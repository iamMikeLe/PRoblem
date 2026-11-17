# 0001. Fluent UI v9 with Teams themes for the UI

- Status: accepted
- Date: 2026-11-17

## Context
The UI must feel like the dark theme of Microsoft Teams: a dense, multi-pane layout people already
know from daily work. It shows many concurrent sessions, lists, tabs, dialogs and data grids.

## Options
1. **Fluent UI React v9**: Microsoft's design system, ships `teamsDarkTheme`, `teamsLightTheme`,
   `teamsHighContrastTheme`; accessible components; CSS-in-JS (Griffel) with design tokens.
   Con: large bundle, Griffel is less familiar than Tailwind.
2. **Mantine / MUI with a custom dark theme**: rich components. Con: imitating Teams by hand,
   no high-contrast theme for free.
3. **Tailwind + headless components**: full control. Con: we would build every component and
   the accessibility ourselves.

## Decision
Fluent UI v9. It gives the Teams look exactly (it is what Teams is built on), theming through
tokens, and three themes including high contrast at no cost.

## Consequences
- Styling uses `makeStyles` + `tokens` only; hard-coded colors are banned (enforced in review).
- The initial bundle is large (~200 kB gzip); route-level code splitting is a Phase 8 task.
- The Teams look comes from layout and tokens, not from copying Teams assets.
