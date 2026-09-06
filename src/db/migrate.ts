import type { Db } from './connection';

interface Migration {
  version: number;
  name: string;
  up: string;
}

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'initial_schema',
    up: `
      CREATE TABLE members (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        tier TEXT NOT NULL CHECK (tier IN ('STANDARD', 'PREMIUM', 'STAFF')),
        status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED')),
        joined_at TEXT NOT NULL,
        membership_expires_at TEXT NOT NULL
      );

      CREATE TABLE books (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        isbn TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        author TEXT NOT NULL,
        published_year INTEGER NOT NULL,
        total_copies INTEGER NOT NULL CHECK (total_copies >= 0),
        available_copies INTEGER NOT NULL CHECK (available_copies >= 0),
        created_at TEXT NOT NULL,
        CHECK (available_copies <= total_copies)
      );

      CREATE TABLE loans (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE RESTRICT,
        member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
        borrowed_at TEXT NOT NULL,
        due_at TEXT NOT NULL,
        returned_at TEXT,
        renewal_count INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'RETURNED'))
      );

      CREATE TABLE reservations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
        member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'PENDING'
          CHECK (status IN ('PENDING', 'READY', 'FULFILLED', 'CANCELLED'))
      );

      CREATE TABLE fines (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        loan_id INTEGER NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
        member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
        amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
        reason TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'UNPAID' CHECK (status IN ('UNPAID', 'PAID', 'WAIVED')),
        created_at TEXT NOT NULL,
        settled_at TEXT
      );

      CREATE INDEX idx_loans_member_status ON loans(member_id, status);
      CREATE INDEX idx_loans_book_status ON loans(book_id, status);
      CREATE INDEX idx_reservations_book_status ON reservations(book_id, status);
      CREATE INDEX idx_fines_member_status ON fines(member_id, status);

      -- A member may not queue twice for the same title.
      CREATE UNIQUE INDEX idx_reservations_unique_pending
        ON reservations(book_id, member_id)
        WHERE status IN ('PENDING', 'READY');

      -- A member may not hold two active loans of the same title.
      CREATE UNIQUE INDEX idx_loans_unique_active
        ON loans(book_id, member_id)
        WHERE status = 'ACTIVE';
    `,
  },
];

function ensureMigrationsTable(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);
}

/** Applies every migration that has not run yet. Safe to call repeatedly. */
export function runMigrations(db: Db): number {
  ensureMigrationsTable(db);

  const applied = new Set(
    db
      .prepare('SELECT version FROM schema_migrations')
      .all()
      .map((row) => (row as { version: number }).version),
  );

  const record = db.prepare(
    'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
  );

  let count = 0;
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) {
      continue;
    }
    db.transaction(() => {
      db.exec(migration.up);
      record.run(migration.version, migration.name, new Date().toISOString());
    })();
    count += 1;
  }

  return count;
}

export function currentSchemaVersion(db: Db): number {
  ensureMigrationsTable(db);
  const row = db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as {
    version: number | null;
  };
  return row.version ?? 0;
}

/** Test-only helper: wipes every row but keeps the schema in place. */
export function truncateAll(db: Db): void {
  db.exec(`
    PRAGMA foreign_keys = OFF;
    DELETE FROM fines;
    DELETE FROM reservations;
    DELETE FROM loans;
    DELETE FROM books;
    DELETE FROM members;
    DELETE FROM sqlite_sequence;
    PRAGMA foreign_keys = ON;
  `);
}
