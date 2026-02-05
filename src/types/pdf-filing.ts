/**
 * PDF Filing Types
 *
 * Defines types and schemas for SEC filings and earnings reports processing.
 * Supports PDF download, text extraction, chunking, and structured fact extraction.
 */

import { z } from 'zod';
import type { ArticleSummary, KeyDataPoint, ResearchSourceType } from './research';

// ============================================================================
// Filing Types
// ============================================================================

/**
 * SEC filing types
 */
export type SECFilingType =
  | '10-K'    // Annual report
  | '10-Q'    // Quarterly report
  | '8-K'     // Current report (material events)
  | '10-K/A'  // Amended annual report
  | '10-Q/A'  // Amended quarterly report
  | '8-K/A'   // Amended current report
  | '20-F'    // Foreign private issuer annual report
  | '6-K'     // Foreign private issuer current report
  | 'DEF 14A' // Proxy statement
  | 'S-1'     // Registration statement (IPO)
  | 'S-3'     // Registration statement (shelf offering)
  | '4'       // Insider trading form
  | '13F'     // Institutional holdings
  | '13D'     // Beneficial ownership (activist)
  | '13G'     // Beneficial ownership (passive)
  | 'other';

/**
 * Common sections found in SEC filings
 */
export type FilingSectionType =
  | 'business'            // Item 1 - Business description
  | 'risk_factors'        // Item 1A - Risk factors
  | 'properties'          // Item 2 - Properties
  | 'legal_proceedings'   // Item 3 - Legal proceedings
  | 'mda'                 // Item 7 - Management Discussion & Analysis
  | 'financials'          // Item 8 - Financial statements
  | 'controls'            // Item 9A - Controls and procedures
  | 'exhibits'            // Item 15 - Exhibits
  | 'signature'           // Signatures
  | 'cover_page'          // Cover page
  | 'table_of_contents'   // Table of contents
  | 'executive_summary'   // Executive summary
  | 'forward_looking'     // Forward-looking statements
  | 'other';

/**
 * Extracted filing metadata
 */
export interface FilingMetadata {
  /** SEC accession number (unique identifier) */
  accessionNumber: string;
  /** Company CIK (Central Index Key) */
  cik: string;
  /** Company name as filed */
  companyName: string;
  /** Company ticker symbol(s) */
  tickers: string[];
  /** Filing type */
  filingType: SECFilingType;
  /** Filing date (when filed with SEC) */
  filingDate: string;
  /** Period of report (fiscal period end date) */
  periodOfReport: string;
  /** Fiscal year end */
  fiscalYearEnd?: string;
  /** Document URL on SEC EDGAR */
  documentUrl: string;
  /** Index URL on SEC EDGAR */
  indexUrl?: string;
  /** Filing agent/filer */
  filedBy?: string;
  /** State of incorporation */
  stateOfIncorporation?: string;
  /** SIC code (industry classification) */
  sicCode?: string;
  /** SIC description */
  sicDescription?: string;
}

/**
 * A section/chunk of a filing document
 */
export interface FilingSection {
  /** Section type */
  type: FilingSectionType;
  /** Section title (as appears in document) */
  title: string;
  /** Section text content */
  content: string;
  /** Starting page number (1-indexed) */
  startPage: number;
  /** Ending page number */
  endPage: number;
  /** Word count */
  wordCount: number;
  /** Character count */
  charCount: number;
  /** Extraction confidence (0-1) */
  confidence: number;
}

/**
 * Extracted PDF content
 */
export interface ExtractedPDFContent {
  /** Full text content */
  fullText: string;
  /** Total pages */
  totalPages: number;
  /** Total word count */
  totalWords: number;
  /** Text by page (1-indexed) */
  pageTexts: Map<number, string>;
  /** Extracted sections */
  sections: FilingSection[];
  /** Extraction metadata */
  extractionMetadata: {
    /** PDF library used */
    extractorUsed: string;
    /** Extraction timestamp */
    extractedAt: string;
    /** Extraction duration in ms */
    durationMs: number;
    /** Whether OCR was needed */
    ocrUsed: boolean;
    /** Any extraction warnings */
    warnings: string[];
  };
}

