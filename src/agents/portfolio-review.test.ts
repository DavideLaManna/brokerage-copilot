/**
 * Portfolio Review Agent Tests
 */

import { describe, it, expect } from 'vitest';
import {
  reviewPortfolio,
  analyzePnL,
  analyzeRiskExposure,
  analyzeConcentration,
  analyzeGreeks,
  analyzeExpirations,
  generateActions,
  formatReviewForDisplay,
  PORTFOLIO_REVIEW_PROMPT_TEMPLATE,
  DEFAULT_REVIEW_CONFIG,
  type PortfolioReviewConfig,
} from './portfolio-review.js';
import type { PortfolioSnapshot, SnapshotPosition } from '../tools/types.js';

// ============================================================================
// Test Fixtures
// ============================================================================

function createMockPosition(overrides: Partial<SnapshotPosition> = {}): SnapshotPosition {
  return {
    id: 'pos-1',
    symbol: 'AAPL',
    underlying: 'AAPL',
    assetClass: 'equity',
    quantity: 100,
    averageCost: 150,
    currentPrice: 175,
    marketValue: 17500,
    unrealizedPnL: 2500,
    unrealizedPnLPercent: 16.67,
    ...overrides,
  };
}

function createMockOptionPosition(overrides: Partial<SnapshotPosition> = {}): SnapshotPosition {
  return {
    id: 'pos-opt-1',
    symbol: 'AAPL240216C00185000',
    underlying: 'AAPL',
    assetClass: 'option',
    quantity: 5,
    averageCost: 3.5,
    currentPrice: 5.0,
    marketValue: 2500,
    unrealizedPnL: 750,
    unrealizedPnLPercent: 42.86,
    optionDetails: {
      strike: 185,
      expiration: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      optionType: 'call',
      daysToExpiration: 30,
    },
    greeks: {
      delta: 0.65,
      gamma: 0.04,
      theta: -0.05,
      vega: 0.15,
      impliedVolatility: 0.25,
    },
    ...overrides,
  };
}

function createMockSnapshot(overrides: Partial<PortfolioSnapshot> = {}): PortfolioSnapshot {
  return {
    account: {
      netLiquidation: 100000,
      buyingPower: 50000,
      cash: 30000,
      dailyPnL: 500,
      unrealizedPnL: 3000,
      currency: 'USD',
    },
    positions: [createMockPosition(), createMockOptionPosition()],
    orders: [],
    exposureByUnderlying: [
      {
        symbol: 'AAPL',
        positionCount: 2,
        netQuantity: 100,
        marketValue: 20000,
        notionalExposure: 25000,
        risk: 5000,
        riskPercent: 5,
        exceedsLimit: false,
        greeks: {
          delta: 432.5,
          gamma: 20,
          theta: -25,
          vega: 75,
        },
      },
    ],
    portfolioGreeks: {
      delta: 432.5,
      gamma: 20,
      theta: -25,
      vega: 75,
      positionsWithGreeks: 1,
      positionsWithoutGreeks: 1,
      interpretations: ['Long 432 delta-equivalent shares', 'Paying $25/day in time decay'],
    },
    summary: {
      totalPositions: 2,
      optionPositions: 1,
      equityPositions: 1,
      openOrders: 0,
      totalMarketValue: 20000,
      totalUnrealizedPnL: 3250,
      totalRisk: 5000,
      totalRiskPercent: 5,
      underlyingsExceedingLimit: 0,
    },
    dataTimestamp: new Date().toISOString(),
    dataSources: [
      {
        source: 'Tradier (tradier)',
        retrievedAt: new Date().toISOString(),
      },
    ],
    ...overrides,
  };
}

// ============================================================================
// DEFAULT_REVIEW_CONFIG Tests
// ============================================================================

describe('DEFAULT_REVIEW_CONFIG', () => {
  it('should have sensible default values', () => {
    expect(DEFAULT_REVIEW_CONFIG.pnlLossThreshold).toBe(-50);
    expect(DEFAULT_REVIEW_CONFIG.pnlGainThreshold).toBe(50);
    expect(DEFAULT_REVIEW_CONFIG.nearExpirationDays).toBe(7);
    expect(DEFAULT_REVIEW_CONFIG.concentrationLimit).toBe(10);
    expect(DEFAULT_REVIEW_CONFIG.maxDeltaExposure).toBe(500);
    expect(DEFAULT_REVIEW_CONFIG.maxThetaDecay).toBe(100);
    expect(DEFAULT_REVIEW_CONFIG.trimProfitPercent).toBe(50);
  });
});

