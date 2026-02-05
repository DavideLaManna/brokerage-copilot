/**
 * PDF Ingestion Service
 *
 * Orchestrates the complete PDF filing ingestion pipeline:
 * 1. Download PDF from URL
 * 2. Extract text content
 * 3. Chunk long documents into sections
 * 4. Summarize each section with LLM
 * 5. Extract structured facts
 * 6. Store in research notes database
 */

import * as crypto from 'crypto';
import type {
  PDFIngestionRequest,
  PDFIngestionResult,
  BatchPDFIngestionRequest,
  BatchPDFIngestionResult,
  FilingProcessingResult,
  FilingMetadata,
  ExtractedPDFContent,
  FilingSummary,
  StructuredFact,
  PDFExtractorConfig,
  ChunkerConfig,
  FilingSummarizerConfig,
} from '../types/pdf-filing';
import {
  validatePDFIngestionRequest,
  getFilingSourceType,
  getFilingImportance,
} from '../types/pdf-filing';
import type {
  ResearchNote,
  StoredResearchNote,
} from '../types/research';
import { RESEARCH_SCHEMA_VERSION, countWords, extractSymbolsFromText, generateUrlHash } from '../types/research';
import type { FactExtractorConfig } from './fact-extractor';

import { PDFExtractor, createPDFExtractor, createMockPDFExtractor } from './pdf-extractor';
import { DocumentChunker, createDocumentChunker } from './document-chunker';
import { FilingSummarizer, createFilingSummarizer } from './filing-summarizer';
import { FactExtractor, createFactExtractor } from './fact-extractor';
import type { LLMProvider } from './article-summarizer';

// ============================================================================
// Types
// ============================================================================

/**
 * Logger interface for dependency injection
 */
export interface PDFIngestionLogger {
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
  debug(message: string, data?: Record<string, unknown>): void;
}

/**
 * Storage interface for research notes
 */
export interface ResearchNoteStorage {
  /** Check if a URL has already been ingested */
  existsByUrlHash(urlHash: string): Promise<boolean>;
  /** Save a research note */
  save(note: ResearchNote): Promise<StoredResearchNote>;
  /** Get a research note by ID */
  get(id: string): Promise<StoredResearchNote | null>;
  /** Update a research note */
  update(id: string, updates: Partial<ResearchNote>): Promise<StoredResearchNote | null>;
}

/**
 * Mock storage for testing
 */
export class MockResearchNoteStorage implements ResearchNoteStorage {
  private notes = new Map<string, StoredResearchNote>();
  private urlHashes = new Set<string>();

  async existsByUrlHash(urlHash: string): Promise<boolean> {
    return this.urlHashes.has(urlHash);
  }

  async save(note: ResearchNote): Promise<StoredResearchNote> {
    const storedNote: StoredResearchNote = {
      ...note,
      createdAt: new Date().toISOString(),
      version: RESEARCH_SCHEMA_VERSION,
    };
    this.notes.set(note.id, storedNote);
    this.urlHashes.add(note.urlHash);
    return storedNote;
  }

  async get(id: string): Promise<StoredResearchNote | null> {
    return this.notes.get(id) || null;
  }

  async update(id: string, updates: Partial<ResearchNote>): Promise<StoredResearchNote | null> {
    const existing = this.notes.get(id);
    if (!existing) return null;

    const updated: StoredResearchNote = {
      ...existing,
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    this.notes.set(id, updated);
    return updated;
  }

  // Test helper
  getAllNotes(): StoredResearchNote[] {
    return Array.from(this.notes.values());
  }
}

/**
 * Configuration for PDF ingestion service
 */
export interface PDFIngestionConfig {
  /** PDF extractor config */
  pdfExtractor?: Partial<PDFExtractorConfig>;
  /** Document chunker config */
  chunker?: Partial<ChunkerConfig>;
  /** Filing summarizer config */
  summarizer?: Partial<FilingSummarizerConfig>;
  /** Fact extractor config */
  factExtractor?: Partial<FactExtractorConfig>;
  /** Default behavior for summaries */
  defaultGenerateSummaries: boolean;
  /** Default behavior for fact extraction */
  defaultExtractFacts: boolean;
  /** Maximum concurrent batch operations */
  maxConcurrency: number;
}

/**
 * Default ingestion configuration
 */
export const DEFAULT_PDF_INGESTION_CONFIG: PDFIngestionConfig = {
  defaultGenerateSummaries: true,
  defaultExtractFacts: true,
  maxConcurrency: 3,
};

// ============================================================================
// PDF Ingestion Service
// ============================================================================

/**
 * PDF filing ingestion service
 */
export class PDFIngestionService {
  private config: PDFIngestionConfig;
  private logger: PDFIngestionLogger;
  private storage: ResearchNoteStorage;
  private pdfExtractor: PDFExtractor;
  private chunker: DocumentChunker;
  private summarizer: FilingSummarizer;
  private factExtractor: FactExtractor;

