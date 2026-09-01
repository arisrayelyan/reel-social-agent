import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import {
  serializerCompiler,
  validatorCompiler,
  hasZodFastifySchemaValidationErrors,
} from 'fastify-type-provider-zod';
import type { AppConfig } from './config.js';
import postgresPlugin from './plugins/postgres.js';
import redisPlugin from './plugins/redis.js';
import { queuePlugin } from './pipeline/queue.js';
import { registerRouter } from './router/index.js';

declare module 'fastify' {
  interface FastifyInstance {
    config: AppConfig;
  }
}

export async function buildApp(config: AppConfig): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.logLevel,
      ...(config.isDev ? { transport: { target: 'pino-pretty' } } : {}),
    },
  });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.decorate('config', config);

  await app.register(cors, { origin: config.corsOrigin });
  await app.register(postgresPlugin, { config });
  await app.register(redisPlugin, { config });
  await app.register(queuePlugin);

  app.setErrorHandler((error, request, reply) => {
    if (hasZodFastifySchemaValidationErrors(error)) {
      return reply.code(400).send({
        error: 'Validation failed',
        details: error.validation.map((v) => v.message),
      });
    }
    const err = error as Error & { statusCode?: number };
    request.log.error(err);
    const statusCode = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
    return reply.code(statusCode).send({ error: err.message });
  });

  await registerRouter(app);

  return app;
}
