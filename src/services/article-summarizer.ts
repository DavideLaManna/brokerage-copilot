/**
 * Article Summarizer Service
 *
 * Generates token-efficient summaries of articles using LLM.
 * Extracts key data points, sentiment, and takeaways.
 */

import {
  type ExtractedArticle,
  type ArticleSummary,
  type SummarizationRequest,
  type SummarizationResult,
  type SummarizerConfig,
  type KeyDataPoint,
  DEFAULT_SUMMARIZER_CONFIG,
  truncateToMaxWords,
  countWords,
} from '../types/research.js';

/**
 * Logger interface for summarizer
 */
export interface ArticleSummarizerLogger {
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
  debug(message: string, data?: Record<string, unknown>): void;
}

/**
 * Default console logger
 */
const defaultLogger: ArticleSummarizerLogger = {
  info: (message, data) =>
    console.log(`[SUMMARIZER] ${message}`, data ? JSON.stringify(data) : ''),
  warn: (message, data) =>
    console.warn(`[SUMMARIZER] ${message}`, data ? JSON.stringify(data) : ''),
  error: (message, data) =>
    console.error(`[SUMMARIZER] ${message}`, data ? JSON.stringify(data) : ''),
  debug: (message, data) =>
    console.debug(`[SUMMARIZER] ${message}`, data ? JSON.stringify(data) : ''),
};

/**
 * LLM Provider interface for dependency injection
 * This allows the summarizer to work with different LLM backends
 */
export interface LLMProvider {
  /**
   * Generate a completion from the LLM
   */
  complete(prompt: string, options?: LLMCompletionOptions): Promise<LLMCompletionResult>;
}

/**
 * Options for LLM completion
 */
export interface LLMCompletionOptions {
  maxTokens?: number;
  temperature?: number;
  model?: string;
}

/**
 * Result from LLM completion
 */
export interface LLMCompletionResult {
  text: string;
  tokensUsed: number;
  model: string;
}

/**
 * Mock LLM provider for testing and demo purposes
 * In production, replace with actual API integration (e.g., Anthropic, OpenAI)
 */
export class MockLLMProvider implements LLMProvider {
  async complete(prompt: string, options?: LLMCompletionOptions): Promise<LLMCompletionResult> {
    // Simulate some delay
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Generate mock summary based on prompt content
    const model = options?.model || 'mock-model';

    // Extract some keywords from the prompt to make the mock more realistic
    const words = prompt.split(/\s+/).filter((w) => w.length > 5);
    const sampleWords = words.slice(0, 10).join(' ');

    return {
      text: JSON.stringify({
        shortSummary: `This article discusses key financial topics. ${sampleWords.substring(0, 50)}...`,
        keyTakeaways: [
          'Key market development identified',
          'Financial metrics discussed',
          'Potential trading implications noted',
        ],
        sentiment: 'neutral',
        sentimentConfidence: 0.75,
        keyDataPoints: [
          {
            type: 'metric',
            description: 'Sample metric from article',
            value: 'N/A',
          },
        ],
        timeHorizon: 'medium_term',
      }),
      tokensUsed: Math.floor(prompt.length / 4) + 150,
      model,
    };
  }
}

// ============================================================================
// Prompt Templates
// ============================================================================

/**
 * System prompt for article summarization
 */
const SUMMARIZATION_SYSTEM_PROMPT = `You are a financial research analyst assistant. Your task is to summarize financial news articles concisely while extracting key trading-relevant information.

Guidelines:
- Be concise and focus on actionable information
- Identify any specific numbers, dates, or metrics mentioned
- Assess the potential market impact (bullish/bearish/neutral)
- Note any catalysts or upcoming events
- Provide 2-4 key takeaways as bullet points

Respond ONLY with valid JSON in the following format:
{
  "shortSummary": "1-3 sentence summary of the key points",
  "keyTakeaways": ["takeaway 1", "takeaway 2", "takeaway 3"],
  "sentiment": "bullish" | "bearish" | "neutral" | "mixed",
  "sentimentConfidence": 0.0-1.0,
  "keyDataPoints": [
    {
      "type": "earnings" | "guidance" | "rating" | "price_target" | "event" | "metric" | "other",
      "description": "description of the data point",
      "value": "optional value",
      "date": "optional date if applicable"
    }
  ],
  "timeHorizon": "short_term" | "medium_term" | "long_term"
}`;

/**
 * Build the user prompt for summarization
 */
