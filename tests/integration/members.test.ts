import request from 'supertest';
import { makeBook, makeMember } from '../helpers/factories';
import { ADMIN_KEY, LIBRARIAN_KEY, MEMBER_KEY, createTestHarness, type TestHarness } from '../helpers/testApp';

describe('/api/members', () => {
  let harness: TestHarness;

  beforeEach(() => {
    harness = createTestHarness();
  });

  afterEach(() => {
    harness.close();
  });

  describe('POST /api/members', () => {
    it('registers a member with sensible defaults', async () => {
      const response = await request(harness.app)
        .post('/api/members')
        .set('x-api-key', LIBRARIAN_KEY)
        .send({ name: 'Somchai Jaidee', email: 'somchai@example.com' });

      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({
        name: 'Somchai Jaidee',
        email: 'somchai@example.com',
        tier: 'STANDARD',
        status: 'ACTIVE',
      });
    });

    it('sets the membership expiry from the injected clock', async () => {
      harness.setNow('2025-01-01T00:00:00.000Z');
      const response = await request(harness.app)
        .post('/api/members')
        .set('x-api-key', LIBRARIAN_KEY)
        .send({ name: 'Napat', email: 'napat@example.com', membershipMonths: 1 });

      // 1 month is modelled as 30 days.
      expect(response.body.membershipExpiresAt).toBe('2025-01-31T00:00:00.000Z');
    });

    it('rejects a duplicate email regardless of case', async () => {
      await request(harness.app)
        .post('/api/members')
        .set('x-api-key', LIBRARIAN_KEY)
        .send({ name: 'Somchai', email: 'somchai@example.com' });

      const response = await request(harness.app)
        .post('/api/members')
        .set('x-api-key', LIBRARIAN_KEY)
        .send({ name: 'Somchai Again', email: 'SOMCHAI@EXAMPLE.COM' });

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('EMAIL_ALREADY_REGISTERED');
    });

    it('rejects an invalid email', async () => {
      const response = await request(harness.app)
        .post('/api/members')
        .set('x-api-key', LIBRARIAN_KEY)
        .send({ name: 'Somchai', email: 'not-an-email' });

      expect(response.status).toBe(400);
      expect(response.body.error.details[0].field).toBe('email');
    });

    it('accepts an explicit tier', async () => {
      const response = await request(harness.app)
        .post('/api/members')
        .set('x-api-key', LIBRARIAN_KEY)
        .send({ name: 'Staff', email: 'staff@example.com', tier: 'STAFF' });

      expect(response.body.tier).toBe('STAFF');
    });
  });

  describe('GET /api/members', () => {
    beforeEach(() => {
      makeMember(harness, { name: 'Alice', email: 'alice@example.com', tier: 'STANDARD' });
      makeMember(harness, { name: 'Bob', email: 'bob@example.com', tier: 'PREMIUM' });
      makeMember(harness, { name: 'Carol', email: 'carol@example.com', tier: 'PREMIUM' });
    });

    it('lists members for staff', async () => {
      const response = await request(harness.app).get('/api/members').set('x-api-key', LIBRARIAN_KEY);
      expect(response.body.meta.total).toBe(3);
    });

    it('filters by tier', async () => {
      const response = await request(harness.app).get('/api/members?tier=PREMIUM').set('x-api-key', ADMIN_KEY);
      expect(response.body.data).toHaveLength(2);
    });

    it('ignores an unknown tier filter instead of erroring', async () => {
      const response = await request(harness.app).get('/api/members?tier=GOLD').set('x-api-key', ADMIN_KEY);
      expect(response.status).toBe(200);
      expect(response.body.meta.total).toBe(3);
    });

    it('searches by name or email', async () => {
      const response = await request(harness.app).get('/api/members?search=bob@').set('x-api-key', ADMIN_KEY);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].name).toBe('Bob');
    });

    it('filters by status', async () => {
      const [alice] = harness.container.repos.members.list({ search: 'Alice' }, { page: 1, limit: 1, offset: 0 }).rows;
      await request(harness.app).post(`/api/members/${alice?.id}/suspend`).set('x-api-key', ADMIN_KEY);

      const response = await request(harness.app).get('/api/members?status=SUSPENDED').set('x-api-key', ADMIN_KEY);
      expect(response.body.data).toHaveLength(1);
    });
  });

  describe('suspend / activate', () => {
    it('suspends and reactivates', async () => {
      const member = makeMember(harness);

      const suspended = await request(harness.app)
        .post(`/api/members/${member.id}/suspend`)
        .set('x-api-key', LIBRARIAN_KEY);
      expect(suspended.body.status).toBe('SUSPENDED');

      const activated = await request(harness.app)
        .post(`/api/members/${member.id}/activate`)
        .set('x-api-key', LIBRARIAN_KEY);
      expect(activated.body.status).toBe('ACTIVE');
    });

    it('rejects a no-op status change', async () => {
      const member = makeMember(harness);
      const response = await request(harness.app)
        .post(`/api/members/${member.id}/activate`)
        .set('x-api-key', LIBRARIAN_KEY);

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('STATUS_UNCHANGED');
    });

    it('404s for an unknown member', async () => {
      const response = await request(harness.app).post('/api/members/999/suspend').set('x-api-key', ADMIN_KEY);
      expect(response.status).toBe(404);
    });

    it('is not available to plain members', async () => {
      const member = makeMember(harness);
      const response = await request(harness.app)
        .post(`/api/members/${member.id}/suspend`)
        .set('x-api-key', MEMBER_KEY);

      expect(response.status).toBe(403);
    });
  });

  describe('POST /api/members/:id/renew-membership', () => {
    it('extends from today, not from the old expiry', async () => {
      harness.setNow('2025-01-01T00:00:00.000Z');
      const member = makeMember(harness, { membershipDays: -10 });

      const response = await request(harness.app)
        .post(`/api/members/${member.id}/renew-membership`)
        .set('x-api-key', LIBRARIAN_KEY)
        .send({ months: 1 });

      expect(response.status).toBe(200);
      expect(response.body.membershipExpiresAt).toBe('2025-01-31T00:00:00.000Z');
    });

    it('rejects a missing months value', async () => {
      const member = makeMember(harness);
      const response = await request(harness.app)
        .post(`/api/members/${member.id}/renew-membership`)
        .set('x-api-key', LIBRARIAN_KEY)
        .send({});

      expect(response.status).toBe(400);
    });

    it('rejects more than 60 months', async () => {
      const member = makeMember(harness);
      const response = await request(harness.app)
        .post(`/api/members/${member.id}/renew-membership`)
        .set('x-api-key', LIBRARIAN_KEY)
        .send({ months: 61 });

      expect(response.status).toBe(400);
    });
  });

  describe('GET /api/members/:id/summary', () => {
    it('reports the loan allowance for the tier', async () => {
      const member = makeMember(harness, { tier: 'STANDARD' });
      const book = makeBook(harness);

      await request(harness.app)
        .post('/api/loans')
        .set('x-api-key', ADMIN_KEY)
        .send({ bookId: book.id, memberId: member.id });

      const response = await request(harness.app)
        .get(`/api/members/${member.id}/summary`)
        .set('x-api-key', MEMBER_KEY);

      expect(response.status).toBe(200);
      expect(response.body.loanAllowance).toEqual({ used: 1, max: 3, remaining: 2 });
      expect(response.body.activeLoans).toHaveLength(1);
      expect(response.body.unpaidFineCents).toBe(0);
    });

    it('reports an empty summary for a new member', async () => {
      const member = makeMember(harness, { tier: 'PREMIUM' });
      const response = await request(harness.app)
        .get(`/api/members/${member.id}/summary`)
        .set('x-api-key', MEMBER_KEY);

      expect(response.body.loanAllowance).toEqual({ used: 0, max: 10, remaining: 10 });
    });

    it('404s for an unknown member', async () => {
      const response = await request(harness.app).get('/api/members/12345/summary').set('x-api-key', ADMIN_KEY);
      expect(response.status).toBe(404);
    });
  });
});