  constructor(options?: {
    config?: Partial<PDFIngestionConfig>;
    logger?: PDFIngestionLogger;
    storage?: ResearchNoteStorage;
    llmProvider?: LLMProvider;
    /** Set to true to use mock extractor that doesn't make network calls */
    useMockExtractor?: boolean;
    /** Custom PDF extractor (overrides useMockExtractor) */
    pdfExtractor?: PDFExtractor;
  }) {
    this.config = { ...DEFAULT_PDF_INGESTION_CONFIG, ...options?.config };
    this.logger = options?.logger || this.createDefaultLogger();
    this.storage = options?.storage || new MockResearchNoteStorage();

    // Initialize sub-services
    // Use provided extractor, or mock if useMockExtractor is true, or real extractor
    if (options?.pdfExtractor) {
      this.pdfExtractor = options.pdfExtractor;
    } else if (options?.useMockExtractor) {
      this.pdfExtractor = createMockPDFExtractor({
        config: this.config.pdfExtractor,
        logger: this.createSubLogger('PDF-EXTRACTOR'),
      });
    } else {
      this.pdfExtractor = createPDFExtractor({
        config: this.config.pdfExtractor,
        logger: this.createSubLogger('PDF-EXTRACTOR'),
      });
    }

    this.chunker = createDocumentChunker({
      config: this.config.chunker,
      logger: this.createSubLogger('CHUNKER'),
    });

    this.summarizer = createFilingSummarizer({
      config: this.config.summarizer,
      logger: this.createSubLogger('SUMMARIZER'),
      llmProvider: options?.llmProvider,
    });

    this.factExtractor = createFactExtractor({
      config: this.config.factExtractor,
      logger: this.createSubLogger('FACT-EXTRACTOR'),
    });
  }

  private createDefaultLogger(): PDFIngestionLogger {
    const prefix = '[PDF-INGESTION]';
    return {
      info: (msg, data) => console.log(prefix, msg, data ? JSON.stringify(data) : ''),
      warn: (msg, data) => console.warn(prefix, msg, data ? JSON.stringify(data) : ''),
      error: (msg, data) => console.error(prefix, msg, data ? JSON.stringify(data) : ''),
      debug: (msg, data) => console.debug(prefix, msg, data ? JSON.stringify(data) : ''),
    };
  }

  private createSubLogger(prefix: string): PDFIngestionLogger {
    return {
      info: (msg, data) => this.logger.debug(`[${prefix}] ${msg}`, data),
      warn: (msg, data) => this.logger.warn(`[${prefix}] ${msg}`, data),
      error: (msg, data) => this.logger.error(`[${prefix}] ${msg}`, data),
      debug: (msg, data) => this.logger.debug(`[${prefix}] ${msg}`, data),
    };
  }

  /**
   * Ingest a PDF filing
   */
  async ingest(request: PDFIngestionRequest): Promise<PDFIngestionResult> {
    this.logger.info('Starting PDF ingestion', { url: request.pdfUrl });

    // Validate request
    const validation = validatePDFIngestionRequest(request);
    if (!validation.valid) {
      return {
        success: false,
        isDuplicate: false,
        error: `Validation failed: ${validation.errors.join(', ')}`,
      };
    }

    // Check for warnings
    if (validation.warnings.length > 0) {
      this.logger.warn('Ingestion warnings', { warnings: validation.warnings });
    }

    // Check for duplicate
    const urlHash = generateUrlHash(request.pdfUrl);
    if (!request.forceReProcess) {
      const exists = await this.storage.existsByUrlHash(urlHash);
      if (exists) {
        this.logger.info('Duplicate URL detected', { url: request.pdfUrl, urlHash });
        return {
          success: true,
          isDuplicate: true,
        };
      }
    }

    // Process the filing
    const processingResult = await this.processFilng(request);

    if (!processingResult.success) {
      return {
        success: false,
        isDuplicate: false,
        processingResult,
        error: processingResult.errors.join(', '),
      };
    }

    // Create and store research note
    const noteId = await this.createAndStoreNote(request, processingResult, urlHash);

    this.logger.info('PDF ingestion completed', {
      url: request.pdfUrl,
      noteId,
      durationMs: processingResult.totalDurationMs,
    });

    return {
      success: true,
      isDuplicate: false,
      processingResult,
      researchNoteId: noteId,
    };
  }

