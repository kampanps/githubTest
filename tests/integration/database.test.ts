import { closeDatabase, createDatabase } from '../../src/db/connection';
import { currentSchemaVersion, runMigrations, truncateAll } from '../../src/db/migrate';
import type { Db } from '../../src/db/connection';
import { makeBook, makeMember } from '../helpers/factories';
import { createTestHarness, type TestHarness } from '../helpers/testApp';

describe('database layer', () => {
  describe('migrations', () => {
    let db: Db;

    beforeEach(() => {
      db = createDatabase();
    });

    afterEach(() => {
      closeDatabase(db);
    });

    it('applies every migration on a fresh database', () => {
      expect(runMigrations(db)).toBe(1);
      expect(currentSchemaVersion(db)).toBe(1);
    });

    it('is idempotent', () => {
      runMigrations(db);
      expect(runMigrations(db)).toBe(0);
      expect(currentSchemaVersion(db)).toBe(1);
    });

    it('reports version 0 before anything is applied', () => {
      expect(currentSchemaVersion(db)).toBe(0);
    });

    it('creates every expected table', () => {
      runMigrations(db);
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all()
        .map((row) => (row as { name: string }).name);

      expect(tables).toEqual(expect.arrayContaining(['books', 'fines', 'loans', 'members', 'reservations']));
    });

    it('closing twice is safe', () => {
      closeDatabase(db);
      expect(() => closeDatabase(db)).not.toThrow();
    });
  });

  describe('constraints', () => {
    let harness: TestHarness;

    beforeEach(() => {
      harness = createTestHarness();
    });

    afterEach(() => {
      harness.close();
    });

    it('enforces foreign keys on loans', () => {
      const member = makeMember(harness);
      expect(() =>
        harness.container.repos.loans.insert({
          bookId: 999_999,
          memberId: member.id,
          borrowedAt: harness.now().toISOString(),
          dueAt: harness.now().toISOString(),
        }),
      ).toThrow(/FOREIGN KEY/i);
    });

    it('rejects a duplicate ISBN at the database level', () => {
      const book = makeBook(harness);
      expect(() => makeBook(harness, { isbn: book.isbn })).toThrow(/UNIQUE/i);
    });

    it('rejects a duplicate email at the database level', () => {
      const member = makeMember(harness);
      expect(() => makeMember(harness, { email: member.email })).toThrow(/UNIQUE/i);
    });

    it('rejects two active loans of the same title by the same member', () => {
      const book = makeBook(harness, { totalCopies: 2 });
      const member = makeMember(harness);
      const args = {
        bookId: book.id,
        memberId: member.id,
        borrowedAt: harness.now().toISOString(),
        dueAt: harness.now().toISOString(),
      };

      harness.container.repos.loans.insert(args);
      expect(() => harness.container.repos.loans.insert(args)).toThrow(/UNIQUE/i);
    });

    it('allows a second loan once the first is returned', () => {
      const book = makeBook(harness, { totalCopies: 2 });
      const member = makeMember(harness);
      const args = {
        bookId: book.id,
        memberId: member.id,
        borrowedAt: harness.now().toISOString(),
        dueAt: harness.now().toISOString(),
      };

      const first = harness.container.repos.loans.insert(args);
      harness.container.repos.loans.markReturned(first.id, harness.now().toISOString());

      expect(() => harness.container.repos.loans.insert(args)).not.toThrow();
    });

    it('rejects a duplicate open reservation', () => {
      const book = makeBook(harness);
      const member = makeMember(harness);
      const now = harness.now().toISOString();

      harness.container.repos.reservations.insert(book.id, member.id, now);
      expect(() => harness.container.repos.reservations.insert(book.id, member.id, now)).toThrow(/UNIQUE/i);
    });

    it('refuses to lend more copies than exist', () => {
      const book = makeBook(harness, { totalCopies: 1 });
      expect(harness.container.repos.books.reserveCopy(book.id)).toBe(true);
      expect(harness.container.repos.books.reserveCopy(book.id)).toBe(false);
      expect(harness.container.repos.books.findById(book.id)?.availableCopies).toBe(0);
    });

    it('refuses to shelve more copies than exist', () => {
      const book = makeBook(harness, { totalCopies: 1 });
      expect(harness.container.repos.books.releaseCopy(book.id)).toBe(false);
      expect(harness.container.repos.books.findById(book.id)?.availableCopies).toBe(1);
    });
  });

  describe('transactions', () => {
    let harness: TestHarness;

    beforeEach(() => {
      harness = createTestHarness();
    });

    afterEach(() => {
      harness.close();
    });

    it('rolls back every write when the transaction throws', () => {
      const book = makeBook(harness, { totalCopies: 2 });
      const member = makeMember(harness);
      const { repos } = harness.container;

      const doomed = harness.db.transaction(() => {
        repos.books.reserveCopy(book.id);
        repos.loans.insert({
          bookId: book.id,
          memberId: member.id,
          borrowedAt: harness.now().toISOString(),
          dueAt: harness.now().toISOString(),
        });
        throw new Error('something went wrong halfway through');
      });

      expect(() => doomed()).toThrow('something went wrong halfway through');
      expect(repos.books.findById(book.id)?.availableCopies).toBe(2);
      expect(repos.loans.countActiveByMember(member.id)).toBe(0);
    });

    it('leaves the copy count untouched when a borrow is rejected by a rule', async () => {
      const book = makeBook(harness, { totalCopies: 1 });
      const member = makeMember(harness, { membershipDays: -1 });

      expect(() => harness.container.services.loans.borrow({ bookId: book.id, memberId: member.id })).toThrow();
      expect(harness.container.repos.books.findById(book.id)?.availableCopies).toBe(1);
    });
  });

  describe('truncateAll', () => {
    let harness: TestHarness;

    beforeEach(() => {
      harness = createTestHarness();
    });

    afterEach(() => {
      harness.close();
    });

    it('clears the data but keeps the schema', () => {
      makeBook(harness);
      makeMember(harness);

      truncateAll(harness.db);

      expect(harness.container.repos.books.list({}, { page: 1, limit: 10, offset: 0 }).total).toBe(0);
      expect(harness.container.repos.members.list({}, { page: 1, limit: 10, offset: 0 }).total).toBe(0);
      expect(currentSchemaVersion(harness.db)).toBe(1);
    });

    it('resets autoincrement ids', () => {
      makeBook(harness);
      truncateAll(harness.db);
      expect(makeBook(harness).id).toBe(1);
    });
  });
});
