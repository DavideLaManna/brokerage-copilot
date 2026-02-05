/**
 * Web Scraper Service
 *
 * Fetches and extracts content from news articles.
 * Supports configurable sources, rate limiting, and content extraction.
 */

import * as https from 'https';
import * as http from 'http';
import { URL } from 'url';
import {
  type ExtractedArticle,
  type ScrapeResult,
  type ScraperConfig,
  type NewsSource,
  DEFAULT_SCRAPER_CONFIG,
  identifySourceFromUrl,
  countWords,
  ALLOWED_NEWS_SOURCES,
} from '../types/research.js';

/**
 * Logger interface for scraper
 */
export interface WebScraperLogger {
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
  debug(message: string, data?: Record<string, unknown>): void;
}

/**
 * Default console logger
 */
const defaultLogger: WebScraperLogger = {
  info: (message, data) =>
    console.log(`[SCRAPER] ${message}`, data ? JSON.stringify(data) : ''),
  warn: (message, data) =>
    console.warn(`[SCRAPER] ${message}`, data ? JSON.stringify(data) : ''),
  error: (message, data) =>
    console.error(`[SCRAPER] ${message}`, data ? JSON.stringify(data) : ''),
  debug: (message, data) =>
    console.debug(`[SCRAPER] ${message}`, data ? JSON.stringify(data) : ''),
};

/**
 * Rate limiter for domain-specific throttling
 */
class RateLimiter {
  private lastRequestTime: Map<string, number> = new Map();
  private requestCounts: Map<string, number[]> = new Map();

  constructor(private defaultDelayMs: number = 1000) {}

