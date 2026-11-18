import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { HookCallback, Options } from "@anthropic-ai/claude-agent-sdk";
import type { AppEvent, ConversationEntry, Review } from "@reviewroom/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type ClaudeQuery,
  createSessionService,
  type RunQuery,
  reviewEnv,
  type SessionService,
} from "../../../src/main/claude/sessions.ts";
import { openDatabase } from "../../../src/main/db/database.ts";
import { AppFailure, silentLogger } from "../../../src/main/errors.ts";
import { insertFinding, setVerdict } from "../../../src/main/findings/repository.ts";
import { createFindingsService } from "../../../src/main/findings/service.ts";
import { insertProject } from "../../../src/main/projects/repository.ts";
import { getReviewRecord, insertReview } from "../../../src/main/reviews/repository.ts";

const SHA = (c: string) => c.repeat(40);

/** SDK messages as Claude Code streams them (only the fields the app reads). */
const sdk = {
  init: (sessionId = "session-1") => ({ type: "system", subtype: "init", session_id: sessionId }),
  delta: (text: string) => ({
    type: "stream_event",
    parent_tool_use_id: null,
    event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
  }),
  text: (text: string) => ({
    type: "assistant",
    parent_tool_use_id: null,
    message: { content: [{ type: "text", text }] },
  }),
  toolUse: (id: string, name: string, input: unknown) => ({
    type: "assistant",
    parent_tool_use_id: null,
    message: { content: [{ type: "tool_use", id, name, input }] },
  }),
  toolResult: (id: string, content: string) => ({
    type: "user",
    parent_tool_use_id: null,
    message: { content: [{ type: "tool_result", tool_use_id: id, content }] },
  }),
  success: (result = "done") => ({
    type: "result",
    subtype: "success",
    is_error: false,
    result,
    total_cost_usd: 0.25,
    duration_ms: 4200,
  }),
};

interface FakeTurn {
  prompt: string;
  options: Options;
  /** Lets the turn run to the end of its script. */
  release(): void;
  interrupted: boolean;
}

/**
 * A scripted `query`: yields the messages, optionally pausing before the result until released.
 * Interrupting ends the turn the way Claude Code does (an error result).
 */
interface Script {
  messages: unknown[];
  /** Pause before the last message until `release()` (or an abort). */
  hold?: boolean;
  /** Ignore interrupts: the turn finishes normally (Stop arrived too late). */
  finishAnyway?: boolean;
  /** Throw after the last message (the process exits badly after its result). */
  throwAfter?: boolean;
}

function fakeClaude(script: (turn: number) => Script) {
  const turns: FakeTurn[] = [];
  const runQuery: RunQuery = (prompt, options) => {
    const { messages, hold, finishAnyway, throwAfter } = script(turns.length);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    if (!hold) release();
    options.abortController?.signal.addEventListener("abort", () => release());
    const turn: FakeTurn = { prompt, options, release, interrupted: false };
    turns.push(turn);
    const query: ClaudeQuery = {
      async *[Symbol.asyncIterator]() {
        const last = messages.at(-1);
        for (const message of messages.slice(0, -1)) yield message;
        await gate;
        if (options.abortController?.signal.aborted) throw new Error("aborted");
        if (turn.interrupted && !finishAnyway) {
          yield { type: "result", subtype: "error_during_execution", is_error: true, errors: [] };
          return;
        }
        if (last !== undefined) yield last;
        if (throwAfter) throw new Error("exited with code 1");
      },
      interrupt: async () => {
        turn.interrupted = true;
        release();
      },
      supportedModels: async () => [
        { value: "default", displayName: "Default (recommended)", description: "Opus" },
        { value: "opus", displayName: "Opus", description: "Most capable" },
      ],
      supportedCommands: async () => [
        { name: "security-review", description: "Security review", argumentHint: "" },
      ],
    };
    return query;
  };
  return { runQuery, turns };
}

