/**
 * Research Storage Service
 *
 * Manages storage and retrieval of research notes with deduplication,
 * search, and encrypted persistence.
 */

import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import {
  type ResearchNote,
  type StoredResearchNote,
  type ResearchQueryOptions,
  type ResearchQueryResult,
  type ArticleSummary,
  generateUrlHash,
  ResearchNoteSchema,
  RESEARCH_SCHEMA_VERSION,
} from '../types/research.js';
import { encrypt, decrypt, type EncryptedData } from '../storage/encryption.js';

/**
 * Storage file format
 */
interface ResearchStorageFile {
  version: number;
  notes: Record<string, EncryptedData>; // key = note id
  urlHashIndex: Record<string, string>; // urlHash -> note id
  metadata: {
    createdAt: string;
    updatedAt: string;
    noteCount: number;
  };
}

/**
 * Configuration options
 */
export interface ResearchStorageOptions {
  /** Directory to store research files */
  storageDir?: string;
  /** Master password for encryption */
  masterPassword: string;
  /** Maximum notes to keep (oldest pruned first) */
  maxNotes?: number;
}

/**
 * Logger interface
 */
export interface ResearchStorageLogger {
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

const DEFAULT_STORAGE_DIR = '.config/research';
const DEFAULT_MAX_NOTES = 10000;

/**
 * Default console logger
 */
const defaultLogger: ResearchStorageLogger = {
  info: (message, data) =>
    console.log(`[RESEARCH] ${message}`, data ? JSON.stringify(data) : ''),
  warn: (message, data) =>
    console.warn(`[RESEARCH] ${message}`, data ? JSON.stringify(data) : ''),
  error: (message, data) =>
    console.error(`[RESEARCH] ${message}`, data ? JSON.stringify(data) : ''),
};

/**
 * ResearchStorageService - Manages research note persistence
 */
export class ResearchStorageService {
  private notes: Map<string, StoredResearchNote> = new Map();
  private urlHashIndex: Map<string, string> = new Map(); // urlHash -> note id
  private storageDir: string;
  private masterPassword: string;
  private maxNotes: number;
  private initialized: boolean = false;
  private logger: ResearchStorageLogger;

  constructor(options: ResearchStorageOptions, logger?: ResearchStorageLogger) {
    if (!options.masterPassword || options.masterPassword.length < 8) {
      throw new Error('Master password must be at least 8 characters');
    }
    this.masterPassword = options.masterPassword;
    this.storageDir = options.storageDir || DEFAULT_STORAGE_DIR;
    this.maxNotes = options.maxNotes || DEFAULT_MAX_NOTES;
    this.logger = logger || defaultLogger;
  }

  /**
   * Initialize the service
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    // Ensure storage directory exists
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true, mode: 0o700 });
    }

    // Load existing notes
    await this.loadNotes();

    this.initialized = true;
    this.logger.info('ResearchStorageService initialized', {
      notesLoaded: this.notes.size,
    });
  }

  // ===========================================================================
  // CRUD Operations
  // ===========================================================================

  /**
   * Save a research note
   * Returns existing note if duplicate URL
   */
  async save(note: ResearchNote): Promise<{ note: StoredResearchNote; isDuplicate: boolean }> {
    this.ensureInitialized();

    // Check for duplicate
    const existingId = this.urlHashIndex.get(note.urlHash);
    if (existingId) {
      const existing = this.notes.get(existingId);
      if (existing) {
        this.logger.info('Duplicate URL detected', {
          url: note.url,
          existingId,
        });
        return { note: existing, isDuplicate: true };
      }
    }

    // Validate note
    const validation = ResearchNoteSchema.safeParse(note);
    if (!validation.success) {
      throw new Error(`Invalid research note: ${validation.error.errors.map(e => e.message).join(', ')}`);
    }

    const now = new Date().toISOString();
    const storedNote: StoredResearchNote = {
      ...note,
      createdAt: now,
      version: RESEARCH_SCHEMA_VERSION,
    };

    // Store in memory
    this.notes.set(storedNote.id, storedNote);
    this.urlHashIndex.set(storedNote.urlHash, storedNote.id);

    // Persist
    await this.persistNotes();

    // Prune if over limit
    if (this.notes.size > this.maxNotes) {
      await this.pruneOldest(this.notes.size - this.maxNotes);
    }

    this.logger.info('Research note saved', {
      id: storedNote.id,
      headline: storedNote.headline,
      symbols: storedNote.symbols,
    });

    return { note: storedNote, isDuplicate: false };
  }

