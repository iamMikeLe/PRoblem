import { DatabaseSync } from "node:sqlite";
import { migrations as defaultMigrations, type Migration } from "./migrations.ts";

/** Opens (or creates) the SQLite database and brings its schema up to date. */
export function openDatabase(
  file: string,
  migrations: readonly Migration[] = defaultMigrations,
): DatabaseSync {
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  migrate(db, migrations);
  return db;
}

export function schemaVersion(db: DatabaseSync): number {
  const row = db
    .prepare("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations")
    .get();
  return Number(row?.version ?? 0);
}

function migrate(db: DatabaseSync, migrations: readonly Migration[]): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);
  const current = schemaVersion(db);
  const record = db.prepare(
    "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)",
  );
  for (const migration of migrations) {
    if (migration.version <= current) continue;
    db.exec("BEGIN");
    try {
      db.exec(migration.sql);
      record.run(migration.version, migration.name, new Date().toISOString());
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw new Error(`Migration ${migration.version} (${migration.name}) failed`, {
        cause: error,
      });
    }
  }
}