// ============================================================================
// analyzePnL Tests
// ============================================================================

describe('analyzePnL', () => {
  const config = DEFAULT_REVIEW_CONFIG;

  it('should return no findings for healthy portfolio', () => {
    const snapshot = createMockSnapshot();
    const findings = analyzePnL(snapshot, config);

    // Healthy portfolio should only have info findings if positions are up significantly
    const criticalOrWarning = findings.filter(
      (f) => f.severity === 'critical' || f.severity === 'warning'
    );
    expect(criticalOrWarning).toHaveLength(0);
  });

  it('should flag portfolio down > 20%', () => {
    const snapshot = createMockSnapshot({
      summary: {
        ...createMockSnapshot().summary,
        totalMarketValue: 100000,
        totalUnrealizedPnL: -25000,
      },
    });

    const findings = analyzePnL(snapshot, config);
    const critical = findings.find(
      (f) => f.category === 'pnl' && f.severity === 'critical'
    );

    expect(critical).toBeDefined();
    expect(critical?.description).toContain('down');
  });

  it('should flag portfolio down > 10% as warning', () => {
    const snapshot = createMockSnapshot({
      summary: {
        ...createMockSnapshot().summary,
        totalMarketValue: 100000,
        totalUnrealizedPnL: -15000,
      },
    });

    const findings = analyzePnL(snapshot, config);
    const warning = findings.find(
      (f) => f.category === 'pnl' && f.severity === 'warning' && f.description.includes('overall')
    );

    expect(warning).toBeDefined();
  });

  it('should flag positions with significant losses', () => {
    const losingPosition = createMockPosition({
      id: 'pos-losing',
      symbol: 'TSLA',
      unrealizedPnL: -5000,
      unrealizedPnLPercent: -60,
    });

    const snapshot = createMockSnapshot({
      positions: [createMockPosition(), losingPosition],
    });

    const findings = analyzePnL(snapshot, config);
    const lossFinding = findings.find(
      (f) => f.category === 'pnl' && f.symbols?.includes('TSLA')
    );

    expect(lossFinding).toBeDefined();
    expect(lossFinding?.severity).toBe('warning');
  });

  it('should flag positions with significant gains', () => {
    const winningPosition = createMockPosition({
      id: 'pos-winning',
      symbol: 'NVDA',
      unrealizedPnL: 10000,
      unrealizedPnLPercent: 100,
    });

    const snapshot = createMockSnapshot({
      positions: [createMockPosition(), winningPosition],
    });

    const findings = analyzePnL(snapshot, config);
    const gainFinding = findings.find(
      (f) => f.category === 'pnl' && f.severity === 'info' && f.symbols?.includes('NVDA')
    );

    expect(gainFinding).toBeDefined();
    expect(gainFinding?.description).toContain('up more than');
  });
});

// ============================================================================
// analyzeRiskExposure Tests
// ============================================================================

describe('analyzeRiskExposure', () => {
  const config = DEFAULT_REVIEW_CONFIG;

  it('should return no findings for healthy risk levels', () => {
    const snapshot = createMockSnapshot();
    const findings = analyzeRiskExposure(snapshot, config);

    expect(findings.filter((f) => f.severity === 'critical')).toHaveLength(0);
  });

  it('should flag critical risk when > 50%', () => {
    const snapshot = createMockSnapshot({
      summary: {
        ...createMockSnapshot().summary,
        totalRisk: 60000,
        totalRiskPercent: 60,
      },
    });

    const findings = analyzeRiskExposure(snapshot, config);
    const critical = findings.find((f) => f.category === 'risk_exposure' && f.severity === 'critical');

    expect(critical).toBeDefined();
    expect(critical?.description).toContain('60.0%');
  });

  it('should flag warning risk when > 30%', () => {
    const snapshot = createMockSnapshot({
      summary: {
        ...createMockSnapshot().summary,
        totalRisk: 35000,
        totalRiskPercent: 35,
      },
    });

    const findings = analyzeRiskExposure(snapshot, config);
    const warning = findings.find((f) => f.category === 'risk_exposure' && f.severity === 'warning');

    expect(warning).toBeDefined();
    expect(warning?.description).toContain('35.0%');
  });

  it('should flag low buying power', () => {
    const snapshot = createMockSnapshot({
      account: {
        ...createMockSnapshot().account,
        netLiquidation: 100000,
        buyingPower: 10000, // Only 10% available
      },
    });

    const findings = analyzeRiskExposure(snapshot, config);
    const lowBP = findings.find(
      (f) => f.category === 'risk_exposure' && f.description.includes('buying power')
    );

    expect(lowBP).toBeDefined();
    expect(lowBP?.severity).toBe('warning');
  });
});

