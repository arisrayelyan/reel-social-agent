import { afterEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import { TelegramClient } from '../src/clients/telegram.js';
import { loadConfig } from '../src/config.js';

vi.mock('axios');

const baseEnv = {
  DATABASE_URL: 'postgresql://test',
  TELEGRAM_BOT_TOKEN: 'bot-token',
  TELEGRAM_CHAT_ID: '12345',
};

afterEach(() => vi.clearAllMocks());

describe('TelegramClient', () => {
  it('posts to the Bot API sendMessage endpoint with the configured chat id', async () => {
    const client = new TelegramClient(loadConfig(baseEnv));
    await client.send('hello');
    expect(axios.post).toHaveBeenCalledWith(
      'https://api.telegram.org/botbot-token/sendMessage',
      expect.objectContaining({ chat_id: '12345', text: 'hello' }),
    );
  });

  it('is a no-op when not configured (never blocks the pipeline)', async () => {
    const client = new TelegramClient(loadConfig({ DATABASE_URL: 'postgresql://test' }));
    await client.send('hello');
    expect(axios.post).not.toHaveBeenCalled();
    expect(client.configured).toBe(false);
  });

  it('escapes HTML in draft-ready notifications', async () => {
    const client = new TelegramClient(loadConfig(baseEnv));
    await client.notifyDraftReady({ topic: 'A <b>weird</b> & true story', costUsd: 1.234 });
    const [, body] = (axios.post as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect((body as { text: string }).text).toContain('A &lt;b&gt;weird&lt;/b&gt; &amp; true story');
    expect((body as { text: string }).text).toContain('$1.23');
  });
});
