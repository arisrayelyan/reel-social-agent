import type { FastifyInstance } from 'fastify';

export async function getSetting<T>(
  app: FastifyInstance,
  key: string,
): Promise<T | null> {
  const { rows } = await app.pg.query<{ value: T }>(
    `SELECT value FROM settings WHERE key = $1`,
    [key],
  );
  return rows[0]?.value ?? null;
}

export async function setSetting(
  app: FastifyInstance,
  key: string,
  value: unknown,
): Promise<void> {
  await app.pg.query(
    `INSERT INTO settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, JSON.stringify(value)],
  );
}

export async function getAllSettings(
  app: FastifyInstance,
): Promise<Record<string, unknown>> {
  const { rows } = await app.pg.query<{ key: string; value: unknown }>(
    `SELECT key, value FROM settings`,
  );
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}
