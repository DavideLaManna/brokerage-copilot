/**
 * Research Notes Types
 *
 * Defines types and schemas for research ingestion pipeline.
 * Supports web/news articles with deduplication, symbol tagging,
 * and LLM summarization.
 */

import { z } from 'zod';
import * as crypto from 'crypto';

// ============================================================================
// Source Types
// ============================================================================

/**
 * Allowed news source types
 */
export type ResearchSourceType =
  | 'news'           // General financial news
  | 'press_release'  // Company press releases
  | 'sec_filing'     // SEC filings (10-K, 10-Q, 8-K, etc.)
  | 'earnings'       // Earnings reports and transcripts
  | 'analyst'        // Analyst reports and ratings
  | 'blog'           // Financial blogs
  | 'social'         // Social media (X/Twitter, etc.)
  | 'other';         // Other sources

/**
 * News source configuration
 */
export interface NewsSource {
  /** Unique identifier for the source */
  id: string;
  /** Display name */
  name: string;
  /** Source type */
  type: ResearchSourceType;
  /** Base URL for the source */
  baseUrl: string;
  /** Whether this source is enabled */
  enabled: boolean;
  /** Trust score (0-1, higher = more reliable) */
  trustScore: number;
  /** Custom headers for requests */
  headers?: Record<string, string>;
  /** Rate limit (requests per minute) */
  rateLimitPerMinute?: number;
}

/**
 * Predefined allowed news sources
 */
export const ALLOWED_NEWS_SOURCES: NewsSource[] = [
  {
    id: 'reuters',
    name: 'Reuters',
    type: 'news',
    baseUrl: 'https://www.reuters.com',
    enabled: true,
    trustScore: 0.95,
    rateLimitPerMinute: 30,
  },
  {
    id: 'bloomberg',
    name: 'Bloomberg',
    type: 'news',
    baseUrl: 'https://www.bloomberg.com',
    enabled: true,
    trustScore: 0.95,
    rateLimitPerMinute: 30,
  },
  {
    id: 'sec_edgar',
    name: 'SEC EDGAR',
    type: 'sec_filing',
    baseUrl: 'https://www.sec.gov/cgi-bin/browse-edgar',
    enabled: true,
    trustScore: 1.0,
    rateLimitPerMinute: 10,
  },
  {
    id: 'business_wire',
    name: 'Business Wire',
    type: 'press_release',
    baseUrl: 'https://www.businesswire.com',
    enabled: true,
    trustScore: 0.9,
    rateLimitPerMinute: 20,
  },
  {
    id: 'pr_newswire',
    name: 'PR Newswire',
    type: 'press_release',
    baseUrl: 'https://www.prnewswire.com',
    enabled: true,
    trustScore: 0.9,
    rateLimitPerMinute: 20,
  },
  {
    id: 'seeking_alpha',
    name: 'Seeking Alpha',
    type: 'analyst',
    baseUrl: 'https://seekingalpha.com',
    enabled: true,
    trustScore: 0.7,
    rateLimitPerMinute: 20,
  },
  {
    id: 'yahoo_finance',
    name: 'Yahoo Finance',
    type: 'news',
    baseUrl: 'https://finance.yahoo.com',
    enabled: true,
    trustScore: 0.8,
    rateLimitPerMinute: 30,
  },
  {
    id: 'marketwatch',
    name: 'MarketWatch',
    type: 'news',
    baseUrl: 'https://www.marketwatch.com',
    enabled: true,
    trustScore: 0.8,
    rateLimitPerMinute: 30,
  },
];

// ============================================================================
// Research Note Types
// ============================================================================

/**
 * Extracted article content from web scraping
 */
export interface ExtractedArticle {
  /** Article headline/title */
  headline: string;
  /** Publication date (ISO 8601) */
  publishedAt: string;
  /** Full body text */
  bodyText: string;
  /** Author(s) if available */
  authors?: string[];
  /** Original URL */
  url: string;
  /** Source identifier */
  sourceId: string;
  /** Source name */
  sourceName: string;
  /** Source type */
  sourceType: ResearchSourceType;
  /** HTML content (for reference) */
  htmlContent?: string;
  /** Word count of body text */
  wordCount: number;
  /** Extraction timestamp */
  extractedAt: string;
}

/**
 * LLM-generated summary of an article
 */
