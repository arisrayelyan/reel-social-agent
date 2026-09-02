import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config.js';

const scrape = vi.fn();
const batchScrape = vi.fn();
vi.mock('firecrawl', () => ({
  // must be constructible — the client does `new Firecrawl(...)`
  default: class {
    scrape = scrape;
    batchScrape = batchScrape;
  },
}));

const { extractLinkedUrls, FirecrawlClient } = await import('../src/clients/firecrawl.js');

function testConfig(overrides: Record<string, string> = {}) {
  return loadConfig({
    DATABASE_URL: 'postgresql://x/x',
    FIRECRAWL_API_KEY: 'fc-test',
    ...overrides,
  });
}

describe('FirecrawlClient', () => {
  beforeEach(() => {
    scrape.mockReset();
    batchScrape.mockReset();
  });

  it('throws without an API key', () => {
    expect(() => new FirecrawlClient(loadConfig({ DATABASE_URL: 'postgresql://x/x' }))).toThrow(
      'FIRECRAWL_API_KEY',
    );
  });

  it('scrape returns title, markdown and links', async () => {
    scrape.mockResolvedValue({
      markdown: '# Page body',
      links: ['https://a.com'],
      metadata: { title: ' Lake Nyos disaster ' },
    });
    const page = await new FirecrawlClient(testConfig()).scrape('https://example.com/nyos');
    expect(page).toEqual({
      url: 'https://example.com/nyos',
      title: 'Lake Nyos disaster',
      markdown: '# Page body',
      links: ['https://a.com'],
    });
    expect(scrape).toHaveBeenCalledWith('https://example.com/nyos', {
      formats: ['markdown', 'links'],
      onlyMainContent: true,
      timeout: 60_000,
    });
  });

  it('scrape throws when the page has no content', async () => {
    scrape.mockResolvedValue({ metadata: {} });
    await expect(new FirecrawlClient(testConfig()).scrape('https://example.com')).rejects.toThrow(
      'no content',
    );
  });

  it('scrapeMany drops failed pages and skips the API for an empty list', async () => {
    batchScrape.mockResolvedValue({
      data: [
        { markdown: 'ok', metadata: { url: 'https://a.com', title: 'A' } },
        { metadata: { url: 'https://b.com' } }, // no markdown → dropped
      ],
    });
    const client = new FirecrawlClient(testConfig());
    expect(await client.scrapeMany([])).toEqual([]);
    expect(batchScrape).not.toHaveBeenCalled();

    const pages = await client.scrapeMany(['https://a.com', 'https://b.com']);
    expect(pages).toHaveLength(1);
    expect(pages[0]).toMatchObject({ url: 'https://a.com', title: 'A', markdown: 'ok' });
  });
});

describe('extractLinkedUrls', () => {
  const source = 'https://example.com/article';

  it('collects inline markdown links, capped', () => {
    const md = [
      'See [one](https://a.com/1) and [two](https://b.com/2)',
      'and [three](https://c.com/3).',
    ].join('\n');
    expect(extractLinkedUrls(md, source, 2)).toEqual(['https://a.com/1', 'https://b.com/2']);
  });

  it('skips images, self-links, duplicates, anchors and non-http', () => {
    const md = [
      '![diagram](https://a.com/pic.png)',
      '[photo](https://a.com/photo.jpg)',
      '[self](https://example.com/article#section)',
      '[dup](https://b.com/x) [dup2](https://b.com/x/)',
      '[mail](mailto:x@y.com)',
      '[ok](https://c.com/page)',
    ].join('\n');
    expect(extractLinkedUrls(md, source, 10)).toEqual(['https://b.com/x', 'https://c.com/page']);
  });

  it('returns empty for markdown without links', () => {
    expect(extractLinkedUrls('plain text only', source, 5)).toEqual([]);
  });
});
