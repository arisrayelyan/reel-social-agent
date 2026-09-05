import path from 'node:path';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SourceImage } from '@reel-agent/shared';
import { UnsupportedImagesError } from '../src/llm/provider.js';
import type { LlmProvider } from '../src/llm/provider.js';

const probeImageSize = vi.fn();
vi.mock('../src/utils/ffmpeg.js', () => ({ probeImageSize }));

const { buildPhotoNotes, describeSourceImages, downloadSourceImages } = await import('../src/utils/sourceImages.js');

let storageDir: string;
const promptsDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../prompts');
const app = () =>
  ({
    config: { storageDir, promptsDir },
    log: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
  }) as never;

function imageResponse(bytes: Buffer, type = 'image/jpeg', status = 200) {
  return new Response(new Uint8Array(bytes), { status, headers: { 'content-type': type } });
}

const candidate = (url: string) => ({ url, alt: 'alt text', context: null });

beforeEach(async () => {
  storageDir = await mkdtemp(path.join(os.tmpdir(), 'reel-source-images-'));
  probeImageSize.mockReset();
  probeImageSize.mockResolvedValue({ width: 1200, height: 800 });
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await rm(storageDir, { recursive: true, force: true });
});

describe('downloadSourceImages', () => {
  it('writes accepted images under 00_sources and records size + hash', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(imageResponse(Buffer.from('jpegbytes'))));
    const images = await downloadSourceImages(app(), 7, 'https://page', [candidate('https://a.com/one.jpg')]);
    expect(images).toHaveLength(1);
    expect(images[0]).toMatchObject({
      url: 'https://a.com/one.jpg',
      page_url: 'https://page',
      file_path: path.join('videos', '7', '00_sources', 'src01.jpg'),
      alt: 'alt text',
      width: 1200,
      height: 800,
      description: null,
      analysis_model: null,
    });
    expect(images[0]!.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect((await readFile(path.join(storageDir, images[0]!.file_path))).toString()).toBe('jpegbytes');
  });

  it('drops non-image content types, HTTP errors, icon-sized files and network failures — never throws', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(imageResponse(Buffer.from('<html>'), 'text/html'))
      .mockResolvedValueOnce(imageResponse(Buffer.from('x'), 'image/jpeg', 404))
      .mockResolvedValueOnce(imageResponse(Buffer.from('tiny')))
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce(imageResponse(Buffer.from('good'), 'image/png'));
    vi.stubGlobal('fetch', fetch);
    probeImageSize.mockResolvedValueOnce({ width: 64, height: 64 }); // the 'tiny' one
    const images = await downloadSourceImages(app(), 1, 'https://page', [
      candidate('https://a.com/page.html'),
      candidate('https://a.com/missing.jpg'),
      candidate('https://a.com/icon.jpg'),
      candidate('https://a.com/flaky.jpg'),
      candidate('https://a.com/good.png'),
    ]);
    expect(images.map((i) => i.url)).toEqual(['https://a.com/good.png']);
    expect(images[0]!.file_path.endsWith('src05.png')).toBe(true);
  });

  it('skips the network for no candidates', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    expect(await downloadSourceImages(app(), 1, 'https://page', [])).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });
});

const image = (i: number, over: Partial<SourceImage> = {}): SourceImage => ({
  url: `https://a.com/${i}.jpg`,
  page_url: 'https://page',
  file_path: `videos/1/00_sources/src0${i}.jpg`,
  alt: i === 0 ? 'Lake Nyos in 1986' : null,
  context: null,
  width: 1000,
  height: 800,
  sha256: 'ab'.repeat(32),
  description: null,
  analysis_model: null,
  ...over,
});

function fakeProvider(reply: unknown): LlmProvider & { calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    name: 'codex',
    calls,
    async generateJson(opts) {
      calls.push(opts);
      return {
        data: opts.schema.parse(reply),
        inputTokens: 10,
        outputTokens: 5,
        costUsd: 0.01,
        raw: JSON.stringify(reply),
        model: 'test-vision',
      };
    },
  };
}

describe('describeSourceImages', () => {
  it('attaches every file, maps descriptions by index and blanks unusable images', async () => {
    const provider = fakeProvider({
      images: [
        { index: 0, usable: true, description: '  Red laterite shore, grey still water.  ' },
        { index: 1, usable: false, description: 'a logo' },
      ],
    });
    const { images, run } = await describeSourceImages(app(), provider, [image(0), image(1)]);
    expect(run?.model).toBe('test-vision');
    expect(images[0]).toMatchObject({ description: 'Red laterite shore, grey still water.', analysis_model: 'test-vision' });
    expect(images[1]).toMatchObject({ description: null, analysis_model: 'test-vision' });
    const call = provider.calls[0] as { images: string[]; prompt: string };
    expect(call.images).toEqual([
      path.join(storageDir, 'videos/1/00_sources/src00.jpg'),
      path.join(storageDir, 'videos/1/00_sources/src01.jpg'),
    ]);
    expect(call.prompt).toContain('2 photograph(s)');
    expect(call.prompt).toContain('1. Lake Nyos in 1986');
    expect(call.prompt).not.toMatch(/\{\{\w+\}\}/);
  });

  it('returns the images untouched with run=null when the provider cannot take images', async () => {
    const provider: LlmProvider = {
      name: 'ollama',
      async generateJson() {
        throw new UnsupportedImagesError('ollama');
      },
    };
    const { images, run } = await describeSourceImages(app(), provider, [image(0)]);
    expect(run).toBeNull();
    expect(images[0]!.description).toBeNull();
  });

  it('propagates other provider failures so the caller can log and continue', async () => {
    const provider: LlmProvider = {
      name: 'codex',
      async generateJson() {
        throw new Error('CLI exploded');
      },
    };
    await expect(describeSourceImages(app(), provider, [image(0)])).rejects.toThrow('CLI exploded');
  });

  it('does nothing for an empty list', async () => {
    const provider = fakeProvider({ images: [] });
    expect(await describeSourceImages(app(), provider, [])).toEqual({ images: [], run: null });
    expect(provider.calls).toHaveLength(0);
  });
});

describe('buildPhotoNotes', () => {
  it('lists only described images with their caption', () => {
    const notes = buildPhotoNotes([
      image(0, { description: 'Grey lake, red soil.' }),
      image(1),
      image(2, { description: 'Tin-roof huts.', context: 'Village of Nyos' }),
    ]);
    expect(notes).toContain('## PHOTO NOTES');
    expect(notes).toContain('1. Grey lake, red soil. (caption: Lake Nyos in 1986)');
    expect(notes).toContain('2. Tin-roof huts. (caption: Village of Nyos)');
    expect(notes).not.toContain('3.');
  });

  it('is empty when nothing was described', () => {
    expect(buildPhotoNotes([image(0), image(1)])).toBe('');
  });
});
