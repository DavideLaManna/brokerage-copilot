/**
 * Filing Section Summarizer Service
 *
 * Summarizes SEC filing sections using LLM with specialized prompts
 * for financial documents. Extracts key data points, risks, and insights.
 */

import type {
  FilingSection,
  FilingSectionType,
  SectionSummary,
  FilingSummary,
  FilingSummarizerConfig,
  SectionSummarizationResult,
  StructuredFact,
  FilingMetadata,
  ExtractedPDFContent,
  DocumentChunk,
} from '../types/pdf-filing';
import {
  DEFAULT_FILING_SUMMARIZER_CONFIG,
  formatSectionType,
  formatFilingType,
} from '../types/pdf-filing';
import type { KeyDataPoint } from '../types/research';
import { truncateToMaxWords, countWords } from '../types/research';
import type { LLMProvider, LLMCompletionOptions, LLMCompletionResult } from './article-summarizer';
import { MockLLMProvider } from './article-summarizer';

// ============================================================================
// Types
// ============================================================================

/**
 * Logger interface for dependency injection
 */
export interface FilingSummarizerLogger {
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
  debug(message: string, data?: Record<string, unknown>): void;
}

/**
 * Options for summarization
 */
export interface SummarizationOptions {
  /** Config overrides */
  config?: Partial<FilingSummarizerConfig>;
  /** Filing metadata for context */
  metadata?: FilingMetadata;
  /** Related symbols for context */
  symbols?: string[];
}

// ============================================================================
// Prompt Templates
// ============================================================================

/**
 * System prompt for SEC filing section summarization
 */
const FILING_SUMMARIZATION_SYSTEM_PROMPT = `You are a financial analyst expert in SEC filings analysis. Your task is to summarize SEC filing sections concisely while extracting key trading-relevant information.

Guidelines:
- Focus on material information that could impact investment decisions
- Identify specific numbers, metrics, dates, and changes from prior periods
- Note any forward-looking statements and guidance
- Highlight risk factors and potential concerns
- Be objective and avoid speculation

Respond ONLY with valid JSON in the following format:
{
  "summary": "2-4 sentence summary of the section's key points",
  "keyPoints": ["key point 1", "key point 2", "key point 3"],
  "keyDataPoints": [
    {
      "type": "earnings" | "guidance" | "rating" | "price_target" | "event" | "metric" | "other",
      "description": "description of the data point",
      "value": "optional value",
      "date": "optional date if applicable"
    }
  ],
  "sentiment": "positive" | "negative" | "neutral" | "mixed"
}`;

/**
 * Section-specific prompt additions
 */
const SECTION_PROMPTS: Record<FilingSectionType, string> = {
  business: `Focus on: Business model changes, new products/services, market position, competitive advantages, key customers, and geographic expansion.`,
  risk_factors: `Focus on: New risks vs. prior filings, risk severity rankings, specific numbers (e.g., exposure amounts), mitigation strategies, and material uncertainties.`,
  properties: `Focus on: Significant property changes, lease obligations, capacity utilization, and planned expansions.`,
  legal_proceedings: `Focus on: Material litigation, estimated losses, settlement amounts, regulatory investigations, and timeline expectations.`,
  mda: `Focus on: Revenue drivers, margin changes, segment performance, cash flow trends, capital allocation, and management's outlook.`,
  financials: `Focus on: Key metrics (revenue, EPS, margins), year-over-year changes, balance sheet health, cash position, and notable accounting changes.`,
  controls: `Focus on: Material weaknesses, significant deficiencies, remediation plans, and auditor opinions.`,
  exhibits: `Focus on: Material contracts, significant amendments, and key exhibits referenced.`,
  signature: `Focus on: Signatories and any unusual certifications.`,
  cover_page: `Focus on: Filing type, company identification, and amendment status.`,
  table_of_contents: `Focus on: Document structure and sections included.`,
  executive_summary: `Focus on: Key highlights and main themes of the filing.`,
  forward_looking: `Focus on: Disclaimer scope, assumptions made, and risk qualifiers.`,
  other: `Focus on: Any material information relevant to investors.`,
};

