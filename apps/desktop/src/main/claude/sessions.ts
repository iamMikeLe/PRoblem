import type { DatabaseSync } from "node:sqlite";
import type { HookCallback, Options } from "@anthropic-ai/claude-agent-sdk";
import {
  type AppEvent,
  type ClaudeCatalog,
  ClaudeCatalogSchema,
  type ConversationEntry,
  type Review,
  type ReviewStatus,
  type SendMessageRequest,
} from "@reviewroom/shared";
import { AppFailure, type Logger } from "../errors.ts";
import { verdictNote } from "../findings/report.ts";
import { markVerdictsTold, untoldVerdicts, type VerdictChange } from "../findings/repository.ts";
import type { FindingsService } from "../findings/service.ts";
import {
  getReviewRecord,
  listInterruptedReviews,
  type ReviewSessionPatch,
  updateOpenReview,
} from "../reviews/repository.ts";
import { appendEntry, listEntries } from "./entries.ts";
import { findingsServer } from "./findingsTool.ts";
import { FINDINGS_SERVER } from "./names.ts";
import { toSignals } from "./normalize.ts";
import { decideToolUse, REVIEW_TOOLS } from "./policy.ts";
import { firstTurnPrompt, REVIEW_SYSTEM_APPEND } from "./prompt.ts";

/** The part of the SDK's `Query` the app uses; tests provide a fake. */
export interface ClaudeQuery extends AsyncIterable<unknown> {
  interrupt(): Promise<unknown>;
  supportedModels(): Promise<unknown>;
  supportedCommands(): Promise<unknown>;
}

/** Starts one Claude turn: `query({ prompt, options })` in the app. */
export type RunQuery = (prompt: string, options: Options) => ClaudeQuery;

export interface SessionServiceDeps {
  db: DatabaseSync;
  runQuery: RunQuery;
  broadcast: (event: AppEvent) => void;
  /** Saves what Claude reports through `report_findings`. */
  findings: Pick<FindingsService, "report">;
  /** Path of the `claude` executable, or `undefined` when Claude Code is not installed. */
  claudePath: () => string | undefined;
  log: Logger;
  /** Turns that may run at the same time; the rest wait as `queued`. */
  maxConcurrent?: number;
  /** How long Stop waits for Claude to wind down before killing the turn. */
  stopTimeoutMs?: number;
  now?: () => Date;
}

export interface SessionService {
  /** Sends the first message of a new review (its review prompt). */
  start(review: Review): void;
  send(request: SendMessageRequest): void;
  stop(reviewId: string): Promise<void>;
  /**
   * Kills a review's turn at once (the review is being closed). Resolves when the turn has ended,
   * or after `waitMs`, so the caller can clean up its folder without Claude still running there.
   */
  cancel(reviewId: string, waitMs?: number): Promise<void>;
  entries(reviewId: string): ReturnType<typeof listEntries>;
  catalog(): ClaudeCatalog;
  /** At startup: turns cut off by a quit are marked as interrupted. */
  recover(): void;
  shutdown(): void;
}

interface Turn {
  readonly abort: AbortController;
  query: ClaudeQuery | undefined;
  stopping: boolean;
  /** Kills the turn if Stop's interrupt does not end it in time. */
  stopTimer: ReturnType<typeof setTimeout> | undefined;
  /** Resolves when the turn has fully ended (its turn-end is stored). */
  readonly done: Promise<void>;
}

/** Claude Code's model aliases, shown until the real list arrives with the first turn. */
const FALLBACK_CATALOG: ClaudeCatalog = {
  models: [
    { value: "opus", displayName: "Opus", description: "Most capable" },
    { value: "sonnet", displayName: "Sonnet", description: "Fast and capable" },
    { value: "haiku", displayName: "Haiku", description: "Fastest" },
  ],
  commands: [],
};

/**
 * Environment of the Claude process (and the git commands it runs): no inherited `GIT_*`
 * variables (which could point git at another repository or config), and no Git LFS downloads
 * from servers a pull request names in `.lfsconfig`.
 */
export function reviewEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const clean: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined && !key.startsWith("GIT_")) clean[key] = value;
  }
  return { ...clean, GIT_LFS_SKIP_SMUDGE: "1", GIT_TERMINAL_PROMPT: "0" };
}

const NOT_INSTALLED =
  "Claude Code was not found on your PATH. Install it (https://code.claude.com), run `claude` once to log in, then restart ReviewRoom.";

