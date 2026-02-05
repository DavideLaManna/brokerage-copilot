/**
 * Tests for Research Types and Helper Functions
 */

import { describe, it, expect } from 'vitest';
import {
  generateUrlHash,
  extractSymbolsFromText,
  identifySourceFromUrl,
  isAllowedSource,
  getSourceById,
  countWords,
  truncateToMaxWords,
  formatSourceType,
  formatSentiment,
  validateResearchNote,
  validateIngestionRequest,
  createResearchNoteFromArticle,
  ALLOWED_NEWS_SOURCES,
  type ExtractedArticle,
} from './research.js';

describe('Research Types Helper Functions', () => {
  describe('generateUrlHash', () => {
    it('generates consistent hash for same URL', () => {
      const url = 'https://example.com/article/123';
      const hash1 = generateUrlHash(url);
      const hash2 = generateUrlHash(url);
      expect(hash1).toBe(hash2);
    });

    it('normalizes URLs before hashing', () => {
      const url1 = 'https://example.com/article/123';
      const url2 = 'https://example.com/article/123/';
      const url3 = 'HTTPS://EXAMPLE.COM/article/123';
      expect(generateUrlHash(url1)).toBe(generateUrlHash(url2));
      expect(generateUrlHash(url1)).toBe(generateUrlHash(url3));
    });

    it('removes UTM parameters', () => {
      const url1 = 'https://example.com/article';
      const url2 = 'https://example.com/article?utm_source=twitter';
      expect(generateUrlHash(url1)).toBe(generateUrlHash(url2));
    });

    it('removes anchors', () => {
      const url1 = 'https://example.com/article';
      const url2 = 'https://example.com/article#section1';
      expect(generateUrlHash(url1)).toBe(generateUrlHash(url2));
    });

    it('generates different hashes for different URLs', () => {
      const hash1 = generateUrlHash('https://example.com/article/1');
      const hash2 = generateUrlHash('https://example.com/article/2');
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('extractSymbolsFromText', () => {
    it('extracts $TICKER symbols', () => {
      const text = 'Check out $AAPL and $MSFT today!';
      const symbols = extractSymbolsFromText(text);
      expect(symbols).toContain('AAPL');
      expect(symbols).toContain('MSFT');
    });

    it('extracts (NASDAQ: AAPL) style symbols', () => {
      const text = 'Apple Inc. (NASDAQ: AAPL) reported earnings.';
      const symbols = extractSymbolsFromText(text);
      expect(symbols).toContain('AAPL');
    });

    it('extracts (NYSE: IBM) style symbols', () => {
      const text = 'IBM (NYSE: IBM) announced a partnership.';
      const symbols = extractSymbolsFromText(text);
      expect(symbols).toContain('IBM');
    });

    it('handles mixed case exchange names', () => {
      const text = 'Apple Inc. (Nasdaq: AAPL) stock rose.';
      const symbols = extractSymbolsFromText(text);
      expect(symbols).toContain('AAPL');
    });

    it('returns unique symbols', () => {
      const text = '$AAPL went up, then $AAPL went down (NASDAQ: AAPL).';
      const symbols = extractSymbolsFromText(text);
      const aaplCount = symbols.filter((s) => s === 'AAPL').length;
      expect(aaplCount).toBe(1);
    });

    it('returns empty array for text without symbols', () => {
      const text = 'This is a general news article without any stock tickers.';
      const symbols = extractSymbolsFromText(text);
      expect(symbols).toHaveLength(0);
    });
  });

  describe('identifySourceFromUrl', () => {
    it('identifies Reuters', () => {
      const source = identifySourceFromUrl('https://www.reuters.com/article/12345');
      expect(source?.id).toBe('reuters');
    });

    it('identifies Bloomberg', () => {
      const source = identifySourceFromUrl('https://www.bloomberg.com/news/article');
      expect(source?.id).toBe('bloomberg');
    });

    it('identifies SEC EDGAR', () => {
      const source = identifySourceFromUrl('https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany');
      expect(source?.id).toBe('sec_edgar');
    });

    it('returns undefined for unknown sources', () => {
      const source = identifySourceFromUrl('https://unknown-source.com/article');
      expect(source).toBeUndefined();
    });
  });

  describe('isAllowedSource', () => {
    it('returns true for allowed sources', () => {
      expect(isAllowedSource('https://www.reuters.com/article')).toBe(true);
      expect(isAllowedSource('https://www.bloomberg.com/news')).toBe(true);
    });

    it('returns false for disallowed sources', () => {
      expect(isAllowedSource('https://random-blog.com/article')).toBe(false);
    });
  });

  describe('getSourceById', () => {
    it('returns source by id', () => {
      const source = getSourceById('reuters');
      expect(source?.name).toBe('Reuters');
    });

    it('returns undefined for unknown id', () => {
      const source = getSourceById('unknown');
      expect(source).toBeUndefined();
    });
  });

  describe('countWords', () => {
    it('counts words correctly', () => {
      expect(countWords('one two three')).toBe(3);
      expect(countWords('hello world')).toBe(2);
    });

    it('handles multiple spaces', () => {
      expect(countWords('one   two    three')).toBe(3);
    });

    it('handles empty string', () => {
      expect(countWords('')).toBe(0);
    });

    it('handles whitespace only', () => {
      expect(countWords('   ')).toBe(0);
    });
  });

  describe('truncateToMaxWords', () => {
    it('truncates text exceeding max words', () => {
      const text = 'one two three four five six seven eight nine ten';
      const truncated = truncateToMaxWords(text, 5);
      expect(truncated).toBe('one two three four five...');
    });

    it('returns original text if under max words', () => {
      const text = 'one two three';
      const truncated = truncateToMaxWords(text, 10);
      expect(truncated).toBe(text);
    });

    it('returns original text if exactly max words', () => {
      const text = 'one two three';
      const truncated = truncateToMaxWords(text, 3);
      expect(truncated).toBe(text);
    });
  });

  describe('formatSourceType', () => {
    it('formats source types for display', () => {
      expect(formatSourceType('news')).toBe('News');
      expect(formatSourceType('press_release')).toBe('Press Release');
      expect(formatSourceType('sec_filing')).toBe('SEC Filing');
      expect(formatSourceType('earnings')).toBe('Earnings');
      expect(formatSourceType('analyst')).toBe('Analyst Report');
    });
  });

  describe('formatSentiment', () => {
    it('formats sentiment for display', () => {
      expect(formatSentiment('bullish')).toBe('Bullish');
      expect(formatSentiment('bearish')).toBe('Bearish');
      expect(formatSentiment('neutral')).toBe('Neutral');
      expect(formatSentiment('mixed')).toBe('Mixed');
    });
  });

  describe('validateResearchNote', () => {
    it('validates a valid research note', () => {
      const note = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        urlHash: 'abc123',
        url: 'https://reuters.com/article',
        sourceId: 'reuters',
        sourceName: 'Reuters',
        sourceType: 'news',
        headline: 'Test Headline',
        publishedAt: '2024-01-15T10:00:00Z',
        bodyText: 'Article body text here.',
        symbols: ['AAPL'],
        tags: ['tech'],
        wordCount: 50,
        trustScore: 0.95,
        ingestedAt: '2024-01-15T10:30:00Z',
        updatedAt: '2024-01-15T10:30:00Z',
        isRead: false,
        isFlagged: false,
      };
      const result = validateResearchNote(note);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('returns errors for invalid note', () => {
      const note = {
        id: 'not-a-uuid',
        headline: '',
      };
      const result = validateResearchNote(note);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('validateIngestionRequest', () => {
    it('validates a valid ingestion request', () => {
      const request = {
        url: 'https://www.reuters.com/article/123',
        symbols: ['AAPL'],
        tags: ['tech'],
      };
      const result = validateIngestionRequest(request);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('warns for non-allowed source', () => {
      const request = {
        url: 'https://random-blog.com/article',
      };
      const result = validateIngestionRequest(request);
      expect(result.valid).toBe(true);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain('not from an allowed news source');
    });

    it('returns errors for invalid URL', () => {
      const request = {
        url: 'not-a-valid-url',
      };
      const result = validateIngestionRequest(request);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('createResearchNoteFromArticle', () => {
    it('creates a research note from extracted article', () => {
      const article: ExtractedArticle = {
        headline: 'Apple Reports Q4 Earnings',
        publishedAt: '2024-01-15T10:00:00Z',
        bodyText: 'Apple Inc. (NASDAQ: AAPL) reported strong earnings today.',
        url: 'https://www.reuters.com/article/123',
        sourceId: 'reuters',
        sourceName: 'Reuters',
        sourceType: 'news',
        wordCount: 50,
        extractedAt: '2024-01-15T10:30:00Z',
      };

      const note = createResearchNoteFromArticle(article, {
        symbols: ['MSFT'],
        tags: ['earnings'],
      });

      expect(note.headline).toBe(article.headline);
      expect(note.url).toBe(article.url);
      expect(note.symbols).toContain('AAPL'); // Auto-extracted
      expect(note.symbols).toContain('MSFT'); // Provided
      expect(note.tags).toContain('earnings');
      expect(note.isRead).toBe(false);
      expect(note.isFlagged).toBe(false);
      expect(note.id).toBeDefined();
      expect(note.urlHash).toBeDefined();
    });

    it('auto-extracts symbols from headline and body', () => {
      const article: ExtractedArticle = {
        headline: '$TSLA shares surge',
        publishedAt: '2024-01-15T10:00:00Z',
        bodyText: 'Tesla (NASDAQ: TSLA) stock jumped 10% following the announcement.',
        url: 'https://www.reuters.com/article/456',
        sourceId: 'reuters',
        sourceName: 'Reuters',
        sourceType: 'news',
        wordCount: 20,
        extractedAt: '2024-01-15T10:30:00Z',
      };

      const note = createResearchNoteFromArticle(article);
      expect(note.symbols).toContain('TSLA');
    });
  });

  describe('ALLOWED_NEWS_SOURCES', () => {
    it('contains expected sources', () => {
      const sourceIds = ALLOWED_NEWS_SOURCES.map((s) => s.id);
      expect(sourceIds).toContain('reuters');
      expect(sourceIds).toContain('bloomberg');
      expect(sourceIds).toContain('sec_edgar');
      expect(sourceIds).toContain('yahoo_finance');
    });

    it('all sources have required fields', () => {
      for (const source of ALLOWED_NEWS_SOURCES) {
        expect(source.id).toBeDefined();
        expect(source.name).toBeDefined();
        expect(source.type).toBeDefined();
        expect(source.baseUrl).toBeDefined();
        expect(source.enabled).toBeDefined();
        expect(source.trustScore).toBeGreaterThanOrEqual(0);
        expect(source.trustScore).toBeLessThanOrEqual(1);
      }
    });
  });
});
