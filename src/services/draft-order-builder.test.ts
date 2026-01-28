/**
 * Tests for Draft Order Builder Service
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  buildDraftOrder,
  buildDraftOrders,
  buildDraftOrdersFromStored,
  buildDraftOrderFromContract,
  generateIdempotencyKey,
  generateCorrelationId,
  validateDraftOrder,
  validateDraftOrdersResult,
  formatDraftOrder,
  formatDraftOrdersResult,
  DEFAULT_DRAFT_ORDER_CONFIG,
  type DraftOrder,
  type DraftOrderBuilderConfig,
} from './draft-order-builder.js';
import type {
  TradeProposal,
  StoredTradeProposal,
  ProposalContract,
  EntryPlan,
} from '../types/trade-proposal.js';

// ============================================================================
// Test Fixtures
// ============================================================================

function createMockContract(overrides: Partial<ProposalContract> = {}): ProposalContract {
  return {
    optionSymbol: 'AAPL240216C00185000',
    underlying: 'AAPL',
    strike: 185,
    expiration: new Date('2024-02-16'),
    optionType: 'call',
    side: 'buy',
    quantity: 1,
    targetPrice: 3.50,
    ...overrides,
  };
}

function createMockEntryPlan(overrides: Partial<EntryPlan> = {}): EntryPlan {
  return {
    orderType: 'limit',
    limitPrice: 3.50,
    timeInForce: 'day',
    ...overrides,
  };
}

function createMockProposal(overrides: Partial<TradeProposal> = {}): TradeProposal {
  return {
    strategyType: 'long_call',
    underlying: 'AAPL',
    contracts: [createMockContract()],
    thesis: ['Bullish on AAPL earnings'],
    catalysts: ['Earnings report'],
    entryPlan: createMockEntryPlan(),
    exitPlan: {
      profitTargets: [{ percentGain: 50, closePercent: 100 }],
    },
    risk: {
      maxLoss: 350,
    },
    confidence: 'medium',
    dataUsed: [],
    ...overrides,
  };
}

function createMockStoredProposal(
  proposal?: TradeProposal,
  overrides: Partial<StoredTradeProposal> = {}
): StoredTradeProposal {
  return {
    id: '123e4567-e89b-12d3-a456-426614174000',
    accountId: 'account-123',
    proposal: proposal ?? createMockProposal(),
    status: 'approved',
    createdAt: new Date('2024-01-15T10:00:00Z'),
    updatedAt: new Date('2024-01-15T10:00:00Z'),
    ...overrides,
  };
}

// ============================================================================
// generateIdempotencyKey Tests
// ============================================================================

describe('generateIdempotencyKey', () => {
  it('should generate a valid UUID', () => {
    const key = generateIdempotencyKey();
    expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  it('should generate unique keys', () => {
    const keys = new Set<string>();
    for (let i = 0; i < 100; i++) {
      keys.add(generateIdempotencyKey());
    }
    expect(keys.size).toBe(100);
  });
});

describe('generateCorrelationId', () => {
  it('should generate a valid UUID', () => {
    const id = generateCorrelationId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });
});

// ============================================================================
// DEFAULT_DRAFT_ORDER_CONFIG Tests
// ============================================================================

describe('DEFAULT_DRAFT_ORDER_CONFIG', () => {
  it('should have sensible defaults', () => {
    expect(DEFAULT_DRAFT_ORDER_CONFIG.defaultTimeInForce).toBe('day');
    expect(DEFAULT_DRAFT_ORDER_CONFIG.defaultOrderType).toBe('limit');
    expect(DEFAULT_DRAFT_ORDER_CONFIG.applySlippage).toBe(true);
    expect(DEFAULT_DRAFT_ORDER_CONFIG.defaultMultiplier).toBe(100);
  });
});

// ============================================================================
// buildDraftOrderFromContract Tests
// ============================================================================

describe('buildDraftOrderFromContract', () => {
  it('should build a draft order from a contract', () => {
    const contract = createMockContract();
    const entryPlan = createMockEntryPlan();

    const draft = buildDraftOrderFromContract(
      contract,
      entryPlan,
      0,
      undefined,
      DEFAULT_DRAFT_ORDER_CONFIG
    );

    expect(draft.orderRequest.symbol).toBe('AAPL240216C00185000');
    expect(draft.orderRequest.assetClass).toBe('option');
    expect(draft.orderRequest.side).toBe('buy');
    expect(draft.orderRequest.orderType).toBe('limit');
    expect(draft.orderRequest.timeInForce).toBe('day');
    expect(draft.orderRequest.quantity).toBe(1);
    expect(draft.orderRequest.limitPrice).toBe(3.50);
    expect(draft.idempotencyKey).toBeTruthy();
    expect(draft.legIndex).toBe(0);
  });

  it('should include option details in the order', () => {
    const contract = createMockContract();
    const entryPlan = createMockEntryPlan();

    const draft = buildDraftOrderFromContract(
      contract,
      entryPlan,
      0,
      undefined,
      DEFAULT_DRAFT_ORDER_CONFIG
    );

    expect(draft.orderRequest.optionDetails).toBeDefined();
    expect(draft.orderRequest.optionDetails?.underlying).toBe('AAPL');
    expect(draft.orderRequest.optionDetails?.strike).toBe(185);
    expect(draft.orderRequest.optionDetails?.optionType).toBe('call');
  });

  it('should apply slippage to buy orders (increase limit price)', () => {
    const contract = createMockContract({ targetPrice: 10.00 });
    const entryPlan = createMockEntryPlan({ slippagePercent: 5 });

    const draft = buildDraftOrderFromContract(
      contract,
      entryPlan,
      0,
      undefined,
      DEFAULT_DRAFT_ORDER_CONFIG
    );

    // 10.00 * 1.05 = 10.50
    expect(draft.orderRequest.limitPrice).toBe(10.50);
  });

  it('should apply slippage to sell orders (decrease limit price)', () => {
    const contract = createMockContract({ side: 'sell', targetPrice: 10.00 });
    const entryPlan = createMockEntryPlan({ slippagePercent: 5 });

    const draft = buildDraftOrderFromContract(
      contract,
      entryPlan,
      0,
      undefined,
      DEFAULT_DRAFT_ORDER_CONFIG
    );

    // 10.00 / 1.05 ≈ 9.52
    expect(draft.orderRequest.limitPrice).toBeCloseTo(9.52, 2);
  });

  it('should not apply slippage when disabled', () => {
    const contract = createMockContract({ targetPrice: 10.00 });
    const entryPlan = createMockEntryPlan({ slippagePercent: 5 });
    const config: Required<DraftOrderBuilderConfig> = {
      ...DEFAULT_DRAFT_ORDER_CONFIG,
      applySlippage: false,
    };

    const draft = buildDraftOrderFromContract(contract, entryPlan, 0, undefined, config);

    expect(draft.orderRequest.limitPrice).toBe(10.00);
  });

  it('should not set limit price for market orders', () => {
    const contract = createMockContract();
    const entryPlan = createMockEntryPlan({ orderType: 'market' });

    const draft = buildDraftOrderFromContract(
      contract,
      entryPlan,
      0,
      undefined,
      DEFAULT_DRAFT_ORDER_CONFIG
    );

    expect(draft.orderRequest.orderType).toBe('market');
    expect(draft.orderRequest.limitPrice).toBeUndefined();
  });

  it('should calculate estimated cost for buy orders (positive)', () => {
    const contract = createMockContract({ quantity: 2, targetPrice: 5.00 });
    const entryPlan = createMockEntryPlan();

    const draft = buildDraftOrderFromContract(
      contract,
      entryPlan,
      0,
      undefined,
      DEFAULT_DRAFT_ORDER_CONFIG
    );

    // 2 contracts * $5.00 * 100 multiplier = $1000 debit
    expect(draft.estimatedCost).toBe(1000);
  });

  it('should calculate estimated cost for sell orders (negative)', () => {
    const contract = createMockContract({ side: 'sell', quantity: 2, targetPrice: 5.00 });
    const entryPlan = createMockEntryPlan();

    const draft = buildDraftOrderFromContract(
      contract,
      entryPlan,
      0,
      undefined,
      DEFAULT_DRAFT_ORDER_CONFIG
    );

    // 2 contracts * $5.00 * 100 multiplier = $1000 credit
    expect(draft.estimatedCost).toBe(-1000);
  });

  it('should set proposal ID when provided', () => {
    const contract = createMockContract();
    const entryPlan = createMockEntryPlan();

    const draft = buildDraftOrderFromContract(
      contract,
      entryPlan,
      0,
      'proposal-123',
      DEFAULT_DRAFT_ORDER_CONFIG
    );

    expect(draft.proposalId).toBe('proposal-123');
  });

  it('should store contract info for reference', () => {
    const contract = createMockContract();
    const entryPlan = createMockEntryPlan();

    const draft = buildDraftOrderFromContract(
      contract,
      entryPlan,
      0,
      undefined,
      DEFAULT_DRAFT_ORDER_CONFIG
    );

    expect(draft.contractInfo.underlying).toBe('AAPL');
    expect(draft.contractInfo.strike).toBe(185);
    expect(draft.contractInfo.optionType).toBe('call');
    expect(draft.contractInfo.side).toBe('buy');
    expect(draft.contractInfo.quantity).toBe(1);
  });

  it('should set createdAt timestamp', () => {
    const contract = createMockContract();
    const entryPlan = createMockEntryPlan();

    const before = new Date();
    const draft = buildDraftOrderFromContract(
      contract,
      entryPlan,
      0,
      undefined,
      DEFAULT_DRAFT_ORDER_CONFIG
    );
    const after = new Date();

    expect(draft.createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(draft.createdAt.getTime()).toBeLessThanOrEqual(after.getTime());
  });
});

// ============================================================================
// buildDraftOrders Tests
// ============================================================================

describe('buildDraftOrders', () => {
  it('should build orders from a single-leg proposal', () => {
    const proposal = createMockProposal();

    const result = buildDraftOrders(proposal);

    expect(result.orders.length).toBe(1);
    expect(result.totalEstimatedCost).toBe(350); // 1 * $3.50 * 100
    expect(result.correlationId).toBeTruthy();
    expect(result.warnings.length).toBe(0);
  });

  it('should build orders from a multi-leg proposal (vertical spread)', () => {
    const proposal = createMockProposal({
      strategyType: 'vertical_spread',
      contracts: [
        createMockContract({ strike: 180, side: 'buy', targetPrice: 5.00 }),
        createMockContract({ strike: 185, side: 'sell', targetPrice: 3.00 }),
      ],
    });

    const result = buildDraftOrders(proposal);

    expect(result.orders.length).toBe(2);
    expect(result.orders[0].legIndex).toBe(0);
    expect(result.orders[1].legIndex).toBe(1);

    // Buy leg: 1 * $5.00 * 100 = $500 debit
    // Sell leg: 1 * $3.00 * 100 = $300 credit
    // Net: $200 debit
    expect(result.totalEstimatedCost).toBe(200);
  });

  it('should generate unique idempotency keys for each leg', () => {
    const proposal = createMockProposal({
      contracts: [
        createMockContract({ strike: 180 }),
        createMockContract({ strike: 185 }),
      ],
    });

    const result = buildDraftOrders(proposal);

    expect(result.orders[0].idempotencyKey).not.toBe(result.orders[1].idempotencyKey);
  });

  it('should warn about market orders', () => {
    const proposal = createMockProposal({
      entryPlan: createMockEntryPlan({ orderType: 'market' }),
    });

    const result = buildDraftOrders(proposal);

    expect(result.warnings).toContain(
      'Market order type - no price protection, order will execute at current market price'
    );
  });

  it('should warn about limit orders without price', () => {
    const proposal = createMockProposal({
      contracts: [createMockContract({ targetPrice: undefined })],
      entryPlan: createMockEntryPlan({ limitPrice: undefined }),
    });

    const result = buildDraftOrders(proposal);

    expect(result.warnings).toContain(
      'Limit order without specified price - order may not execute'
    );
  });

  it('should handle proposal with no contracts', () => {
    const proposal = createMockProposal({ contracts: [] });

    const result = buildDraftOrders(proposal);

    expect(result.orders.length).toBe(0);
    expect(result.warnings).toContain('Proposal has no contracts to convert to orders');
  });

  it('should skip contracts without option symbol', () => {
    const proposal = createMockProposal({
      contracts: [
        createMockContract({ optionSymbol: '' }),
        createMockContract({ optionSymbol: 'AAPL240216C00190000' }),
      ],
    });

    const result = buildDraftOrders(proposal);

    expect(result.orders.length).toBe(1);
    expect(result.warnings).toContain('Contract 0 missing option symbol - cannot create order');
  });

  it('should handle different time in force values', () => {
    const proposal = createMockProposal({
      entryPlan: createMockEntryPlan({ timeInForce: 'gtc' }),
    });

    const result = buildDraftOrders(proposal);

    expect(result.orders[0].orderRequest.timeInForce).toBe('gtc');
  });

  it('should apply custom configuration', () => {
    const proposal = createMockProposal();
    const config: DraftOrderBuilderConfig = {
      defaultMultiplier: 10, // Mini options
    };

    const result = buildDraftOrders(proposal, config);

    // 1 * $3.50 * 10 = $35
    expect(result.totalEstimatedCost).toBe(35);
  });

  it('should calculate credit for short strategies', () => {
    const proposal = createMockProposal({
      strategyType: 'short_put',
      contracts: [createMockContract({ side: 'sell', optionType: 'put', targetPrice: 2.00 })],
    });

    const result = buildDraftOrders(proposal);

    // Selling 1 put at $2.00 * 100 = $200 credit (negative)
    expect(result.totalEstimatedCost).toBe(-200);
  });
});

// ============================================================================
// buildDraftOrdersFromStored Tests
// ============================================================================

describe('buildDraftOrdersFromStored', () => {
  it('should include proposal ID in all orders', () => {
    const stored = createMockStoredProposal();

    const result = buildDraftOrdersFromStored(stored);

    expect(result.proposalId).toBe('123e4567-e89b-12d3-a456-426614174000');
    expect(result.orders[0].proposalId).toBe('123e4567-e89b-12d3-a456-426614174000');
  });

  it('should warn if proposal is not approved', () => {
    const stored = createMockStoredProposal(undefined, { status: 'draft' });

    const result = buildDraftOrdersFromStored(stored);

    expect(result.warnings[0]).toContain("Proposal status is 'draft'");
    expect(result.warnings[0]).toContain('only approved proposals should be executed');
  });

  it('should not warn for approved proposals', () => {
    const stored = createMockStoredProposal(undefined, { status: 'approved' });

    const result = buildDraftOrdersFromStored(stored);

    expect(result.warnings.some(w => w.includes('status'))).toBe(false);
  });

  it('should warn for rejected proposals', () => {
    const stored = createMockStoredProposal(undefined, { status: 'rejected' });

    const result = buildDraftOrdersFromStored(stored);

    expect(result.warnings[0]).toContain("Proposal status is 'rejected'");
  });

  it('should warn for executed proposals', () => {
    const stored = createMockStoredProposal(undefined, { status: 'executed' });

    const result = buildDraftOrdersFromStored(stored);

    expect(result.warnings[0]).toContain("Proposal status is 'executed'");
  });
});

// ============================================================================
// buildDraftOrder Tests
// ============================================================================

describe('buildDraftOrder', () => {
  it('should return single order for single-leg proposal', () => {
    const proposal = createMockProposal();

    const draft = buildDraftOrder(proposal);

    expect(draft.orderRequest.symbol).toBe('AAPL240216C00185000');
    expect(draft.idempotencyKey).toBeTruthy();
  });

  it('should throw for proposal with no contracts', () => {
    const proposal = createMockProposal({ contracts: [] });

    expect(() => buildDraftOrder(proposal)).toThrow('Proposal produced no orders');
  });

  it('should throw for multi-leg proposals', () => {
    const proposal = createMockProposal({
      contracts: [
        createMockContract({ strike: 180 }),
        createMockContract({ strike: 185 }),
      ],
    });

    expect(() => buildDraftOrder(proposal)).toThrow(
      'Proposal has 2 legs - use buildDraftOrders() for multi-leg strategies'
    );
  });
});

// ============================================================================
// validateDraftOrder Tests
// ============================================================================

describe('validateDraftOrder', () => {
  it('should validate a well-formed order', () => {
    const proposal = createMockProposal();
    const draft = buildDraftOrder(proposal);

    const validation = validateDraftOrder(draft);

    expect(validation.valid).toBe(true);
    expect(validation.errors.length).toBe(0);
  });

  it('should reject order missing symbol', () => {
    const proposal = createMockProposal();
    const draft = buildDraftOrder(proposal);
    draft.orderRequest.symbol = '';

    const validation = validateDraftOrder(draft);

    expect(validation.valid).toBe(false);
    expect(validation.errors).toContain('Order missing symbol');
  });

  it('should reject order with zero quantity', () => {
    const proposal = createMockProposal();
    const draft = buildDraftOrder(proposal);
    draft.orderRequest.quantity = 0;

    const validation = validateDraftOrder(draft);

    expect(validation.valid).toBe(false);
    expect(validation.errors).toContain('Order quantity must be positive');
  });

  it('should reject limit order without limit price', () => {
    const proposal = createMockProposal();
    const draft = buildDraftOrder(proposal);
    draft.orderRequest.orderType = 'limit';
    draft.orderRequest.limitPrice = undefined;

    const validation = validateDraftOrder(draft);

    expect(validation.valid).toBe(false);
    expect(validation.errors).toContain('Limit order missing limit price');
  });

  it('should reject stop order without stop price', () => {
    const proposal = createMockProposal();
    const draft = buildDraftOrder(proposal);
    draft.orderRequest.orderType = 'stop';
    draft.orderRequest.stopPrice = undefined;

    const validation = validateDraftOrder(draft);

    expect(validation.valid).toBe(false);
    expect(validation.errors).toContain('Stop order missing stop price');
  });

  it('should reject stop-limit order without both prices', () => {
    const proposal = createMockProposal();
    const draft = buildDraftOrder(proposal);
    draft.orderRequest.orderType = 'stop_limit';
    draft.orderRequest.limitPrice = undefined;
    draft.orderRequest.stopPrice = undefined;

    const validation = validateDraftOrder(draft);

    expect(validation.valid).toBe(false);
    expect(validation.errors).toContain('Stop-limit order missing limit price');
    expect(validation.errors).toContain('Stop-limit order missing stop price');
  });

  it('should reject order missing idempotency key', () => {
    const proposal = createMockProposal();
    const draft = buildDraftOrder(proposal);
    draft.idempotencyKey = '';

    const validation = validateDraftOrder(draft);

    expect(validation.valid).toBe(false);
    expect(validation.errors).toContain('Order missing idempotency key');
  });

  it('should reject option order without option details', () => {
    const proposal = createMockProposal();
    const draft = buildDraftOrder(proposal);
    draft.orderRequest.optionDetails = undefined;

    const validation = validateDraftOrder(draft);

    expect(validation.valid).toBe(false);
    expect(validation.errors).toContain('Option order missing option details');
  });
});

// ============================================================================
// validateDraftOrdersResult Tests
// ============================================================================

describe('validateDraftOrdersResult', () => {
  it('should validate all orders in result', () => {
    const proposal = createMockProposal({
      contracts: [
        createMockContract({ strike: 180 }),
        createMockContract({ strike: 185 }),
      ],
    });

    const result = buildDraftOrders(proposal);
    const validation = validateDraftOrdersResult(result);

    expect(validation.valid).toBe(true);
    expect(validation.errors.length).toBe(0);
  });

  it('should include order index in error messages', () => {
    const proposal = createMockProposal({
      contracts: [
        createMockContract({ strike: 180 }),
        createMockContract({ strike: 185 }),
      ],
    });

    const result = buildDraftOrders(proposal);
    result.orders[1].orderRequest.symbol = '';

    const validation = validateDraftOrdersResult(result);

    expect(validation.valid).toBe(false);
    expect(validation.errors.some(e => e.startsWith('Order 1:'))).toBe(true);
  });

  it('should include warnings from the result', () => {
    const proposal = createMockProposal({
      entryPlan: createMockEntryPlan({ orderType: 'market' }),
    });

    const result = buildDraftOrders(proposal);
    const validation = validateDraftOrdersResult(result);

    expect(validation.warnings.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// formatDraftOrder Tests
// ============================================================================

describe('formatDraftOrder', () => {
  it('should format a buy order correctly', () => {
    const proposal = createMockProposal();
    const draft = buildDraftOrder(proposal);

    const formatted = formatDraftOrder(draft);

    expect(formatted).toContain('BUY');
    expect(formatted).toContain('1x');
    expect(formatted).toContain('AAPL');
    expect(formatted).toContain('$185');
    expect(formatted).toContain('C'); // Call
    expect(formatted).toContain('@ $3.50');
    expect(formatted).toContain('debit');
  });

  it('should format a sell order correctly', () => {
    const proposal = createMockProposal({
      contracts: [createMockContract({ side: 'sell', optionType: 'put' })],
    });
    const draft = buildDraftOrder(proposal);

    const formatted = formatDraftOrder(draft);

    expect(formatted).toContain('SELL');
    expect(formatted).toContain('P'); // Put
    expect(formatted).toContain('credit');
  });

  it('should format market order without price', () => {
    const proposal = createMockProposal({
      entryPlan: createMockEntryPlan({ orderType: 'market' }),
    });
    const draft = buildDraftOrder(proposal);

    const formatted = formatDraftOrder(draft);

    expect(formatted).not.toContain('@ $');
  });

  it('should include expiration date', () => {
    const proposal = createMockProposal();
    const draft = buildDraftOrder(proposal);

    const formatted = formatDraftOrder(draft);

    expect(formatted).toContain('2024-02-16');
  });
});

// ============================================================================
// formatDraftOrdersResult Tests
// ============================================================================

describe('formatDraftOrdersResult', () => {
  it('should format single-leg result', () => {
    const proposal = createMockProposal();
    const result = buildDraftOrders(proposal);

    const formatted = formatDraftOrdersResult(result);

    expect(formatted).toContain('Orders (1 leg):');
    expect(formatted).toContain('Total:');
  });

  it('should format multi-leg result', () => {
    const proposal = createMockProposal({
      contracts: [
        createMockContract({ strike: 180 }),
        createMockContract({ strike: 185 }),
      ],
    });
    const result = buildDraftOrders(proposal);

    const formatted = formatDraftOrdersResult(result);

    expect(formatted).toContain('Orders (2 legs):');
  });

  it('should format empty result', () => {
    const proposal = createMockProposal({ contracts: [] });
    const result = buildDraftOrders(proposal);

    const formatted = formatDraftOrdersResult(result);

    expect(formatted).toContain('No orders to display');
  });

  it('should include warnings', () => {
    const proposal = createMockProposal({
      entryPlan: createMockEntryPlan({ orderType: 'market' }),
    });
    const result = buildDraftOrders(proposal);

    const formatted = formatDraftOrdersResult(result);

    expect(formatted).toContain('Warnings:');
    expect(formatted).toContain('⚠');
  });

  it('should show credit total correctly', () => {
    const proposal = createMockProposal({
      contracts: [createMockContract({ side: 'sell', targetPrice: 2.00 })],
    });
    const result = buildDraftOrders(proposal);

    const formatted = formatDraftOrdersResult(result);

    expect(formatted).toContain('$200.00 credit');
  });
});

// ============================================================================
// Edge Cases
// ============================================================================

describe('edge cases', () => {
  it('should handle zero target price', () => {
    const proposal = createMockProposal({
      contracts: [createMockContract({ targetPrice: 0 })],
      entryPlan: createMockEntryPlan({ limitPrice: undefined }),
    });

    const result = buildDraftOrders(proposal);

    expect(result.orders[0].estimatedCost).toBe(0);
  });

  it('should handle very large quantities', () => {
    const proposal = createMockProposal({
      contracts: [createMockContract({ quantity: 1000, targetPrice: 1.00 })],
    });

    const result = buildDraftOrders(proposal);

    // 1000 * $1.00 * 100 = $100,000
    expect(result.totalEstimatedCost).toBe(100000);
  });

  it('should handle fractional prices', () => {
    const proposal = createMockProposal({
      contracts: [createMockContract({ targetPrice: 3.456 })],
    });

    const result = buildDraftOrders(proposal);

    // Limit price should be rounded to 2 decimal places
    expect(result.orders[0].orderRequest.limitPrice).toBe(3.46);
  });

  it('should handle multiple contracts with different sides', () => {
    const proposal = createMockProposal({
      strategyType: 'iron_condor',
      contracts: [
        createMockContract({ strike: 170, side: 'sell', optionType: 'put', targetPrice: 1.00 }),
        createMockContract({ strike: 165, side: 'buy', optionType: 'put', targetPrice: 0.50 }),
        createMockContract({ strike: 190, side: 'sell', optionType: 'call', targetPrice: 1.00 }),
        createMockContract({ strike: 195, side: 'buy', optionType: 'call', targetPrice: 0.50 }),
      ],
    });

    const result = buildDraftOrders(proposal);

    expect(result.orders.length).toBe(4);
    // Net credit: -$100 - $50 - $100 + $50 = -$100 + $50 = net $100 credit
    // Sell 2: -$100 - $100 = -$200
    // Buy 2: +$50 + $50 = +$100
    // Net: -$100 credit
    expect(result.totalEstimatedCost).toBe(-100);
  });

  it('should preserve all time in force values', () => {
    const tifs: Array<EntryPlan['timeInForce']> = ['day', 'gtc', 'ioc', 'fok'];

    for (const tif of tifs) {
      const proposal = createMockProposal({
        entryPlan: createMockEntryPlan({ timeInForce: tif }),
      });
      const draft = buildDraftOrder(proposal);
      expect(draft.orderRequest.timeInForce).toBe(tif);
    }
  });
});
