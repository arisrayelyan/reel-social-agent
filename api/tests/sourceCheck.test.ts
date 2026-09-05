import { describe, expect, it, vi } from 'vitest';
import { checkUrl } from '../src/utils/sourceCheck.js';

const response = (status: number) => new Response(null, { status });

describe('checkUrl', () => {
  it('is reachable on a 2xx HEAD', async () => {
    const fetch = vi.fn().mockResolvedValue(response(200));
    expect(await checkUrl('https://en.wikipedia.org/wiki/Lake_Nyos_disaster', fetch as never)).toBe('reachable');
    expect(fetch.mock.calls[0]![1]).toMatchObject({ method: 'HEAD' });
  });

  it('falls back to GET when the host refuses HEAD', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response(405)).mockResolvedValueOnce(response(200));
    expect(await checkUrl('https://example.com/a', fetch as never)).toBe('reachable');
    expect(fetch.mock.calls[1]![1]).toMatchObject({ method: 'GET' });
  });

  it('is unreachable on 404, network failure, or a non-http scheme — never throws', async () => {
    expect(await checkUrl('https://example.com/x', vi.fn().mockResolvedValue(response(404)) as never)).toBe('unreachable');
    expect(await checkUrl('https://example.com/x', vi.fn().mockRejectedValue(new Error('ENOTFOUND')) as never)).toBe('unreachable');
    const fetch = vi.fn();
    expect(await checkUrl('ftp://example.com/x', fetch as never)).toBe('unreachable');
    expect(fetch).not.toHaveBeenCalled();
  });
});