  /**
   * Get a note by ID
   */
  async getById(id: string): Promise<StoredResearchNote | null> {
    this.ensureInitialized();
    return this.notes.get(id) || null;
  }

  /**
   * Get a note by URL
   */
  async getByUrl(url: string): Promise<StoredResearchNote | null> {
    this.ensureInitialized();
    const urlHash = generateUrlHash(url);
    const noteId = this.urlHashIndex.get(urlHash);
    if (!noteId) {
      return null;
    }
    return this.notes.get(noteId) || null;
  }

  /**
   * Check if a URL already exists
   */
  hasUrl(url: string): boolean {
    this.ensureInitialized();
    const urlHash = generateUrlHash(url);
    return this.urlHashIndex.has(urlHash);
  }

  /**
   * Update a research note
   */
  async update(
    id: string,
    updates: Partial<Pick<ResearchNote, 'symbols' | 'tags' | 'summary' | 'userNotes' | 'isRead' | 'isFlagged'>>
  ): Promise<StoredResearchNote | null> {
    this.ensureInitialized();

    const existing = this.notes.get(id);
    if (!existing) {
      return null;
    }

    const updated: StoredResearchNote = {
      ...existing,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    // Validate
    const validation = ResearchNoteSchema.safeParse(updated);
    if (!validation.success) {
      throw new Error(`Invalid update: ${validation.error.errors.map(e => e.message).join(', ')}`);
    }

    this.notes.set(id, updated);
    await this.persistNotes();

    this.logger.info('Research note updated', { id, updates: Object.keys(updates) });

    return updated;
  }

  /**
   * Add or update summary for a note
   */
  async addSummary(id: string, summary: ArticleSummary): Promise<StoredResearchNote | null> {
    return this.update(id, { summary });
  }

  /**
   * Mark a note as read
   */
  async markRead(id: string): Promise<StoredResearchNote | null> {
    return this.update(id, { isRead: true });
  }

  /**
   * Toggle flag on a note
   */
  async toggleFlag(id: string): Promise<StoredResearchNote | null> {
    const existing = this.notes.get(id);
    if (!existing) {
      return null;
    }
    return this.update(id, { isFlagged: !existing.isFlagged });
  }

  /**
   * Add symbols to a note
   */
  async addSymbols(id: string, symbols: string[]): Promise<StoredResearchNote | null> {
    const existing = this.notes.get(id);
    if (!existing) {
      return null;
    }
    const newSymbols = Array.from(new Set([...existing.symbols, ...symbols]));
    return this.update(id, { symbols: newSymbols });
  }

  /**
   * Add tags to a note
   */
  async addTags(id: string, tags: string[]): Promise<StoredResearchNote | null> {
    const existing = this.notes.get(id);
    if (!existing) {
      return null;
    }
    const newTags = Array.from(new Set([...existing.tags, ...tags]));
    return this.update(id, { tags: newTags });
  }

  /**
   * Delete a note
   */
  async delete(id: string): Promise<boolean> {
    this.ensureInitialized();

    const existing = this.notes.get(id);
    if (!existing) {
      return false;
    }

    this.notes.delete(id);
    this.urlHashIndex.delete(existing.urlHash);
    await this.persistNotes();

    this.logger.info('Research note deleted', { id });
    return true;
  }

  // ===========================================================================
  // Query Operations
  // ===========================================================================

  /**
   * Query research notes with filters
   */
  async query(options: ResearchQueryOptions = {}): Promise<ResearchQueryResult> {
    this.ensureInitialized();

    let notes = Array.from(this.notes.values());

    // Apply filters
    if (options.symbols?.length) {
      const symbolSet = new Set(options.symbols.map(s => s.toUpperCase()));
      notes = notes.filter((n) =>
        n.symbols.some((s) => symbolSet.has(s.toUpperCase()))
      );
    }

    if (options.sourceTypes?.length) {
      const typeSet = new Set(options.sourceTypes);
      notes = notes.filter((n) => typeSet.has(n.sourceType));
    }

    if (options.sourceIds?.length) {
      const idSet = new Set(options.sourceIds);
      notes = notes.filter((n) => idSet.has(n.sourceId));
    }

    if (options.tags?.length) {
      const tagSet = new Set(options.tags.map(t => t.toLowerCase()));
      notes = notes.filter((n) =>
        n.tags.some((t) => tagSet.has(t.toLowerCase()))
      );
    }

    if (options.searchQuery) {
      const query = options.searchQuery.toLowerCase();
      notes = notes.filter(
        (n) =>
          n.headline.toLowerCase().includes(query) ||
          n.bodyText.toLowerCase().includes(query) ||
          n.summary?.shortSummary.toLowerCase().includes(query)
      );
    }

    if (options.sentiment?.length) {
      const sentimentSet = new Set(options.sentiment);
      notes = notes.filter(
        (n) => n.summary?.sentiment && sentimentSet.has(n.summary.sentiment)
      );
    }

    if (options.publishedAfter) {
      const afterDate = new Date(options.publishedAfter).getTime();
      notes = notes.filter((n) => new Date(n.publishedAt).getTime() >= afterDate);
    }

    if (options.publishedBefore) {
      const beforeDate = new Date(options.publishedBefore).getTime();
      notes = notes.filter((n) => new Date(n.publishedAt).getTime() <= beforeDate);
    }

    if (options.unreadOnly) {
      notes = notes.filter((n) => !n.isRead);
    }

    if (options.flaggedOnly) {
      notes = notes.filter((n) => n.isFlagged);
    }

    if (options.hasSummary !== undefined) {
      notes = notes.filter((n) =>
        options.hasSummary ? n.summary !== undefined : n.summary === undefined
      );
    }

    // Get total count before pagination
    const totalCount = notes.length;

    // Sort
    const sortBy = options.sortBy || 'publishedAt';
    const sortOrder = options.sortOrder || 'desc';
    const sortMultiplier = sortOrder === 'asc' ? 1 : -1;

    notes.sort((a, b) => {
      let aVal: number | string;
      let bVal: number | string;

      switch (sortBy) {
        case 'publishedAt':
          aVal = new Date(a.publishedAt).getTime();
          bVal = new Date(b.publishedAt).getTime();
          break;
        case 'ingestedAt':
          aVal = new Date(a.ingestedAt).getTime();
          bVal = new Date(b.ingestedAt).getTime();
          break;
        case 'trustScore':
          aVal = a.trustScore;
          bVal = b.trustScore;
          break;
        case 'wordCount':
          aVal = a.wordCount;
          bVal = b.wordCount;
          break;
        default:
          aVal = new Date(a.publishedAt).getTime();
          bVal = new Date(b.publishedAt).getTime();
      }

      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return (aVal - bVal) * sortMultiplier;
      }
      return String(aVal).localeCompare(String(bVal)) * sortMultiplier;
    });

    // Paginate
    const offset = options.offset || 0;
    const limit = options.limit || 50;
    const paginatedNotes = notes.slice(offset, offset + limit);

    return {
      notes: paginatedNotes,
      totalCount,
      hasMore: offset + paginatedNotes.length < totalCount,
    };
  }

