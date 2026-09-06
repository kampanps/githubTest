import request from 'supertest';
import { makeBook, makeMember, nextIsbn13 } from '../helpers/factories';
import { ADMIN_KEY, LIBRARIAN_KEY, createTestHarness, type TestHarness } from '../helpers/testApp';

const VALID_BOOK = {
  isbn: '9780132350884',
  title: 'Clean Code',
  author: 'Robert C. Martin',
  publishedYear: 2008,
  totalCopies: 3,
};

describe('/api/books', () => {
  let harness: TestHarness;

  beforeEach(() => {
    harness = createTestHarness();
  });

  afterEach(() => {
    harness.close();
  });

  describe('POST /api/books', () => {
    it('creates a book with every copy on the shelf', async () => {
      const response = await request(harness.app).post('/api/books').set('x-api-key', LIBRARIAN_KEY).send(VALID_BOOK);

      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({
        isbn: '9780132350884',
        title: 'Clean Code',
        totalCopies: 3,
        availableCopies: 3,
      });
      expect(response.body.id).toEqual(expect.any(Number));
      expect(response.body.createdAt).toBe(harness.now().toISOString());
    });

    it('stores the ISBN without hyphens', async () => {
      const response = await request(harness.app)
        .post('/api/books')
        .set('x-api-key', LIBRARIAN_KEY)
        .send({ ...VALID_BOOK, isbn: '978-0-13-235088-4' });

      expect(response.status).toBe(201);
      expect(response.body.isbn).toBe('9780132350884');
    });

    it('rejects a duplicate ISBN', async () => {
      await request(harness.app).post('/api/books').set('x-api-key', LIBRARIAN_KEY).send(VALID_BOOK);
      const response = await request(harness.app).post('/api/books').set('x-api-key', LIBRARIAN_KEY).send(VALID_BOOK);

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('ISBN_ALREADY_EXISTS');
    });

    it('treats a hyphenated duplicate as the same ISBN', async () => {
      await request(harness.app).post('/api/books').set('x-api-key', LIBRARIAN_KEY).send(VALID_BOOK);
      const response = await request(harness.app)
        .post('/api/books')
        .set('x-api-key', LIBRARIAN_KEY)
        .send({ ...VALID_BOOK, isbn: '978-0-13-235088-4' });

      expect(response.status).toBe(409);
    });

    it('returns every field error at once', async () => {
      const response = await request(harness.app).post('/api/books').set('x-api-key', LIBRARIAN_KEY).send({});

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.details).toHaveLength(5);
    });

    it('rejects a publication year in the future, using the injected clock', async () => {
      harness.setNow('2010-01-01T00:00:00.000Z');
      const response = await request(harness.app)
        .post('/api/books')
        .set('x-api-key', LIBRARIAN_KEY)
        .send({ ...VALID_BOOK, publishedYear: 2020 });

      expect(response.status).toBe(400);
      expect(response.body.error.details[0].field).toBe('publishedYear');
    });
  });

  describe('GET /api/books', () => {
    beforeEach(() => {
      makeBook(harness, { title: 'Refactoring', author: 'Martin Fowler', totalCopies: 2 });
      makeBook(harness, { title: 'Domain-Driven Design', author: 'Eric Evans', totalCopies: 1 });
      makeBook(harness, { title: 'Patterns of Enterprise Application Architecture', author: 'Martin Fowler', totalCopies: 1 });
    });

    it('lists every book with pagination metadata', async () => {
      const response = await request(harness.app).get('/api/books').set('x-api-key', ADMIN_KEY);

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(3);
      expect(response.body.meta).toMatchObject({ page: 1, total: 3, totalPages: 1, hasNext: false });
    });

    it('paginates', async () => {
      const response = await request(harness.app).get('/api/books?page=1&limit=2').set('x-api-key', ADMIN_KEY);

      expect(response.body.data).toHaveLength(2);
      expect(response.body.meta).toMatchObject({ totalPages: 2, hasNext: true, hasPrevious: false });
    });

    it('returns an empty page past the end rather than an error', async () => {
      const response = await request(harness.app).get('/api/books?page=99').set('x-api-key', ADMIN_KEY);

      expect(response.status).toBe(200);
      expect(response.body.data).toEqual([]);
    });

    it('searches across title, author and isbn', async () => {
      const byTitle = await request(harness.app).get('/api/books?search=Refactoring').set('x-api-key', ADMIN_KEY);
      expect(byTitle.body.data).toHaveLength(1);

      const byAuthor = await request(harness.app).get('/api/books?search=Fowler').set('x-api-key', ADMIN_KEY);
      expect(byAuthor.body.data).toHaveLength(2);
    });

    it('filters by exact author', async () => {
      const response = await request(harness.app)
        .get('/api/books?author=Eric%20Evans')
        .set('x-api-key', ADMIN_KEY);

      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].title).toBe('Domain-Driven Design');
    });

    it('keeps the total consistent with the filter', async () => {
      const response = await request(harness.app)
        .get('/api/books?search=Fowler&limit=1')
        .set('x-api-key', ADMIN_KEY);

      expect(response.body.data).toHaveLength(1);
      expect(response.body.meta.total).toBe(2);
    });

    it('filters to available copies only', async () => {
      const member = makeMember(harness);
      const soleCopy = harness.container.repos.books.list({ search: 'Domain-Driven' }, { page: 1, limit: 1, offset: 0 })
        .rows[0];

      await request(harness.app)
        .post('/api/loans')
        .set('x-api-key', ADMIN_KEY)
        .send({ bookId: soleCopy?.id, memberId: member.id });

      const response = await request(harness.app).get('/api/books?available=true').set('x-api-key', ADMIN_KEY);
      expect(response.body.data.map((b: { title: string }) => b.title)).not.toContain('Domain-Driven Design');
    });
  });

  describe('GET /api/books/:id', () => {
    it('returns one book', async () => {
      const book = makeBook(harness, { title: 'Test Driven Development' });
      const response = await request(harness.app).get(`/api/books/${book.id}`).set('x-api-key', ADMIN_KEY);

      expect(response.status).toBe(200);
      expect(response.body.title).toBe('Test Driven Development');
    });

    it('404s for an unknown id', async () => {
      const response = await request(harness.app).get('/api/books/4242').set('x-api-key', ADMIN_KEY);
      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('PATCH /api/books/:id', () => {
    it('updates a single field and leaves the rest alone', async () => {
      const book = makeBook(harness, { title: 'Old Title', author: 'Author', totalCopies: 2 });
      const response = await request(harness.app)
        .patch(`/api/books/${book.id}`)
        .set('x-api-key', LIBRARIAN_KEY)
        .send({ title: 'New Title' });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ title: 'New Title', author: 'Author', totalCopies: 2 });
    });

    it('grows the collection and puts the new copies on the shelf', async () => {
      const book = makeBook(harness, { totalCopies: 1 });
      const response = await request(harness.app)
        .patch(`/api/books/${book.id}`)
        .set('x-api-key', LIBRARIAN_KEY)
        .send({ totalCopies: 5 });

      expect(response.body).toMatchObject({ totalCopies: 5, availableCopies: 5 });
    });

    it('refuses to shrink below the number of copies on loan', async () => {
      const book = makeBook(harness, { totalCopies: 3 });
      for (const member of [makeMember(harness), makeMember(harness)]) {
        await request(harness.app)
          .post('/api/loans')
          .set('x-api-key', ADMIN_KEY)
          .send({ bookId: book.id, memberId: member.id });
      }

      const response = await request(harness.app)
        .patch(`/api/books/${book.id}`)
        .set('x-api-key', LIBRARIAN_KEY)
        .send({ totalCopies: 1 });

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('COPIES_ON_LOAN');
    });

    it('rejects a non-positive totalCopies as a validation error', async () => {
      const book = makeBook(harness, { totalCopies: 2 });
      const response = await request(harness.app)
        .patch(`/api/books/${book.id}`)
        .set('x-api-key', LIBRARIAN_KEY)
        .send({ totalCopies: 0 });

      expect(response.status).toBe(400);
      expect(response.body.error.details[0].field).toBe('totalCopies');
    });

    it('rejects an empty patch body', async () => {
      const book = makeBook(harness);
      const response = await request(harness.app)
        .patch(`/api/books/${book.id}`)
        .set('x-api-key', LIBRARIAN_KEY)
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error.details[0].field).toBe('body');
    });

    it('404s before validating the body', async () => {
      const response = await request(harness.app)
        .patch('/api/books/9999')
        .set('x-api-key', LIBRARIAN_KEY)
        .send({});

      expect(response.status).toBe(404);
    });
  });

  describe('DELETE /api/books/:id', () => {
    it('deletes a book that is fully on the shelf', async () => {
      const book = makeBook(harness, { isbn: nextIsbn13() });
      const response = await request(harness.app).delete(`/api/books/${book.id}`).set('x-api-key', ADMIN_KEY);

      expect(response.status).toBe(204);
      expect(harness.container.repos.books.findById(book.id)).toBeNull();
    });

    it('refuses while a copy is on loan', async () => {
      const book = makeBook(harness, { totalCopies: 1 });
      const member = makeMember(harness);
      await request(harness.app)
        .post('/api/loans')
        .set('x-api-key', ADMIN_KEY)
        .send({ bookId: book.id, memberId: member.id });

      const response = await request(harness.app).delete(`/api/books/${book.id}`).set('x-api-key', ADMIN_KEY);
      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('COPIES_ON_LOAN');
    });

    it('404s for an unknown id', async () => {
      const response = await request(harness.app).delete('/api/books/999').set('x-api-key', ADMIN_KEY);
      expect(response.status).toBe(404);
    });
  });
});
