import {
  Button,
  Caption1,
  Field,
  Input,
  MessageBar,
  MessageBarActions,
  MessageBarBody,
  MessageBarTitle,
  makeStyles,
  mergeClasses,
  Spinner,
  Switch,
  Tab,
  TabList,
  Text,
  Tree,
  TreeItem,
  TreeItemLayout,
  tokens,
} from "@fluentui/react-components";
import { ArrowSyncRegular, DocumentRegular, FolderRegular } from "@fluentui/react-icons";
import {
  type ChangedFile,
  type ChangeFilters,
  DEFAULT_CHANGE_FILTERS,
  type Finding,
  hiddenBy,
  type Project,
  type Review,
} from "@problem/shared";
import { useMemo, useState } from "react";
import { useIsBusy } from "../conversation/store.ts";
import { useFindings, useOpenInEditor } from "../findings/queries.ts";
import { useUpdateProject } from "../projects/queries.ts";
import { shortSha } from "../reviews/describe.ts";
import { DiffView, shownNewLines } from "./DiffView.tsx";
import { buildTree, type DiffMode, loadDiffMode, saveDiffMode, type TreeNode } from "./model.ts";
import { useChangeSet, useFileDiff, useRefreshReview, useUpdateCheck } from "./queries.ts";

const STATUS_LETTER: Record<ChangedFile["status"], string> = {
  added: "A",
  modified: "M",
  deleted: "D",
  renamed: "R",
  copied: "C",
  "type-changed": "T",
};

