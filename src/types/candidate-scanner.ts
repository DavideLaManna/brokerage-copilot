/**
 * Candidate Scanner Types
 *
 * Defines types and schemas for the automated trade candidate scanner.
 * The scanner identifies potential trade opportunities based on configurable
 * criteria including technical analysis, liquidity, and research catalysts.
 */

import { z } from 'zod';
import type { ConfidenceLevel, StrategyType, TradeProposal } from './trade-proposal.js';
import type { TechnicalAnalysis, RSIInterpretation } from '../services/technical-indicators.js';
import type { LiquidityRating } from '../services/liquidity.js';
import type { StoredResearchNote } from './research.js';

// ============================================================================
// Scanner Trigger Types
// ============================================================================

/**
 * Types of technical triggers that can generate candidates
 */
export type TechnicalTriggerType =
  | 'rsi_oversold'        // RSI < 30
  | 'rsi_overbought'      // RSI > 70
  | 'golden_cross'        // 50 SMA crosses above 200 SMA
  | 'death_cross'         // 50 SMA crosses below 200 SMA
  | 'price_above_ma'      // Price above key MA
  | 'price_below_ma'      // Price below key MA
  | 'high_volatility'     // ATR above threshold
  | 'low_volatility';     // ATR below threshold

/**
 * Types of research triggers that can generate candidates
 */
export type ResearchTriggerType =
  | 'bullish_news'        // Recent bullish sentiment research
  | 'bearish_news'        // Recent bearish sentiment research
  | 'earnings_upcoming'   // Earnings announcement approaching
  | 'catalyst_present';   // Any significant catalyst identified

/**
 * Combined trigger type for scanner
 */
export type ScannerTriggerType = TechnicalTriggerType | ResearchTriggerType;

// ============================================================================
// Scanner Configuration
// ============================================================================

/**
 * Configuration for scanner filters
 */
export interface ScannerFilters {
  // Technical triggers
  /** Enable RSI oversold detection (RSI < threshold) */
  rsiOversold?: {
    enabled: boolean;
    threshold?: number;  // Default: 30
  };
  /** Enable RSI overbought detection (RSI > threshold) */
  rsiOverbought?: {
    enabled: boolean;
    threshold?: number;  // Default: 70
  };
  /** Enable golden cross detection (50 SMA > 200 SMA) */
  goldenCross?: {
    enabled: boolean;
  };
  /** Enable death cross detection (50 SMA < 200 SMA) */
  deathCross?: {
    enabled: boolean;
  };
  /** Enable high volatility detection (ATR > threshold%) */
  highVolatility?: {
    enabled: boolean;
    thresholdPercent?: number;  // Default: 3%
  };

  // Research triggers
  /** Enable bullish news trigger */
  bullishNews?: {
    enabled: boolean;
    /** Hours to look back for news */
    lookbackHours?: number;  // Default: 48
    /** Minimum trust score for research */
    minTrustScore?: number;  // Default: 0.7
  };
  /** Enable bearish news trigger */
  bearishNews?: {
    enabled: boolean;
    lookbackHours?: number;
    minTrustScore?: number;
  };
  /** Enable upcoming earnings trigger */
  earningsUpcoming?: {
    enabled: boolean;
    /** Days before earnings to trigger */
    daysBeforeEarnings?: number;  // Default: 14
  };

  // Options filters
  /** Minimum days to expiration */
  minDTE?: number;  // Default: 14
  /** Maximum days to expiration */
  maxDTE?: number;  // Default: 60
  /** Minimum liquidity rating */
  minLiquidityRating?: LiquidityRating;  // Default: 'medium'
  /** Minimum open interest */
  minOpenInterest?: number;  // Default: 100
  /** Minimum volume */
  minVolume?: number;  // Default: 10
  /** Maximum bid-ask spread percent */
  maxSpreadPercent?: number;  // Default: 5%

  // IV filters (if available)
  /** Minimum IV rank (0-100) */
  minIVRank?: number;
  /** Maximum IV rank (0-100) */
  maxIVRank?: number;
}

/**
 * Full scanner configuration
 */
export interface CandidateScannerConfig {
  /** Symbols to scan (if empty, scans watchlist or all tracked symbols) */
  symbolsToScan?: string[];
  /** Scanner filters */
  filters: ScannerFilters;
  /** Polling interval in milliseconds (default: 5 minutes) */
  pollingIntervalMs?: number;
  /** Maximum candidates per scan */
  maxCandidatesPerScan?: number;  // Default: 20
  /** Maximum candidates per symbol */
  maxCandidatesPerSymbol?: number;  // Default: 3
  /** Minimum score to include candidate (0-100) */
  minScore?: number;  // Default: 50
  /** Minimum confidence for generated proposals */
  minConfidence?: ConfidenceLevel;  // Default: 'low'
  /** Whether to auto-generate TradeProposals */
  generateProposals?: boolean;  // Default: true
  /** Strategy types to consider for proposal generation */
  allowedStrategies?: StrategyType[];
}