  /**
   * Check if a request to a domain can proceed
   */
  async waitForSlot(domain: string, rateLimitPerMinute?: number): Promise<void> {
    const now = Date.now();
    const lastTime = this.lastRequestTime.get(domain) || 0;
    const minDelay = this.defaultDelayMs;

    // Basic delay between requests to same domain
    const timeSinceLastRequest = now - lastTime;
    if (timeSinceLastRequest < minDelay) {
      await this.sleep(minDelay - timeSinceLastRequest);
    }

    // Per-minute rate limiting if configured
    if (rateLimitPerMinute) {
      const counts = this.requestCounts.get(domain) || [];
      const oneMinuteAgo = now - 60000;

      // Remove old entries
      const recentCounts = counts.filter((t) => t > oneMinuteAgo);

      if (recentCounts.length >= rateLimitPerMinute) {
        // Wait until oldest request ages out
        const oldestRequest = recentCounts[0];
        if (oldestRequest !== undefined) {
          const waitTime = oldestRequest + 60000 - now;
          if (waitTime > 0) {
            await this.sleep(waitTime);
          }
        }
      }

      recentCounts.push(Date.now());
      this.requestCounts.set(domain, recentCounts);
    }

    this.lastRequestTime.set(domain, Date.now());
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * WebScraper - Fetches and extracts article content
 */
export class WebScraper {
  private config: ScraperConfig;
  private logger: WebScraperLogger;
  private rateLimiter: RateLimiter;
  private allowedSources: Map<string, NewsSource>;

  constructor(config: Partial<ScraperConfig> = {}, logger?: WebScraperLogger) {
    this.config = { ...DEFAULT_SCRAPER_CONFIG, ...config };
    this.logger = logger || defaultLogger;
    this.rateLimiter = new RateLimiter(this.config.requestDelayMs);
    this.allowedSources = new Map(ALLOWED_NEWS_SOURCES.map((s) => [s.id, s]));
  }

  /**
   * Scrape a URL and extract article content
   */
  async scrape(url: string): Promise<ScrapeResult> {
    const startTime = Date.now();

    try {
      // Validate URL
      const parsedUrl = new URL(url);

      // Identify source
      const source = identifySourceFromUrl(url);
      if (!source) {
        this.logger.warn('URL not from allowed source', { url });
        return {
          success: false,
          error: 'URL is not from an allowed news source',
          errorCode: 'blocked',
          durationMs: Date.now() - startTime,
        };
      }

      if (!source.enabled) {
        return {
          success: false,
          error: `Source ${source.name} is disabled`,
          errorCode: 'blocked',
          durationMs: Date.now() - startTime,
        };
      }

      // Rate limiting
      await this.rateLimiter.waitForSlot(
        parsedUrl.hostname,
        source.rateLimitPerMinute
      );

      // Fetch the page
      const { html, statusCode } = await this.fetchPage(url, source);

      if (statusCode !== 200) {
        this.logger.warn('Non-200 status code', { url, statusCode });
        return {
          success: false,
          error: `HTTP ${statusCode}`,
          errorCode: statusCode === 404 ? 'not_found' : statusCode === 429 ? 'rate_limit' : 'unknown',
          statusCode,
          durationMs: Date.now() - startTime,
        };
      }

      // Extract article content
      const article = this.extractArticle(html, url, source);

      if (!article) {
        return {
          success: false,
          error: 'Could not extract article content',
          errorCode: 'parse',
          statusCode,
          durationMs: Date.now() - startTime,
        };
      }

      this.logger.info('Successfully scraped article', {
        url,
        headline: article.headline,
        wordCount: article.wordCount,
      });

      return {
        success: true,
        article,
        statusCode,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const isTimeout = errorMessage.includes('timeout') || errorMessage.includes('ETIMEDOUT');
      const isNetwork = errorMessage.includes('ECONNREFUSED') || errorMessage.includes('ENOTFOUND');

      this.logger.error('Scrape failed', { url, error: errorMessage });

      return {
        success: false,
        error: errorMessage,
        errorCode: isTimeout ? 'timeout' : isNetwork ? 'network' : 'unknown',
        durationMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Scrape multiple URLs in parallel with concurrency limit
   */
  async scrapeMany(
    urls: string[],
    concurrency: number = 3
  ): Promise<Map<string, ScrapeResult>> {
    const results = new Map<string, ScrapeResult>();
    const queue = [...urls];

    const worker = async () => {
      while (queue.length > 0) {
        const url = queue.shift();
        if (url) {
          const result = await this.scrape(url);
          results.set(url, result);
        }
      }
    };

    // Run workers in parallel
    const workers = Array(Math.min(concurrency, urls.length))
      .fill(null)
      .map(() => worker());

    await Promise.all(workers);

    return results;
  }

  /**
   * Fetch a page with retry logic
   */
  private async fetchPage(
    url: string,
    source: NewsSource
  ): Promise<{ html: string; statusCode: number }> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < this.config.retryAttempts; attempt++) {
      try {
        const result = await this.fetchWithTimeout(url, source);
        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        this.logger.warn('Fetch attempt failed', {
          url,
          attempt: attempt + 1,
          error: lastError.message,
        });

        if (attempt < this.config.retryAttempts - 1) {
          await this.sleep(this.config.retryDelayMs * (attempt + 1));
        }
      }
    }

    throw lastError || new Error('Fetch failed after retries');
  }

  /**
   * Fetch a URL with timeout
   */
  private fetchWithTimeout(
    url: string,
    source: NewsSource
  ): Promise<{ html: string; statusCode: number }> {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url);
      const isHttps = parsedUrl.protocol === 'https:';
      const client = isHttps ? https : http;

      const headers: Record<string, string> = {
        'User-Agent': this.config.userAgent,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        ...(source.headers || {}),
      };

      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'GET',
        headers,
        timeout: this.config.timeoutMs,
      };

      let redirectCount = 0;

      const makeRequest = (requestUrl: URL): void => {
        const req = client.request(
          {
            ...options,
            hostname: requestUrl.hostname,
            path: requestUrl.pathname + requestUrl.search,
          },
          (res) => {
            // Handle redirects
            if (
              res.statusCode &&
              res.statusCode >= 300 &&
              res.statusCode < 400 &&
              res.headers.location
            ) {
              if (!this.config.followRedirects) {
                resolve({ html: '', statusCode: res.statusCode });
                return;
              }

              redirectCount++;
              if (redirectCount > this.config.maxRedirects) {
                reject(new Error('Too many redirects'));
                return;
              }

              const redirectUrl = new URL(res.headers.location, requestUrl);
              makeRequest(redirectUrl);
              return;
            }

            const chunks: Buffer[] = [];

            res.on('data', (chunk) => chunks.push(chunk));
            res.on('end', () => {
              const html = Buffer.concat(chunks).toString('utf-8');
              resolve({ html, statusCode: res.statusCode || 0 });
            });
            res.on('error', reject);
          }
        );

        req.on('timeout', () => {
          req.destroy();
          reject(new Error('Request timeout'));
        });

        req.on('error', reject);
        req.end();
      };

      makeRequest(parsedUrl);
    });
  }