const useStyles = makeStyles({
  root: {
    display: "grid",
    gridTemplateRows: "auto minmax(0, 1fr)",
    gridTemplateColumns: "minmax(0, 1fr)",
    minHeight: 0,
  },
  banner: { padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalL} 0` },
  status: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
    color: tokens.colorNeutralForeground3,
  },
  body: {
    display: "grid",
    gridTemplateColumns: "300px minmax(0, 1fr)",
    minHeight: 0,
    marginTop: tokens.spacingVerticalS,
    borderTop: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
  },
  side: {
    display: "grid",
    gridTemplateRows: "auto minmax(0, 1fr)",
    minHeight: 0,
    borderRight: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
  },
  filters: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXS,
    padding: tokens.spacingHorizontalM,
    borderBottom: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
  },
  tree: { overflowY: "auto", minHeight: 0, paddingBlock: tokens.spacingVerticalXS },
  hidden: {
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
    color: tokens.colorNeutralForeground3,
  },
  hiddenFile: {
    display: "flex",
    justifyContent: "flex-start",
    width: "100%",
    fontFamily: tokens.fontFamilyMonospace,
    overflowWrap: "anywhere",
    textAlign: "left",
  },
  fileName: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  selected: { backgroundColor: tokens.colorNeutralBackground1Selected },
  counts: {
    display: "flex",
    gap: tokens.spacingHorizontalXS,
    fontFamily: tokens.fontFamilyMonospace,
  },
  added: { color: tokens.colorPaletteGreenForeground1 },
  deleted: { color: tokens.colorPaletteRedForeground1 },
  letter: {
    fontFamily: tokens.fontFamilyMonospace,
    color: tokens.colorNeutralForeground3,
    textDecorationLine: "none",
  },
  main: { display: "grid", gridTemplateRows: "auto auto minmax(0, 1fr)", minHeight: 0 },
  fileHeader: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalM,
    padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalL}`,
    borderBottom: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    minWidth: 0,
  },
  path: {
    fontFamily: tokens.fontFamilyMonospace,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    flexGrow: 1,
  },
  outside: {
    display: "flex",
    flexWrap: "wrap",
    gap: tokens.spacingHorizontalS,
    padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalL}`,
    color: tokens.colorNeutralForeground3,
  },
  center: {
    display: "grid",
    placeItems: "center",
    padding: tokens.spacingVerticalXXL,
    color: tokens.colorNeutralForeground3,
  },
});

interface Props {
  review: Review;
  project: Project | undefined;
  onShowFinding: (finding: Finding) => void;
}

/** The Changes tab: what the review changes since its merge base, with findings on their lines. */
export function ChangesTab({ review, project, onShowFinding }: Props) {
  const styles = useStyles();
  const changes = useChangeSet(review.id, review.headSha);
  const findings = useFindings(review.id);
  const [selected, setSelected] = useState<string>();
  const [mode, setMode] = useState<DiffMode>(loadDiffMode);
  const filters = project?.changeFilters ?? DEFAULT_CHANGE_FILTERS;

  const { visible, hidden } = useMemo(() => {
    const all = changes.data?.files ?? [];
    const reasons = all.map((file) => hiddenBy(file.path, filters));
    return {
      visible: all.filter((_, i) => reasons[i] === undefined),
      hidden: all.filter((_, i) => reasons[i] !== undefined),
    };
  }, [changes.data, filters]);
  const files = changes.data?.files ?? [];
  const current = files.find((file) => file.path === selected) ?? visible[0];
  const openFindings = (findings.data ?? []).filter((f) => f.withdrawnReason === null);

  return (
    <div className={styles.root}>
      <div className={styles.banner}>
        <UpdateBanner review={review} />
      </div>
      <div className={styles.body}>
        <aside className={styles.side} aria-label="Changed files">
          {project && (
            <FilterControls
              key={`${project.id}:${filters.exclude.join(",")}`}
              project={project}
              filters={filters}
            />
          )}
          <div className={styles.tree}>
            {changes.isLoading && <Spinner size="small" label="Loading changes" />}
            {changes.error && (
              <MessageBar intent="error">
                <MessageBarBody>{changes.error.message}</MessageBarBody>
              </MessageBar>
            )}
            {changes.data && visible.length === 0 && (
              <Text className={styles.center}>
                {files.length === 0
                  ? "No changes against the merge base."
                  : "All changed files are hidden by the filters."}
              </Text>
            )}
            {visible.length > 0 && (
              <FileTree
                files={visible}
                selected={current?.path}
                findings={openFindings}
                onSelect={setSelected}
              />
            )}
            {hidden.length > 0 && (
              <HiddenFiles files={hidden} selected={current?.path} onSelect={setSelected} />
            )}
          </div>
        </aside>
        <section className={styles.main} aria-label="Diff">
          {current ? (
            <FilePanel
              review={review}
              file={current}
              mode={mode}
              onMode={(next) => {
                setMode(next);
                saveDiffMode(next);
              }}
              findings={openFindings.filter((f) => f.file === current.path)}
              onShowFinding={onShowFinding}
            />
          ) : (
            <>
              <div />
              <div />
              <Text className={styles.center}>Select a file.</Text>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function UpdateBanner({ review }: { review: Review }) {
  const styles = useStyles();
  const check = useUpdateCheck(review.id);
  const refresh = useRefreshReview();
  const busy = useIsBusy(review);
  const branch =
    review.source.kind === "pull-request"
      ? `pull request #${review.source.number}`
      : review.headBranch;

  if (check.isFetching && !check.data) {
    return (
      <div className={styles.status} role="status">
        <Spinner size="extra-tiny" /> <Caption1>Checking {branch} for new commits…</Caption1>
      </div>
    );
  }
  const checkNow = (
    <Button
      size="small"
      icon={<ArrowSyncRegular />}
      disabled={check.isFetching}
      onClick={() => void check.refetch()}
    >
      Check now
    </Button>
  );
  if (check.error) {
    return (
      <MessageBar intent="warning">
        <MessageBarBody>Could not check for new commits: {check.error.message}</MessageBarBody>
        <MessageBarActions>{checkNow}</MessageBarActions>
      </MessageBar>
    );
  }
  const data = check.data;
  const moved =
    data !== undefined && data.headSha === review.headSha && data.latestSha !== review.headSha;
  if (!moved) {
    return (
      <div className={styles.status}>
        <Caption1>
          Up to date at {shortSha(review.headSha)}
          {check.dataUpdatedAt > 0 &&
            ` · checked ${new Date(check.dataUpdatedAt).toLocaleTimeString()}`}
        </Caption1>
        {checkNow}
      </div>
    );
  }
  const subjects = data.commits.slice(0, 3).map((c) => c.subject);
  return (
    <MessageBar intent={data.rewritten ? "warning" : "info"} layout="multiline">
      <MessageBarBody>
        <MessageBarTitle>
          {data.rewritten
            ? `The history of ${branch} was rewritten`
            : `${data.newCommits} new ${data.newCommits === 1 ? "commit" : "commits"} on ${branch}`}
        </MessageBarTitle>
        {subjects.join(" · ")}
        {data.commits.length > subjects.length && " · …"}
        {refresh.error && <div>{refresh.error.message}</div>}
        {busy && <div>Claude is working on this review; refresh when it is done.</div>}
      </MessageBarBody>
      <MessageBarActions>
        <Button
          size="small"
          appearance="primary"
          disabled={busy || refresh.isPending}
          onClick={() => refresh.mutate(review.id)}
        >
          {refresh.isPending ? "Refreshing…" : `Refresh to ${shortSha(data.latestSha)}`}
        </Button>
        {checkNow}
      </MessageBarActions>
    </MessageBar>
  );
}

