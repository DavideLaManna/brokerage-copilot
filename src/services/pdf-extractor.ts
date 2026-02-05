/**
 * PDF Text Extraction Service
 *
 * Downloads and extracts text content from PDF documents.
 * Supports SEC filings and other financial documents.
 */

import * as crypto from 'crypto';
import type {
  PDFExtractorConfig,
  ExtractedPDFContent,
  PDFExtractionResult,
  FilingSection,
  FilingSectionType,
  FilingMetadata,
  SECFilingType,
} from '../types/pdf-filing';
import {
  DEFAULT_PDF_EXTRACTOR_CONFIG,
  extractAccessionNumber,
  extractCIK,
  determineFilingType,
} from '../types/pdf-filing';
import { countWords } from '../types/research';

// ============================================================================
// Types
// ============================================================================

/**
 * Logger interface for dependency injection
 */
export interface PDFExtractorLogger {
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
  debug(message: string, data?: Record<string, unknown>): void;
}

/**
 * PDF parser result (simulating pdf-parse output)
 */
interface PDFParseResult {
  numpages: number;
  text: string;
  info?: {
    Title?: string;
    Author?: string;
    Subject?: string;
    Creator?: string;
    Producer?: string;
    CreationDate?: string;
    ModDate?: string;
  };
  metadata?: Record<string, unknown>;
}

/**
 * PDF parser interface for dependency injection
 */
export interface PDFParser {
  parse(buffer: Buffer): Promise<PDFParseResult>;
}

// ============================================================================
// Section Detection Patterns
// ============================================================================

/**
 * Patterns for detecting SEC filing sections
 */
const SECTION_PATTERNS: Array<{
  type: FilingSectionType;
  patterns: RegExp[];
  titlePatterns: string[];
}> = [
  {
    type: 'cover_page',
    patterns: [
      /^UNITED STATES\s+SECURITIES AND EXCHANGE COMMISSION/im,
      /^Form\s+(10-[KQ]|8-K|20-F)/im,
    ],
    titlePatterns: ['Cover Page', 'Filing Cover'],
  },
  {
    type: 'table_of_contents',
    patterns: [
      /TABLE\s+OF\s+CONTENTS/i,
      /^INDEX$/im,
      /^CONTENTS$/im,
    ],
    titlePatterns: ['Table of Contents', 'Index', 'Contents'],
  },
  {
    type: 'forward_looking',
    patterns: [
      /FORWARD[- ]LOOKING\s+STATEMENTS/i,
      /CAUTIONARY\s+STATEMENT/i,
      /SAFE\s+HARBOR\s+STATEMENT/i,
    ],
    titlePatterns: ['Forward-Looking Statements', 'Cautionary Statement'],
  },
  {
    type: 'business',
    patterns: [
      /^ITEM\s+1\.?\s*[-–—]?\s*BUSINESS/im,
      /^PART\s+I[\.\s]+ITEM\s+1[\.\s]+BUSINESS/im,
      /^ITEM\s+1\.\s+DESCRIPTION\s+OF\s+BUSINESS/im,
    ],
    titlePatterns: ['Item 1. Business', 'Business Description', 'Description of Business'],
  },
  {
    type: 'risk_factors',
    patterns: [
      /^ITEM\s+1A\.?\s*[-–—]?\s*RISK\s+FACTORS/im,
      /^RISK\s+FACTORS$/im,
      /^ITEM\s+1A\.\s+RISK\s+FACTORS/im,
    ],
    titlePatterns: ['Item 1A. Risk Factors', 'Risk Factors'],
  },
  {
    type: 'properties',
    patterns: [
      /^ITEM\s+2\.?\s*[-–—]?\s*PROPERTIES/im,
      /^ITEM\s+2\.\s+PROPERTIES/im,
    ],
    titlePatterns: ['Item 2. Properties', 'Properties'],
  },
  {
    type: 'legal_proceedings',
    patterns: [
      /^ITEM\s+3\.?\s*[-–—]?\s*LEGAL\s+PROCEEDINGS/im,
      /^ITEM\s+3\.\s+LEGAL\s+PROCEEDINGS/im,
    ],
    titlePatterns: ['Item 3. Legal Proceedings', 'Legal Proceedings'],
  },
  {
    type: 'mda',
    patterns: [
      /^ITEM\s+7\.?\s*[-–—]?\s*MANAGEMENT['']?S?\s+DISCUSSION/im,
      /^MANAGEMENT['']?S?\s+DISCUSSION\s+AND\s+ANALYSIS/im,
      /^MD&A$/im,
      /^ITEM\s+2\.?\s*[-–—]?\s*MANAGEMENT['']?S?\s+DISCUSSION/im, // 10-Q Item 2
    ],
    titlePatterns: ["Item 7. Management's Discussion and Analysis", 'MD&A', "Management's Discussion & Analysis"],
  },
  {
    type: 'financials',
    patterns: [
      /^ITEM\s+8\.?\s*[-–—]?\s*FINANCIAL\s+STATEMENTS/im,
      /^CONSOLIDATED\s+FINANCIAL\s+STATEMENTS/im,
      /^FINANCIAL\s+STATEMENTS\s+AND\s+SUPPLEMENTARY\s+DATA/im,
    ],
    titlePatterns: ['Item 8. Financial Statements', 'Consolidated Financial Statements'],
  },
  {
    type: 'controls',
    patterns: [
      /^ITEM\s+9A\.?\s*[-–—]?\s*CONTROLS\s+AND\s+PROCEDURES/im,
      /^CONTROLS\s+AND\s+PROCEDURES$/im,
      /^ITEM\s+4\.?\s*[-–—]?\s*CONTROLS\s+AND\s+PROCEDURES/im, // 10-Q Item 4
    ],
    titlePatterns: ['Item 9A. Controls and Procedures', 'Controls and Procedures'],
  },
  {
    type: 'exhibits',
    patterns: [
      /^ITEM\s+15\.?\s*[-–—]?\s*EXHIBITS/im,
      /^EXHIBITS?\s+AND\s+FINANCIAL\s+STATEMENT\s+SCHEDULES/im,
      /^ITEM\s+6\.?\s*[-–—]?\s*EXHIBITS/im, // 10-Q Item 6
    ],
    titlePatterns: ['Item 15. Exhibits', 'Exhibits and Financial Statement Schedules'],
  },
  {
    type: 'signature',
    patterns: [
      /^SIGNATURES?$/im,
      /^SIGNATURE\s+PAGE$/im,
      /pursuant to the requirements of/i,
    ],
    titlePatterns: ['Signatures', 'Signature Page'],
  },
];

