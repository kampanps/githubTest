import type { Role } from './domain/types';

export interface AppConfig {
  port: number;
  nodeEnv: string;
  databasePath: string;
  /** API key -> role. Intentionally simple: this project exists to exercise CI, not auth. */
  apiKeys: Record<string, Role>;
}

function readPort(raw: string | undefined, fallback: number): number {
  if (raw === undefined || !/^\d+$/.test(raw)) {
    return fallback;
  }
  const parsed = Number(raw);
  return parsed > 0 && parsed < 65_536 ? parsed : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const apiKeys: Record<string, Role> = {};

  const admin = env.API_KEY_ADMIN ?? 'admin-secret-key';
  const librarian = env.API_KEY_LIBRARIAN ?? 'librarian-secret-key';
  const member = env.API_KEY_MEMBER ?? 'member-secret-key';

  apiKeys[admin] = 'ADMIN';
  apiKeys[librarian] = 'LIBRARIAN';
  apiKeys[member] = 'MEMBER';

  return {
    port: readPort(env.PORT, 3000),
    nodeEnv: env.NODE_ENV ?? 'development',
    databasePath: env.DATABASE_PATH ?? './library.db',
    apiKeys,
  };
}
