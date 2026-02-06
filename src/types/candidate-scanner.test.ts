/**
 * Tests for Candidate Scanner Types
 */

import { describe, it, expect } from 'vitest';
import {
  ScannerFiltersSchema,
  CandidateScannerConfigSchema,
  CandidateTriggerSchema,
  CandidateScoreBreakdownSchema,
  ResearchNoteReferenceSchema,
  DEFAULT_SCANNER_FILTERS,
  DEFAULT_SCANNER_CONFIG,
  formatTriggerType,
  formatCandidateStatus,
  getTriggerStrengthClass,
  isBullishTrigger,
  isBearishTrigger,
  getSuggestedDirection,
  validateScannerConfig,
  calculateOverallScore,
  getCandidateSummary,
  type CandidateTrigger,
  type CandidateScoreBreakdown,
  type TradeCandidate,
  type ScannerTriggerType,
} from './candidate-scanner.js';

describe('Candidate Scanner Types', () => {
  // ============================================================================
  // Zod Schema Tests
  // ============================================================================

  describe('ScannerFiltersSchema', () => {
    it('should validate a minimal filters object', () => {
      const filters = {};
      const result = ScannerFiltersSchema.safeParse(filters);
      expect(result.success).toBe(true);
    });

    it('should validate filters with RSI settings', () => {
      const filters = {
        rsiOversold: { enabled: true, threshold: 25 },
        rsiOverbought: { enabled: true, threshold: 75 },
      };
      const result = ScannerFiltersSchema.safeParse(filters);
      expect(result.success).toBe(true);
    });

    it('should validate filters with DTE range', () => {
      const filters = {
        minDTE: 14,
        maxDTE: 60,
      };
      const result = ScannerFiltersSchema.safeParse(filters);
      expect(result.success).toBe(true);
    });

    it('should validate filters with liquidity settings', () => {
      const filters = {
        minLiquidityRating: 'medium' as const,
        minOpenInterest: 100,
        minVolume: 10,
        maxSpreadPercent: 5,
      };
      const result = ScannerFiltersSchema.safeParse(filters);
      expect(result.success).toBe(true);
    });

    it('should reject invalid RSI threshold', () => {
      const filters = {
        rsiOversold: { enabled: true, threshold: 150 }, // Invalid: > 100
      };
      const result = ScannerFiltersSchema.safeParse(filters);
      expect(result.success).toBe(false);
    });

    it('should reject invalid liquidity rating', () => {
      const filters = {
        minLiquidityRating: 'invalid',
      };
      const result = ScannerFiltersSchema.safeParse(filters);
      expect(result.success).toBe(false);
    });
  });

  describe('CandidateScannerConfigSchema', () => {
    it('should validate a full config', () => {
      const config = {
        symbolsToScan: ['AAPL', 'MSFT', 'GOOGL'],
        filters: DEFAULT_SCANNER_FILTERS,
        pollingIntervalMs: 300000,
        maxCandidatesPerScan: 20,
        maxCandidatesPerSymbol: 3,
        minScore: 50,
        minConfidence: 'medium' as const,
        generateProposals: true,
        allowedStrategies: ['long_call', 'long_put'] as const,
      };
      const result = CandidateScannerConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it('should validate with minimal config', () => {
      const config = {
        filters: {},
      };
      const result = CandidateScannerConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it('should reject invalid confidence level', () => {
      const config = {
        filters: {},
        minConfidence: 'very_high', // Invalid
      };
      const result = CandidateScannerConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });
  });

  describe('CandidateTriggerSchema', () => {
    it('should validate a valid trigger', () => {
      const trigger = {
        type: 'rsi_oversold' as const,
        description: 'RSI at 25 (below 30)',
        value: 25,
        threshold: 30,
        strength: 'strong' as const,
      };
      const result = CandidateTriggerSchema.safeParse(trigger);
      expect(result.success).toBe(true);
    });

    it('should reject invalid trigger type', () => {
      const trigger = {
        type: 'invalid_trigger',
        description: 'Test',
        strength: 'strong',
      };
      const result = CandidateTriggerSchema.safeParse(trigger);
      expect(result.success).toBe(false);
    });

    it('should reject invalid strength', () => {
      const trigger = {
        type: 'rsi_oversold',
        description: 'Test',
        strength: 'very_strong',
      };
      const result = CandidateTriggerSchema.safeParse(trigger);
      expect(result.success).toBe(false);
    });
  });

  describe('CandidateScoreBreakdownSchema', () => {
    it('should validate a valid breakdown', () => {
      const breakdown = {
        technicalScore: 75,
        researchScore: 60,
        liquidityScore: 80,
        ivRankScore: 50,
      };
      const result = CandidateScoreBreakdownSchema.safeParse(breakdown);
      expect(result.success).toBe(true);
    });

    it('should validate without IV rank', () => {
      const breakdown = {
        technicalScore: 75,
        researchScore: 60,
        liquidityScore: 80,
      };
      const result = CandidateScoreBreakdownSchema.safeParse(breakdown);
      expect(result.success).toBe(true);
    });

    it('should reject score > 100', () => {
      const breakdown = {
        technicalScore: 150,
        researchScore: 60,
        liquidityScore: 80,
      };
      const result = CandidateScoreBreakdownSchema.safeParse(breakdown);
      expect(result.success).toBe(false);
    });

    it('should reject score < 0', () => {
      const breakdown = {
        technicalScore: -10,
        researchScore: 60,
        liquidityScore: 80,
      };
      const result = CandidateScoreBreakdownSchema.safeParse(breakdown);
      expect(result.success).toBe(false);
    });
  });

  describe('ResearchNoteReferenceSchema', () => {
    it('should validate a valid reference', () => {
      const ref = {
        id: 'abc123',
        headline: 'AAPL earnings beat expectations',
        sentiment: 'bullish' as const,
        sourceName: 'Reuters',
        publishedAt: '2026-01-15T10:00:00Z',
        trustScore: 0.95,
      };
      const result = ResearchNoteReferenceSchema.safeParse(ref);
      expect(result.success).toBe(true);
    });

    it('should reject invalid trust score', () => {
      const ref = {
        id: 'abc123',
        headline: 'Test',
        sourceName: 'Test',
        publishedAt: '2026-01-15T10:00:00Z',
        trustScore: 1.5, // Invalid: > 1
      };
      const result = ResearchNoteReferenceSchema.safeParse(ref);
      expect(result.success).toBe(false);
    });
  });

  // ============================================================================
  // Default Config Tests
  // ============================================================================

  describe('DEFAULT_SCANNER_FILTERS', () => {
    it('should have RSI oversold enabled with default threshold', () => {
      expect(DEFAULT_SCANNER_FILTERS.rsiOversold?.enabled).toBe(true);
      expect(DEFAULT_SCANNER_FILTERS.rsiOversold?.threshold).toBe(30);
    });

    it('should have RSI overbought enabled with default threshold', () => {
      expect(DEFAULT_SCANNER_FILTERS.rsiOverbought?.enabled).toBe(true);
      expect(DEFAULT_SCANNER_FILTERS.rsiOverbought?.threshold).toBe(70);
    });

    it('should have reasonable DTE range', () => {
      expect(DEFAULT_SCANNER_FILTERS.minDTE).toBe(14);
      expect(DEFAULT_SCANNER_FILTERS.maxDTE).toBe(60);
    });

    it('should have liquidity filters set', () => {
      expect(DEFAULT_SCANNER_FILTERS.minLiquidityRating).toBe('medium');
      expect(DEFAULT_SCANNER_FILTERS.minOpenInterest).toBe(100);
      expect(DEFAULT_SCANNER_FILTERS.minVolume).toBe(10);
      expect(DEFAULT_SCANNER_FILTERS.maxSpreadPercent).toBe(5);
    });
  });

  describe('DEFAULT_SCANNER_CONFIG', () => {
    it('should have default polling interval', () => {
      expect(DEFAULT_SCANNER_CONFIG.pollingIntervalMs).toBe(5 * 60 * 1000);
    });

    it('should have max candidates limits', () => {
      expect(DEFAULT_SCANNER_CONFIG.maxCandidatesPerScan).toBe(20);
      expect(DEFAULT_SCANNER_CONFIG.maxCandidatesPerSymbol).toBe(3);
    });

    it('should have default min score', () => {
      expect(DEFAULT_SCANNER_CONFIG.minScore).toBe(50);
    });

    it('should have generate proposals enabled', () => {
      expect(DEFAULT_SCANNER_CONFIG.generateProposals).toBe(true);
    });

    it('should have allowed strategies defined', () => {
      expect(DEFAULT_SCANNER_CONFIG.allowedStrategies).toContain('long_call');
      expect(DEFAULT_SCANNER_CONFIG.allowedStrategies).toContain('vertical_spread');
    });
  });

  // ============================================================================
  // Helper Function Tests
  // ============================================================================

  describe('formatTriggerType', () => {
    it('should format RSI oversold', () => {
      expect(formatTriggerType('rsi_oversold')).toBe('RSI Oversold');
    });

    it('should format RSI overbought', () => {
      expect(formatTriggerType('rsi_overbought')).toBe('RSI Overbought');
    });

    it('should format golden cross', () => {
      expect(formatTriggerType('golden_cross')).toBe('Golden Cross');
    });

    it('should format death cross', () => {
      expect(formatTriggerType('death_cross')).toBe('Death Cross');
    });

    it('should format bullish news', () => {
      expect(formatTriggerType('bullish_news')).toBe('Bullish News');
    });

    it('should format bearish news', () => {
      expect(formatTriggerType('bearish_news')).toBe('Bearish News');
    });

    it('should format high volatility', () => {
      expect(formatTriggerType('high_volatility')).toBe('High Volatility');
    });
  });

  describe('formatCandidateStatus', () => {
    it('should format new status', () => {
      expect(formatCandidateStatus('new')).toBe('New');
    });

    it('should format viewed status', () => {
      expect(formatCandidateStatus('viewed')).toBe('Viewed');
    });

    it('should format dismissed status', () => {
      expect(formatCandidateStatus('dismissed')).toBe('Dismissed');
    });

    it('should format actioned status', () => {
      expect(formatCandidateStatus('actioned')).toBe('Actioned');
    });
  });

  describe('getTriggerStrengthClass', () => {
    it('should return strong class', () => {
      expect(getTriggerStrengthClass('strong')).toBe('trigger-strong');
    });

    it('should return moderate class', () => {
      expect(getTriggerStrengthClass('moderate')).toBe('trigger-moderate');
    });

    it('should return weak class', () => {
      expect(getTriggerStrengthClass('weak')).toBe('trigger-weak');
    });
  });

  describe('isBullishTrigger', () => {
    it('should identify RSI oversold as bullish', () => {
      expect(isBullishTrigger('rsi_oversold')).toBe(true);
    });

    it('should identify golden cross as bullish', () => {
      expect(isBullishTrigger('golden_cross')).toBe(true);
    });

    it('should identify bullish news as bullish', () => {
      expect(isBullishTrigger('bullish_news')).toBe(true);
    });

    it('should not identify death cross as bullish', () => {
      expect(isBullishTrigger('death_cross')).toBe(false);
    });

    it('should not identify bearish news as bullish', () => {
      expect(isBullishTrigger('bearish_news')).toBe(false);
    });
  });

  describe('isBearishTrigger', () => {
    it('should identify RSI overbought as bearish', () => {
      expect(isBearishTrigger('rsi_overbought')).toBe(true);
    });

    it('should identify death cross as bearish', () => {
      expect(isBearishTrigger('death_cross')).toBe(true);
    });

    it('should identify bearish news as bearish', () => {
      expect(isBearishTrigger('bearish_news')).toBe(true);
    });

    it('should not identify golden cross as bearish', () => {
      expect(isBearishTrigger('golden_cross')).toBe(false);
    });

    it('should not identify bullish news as bearish', () => {
      expect(isBearishTrigger('bullish_news')).toBe(false);
    });
  });

  describe('getSuggestedDirection', () => {
    it('should return bullish for bullish triggers', () => {
      const triggers: CandidateTrigger[] = [
        { type: 'rsi_oversold', description: 'Test', strength: 'strong' },
        { type: 'golden_cross', description: 'Test', strength: 'moderate' },
      ];
      expect(getSuggestedDirection(triggers)).toBe('bullish');
    });

    it('should return bearish for bearish triggers', () => {
      const triggers: CandidateTrigger[] = [
        { type: 'rsi_overbought', description: 'Test', strength: 'strong' },
        { type: 'death_cross', description: 'Test', strength: 'moderate' },
      ];
      expect(getSuggestedDirection(triggers)).toBe('bearish');
    });

    it('should return neutral for mixed triggers', () => {
      const triggers: CandidateTrigger[] = [
        { type: 'rsi_oversold', description: 'Test', strength: 'moderate' },
        { type: 'rsi_overbought', description: 'Test', strength: 'moderate' },
      ];
      expect(getSuggestedDirection(triggers)).toBe('neutral');
    });

    it('should weight strong triggers more heavily', () => {
      const triggers: CandidateTrigger[] = [
        { type: 'rsi_oversold', description: 'Test', strength: 'strong' },
        { type: 'death_cross', description: 'Test', strength: 'weak' },
      ];
      expect(getSuggestedDirection(triggers)).toBe('bullish');
    });
  });

  describe('validateScannerConfig', () => {
    it('should validate a valid config', () => {
      const result = validateScannerConfig(DEFAULT_SCANNER_CONFIG);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should warn when minDTE >= maxDTE', () => {
      const config = {
        ...DEFAULT_SCANNER_CONFIG,
        filters: {
          ...DEFAULT_SCANNER_FILTERS,
          minDTE: 60,
          maxDTE: 30,
        },
      };
      const result = validateScannerConfig(config);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('minDTE must be less than maxDTE');
    });

    it('should warn for high minScore', () => {
      const config = {
        ...DEFAULT_SCANNER_CONFIG,
        minScore: 90,
      };
      const result = validateScannerConfig(config);
      expect(result.valid).toBe(true);
      expect(result.warnings.some((w) => w.includes('High minScore'))).toBe(true);
    });

    it('should warn for large maxCandidatesPerScan', () => {
      const config = {
        ...DEFAULT_SCANNER_CONFIG,
        maxCandidatesPerScan: 100,
      };
      const result = validateScannerConfig(config);
      expect(result.valid).toBe(true);
      expect(result.warnings.some((w) => w.includes('impact performance'))).toBe(true);
    });

    it('should warn when no triggers are enabled', () => {
      const config = {
        filters: {
          rsiOversold: { enabled: false },
          rsiOverbought: { enabled: false },
          goldenCross: { enabled: false },
          deathCross: { enabled: false },
          highVolatility: { enabled: false },
          bullishNews: { enabled: false },
          bearishNews: { enabled: false },
          earningsUpcoming: { enabled: false },
        },
      };
      const result = validateScannerConfig(config);
      expect(result.valid).toBe(true);
      expect(result.warnings.some((w) => w.includes('No triggers enabled'))).toBe(true);
    });
  });

  describe('calculateOverallScore', () => {
    it('should calculate weighted score', () => {
      const breakdown: CandidateScoreBreakdown = {
        technicalScore: 100,
        researchScore: 100,
        liquidityScore: 100,
      };
      // Without IV rank: (100*0.4 + 100*0.3 + 100*0.2) / 0.9 = 100
      expect(calculateOverallScore(breakdown)).toBe(100);
    });

    it('should handle IV rank when present', () => {
      const breakdown: CandidateScoreBreakdown = {
        technicalScore: 80,
        researchScore: 60,
        liquidityScore: 70,
        ivRankScore: 50,
      };
      // 80*0.4 + 60*0.3 + 70*0.2 + 50*0.1 = 32 + 18 + 14 + 5 = 69
      expect(calculateOverallScore(breakdown)).toBe(69);
    });

    it('should cap score at 100', () => {
      const breakdown: CandidateScoreBreakdown = {
        technicalScore: 100,
        researchScore: 100,
        liquidityScore: 100,
        ivRankScore: 100,
      };
      expect(calculateOverallScore(breakdown)).toBe(100);
    });

    it('should floor score at 0', () => {
      const breakdown: CandidateScoreBreakdown = {
        technicalScore: 0,
        researchScore: 0,
        liquidityScore: 0,
      };
      expect(calculateOverallScore(breakdown)).toBe(0);
    });
  });

  describe('getCandidateSummary', () => {
    it('should return a summary string', () => {
      const candidate: TradeCandidate = {
        id: '123',
        symbol: 'AAPL',
        currentPrice: 150,
        generatedAt: new Date(),
        triggers: [
          { type: 'rsi_oversold', description: 'RSI low', strength: 'strong' },
          { type: 'bullish_news', description: 'Good news', strength: 'moderate' },
        ],
        technicals: {} as any,
        researchContext: [],
        score: 75,
        scoreBreakdown: { technicalScore: 80, researchScore: 70, liquidityScore: 75 },
        suggestedStrategy: 'long_call',
        strategyRationale: 'Test rationale',
        warnings: [],
      };

      const summary = getCandidateSummary(candidate);
      expect(summary).toContain('AAPL');
      expect(summary).toContain('75');
      expect(summary).toContain('long_call');
      expect(summary).toContain('RSI Oversold');
    });
  });
});
