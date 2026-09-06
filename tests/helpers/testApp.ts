import type { Express } from 'express';
import { loadConfig, type AppConfig } from '../../src/config';
import { createContainer, type Container } from '../../src/container';
import { closeDatabase, createDatabase, IN_MEMORY } from '../../src/db/connection';
import { runMigrations } from '../../src/db/migrate';
import type { Db } from '../../src/db/connection';
import { createApp } from '../../src/http/app';

export const ADMIN_KEY = 'test-admin-key';
export const LIBRARIAN_KEY = 'test-librarian-key';
export const MEMBER_KEY = 'test-member-key';

/** Fixed "today" so due dates and fines are reproducible. */
export const DEFAULT_NOW = new Date('2025-01-15T09:00:00.000Z');

export interface TestHarness {
  app: Express;
  container: Container;
  db: Db;
  config: AppConfig;
  /** Move the injected clock. Every service reads through it, so time travel is total. */
  setNow(value: Date | string): void;
  advanceDays(days: number): void;
  now(): Date;
  close(): void;
}

export function createTestHarness(options: { now?: Date | string } = {}): TestHarness {
  const config = loadConfig({
    NODE_ENV: 'test',
    API_KEY_ADMIN: ADMIN_KEY,
    API_KEY_LIBRARIAN: LIBRARIAN_KEY,
    API_KEY_MEMBER: MEMBER_KEY,
    DATABASE_PATH: IN_MEMORY,
  } as NodeJS.ProcessEnv);

  const db = createDatabase(IN_MEMORY);
  runMigrations(db);

  let current = options.now ? new Date(options.now) : new Date(DEFAULT_NOW);

  const container = createContainer({ db, config, clock: () => new Date(current) });
  const app = createApp(container);

  return {
    app,
    container,
    db,
    config,
    now: () => new Date(current),
    setNow(value) {
      current = new Date(value);
    },
    advanceDays(days) {
      current = new Date(current.getTime() + days * 24 * 60 * 60 * 1000);
    },
    close() {
      closeDatabase(db);
    },
  };
}
