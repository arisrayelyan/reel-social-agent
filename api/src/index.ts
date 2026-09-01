import 'dotenv/config';
import { loadConfig } from './config.js';
import { buildApp } from './app.js';
import { startWorker } from './pipeline/worker.js';

const config = loadConfig();
const app = await buildApp(config);

// Pipeline worker runs in-process with the API (single deployment unit).
const worker = startWorker(app);

app.addHook('onClose', async () => {
  await worker.close();
});

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await app.listen({ port: config.port, host: '0.0.0.0' });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