export interface ArticleSummary {
  /** Short summary (1-3 sentences) */
  shortSummary: string;
  /** Bullet point key takeaways */
  keyTakeaways: string[];
  /** Identified sentiment (bullish/bearish/neutral) */
  sentiment?: 'bullish' | 'bearish' | 'neutral' | 'mixed';
  /** Confidence in sentiment analysis (0-1) */
  sentimentConfidence?: number;
  /** Key data points extracted */
  keyDataPoints?: KeyDataPoint[];
  /** Relevant time horizon (short/medium/long term) */
  timeHorizon?: 'short_term' | 'medium_term' | 'long_term';
  /** Token count used for summarization */
  tokensUsed: number;
  /** Model used for summarization */
  modelUsed: string;
  /** When the summary was generated */
  generatedAt: string;
}

/**
 * A key data point extracted from research
 */
export interface KeyDataPoint {
  /** Type of data point */
  type: 'earnings' | 'guidance' | 'rating' | 'price_target' | 'event' | 'metric' | 'other';
  /** Description */
  description: string;
  /** Value if applicable */
  value?: string | number;
  /** Date if applicable */
  date?: string;
}

/**
 * Research note - the core stored entity
 */
export interface ResearchNote {
  /** Unique ID (UUID) */
  id: string;
  /** URL hash for deduplication */
  urlHash: string;
  /** Source URL */
  url: string;
  /** Source identifier */
  sourceId: string;
  /** Source name */
  sourceName: string;
  /** Source type */
  sourceType: ResearchSourceType;
  /** Article headline */
  headline: string;
  /** Publication date */
  publishedAt: string;
  /** Full body text */
  bodyText: string;
  /** Authors */
  authors?: string[];
  /** Associated symbols (tickers) */
  symbols: string[];
  /** Tags for categorization */
  tags: string[];
  /** LLM-generated summary */
  summary?: ArticleSummary;
  /** Word count */
  wordCount: number;
  /** Trust score from source */
  trustScore: number;
  /** When this note was ingested */
  ingestedAt: string;
  /** When this note was last updated */
  updatedAt: string;
  /** User-added notes */
  userNotes?: string;
  /** Whether this note has been read/reviewed */
  isRead: boolean;
  /** Whether this note is flagged as important */
  isFlagged: boolean;
}

/**
 * Stored research note with storage metadata
 */
export interface StoredResearchNote extends ResearchNote {
  /** When created in storage */
  createdAt: string;
  /** Schema version */
  version: number;
}

// ============================================================================
// Scraper Types
// ============================================================================

/**
 * Configuration for the web scraper
 */
export interface ScraperConfig {
  /** Request timeout in milliseconds */
  timeoutMs: number;
  /** User agent string */
  userAgent: string;
  /** Whether to follow redirects */
  followRedirects: boolean;
  /** Maximum redirects to follow */
  maxRedirects: number;
  /** Retry attempts on failure */
  retryAttempts: number;
  /** Delay between retries in ms */
  retryDelayMs: number;
  /** Whether to respect robots.txt */
  respectRobotsTxt: boolean;
  /** Minimum delay between requests to same domain */
  requestDelayMs: number;
}

/**
 * Default scraper configuration
 */
export const DEFAULT_SCRAPER_CONFIG: ScraperConfig = {
  timeoutMs: 30000,
  userAgent: 'Mozilla/5.0 (compatible; OptionsTraderBot/1.0; +https://example.com/bot)',
  followRedirects: true,
  maxRedirects: 5,
  retryAttempts: 3,
  retryDelayMs: 1000,
  respectRobotsTxt: true,
  requestDelayMs: 1000,
};

/**
 * Result of a scrape operation
 */
export interface ScrapeResult {
  /** Whether scraping succeeded */
  success: boolean;
  /** Extracted article if successful */
  article?: ExtractedArticle;
  /** Error message if failed */
  error?: string;
  /** Error code if failed */
  errorCode?: 'timeout' | 'network' | 'parse' | 'blocked' | 'not_found' | 'rate_limit' | 'unknown';
  /** HTTP status code */
  statusCode?: number;
  /** Time taken in milliseconds */
  durationMs: number;
}

// ============================================================================
// Summarizer Types
// ============================================================================

/**
 * Configuration for article summarization
 */
export interface SummarizerConfig {
  /** Maximum tokens for input (truncate if longer) */
  maxInputTokens: number;
  /** Maximum tokens for output summary */
  maxOutputTokens: number;
  /** Temperature for LLM */
  temperature: number;
  /** Model to use */
  model: string;
  /** Whether to extract key data points */
  extractDataPoints: boolean;
  /** Whether to analyze sentiment */
  analyzeSentiment: boolean;
}

/**
 * Default summarizer configuration
 */
export const DEFAULT_SUMMARIZER_CONFIG: SummarizerConfig = {
  maxInputTokens: 4000,
  maxOutputTokens: 500,
  temperature: 0.3,
  model: 'claude-3-haiku',
  extractDataPoints: true,
  analyzeSentiment: true,
};