// ============================================================================
// Structured Facts
// ============================================================================

/**
 * Types of structured facts that can be extracted from filings
 */
export type StructuredFactType =
  | 'earnings_date'      // Upcoming/past earnings date
  | 'earnings_eps'       // EPS (actual or guidance)
  | 'earnings_revenue'   // Revenue (actual or guidance)
  | 'guidance'           // Financial guidance
  | 'dividend'           // Dividend information
  | 'buyback'            // Share buyback
  | 'acquisition'        // M&A activity
  | 'divestiture'        // Asset/business sale
  | 'debt'               // Debt issuance/repayment
  | 'executive_change'   // C-suite changes
  | 'legal_matter'       // Material legal matters
  | 'regulatory'         // Regulatory matters
  | 'risk'               // Key risk factors
  | 'other';

/**
 * A structured fact extracted from a filing
 */
export interface StructuredFact {
  /** Unique ID */
  id: string;
  /** Fact type */
  type: StructuredFactType;
  /** Short description */
  description: string;
  /** Detailed value/content */
  value: string;
  /** Numeric value if applicable */
  numericValue?: number;
  /** Unit for numeric value */
  unit?: string;
  /** Currency if monetary */
  currency?: string;
  /** Date associated with the fact */
  date?: string;
  /** Whether this is forward-looking (guidance) */
  isForwardLooking: boolean;
  /** Time period (e.g., "Q4 2025", "FY 2026") */
  period?: string;
  /** Year-over-year change if applicable */
  yoyChange?: number;
  /** Citation (page/section reference) */
  citation: FactCitation;
  /** Confidence score (0-1) */
  confidence: number;
  /** Related symbols */
  symbols: string[];
  /** Extraction timestamp */
  extractedAt: string;
}

/**
 * Citation for a structured fact
 */
export interface FactCitation {
  /** Page number(s) */
  pageNumbers: number[];
  /** Section type */
  sectionType?: FilingSectionType;
  /** Section title */
  sectionTitle?: string;
  /** Exact quote from document (truncated) */
  quote?: string;
}

// ============================================================================
// Section Summary Types
// ============================================================================

/**
 * Summary of a filing section (generated by LLM)
 */
export interface SectionSummary {
  /** Section being summarized */
  sectionType: FilingSectionType;
  /** Short summary (2-4 sentences) */
  summary: string;
  /** Key points extracted */
  keyPoints: string[];
  /** Key data points/facts */
  keyDataPoints: KeyDataPoint[];
  /** Sentiment if applicable */
  sentiment?: 'positive' | 'negative' | 'neutral' | 'mixed';
  /** Tokens used for summarization */
  tokensUsed: number;
  /** Model used */
  modelUsed: string;
  /** When generated */
  generatedAt: string;
}

/**
 * Complete filing summary
 */
export interface FilingSummary {
  /** Executive summary (1 paragraph) */
  executiveSummary: string;
  /** Key highlights */
  highlights: string[];
  /** Section summaries */
  sectionSummaries: SectionSummary[];
  /** All extracted structured facts */
  structuredFacts: StructuredFact[];
  /** Overall sentiment */
  overallSentiment?: 'positive' | 'negative' | 'neutral' | 'mixed';
  /** Key risks identified */
  keyRisks: string[];
  /** Key opportunities identified */
  keyOpportunities: string[];
  /** Material changes from prior period */
  materialChanges: string[];
  /** Total tokens used */
  totalTokensUsed: number;
  /** When generated */
  generatedAt: string;
}

// ============================================================================
// PDF Processing Types
// ============================================================================

/**
 * Configuration for PDF extraction
 */
