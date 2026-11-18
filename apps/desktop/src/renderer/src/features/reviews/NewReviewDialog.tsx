import {
  Button,
  Combobox,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Dropdown,
  Field,
  MessageBar,
  MessageBarBody,
  makeStyles,
  Option,
  Switch,
  Textarea,
  tokens,
} from "@fluentui/react-components";
import { type Project, REVIEW_SOURCE_MAX, type Review } from "@problem/shared";
import { type FormEvent, useState } from "react";
import { AppRequestError } from "../../lib/api.ts";
import { loadIsolated, saveIsolated } from "./isolationPreference.ts";
import { useBranches, useCreateReview } from "./queries.ts";

const useStyles = makeStyles({
  content: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalM },
  prompt: { minHeight: "140px" },
});

/** Error codes about the "Branch or pull request" input, and about the base branch. */
const SOURCE_ERRORS = new Set(["invalid_source", "branch_not_found", "pr_repo_mismatch"]);
const BASE_ERRORS = new Set(["base_not_found"]);

type ErrorPlace = "source" | "base" | "general";
function placeOf(error: Error): ErrorPlace {
  const code = error instanceof AppRequestError ? error.code : "";
  if (SOURCE_ERRORS.has(code)) return "source";
  if (BASE_ERRORS.has(code)) return "base";
  return "general";
}

const fieldError = (message: string | undefined) =>
  message ? ({ validationState: "error", validationMessage: message } as const) : {};

/** At most this many branch suggestions are rendered; typing narrows them. */
const MAX_SUGGESTIONS = 50;

interface Props {
  open: boolean;
  projects: readonly Project[];
  /** Preselected project (the one the user was looking at). */
  initialProjectId: string | undefined;
  onClose: () => void;
  onCreated: (review: Review) => void;
}

interface FormState {
  projectId: string | undefined;
  source: string;
  base: string;
  isolated: boolean;
  prompt: string;
}

function initialState(projects: readonly Project[], projectId: string | undefined): FormState {
  const project = projects.find((p) => p.id === projectId) ?? projects[0];
  return {
    projectId: project?.id,
    source: "",
    base: "",
    isolated: project ? loadIsolated(project.id) : true,
    prompt: project?.reviewPrompt ?? "",
  };
}

/** Starts a review of a branch or a GitHub pull request. */
export function NewReviewDialog({ open, projects, initialProjectId, onClose, onCreated }: Props) {
  const styles = useStyles();
  const create = useCreateReview();
  const [form, setForm] = useState<FormState>(() => initialState(projects, initialProjectId));
  const branches = useBranches(open ? form.projectId : undefined);

  const update = (patch: Partial<FormState>) => {
    setForm((current) => ({ ...current, ...patch }));
    if (create.isError) create.reset();
  };

  const selectProject = (projectId: string) => {
    const project = projects.find((p) => p.id === projectId);
    if (!project) return;
    update({
      projectId,
      isolated: loadIsolated(projectId),
      prompt: project.reviewPrompt,
      base: "",
    });
  };

  const close = () => {
    if (create.isPending) return;
    create.reset();
    setForm(initialState(projects, initialProjectId));
    onClose();
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const { projectId } = form;
    if (!projectId) return;
    saveIsolated(projectId, form.isolated);
    const base = form.base.trim();
    create.mutate(
      {
        projectId,
        source: form.source.trim(),
        isolated: form.isolated,
        prompt: form.prompt,
        ...(base ? { base } : {}),
      },
      {
        onSuccess: (review) => {
          create.reset();
          setForm(initialState(projects, projectId));
          onCreated(review);
        },
      },
    );
  };

  const suggestions = (query: string) => {
    const needle = query.trim().toLowerCase();
    return (branches.data ?? [])
      .filter((name) => name.toLowerCase().includes(needle))
      .slice(0, MAX_SUGGESTIONS);
  };
  const isUrl = form.source.includes("://");
  const errorPlace = create.isError ? placeOf(create.error) : undefined;
  const errorFor = (place: ErrorPlace) =>
    create.isError && errorPlace === place ? create.error.message : undefined;
  const project = projects.find((p) => p.id === form.projectId);

  return (
    <Dialog open={open} onOpenChange={(_, data) => (data.open ? undefined : close())}>
      <DialogSurface>
        <form onSubmit={submit}>
          <DialogBody>
            <DialogTitle>New review</DialogTitle>
            <DialogContent className={styles.content}>
              <Field label="Project" required>
                <Dropdown
                  value={project?.name ?? ""}
                  selectedOptions={form.projectId ? [form.projectId] : []}
                  onOptionSelect={(_, data) => data.optionValue && selectProject(data.optionValue)}
                >
                  {projects.map((p) => (
                    <Option key={p.id} value={p.id}>
                      {p.name}
                    </Option>
                  ))}
                </Dropdown>
              </Field>
              <Field
                label="Branch or pull request"
                required
                hint="A branch name, or a GitHub pull request link."
                {...fieldError(errorFor("source"))}
              >
                <Combobox
                  freeform
                  value={form.source}
                  maxLength={REVIEW_SOURCE_MAX}
                  placeholder="feature/my-change or https://github.com/…/pull/42"
                  onChange={(event) => update({ source: event.target.value })}
                  onOptionSelect={(_, data) => update({ source: data.optionValue ?? form.source })}
                >
                  {isUrl
                    ? null
                    : suggestions(form.source).map((name) => <Option key={name}>{name}</Option>)}
                </Combobox>
              </Field>
              <Field
                label="Base branch"
                hint="Optional. Defaults to the pull request's base, or the remote's default branch."
                {...fieldError(errorFor("base"))}
              >
                <Combobox
                  freeform
                  value={form.base}
                  maxLength={REVIEW_SOURCE_MAX}
                  placeholder="main"
                  onChange={(event) => update({ base: event.target.value })}
                  onOptionSelect={(_, data) => update({ base: data.optionValue ?? form.base })}
                >
                  {suggestions(form.base).map((name) => (
                    <Option key={name}>{name}</Option>
                  ))}
                </Combobox>
              </Field>
              <Field
                hint={
                  form.isolated
                    ? "Checks out the code in a separate folder. Your project folder is not touched."
                    : "Checks out the code in your project folder (no uncommitted changes allowed). Your branch is restored when the review closes."
                }
              >
                <Switch
                  label="Isolated worktree"
                  checked={form.isolated}
                  onChange={(_, data) => update({ isolated: data.checked })}
                />
              </Field>
              {errorFor("general") && (
                <MessageBar intent="error">
                  <MessageBarBody>{errorFor("general")}</MessageBarBody>
                </MessageBar>
              )}
              <Field
                label="Review prompt"
                hint="Copied from the project; changes apply to this review only."
              >
                <Textarea
                  className={styles.prompt}
                  resize="vertical"
                  value={form.prompt}
                  onChange={(_, data) => update({ prompt: data.value })}
                />
              </Field>
            </DialogContent>
            <DialogActions>
              <Button appearance="secondary" onClick={close} disabled={create.isPending}>
                Cancel
              </Button>
              <Button
                appearance="primary"
                type="submit"
                disabled={
                  !form.projectId ||
                  form.source.trim() === "" ||
                  form.prompt.trim() === "" ||
                  create.isPending
                }
              >
                {create.isPending ? "Starting…" : "Start review"}
              </Button>
            </DialogActions>
          </DialogBody>
        </form>
      </DialogSurface>
    </Dialog>
  );
}