/**
 * Build section-specific prompt
 */
function buildSectionPrompt(
  section: FilingSection,
  metadata?: FilingMetadata,
  symbols?: string[]
): string {
  const sectionGuidance = SECTION_PROMPTS[section.type] || SECTION_PROMPTS.other;

  let contextInfo = '';
  if (metadata) {
    contextInfo = `
Company: ${metadata.companyName}
Ticker(s): ${metadata.tickers.join(', ') || 'N/A'}
Filing Type: ${formatFilingType(metadata.filingType)}
Period: ${metadata.periodOfReport}
`;
  }

  if (symbols?.length) {
    contextInfo += `Related Symbols: ${symbols.join(', ')}\n`;
  }

  return `${sectionGuidance}

${contextInfo}

SECTION: ${formatSectionType(section.type)}
Title: ${section.title}

CONTENT:
${section.content}

Analyze this section and provide a structured summary following the JSON format specified.`;
}

/**
 * Build executive summary prompt
 */
function buildExecutiveSummaryPrompt(
  sectionSummaries: SectionSummary[],
  metadata?: FilingMetadata
): string {
  let contextInfo = '';
  if (metadata) {
    contextInfo = `
Company: ${metadata.companyName}
Ticker(s): ${metadata.tickers.join(', ') || 'N/A'}
Filing Type: ${formatFilingType(metadata.filingType)}
Period: ${metadata.periodOfReport}
`;
  }

  const summariesText = sectionSummaries
    .map(s => `## ${formatSectionType(s.sectionType)}\n${s.summary}`)
    .join('\n\n');

  return `Based on the following section summaries from an SEC filing, provide an executive summary.
${contextInfo}

SECTION SUMMARIES:
${summariesText}

Respond ONLY with valid JSON in the following format:
{
  "executiveSummary": "1 paragraph executive summary of the entire filing",
  "highlights": ["highlight 1", "highlight 2", "highlight 3"],
  "keyRisks": ["risk 1", "risk 2"],
  "keyOpportunities": ["opportunity 1", "opportunity 2"],
  "materialChanges": ["change 1", "change 2"],
  "overallSentiment": "positive" | "negative" | "neutral" | "mixed"
}`;
}

// ============================================================================
// Mock Filing LLM Provider
// ============================================================================

/**
 * Mock LLM provider specialized for SEC filings
 */