export function createSessionService(deps: SessionServiceDeps): SessionService {
  const { db, broadcast, log } = deps;
  const now = deps.now ?? (() => new Date());
  const maxConcurrent = deps.maxConcurrent ?? 3;
  const stopTimeoutMs = deps.stopTimeoutMs ?? 10_000;

  const running = new Map<string, Turn>();
  /** `told`: verdicts the prompt tells Claude about, marked as told once the turn has started. */
  interface QueuedTurn {
    reviewId: string;
    prompt: string;
    told: readonly VerdictChange[];
  }
  const queue: QueuedTurn[] = [];
  let catalog = FALLBACK_CATALOG;
  let catalogRequested = false;
  /** Set by `shutdown()`: the database is about to close, `recover()` handles the rest next start. */
  let closing = false;

  function record(reviewId: string, entry: ConversationEntry): void {
    if (closing) return;
    broadcast({ type: "review.entry", entry: appendEntry(db, reviewId, entry, now()) });
  }

  function patch(reviewId: string, changes: ReviewSessionPatch): void {
    if (closing) return;
    const updated = updateOpenReview(db, reviewId, changes, now());
    if (updated && changes.status !== undefined) {
      broadcast({ type: "review.status", reviewId, status: changes.status });
    }
  }

  function setStatus(reviewId: string, status: ReviewStatus): void {
    patch(reviewId, { status });
  }

  function openReview(reviewId: string): Review {
    const record = getReviewRecord(db, reviewId);
    if (!record || record.closedAt !== null) {
      throw new AppFailure("review_not_found", "Review not found");
    }
    return record.review;
  }

  /** Loads models and slash commands once per app run, from the first turn that starts. */
  function loadCatalog(query: ClaudeQuery): void {
    if (catalogRequested) return;
    catalogRequested = true;
    Promise.all([query.supportedModels(), query.supportedCommands()])
      .then(([models, commands]) => {
        const parsed = ClaudeCatalogSchema.safeParse({ models, commands });
        // The composer has its own "Default model" choice (model = null), so drop Claude Code's.
        if (parsed.success) {
          catalog = {
            ...parsed.data,
            models: parsed.data.models.filter((model) => model.value !== "default"),
          };
        } else log.error("unexpected model or command list from Claude Code");
      })
      .catch((error: unknown) => {
        catalogRequested = false;
        log.error("could not load models and commands", { error });
      });
  }

  function optionsFor(review: Review, turn: Turn, executable: string): Options {
    const gate: HookCallback = async (input) => {
      if (input.hook_event_name !== "PreToolUse") return {};
      const decision = decideToolUse(input.tool_name, input.tool_input, review.workdir);
      if (!decision.allow)
        log.info("tool call denied", { review: review.id, tool: input.tool_name });
      return {
        hookSpecificOutput: decision.allow
          ? {
              hookEventName: "PreToolUse",
              permissionDecision: "allow",
              ...(decision.updatedInput ? { updatedInput: decision.updatedInput } : {}),
            }
          : {
              hookEventName: "PreToolUse",
              permissionDecision: "deny",
              permissionDecisionReason: decision.reason,
            },
      };
    };
    return {
      cwd: review.workdir,
      pathToClaudeCodeExecutable: executable,
      abortController: turn.abort,
      ...(review.sessionId ? { resume: review.sessionId } : {}),
      ...(review.model ? { model: review.model } : {}),
      // Only the tools a read-only review needs; the gate checks each call on top (ADR 0005).
      tools: [...REVIEW_TOOLS],
      // Never the user's defaultMode (it could be bypassPermissions) and never the checkout's own
      // settings: a pull request could ship `.claude/settings.json` with hooks that run commands.
      permissionMode: "default",
      settingSources: ["user"],
      // Only the app's own server: report_findings, bound to this review (ADR 0004).
      strictMcpConfig: true,
      mcpServers: {
        [FINDINGS_SERVER]: findingsServer((input) =>
          deps.findings.report(review.id, review.workdir, input),
        ),
      },
      hooks: { PreToolUse: [{ hooks: [gate] }] },
      // Anything that still reaches a permission prompt is refused: there is nobody to ask yet.
      canUseTool: async () => ({
        behavior: "deny",
        message: "This review is read-only; the call was refused.",
      }),
      // Our gate must run even if the user's settings disable hooks.
      settings: { disableAllHooks: false },
      env: reviewEnv(process.env),
      includePartialMessages: true,
      systemPrompt: { type: "preset", preset: "claude_code", append: REVIEW_SYSTEM_APPEND },
    };
  }

  const turnEnd = (
    outcome: "error" | "interrupted",
    message: string,
  ): Extract<ConversationEntry, { kind: "turn-end" }> => ({
    kind: "turn-end",
    outcome,
    costUsd: null,
    durationMs: null,
    message,
  });

  async function runTurn({ reviewId, prompt, told }: QueuedTurn): Promise<void> {
    let finish!: () => void;
    const turn: Turn = {
      abort: new AbortController(),
      query: undefined,
      stopping: false,
      stopTimer: undefined,
      done: new Promise((resolve) => {
        finish = resolve;
      }),
    };
    running.set(reviewId, turn);
    let ended: ConversationEntry | undefined;
    const end = (entry: ConversationEntry) => {
      ended = entry;
      record(reviewId, entry);
    };

    try {
      setStatus(reviewId, "running");
      const review = openReview(reviewId);
      const executable = deps.claudePath();
      if (!executable) throw new AppFailure("claude_unavailable", NOT_INSTALLED);
      const query = deps.runQuery(prompt, optionsFor(review, turn, executable));
      turn.query = query;
      for await (const message of query) {
        for (const signal of toSignals(message, review.workdir)) {
          if (signal.type === "session") {
            // Claude has the message now; a stopped or failed start keeps the note for next time.
            if (told.length > 0 && !closing) markVerdictsTold(db, reviewId, told);
            if (signal.sessionId !== review.sessionId) {
              patch(reviewId, { sessionId: signal.sessionId });
              broadcast({ type: "review.session", reviewId, sessionId: signal.sessionId });
            }
            loadCatalog(query);
          } else if (signal.type === "delta") {
            broadcast({ type: "review.delta", reviewId, text: signal.text });
          } else if (signal.entry.kind === "turn-end") {
            // A turn that finished anyway keeps its result, even if Stop was clicked meanwhile.
            const stopped = turn.stopping && signal.entry.outcome !== "success";
            end(
              stopped
                ? { ...signal.entry, outcome: "interrupted", message: "Stopped." }
                : signal.entry,
            );
          } else {
            record(reviewId, signal.entry);
          }
        }
      }
    } catch (error) {
      if (ended) {
        log.error("claude failed after the turn had ended", { review: reviewId, error });
      } else if (turn.stopping) {
        end(turnEnd("interrupted", "Stopped."));
      } else {
        log.error("claude turn failed", { review: reviewId, error });
        end(turnEnd("error", error instanceof Error ? error.message : String(error)));
      }
    } finally {
      // Release the review first: whatever happens below, it must not stay busy forever.
      running.delete(reviewId);
      clearTimeout(turn.stopTimer);
      try {
        if (!ended) {
          end(
            turn.stopping
              ? turnEnd("interrupted", "Stopped.")
              : turnEnd("error", "Claude ended the turn without a result."),
          );
        }
        const failed = ended?.kind === "turn-end" && ended.outcome === "error";
        setStatus(reviewId, failed ? "failed" : "idle");
      } catch (error) {
        log.error("could not record the end of a turn", { review: reviewId, error });
      }
      finish();
      pump();
    }
  }

  function pump(): void {
    while (running.size < maxConcurrent) {
      const next = queue.shift();
      if (!next) return;
      void runTurn(next);
    }
  }

  function assertIdle(reviewId: string): void {
    if (running.has(reviewId) || queue.some((item) => item.reviewId === reviewId)) {
      throw new AppFailure(
        "review_busy",
        "Claude is still working on this review. Stop it or wait.",
      );
    }
  }

  function enqueue(reviewId: string, text: string, told: readonly VerdictChange[] = []): void {
    assertIdle(reviewId);
    record(reviewId, { kind: "user", text });
    setStatus(reviewId, "queued");
    queue.push({ reviewId, prompt: text, told });
    pump();
  }

  function dequeue(reviewId: string): boolean {
    const index = queue.findIndex((item) => item.reviewId === reviewId);
    if (index < 0) return false;
    queue.splice(index, 1);
    return true;
  }

  return {
    start(review) {
      enqueue(review.id, firstTurnPrompt(review));
    },

    send({ id, text, model }) {
      const review = openReview(id);
      assertIdle(id);
      if (model !== review.model) patch(id, { model });
      // Tell Claude which findings the user accepted or dismissed since the last message.
      const told = untoldVerdicts(db, id);
      const note = verdictNote(told);
      enqueue(id, note ? `${note}\n\n${text}` : text, told);
    },

    async stop(reviewId) {
      if (dequeue(reviewId)) {
        record(reviewId, {
          kind: "turn-end",
          outcome: "interrupted",
          costUsd: null,
          durationMs: null,
          message: "Stopped before Claude started.",
        });
        setStatus(reviewId, "idle");
        return;
      }
      const turn = running.get(reviewId);
      if (!turn || turn.stopping) return;
      turn.stopping = true;
      // Ask Claude Code to stop cleanly; kill the turn if it does not end in time.
      turn.stopTimer = setTimeout(() => turn.abort.abort(), stopTimeoutMs);
      turn.stopTimer.unref?.();
      try {
        await turn.query?.interrupt();
      } catch (error) {
        log.error("interrupt failed; aborting the turn", { review: reviewId, error });
        turn.abort.abort();
      }
    },

    async cancel(reviewId, waitMs = 5000) {
      dequeue(reviewId);
      const turn = running.get(reviewId);
      if (!turn) return;
      turn.stopping = true;
      turn.abort.abort();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, waitMs);
      });
      await Promise.race([turn.done, timeout]);
      clearTimeout(timer);
    },

    entries: (reviewId) => listEntries(db, reviewId),
    catalog: () => catalog,

    recover() {
      for (const review of listInterruptedReviews(db)) {
        record(review.id, {
          kind: "turn-end",
          outcome: "interrupted",
          costUsd: null,
          durationMs: null,
          message: "ReviewRoom closed while Claude was working. Send a message to continue.",
        });
        setStatus(review.id, "idle");
      }
    },

    shutdown() {
      closing = true;
      queue.length = 0;
      for (const turn of running.values()) {
        turn.stopping = true;
        turn.abort.abort();
      }
    },
  };
}
