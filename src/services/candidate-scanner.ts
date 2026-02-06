/**
 * Candidate Scanner Service
 *
 * Automated scanner for identifying new trade candidates based on configurable
 * criteria including technical analysis, liquidity metrics, and research catalysts.
 *
 * Key features:
 * - Multiple trigger types (RSI, MA crossovers, volatility, news)
 * - Configurable filters (DTE, liquidity, IV rank)
 * - Scoring and ranking system
 * - Automatic TradeProposal generation for top candidates
 * - Scheduled or on-demand scanning
 * - In-memory storage with persistence
 */

import { randomUUID } from 'crypto';
import * as path from 'path';
import * as fs from 'fs/promises';
import type { BrokerAdapter, Position, AccountSummary, Quote, OptionChain, OptionContract } from '../types/broker.js';
import type { MarketDataService } from './market-data.js';
import type { ResearchStorageService } from './research-storage.js';
import type { TradeProposalService } from './trade-proposal.js';
import type { AuditLogService } from './audit-log.js';
import type { StoredResearchNote } from '../types/research.js';
import type {
  TradeProposal,
  StrategyType,
  ConfidenceLevel,
  ProposalContract,
  DataSource,
} from '../types/trade-proposal.js';
import {
  computeTechnicalIndicators,
  type TechnicalAnalysis,
  type ComputeTechnicalsInput,
} from './technical-indicators.js';
import {
  getLiquidityRating,
  computeLiquidityMetrics,
  type LiquidityRating,
} from './liquidity.js';
import {
  type CandidateScannerConfig,
  type ScannerFilters,
  type TradeCandidate,
  type StoredTradeCandidate,
  type CandidateTrigger,
  type CandidateScoreBreakdown,
  type CandidateScanResult,
  type CandidateQueryOptions,
  type CandidateQueryResult,
  type ResearchNoteReference,
  type ScannerTriggerType,
  DEFAULT_SCANNER_CONFIG,
  DEFAULT_SCANNER_FILTERS,
  CANDIDATE_SCANNER_SCHEMA_VERSION,
  createResearchNoteReference,
  calculateOverallScore,
  getSuggestedDirection,
  isBullishTrigger,
  isBearishTrigger,
  formatTriggerType,
} from '../types/candidate-scanner.js';
import { encrypt, decrypt, type EncryptedData } from '../storage/encryption.js';

/**
 * Storage file structure
 */
interface CandidateStorageFile {
  version: number;
  candidates: Record<string, EncryptedData>;
  savedAt: string;
}

// ============================================================================
// Types
// ============================================================================

/**
 * Logger interface for the scanner service
 */
export interface CandidateScannerLogger {
  debug?: (message: string, data?: unknown) => void;
  info?: (message: string, data?: unknown) => void;
  warn?: (message: string, data?: unknown) => void;
  error?: (message: string, data?: unknown) => void;
}

/**
 * Options for creating the scanner service
 */
export interface CandidateScannerServiceOptions {
  /** Account ID for this scanner instance */
  accountId: string;
  /** Scanner configuration */
  config?: Partial<CandidateScannerConfig>;
  /** Logger for debug output */
  logger?: CandidateScannerLogger;
  /** Directory for persisting data (defaults to .config/candidates/) */
  storageDir?: string;
  /** Master password for encryption */
  masterPassword?: string;
}

// ============================================================================
// Service Implementation
// ============================================================================

/**
 * Candidate Scanner Service
 *
 * Scans for trade candidates based on technical analysis, research,
 * and liquidity criteria. Generates scored and ranked candidates
 * with optional automatic TradeProposal creation.
 */
export class CandidateScannerService {
  private adapter: BrokerAdapter;
  private marketDataService: MarketDataService;
  private researchStorage?: ResearchStorageService;
  private proposalService?: TradeProposalService;
  private auditLogService?: AuditLogService;
  private accountId: string;
  private config: CandidateScannerConfig;
  private logger?: CandidateScannerLogger;
  private storageDir: string;
  private masterPassword?: string;

  // In-memory storage
  private candidates: Map<string, StoredTradeCandidate> = new Map();
  private initialized = false;

  // Polling state
  private pollingInterval: NodeJS.Timeout | null = null;
  private isPolling = false;
  private lastScanAt?: Date;

  constructor(
    adapter: BrokerAdapter,
    marketDataService: MarketDataService,
    options: CandidateScannerServiceOptions,
    researchStorage?: ResearchStorageService,
    proposalService?: TradeProposalService,
    auditLogService?: AuditLogService
  ) {
    this.adapter = adapter;
    this.marketDataService = marketDataService;
    this.researchStorage = researchStorage;
    this.proposalService = proposalService;
    this.auditLogService = auditLogService;
    this.accountId = options.accountId;
    this.config = {
      ...DEFAULT_SCANNER_CONFIG,
      ...options.config,
      filters: {
        ...DEFAULT_SCANNER_FILTERS,
        ...options.config?.filters,
      },
    };
    this.logger = options.logger;
    this.storageDir = options.storageDir || '.config/candidates';
    this.masterPassword = options.masterPassword;

    this.logger?.info?.('[CANDIDATE SCANNER] Service created', {
      accountId: this.accountId,
      symbolsToScan: this.config.symbolsToScan?.length ?? 'all',
      pollingIntervalMs: this.config.pollingIntervalMs,
    });
  }