export interface PDFExtractorConfig {
  /** Maximum pages to extract (0 = unlimited) */
  maxPages: number;
  /** Whether to use OCR for scanned documents */
  enableOCR: boolean;
  /** Minimum confidence for OCR text */
  ocrMinConfidence: number;
  /** Whether to preserve layout/formatting */
  preserveLayout: boolean;
  /** Whether to extract images */
  extractImages: boolean;
  /** Request timeout in ms */
  timeoutMs: number;
}

/**
 * Default PDF extractor config
 */
export const DEFAULT_PDF_EXTRACTOR_CONFIG: PDFExtractorConfig = {
  maxPages: 0, // No limit
  enableOCR: false,
  ocrMinConfidence: 0.8,
  preserveLayout: false,
  extractImages: false,
  timeoutMs: 60000,
};

/**
 * Configuration for document chunking
 */
export interface ChunkerConfig {
  /** Maximum words per chunk */
  maxWordsPerChunk: number;
  /** Overlap words between chunks */
  overlapWords: number;
  /** Whether to split on section boundaries */
  splitOnSections: boolean;
  /** Minimum words for a chunk to be valid */
  minChunkWords: number;
}

/**
 * Default chunker config
 */
export const DEFAULT_CHUNKER_CONFIG: ChunkerConfig = {
  maxWordsPerChunk: 2000,
  overlapWords: 100,
  splitOnSections: true,
  minChunkWords: 50,
};

/**
 * A document chunk
 */
export interface DocumentChunk {
  /** Chunk index (0-based) */
  index: number;
  /** Chunk content */
  content: string;
  /** Word count */
  wordCount: number;
  /** Starting page */
  startPage: number;
  /** Ending page */
  endPage: number;
  /** Section type if applicable */
  sectionType?: FilingSectionType;
  /** Section title if applicable */
  sectionTitle?: string;
  /** Metadata about chunk */
  metadata: {
    /** Whether this is the start of a section */
    isSectionStart: boolean;
    /** Whether this chunk has overlap from previous */
    hasOverlap: boolean;
  };
}

/**
 * Configuration for filing summarization
 */
export interface FilingSummarizerConfig {
  /** Maximum input tokens per section */
  maxInputTokensPerSection: number;
  /** Maximum output tokens per section */
  maxOutputTokensPerSection: number;
  /** Temperature for LLM */
  temperature: number;
  /** Model to use */
  model: string;
  /** Sections to summarize (empty = all) */
  sectionsToSummarize: FilingSectionType[];
  /** Whether to extract structured facts */
  extractFacts: boolean;
  /** Whether to identify risks */
  identifyRisks: boolean;
}

/**
 * Default filing summarizer config
 */
export const DEFAULT_FILING_SUMMARIZER_CONFIG: FilingSummarizerConfig = {
  maxInputTokensPerSection: 4000,
  maxOutputTokensPerSection: 800,
  temperature: 0.3,
  model: 'claude-3-haiku',
  sectionsToSummarize: [], // All sections
  extractFacts: true,
  identifyRisks: true,
};

// ============================================================================
// Result Types
// ============================================================================

/**
 * Result of PDF extraction
 */
export interface PDFExtractionResult {
  /** Whether extraction succeeded */
  success: boolean;
  /** Extracted content if successful */
  content?: ExtractedPDFContent;
  /** Error message if failed */
  error?: string;
  /** Error code if failed */
  errorCode?: 'download_failed' | 'parse_error' | 'timeout' | 'unsupported_format' | 'ocr_failed' | 'unknown';
  /** Duration in ms */
  durationMs: number;
}

/**
 * Result of document chunking
 */
export interface ChunkingResult {
  /** Whether chunking succeeded */
  success: boolean;
  /** Chunks if successful */
  chunks?: DocumentChunk[];
  /** Total chunks created */
  totalChunks: number;
  /** Error if failed */
  error?: string;
}

/**
 * Result of section summarization
 */
export interface SectionSummarizationResult {
  /** Whether summarization succeeded */
  success: boolean;
  /** Summary if successful */
  summary?: SectionSummary;
  /** Error if failed */
  error?: string;
  /** Duration in ms */
  durationMs: number;
}

