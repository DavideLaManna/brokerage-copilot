/**
 * Research Retrieval Tool
 *
 * MCP tool that searches and retrieves research notes for LLM agents
 * to use when generating trade ideas. Returns relevant notes with
 * source citations and timestamps.
 */

import { z } from 'zod';
import type {
  StoredResearchNote,
  ResearchQueryOptions,
  ResearchSourceType,
  ArticleSummary,
  KeyDataPoint,
} from '../types/research.js';
import type { ResearchStorageService } from '../services/research-storage.js';
import type { DataSource } from '../types/trade-proposal.js';
import type { MCPToolDefinition, MCPToolResult } from './types.js';

// ============================================================================
// Research Retrieval Types
// ============================================================================

/**
 * Simplified research note for LLM consumption
 */
export interface ResearchNoteSnapshot {
  /** Note ID for reference */
  id: string;
  /** Article headline */
  headline: string;
  /** Source name (e.g., "Reuters", "SEC EDGAR") */
  sourceName: string;
  /** Source type */
  sourceType: ResearchSourceType;
  /** Publication date (ISO string) */
  publishedAt: string;
  /** When the note was ingested (ISO string) */
  ingestedAt: string;
  /** Original URL */
  url: string;
  /** Associated ticker symbols */
  symbols: string[];
  /** Trust score (0-1) */
  trustScore: number;
  /** Short summary (if available) */
  shortSummary?: string;
  /** Key takeaways (if available) */
  keyTakeaways?: string[];
  /** Sentiment analysis (if available) */
  sentiment?: 'bullish' | 'bearish' | 'neutral' | 'mixed';
  /** Sentiment confidence (0-1, if available) */
  sentimentConfidence?: number;
  /** Key data points extracted (if available) */
  keyDataPoints?: KeyDataPoint[];
  /** Time horizon (if available) */
  timeHorizon?: 'short_term' | 'medium_term' | 'long_term';
  /** Tags */
  tags: string[];
  /** Word count of original article */
  wordCount: number;
  /** Whether flagged as important */
  isFlagged: boolean;
  /** User notes (if any) */
  userNotes?: string;
}

/**
 * Research search result for MCP tool
 */
export interface ResearchSearchResult {
  /** Matching research notes */
  notes: ResearchNoteSnapshot[];
  /** Total count of matching notes (before pagination) */
  totalCount: number;
  /** Whether there are more results */
  hasMore: boolean;
  /** Request parameters used */
  request: {
    symbol?: string;
    keywords?: string[];
    sourceTypes?: ResearchSourceType[];
    sentiment?: string[];
    limit: number;
    offset: number;
    publishedAfter?: string;
    publishedBefore?: string;
    sortBy?: string;
    sortOrder?: string;
  };
  /** Summary statistics */
  summary: {
    /** Breakdown by source type */
    sourceTypeCounts: Record<string, number>;
    /** Breakdown by sentiment */
    sentimentCounts: Record<string, number>;
    /** Average trust score */
    averageTrustScore: number;
    /** Count with summaries */
    withSummaryCount: number;
    /** Earliest publication date */
    earliestPublication?: string;
    /** Latest publication date */
    latestPublication?: string;
  };
  /** Data timestamp */
  dataTimestamp: string;
  /** Data source information */
  dataSources: {
    source: string;
    retrievedAt: string;
  }[];
}

// ============================================================================
// Zod Schema for Input Validation
// ============================================================================

/**
 * Schema for search_research input parameters
 */