/**
 * Files the filters hide, listed by name (collapsed): a change can always be found, even one a
 * pull request placed in a folder that looks generated.
 */
function HiddenFiles({
  files,
  selected,
  onSelect,
}: {
  files: readonly ChangedFile[];
  selected: string | undefined;
  onSelect: (path: string) => void;
}) {
  const styles = useStyles();
  return (
    <details className={styles.hidden}>
      <summary>
        <Caption1>
          {files.length} hidden {files.length === 1 ? "file" : "files"}
        </Caption1>
      </summary>
      {files.map((file) => (
        <Button
          key={file.path}
          size="small"
          appearance={file.path === selected ? "secondary" : "subtle"}
          className={styles.hiddenFile}
          onClick={() => onSelect(file.path)}
        >
          {file.path}
        </Button>
      ))}
    </details>
  );
}

function FilterControls({ project, filters }: { project: Project; filters: ChangeFilters }) {
  const styles = useStyles();
  const update = useUpdateProject();
  const [patterns, setPatterns] = useState(filters.exclude.join(", "));
  const save = (next: ChangeFilters) =>
    update.mutate({ id: project.id, body: { changeFilters: next } });
  const savePatterns = () => {
    const exclude = patterns
      .split(/[,\n]/)
      .map((p) => p.trim())
      .filter((p) => p !== "")
      .slice(0, 50);
    if (exclude.join(",") !== filters.exclude.join(",")) save({ ...filters, exclude });
  };
  return (
    <div className={styles.filters}>
      <Switch
        label="Hide tests"
        checked={filters.hideTests}
        onChange={(_, data) => save({ ...filters, hideTests: data.checked })}
      />
      <Switch
        label="Hide generated files"
        checked={filters.hideGenerated}
        onChange={(_, data) => save({ ...filters, hideGenerated: data.checked })}
      />
      <Field label="Hide patterns" hint="Globs, comma-separated, e.g. docs/**, *.svg" size="small">
        <Input
          size="small"
          value={patterns}
          onChange={(_, data) => setPatterns(data.value)}
          onBlur={savePatterns}
          onKeyDown={(event) => {
            if (event.key === "Enter") savePatterns();
          }}
        />
      </Field>
      <Caption1>Saved for {project.name}</Caption1>
      {update.error && <Caption1 role="alert">{update.error.message}</Caption1>}
    </div>
  );
}

function FileTree({
  files,
  selected,
  findings,
  onSelect,
}: {
  files: readonly ChangedFile[];
  selected: string | undefined;
  findings: readonly Finding[];
  onSelect: (path: string) => void;
}) {
  const nodes = useMemo(() => buildTree(files), [files]);
  return (
    <Tree aria-label="Changed files" size="small" defaultOpenItems={allFolders(nodes)}>
      <TreeNodes nodes={nodes} selected={selected} findings={findings} onSelect={onSelect} />
    </Tree>
  );
}

function allFolders(nodes: readonly TreeNode[]): string[] {
  return nodes.flatMap((node) =>
    node.kind === "folder" ? [`dir:${node.path}`, ...allFolders(node.children)] : [],
  );
}