export const ScannerFiltersSchema = z.object({
  rsiOversold: z.object({
    enabled: z.boolean(),
    threshold: z.number().min(0).max(100).optional(),
  }).optional(),
  rsiOverbought: z.object({
    enabled: z.boolean(),
    threshold: z.number().min(0).max(100).optional(),
  }).optional(),
  goldenCross: z.object({
    enabled: z.boolean(),
  }).optional(),
  deathCross: z.object({
    enabled: z.boolean(),
  }).optional(),
  highVolatility: z.object({
    enabled: z.boolean(),
    thresholdPercent: z.number().positive().optional(),
  }).optional(),
  bullishNews: z.object({
    enabled: z.boolean(),
    lookbackHours: z.number().positive().optional(),
    minTrustScore: z.number().min(0).max(1).optional(),
  }).optional(),
  bearishNews: z.object({
    enabled: z.boolean(),
    lookbackHours: z.number().positive().optional(),
    minTrustScore: z.number().min(0).max(1).optional(),
  }).optional(),
  earningsUpcoming: z.object({
    enabled: z.boolean(),
    daysBeforeEarnings: z.number().positive().optional(),
  }).optional(),
  minDTE: z.number().int().nonnegative().optional(),
  maxDTE: z.number().int().positive().optional(),
  minLiquidityRating: z.enum(['high', 'medium', 'low', 'very_low']).optional(),
  minOpenInterest: z.number().int().nonnegative().optional(),
  minVolume: z.number().int().nonnegative().optional(),
  maxSpreadPercent: z.number().min(0).max(100).optional(),
  minIVRank: z.number().min(0).max(100).optional(),
  maxIVRank: z.number().min(0).max(100).optional(),
});

export const CandidateScannerConfigSchema = z.object({
  symbolsToScan: z.array(z.string().min(1)).optional(),
  filters: ScannerFiltersSchema,
  pollingIntervalMs: z.number().int().positive().optional(),
  maxCandidatesPerScan: z.number().int().positive().optional(),
  maxCandidatesPerSymbol: z.number().int().positive().optional(),
  minScore: z.number().min(0).max(100).optional(),
  minConfidence: z.enum(['low', 'medium', 'high']).optional(),
  generateProposals: z.boolean().optional(),
  allowedStrategies: z.array(z.enum([
    'long_call', 'long_put', 'short_call', 'short_put',
    'covered_call', 'cash_secured_put', 'vertical_spread',
    'calendar_spread', 'iron_condor', 'straddle', 'strangle', 'custom',
  ])).optional(),
});

// ============================================================================
// Default Configuration
// ============================================================================

export const DEFAULT_SCANNER_FILTERS: ScannerFilters = {
  rsiOversold: { enabled: true, threshold: 30 },
  rsiOverbought: { enabled: true, threshold: 70 },
  goldenCross: { enabled: true },
  deathCross: { enabled: true },
  highVolatility: { enabled: true, thresholdPercent: 3 },
  bullishNews: { enabled: true, lookbackHours: 48, minTrustScore: 0.7 },
  bearishNews: { enabled: true, lookbackHours: 48, minTrustScore: 0.7 },
  earningsUpcoming: { enabled: false, daysBeforeEarnings: 14 },
  minDTE: 14,
  maxDTE: 60,
  minLiquidityRating: 'medium',
  minOpenInterest: 100,
  minVolume: 10,
  maxSpreadPercent: 5,
};

export const DEFAULT_SCANNER_CONFIG: CandidateScannerConfig = {
  symbolsToScan: [],
  filters: DEFAULT_SCANNER_FILTERS,
  pollingIntervalMs: 5 * 60 * 1000, // 5 minutes
  maxCandidatesPerScan: 20,
  maxCandidatesPerSymbol: 3,
  minScore: 50,
  minConfidence: 'low',
  generateProposals: true,
  allowedStrategies: [
    'long_call', 'long_put', 'cash_secured_put',
    'vertical_spread', 'iron_condor',
  ],
};

// ============================================================================
// Scanner Result Types
// ============================================================================

/**
 * Score breakdown for a candidate
 */
