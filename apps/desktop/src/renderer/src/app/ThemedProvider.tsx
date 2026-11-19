import { FluentProvider } from "@fluentui/react-components";
import { type ReactNode, useEffect } from "react";
import { THEMES, useTheme } from "../lib/theme.ts";

/** Fluent with the chosen theme; the page behind it and native scrollbars follow it too. */
export function ThemedProvider({ children }: { children: ReactNode }) {
  const name = useTheme((state) => state.name);
  const { theme } = THEMES[name];
  useEffect(() => {
    document.body.style.backgroundColor = theme.colorNeutralBackground1;
    document.documentElement.style.colorScheme = name === "light" ? "light" : "dark";
  }, [name, theme]);
  return (
    <FluentProvider theme={theme} style={{ height: "100%" }}>
      {children}
    </FluentProvider>
  );
}
