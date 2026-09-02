import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { z } from 'zod';
import { renderCaptionedReel } from './render';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 4043);
const STORAGE_DIR = path.resolve(here, '../', process.env.STORAGE_DIR ?? '../../storage');
const CONCURRENCY = process.env.REMOTION_CONCURRENCY
  ? Number(process.env.REMOTION_CONCURRENCY)
  : null;

const OverlayCueSchema = z.object({
  text: z.string().min(1).max(64),
  start: z.number().nonnegative(),
  end: z.number().nonnegative(),
});

const RenderBodySchema = z.object({
  video_path: z.string().min(1),
  cues: z.array(
    z.object({
      text: z.string(),
      start: z.number(),
      end: z.number(),
      words: z.array(z.object({ word: z.string(), start: z.number(), end: z.number() })),
    }),
  ),
  duration_seconds: z.number().positive(),
  out_path: z.string().min(1),
  // nullish throughout so a caller from before the overlay layer still validates
  overlay: z
    .object({
      hook: z.string().max(120).nullish(),
      stamps: z.array(OverlayCueSchema).default([]),
      exhibits: z.array(OverlayCueSchema).default([]),
      notice: OverlayCueSchema.nullish(),
    })
    .nullish(),
});

const app = Fastify({ logger: true });

// Remotion's headless browser streams the source video over HTTP from here.
await app.register(fastifyStatic, { root: STORAGE_DIR, prefix: '/files/' });

app.get('/health', async () => ({ ok: true }));

app.post('/render', async (request, reply) => {
  const parsed = RenderBodySchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: 'Invalid body', details: parsed.error.issues });
  }
  const { video_path, cues, duration_seconds, out_path, overlay } = parsed.data;

  const rel = path.relative(STORAGE_DIR, video_path);
  if (rel.startsWith('..')) {
    return reply.code(400).send({ error: `video_path must live under ${STORAGE_DIR}` });
  }
  const videoSrc = `http://localhost:${PORT}/files/${rel.split(path.sep).join('/')}`;

  app.log.info({ videoSrc, out_path }, 'starting caption render');
  await renderCaptionedReel({
    videoSrc,
    cues,
    durationSeconds: duration_seconds,
    outPath: out_path,
    overlay: {
      hook: overlay?.hook ?? null,
      stamps: overlay?.stamps ?? [],
      exhibits: overlay?.exhibits ?? [],
      notice: overlay?.notice ?? null,
    },
    concurrency: CONCURRENCY,
  });
  return { out_path };
});

try {
  await app.listen({ port: PORT, host: '0.0.0.0' });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
