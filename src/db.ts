import Database from "better-sqlite3";

export type DB = Database.Database;

/**
 * Open (or create) a SQLite database. Pass ":memory:" for tests.
 * Note: we deliberately keep the default rollback journal rather than WAL; WAL relies on shared
 * memory files that misbehave on some mounted filesystems (e.g. WSL /mnt/c, network drives).
 */
export function openDatabase(file: string): DB {
  const db = new Database(file);
  db.pragma("foreign_keys = ON");
  return db;
}

/** True when the schema exists and has been seeded. */
export function isSeeded(db: DB): boolean {
  const row = db
    .prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'dataset_meta'")
    .get() as { n: number };
  if (row.n === 0) return false;
  const meta = db.prepare("SELECT value FROM dataset_meta WHERE key = 'as_of'").get() as
    | { value: string }
    | undefined;
  return meta !== undefined;
}