  // ============================================================================
  // Initialization and Persistence
  // ============================================================================

  /**
   * Initialize the service (load persisted data)
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      await this.loadFromDisk();
      this.initialized = true;
      this.logger?.info?.('[CANDIDATE SCANNER] Service initialized', {
        candidatesLoaded: this.candidates.size,
      });
    } catch (error) {
      this.logger?.warn?.('[CANDIDATE SCANNER] Failed to load persisted data', { error });
      this.initialized = true;
    }
  }

  /**
   * Load candidates from disk
   */
  private async loadFromDisk(): Promise<void> {
    const filePath = this.getCandidatesFilePath();
    try {
      await fs.access(filePath);
      const fileContent = await fs.readFile(filePath, 'utf-8');

      if (!this.masterPassword) {
        this.logger?.warn?.('[CANDIDATE SCANNER] No master password, skipping load');
        return;
      }

      const storageFile = JSON.parse(fileContent) as CandidateStorageFile;

      for (const [id, encryptedData] of Object.entries(storageFile.candidates)) {
        try {
          const decrypted = decrypt(encryptedData, this.masterPassword);
          const candidate = JSON.parse(decrypted) as StoredTradeCandidate;

          // Deserialize dates
          candidate.generatedAt = new Date(candidate.generatedAt);
          candidate.createdAt = new Date(candidate.createdAt);
          candidate.updatedAt = new Date(candidate.updatedAt);
          if (candidate.viewedAt) candidate.viewedAt = new Date(candidate.viewedAt);
          if (candidate.dismissedAt) candidate.dismissedAt = new Date(candidate.dismissedAt);
          if (candidate.actionedAt) candidate.actionedAt = new Date(candidate.actionedAt);

          this.candidates.set(id, candidate);
        } catch {
          // Skip corrupt entries
        }
      }
    } catch (error) {
      // File doesn't exist or read error - start fresh
    }
  }

  /**
   * Save candidates to disk
   */
  private async saveToDisk(): Promise<void> {
    if (!this.masterPassword) {
      this.logger?.debug?.('[CANDIDATE SCANNER] No master password, skipping save');
      return;
    }

    const filePath = this.getCandidatesFilePath();
    const dir = path.dirname(filePath);

    try {
      await fs.mkdir(dir, { recursive: true });

      const encryptedCandidates: Record<string, EncryptedData> = {};
      for (const [id, candidate] of this.candidates.entries()) {
        encryptedCandidates[id] = encrypt(JSON.stringify(candidate), this.masterPassword);
      }

      const storageFile: CandidateStorageFile = {
        version: CANDIDATE_SCANNER_SCHEMA_VERSION,
        candidates: encryptedCandidates,
        savedAt: new Date().toISOString(),
      };

      await fs.writeFile(filePath, JSON.stringify(storageFile, null, 2), 'utf-8');
    } catch (error) {
      this.logger?.error?.('[CANDIDATE SCANNER] Failed to save to disk', { error });
    }
  }

  private getCandidatesFilePath(): string {
    return path.join(this.storageDir, this.accountId, 'candidates.json');
  }

  // ============================================================================
  // Configuration Management
  // ============================================================================

  /**
   * Update scanner configuration
   */
  updateConfig(updates: Partial<CandidateScannerConfig>): void {
    this.config = {
      ...this.config,
      ...updates,
      filters: {
        ...this.config.filters,
        ...updates.filters,
      },
    };

    this.logger?.info?.('[CANDIDATE SCANNER] Configuration updated', {
      updates: Object.keys(updates),
    });
  }

  /**
   * Get current configuration
   */
  getConfig(): CandidateScannerConfig {
    return { ...this.config };
  }

  // ============================================================================
  // Polling Control
  // ============================================================================

  /**
   * Start automated scanning
   */
  startPolling(): void {
    if (this.pollingInterval) {
      this.logger?.warn?.('[CANDIDATE SCANNER] Polling already running');
      return;
    }

    this.isPolling = true;
    const intervalMs = this.config.pollingIntervalMs ?? 5 * 60 * 1000;

    this.pollingInterval = setInterval(async () => {
      try {
        await this.scan();
      } catch (error) {
        this.logger?.error?.('[CANDIDATE SCANNER] Polling scan failed', { error });
      }
    }, intervalMs);

    this.logger?.info?.('[CANDIDATE SCANNER] Polling started', { intervalMs });
  }

  /**
   * Stop automated scanning
   */
  stopPolling(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
    this.isPolling = false;
    this.logger?.info?.('[CANDIDATE SCANNER] Polling stopped');
  }

  /**
   * Check if polling is active
   */
  isPollingActive(): boolean {
    return this.isPolling;
  }

  // ============================================================================
  // Core Scanning Logic
  // ============================================================================

