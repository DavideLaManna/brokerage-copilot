/**
 * Tests for Order Repricing Service
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  OrderRepricingService,
  createOrderRepricingService,
  evaluateOrderForRepricing,
} from './order-repricing.js';
import {
  calculateDeviationPercent,
  calculateProposedPrice,
  orderQualifiesForRepricing,
  generateRepricingRationale,
  formatRepricingProposal,
  validateRepricingConfig,
  DEFAULT_REPRICING_CONFIG,
} from '../types/repricing.js';
import type { Order, Quote, BrokerAdapter } from '../types/broker.js';
import type { MarketDataService } from './market-data.js';
import type { AuditLogService } from './audit-log.js';

// ============================================================================
// Mock Helpers
// ============================================================================

function createMockOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 'order-123',
    symbol: 'AAPL',
    assetClass: 'equity',
    side: 'buy',
    orderType: 'limit',
    timeInForce: 'gtc',
    quantity: 100,
    limitPrice: 150.0,
    filledQuantity: 0,
    status: 'open',
    submittedAt: new Date(Date.now() - 10 * 60 * 1000), // 10 minutes ago
    ...overrides,
  };
}

function createMockQuote(overrides: Partial<Quote> = {}): Quote {
  return {
    symbol: 'AAPL',
    bid: 159.5,
    ask: 160.5,
    mid: 160.0,
    last: 160.0,
    bidSize: 100,
    askSize: 100,
    volume: 1000000,
    asOf: new Date(),
    ...overrides,
  };
}

function createMockAdapter(): BrokerAdapter {
  return {
    brokerType: 'tradier',
    brokerName: 'Tradier',
    getOpenOrders: vi.fn().mockResolvedValue([]),
    getOrder: vi.fn().mockResolvedValue(null),
    placeOrder: vi.fn().mockResolvedValue({ id: 'new-order-456' }),
    cancelOrder: vi.fn().mockResolvedValue(true),
    getAccountSummary: vi.fn(),
    getPositions: vi.fn(),
    getQuote: vi.fn(),
    getOptionChain: vi.fn(),
    getHistoricalBars: vi.fn(),
    validateConnection: vi.fn(),
    disconnect: vi.fn(),
  };
}

function createMockMarketDataService(): MarketDataService {
  return {
    getQuote: vi.fn().mockResolvedValue(createMockQuote()),
    getQuotes: vi.fn(),
    getOptionChain: vi.fn(),
    getHistoricalBars: vi.fn(),
    getAdapter: vi.fn(),
    getConfig: vi.fn(),
    updateConfig: vi.fn(),
    clearCache: vi.fn(),
    clearOptionChainCache: vi.fn(),
    clearQuoteCache: vi.fn(),
    clearHistoricalBarsCache: vi.fn(),
    invalidateSymbol: vi.fn(),
    getOptionChainCacheStats: vi.fn(),
    getQuoteCacheStats: vi.fn(),
    getHistoricalBarsCacheStats: vi.fn(),
  } as unknown as MarketDataService;
}

function createMockAuditLogService(): AuditLogService {
  return {
    log: vi.fn().mockResolvedValue({ id: 'audit-123' }),
  } as unknown as AuditLogService;
}

// ============================================================================
// Helper Function Tests
// ============================================================================

describe('calculateDeviationPercent', () => {
  it('should calculate positive deviation when limit is above mid', () => {
    const result = calculateDeviationPercent(110, 100);
    expect(result).toBe(10);
  });

  it('should calculate negative deviation when limit is below mid', () => {
    const result = calculateDeviationPercent(90, 100);
    expect(result).toBe(-10);
  });

  it('should return 0 when limit equals mid', () => {
    const result = calculateDeviationPercent(100, 100);
    expect(result).toBe(0);
  });

  it('should return 0 when mid is 0', () => {
    const result = calculateDeviationPercent(100, 0);
    expect(result).toBe(0);
  });

  it('should handle small deviations', () => {
    const result = calculateDeviationPercent(100.5, 100);
    expect(result).toBeCloseTo(0.5, 5);
  });
});

describe('calculateProposedPrice', () => {
  it('should calculate buy price below mid', () => {
    const result = calculateProposedPrice('buy', 100, 2);
    expect(result).toBe(98); // 100 * (1 - 0.02)
  });

  it('should calculate sell price above mid', () => {
    const result = calculateProposedPrice('sell', 100, 2);
    expect(result).toBe(102); // 100 * (1 + 0.02)
  });

  it('should handle 0% band', () => {
    const buyResult = calculateProposedPrice('buy', 100, 0);
    const sellResult = calculateProposedPrice('sell', 100, 0);
    expect(buyResult).toBe(100);
    expect(sellResult).toBe(100);
  });
});

describe('orderQualifiesForRepricing', () => {
  const config = DEFAULT_REPRICING_CONFIG;

  it('should qualify order with large deviation', () => {
    const order = createMockOrder({ limitPrice: 150 });
    const result = orderQualifiesForRepricing(order, 160, config, 600);
    expect(result.qualifies).toBe(true);
  });

  it('should not qualify market orders', () => {
    const order = createMockOrder({ orderType: 'market', limitPrice: undefined });
    const result = orderQualifiesForRepricing(order, 160, config, 600);
    expect(result.qualifies).toBe(false);
    expect(result.reason).toContain('Not a limit order');
  });

  it('should not qualify orders without limit price', () => {
    const order = createMockOrder({ limitPrice: undefined });
    const result = orderQualifiesForRepricing(order, 160, config, 600);
    expect(result.qualifies).toBe(false);
    expect(result.reason).toContain('No limit price');
  });

  it('should not qualify filled orders', () => {
    const order = createMockOrder({ status: 'filled' });
    const result = orderQualifiesForRepricing(order, 160, config, 600);
    expect(result.qualifies).toBe(false);
    expect(result.reason).toContain('filled');
  });

  it('should not qualify canceled orders', () => {
    const order = createMockOrder({ status: 'canceled' });
    const result = orderQualifiesForRepricing(order, 160, config, 600);
    expect(result.qualifies).toBe(false);
  });

  it('should not qualify orders too young', () => {
    const order = createMockOrder();
    const result = orderQualifiesForRepricing(order, 160, config, 60); // Only 60s old
    expect(result.qualifies).toBe(false);
    expect(result.reason).toContain('minimum');
  });

  it('should not qualify orders within deviation threshold', () => {
    const order = createMockOrder({ limitPrice: 159 }); // Only 0.625% deviation
    const result = orderQualifiesForRepricing(order, 160, config, 600);
    expect(result.qualifies).toBe(false);
    expect(result.reason).toContain('within threshold');
  });

  it('should qualify partially filled orders', () => {
    const order = createMockOrder({ status: 'partially_filled', limitPrice: 150 });
    const result = orderQualifiesForRepricing(order, 160, config, 600);
    expect(result.qualifies).toBe(true);
  });

  it('should respect includeOptions config', () => {
    const order = createMockOrder({ assetClass: 'option', limitPrice: 5 });
    const configNoOptions = { ...config, includeOptions: false };
    const result = orderQualifiesForRepricing(order, 6, configNoOptions, 600);
    expect(result.qualifies).toBe(false);
    expect(result.reason).toContain('Options excluded');
  });

  it('should respect includeEquities config', () => {
    const order = createMockOrder({ assetClass: 'equity', limitPrice: 150 });
    const configNoEquities = { ...config, includeEquities: false };
    const result = orderQualifiesForRepricing(order, 160, configNoEquities, 600);
    expect(result.qualifies).toBe(false);
    expect(result.reason).toContain('Equities excluded');
  });

  it('should respect minMidPrice config', () => {
    const order = createMockOrder({ limitPrice: 0.005 });
    const result = orderQualifiesForRepricing(order, 0.008, config, 600);
    expect(result.qualifies).toBe(false);
    expect(result.reason).toContain('below minimum');
  });
});

describe('generateRepricingRationale', () => {
  it('should generate rationale with deviation info', () => {
    const order = createMockOrder({ limitPrice: 150, side: 'buy' });
    const rationale = generateRepricingRationale(order, 160, 157, -6.25, 159, 161);
    expect(rationale.length).toBeGreaterThan(0);
    expect(rationale.some((r) => r.includes('$150.00'))).toBe(true);
    expect(rationale.some((r) => r.includes('$160.00'))).toBe(true);
  });

  it('should mention spread in rationale', () => {
    const order = createMockOrder({ limitPrice: 150 });
    const rationale = generateRepricingRationale(order, 160, 157, -6.25, 159, 161);
    expect(rationale.some((r) => r.includes('spread'))).toBe(true);
  });

  it('should mention improvement in rationale', () => {
    const order = createMockOrder({ limitPrice: 150 });
    const rationale = generateRepricingRationale(order, 160, 157, -6.25, 159, 161);
    expect(rationale.some((r) => r.includes('closer to market'))).toBe(true);
  });
});

describe('formatRepricingProposal', () => {
  it('should format proposal as readable text', () => {
    const proposal = {
      id: 'prop-123',
      accountId: 'acc-123',
      orderId: 'order-123',
      symbol: 'AAPL',
      assetClass: 'equity' as const,
      side: 'buy' as const,
      currentLimitPrice: 150,
      currentMidPrice: 160,
      currentBid: 159,
      currentAsk: 161,
      deviationPercent: -6.25,
      proposedLimitPrice: 157,
      improvementPercent: 1.875,
      rationale: ['Test rationale 1', 'Test rationale 2'],
      status: 'proposed' as const,
      quantity: 100,
      timeInForce: 'gtc' as const,
      orderSubmittedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const formatted = formatRepricingProposal(proposal);
    expect(formatted).toContain('AAPL');
    expect(formatted).toContain('PROPOSED');
    expect(formatted).toContain('$150.00');
    expect(formatted).toContain('$157.00');
    expect(formatted).toContain('Test rationale 1');
  });
});

describe('validateRepricingConfig', () => {
  it('should validate valid config', () => {
    const result = validateRepricingConfig(DEFAULT_REPRICING_CONFIG);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should reject invalid priceDeviationThreshold', () => {
    const result = validateRepricingConfig({
      ...DEFAULT_REPRICING_CONFIG,
      priceDeviationThreshold: -5,
    });
    expect(result.valid).toBe(false);
  });

  it('should warn about aggressive settings', () => {
    const result = validateRepricingConfig({
      ...DEFAULT_REPRICING_CONFIG,
      priceDeviationThreshold: 1,
    });
    expect(result.valid).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('should warn when reprice band exceeds deviation threshold', () => {
    const result = validateRepricingConfig({
      ...DEFAULT_REPRICING_CONFIG,
      priceDeviationThreshold: 2,
      repriceBandPercent: 5,
    });
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.includes('band'))).toBe(true);
  });
});

// ============================================================================
// Service Tests
// ============================================================================

describe('OrderRepricingService', () => {
  let service: OrderRepricingService;
  let adapter: BrokerAdapter;
  let marketDataService: MarketDataService;
  let auditLogService: AuditLogService;

  beforeEach(() => {
    adapter = createMockAdapter();
    marketDataService = createMockMarketDataService();
    auditLogService = createMockAuditLogService();
    service = new OrderRepricingService(
      adapter,
      marketDataService,
      'test-account',
      {},
      auditLogService
    );
  });

  describe('scanOpenOrders', () => {
    it('should scan orders and generate proposals', async () => {
      const orders = [
        createMockOrder({ id: 'order-1', limitPrice: 150 }), // 6.25% deviation from mid 160
        createMockOrder({ id: 'order-2', limitPrice: 140 }), // 12.5% deviation from mid 160
      ];
      vi.mocked(adapter.getOpenOrders).mockResolvedValue(orders);

      const result = await service.scanOpenOrders();

      expect(result.ordersScanned).toBe(2);
      expect(result.ordersQualifying).toBe(2);
      expect(result.proposals.length).toBe(2);
    });

    it('should skip orders that do not qualify', async () => {
      const orders = [
        createMockOrder({ id: 'order-1', limitPrice: 159.5 }), // Within threshold
        createMockOrder({ id: 'order-2', limitPrice: 150 }), // Qualifies
      ];
      vi.mocked(adapter.getOpenOrders).mockResolvedValue(orders);

      const result = await service.scanOpenOrders();

      expect(result.ordersScanned).toBe(2);
      expect(result.ordersQualifying).toBe(1);
      expect(result.proposals.length).toBe(1);
    });

    it('should handle empty orders list', async () => {
      vi.mocked(adapter.getOpenOrders).mockResolvedValue([]);

      const result = await service.scanOpenOrders();

      expect(result.ordersScanned).toBe(0);
      expect(result.ordersQualifying).toBe(0);
      expect(result.proposals).toHaveLength(0);
    });

    it('should respect maxOrdersPerScan config', async () => {
      const orders = Array.from({ length: 100 }, (_, i) =>
        createMockOrder({ id: `order-${i}`, limitPrice: 150 })
      );
      vi.mocked(adapter.getOpenOrders).mockResolvedValue(orders);

      const result = await service.scanOpenOrders();

      expect(result.ordersScanned).toBe(50); // Default max
    });

    it('should handle quote fetch errors gracefully', async () => {
      const orders = [createMockOrder({ id: 'order-1', limitPrice: 150 })];
      vi.mocked(adapter.getOpenOrders).mockResolvedValue(orders);
      vi.mocked(marketDataService.getQuote).mockRejectedValue(
        new Error('Quote not available')
      );

      const result = await service.scanOpenOrders();

      expect(result.ordersScanned).toBe(1);
      expect(result.ordersQualifying).toBe(0);
      expect(result.skipped.length).toBe(1);
      expect(result.skipped[0].reason).toContain('Quote not available');
    });
  });

  describe('evaluateOrder', () => {
    it('should generate proposal for qualifying order', async () => {
      const order = createMockOrder({ limitPrice: 150 });
      const proposal = await service.evaluateOrder(order);

      expect(proposal).not.toBeNull();
      expect(proposal?.symbol).toBe('AAPL');
      expect(proposal?.currentLimitPrice).toBe(150);
      expect(proposal?.status).toBe('proposed');
    });

    it('should return null for non-qualifying order', async () => {
      const order = createMockOrder({ limitPrice: 159.5 }); // Within threshold
      const proposal = await service.evaluateOrder(order);

      expect(proposal).toBeNull();
    });
  });

  describe('generateProposal', () => {
    it('should generate proposal with correct fields', () => {
      const order = createMockOrder({ limitPrice: 150 });
      const quote = createMockQuote();
      const proposal = service.generateProposal(order, quote);

      expect(proposal.id).toBeDefined();
      expect(proposal.orderId).toBe('order-123');
      expect(proposal.symbol).toBe('AAPL');
      expect(proposal.currentLimitPrice).toBe(150);
      expect(proposal.currentMidPrice).toBe(160);
      expect(proposal.deviationPercent).toBeCloseTo(-6.25, 2);
      expect(proposal.status).toBe('proposed');
      expect(proposal.rationale.length).toBeGreaterThan(0);
    });

    it('should calculate proposed price for buy orders', () => {
      const order = createMockOrder({ side: 'buy', limitPrice: 150 });
      const quote = createMockQuote({ mid: 160 });
      const proposal = service.generateProposal(order, quote);

      // Buy should be below mid: 160 * (1 - 0.02) = 156.8
      expect(proposal.proposedLimitPrice).toBe(156.8);
    });

    it('should calculate proposed price for sell orders', () => {
      const order = createMockOrder({ side: 'sell', limitPrice: 170 });
      const quote = createMockQuote({ mid: 160 });
      const proposal = service.generateProposal(order, quote);

      // Sell should be above mid: 160 * (1 + 0.02) = 163.2
      expect(proposal.proposedLimitPrice).toBe(163.2);
    });
  });

  describe('proposal lifecycle', () => {
    beforeEach(async () => {
      const orders = [createMockOrder({ id: 'order-1', limitPrice: 150 })];
      vi.mocked(adapter.getOpenOrders).mockResolvedValue(orders);
      await service.scanOpenOrders();
    });

    it('should store proposals after scanning', () => {
      const proposals = service.getProposals();
      expect(proposals.length).toBe(1);
    });

    it('should get pending proposals', () => {
      const pending = service.getPendingProposals();
      expect(pending.length).toBe(1);
      expect(pending[0].status).toBe('proposed');
    });

    it('should retrieve proposal by ID', () => {
      const pending = service.getPendingProposals();
      const proposal = service.getProposal(pending[0].id);
      expect(proposal).not.toBeNull();
      expect(proposal?.orderId).toBe('order-1');
    });

    it('should return null for non-existent proposal', () => {
      const proposal = service.getProposal('non-existent');
      expect(proposal).toBeNull();
    });
  });

  describe('approveProposal', () => {
    beforeEach(async () => {
      const orders = [createMockOrder({ id: 'order-1', limitPrice: 150 })];
      vi.mocked(adapter.getOpenOrders).mockResolvedValue(orders);
      await service.scanOpenOrders();
    });

    it('should approve a proposed proposal', async () => {
      const pending = service.getPendingProposals();
      const approved = await service.approveProposal(pending[0].id);

      expect(approved).not.toBeNull();
      expect(approved?.status).toBe('approved');
      expect(approved?.approvedAt).toBeDefined();
    });

    it('should log approval to audit trail', async () => {
      const pending = service.getPendingProposals();
      await service.approveProposal(pending[0].id);

      expect(auditLogService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'approval',
          actor: 'user',
        })
      );
    });

    it('should return null for non-existent proposal', async () => {
      const result = await service.approveProposal('non-existent');
      expect(result).toBeNull();
    });

    it('should not approve already approved proposal', async () => {
      const pending = service.getPendingProposals();
      await service.approveProposal(pending[0].id);
      const result = await service.approveProposal(pending[0].id);
      expect(result).toBeNull();
    });
  });

  describe('rejectProposal', () => {
    beforeEach(async () => {
      const orders = [createMockOrder({ id: 'order-1', limitPrice: 150 })];
      vi.mocked(adapter.getOpenOrders).mockResolvedValue(orders);
      await service.scanOpenOrders();
    });

    it('should reject a proposed proposal', async () => {
      const pending = service.getPendingProposals();
      const rejected = await service.rejectProposal(pending[0].id, 'Test reason');

      expect(rejected).not.toBeNull();
      expect(rejected?.status).toBe('rejected');
      expect(rejected?.rejectedAt).toBeDefined();
      expect(rejected?.rejectionReason).toBe('Test reason');
    });

    it('should log rejection to audit trail', async () => {
      const pending = service.getPendingProposals();
      await service.rejectProposal(pending[0].id, 'Not interested');

      expect(auditLogService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'rejection',
          actor: 'user',
        })
      );
    });

    it('should reject without reason', async () => {
      const pending = service.getPendingProposals();
      const rejected = await service.rejectProposal(pending[0].id);

      expect(rejected).not.toBeNull();
      expect(rejected?.status).toBe('rejected');
      expect(rejected?.rejectionReason).toBeUndefined();
    });
  });

  describe('executeProposal', () => {
    beforeEach(async () => {
      const orders = [createMockOrder({ id: 'order-1', limitPrice: 150 })];
      vi.mocked(adapter.getOpenOrders).mockResolvedValue(orders);
      vi.mocked(adapter.getOrder).mockResolvedValue(createMockOrder());
      await service.scanOpenOrders();
    });

    it('should execute an approved proposal', async () => {
      const pending = service.getPendingProposals();
      await service.approveProposal(pending[0].id);

      const result = await service.executeProposal(pending[0].id);

      expect(result.success).toBe(true);
      expect(result.newOrderId).toBe('new-order-456');
      expect(adapter.cancelOrder).toHaveBeenCalledWith('order-1');
      expect(adapter.placeOrder).toHaveBeenCalled();
    });

    it('should not execute non-approved proposal', async () => {
      const pending = service.getPendingProposals();
      const result = await service.executeProposal(pending[0].id);

      expect(result.success).toBe(false);
      expect(result.errorMessage).toContain('proposed');
    });

    it('should handle cancel failure', async () => {
      const pending = service.getPendingProposals();
      await service.approveProposal(pending[0].id);
      vi.mocked(adapter.cancelOrder).mockResolvedValue(false);

      const result = await service.executeProposal(pending[0].id);

      expect(result.success).toBe(false);
      expect(result.errorMessage).toContain('cancel');
    });

    it('should log execution to audit trail', async () => {
      const pending = service.getPendingProposals();
      await service.approveProposal(pending[0].id);
      await service.executeProposal(pending[0].id);

      expect(auditLogService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'modification',
          actor: 'system',
        })
      );
    });

    it('should update proposal status on success', async () => {
      const pending = service.getPendingProposals();
      await service.approveProposal(pending[0].id);
      await service.executeProposal(pending[0].id);

      const proposal = service.getProposal(pending[0].id);
      expect(proposal?.status).toBe('executed');
      expect(proposal?.executedAt).toBeDefined();
      expect(proposal?.newOrderId).toBe('new-order-456');
    });

    it('should update proposal status on failure', async () => {
      const pending = service.getPendingProposals();
      await service.approveProposal(pending[0].id);
      vi.mocked(adapter.cancelOrder).mockRejectedValue(new Error('Network error'));

      await service.executeProposal(pending[0].id);

      const proposal = service.getProposal(pending[0].id);
      expect(proposal?.status).toBe('failed');
      expect(proposal?.errorMessage).toContain('Network error');
    });
  });

  describe('config management', () => {
    it('should return current config', () => {
      const config = service.getConfig();
      expect(config.priceDeviationThreshold).toBe(5);
    });

    it('should update config', () => {
      service.updateConfig({ priceDeviationThreshold: 10 });
      const config = service.getConfig();
      expect(config.priceDeviationThreshold).toBe(10);
    });
  });

  describe('statistics', () => {
    beforeEach(async () => {
      const orders = [
        createMockOrder({ id: 'order-1', limitPrice: 150 }),
        createMockOrder({ id: 'order-2', limitPrice: 145 }),
      ];
      vi.mocked(adapter.getOpenOrders).mockResolvedValue(orders);
      await service.scanOpenOrders();
    });

    it('should return correct statistics', () => {
      const stats = service.getStatistics();
      expect(stats.total).toBe(2);
      expect(stats.proposed).toBe(2);
      expect(stats.approved).toBe(0);
      expect(stats.rejected).toBe(0);
    });

    it('should update statistics after approval', async () => {
      const pending = service.getPendingProposals();
      await service.approveProposal(pending[0].id);

      const stats = service.getStatistics();
      expect(stats.proposed).toBe(1);
      expect(stats.approved).toBe(1);
    });
  });

  describe('clearProposals', () => {
    beforeEach(async () => {
      const orders = [createMockOrder({ id: 'order-1', limitPrice: 150 })];
      vi.mocked(adapter.getOpenOrders).mockResolvedValue(orders);
      await service.scanOpenOrders();
    });

    it('should clear all proposals', () => {
      expect(service.getProposals().length).toBe(1);
      service.clearProposals();
      expect(service.getProposals().length).toBe(0);
    });
  });
});

describe('createOrderRepricingService', () => {
  it('should create service with default config', () => {
    const adapter = createMockAdapter();
    const marketDataService = createMockMarketDataService();
    const service = createOrderRepricingService(
      adapter,
      marketDataService,
      'test-account'
    );
    expect(service).toBeInstanceOf(OrderRepricingService);
  });

  it('should create service with custom config', () => {
    const adapter = createMockAdapter();
    const marketDataService = createMockMarketDataService();
    const service = createOrderRepricingService(
      adapter,
      marketDataService,
      'test-account',
      { repricingConfig: { priceDeviationThreshold: 10 } }
    );
    expect(service.getConfig().priceDeviationThreshold).toBe(10);
  });
});

describe('evaluateOrderForRepricing', () => {
  it('should evaluate order without service', () => {
    const order = createMockOrder({ limitPrice: 150 });
    const quote = createMockQuote();
    const proposal = evaluateOrderForRepricing(order, quote);

    expect(proposal).not.toBeNull();
    expect(proposal?.symbol).toBe('AAPL');
    expect(proposal?.status).toBe('proposed');
  });

  it('should return null for non-qualifying order', () => {
    const order = createMockOrder({ limitPrice: 159.5 }); // Within threshold
    const quote = createMockQuote();
    const proposal = evaluateOrderForRepricing(order, quote);

    expect(proposal).toBeNull();
  });

  it('should use custom config', () => {
    const order = createMockOrder({ limitPrice: 159.5 }); // Would be within default threshold
    const quote = createMockQuote();
    const proposal = evaluateOrderForRepricing(
      order,
      quote,
      { ...DEFAULT_REPRICING_CONFIG, priceDeviationThreshold: 0.1 } // Very low threshold
    );

    expect(proposal).not.toBeNull();
  });
});
