/**
 * Tests for Research Storage Service
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  ResearchStorageService,
  createResearchStorageService,
  type ResearchStorageLogger,
} from './research-storage.js';
import {
  type ResearchNote,
  createResearchNoteFromArticle,
  type ExtractedArticle,
} from '../types/research.js';

// Mock logger
const mockLogger: ResearchStorageLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

// Test storage directory
const TEST_STORAGE_DIR = '.test-research-storage';
const TEST_PASSWORD = 'test-master-password-12345';

// Helper to create a test article
function createTestArticle(suffix: string = ''): ExtractedArticle {
  return {
    headline: `Test Headline ${suffix}`,
    publishedAt: new Date().toISOString(),
    bodyText: `Test body text for article ${suffix}. Contains enough content.`,
    url: `https://www.reuters.com/article/test-${suffix}-${Date.now()}`,
    sourceId: 'reuters',
    sourceName: 'Reuters',
    sourceType: 'news',
    wordCount: 50,
    extractedAt: new Date().toISOString(),
  };
}

// Helper to create a test note
function createTestNote(suffix: string = ''): ResearchNote {
  return createResearchNoteFromArticle(createTestArticle(suffix), {
    symbols: ['AAPL'],
    tags: ['test'],
  });
}

describe('ResearchStorageService', () => {
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
    it('throws error for short password', () => {
      expect(() => {
        new ResearchStorageService({ masterPassword: 'short' }, mockLogger);
      }).toThrow('Master password must be at least 8 characters');
    });

    it('creates service with valid password', () => {
      const service = new ResearchStorageService(
        { masterPassword: TEST_PASSWORD, storageDir: TEST_STORAGE_DIR },
        mockLogger
      );
      expect(service).toBeDefined();
    });
  });

  describe('initialize', () => {
    it('creates storage directory if not exists', async () => {
      const service = new ResearchStorageService(
        { masterPassword: TEST_PASSWORD, storageDir: TEST_STORAGE_DIR },
        mockLogger
      );
      await service.initialize();
      expect(fs.existsSync(TEST_STORAGE_DIR)).toBe(true);
    });

    it('is idempotent', async () => {
      const service = new ResearchStorageService(
        { masterPassword: TEST_PASSWORD, storageDir: TEST_STORAGE_DIR },
        mockLogger
      );
      await service.initialize();
      await service.initialize(); // Should not throw
    });
  });

  describe('save', () => {
    it('saves a research note', async () => {
      const service = new ResearchStorageService(
        { masterPassword: TEST_PASSWORD, storageDir: TEST_STORAGE_DIR },
        mockLogger
      );
      await service.initialize();

      const note = createTestNote('save-test');
      const result = await service.save(note);

      expect(result.isDuplicate).toBe(false);
      expect(result.note.id).toBe(note.id);
      expect(result.note.headline).toBe(note.headline);
    });

    it('detects duplicate URLs', async () => {
      const service = new ResearchStorageService(
        { masterPassword: TEST_PASSWORD, storageDir: TEST_STORAGE_DIR },
        mockLogger
      );
      await service.initialize();

      const article = createTestArticle('dup-test');
      const note1 = createResearchNoteFromArticle(article);
      const note2 = createResearchNoteFromArticle(article); // Same URL

      await service.save(note1);
      const result = await service.save(note2);

      expect(result.isDuplicate).toBe(true);
      expect(result.note.id).toBe(note1.id);
    });

    it('throws error before initialization', async () => {
      const service = new ResearchStorageService(
        { masterPassword: TEST_PASSWORD, storageDir: TEST_STORAGE_DIR },
        mockLogger
      );

      await expect(service.save(createTestNote())).rejects.toThrow('not initialized');
    });
  });

  describe('getById', () => {
    it('retrieves a saved note', async () => {
      const service = new ResearchStorageService(
        { masterPassword: TEST_PASSWORD, storageDir: TEST_STORAGE_DIR },
        mockLogger
      );
      await service.initialize();

      const note = createTestNote('getbyid-test');
      await service.save(note);

      const retrieved = await service.getById(note.id);
      expect(retrieved?.headline).toBe(note.headline);
    });

    it('returns null for non-existent note', async () => {
      const service = new ResearchStorageService(
        { masterPassword: TEST_PASSWORD, storageDir: TEST_STORAGE_DIR },
        mockLogger
      );
      await service.initialize();

      const retrieved = await service.getById('non-existent-id');
      expect(retrieved).toBeNull();
    });
  });

  describe('getByUrl', () => {
    it('retrieves a note by URL', async () => {
      const service = new ResearchStorageService(
        { masterPassword: TEST_PASSWORD, storageDir: TEST_STORAGE_DIR },
        mockLogger
      );
      await service.initialize();

      const note = createTestNote('getbyurl-test');
      await service.save(note);

      const retrieved = await service.getByUrl(note.url);
      expect(retrieved?.id).toBe(note.id);
    });

    it('returns null for non-existent URL', async () => {
      const service = new ResearchStorageService(
        { masterPassword: TEST_PASSWORD, storageDir: TEST_STORAGE_DIR },
        mockLogger
      );
      await service.initialize();

      const retrieved = await service.getByUrl('https://nonexistent.com/article');
      expect(retrieved).toBeNull();
    });
  });

  describe('hasUrl', () => {
    it('returns true for existing URL', async () => {
      const service = new ResearchStorageService(
        { masterPassword: TEST_PASSWORD, storageDir: TEST_STORAGE_DIR },
        mockLogger
      );
      await service.initialize();

      const note = createTestNote('hasurl-test');
      await service.save(note);

      expect(service.hasUrl(note.url)).toBe(true);
    });

    it('returns false for non-existent URL', async () => {
      const service = new ResearchStorageService(
        { masterPassword: TEST_PASSWORD, storageDir: TEST_STORAGE_DIR },
        mockLogger
      );
      await service.initialize();

      expect(service.hasUrl('https://nonexistent.com/article')).toBe(false);
    });
  });

  describe('update', () => {
    it('updates note fields', async () => {
      const service = new ResearchStorageService(
        { masterPassword: TEST_PASSWORD, storageDir: TEST_STORAGE_DIR },
        mockLogger
      );
      await service.initialize();

      const note = createTestNote('update-test');
      await service.save(note);

      const updated = await service.update(note.id, {
        isRead: true,
        isFlagged: true,
        userNotes: 'My notes here',
      });

      expect(updated?.isRead).toBe(true);
      expect(updated?.isFlagged).toBe(true);
      expect(updated?.userNotes).toBe('My notes here');
    });

    it('returns null for non-existent note', async () => {
      const service = new ResearchStorageService(
        { masterPassword: TEST_PASSWORD, storageDir: TEST_STORAGE_DIR },
        mockLogger
      );
      await service.initialize();

      const updated = await service.update('non-existent', { isRead: true });
      expect(updated).toBeNull();
    });
  });

  describe('markRead', () => {
    it('marks a note as read', async () => {
      const service = new ResearchStorageService(
        { masterPassword: TEST_PASSWORD, storageDir: TEST_STORAGE_DIR },
        mockLogger
      );
      await service.initialize();

      const note = createTestNote('markread-test');
      await service.save(note);

      const updated = await service.markRead(note.id);
      expect(updated?.isRead).toBe(true);
    });
  });

  describe('toggleFlag', () => {
    it('toggles the flag on a note', async () => {
      const service = new ResearchStorageService(
        { masterPassword: TEST_PASSWORD, storageDir: TEST_STORAGE_DIR },
        mockLogger
      );
      await service.initialize();

      const note = createTestNote('toggleflag-test');
      await service.save(note);

      let updated = await service.toggleFlag(note.id);
      expect(updated?.isFlagged).toBe(true);

      updated = await service.toggleFlag(note.id);
      expect(updated?.isFlagged).toBe(false);
    });
  });

  describe('addSymbols', () => {
    it('adds symbols to a note', async () => {
      const service = new ResearchStorageService(
        { masterPassword: TEST_PASSWORD, storageDir: TEST_STORAGE_DIR },
        mockLogger
      );
      await service.initialize();

      const note = createTestNote('addsymbols-test');
      await service.save(note);

      const updated = await service.addSymbols(note.id, ['MSFT', 'GOOG']);
      expect(updated?.symbols).toContain('AAPL');
      expect(updated?.symbols).toContain('MSFT');
      expect(updated?.symbols).toContain('GOOG');
    });

    it('does not duplicate existing symbols', async () => {
      const service = new ResearchStorageService(
        { masterPassword: TEST_PASSWORD, storageDir: TEST_STORAGE_DIR },
        mockLogger
      );
      await service.initialize();

      const note = createTestNote('addsymbols-dup-test');
      await service.save(note);

      const updated = await service.addSymbols(note.id, ['AAPL', 'MSFT']);
      const aaplCount = updated?.symbols.filter((s) => s === 'AAPL').length;
      expect(aaplCount).toBe(1);
    });
  });

  describe('delete', () => {
    it('deletes a note', async () => {
      const service = new ResearchStorageService(
        { masterPassword: TEST_PASSWORD, storageDir: TEST_STORAGE_DIR },
        mockLogger
      );
      await service.initialize();

      const note = createTestNote('delete-test');
      await service.save(note);

      const deleted = await service.delete(note.id);
      expect(deleted).toBe(true);

      const retrieved = await service.getById(note.id);
      expect(retrieved).toBeNull();
    });

    it('returns false for non-existent note', async () => {
      const service = new ResearchStorageService(
        { masterPassword: TEST_PASSWORD, storageDir: TEST_STORAGE_DIR },
        mockLogger
      );
      await service.initialize();

      const deleted = await service.delete('non-existent');
      expect(deleted).toBe(false);
    });
  });

  describe('query', () => {
    it('queries notes by symbol', async () => {
      const service = new ResearchStorageService(
        { masterPassword: TEST_PASSWORD, storageDir: TEST_STORAGE_DIR },
        mockLogger
      );
      await service.initialize();

      const article1 = createTestArticle('query-1');
      const article2 = createTestArticle('query-2');

      await service.save(
        createResearchNoteFromArticle(article1, { symbols: ['AAPL'] })
      );
      await service.save(
        createResearchNoteFromArticle(article2, { symbols: ['MSFT'] })
      );

      const result = await service.query({ symbols: ['AAPL'] });
      expect(result.notes.length).toBe(1);
      expect(result.notes[0].symbols).toContain('AAPL');
    });

    it('queries notes by source type', async () => {
      const service = new ResearchStorageService(
        { masterPassword: TEST_PASSWORD, storageDir: TEST_STORAGE_DIR },
        mockLogger
      );
      await service.initialize();

      await service.save(createTestNote('query-source'));

      const result = await service.query({ sourceTypes: ['news'] });
      expect(result.notes.length).toBeGreaterThan(0);
      expect(result.notes[0].sourceType).toBe('news');
    });

    it('queries notes by search query', async () => {
      const service = new ResearchStorageService(
        { masterPassword: TEST_PASSWORD, storageDir: TEST_STORAGE_DIR },
        mockLogger
      );
      await service.initialize();

      const article = createTestArticle('unique-search-term-xyz');
      await service.save(createResearchNoteFromArticle(article));

      const result = await service.query({ searchQuery: 'unique-search-term-xyz' });
      expect(result.notes.length).toBe(1);
    });

    it('supports pagination', async () => {
      const service = new ResearchStorageService(
        { masterPassword: TEST_PASSWORD, storageDir: TEST_STORAGE_DIR },
        mockLogger
      );
      await service.initialize();

      // Create 5 notes
      for (let i = 0; i < 5; i++) {
        await service.save(createTestNote(`pagination-${i}`));
      }

      const page1 = await service.query({ limit: 2, offset: 0 });
      expect(page1.notes.length).toBe(2);
      expect(page1.totalCount).toBe(5);
      expect(page1.hasMore).toBe(true);

      const page2 = await service.query({ limit: 2, offset: 2 });
      expect(page2.notes.length).toBe(2);
      expect(page2.hasMore).toBe(true);

      const page3 = await service.query({ limit: 2, offset: 4 });
      expect(page3.notes.length).toBe(1);
      expect(page3.hasMore).toBe(false);
    });
  });

  describe('getStatistics', () => {
    it('returns storage statistics', async () => {
      const service = new ResearchStorageService(
        { masterPassword: TEST_PASSWORD, storageDir: TEST_STORAGE_DIR },
        mockLogger
      );
      await service.initialize();

      await service.save(createTestNote('stats-1'));
      await service.save(createTestNote('stats-2'));

      const stats = service.getStatistics();
      expect(stats.totalNotes).toBe(2);
      expect(stats.unreadCount).toBe(2);
      expect(stats.symbolCounts).toBeDefined();
    });
  });

  describe('persistence', () => {
    it('persists notes across service restarts', async () => {
      // First instance: save a note
      const service1 = new ResearchStorageService(
        { masterPassword: TEST_PASSWORD, storageDir: TEST_STORAGE_DIR },
        mockLogger
      );
      await service1.initialize();
      const note = createTestNote('persist-test');
      await service1.save(note);

      // Second instance: load and verify
      const service2 = new ResearchStorageService(
        { masterPassword: TEST_PASSWORD, storageDir: TEST_STORAGE_DIR },
        mockLogger
      );
      await service2.initialize();
      const loaded = await service2.getById(note.id);
      expect(loaded?.headline).toBe(note.headline);
    });
  });

  describe('createResearchStorageService factory', () => {
    it('creates a ResearchStorageService instance', () => {
      const service = createResearchStorageService(
        { masterPassword: TEST_PASSWORD, storageDir: TEST_STORAGE_DIR },
        mockLogger
      );
      expect(service).toBeInstanceOf(ResearchStorageService);
    });
  });
});