export interface CandidateScoreBreakdown {
  /** Technical analysis score (0-100) */
  technicalScore: number;
  /** Research/catalyst score (0-100) */
  researchScore: number;
  /** Liquidity score (0-100) */
  liquidityScore: number;
  /** IV rank score if available (0-100) */
  ivRankScore?: number;
}

/**
 * Triggered conditions that led to candidate generation
 */
export interface CandidateTrigger {
  /** Type of trigger */
  type: ScannerTriggerType;
  /** Description of the trigger condition */
  description: string;
  /** Actual value that triggered */
  value?: number | string;
  /** Threshold that was crossed */
  threshold?: number | string;
  /** Severity/strength of the signal */
  strength: 'weak' | 'moderate' | 'strong';
}

/**
 * A trade candidate generated by the scanner
 */
export interface TradeCandidate {
  /** Unique identifier */
  id: string;
  /** Underlying symbol */
  symbol: string;
  /** Current underlying price */
  currentPrice: number;
  /** When the candidate was generated */
  generatedAt: Date;
  /** Triggers that created this candidate */
  triggers: CandidateTrigger[];
  /** Technical analysis snapshot */
  technicals: TechnicalAnalysis;
  /** Related research notes */
  researchContext: ResearchNoteReference[];
  /** Overall score (0-100) */
  score: number;
  /** Score breakdown */
  scoreBreakdown: CandidateScoreBreakdown;
  /** Suggested strategy based on analysis */
  suggestedStrategy: StrategyType;
  /** Reasoning for strategy suggestion */
  strategyRationale: string;
  /** Generated TradeProposal (if generateProposals is enabled) */
  proposal?: TradeProposal;
  /** Proposal ID if stored */
  proposalId?: string;
  /** Warnings or concerns */
  warnings: string[];
}

/**
 * Reference to a research note (lightweight for storage)
 */
export interface ResearchNoteReference {
  /** Research note ID */
  id: string;
  /** Headline */
  headline: string;
  /** Sentiment */
  sentiment?: 'bullish' | 'bearish' | 'neutral' | 'mixed';
  /** Source name */
  sourceName: string;
  /** Published date */
  publishedAt: string;
  /** Trust score */
  trustScore: number;
}

/**
 * Stored candidate (persisted to disk)
 */
export interface StoredTradeCandidate extends TradeCandidate {
  /** Account ID this belongs to */
  accountId: string;
  /** Status of the candidate */
  status: 'new' | 'viewed' | 'dismissed' | 'actioned';
  /** When the candidate was viewed (if viewed) */
  viewedAt?: Date;
  /** When the candidate was dismissed (if dismissed) */
  dismissedAt?: Date;
  /** Dismiss reason (if dismissed) */
  dismissReason?: string;
  /** When actioned (proposal created/submitted) */
  actionedAt?: Date;
  /** Created timestamp */
  createdAt: Date;
  /** Updated timestamp */
  updatedAt: Date;
}

/**
 * Result of a scanner scan operation
 */
export interface CandidateScanResult {
  /** When the scan was performed */
  scannedAt: Date;
  /** Symbols that were scanned */
  scannedSymbols: string[];
  /** Number of symbols evaluated */
  symbolsEvaluated: number;
  /** Generated candidates */
  candidates: TradeCandidate[];
  /** Summary statistics */
  summary: {
    /** Total candidates generated */
    total: number;
    /** Candidates by strategy type */
    byStrategy: Partial<Record<StrategyType, number>>;
    /** Candidates by trigger type */
    byTrigger: Partial<Record<ScannerTriggerType, number>>;
    /** Average score */
    averageScore: number;
  };
  /** Symbols skipped and why */
  skipped: Array<{ symbol: string; reason: string }>;
  /** Warnings during scan */
  warnings: string[];
  /** Scan duration in milliseconds */
  durationMs: number;
}

/**
 * Query options for retrieving candidates
 */
export interface CandidateQueryOptions {
  /** Filter by symbols */
  symbols?: string[];
  /** Filter by status */
  status?: Array<'new' | 'viewed' | 'dismissed' | 'actioned'>;
  /** Filter by trigger types */
  triggerTypes?: ScannerTriggerType[];
  /** Filter by strategy types */
  strategyTypes?: StrategyType[];
  /** Minimum score */
  minScore?: number;
  /** Generated after this date */
  generatedAfter?: Date;
  /** Generated before this date */
  generatedBefore?: Date;
  /** Sort field */
  sortBy?: 'score' | 'generatedAt' | 'symbol';
  /** Sort order */
  sortOrder?: 'asc' | 'desc';
  /** Pagination offset */
  offset?: number;
  /** Pagination limit */
  limit?: number;
}

