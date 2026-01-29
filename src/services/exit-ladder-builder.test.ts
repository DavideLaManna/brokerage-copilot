/**
 * Exit Ladder Builder Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  proposeExitLadder,
  proposeExitLadderPreset,
  proposeExitLadderFromTargets,
  calculateExitPrice,
  calculateContractsToClose,
  validateRungPercentages,
  validateExitLadderConfig,
  formatExitLadderOrder,
  formatExitLadderProposal,
  toBuiltDraftOrdersResult,
  PRESET_LADDERS,
  DEFAULT_EXIT_LADDER_CONFIG,
  type ExitLadderConfig,
  type ExitLadderRung,
  type ExitLadderValidationContext,
} from './exit-ladder-builder.js';
import type { Position, AccountSummary } from '../types/broker.js';
import type { RiskConfig } from '../types/risk-config.js';
import { DEFAULT_RISK_CONFIG } from '../types/risk-config.js';

// ============================================================================
// Test Data
// ============================================================================

function createMockOptionPosition(overrides: Partial<Position> = {}): Position {
  return {
    id: 'pos-123',
    symbol: 'AAPL240119C00150000',
    quantity: 10,
    averageCost: 5.0,
    currentPrice: 6.25,
    marketValue: 6250,
    unrealizedPnL: 1250,
    unrealizedPnLPercent: 25,
    assetClass: 'option',
    optionDetails: {
      optionSymbol: 'AAPL240119C00150000',
      underlying: 'AAPL',
      strike: 150,
      expiration: new Date('2024-01-19'),
      optionType: 'call',
      multiplier: 100,
    },
    ...overrides,
  };
}

function createMockAccount(overrides: Partial<AccountSummary> = {}): AccountSummary {
  return {
    netLiquidation: 100000,
    buyingPower: 50000,
    cash: 25000,
    dailyPnL: 500,
    unrealizedPnL: 1250,
    currency: 'USD',
    asOf: new Date(),
    ...overrides,
  };
}

function createValidationContext(
  overrides: Partial<ExitLadderValidationContext> = {}
): ExitLadderValidationContext {
  return {
    riskConfig: DEFAULT_RISK_CONFIG,
    account: createMockAccount(),
    otherPositions: [],
    ...overrides,
  };
}

// ============================================================================
// Helper Function Tests
// ============================================================================

describe('calculateExitPrice', () => {
  it('calculates exit price for 25% profit target', () => {
    const exitPrice = calculateExitPrice(5.0, 25);
    expect(exitPrice).toBe(6.25);
  });

  it('calculates exit price for 50% profit target', () => {
    const exitPrice = calculateExitPrice(5.0, 50);
    expect(exitPrice).toBe(7.5);
  });

  it('calculates exit price for 100% profit target', () => {
    const exitPrice = calculateExitPrice(5.0, 100);
    expect(exitPrice).toBe(10.0);
  });

  it('calculates exit price for small profit target', () => {
    const exitPrice = calculateExitPrice(5.0, 10);
    expect(exitPrice).toBe(5.5);
  });

  it('rounds to 2 decimal places', () => {
    const exitPrice = calculateExitPrice(3.33, 33);
    // 3.33 * 1.33 = 4.4289
    expect(exitPrice).toBe(4.43);
  });

  it('handles zero cost basis', () => {
    const exitPrice = calculateExitPrice(0, 50);
    expect(exitPrice).toBe(0);
  });
});

describe('calculateContractsToClose', () => {
  it('calculates contracts for first rung', () => {
    const contracts = calculateContractsToClose(10, 34, 0, false);
    expect(contracts).toBe(3); // floor(10 * 0.34) = 3
  });

  it('calculates contracts for subsequent rung', () => {
    const contracts = calculateContractsToClose(10, 33, 3, false);
    expect(contracts).toBe(3);
  });

  it('returns at least 1 contract when some remain', () => {
    const contracts = calculateContractsToClose(10, 5, 0, false);
    expect(contracts).toBe(1); // max(1, floor(10 * 0.05)) = max(1, 0) = 1
  });

  it('returns 0 when no contracts remain', () => {
    const contracts = calculateContractsToClose(10, 33, 10, false);
    expect(contracts).toBe(0);
  });

  it('caps at remaining quantity', () => {
    const contracts = calculateContractsToClose(10, 100, 8, false);
    expect(contracts).toBe(2); // min(10, 2) = 2
  });

  it('handles small positions', () => {
    const contracts = calculateContractsToClose(3, 34, 0, false);
    expect(contracts).toBe(1);
  });

  it('handles single contract position', () => {
    const contracts = calculateContractsToClose(1, 100, 0, false);
    expect(contracts).toBe(1);
  });

  it('takes all remaining when last rung', () => {
    const contracts = calculateContractsToClose(10, 33, 6, true);
    expect(contracts).toBe(4); // remaining contracts
  });

  it('handles last rung with partial allocation', () => {
    const contracts = calculateContractsToClose(5, 33, 3, true);
    expect(contracts).toBe(2); // takes remaining
  });
});

describe('validateRungPercentages', () => {
  it('validates rungs totaling 100%', () => {
    const rungs: ExitLadderRung[] = [
      { targetProfitPercent: 25, closePercent: 34 },
      { targetProfitPercent: 50, closePercent: 33 },
      { targetProfitPercent: 100, closePercent: 33 },
    ];
    const result = validateRungPercentages(rungs);
    expect(result.valid).toBe(true);
    expect(result.totalPercent).toBe(100);
  });

  it('warns when rungs total less than 95%', () => {
    const rungs: ExitLadderRung[] = [
      { targetProfitPercent: 25, closePercent: 25 },
      { targetProfitPercent: 50, closePercent: 25 },
    ];
    const result = validateRungPercentages(rungs);
    expect(result.valid).toBe(false);
    expect(result.totalPercent).toBe(50);
    expect(result.warning).toContain('only close 50%');
  });

  it('warns when rungs exceed 100%', () => {
    const rungs: ExitLadderRung[] = [
      { targetProfitPercent: 25, closePercent: 60 },
      { targetProfitPercent: 50, closePercent: 60 },
    ];
    const result = validateRungPercentages(rungs);
    expect(result.valid).toBe(false);
    expect(result.totalPercent).toBe(120);
    expect(result.warning).toContain('exceeds 100%');
  });

  it('accepts rungs between 95% and 100%', () => {
    const rungs: ExitLadderRung[] = [
      { targetProfitPercent: 25, closePercent: 32 },
      { targetProfitPercent: 50, closePercent: 32 },
      { targetProfitPercent: 100, closePercent: 32 },
    ];
    const result = validateRungPercentages(rungs);
    expect(result.valid).toBe(true);
    expect(result.totalPercent).toBe(96);
  });
});

describe('validateExitLadderConfig', () => {
  it('validates correct configuration', () => {
    const config: ExitLadderConfig = {
      rungs: PRESET_LADDERS.standard,
    };
    const result = validateExitLadderConfig(config);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects empty rungs array', () => {
    const config: ExitLadderConfig = {
      rungs: [],
    };
    const result = validateExitLadderConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('At least one rung'))).toBe(true);
  });

  it('warns when rungs are not sorted', () => {
    const config: ExitLadderConfig = {
      rungs: [
        { targetProfitPercent: 100, closePercent: 33 },
        { targetProfitPercent: 25, closePercent: 34 },
        { targetProfitPercent: 50, closePercent: 33 },
      ],
    };
    const result = validateExitLadderConfig(config);
    expect(result.warnings.some((w) => w.includes('not in ascending order'))).toBe(true);
  });

  it('rejects duplicate profit targets', () => {
    const config: ExitLadderConfig = {
      rungs: [
        { targetProfitPercent: 50, closePercent: 50 },
        { targetProfitPercent: 50, closePercent: 50 },
      ],
    };
    const result = validateExitLadderConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Duplicate profit targets'))).toBe(true);
  });

  it('rejects invalid close percentage', () => {
    const config: ExitLadderConfig = {
      rungs: [{ targetProfitPercent: 50, closePercent: 150 }],
    };
    const result = validateExitLadderConfig(config);
    expect(result.valid).toBe(false);
  });

  it('rejects negative profit target', () => {
    const config: ExitLadderConfig = {
      rungs: [{ targetProfitPercent: -10, closePercent: 100 }],
    };
    const result = validateExitLadderConfig(config);
    expect(result.valid).toBe(false);
  });
});

// ============================================================================
// proposeExitLadder Tests
// ============================================================================

describe('proposeExitLadder', () => {
  it('creates exit ladder proposal with standard rungs', () => {
    const position = createMockOptionPosition();
    const config: ExitLadderConfig = {
      rungs: PRESET_LADDERS.standard,
    };

    const proposal = proposeExitLadder(position, config);

    expect(proposal.proposalId).toBeDefined();
    expect(proposal.correlationId).toBeDefined();
    expect(proposal.position).toBe(position);
    expect(proposal.orders).toHaveLength(3);
    expect(proposal.createdAt).toBeInstanceOf(Date);
  });

  it('calculates correct exit prices', () => {
    const position = createMockOptionPosition({ averageCost: 5.0 });
    const config: ExitLadderConfig = {
      rungs: [
        { targetProfitPercent: 25, closePercent: 34 },
        { targetProfitPercent: 50, closePercent: 33 },
        { targetProfitPercent: 100, closePercent: 33 },
      ],
    };

    const proposal = proposeExitLadder(position, config);

    expect(proposal.orders[0]!.exitPrice).toBe(6.25); // 5.0 * 1.25
    expect(proposal.orders[1]!.exitPrice).toBe(7.5); // 5.0 * 1.50
    expect(proposal.orders[2]!.exitPrice).toBe(10.0); // 5.0 * 2.00
  });

  it('allocates contracts across rungs', () => {
    const position = createMockOptionPosition({ quantity: 10 });
    const config: ExitLadderConfig = {
      rungs: [
        { targetProfitPercent: 25, closePercent: 34 },
        { targetProfitPercent: 50, closePercent: 33 },
        { targetProfitPercent: 100, closePercent: 33 },
      ],
    };

    const proposal = proposeExitLadder(position, config);

    // Should allocate all 10 contracts
    expect(proposal.totalContractsToExit).toBe(10);
    expect(proposal.contractsRemaining).toBe(0);

    // Each rung gets 3-4 contracts
    const totalContracts = proposal.orders.reduce((sum, o) => sum + o.contractsToClose, 0);
    expect(totalContracts).toBe(10);
  });

  it('creates sell orders for long positions', () => {
    const position = createMockOptionPosition({ quantity: 10 });
    const proposal = proposeExitLadder(position, { rungs: PRESET_LADDERS.standard });

    for (const order of proposal.orders) {
      expect(order.draftOrder.orderRequest.side).toBe('sell');
    }
  });

  it('uses limit orders by default', () => {
    const position = createMockOptionPosition();
    const proposal = proposeExitLadder(position, { rungs: PRESET_LADDERS.standard });

    for (const order of proposal.orders) {
      expect(order.draftOrder.orderRequest.orderType).toBe('limit');
      expect(order.draftOrder.orderRequest.limitPrice).toBeDefined();
    }
  });

  it('uses GTC time in force by default', () => {
    const position = createMockOptionPosition();
    const proposal = proposeExitLadder(position, { rungs: PRESET_LADDERS.standard });

    for (const order of proposal.orders) {
      expect(order.draftOrder.orderRequest.timeInForce).toBe('gtc');
    }
  });

  it('generates unique idempotency keys', () => {
    const position = createMockOptionPosition();
    const proposal = proposeExitLadder(position, { rungs: PRESET_LADDERS.standard });

    const keys = proposal.orders.map((o) => o.draftOrder.idempotencyKey);
    const uniqueKeys = new Set(keys);
    expect(uniqueKeys.size).toBe(keys.length);
  });

  it('calculates estimated credit and profit', () => {
    const position = createMockOptionPosition({ averageCost: 5.0, quantity: 10 });
    const config: ExitLadderConfig = {
      rungs: [{ targetProfitPercent: 100, closePercent: 100 }],
    };

    const proposal = proposeExitLadder(position, config);

    // 10 contracts @ $10.00 (100% profit) = $10,000 credit
    // Cost basis: 10 * $5.00 * 100 = $5,000
    // Profit: $10,000 - $5,000 = $5,000
    expect(proposal.totalEstimatedCredit).toBe(10000);
    expect(proposal.totalEstimatedProfit).toBe(5000);
  });

  it('warns for short positions', () => {
    const position = createMockOptionPosition({ quantity: -10 });
    const proposal = proposeExitLadder(position, { rungs: PRESET_LADDERS.standard });

    expect(proposal.warnings.some((w) => w.includes('positive'))).toBe(true);
  });

  it('warns for equity positions', () => {
    const position: Position = {
      id: 'pos-123',
      symbol: 'AAPL',
      quantity: 100,
      averageCost: 150,
      currentPrice: 160,
      marketValue: 16000,
      unrealizedPnL: 1000,
      unrealizedPnLPercent: 6.67,
      assetClass: 'equity',
    };
    const proposal = proposeExitLadder(position, { rungs: PRESET_LADDERS.standard });

    expect(proposal.warnings.some((w) => w.includes('option positions'))).toBe(true);
  });

  it('includes option details in orders', () => {
    const position = createMockOptionPosition();
    const proposal = proposeExitLadder(position, { rungs: PRESET_LADDERS.standard });

    for (const order of proposal.orders) {
      const optionDetails = order.draftOrder.orderRequest.optionDetails;
      expect(optionDetails).toBeDefined();
      expect(optionDetails!.underlying).toBe('AAPL');
      expect(optionDetails!.strike).toBe(150);
      expect(optionDetails!.optionType).toBe('call');
    }
  });

  it('respects custom order type', () => {
    const position = createMockOptionPosition();
    const config: ExitLadderConfig = {
      rungs: PRESET_LADDERS.standard,
      orderType: 'market',
    };

    const proposal = proposeExitLadder(position, config);

    for (const order of proposal.orders) {
      expect(order.draftOrder.orderRequest.orderType).toBe('market');
      expect(order.draftOrder.orderRequest.limitPrice).toBeUndefined();
    }
  });

  it('respects custom time in force', () => {
    const position = createMockOptionPosition();
    const config: ExitLadderConfig = {
      rungs: PRESET_LADDERS.standard,
      timeInForce: 'day',
    };

    const proposal = proposeExitLadder(position, config);

    for (const order of proposal.orders) {
      expect(order.draftOrder.orderRequest.timeInForce).toBe('day');
    }
  });

  it('handles position with contracts that cannot be evenly divided', () => {
    const position = createMockOptionPosition({ quantity: 5 });
    const config: ExitLadderConfig = {
      rungs: [
        { targetProfitPercent: 25, closePercent: 34 },
        { targetProfitPercent: 50, closePercent: 33 },
        { targetProfitPercent: 100, closePercent: 33 },
      ],
    };

    const proposal = proposeExitLadder(position, config);

    // Should still allocate all 5 contracts
    const totalAllocated = proposal.orders.reduce((sum, o) => sum + o.contractsToClose, 0);
    expect(totalAllocated).toBe(5);
  });

  it('validates orders when context provided', () => {
    const position = createMockOptionPosition();
    const context = createValidationContext();

    const proposal = proposeExitLadder(position, { rungs: PRESET_LADDERS.standard }, context);

    // All orders should have validation results
    for (const order of proposal.orders) {
      expect(order.validationResult).toBeDefined();
    }

    expect(proposal.validationSummary.passedCount).toBeGreaterThanOrEqual(0);
  });

  it('skips validation when not configured', () => {
    const position = createMockOptionPosition();
    const config: ExitLadderConfig = {
      rungs: PRESET_LADDERS.standard,
      validateOrders: false,
    };

    const proposal = proposeExitLadder(position, config, createValidationContext());

    for (const order of proposal.orders) {
      expect(order.validationResult).toBeUndefined();
    }
  });

  it('tracks validation failures', () => {
    const position = createMockOptionPosition({ quantity: 1000 }); // Large position
    const context = createValidationContext({
      riskConfig: { ...DEFAULT_RISK_CONFIG, maxContractsPerPosition: 10 },
    });

    const proposal = proposeExitLadder(position, { rungs: PRESET_LADDERS.standard }, context);

    // Some validation failures expected due to position size
    expect(proposal.validationSummary.allPassed).toBe(false);
    expect(proposal.validationSummary.failedCount).toBeGreaterThan(0);
  });
});

// ============================================================================
// proposeExitLadderPreset Tests
// ============================================================================

describe('proposeExitLadderPreset', () => {
  it('creates conservative ladder', () => {
    const position = createMockOptionPosition();
    const proposal = proposeExitLadderPreset(position, 'conservative');

    expect(proposal.orders).toHaveLength(3);
    expect(proposal.orders[0]!.targetProfitPercent).toBe(15);
    expect(proposal.orders[1]!.targetProfitPercent).toBe(30);
    expect(proposal.orders[2]!.targetProfitPercent).toBe(50);
  });

  it('creates standard ladder', () => {
    const position = createMockOptionPosition();
    const proposal = proposeExitLadderPreset(position, 'standard');

    expect(proposal.orders).toHaveLength(3);
    expect(proposal.orders[0]!.targetProfitPercent).toBe(25);
    expect(proposal.orders[1]!.targetProfitPercent).toBe(50);
    expect(proposal.orders[2]!.targetProfitPercent).toBe(100);
  });

  it('creates aggressive ladder', () => {
    const position = createMockOptionPosition();
    const proposal = proposeExitLadderPreset(position, 'aggressive');

    expect(proposal.orders).toHaveLength(3);
    expect(proposal.orders[0]!.targetProfitPercent).toBe(50);
    expect(proposal.orders[1]!.targetProfitPercent).toBe(100);
    expect(proposal.orders[2]!.targetProfitPercent).toBe(200);
  });

  it('passes validation context through', () => {
    const position = createMockOptionPosition();
    const context = createValidationContext();
    const proposal = proposeExitLadderPreset(position, 'standard', context);

    for (const order of proposal.orders) {
      expect(order.validationResult).toBeDefined();
    }
  });
});

// ============================================================================
// proposeExitLadderFromTargets Tests
// ============================================================================

describe('proposeExitLadderFromTargets', () => {
  it('creates ladder from target array', () => {
    const position = createMockOptionPosition();
    const targets = [25, 50, 100];
    const proposal = proposeExitLadderFromTargets(position, targets);

    expect(proposal.orders).toHaveLength(3);
    expect(proposal.orders[0]!.targetProfitPercent).toBe(25);
    expect(proposal.orders[1]!.targetProfitPercent).toBe(50);
    expect(proposal.orders[2]!.targetProfitPercent).toBe(100);
  });

  it('distributes close percentages evenly', () => {
    const position = createMockOptionPosition();
    const targets = [20, 40, 60, 80];
    const proposal = proposeExitLadderFromTargets(position, targets);

    // 100 / 4 = 25 each
    const totalPercent = proposal.config.rungs.reduce((sum, r) => sum + r.closePercent, 0);
    expect(totalPercent).toBe(100);
  });

  it('handles single target', () => {
    const position = createMockOptionPosition();
    const targets = [50];
    const proposal = proposeExitLadderFromTargets(position, targets);

    expect(proposal.orders).toHaveLength(1);
    expect(proposal.config.rungs[0]!.closePercent).toBe(100);
  });

  it('handles two targets', () => {
    const position = createMockOptionPosition();
    const targets = [50, 100];
    const proposal = proposeExitLadderFromTargets(position, targets);

    expect(proposal.orders).toHaveLength(2);
    const totalPercent = proposal.config.rungs.reduce((sum, r) => sum + r.closePercent, 0);
    expect(totalPercent).toBe(100);
  });
});

// ============================================================================
// Formatting Tests
// ============================================================================

describe('formatExitLadderOrder', () => {
  it('formats order correctly', () => {
    const position = createMockOptionPosition({ averageCost: 5.0 });
    const proposal = proposeExitLadder(position, {
      rungs: [{ targetProfitPercent: 50, closePercent: 100 }],
    });

    const formatted = formatExitLadderOrder(proposal.orders[0]!);

    expect(formatted).toContain('Rung 1');
    expect(formatted).toContain('Sell');
    expect(formatted).toContain('$7.50');
    expect(formatted).toContain('+50%');
  });

  it('includes FAILED tag when validation fails', () => {
    const position = createMockOptionPosition({ quantity: 1000 });
    const context = createValidationContext({
      riskConfig: { ...DEFAULT_RISK_CONFIG, maxContractsPerPosition: 10 },
    });

    const proposal = proposeExitLadder(
      position,
      { rungs: [{ targetProfitPercent: 50, closePercent: 100 }] },
      context
    );

    const failedOrder = proposal.orders.find((o) => o.validationResult?.valid === false);
    if (failedOrder) {
      const formatted = formatExitLadderOrder(failedOrder);
      expect(formatted).toContain('[FAILED]');
    }
  });
});

describe('formatExitLadderProposal', () => {
  it('formats proposal with all sections', () => {
    const position = createMockOptionPosition();
    const proposal = proposeExitLadder(position, { rungs: PRESET_LADDERS.standard });

    const formatted = formatExitLadderProposal(proposal);

    expect(formatted).toContain('Exit Ladder');
    expect(formatted).toContain('AAPL240119C00150000');
    expect(formatted).toContain('Exit Orders:');
    expect(formatted).toContain('Total Contracts to Exit');
    expect(formatted).toContain('Total Estimated Credit');
  });

  it('includes validation summary', () => {
    const position = createMockOptionPosition();
    const context = createValidationContext();
    const proposal = proposeExitLadder(position, { rungs: PRESET_LADDERS.standard }, context);

    const formatted = formatExitLadderProposal(proposal);

    expect(formatted).toContain('Validation');
    expect(formatted).toContain('passed');
  });

  it('includes warnings when present', () => {
    const position = createMockOptionPosition({ quantity: -10 });
    const proposal = proposeExitLadder(position, { rungs: PRESET_LADDERS.standard });

    const formatted = formatExitLadderProposal(proposal);

    expect(formatted).toContain('Warnings');
  });
});

describe('toBuiltDraftOrdersResult', () => {
  it('converts proposal to BuildDraftOrdersResult format', () => {
    const position = createMockOptionPosition();
    const proposal = proposeExitLadder(position, { rungs: PRESET_LADDERS.standard });

    const result = toBuiltDraftOrdersResult(proposal);

    expect(result.orders).toHaveLength(proposal.orders.length);
    expect(result.correlationId).toBe(proposal.correlationId);
    expect(result.proposalId).toBe(proposal.proposalId);
    expect(result.warnings).toEqual(proposal.warnings);
  });

  it('returns negative cost (credit) for sell orders', () => {
    const position = createMockOptionPosition();
    const proposal = proposeExitLadder(position, { rungs: PRESET_LADDERS.standard });

    const result = toBuiltDraftOrdersResult(proposal);

    // Should be negative because we're receiving credit
    expect(result.totalEstimatedCost).toBeLessThan(0);
    expect(result.totalEstimatedCost).toBe(-proposal.totalEstimatedCredit);
  });
});

// ============================================================================
// Preset Ladder Tests
// ============================================================================

describe('PRESET_LADDERS', () => {
  it('conservative ladder totals 100%', () => {
    const total = PRESET_LADDERS.conservative.reduce((sum, r) => sum + r.closePercent, 0);
    expect(total).toBe(100);
  });

  it('standard ladder totals 100%', () => {
    const total = PRESET_LADDERS.standard.reduce((sum, r) => sum + r.closePercent, 0);
    expect(total).toBe(100);
  });

  it('aggressive ladder totals 100%', () => {
    const total = PRESET_LADDERS.aggressive.reduce((sum, r) => sum + r.closePercent, 0);
    expect(total).toBe(100);
  });

  it('all presets have ascending profit targets', () => {
    for (const [name, rungs] of Object.entries(PRESET_LADDERS)) {
      for (let i = 1; i < rungs.length; i++) {
        expect(rungs[i]!.targetProfitPercent).toBeGreaterThan(rungs[i - 1]!.targetProfitPercent);
      }
    }
  });
});

// ============================================================================
// Edge Cases
// ============================================================================

describe('Edge cases', () => {
  it('handles single contract position', () => {
    const position = createMockOptionPosition({ quantity: 1 });
    const proposal = proposeExitLadder(position, {
      rungs: [
        { targetProfitPercent: 25, closePercent: 34 },
        { targetProfitPercent: 50, closePercent: 33 },
        { targetProfitPercent: 100, closePercent: 33 },
      ],
    });

    // Should allocate the single contract to first rung only
    expect(proposal.orders.filter((o) => o.contractsToClose > 0)).toHaveLength(1);
    expect(proposal.totalContractsToExit).toBe(1);
  });

  it('handles very small cost basis', () => {
    const position = createMockOptionPosition({ averageCost: 0.01 });
    const proposal = proposeExitLadder(position, { rungs: PRESET_LADDERS.standard });

    expect(proposal.orders[0]!.exitPrice).toBe(0.01); // Rounded
  });

  it('handles large profit targets', () => {
    const position = createMockOptionPosition({ averageCost: 5.0 });
    const proposal = proposeExitLadder(position, {
      rungs: [{ targetProfitPercent: 1000, closePercent: 100 }],
    });

    expect(proposal.orders[0]!.exitPrice).toBe(55.0); // 5.0 * 11
  });

  it('handles position without option details', () => {
    const position: Position = {
      id: 'pos-123',
      symbol: 'AAPL',
      quantity: 100,
      averageCost: 150,
      currentPrice: 160,
      marketValue: 16000,
      unrealizedPnL: 1000,
      unrealizedPnLPercent: 6.67,
      assetClass: 'equity',
    };

    const proposal = proposeExitLadder(position, { rungs: PRESET_LADDERS.standard });

    expect(proposal.orders.length).toBeGreaterThan(0);
    expect(proposal.warnings.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// Default Configuration Tests
// ============================================================================

describe('DEFAULT_EXIT_LADDER_CONFIG', () => {
  it('has sensible defaults', () => {
    expect(DEFAULT_EXIT_LADDER_CONFIG.orderType).toBe('limit');
    expect(DEFAULT_EXIT_LADDER_CONFIG.timeInForce).toBe('gtc');
    expect(DEFAULT_EXIT_LADDER_CONFIG.validateOrders).toBe(true);
  });
});
