/**
 * Integration tests open a real (in-memory) SQLite database per test file.
 * They are still fast, but give them a little more headroom than the default
 * so a slow CI runner does not produce flaky failures.
 */
jest.setTimeout(20_000);

export {};