  /**
   * Process a filing (extract, chunk, summarize, extract facts)
   */
  private async processFilng(request: PDFIngestionRequest): Promise<FilingProcessingResult> {
    const startTime = Date.now();
    const errors: string[] = [];
    const warnings: string[] = [];
    const stepDurations: FilingProcessingResult['stepDurations'] = {};

    // Step 1: Download and extract PDF
    const downloadStart = Date.now();
    const extractionResult = await this.pdfExtractor.extractFromUrl(request.pdfUrl);
    stepDurations.download = Date.now() - downloadStart;
    stepDurations.extraction = extractionResult.durationMs;

    if (!extractionResult.success || !extractionResult.content) {
      errors.push(`PDF extraction failed: ${extractionResult.error}`);
      return {
        success: false,
        facts: [],
        errors,
        warnings,
        totalDurationMs: Date.now() - startTime,
        stepDurations,
      };
    }

    const content = extractionResult.content;

    // Step 2: Extract metadata
    const metadata = this.pdfExtractor.extractMetadata(
      request.pdfUrl,
      content,
      {
        ...request.metadataOverride,
        filingType: request.filingType,
        accessionNumber: request.accessionNumber,
        cik: request.cik,
        tickers: request.tickers,
      }
    );

    if (!metadata) {
      warnings.push('Could not extract complete filing metadata');
    }

    // Step 3: Chunk content
    const chunkingStart = Date.now();
    const chunkingResult = this.chunker.chunkContent(content, {
      prioritySections: ['mda', 'risk_factors', 'financials', 'business'],
      skipSections: request.sectionsToProcess?.length
        ? undefined
        : ['table_of_contents', 'signature', 'exhibits'],
    });
    stepDurations.chunking = Date.now() - chunkingStart;

    if (!chunkingResult.success) {
      warnings.push(`Chunking failed: ${chunkingResult.error}`);
    }

    // Step 4: Generate summaries (if requested)
    let summary: FilingSummary | undefined;
    const shouldSummarize = request.generateSummaries ?? this.config.defaultGenerateSummaries;

    if (shouldSummarize) {
      const summarizeStart = Date.now();
      summary = await this.summarizer.generateFilingSummary(content, {
        metadata: metadata || undefined,
        symbols: this.collectSymbols(request, metadata),
      });
      stepDurations.summarization = Date.now() - summarizeStart;
    }

    // Step 5: Extract structured facts (if requested)
    const facts: StructuredFact[] = [];
    const shouldExtractFacts = request.extractFacts ?? this.config.defaultExtractFacts;

    if (shouldExtractFacts) {
      const factStart = Date.now();
      const factResult = this.factExtractor.extractFromContent(content, {
        metadata: metadata || undefined,
        symbols: this.collectSymbols(request, metadata),
      });
      stepDurations.factExtraction = Date.now() - factStart;

      facts.push(...factResult.facts);
      warnings.push(...factResult.warnings);

      // Add facts to summary if we have one
      if (summary) {
        summary.structuredFacts = facts;
      }
    }

    return {
      success: true,
      metadata: metadata || undefined,
      extractedContent: content,
      summary,
      facts,
      errors,
      warnings,
      totalDurationMs: Date.now() - startTime,
      stepDurations,
    };
  }

  /**
   * Collect symbols from request and metadata
   */
  private collectSymbols(request: PDFIngestionRequest, metadata: FilingMetadata | null): string[] {
    const symbols = new Set<string>();

    if (request.tickers) {
      request.tickers.forEach(t => symbols.add(t));
    }

    if (request.symbols) {
      request.symbols.forEach(s => symbols.add(s));
    }

    if (metadata?.tickers) {
      metadata.tickers.forEach(t => symbols.add(t));
    }

    return Array.from(symbols);
  }