/**
 * Result of fact extraction
 */
export interface FactExtractionResult {
  /** Whether extraction succeeded */
  success: boolean;
  /** Extracted facts */
  facts: StructuredFact[];
  /** Warnings during extraction */
  warnings: string[];
  /** Duration in ms */
  durationMs: number;
}

/**
 * Result of full filing processing
 */
export interface FilingProcessingResult {
  /** Whether processing succeeded */
  success: boolean;
  /** Filing metadata */
  metadata?: FilingMetadata;
  /** Extracted content */
  extractedContent?: ExtractedPDFContent;
  /** Filing summary */
  summary?: FilingSummary;
  /** Extracted facts */
  facts: StructuredFact[];
  /** Research note ID if stored */
  researchNoteId?: string;
  /** Errors encountered */
  errors: string[];
  /** Warnings */
  warnings: string[];
  /** Total duration in ms */
  totalDurationMs: number;
  /** Individual step durations */
  stepDurations: {
    download?: number;
    extraction?: number;
    chunking?: number;
    summarization?: number;
    factExtraction?: number;
    storage?: number;
  };
}

// ============================================================================
// Ingestion Types
// ============================================================================

/**
 * Request to ingest a PDF filing
 */
export interface PDFIngestionRequest {
  /** PDF URL to download */
  pdfUrl: string;
  /** Filing type if known */
  filingType?: SECFilingType;
  /** Accession number if known */
  accessionNumber?: string;
  /** CIK if known */
  cik?: string;
  /** Company ticker(s) */
  tickers?: string[];
  /** Additional symbols to associate */
  symbols?: string[];
  /** Tags to add */
  tags?: string[];
  /** Whether to generate section summaries */
  generateSummaries?: boolean;
  /** Whether to extract structured facts */
  extractFacts?: boolean;
  /** Specific sections to process (empty = all) */
  sectionsToProcess?: FilingSectionType[];
  /** Force re-processing even if already exists */
  forceReProcess?: boolean;
  /** Custom filing metadata override */
  metadataOverride?: Partial<FilingMetadata>;
}

/**
 * Result of PDF ingestion
 */
export interface PDFIngestionResult {
  /** Whether ingestion succeeded */
  success: boolean;
  /** Processing result */
  processingResult?: FilingProcessingResult;
  /** Research note if created */
  researchNoteId?: string;
  /** Whether this was a duplicate */
  isDuplicate: boolean;
  /** Error if failed */
  error?: string;
}

/**
 * Batch PDF ingestion request
 */
export interface BatchPDFIngestionRequest {
  /** PDF URLs to ingest */
  requests: PDFIngestionRequest[];
  /** Maximum concurrent downloads */
  concurrency?: number;
  /** Whether to generate summaries for all */
  generateSummaries?: boolean;
  /** Whether to extract facts for all */
  extractFacts?: boolean;
}

/**
 * Batch PDF ingestion result
 */
export interface BatchPDFIngestionResult {
  /** Total processed */
  totalProcessed: number;
  /** Successful */
  succeeded: number;
  /** Failed */
  failed: number;
  /** Duplicates skipped */
  duplicates: number;
  /** Individual results */
  results: PDFIngestionResult[];
  /** Total duration in ms */
  totalDurationMs: number;
}

// ============================================================================
// Zod Schemas
// ============================================================================

/**
 * Schema for SEC filing type
 */
export const SECFilingTypeSchema = z.enum([
  '10-K', '10-Q', '8-K', '10-K/A', '10-Q/A', '8-K/A',
  '20-F', '6-K', 'DEF 14A', 'S-1', 'S-3', '4', '13F', '13D', '13G', 'other'
]);

/**
 * Schema for filing section type
 */
export const FilingSectionTypeSchema = z.enum([
  'business', 'risk_factors', 'properties', 'legal_proceedings', 'mda',
  'financials', 'controls', 'exhibits', 'signature', 'cover_page',
  'table_of_contents', 'executive_summary', 'forward_looking', 'other'
]);

