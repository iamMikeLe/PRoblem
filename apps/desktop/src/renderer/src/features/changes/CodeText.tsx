import { makeStyles } from "@fluentui/react-components";
import { memo } from "react";
import { dropChars, indentSteps, type TokenLine } from "./highlight.ts";
import { INDENT_LEVEL_CLASSES, useIndentClasses, useSyntaxClasses } from "./syntaxTheme.ts";

const useStyles = makeStyles({
  // The font and size come from the table; `code` would otherwise reset them.
  code: { fontFamily: "inherit", fontSize: "inherit" },
});

interface Props {
  tokens: TokenLine;
  /** The file's indentation step in spaces. */
  indentUnit: number;
}

/**
 * One line of code: its indentation as colored bands (one per nesting level), then its tokens.
 * Everything is text in spans, so copying gives the line as it is, whitespace included; nothing
 * from the code is ever parsed as markup.
 */
export const CodeText = memo(function CodeText({ tokens, indentUnit }: Props) {
  const styles = useStyles();
  const syntax = useSyntaxClasses();
  const bands = useIndentClasses();
  const text = tokens.map((token) => token.text).join("");
  const steps = indentSteps(text, indentUnit);
  const indent = steps.reduce((length, step) => length + step.text.length, 0);
  return (
    <code className={styles.code}>
      {steps.map((step) => (
        <span
          key={`indent-${step.level}`}
          className={
            bands[INDENT_LEVEL_CLASSES[step.level % INDENT_LEVEL_CLASSES.length] ?? "level0"]
          }
        >
          {step.text}
        </span>
      ))}
      {dropChars(tokens, indent).map((token, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a line's tokens never reorder
        <span key={i} className={token.role && syntax[token.role]}>
          {token.text}
        </span>
      ))}
    </code>
  );
});
