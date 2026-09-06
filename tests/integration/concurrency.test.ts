import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { loadConfig } from '../../src/config';
import { createContainer } from '../../src/container';
import { closeDatabase, createDatabase } from '../../src/db/connection';
import { runMigrations } from '../../src/db/migrate';
import { createBookRepository } from '../../src/repositories/bookRepository';
import { makeBook, makeMember } from '../helpers/factories';
import { MEMBER_KEY, createTestHarness, type TestHarness } from '../helpers/testApp';

/**
 * "What happens when two people grab the last copy at the same moment?"
 *
 * Two separate guarantees answer that, and these tests pin both of them down:
 *
 *   1. Node runs one request at a time, and better-sqlite3 is synchronous, so a
 *      service transaction can never be interleaved with another request.
 *   2. Even if it could - a second process, a second replica - the decrement is
 *      a guarded UPDATE (`WHERE available_copies > 0`), so the database itself
 *      refuses to hand out a copy that is not there.
 *
 * Guarantee 2 is the one that matters, because guarantee 1 disappears the moment
 * you run more than one instance.
 */
describe('concurrent access', () => {
  describe('many requests for the last copy', () => {
    let harness: TestHarness;

    beforeEach(() => {
      harness = createTestHarness();
    });

    afterEach(() => {
      harness.close();
    });

    it('gives the single copy to exactly one of ten simultaneous borrowers', async () => {
      const book = makeBook(harness, { title: 'The Last Copy', totalCopies: 1 });
      const members = Array.from({ length: 10 }, () => makeMember(harness));

      const responses = await Promise.all(
        members.map((member) =>
          request(harness.app)
            .post('/api/loans')
            .set('x-api-key', MEMBER_KEY)
            .send({ bookId: book.id, memberId: member.id }),
        ),
      );

      const created = responses.filter((r) => r.status === 201);
      const rejected = responses.filter((r) => r.status === 422);

      expect(created).toHaveLength(1);
      expect(rejected).toHaveLength(9);
      expect(new Set(rejected.map((r) => r.body.error.code))).toEqual(new Set(['NO_COPIES_AVAILABLE']));
    });

    it('never lets availableCopies go negative', async () => {
      const book = makeBook(harness, { totalCopies: 2 });
      const members = Array.from({ length: 8 }, () => makeMember(harness));

      await Promise.all(
        members.map((member) =>
          request(harness.app)
            .post('/api/loans')
            .set('x-api-key', MEMBER_KEY)
            .send({ bookId: book.id, memberId: member.id }),
        ),
      );

      const after = harness.container.repos.books.findById(book.id);
      expect(after?.availableCopies).toBe(0);
      expect(harness.container.repos.loans.list({ bookId: book.id }, { page: 1, limit: 50, offset: 0 }).total).toBe(2);
    });

    it('hands out exactly as many loans as there are copies', async () => {
      const book = makeBook(harness, { totalCopies: 3 });
      const members = Array.from({ length: 12 }, () => makeMember(harness));

      const responses = await Promise.all(
        members.map((member) =>
          request(harness.app)
            .post('/api/loans')
            .set('x-api-key', MEMBER_KEY)
            .send({ bookId: book.id, memberId: member.id }),
        ),
      );

      expect(responses.filter((r) => r.status === 201)).toHaveLength(3);
      expect(harness.container.repos.books.findById(book.id)?.availableCopies).toBe(0);
    });

    it('lets the same member fire the same borrow twice without getting two loans', async () => {
      const book = makeBook(harness, { totalCopies: 5 });
      const member = makeMember(harness);
      const send = () =>
        request(harness.app)
          .post('/api/loans')
          .set('x-api-key', MEMBER_KEY)
          .send({ bookId: book.id, memberId: member.id });

      const [first, second] = await Promise.all([send(), send()]);

      expect([first?.status, second?.status].sort()).toEqual([201, 422]);
      expect(harness.container.repos.loans.countActiveByMember(member.id)).toBe(1);
      // One copy off the shelf, not two.
      expect(harness.container.repos.books.findById(book.id)?.availableCopies).toBe(4);
    });
  });

  describe('two connections to the same database file', () => {
    let directory: string;
    let path: string;

    beforeEach(() => {
      directory = mkdtempSync(join(tmpdir(), 'library-concurrency-'));
      path = join(directory, 'library.db');
    });

    afterEach(() => {
      rmSync(directory, { recursive: true, force: true });
    });

    /**
     * This is the case single-threadedness does NOT cover: two processes, or two
     * replicas behind a load balancer, sharing one database.
     */
    it('lets only one connection take the last copy', () => {
      const setup = createDatabase(path);
      runMigrations(setup);
      const book = createBookRepository(setup).insert(
        { isbn: '9780132350884', title: 'Shared', author: 'A', publishedYear: 2020, totalCopies: 1 },
        new Date().toISOString(),
      );
      closeDatabase(setup);

      const alpha = createDatabase(path);
      const bravo = createDatabase(path);

      try {
        const alphaWon = createBookRepository(alpha).reserveCopy(book.id);
        const bravoWon = createBookRepository(bravo).reserveCopy(book.id);

        expect(alphaWon).toBe(true);
        expect(bravoWon).toBe(false);
        expect(createBookRepository(bravo).findById(book.id)?.availableCopies).toBe(0);
      } finally {
        closeDatabase(alpha);
        closeDatabase(bravo);
      }
    });

    it('refuses a duplicate active loan even from a second connection', () => {
      const config = loadConfig({ DATABASE_PATH: path } as NodeJS.ProcessEnv);

      const setup = createDatabase(path);
      runMigrations(setup);
      const first = createContainer({ db: setup, config });
      const book = first.repos.books.insert(
        { isbn: '9780132350884', title: 'Shared', author: 'A', publishedYear: 2020, totalCopies: 5 },
        new Date().toISOString(),
      );
      const member = first.repos.members.insert({
        name: 'Racer',
        email: 'racer@example.com',
        tier: 'STANDARD',
        joinedAt: new Date().toISOString(),
        membershipExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      });

      const second = createDatabase(path);
      const other = createContainer({ db: second, config });

      try {
        const args = {
          bookId: book.id,
          memberId: member.id,
          borrowedAt: new Date().toISOString(),
          dueAt: new Date().toISOString(),
        };

        first.repos.loans.insert(args);
        // The partial unique index is enforced by SQLite, not by the service layer.
        expect(() => other.repos.loans.insert(args)).toThrow(/UNIQUE/i);
      } finally {
        closeDatabase(setup);
        closeDatabase(second);
      }
    });
  });
});