export const SearchResearchInputSchema = z.object({
  /** Stock ticker symbol to search for (optional) */
  symbol: z.string().min(1).toUpperCase().optional(),
  /** Keywords to search in headline, body, and summary (optional) */
  keywords: z.array(z.string().min(1)).optional(),
  /** Filter by source types (optional) */
  sourceTypes: z.array(z.enum([
    'news', 'press_release', 'sec_filing', 'earnings', 'analyst', 'blog', 'social', 'other'
  ])).optional(),
  /** Filter by sentiment (optional) */
  sentiment: z.array(z.enum(['bullish', 'bearish', 'neutral', 'mixed'])).optional(),
  /** Only notes published after this date (ISO string, optional) */
  publishedAfter: z.string().datetime().optional(),
  /** Only notes published before this date (ISO string, optional) */
  publishedBefore: z.string().datetime().optional(),
  /** Only flagged notes (optional) */
  flaggedOnly: z.boolean().optional(),
  /** Only notes with summaries (optional) */
  hasSummary: z.boolean().optional(),
  /** Maximum results to return (default: 20) */
  limit: z.number().int().positive().max(100).optional(),
  /** Offset for pagination (default: 0) */
  offset: z.number().int().nonnegative().optional(),
  /** Sort by field (default: publishedAt) */
  sortBy: z.enum(['publishedAt', 'ingestedAt', 'trustScore', 'wordCount']).optional(),
  /** Sort order (default: desc) */
  sortOrder: z.enum(['asc', 'desc']).optional(),
});

export type SearchResearchInput = z.infer<typeof SearchResearchInputSchema>;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Convert StoredResearchNote to ResearchNoteSnapshot for LLM consumption
 */
function toNoteSnapshot(note: StoredResearchNote): ResearchNoteSnapshot {
  const snapshot: ResearchNoteSnapshot = {
    id: note.id,
    headline: note.headline,
    sourceName: note.sourceName,
    sourceType: note.sourceType,
    publishedAt: note.publishedAt,
    ingestedAt: note.ingestedAt,
    url: note.url,
    symbols: note.symbols,
    trustScore: note.trustScore,
    tags: note.tags,
    wordCount: note.wordCount,
    isFlagged: note.isFlagged,
  };

  // Include summary fields if available
  if (note.summary) {
    snapshot.shortSummary = note.summary.shortSummary;
    snapshot.keyTakeaways = note.summary.keyTakeaways;
    snapshot.sentiment = note.summary.sentiment;
    snapshot.sentimentConfidence = note.summary.sentimentConfidence;
    snapshot.keyDataPoints = note.summary.keyDataPoints;
    snapshot.timeHorizon = note.summary.timeHorizon;
  }

  if (note.userNotes) {
    snapshot.userNotes = note.userNotes;
  }

  return snapshot;
}

/**
 * Build summary statistics from search results
 */
function buildSearchSummary(notes: StoredResearchNote[]): ResearchSearchResult['summary'] {
  const sourceTypeCounts: Record<string, number> = {};
  const sentimentCounts: Record<string, number> = {};
  let totalTrustScore = 0;
  let withSummaryCount = 0;
  let earliestPublication: string | undefined;
  let latestPublication: string | undefined;

  for (const note of notes) {
    // Count source types
    sourceTypeCounts[note.sourceType] = (sourceTypeCounts[note.sourceType] || 0) + 1;

    // Count sentiments
    if (note.summary?.sentiment) {
      sentimentCounts[note.summary.sentiment] = (sentimentCounts[note.summary.sentiment] || 0) + 1;
    }

    // Sum trust scores
    totalTrustScore += note.trustScore;

    // Count with summaries
    if (note.summary) {
      withSummaryCount++;
    }

    // Track date range
    if (!earliestPublication || note.publishedAt < earliestPublication) {
      earliestPublication = note.publishedAt;
    }
    if (!latestPublication || note.publishedAt > latestPublication) {
      latestPublication = note.publishedAt;
    }
  }

  return {
    sourceTypeCounts,
    sentimentCounts,
    averageTrustScore: notes.length > 0 ? totalTrustScore / notes.length : 0,
    withSummaryCount,
    earliestPublication,
    latestPublication,
  };
}

/**
 * Combine symbol and keyword search into a query
 */
function buildSearchQuery(keywords?: string[]): string | undefined {
  if (!keywords || keywords.length === 0) {
    return undefined;
  }
  // Join keywords with spaces for full-text search
  return keywords.join(' ');
}

// ============================================================================
// Research Search Function
// ============================================================================

/**
 * Search research notes with filters
 */