/**
 * Request for summarization
 */
export interface SummarizationRequest {
  /** Article to summarize */
  article: ExtractedArticle;
  /** Symbols this article relates to */
  symbols: string[];
  /** Optional custom prompt addition */
  customPrompt?: string;
  /** Configuration overrides */
  config?: Partial<SummarizerConfig>;
}

/**
 * Result of summarization
 */
export interface SummarizationResult {
  /** Whether summarization succeeded */
  success: boolean;
  /** Generated summary if successful */
  summary?: ArticleSummary;
  /** Error message if failed */
  error?: string;
  /** Time taken in milliseconds */
  durationMs: number;
}

// ============================================================================
// Query Types
// ============================================================================

/**
 * Options for querying research notes
 */
export interface ResearchQueryOptions {
  /** Filter by symbols */
  symbols?: string[];
  /** Filter by source types */
  sourceTypes?: ResearchSourceType[];
  /** Filter by source IDs */
  sourceIds?: string[];
  /** Filter by tags */
  tags?: string[];
  /** Full-text search query */
  searchQuery?: string;
  /** Filter by sentiment */
  sentiment?: ('bullish' | 'bearish' | 'neutral' | 'mixed')[];
  /** Filter articles after this date */
  publishedAfter?: string;
  /** Filter articles before this date */
  publishedBefore?: string;
  /** Only unread articles */
  unreadOnly?: boolean;
  /** Only flagged articles */
  flaggedOnly?: boolean;
  /** Only articles with summaries */
  hasSummary?: boolean;
  /** Maximum results to return */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
  /** Sort field */
  sortBy?: 'publishedAt' | 'ingestedAt' | 'trustScore' | 'wordCount';
  /** Sort order */
  sortOrder?: 'asc' | 'desc';
}

/**
 * Result of a research query
 */
export interface ResearchQueryResult {
  /** Matching research notes */
  notes: StoredResearchNote[];
  /** Total count matching filters */
  totalCount: number;
  /** Whether there are more results */
  hasMore: boolean;
}

// ============================================================================
// Ingestion Types
// ============================================================================

/**
 * Request to ingest a URL
 */
export interface IngestionRequest {
  /** URL to ingest */
  url: string;
  /** Symbols to associate with this article */
  symbols?: string[];
  /** Tags to add */
  tags?: string[];
  /** Whether to generate summary */
  generateSummary?: boolean;
  /** Force re-ingestion even if URL exists */
  forceReIngest?: boolean;
}

/**
 * Result of an ingestion operation
 */
export interface IngestionResult {
  /** Whether ingestion succeeded */
  success: boolean;
  /** Ingested note if successful */
  note?: StoredResearchNote;
  /** Whether this was a duplicate */
  isDuplicate: boolean;
  /** Error message if failed */
  error?: string;
  /** Scrape result details */
  scrapeResult?: ScrapeResult;
  /** Summarization result details */
  summarizationResult?: SummarizationResult;
}

/**
 * Batch ingestion request
 */
export interface BatchIngestionRequest {
  /** URLs to ingest */
  urls: string[];
  /** Symbols to associate with all articles */
  symbols?: string[];
  /** Tags to add to all articles */
  tags?: string[];
  /** Whether to generate summaries */
  generateSummaries?: boolean;
  /** Maximum concurrent requests */
  concurrency?: number;
}

/**
 * Batch ingestion result
 */
export interface BatchIngestionResult {
  /** Total URLs processed */
  totalProcessed: number;
  /** Successful ingestions */
  succeeded: number;
  /** Failed ingestions */
  failed: number;
  /** Duplicates skipped */
  duplicates: number;
  /** Individual results */
  results: IngestionResult[];
  /** Total time taken in milliseconds */
  totalDurationMs: number;
}

// ============================================================================
// Zod Schemas
// ============================================================================

/**
 * Schema for news source
 */
export const NewsSourceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(['news', 'press_release', 'sec_filing', 'earnings', 'analyst', 'blog', 'social', 'other']),
  baseUrl: z.string().url(),
  enabled: z.boolean(),
  trustScore: z.number().min(0).max(1),
  headers: z.record(z.string()).optional(),
  rateLimitPerMinute: z.number().positive().optional(),
});

/**
 * Schema for key data point
 */
export const KeyDataPointSchema = z.object({
  type: z.enum(['earnings', 'guidance', 'rating', 'price_target', 'event', 'metric', 'other']),
  description: z.string().min(1),
  value: z.union([z.string(), z.number()]).optional(),
  date: z.string().optional(),
});

