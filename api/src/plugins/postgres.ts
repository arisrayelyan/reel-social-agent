import fp from 'fastify-plugin';
import fastifyPostgres from '@fastify/postgres';
import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../config.js';

/** Exposes `app.pg` (pool + query helpers) for the queries/ layer. */
export default fp(async (app: FastifyInstance, opts: { config: AppConfig }) => {
  await app.register(fastifyPostgres, { connectionString: opts.config.databaseUrl });
});