  /**
   * Run a scan for trade candidates
   */
  async scan(symbolsOverride?: string[]): Promise<CandidateScanResult> {
    const startTime = Date.now();
    const symbols = symbolsOverride ?? this.config.symbolsToScan ?? [];

    if (symbols.length === 0) {
      this.logger?.warn?.('[CANDIDATE SCANNER] No symbols to scan');
      return {
        scannedAt: new Date(),
        scannedSymbols: [],
        symbolsEvaluated: 0,
        candidates: [],
        summary: {
          total: 0,
          byStrategy: {},
          byTrigger: {},
          averageScore: 0,
        },
        skipped: [],
        warnings: ['No symbols configured for scanning'],
        durationMs: Date.now() - startTime,
      };
    }

    this.logger?.info?.('[CANDIDATE SCANNER] Starting scan', {
      symbolCount: symbols.length,
    });

    const candidates: TradeCandidate[] = [];
    const skipped: Array<{ symbol: string; reason: string }> = [];
    const warnings: string[] = [];

    // Scan each symbol
    for (const symbol of symbols) {
      try {
        const symbolCandidates = await this.evaluateSymbol(symbol);
        candidates.push(...symbolCandidates);
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'Unknown error';
        skipped.push({ symbol, reason });
        this.logger?.warn?.('[CANDIDATE SCANNER] Symbol evaluation failed', {
          symbol,
          error: reason,
        });
      }
    }

    // Apply limits
    const maxCandidates = this.config.maxCandidatesPerScan ?? 20;
    const sortedCandidates = candidates
      .sort((a, b) => b.score - a.score)
      .slice(0, maxCandidates);

    // Filter by minimum score
    const minScore = this.config.minScore ?? 50;
    const filteredCandidates = sortedCandidates.filter((c) => c.score >= minScore);

    // Store candidates
    const now = new Date();
    for (const candidate of filteredCandidates) {
      const stored: StoredTradeCandidate = {
        ...candidate,
        accountId: this.accountId,
        status: 'new',
        createdAt: now,
        updatedAt: now,
      };
      this.candidates.set(candidate.id, stored);
    }

    // Save to disk
    await this.saveToDisk();

    // Calculate summary
    const byStrategy: Partial<Record<StrategyType, number>> = {};
    const byTrigger: Partial<Record<ScannerTriggerType, number>> = {};
    let totalScore = 0;

    for (const candidate of filteredCandidates) {
      byStrategy[candidate.suggestedStrategy] = (byStrategy[candidate.suggestedStrategy] ?? 0) + 1;
      totalScore += candidate.score;
      for (const trigger of candidate.triggers) {
        byTrigger[trigger.type] = (byTrigger[trigger.type] ?? 0) + 1;
      }
    }

    const result: CandidateScanResult = {
      scannedAt: now,
      scannedSymbols: symbols,
      symbolsEvaluated: symbols.length - skipped.length,
      candidates: filteredCandidates,
      summary: {
        total: filteredCandidates.length,
        byStrategy,
        byTrigger,
        averageScore: filteredCandidates.length > 0 ? totalScore / filteredCandidates.length : 0,
      },
      skipped,
      warnings,
      durationMs: Date.now() - startTime,
    };

    this.lastScanAt = now;

    this.logger?.info?.('[CANDIDATE SCANNER] Scan complete', {
      candidatesFound: filteredCandidates.length,
      symbolsEvaluated: result.symbolsEvaluated,
      durationMs: result.durationMs,
    });

    // Log to audit
    this.auditLogService?.log({
      eventType: 'recommendation',
      actor: 'agent',
      accountId: this.accountId,
      details: {
        type: 'recommendation',
        strategyType: 'custom',
        underlying: symbols.join(','),
        confidence: 'medium',
        thesis: [`Scanned ${symbols.length} symbols for trade candidates`],
        catalysts: filteredCandidates.slice(0, 3).map((c) => `${c.symbol}: ${c.triggers[0]?.description || 'trigger detected'}`),
        contractCount: filteredCandidates.length,
      },
      summary: `Scanner found ${filteredCandidates.length} trade candidates`,
    });

    return result;
  }

  /**
   * Evaluate a single symbol for trade candidates
   */
  private async evaluateSymbol(symbol: string): Promise<TradeCandidate[]> {
    const candidates: TradeCandidate[] = [];
    const maxPerSymbol = this.config.maxCandidatesPerSymbol ?? 3;

    // Get current quote
    const quote = await this.marketDataService.getQuote(symbol);
    if (!quote || quote.last <= 0) {
      throw new Error(`No valid quote for ${symbol}`);
    }

    // Get technical analysis
    const technicals = await this.getTechnicalAnalysis(symbol);

    // Get recent research
    const researchNotes = await this.getRecentResearch(symbol);

    // Evaluate technical triggers
    const triggers = this.evaluateTriggers(technicals, researchNotes);

    if (triggers.length === 0) {
      return [];
    }

    // Calculate scores
    const scoreBreakdown = this.calculateScoreBreakdown(technicals, researchNotes, triggers);
    const overallScore = calculateOverallScore(scoreBreakdown);

    // Determine suggested strategy
    const direction = getSuggestedDirection(triggers);
    const suggestedStrategy = this.suggestStrategy(direction, triggers, technicals);
    const strategyRationale = this.generateStrategyRationale(direction, triggers, technicals);

    // Create candidate
    const candidate: TradeCandidate = {
      id: randomUUID(),
      symbol,
      currentPrice: quote.last,
      generatedAt: new Date(),
      triggers,
      technicals,
      researchContext: researchNotes.map(createResearchNoteReference),
      score: overallScore,
      scoreBreakdown,
      suggestedStrategy,
      strategyRationale,
      warnings: this.generateWarnings(technicals, triggers),
    };

    // Generate proposal if enabled
    if (this.config.generateProposals && this.proposalService) {
      try {
        const proposal = await this.generateProposal(candidate, quote);
        if (proposal) {
          candidate.proposal = proposal;

          // Store the proposal
          const stored = await this.proposalService.createProposal(
            this.accountId,
            proposal,
            { createdBy: 'CandidateScanner', status: 'draft' }
          );
          candidate.proposalId = stored.id;
        }
      } catch (error) {
        candidate.warnings.push('Failed to generate proposal: ' + (error instanceof Error ? error.message : 'Unknown error'));
      }
    }

    candidates.push(candidate);

    return candidates.slice(0, maxPerSymbol);
  }