/**
 * Result of querying candidates
 */
export interface CandidateQueryResult {
  /** Candidates matching the query */
  candidates: StoredTradeCandidate[];
  /** Total count (before pagination) */
  totalCount: number;
  /** Whether there are more results */
  hasMore: boolean;
}

// ============================================================================
// Zod Schemas for Validation
// ============================================================================

export const CandidateTriggerSchema = z.object({
  type: z.enum([
    'rsi_oversold', 'rsi_overbought', 'golden_cross', 'death_cross',
    'price_above_ma', 'price_below_ma', 'high_volatility', 'low_volatility',
    'bullish_news', 'bearish_news', 'earnings_upcoming', 'catalyst_present',
  ]),
  description: z.string().min(1),
  value: z.union([z.number(), z.string()]).optional(),
  threshold: z.union([z.number(), z.string()]).optional(),
  strength: z.enum(['weak', 'moderate', 'strong']),
});

export const CandidateScoreBreakdownSchema = z.object({
  technicalScore: z.number().min(0).max(100),
  researchScore: z.number().min(0).max(100),
  liquidityScore: z.number().min(0).max(100),
  ivRankScore: z.number().min(0).max(100).optional(),
});

export const ResearchNoteReferenceSchema = z.object({
  id: z.string().min(1),
  headline: z.string().min(1),
  sentiment: z.enum(['bullish', 'bearish', 'neutral', 'mixed']).optional(),
  sourceName: z.string().min(1),
  publishedAt: z.string(),
  trustScore: z.number().min(0).max(1),
});

export const TradeCandidateSchema = z.object({
  id: z.string().uuid(),
  symbol: z.string().min(1),
  currentPrice: z.number().positive(),
  generatedAt: z.date(),
  triggers: z.array(CandidateTriggerSchema).min(1),
  technicals: z.object({}).passthrough(), // TechnicalAnalysis is complex, pass through
  researchContext: z.array(ResearchNoteReferenceSchema),
  score: z.number().min(0).max(100),
  scoreBreakdown: CandidateScoreBreakdownSchema,
  suggestedStrategy: z.enum([
    'long_call', 'long_put', 'short_call', 'short_put',
    'covered_call', 'cash_secured_put', 'vertical_spread',
    'calendar_spread', 'iron_condor', 'straddle', 'strangle', 'custom',
  ]),
  strategyRationale: z.string().min(1),
  proposal: z.object({}).passthrough().optional(), // TradeProposal is complex
  proposalId: z.string().uuid().optional(),
  warnings: z.array(z.string()),
});

