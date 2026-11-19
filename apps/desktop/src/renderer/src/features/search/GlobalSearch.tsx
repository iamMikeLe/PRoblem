import {
  Caption1,
  makeStyles,
  mergeClasses,
  SearchBox,
  Spinner,
  Text,
  tokens,
  useId,
} from "@fluentui/react-components";
import { ChatRegular, DocumentRegular } from "@fluentui/react-icons";
import { type SearchResults, searchTerms } from "@problem/shared";
import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { SeverityBadge } from "../findings/FindingsTab.tsx";
import { useSearch } from "./queries.ts";

/** Where a search result leads: a review, one of its findings, or one of its changed files. */
/** Where to take the user in a review: from search, or from an Activity row (`tab`). */
export type SearchTarget =
  | { kind: "review"; reviewId: string }
  | { kind: "finding"; reviewId: string; number: number }
  | { kind: "file"; reviewId: string; path: string }
  | { kind: "tab"; reviewId: string; tab: "conversation" | "changes" | "comments" };

interface Option {
  key: string;
  group: "Reviews" | "Findings" | "Files";
  target: SearchTarget;
  /** What a screen reader announces for the option. */
  label: string;
  render: (terms: readonly string[]) => ReactNode;
}

const useStyles = makeStyles({
  root: { position: "relative", width: "100%" },
  box: { width: "100%" },
  popup: {
    position: "absolute",
    top: `calc(100% + ${tokens.spacingVerticalXS})`,
    left: 0,
    right: 0,
    zIndex: 1000,
    maxHeight: "60vh",
    overflowY: "auto",
    padding: tokens.spacingVerticalXS,
    backgroundColor: tokens.colorNeutralBackground1,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke1}`,
    borderRadius: tokens.borderRadiusMedium,
    boxShadow: tokens.shadow16,
    WebkitAppRegion: "no-drag",
  },
  group: {
    display: "block",
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalS} ${tokens.spacingVerticalXXS}`,
    color: tokens.colorNeutralForeground3,
  },
  option: {
    display: "grid",
    gridTemplateColumns: "auto minmax(0, 1fr)",
    alignItems: "center",
    columnGap: tokens.spacingHorizontalS,
    padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalS}`,
    borderRadius: tokens.borderRadiusSmall,
    cursor: "pointer",
  },
  active: { backgroundColor: tokens.colorNeutralBackground1Selected },
  lines: { display: "flex", flexDirection: "column", minWidth: 0 },
  line: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  mono: { fontFamily: tokens.fontFamilyMonospace },
  muted: { color: tokens.colorNeutralForeground3 },
  mark: {
    backgroundColor: "transparent",
    color: tokens.colorBrandForeground1,
    fontWeight: tokens.fontWeightSemibold,
  },
  status: { padding: tokens.spacingHorizontalS, color: tokens.colorNeutralForeground3 },
});

const GROUPS: readonly Option["group"][] = ["Reviews", "Findings", "Files"];
const SHORTCUT = window.problem?.platform === "darwin" ? "⌘K" : "Ctrl+K";

const escapeRegExp = (term: string) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** `text` with the search words emphasized. */
function Highlight({ text, terms }: { text: string; terms: readonly string[] }) {
  const styles = useStyles();
  if (terms.length === 0) return <>{text}</>;
  const pattern = new RegExp(`(${terms.map(escapeRegExp).join("|")})`, "gi");
  const lower = new Set(terms);
  return (
    <>
      {text.split(pattern).map((part, index) =>
        lower.has(part.toLowerCase()) ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: the parts of one string never reorder
          <mark key={index} className={styles.mark}>
            {part}
          </mark>
        ) : (
          part
        ),
      )}
    </>
  );
}

function useOptions(results: SearchResults | undefined): Option[] {
  const styles = useStyles();
  if (!results) return [];
  return [
    ...results.reviews.map(
      (hit): Option => ({
        key: `review:${hit.reviewId}`,
        group: "Reviews",
        target: { kind: "review", reviewId: hit.reviewId },
        label: `Review ${hit.title}`,
        render: (terms) => (
          <>
            <ChatRegular aria-hidden />
            <span className={styles.lines}>
              <Text className={styles.line}>
                <Highlight text={hit.title} terms={terms} />
              </Text>
              <Caption1 className={mergeClasses(styles.line, styles.muted)}>
                <Highlight text={hit.detail} terms={terms} />
              </Caption1>
            </span>
          </>
        ),
      }),
    ),
    ...results.findings.map(
      (hit): Option => ({
        key: `finding:${hit.reviewId}:${hit.number}`,
        group: "Findings",
        target: { kind: "finding", reviewId: hit.reviewId, number: hit.number },
        label: `Finding #${hit.number} ${hit.title} in ${hit.reviewTitle}`,
        render: (terms) => (
          <>
            <SeverityBadge severity={hit.severity} />
            <span className={styles.lines}>
              <Text className={styles.line}>
                #{hit.number} <Highlight text={hit.title} terms={terms} />
              </Text>
              <Caption1 className={mergeClasses(styles.line, styles.muted)}>
                {hit.reviewTitle}
                {hit.excerpt !== null && (
                  <>
                    {" · "}
                    <Highlight text={hit.excerpt} terms={terms} />
                  </>
                )}
              </Caption1>
            </span>
          </>
        ),
      }),
    ),
    ...results.files.map(
      (hit): Option => ({
        key: `file:${hit.reviewId}:${hit.path}`,
        group: "Files",
        target: { kind: "file", reviewId: hit.reviewId, path: hit.path },
        label: `File ${hit.path} in ${hit.reviewTitle}`,
        render: (terms) => (
          <>
            <DocumentRegular aria-hidden />
            <span className={styles.lines}>
              <Text className={mergeClasses(styles.line, styles.mono)}>
                <Highlight text={hit.path} terms={terms} />
              </Text>
              <Caption1 className={mergeClasses(styles.line, styles.muted)}>
                {hit.reviewTitle}
              </Caption1>
            </span>
          </>
        ),
      }),
    ),
  ];
}

