/**
 * Ordered, append-only schema migrations. Never edit a released migration; add a new one.
 */
export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const migrations: readonly Migration[] = [
  {
    version: 1,
    name: "projects",
    sql: `
      CREATE TABLE projects (
        id            TEXT PRIMARY KEY,
        name          TEXT NOT NULL,
        path          TEXT NOT NULL UNIQUE,
        review_prompt TEXT NOT NULL,
        created_at    TEXT NOT NULL
      );
    `,
  },
  {
    version: 2,
    name: "projects_updated_at",
    sql: `
      ALTER TABLE projects ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';
      UPDATE projects SET updated_at = created_at;
    `,
  },
  {
    version: 3,
    name: "reviews",
    sql: `
      CREATE TABLE reviews (
        id             TEXT PRIMARY KEY,
        project_id     TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        title          TEXT NOT NULL,
        source_kind    TEXT NOT NULL CHECK (source_kind IN ('branch', 'pull-request')),
        pr_url         TEXT,
        pr_number      INTEGER,
        pr_repo        TEXT,
        head_branch    TEXT NOT NULL,
        head_sha       TEXT NOT NULL,
        base_branch    TEXT NOT NULL,
        base_sha       TEXT NOT NULL,
        merge_base_sha TEXT,
        workdir        TEXT NOT NULL,
        isolated       INTEGER NOT NULL CHECK (isolated IN (0, 1)),
        prompt         TEXT NOT NULL,
        status         TEXT NOT NULL,
        -- In-place reviews: the branch the project checkout was on before, restored on close.
        restore_branch TEXT,
        created_at     TEXT NOT NULL,
        updated_at     TEXT NOT NULL,
        closed_at      TEXT,
        CHECK ((source_kind = 'pull-request') = (pr_number IS NOT NULL))
      );
      CREATE INDEX reviews_open ON reviews (project_id) WHERE closed_at IS NULL;
      -- At most one open in-place review per project: they share the project checkout.
      CREATE UNIQUE INDEX reviews_one_in_place ON reviews (project_id)
        WHERE isolated = 0 AND closed_at IS NULL;
    `,
  },
];
