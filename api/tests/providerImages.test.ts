import path from 'node:path';
import os from 'node:os';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const execa = vi.fn();
vi.mock('execa', () => ({ execa }));

const { CodexProvider } = await import('../src/llm/codex.js');
const { ClaudeCodeProvider } = await import('../src/llm/claudeCode.js');
const { CursorAgentProvider } = await import('../src/llm/cursorAgent.js');
const { OllamaProvider } = await import('../src/llm/ollama.js');
const { UnsupportedImagesError } = await import('../src/llm/provider.js');

const schema = z.object({ ok: z.boolean() });
const base = { system: 'sys', prompt: 'user', schema };
let tmp: string;
let imageA: string;

beforeEach(async () => {
  execa.mockReset();
  tmp = await mkdtemp(path.join(os.tmpdir(), 'reel-provider-images-'));
  imageA = path.join(tmp, 'a.jpg');
  await writeFile(imageA, 'jpg');
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe('image attachments per CLI provider', () => {
  it('codex passes each image with -i before the prompt', async () => {
    execa.mockResolvedValue({
      stdout: '{"type":"item.completed","item":{"type":"agent_message","text":"{\\"ok\\":true}"}}',
    });
    await new CodexProvider('codex', 1, 1, 'm').generateJson({ ...base, images: [imageA, '/x/b.png'] });
    const args = execa.mock.calls[0]![1] as string[];
    expect(args).toEqual(expect.arrayContaining(['-i', imageA, '-i', '/x/b.png']));
    expect(args.indexOf('-i')).toBeLessThan(args.indexOf('sys\n\nuser'));
  });

  it('codex sends no -i flag without images (unchanged story path)', async () => {
    execa.mockResolvedValue({
      stdout: '{"type":"item.completed","item":{"type":"agent_message","text":"{\\"ok\\":true}"}}',
    });
    await new CodexProvider('codex', 1, 1, 'm').generateJson(base);
    expect(execa.mock.calls[0]![1]).not.toContain('-i');
  });

  it('claude lists the paths in the prompt and pre-approves the Read tool', async () => {
    execa.mockResolvedValue({ stdout: JSON.stringify({ type: 'result', subtype: 'success', result: '{"ok":true}' }) });
    await new ClaudeCodeProvider('claude').generateJson({ ...base, images: [imageA] });
    const args = execa.mock.calls[0]![1] as string[];
    expect(args).toEqual(expect.arrayContaining(['--allowedTools', 'Read']));
    expect(args[1]).toContain(`1. ${imageA}`);
  });

  it('claude leaves the argument list unchanged without images', async () => {
    execa.mockResolvedValue({ stdout: JSON.stringify({ type: 'result', subtype: 'success', result: '{"ok":true}' }) });
    await new ClaudeCodeProvider('claude').generateJson(base);
    expect(execa.mock.calls[0]![1]).toEqual(['-p', 'sys\n\nuser', '--output-format', 'json']);
  });

  it('cursor-agent copies images into its scratch workspace, references them relatively, and cleans up', async () => {
    const workDir = path.join(tmp, 'scratch');
    execa.mockImplementation(async (_cli: string, args: string[]) => {
      // while the CLI "runs", the copy must exist under the workspace
      const imagesRoot = path.join(workDir, 'images');
      const [runDir] = await readdir(imagesRoot);
      expect(await readdir(path.join(imagesRoot, runDir!))).toEqual(['img01.jpg']);
      expect(args[1]).toContain(`1. ./images/${runDir}/img01.jpg`);
      return { stdout: JSON.stringify({ type: 'result', result: '{"ok":true}', usage: { inputTokens: 1, outputTokens: 1 } }) };
    });
    await new CursorAgentProvider('agent', 'm', {}, workDir).generateJson({ ...base, images: [imageA] });
    expect(execa).toHaveBeenCalledTimes(1);
    expect(await readdir(path.join(workDir, 'images'))).toEqual([]);
  });

  it('ollama refuses images with UnsupportedImagesError before touching the network', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(
      new OllamaProvider('http://localhost:11434', 'm').generateJson({ ...base, images: [imageA] }),
    ).rejects.toBeInstanceOf(UnsupportedImagesError);
    expect(fetch).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