/** ⌘K (macOS) or Ctrl+K anywhere focuses the search. */
function useFocusShortcut(input: React.RefObject<HTMLInputElement | null>) {
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        input.current?.focus();
        input.current?.select();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [input]);
}

/**
 * The title bar's search over open reviews, their findings and changed files (a combobox:
 * ↑/↓ move, Enter opens, Esc closes).
 */
export function GlobalSearch({ onOpen }: { onOpen: (target: SearchTarget) => void }) {
  const styles = useStyles();
  const listId = useId("search-results");
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const search = useSearch(text);
  const options = useOptions(search.data);
  useFocusShortcut(input);

  const terms = searchTerms(text);
  const shown = open && text.trim() !== "";
  const activeIndex = Math.min(active, Math.max(options.length - 1, 0));
  const current = shown ? options[activeIndex] : undefined;

  const choose = (option: Option) => {
    setOpen(false);
    setText("");
    input.current?.blur();
    onOpen(option.target);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Escape") {
      // A first Esc closes the results, a second one clears the text.
      if (shown) setOpen(false);
      else setText("");
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      if (options.length === 0) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((activeIndex + step + options.length) % options.length);
      return;
    }
    if (event.key === "Enter" && current) {
      event.preventDefault();
      choose(current);
    }
  };

  return (
    <div className={styles.root}>
      <SearchBox
        input={{ ref: input }}
        className={styles.box}
        size="small"
        placeholder={`Search reviews, findings, files (${SHORTCUT})`}
        role="combobox"
        aria-label="Search reviews, findings and files"
        aria-expanded={shown}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={current ? `${listId}-${activeIndex}` : undefined}
        value={text}
        onChange={(_, data) => {
          setText(data.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
      />
      {shown && (
        <div id={listId} role="listbox" aria-label="Search results" className={styles.popup}>
          {options.length === 0 &&
            (search.isFetching || search.data === undefined ? (
              <Spinner size="tiny" label="Searching" className={styles.status} />
            ) : search.error ? (
              <Text className={styles.status}>Search failed: {search.error.message}</Text>
            ) : (
              <Text className={styles.status}>Nothing found in open reviews.</Text>
            ))}
          {GROUPS.map((group) => {
            const members = options
              .map((option, index) => ({ option, index }))
              .filter(({ option }) => option.group === group);
            if (members.length === 0) return null;
            const headingId = `${listId}-${group}`;
            return (
              // A group of options inside a listbox: <fieldset> is for form controls.
              // biome-ignore lint/a11y/useSemanticElements: ARIA listbox group pattern
              <div key={group} role="group" aria-labelledby={headingId}>
                <Caption1 id={headingId} className={styles.group}>
                  {group}
                </Caption1>
                {members.map(({ option, index }) => (
                  // biome-ignore lint/a11y/useKeyWithClickEvents: the input handles the keyboard
                  <div
                    key={option.key}
                    id={`${listId}-${index}`}
                    role="option"
                    tabIndex={-1}
                    aria-selected={index === activeIndex}
                    aria-label={option.label}
                    className={mergeClasses(styles.option, index === activeIndex && styles.active)}
                    // Keep focus in the input, so blur does not close the list before the click.
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => choose(option)}
                  >
                    {option.render(terms)}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
