import request from 'supertest';
import { ADMIN_KEY, createTestHarness, type TestHarness } from '../helpers/testApp';

describe('health and error plumbing', () => {
  let harness: TestHarness;

  beforeEach(() => {
    harness = createTestHarness();
  });

  afterEach(() => {
    harness.close();
  });

  describe('GET /health', () => {
    it('responds without an API key', async () => {
      const response = await request(harness.app).get('/health');
      expect(response.status).toBe(200);
      expect(response.body.status).toBe('ok');
    });

    it('reports the injected clock, not the wall clock', async () => {
      harness.setNow('2030-06-01T00:00:00.000Z');
      const response = await request(harness.app).get('/health');
      expect(response.body.timestamp).toBe('2030-06-01T00:00:00.000Z');
    });
  });

  describe('GET /ready', () => {
    it('reports the applied schema version', async () => {
      const response = await request(harness.app).get('/ready');
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ status: 'ready', schemaVersion: 1 });
    });

    it('reports 503 once the database is gone', async () => {
      harness.db.close();
      const response = await request(harness.app).get('/ready');
      expect(response.status).toBe(503);
      expect(response.body.status).toBe('unavailable');
    });
  });

  describe('request correlation', () => {
    it('generates an x-request-id when none is supplied', async () => {
      const response = await request(harness.app).get('/health');
      expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('echoes a caller-supplied x-request-id', async () => {
      const response = await request(harness.app).get('/health').set('x-request-id', 'trace-123');
      expect(response.headers['x-request-id']).toBe('trace-123');
    });

    it('ignores a blank x-request-id and generates one instead', async () => {
      const response = await request(harness.app).get('/health').set('x-request-id', '   ');
      expect(response.headers['x-request-id']).not.toBe('   ');
    });

    it('includes the request id in an error body', async () => {
      const response = await request(harness.app)
        .get('/api/books/999999')
        .set('x-api-key', ADMIN_KEY)
        .set('x-request-id', 'trace-err');

      expect(response.status).toBe(404);
      expect(response.body.error.requestId).toBe('trace-err');
    });
  });

  describe('unknown routes', () => {
    it('returns ROUTE_NOT_FOUND for an unmatched path', async () => {
      const response = await request(harness.app).get('/nope');
      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('ROUTE_NOT_FOUND');
    });

    it('checks the API key before deciding the route does not exist', async () => {
      const response = await request(harness.app).get('/api/nope');
      expect(response.status).toBe(401);
    });
  });

  describe('malformed input', () => {
    it('rejects a body that is not valid JSON', async () => {
      const response = await request(harness.app)
        .post('/api/books')
        .set('x-api-key', ADMIN_KEY)
        .set('Content-Type', 'application/json')
        .send('{"title": ');

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('MALFORMED_JSON');
    });

    it('rejects a non-integer id in the path with a 400, not a 404', async () => {
      const response = await request(harness.app).get('/api/books/abc').set('x-api-key', ADMIN_KEY);
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  it('does not advertise the server framework', async () => {
    const response = await request(harness.app).get('/health');
    expect(response.headers['x-powered-by']).toBeUndefined();
  });
});