function buildSummarizationPrompt(
  article: ExtractedArticle,
  symbols: string[],
  customPrompt?: string
): string {
  let prompt = `Please summarize the following financial article.\n\n`;

  if (symbols.length > 0) {
    prompt += `Related symbols: ${symbols.join(', ')}\n\n`;
  }

  prompt += `Source: ${article.sourceName} (${article.sourceType})\n`;
  prompt += `Published: ${article.publishedAt}\n`;
  prompt += `Headline: ${article.headline}\n\n`;
  prompt += `Article:\n${article.bodyText}\n`;

  if (customPrompt) {
    prompt += `\nAdditional instructions: ${customPrompt}\n`;
  }

  return prompt;
}

// ============================================================================
// ArticleSummarizer Class
// ============================================================================

/**
 * ArticleSummarizer - Generates summaries using LLM
 */
export class ArticleSummarizer {
  private config: SummarizerConfig;
  private logger: ArticleSummarizerLogger;
  private llmProvider: LLMProvider;

  constructor(
    llmProvider: LLMProvider,
    config: Partial<SummarizerConfig> = {},
    logger?: ArticleSummarizerLogger
  ) {
    this.llmProvider = llmProvider;
    this.config = { ...DEFAULT_SUMMARIZER_CONFIG, ...config };
    this.logger = logger || defaultLogger;
  }

