/**
 * Structured Fact Extraction Service
 *
 * Extracts structured facts from SEC filings including:
 * - Earnings dates and metrics
 * - Guidance numbers
 * - Key risks
 * - Material events
 *
 * Uses both pattern-based extraction and LLM-assisted extraction.
 */

import * as crypto from 'crypto';
import type {
  StructuredFact,
  StructuredFactType,
  FactCitation,
  FilingSection,
  FilingSectionType,
  FactExtractionResult,
  FilingMetadata,
  ExtractedPDFContent,
} from '../types/pdf-filing';
import { formatFactType } from '../types/pdf-filing';
import type { LLMProvider, LLMCompletionOptions, LLMCompletionResult } from './article-summarizer';

// ============================================================================
// Types
// ============================================================================

/**
 * Logger interface for dependency injection
 */
export interface FactExtractorLogger {
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
  debug(message: string, data?: Record<string, unknown>): void;
}

/**
 * Configuration for fact extraction
 */
export interface FactExtractorConfig {
  /** Whether to use LLM for enhanced extraction */
  useLLM: boolean;
  /** Maximum tokens for LLM extraction */
  maxLLMTokens: number;
  /** Minimum confidence threshold for pattern-based extraction */
  minPatternConfidence: number;
  /** Extract earnings-related facts */
  extractEarnings: boolean;
  /** Extract guidance facts */
  extractGuidance: boolean;
  /** Extract risk facts */
  extractRisks: boolean;
  /** Extract M&A facts */
  extractMA: boolean;
  /** Extract executive changes */
  extractExecutiveChanges: boolean;
  /** Maximum facts to extract per section */
  maxFactsPerSection: number;
}

/**
 * Default fact extractor configuration
 */
export const DEFAULT_FACT_EXTRACTOR_CONFIG: FactExtractorConfig = {
  useLLM: false,
  maxLLMTokens: 1000,
  minPatternConfidence: 0.7,
  extractEarnings: true,
  extractGuidance: true,
  extractRisks: true,
  extractMA: true,
  extractExecutiveChanges: true,
  maxFactsPerSection: 20,
};

/**
 * Extraction options
 */
export interface ExtractionOptions {
  /** Config overrides */
  config?: Partial<FactExtractorConfig>;
  /** Filing metadata for context */
  metadata?: FilingMetadata;
  /** Symbols to tag facts with */
  symbols?: string[];
}

// ============================================================================
// Pattern Definitions
// ============================================================================

/**
 * Pattern for extracting monetary values
 */
const MONEY_PATTERN = /\$[\d,]+(?:\.\d{1,2})?\s*(?:million|billion|M|B|thousand|K)?/gi;

/**
 * Pattern for extracting percentages
 */
const PERCENT_PATTERN = /[\d.]+%/g;

/**
 * Pattern for dates
 */
const DATE_PATTERN = /(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}|\d{1,2}\/\d{1,2}\/\d{2,4}|Q[1-4]\s+(?:FY)?\s*\d{4}/gi;

/**
 * Earnings-related patterns
 */
const EARNINGS_PATTERNS = [
  {
    pattern: /(?:earnings|EPS|diluted EPS|basic EPS)[^\d]*(\$?[\d.]+)/gi,
    type: 'earnings_eps' as StructuredFactType,
    description: 'Earnings per share',
  },
  {
    pattern: /(?:net\s+(?:sales|revenue))[^\d]*(\$[\d,]+(?:\.\d{1,2})?\s*(?:million|billion|M|B)?)/gi,
    type: 'earnings_revenue' as StructuredFactType,
    description: 'Net revenue',
  },
  {
    pattern: /(?:gross\s+(?:margin|profit))[^\d]*(\$[\d,]+(?:\.\d{1,2})?\s*(?:million|billion|M|B)?)/gi,
    type: 'earnings_revenue' as StructuredFactType,
    description: 'Gross margin',
  },
  {
    pattern: /(?:operating\s+income)[^\d]*(\$[\d,]+(?:\.\d{1,2})?\s*(?:million|billion|M|B)?)/gi,
    type: 'earnings_revenue' as StructuredFactType,
    description: 'Operating income',
  },
];

/**
 * Guidance-related patterns
 */