export const StoredTradeCandidateSchema = TradeCandidateSchema.extend({
  accountId: z.string().min(1),
  status: z.enum(['new', 'viewed', 'dismissed', 'actioned']),
  viewedAt: z.date().optional(),
  dismissedAt: z.date().optional(),
  dismissReason: z.string().optional(),
  actionedAt: z.date().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Format trigger type for display
 */
export function formatTriggerType(type: ScannerTriggerType): string {
  const names: Record<ScannerTriggerType, string> = {
    rsi_oversold: 'RSI Oversold',
    rsi_overbought: 'RSI Overbought',
    golden_cross: 'Golden Cross',
    death_cross: 'Death Cross',
    price_above_ma: 'Price Above MA',
    price_below_ma: 'Price Below MA',
    high_volatility: 'High Volatility',
    low_volatility: 'Low Volatility',
    bullish_news: 'Bullish News',
    bearish_news: 'Bearish News',
    earnings_upcoming: 'Earnings Upcoming',
    catalyst_present: 'Catalyst Present',
  };
  return names[type] || type;
}

/**
 * Format candidate status for display
 */
export function formatCandidateStatus(status: StoredTradeCandidate['status']): string {
  const names: Record<StoredTradeCandidate['status'], string> = {
    new: 'New',
    viewed: 'Viewed',
    dismissed: 'Dismissed',
    actioned: 'Actioned',
  };
  return names[status] || status;
}

/**
 * Get trigger strength class for styling
 */
export function getTriggerStrengthClass(strength: CandidateTrigger['strength']): string {
  const classes: Record<CandidateTrigger['strength'], string> = {
    weak: 'trigger-weak',
    moderate: 'trigger-moderate',
    strong: 'trigger-strong',
  };
  return classes[strength] || '';
}

/**
 * Determine if a trigger is bullish or bearish
 */
export function isBullishTrigger(type: ScannerTriggerType): boolean {
  const bullishTriggers: ScannerTriggerType[] = [
    'rsi_oversold',    // Potential bounce
    'golden_cross',
    'price_above_ma',
    'bullish_news',
  ];
  return bullishTriggers.includes(type);
}

/**
 * Determine if a trigger is bearish
 */
export function isBearishTrigger(type: ScannerTriggerType): boolean {
  const bearishTriggers: ScannerTriggerType[] = [
    'rsi_overbought',  // Potential pullback
    'death_cross',
    'price_below_ma',
    'bearish_news',
  ];
  return bearishTriggers.includes(type);
}

/**
 * Get suggested direction based on triggers
 */
export function getSuggestedDirection(triggers: CandidateTrigger[]): 'bullish' | 'bearish' | 'neutral' {
  let bullishCount = 0;
  let bearishCount = 0;

  for (const trigger of triggers) {
    if (isBullishTrigger(trigger.type)) {
      bullishCount += trigger.strength === 'strong' ? 2 : trigger.strength === 'moderate' ? 1.5 : 1;
    } else if (isBearishTrigger(trigger.type)) {
      bearishCount += trigger.strength === 'strong' ? 2 : trigger.strength === 'moderate' ? 1.5 : 1;
    }
  }

  if (bullishCount > bearishCount + 0.5) return 'bullish';
  if (bearishCount > bullishCount + 0.5) return 'bearish';
  return 'neutral';
}

/**
 * Validate scanner configuration
 */
export function validateScannerConfig(config: unknown): {
  valid: boolean;
  errors: string[];
  warnings: string[];
} {
  const result = CandidateScannerConfigSchema.safeParse(config);
  const warnings: string[] = [];

  if (!result.success) {
    return {
      valid: false,
      errors: result.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`),
      warnings: [],
    };
  }

  const data = result.data;

  // Check for warnings
  if (data.filters.minDTE !== undefined && data.filters.maxDTE !== undefined) {
    if (data.filters.minDTE >= data.filters.maxDTE) {
      return {
        valid: false,
        errors: ['minDTE must be less than maxDTE'],
        warnings: [],
      };
    }
  }

  if (data.minScore !== undefined && data.minScore > 80) {
    warnings.push('High minScore (>80) may result in very few candidates');
  }

  if (data.maxCandidatesPerScan !== undefined && data.maxCandidatesPerScan > 50) {
    warnings.push('Large maxCandidatesPerScan may impact performance');
  }

  // Count enabled triggers
  const enabledTriggers = [
    data.filters.rsiOversold?.enabled,
    data.filters.rsiOverbought?.enabled,
    data.filters.goldenCross?.enabled,
    data.filters.deathCross?.enabled,
    data.filters.highVolatility?.enabled,
    data.filters.bullishNews?.enabled,
    data.filters.bearishNews?.enabled,
    data.filters.earningsUpcoming?.enabled,
  ].filter(Boolean).length;

  if (enabledTriggers === 0) {
    warnings.push('No triggers enabled - scanner will not generate candidates');
  }

  return {
    valid: true,
    errors: [],
    warnings,
  };
}

/**
 * Create research note reference from stored note
 */
export function createResearchNoteReference(note: StoredResearchNote): ResearchNoteReference {
  return {
    id: note.id,
    headline: note.headline,
    sentiment: note.summary?.sentiment,
    sourceName: note.sourceName,
    publishedAt: note.publishedAt,
    trustScore: note.trustScore,
  };
}

/**
 * Calculate overall score from breakdown
 */
export function calculateOverallScore(breakdown: CandidateScoreBreakdown): number {
  // Weight: Technical 40%, Research 30%, Liquidity 20%, IV Rank 10%
  const technicalWeight = 0.4;
  const researchWeight = 0.3;
  const liquidityWeight = 0.2;
  const ivRankWeight = 0.1;

  let score = breakdown.technicalScore * technicalWeight +
              breakdown.researchScore * researchWeight +
              breakdown.liquidityScore * liquidityWeight;

  if (breakdown.ivRankScore !== undefined) {
    score += breakdown.ivRankScore * ivRankWeight;
  } else {
    // Redistribute IV weight to other factors
    score = score / (1 - ivRankWeight);
  }

  return Math.round(Math.min(100, Math.max(0, score)));
}

/**
 * Get summary of a candidate for display
 */
export function getCandidateSummary(candidate: TradeCandidate): string {
  const triggerNames = candidate.triggers.map((t) => formatTriggerType(t.type)).join(', ');
  return `${candidate.symbol} - Score: ${candidate.score} - ${candidate.suggestedStrategy} - Triggers: ${triggerNames}`;
}

// ============================================================================
// Schema Version
// ============================================================================

export const CANDIDATE_SCANNER_SCHEMA_VERSION = 1;