// ============================================================================
// analyzeConcentration Tests
// ============================================================================

describe('analyzeConcentration', () => {
  const config = DEFAULT_REVIEW_CONFIG;

  it('should return no findings when within limits', () => {
    const snapshot = createMockSnapshot();
    const findings = analyzeConcentration(snapshot, config);

    expect(findings.filter((f) => f.severity === 'critical')).toHaveLength(0);
  });

  it('should flag over-concentrated positions', () => {
    const snapshot = createMockSnapshot({
      exposureByUnderlying: [
        {
          symbol: 'AAPL',
          positionCount: 5,
          netQuantity: 500,
          marketValue: 80000,
          notionalExposure: 100000,
          risk: 15000,
          riskPercent: 15, // Over 10% limit
          exceedsLimit: true,
        },
      ],
    });

    const findings = analyzeConcentration(snapshot, config);
    const critical = findings.find((f) => f.category === 'concentration' && f.severity === 'critical');

    expect(critical).toBeDefined();
    expect(critical?.symbols).toContain('AAPL');
  });

  it('should warn about approaching concentration limit', () => {
    const snapshot = createMockSnapshot({
      exposureByUnderlying: [
        {
          symbol: 'MSFT',
          positionCount: 2,
          netQuantity: 200,
          marketValue: 50000,
          notionalExposure: 60000,
          risk: 8000,
          riskPercent: 8, // 80% of 10% limit
          exceedsLimit: false,
        },
      ],
    });

    const findings = analyzeConcentration(snapshot, config);
    const warning = findings.find(
      (f) => f.category === 'concentration' && f.severity === 'warning'
    );

    expect(warning).toBeDefined();
    expect(warning?.description).toContain('approaching');
  });
});

// ============================================================================
// analyzeGreeks Tests
// ============================================================================

describe('analyzeGreeks', () => {
  const config = DEFAULT_REVIEW_CONFIG;

  it('should return no findings for balanced Greeks', () => {
    const snapshot = createMockSnapshot({
      portfolioGreeks: {
        delta: 200,
        gamma: 10,
        theta: -30,
        vega: 50,
        positionsWithGreeks: 5,
        positionsWithoutGreeks: 0,
        interpretations: [],
      },
    });

    const findings = analyzeGreeks(snapshot, config);
    const warnings = findings.filter((f) => f.severity === 'warning');

    expect(warnings).toHaveLength(0);
  });

  it('should flag high delta exposure', () => {
    const snapshot = createMockSnapshot({
      portfolioGreeks: {
        delta: 750, // Over 500 limit
        gamma: 10,
        theta: -30,
        vega: 50,
        positionsWithGreeks: 5,
        positionsWithoutGreeks: 0,
        interpretations: [],
      },
    });

    const findings = analyzeGreeks(snapshot, config);
    const deltaWarning = findings.find(
      (f) => f.category === 'greeks' && f.description.includes('delta')
    );

    expect(deltaWarning).toBeDefined();
    expect(deltaWarning?.description).toContain('750');
  });

  it('should flag high theta decay', () => {
    const snapshot = createMockSnapshot({
      portfolioGreeks: {
        delta: 200,
        gamma: 10,
        theta: -150, // Over -100 limit
        vega: 50,
        positionsWithGreeks: 5,
        positionsWithoutGreeks: 0,
        interpretations: [],
      },
    });

    const findings = analyzeGreeks(snapshot, config);
    const thetaWarning = findings.find(
      (f) => f.category === 'greeks' && f.description.includes('theta')
    );

    expect(thetaWarning).toBeDefined();
    expect(thetaWarning?.description).toContain('150');
  });

  it('should note positions missing Greeks', () => {
    const snapshot = createMockSnapshot({
      portfolioGreeks: {
        delta: 200,
        gamma: 10,
        theta: -30,
        vega: 50,
        positionsWithGreeks: 3,
        positionsWithoutGreeks: 2,
        interpretations: [],
      },
    });

    const findings = analyzeGreeks(snapshot, config);
    const missingGreeks = findings.find(
      (f) => f.category === 'greeks' && f.description.includes('missing')
    );

    expect(missingGreeks).toBeDefined();
    expect(missingGreeks?.severity).toBe('info');
  });
});

