import request from 'supertest';
import { makeBook, makeMember } from '../helpers/factories';
import { ADMIN_KEY, LIBRARIAN_KEY, MEMBER_KEY, createTestHarness, type TestHarness } from '../helpers/testApp';

describe('API key authentication and roles', () => {
  let harness: TestHarness;
  let bookId: number;

  beforeEach(() => {
    harness = createTestHarness();
    bookId = makeBook(harness).id;
    makeMember(harness);
  });

  afterEach(() => {
    harness.close();
  });

  describe('authentication', () => {
    it('rejects a request with no key', async () => {
      const response = await request(harness.app).get('/api/books');
      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('UNAUTHORIZED');
      expect(response.body.error.message).toMatch(/x-api-key/);
    });

    it('rejects an unknown key', async () => {
      const response = await request(harness.app).get('/api/books').set('x-api-key', 'not-a-real-key');
      expect(response.status).toBe(401);
      expect(response.body.error.message).toMatch(/Unknown API key/);
    });

    it('rejects an empty key header', async () => {
      const response = await request(harness.app).get('/api/books').set('x-api-key', '');
      expect(response.status).toBe(401);
    });

    it.each([
      ['admin', ADMIN_KEY],
      ['librarian', LIBRARIAN_KEY],
      ['member', MEMBER_KEY],
    ])('accepts the %s key on a public read', async (_role, key) => {
      const response = await request(harness.app).get('/api/books').set('x-api-key', key);
      expect(response.status).toBe(200);
    });
  });

  describe('role enforcement', () => {
    it('lets a librarian create a book', async () => {
      const response = await request(harness.app)
        .post('/api/books')
        .set('x-api-key', LIBRARIAN_KEY)
        .send({ isbn: '9780201616224', title: 'The Pragmatic Programmer', author: 'Hunt', publishedYear: 1999, totalCopies: 1 });

      expect(response.status).toBe(201);
    });

    it('stops a member from creating a book', async () => {
      const response = await request(harness.app)
        .post('/api/books')
        .set('x-api-key', MEMBER_KEY)
        .send({ isbn: '9780201616224', title: 'The Pragmatic Programmer', author: 'Hunt', publishedYear: 1999, totalCopies: 1 });

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('FORBIDDEN');
      expect(response.body.error.message).toMatch(/ADMIN, LIBRARIAN/);
    });

    it('stops a librarian from deleting a book (admin only)', async () => {
      const response = await request(harness.app).delete(`/api/books/${bookId}`).set('x-api-key', LIBRARIAN_KEY);
      expect(response.status).toBe(403);
    });

    it('lets an admin delete a book', async () => {
      const response = await request(harness.app).delete(`/api/books/${bookId}`).set('x-api-key', ADMIN_KEY);
      expect(response.status).toBe(204);
    });

    it('stops a member from listing every member', async () => {
      const response = await request(harness.app).get('/api/members').set('x-api-key', MEMBER_KEY);
      expect(response.status).toBe(403);
    });

    it('checks the role before validating the body', async () => {
      // A member sending nonsense should still be told about the role, not the body.
      const response = await request(harness.app).post('/api/books').set('x-api-key', MEMBER_KEY).send({});
      expect(response.status).toBe(403);
    });
  });
});
