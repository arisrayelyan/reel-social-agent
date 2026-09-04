import Firecrawl from 'firecrawl';
import type { AppConfig } from '../config.js';

export interface ScrapedPage {
  url: string;
  title: string;
  markdown: string;
  links: string[];
}

/** A photograph referenced from the page's main-content markdown. */
export interface SourceImageCandidate {
  url: string;
  alt: string | null;
  /** Nearest caption / surrounding text (~120 chars). */
  context: string | null;
}

/**
 * Main content, nothing else. `onlyMainContent` drops nav/footer boilerplate;
 * the structural tags are excluded on top because some sites mark sidebars
 * and comment forms as part of the article body. Shared by both scrape paths
 * so the filter cannot drift between the main page and linked pages.
 */
export const MAIN_CONTENT_OPTIONS = {
  onlyMainContent: true,
  blockAds: true,
  removeBase64Images: true,
  excludeTags: ['nav', 'header', 'footer', 'aside', 'form', 'iframe', 'script', 'style'],
  timeout: 60_000,
};

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
    // No `images` format on purpose: it returns every <img> on the page, nav
    // and logos included. The `![alt](url)` references left in main-content
    // markdown are the photos that belong to the article — see
    // extractSourceImages.
    const doc = await this.firecrawl.scrape(url, {
      formats: ['markdown', 'links'],
      ...MAIN_CONTENT_OPTIONS,
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
      options: { formats: ['markdown'], ...MAIN_CONTENT_OPTIONS },
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

/** Not a photograph of the event: UI furniture, flags, badges, tracking pixels. */
const NON_PHOTO_URL = /(logo|icon|sprite|badge|emoji|avatar|favicon|1x1|pixel|spacer|button|flag_of|\bflags?\b|commons-logo|wikimedia-button|poweredby|edit-icon|magnify-clip|question_book|ambox|padlock|crystal_clear|nuvola|symbol_)/i;

/**
 * Wikimedia thumbs — `/thumb/a/ab/File.jpg/220px-File.jpg` — point at the
 * full-size original one directory up: `/a/ab/File.jpg`. Free full-res.
 */
export function upgradeWikimediaThumb(url: string): string {
  const m = url.match(/^(https?:\/\/upload\.wikimedia\.org\/wikipedia\/[^/]+)\/thumb\/(.+?)\/[^/]*?\d+px-[^/]+$/i);
  return m ? `${m[1]}/${m[2]}` : url;
}

/**
 * Photographs the article itself shows — `![alt](url)` references in the
 * main-content markdown (onlyMainContent has already stripped the chrome, so
 * whatever survives is editorial). Deliberately NOT og:image or Firecrawl's
 * `images` format: decided 4 Sep 2026, those return page furniture.
 * Pure and ordered so the result is reproducible for a given markdown.
 */
export function extractSourceImages(
  markdown: string,
  pageUrl: string,
  max: number,
): SourceImageCandidate[] {
  if (max <= 0) return [];
  const seen = new Set<string>();
  const out: SourceImageCandidate[] = [];
  const lines = markdown.split('\n');
  for (const [lineNo, line] of lines.entries()) {
    for (const match of line.matchAll(/!\[([^\]]*)\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)) {
      if (out.length >= max) return out;
      let url: string;
      try {
        url = new URL(match[2]!, pageUrl).toString();
      } catch {
        continue;
      }
      if (!/^https?:/i.test(url)) continue;
      if (/\.(svg|gif|ico|bmp|tiff?)(\?|$)/i.test(url)) continue;
      url = upgradeWikimediaThumb(url);
      if (NON_PHOTO_URL.test(url)) continue;
      const key = url.replace(/[?#].*$/, '');
      if (seen.has(key)) continue;
      seen.add(key);
      const alt = match[1]?.trim() || null;
      out.push({ url, alt, context: nearestCaption(lines, lineNo, match[0]) });
    }
  }
  return out;
}

/** Text on the image's own line (minus the image) or the next non-empty line, trimmed to ~120 chars. */
function nearestCaption(lines: string[], lineNo: number, imageMarkdown: string): string | null {
  const own = lines[lineNo]!.replace(imageMarkdown, '').replace(/[![\]()*_`]/g, ' ').trim();
  let text = own;
  if (!text) {
    for (let i = lineNo + 1; i < Math.min(lines.length, lineNo + 3); i++) {
      const next = lines[i]!.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/[![\]()*_`#]/g, ' ').trim();
      if (next) {
        text = next;
        break;
      }
    }
  }
  text = text.replace(/\s+/g, ' ');
  return text ? text.slice(0, 120) : null;
}