/**
 * Schema for structured fact type
 */
export const StructuredFactTypeSchema = z.enum([
  'earnings_date', 'earnings_eps', 'earnings_revenue', 'guidance', 'dividend',
  'buyback', 'acquisition', 'divestiture', 'debt', 'executive_change',
  'legal_matter', 'regulatory', 'risk', 'other'
]);

/**
 * Schema for filing metadata
 */
export const FilingMetadataSchema = z.object({
  accessionNumber: z.string().min(1),
  cik: z.string().min(1),
  companyName: z.string().min(1),
  tickers: z.array(z.string()),
  filingType: SECFilingTypeSchema,
  filingDate: z.string(),
  periodOfReport: z.string(),
  fiscalYearEnd: z.string().optional(),
  documentUrl: z.string().url(),
  indexUrl: z.string().url().optional(),
  filedBy: z.string().optional(),
  stateOfIncorporation: z.string().optional(),
  sicCode: z.string().optional(),
  sicDescription: z.string().optional(),
});

/**
 * Schema for fact citation
 */
export const FactCitationSchema = z.object({
  pageNumbers: z.array(z.number().int().positive()),
  sectionType: FilingSectionTypeSchema.optional(),
  sectionTitle: z.string().optional(),
  quote: z.string().optional(),
});

/**
 * Schema for structured fact
 */
export const StructuredFactSchema = z.object({
  id: z.string().uuid(),
  type: StructuredFactTypeSchema,
  description: z.string().min(1),
  value: z.string().min(1),
  numericValue: z.number().optional(),
  unit: z.string().optional(),
  currency: z.string().optional(),
  date: z.string().optional(),
  isForwardLooking: z.boolean(),
  period: z.string().optional(),
  yoyChange: z.number().optional(),
  citation: FactCitationSchema,
  confidence: z.number().min(0).max(1),
  symbols: z.array(z.string()),
  extractedAt: z.string().datetime(),
});

/**
 * Schema for filing section
 */
export const FilingSectionSchema = z.object({
  type: FilingSectionTypeSchema,
  title: z.string().min(1),
  content: z.string(),
  startPage: z.number().int().positive(),
  endPage: z.number().int().positive(),
  wordCount: z.number().int().min(0),
  charCount: z.number().int().min(0),
  confidence: z.number().min(0).max(1),
});

/**
 * Schema for section summary
 */
export const SectionSummarySchema = z.object({
  sectionType: FilingSectionTypeSchema,
  summary: z.string().min(1),
  keyPoints: z.array(z.string()),
  keyDataPoints: z.array(z.object({
    type: z.enum(['earnings', 'guidance', 'rating', 'price_target', 'event', 'metric', 'other']),
    description: z.string().min(1),
    value: z.union([z.string(), z.number()]).optional(),
    date: z.string().optional(),
  })),
  sentiment: z.enum(['positive', 'negative', 'neutral', 'mixed']).optional(),
  tokensUsed: z.number().int().min(0),
  modelUsed: z.string().min(1),
  generatedAt: z.string().datetime(),
});

/**
 * Schema for PDF ingestion request
 */
export const PDFIngestionRequestSchema = z.object({
  pdfUrl: z.string().url(),
  filingType: SECFilingTypeSchema.optional(),
  accessionNumber: z.string().optional(),
  cik: z.string().optional(),
  tickers: z.array(z.string()).optional(),
  symbols: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  generateSummaries: z.boolean().optional(),
  extractFacts: z.boolean().optional(),
  sectionsToProcess: z.array(FilingSectionTypeSchema).optional(),
  forceReProcess: z.boolean().optional(),
  metadataOverride: FilingMetadataSchema.partial().optional(),
});

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Format filing type for display
 */
