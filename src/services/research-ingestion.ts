/**
 * Research Ingestion Service
 *
 * Orchestrates the full research ingestion pipeline:
 * 1. Scrape article from URL
 * 2. Deduplicate by URL hash
 * 3. Extract symbols and metadata
 * 4. Generate LLM summary (optional)
 * 5. Store in research notes database
 */

import {
  type IngestionRequest,
  type IngestionResult,
  type BatchIngestionRequest,
  type BatchIngestionResult,
  type StoredResearchNote,
  type ExtractedArticle,
  createResearchNoteFromArticle,
  validateIngestionRequest,
} from '../types/research.js';
import { WebScraper, createWebScraper, type WebScraperLogger } from './web-scraper.js';
import {
  ArticleSummarizer,
  createMockArticleSummarizer,
  type LLMProvider,
  type ArticleSummarizerLogger,
} from './article-summarizer.js';
import {
  ResearchStorageService,
  createResearchStorageService,
  type ResearchStorageOptions,
  type ResearchStorageLogger,
} from './research-storage.js';

/**
 * Logger interface for ingestion service
 */
export interface ResearchIngestionLogger {
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
  debug(message: string, data?: Record<string, unknown>): void;
}

/**
 * Default console logger
 */
const defaultLogger: ResearchIngestionLogger = {
  info: (message, data) =>
    console.log(`[INGESTION] ${message}`, data ? JSON.stringify(data) : ''),
  warn: (message, data) =>
    console.warn(`[INGESTION] ${message}`, data ? JSON.stringify(data) : ''),
  error: (message, data) =>
    console.error(`[INGESTION] ${message}`, data ? JSON.stringify(data) : ''),
  debug: (message, data) =>
    console.debug(`[INGESTION] ${message}`, data ? JSON.stringify(data) : ''),
};

/**
 * Configuration for the ingestion service
 */
export interface ResearchIngestionConfig {
  /** Default behavior for generating summaries */
  generateSummaryByDefault: boolean;
  /** Maximum concurrent requests for batch ingestion */
  defaultConcurrency: number;
  /** Maximum articles per batch */
  maxBatchSize: number;
}

/**
 * Default configuration
 */
const DEFAULT_INGESTION_CONFIG: ResearchIngestionConfig = {
  generateSummaryByDefault: true,
  defaultConcurrency: 3,
  maxBatchSize: 100,
};

/**
 * Options for creating the ingestion service
 */
export interface ResearchIngestionServiceOptions {
  /** Storage options (required) */
  storage: ResearchStorageOptions;
  /** Optional custom LLM provider for summarization */
  llmProvider?: LLMProvider;
  /** Ingestion configuration */
  config?: Partial<ResearchIngestionConfig>;
  /** Custom logger */
  logger?: ResearchIngestionLogger;
}

/**
 * ResearchIngestionService - Full pipeline orchestration
 */
export class ResearchIngestionService {
  private scraper: WebScraper;
  private summarizer: ArticleSummarizer;
  private storage: ResearchStorageService;
  private config: ResearchIngestionConfig;
  private logger: ResearchIngestionLogger;
  private initialized: boolean = false;

  constructor(options: ResearchIngestionServiceOptions) {
    this.config = { ...DEFAULT_INGESTION_CONFIG, ...options.config };
    this.logger = options.logger || defaultLogger;

    // Create components with unified logger interface
    const unifiedLogger = {
      info: this.logger.info.bind(this.logger),
      warn: this.logger.warn.bind(this.logger),
      error: this.logger.error.bind(this.logger),
      debug: this.logger.debug.bind(this.logger),
    };

    this.scraper = createWebScraper(undefined, unifiedLogger as WebScraperLogger);

    if (options.llmProvider) {
      this.summarizer = new ArticleSummarizer(
        options.llmProvider,
        undefined,
        unifiedLogger as ArticleSummarizerLogger
      );
    } else {
      // Use mock LLM for now
      this.summarizer = createMockArticleSummarizer(
        undefined,
        unifiedLogger as ArticleSummarizerLogger
      );
    }

    this.storage = createResearchStorageService(
      options.storage,
      unifiedLogger as ResearchStorageLogger
    );
  }