function TreeNodes({
  nodes,
  selected,
  findings,
  onSelect,
}: {
  nodes: readonly TreeNode[];
  selected: string | undefined;
  findings: readonly Finding[];
  onSelect: (path: string) => void;
}) {
  const styles = useStyles();
  return (
    <>
      {nodes.map((node) => {
        if (node.kind === "folder") {
          return (
            <TreeItem key={node.path} itemType="branch" value={`dir:${node.path}`}>
              <TreeItemLayout iconBefore={<FolderRegular />}>{node.name}</TreeItemLayout>
              <Tree>
                <TreeNodes
                  nodes={node.children}
                  selected={selected}
                  findings={findings}
                  onSelect={onSelect}
                />
              </Tree>
            </TreeItem>
          );
        }
        const { file } = node;
        const count = findings.filter((f) => f.file === file.path).length;
        const isSelected = file.path === selected;
        return (
          <TreeItem
            key={file.path}
            itemType="leaf"
            value={file.path}
            aria-current={isSelected ? "true" : undefined}
            onClick={() => onSelect(file.path)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") onSelect(file.path);
            }}
          >
            <TreeItemLayout
              className={mergeClasses(isSelected && styles.selected)}
              iconBefore={<DocumentRegular />}
              aside={
                <span className={styles.counts}>
                  {count > 0 && <Caption1>{count} ⚑</Caption1>}
                  {file.additions === null ? (
                    <Caption1>bin</Caption1>
                  ) : (
                    <>
                      <Caption1 className={styles.added}>+{file.additions}</Caption1>
                      <Caption1 className={styles.deleted}>−{file.deletions}</Caption1>
                    </>
                  )}
                </span>
              }
            >
              <span
                className={styles.fileName}
                title={file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
              >
                <abbr className={styles.letter} title={file.status}>
                  {STATUS_LETTER[file.status]}
                </abbr>{" "}
                {node.name}
              </span>
            </TreeItemLayout>
          </TreeItem>
        );
      })}
    </>
  );
}

function FilePanel({
  review,
  file,
  mode,
  onMode,
  findings,
  onShowFinding,
}: {
  review: Review;
  file: ChangedFile;
  mode: DiffMode;
  onMode: (mode: DiffMode) => void;
  findings: readonly Finding[];
  onShowFinding: (finding: Finding) => void;
}) {
  const styles = useStyles();
  const diff = useFileDiff(review.id, review.headSha, file.path);
  const editor = useOpenInEditor();
  const shown = diff.data ? shownNewLines(diff.data) : undefined;
  const outside = shown ? findings.filter((f) => f.line === null || !shown.has(f.line)) : [];

  return (
    <>
      <div className={styles.fileHeader}>
        <Text className={styles.path} title={file.path}>
          {file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
        </Text>
        <TabList
          size="small"
          selectedValue={mode}
          aria-label="Diff layout"
          onTabSelect={(_, data) => onMode(data.value === "split" ? "split" : "unified")}
        >
          <Tab value="unified">Unified</Tab>
          <Tab value="split">Split</Tab>
        </TabList>
        {file.status !== "deleted" && (
          <Button
            size="small"
            onClick={() => editor.mutate({ id: review.id, file: file.path, line: null })}
          >
            Open in editor
          </Button>
        )}
      </div>
      <div className={styles.outside}>
        {editor.error && <Caption1 role="alert">{editor.error.message}</Caption1>}
        {outside.length > 0 && (
          <>
            <Caption1>Findings outside the changed lines:</Caption1>
            {outside.map((f) => (
              <Button
                key={f.number}
                size="small"
                appearance="subtle"
                onClick={() => onShowFinding(f)}
              >
                #{f.number}
                {f.line !== null && ` (line ${f.line})`} {f.title}
              </Button>
            ))}
          </>
        )}
      </div>
      {diff.isLoading ? (
        <Spinner size="small" label="Loading diff" />
      ) : diff.error ? (
        <MessageBar intent="error">
          <MessageBarBody>{diff.error.message}</MessageBarBody>
        </MessageBar>
      ) : diff.data ? (
        <DiffView
          diff={diff.data}
          mode={mode}
          findings={findings}
          onOpenLine={(line) => editor.mutate({ id: review.id, file: file.path, line })}
          onShowFinding={onShowFinding}
        />
      ) : null}
    </>
  );
}