export class MockFilingLLMProvider implements LLMProvider {
  async complete(prompt: string, options?: LLMCompletionOptions): Promise<LLMCompletionResult> {
    await new Promise(resolve => setTimeout(resolve, 50));

    const model = options?.model || 'mock-filing-model';

    // Detect if this is an executive summary request
    if (prompt.includes('executive summary')) {
      return {
        text: JSON.stringify({
          executiveSummary: 'The company reported strong operational performance with revenue growth driven by services expansion. Management remains optimistic about future growth while acknowledging macroeconomic uncertainties.',
          highlights: [
            'Revenue increased 8% year-over-year to $410.5B',
            'Services segment reached record $95.2B',
            'Returned $100B to shareholders',
          ],
          keyRisks: [
            'Global economic uncertainty',
            'Supply chain concentration',
            'Intense market competition',
          ],
          keyOpportunities: [
            'Services expansion potential',
            'New product categories',
            'Emerging market growth',
          ],
          materialChanges: [
            'Shift toward services revenue',
            'Increased R&D investment',
          ],
          overallSentiment: 'positive',
        }),
        tokensUsed: 250,
        model,
      };
    }

    // Detect section type from prompt
    let sentiment: 'positive' | 'negative' | 'neutral' | 'mixed' = 'neutral';
    let summary = 'This section contains standard disclosure information.';
    const keyPoints = ['Key disclosure identified', 'Standard regulatory compliance noted'];
    const keyDataPoints: KeyDataPoint[] = [];

    if (prompt.includes('RISK FACTORS') || prompt.includes('risk_factors')) {
      sentiment = 'negative';
      summary = 'The company identifies several risk factors including global economic conditions, supply chain disruptions, and competitive pressures that could materially affect business results.';
      keyPoints.push('Supply chain concentration risk highlighted');
      keyPoints.push('Competitive pressure acknowledged');
      keyDataPoints.push({
        type: 'other',
        description: 'Risk factors identified',
        value: 'Multiple material risks disclosed',
      });
    } else if (prompt.includes('MANAGEMENT') || prompt.includes('mda')) {
      sentiment = 'positive';
      summary = 'Management reports strong operational performance with revenue growth of 8% year-over-year. Services segment continues to expand while product margins remain stable.';
      keyPoints.push('Revenue growth of 8% YoY');
      keyPoints.push('Services expansion continues');
      keyDataPoints.push({
        type: 'earnings',
        description: 'Net sales',
        value: '$410.5B',
      });
      keyDataPoints.push({
        type: 'guidance',
        description: 'Services revenue',
        value: '$95.2B',
      });
    } else if (prompt.includes('FINANCIAL STATEMENTS') || prompt.includes('financials')) {
      sentiment = 'positive';
      summary = 'Consolidated financial statements show improved profitability with gross margin of $185.4B and operating income of $131.3B.';
      keyPoints.push('Gross margin improved');
      keyPoints.push('Operating expenses well controlled');
      keyDataPoints.push({
        type: 'earnings',
        description: 'Gross margin',
        value: '$185.4B',
      });
      keyDataPoints.push({
        type: 'earnings',
        description: 'Operating income',
        value: '$131.3B',
      });
    } else if (prompt.includes('BUSINESS') || prompt.includes('business')) {
      sentiment = 'neutral';
      summary = 'The company operates across multiple product and service segments including iPhone, Mac, and a growing services business encompassing Apple Music, TV+, and more.';
      keyPoints.push('Diversified product portfolio');
      keyPoints.push('Services expansion strategy');
    }

    return {
      text: JSON.stringify({
        summary,
        keyPoints,
        keyDataPoints,
        sentiment,
      }),
      tokensUsed: Math.floor(prompt.length / 4) + 100,
      model,
    };
  }
}

// ============================================================================
// Filing Summarizer Service
// ============================================================================

/**
 * SEC filing section summarizer service
 */
export class FilingSummarizer {
  private config: FilingSummarizerConfig;
  private logger: FilingSummarizerLogger;
  private llmProvider: LLMProvider;

  constructor(options?: {
    config?: Partial<FilingSummarizerConfig>;
    logger?: FilingSummarizerLogger;
    llmProvider?: LLMProvider;
  }) {
    this.config = { ...DEFAULT_FILING_SUMMARIZER_CONFIG, ...options?.config };
    this.logger = options?.logger || this.createDefaultLogger();
    this.llmProvider = options?.llmProvider || new MockFilingLLMProvider();
  }

  private createDefaultLogger(): FilingSummarizerLogger {
    const prefix = '[FILING-SUMMARIZER]';
    return {
      info: (msg, data) => console.log(prefix, msg, data ? JSON.stringify(data) : ''),
      warn: (msg, data) => console.warn(prefix, msg, data ? JSON.stringify(data) : ''),
      error: (msg, data) => console.error(prefix, msg, data ? JSON.stringify(data) : ''),
      debug: (msg, data) => console.debug(prefix, msg, data ? JSON.stringify(data) : ''),
    };
  }

