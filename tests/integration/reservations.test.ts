import request from 'supertest';
import { makeBook, makeMember } from '../helpers/factories';
import { ADMIN_KEY, MEMBER_KEY, createTestHarness, type TestHarness } from '../helpers/testApp';

describe('/api/reservations', () => {
  let harness: TestHarness;

  const borrow = (bookId: number, memberId: number) =>
    request(harness.app).post('/api/loans').set('x-api-key', MEMBER_KEY).send({ bookId, memberId });

  const reserve = (bookId: number, memberId: number) =>
    request(harness.app).post('/api/reservations').set('x-api-key', MEMBER_KEY).send({ bookId, memberId });

  beforeEach(() => {
    harness = createTestHarness();
  });

  afterEach(() => {
    harness.close();
  });

  it('queues a member for a fully borrowed title', async () => {
    const book = makeBook(harness, { totalCopies: 1 });
    const holder = makeMember(harness);
    const waiter = makeMember(harness);

    await borrow(book.id, holder.id);
    const response = await reserve(book.id, waiter.id);

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ bookId: book.id, memberId: waiter.id, status: 'PENDING', position: 1 });
  });

  it('refuses to queue for a book that is on the shelf', async () => {
    const book = makeBook(harness, { totalCopies: 1 });
    const member = makeMember(harness);

    const response = await reserve(book.id, member.id);

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('BOOK_AVAILABLE');
  });

  it('refuses to queue for a book the member already has out', async () => {
    const book = makeBook(harness, { totalCopies: 1 });
    const member = makeMember(harness);
    await borrow(book.id, member.id);

    const response = await reserve(book.id, member.id);
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('ALREADY_BORROWED');
  });

  it('refuses a duplicate reservation', async () => {
    const book = makeBook(harness, { totalCopies: 1 });
    await borrow(book.id, makeMember(harness).id);
    const waiter = makeMember(harness);

    await reserve(book.id, waiter.id);
    const response = await reserve(book.id, waiter.id);

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('ALREADY_RESERVED');
  });

  it('refuses a suspended member', async () => {
    const book = makeBook(harness, { totalCopies: 1 });
    await borrow(book.id, makeMember(harness).id);
    const waiter = makeMember(harness);
    await request(harness.app).post(`/api/members/${waiter.id}/suspend`).set('x-api-key', ADMIN_KEY);

    const response = await reserve(book.id, waiter.id);
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('MEMBER_SUSPENDED');
  });

  it('404s for an unknown book or member', async () => {
    const member = makeMember(harness);
    expect((await reserve(9999, member.id)).status).toBe(404);

    const book = makeBook(harness, { totalCopies: 1 });
    await borrow(book.id, member.id);
    expect((await reserve(book.id, 9999)).status).toBe(404);
  });

  it('keeps the queue in arrival order', async () => {
    const book = makeBook(harness, { totalCopies: 1 });
    await borrow(book.id, makeMember(harness).id);

    const first = makeMember(harness);
    const second = makeMember(harness);
    const third = makeMember(harness);

    for (const member of [first, second, third]) {
      harness.advanceDays(1);
      await reserve(book.id, member.id);
    }

    const response = await request(harness.app)
      .get(`/api/books/${book.id}/reservations`)
      .set('x-api-key', ADMIN_KEY);

    expect(response.body.data.map((r: { memberId: number; position: number }) => [r.memberId, r.position])).toEqual([
      [first.id, 1],
      [second.id, 2],
      [third.id, 3],
    ]);
  });

  it('lets a second member queue behind the first', async () => {
    const book = makeBook(harness, { totalCopies: 1 });
    await borrow(book.id, makeMember(harness).id);

    await reserve(book.id, makeMember(harness).id);
    const response = await reserve(book.id, makeMember(harness).id);

    expect(response.status).toBe(201);
    expect(response.body.position).toBe(2);
  });

  describe('cancelling', () => {
    it('cancels a pending reservation', async () => {
      const book = makeBook(harness, { totalCopies: 1 });
      await borrow(book.id, makeMember(harness).id);
      const { body: reservation } = await reserve(book.id, makeMember(harness).id);

      const response = await request(harness.app)
        .delete(`/api/reservations/${reservation.id}`)
        .set('x-api-key', MEMBER_KEY);

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('CANCELLED');
    });

    it('refuses to cancel twice', async () => {
      const book = makeBook(harness, { totalCopies: 1 });
      await borrow(book.id, makeMember(harness).id);
      const { body: reservation } = await reserve(book.id, makeMember(harness).id);

      await request(harness.app).delete(`/api/reservations/${reservation.id}`).set('x-api-key', MEMBER_KEY);
      const response = await request(harness.app)
        .delete(`/api/reservations/${reservation.id}`)
        .set('x-api-key', MEMBER_KEY);

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('RESERVATION_NOT_OPEN');
    });

    it('404s for an unknown reservation', async () => {
      const response = await request(harness.app).delete('/api/reservations/999').set('x-api-key', MEMBER_KEY);
      expect(response.status).toBe(404);
    });

    it('drops the cancelled member out of the queue', async () => {
      const book = makeBook(harness, { totalCopies: 1 });
      await borrow(book.id, makeMember(harness).id);
      const { body: first } = await reserve(book.id, makeMember(harness).id);
      const second = makeMember(harness);
      await reserve(book.id, second.id);

      await request(harness.app).delete(`/api/reservations/${first.id}`).set('x-api-key', MEMBER_KEY);

      const queue = await request(harness.app)
        .get(`/api/books/${book.id}/reservations`)
        .set('x-api-key', ADMIN_KEY);

      expect(queue.body.data).toHaveLength(1);
      expect(queue.body.data[0]).toMatchObject({ memberId: second.id, position: 1 });
    });

    it('reports no position for a cancelled reservation', async () => {
      const book = makeBook(harness, { totalCopies: 1 });
      await borrow(book.id, makeMember(harness).id);
      const { body: reservation } = await reserve(book.id, makeMember(harness).id);

      await request(harness.app).delete(`/api/reservations/${reservation.id}`).set('x-api-key', MEMBER_KEY);

      const response = await request(harness.app)
        .get(`/api/reservations/${reservation.id}`)
        .set('x-api-key', MEMBER_KEY);

      expect(response.body).toMatchObject({ status: 'CANCELLED', position: null });
    });
  });

  it('404s the queue of an unknown book', async () => {
    const response = await request(harness.app).get('/api/books/9999/reservations').set('x-api-key', ADMIN_KEY);
    expect(response.status).toBe(404);
  });
});