  /**
   * Create and store a research note from processing result
   */
  private async createAndStoreNote(
    request: PDFIngestionRequest,
    result: FilingProcessingResult,
    urlHash: string
  ): Promise<string> {
    const now = new Date().toISOString();
    const metadata = result.metadata;
    const content = result.extractedContent!;

    // Collect all symbols
    const allSymbols = this.collectSymbols(request, metadata || null);

    // Auto-extract symbols from content
    const extractedSymbols = extractSymbolsFromText(
      content.fullText.substring(0, 5000) // Only check first 5000 chars for performance
    );
    extractedSymbols.forEach(s => {
      if (!allSymbols.includes(s)) {
        allSymbols.push(s);
      }
    });

    // Build headline
    let headline = 'SEC Filing';
    if (metadata) {
      headline = `${metadata.companyName} ${metadata.filingType}`;
      if (metadata.periodOfReport) {
        headline += ` - ${metadata.periodOfReport}`;
      }
    }

    // Build body text (truncate if very long)
    let bodyText = content.fullText;
    if (bodyText.length > 100000) {
      bodyText = bodyText.substring(0, 100000) + '\n\n[Content truncated...]';
    }

    // Build tags
    const tags = [...(request.tags || [])];
    if (metadata?.filingType) {
      tags.push(metadata.filingType);
    }
    if (result.summary?.overallSentiment) {
      tags.push(result.summary.overallSentiment);
    }

    // Create note
    const note: ResearchNote = {
      id: crypto.randomUUID(),
      urlHash,
      url: request.pdfUrl,
      sourceId: 'sec_edgar',
      sourceName: 'SEC EDGAR',
      sourceType: getFilingSourceType(metadata?.filingType),
      headline,
      publishedAt: metadata?.filingDate || now,
      bodyText,
      authors: metadata?.filedBy ? [metadata.filedBy] : undefined,
      symbols: allSymbols,
      tags,
      summary: result.summary
        ? {
            shortSummary: result.summary.executiveSummary,
            keyTakeaways: result.summary.highlights,
            sentiment: this.mapSentiment(result.summary.overallSentiment),
            sentimentConfidence: 0.8,
            keyDataPoints: result.facts.slice(0, 10).map(f => ({
              type: this.mapFactTypeToKeyDataPointType(f.type),
              description: f.description,
              value: f.value,
              date: f.date,
            })),
            timeHorizon: 'medium_term',
            tokensUsed: result.summary.totalTokensUsed,
            modelUsed: 'filing-summarizer',
            generatedAt: result.summary.generatedAt,
          }
        : undefined,
      wordCount: content.totalWords,
      trustScore: metadata?.filingType ? getFilingImportance(metadata.filingType) : 0.9,
      ingestedAt: now,
      updatedAt: now,
      isRead: false,
      isFlagged: false,
    };

    // Store note
    const storedNote = await this.storage.save(note);
    return storedNote.id;
  }

  /**
   * Map filing sentiment to research note sentiment
   */
  private mapSentiment(
    sentiment?: 'positive' | 'negative' | 'neutral' | 'mixed'
  ): 'bullish' | 'bearish' | 'neutral' | 'mixed' | undefined {
    if (!sentiment) return undefined;
    const mapping: Record<string, 'bullish' | 'bearish' | 'neutral' | 'mixed'> = {
      positive: 'bullish',
      negative: 'bearish',
      neutral: 'neutral',
      mixed: 'mixed',
    };
    return mapping[sentiment];
  }

  /**
   * Map fact type to key data point type
   */
  private mapFactTypeToKeyDataPointType(
    factType: string
  ): 'earnings' | 'guidance' | 'rating' | 'price_target' | 'event' | 'metric' | 'other' {
    const mapping: Record<string, 'earnings' | 'guidance' | 'rating' | 'price_target' | 'event' | 'metric' | 'other'> = {
      earnings_date: 'event',
      earnings_eps: 'earnings',
      earnings_revenue: 'earnings',
      guidance: 'guidance',
      dividend: 'metric',
      buyback: 'metric',
      acquisition: 'event',
      divestiture: 'event',
      debt: 'metric',
      executive_change: 'event',
      legal_matter: 'event',
      regulatory: 'event',
      risk: 'other',
      other: 'other',
    };
    return mapping[factType] || 'other';
  }

