import Database from 'better-sqlite3';

export type Db = Database.Database;

export const IN_MEMORY = ':memory:';

/**
 * Opens a SQLite connection with the pragmas we rely on.
 *
 * `foreign_keys` is OFF by default in SQLite, which would quietly let the
 * repositories insert loans pointing at books that do not exist - exactly the
 * kind of bug the integration tests are meant to catch.
 */
export function createDatabase(path: string = IN_MEMORY): Db {
  const db = new Database(path);

  db.pragma('foreign_keys = ON');
  if (path !== IN_MEMORY) {
    db.pragma('journal_mode = WAL');
  }

  return db;
}

export function closeDatabase(db: Db): void {
  if (db.open) {
    db.close();
  }
}