/**
 * Schema for article summary
 */
export const ArticleSummarySchema = z.object({
  shortSummary: z.string().min(1),
  keyTakeaways: z.array(z.string()),
  sentiment: z.enum(['bullish', 'bearish', 'neutral', 'mixed']).optional(),
  sentimentConfidence: z.number().min(0).max(1).optional(),
  keyDataPoints: z.array(KeyDataPointSchema).optional(),
  timeHorizon: z.enum(['short_term', 'medium_term', 'long_term']).optional(),
  tokensUsed: z.number().int().min(0),
  modelUsed: z.string().min(1),
  generatedAt: z.string().datetime(),
});

/**
 * Schema for research note
 */
export const ResearchNoteSchema = z.object({
  id: z.string().uuid(),
  urlHash: z.string().min(1),
  url: z.string().url(),
  sourceId: z.string().min(1),
  sourceName: z.string().min(1),
  sourceType: z.enum(['news', 'press_release', 'sec_filing', 'earnings', 'analyst', 'blog', 'social', 'other']),
  headline: z.string().min(1),
  publishedAt: z.string().datetime(),
  bodyText: z.string(),
  authors: z.array(z.string()).optional(),
  symbols: z.array(z.string()),
  tags: z.array(z.string()),
  summary: ArticleSummarySchema.optional(),
  wordCount: z.number().int().min(0),
  trustScore: z.number().min(0).max(1),
  ingestedAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  userNotes: z.string().optional(),
  isRead: z.boolean(),
  isFlagged: z.boolean(),
});

/**
 * Schema for stored research note
 */
export const StoredResearchNoteSchema = ResearchNoteSchema.extend({
  createdAt: z.string().datetime(),
  version: z.number().int().positive(),
});

/**
 * Schema for ingestion request
 */
export const IngestionRequestSchema = z.object({
  url: z.string().url(),
  symbols: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  generateSummary: z.boolean().optional(),
  forceReIngest: z.boolean().optional(),
});

/**
 * Schema for research query options
 */
