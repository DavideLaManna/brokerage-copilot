/**
 * Document Chunking Service
 *
 * Splits long documents (e.g., 10-K filings) into manageable chunks
 * for LLM processing. Supports section-aware chunking with configurable
 * overlap for context preservation.
 */

import * as crypto from 'crypto';
import type {
  ChunkerConfig,
  DocumentChunk,
  ChunkingResult,
  FilingSection,
  FilingSectionType,
  ExtractedPDFContent,
} from '../types/pdf-filing';
import { DEFAULT_CHUNKER_CONFIG } from '../types/pdf-filing';
import { countWords } from '../types/research';

// ============================================================================
// Types
// ============================================================================

/**
 * Logger interface for dependency injection
 */
export interface ChunkerLogger {
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
  debug(message: string, data?: Record<string, unknown>): void;
}

/**
 * Options for chunking operations
 */
export interface ChunkingOptions {
  /** Config overrides */
  config?: Partial<ChunkerConfig>;
  /** Sections to prioritize (process first) */
  prioritySections?: FilingSectionType[];
  /** Sections to skip */
  skipSections?: FilingSectionType[];
  /** Maximum total chunks to create */
  maxTotalChunks?: number;
}

// ============================================================================
// Document Chunker Service
// ============================================================================

/**
 * Document chunking service for long financial documents
 */
export class DocumentChunker {
  private config: ChunkerConfig;
  private logger: ChunkerLogger;

  constructor(options?: {
    config?: Partial<ChunkerConfig>;
    logger?: ChunkerLogger;
  }) {
    this.config = { ...DEFAULT_CHUNKER_CONFIG, ...options?.config };
    this.logger = options?.logger || this.createDefaultLogger();
  }

  private createDefaultLogger(): ChunkerLogger {
    const prefix = '[CHUNKER]';
    return {
      info: (msg, data) => console.log(prefix, msg, data ? JSON.stringify(data) : ''),
      warn: (msg, data) => console.warn(prefix, msg, data ? JSON.stringify(data) : ''),
      error: (msg, data) => console.error(prefix, msg, data ? JSON.stringify(data) : ''),
      debug: (msg, data) => console.debug(prefix, msg, data ? JSON.stringify(data) : ''),
    };
  }