// ============================================================================
// analyzeExpirations Tests
// ============================================================================

describe('analyzeExpirations', () => {
  const config = DEFAULT_REVIEW_CONFIG;

  it('should return no findings when no near-term expirations', () => {
    const snapshot = createMockSnapshot();
    // Default mock has 30 DTE
    const findings = analyzeExpirations(snapshot, config);

    expect(findings).toHaveLength(0);
  });

  it('should flag positions expiring today', () => {
    const expiringToday = createMockOptionPosition({
      id: 'expiring-today',
      symbol: 'AAPL240126C00185000',
      optionDetails: {
        strike: 185,
        expiration: new Date().toISOString(),
        optionType: 'call',
        daysToExpiration: 0,
      },
    });

    const snapshot = createMockSnapshot({
      positions: [expiringToday],
    });

    const findings = analyzeExpirations(snapshot, config);
    const critical = findings.find(
      (f) => f.category === 'expiration' && f.severity === 'critical'
    );

    expect(critical).toBeDefined();
    expect(critical?.description).toContain('TODAY');
  });

  it('should flag positions expiring this week', () => {
    const expiringThisWeek = createMockOptionPosition({
      id: 'expiring-soon',
      symbol: 'AAPL240131C00185000',
      optionDetails: {
        strike: 185,
        expiration: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
        optionType: 'call',
        daysToExpiration: 5,
      },
    });

    const snapshot = createMockSnapshot({
      positions: [expiringThisWeek],
    });

    const findings = analyzeExpirations(snapshot, config);
    const warning = findings.find(
      (f) => f.category === 'expiration' && f.severity === 'warning'
    );

    expect(warning).toBeDefined();
    expect(warning?.description).toContain('within 7 days');
  });
});

// ============================================================================
// generateActions Tests
// ============================================================================

