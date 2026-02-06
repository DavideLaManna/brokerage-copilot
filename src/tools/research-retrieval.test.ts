/**
 * Research Retrieval Tool Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  SearchResearchInputSchema,
  searchResearch,
  createSearchResearchTool,
  getResearch,
  getResearchBySymbol,
  getRecentResearch,
  getResearchBySentiment,
  researchNotesToDataSources,
  formatResearchCitations,
  type SearchResearchInput,
  type ResearchNoteSnapshot,
  type ResearchSearchResult,
  type ResearchRetrievalToolContext,
} from './research-retrieval.js';
import { ResearchStorageService, createResearchStorageService } from '../services/research-storage.js';
import type { StoredResearchNote, ResearchNote, ArticleSummary } from '../types/research.js';
import { generateUrlHash } from '../types/research.js';

// ============================================================================
// Test Helpers
// ============================================================================

const TEST_STORAGE_DIR = '.test-research-retrieval';
const TEST_PASSWORD = 'test-password-123';

/**
 * Create a mock research note
 */
function createMockNote(overrides: Partial<ResearchNote> = {}): ResearchNote {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  return {
    id,
    urlHash: generateUrlHash(`https://example.com/article/${id}`),
    url: `https://example.com/article/${id}`,
    sourceId: 'reuters',
    sourceName: 'Reuters',
    sourceType: 'news',
    headline: 'Test Article Headline',
    publishedAt: now,
    bodyText: 'This is the body text of the test article.',
    symbols: ['AAPL'],
    tags: ['earnings'],
    wordCount: 100,
    trustScore: 0.9,
    ingestedAt: now,
    updatedAt: now,
    isRead: false,
    isFlagged: false,
    ...overrides,
  };
}

/**
 * Create a mock article summary
 */