  /**
   * Get notes by symbol
   */
  async getBySymbol(symbol: string, limit: number = 20): Promise<StoredResearchNote[]> {
    const result = await this.query({
      symbols: [symbol],
      limit,
      sortBy: 'publishedAt',
      sortOrder: 'desc',
    });
    return result.notes;
  }

  /**
   * Get recent notes
   */
  async getRecent(limit: number = 20): Promise<StoredResearchNote[]> {
    const result = await this.query({
      limit,
      sortBy: 'ingestedAt',
      sortOrder: 'desc',
    });
    return result.notes;
  }

  /**
   * Get unread notes
   */
  async getUnread(limit: number = 20): Promise<StoredResearchNote[]> {
    const result = await this.query({
      unreadOnly: true,
      limit,
      sortBy: 'publishedAt',
      sortOrder: 'desc',
    });
    return result.notes;
  }

  /**
   * Get flagged notes
   */
  async getFlagged(limit: number = 50): Promise<StoredResearchNote[]> {
    const result = await this.query({
      flaggedOnly: true,
      limit,
      sortBy: 'publishedAt',
      sortOrder: 'desc',
    });
    return result.notes;
  }

  /**
   * Search notes by keyword
   */
  async search(query: string, limit: number = 20): Promise<StoredResearchNote[]> {
    const result = await this.query({
      searchQuery: query,
      limit,
      sortBy: 'publishedAt',
      sortOrder: 'desc',
    });
    return result.notes;
  }

  // ===========================================================================
  // Statistics
  // ===========================================================================