// ============================================================================
// Mock PDF Parser (for testing/demo)
// ============================================================================

/**
 * Mock PDF parser for testing/demo purposes
 */
export class MockPDFParser implements PDFParser {
  private mockContent: string;
  private mockPages: number;

  constructor(options?: { content?: string; pages?: number }) {
    this.mockContent = options?.content || this.generateMockFilingContent();
    this.mockPages = options?.pages || 50;
  }

  async parse(_buffer: Buffer): Promise<PDFParseResult> {
    // Simulate parsing delay
    await new Promise(resolve => setTimeout(resolve, 100));

    return {
      numpages: this.mockPages,
      text: this.mockContent,
      info: {
        Title: 'Annual Report (10-K)',
        Author: 'Apple Inc.',
        CreationDate: new Date().toISOString(),
      },
    };
  }

  private generateMockFilingContent(): string {
    return `
UNITED STATES SECURITIES AND EXCHANGE COMMISSION
Washington, D.C. 20549

FORM 10-K

ANNUAL REPORT PURSUANT TO SECTION 13 OR 15(d) OF THE SECURITIES EXCHANGE ACT OF 1934

For the fiscal year ended September 30, 2025

Commission File Number: 001-36743

APPLE INC.
(Exact name of registrant as specified in its charter)

California                                94-2404110
(State or other jurisdiction of         (I.R.S. Employer
incorporation or organization)           Identification No.)

One Apple Park Way
Cupertino, California 95014
(Address of principal executive offices) (Zip Code)

TABLE OF CONTENTS

PART I
Item 1.  Business...........................................3
Item 1A. Risk Factors......................................15
Item 1B. Unresolved Staff Comments.........................35
Item 2.  Properties........................................36
Item 3.  Legal Proceedings.................................37
Item 4.  Mine Safety Disclosures...........................38

PART II
Item 5.  Market for Registrant's Common Equity.............39
Item 6.  [Reserved]........................................40
Item 7.  Management's Discussion and Analysis..............41
Item 8.  Financial Statements..............................55
Item 9.  Changes in and Disagreements with Accountants.....89
Item 9A. Controls and Procedures...........................90

FORWARD-LOOKING STATEMENTS

This Annual Report on Form 10-K contains forward-looking statements within the meaning of the Private Securities Litigation Reform Act of 1995. These statements involve risks and uncertainties, and actual results may differ materially from those anticipated.

ITEM 1. BUSINESS

Apple Inc. ("Apple" or the "Company") designs, manufactures and markets smartphones, personal computers, tablets, wearables and accessories, and sells a variety of related services.

Products

iPhone
iPhone is the Company's line of smartphones based on its iOS operating system. During 2025, the Company released iPhone 16, iPhone 16 Plus, iPhone 16 Pro and iPhone 16 Pro Max.

Mac
Mac is the Company's line of personal computers based on its macOS operating system. The Company offers Mac in various configurations, including MacBook Air, MacBook Pro, iMac, Mac mini, Mac Studio and Mac Pro.

Services
The Company offers various services including Apple Music, Apple TV+, Apple Arcade, iCloud, Apple Pay and more.

ITEM 1A. RISK FACTORS

The Company's business, reputation, results of operations, financial condition and stock price can be affected by a number of factors.

Global and Regional Economic Conditions
The Company's operations and performance depend significantly on global and regional economic conditions.

Intense Competition
The markets for the Company's products and services are highly competitive.

Supply Chain Disruptions
The Company relies on a complex global supply chain that may be disrupted by various factors including natural disasters, geopolitical tensions, and public health crises.

ITEM 7. MANAGEMENT'S DISCUSSION AND ANALYSIS OF FINANCIAL CONDITION AND RESULTS OF OPERATIONS

The following discussion should be read in conjunction with the consolidated financial statements.

Fiscal 2025 Highlights

Total net sales increased 8% year-over-year to $410.5 billion.
Services revenue reached $95.2 billion, a new quarterly record.
The Company returned over $100 billion to shareholders through dividends and share repurchases.

Net Sales
Net sales increased $30.3 billion or 8% during 2025 compared to 2024.

Products
Products net sales increased $18.2 billion or 6% during 2025 compared to 2024.

Services
Services net sales increased $12.1 billion or 15% during 2025 compared to 2024.

ITEM 8. FINANCIAL STATEMENTS AND SUPPLEMENTARY DATA

CONSOLIDATED STATEMENTS OF OPERATIONS
(In millions, except number of shares which are reflected in thousands and per share amounts)

                                          Years ended
                                   September 30,  September 24,
                                       2025           2024
Net sales:
  Products                          $ 315,300      $ 297,100
  Services                             95,200         83,100
    Total net sales                   410,500        380,200

Cost of sales:
  Products                            198,700        188,900
  Services                             26,400         24,200
    Total cost of sales               225,100        213,100

Gross margin                          185,400        167,100

Operating expenses:
  Research and development             29,900         27,500
  Selling, general and administrative  24,200         22,800
    Total operating expenses           54,100         50,300

Operating income                      131,300        116,800

ITEM 9A. CONTROLS AND PROCEDURES

Evaluation of Disclosure Controls and Procedures
Based on the evaluation of our disclosure controls and procedures, our CEO and CFO concluded that our disclosure controls and procedures were effective.

Management's Report on Internal Control Over Financial Reporting
Our management is responsible for establishing and maintaining adequate internal control over financial reporting.

SIGNATURES

Pursuant to the requirements of Section 13 or 15(d) of the Securities Exchange Act of 1934, the registrant has duly caused this report to be signed on its behalf by the undersigned, thereunto duly authorized.

APPLE INC.

By: /s/ Tim Cook
    Tim Cook
    Chief Executive Officer

Date: November 1, 2025
`;
  }
}

