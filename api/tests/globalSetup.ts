import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runner as migrate } from 'node-pg-migrate';

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5439/reel-agent-test';

/** Applies all migrations to the dedicated test database before the suite. */
export default async function setup(): Promise<void> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  await migrate({
    databaseUrl: TEST_DATABASE_URL,
    dir: path.join(here, '..', 'src', 'database', 'migrations'),
    direction: 'up',
    migrationsTable: 'pgmigrations',
    log: () => undefined,
  });
}
