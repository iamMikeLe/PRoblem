# 0011. Opening a finding's file in the user's editor

- Status: accepted
- Date: 2026-11-18

## Context
A finding points at `file:line`. One click should open that line in the user's editor. The path
comes from Claude, and Claude read a pull request that may try to steer it (prompt injection), so
the path is untrusted. The editor runs as the user, outside the read-only Claude session.

## Options
1. **Only VS Code, fixed command** (`code --goto file:line`). Con: many users use Cursor, Zed or a
   JetBrains IDE.
2. **Presets plus a custom command template** with `{file}`, `{line}` and `{dir}` placeholders,
   stored in the app settings. Con: a template is a command line the app must run safely.
3. **`shell.openPath` / the OS default app.** Con: no line number, and it may open a viewer.

## Decision
Option 2, chosen by the user.
- Presets: VS Code, Cursor, Zed, IntelliJ IDEA, WebStorm, and a custom command.
- **The template is split into words first, and the placeholders are filled in after.** Each
  word is filled in a single pass, so text a placeholder inserts is never scanned again. The
  program then runs with `spawn` and no shell. A file name can never become an extra argument.
- `{file}` is the absolute real path of a file inside the review's folder:
  - Symlinks are resolved, and the file must be outside any `.git` folder (case-insensitive).
  - Paths with `..`, absolute paths and `~` are refused before anything is resolved.
  - The path always starts with `/`, so an editor never reads it as an option (`--install-extension=…`) or a URI.
- The program is either a bare name looked up on the PATH (absolute folders only) or an absolute
  path. Relative paths are refused.
- The editor starts in the user's home folder, not in the checkout.
- **The presets open only the file, never the folder.** A security review pointed this out:
  - `code {dir} …` opens the pull request's checkout as a workspace, which loads its
    `.vscode/settings.json` and `tasks.json`.
  - A task with `runOn: folderOpen` runs a command. Only Workspace Trust stops it, and Cursor
    has shipped with Workspace Trust off.
  - `{dir}` is still available for custom templates, and Settings warns when a template uses it.

## Consequences
- A missing launcher (for example VS Code without the `code` shell command) is reported with
  how to install it.
- Opening a file shows only the file, without the project tree.
- `test/main/editor/open.test.ts` covers the splitting, the path checks, finding the program,
  and what the launch receives.