export function formatFilingType(filingType: SECFilingType): string {
  const formats: Record<SECFilingType, string> = {
    '10-K': 'Annual Report (10-K)',
    '10-Q': 'Quarterly Report (10-Q)',
    '8-K': 'Current Report (8-K)',
    '10-K/A': 'Amended Annual Report (10-K/A)',
    '10-Q/A': 'Amended Quarterly Report (10-Q/A)',
    '8-K/A': 'Amended Current Report (8-K/A)',
    '20-F': 'Foreign Annual Report (20-F)',
    '6-K': 'Foreign Current Report (6-K)',
    'DEF 14A': 'Proxy Statement (DEF 14A)',
    'S-1': 'IPO Registration (S-1)',
    'S-3': 'Shelf Registration (S-3)',
    '4': 'Insider Trading (Form 4)',
    '13F': 'Institutional Holdings (13F)',
    '13D': 'Activist Ownership (13D)',
    '13G': 'Passive Ownership (13G)',
    'other': 'Other Filing',
  };
  return formats[filingType] || filingType;
}

/**
 * Format section type for display
 */
export function formatSectionType(sectionType: FilingSectionType): string {
  const formats: Record<FilingSectionType, string> = {
    business: 'Business Description',
    risk_factors: 'Risk Factors',
    properties: 'Properties',
    legal_proceedings: 'Legal Proceedings',
    mda: "Management's Discussion & Analysis",
    financials: 'Financial Statements',
    controls: 'Controls & Procedures',
    exhibits: 'Exhibits & Schedules',
    signature: 'Signatures',
    cover_page: 'Cover Page',
    table_of_contents: 'Table of Contents',
    executive_summary: 'Executive Summary',
    forward_looking: 'Forward-Looking Statements',
    other: 'Other',
  };
  return formats[sectionType] || sectionType;
}

/**
 * Format structured fact type for display
 */
export function formatFactType(factType: StructuredFactType): string {
  const formats: Record<StructuredFactType, string> = {
    earnings_date: 'Earnings Date',
    earnings_eps: 'EPS',
    earnings_revenue: 'Revenue',
    guidance: 'Guidance',
    dividend: 'Dividend',
    buyback: 'Share Buyback',
    acquisition: 'Acquisition',
    divestiture: 'Divestiture',
    debt: 'Debt',
    executive_change: 'Executive Change',
    legal_matter: 'Legal Matter',
    regulatory: 'Regulatory',
    risk: 'Risk Factor',
    other: 'Other',
  };
  return formats[factType] || factType;
}

/**
 * Determine filing type from accession number or URL patterns
 */
export function determineFilingType(url: string, accessionNumber?: string): SECFilingType | undefined {
  const urlLower = url.toLowerCase();

  // Check URL patterns
  if (urlLower.includes('10-k') || urlLower.includes('10k')) {
    if (urlLower.includes('/a') || urlLower.includes('-a')) return '10-K/A';
    return '10-K';
  }
  if (urlLower.includes('10-q') || urlLower.includes('10q')) {
    if (urlLower.includes('/a') || urlLower.includes('-a')) return '10-Q/A';
    return '10-Q';
  }
  if (urlLower.includes('8-k') || urlLower.includes('8k')) {
    if (urlLower.includes('/a') || urlLower.includes('-a')) return '8-K/A';
    return '8-K';
  }
  if (urlLower.includes('20-f') || urlLower.includes('20f')) return '20-F';
  if (urlLower.includes('6-k') || urlLower.includes('6k')) return '6-K';
  if (urlLower.includes('def14a') || urlLower.includes('def 14a')) return 'DEF 14A';
  if (urlLower.includes('s-1') && !urlLower.includes('s-11')) return 'S-1';
  if (urlLower.includes('s-3')) return 'S-3';
  if (urlLower.includes('form4') || urlLower.includes('form-4')) return '4';
  if (urlLower.includes('13f')) return '13F';
  if (urlLower.includes('13d')) return '13D';
  if (urlLower.includes('13g')) return '13G';

  return undefined;
}

/**
 * Extract accession number from SEC EDGAR URL
 */
