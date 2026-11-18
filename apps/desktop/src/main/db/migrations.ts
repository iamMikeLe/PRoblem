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
  {
    version: 4,
    name: "claude_sessions",
    sql: `
      ALTER TABLE reviews ADD COLUMN session_id TEXT;
      ALTER TABLE reviews ADD COLUMN model TEXT;
      -- The conversation of a review, append-only. \`payload\` is a JSON ConversationEntry.
      CREATE TABLE review_entries (
        review_id TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
        seq       INTEGER NOT NULL CHECK (seq > 0),
        at        TEXT NOT NULL,
        kind      TEXT NOT NULL,
        payload   TEXT NOT NULL,
        PRIMARY KEY (review_id, seq)
      ) WITHOUT ROWID;
    `,
  },
  {
    version: 5,
    name: "findings_and_settings",
    sql: `
      -- Findings Claude reported through report_findings; \`number\` is assigned by the app (ADR 0004).
      CREATE TABLE findings (
        review_id      TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
        number         INTEGER NOT NULL CHECK (number > 0),
        severity       TEXT NOT NULL CHECK (severity IN ('blocker', 'major', 'minor', 'nit')),
        title          TEXT NOT NULL,
        file           TEXT,
        line           INTEGER CHECK (line > 0),
        problem        TEXT NOT NULL,
        suggestion     TEXT NOT NULL,
        verdict        TEXT NOT NULL DEFAULT 'open' CHECK (verdict IN ('open', 'accepted', 'dismissed')),
        changed_since_verdict INTEGER NOT NULL DEFAULT 0,
        withdrawn_reason TEXT,
        -- The verdict Claude was last told about; differs from \`verdict\` until the next message.
        verdict_told   TEXT NOT NULL DEFAULT 'open',
        created_at     TEXT NOT NULL,
        updated_at     TEXT NOT NULL,
        PRIMARY KEY (review_id, number)
      ) WITHOUT ROWID;
      CREATE TABLE app_settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      ) WITHOUT ROWID;
    `,
  },
  {
    version: 6,
    name: "permission_gate",
    sql: `
      ALTER TABLE reviews ADD COLUMN fix_mode INTEGER NOT NULL DEFAULT 0;
      -- "Allow for this review" (ADR 0012): an exact Bash command or path per tool.
      CREATE TABLE review_grants (
        review_id  TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
        tool       TEXT NOT NULL,
        scope      TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (review_id, tool, scope)
      ) WITHOUT ROWID;
    `,
  },
];