function createMockSummary(overrides: Partial<ArticleSummary> = {}): ArticleSummary {
  return {
    shortSummary: 'This is a short summary of the article.',
    keyTakeaways: ['Key point 1', 'Key point 2', 'Key point 3'],
    sentiment: 'bullish',
    sentimentConfidence: 0.85,
    keyDataPoints: [
      {
        type: 'earnings',
        description: 'EPS beat expectations',
        value: '$1.50',
      },
    ],
    timeHorizon: 'short_term',
    tokensUsed: 500,
    modelUsed: 'claude-3-haiku',
    generatedAt: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Clean up test directory
 */
function cleanupTestDir(): void {
  if (fs.existsSync(TEST_STORAGE_DIR)) {
    fs.rmSync(TEST_STORAGE_DIR, { recursive: true, force: true });
  }
}

// ============================================================================
// Input Schema Tests
// ============================================================================

describe('SearchResearchInputSchema', () => {
  it('accepts valid input with symbol only', () => {
    const input = { symbol: 'AAPL' };
    const result = SearchResearchInputSchema.parse(input);
    expect(result.symbol).toBe('AAPL');
  });

  it('accepts valid input with keywords only', () => {
    const input = { keywords: ['earnings', 'guidance'] };
    const result = SearchResearchInputSchema.parse(input);
    expect(result.keywords).toEqual(['earnings', 'guidance']);
  });

  it('accepts valid input with all options', () => {
    const input: SearchResearchInput = {
      symbol: 'AAPL',
      keywords: ['earnings'],
      sourceTypes: ['news', 'sec_filing'],
      sentiment: ['bullish', 'neutral'],
      publishedAfter: '2024-01-01T00:00:00Z',
      publishedBefore: '2024-12-31T23:59:59Z',
      flaggedOnly: true,
      hasSummary: true,
      limit: 50,
      offset: 10,
      sortBy: 'trustScore',
      sortOrder: 'asc',
    };
    const result = SearchResearchInputSchema.parse(input);
    expect(result).toEqual(input);
  });

  it('converts symbol to uppercase', () => {
    const input = { symbol: 'aapl' };
    const result = SearchResearchInputSchema.parse(input);
    expect(result.symbol).toBe('AAPL');
  });

  it('accepts empty input (searches all)', () => {
    const input = {};
    const result = SearchResearchInputSchema.parse(input);
    expect(result).toEqual({});
  });

  it('rejects invalid source types', () => {
    const input = { sourceTypes: ['invalid_type'] };
    expect(() => SearchResearchInputSchema.parse(input)).toThrow();
  });

  it('rejects invalid sentiment', () => {
    const input = { sentiment: ['very_bullish'] };
    expect(() => SearchResearchInputSchema.parse(input)).toThrow();
  });

  it('rejects limit greater than 100', () => {
    const input = { limit: 101 };
    expect(() => SearchResearchInputSchema.parse(input)).toThrow();
  });

  it('rejects negative offset', () => {
    const input = { offset: -1 };
    expect(() => SearchResearchInputSchema.parse(input)).toThrow();
  });

  it('rejects empty symbol', () => {
    const input = { symbol: '' };
    expect(() => SearchResearchInputSchema.parse(input)).toThrow();
  });

  it('rejects empty keywords', () => {
    const input = { keywords: [''] };
    expect(() => SearchResearchInputSchema.parse(input)).toThrow();
  });
});

// ============================================================================
// Search Function Tests
// ============================================================================

describe('searchResearch', () => {
  let storage: ResearchStorageService;

  beforeEach(async () => {
    cleanupTestDir();
    storage = createResearchStorageService({
      storageDir: TEST_STORAGE_DIR,
      masterPassword: TEST_PASSWORD,
    });
    await storage.initialize();
  });

  afterEach(() => {
    cleanupTestDir();
  });

  it('returns empty results when no notes exist', async () => {
    const result = await searchResearch(storage, {});
    expect(result.notes).toHaveLength(0);
    expect(result.totalCount).toBe(0);
    expect(result.hasMore).toBe(false);
  });

  it('finds notes by symbol', async () => {
    const note = createMockNote({ symbols: ['AAPL', 'GOOG'] });
    await storage.save(note);

    const result = await searchResearch(storage, { symbol: 'AAPL' });
    expect(result.notes).toHaveLength(1);
    expect(result.notes[0].symbols).toContain('AAPL');
  });

  it('finds notes by keywords in headline', async () => {
    const note = createMockNote({ headline: 'Apple reports strong earnings growth' });
    await storage.save(note);

    const result = await searchResearch(storage, { keywords: ['earnings', 'growth'] });
    expect(result.notes).toHaveLength(1);
    expect(result.notes[0].headline).toContain('earnings');
  });

  it('finds notes by keywords in body', async () => {
    const note = createMockNote({ bodyText: 'The company announced a significant dividend increase.' });
    await storage.save(note);

    const result = await searchResearch(storage, { keywords: ['dividend'] });
    expect(result.notes).toHaveLength(1);
  });

  it('filters by source type', async () => {
    const newsNote = createMockNote({ sourceType: 'news' });
    const secNote = createMockNote({ sourceType: 'sec_filing' });
    await storage.save(newsNote);
    await storage.save(secNote);

    const result = await searchResearch(storage, { sourceTypes: ['sec_filing'] });
    expect(result.notes).toHaveLength(1);
    expect(result.notes[0].sourceType).toBe('sec_filing');
  });

  it('filters by sentiment', async () => {
    const bullishNote = createMockNote({ summary: createMockSummary({ sentiment: 'bullish' }) });
    const bearishNote = createMockNote({ summary: createMockSummary({ sentiment: 'bearish' }) });
    await storage.save(bullishNote);
    await storage.save(bearishNote);

    const result = await searchResearch(storage, { sentiment: ['bullish'] });
    expect(result.notes).toHaveLength(1);
    expect(result.notes[0].sentiment).toBe('bullish');
  });

  it('filters by date range', async () => {
    const oldNote = createMockNote({ publishedAt: '2023-01-01T00:00:00Z' });
    const newNote = createMockNote({ publishedAt: '2024-06-15T00:00:00Z' });
    await storage.save(oldNote);
    await storage.save(newNote);

    const result = await searchResearch(storage, {
      publishedAfter: '2024-01-01T00:00:00Z',
    });
    expect(result.notes).toHaveLength(1);
  });

  it('filters flagged notes only', async () => {
    const flaggedNote = createMockNote({ isFlagged: true });
    const normalNote = createMockNote({ isFlagged: false });
    await storage.save(flaggedNote);
    await storage.save(normalNote);

    const result = await searchResearch(storage, { flaggedOnly: true });
    expect(result.notes).toHaveLength(1);
    expect(result.notes[0].isFlagged).toBe(true);
  });

  it('filters notes with summaries', async () => {
    const withSummary = createMockNote({ summary: createMockSummary() });
    const withoutSummary = createMockNote();
    await storage.save(withSummary);
    await storage.save(withoutSummary);

    const result = await searchResearch(storage, { hasSummary: true });
    expect(result.notes).toHaveLength(1);
    expect(result.notes[0].shortSummary).toBeDefined();
  });

  it('respects limit and offset', async () => {
    // Create 5 notes
    for (let i = 0; i < 5; i++) {
      const note = createMockNote({ headline: `Article ${i}` });
      await storage.save(note);
    }

    const result = await searchResearch(storage, { limit: 2, offset: 1 });
    expect(result.notes).toHaveLength(2);
    expect(result.totalCount).toBe(5);
    expect(result.hasMore).toBe(true);
  });

  it('sorts by trust score', async () => {
    const lowTrust = createMockNote({ trustScore: 0.5 });
    const highTrust = createMockNote({ trustScore: 0.95 });
    await storage.save(lowTrust);
    await storage.save(highTrust);

    const result = await searchResearch(storage, {
      sortBy: 'trustScore',
      sortOrder: 'desc',
    });
    expect(result.notes[0].trustScore).toBeGreaterThan(result.notes[1].trustScore);
  });

  it('includes summary statistics', async () => {
    const note1 = createMockNote({
      sourceType: 'news',
      summary: createMockSummary({ sentiment: 'bullish' }),
    });
    const note2 = createMockNote({
      sourceType: 'sec_filing',
      summary: createMockSummary({ sentiment: 'bearish' }),
    });
    await storage.save(note1);
    await storage.save(note2);

    const result = await searchResearch(storage, {});
    expect(result.summary.sourceTypeCounts['news']).toBe(1);
    expect(result.summary.sourceTypeCounts['sec_filing']).toBe(1);
    expect(result.summary.sentimentCounts['bullish']).toBe(1);
    expect(result.summary.sentimentCounts['bearish']).toBe(1);
    expect(result.summary.withSummaryCount).toBe(2);
    expect(result.summary.averageTrustScore).toBeGreaterThan(0);
  });

  it('includes data timestamp and sources', async () => {
    const result = await searchResearch(storage, {});
    expect(result.dataTimestamp).toBeDefined();
    expect(result.dataSources).toHaveLength(1);
    expect(result.dataSources[0].source).toBe('Research Storage');
  });

  it('converts notes to snapshots with all fields', async () => {
    const summary = createMockSummary();
    const note = createMockNote({
      summary,
      userNotes: 'My notes about this article',
      isFlagged: true,
    });
    await storage.save(note);

    const result = await searchResearch(storage, {});
    const snapshot = result.notes[0];

    expect(snapshot.id).toBe(note.id);
    expect(snapshot.headline).toBe(note.headline);
    expect(snapshot.sourceName).toBe(note.sourceName);
    expect(snapshot.sourceType).toBe(note.sourceType);
    expect(snapshot.url).toBe(note.url);
    expect(snapshot.symbols).toEqual(note.symbols);
    expect(snapshot.trustScore).toBe(note.trustScore);
    expect(snapshot.shortSummary).toBe(summary.shortSummary);
    expect(snapshot.keyTakeaways).toEqual(summary.keyTakeaways);
    expect(snapshot.sentiment).toBe(summary.sentiment);
    expect(snapshot.sentimentConfidence).toBe(summary.sentimentConfidence);
    expect(snapshot.keyDataPoints).toEqual(summary.keyDataPoints);
    expect(snapshot.timeHorizon).toBe(summary.timeHorizon);
    expect(snapshot.userNotes).toBe('My notes about this article');
    expect(snapshot.isFlagged).toBe(true);
  });
});

// ============================================================================
// Convenience Function Tests
// ============================================================================

describe('getResearchBySymbol', () => {
  let storage: ResearchStorageService;

  beforeEach(async () => {
    cleanupTestDir();
    storage = createResearchStorageService({
      storageDir: TEST_STORAGE_DIR,
      masterPassword: TEST_PASSWORD,
    });
    await storage.initialize();
  });

  afterEach(() => {
    cleanupTestDir();
  });

  it('searches by symbol with uppercase conversion', async () => {
    const note = createMockNote({ symbols: ['AAPL'] });
    await storage.save(note);

    const result = await getResearchBySymbol(storage, 'aapl');
    expect(result.notes).toHaveLength(1);
    expect(result.request.symbol).toBe('AAPL');
  });

  it('uses default limit of 10', async () => {
    const result = await getResearchBySymbol(storage, 'AAPL');
    expect(result.request.limit).toBe(10);
  });
});

describe('getRecentResearch', () => {
  let storage: ResearchStorageService;

  beforeEach(async () => {
    cleanupTestDir();
    storage = createResearchStorageService({
      storageDir: TEST_STORAGE_DIR,
      masterPassword: TEST_PASSWORD,
    });
    await storage.initialize();
  });

  afterEach(() => {
    cleanupTestDir();
  });

  it('returns recent notes sorted by ingestedAt', async () => {
    const note = createMockNote();
    await storage.save(note);

    const result = await getRecentResearch(storage);
    expect(result.request.sortBy).toBe('ingestedAt');
    expect(result.request.sortOrder).toBe('desc');
  });

  it('uses default limit of 20', async () => {
    const result = await getRecentResearch(storage);
    expect(result.request.limit).toBe(20);
  });
});

describe('getResearchBySentiment', () => {
  let storage: ResearchStorageService;

  beforeEach(async () => {
    cleanupTestDir();
    storage = createResearchStorageService({
      storageDir: TEST_STORAGE_DIR,
      masterPassword: TEST_PASSWORD,
    });
    await storage.initialize();
  });

  afterEach(() => {
    cleanupTestDir();
  });

  it('filters by sentiment', async () => {
    const bullishNote = createMockNote({ summary: createMockSummary({ sentiment: 'bullish' }) });
    await storage.save(bullishNote);

    const result = await getResearchBySentiment(storage, 'bullish');
    expect(result.notes).toHaveLength(1);
    expect(result.notes[0].sentiment).toBe('bullish');
  });

  it('combines sentiment and symbol filter', async () => {
    const aaplBullish = createMockNote({
      symbols: ['AAPL'],
      summary: createMockSummary({ sentiment: 'bullish' }),
    });
    const googBullish = createMockNote({
      symbols: ['GOOG'],
      summary: createMockSummary({ sentiment: 'bullish' }),
    });
    await storage.save(aaplBullish);
    await storage.save(googBullish);

    const result = await getResearchBySentiment(storage, 'bullish', 'AAPL');
    expect(result.notes).toHaveLength(1);
    expect(result.notes[0].symbols).toContain('AAPL');
  });
});

// ============================================================================
// DataSource Conversion Tests
// ============================================================================

describe('researchNotesToDataSources', () => {
  it('converts news notes to news data sources', () => {
    const note: ResearchNoteSnapshot = {
      id: '123',
      headline: 'Apple Reports Record Earnings',
      sourceName: 'Reuters',
      sourceType: 'news',
      publishedAt: '2024-01-15T10:00:00Z',
      ingestedAt: '2024-01-15T11:00:00Z',
      url: 'https://reuters.com/article/123',
      symbols: ['AAPL'],
      trustScore: 0.95,
      tags: [],
      wordCount: 500,
      isFlagged: false,
      sentiment: 'bullish',
    };

    const dataSources = researchNotesToDataSources([note]);
    expect(dataSources).toHaveLength(1);
    expect(dataSources[0].sourceType).toBe('news');
    expect(dataSources[0].description).toContain('Reuters');
    expect(dataSources[0].description).toContain('Apple Reports Record Earnings');
    expect(dataSources[0].description).toContain('bullish');
    expect(dataSources[0].reference).toBe('123');
  });

  it('converts sec_filing notes to research data sources', () => {
    const note: ResearchNoteSnapshot = {
      id: '456',
      headline: 'Form 10-K Annual Report',
      sourceName: 'SEC EDGAR',
      sourceType: 'sec_filing',
      publishedAt: '2024-01-15T10:00:00Z',
      ingestedAt: '2024-01-15T11:00:00Z',
      url: 'https://sec.gov/filing/456',
      symbols: ['AAPL'],
      trustScore: 1.0,
      tags: [],
      wordCount: 10000,
      isFlagged: false,
    };

    const dataSources = researchNotesToDataSources([note]);
    expect(dataSources[0].sourceType).toBe('research');
  });

  it('converts earnings notes to earnings data sources', () => {
    const note: ResearchNoteSnapshot = {
      id: '789',
      headline: 'Q4 Earnings Call Transcript',
      sourceName: 'Seeking Alpha',
      sourceType: 'earnings',
      publishedAt: '2024-01-15T10:00:00Z',
      ingestedAt: '2024-01-15T11:00:00Z',
      url: 'https://seekingalpha.com/earnings/789',
      symbols: ['AAPL'],
      trustScore: 0.7,
      tags: [],
      wordCount: 5000,
      isFlagged: false,
    };

    const dataSources = researchNotesToDataSources([note]);
    expect(dataSources[0].sourceType).toBe('earnings');
  });

  it('handles multiple notes', () => {
    const notes: ResearchNoteSnapshot[] = [
      {
        id: '1',
        headline: 'News Article',
        sourceName: 'Reuters',
        sourceType: 'news',
        publishedAt: '2024-01-15T10:00:00Z',
        ingestedAt: '2024-01-15T11:00:00Z',
        url: 'https://reuters.com/1',
        symbols: ['AAPL'],
        trustScore: 0.9,
        tags: [],
        wordCount: 100,
        isFlagged: false,
      },
      {
        id: '2',
        headline: 'SEC Filing',
        sourceName: 'SEC EDGAR',
        sourceType: 'sec_filing',
        publishedAt: '2024-01-15T10:00:00Z',
        ingestedAt: '2024-01-15T11:00:00Z',
        url: 'https://sec.gov/2',
        symbols: ['AAPL'],
        trustScore: 1.0,
        tags: [],
        wordCount: 1000,
        isFlagged: false,
      },
    ];

    const dataSources = researchNotesToDataSources(notes);
    expect(dataSources).toHaveLength(2);
    expect(dataSources[0].reference).toBe('1');
    expect(dataSources[1].reference).toBe('2');
  });

  it('returns empty array for empty input', () => {
    const dataSources = researchNotesToDataSources([]);
    expect(dataSources).toHaveLength(0);
  });
});

// ============================================================================
// Citation Formatting Tests
// ============================================================================

describe('formatResearchCitations', () => {
  it('formats single citation', () => {
    const notes: ResearchNoteSnapshot[] = [
      {
        id: '1',
        headline: 'Apple Reports Record Earnings',
        sourceName: 'Reuters',
        sourceType: 'news',
        publishedAt: '2024-01-15T10:00:00Z',
        ingestedAt: '2024-01-15T11:00:00Z',
        url: 'https://reuters.com/1',
        symbols: ['AAPL'],
        trustScore: 0.9,
        tags: [],
        wordCount: 100,
        isFlagged: false,
      },
    ];

    const citation = formatResearchCitations(notes);
    expect(citation).toContain('Sources:');
    expect(citation).toContain('[1] Reuters');
    expect(citation).toContain('Apple Reports Record Earnings');
  });

  it('formats multiple citations with numbers', () => {
    const notes: ResearchNoteSnapshot[] = [
      {
        id: '1',
        headline: 'First Article',
        sourceName: 'Reuters',
        sourceType: 'news',
        publishedAt: '2024-01-15T10:00:00Z',
        ingestedAt: '2024-01-15T11:00:00Z',
        url: 'https://reuters.com/1',
        symbols: ['AAPL'],
        trustScore: 0.9,
        tags: [],
        wordCount: 100,
        isFlagged: false,
      },
      {
        id: '2',
        headline: 'Second Article',
        sourceName: 'Bloomberg',
        sourceType: 'news',
        publishedAt: '2024-01-16T10:00:00Z',
        ingestedAt: '2024-01-16T11:00:00Z',
        url: 'https://bloomberg.com/2',
        symbols: ['AAPL'],
        trustScore: 0.95,
        tags: [],
        wordCount: 200,
        isFlagged: false,
      },
    ];

    const citation = formatResearchCitations(notes);
    expect(citation).toContain('[1] Reuters');
    expect(citation).toContain('[2] Bloomberg');
  });

  it('returns empty string for empty array', () => {
    const citation = formatResearchCitations([]);
    expect(citation).toBe('');
  });
});

// ============================================================================
// MCP Tool Tests
// ============================================================================

describe('createSearchResearchTool', () => {
  let storage: ResearchStorageService;
  let tool: ReturnType<typeof createSearchResearchTool>;

  beforeEach(async () => {
    cleanupTestDir();
    storage = createResearchStorageService({
      storageDir: TEST_STORAGE_DIR,
      masterPassword: TEST_PASSWORD,
    });
    await storage.initialize();

    const context: ResearchRetrievalToolContext = { storage };
    tool = createSearchResearchTool(context);
  });

  afterEach(() => {
    cleanupTestDir();
  });

  it('has correct name and description', () => {
    expect(tool.name).toBe('search_research');
    expect(tool.description).toContain('Search and retrieve research notes');
    expect(tool.description).toContain('symbol');
    expect(tool.description).toContain('keywords');
  });

  it('returns success with empty results', async () => {
    const result = await tool.handler({});
    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect((result.data as ResearchSearchResult).notes).toHaveLength(0);
  });

  it('returns success with matching notes', async () => {
    const note = createMockNote({ symbols: ['AAPL'] });
    await storage.save(note);

    const result = await tool.handler({ symbol: 'AAPL' });
    expect(result.success).toBe(true);
    expect((result.data as ResearchSearchResult).notes).toHaveLength(1);
  });

  it('includes metadata in result', async () => {
    const note = createMockNote({ summary: createMockSummary() });
    await storage.save(note);

    const result = await tool.handler({});
    expect(result.metadata).toBeDefined();
    expect(result.metadata?.totalCount).toBe(1);
    expect(result.metadata?.returnedCount).toBe(1);
    expect(result.metadata?.withSummaryCount).toBe(1);
  });

  it('returns error when storage is null', async () => {
    const context: ResearchRetrievalToolContext = { storage: null };
    const nullTool = createSearchResearchTool(context);

    const result = await nullTool.handler({ symbol: 'AAPL' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Research storage not available');
  });

  it('returns error for invalid input', async () => {
    const result = await tool.handler({ limit: 1000 }); // exceeds max
    expect(result.success).toBe(false);
    expect(result.error).toContain('Failed to search research');
  });

  it('includes timestamp', async () => {
    const result = await tool.handler({});
    expect(result.timestamp).toBeDefined();
    expect(new Date(result.timestamp).getTime()).toBeLessThanOrEqual(Date.now());
  });
});

// ============================================================================
// Integration Tests
// ============================================================================

describe('Research Retrieval Integration', () => {
  let storage: ResearchStorageService;

  beforeEach(async () => {
    cleanupTestDir();
    storage = createResearchStorageService({
      storageDir: TEST_STORAGE_DIR,
      masterPassword: TEST_PASSWORD,
    });
    await storage.initialize();
  });

  afterEach(() => {
    cleanupTestDir();
  });

  it('supports complex multi-criteria search', async () => {
    // Create diverse notes
    await storage.save(createMockNote({
      symbols: ['AAPL'],
      sourceType: 'news',
      headline: 'Apple earnings beat expectations',
      summary: createMockSummary({ sentiment: 'bullish' }),
      publishedAt: '2024-06-15T10:00:00Z',
      isFlagged: true,
    }));

    await storage.save(createMockNote({
      symbols: ['AAPL'],
      sourceType: 'sec_filing',
      headline: 'Apple Form 10-K Annual Report',
      summary: createMockSummary({ sentiment: 'neutral' }),
      publishedAt: '2024-03-01T10:00:00Z',
    }));

    await storage.save(createMockNote({
      symbols: ['GOOG'],
      sourceType: 'news',
      headline: 'Google announces AI partnership',
      summary: createMockSummary({ sentiment: 'bullish' }),
      publishedAt: '2024-06-20T10:00:00Z',
    }));

    // Complex search: AAPL, news only, bullish, recent
    const result = await searchResearch(storage, {
      symbol: 'AAPL',
      sourceTypes: ['news'],
      sentiment: ['bullish'],
      publishedAfter: '2024-05-01T00:00:00Z',
    });

    expect(result.notes).toHaveLength(1);
    expect(result.notes[0].headline).toContain('Apple earnings');
    expect(result.notes[0].symbols).toContain('AAPL');
    expect(result.notes[0].sourceType).toBe('news');
    expect(result.notes[0].sentiment).toBe('bullish');
  });

  it('provides accurate summary statistics', async () => {
    await storage.save(createMockNote({
      sourceType: 'news',
      trustScore: 0.9,
      summary: createMockSummary({ sentiment: 'bullish' }),
    }));

    await storage.save(createMockNote({
      sourceType: 'news',
      trustScore: 0.8,
      summary: createMockSummary({ sentiment: 'bearish' }),
    }));

    await storage.save(createMockNote({
      sourceType: 'sec_filing',
      trustScore: 1.0,
      // No summary
    }));

    const result = await searchResearch(storage, {});

    expect(result.summary.sourceTypeCounts['news']).toBe(2);
    expect(result.summary.sourceTypeCounts['sec_filing']).toBe(1);
    expect(result.summary.sentimentCounts['bullish']).toBe(1);
    expect(result.summary.sentimentCounts['bearish']).toBe(1);
    expect(result.summary.withSummaryCount).toBe(2);
    expect(result.summary.averageTrustScore).toBeCloseTo(0.9, 1);
  });

  it('generates proper data sources for trade proposals', async () => {
    const note = createMockNote({
      headline: 'Important Market News',
      sourceName: 'Bloomberg',
      sourceType: 'news',
      summary: createMockSummary({ sentiment: 'bullish' }),
    });
    await storage.save(note);

    const searchResult = await searchResearch(storage, {});
    const dataSources = researchNotesToDataSources(searchResult.notes);

    expect(dataSources).toHaveLength(1);
    expect(dataSources[0].sourceType).toBe('news');
    expect(dataSources[0].description).toContain('Bloomberg');
    expect(dataSources[0].description).toContain('Important Market News');
    expect(dataSources[0].description).toContain('bullish');
    expect(dataSources[0].reference).toBe(note.id);
    expect(dataSources[0].retrievedAt).toBeInstanceOf(Date);
  });
});