export function extractAccessionNumber(url: string): string | undefined {
  // Pattern: 0001193125-24-012345 or 000119312524012345
  const patterns = [
    /(\d{10}-\d{2}-\d{6})/,           // With dashes
    /(\d{18})/,                        // Without dashes
    /accession=(\d{10}-\d{2}-\d{6})/, // Query param
    /Archives\/edgar\/data\/\d+\/(\d{18})/,  // In path
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match && match[1]) {
      // Normalize to dash format
      const raw = match[1].replace(/-/g, '');
      if (raw.length === 18) {
        return `${raw.slice(0, 10)}-${raw.slice(10, 12)}-${raw.slice(12)}`;
      }
      return match[1];
    }
  }

  return undefined;
}

/**
 * Extract CIK from SEC EDGAR URL
 */
export function extractCIK(url: string): string | undefined {
  // Pattern: /cik=0001234567 or /data/1234567/
  const patterns = [
    /cik[=\/]0*(\d+)/i,
    /\/data\/0*(\d+)\//,
    /CIK=0*(\d+)/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match && match[1]) {
      return match[1].padStart(10, '0');
    }
  }

  return undefined;
}

/**
 * Check if a URL is a valid SEC EDGAR PDF
 */
export function isValidSECPDFUrl(url: string): boolean {
  const urlLower = url.toLowerCase();
  return (
    (urlLower.includes('sec.gov') || urlLower.includes('edgar')) &&
    (urlLower.endsWith('.pdf') || urlLower.includes('.pdf') || urlLower.includes('format=pdf'))
  );
}

/**
 * Build SEC EDGAR document URL
 */
export function buildSECDocumentUrl(cik: string, accessionNumber: string, filename: string): string {
  const cleanCik = cik.replace(/^0+/, '');
  const cleanAccession = accessionNumber.replace(/-/g, '');
  return `https://www.sec.gov/Archives/edgar/data/${cleanCik}/${cleanAccession}/${filename}`;
}

/**
 * Validate PDF ingestion request
 */
export function validatePDFIngestionRequest(request: unknown): {
  valid: boolean;
  errors: string[];
  warnings: string[];
} {
  const result = PDFIngestionRequestSchema.safeParse(request);
  const warnings: string[] = [];

  if (!result.success) {
    return {
      valid: false,
      errors: result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`),
      warnings: [],
    };
  }

  const data = result.data;

  // Check if URL looks like SEC filing
  if (!isValidSECPDFUrl(data.pdfUrl)) {
    warnings.push('URL does not appear to be from SEC EDGAR. Extraction may have limited accuracy.');
  }

  // Warn if no ticker provided for non-SEC URLs
  if (!data.tickers?.length && !data.pdfUrl.includes('sec.gov')) {
    warnings.push('No ticker symbols provided. Auto-extraction may be less accurate for non-SEC documents.');
  }

  return { valid: true, errors: [], warnings };
}

/**
 * Create a source type for PDF filing research notes
 */
export function getFilingSourceType(filingType?: SECFilingType): ResearchSourceType {
  if (!filingType) return 'sec_filing';

  // Earnings-related filings
  if (filingType === '8-K' || filingType === '8-K/A') {
    return 'earnings'; // 8-K often contains earnings
  }

  return 'sec_filing';
}

/**
 * Get filing importance/priority score (0-1)
 * Higher scores for more material filings
 */
export function getFilingImportance(filingType: SECFilingType): number {
  const scores: Record<SECFilingType, number> = {
    '10-K': 1.0,
    '10-K/A': 0.95,
    '10-Q': 0.9,
    '10-Q/A': 0.85,
    '8-K': 0.9,
    '8-K/A': 0.85,
    '20-F': 1.0,
    '6-K': 0.8,
    'DEF 14A': 0.7,
    'S-1': 0.95,
    'S-3': 0.6,
    '4': 0.5,
    '13F': 0.6,
    '13D': 0.8,
    '13G': 0.4,
    'other': 0.3,
  };
  return scores[filingType] ?? 0.5;
}