  /**
   * Chunk extracted PDF content
   */
  chunkContent(content: ExtractedPDFContent, options?: ChunkingOptions): ChunkingResult {
    const effectiveConfig = { ...this.config, ...options?.config };

    this.logger.info('Starting document chunking', {
      totalWords: content.totalWords,
      totalPages: content.totalPages,
      sectionsCount: content.sections.length,
      maxWordsPerChunk: effectiveConfig.maxWordsPerChunk,
    });

    try {
      let chunks: DocumentChunk[];

      if (effectiveConfig.splitOnSections && content.sections.length > 1) {
        chunks = this.chunkBySections(content.sections, effectiveConfig, options);
      } else {
        chunks = this.chunkByWords(content.fullText, effectiveConfig, 1, content.totalPages);
      }

      // Apply max chunks limit if specified
      if (options?.maxTotalChunks && chunks.length > options.maxTotalChunks) {
        this.logger.warn('Truncating chunks to max limit', {
          totalChunks: chunks.length,
          maxChunks: options.maxTotalChunks,
        });
        chunks = chunks.slice(0, options.maxTotalChunks);
      }

      this.logger.info('Document chunking completed', {
        totalChunks: chunks.length,
        avgWordsPerChunk: chunks.reduce((sum, c) => sum + c.wordCount, 0) / chunks.length,
      });

      return {
        success: true,
        chunks,
        totalChunks: chunks.length,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('Document chunking failed', { error: errorMessage });

      return {
        success: false,
        totalChunks: 0,
        error: errorMessage,
      };
    }
  }

  /**
   * Chunk a single section
   */
  chunkSection(section: FilingSection, options?: ChunkingOptions): ChunkingResult {
    const effectiveConfig = { ...this.config, ...options?.config };

    this.logger.debug('Chunking section', {
      sectionType: section.type,
      wordCount: section.wordCount,
    });

    try {
      const chunks = this.chunkByWords(
        section.content,
        effectiveConfig,
        section.startPage,
        section.endPage,
        section.type,
        section.title
      );

      return {
        success: true,
        chunks,
        totalChunks: chunks.length,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        totalChunks: 0,
        error: errorMessage,
      };
    }
  }

  /**
   * Chunk plain text
   */
  chunkText(text: string, options?: ChunkingOptions): ChunkingResult {
    const effectiveConfig = { ...this.config, ...options?.config };
    const totalWords = countWords(text);

    this.logger.info('Chunking plain text', {
      totalWords,
      maxWordsPerChunk: effectiveConfig.maxWordsPerChunk,
    });

    try {
      const chunks = this.chunkByWords(text, effectiveConfig, 1, 1);

      return {
        success: true,
        chunks,
        totalChunks: chunks.length,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        totalChunks: 0,
        error: errorMessage,
      };
    }
  }

  /**
   * Chunk sections with section-aware boundaries
   */
  private chunkBySections(
    sections: FilingSection[],
    config: ChunkerConfig,
    options?: ChunkingOptions
  ): DocumentChunk[] {
    const allChunks: DocumentChunk[] = [];
    let globalIndex = 0;

    // Filter and order sections
    let orderedSections = [...sections];

    // Remove skipped sections
    if (options?.skipSections?.length) {
      orderedSections = orderedSections.filter(
        s => !options.skipSections?.includes(s.type)
      );
    }

    // Prioritize certain sections
    if (options?.prioritySections?.length) {
      const priorityOrder = options.prioritySections;
      orderedSections.sort((a, b) => {
        const aIndex = priorityOrder.indexOf(a.type);
        const bIndex = priorityOrder.indexOf(b.type);
        if (aIndex === -1 && bIndex === -1) return 0;
        if (aIndex === -1) return 1;
        if (bIndex === -1) return -1;
        return aIndex - bIndex;
      });
    }

    for (const section of orderedSections) {
      if (section.wordCount <= config.maxWordsPerChunk) {
        // Section fits in one chunk
        if (section.wordCount >= config.minChunkWords) {
          allChunks.push({
            index: globalIndex++,
            content: section.content,
            wordCount: section.wordCount,
            startPage: section.startPage,
            endPage: section.endPage,
            sectionType: section.type,
            sectionTitle: section.title,
            metadata: {
              isSectionStart: true,
              hasOverlap: false,
            },
          });
        }
      } else {
        // Section needs to be split
        const sectionChunks = this.chunkByWords(
          section.content,
          config,
          section.startPage,
          section.endPage,
          section.type,
          section.title
        );

        // Re-index chunks
        for (const chunk of sectionChunks) {
          chunk.index = globalIndex++;
        }

        allChunks.push(...sectionChunks);
      }
    }

    return allChunks;
  }

  /**
   * Chunk text by word count with overlap
   */
  private chunkByWords(
    text: string,
    config: ChunkerConfig,
    startPage: number,
    endPage: number,
    sectionType?: FilingSectionType,
    sectionTitle?: string
  ): DocumentChunk[] {
    const chunks: DocumentChunk[] = [];
    const words = text.split(/\s+/).filter(w => w.length > 0);
    const totalWords = words.length;

    if (totalWords === 0) {
      return [];
    }

    // If text fits in one chunk, return single chunk
    if (totalWords <= config.maxWordsPerChunk) {
      if (totalWords >= config.minChunkWords) {
        chunks.push({
          index: 0,
          content: text.trim(),
          wordCount: totalWords,
          startPage,
          endPage,
          sectionType,
          sectionTitle,
          metadata: {
            isSectionStart: true,
            hasOverlap: false,
          },
        });
      }
      return chunks;
    }

    // Calculate chunk boundaries
    const effectiveChunkSize = config.maxWordsPerChunk - config.overlapWords;
    let chunkStart = 0;
    let chunkIndex = 0;

    while (chunkStart < totalWords) {
      const chunkEnd = Math.min(chunkStart + config.maxWordsPerChunk, totalWords);
      const chunkWords = words.slice(chunkStart, chunkEnd);
      const chunkContent = chunkWords.join(' ');
      const wordCount = chunkWords.length;

      // Skip chunks that are too small (unless it's the last chunk)
      if (wordCount >= config.minChunkWords || chunkStart + wordCount >= totalWords) {
        // Estimate page range for this chunk
        const progress = (chunkStart + chunkEnd) / 2 / totalWords;
        const estimatedPage = Math.round(startPage + (endPage - startPage) * progress);

        chunks.push({
          index: chunkIndex++,
          content: chunkContent,
          wordCount,
          startPage: chunkIndex === 1 ? startPage : estimatedPage,
          endPage: chunkStart + wordCount >= totalWords ? endPage : estimatedPage,
          sectionType,
          sectionTitle,
          metadata: {
            isSectionStart: chunkStart === 0,
            hasOverlap: chunkStart > 0,
          },
        });
      }

      // Move to next chunk with overlap
      chunkStart += effectiveChunkSize;
    }

    return chunks;
  }

  /**
   * Merge adjacent small chunks
   */
  mergeSmallChunks(chunks: DocumentChunk[], minWords?: number): DocumentChunk[] {
    const minChunkWords = minWords || this.config.minChunkWords;
    const maxChunkWords = this.config.maxWordsPerChunk;
    const merged: DocumentChunk[] = [];
    let pendingChunk: DocumentChunk | null = null;

    for (const chunk of chunks) {
      if (!pendingChunk) {
        if (chunk.wordCount < minChunkWords) {
          pendingChunk = { ...chunk };
        } else {
          merged.push(chunk);
        }
      } else {
        // Try to merge with pending chunk
        const combinedWords: number = pendingChunk.wordCount + chunk.wordCount;

        if (combinedWords <= maxChunkWords) {
          // Merge chunks
          const mergedChunk: DocumentChunk = {
            index: pendingChunk.index,
            content: pendingChunk.content + '\n\n' + chunk.content,
            wordCount: combinedWords,
            startPage: pendingChunk.startPage,
            endPage: chunk.endPage,
            sectionType: pendingChunk.sectionType,
            sectionTitle: pendingChunk.sectionTitle,
            metadata: pendingChunk.metadata,
          };
          pendingChunk = mergedChunk;

          // If merged chunk is large enough, add it
          if (pendingChunk.wordCount >= minChunkWords) {
            merged.push(pendingChunk);
            pendingChunk = null;
          }
        } else {
          // Can't merge, add pending and continue
          merged.push(pendingChunk);

          if (chunk.wordCount < minChunkWords) {
            const newPending: DocumentChunk = { ...chunk };
            pendingChunk = newPending;
          } else {
            merged.push(chunk);
            pendingChunk = null;
          }
        }
      }
    }

    // Add any remaining pending chunk
    if (pendingChunk) {
      merged.push(pendingChunk);
    }

    // Re-index
    return merged.map((chunk, index) => ({ ...chunk, index }));
  }

  /**
   * Filter chunks by section type
   */
  filterBySectionType(chunks: DocumentChunk[], sectionTypes: FilingSectionType[]): DocumentChunk[] {
    return chunks
      .filter(chunk => chunk.sectionType && sectionTypes.includes(chunk.sectionType))
      .map((chunk, index) => ({ ...chunk, index }));
  }

  /**
   * Get chunks for a specific section
   */
  getChunksForSection(chunks: DocumentChunk[], sectionType: FilingSectionType): DocumentChunk[] {
    return chunks.filter(chunk => chunk.sectionType === sectionType);
  }

  /**
   * Calculate chunking statistics
   */
  getChunkingStats(chunks: DocumentChunk[]): {
    totalChunks: number;
    totalWords: number;
    avgWordsPerChunk: number;
    minWordsInChunk: number;
    maxWordsInChunk: number;
    chunksBySectionType: Record<string, number>;
    chunksWithOverlap: number;
  } {
    if (chunks.length === 0) {
      return {
        totalChunks: 0,
        totalWords: 0,
        avgWordsPerChunk: 0,
        minWordsInChunk: 0,
        maxWordsInChunk: 0,
        chunksBySectionType: {},
        chunksWithOverlap: 0,
      };
    }

    const wordCounts = chunks.map(c => c.wordCount);
    const chunksBySectionType: Record<string, number> = {};

    for (const chunk of chunks) {
      const sectionKey = chunk.sectionType || 'other';
      chunksBySectionType[sectionKey] = (chunksBySectionType[sectionKey] || 0) + 1;
    }

    return {
      totalChunks: chunks.length,
      totalWords: wordCounts.reduce((sum, wc) => sum + wc, 0),
      avgWordsPerChunk: Math.round(wordCounts.reduce((sum, wc) => sum + wc, 0) / chunks.length),
      minWordsInChunk: Math.min(...wordCounts),
      maxWordsInChunk: Math.max(...wordCounts),
      chunksBySectionType,
      chunksWithOverlap: chunks.filter(c => c.metadata.hasOverlap).length,
    };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<ChunkerConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): ChunkerConfig {
    return { ...this.config };
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a document chunker service
 */
export function createDocumentChunker(options?: {
  config?: Partial<ChunkerConfig>;
  logger?: ChunkerLogger;
}): DocumentChunker {
  return new DocumentChunker(options);
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Chunk extracted PDF content (convenience function)
 */
export function chunkPDFContent(
  content: ExtractedPDFContent,
  options?: ChunkingOptions & {
    config?: Partial<ChunkerConfig>;
    logger?: ChunkerLogger;
  }
): ChunkingResult {
  const chunker = createDocumentChunker(options);
  return chunker.chunkContent(content, options);
}

/**
 * Chunk a filing section (convenience function)
 */
export function chunkFilingSection(
  section: FilingSection,
  options?: ChunkingOptions & {
    config?: Partial<ChunkerConfig>;
    logger?: ChunkerLogger;
  }
): ChunkingResult {
  const chunker = createDocumentChunker(options);
  return chunker.chunkSection(section, options);
}

/**
 * Chunk plain text (convenience function)
 */
export function chunkText(
  text: string,
  options?: ChunkingOptions & {
    config?: Partial<ChunkerConfig>;
    logger?: ChunkerLogger;
  }
): ChunkingResult {
  const chunker = createDocumentChunker(options);
  return chunker.chunkText(text, options);
}

/**
 * Estimate number of chunks for a given text
 */
export function estimateChunkCount(
  text: string,
  config?: Partial<ChunkerConfig>
): number {
  const effectiveConfig = { ...DEFAULT_CHUNKER_CONFIG, ...config };
  const totalWords = countWords(text);

  if (totalWords <= effectiveConfig.maxWordsPerChunk) {
    return 1;
  }

  const effectiveChunkSize = effectiveConfig.maxWordsPerChunk - effectiveConfig.overlapWords;
  return Math.ceil(totalWords / effectiveChunkSize);
}
