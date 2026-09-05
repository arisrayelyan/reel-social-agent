import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config.js';

const scrape = vi.fn();
const batchScrape = vi.fn();
const search = vi.fn();
vi.mock('firecrawl', () => ({
  // must be constructible — the client does `new Firecrawl(...)`
  default: class {
    scrape = scrape;
    batchScrape = batchScrape;
    search = search;
  },
}));

const { extractLinkedUrls, extractSourceImages, FirecrawlClient, MAIN_CONTENT_OPTIONS, upgradeWikimediaThumb } =
  await import('../src/clients/firecrawl.js');

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
    search.mockReset();
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
      blockAds: true,
      removeBase64Images: true,
      excludeTags: ['nav', 'header', 'footer', 'aside', 'form', 'iframe', 'script', 'style'],
      timeout: 60_000,
    });
  });

  it('search returns web hits only, tolerating both SDK result shapes', async () => {
    search.mockResolvedValue({
      web: [
        { url: 'https://en.wikipedia.org/wiki/Banqiao_Dam', title: 'Banqiao Dam', description: 'A dam in Henan' },
        { metadata: { url: 'https://damfailures.org/x', title: 'Case study' }, markdown: '...' },
        { url: 'mailto:nope' },
      ],
      news: [{ url: 'https://news.example.com/a', title: 'ignored' }],
    });
    const hits = await new FirecrawlClient(testConfig()).search('Banqiao Dam 1975', 3);
    expect(search).toHaveBeenCalledWith('Banqiao Dam 1975', { limit: 3, sources: ['web'] });
    expect(hits).toEqual([
      { url: 'https://en.wikipedia.org/wiki/Banqiao_Dam', title: 'Banqiao Dam', description: 'A dam in Henan' },
      { url: 'https://damfailures.org/x', title: 'Case study', description: null },
    ]);
  });

  it('scrapeMany applies the same main-content filter as scrape', async () => {
    batchScrape.mockResolvedValue({ data: [] });
    await new FirecrawlClient(testConfig()).scrapeMany(['https://a.com']);
    expect(batchScrape).toHaveBeenCalledWith(['https://a.com'], {
      options: { formats: ['markdown'], ...MAIN_CONTENT_OPTIONS },
      ignoreInvalidURLs: true,
      timeout: 180,
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

describe('upgradeWikimediaThumb', () => {
  it('rewrites a thumb URL to the full-size original', () => {
    expect(
      upgradeWikimediaThumb(
        'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Lake_Nyos.jpg/220px-Lake_Nyos.jpg',
      ),
    ).toBe('https://upload.wikimedia.org/wikipedia/commons/a/ab/Lake_Nyos.jpg');
  });

  it('leaves non-thumb and non-wikimedia URLs alone', () => {
    expect(upgradeWikimediaThumb('https://upload.wikimedia.org/wikipedia/commons/a/ab/Lake_Nyos.jpg')).toBe(
      'https://upload.wikimedia.org/wikipedia/commons/a/ab/Lake_Nyos.jpg',
    );
    expect(upgradeWikimediaThumb('https://example.com/thumb/x/220px-y.jpg')).toBe(
      'https://example.com/thumb/x/220px-y.jpg',
    );
  });
});

describe('extractSourceImages', () => {
  const page = 'https://en.wikipedia.org/wiki/Lake_Nyos_disaster';

  it('keeps editorial photos in order, upgrades wikimedia thumbs, carries alt and caption', () => {
    const md = [
      '# Lake Nyos disaster',
      '![Lake Nyos after the eruption](https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Nyos.jpg/300px-Nyos.jpg)',
      'The lake as it appeared on 29 August 1986.',
      '',
      'Some paragraph text.',
      '![](/media/cattle.png) Dead cattle in the Nyos valley',
    ].join('\n');
    expect(extractSourceImages(md, page, 4)).toEqual([
      {
        url: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Nyos.jpg',
        alt: 'Lake Nyos after the eruption',
        context: 'The lake as it appeared on 29 August 1986.',
      },
      {
        url: 'https://en.wikipedia.org/media/cattle.png',
        alt: null,
        context: 'Dead cattle in the Nyos valley',
      },
    ]);
  });

  it('drops icons, flags, svg/gif, duplicates and non-http, and honours the cap', () => {
    const md = [
      '![](https://upload.wikimedia.org/wikipedia/commons/thumb/4/4a/Commons-logo.svg/30px-Commons-logo.svg.png)',
      '![Flag](https://upload.wikimedia.org/wikipedia/commons/thumb/1/1c/Flag_of_Cameroon.svg/23px-Flag_of_Cameroon.svg.png)',
      '![edit](https://en.wikipedia.org/static/images/edit-icon.png)',
      '![anim](https://a.com/anim.gif)',
      '![vector](https://a.com/map.svg)',
      '![one](https://a.com/one.jpg)',
      '![one again](https://a.com/one.jpg?w=800)',
      '![data](data:image/png;base64,AAAA)',
      '![two](https://a.com/two.jpg)',
      '![three](https://a.com/three.jpg)',
    ].join('\n');
    expect(extractSourceImages(md, page, 2).map((i) => i.url)).toEqual([
      'https://a.com/one.jpg',
      'https://a.com/two.jpg',
    ]);
  });

  it('returns nothing for a zero cap or markdown without images', () => {
    expect(extractSourceImages('![x](https://a.com/x.jpg)', page, 0)).toEqual([]);
    expect(extractSourceImages('no images here', page, 4)).toEqual([]);
  });
});