describe("session service", () => {
  let db: DatabaseSync;
  let dir: string;
  let events: AppEvent[];
  let review: Review;

  function addReview(id: string): Review {
    const project = insertProject(db, {
      name: `p-${id}`,
      path: join(dir, id),
      reviewPrompt: "Review it.",
    });
    const value: Review = {
      id,
      projectId: project.id,
      title: "Retry webhooks",
      source: { kind: "branch", branch: "feature" },
      headBranch: "feature",
      headSha: SHA("a"),
      baseBranch: "main",
      baseSha: SHA("b"),
      mergeBaseSha: SHA("c"),
      workdir: dir,
      isolated: true,
      prompt: "Review it.",
      status: "idle",
      sessionId: null,
      model: null,
      createdAt: "2026-11-17T10:00:00.000Z",
      updatedAt: "2026-11-17T10:00:00.000Z",
    };
    insertReview(db, value, null);
    return value;
  }

  function service(runQuery: RunQuery, overrides: { maxConcurrent?: number } = {}) {
    return createSessionService({
      db,
      runQuery,
      broadcast: (event) => events.push(event),
      findings: createFindingsService({ db, broadcast: (event) => events.push(event) }),
      claudePath: () => "/usr/local/bin/claude",
      log: silentLogger,
      ...overrides,
    });
  }

  const entries = (sessions: SessionService, id = review.id): ConversationEntry[] =>
    sessions.entries(id).map((stored) => stored.entry);
  const status = (id = review.id) => getReviewRecord(db, id)?.review.status;
  const settle = () => vi.waitFor(() => expect(status()).not.toMatch(/queued|running/));

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "reviewroom-sessions-"));
    db = openDatabase(":memory:");
    events = [];
    review = addReview("r1");
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("runs the first turn with the review prompt and stores the conversation in order", async () => {
    const claude = fakeClaude(() => ({
      messages: [
        sdk.init(),
        sdk.delta("Looking"),
        sdk.toolUse("t1", "Bash", { command: "git diff main feature" }),
        sdk.toolResult("t1", "+ retry()"),
        sdk.text("One **major** issue."),
        sdk.success(),
      ],
    }));
    const sessions = service(claude.runQuery);

    sessions.start(review);
    await settle();

    expect(claude.turns[0]?.prompt).toContain("Review it.");
    expect(claude.turns[0]?.prompt).toContain(`git diff ${SHA("c")} ${SHA("a")}`);
    expect(entries(sessions).map((e) => e.kind)).toEqual([
      "user",
      "tool-call",
      "tool-result",
      "assistant",
      "turn-end",
    ]);
    expect(entries(sessions)).toContainEqual({
      kind: "turn-end",
      outcome: "success",
      costUsd: 0.25,
      durationMs: 4200,
      message: null,
    });
    expect(sessions.entries(review.id).map((e) => e.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(status()).toBe("idle");
    expect(getReviewRecord(db, review.id)?.review.sessionId).toBe("session-1");

    // Status goes queued → running → idle; live text is broadcast but never stored.
    const statuses = events.flatMap((e) => (e.type === "review.status" ? [e.status] : []));
    expect(statuses).toEqual(["queued", "running", "idle"]);
    expect(events).toContainEqual({ type: "review.delta", reviewId: review.id, text: "Looking" });
    expect(events.filter((e) => e.type === "review.entry")).toHaveLength(5);
  });

  it("resumes the stored session on the next message and keeps the chosen model", async () => {
    const claude = fakeClaude(() => ({ messages: [sdk.init(), sdk.success()] }));
    const sessions = service(claude.runQuery);
    sessions.start(review);
    await settle();

    sessions.send({ id: review.id, text: "Check the tests too", model: "opus" });
    await settle();

    expect(claude.turns[0]?.options.resume).toBeUndefined();
    expect(claude.turns[1]?.options).toMatchObject({ resume: "session-1", model: "opus" });
    expect(claude.turns[1]?.prompt).toBe("Check the tests too");
    expect(getReviewRecord(db, review.id)?.review.model).toBe("opus");
  });

  it("runs every turn read-only: own tools only, no project settings, only the app's MCP server, gate on every call", async () => {
    const claude = fakeClaude(() => ({ messages: [sdk.init(), sdk.success()] }));
    service(claude.runQuery).start(review);
    await settle();

    const options = claude.turns[0]?.options;
    expect(options).toMatchObject({
      cwd: dir,
      pathToClaudeCodeExecutable: "/usr/local/bin/claude",
      tools: ["Read", "Grep", "Glob", "Bash"],
      permissionMode: "default",
      settingSources: ["user"],
      strictMcpConfig: true,
      settings: { disableAllHooks: false },
    });
    expect(Object.keys(options?.mcpServers ?? {})).toEqual(["reviewroom"]);
    expect(options?.mcpServers?.reviewroom).toMatchObject({ type: "sdk", name: "reviewroom" });
    expect(options?.env?.GIT_LFS_SKIP_SMUDGE).toBe("1");

    const gate: HookCallback | undefined = options?.hooks?.PreToolUse?.[0]?.hooks[0];
    if (!gate) throw new Error("no PreToolUse hook");
    const ask = (tool_name: string, tool_input: unknown) =>
      gate(
        {
          hook_event_name: "PreToolUse",
          tool_name,
          tool_input,
          tool_use_id: "t",
          session_id: "s",
          transcript_path: "",
          cwd: dir,
        },
        "t",
        { signal: new AbortController().signal },
      );
    expect(await ask("Bash", { command: "git log --oneline" })).toMatchObject({
      hookSpecificOutput: {
        permissionDecision: "allow",
        updatedInput: { command: "git log --no-ext-diff --no-textconv --oneline" },
      },
    });
    expect(await ask("Bash", { command: "rm -rf ." })).toMatchObject({
      hookSpecificOutput: { permissionDecision: "deny" },
    });
    expect(await ask("mcp__reviewroom__report_findings", { add: [] })).toMatchObject({
      hookSpecificOutput: { permissionDecision: "allow" },
    });
    expect(await ask("mcp__other__report_findings", {})).toMatchObject({
      hookSpecificOutput: { permissionDecision: "deny" },
    });
    expect(await ask("Write", { file_path: join(dir, "x"), content: "" })).toMatchObject({
      hookSpecificOutput: { permissionDecision: "deny" },
    });
    expect(
      await options?.canUseTool?.(
        "Edit",
        {},
        { signal: new AbortController().signal, toolUseID: "t", requestId: "r" },
      ),
    ).toMatchObject({ behavior: "deny" });
  });

  it("tells Claude about verdicts changed since the last message, once", async () => {
    const claude = fakeClaude(() => ({ messages: [sdk.init(), sdk.success()] }));
    const sessions = service(claude.runQuery);
    sessions.start(review);
    await settle();
    const at = new Date("2026-11-18T10:00:00.000Z");
    const content = {
      severity: "major",
      file: null,
      line: null,
      problem: "p",
      suggestion: "s",
    } as const;
    insertFinding(db, review.id, { ...content, title: "Retries never stop" }, at);
    insertFinding(db, review.id, { ...content, title: "Missing test" }, at);
    insertFinding(db, review.id, { ...content, title: "Unchanged" }, at);
    setVerdict(db, review.id, 1, "dismissed", at);
    setVerdict(db, review.id, 2, "accepted", at);

    sessions.send({ id: review.id, text: "Anything else?", model: null });
    await settle();
    sessions.send({ id: review.id, text: "Thanks", model: null });
    await settle();

    expect(claude.turns[1]?.prompt).toBe(
      '[ReviewRoom] Since my last message I have:\n- dismissed #1 "Retries never stop"\n- accepted #2 "Missing test"\n\nAnything else?',
    );
    expect(claude.turns[2]?.prompt).toBe("Thanks");
  });

  it("keeps an untold verdict when the message is refused as busy", async () => {
    const claude = fakeClaude((turn) => ({
      messages: [sdk.init(), sdk.success()],
      hold: turn === 0,
    }));
    const sessions = service(claude.runQuery);
    sessions.start(review);
    await vi.waitFor(() => expect(claude.turns).toHaveLength(1));
    const at = new Date("2026-11-18T10:00:00.000Z");
    insertFinding(
      db,
      review.id,
      { severity: "nit", title: "Typo", file: null, line: null, problem: "p", suggestion: "s" },
      at,
    );
    setVerdict(db, review.id, 1, "dismissed", at);

    expect(() => sessions.send({ id: review.id, text: "Hi", model: null })).toThrow(AppFailure);
    claude.turns[0]?.release();
    await settle();
    sessions.send({ id: review.id, text: "Hi", model: null });
    await settle();
    expect(claude.turns[1]?.prompt).toContain('dismissed #1 "Typo"');
  });

  it("tells Claude again when the message with the note was stopped before Claude started", async () => {
    const claude = fakeClaude((turn) => ({
      messages: [sdk.init(), sdk.success()],
      hold: turn === 0,
    }));
    const sessions = service(claude.runQuery, { maxConcurrent: 1 });
    const other = addReview("r2");
    sessions.start(other); // occupies the only slot, so r1's next turn waits in the queue
    await vi.waitFor(() => expect(claude.turns).toHaveLength(1));
    const at = new Date("2026-11-18T10:00:00.000Z");
    insertFinding(
      db,
      review.id,
      { severity: "nit", title: "Typo", file: null, line: null, problem: "p", suggestion: "s" },
      at,
    );
    setVerdict(db, review.id, 1, "dismissed", at);

    sessions.send({ id: review.id, text: "First", model: null });
    await sessions.stop(review.id);
    claude.turns[0]?.release();
    await vi.waitFor(() => expect(status(other.id)).toBe("idle"));

    sessions.send({ id: review.id, text: "Second", model: null });
    await settle();
    expect(claude.turns[1]?.prompt).toContain('dismissed #1 "Typo"');
    expect(claude.turns[1]?.prompt).toContain("Second");
  });

  it("refuses a message while a turn is running", async () => {
    const claude = fakeClaude(() => ({ messages: [sdk.init(), sdk.success()], hold: true }));
    const sessions = service(claude.runQuery);
    sessions.start(review);
    await vi.waitFor(() => expect(status()).toBe("running"));

    expect(() => sessions.send({ id: review.id, text: "again", model: null })).toThrow(AppFailure);

    claude.turns[0]?.release();
    await settle();
  });

  it("stops a running turn: the turn ends as interrupted and the review is usable again", async () => {
    const claude = fakeClaude(() => ({ messages: [sdk.init(), sdk.success()], hold: true }));
    const sessions = service(claude.runQuery);
    sessions.start(review);
    await vi.waitFor(() => expect(status()).toBe("running"));

    await sessions.stop(review.id);
    await settle();

    expect(entries(sessions).at(-1)).toMatchObject({ kind: "turn-end", outcome: "interrupted" });
    expect(status()).toBe("idle");
    sessions.send({ id: review.id, text: "continue", model: null });
    await vi.waitFor(() => expect(claude.turns).toHaveLength(2));
    claude.turns[1]?.release();
    await settle();
    expect(entries(sessions).at(-1)).toMatchObject({ kind: "turn-end", outcome: "success" });
  });

  it("queues turns beyond the concurrency limit and stops a queued one without running it", async () => {
    const second = addReview("r2");
    const third = addReview("r3");
    const claude = fakeClaude(() => ({ messages: [sdk.init(), sdk.success()], hold: true }));
    const sessions = service(claude.runQuery, { maxConcurrent: 1 });

    sessions.start(review);
    sessions.start(second);
    sessions.start(third);
    await vi.waitFor(() => expect(claude.turns).toHaveLength(1));
    expect(status(second.id)).toBe("queued");

    await sessions.stop(third.id);
    expect(status(third.id)).toBe("idle");
    expect(entries(sessions, third.id).at(-1)).toMatchObject({ outcome: "interrupted" });

    claude.turns[0]?.release();
    await vi.waitFor(() => expect(claude.turns).toHaveLength(2));
    claude.turns[1]?.release();
    await vi.waitFor(() => expect(status(second.id)).toBe("idle"));
    expect(claude.turns).toHaveLength(2);
  });

  it("fails the turn with a clear message when Claude Code is not installed", async () => {
    const claude = fakeClaude(() => ({ messages: [] }));
    const sessions = createSessionService({
      db,
      runQuery: claude.runQuery,
      broadcast: () => {},
      findings: createFindingsService({ db, broadcast: () => {} }),
      claudePath: () => undefined,
      log: silentLogger,
    });
    sessions.start(review);
    await settle();

    expect(status()).toBe("failed");
    expect(entries(sessions).at(-1)).toMatchObject({
      kind: "turn-end",
      outcome: "error",
      message: expect.stringContaining("Claude Code was not found"),
    });
    expect(claude.turns).toHaveLength(0);
  });

  it("records an error turn when Claude Code reports a failure", async () => {
    const claude = fakeClaude(() => ({
      messages: [
        sdk.init(),
        { type: "result", subtype: "error_max_turns", is_error: true, errors: ["Too many turns"] },
      ],
    }));
    const sessions = service(claude.runQuery);
    sessions.start(review);
    await settle();

    expect(status()).toBe("failed");
    expect(entries(sessions).at(-1)).toMatchObject({ outcome: "error", message: "Too many turns" });
  });

  it("marks turns cut off by a quit as interrupted at the next start", () => {
    db.prepare("UPDATE reviews SET status = 'running' WHERE id = ?").run(review.id);
    const sessions = service(fakeClaude(() => ({ messages: [] })).runQuery);

    sessions.recover();

    expect(status()).toBe("idle");
    expect(entries(sessions)).toEqual([
      expect.objectContaining({ kind: "turn-end", outcome: "interrupted" }),
    ]);
  });

  it("loads models and slash commands from the first session", async () => {
    const claude = fakeClaude(() => ({ messages: [sdk.init(), sdk.success()] }));
    const sessions = service(claude.runQuery);
    expect(sessions.catalog().commands).toEqual([]);

    sessions.start(review);
    await settle();

    await vi.waitFor(() =>
      expect(sessions.catalog()).toEqual({
        models: [{ value: "opus", displayName: "Opus", description: "Most capable" }],
        commands: [{ name: "security-review", description: "Security review", argumentHint: "" }],
      }),
    );
  });

  it("gives Claude a git environment without inherited GIT_ variables and without LFS downloads", () => {
    expect(reviewEnv({ PATH: "/usr/bin", GIT_DIR: "/elsewhere", GIT_CONFIG_GLOBAL: "/x" })).toEqual(
      {
        PATH: "/usr/bin",
        GIT_LFS_SKIP_SMUDGE: "1",
        GIT_TERMINAL_PROMPT: "0",
      },
    );
  });

  it("keeps the result of a turn that finished while Stop was on its way", async () => {
    const claude = fakeClaude(() => ({
      messages: [sdk.init(), sdk.success()],
      hold: true,
      finishAnyway: true,
    }));
    const sessions = service(claude.runQuery);
    sessions.start(review);
    await vi.waitFor(() => expect(status()).toBe("running"));

    await sessions.stop(review.id);
    await settle();

    expect(entries(sessions).at(-1)).toMatchObject({
      kind: "turn-end",
      outcome: "success",
      costUsd: 0.25,
    });
  });

  it("keeps a stored result when Claude Code fails afterwards", async () => {
    const claude = fakeClaude(() => ({ messages: [sdk.init(), sdk.success()], throwAfter: true }));
    const sessions = service(claude.runQuery);
    sessions.start(review);
    await settle();

    expect(status()).toBe("idle");
    expect(entries(sessions).filter((e) => e.kind === "turn-end")).toEqual([
      expect.objectContaining({ outcome: "success" }),
    ]);
  });

  it("closing waits until the killed turn has ended", async () => {
    const claude = fakeClaude(() => ({ messages: [sdk.init(), sdk.success()], hold: true }));
    const sessions = service(claude.runQuery);
    sessions.start(review);
    await vi.waitFor(() => expect(status()).toBe("running"));

    await sessions.cancel(review.id);

    expect(entries(sessions).at(-1)).toMatchObject({ kind: "turn-end", outcome: "interrupted" });
    expect(status()).toBe("idle");
    sessions.send({ id: review.id, text: "still usable", model: null });
  });

  it("writes nothing after shutdown (the database is closing); recover() cleans up next start", async () => {
    const claude = fakeClaude(() => ({ messages: [sdk.init(), sdk.success()], hold: true }));
    const sessions = service(claude.runQuery);
    sessions.start(review);
    await vi.waitFor(() =>
      expect(getReviewRecord(db, review.id)?.review.sessionId).toBe("session-1"),
    );
    const stored = entries(sessions).length;
    events = [];

    sessions.shutdown();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(entries(sessions)).toHaveLength(stored);
    expect(events).toEqual([]);
    expect(status()).toBe("running");
  });
});