  /**
   * Get technical analysis for a symbol
   */
  private async getTechnicalAnalysis(symbol: string): Promise<TechnicalAnalysis> {
    // Get historical bars for analysis
    const barsResponse = await this.marketDataService.getHistoricalBars({
      symbol,
      interval: 'daily',
      limit: 250, // ~1 year of daily data
    });

    if (!barsResponse.bars || barsResponse.bars.length < 50) {
      throw new Error(`Insufficient historical data for ${symbol}`);
    }

    const input: ComputeTechnicalsInput = {
      symbol,
      bars: barsResponse.bars,
    };

    return computeTechnicalIndicators(input);
  }

  /**
   * Get recent research for a symbol
   */
  private async getRecentResearch(symbol: string): Promise<StoredResearchNote[]> {
    if (!this.researchStorage) {
      return [];
    }

    const lookbackHours = this.config.filters.bullishNews?.lookbackHours ?? 48;
    const lookbackMs = lookbackHours * 60 * 60 * 1000;

    try {
      const result = await this.researchStorage.query({
        symbols: [symbol],
        publishedAfter: new Date(Date.now() - lookbackMs).toISOString(),
        sortBy: 'publishedAt',
        sortOrder: 'desc',
        limit: 10,
      });
      return result.notes;
    } catch {
      return [];
    }
  }

  /**
   * Evaluate triggers based on analysis
   */
  private evaluateTriggers(
    technicals: TechnicalAnalysis,
    researchNotes: StoredResearchNote[]
  ): CandidateTrigger[] {
    const triggers: CandidateTrigger[] = [];
    const filters = this.config.filters;

    // RSI Oversold
    if (filters.rsiOversold?.enabled && technicals.rsi) {
      const threshold = filters.rsiOversold.threshold ?? 30;
      if (technicals.rsi.value < threshold) {
        triggers.push({
          type: 'rsi_oversold',
          description: `RSI at ${technicals.rsi.value.toFixed(1)} (below ${threshold})`,
          value: technicals.rsi.value,
          threshold,
          strength: technicals.rsi.value < 20 ? 'strong' : technicals.rsi.value < 25 ? 'moderate' : 'weak',
        });
      }
    }

    // RSI Overbought
    if (filters.rsiOverbought?.enabled && technicals.rsi) {
      const threshold = filters.rsiOverbought.threshold ?? 70;
      if (technicals.rsi.value > threshold) {
        triggers.push({
          type: 'rsi_overbought',
          description: `RSI at ${technicals.rsi.value.toFixed(1)} (above ${threshold})`,
          value: technicals.rsi.value,
          threshold,
          strength: technicals.rsi.value > 80 ? 'strong' : technicals.rsi.value > 75 ? 'moderate' : 'weak',
        });
      }
    }

    // Golden Cross / Death Cross (from trend signals)
    if (filters.goldenCross?.enabled || filters.deathCross?.enabled) {
      for (const signal of technicals.trend.signals) {
        if (filters.goldenCross?.enabled && signal.toLowerCase().includes('golden cross')) {
          triggers.push({
            type: 'golden_cross',
            description: signal,
            strength: 'strong',
          });
        }
        if (filters.deathCross?.enabled && signal.toLowerCase().includes('death cross')) {
          triggers.push({
            type: 'death_cross',
            description: signal,
            strength: 'strong',
          });
        }
      }
    }

    // High Volatility
    if (filters.highVolatility?.enabled && technicals.atr) {
      const threshold = filters.highVolatility.thresholdPercent ?? 3;
      if (technicals.atr.valuePercent > threshold) {
        triggers.push({
          type: 'high_volatility',
          description: `ATR at ${technicals.atr.valuePercent.toFixed(2)}% (above ${threshold}%)`,
          value: technicals.atr.valuePercent,
          threshold,
          strength: technicals.atr.valuePercent > threshold * 1.5 ? 'strong' : 'moderate',
        });
      }
    }

    // Research triggers
    if (researchNotes.length > 0) {
      const minTrustScore = filters.bullishNews?.minTrustScore ?? 0.7;
      const trustedNotes = researchNotes.filter((n) => n.trustScore >= minTrustScore);

      // Bullish News
      if (filters.bullishNews?.enabled) {
        const bullishNotes = trustedNotes.filter((n) => n.summary?.sentiment === 'bullish');
        if (bullishNotes.length > 0) {
          triggers.push({
            type: 'bullish_news',
            description: `${bullishNotes.length} recent bullish news article(s)`,
            value: bullishNotes.length,
            strength: bullishNotes.length >= 3 ? 'strong' : bullishNotes.length >= 2 ? 'moderate' : 'weak',
          });
        }
      }

      // Bearish News
      if (filters.bearishNews?.enabled) {
        const bearishNotes = trustedNotes.filter((n) => n.summary?.sentiment === 'bearish');
        if (bearishNotes.length > 0) {
          triggers.push({
            type: 'bearish_news',
            description: `${bearishNotes.length} recent bearish news article(s)`,
            value: bearishNotes.length,
            strength: bearishNotes.length >= 3 ? 'strong' : bearishNotes.length >= 2 ? 'moderate' : 'weak',
          });
        }
      }
    }

    return triggers;
  }

