import { makeStyles, tokens } from "@fluentui/react-components";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

const useStyles = makeStyles({
  root: {
    lineHeight: tokens.lineHeightBase300,
    overflowWrap: "anywhere",
    "& > :first-child": { marginTop: 0 },
    "& > :last-child": { marginBottom: 0 },
    "& pre": {
      backgroundColor: tokens.colorNeutralBackground3,
      padding: tokens.spacingHorizontalM,
      borderRadius: tokens.borderRadiusMedium,
      overflowX: "auto",
    },
    "& code": { fontFamily: tokens.fontFamilyMonospace, fontSize: tokens.fontSizeBase200 },
    "& :not(pre) > code": {
      backgroundColor: tokens.colorNeutralBackground3,
      paddingInline: tokens.spacingHorizontalXXS,
      borderRadius: tokens.borderRadiusSmall,
    },
    // `---` separates findings in a posted review's summary.
    "& hr": {
      border: "none",
      borderTop: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke1}`,
      marginBlock: tokens.spacingVerticalL,
    },
    "& table": { borderCollapse: "collapse" },
    "& th, & td": {
      border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
      padding: `${tokens.spacingVerticalXXS} ${tokens.spacingHorizontalS}`,
    },
  },
  link: { color: tokens.colorBrandForegroundLink, textDecorationLine: "underline" },
});

/**
 * Claude's markdown. react-markdown never renders raw HTML. Links and images are shown as text:
 * the window does not navigate, and remote images could be used to track who reads a review.
 */
export function Markdown({ text }: { text: string }) {
  const styles = useStyles();
  const components: Components = {
    a: ({ children, href }) => (
      <span className={styles.link} title={href}>
        {children}
      </span>
    ),
    img: ({ alt, src }) => <span title={src}>[image: {alt}]</span>,
  };
  return (
    <div className={styles.root}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
