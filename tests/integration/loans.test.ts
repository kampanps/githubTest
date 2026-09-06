import request from 'supertest';
import { TIER_POLICIES } from '../../src/domain/policy';
import { makeBook, makeMember } from '../helpers/factories';
import { ADMIN_KEY, LIBRARIAN_KEY, MEMBER_KEY, createTestHarness, type TestHarness } from '../helpers/testApp';

describe('/api/loans', () => {
  let harness: TestHarness;

  const borrow = (bookId: number, memberId: number) =>
    request(harness.app).post('/api/loans').set('x-api-key', MEMBER_KEY).send({ bookId, memberId });

  const returnLoan = (loanId: number) =>
    request(harness.app).post(`/api/loans/${loanId}/return`).set('x-api-key', MEMBER_KEY);

  const renew = (loanId: number) =>
    request(harness.app).post(`/api/loans/${loanId}/renew`).set('x-api-key', MEMBER_KEY);

  beforeEach(() => {
    harness = createTestHarness();
  });

  afterEach(() => {
    harness.close();
  });

  describe('borrowing', () => {
    it('creates a loan and takes a copy off the shelf', async () => {
      const book = makeBook(harness, { totalCopies: 2 });
      const member = makeMember(harness);

      const response = await borrow(book.id, member.id);

      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({
        bookId: book.id,
        memberId: member.id,
        status: 'ACTIVE',
        renewalCount: 0,
        returnedAt: null,
      });
      expect(harness.container.repos.books.findById(book.id)?.availableCopies).toBe(1);
    });

    it('sets the due date from the member tier', async () => {
      const book = makeBook(harness);
      const member = makeMember(harness, { tier: 'PREMIUM' });

      const response = await borrow(book.id, member.id);

      // now = 2025-01-15T09:00Z, PREMIUM gets 30 days.
      expect(response.body.borrowedAt).toBe('2025-01-15T09:00:00.000Z');
      expect(response.body.dueAt).toBe('2025-02-14T09:00:00.000Z');
    });

    it('404s for an unknown member', async () => {
      const book = makeBook(harness);
      const response = await borrow(book.id, 9999);
      expect(response.status).toBe(404);
      expect(response.body.error.message).toMatch(/Member/);
    });

    it('404s for an unknown book', async () => {
      const member = makeMember(harness);
      const response = await borrow(9999, member.id);
      expect(response.status).toBe(404);
      expect(response.body.error.message).toMatch(/Book/);
    });

    it('400s when the ids are missing', async () => {
      const response = await request(harness.app).post('/api/loans').set('x-api-key', MEMBER_KEY).send({});
      expect(response.status).toBe(400);
    });

    it('refuses when the last copy is gone', async () => {
      const book = makeBook(harness, { totalCopies: 1 });
      const first = makeMember(harness);
      const second = makeMember(harness);

      await borrow(book.id, first.id);
      const response = await borrow(book.id, second.id);

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('NO_COPIES_AVAILABLE');
      expect(harness.container.repos.books.findById(book.id)?.availableCopies).toBe(0);
    });

    it('refuses a second copy of the same title for the same member', async () => {
      const book = makeBook(harness, { totalCopies: 3 });
      const member = makeMember(harness);

      await borrow(book.id, member.id);
      const response = await borrow(book.id, member.id);

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('DUPLICATE_LOAN');
      expect(harness.container.repos.books.findById(book.id)?.availableCopies).toBe(2);
    });

    it('refuses a suspended member', async () => {
      const book = makeBook(harness);
      const member = makeMember(harness);
      await request(harness.app).post(`/api/members/${member.id}/suspend`).set('x-api-key', ADMIN_KEY);

      const response = await borrow(book.id, member.id);
      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('MEMBER_SUSPENDED');
    });

    it('refuses an expired membership', async () => {
      const book = makeBook(harness);
      const member = makeMember(harness, { membershipDays: -1 });

      const response = await borrow(book.id, member.id);
      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('MEMBERSHIP_EXPIRED');
    });

    it('enforces the tier loan limit', async () => {
      const member = makeMember(harness, { tier: 'STANDARD' });
      const limit = TIER_POLICIES.STANDARD.maxActiveLoans;

      for (let i = 0; i < limit; i += 1) {
        const book = makeBook(harness);
        const response = await borrow(book.id, member.id);
        expect(response.status).toBe(201);
      }

      const oneTooMany = await borrow(makeBook(harness).id, member.id);
      expect(oneTooMany.status).toBe(422);
      expect(oneTooMany.body.error.code).toBe('LOAN_LIMIT_REACHED');
    });

    it('lets a PREMIUM member exceed the STANDARD limit', async () => {
      const member = makeMember(harness, { tier: 'PREMIUM' });

      for (let i = 0; i < TIER_POLICIES.STANDARD.maxActiveLoans + 1; i += 1) {
        const response = await borrow(makeBook(harness).id, member.id);
        expect(response.status).toBe(201);
      }
    });
  });

  describe('returning', () => {
    it('returns a book on time with no fine', async () => {
      const book = makeBook(harness);
      const member = makeMember(harness);
      const { body: loan } = await borrow(book.id, member.id);

      harness.advanceDays(7);
      const response = await returnLoan(loan.id);

      expect(response.status).toBe(200);
      expect(response.body.loan.status).toBe('RETURNED');
      expect(response.body.loan.returnedAt).toBe('2025-01-22T09:00:00.000Z');
      expect(response.body.daysLate).toBe(0);
      expect(response.body.fine).toBeNull();
      expect(harness.container.repos.books.findById(book.id)?.availableCopies).toBe(1);
    });

    it('charges a fine for a late return, after the grace day', async () => {
      const book = makeBook(harness);
      const member = makeMember(harness);
      const { body: loan } = await borrow(book.id, member.id);

      // STANDARD = 14 days; 20 days later is 6 days late, 5 of them billable.
      harness.advanceDays(20);
      const response = await returnLoan(loan.id);

      expect(response.body.daysLate).toBe(6);
      expect(response.body.fine).toMatchObject({ amountCents: 2_500, status: 'UNPAID', memberId: member.id });
    });

    it('charges nothing when the return is inside the grace day', async () => {
      const book = makeBook(harness);
      const member = makeMember(harness);
      const { body: loan } = await borrow(book.id, member.id);

      harness.advanceDays(15);
      const response = await returnLoan(loan.id);

      expect(response.body.daysLate).toBe(1);
      expect(response.body.fine).toBeNull();
    });

    it('refuses to return the same loan twice', async () => {
      const book = makeBook(harness);
      const member = makeMember(harness);
      const { body: loan } = await borrow(book.id, member.id);

      await returnLoan(loan.id);
      const response = await returnLoan(loan.id);

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('LOAN_ALREADY_RETURNED');
      // The copy must not be put back on the shelf twice.
      expect(harness.container.repos.books.findById(book.id)?.availableCopies).toBe(1);
    });

    it('404s for an unknown loan', async () => {
      const response = await returnLoan(9999);
      expect(response.status).toBe(404);
    });

    it('frees the member to borrow the same title again', async () => {
      const book = makeBook(harness);
      const member = makeMember(harness);
      const { body: loan } = await borrow(book.id, member.id);

      await returnLoan(loan.id);
      const again = await borrow(book.id, member.id);

      expect(again.status).toBe(201);
    });
  });

  describe('renewing', () => {
    it('extends the due date from the current due date', async () => {
      const book = makeBook(harness);
      const member = makeMember(harness, { tier: 'STANDARD' });
      const { body: loan } = await borrow(book.id, member.id);

      const response = await renew(loan.id);

      expect(response.status).toBe(200);
      expect(response.body.renewalCount).toBe(1);
      expect(response.body.dueAt).toBe('2025-02-05T09:00:00.000Z');
    });

    it('stops at the tier renewal limit', async () => {
      const book = makeBook(harness);
      const member = makeMember(harness, { tier: 'STANDARD' });
      const { body: loan } = await borrow(book.id, member.id);

      for (let i = 0; i < TIER_POLICIES.STANDARD.maxRenewals; i += 1) {
        expect((await renew(loan.id)).status).toBe(200);
      }

      const response = await renew(loan.id);
      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('RENEWAL_LIMIT_REACHED');
    });

    it('refuses to renew an overdue loan', async () => {
      const book = makeBook(harness);
      const member = makeMember(harness);
      const { body: loan } = await borrow(book.id, member.id);

      harness.advanceDays(20);
      const response = await renew(loan.id);

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('LOAN_OVERDUE');
    });

    it('refuses to renew a returned loan', async () => {
      const book = makeBook(harness);
      const member = makeMember(harness);
      const { body: loan } = await borrow(book.id, member.id);
      await returnLoan(loan.id);

      const response = await renew(loan.id);
      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('LOAN_ALREADY_RETURNED');
    });
  });

  describe('listing', () => {
    it('filters by member and status', async () => {
      const member = makeMember(harness);
      const other = makeMember(harness);
      const first = makeBook(harness);
      const second = makeBook(harness);

      const { body: loan } = await borrow(first.id, member.id);
      await borrow(second.id, member.id);
      await borrow(first.id, other.id);
      await returnLoan(loan.id);

      const active = await request(harness.app)
        .get(`/api/loans?memberId=${member.id}&status=ACTIVE`)
        .set('x-api-key', MEMBER_KEY);
      expect(active.body.meta.total).toBe(1);

      const all = await request(harness.app).get(`/api/loans?memberId=${member.id}`).set('x-api-key', MEMBER_KEY);
      expect(all.body.meta.total).toBe(2);
    });

    it('lists overdue loans for staff only', async () => {
      const member = makeMember(harness);
      await borrow(makeBook(harness).id, member.id);
      harness.advanceDays(30);

      const staff = await request(harness.app).get('/api/loans/overdue').set('x-api-key', LIBRARIAN_KEY);
      expect(staff.status).toBe(200);
      expect(staff.body.data).toHaveLength(1);

      const plainMember = await request(harness.app).get('/api/loans/overdue').set('x-api-key', MEMBER_KEY);
      expect(plainMember.status).toBe(403);
    });

    it('reports no overdue loans before the due date', async () => {
      const member = makeMember(harness);
      await borrow(makeBook(harness).id, member.id);

      const response = await request(harness.app).get('/api/loans/overdue').set('x-api-key', LIBRARIAN_KEY);
      expect(response.body.data).toEqual([]);
    });

    it('returns a single loan by id', async () => {
      const member = makeMember(harness);
      const { body: loan } = await borrow(makeBook(harness).id, member.id);

      const response = await request(harness.app).get(`/api/loans/${loan.id}`).set('x-api-key', MEMBER_KEY);
      expect(response.status).toBe(200);
      expect(response.body.id).toBe(loan.id);
    });
  });
});
