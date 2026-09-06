import request from 'supertest';
import { BORROW_BLOCK_FINE_THRESHOLD_CENTS } from '../../src/domain/policy';
import { makeBook, makeMember } from '../helpers/factories';
import { ADMIN_KEY, LIBRARIAN_KEY, MEMBER_KEY, createTestHarness, type TestHarness } from '../helpers/testApp';

describe('fines', () => {
  let harness: TestHarness;

  const borrow = (bookId: number, memberId: number) =>
    request(harness.app).post('/api/loans').set('x-api-key', MEMBER_KEY).send({ bookId, memberId });

  const returnLoan = (loanId: number) =>
    request(harness.app).post(`/api/loans/${loanId}/return`).set('x-api-key', MEMBER_KEY);

  /** Borrows a book, waits `daysLate` past the 14-day STANDARD due date, returns it. */
  async function incurFine(memberId: number, daysLate: number): Promise<number> {
    const book = makeBook(harness);
    const { body: loan } = await borrow(book.id, memberId);
    harness.advanceDays(14 + daysLate);
    const { body: receipt } = await returnLoan(loan.id);
    harness.advanceDays(-(14 + daysLate));
    return receipt.fine?.id ?? 0;
  }

  beforeEach(() => {
    harness = createTestHarness();
  });

  afterEach(() => {
    harness.close();
  });

  describe('GET /api/members/:id/fines', () => {
    it('reports an empty statement for a member with no fines', async () => {
      const member = makeMember(harness);
      const response = await request(harness.app)
        .get(`/api/members/${member.id}/fines`)
        .set('x-api-key', MEMBER_KEY);

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ fines: [], unpaidCents: 0, unpaidFormatted: '0.00' });
    });

    it('totals several unpaid fines', async () => {
      const member = makeMember(harness);
      await incurFine(member.id, 6); // 5 billable days -> 2500
      await incurFine(member.id, 3); // 2 billable days -> 1000

      const response = await request(harness.app)
        .get(`/api/members/${member.id}/fines`)
        .set('x-api-key', MEMBER_KEY);

      expect(response.body.fines).toHaveLength(2);
      expect(response.body.unpaidCents).toBe(3_500);
      expect(response.body.unpaidFormatted).toBe('35.00');
    });

    it('filters by status', async () => {
      const member = makeMember(harness);
      const fineId = await incurFine(member.id, 6);
      await request(harness.app).post(`/api/fines/${fineId}/pay`).set('x-api-key', MEMBER_KEY);

      const paid = await request(harness.app)
        .get(`/api/members/${member.id}/fines?status=PAID`)
        .set('x-api-key', MEMBER_KEY);
      expect(paid.body.fines).toHaveLength(1);

      const unpaid = await request(harness.app)
        .get(`/api/members/${member.id}/fines?status=UNPAID`)
        .set('x-api-key', MEMBER_KEY);
      expect(unpaid.body.fines).toHaveLength(0);
    });

    it('404s for an unknown member', async () => {
      const response = await request(harness.app).get('/api/members/9999/fines').set('x-api-key', ADMIN_KEY);
      expect(response.status).toBe(404);
    });
  });

  describe('paying and waiving', () => {
    it('marks a fine paid and stamps the settlement time', async () => {
      const member = makeMember(harness);
      const fineId = await incurFine(member.id, 6);

      const response = await request(harness.app).post(`/api/fines/${fineId}/pay`).set('x-api-key', MEMBER_KEY);

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ status: 'PAID', settledAt: harness.now().toISOString() });
    });

    it('refuses to pay the same fine twice', async () => {
      const member = makeMember(harness);
      const fineId = await incurFine(member.id, 6);

      await request(harness.app).post(`/api/fines/${fineId}/pay`).set('x-api-key', MEMBER_KEY);
      const response = await request(harness.app).post(`/api/fines/${fineId}/pay`).set('x-api-key', MEMBER_KEY);

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('FINE_ALREADY_SETTLED');
    });

    it('lets an admin waive a fine', async () => {
      const member = makeMember(harness);
      const fineId = await incurFine(member.id, 6);

      const response = await request(harness.app).post(`/api/fines/${fineId}/waive`).set('x-api-key', ADMIN_KEY);
      expect(response.status).toBe(200);
      expect(response.body.status).toBe('WAIVED');
    });

    it('stops a librarian from waiving a fine', async () => {
      const member = makeMember(harness);
      const fineId = await incurFine(member.id, 6);

      const response = await request(harness.app).post(`/api/fines/${fineId}/waive`).set('x-api-key', LIBRARIAN_KEY);
      expect(response.status).toBe(403);
    });

    it('404s for an unknown fine', async () => {
      const response = await request(harness.app).post('/api/fines/9999/pay').set('x-api-key', MEMBER_KEY);
      expect(response.status).toBe(404);
    });

    it('removes a waived fine from the outstanding balance', async () => {
      const member = makeMember(harness);
      const fineId = await incurFine(member.id, 6);
      await request(harness.app).post(`/api/fines/${fineId}/waive`).set('x-api-key', ADMIN_KEY);

      const response = await request(harness.app)
        .get(`/api/members/${member.id}/fines`)
        .set('x-api-key', MEMBER_KEY);

      expect(response.body.unpaidCents).toBe(0);
    });
  });

  describe('fines as a borrowing block', () => {
    it('still allows borrowing below the threshold', async () => {
      const member = makeMember(harness);
      await incurFine(member.id, 6);

      const response = await borrow(makeBook(harness).id, member.id);
      expect(response.status).toBe(201);
    });

    it('blocks borrowing once the threshold is reached', async () => {
      const member = makeMember(harness);
      await incurFine(member.id, 45); // 44 billable days -> 22000 cents

      const statement = await request(harness.app)
        .get(`/api/members/${member.id}/fines`)
        .set('x-api-key', MEMBER_KEY);
      expect(statement.body.unpaidCents).toBeGreaterThanOrEqual(BORROW_BLOCK_FINE_THRESHOLD_CENTS);

      const response = await borrow(makeBook(harness).id, member.id);
      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('OUTSTANDING_FINES');
    });

    it('unblocks borrowing once the fine is paid', async () => {
      const member = makeMember(harness);
      const fineId = await incurFine(member.id, 45);

      await request(harness.app).post(`/api/fines/${fineId}/pay`).set('x-api-key', MEMBER_KEY);

      const response = await borrow(makeBook(harness).id, member.id);
      expect(response.status).toBe(201);
    });
  });
});