  /**
   * Batch ingest multiple PDFs
   */
  async ingestBatch(request: BatchPDFIngestionRequest): Promise<BatchPDFIngestionResult> {
    const startTime = Date.now();
    const results: PDFIngestionResult[] = [];
    let succeeded = 0;
    let failed = 0;
    let duplicates = 0;

    this.logger.info('Starting batch PDF ingestion', {
      count: request.requests.length,
      concurrency: request.concurrency || this.config.maxConcurrency,
    });

    // Process in batches for concurrency control
    const concurrency = request.concurrency || this.config.maxConcurrency;
    const batches: PDFIngestionRequest[][] = [];

    for (let i = 0; i < request.requests.length; i += concurrency) {
      batches.push(request.requests.slice(i, i + concurrency));
    }

    for (const batch of batches) {
      const batchPromises = batch.map(req =>
        this.ingest({
          ...req,
          generateSummaries: req.generateSummaries ?? request.generateSummaries,
          extractFacts: req.extractFacts ?? request.extractFacts,
        })
      );

      const batchResults = await Promise.all(batchPromises);

      for (const result of batchResults) {
        results.push(result);

        if (result.isDuplicate) {
          duplicates++;
        } else if (result.success) {
          succeeded++;
        } else {
          failed++;
        }
      }
    }

    this.logger.info('Batch PDF ingestion completed', {
      total: results.length,
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
   * Re-process an existing note
   */
  async reProcess(noteId: string, options?: {
    generateSummaries?: boolean;
    extractFacts?: boolean;
  }): Promise<PDFIngestionResult> {
    const existingNote = await this.storage.get(noteId);

    if (!existingNote) {
      return {
        success: false,
        isDuplicate: false,
        error: `Note not found: ${noteId}`,
      };
    }

    return this.ingest({
      pdfUrl: existingNote.url,
      generateSummaries: options?.generateSummaries,
      extractFacts: options?.extractFacts,
      forceReProcess: true,
    });
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<PDFIngestionConfig>): void {
    this.config = { ...this.config, ...config };

    if (config.pdfExtractor) {
      this.pdfExtractor.updateConfig(config.pdfExtractor);
    }
    if (config.chunker) {
      this.chunker.updateConfig(config.chunker);
    }
    if (config.summarizer) {
      this.summarizer.updateConfig(config.summarizer);
    }
    if (config.factExtractor) {
      this.factExtractor.updateConfig(config.factExtractor);
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): PDFIngestionConfig {
    return { ...this.config };
  }

  /**
   * Get service statistics
   */
  getStats(): {
    pdfExtractorConfig: PDFExtractorConfig;
    chunkerConfig: ChunkerConfig;
    summarizerConfig: FilingSummarizerConfig;
    factExtractorConfig: FactExtractorConfig;
  } {
    return {
      pdfExtractorConfig: this.pdfExtractor.getConfig(),
      chunkerConfig: this.chunker.getConfig(),
      summarizerConfig: this.summarizer.getConfig(),
      factExtractorConfig: this.factExtractor.getConfig(),
    };
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a PDF ingestion service
 */
export function createPDFIngestionService(options?: {
  config?: Partial<PDFIngestionConfig>;
  logger?: PDFIngestionLogger;
  storage?: ResearchNoteStorage;
  llmProvider?: LLMProvider;
}): PDFIngestionService {
  return new PDFIngestionService(options);
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Ingest a PDF filing (convenience function)
 */
export async function ingestPDFFiling(
  request: PDFIngestionRequest,
  options?: {
    config?: Partial<PDFIngestionConfig>;
    logger?: PDFIngestionLogger;
    storage?: ResearchNoteStorage;
    llmProvider?: LLMProvider;
  }
): Promise<PDFIngestionResult> {
  const service = createPDFIngestionService(options);
  return service.ingest(request);
}

/**
 * Batch ingest PDF filings (convenience function)
 */
export async function ingestPDFFilingsBatch(
  request: BatchPDFIngestionRequest,
  options?: {
    config?: Partial<PDFIngestionConfig>;
    logger?: PDFIngestionLogger;
    storage?: ResearchNoteStorage;
    llmProvider?: LLMProvider;
  }
): Promise<BatchPDFIngestionResult> {
  const service = createPDFIngestionService(options);
  return service.ingestBatch(request);
}