export async function searchResearch(
  storage: ResearchStorageService,
  input: SearchResearchInput
): Promise<ResearchSearchResult> {
  const startTime = new Date();

  // Build query options from input
  const queryOptions: ResearchQueryOptions = {
    symbols: input.symbol ? [input.symbol] : undefined,
    searchQuery: buildSearchQuery(input.keywords),
    sourceTypes: input.sourceTypes,
    sentiment: input.sentiment,
    publishedAfter: input.publishedAfter,
    publishedBefore: input.publishedBefore,
    flaggedOnly: input.flaggedOnly,
    hasSummary: input.hasSummary,
    limit: input.limit || 20,
    offset: input.offset || 0,
    sortBy: input.sortBy || 'publishedAt',
    sortOrder: input.sortOrder || 'desc',
  };

  // Execute query
  const result = await storage.query(queryOptions);

  // Convert notes to snapshots
  const noteSnapshots = result.notes.map(toNoteSnapshot);

  // Build summary statistics
  const summary = buildSearchSummary(result.notes);

  return {
    notes: noteSnapshots,
    totalCount: result.totalCount,
    hasMore: result.hasMore,
    request: {
      symbol: input.symbol,
      keywords: input.keywords,
      sourceTypes: input.sourceTypes,
      sentiment: input.sentiment,
      limit: queryOptions.limit || 20,
      offset: queryOptions.offset || 0,
      publishedAfter: input.publishedAfter,
      publishedBefore: input.publishedBefore,
      sortBy: queryOptions.sortBy,
      sortOrder: queryOptions.sortOrder,
    },
    summary,
    dataTimestamp: startTime.toISOString(),
    dataSources: [
      {
        source: 'Research Storage',
        retrievedAt: startTime.toISOString(),
      },
    ],
  };
}

// ============================================================================
// DataSource Helper for TradeProposal
// ============================================================================

/**
 * Convert research notes to DataSource entries for TradeProposal.dataUsed
 *
 * @param notes - Research notes used in generating a trade idea
 * @returns Array of DataSource entries to include in TradeProposal.dataUsed
 */
export function researchNotesToDataSources(notes: ResearchNoteSnapshot[]): DataSource[] {
  return notes.map((note) => ({
    sourceType: note.sourceType === 'news' || note.sourceType === 'blog' || note.sourceType === 'social'
      ? 'news'
      : note.sourceType === 'sec_filing' || note.sourceType === 'analyst'
      ? 'research'
      : note.sourceType === 'earnings'
      ? 'earnings'
      : 'other',
    description: `${note.sourceName}: "${note.headline}"${note.sentiment ? ` (${note.sentiment})` : ''}`,
    retrievedAt: new Date(note.ingestedAt),
    reference: note.id, // Reference the note ID for traceability
  }));
}

/**
 * Format research notes as a citation string for trade proposal thesis
 *
 * @param notes - Research notes to cite
 * @returns Formatted citation string
 */
export function formatResearchCitations(notes: ResearchNoteSnapshot[]): string {
  if (notes.length === 0) {
    return '';
  }

  const citations = notes.map((note, index) => {
    const date = new Date(note.publishedAt).toLocaleDateString();
    return `[${index + 1}] ${note.sourceName} (${date}): "${note.headline}"`;
  });

  return `Sources:\n${citations.join('\n')}`;
}

// ============================================================================
// MCP Tool Definition
// ============================================================================

/**
 * Context required for research retrieval tool
 */
export interface ResearchRetrievalToolContext {
  /** Research storage service for querying notes */
  storage: ResearchStorageService | null;
}

/**
 * Create the search_research tool definition
 *
 * @param context - Tool context with dependencies
 * @returns MCP tool definition
 */
