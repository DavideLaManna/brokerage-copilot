/**
 * Tests for Article Summarizer Service
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ArticleSummarizer,
  MockLLMProvider,
  createMockArticleSummarizer,
  createArticleSummarizer,
  summarizeArticle,
  type LLMProvider,
  type ArticleSummarizerLogger,
} from './article-summarizer.js';
import { DEFAULT_SUMMARIZER_CONFIG, type ExtractedArticle } from '../types/research.js';

// Mock logger
const mockLogger: ArticleSummarizerLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

// Sample article for testing
const sampleArticle: ExtractedArticle = {
  headline: 'Apple Reports Strong Q4 Earnings, Beats Expectations',
  publishedAt: '2024-01-15T10:00:00Z',
  bodyText: `Apple Inc. (NASDAQ: AAPL) reported fourth quarter earnings that exceeded Wall Street expectations.
    The company posted revenue of $90 billion, up 5% year-over-year. iPhone sales remained strong,
    contributing $45 billion to the total. CEO Tim Cook expressed optimism about the upcoming product lineup.
    The company also announced a new $100 billion share buyback program. Analysts reacted positively,
    with several raising their price targets. The stock rose 3% in after-hours trading.
    Looking ahead, Apple expects continued growth in its services segment, which saw 20% year-over-year growth.`,
  url: 'https://www.reuters.com/article/apple-earnings',
  sourceId: 'reuters',
  sourceName: 'Reuters',
  sourceType: 'news',
  wordCount: 100,
  extractedAt: '2024-01-15T10:30:00Z',
};

describe('MockLLMProvider', () => {
  it('returns a completion result', async () => {
    const provider = new MockLLMProvider();
    const result = await provider.complete('Test prompt');
    expect(result.text).toBeDefined();
    expect(result.tokensUsed).toBeGreaterThan(0);
    expect(result.model).toBe('mock-model');
  });

  it('uses provided model name', async () => {
    const provider = new MockLLMProvider();
    const result = await provider.complete('Test prompt', { model: 'custom-model' });
    expect(result.model).toBe('custom-model');
  });

  it('returns valid JSON in response', async () => {
    const provider = new MockLLMProvider();
    const result = await provider.complete('Test prompt');
    const parsed = JSON.parse(result.text);
    expect(parsed.shortSummary).toBeDefined();
    expect(parsed.keyTakeaways).toBeDefined();
  });
});

describe('ArticleSummarizer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('creates summarizer with default config', () => {
      const provider = new MockLLMProvider();
      const summarizer = new ArticleSummarizer(provider, {}, mockLogger);
      const config = summarizer.getConfig();
      expect(config.maxInputTokens).toBe(DEFAULT_SUMMARIZER_CONFIG.maxInputTokens);
      expect(config.model).toBe(DEFAULT_SUMMARIZER_CONFIG.model);
    });

    it('creates summarizer with custom config', () => {
      const provider = new MockLLMProvider();
      const summarizer = new ArticleSummarizer(
        provider,
        { maxInputTokens: 2000, temperature: 0.5 },
        mockLogger
      );
      const config = summarizer.getConfig();
      expect(config.maxInputTokens).toBe(2000);
      expect(config.temperature).toBe(0.5);
    });
  });

  describe('summarize', () => {
    it('summarizes an article successfully', async () => {
      const summarizer = createMockArticleSummarizer({}, mockLogger);
      const result = await summarizer.summarize({
        article: sampleArticle,
        symbols: ['AAPL'],
      });

      expect(result.success).toBe(true);
      expect(result.summary).toBeDefined();
      expect(result.summary?.shortSummary).toBeDefined();
      expect(result.summary?.keyTakeaways).toBeInstanceOf(Array);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('creates minimal summary for very short articles', async () => {
      const summarizer = createMockArticleSummarizer({}, mockLogger);
      const shortArticle: ExtractedArticle = {
        ...sampleArticle,
        bodyText: 'Very short content.',
        wordCount: 3,
      };

      const result = await summarizer.summarize({
        article: shortArticle,
        symbols: [],
      });

      expect(result.success).toBe(true);
      expect(result.summary).toBeDefined();
      expect(result.summary?.tokensUsed).toBe(0); // Minimal summary doesn't use LLM
    });

    it('includes symbols in summary request', async () => {
      const summarizer = createMockArticleSummarizer({}, mockLogger);
      const result = await summarizer.summarize({
        article: sampleArticle,
        symbols: ['AAPL', 'MSFT'],
      });

      expect(result.success).toBe(true);
    });

    it('handles custom prompt', async () => {
      const summarizer = createMockArticleSummarizer({}, mockLogger);
      const result = await summarizer.summarize({
        article: sampleArticle,
        symbols: ['AAPL'],
        customPrompt: 'Focus on earnings numbers',
      });

      expect(result.success).toBe(true);
    });

    it('handles LLM errors gracefully', async () => {
      const failingProvider: LLMProvider = {
        complete: vi.fn().mockRejectedValue(new Error('API Error')),
      };
      const summarizer = new ArticleSummarizer(failingProvider, {}, mockLogger);
      const result = await summarizer.summarize({
        article: sampleArticle,
        symbols: [],
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('API Error');
    });

    it('handles invalid JSON response from LLM', async () => {
      const badResponseProvider: LLMProvider = {
        complete: vi.fn().mockResolvedValue({
          text: 'This is not valid JSON',
          tokensUsed: 10,
          model: 'test',
        }),
      };
      const summarizer = new ArticleSummarizer(badResponseProvider, {}, mockLogger);
      const result = await summarizer.summarize({
        article: sampleArticle,
        symbols: [],
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('summarizeMany', () => {
    it('summarizes multiple articles', async () => {
      const summarizer = createMockArticleSummarizer({}, mockLogger);
      const requests = [
        { article: sampleArticle, symbols: ['AAPL'] },
        { article: { ...sampleArticle, url: 'https://example.com/2' }, symbols: ['MSFT'] },
      ];

      const results = await summarizer.summarizeMany(requests, 2);
      expect(results.size).toBe(2);
    });

    it('respects concurrency limit', async () => {
      const summarizer = createMockArticleSummarizer({}, mockLogger);
      const requests = Array(5).fill(null).map((_, i) => ({
        article: { ...sampleArticle, url: `https://example.com/${i}` },
        symbols: [],
      }));

      const results = await summarizer.summarizeMany(requests, 1);
      expect(results.size).toBe(5);
    });
  });

  describe('updateConfig', () => {
    it('updates configuration', () => {
      const summarizer = createMockArticleSummarizer({}, mockLogger);
      summarizer.updateConfig({ maxOutputTokens: 300 });
      expect(summarizer.getConfig().maxOutputTokens).toBe(300);
    });
  });

  describe('getConfig', () => {
    it('returns a copy of the config', () => {
      const summarizer = createMockArticleSummarizer({}, mockLogger);
      const config1 = summarizer.getConfig();
      const config2 = summarizer.getConfig();
      expect(config1).toEqual(config2);
      expect(config1).not.toBe(config2);
    });
  });
});

describe('Factory Functions', () => {
  describe('createMockArticleSummarizer', () => {
    it('creates a summarizer with mock LLM', () => {
      const summarizer = createMockArticleSummarizer();
      expect(summarizer).toBeInstanceOf(ArticleSummarizer);
    });
  });

  describe('createArticleSummarizer', () => {
    it('creates a summarizer with custom LLM', () => {
      const customProvider: LLMProvider = {
        complete: vi.fn().mockResolvedValue({
          text: JSON.stringify({ shortSummary: 'Test', keyTakeaways: [] }),
          tokensUsed: 10,
          model: 'custom',
        }),
      };
      const summarizer = createArticleSummarizer(customProvider);
      expect(summarizer).toBeInstanceOf(ArticleSummarizer);
    });
  });

  describe('summarizeArticle', () => {
    it('summarizes a single article', async () => {
      const result = await summarizeArticle(sampleArticle, ['AAPL']);
      expect(result.success).toBe(true);
      expect(result.summary).toBeDefined();
    });
  });
});

describe('Summary Parsing', () => {
  it('handles markdown code blocks in response', async () => {
    const codeBlockProvider: LLMProvider = {
      complete: vi.fn().mockResolvedValue({
        text: '```json\n{"shortSummary": "Test summary", "keyTakeaways": ["Point 1"]}\n```',
        tokensUsed: 10,
        model: 'test',
      }),
    };
    const summarizer = new ArticleSummarizer(codeBlockProvider, {}, mockLogger);
    const result = await summarizer.summarize({
      article: sampleArticle,
      symbols: [],
    });

    expect(result.success).toBe(true);
    expect(result.summary?.shortSummary).toBe('Test summary');
  });

  it('validates sentiment values', async () => {
    const goodSentimentProvider: LLMProvider = {
      complete: vi.fn().mockResolvedValue({
        text: JSON.stringify({
          shortSummary: 'Test',
          keyTakeaways: ['Point'],
          sentiment: 'bullish',
          sentimentConfidence: 0.8,
        }),
        tokensUsed: 10,
        model: 'test',
      }),
    };
    const summarizer = new ArticleSummarizer(goodSentimentProvider, {}, mockLogger);
    const result = await summarizer.summarize({
      article: sampleArticle,
      symbols: [],
    });

    expect(result.summary?.sentiment).toBe('bullish');
    expect(result.summary?.sentimentConfidence).toBe(0.8);
  });

  it('ignores invalid sentiment values', async () => {
    const badSentimentProvider: LLMProvider = {
      complete: vi.fn().mockResolvedValue({
        text: JSON.stringify({
          shortSummary: 'Test',
          keyTakeaways: ['Point'],
          sentiment: 'invalid-sentiment',
          sentimentConfidence: 2.0, // Invalid: > 1
        }),
        tokensUsed: 10,
        model: 'test',
      }),
    };
    const summarizer = new ArticleSummarizer(badSentimentProvider, {}, mockLogger);
    const result = await summarizer.summarize({
      article: sampleArticle,
      symbols: [],
    });

    expect(result.summary?.sentiment).toBeUndefined();
    expect(result.summary?.sentimentConfidence).toBeUndefined();
  });

  it('parses key data points', async () => {
    const dataPointsProvider: LLMProvider = {
      complete: vi.fn().mockResolvedValue({
        text: JSON.stringify({
          shortSummary: 'Test',
          keyTakeaways: ['Point'],
          keyDataPoints: [
            { type: 'earnings', description: 'Q4 EPS of $1.50' },
            { type: 'price_target', description: 'PT raised to $200', value: '$200' },
          ],
        }),
        tokensUsed: 10,
        model: 'test',
      }),
    };
    const summarizer = new ArticleSummarizer(dataPointsProvider, {}, mockLogger);
    const result = await summarizer.summarize({
      article: sampleArticle,
      symbols: [],
    });

    expect(result.summary?.keyDataPoints).toHaveLength(2);
    expect(result.summary?.keyDataPoints?.[0].type).toBe('earnings');
    expect(result.summary?.keyDataPoints?.[1].value).toBe('$200');
  });
});