  /**
   * Summarize a single filing section
   */
  async summarizeSection(
    section: FilingSection,
    options?: SummarizationOptions
  ): Promise<SectionSummarizationResult> {
    const startTime = Date.now();
    const effectiveConfig = { ...this.config, ...options?.config };

    this.logger.info('Summarizing section', {
      sectionType: section.type,
      wordCount: section.wordCount,
    });

    // Check if section should be summarized
    if (
      effectiveConfig.sectionsToSummarize.length > 0 &&
      !effectiveConfig.sectionsToSummarize.includes(section.type)
    ) {
      return {
        success: false,
        error: `Section type ${section.type} not in sections to summarize`,
        durationMs: Date.now() - startTime,
      };
    }

    try {
      // Truncate content if too long (estimate ~4 chars per token)
      const maxWords = Math.floor(effectiveConfig.maxInputTokensPerSection * 0.75);
      const truncatedContent = truncateToMaxWords(section.content, maxWords);

      // Build prompt
      const prompt = buildSectionPrompt(
        { ...section, content: truncatedContent },
        options?.metadata,
        options?.symbols
      );

      // Call LLM
      const result = await this.llmProvider.complete(
        `${FILING_SUMMARIZATION_SYSTEM_PROMPT}\n\n${prompt}`,
        {
          maxTokens: effectiveConfig.maxOutputTokensPerSection,
          temperature: effectiveConfig.temperature,
          model: effectiveConfig.model,
        }
      );

      // Parse response
      const parsed = JSON.parse(result.text);

      const summary: SectionSummary = {
        sectionType: section.type,
        summary: parsed.summary || '',
        keyPoints: parsed.keyPoints || [],
        keyDataPoints: parsed.keyDataPoints || [],
        sentiment: parsed.sentiment,
        tokensUsed: result.tokensUsed,
        modelUsed: result.model,
        generatedAt: new Date().toISOString(),
      };

      this.logger.info('Section summarized', {
        sectionType: section.type,
        tokensUsed: result.tokensUsed,
        keyPointsCount: summary.keyPoints.length,
      });

      return {
        success: true,
        summary,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('Section summarization failed', {
        sectionType: section.type,
        error: errorMessage,
      });

      return {
        success: false,
        error: errorMessage,
        durationMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Summarize multiple sections
   */
  async summarizeSections(
    sections: FilingSection[],
    options?: SummarizationOptions
  ): Promise<{
    results: SectionSummarizationResult[];
    successCount: number;
    totalTokensUsed: number;
  }> {
    const results: SectionSummarizationResult[] = [];
    let totalTokensUsed = 0;
    let successCount = 0;

    // Filter sections if configured
    const effectiveConfig = { ...this.config, ...options?.config };
    let sectionsToProcess = sections;

    if (effectiveConfig.sectionsToSummarize.length > 0) {
      sectionsToProcess = sections.filter(s =>
        effectiveConfig.sectionsToSummarize.includes(s.type)
      );
    }

    this.logger.info('Summarizing multiple sections', {
      totalSections: sectionsToProcess.length,
    });

    for (const section of sectionsToProcess) {
      const result = await this.summarizeSection(section, options);
      results.push(result);

      if (result.success && result.summary) {
        successCount++;
        totalTokensUsed += result.summary.tokensUsed;
      }
    }

    return { results, successCount, totalTokensUsed };
  }

  /**
   * Generate complete filing summary
   */
  async generateFilingSummary(
    content: ExtractedPDFContent,
    options?: SummarizationOptions
  ): Promise<FilingSummary> {
    const startTime = Date.now();

    this.logger.info('Generating filing summary', {
      sectionsCount: content.sections.length,
      totalWords: content.totalWords,
    });

    // Summarize all sections
    const { results, totalTokensUsed } = await this.summarizeSections(content.sections, options);

    // Collect successful summaries
    const sectionSummaries = results
      .filter(r => r.success && r.summary)
      .map(r => r.summary!);

    // Collect all key data points and facts
    const allKeyDataPoints: KeyDataPoint[] = [];
    const allFacts: StructuredFact[] = [];

    for (const summary of sectionSummaries) {
      if (summary.keyDataPoints) {
        allKeyDataPoints.push(...summary.keyDataPoints);
      }
    }

    // Generate executive summary
    let executiveSummary = 'Filing summary not available.';
    let highlights: string[] = [];
    let keyRisks: string[] = [];
    let keyOpportunities: string[] = [];
    let materialChanges: string[] = [];
    let overallSentiment: 'positive' | 'negative' | 'neutral' | 'mixed' | undefined;
    let execSummaryTokens = 0;

    if (sectionSummaries.length > 0) {
      try {
        const execPrompt = buildExecutiveSummaryPrompt(sectionSummaries, options?.metadata);
        const execResult = await this.llmProvider.complete(
          `${FILING_SUMMARIZATION_SYSTEM_PROMPT}\n\n${execPrompt}`,
          {
            maxTokens: 600,
            temperature: this.config.temperature,
            model: this.config.model,
          }
        );

        const parsed = JSON.parse(execResult.text);
        executiveSummary = parsed.executiveSummary || executiveSummary;
        highlights = parsed.highlights || [];
        keyRisks = parsed.keyRisks || [];
        keyOpportunities = parsed.keyOpportunities || [];
        materialChanges = parsed.materialChanges || [];
        overallSentiment = parsed.overallSentiment;
        execSummaryTokens = execResult.tokensUsed;
      } catch (error) {
        this.logger.error('Executive summary generation failed', {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    const filingSummary: FilingSummary = {
      executiveSummary,
      highlights,
      sectionSummaries,
      structuredFacts: allFacts,
      overallSentiment,
      keyRisks,
      keyOpportunities,
      materialChanges,
      totalTokensUsed: totalTokensUsed + execSummaryTokens,
      generatedAt: new Date().toISOString(),
    };

    this.logger.info('Filing summary generated', {
      sectionSummariesCount: sectionSummaries.length,
      totalTokensUsed: filingSummary.totalTokensUsed,
      durationMs: Date.now() - startTime,
    });

    return filingSummary;
  }

  /**
   * Summarize chunks for a section
   */
  async summarizeChunks(
    chunks: DocumentChunk[],
    options?: SummarizationOptions
  ): Promise<{
    combinedSummary: string;
    chunkSummaries: string[];
    totalTokensUsed: number;
  }> {
    const chunkSummaries: string[] = [];
    let totalTokensUsed = 0;

    for (const chunk of chunks) {
      // Create a pseudo-section for the chunk
      const pseudoSection: FilingSection = {
        type: chunk.sectionType || 'other',
        title: chunk.sectionTitle || `Chunk ${chunk.index + 1}`,
        content: chunk.content,
        startPage: chunk.startPage,
        endPage: chunk.endPage,
        wordCount: chunk.wordCount,
        charCount: chunk.content.length,
        confidence: 0.8,
      };

      const result = await this.summarizeSection(pseudoSection, options);

      if (result.success && result.summary) {
        chunkSummaries.push(result.summary.summary);
        totalTokensUsed += result.summary.tokensUsed;
      }
    }

    // Combine chunk summaries
    const combinedSummary = chunkSummaries.join(' ');

    return { combinedSummary, chunkSummaries, totalTokensUsed };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<FilingSummarizerConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): FilingSummarizerConfig {
    return { ...this.config };
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a filing summarizer service
 */
export function createFilingSummarizer(options?: {
  config?: Partial<FilingSummarizerConfig>;
  logger?: FilingSummarizerLogger;
  llmProvider?: LLMProvider;
}): FilingSummarizer {
  return new FilingSummarizer(options);
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Summarize a filing section (convenience function)
 */
export async function summarizeFilingSection(
  section: FilingSection,
  options?: SummarizationOptions & {
    config?: Partial<FilingSummarizerConfig>;
    logger?: FilingSummarizerLogger;
    llmProvider?: LLMProvider;
  }
): Promise<SectionSummarizationResult> {
  const summarizer = createFilingSummarizer(options);
  return summarizer.summarizeSection(section, options);
}

/**
 * Generate full filing summary (convenience function)
 */
export async function generateFilingSummary(
  content: ExtractedPDFContent,
  options?: SummarizationOptions & {
    config?: Partial<FilingSummarizerConfig>;
    logger?: FilingSummarizerLogger;
    llmProvider?: LLMProvider;
  }
): Promise<FilingSummary> {
  const summarizer = createFilingSummarizer(options);
  return summarizer.generateFilingSummary(content, options);
}