describe('generateActions', () => {
  const config = DEFAULT_REVIEW_CONFIG;

  it('should generate exit action for expiring positions', () => {
    const expiringToday = createMockOptionPosition({
      id: 'expiring-today',
      symbol: 'AAPL240126C00185000',
      optionDetails: {
        strike: 185,
        expiration: new Date().toISOString(),
        optionType: 'call',
        daysToExpiration: 0,
      },
    });

    const snapshot = createMockSnapshot({
      positions: [expiringToday],
    });

    const findings = analyzeExpirations(snapshot, config);
    const actions = generateActions(snapshot, findings, config);

    const exitAction = actions.find(
      (a) => a.action === 'exit' && a.symbol === 'AAPL240126C00185000'
    );

    expect(exitAction).toBeDefined();
    expect(exitAction?.priority).toBe('high');
    expect(exitAction?.triggeredBy).toContain('expiration');
  });

  it('should generate trim action for over-concentrated positions', () => {
    const snapshot = createMockSnapshot({
      exposureByUnderlying: [
        {
          symbol: 'AAPL',
          positionCount: 5,
          netQuantity: 500,
          marketValue: 80000,
          notionalExposure: 100000,
          risk: 15000,
          riskPercent: 15,
          exceedsLimit: true,
        },
      ],
    });

    const findings = analyzeConcentration(snapshot, config);
    const actions = generateActions(snapshot, findings, config);

    const trimAction = actions.find((a) => a.action === 'trim' && a.symbol === 'AAPL');

    expect(trimAction).toBeDefined();
    expect(trimAction?.priority).toBe('high');
    expect(trimAction?.triggeredBy).toContain('concentration');
  });

  it('should generate hedge action for high delta', () => {
    const snapshot = createMockSnapshot({
      portfolioGreeks: {
        delta: 750,
        gamma: 10,
        theta: -30,
        vega: 50,
        positionsWithGreeks: 5,
        positionsWithoutGreeks: 0,
        interpretations: [],
      },
    });

    const findings = analyzeGreeks(snapshot, config);
    const actions = generateActions(snapshot, findings, config);

    const hedgeAction = actions.find((a) => a.action === 'hedge');

    expect(hedgeAction).toBeDefined();
    expect(hedgeAction?.symbol).toBe('PORTFOLIO');
    expect(hedgeAction?.triggeredBy).toContain('greeks');
  });

  it('should generate trim action for profitable positions', () => {
    const profitablePosition = createMockPosition({
      id: 'big-winner',
      symbol: 'NVDA',
      unrealizedPnL: 10000,
      unrealizedPnLPercent: 100,
    });

    const snapshot = createMockSnapshot({
      positions: [profitablePosition],
    });

    const findings = analyzePnL(snapshot, config);
    const actions = generateActions(snapshot, findings, config);

    const trimAction = actions.find((a) => a.action === 'trim' && a.symbol === 'NVDA');

    expect(trimAction).toBeDefined();
    expect(trimAction?.priority).toBe('low');
    expect(trimAction?.rationale).toContain('100%');
  });

  it('should add hold actions for healthy positions', () => {
    const snapshot = createMockSnapshot();
    const findings = analyzePnL(snapshot, config);
    const actions = generateActions(snapshot, findings, config);

    const holdActions = actions.filter((a) => a.action === 'hold');

    expect(holdActions.length).toBeGreaterThan(0);
  });

  it('should sort actions by priority', () => {
    const expiringToday = createMockOptionPosition({
      id: 'expiring',
      symbol: 'EXPIRING',
      optionDetails: {
        strike: 185,
        expiration: new Date().toISOString(),
        optionType: 'call',
        daysToExpiration: 0,
      },
    });

    const profitablePosition = createMockPosition({
      id: 'profitable',
      symbol: 'PROFITABLE',
      unrealizedPnL: 5000,
      unrealizedPnLPercent: 60,
    });

    const snapshot = createMockSnapshot({
      positions: [expiringToday, profitablePosition],
    });

    const findings = [
      ...analyzeExpirations(snapshot, config),
      ...analyzePnL(snapshot, config),
    ];
    const actions = generateActions(snapshot, findings, config);

    // High priority should come first
    const nonHoldActions = actions.filter((a) => a.action !== 'hold');
    if (nonHoldActions.length >= 2) {
      expect(nonHoldActions[0].priority).toBe('high');
    }
  });
});

// ============================================================================
// reviewPortfolio Tests
// ============================================================================

describe('reviewPortfolio', () => {
  it('should return healthy assessment for good portfolio', () => {
    const snapshot = createMockSnapshot();
    const review = reviewPortfolio(snapshot);

    expect(review.healthAssessment).toBe('healthy');
    expect(review.summary).toContain('good health');
  });

  it('should return caution assessment for portfolio with warnings', () => {
    const snapshot = createMockSnapshot({
      summary: {
        ...createMockSnapshot().summary,
        totalRisk: 35000,
        totalRiskPercent: 35,
      },
      account: {
        ...createMockSnapshot().account,
        buyingPower: 15000, // Low
      },
    });

    const review = reviewPortfolio(snapshot);

    expect(review.healthAssessment).toBe('caution');
  });

  it('should return at_risk assessment for portfolio with critical issues', () => {
    const snapshot = createMockSnapshot({
      exposureByUnderlying: [
        {
          symbol: 'AAPL',
          positionCount: 5,
          netQuantity: 500,
          marketValue: 80000,
          notionalExposure: 100000,
          risk: 15000,
          riskPercent: 15,
          exceedsLimit: true,
        },
      ],
    });

    const review = reviewPortfolio(snapshot);

    expect(review.healthAssessment).toBe('at_risk');
    expect(review.attentionRequired).toContain('AAPL');
  });

  it('should include data timestamps and sources', () => {
    const snapshot = createMockSnapshot();
    const review = reviewPortfolio(snapshot);

    expect(review.dataTimestamp).toBe(snapshot.dataTimestamp);
    expect(review.dataSources).toEqual(snapshot.dataSources);
    expect(review.reviewGeneratedAt).toBeDefined();
  });

  it('should accept custom config', () => {
    const snapshot = createMockSnapshot();
    const customConfig: Partial<PortfolioReviewConfig> = {
      pnlLossThreshold: -30, // More strict
      concentrationLimit: 5, // More strict
    };

    const review = reviewPortfolio(snapshot, customConfig);

    expect(review).toBeDefined();
    // With 5% concentration limit, the 5% risk position should be at limit
  });

  it('should generate summary with position counts', () => {
    const snapshot = createMockSnapshot();
    const review = reviewPortfolio(snapshot);

    expect(review.summary).toContain('2 positions');
    expect(review.summary).toContain('1 options');
    expect(review.summary).toContain('1 equity');
  });
});