const GUIDANCE_PATTERNS = [
  {
    pattern: /(?:expect|anticipate|project|forecast|guidance)[^\d]{0,30}((?:\$[\d,]+(?:\.\d{1,2})?\s*(?:million|billion|M|B)?)|(?:[\d.]+%))/gi,
    type: 'guidance' as StructuredFactType,
    description: 'Forward guidance',
  },
  {
    pattern: /(?:fiscal\s+(?:year|quarter))[^\d]{0,20}(?:expect|guidance|outlook)[^\d]{0,30}((?:\$[\d,]+)|(?:[\d.]+%))/gi,
    type: 'guidance' as StructuredFactType,
    description: 'Fiscal period guidance',
  },
];

/**
 * Dividend patterns
 */
const DIVIDEND_PATTERNS = [
  {
    pattern: /(?:dividend)[^\d]{0,20}(\$[\d.]+)\s*(?:per\s+share)?/gi,
    type: 'dividend' as StructuredFactType,
    description: 'Dividend per share',
  },
  {
    pattern: /(?:declared|announced)\s+(?:a\s+)?(?:quarterly\s+)?dividend[^\d]{0,20}(\$[\d.]+)/gi,
    type: 'dividend' as StructuredFactType,
    description: 'Declared dividend',
  },
];

/**
 * Share buyback patterns
 */
const BUYBACK_PATTERNS = [
  {
    pattern: /(?:repurchase|buyback)[^\d]{0,30}(\$[\d,]+(?:\.\d{1,2})?\s*(?:million|billion|M|B)?)/gi,
    type: 'buyback' as StructuredFactType,
    description: 'Share repurchase',
  },
  {
    pattern: /(?:returned)[^\d]{0,20}(\$[\d,]+(?:\.\d{1,2})?\s*(?:million|billion|M|B)?)[^\d]{0,20}(?:to\s+shareholders)/gi,
    type: 'buyback' as StructuredFactType,
    description: 'Return to shareholders',
  },
];

/**
 * M&A patterns
 */
const MA_PATTERNS = [
  {
    pattern: /(?:acquire|acquisition|merger|purchase)[^\d]{0,50}(\$[\d,]+(?:\.\d{1,2})?\s*(?:million|billion|M|B)?)/gi,
    type: 'acquisition' as StructuredFactType,
    description: 'Acquisition value',
  },
  {
    pattern: /(?:divest|divestiture|sale of|sold)[^\d]{0,50}(\$[\d,]+(?:\.\d{1,2})?\s*(?:million|billion|M|B)?)/gi,
    type: 'divestiture' as StructuredFactType,
    description: 'Divestiture value',
  },
];

/**
 * Debt patterns
 */
const DEBT_PATTERNS = [
  {
    pattern: /(?:debt|borrowed|credit facility|loan)[^\d]{0,30}(\$[\d,]+(?:\.\d{1,2})?\s*(?:million|billion|M|B)?)/gi,
    type: 'debt' as StructuredFactType,
    description: 'Debt amount',
  },
];

/**
 * Executive change patterns
 */
const EXECUTIVE_PATTERNS = [
  {
    pattern: /(?:appointed|named|elected)\s+(?:as\s+)?(?:Chief|CEO|CFO|COO|President|Chairman)/gi,
    type: 'executive_change' as StructuredFactType,
    description: 'Executive appointment',
  },
  {
    pattern: /(?:resigned|departed|retirement|stepping down)[^\w]{0,30}(?:Chief|CEO|CFO|COO|President|Chairman)/gi,
    type: 'executive_change' as StructuredFactType,
    description: 'Executive departure',
  },
];

// ============================================================================
// Mock LLM Provider for Fact Extraction
// ============================================================================

/**
 * Mock LLM provider for fact extraction
 */
