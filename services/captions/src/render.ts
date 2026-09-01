import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import type { CaptionCue } from './cues';

const here = path.dirname(fileURLToPath(import.meta.url));
const ENTRY = path.join(here, 'remotion', 'index.ts');

let serveUrlPromise: Promise<string> | null = null;

/** Webpack-bundles the Remotion project once per process. */
function getServeUrl(): Promise<string> {
  serveUrlPromise ??= bundle({ entryPoint: ENTRY });
  return serveUrlPromise;
}

export interface RenderRequest {
  videoSrc: string;
  cues: CaptionCue[];
  durationSeconds: number;
  outPath: string;
  concurrency: number | null;
}

export async function renderCaptionedReel(req: RenderRequest): Promise<void> {
  const serveUrl = await getServeUrl();
  const inputProps = {
    videoSrc: req.videoSrc,
    cues: req.cues,
    durationSeconds: req.durationSeconds,
  };
  const composition = await selectComposition({
    serveUrl,
    id: 'CaptionedReel',
    inputProps,
  });
  await renderMedia({
    composition,
    serveUrl,
    codec: 'h264',
    outputLocation: req.outPath,
    inputProps,
    concurrency: req.concurrency,
  });
}