  /**
   * Extract article content from HTML
   */
  private extractArticle(
    html: string,
    url: string,
    source: NewsSource
  ): ExtractedArticle | null {
    try {
      // Extract headline
      const headline = this.extractHeadline(html);
      if (!headline) {
        this.logger.warn('Could not extract headline', { url });
        return null;
      }

      // Extract body text
      const bodyText = this.extractBodyText(html);
      if (!bodyText || bodyText.length < 100) {
        this.logger.warn('Could not extract sufficient body text', {
          url,
          length: bodyText?.length || 0,
        });
        return null;
      }

      // Extract published date
      const publishedAt = this.extractPublishedDate(html) || new Date().toISOString();

      // Extract authors
      const authors = this.extractAuthors(html);

      const wordCount = countWords(bodyText);

      return {
        headline,
        publishedAt,
        bodyText,
        authors,
        url,
        sourceId: source.id,
        sourceName: source.name,
        sourceType: source.type,
        htmlContent: html,
        wordCount,
        extractedAt: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error('Error extracting article', {
        url,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Extract headline from HTML
   */
  private extractHeadline(html: string): string | null {
    // Try different patterns for headline extraction

    // 1. Try og:title meta tag
    const ogTitleMatch = html.match(
      /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i
    );
    if (ogTitleMatch?.[1]) {
      return this.decodeHtmlEntities(ogTitleMatch[1].trim());
    }

    // 2. Try twitter:title meta tag
    const twitterTitleMatch = html.match(
      /<meta[^>]+name=["']twitter:title["'][^>]+content=["']([^"']+)["']/i
    );
    if (twitterTitleMatch?.[1]) {
      return this.decodeHtmlEntities(twitterTitleMatch[1].trim());
    }

    // 3. Try <title> tag
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleMatch?.[1]) {
      // Clean up common suffixes like " | Reuters"
      let title = titleMatch[1].trim();
      title = title.replace(/\s*[|\-–—]\s*[^|\-–—]+$/, '').trim();
      return this.decodeHtmlEntities(title);
    }

    // 4. Try h1 tag
    const h1Match = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
    if (h1Match?.[1]) {
      return this.decodeHtmlEntities(h1Match[1].trim());
    }

    // 5. Try article headline class patterns
    const headlineMatch = html.match(
      /<[^>]+class=["'][^"']*(?:headline|title|heading)[^"']*["'][^>]*>([^<]+)</i
    );
    if (headlineMatch?.[1]) {
      return this.decodeHtmlEntities(headlineMatch[1].trim());
    }

    return null;
  }

  /**
   * Extract body text from HTML
   */
  private extractBodyText(html: string): string {
    // Remove scripts, styles, and other non-content elements
    let cleaned = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, '')
      .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
      .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
      .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
      .replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '');

    // Try to find article content
    let content = '';

    // 1. Try <article> tag
    const articleMatch = cleaned.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
    if (articleMatch?.[1]) {
      content = articleMatch[1];
    }

    // 2. Try content-specific classes
    if (!content) {
      const contentPatterns = [
        /<[^>]+class=["'][^"']*article[_-]?(?:body|content|text)[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|article|section)>/gi,
        /<[^>]+class=["'][^"']*(?:post|entry)[_-]?content[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|article|section)>/gi,
        /<[^>]+class=["'][^"']*story[_-]?body[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|article|section)>/gi,
      ];

      for (const pattern of contentPatterns) {
        const match = pattern.exec(cleaned);
        if (match?.[1] && match[1].length > content.length) {
          content = match[1];
        }
      }
    }

    // 3. Fall back to extracting all paragraphs
    if (!content || content.length < 200) {
      const paragraphs: string[] = [];
      const pPattern = /<p[^>]*>([\s\S]*?)<\/p>/gi;
      let match;
      while ((match = pPattern.exec(cleaned)) !== null) {
        if (match[1] && match[1].trim().length > 50) {
          paragraphs.push(match[1]);
        }
      }
      if (paragraphs.length > 0) {
        content = paragraphs.join('\n\n');
      }
    }

    // Strip remaining HTML tags and clean up
    const text = content
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    return this.decodeHtmlEntities(text);
  }

  /**
   * Extract published date from HTML
   */
  private extractPublishedDate(html: string): string | null {
    // Try different date patterns

    // 1. Try article:published_time meta tag
    const ogDateMatch = html.match(
      /<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["']/i
    );
    if (ogDateMatch?.[1]) {
      return this.normalizeDate(ogDateMatch[1]);
    }

    // 2. Try datePublished schema.org
    const schemaMatch = html.match(/"datePublished"\s*:\s*"([^"]+)"/i);
    if (schemaMatch?.[1]) {
      return this.normalizeDate(schemaMatch[1]);
    }

    // 3. Try date meta tag
    const dateMatch = html.match(
      /<meta[^>]+name=["'](?:date|publish_date|pub_date)["'][^>]+content=["']([^"']+)["']/i
    );
    if (dateMatch?.[1]) {
      return this.normalizeDate(dateMatch[1]);
    }

    // 4. Try time tag with datetime attribute
    const timeMatch = html.match(/<time[^>]+datetime=["']([^"']+)["']/i);
    if (timeMatch?.[1]) {
      return this.normalizeDate(timeMatch[1]);
    }

    return null;
  }

  /**
   * Extract author names from HTML
   */
  private extractAuthors(html: string): string[] {
    const authors: string[] = [];

    // 1. Try author meta tag
    const metaAuthorMatch = html.match(
      /<meta[^>]+name=["']author["'][^>]+content=["']([^"']+)["']/i
    );
    if (metaAuthorMatch?.[1]) {
      authors.push(this.decodeHtmlEntities(metaAuthorMatch[1].trim()));
    }

    // 2. Try article:author meta tag
    const ogAuthorMatch = html.match(
      /<meta[^>]+property=["']article:author["'][^>]+content=["']([^"']+)["']/i
    );
    if (ogAuthorMatch?.[1] && !authors.includes(ogAuthorMatch[1])) {
      authors.push(this.decodeHtmlEntities(ogAuthorMatch[1].trim()));
    }

    // 3. Try schema.org author
    const schemaMatch = html.match(/"author"\s*:\s*(?:\{[^}]*"name"\s*:\s*"([^"]+)"|"([^"]+)")/i);
    if (schemaMatch) {
      const author = schemaMatch[1] || schemaMatch[2];
      if (author && !authors.includes(author)) {
        authors.push(this.decodeHtmlEntities(author.trim()));
      }
    }

    // 4. Try byline patterns
    const bylineMatch = html.match(
      /<[^>]+class=["'][^"']*(?:byline|author)[^"']*["'][^>]*>([^<]+)</i
    );
    if (bylineMatch?.[1]) {
      let author = bylineMatch[1].trim();
      // Remove common prefixes
      author = author.replace(/^(?:By|Written by|Author:)\s*/i, '');
      if (author && !authors.includes(author)) {
        authors.push(this.decodeHtmlEntities(author));
      }
    }

    return authors;
  }

  /**
   * Normalize a date string to ISO 8601
   */
  private normalizeDate(dateStr: string): string {
    try {
      const date = new Date(dateStr);
      if (!isNaN(date.getTime())) {
        return date.toISOString();
      }
    } catch {
      // Fall through to return current date
    }
    return new Date().toISOString();
  }

  /**
   * Decode HTML entities
   */
  private decodeHtmlEntities(text: string): string {
    const entities: Record<string, string> = {
      '&amp;': '&',
      '&lt;': '<',
      '&gt;': '>',
      '&quot;': '"',
      '&#39;': "'",
      '&apos;': "'",
      '&nbsp;': ' ',
      '&ndash;': '–',
      '&mdash;': '—',
      '&lsquo;': "'",
      '&rsquo;': "'",
      '&ldquo;': '"',
      '&rdquo;': '"',
    };

    let decoded = text;
    for (const [entity, char] of Object.entries(entities)) {
      decoded = decoded.split(entity).join(char);
    }

    // Handle numeric entities
    decoded = decoded.replace(/&#(\d+);/g, (_, code) =>
      String.fromCharCode(parseInt(code, 10))
    );
    decoded = decoded.replace(/&#x([0-9a-f]+);/gi, (_, code) =>
      String.fromCharCode(parseInt(code, 16))
    );

    return decoded;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get current configuration
   */
  getConfig(): ScraperConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<ScraperConfig>): void {
    this.config = { ...this.config, ...config };
    this.rateLimiter = new RateLimiter(this.config.requestDelayMs);
  }
}

/**
 * Create a web scraper instance
 */
export function createWebScraper(
  config?: Partial<ScraperConfig>,
  logger?: WebScraperLogger
): WebScraper {
  return new WebScraper(config, logger);
}

/**
 * Scrape a single URL (convenience function)
 */
export async function scrapeUrl(
  url: string,
  config?: Partial<ScraperConfig>
): Promise<ScrapeResult> {
  const scraper = createWebScraper(config);
  return scraper.scrape(url);
}