export class MockFactExtractionLLMProvider implements LLMProvider {
  async complete(prompt: string, _options?: LLMCompletionOptions): Promise<LLMCompletionResult> {
    await new Promise(resolve => setTimeout(resolve, 50));

    // Generate mock facts based on prompt content
    const facts: Array<{
      type: string;
      description: string;
      value: string;
      isForwardLooking: boolean;
      confidence: number;
    }> = [];

    if (prompt.includes('revenue') || prompt.includes('sales')) {
      facts.push({
        type: 'earnings_revenue',
        description: 'Total net sales',
        value: '$410.5 billion',
        isForwardLooking: false,
        confidence: 0.95,
      });
    }

    if (prompt.includes('guidance') || prompt.includes('expect')) {
      facts.push({
        type: 'guidance',
        description: 'Management expects continued growth',
        value: '8-10% growth',
        isForwardLooking: true,
        confidence: 0.85,
      });
    }

    if (prompt.includes('risk')) {
      facts.push({
        type: 'risk',
        description: 'Supply chain concentration risk',
        value: 'High dependency on Asian suppliers',
        isForwardLooking: false,
        confidence: 0.9,
      });
    }

    return {
      text: JSON.stringify({ facts }),
      tokensUsed: 100,
      model: 'mock-fact-extraction-model',
    };
  }
}

// ============================================================================
// Fact Extractor Service
// ============================================================================

/**
 * Structured fact extraction service
 */
export class FactExtractor {
  private config: FactExtractorConfig;
  private logger: FactExtractorLogger;
  private llmProvider?: LLMProvider;

  constructor(options?: {
    config?: Partial<FactExtractorConfig>;
    logger?: FactExtractorLogger;
    llmProvider?: LLMProvider;
  }) {
    this.config = { ...DEFAULT_FACT_EXTRACTOR_CONFIG, ...options?.config };
    this.logger = options?.logger || this.createDefaultLogger();
    this.llmProvider = options?.llmProvider;
  }

  private createDefaultLogger(): FactExtractorLogger {
    const prefix = '[FACT-EXTRACTOR]';
    return {
      info: (msg, data) => console.log(prefix, msg, data ? JSON.stringify(data) : ''),
      warn: (msg, data) => console.warn(prefix, msg, data ? JSON.stringify(data) : ''),
      error: (msg, data) => console.error(prefix, msg, data ? JSON.stringify(data) : ''),
      debug: (msg, data) => console.debug(prefix, msg, data ? JSON.stringify(data) : ''),
    };
  }

