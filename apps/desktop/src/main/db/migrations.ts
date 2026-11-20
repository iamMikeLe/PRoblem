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
  {
    version: 7,
    name: "changes_view",
    sql: `
      -- JSON ChangeFilters; NULL = the defaults.
      ALTER TABLE projects ADD COLUMN change_filters TEXT;
      -- The head a review had before its last Refresh, until Claude has been told (ADR 0013).
      ALTER TABLE reviews ADD COLUMN moved_from_sha TEXT;
    `,
  },
  {
    version: 8,
    name: "github",
    sql: `
      -- The GitHub review a finding was posted in (ADR 0014).
      ALTER TABLE findings ADD COLUMN posted_url TEXT;
      -- The open pull request of a branch review, found by its head branch (JSON PullRequestLink).
      ALTER TABLE reviews ADD COLUMN linked_pr TEXT;
      -- PR comments: the newest one Claude has been told about, and a note of newer ones that
      -- starts the next message (with the newest comment it covers).
      ALTER TABLE reviews ADD COLUMN comments_told_at TEXT;
      ALTER TABLE reviews ADD COLUMN comments_note TEXT;
      ALTER TABLE reviews ADD COLUMN comments_note_until TEXT;
    `,
  },
  {
    version: 9,
    name: "finding_reproduction",
    sql: `
      -- Steps to reproduce a finding (markdown); empty when it cannot be reproduced by running something.
      ALTER TABLE findings ADD COLUMN reproduction TEXT NOT NULL DEFAULT '';
    `,
  },
  {
    version: 10,
    name: "activity",
    sql: `
      -- The Activity feed (ADR 0015). \`detail\` is a JSON ActivityDetail; NULL \`read_at\` = unread.
      CREATE TABLE activity (
        id        TEXT PRIMARY KEY,
        review_id TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
        kind      TEXT NOT NULL,
        detail    TEXT NOT NULL,
        at        TEXT NOT NULL,
        read_at   TEXT
      );
      CREATE INDEX activity_by_time ON activity (at);
      CREATE INDEX activity_by_review ON activity (review_id, kind);
    `,
  },
  {
    version: 11,
    name: "credentials",
    sql: `
      -- Git host credentials (ADR 0019): one row per host. \`secret\` is encrypted with the OS
      -- keychain (Electron safeStorage); it is useless on another machine or account.
      CREATE TABLE credentials (
        host       TEXT PRIMARY KEY,
        account    TEXT NOT NULL,
        secret     BLOB NOT NULL,
        updated_at TEXT NOT NULL
      );
    `,
  },
];