  /**
   * Calculate score breakdown for a candidate
   */
  private calculateScoreBreakdown(
    technicals: TechnicalAnalysis,
    researchNotes: StoredResearchNote[],
    triggers: CandidateTrigger[]
  ): CandidateScoreBreakdown {
    // Technical score (0-100)
    let technicalScore = 50; // Base score

    // RSI contribution
    if (technicals.rsi) {
      if (technicals.rsi.interpretation === 'oversold' || technicals.rsi.interpretation === 'overbought') {
        technicalScore += 20;
      } else if (technicals.rsi.interpretation === 'approaching_oversold' || technicals.rsi.interpretation === 'approaching_overbought') {
        technicalScore += 10;
      }
    }

    // Trend contribution
    if (technicals.trend.direction === 'bullish' || technicals.trend.direction === 'bearish') {
      technicalScore += 15;
    }

    // Signal contribution
    technicalScore += Math.min(15, technicals.trend.signals.length * 5);

    technicalScore = Math.min(100, technicalScore);

    // Research score (0-100)
    let researchScore = 30; // Base score (no research is neutral)

    if (researchNotes.length > 0) {
      // Trust-weighted sentiment
      const avgTrustScore = researchNotes.reduce((sum, n) => sum + n.trustScore, 0) / researchNotes.length;
      researchScore = avgTrustScore * 50 + 25;

      // Sentiment alignment bonus
      const bullishCount = researchNotes.filter((n) => n.summary?.sentiment === 'bullish').length;
      const bearishCount = researchNotes.filter((n) => n.summary?.sentiment === 'bearish').length;

      if (bullishCount > bearishCount * 2 || bearishCount > bullishCount * 2) {
        researchScore += 20; // Strong consensus
      }
    }

    researchScore = Math.min(100, researchScore);

    // Liquidity score (0-100) - for now use a default
    // In a full implementation, this would check option chain liquidity
    const liquidityScore = 70;

    return {
      technicalScore: Math.round(technicalScore),
      researchScore: Math.round(researchScore),
      liquidityScore,
    };
  }

  /**
   * Suggest a strategy based on analysis
   */
  private suggestStrategy(
    direction: 'bullish' | 'bearish' | 'neutral',
    triggers: CandidateTrigger[],
    technicals: TechnicalAnalysis
  ): StrategyType {
    const allowed = this.config.allowedStrategies ?? DEFAULT_SCANNER_CONFIG.allowedStrategies!;

    // High volatility suggests premium selling or condors
    const hasHighVol = triggers.some((t) => t.type === 'high_volatility');

    if (direction === 'bullish') {
      if (hasHighVol && allowed.includes('cash_secured_put')) {
        return 'cash_secured_put';
      }
      if (allowed.includes('long_call')) {
        return 'long_call';
      }
      if (allowed.includes('vertical_spread')) {
        return 'vertical_spread';
      }
    }

    if (direction === 'bearish') {
      if (hasHighVol && allowed.includes('iron_condor')) {
        return 'iron_condor';
      }
      if (allowed.includes('long_put')) {
        return 'long_put';
      }
      if (allowed.includes('vertical_spread')) {
        return 'vertical_spread';
      }
    }

    // Neutral or default
    if (hasHighVol && allowed.includes('iron_condor')) {
      return 'iron_condor';
    }

    return allowed[0] ?? 'long_call';
  }

  /**
   * Generate rationale for suggested strategy
   */
  private generateStrategyRationale(
    direction: 'bullish' | 'bearish' | 'neutral',
    triggers: CandidateTrigger[],
    technicals: TechnicalAnalysis
  ): string {
    const parts: string[] = [];

    parts.push(`Technical direction: ${direction}.`);

    if (technicals.rsi) {
      parts.push(`RSI: ${technicals.rsi.value.toFixed(1)} (${technicals.rsi.interpretation}).`);
    }

    if (technicals.trend.signals.length > 0) {
      parts.push(`Signals: ${technicals.trend.signals.slice(0, 2).join(', ')}.`);
    }

    const triggerTypes = triggers.map((t) => formatTriggerType(t.type)).join(', ');
    parts.push(`Triggered by: ${triggerTypes}.`);

    return parts.join(' ');
  }

  /**
   * Generate warnings for a candidate
   */
  private generateWarnings(
    technicals: TechnicalAnalysis,
    triggers: CandidateTrigger[]
  ): string[] {
    const warnings: string[] = [];

    // Add any technical warnings
    warnings.push(...technicals.warnings);

    // Mixed signals warning
    const hasBullish = triggers.some((t) => isBullishTrigger(t.type));
    const hasBearish = triggers.some((t) => isBearishTrigger(t.type));

    if (hasBullish && hasBearish) {
      warnings.push('Mixed signals detected - conflicting bullish and bearish triggers');
    }

    // Low data warning
    if (technicals.barsAnalyzed < 100) {
      warnings.push(`Limited historical data (${technicals.barsAnalyzed} bars)`);
    }

    return warnings;
  }