  /**
   * Extract facts from a filing section
   */
  extractFromSection(
    section: FilingSection,
    options?: ExtractionOptions
  ): FactExtractionResult {
    const startTime = Date.now();
    const effectiveConfig = { ...this.config, ...options?.config };
    const facts: StructuredFact[] = [];
    const warnings: string[] = [];

    this.logger.info('Extracting facts from section', {
      sectionType: section.type,
      wordCount: section.wordCount,
    });

    try {
      // Pattern-based extraction
      const patternFacts = this.extractWithPatterns(section, effectiveConfig, options);
      facts.push(...patternFacts);

      // Limit facts per section
      if (facts.length > effectiveConfig.maxFactsPerSection) {
        warnings.push(`Truncated facts to ${effectiveConfig.maxFactsPerSection} per section`);
        facts.length = effectiveConfig.maxFactsPerSection;
      }

      this.logger.info('Facts extracted from section', {
        sectionType: section.type,
        factCount: facts.length,
        durationMs: Date.now() - startTime,
      });

      return {
        success: true,
        facts,
        warnings,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('Fact extraction failed', {
        sectionType: section.type,
        error: errorMessage,
      });

      return {
        success: false,
        facts: [],
        warnings: [errorMessage],
        durationMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Extract facts from entire filing content
   */
  extractFromContent(
    content: ExtractedPDFContent,
    options?: ExtractionOptions
  ): FactExtractionResult {
    const startTime = Date.now();
    const allFacts: StructuredFact[] = [];
    const allWarnings: string[] = [];

    this.logger.info('Extracting facts from content', {
      sectionsCount: content.sections.length,
      totalWords: content.totalWords,
    });

    for (const section of content.sections) {
      const result = this.extractFromSection(section, options);
      allFacts.push(...result.facts);
      allWarnings.push(...result.warnings);
    }

    // Deduplicate facts by value and type
    const uniqueFacts = this.deduplicateFacts(allFacts);

    this.logger.info('Facts extracted from content', {
      totalFacts: uniqueFacts.length,
      duplicatesRemoved: allFacts.length - uniqueFacts.length,
      durationMs: Date.now() - startTime,
    });

    return {
      success: true,
      facts: uniqueFacts,
      warnings: allWarnings,
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * Extract facts using pattern matching
   */
  private extractWithPatterns(
    section: FilingSection,
    config: FactExtractorConfig,
    options?: ExtractionOptions
  ): StructuredFact[] {
    const facts: StructuredFact[] = [];
    const text = section.content;
    const symbols = options?.symbols || options?.metadata?.tickers || [];

    // Extract earnings facts
    if (config.extractEarnings) {
      for (const patternDef of EARNINGS_PATTERNS) {
        facts.push(...this.extractPattern(patternDef, text, section, symbols));
      }
    }

    // Extract guidance facts
    if (config.extractGuidance) {
      for (const patternDef of GUIDANCE_PATTERNS) {
        facts.push(...this.extractPattern(patternDef, text, section, symbols, true));
      }
    }

    // Extract dividend facts
    facts.push(...this.extractDividendFacts(text, section, symbols));

    // Extract buyback facts
    facts.push(...this.extractBuybackFacts(text, section, symbols));

    // Extract M&A facts
    if (config.extractMA) {
      for (const patternDef of MA_PATTERNS) {
        facts.push(...this.extractPattern(patternDef, text, section, symbols));
      }
    }

    // Extract debt facts
    facts.push(...this.extractDebtFacts(text, section, symbols));

    // Extract executive changes
    if (config.extractExecutiveChanges) {
      facts.push(...this.extractExecutiveFacts(text, section, symbols));
    }

    // Extract risk facts from risk_factors section
    if (config.extractRisks && section.type === 'risk_factors') {
      facts.push(...this.extractRiskFacts(text, section, symbols));
    }

    return facts;
  }

  /**
   * Extract facts using a pattern definition
   */
  private extractPattern(
    patternDef: {
      pattern: RegExp;
      type: StructuredFactType;
      description: string;
    },
    text: string,
    section: FilingSection,
    symbols: string[],
    isForwardLooking = false
  ): StructuredFact[] {
    const facts: StructuredFact[] = [];
    const pattern = new RegExp(patternDef.pattern.source, patternDef.pattern.flags);

    let match;
    while ((match = pattern.exec(text)) !== null) {
      const value = match[1] || match[0];
      const quote = this.extractContext(text, match.index || 0, 100);

      facts.push(this.createFact({
        type: patternDef.type,
        description: patternDef.description,
        value,
        quote,
        section,
        symbols,
        isForwardLooking,
        confidence: 0.8,
      }));
    }

    return facts;
  }

  /**
   * Extract dividend facts
   */
  private extractDividendFacts(
    text: string,
    section: FilingSection,
    symbols: string[]
  ): StructuredFact[] {
    const facts: StructuredFact[] = [];

    for (const patternDef of DIVIDEND_PATTERNS) {
      const pattern = new RegExp(patternDef.pattern.source, patternDef.pattern.flags);
      let match;

      while ((match = pattern.exec(text)) !== null) {
        const value = match[1] || match[0];
        const quote = this.extractContext(text, match.index || 0, 100);

        facts.push(this.createFact({
          type: 'dividend',
          description: patternDef.description,
          value,
          quote,
          section,
          symbols,
          isForwardLooking: false,
          confidence: 0.85,
        }));
      }
    }

    return facts;
  }

  /**
   * Extract buyback facts
   */
  private extractBuybackFacts(
    text: string,
    section: FilingSection,
    symbols: string[]
  ): StructuredFact[] {
    const facts: StructuredFact[] = [];

    for (const patternDef of BUYBACK_PATTERNS) {
      const pattern = new RegExp(patternDef.pattern.source, patternDef.pattern.flags);
      let match;

      while ((match = pattern.exec(text)) !== null) {
        const value = match[1] || match[0];
        const quote = this.extractContext(text, match.index || 0, 100);

        facts.push(this.createFact({
          type: 'buyback',
          description: patternDef.description,
          value,
          quote,
          section,
          symbols,
          isForwardLooking: false,
          confidence: 0.85,
        }));
      }
    }

    return facts;
  }

  /**
   * Extract debt facts
   */
  private extractDebtFacts(
    text: string,
    section: FilingSection,
    symbols: string[]
  ): StructuredFact[] {
    const facts: StructuredFact[] = [];

    for (const patternDef of DEBT_PATTERNS) {
      const pattern = new RegExp(patternDef.pattern.source, patternDef.pattern.flags);
      let match;

      while ((match = pattern.exec(text)) !== null) {
        const value = match[1] || match[0];
        const quote = this.extractContext(text, match.index || 0, 100);

        facts.push(this.createFact({
          type: 'debt',
          description: patternDef.description,
          value,
          quote,
          section,
          symbols,
          isForwardLooking: false,
          confidence: 0.75,
        }));
      }
    }

    return facts;
  }

  /**
   * Extract executive change facts
   */
  private extractExecutiveFacts(
    text: string,
    section: FilingSection,
    symbols: string[]
  ): StructuredFact[] {
    const facts: StructuredFact[] = [];

    for (const patternDef of EXECUTIVE_PATTERNS) {
      const pattern = new RegExp(patternDef.pattern.source, patternDef.pattern.flags);
      let match;

      while ((match = pattern.exec(text)) !== null) {
        const value = match[0];
        const quote = this.extractContext(text, match.index || 0, 150);

        facts.push(this.createFact({
          type: 'executive_change',
          description: patternDef.description,
          value,
          quote,
          section,
          symbols,
          isForwardLooking: false,
          confidence: 0.9,
        }));
      }
    }

    return facts;
  }

  /**
   * Extract risk facts
   */
  private extractRiskFacts(
    text: string,
    section: FilingSection,
    symbols: string[]
  ): StructuredFact[] {
    const facts: StructuredFact[] = [];

    // Look for risk headers/titles
    const riskPatterns = [
      /(?:^|\n)\s*([A-Z][A-Za-z\s]+(?:Risk|Risks|Uncertainties))\s*(?:\.|:|\n)/gm,
      /(?:material|significant|key)\s+(?:risk|uncertainty)[^\n]{0,100}/gi,
    ];

    for (const pattern of riskPatterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const value = match[1] || match[0];
        const quote = this.extractContext(text, match.index || 0, 200);

        facts.push(this.createFact({
          type: 'risk',
          description: 'Key risk factor',
          value: value.trim(),
          quote,
          section,
          symbols,
          isForwardLooking: false,
          confidence: 0.7,
        }));

        // Limit risk facts
        if (facts.length >= 10) break;
      }
      if (facts.length >= 10) break;
    }

    return facts;
  }

  /**
   * Create a structured fact object
   */
  private createFact(params: {
    type: StructuredFactType;
    description: string;
    value: string;
    quote: string;
    section: FilingSection;
    symbols: string[];
    isForwardLooking: boolean;
    confidence: number;
    numericValue?: number;
    unit?: string;
    currency?: string;
    date?: string;
    period?: string;
  }): StructuredFact {
    // Try to parse numeric value
    let numericValue: number | undefined;
    let unit: string | undefined;
    let currency: string | undefined;

    const valueStr = params.value;
    const numMatch = valueStr.match(/[\d,]+(?:\.\d+)?/);
    if (numMatch) {
      numericValue = parseFloat(numMatch[0].replace(/,/g, ''));

      // Determine unit
      if (valueStr.toLowerCase().includes('billion') || valueStr.includes('B')) {
        numericValue *= 1000000000;
        unit = 'dollars';
      } else if (valueStr.toLowerCase().includes('million') || valueStr.includes('M')) {
        numericValue *= 1000000;
        unit = 'dollars';
      } else if (valueStr.includes('%')) {
        unit = 'percent';
      }

      // Check for currency
      if (valueStr.includes('$')) {
        currency = 'USD';
      }
    }

    // Extract date from context
    const dateMatch = params.quote.match(DATE_PATTERN);
    const date = dateMatch ? dateMatch[0] : params.date;

    return {
      id: crypto.randomUUID(),
      type: params.type,
      description: params.description,
      value: params.value.trim(),
      numericValue,
      unit,
      currency,
      date,
      isForwardLooking: params.isForwardLooking,
      period: params.period,
      yoyChange: undefined,
      citation: {
        pageNumbers: [params.section.startPage],
        sectionType: params.section.type,
        sectionTitle: params.section.title,
        quote: params.quote.trim(),
      },
      confidence: params.confidence,
      symbols: params.symbols,
      extractedAt: new Date().toISOString(),
    };
  }

  /**
   * Extract context around a match
   */
  private extractContext(text: string, position: number, contextLength: number): string {
    const start = Math.max(0, position - contextLength);
    const end = Math.min(text.length, position + contextLength);
    let context = text.slice(start, end);

    // Clean up the context
    context = context.replace(/\s+/g, ' ').trim();

    if (start > 0) context = '...' + context;
    if (end < text.length) context = context + '...';

    return context;
  }

  /**
   * Deduplicate facts by value and type
   */
  private deduplicateFacts(facts: StructuredFact[]): StructuredFact[] {
    const seen = new Map<string, StructuredFact>();

    for (const fact of facts) {
      const key = `${fact.type}:${fact.value.toLowerCase().trim()}`;

      if (!seen.has(key)) {
        seen.set(key, fact);
      } else {
        // Keep the one with higher confidence
        const existing = seen.get(key)!;
        if (fact.confidence > existing.confidence) {
          seen.set(key, fact);
        }
      }
    }

    return Array.from(seen.values());
  }

  /**
   * Filter facts by type
   */
  filterByType(facts: StructuredFact[], types: StructuredFactType[]): StructuredFact[] {
    return facts.filter(fact => types.includes(fact.type));
  }

  /**
   * Filter facts by confidence
   */
  filterByConfidence(facts: StructuredFact[], minConfidence: number): StructuredFact[] {
    return facts.filter(fact => fact.confidence >= minConfidence);
  }

  /**
   * Get facts with forward-looking statements
   */
  getForwardLookingFacts(facts: StructuredFact[]): StructuredFact[] {
    return facts.filter(fact => fact.isForwardLooking);
  }

  /**
   * Group facts by type
   */
  groupByType(facts: StructuredFact[]): Map<StructuredFactType, StructuredFact[]> {
    const grouped = new Map<StructuredFactType, StructuredFact[]>();

    for (const fact of facts) {
      if (!grouped.has(fact.type)) {
        grouped.set(fact.type, []);
      }
      grouped.get(fact.type)!.push(fact);
    }

    return grouped;
  }

  /**
   * Get extraction statistics
   */
  getStats(facts: StructuredFact[]): {
    total: number;
    byType: Record<string, number>;
    forwardLooking: number;
    avgConfidence: number;
    withNumericValue: number;
  } {
    const byType: Record<string, number> = {};

    for (const fact of facts) {
      byType[fact.type] = (byType[fact.type] || 0) + 1;
    }

    return {
      total: facts.length,
      byType,
      forwardLooking: facts.filter(f => f.isForwardLooking).length,
      avgConfidence: facts.length > 0
        ? facts.reduce((sum, f) => sum + f.confidence, 0) / facts.length
        : 0,
      withNumericValue: facts.filter(f => f.numericValue !== undefined).length,
    };
  }

  /**
   * Format fact for display
   */
  formatFact(fact: StructuredFact): string {
    let formatted = `[${formatFactType(fact.type)}] ${fact.description}: ${fact.value}`;

    if (fact.isForwardLooking) {
      formatted += ' (Forward-Looking)';
    }

    if (fact.date) {
      formatted += ` (${fact.date})`;
    }

    formatted += ` [Confidence: ${(fact.confidence * 100).toFixed(0)}%]`;

    return formatted;
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<FactExtractorConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): FactExtractorConfig {
    return { ...this.config };
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a fact extractor service
 */
export function createFactExtractor(options?: {
  config?: Partial<FactExtractorConfig>;
  logger?: FactExtractorLogger;
  llmProvider?: LLMProvider;
}): FactExtractor {
  return new FactExtractor(options);
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Extract facts from a section (convenience function)
 */
export function extractFactsFromSection(
  section: FilingSection,
  options?: ExtractionOptions & {
    config?: Partial<FactExtractorConfig>;
    logger?: FactExtractorLogger;
  }
): FactExtractionResult {
  const extractor = createFactExtractor(options);
  return extractor.extractFromSection(section, options);
}

/**
 * Extract facts from content (convenience function)
 */
export function extractFactsFromContent(
  content: ExtractedPDFContent,
  options?: ExtractionOptions & {
    config?: Partial<FactExtractorConfig>;
    logger?: FactExtractorLogger;
  }
): FactExtractionResult {
  const extractor = createFactExtractor(options);
  return extractor.extractFromContent(content, options);
}