export const ResearchQueryOptionsSchema = z.object({
  symbols: z.array(z.string()).optional(),
  sourceTypes: z.array(z.enum(['news', 'press_release', 'sec_filing', 'earnings', 'analyst', 'blog', 'social', 'other'])).optional(),
  sourceIds: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  searchQuery: z.string().optional(),
  sentiment: z.array(z.enum(['bullish', 'bearish', 'neutral', 'mixed'])).optional(),
  publishedAfter: z.string().datetime().optional(),
  publishedBefore: z.string().datetime().optional(),
  unreadOnly: z.boolean().optional(),
  flaggedOnly: z.boolean().optional(),
  hasSummary: z.boolean().optional(),
  limit: z.number().int().positive().optional(),
  offset: z.number().int().min(0).optional(),
  sortBy: z.enum(['publishedAt', 'ingestedAt', 'trustScore', 'wordCount']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
});

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Generate a URL hash for deduplication
 */
export function generateUrlHash(url: string): string {
  // Normalize URL: lowercase, remove trailing slashes, remove query params that don't affect content
  const normalizedUrl = url
    .toLowerCase()
    .replace(/\/+$/, '')
    .replace(/\?utm_.*$/, '') // Remove UTM tracking params
    .replace(/\?ref=.*$/, '')
    .replace(/#.*$/, ''); // Remove anchors

  return crypto.createHash('sha256').update(normalizedUrl).digest('hex');
}

/**
 * Extract symbols from text
 * Looks for common ticker patterns like $AAPL or (NASDAQ: AAPL)
 */
export function extractSymbolsFromText(text: string): string[] {
  const symbols = new Set<string>();

  // Match $AAPL style
  const cashTagPattern = /\$([A-Z]{1,5})\b/g;
  let match;
  while ((match = cashTagPattern.exec(text)) !== null) {
    const symbol = match[1];
    if (symbol) {
      symbols.add(symbol);
    }
  }

  // Match (NASDAQ: AAPL) or (NYSE: IBM) style
  const exchangePattern = /\((?:NASDAQ|NYSE|AMEX|OTC|TSX):\s*([A-Z]{1,5})\)/gi;
  while ((match = exchangePattern.exec(text)) !== null) {
    const symbol = match[1];
    if (symbol) {
      symbols.add(symbol.toUpperCase());
    }
  }

  // Match common company name patterns
  // This is a simple heuristic - in production you'd use a more sophisticated NER
  const companyPattern = /\b([A-Z]{2,5})\s+(?:Inc\.|Corp\.|Corporation|Company|Ltd\.?)\b/g;
  while ((match = companyPattern.exec(text)) !== null) {
    const symbol = match[1];
    // Only add if it looks like a ticker (all caps, 2-5 chars)
    if (symbol && symbol.length >= 2 && symbol.length <= 5) {
      symbols.add(symbol);
    }
  }

  return Array.from(symbols);
}

/**
 * Identify source from URL
 */
export function identifySourceFromUrl(url: string): NewsSource | undefined {
  const urlLower = url.toLowerCase();
  return ALLOWED_NEWS_SOURCES.find((source) =>
    urlLower.includes(new URL(source.baseUrl).hostname)
  );
}

/**
 * Check if a URL is from an allowed source
 */
export function isAllowedSource(url: string): boolean {
  return identifySourceFromUrl(url) !== undefined;
}

/**
 * Get source by ID
 */
export function getSourceById(sourceId: string): NewsSource | undefined {
  return ALLOWED_NEWS_SOURCES.find((s) => s.id === sourceId);
}

/**
 * Count words in text
 */
export function countWords(text: string): number {
  return text.split(/\s+/).filter((word) => word.length > 0).length;
}

/**
 * Truncate text to max words (for token-efficient summarization)
 */
export function truncateToMaxWords(text: string, maxWords: number): string {
  const words = text.split(/\s+/);
  if (words.length <= maxWords) {
    return text;
  }
  return words.slice(0, maxWords).join(' ') + '...';
}

/**
 * Format source type for display
 */
export function formatSourceType(sourceType: ResearchSourceType): string {
  const formats: Record<ResearchSourceType, string> = {
    news: 'News',
    press_release: 'Press Release',
    sec_filing: 'SEC Filing',
    earnings: 'Earnings',
    analyst: 'Analyst Report',
    blog: 'Blog',
    social: 'Social Media',
    other: 'Other',
  };
  return formats[sourceType] || sourceType;
}

/**
 * Format sentiment for display
 */
export function formatSentiment(sentiment: 'bullish' | 'bearish' | 'neutral' | 'mixed'): string {
  const formats = {
    bullish: 'Bullish',
    bearish: 'Bearish',
    neutral: 'Neutral',
    mixed: 'Mixed',
  };
  return formats[sentiment] || sentiment;
}

/**
 * Validate a research note
 */
export function validateResearchNote(note: unknown): {
  valid: boolean;
  errors: string[];
} {
  const result = ResearchNoteSchema.safeParse(note);
  if (!result.success) {
    return {
      valid: false,
      errors: result.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`),
    };
  }
  return { valid: true, errors: [] };
}

/**
 * Validate an ingestion request
 */
export function validateIngestionRequest(request: unknown): {
  valid: boolean;
  errors: string[];
  warnings: string[];
} {
  const result = IngestionRequestSchema.safeParse(request);
  const warnings: string[] = [];

  if (!result.success) {
    return {
      valid: false,
      errors: result.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`),
      warnings: [],
    };
  }

  // Check if URL is from allowed source
  if (!isAllowedSource(result.data.url)) {
    warnings.push(`URL is not from an allowed news source. Allowed sources: ${ALLOWED_NEWS_SOURCES.map(s => s.name).join(', ')}`);
  }

  return { valid: true, errors: [], warnings };
}

/**
 * Create a research note from extracted article
 */
export function createResearchNoteFromArticle(
  article: ExtractedArticle,
  options: {
    symbols?: string[];
    tags?: string[];
    summary?: ArticleSummary;
  } = {}
): ResearchNote {
  const now = new Date().toISOString();
  const source = getSourceById(article.sourceId);

  // Auto-extract symbols from headline and body
  const extractedSymbols = extractSymbolsFromText(article.headline + ' ' + article.bodyText);
  const allSymbols = Array.from(new Set([...(options.symbols || []), ...extractedSymbols]));

  return {
    id: crypto.randomUUID(),
    urlHash: generateUrlHash(article.url),
    url: article.url,
    sourceId: article.sourceId,
    sourceName: article.sourceName,
    sourceType: article.sourceType,
    headline: article.headline,
    publishedAt: article.publishedAt,
    bodyText: article.bodyText,
    authors: article.authors,
    symbols: allSymbols,
    tags: options.tags || [],
    summary: options.summary,
    wordCount: article.wordCount,
    trustScore: source?.trustScore || 0.5,
    ingestedAt: now,
    updatedAt: now,
    isRead: false,
    isFlagged: false,
  };
}

/**
 * Current schema version
 */
export const RESEARCH_SCHEMA_VERSION = 1;
