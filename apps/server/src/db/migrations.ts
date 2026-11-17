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
];