// ============================================================================
// formatReviewForDisplay Tests
// ============================================================================

describe('formatReviewForDisplay', () => {
  it('should format healthy review correctly', () => {
    const snapshot = createMockSnapshot();
    const review = reviewPortfolio(snapshot);
    const formatted = formatReviewForDisplay(review);

    expect(formatted).toContain('HEALTHY');
    expect(formatted).toContain('Summary');
    expect(formatted).toContain('Data Sources');
  });

  it('should include attention required section when needed', () => {
    const expiringToday = createMockOptionPosition({
      id: 'expiring',
      symbol: 'AAPL240126C00185000',
      optionDetails: {
        strike: 185,
        expiration: new Date().toISOString(),
        optionType: 'call',
        daysToExpiration: 0,
      },
    });

    const snapshot = createMockSnapshot({
      positions: [expiringToday],
    });

    const review = reviewPortfolio(snapshot);
    const formatted = formatReviewForDisplay(review);

    expect(formatted).toContain('Immediate Attention');
  });

  it('should format findings with severity icons', () => {
    const snapshot = createMockSnapshot({
      portfolioGreeks: {
        delta: 750,
        gamma: 10,
        theta: -30,
        vega: 50,
        positionsWithGreeks: 3,
        positionsWithoutGreeks: 2,
        interpretations: [],
      },
    });

    const review = reviewPortfolio(snapshot);
    const formatted = formatReviewForDisplay(review);

    expect(formatted).toContain('Analysis Findings');
    expect(formatted).toContain('[*]'); // Warning icon
  });

  it('should format actions with priority tags', () => {
    const expiringToday = createMockOptionPosition({
      id: 'expiring',
      symbol: 'AAPL240126C00185000',
      optionDetails: {
        strike: 185,
        expiration: new Date().toISOString(),
        optionType: 'call',
        daysToExpiration: 0,
      },
    });

    const snapshot = createMockSnapshot({
      positions: [expiringToday],
    });

    const review = reviewPortfolio(snapshot);
    const formatted = formatReviewForDisplay(review);

    expect(formatted).toContain('[HIGH]');
    expect(formatted).toContain('EXIT');
  });
});

// ============================================================================
// PORTFOLIO_REVIEW_PROMPT_TEMPLATE Tests
// ============================================================================