  /**
   * Summarize an article
   */
  async summarize(request: SummarizationRequest): Promise<SummarizationResult> {
    const startTime = Date.now();
    const config = { ...this.config, ...request.config };

    try {
      const { article, symbols, customPrompt } = request;

      // Check if article is too short to need summarization
      if (article.wordCount < 50) {
        this.logger.info('Article too short for summarization', {
          wordCount: article.wordCount,
          headline: article.headline,
        });

        return {
          success: true,
          summary: this.createMinimalSummary(article, config),
          durationMs: Date.now() - startTime,
        };
      }

      // Truncate article body for token efficiency
      const maxWords = Math.floor(config.maxInputTokens / 1.5); // rough estimate
      const truncatedBody = truncateToMaxWords(article.bodyText, maxWords);
      const truncatedArticle = { ...article, bodyText: truncatedBody };

      // Build prompt
      const userPrompt = buildSummarizationPrompt(truncatedArticle, symbols, customPrompt);
      const fullPrompt = `${SUMMARIZATION_SYSTEM_PROMPT}\n\n${userPrompt}`;

      this.logger.debug('Sending summarization request', {
        headline: article.headline,
        bodyWordCount: article.wordCount,
        truncatedWordCount: countWords(truncatedBody),
      });

      // Call LLM
      const result = await this.llmProvider.complete(fullPrompt, {
        maxTokens: config.maxOutputTokens,
        temperature: config.temperature,
        model: config.model,
      });

      // Parse response
      const summary = this.parseResponse(result.text, result.tokensUsed, result.model);

      if (!summary) {
        return {
          success: false,
          error: 'Failed to parse LLM response',
          durationMs: Date.now() - startTime,
        };
      }

      this.logger.info('Article summarized successfully', {
        headline: article.headline,
        sentiment: summary.sentiment,
        tokensUsed: summary.tokensUsed,
      });

      return {
        success: true,
        summary,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error('Summarization failed', { error: errorMessage });

      return {
        success: false,
        error: errorMessage,
        durationMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Summarize multiple articles
   */
  async summarizeMany(
    requests: SummarizationRequest[],
    concurrency: number = 3
  ): Promise<Map<string, SummarizationResult>> {
    const results = new Map<string, SummarizationResult>();
    const queue = [...requests];

    const worker = async () => {
      while (queue.length > 0) {
        const request = queue.shift();
        if (request) {
          const result = await this.summarize(request);
          results.set(request.article.url, result);
        }
      }
    };

    // Run workers in parallel
    const workers = Array(Math.min(concurrency, requests.length))
      .fill(null)
      .map(() => worker());

    await Promise.all(workers);

    return results;
  }

  /**
   * Parse LLM response into ArticleSummary
   */
  private parseResponse(
    text: string,
    tokensUsed: number,
    model: string
  ): ArticleSummary | null {
    try {
      // Try to extract JSON from the response
      let jsonText = text.trim();

      // Handle case where LLM wraps in markdown code blocks
      const jsonMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch?.[1]) {
        jsonText = jsonMatch[1].trim();
      }

      const parsed = JSON.parse(jsonText);

      // Validate required fields
      if (!parsed.shortSummary || !Array.isArray(parsed.keyTakeaways)) {
        this.logger.warn('Invalid summary structure', { parsed });
        return null;
      }

      // Build summary with defaults
      const summary: ArticleSummary = {
        shortSummary: String(parsed.shortSummary),
        keyTakeaways: parsed.keyTakeaways.map(String),
        sentiment: this.validateSentiment(parsed.sentiment),
        sentimentConfidence: this.validateConfidence(parsed.sentimentConfidence),
        keyDataPoints: this.parseDataPoints(parsed.keyDataPoints),
        timeHorizon: this.validateTimeHorizon(parsed.timeHorizon),
        tokensUsed,
        modelUsed: model,
        generatedAt: new Date().toISOString(),
      };

      return summary;
    } catch (error) {
      this.logger.error('Failed to parse LLM response', {
        error: error instanceof Error ? error.message : String(error),
        text: text.substring(0, 200),
      });
      return null;
    }
  }

  /**
   * Create a minimal summary for very short articles
   */
  private createMinimalSummary(
    article: ExtractedArticle,
    config: SummarizerConfig
  ): ArticleSummary {
    return {
      shortSummary: article.headline,
      keyTakeaways: [article.bodyText.substring(0, 200)],
      sentiment: undefined,
      sentimentConfidence: undefined,
      keyDataPoints: undefined,
      timeHorizon: undefined,
      tokensUsed: 0,
      modelUsed: config.model,
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Validate sentiment value
   */
  private validateSentiment(
    value: unknown
  ): 'bullish' | 'bearish' | 'neutral' | 'mixed' | undefined {
    if (
      value === 'bullish' ||
      value === 'bearish' ||
      value === 'neutral' ||
      value === 'mixed'
    ) {
      return value;
    }
    return undefined;
  }

  /**
   * Validate confidence value
   */
  private validateConfidence(value: unknown): number | undefined {
    if (typeof value === 'number' && value >= 0 && value <= 1) {
      return value;
    }
    return undefined;
  }

  /**
   * Validate time horizon value
   */
  private validateTimeHorizon(
    value: unknown
  ): 'short_term' | 'medium_term' | 'long_term' | undefined {
    if (value === 'short_term' || value === 'medium_term' || value === 'long_term') {
      return value;
    }
    return undefined;
  }

  /**
   * Parse key data points from response
   */
  private parseDataPoints(value: unknown): KeyDataPoint[] | undefined {
    if (!Array.isArray(value)) {
      return undefined;
    }

    const validTypes = [
      'earnings',
      'guidance',
      'rating',
      'price_target',
      'event',
      'metric',
      'other',
    ];

    const dataPoints: KeyDataPoint[] = [];
    for (const item of value) {
      if (item && typeof item === 'object' && 'type' in item && 'description' in item) {
        const type = validTypes.includes(String(item.type)) ? String(item.type) : 'other';
        dataPoints.push({
          type: type as KeyDataPoint['type'],
          description: String(item.description),
          value: item.value !== undefined ? String(item.value) : undefined,
          date: item.date !== undefined ? String(item.date) : undefined,
        });
      }
    }

    return dataPoints.length > 0 ? dataPoints : undefined;
  }

  /**
   * Get current configuration
   */
  getConfig(): SummarizerConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<SummarizerConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create an article summarizer with mock LLM (for testing/demo)
 */
export function createMockArticleSummarizer(
  config?: Partial<SummarizerConfig>,
  logger?: ArticleSummarizerLogger
): ArticleSummarizer {
  return new ArticleSummarizer(new MockLLMProvider(), config, logger);
}

/**
 * Create an article summarizer with custom LLM provider
 */
export function createArticleSummarizer(
  llmProvider: LLMProvider,
  config?: Partial<SummarizerConfig>,
  logger?: ArticleSummarizerLogger
): ArticleSummarizer {
  return new ArticleSummarizer(llmProvider, config, logger);
}

/**
 * Summarize a single article (convenience function using mock LLM)
 */
export async function summarizeArticle(
  article: ExtractedArticle,
  symbols: string[] = [],
  config?: Partial<SummarizerConfig>
): Promise<SummarizationResult> {
  const summarizer = createMockArticleSummarizer(config);
  return summarizer.summarize({ article, symbols });
}
