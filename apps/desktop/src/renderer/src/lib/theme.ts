import {
  type Theme,
  teamsDarkTheme,
  teamsHighContrastTheme,
  teamsLightTheme,
} from "@fluentui/react-components";
import { z } from "zod";
import { create } from "zustand";

export const ThemeNameSchema = z.enum(["dark", "light", "highContrast"]);
export type ThemeName = z.infer<typeof ThemeNameSchema>;

export const THEMES: Readonly<Record<ThemeName, { label: string; theme: Theme }>> = {
  dark: { label: "Teams dark", theme: teamsDarkTheme },
  light: { label: "Teams light", theme: teamsLightTheme },
  highContrast: { label: "High contrast", theme: teamsHighContrastTheme },
};

const STORAGE_KEY = "problem.theme";

/** The saved theme; dark when none is saved or storage is unavailable. */
export function loadTheme(): ThemeName {
  try {
    const parsed = ThemeNameSchema.safeParse(window.localStorage.getItem(STORAGE_KEY));
    if (parsed.success) return parsed.data;
  } catch {
    // Storage unavailable: the default.
  }
  return "dark";
}

interface ThemeState {
  name: ThemeName;
  setTheme(name: ThemeName): void;
}

/** The window's theme, remembered on this machine. */
export const useTheme = create<ThemeState>()((set) => ({
  name: loadTheme(),
  setTheme: (name) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, name);
    } catch {
      // Not remembered; still applied for this session.
    }
    set({ name });
  },
}));