  /**
   * Initialize the service
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    await this.storage.initialize();
    this.initialized = true;
    this.logger.info('ResearchIngestionService initialized');
  }

  /**
   * Ingest a single URL
   */
  async ingest(request: IngestionRequest): Promise<IngestionResult> {
    this.ensureInitialized();

    const { url, symbols = [], tags = [], generateSummary, forceReIngest = false } = request;

    // Validate request
    const validation = validateIngestionRequest(request);
    if (!validation.valid) {
      return {
        success: false,
        isDuplicate: false,
        error: `Invalid request: ${validation.errors.join(', ')}`,
      };
    }

    // Log warnings
    for (const warning of validation.warnings) {
      this.logger.warn(warning, { url });
    }

    // Check for existing article (unless forceReIngest)
    if (!forceReIngest) {
      const existing = await this.storage.getByUrl(url);
      if (existing) {
        this.logger.info('Duplicate URL skipped', { url, existingId: existing.id });
        return {
          success: true,
          note: existing,
          isDuplicate: true,
        };
      }
    }

    // Scrape the URL
    this.logger.debug('Starting scrape', { url });
    const scrapeResult = await this.scraper.scrape(url);

    if (!scrapeResult.success || !scrapeResult.article) {
      this.logger.warn('Scrape failed', { url, error: scrapeResult.error });
      return {
        success: false,
        isDuplicate: false,
        error: scrapeResult.error || 'Unknown scrape error',
        scrapeResult,
      };
    }

    const article = scrapeResult.article;

    // Generate summary if requested
    const shouldSummarize = generateSummary ?? this.config.generateSummaryByDefault;
    let summarizationResult;

    if (shouldSummarize) {
      this.logger.debug('Starting summarization', { url, headline: article.headline });
      summarizationResult = await this.summarizer.summarize({
        article,
        symbols,
      });

      if (!summarizationResult.success) {
        this.logger.warn('Summarization failed', { url, error: summarizationResult.error });
        // Continue without summary - this is not a fatal error
      }
    }

    // Create research note
    const note = createResearchNoteFromArticle(article, {
      symbols,
      tags,
      summary: summarizationResult?.summary,
    });

    // Save to storage
    const saveResult = await this.storage.save(note);

    this.logger.info('Article ingested successfully', {
      url,
      id: saveResult.note.id,
      headline: note.headline,
      symbols: note.symbols,
      hasSummary: !!note.summary,
    });

    return {
      success: true,
      note: saveResult.note,
      isDuplicate: saveResult.isDuplicate,
      scrapeResult,
      summarizationResult,
    };
  }

  /**
   * Ingest multiple URLs in batch
   */
  async ingestBatch(request: BatchIngestionRequest): Promise<BatchIngestionResult> {
    this.ensureInitialized();

    const startTime = Date.now();
    const {
      urls,
      symbols = [],
      tags = [],
      generateSummaries = this.config.generateSummaryByDefault,
      concurrency = this.config.defaultConcurrency,
    } = request;

    // Limit batch size
    const limitedUrls = urls.slice(0, this.config.maxBatchSize);
    if (urls.length > this.config.maxBatchSize) {
      this.logger.warn('Batch size exceeded maximum', {
        requested: urls.length,
        max: this.config.maxBatchSize,
      });
    }

    this.logger.info('Starting batch ingestion', {
      urlCount: limitedUrls.length,
      concurrency,
      generateSummaries,
    });

    const results: IngestionResult[] = [];
    const queue = [...limitedUrls];

    const worker = async () => {
      while (queue.length > 0) {
        const url = queue.shift();
        if (url) {
          const result = await this.ingest({
            url,
            symbols,
            tags,
            generateSummary: generateSummaries,
          });
          results.push(result);
        }
      }
    };

    // Run workers in parallel
    const workers = Array(Math.min(concurrency, limitedUrls.length))
      .fill(null)
      .map(() => worker());

    await Promise.all(workers);

    // Calculate statistics
    const succeeded = results.filter((r) => r.success && !r.isDuplicate).length;
    const failed = results.filter((r) => !r.success).length;
    const duplicates = results.filter((r) => r.isDuplicate).length;

    this.logger.info('Batch ingestion complete', {
      totalProcessed: results.length,
      succeeded,
      failed,
      duplicates,
      durationMs: Date.now() - startTime,
    });

    return {
      totalProcessed: results.length,
      succeeded,
      failed,
      duplicates,
      results,
      totalDurationMs: Date.now() - startTime,
    };
  }

  /**
   * Re-ingest an article (update with fresh content)
   */
  async reIngest(url: string): Promise<IngestionResult> {
    const existing = await this.storage.getByUrl(url);
    if (!existing) {
      return {
        success: false,
        isDuplicate: false,
        error: 'Article not found for re-ingestion',
      };
    }

    // Delete existing and re-ingest
    await this.storage.delete(existing.id);

    return this.ingest({
      url,
      symbols: existing.symbols,
      tags: existing.tags,
      generateSummary: true,
      forceReIngest: true,
    });
  }