describe('PORTFOLIO_REVIEW_PROMPT_TEMPLATE', () => {
  it('should contain tool reference', () => {
    expect(PORTFOLIO_REVIEW_PROMPT_TEMPLATE).toContain('get_portfolio_snapshot()');
  });

  it('should contain analysis categories', () => {
    expect(PORTFOLIO_REVIEW_PROMPT_TEMPLATE).toContain('P&L Analysis');
    expect(PORTFOLIO_REVIEW_PROMPT_TEMPLATE).toContain('Risk Exposure');
    expect(PORTFOLIO_REVIEW_PROMPT_TEMPLATE).toContain('Concentration');
    expect(PORTFOLIO_REVIEW_PROMPT_TEMPLATE).toContain('Greeks');
  });

  it('should contain action types', () => {
    expect(PORTFOLIO_REVIEW_PROMPT_TEMPLATE).toContain('HOLD');
    expect(PORTFOLIO_REVIEW_PROMPT_TEMPLATE).toContain('TRIM');
    expect(PORTFOLIO_REVIEW_PROMPT_TEMPLATE).toContain('EXIT');
    expect(PORTFOLIO_REVIEW_PROMPT_TEMPLATE).toContain('HEDGE');
    expect(PORTFOLIO_REVIEW_PROMPT_TEMPLATE).toContain('MONITOR');
  });

  it('should emphasize no order execution', () => {
    expect(PORTFOLIO_REVIEW_PROMPT_TEMPLATE).toContain('do NOT execute');
  });

  it('should include output format guidance', () => {
    expect(PORTFOLIO_REVIEW_PROMPT_TEMPLATE).toContain('Output Format');
    expect(PORTFOLIO_REVIEW_PROMPT_TEMPLATE).toContain('HEALTHY');
    expect(PORTFOLIO_REVIEW_PROMPT_TEMPLATE).toContain('CAUTION');
    expect(PORTFOLIO_REVIEW_PROMPT_TEMPLATE).toContain('AT RISK');
  });
});

// ============================================================================
// Edge Cases
// ============================================================================

describe('Edge Cases', () => {
  const config = DEFAULT_REVIEW_CONFIG;

  it('should handle empty positions', () => {
    const snapshot = createMockSnapshot({
      positions: [],
      summary: {
        ...createMockSnapshot().summary,
        totalPositions: 0,
        optionPositions: 0,
        equityPositions: 0,
      },
    });

    const review = reviewPortfolio(snapshot);

    expect(review.healthAssessment).toBe('healthy');
    expect(review.actions).toHaveLength(0);
  });

  it('should handle zero account value gracefully', () => {
    const snapshot = createMockSnapshot({
      account: {
        ...createMockSnapshot().account,
        netLiquidation: 0,
      },
      summary: {
        ...createMockSnapshot().summary,
        totalMarketValue: 0,
      },
    });

    // Should not throw
    expect(() => reviewPortfolio(snapshot)).not.toThrow();
  });

  it('should handle negative P&L scenarios', () => {
    const losingPosition = createMockPosition({
      unrealizedPnL: -10000,
      unrealizedPnLPercent: -80,
    });

    const snapshot = createMockSnapshot({
      positions: [losingPosition],
      summary: {
        ...createMockSnapshot().summary,
        totalUnrealizedPnL: -10000,
      },
    });

    const review = reviewPortfolio(snapshot);

    expect(review.findings.length).toBeGreaterThan(0);
  });

  it('should handle very short DTE option that is losing', () => {
    const shortDTELoser = createMockOptionPosition({
      id: 'short-dte-loser',
      symbol: 'TSLA240127P00200000',
      unrealizedPnL: -500,
      unrealizedPnLPercent: -70,
      optionDetails: {
        strike: 200,
        expiration: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
        optionType: 'put',
        daysToExpiration: 5,
      },
    });

    const snapshot = createMockSnapshot({
      positions: [shortDTELoser],
    });

    const review = reviewPortfolio(snapshot);
    const exitAction = review.actions.find(
      (a) => a.action === 'exit' && a.symbol === 'TSLA240127P00200000'
    );

    // Should recommend exit due to loss + short DTE
    expect(exitAction).toBeDefined();
  });

  it('should handle multiple underlyings with different risk levels', () => {
    const snapshot = createMockSnapshot({
      exposureByUnderlying: [
        {
          symbol: 'AAPL',
          positionCount: 1,
          netQuantity: 100,
          marketValue: 15000,
          notionalExposure: 20000,
          risk: 5000,
          riskPercent: 5,
          exceedsLimit: false,
        },
        {
          symbol: 'TSLA',
          positionCount: 3,
          netQuantity: 200,
          marketValue: 40000,
          notionalExposure: 50000,
          risk: 15000,
          riskPercent: 15, // Over limit
          exceedsLimit: true,
        },
      ],
    });

    const review = reviewPortfolio(snapshot);

    expect(review.attentionRequired).toContain('TSLA');
    expect(review.attentionRequired).not.toContain('AAPL');
  });
});
