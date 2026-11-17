/**
 * Whether new reviews of a project start in an isolated worktree, remembered per project.
 * A per-viewer convenience, so browser storage is fine; it may be unavailable, hence try/catch.
 */
const key = (projectId: string) => `reviewroom.isolated.${projectId}`;

export function loadIsolated(projectId: string): boolean {
  try {
    return window.localStorage.getItem(key(projectId)) !== "false";
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
