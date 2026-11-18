/**
 * Whether new reviews of a project start in an isolated worktree, remembered per project.
 * A per-viewer convenience, so browser storage is fine; it may be unavailable, hence try/catch.
 */
const key = (projectId: string) => `problem.isolated.${projectId}`;
/** The key from before the app was renamed (ReviewRoom), still read until a new value is saved. */
const legacyKey = (projectId: string) => `reviewroom.isolated.${projectId}`;

export function loadIsolated(projectId: string): boolean {
  try {
    const stored =
      window.localStorage.getItem(key(projectId)) ??
      window.localStorage.getItem(legacyKey(projectId));
    return stored !== "false";
  } catch {
    return true;
  }
}

export function saveIsolated(projectId: string, isolated: boolean): void {
  try {
    window.localStorage.setItem(key(projectId), String(isolated));
  } catch {
    // Not remembered; the default (isolated) applies next time.
  }
}