  /**
   * Get storage statistics
   */
  getStatistics(): {
    totalNotes: number;
    unreadCount: number;
    flaggedCount: number;
    withSummaryCount: number;
    symbolCounts: Record<string, number>;
    sourceTypeCounts: Record<string, number>;
    recentNotes: number;
  } {
    this.ensureInitialized();

    const notes = Array.from(this.notes.values());
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;

    const symbolCounts: Record<string, number> = {};
    const sourceTypeCounts: Record<string, number> = {};

    for (const note of notes) {
      for (const symbol of note.symbols) {
        symbolCounts[symbol] = (symbolCounts[symbol] || 0) + 1;
      }
      sourceTypeCounts[note.sourceType] = (sourceTypeCounts[note.sourceType] || 0) + 1;
    }

    return {
      totalNotes: notes.length,
      unreadCount: notes.filter((n) => !n.isRead).length,
      flaggedCount: notes.filter((n) => n.isFlagged).length,
      withSummaryCount: notes.filter((n) => n.summary !== undefined).length,
      symbolCounts,
      sourceTypeCounts,
      recentNotes: notes.filter((n) => new Date(n.ingestedAt).getTime() > oneDayAgo).length,
    };
  }

  /**
   * Get all unique symbols across notes
   */
  getAllSymbols(): string[] {
    this.ensureInitialized();
    const symbols = new Set<string>();
    for (const note of this.notes.values()) {
      for (const symbol of note.symbols) {
        symbols.add(symbol);
      }
    }
    return Array.from(symbols).sort();
  }

  /**
   * Get all unique tags across notes
   */
  getAllTags(): string[] {
    this.ensureInitialized();
    const tags = new Set<string>();
    for (const note of this.notes.values()) {
      for (const tag of note.tags) {
        tags.add(tag);
      }
    }
    return Array.from(tags).sort();
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('ResearchStorageService not initialized. Call initialize() first.');
    }
  }

  /**
   * Load notes from storage
   */
  private async loadNotes(): Promise<void> {
    const filePath = path.join(this.storageDir, 'research.json');

    if (!fs.existsSync(filePath)) {
      return;
    }

    try {
      const fileContent = fs.readFileSync(filePath, 'utf-8');
      const storageFile: ResearchStorageFile = JSON.parse(fileContent);

      // Decrypt and load notes
      for (const [id, encryptedData] of Object.entries(storageFile.notes)) {
        try {
          const decrypted = decrypt(encryptedData, this.masterPassword);
          const note: StoredResearchNote = JSON.parse(decrypted);
          this.notes.set(id, note);
          this.urlHashIndex.set(note.urlHash, id);
        } catch (error) {
          this.logger.warn('Failed to decrypt note', { id, error: String(error) });
        }
      }

      this.logger.info('Loaded research notes', { count: this.notes.size });
    } catch (error) {
      this.logger.error('Failed to load research notes', { error: String(error) });
    }
  }

  /**
   * Persist notes to storage
   */
  private async persistNotes(): Promise<void> {
    const filePath = path.join(this.storageDir, 'research.json');
    const now = new Date().toISOString();

    const encryptedNotes: Record<string, EncryptedData> = {};
    const urlHashIndex: Record<string, string> = {};

    for (const [id, note] of this.notes.entries()) {
      encryptedNotes[id] = encrypt(JSON.stringify(note), this.masterPassword);
      urlHashIndex[note.urlHash] = id;
    }

    const storageFile: ResearchStorageFile = {
      version: RESEARCH_SCHEMA_VERSION,
      notes: encryptedNotes,
      urlHashIndex,
      metadata: {
        createdAt: now,
        updatedAt: now,
        noteCount: this.notes.size,
      },
    };

    // Write atomically
    const tempPath = filePath + '.tmp';
    fs.writeFileSync(tempPath, JSON.stringify(storageFile, null, 2), { mode: 0o600 });
    fs.renameSync(tempPath, filePath);
  }

  /**
   * Prune oldest notes
   */
  private async pruneOldest(count: number): Promise<void> {
    const sorted = Array.from(this.notes.values()).sort(
      (a, b) => new Date(a.ingestedAt).getTime() - new Date(b.ingestedAt).getTime()
    );

    const toDelete = sorted.slice(0, count);
    for (const note of toDelete) {
      this.notes.delete(note.id);
      this.urlHashIndex.delete(note.urlHash);
    }

    await this.persistNotes();
    this.logger.info('Pruned old research notes', { count: toDelete.length });
  }
}

/**
 * Create a research storage service
 */
export function createResearchStorageService(
  options: ResearchStorageOptions,
  logger?: ResearchStorageLogger
): ResearchStorageService {
  return new ResearchStorageService(options, logger);
}
