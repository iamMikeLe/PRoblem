---
name: fluent-teams-ui
description: UI conventions for the PRoblem desktop UI (Electron renderer) - Fluent UI v9 components and tokens, the Microsoft Teams-style dark shell layout, theming, icons and accessibility rules. Use whenever creating or changing React components or styles in apps/desktop/src/renderer.
---

# Fluent UI v9, Teams style

PRoblem looks and behaves like Microsoft Teams (dark): a title bar with search, a narrow app
rail, a list pane, and a main pane with a header, tabs and a composer at the bottom.

## Shell (`apps/desktop/src/renderer/src/app/App.tsx`)

```
┌──────────────────────── TitleBar 48px ─────────────────────────┐
│ Rail │ ListPane 320px    │ MainPane                            │
│ 68px │ reviews grouped   │ header: status · title · tabs · act │
│      │ by project        │ body (tab content, scrolls)         │
│      │                   │ composer                            │
└──────┴───────────────────┴─────────────────────────────────────┘
```

Background layers (darkest to lightest feel in Teams dark): rail/title `colorNeutralBackground3`,
list `colorNeutralBackground2`, main `colorNeutralBackground1`.

## Window chrome

The native title bar is hidden; `TitleBar` is the window's title bar. It is a drag region
(`WebkitAppRegion: "drag"`), and every interactive element in it needs `WebkitAppRegion: "no-drag"`.
It leaves room for the macOS traffic lights (left) or the Windows/Linux caption buttons (right),
based on `window.problem.platform`. Prefer native surfaces where they exist: folder picker via
`api.dialog.pickFolder()`, notifications and dock badge from the main process.

## Rules

- **Components:** use `@fluentui/react-components` first (Button, TabList/Tab, Dialog, Menu,
  Tooltip, DataGrid, Badge, Avatar, Toast, MessageBar, Spinner, Textarea, Field).
  Only hand-roll when Fluent has nothing (e.g. the rail item), and then match Fluent behavior.
- **Styling:** `makeStyles` + `tokens` only. Never hex/rgb, never inline `style` colors.
  Spacing via `tokens.spacing*`, radius via `tokens.borderRadius*`, type via Fluent `Text`
  presets (`Subtitle1`, `Body1`, `Caption1`) or `size`/`weight` props.
- **Themes:** the app is wrapped in `FluentProvider` with `teamsDarkTheme`. Everything must also
  work with `teamsLightTheme` and `teamsHighContrastTheme`; that is free if you follow the token rule.
- **Icons:** `@fluentui/react-icons`, `*Regular` by default, `bundleIcon(Filled, Regular)` for
  selectable items, imported by name (tree-shaken).
- **Status:** review status is a `StatusDot` (Badge) with an `aria-label`; never color alone.
  Colors: running = warning, needs-input = brand, idle = success, failed = danger.
- **Severity:** blocker = danger, major = severe, minor = warning, nit = informative.

## Accessibility

- Icon-only buttons: `aria-label`, or a `Tooltip` with `relationship="label"`.
- Keep landmarks: `nav` (rail), `aside` (list), `main`. Headings for review titles.
- Everything keyboard-operable; lists of reviews/findings support arrow keys
  (Fluent `useArrowNavigationGroup`).

## State

- Main-process data: React Query over `lib/api.ts`. Live stream state for all reviews: the
  Zustand store fed by `window.problem.onEvent`. Component state only for transient UI (an open menu).
- Switching reviews must keep each review's scroll position, composer draft and pending approvals.
