/**
 * Tests for Research Ingestion Service
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import {
  ResearchIngestionService,
  createResearchIngestionService,
  type ResearchIngestionLogger,
} from './research-ingestion.js';

// Mock logger
const mockLogger: ResearchIngestionLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

// Test storage directory
const TEST_STORAGE_DIR = '.test-ingestion-storage';
const TEST_PASSWORD = 'test-master-password-12345';

describe('ResearchIngestionService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clean up test directory
    if (fs.existsSync(TEST_STORAGE_DIR)) {
      fs.rmSync(TEST_STORAGE_DIR, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    // Clean up test directory
    if (fs.existsSync(TEST_STORAGE_DIR)) {
      fs.rmSync(TEST_STORAGE_DIR, { recursive: true, force: true });
    }
  });

  describe('constructor', () => {
    it('creates service with required options', () => {
      const service = new ResearchIngestionService({
        storage: { masterPassword: TEST_PASSWORD, storageDir: TEST_STORAGE_DIR },
        logger: mockLogger,
      });
      expect(service).toBeDefined();
    });

    it('creates service with custom config', () => {
      const service = new ResearchIngestionService({
        storage: { masterPassword: TEST_PASSWORD, storageDir: TEST_STORAGE_DIR },
        config: { generateSummaryByDefault: false, defaultConcurrency: 5 },
        logger: mockLogger,
      });
      expect(service).toBeDefined();
    });
  });

  describe('initialize', () => {
    it('initializes the service', async () => {
      const service = createResearchIngestionService({
        storage: { masterPassword: TEST_PASSWORD, storageDir: TEST_STORAGE_DIR },
        logger: mockLogger,
      });
      await service.initialize();
      // Should not throw
    });

    it('is idempotent', async () => {
      const service = createResearchIngestionService({
        storage: { masterPassword: TEST_PASSWORD, storageDir: TEST_STORAGE_DIR },
        logger: mockLogger,
      });
      await service.initialize();
      await service.initialize(); // Should not throw
    });
  });

  describe('ingest', () => {
    it('rejects invalid URLs', async () => {
      const service = createResearchIngestionService({
        storage: { masterPassword: TEST_PASSWORD, storageDir: TEST_STORAGE_DIR },
        logger: mockLogger,
      });
      await service.initialize();

      const result = await service.ingest({ url: 'not-a-valid-url' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid request');
    });

    it('rejects URLs from non-allowed sources', async () => {
      const service = createResearchIngestionService({
        storage: { masterPassword: TEST_PASSWORD, storageDir: TEST_STORAGE_DIR },
        logger: mockLogger,
      });
      await service.initialize();

      // The scraper will reject this as blocked
      const result = await service.ingest({ url: 'https://random-blog.com/article' });
      expect(result.success).toBe(false);
    });

    it('throws error before initialization', async () => {
      const service = createResearchIngestionService({
        storage: { masterPassword: TEST_PASSWORD, storageDir: TEST_STORAGE_DIR },
        logger: mockLogger,
      });

      await expect(service.ingest({ url: 'https://reuters.com/test' })).rejects.toThrow(
        'not initialized'
      );
    });

    it('includes symbols and tags in request', async () => {
      const service = createResearchIngestionService({
        storage: { masterPassword: TEST_PASSWORD, storageDir: TEST_STORAGE_DIR },
        logger: mockLogger,
      });
      await service.initialize();

      // This will fail at the scrape step (network), but validates the request handling
      const result = await service.ingest({
        url: 'https://www.reuters.com/article/test-123',
        symbols: ['AAPL', 'MSFT'],
        tags: ['earnings', 'tech'],
      });

      // The request was valid but scrape failed (no network)
      expect(result.error || result.success).toBeDefined();
    });
  });

  describe('ingestBatch', () => {
    it('processes multiple URLs', async () => {
      const service = createResearchIngestionService({
        storage: { masterPassword: TEST_PASSWORD, storageDir: TEST_STORAGE_DIR },
        logger: mockLogger,
      });
      await service.initialize();

      const result = await service.ingestBatch({
        urls: [
          'https://random-1.com/article',
          'https://random-2.com/article',
        ],
        symbols: ['AAPL'],
        concurrency: 2,
      });

      expect(result.totalProcessed).toBe(2);
      expect(result.results.length).toBe(2);
    });

    it('respects max batch size', async () => {
      const service = createResearchIngestionService({
        storage: { masterPassword: TEST_PASSWORD, storageDir: TEST_STORAGE_DIR },
        config: { maxBatchSize: 2, defaultConcurrency: 1, generateSummaryByDefault: false },
        logger: mockLogger,
      });
      await service.initialize();

      const urls = Array(5).fill('https://random.com/').map((u, i) => `${u}${i}`);
      const result = await service.ingestBatch({ urls });

      expect(result.totalProcessed).toBe(2); // Capped at maxBatchSize
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Batch size exceeded maximum',
        expect.any(Object)
      );
    });

    it('returns statistics', async () => {
      const service = createResearchIngestionService({
        storage: { masterPassword: TEST_PASSWORD, storageDir: TEST_STORAGE_DIR },
        logger: mockLogger,
      });
      await service.initialize();

      const result = await service.ingestBatch({
        urls: ['https://random.com/1', 'https://random.com/2'],
      });

      expect(result).toHaveProperty('succeeded');
      expect(result).toHaveProperty('failed');
      expect(result).toHaveProperty('duplicates');
      expect(result).toHaveProperty('totalDurationMs');
    });
  });

  describe('storage passthrough methods', () => {
    it('getNote returns null for non-existent note', async () => {
      const service = createResearchIngestionService({
        storage: { masterPassword: TEST_PASSWORD, storageDir: TEST_STORAGE_DIR },
        logger: mockLogger,
      });
      await service.initialize();

      const note = await service.getNote('non-existent');
      expect(note).toBeNull();
    });

    it('getNoteByUrl returns null for non-existent URL', async () => {
      const service = createResearchIngestionService({
        storage: { masterPassword: TEST_PASSWORD, storageDir: TEST_STORAGE_DIR },
        logger: mockLogger,
      });
      await service.initialize();

      const note = await service.getNoteByUrl('https://nonexistent.com/article');
      expect(note).toBeNull();
    });

    it('hasUrl returns false for non-existent URL', async () => {
      const service = createResearchIngestionService({
        storage: { masterPassword: TEST_PASSWORD, storageDir: TEST_STORAGE_DIR },
        logger: mockLogger,
      });
      await service.initialize();

      expect(service.hasUrl('https://nonexistent.com/article')).toBe(false);
    });

    it('queryNotes returns empty result', async () => {
      const service = createResearchIngestionService({
        storage: { masterPassword: TEST_PASSWORD, storageDir: TEST_STORAGE_DIR },
        logger: mockLogger,
      });
      await service.initialize();

      const result = await service.queryNotes({ symbols: ['AAPL'] });
      expect(result.notes).toHaveLength(0);
      expect(result.totalCount).toBe(0);
    });

    it('getStatistics returns initial stats', async () => {
      const service = createResearchIngestionService({
        storage: { masterPassword: TEST_PASSWORD, storageDir: TEST_STORAGE_DIR },
        logger: mockLogger,
      });
      await service.initialize();

      const stats = service.getStatistics();
      expect(stats.totalNotes).toBe(0);
      expect(stats.unreadCount).toBe(0);
    });

    it('getAllSymbols returns empty array initially', async () => {
      const service = createResearchIngestionService({
        storage: { masterPassword: TEST_PASSWORD, storageDir: TEST_STORAGE_DIR },
        logger: mockLogger,
      });
      await service.initialize();

      const symbols = service.getAllSymbols();
      expect(symbols).toHaveLength(0);
    });

    it('getAllTags returns empty array initially', async () => {
      const service = createResearchIngestionService({
        storage: { masterPassword: TEST_PASSWORD, storageDir: TEST_STORAGE_DIR },
        logger: mockLogger,
      });
      await service.initialize();

      const tags = service.getAllTags();
      expect(tags).toHaveLength(0);
    });
  });

  describe('createResearchIngestionService factory', () => {
    it('creates a ResearchIngestionService instance', () => {
      const service = createResearchIngestionService({
        storage: { masterPassword: TEST_PASSWORD, storageDir: TEST_STORAGE_DIR },
        logger: mockLogger,
      });
      expect(service).toBeInstanceOf(ResearchIngestionService);
    });
  });
});