  /**
   * Add summary to an existing note
   */
  async addSummaryToNote(noteId: string): Promise<StoredResearchNote | null> {
    this.ensureInitialized();

    const note = await this.storage.getById(noteId);
    if (!note) {
      return null;
    }

    if (note.summary) {
      this.logger.info('Note already has summary', { noteId });
      return note;
    }

    // Create ExtractedArticle from stored note for summarization
    const article: ExtractedArticle = {
      headline: note.headline,
      publishedAt: note.publishedAt,
      bodyText: note.bodyText,
      authors: note.authors,
      url: note.url,
      sourceId: note.sourceId,
      sourceName: note.sourceName,
      sourceType: note.sourceType,
      wordCount: note.wordCount,
      extractedAt: note.ingestedAt,
    };

    const result = await this.summarizer.summarize({
      article,
      symbols: note.symbols,
    });

    if (!result.success || !result.summary) {
      this.logger.warn('Failed to add summary to note', { noteId, error: result.error });
      return null;
    }

    return this.storage.addSummary(noteId, result.summary);
  }

  // ===========================================================================
  // Storage Passthrough Methods
  // ===========================================================================

  /**
   * Get a note by ID
   */
  async getNote(id: string): Promise<StoredResearchNote | null> {
    this.ensureInitialized();
    return this.storage.getById(id);
  }

  /**
   * Get a note by URL
   */
  async getNoteByUrl(url: string): Promise<StoredResearchNote | null> {
    this.ensureInitialized();
    return this.storage.getByUrl(url);
  }

  /**
   * Check if URL exists
   */
  hasUrl(url: string): boolean {
    this.ensureInitialized();
    return this.storage.hasUrl(url);
  }

  /**
   * Query notes
   */
  async queryNotes(
    options: Parameters<typeof this.storage.query>[0]
  ): Promise<Awaited<ReturnType<typeof this.storage.query>>> {
    this.ensureInitialized();
    return this.storage.query(options);
  }

  /**
   * Get notes by symbol
   */
  async getNotesBySymbol(symbol: string, limit?: number): Promise<StoredResearchNote[]> {
    this.ensureInitialized();
    return this.storage.getBySymbol(symbol, limit);
  }

  /**
   * Get recent notes
   */
  async getRecentNotes(limit?: number): Promise<StoredResearchNote[]> {
    this.ensureInitialized();
    return this.storage.getRecent(limit);
  }

  /**
   * Search notes
   */
  async searchNotes(query: string, limit?: number): Promise<StoredResearchNote[]> {
    this.ensureInitialized();
    return this.storage.search(query, limit);
  }

  /**
   * Mark note as read
   */
  async markNoteRead(id: string): Promise<StoredResearchNote | null> {
    this.ensureInitialized();
    return this.storage.markRead(id);
  }

  /**
   * Toggle note flag
   */
  async toggleNoteFlag(id: string): Promise<StoredResearchNote | null> {
    this.ensureInitialized();
    return this.storage.toggleFlag(id);
  }

  /**
   * Add symbols to a note
   */
  async addSymbolsToNote(id: string, symbols: string[]): Promise<StoredResearchNote | null> {
    this.ensureInitialized();
    return this.storage.addSymbols(id, symbols);
  }

  /**
   * Add tags to a note
   */
  async addTagsToNote(id: string, tags: string[]): Promise<StoredResearchNote | null> {
    this.ensureInitialized();
    return this.storage.addTags(id, tags);
  }

  /**
   * Delete a note
   */
  async deleteNote(id: string): Promise<boolean> {
    this.ensureInitialized();
    return this.storage.delete(id);
  }

  /**
   * Get storage statistics
   */
  getStatistics(): ReturnType<typeof this.storage.getStatistics> {
    this.ensureInitialized();
    return this.storage.getStatistics();
  }

  /**
   * Get all symbols
   */
  getAllSymbols(): string[] {
    this.ensureInitialized();
    return this.storage.getAllSymbols();
  }

  /**
   * Get all tags
   */
  getAllTags(): string[] {
    this.ensureInitialized();
    return this.storage.getAllTags();
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('ResearchIngestionService not initialized. Call initialize() first.');
    }
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a research ingestion service
 */
export function createResearchIngestionService(
  options: ResearchIngestionServiceOptions
): ResearchIngestionService {
  return new ResearchIngestionService(options);
}
