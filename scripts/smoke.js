#!/usr/bin/env node
/**
 * Smoke test for the COMPILED build in dist/.
 *
 * Run it after `npm run build`, ideally against a production-only install
 * (`npm ci --omit=dev`), which is what the CI job does. It catches things the
 * test suite structurally cannot:
 *
 *   - a devDependency that leaked into src/
 *   - a native module (better-sqlite3) that did not install on this platform
 *   - a broken build output, or a file missing from the artifact
 *
 * Note that requiring dist/http/app.js alone proves very little: every import of
 * `Db` in the source is a type-only import, so TypeScript erases it and the
 * compiled app never pulls in the database driver. This script therefore boots
 * the real wiring - migrate, container, app, listen, request - end to end.
 */

const assert = require('node:assert');
const http = require('node:http');

function required(path) {
  try {
    return require(path);
  } catch (error) {
    console.error(`FAIL  could not load ${path}`);
    console.error(`      ${error.message}`);
    process.exit(1);
  }
}

const { loadConfig } = required('../dist/config.js');
const { createDatabase, closeDatabase, IN_MEMORY } = required('../dist/db/connection.js');
const { runMigrations, currentSchemaVersion } = required('../dist/db/migrate.js');
const { createContainer } = required('../dist/container.js');
const { createApp } = required('../dist/http/app.js');

function get(port, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const request = http.get({ host: '127.0.0.1', port, path, headers }, (response) => {
      let body = '';
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.on('end', () => resolve({ status: response.statusCode, body }));
    });
    request.on('error', reject);
  });
}

async function main() {
  const config = loadConfig({ NODE_ENV: 'test', DATABASE_PATH: IN_MEMORY });

  const db = createDatabase(IN_MEMORY);
  runMigrations(db);
  assert.strictEqual(currentSchemaVersion(db), 1, 'migrations did not reach version 1');

  const container = createContainer({ db, config });
  const app = createApp(container);

  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const { port } = server.address();

  try {
    const health = await get(port, '/health');
    assert.strictEqual(health.status, 200, `/health returned ${health.status}`);
    assert.strictEqual(JSON.parse(health.body).status, 'ok');

    const ready = await get(port, '/ready');
    assert.strictEqual(ready.status, 200, `/ready returned ${ready.status}`);
    assert.strictEqual(JSON.parse(ready.body).schemaVersion, 1);

    // The database driver is only reached through a route that queries it.
    const unauthorized = await get(port, '/api/books');
    assert.strictEqual(unauthorized.status, 401, 'an unauthenticated call should be rejected');

    const key = Object.keys(config.apiKeys)[0];
    const books = await get(port, '/api/books', { 'x-api-key': key });
    assert.strictEqual(books.status, 200, `/api/books returned ${books.status}`);
    assert.deepStrictEqual(JSON.parse(books.body).data, [], 'a fresh database should list no books');
  } finally {
    server.close();
    closeDatabase(db);
  }

  console.log('OK    compiled build boots, migrates and serves requests');
}

main().catch((error) => {
  console.error('FAIL  smoke test failed');
  console.error(error);
  process.exit(1);
});
