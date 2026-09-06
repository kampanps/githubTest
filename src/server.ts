import { loadConfig } from './config';
import { createContainer } from './container';
import { closeDatabase, createDatabase } from './db/connection';
import { runMigrations } from './db/migrate';
import { createApp } from './http/app';

function main(): void {
  const config = loadConfig();
  const db = createDatabase(config.databasePath);
  runMigrations(db);

  const container = createContainer({ db, config });
  const app = createApp(container);

  const server = app.listen(config.port, () => {
    console.log(`library-lending-api listening on :${config.port} (${config.nodeEnv})`);
  });

  const shutdown = (signal: string): void => {
    console.log(`${signal} received, shutting down`);
    server.close(() => {
      closeDatabase(db);
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main();