// ============================================================================
// PDF Extractor Service
// ============================================================================

/**
 * PDF text extraction service
 */
export class PDFExtractor {
  private config: PDFExtractorConfig;
  private logger: PDFExtractorLogger;
  private parser: PDFParser;

  constructor(options?: {
    config?: Partial<PDFExtractorConfig>;
    logger?: PDFExtractorLogger;
    parser?: PDFParser;
  }) {
    this.config = { ...DEFAULT_PDF_EXTRACTOR_CONFIG, ...options?.config };
    this.logger = options?.logger || this.createDefaultLogger();
    this.parser = options?.parser || new MockPDFParser();
  }

  private createDefaultLogger(): PDFExtractorLogger {
    const prefix = '[PDF-EXTRACTOR]';
    return {
      info: (msg, data) => console.log(prefix, msg, data ? JSON.stringify(data) : ''),
      warn: (msg, data) => console.warn(prefix, msg, data ? JSON.stringify(data) : ''),
      error: (msg, data) => console.error(prefix, msg, data ? JSON.stringify(data) : ''),
      debug: (msg, data) => console.debug(prefix, msg, data ? JSON.stringify(data) : ''),
    };
  }

  /**
   * Extract text from a PDF URL
   */
  async extractFromUrl(url: string): Promise<PDFExtractionResult> {
    const startTime = Date.now();

    this.logger.info('Starting PDF extraction', { url });

    try {
      // Download PDF
      const buffer = await this.downloadPDF(url);

      // Parse PDF
      const parseResult = await this.parsePDF(buffer);

      // Extract sections
      const sections = this.extractSections(parseResult.text, parseResult.numpages);

      // Build page texts map (simplified - real implementation would use actual page boundaries)
      const pageTexts = this.buildPageTexts(parseResult.text, parseResult.numpages);

      const content: ExtractedPDFContent = {
        fullText: parseResult.text,
        totalPages: parseResult.numpages,
        totalWords: countWords(parseResult.text),
        pageTexts,
        sections,
        extractionMetadata: {
          extractorUsed: 'pdf-parse',
          extractedAt: new Date().toISOString(),
          durationMs: Date.now() - startTime,
          ocrUsed: false,
          warnings: [],
        },
      };

      this.logger.info('PDF extraction completed', {
        url,
        pages: content.totalPages,
        words: content.totalWords,
        sections: content.sections.length,
        durationMs: content.extractionMetadata.durationMs,
      });

      return {
        success: true,
        content,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorCode = this.determineErrorCode(error);

      this.logger.error('PDF extraction failed', { url, error: errorMessage, errorCode });

      return {
        success: false,
        error: errorMessage,
        errorCode,
        durationMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Extract text from a PDF buffer
   */
  async extractFromBuffer(buffer: Buffer): Promise<PDFExtractionResult> {
    const startTime = Date.now();

    this.logger.info('Starting PDF extraction from buffer', { size: buffer.length });

    try {
      const parseResult = await this.parsePDF(buffer);
      const sections = this.extractSections(parseResult.text, parseResult.numpages);
      const pageTexts = this.buildPageTexts(parseResult.text, parseResult.numpages);

      const content: ExtractedPDFContent = {
        fullText: parseResult.text,
        totalPages: parseResult.numpages,
        totalWords: countWords(parseResult.text),
        pageTexts,
        sections,
        extractionMetadata: {
          extractorUsed: 'pdf-parse',
          extractedAt: new Date().toISOString(),
          durationMs: Date.now() - startTime,
          ocrUsed: false,
          warnings: [],
        },
      };

      return {
        success: true,
        content,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      return {
        success: false,
        error: errorMessage,
        errorCode: this.determineErrorCode(error),
        durationMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Download PDF from URL
   */
  private async downloadPDF(url: string): Promise<Buffer> {
    this.logger.debug('Downloading PDF', { url });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; OptionsTraderBot/1.0; +https://example.com/bot)',
          'Accept': 'application/pdf',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('pdf') && !contentType.includes('octet-stream')) {
        this.logger.warn('Response may not be a PDF', { contentType, url });
      }

      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Parse PDF buffer
   */
  private async parsePDF(buffer: Buffer): Promise<PDFParseResult> {
    this.logger.debug('Parsing PDF', { size: buffer.length });

    // Check for PDF magic number
    const header = buffer.slice(0, 5).toString('ascii');
    if (!header.startsWith('%PDF-')) {
      throw new Error('Invalid PDF file: missing PDF header');
    }

    return await this.parser.parse(buffer);
  }

  /**
   * Extract sections from full text
   */
  private extractSections(text: string, totalPages: number): FilingSection[] {
    const sections: FilingSection[] = [];
    const lines = text.split('\n');
    let currentSection: Partial<FilingSection> | null = null;
    let currentContent: string[] = [];
    let estimatedPage = 1;
    let linesSincePageBreak = 0;
    const linesPerPage = Math.ceil(lines.length / Math.max(totalPages, 1));

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]?.trim() || '';
      linesSincePageBreak++;

      // Estimate page transitions
      if (linesSincePageBreak >= linesPerPage) {
        estimatedPage = Math.min(estimatedPage + 1, totalPages);
        linesSincePageBreak = 0;
      }

      // Check if this line starts a new section
      const sectionMatch = this.matchSectionStart(line);

      if (sectionMatch) {
        // Save previous section if exists
        if (currentSection && currentSection.type) {
          const content = currentContent.join('\n').trim();
          sections.push({
            type: currentSection.type,
            title: currentSection.title || '',
            content,
            startPage: currentSection.startPage || 1,
            endPage: estimatedPage - 1,
            wordCount: countWords(content),
            charCount: content.length,
            confidence: currentSection.confidence || 0.8,
          });
        }

        // Start new section
        currentSection = {
          type: sectionMatch.type,
          title: sectionMatch.title,
          startPage: estimatedPage,
          confidence: sectionMatch.confidence,
        };
        currentContent = [line];
      } else if (currentSection) {
        currentContent.push(line);
      }
    }

    // Save last section
    if (currentSection && currentSection.type) {
      const content = currentContent.join('\n').trim();
      sections.push({
        type: currentSection.type,
        title: currentSection.title || '',
        content,
        startPage: currentSection.startPage || 1,
        endPage: totalPages,
        wordCount: countWords(content),
        charCount: content.length,
        confidence: currentSection.confidence || 0.8,
      });
    }

    // If no sections found, create a single "other" section
    if (sections.length === 0) {
      sections.push({
        type: 'other',
        title: 'Full Document',
        content: text,
        startPage: 1,
        endPage: totalPages,
        wordCount: countWords(text),
        charCount: text.length,
        confidence: 0.5,
      });
    }

    return sections;
  }

  /**
   * Match a line against section patterns
   */
  private matchSectionStart(line: string): {
    type: FilingSectionType;
    title: string;
    confidence: number;
  } | null {
    for (const sectionDef of SECTION_PATTERNS) {
      for (const pattern of sectionDef.patterns) {
        if (pattern.test(line)) {
          // Find best title match
          const title = sectionDef.titlePatterns.find(t =>
            line.toLowerCase().includes(t.toLowerCase())
          ) || sectionDef.titlePatterns[0] || line;

          return {
            type: sectionDef.type,
            title: title || '',
            confidence: 0.9,
          };
        }
      }
    }
    return null;
  }

  /**
   * Build page texts map (simplified implementation)
   */
  private buildPageTexts(text: string, totalPages: number): Map<number, string> {
    const pageTexts = new Map<number, string>();
    const lines = text.split('\n');
    const linesPerPage = Math.ceil(lines.length / Math.max(totalPages, 1));

    for (let page = 1; page <= totalPages; page++) {
      const startLine = (page - 1) * linesPerPage;
      const endLine = Math.min(page * linesPerPage, lines.length);
      const pageContent = lines.slice(startLine, endLine).join('\n');
      pageTexts.set(page, pageContent);
    }

    return pageTexts;
  }

  /**
   * Determine error code from exception
   */
  private determineErrorCode(
    error: unknown
  ): 'download_failed' | 'parse_error' | 'timeout' | 'unsupported_format' | 'ocr_failed' | 'unknown' {
    if (error instanceof Error) {
      const msg = error.message.toLowerCase();
      if (msg.includes('abort') || msg.includes('timeout')) return 'timeout';
      if (msg.includes('http') || msg.includes('fetch') || msg.includes('network')) return 'download_failed';
      if (msg.includes('invalid pdf') || msg.includes('missing pdf')) return 'unsupported_format';
      if (msg.includes('parse') || msg.includes('corrupt')) return 'parse_error';
      if (msg.includes('ocr')) return 'ocr_failed';
    }
    return 'unknown';
  }

  /**
   * Extract filing metadata from URL and content
   */
  extractMetadata(
    url: string,
    content?: ExtractedPDFContent,
    overrides?: Partial<FilingMetadata>
  ): FilingMetadata | null {
    const accessionNumber = overrides?.accessionNumber || extractAccessionNumber(url);
    const cik = overrides?.cik || extractCIK(url);
    // Prefer explicit override, then auto-detection from URL
    const filingType = overrides?.filingType || determineFilingType(url, accessionNumber);

    if (!accessionNumber || !cik) {
      this.logger.warn('Could not extract filing metadata', { url });
      return null;
    }

    // Try to extract company name from content
    let companyName = overrides?.companyName || '';
    if (content && !companyName) {
      const nameMatch = content.fullText.match(/^([A-Z][A-Za-z\s&.,]+(?:Inc\.|Corp\.|LLC|LP|Ltd\.?))/m);
      if (nameMatch) {
        companyName = nameMatch[1]?.trim() || 'Unknown Company';
      }
    }

    // Extract period from content
    let periodOfReport = overrides?.periodOfReport || '';
    if (content && !periodOfReport) {
      const periodMatch = content.fullText.match(
        /(?:for the (?:fiscal|quarterly) (?:year|period) ended|period of report:?)\s*([A-Za-z]+\s+\d{1,2},?\s+\d{4})/i
      );
      if (periodMatch) {
        periodOfReport = periodMatch[1] || '';
      }
    }

    return {
      accessionNumber,
      cik,
      companyName: companyName || 'Unknown Company',
      tickers: overrides?.tickers || [],
      filingType: filingType || 'other',
      filingDate: overrides?.filingDate || new Date().toISOString().split('T')[0] || '',
      periodOfReport: periodOfReport || '',
      fiscalYearEnd: overrides?.fiscalYearEnd,
      documentUrl: url,
      indexUrl: overrides?.indexUrl,
      filedBy: overrides?.filedBy,
      stateOfIncorporation: overrides?.stateOfIncorporation,
      sicCode: overrides?.sicCode,
      sicDescription: overrides?.sicDescription,
    };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<PDFExtractorConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): PDFExtractorConfig {
    return { ...this.config };
  }
}

// ============================================================================
// Mock PDF Extractor for Testing
// ============================================================================

/**
 * Mock PDF extractor that doesn't make network calls
 */
export class MockPDFExtractor extends PDFExtractor {
  private mockParser: MockPDFParser;

  constructor(options?: {
    config?: Partial<PDFExtractorConfig>;
    logger?: PDFExtractorLogger;
    parser?: PDFParser;
  }) {
    const mockParser = (options?.parser as MockPDFParser) || new MockPDFParser();
    super({ ...options, parser: mockParser });
    this.mockParser = mockParser;
  }

  /**
   * Override extractFromUrl to skip network download
   */
  override async extractFromUrl(url: string): Promise<PDFExtractionResult> {
    // Use extractFromBuffer with a mock buffer to skip network call
    const mockBuffer = Buffer.from('%PDF-1.4 mock content');
    return super.extractFromBuffer(mockBuffer);
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a PDF extractor service
 */
export function createPDFExtractor(options?: {
  config?: Partial<PDFExtractorConfig>;
  logger?: PDFExtractorLogger;
  parser?: PDFParser;
}): PDFExtractor {
  return new PDFExtractor(options);
}

/**
 * Create a mock PDF extractor for testing (no network calls)
 */
export function createMockPDFExtractor(options?: {
  config?: Partial<PDFExtractorConfig>;
  logger?: PDFExtractorLogger;
  parser?: PDFParser;
}): MockPDFExtractor {
  return new MockPDFExtractor(options);
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Extract text from a PDF URL (convenience function)
 */
export async function extractPDFFromUrl(
  url: string,
  options?: {
    config?: Partial<PDFExtractorConfig>;
    logger?: PDFExtractorLogger;
    parser?: PDFParser;
  }
): Promise<PDFExtractionResult> {
  const extractor = createPDFExtractor(options);
  return extractor.extractFromUrl(url);
}

/**
 * Extract text from a PDF buffer (convenience function)
 */
export async function extractPDFFromBuffer(
  buffer: Buffer,
  options?: {
    config?: Partial<PDFExtractorConfig>;
    logger?: PDFExtractorLogger;
    parser?: PDFParser;
  }
): Promise<PDFExtractionResult> {
  const extractor = createPDFExtractor(options);
  return extractor.extractFromBuffer(buffer);
}
