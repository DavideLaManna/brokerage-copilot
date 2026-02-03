/**
 * Spread Calculator Service Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  SpreadCalculator,
  createSpreadCalculator,
  createSpreadFromProposal,
  calculateSpreadRiskMetrics,
  calculateVerticalSpreadRisk,
  calculateIronCondorRisk,
  calculateStraddleStrangleRisk,
  calculateSpreadWidth,
  calculateNetPremium,
  validateSpread,
} from './spread-calculator.js';
import type { TradeProposal, ProposalContract } from '../types/trade-proposal.js';
import type { SpreadLeg } from '../types/spreads.js';
import type { AccountSummary, Position } from '../types/broker.js';
import { createDefaultCapabilities } from '../types/spreads.js';

// ============================================================================
// Test Fixtures
// ============================================================================

function createMockContract(
  optionType: 'call' | 'put',
  side: 'buy' | 'sell',
  strike: number,
  targetPrice: number = 0
): ProposalContract {
  const expirationDate = new Date();
  expirationDate.setDate(expirationDate.getDate() + 30);

  return {
    optionSymbol: `AAPL${strike}${optionType === 'call' ? 'C' : 'P'}`,
    underlying: 'AAPL',
    strike,
    expiration: expirationDate,
    optionType,
    side,
    quantity: 1,
    targetPrice,
  };
}

function createMockSpreadLeg(
  optionType: 'call' | 'put',
  side: 'buy' | 'sell',
  strike: number,
  index: number = 0
): SpreadLeg {
  const expirationDate = new Date();
  expirationDate.setDate(expirationDate.getDate() + 30);

  return {
    legIndex: index,
    optionSymbol: `AAPL${strike}${optionType === 'call' ? 'C' : 'P'}`,
    underlying: 'AAPL',
    strike,
    expiration: expirationDate,
    optionType,
    side,
    quantity: 1,
    ratio: 1,
  };
}

function createCallDebitSpreadProposal(
  longStrike: number = 150,
  shortStrike: number = 155,
  longPrice: number = 3.50,
  shortPrice: number = 2.00
): TradeProposal {
  return {
    strategyType: 'vertical_spread',
    underlying: 'AAPL',
    contracts: [
      createMockContract('call', 'buy', longStrike, longPrice),
      createMockContract('call', 'sell', shortStrike, shortPrice),
    ],
    thesis: ['Bullish on AAPL'],
    catalysts: ['Earnings'],
    entryPlan: {
      orderType: 'limit',
      limitPrice: longPrice - shortPrice, // Net debit
      timeInForce: 'day',
    },
    exitPlan: {
      profitTargets: [{ percentGain: 50, closePercent: 100 }],
    },
    risk: {
      maxLoss: (longPrice - shortPrice) * 100,
    },
    confidence: 'medium',
    dataUsed: [],
  };
}

function createIronCondorProposal(): TradeProposal {
  return {
    strategyType: 'iron_condor',
    underlying: 'AAPL',
    contracts: [
      createMockContract('put', 'buy', 140, 0.50),   // Long put (protection)
      createMockContract('put', 'sell', 145, 1.00),  // Short put
      createMockContract('call', 'sell', 155, 1.00), // Short call
      createMockContract('call', 'buy', 160, 0.50),  // Long call (protection)
    ],
    thesis: ['Neutral on AAPL, expecting range-bound movement'],
    catalysts: [],
    entryPlan: {
      orderType: 'limit',
      limitPrice: -1.00, // Net credit
      timeInForce: 'day',
    },
    exitPlan: {
      profitTargets: [{ percentGain: 50, closePercent: 100 }],
    },
    risk: {
      maxLoss: 400,
    },
    confidence: 'medium',
    dataUsed: [],
  };
}

function createMockAccount(): AccountSummary {
  return {
    netLiquidation: 100000,
    buyingPower: 50000,
    cash: 30000,
    dailyPnL: 0,
    unrealizedPnL: 0,
    currency: 'USD',
    asOf: new Date(),
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('SpreadCalculator', () => {
  describe('calculateSpreadWidth', () => {
    it('should calculate width for vertical spread', () => {
      const legs: SpreadLeg[] = [
        createMockSpreadLeg('call', 'buy', 150, 0),
        createMockSpreadLeg('call', 'sell', 155, 1),
      ];

      const width = calculateSpreadWidth(legs);
      expect(width).toBe(5);
    });

    it('should return undefined for single leg', () => {
      const legs: SpreadLeg[] = [createMockSpreadLeg('call', 'buy', 150, 0)];
      expect(calculateSpreadWidth(legs)).toBeUndefined();
    });

    it('should handle wider spreads', () => {
      const legs: SpreadLeg[] = [
        createMockSpreadLeg('put', 'buy', 100, 0),
        createMockSpreadLeg('put', 'sell', 120, 1),
      ];

      expect(calculateSpreadWidth(legs)).toBe(20);
    });
  });

  describe('calculateNetPremium', () => {
    it('should calculate net debit for call debit spread', () => {
      const legs: SpreadLeg[] = [
        createMockSpreadLeg('call', 'buy', 150, 0),
        createMockSpreadLeg('call', 'sell', 155, 1),
      ];

      const legPrices = new Map<string, number>([
        ['AAPL150C', 3.50],
        ['AAPL155C', 2.00],
      ]);

      const netPremium = calculateNetPremium(legs, legPrices, 100);
      expect(netPremium).toBe(150); // (3.50 * 100) - (2.00 * 100) = 150 debit
    });

    it('should calculate net credit for put credit spread', () => {
      const legs: SpreadLeg[] = [
        createMockSpreadLeg('put', 'sell', 150, 0),
        createMockSpreadLeg('put', 'buy', 145, 1),
      ];

      const legPrices = new Map<string, number>([
        ['AAPL150P', 2.50],
        ['AAPL145P', 1.00],
      ]);

      const netPremium = calculateNetPremium(legs, legPrices, 100);
      expect(netPremium).toBe(-150); // -(2.50 * 100) + (1.00 * 100) = -150 credit
    });
  });

  describe('calculateVerticalSpreadRisk', () => {
    it('should calculate risk for call debit spread', () => {
      const legs: SpreadLeg[] = [
        createMockSpreadLeg('call', 'buy', 150, 0),
        createMockSpreadLeg('call', 'sell', 155, 1),
      ];

      const netPremium = 150; // $1.50 * 100 debit
      const metrics = calculateVerticalSpreadRisk(legs, netPremium, 100);

      expect(metrics.maxLoss).toBe(150); // Premium paid
      expect(metrics.maxProfit).toBe(350); // Width ($5 * 100) - premium ($1.50 * 100)
      expect(metrics.isDefinedRisk).toBe(true);
      expect(metrics.breakEvenPrices.length).toBe(1);
      expect(metrics.breakEvenPrices[0]).toBeCloseTo(151.5); // Long strike + premium
    });

    it('should calculate risk for put credit spread', () => {
      const legs: SpreadLeg[] = [
        createMockSpreadLeg('put', 'sell', 150, 0),
        createMockSpreadLeg('put', 'buy', 145, 1),
      ];

      const netPremium = -100; // $1.00 * 100 credit
      const metrics = calculateVerticalSpreadRisk(legs, netPremium, 100);

      expect(metrics.maxLoss).toBe(400); // Width ($5 * 100) - credit ($1 * 100)
      expect(metrics.maxProfit).toBe(100); // Credit received
      expect(metrics.isDefinedRisk).toBe(true);
    });

    it('should throw for invalid leg count', () => {
      const legs: SpreadLeg[] = [createMockSpreadLeg('call', 'buy', 150, 0)];
      expect(() => calculateVerticalSpreadRisk(legs, 100, 100)).toThrow();
    });
  });

  describe('calculateIronCondorRisk', () => {
    it('should calculate risk for iron condor', () => {
      const legs: SpreadLeg[] = [
        createMockSpreadLeg('put', 'buy', 140, 0),
        createMockSpreadLeg('put', 'sell', 145, 1),
        createMockSpreadLeg('call', 'sell', 155, 2),
        createMockSpreadLeg('call', 'buy', 160, 3),
      ];

      const netPremium = -100; // $1.00 * 100 net credit
      const metrics = calculateIronCondorRisk(legs, netPremium, 100);

      // Both wings are $5 wide
      // Max loss = width ($5 * 100) - credit ($1 * 100) = $400
      expect(metrics.maxLoss).toBe(400);
      expect(metrics.maxProfit).toBe(100);
      expect(metrics.isDefinedRisk).toBe(true);
      expect(metrics.breakEvenPrices.length).toBe(2);
    });

    it('should throw for invalid leg count', () => {
      const legs: SpreadLeg[] = [
        createMockSpreadLeg('put', 'buy', 140, 0),
        createMockSpreadLeg('put', 'sell', 145, 1),
      ];
      expect(() => calculateIronCondorRisk(legs, 100, 100)).toThrow();
    });
  });

  describe('calculateStraddleStrangleRisk', () => {
    it('should calculate risk for long straddle', () => {
      const legs: SpreadLeg[] = [
        createMockSpreadLeg('call', 'buy', 150, 0),
        createMockSpreadLeg('put', 'buy', 150, 1),
      ];

      const netPremium = 500; // $5.00 * 100 total premium
      const metrics = calculateStraddleStrangleRisk(legs, netPremium, 100);

      expect(metrics.maxLoss).toBe(500);
      expect(metrics.maxProfit).toBe(Infinity);
      expect(metrics.isDefinedRisk).toBe(true);
      expect(metrics.breakEvenPrices.length).toBe(2);
    });

    it('should calculate risk for short strangle', () => {
      const legs: SpreadLeg[] = [
        createMockSpreadLeg('call', 'sell', 155, 0),
        createMockSpreadLeg('put', 'sell', 145, 1),
      ];

      const netPremium = -300; // $3.00 * 100 credit
      const metrics = calculateStraddleStrangleRisk(legs, netPremium, 100);

      expect(metrics.maxLoss).toBe(Infinity);
      expect(metrics.maxProfit).toBe(300);
      expect(metrics.isDefinedRisk).toBe(false);
    });
  });

  describe('createSpreadFromProposal', () => {
    it('should create spread definition from call debit spread', () => {
      const proposal = createCallDebitSpreadProposal();
      const spread = createSpreadFromProposal(proposal);

      expect(spread.strategyType).toBe('vertical_spread');
      expect(spread.spreadSubtype).toBe('call_debit_spread');
      expect(spread.underlying).toBe('AAPL');
      expect(spread.legs.length).toBe(2);
      expect(spread.isDebit).toBe(true);
      expect(spread.spreadWidth).toBe(5);
    });

    it('should create spread definition from iron condor', () => {
      const proposal = createIronCondorProposal();
      const spread = createSpreadFromProposal(proposal);

      expect(spread.strategyType).toBe('iron_condor');
      expect(spread.spreadSubtype).toBe('iron_condor');
      expect(spread.legs.length).toBe(4);
    });
  });

  describe('calculateSpreadRiskMetrics', () => {
    it('should calculate metrics for call debit spread', () => {
      const proposal = createCallDebitSpreadProposal(150, 155, 3.50, 2.00);
      const spread = createSpreadFromProposal(proposal);
      const metrics = calculateSpreadRiskMetrics(spread);

      expect(metrics.isDefinedRisk).toBe(true);
      expect(metrics.maxLoss).toBe(150); // $1.50 debit * 100
      expect(metrics.maxProfit).toBe(350); // $5 width - $1.50 debit * 100
    });

    it('should calculate metrics for iron condor', () => {
      const proposal = createIronCondorProposal();
      const spread = createSpreadFromProposal(proposal);
      const metrics = calculateSpreadRiskMetrics(spread);

      expect(metrics.isDefinedRisk).toBe(true);
      expect(metrics.maxProfit).toBe(100); // Net credit of $1.00 * 100
    });
  });

  describe('validateSpread', () => {
    it('should validate a valid call debit spread', () => {
      const proposal = createCallDebitSpreadProposal();
      const result = validateSpread(proposal, {
        account: createMockAccount(),
        positions: [],
        capabilities: createDefaultCapabilities(3),
      });

      expect(result.valid).toBe(true);
      expect(result.errors.length).toBe(0);
      expect(result.riskMetrics).toBeDefined();
    });

    it('should fail validation with insufficient capabilities', () => {
      const proposal = createCallDebitSpreadProposal();
      const result = validateSpread(proposal, {
        account: createMockAccount(),
        positions: [],
        capabilities: createDefaultCapabilities(1), // Level 1 can't trade spreads
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('level'))).toBe(true);
    });

    it('should warn about undefined risk strategies', () => {
      // Create a short strangle (undefined risk)
      const proposal: TradeProposal = {
        strategyType: 'strangle',
        underlying: 'AAPL',
        contracts: [
          createMockContract('call', 'sell', 155, 1.50),
          createMockContract('put', 'sell', 145, 1.50),
        ],
        thesis: ['Neutral'],
        catalysts: [],
        entryPlan: { orderType: 'limit', timeInForce: 'day' },
        exitPlan: { profitTargets: [{ percentGain: 50, closePercent: 100 }] },
        risk: { maxLoss: Infinity },
        confidence: 'low',
        dataUsed: [],
      };

      const result = validateSpread(proposal, {
        account: createMockAccount(),
        positions: [],
        capabilities: createDefaultCapabilities(4),
      });

      expect(result.warnings.some(w => w.includes('UNDEFINED'))).toBe(true);
    });
  });

  describe('SpreadCalculator class', () => {
    let calculator: SpreadCalculator;

    beforeEach(() => {
      calculator = createSpreadCalculator();
    });

    it('should calculate proposal risk', () => {
      const proposal = createCallDebitSpreadProposal();
      const metrics = calculator.calculateProposalRisk(proposal);

      expect(metrics.maxLoss).toBe(150);
      expect(metrics.isDefinedRisk).toBe(true);
    });

    it('should validate proposal', () => {
      const proposal = createCallDebitSpreadProposal();
      const result = calculator.validateProposal(proposal, {
        account: createMockAccount(),
        positions: [],
      });

      expect(result.valid).toBe(true);
    });

    it('should calculate max loss for RiskEngine', () => {
      const proposal = createCallDebitSpreadProposal();
      const maxLoss = calculator.calculateMaxLoss(proposal);

      expect(maxLoss).toBe(150);
    });

    it('should handle undefined risk in max loss calculation', () => {
      // Short strangle has undefined max loss
      const proposal: TradeProposal = {
        strategyType: 'strangle',
        underlying: 'AAPL',
        contracts: [
          createMockContract('call', 'sell', 155, 1.50),
          createMockContract('put', 'sell', 145, 1.50),
        ],
        thesis: ['Neutral'],
        catalysts: [],
        entryPlan: { orderType: 'limit', timeInForce: 'day' },
        exitPlan: { profitTargets: [{ percentGain: 50, closePercent: 100 }] },
        risk: { maxLoss: Infinity },
        confidence: 'low',
        dataUsed: [],
      };

      const maxLoss = calculator.calculateMaxLoss(proposal);
      // Should return net premium * 10 as fallback for undefined risk
      expect(maxLoss).toBeGreaterThan(0);
      expect(maxLoss).toBeLessThan(Infinity);
    });
  });
});

describe('Spread Subtype Detection', () => {
  it('should detect call debit spread', () => {
    const proposal = createCallDebitSpreadProposal(150, 155);
    const spread = createSpreadFromProposal(proposal);
    expect(spread.spreadSubtype).toBe('call_debit_spread');
  });

  it('should detect call credit spread', () => {
    const proposal: TradeProposal = {
      ...createCallDebitSpreadProposal(),
      contracts: [
        createMockContract('call', 'sell', 150, 3.50),
        createMockContract('call', 'buy', 155, 2.00),
      ],
    };
    const spread = createSpreadFromProposal(proposal);
    expect(spread.spreadSubtype).toBe('call_credit_spread');
  });

  it('should detect put debit spread', () => {
    const proposal: TradeProposal = {
      ...createCallDebitSpreadProposal(),
      contracts: [
        createMockContract('put', 'buy', 150, 3.50),
        createMockContract('put', 'sell', 145, 2.00),
      ],
    };
    const spread = createSpreadFromProposal(proposal);
    expect(spread.spreadSubtype).toBe('put_debit_spread');
  });

  it('should detect put credit spread', () => {
    const proposal: TradeProposal = {
      ...createCallDebitSpreadProposal(),
      contracts: [
        createMockContract('put', 'sell', 150, 3.50),
        createMockContract('put', 'buy', 145, 2.00),
      ],
    };
    const spread = createSpreadFromProposal(proposal);
    expect(spread.spreadSubtype).toBe('put_credit_spread');
  });

  it('should detect iron condor', () => {
    const proposal = createIronCondorProposal();
    const spread = createSpreadFromProposal(proposal);
    expect(spread.spreadSubtype).toBe('iron_condor');
  });

  it('should detect long straddle', () => {
    const proposal: TradeProposal = {
      strategyType: 'straddle',
      underlying: 'AAPL',
      contracts: [
        createMockContract('call', 'buy', 150, 2.50),
        createMockContract('put', 'buy', 150, 2.50),
      ],
      thesis: ['Expecting volatility'],
      catalysts: ['Earnings'],
      entryPlan: { orderType: 'limit', timeInForce: 'day' },
      exitPlan: { profitTargets: [{ percentGain: 50, closePercent: 100 }] },
      risk: { maxLoss: 500 },
      confidence: 'medium',
      dataUsed: [],
    };
    const spread = createSpreadFromProposal(proposal);
    expect(spread.spreadSubtype).toBe('long_straddle');
  });

  it('should detect short strangle', () => {
    const proposal: TradeProposal = {
      strategyType: 'strangle',
      underlying: 'AAPL',
      contracts: [
        createMockContract('call', 'sell', 155, 1.50),
        createMockContract('put', 'sell', 145, 1.50),
      ],
      thesis: ['Expecting low volatility'],
      catalysts: [],
      entryPlan: { orderType: 'limit', timeInForce: 'day' },
      exitPlan: { profitTargets: [{ percentGain: 50, closePercent: 100 }] },
      risk: { maxLoss: Infinity },
      confidence: 'medium',
      dataUsed: [],
    };
    const spread = createSpreadFromProposal(proposal);
    expect(spread.spreadSubtype).toBe('short_strangle');
  });
});

describe('Broker Capability Checking', () => {
  it('should allow level 2 for debit spreads', () => {
    const proposal = createCallDebitSpreadProposal();
    const result = validateSpread(proposal, {
      account: createMockAccount(),
      positions: [],
      capabilities: createDefaultCapabilities(2),
    });

    expect(result.valid).toBe(true);
  });

  it('should deny level 1 for spreads', () => {
    const proposal = createCallDebitSpreadProposal();
    const result = validateSpread(proposal, {
      account: createMockAccount(),
      positions: [],
      capabilities: createDefaultCapabilities(1),
    });

    expect(result.valid).toBe(false);
  });

  it('should require level 3 for iron condors', () => {
    const proposal = createIronCondorProposal();

    const level2Result = validateSpread(proposal, {
      account: createMockAccount(),
      positions: [],
      capabilities: createDefaultCapabilities(2),
    });
    expect(level2Result.valid).toBe(false);

    const level3Result = validateSpread(proposal, {
      account: createMockAccount(),
      positions: [],
      capabilities: createDefaultCapabilities(3),
    });
    expect(level3Result.valid).toBe(true);
  });

  it('should require level 4 for short strangles', () => {
    const proposal: TradeProposal = {
      strategyType: 'strangle',
      underlying: 'AAPL',
      contracts: [
        createMockContract('call', 'sell', 155, 1.50),
        createMockContract('put', 'sell', 145, 1.50),
      ],
      thesis: ['Neutral'],
      catalysts: [],
      entryPlan: { orderType: 'limit', timeInForce: 'day' },
      exitPlan: { profitTargets: [{ percentGain: 50, closePercent: 100 }] },
      risk: { maxLoss: Infinity },
      confidence: 'low',
      dataUsed: [],
    };

    const level3Result = validateSpread(proposal, {
      account: createMockAccount(),
      positions: [],
      capabilities: createDefaultCapabilities(3),
    });
    expect(level3Result.valid).toBe(false);

    const level4Result = validateSpread(proposal, {
      account: createMockAccount(),
      positions: [],
      capabilities: createDefaultCapabilities(4),
    });
    // Should still warn about undefined risk even though capability check passes
    expect(level4Result.warnings.some(w => w.includes('UNDEFINED'))).toBe(true);
  });
});
