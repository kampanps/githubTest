import request from 'supertest';
import { makeBook, makeMember } from '../helpers/factories';
import { ADMIN_KEY, MEMBER_KEY, createTestHarness, type TestHarness } from '../helpers/testApp';

/**
 * End-to-end journeys that cross several endpoints. These are the tests that
 * would catch a regression in how the pieces fit together rather than in any
 * single handler.
 */
describe('lending journeys', () => {
  let harness: TestHarness;

  const api = () => request(harness.app);

  beforeEach(() => {
    harness = createTestHarness();
  });

  afterEach(() => {
    harness.close();
  });

  it('runs the reservation hand-off: borrow, queue, return, promote, collect', async () => {
    const book = makeBook(harness, { title: 'The Only Copy', totalCopies: 1 });
    const holder = makeMember(harness, { name: 'Holder' });
    const waiter = makeMember(harness, { name: 'Waiter' });
    const opportunist = makeMember(harness, { name: 'Opportunist' });

    // 1. The only copy goes out.
    const { body: loan } = await api()
      .post('/api/loans')
      .set('x-api-key', MEMBER_KEY)
      .send({ bookId: book.id, memberId: holder.id });
    expect(loan.status).toBe('ACTIVE');

    // 2. Someone queues for it.
    const { body: reservation } = await api()
      .post('/api/reservations')
      .set('x-api-key', MEMBER_KEY)
      .send({ bookId: book.id, memberId: waiter.id });
    expect(reservation).toMatchObject({ status: 'PENDING', position: 1 });

    // 3. The holder cannot renew while someone is waiting.
    const renewal = await api().post(`/api/loans/${loan.id}/renew`).set('x-api-key', MEMBER_KEY);
    expect(renewal.status).toBe(422);
    expect(renewal.body.error.code).toBe('RESERVED_BY_ANOTHER_MEMBER');

    // 4. The book comes back and the waiter is promoted.
    harness.advanceDays(10);
    const { body: receipt } = await api().post(`/api/loans/${loan.id}/return`).set('x-api-key', MEMBER_KEY);
    expect(receipt.fine).toBeNull();
    expect(receipt.promotedReservation).toMatchObject({ id: reservation.id, status: 'READY' });

    // 5. A passer-by cannot take the copy that is being held.
    const stolen = await api()
      .post('/api/loans')
      .set('x-api-key', MEMBER_KEY)
      .send({ bookId: book.id, memberId: opportunist.id });
    expect(stolen.status).toBe(422);
    expect(stolen.body.error.code).toBe('RESERVED_BY_ANOTHER_MEMBER');

    // 6. The waiter collects it, and the reservation is consumed.
    const collected = await api()
      .post('/api/loans')
      .set('x-api-key', MEMBER_KEY)
      .send({ bookId: book.id, memberId: waiter.id });
    expect(collected.status).toBe(201);

    const finalState = await api().get(`/api/reservations/${reservation.id}`).set('x-api-key', MEMBER_KEY);
    expect(finalState.body).toMatchObject({ status: 'FULFILLED', position: null });

    const queue = await api().get(`/api/books/${book.id}/reservations`).set('x-api-key', ADMIN_KEY);
    expect(queue.body.data).toEqual([]);
  });

  it('runs the overdue journey: borrow, go late, get fined, get blocked, pay, borrow again', async () => {
    const member = makeMember(harness, { tier: 'STANDARD' });
    const first = makeBook(harness, { title: 'Late Book' });
    const second = makeBook(harness, { title: 'Next Book' });

    const { body: loan } = await api()
      .post('/api/loans')
      .set('x-api-key', MEMBER_KEY)
      .send({ bookId: first.id, memberId: member.id });

    // 60 days on a 14-day loan: 46 days late, 45 billable, 22500 cents.
    harness.advanceDays(60);

    const overdue = await api().get('/api/loans/overdue').set('x-api-key', ADMIN_KEY);
    expect(overdue.body.data.map((l: { id: number }) => l.id)).toContain(loan.id);

    const { body: receipt } = await api().post(`/api/loans/${loan.id}/return`).set('x-api-key', MEMBER_KEY);
    expect(receipt.daysLate).toBe(46);
    expect(receipt.fine.amountCents).toBe(22_500);

    const blocked = await api()
      .post('/api/loans')
      .set('x-api-key', MEMBER_KEY)
      .send({ bookId: second.id, memberId: member.id });
    expect(blocked.body.error.code).toBe('OUTSTANDING_FINES');

    await api().post(`/api/fines/${receipt.fine.id}/pay`).set('x-api-key', MEMBER_KEY);

    const summary = await api().get(`/api/members/${member.id}/summary`).set('x-api-key', MEMBER_KEY);
    expect(summary.body.unpaidFineCents).toBe(0);

    const unblocked = await api()
      .post('/api/loans')
      .set('x-api-key', MEMBER_KEY)
      .send({ bookId: second.id, memberId: member.id });
    expect(unblocked.status).toBe(201);
  });

  it('runs the suspension journey: a suspended member keeps their loans but cannot start new ones', async () => {
    const member = makeMember(harness);
    const held = makeBook(harness);
    const wanted = makeBook(harness);

    const { body: loan } = await api()
      .post('/api/loans')
      .set('x-api-key', MEMBER_KEY)
      .send({ bookId: held.id, memberId: member.id });

    await api().post(`/api/members/${member.id}/suspend`).set('x-api-key', ADMIN_KEY);

    const blockedBorrow = await api()
      .post('/api/loans')
      .set('x-api-key', MEMBER_KEY)
      .send({ bookId: wanted.id, memberId: member.id });
    expect(blockedBorrow.body.error.code).toBe('MEMBER_SUSPENDED');

    const blockedRenewal = await api().post(`/api/loans/${loan.id}/renew`).set('x-api-key', MEMBER_KEY);
    expect(blockedRenewal.body.error.code).toBe('MEMBER_SUSPENDED');

    // Returning is always allowed - we want the book back.
    const returned = await api().post(`/api/loans/${loan.id}/return`).set('x-api-key', MEMBER_KEY);
    expect(returned.status).toBe(200);

    await api().post(`/api/members/${member.id}/activate`).set('x-api-key', ADMIN_KEY);
    const allowed = await api()
      .post('/api/loans')
      .set('x-api-key', MEMBER_KEY)
      .send({ bookId: wanted.id, memberId: member.id });
    expect(allowed.status).toBe(201);
  });

  it('runs the expiry journey: a lapsed membership blocks borrowing until it is renewed', async () => {
    const member = makeMember(harness, { membershipDays: 5 });
    const book = makeBook(harness);

    harness.advanceDays(10);

    const blocked = await api()
      .post('/api/loans')
      .set('x-api-key', MEMBER_KEY)
      .send({ bookId: book.id, memberId: member.id });
    expect(blocked.body.error.code).toBe('MEMBERSHIP_EXPIRED');

    await api()
      .post(`/api/members/${member.id}/renew-membership`)
      .set('x-api-key', ADMIN_KEY)
      .send({ months: 12 });

    const allowed = await api()
      .post('/api/loans')
      .set('x-api-key', MEMBER_KEY)
      .send({ bookId: book.id, memberId: member.id });
    expect(allowed.status).toBe(201);
  });

  it('keeps copy counts balanced across a busy multi-copy title', async () => {
    const book = makeBook(harness, { totalCopies: 3 });
    const members = [makeMember(harness), makeMember(harness), makeMember(harness), makeMember(harness)];
    const loanIds: number[] = [];

    for (const member of members.slice(0, 3)) {
      const { body } = await api()
        .post('/api/loans')
        .set('x-api-key', MEMBER_KEY)
        .send({ bookId: book.id, memberId: member.id });
      loanIds.push(body.id);
    }

    expect(harness.container.repos.books.findById(book.id)?.availableCopies).toBe(0);

    const fourth = await api()
      .post('/api/loans')
      .set('x-api-key', MEMBER_KEY)
      .send({ bookId: book.id, memberId: members[3]?.id });
    expect(fourth.body.error.code).toBe('NO_COPIES_AVAILABLE');

    for (const loanId of loanIds) {
      await api().post(`/api/loans/${loanId}/return`).set('x-api-key', MEMBER_KEY);
    }

    const restored = harness.container.repos.books.findById(book.id);
    expect(restored).toMatchObject({ totalCopies: 3, availableCopies: 3 });
  });
});