export function createSearchResearchTool(context: ResearchRetrievalToolContext): MCPToolDefinition {
  return {
    name: 'search_research',
    description: `Search and retrieve research notes for trade idea analysis.

Returns relevant research notes with:
- Headlines and summaries
- Source citations (name, URL, publication date)
- Sentiment analysis (bullish/bearish/neutral/mixed)
- Key data points (earnings, guidance, ratings, etc.)
- Trust scores for source reliability
- Associated ticker symbols

Search options:
- symbol: Filter by ticker symbol (e.g., "AAPL")
- keywords: Full-text search terms (e.g., ["earnings", "guidance"])
- sourceTypes: Filter by source (news, sec_filing, earnings, analyst, etc.)
- sentiment: Filter by sentiment (bullish, bearish, neutral, mixed)
- publishedAfter/Before: Date range filters (ISO format)
- flaggedOnly: Only important flagged notes
- hasSummary: Only notes with AI summaries
- limit/offset: Pagination (default 20 results)
- sortBy: publishedAt, ingestedAt, trustScore, or wordCount
- sortOrder: asc or desc (default: desc)

Use this tool to gather research context before recommending trades.
Include the returned notes in your TradeProposal.dataUsed field.`,
    inputSchema: SearchResearchInputSchema,
    handler: async (input: unknown): Promise<MCPToolResult> => {
      const startTime = new Date();

      // Check if storage is available
      if (!context.storage) {
        return {
          success: false,
          error: 'Research storage not available. Please ensure the storage service is initialized.',
          timestamp: startTime.toISOString(),
        };
      }

      try {
        // Parse and validate input
        const parsedInput = SearchResearchInputSchema.parse(input);

        // Execute search
        const result = await searchResearch(context.storage, parsedInput);

        return {
          success: true,
          data: result,
          timestamp: startTime.toISOString(),
          metadata: {
            totalCount: result.totalCount,
            returnedCount: result.notes.length,
            hasMore: result.hasMore,
            symbol: parsedInput.symbol,
            keywordCount: parsedInput.keywords?.length || 0,
            withSummaryCount: result.summary.withSummaryCount,
            averageTrustScore: result.summary.averageTrustScore,
          },
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        return {
          success: false,
          error: `Failed to search research: ${errorMessage}`,
          timestamp: startTime.toISOString(),
        };
      }
    },
  };
}

/**
 * Standalone function to search research (for direct API use)
 *
 * @param storage - Research storage service
 * @param input - Search parameters
 * @returns Research search result
 */
export async function getResearch(
  storage: ResearchStorageService,
  input: SearchResearchInput
): Promise<ResearchSearchResult> {
  return searchResearch(storage, input);
}

/**
 * Get research by symbol (convenience function)
 *
 * @param storage - Research storage service
 * @param symbol - Ticker symbol
 * @param limit - Maximum results (default 10)
 * @returns Research search result for the symbol
 */
export async function getResearchBySymbol(
  storage: ResearchStorageService,
  symbol: string,
  limit: number = 10
): Promise<ResearchSearchResult> {
  return searchResearch(storage, {
    symbol: symbol.toUpperCase(),
    limit,
    sortBy: 'publishedAt',
    sortOrder: 'desc',
  });
}

/**
 * Get recent research (convenience function)
 *
 * @param storage - Research storage service
 * @param limit - Maximum results (default 20)
 * @returns Recent research notes
 */
export async function getRecentResearch(
  storage: ResearchStorageService,
  limit: number = 20
): Promise<ResearchSearchResult> {
  return searchResearch(storage, {
    limit,
    sortBy: 'ingestedAt',
    sortOrder: 'desc',
  });
}

/**
 * Get research with specific sentiment (convenience function)
 *
 * @param storage - Research storage service
 * @param sentiment - Sentiment to filter by
 * @param symbol - Optional symbol filter
 * @param limit - Maximum results (default 10)
 * @returns Research notes with the specified sentiment
 */
export async function getResearchBySentiment(
  storage: ResearchStorageService,
  sentiment: 'bullish' | 'bearish' | 'neutral' | 'mixed',
  symbol?: string,
  limit: number = 10
): Promise<ResearchSearchResult> {
  return searchResearch(storage, {
    symbol: symbol?.toUpperCase(),
    sentiment: [sentiment],
    hasSummary: true, // Sentiment requires summary
    limit,
    sortBy: 'publishedAt',
    sortOrder: 'desc',
  });
}