  /**
   * Generate a TradeProposal for a candidate
   */
  private async generateProposal(
    candidate: TradeCandidate,
    quote: Quote
  ): Promise<TradeProposal | null> {
    // Get option chain
    const chain = await this.marketDataService.getOptionChain({
      symbol: candidate.symbol,
      minDTE: this.config.filters.minDTE ?? 14,
      maxDTE: this.config.filters.maxDTE ?? 60,
    });

    // Flatten the contracts Map to an array
    const allContracts: OptionContract[] = [];
    for (const contracts of chain.contracts.values()) {
      allContracts.push(...contracts);
    }

    if (!chain || allContracts.length === 0) {
      return null;
    }

    // Filter for liquid contracts
    const liquidContracts = this.filterLiquidContracts(allContracts);
    if (liquidContracts.length === 0) {
      return null;
    }

    // Select contracts based on strategy
    const selectedContracts = this.selectContractsForStrategy(
      candidate.suggestedStrategy,
      liquidContracts,
      quote.last
    );

    if (selectedContracts.length === 0) {
      return null;
    }

    // Build proposal
    const direction = getSuggestedDirection(candidate.triggers);
    const proposalContracts: ProposalContract[] = selectedContracts.map((c) => ({
      optionSymbol: c.optionSymbol,
      underlying: candidate.symbol,
      strike: c.strike,
      expiration: c.expiration,
      optionType: c.optionType,
      side: this.getSideForStrategy(candidate.suggestedStrategy, c.optionType, direction),
      quantity: 1,
      targetPrice: (c.bid + c.ask) / 2,
    }));

    // Calculate max loss estimate
    const maxLoss = this.estimateMaxLoss(proposalContracts, candidate.suggestedStrategy);

    // Build data sources
    const dataSources: DataSource[] = [
      {
        sourceType: 'technical_analysis',
        description: `Technical analysis for ${candidate.symbol}`,
        retrievedAt: new Date(candidate.technicals.dataTimestamp),
      },
      {
        sourceType: 'market_data',
        description: `Option chain for ${candidate.symbol}`,
        retrievedAt: new Date(),
      },
    ];

    // Add research sources
    for (const ref of candidate.researchContext.slice(0, 3)) {
      dataSources.push({
        sourceType: ref.sentiment === 'bullish' || ref.sentiment === 'bearish' ? 'news' : 'other',
        description: ref.headline,
        retrievedAt: new Date(ref.publishedAt),
        reference: ref.id,
      });
    }

    const proposal: TradeProposal = {
      strategyType: candidate.suggestedStrategy,
      underlying: candidate.symbol,
      contracts: proposalContracts,
      thesis: this.generateThesis(candidate),
      catalysts: this.extractCatalysts(candidate),
      entryPlan: {
        orderType: 'limit',
        limitPrice: proposalContracts.reduce((sum, c) => sum + (c.targetPrice ?? 0), 0),
        slippagePercent: 2,
        timeInForce: 'day',
      },
      exitPlan: {
        profitTargets: [
          { percentGain: 50, closePercent: 50 },
          { percentGain: 100, closePercent: 50 },
        ],
        stopLoss: {
          type: 'percent',
          value: 50,
        },
        maxHoldDays: 30,
      },
      risk: {
        maxLoss,
        maxLossPercent: undefined, // Would need account info
        riskRewardRatio: 2, // Default target
      },
      confidence: this.determineConfidence(candidate.score),
      dataUsed: dataSources,
    };

    return proposal;
  }

  /**
   * Filter option contracts by liquidity criteria
   */
  private filterLiquidContracts(contracts: OptionContract[]): OptionContract[] {
    const filters = this.config.filters;
    const minOI = filters.minOpenInterest ?? 100;
    const minVolume = filters.minVolume ?? 10;
    const maxSpread = filters.maxSpreadPercent ?? 5;

    return contracts.filter((c) => {
      if (c.openInterest < minOI) return false;
      if (c.volume < minVolume) return false;

      const mid = (c.bid + c.ask) / 2;
      if (mid > 0) {
        const spreadPercent = ((c.ask - c.bid) / mid) * 100;
        if (spreadPercent > maxSpread) return false;
      }

      return true;
    });
  }

  /**
   * Select contracts for a strategy
   */
  private selectContractsForStrategy(
    strategy: StrategyType,
    contracts: OptionContract[],
    currentPrice: number
  ): OptionContract[] {
    // Sort by distance from current price
    const sorted = [...contracts].sort((a, b) =>
      Math.abs(a.strike - currentPrice) - Math.abs(b.strike - currentPrice)
    );

    // Find ATM strikes
    const atmCalls = sorted.filter((c) => c.optionType === 'call').slice(0, 3);
    const atmPuts = sorted.filter((c) => c.optionType === 'put').slice(0, 3);

    switch (strategy) {
      case 'long_call':
        return atmCalls.slice(0, 1);
      case 'long_put':
        return atmPuts.slice(0, 1);
      case 'cash_secured_put':
        // Slightly OTM put
        const otmPuts = contracts
          .filter((c) => c.optionType === 'put' && c.strike < currentPrice * 0.95)
          .sort((a, b) => b.strike - a.strike);
        return otmPuts.slice(0, 1);
      case 'vertical_spread':
        // Return ATM and one strike OTM for vertical
        if (atmCalls.length >= 2) {
          return atmCalls.slice(0, 2);
        }
        return atmCalls.slice(0, 1);
      default:
        return atmCalls.slice(0, 1);
    }
  }

