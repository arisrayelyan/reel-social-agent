import Firecrawl from 'firecrawl';
import type { AppConfig } from '../config.js';

export interface ScrapedPage {
  url: string;
  title: string;
  markdown: string;
  links: string[];
}

/**
 * Firecrawl web scraping (https://firecrawl.dev). Each scraped page costs one
 * credit (~$0.005 on the hobby plan) — callers cap linked-page fan-out via
 * config.firecrawlMaxLinkedPages.
 */
export class FirecrawlClient {
  private readonly firecrawl: Firecrawl;

  constructor(private readonly config: AppConfig) {
    if (!config.firecrawlApiKey) {
      throw new Error('FIRECRAWL_API_KEY is not set (api/.env) — get one at https://www.firecrawl.dev');
    }
    this.firecrawl = new Firecrawl({ apiKey: config.firecrawlApiKey });
  }

  async scrape(url: string): Promise<ScrapedPage> {
    const doc = await this.firecrawl.scrape(url, {
      formats: ['markdown', 'links'],
      onlyMainContent: true,
      timeout: 60_000,
    });
    if (!doc.markdown) throw new Error(`Firecrawl returned no content for ${url}`);
    return {
      url,
      title: doc.metadata?.title?.trim() || url,
      markdown: doc.markdown,
      links: doc.links ?? [],
    };
  }

  /** Batch-scrapes secondary pages; per-page failures are dropped, not fatal. */
  async scrapeMany(urls: string[]): Promise<ScrapedPage[]> {
    if (urls.length === 0) return [];
    const job = await this.firecrawl.batchScrape(urls, {
      options: { formats: ['markdown'], onlyMainContent: true, timeout: 60_000 },
      ignoreInvalidURLs: true,
      timeout: 180,
    });
    return job.data
      .filter((doc) => doc.markdown)
      .map((doc) => ({
        url: doc.metadata?.url ?? '',
        title: doc.metadata?.title?.trim() || doc.metadata?.url || '',
        markdown: doc.markdown!,
        links: [],
      }));
  }
}

/**
 * URLs actually mentioned in the article body — inline markdown links only
 * (nav/footer links never make it into onlyMainContent markdown as [text](url)
 * references we care about). Skips images, anchors, self-links and non-http.
 */
export function extractLinkedUrls(markdown: string, sourceUrl: string, max: number): string[] {
  const seen = new Set<string>();
  const normalize = (u: string) => u.replace(/[)#].*$/, '').replace(/\/$/, '');
  const self = normalize(sourceUrl);
  const out: string[] = [];
  // matches [text](url) but not images ![alt](url)
  for (const match of markdown.matchAll(/(?<!!)\[[^\]]+\]\((https?:\/\/[^\s)]+)\)/g)) {
    if (out.length >= max) break;
    const url = match[1]!;
    const key = normalize(url);
    if (!key || key === self || seen.has(key)) continue;
    if (/\.(png|jpe?g|gif|webp|svg|mp4|webm|pdf|zip)(\?|$)/i.test(url)) continue;
    seen.add(key);
    out.push(url);
  }
  return out;
}