  /**
   * Get order side for a strategy
   */
  private getSideForStrategy(
    strategy: StrategyType,
    optionType: 'call' | 'put',
    direction: 'bullish' | 'bearish' | 'neutral'
  ): 'buy' | 'sell' {
    switch (strategy) {
      case 'long_call':
      case 'long_put':
        return 'buy';
      case 'short_call':
      case 'short_put':
      case 'cash_secured_put':
      case 'covered_call':
        return 'sell';
      case 'vertical_spread':
        // Buy closer to ATM, sell further
        return direction === 'bullish' ? 'buy' : 'sell';
      default:
        return 'buy';
    }
  }

  /**
   * Estimate max loss for a position
   */
  private estimateMaxLoss(contracts: ProposalContract[], strategy: StrategyType): number {
    // For long positions, max loss is premium paid
    const totalPremium = contracts.reduce((sum, c) => {
      const price = c.targetPrice ?? 0;
      const value = price * c.quantity * 100;
      return sum + (c.side === 'buy' ? value : -value);
    }, 0);

    if (totalPremium > 0) {
      return totalPremium; // Debit trade, max loss is premium
    }

    // For credit trades, estimate based on strikes
    // This is simplified - real calculation would be more complex
    return Math.abs(totalPremium) * 2;
  }

  /**
   * Generate thesis points for a candidate
   */
  private generateThesis(candidate: TradeCandidate): string[] {
    const thesis: string[] = [];

    thesis.push(`Technical setup: ${candidate.strategyRationale}`);

    for (const trigger of candidate.triggers.slice(0, 3)) {
      thesis.push(`${formatTriggerType(trigger.type)}: ${trigger.description}`);
    }

    if (candidate.researchContext.length > 0) {
      const sentiments = candidate.researchContext
        .filter((r) => r.sentiment)
        .map((r) => r.sentiment);
      const bullish = sentiments.filter((s) => s === 'bullish').length;
      const bearish = sentiments.filter((s) => s === 'bearish').length;

      if (bullish > bearish) {
        thesis.push(`Research sentiment: Predominantly bullish (${bullish}/${sentiments.length})`);
      } else if (bearish > bullish) {
        thesis.push(`Research sentiment: Predominantly bearish (${bearish}/${sentiments.length})`);
      }
    }

    return thesis;
  }

  /**
   * Extract catalysts from research
   */
  private extractCatalysts(candidate: TradeCandidate): string[] {
    const catalysts: string[] = [];

    for (const ref of candidate.researchContext.slice(0, 3)) {
      catalysts.push(ref.headline);
    }

    // Add technical catalysts
    if (candidate.triggers.some((t) => t.type === 'golden_cross')) {
      catalysts.push('Golden cross pattern - bullish momentum signal');
    }
    if (candidate.triggers.some((t) => t.type === 'death_cross')) {
      catalysts.push('Death cross pattern - bearish momentum signal');
    }

    return catalysts;
  }

  /**
   * Determine confidence level based on score
   */
  private determineConfidence(score: number): ConfidenceLevel {
    if (score >= 75) return 'high';
    if (score >= 50) return 'medium';
    return 'low';
  }

  // ============================================================================
  // Candidate Management
  // ============================================================================

  /**
   * Get a candidate by ID
   */
  getCandidate(candidateId: string): StoredTradeCandidate | undefined {
    return this.candidates.get(candidateId);
  }

  /**
   * Get all candidates
   */
  getAllCandidates(): StoredTradeCandidate[] {
    return Array.from(this.candidates.values());
  }

  /**
   * Query candidates with filters
   */
  queryCandidates(options: CandidateQueryOptions = {}): CandidateQueryResult {
    let candidates = Array.from(this.candidates.values());

    // Apply filters
    if (options.symbols?.length) {
      candidates = candidates.filter((c) => options.symbols!.includes(c.symbol));
    }

    if (options.status?.length) {
      candidates = candidates.filter((c) => options.status!.includes(c.status));
    }

    if (options.triggerTypes?.length) {
      candidates = candidates.filter((c) =>
        c.triggers.some((t) => options.triggerTypes!.includes(t.type))
      );
    }

    if (options.strategyTypes?.length) {
      candidates = candidates.filter((c) =>
        options.strategyTypes!.includes(c.suggestedStrategy)
      );
    }

    if (options.minScore !== undefined) {
      candidates = candidates.filter((c) => c.score >= options.minScore!);
    }

    if (options.generatedAfter) {
      candidates = candidates.filter((c) => c.generatedAt >= options.generatedAfter!);
    }

    if (options.generatedBefore) {
      candidates = candidates.filter((c) => c.generatedAt <= options.generatedBefore!);
    }

    // Sort
    const sortBy = options.sortBy ?? 'score';
    const sortOrder = options.sortOrder ?? 'desc';

    candidates.sort((a, b) => {
      let comparison = 0;
      switch (sortBy) {
        case 'score':
          comparison = a.score - b.score;
          break;
        case 'generatedAt':
          comparison = a.generatedAt.getTime() - b.generatedAt.getTime();
          break;
        case 'symbol':
          comparison = a.symbol.localeCompare(b.symbol);
          break;
      }
      return sortOrder === 'asc' ? comparison : -comparison;
    });

    const totalCount = candidates.length;

    // Paginate
    const offset = options.offset ?? 0;
    const limit = options.limit ?? 50;
    candidates = candidates.slice(offset, offset + limit);

    return {
      candidates,
      totalCount,
      hasMore: offset + candidates.length < totalCount,
    };
  }

  /**
   * Mark a candidate as viewed
   */
  async markAsViewed(candidateId: string): Promise<StoredTradeCandidate | undefined> {
    const candidate = this.candidates.get(candidateId);
    if (!candidate) return undefined;

    candidate.status = 'viewed';
    candidate.viewedAt = new Date();
    candidate.updatedAt = new Date();

    await this.saveToDisk();
    return candidate;
  }

  /**
   * Dismiss a candidate
   */
  async dismissCandidate(candidateId: string, reason?: string): Promise<StoredTradeCandidate | undefined> {
    const candidate = this.candidates.get(candidateId);
    if (!candidate) return undefined;

    candidate.status = 'dismissed';
    candidate.dismissedAt = new Date();
    candidate.dismissReason = reason;
    candidate.updatedAt = new Date();

    await this.saveToDisk();
    return candidate;
  }

  /**
   * Mark a candidate as actioned
   */
  async markAsActioned(candidateId: string): Promise<StoredTradeCandidate | undefined> {
    const candidate = this.candidates.get(candidateId);
    if (!candidate) return undefined;

    candidate.status = 'actioned';
    candidate.actionedAt = new Date();
    candidate.updatedAt = new Date();

    await this.saveToDisk();
    return candidate;
  }

  /**
   * Delete a candidate
   */
  async deleteCandidate(candidateId: string): Promise<boolean> {
    const deleted = this.candidates.delete(candidateId);
    if (deleted) {
      await this.saveToDisk();
    }
    return deleted;
  }

  /**
   * Clear all candidates
   */
  async clearCandidates(): Promise<void> {
    this.candidates.clear();
    await this.saveToDisk();
  }

  /**
   * Get scanner statistics
   */
  getStatistics(): {
    totalCandidates: number;
    byStatus: Record<string, number>;
    byStrategy: Record<string, number>;
    averageScore: number;
    lastScanAt?: Date;
  } {
    const candidates = Array.from(this.candidates.values());

    const byStatus: Record<string, number> = { new: 0, viewed: 0, dismissed: 0, actioned: 0 };
    const byStrategy: Record<string, number> = {};
    let totalScore = 0;

    for (const candidate of candidates) {
      byStatus[candidate.status] = (byStatus[candidate.status] ?? 0) + 1;
      byStrategy[candidate.suggestedStrategy] = (byStrategy[candidate.suggestedStrategy] ?? 0) + 1;
      totalScore += candidate.score;
    }

    return {
      totalCandidates: candidates.length,
      byStatus,
      byStrategy,
      averageScore: candidates.length > 0 ? totalScore / candidates.length : 0,
      lastScanAt: this.lastScanAt,
    };
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a candidate scanner service
 */
export function createCandidateScannerService(
  adapter: BrokerAdapter,
  marketDataService: MarketDataService,
  options: CandidateScannerServiceOptions,
  researchStorage?: ResearchStorageService,
  proposalService?: TradeProposalService,
  auditLogService?: AuditLogService
): CandidateScannerService {
  return new CandidateScannerService(
    adapter,
    marketDataService,
    options,
    researchStorage,
    proposalService,
    auditLogService
  );
}

/**
 * Standalone function to evaluate a single symbol
 */
export async function evaluateSymbolForCandidates(
  symbol: string,
  marketDataService: MarketDataService,
  config: CandidateScannerConfig = DEFAULT_SCANNER_CONFIG
): Promise<CandidateTrigger[]> {
  // Get historical bars
  const barsResponse = await marketDataService.getHistoricalBars({
    symbol,
    interval: 'daily',
    limit: 250,
  });

  if (!barsResponse.bars || barsResponse.bars.length < 50) {
    return [];
  }

  const technicals = computeTechnicalIndicators({
    symbol,
    bars: barsResponse.bars,
  });

  // Simple trigger evaluation without research
  const triggers: CandidateTrigger[] = [];
  const filters = config.filters;

  if (filters.rsiOversold?.enabled && technicals.rsi) {
    const threshold = filters.rsiOversold.threshold ?? 30;
    if (technicals.rsi.value < threshold) {
      triggers.push({
        type: 'rsi_oversold',
        description: `RSI at ${technicals.rsi.value.toFixed(1)}`,
        value: technicals.rsi.value,
        threshold,
        strength: technicals.rsi.value < 20 ? 'strong' : 'moderate',
      });
    }
  }

  if (filters.rsiOverbought?.enabled && technicals.rsi) {
    const threshold = filters.rsiOverbought.threshold ?? 70;
    if (technicals.rsi.value > threshold) {
      triggers.push({
        type: 'rsi_overbought',
        description: `RSI at ${technicals.rsi.value.toFixed(1)}`,
        value: technicals.rsi.value,
        threshold,
        strength: technicals.rsi.value > 80 ? 'strong' : 'moderate',
      });
    }
  }

  return triggers;
}
