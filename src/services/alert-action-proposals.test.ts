/**
 * Tests for Alert Action Proposals Service
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  AlertActionProposalsService,
  createAlertActionProposalsService,
  generateAlertProposal,
  type AlertActionProposalsConfig,
  type AlertProposalResult,
  type AlertWithProposals,
} from './alert-action-proposals.js';
import type { BrokerAdapter, Position, Quote, OptionChain } from '../types/broker.js';
import type { MarketDataService } from './market-data.js';
import type { TradeProposalService } from './trade-proposal.js';
import type { AuditLogService } from './audit-log.js';
import type {
  AlertEvent,
  AlertRecommendedAction,
  AlertContext,
} from '../types/alerts.js';
import type { StoredTradeProposal, TradeProposal } from '../types/trade-proposal.js';

// ============================================================================
// Mock Factories
// ============================================================================

function createMockBrokerAdapter(
  positions: Position[] = [],
  quotes: Record<string, Quote> = {}
): BrokerAdapter {
  return {
    getPositions: vi.fn().mockResolvedValue(positions),
    getQuote: vi.fn().mockImplementation((symbol: string) =>
      quotes[symbol] ?? {
        symbol,
        bid: 1.0,
        ask: 1.1,
        mid: 1.05,
        last: 1.05,
        volume: 1000,
      }
    ),
    getOptionChain: vi.fn().mockResolvedValue({
      underlying: 'AAPL',
      underlyingPrice: 150,
      expirations: [
        {
          expiration: '2026-03-21',
          daysToExpiration: 30,
          calls: [
            {
              symbol: 'AAPL260321C00155000',
              strike: 155,
              expiration: '2026-03-21',
              bid: 2.5,
              ask: 2.7,
              volume: 100,
              openInterest: 500,
            },
            {
              symbol: 'AAPL260321C00160000',
              strike: 160,
              expiration: '2026-03-21',
              bid: 1.5,
              ask: 1.7,
              volume: 200,
              openInterest: 600,
            },
          ],
          puts: [
            {
              symbol: 'AAPL260321P00145000',
              strike: 145,
              expiration: '2026-03-21',
              bid: 2.0,
              ask: 2.2,
              volume: 150,
              openInterest: 400,
            },
            {
              symbol: 'AAPL260321P00140000',
              strike: 140,
              expiration: '2026-03-21',
              bid: 1.2,
              ask: 1.4,
              volume: 250,
              openInterest: 700,
            },
          ],
        },
      ],
    } as OptionChain),
    getAccountSummary: vi.fn().mockResolvedValue({
      netLiquidation: 100000,
      buyingPower: 50000,
      cash: 20000,
      dailyPnL: -500,
      unrealizedPnL: -1000,
    }),
    getOpenOrders: vi.fn().mockResolvedValue([]),
    getOrder: vi.fn().mockResolvedValue(null),
    placeOrder: vi.fn().mockResolvedValue({ orderId: 'ORDER-123', status: 'pending' }),
    cancelOrder: vi.fn().mockResolvedValue(true),
    validateConnection: vi.fn().mockResolvedValue(true),
    disconnect: vi.fn().mockResolvedValue(undefined),
  } as unknown as BrokerAdapter;
}

function createMockMarketDataService(
  quotes: Record<string, Quote> = {},
  optionChain?: OptionChain
): MarketDataService {
  return {
    getQuote: vi.fn().mockImplementation((symbol: string) =>
      Promise.resolve(
        quotes[symbol] ?? {
          symbol,
          bid: 1.0,
          ask: 1.1,
          mid: 1.05,
          last: 1.05,
          volume: 1000,
        }
      )
    ),
    getOptionChain: vi.fn().mockResolvedValue(
      optionChain ?? {
        underlying: 'AAPL',
        underlyingPrice: 150,
        expirations: [
          {
            expiration: '2026-03-21',
            daysToExpiration: 30,
            calls: [
              {
                symbol: 'AAPL260321C00155000',
                strike: 155,
                expiration: '2026-03-21',
                bid: 2.5,
                ask: 2.7,
                volume: 100,
                openInterest: 500,
              },
            ],
            puts: [
              {
                symbol: 'AAPL260321P00145000',
                strike: 145,
                expiration: '2026-03-21',
                bid: 2.0,
                ask: 2.2,
                volume: 150,
                openInterest: 400,
              },
            ],
          },
        ],
      }
    ),
    invalidateCache: vi.fn(),
    getCacheStats: vi.fn().mockReturnValue({ hits: 0, misses: 0, entries: 0, hitRate: 0 }),
  } as unknown as MarketDataService;
}

function createMockTradeProposalService(): TradeProposalService {
  let proposalId = 0;
  return {
    createProposal: vi.fn().mockImplementation(
      (accountId: string, proposal: TradeProposal, options?: { createdBy?: string; notes?: string }) => {
        proposalId++;
        const stored: StoredTradeProposal = {
          id: `PROPOSAL-${proposalId}`,
          accountId,
          proposal,
          status: 'draft',
          createdAt: new Date(),
          updatedAt: new Date(),
          createdBy: options?.createdBy,
          notes: options?.notes,
        };
        return Promise.resolve(stored);
      }
    ),
    getProposal: vi.fn().mockReturnValue(null),
    getAllProposals: vi.fn().mockReturnValue([]),
    updateProposal: vi.fn(),
    updateStatus: vi.fn(),
    approveProposal: vi.fn(),
    rejectProposal: vi.fn(),
    markExecuted: vi.fn(),
    deleteProposal: vi.fn(),
    initialize: vi.fn().mockResolvedValue(undefined),
  } as unknown as TradeProposalService;
}

function createMockAuditLogService(): AuditLogService {
  return {
    log: vi.fn(),
    query: vi.fn().mockResolvedValue([]),
    getEntry: vi.fn().mockReturnValue(null),
    initialize: vi.fn().mockResolvedValue(undefined),
  } as unknown as AuditLogService;
}

function createMockPosition(overrides: Partial<Position> = {}): Position {
  return {
    id: 'POS-1',
    symbol: 'AAPL260321C00150000',
    quantity: 5,
    averageCost: 3.0,
    currentPrice: 3.5,
    marketValue: 1750,
    unrealizedPnL: 250,
    unrealizedPnLPercent: 16.67,
    assetClass: 'option',
    optionDetails: {
      underlying: 'AAPL',
      strike: 150,
      expiration: '2026-03-21',
      optionType: 'call',
      multiplier: 100,
    },
    greeks: {
      delta: 0.6,
      gamma: 0.05,
      theta: -0.02,
      vega: 0.1,
    },
    ...overrides,
  };
}

function createMockAlert(overrides: Partial<AlertEvent> = {}): AlertEvent {
  return {
    id: 'ALERT-1',
    accountId: 'TEST-ACCOUNT',
    triggerId: 'TRIGGER-1',
    triggerName: 'Test Trigger',
    triggerType: 'premium_target',
    severity: 'warning',
    status: 'active',
    title: 'AAPL +50% P&L',
    message: 'AAPL option position has reached +50% profit',
    context: {
      position: {
        symbol: 'AAPL260321C00150000',
        quantity: 5,
        avgCost: 3.0,
        currentValue: 1750,
        unrealizedPnL: 250,
        unrealizedPnLPercent: 50,
      },
    },
    recommendedActions: [
      {
        action: 'trim',
        rationale: 'Take partial profits at +50%',
        priority: 'medium',
        symbols: ['AAPL260321C00150000'],
      },
    ],
    triggeredAt: new Date(),
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('AlertActionProposalsService', () => {
  let service: AlertActionProposalsService;
  let mockAdapter: BrokerAdapter;
  let mockMarketData: MarketDataService;
  let mockProposalService: TradeProposalService;
  let mockAuditService: AuditLogService;

  beforeEach(() => {
    const position = createMockPosition();
    mockAdapter = createMockBrokerAdapter([position], {
      'AAPL260321C00150000': {
        symbol: 'AAPL260321C00150000',
        bid: 3.4,
        ask: 3.6,
        mid: 3.5,
        last: 3.5,
        volume: 500,
      },
      AAPL: {
        symbol: 'AAPL',
        bid: 149.5,
        ask: 150.5,
        mid: 150,
        last: 150,
        volume: 1000000,
      },
    });
    mockMarketData = createMockMarketDataService({
      'AAPL260321C00150000': {
        symbol: 'AAPL260321C00150000',
        bid: 3.4,
        ask: 3.6,
        mid: 3.5,
        last: 3.5,
        volume: 500,
      },
      AAPL: {
        symbol: 'AAPL',
        bid: 149.5,
        ask: 150.5,
        mid: 150,
        last: 150,
        volume: 1000000,
      },
    });
    mockProposalService = createMockTradeProposalService();
    mockAuditService = createMockAuditLogService();

    service = new AlertActionProposalsService(
      mockAdapter,
      mockMarketData,
      mockProposalService,
      'TEST-ACCOUNT',
      {},
      mockAuditService
    );
  });

  describe('constructor', () => {
    it('should create service with default config', () => {
      expect(service).toBeDefined();
    });

    it('should accept custom config', () => {
      const config: AlertActionProposalsConfig = {
        defaultExitPercent: 75,
        defaultTrimPercent: 25,
        defaultTimeInForce: 'gtc',
        defaultOrderType: 'market',
        slippagePercent: 2,
      };

      const customService = new AlertActionProposalsService(
        mockAdapter,
        mockMarketData,
        mockProposalService,
        'TEST-ACCOUNT',
        config
      );

      expect(customService).toBeDefined();
    });
  });

  describe('generateProposalsForAlert', () => {
    it('should generate proposals for trim action', async () => {
      const alert = createMockAlert();
      const result = await service.generateProposalsForAlert(alert);

      expect(result.alert).toBe(alert);
      expect(result.correlationId).toBeDefined();
      expect(result.proposals.length).toBeGreaterThan(0);
    });

    it('should skip non-actionable recommendations', async () => {
      const alert = createMockAlert({
        recommendedActions: [
          {
            action: 'hold',
            rationale: 'Keep position',
            priority: 'low',
            symbols: [],
          },
          {
            action: 'monitor',
            rationale: 'Watch closely',
            priority: 'low',
            symbols: [],
          },
        ],
      });

      const result = await service.generateProposalsForAlert(alert);

      expect(result.proposals.length).toBe(0);
    });

    it('should generate proposals for exit action', async () => {
      const alert = createMockAlert({
        recommendedActions: [
          {
            action: 'exit',
            rationale: 'Close position to limit losses',
            priority: 'high',
            symbols: ['AAPL260321C00150000'],
          },
        ],
      });

      const result = await service.generateProposalsForAlert(alert);

      expect(result.proposals.length).toBe(1);
      const proposal = result.proposals[0]!;
      expect(proposal.success).toBe(true);
      expect(proposal.action.action).toBe('exit');
    });

    it('should generate proposals for hedge action', async () => {
      const alert = createMockAlert({
        triggerType: 'portfolio_drawdown',
        recommendedActions: [
          {
            action: 'hedge',
            rationale: 'Add protective puts',
            priority: 'high',
            symbols: ['AAPL'],
          },
        ],
      });

      const result = await service.generateProposalsForAlert(alert);

      expect(result.proposals.length).toBe(1);
      const proposal = result.proposals[0]!;
      expect(proposal.action.action).toBe('hedge');
    });

    it('should log to audit service', async () => {
      const alert = createMockAlert();
      await service.generateProposalsForAlert(alert);

      expect(mockAuditService.log).toHaveBeenCalled();
    });

    it('should store alert-proposal associations', async () => {
      const alert = createMockAlert();
      await service.generateProposalsForAlert(alert);

      const stored = service.getProposalsForAlert(alert.id);
      expect(stored).toBeDefined();
      expect(stored?.alert.id).toBe(alert.id);
    });
  });

  describe('generateProposalForAction', () => {
    it('should generate proposal for exit action', async () => {
      const alert = createMockAlert();
      const action: AlertRecommendedAction = {
        action: 'exit',
        rationale: 'Close position',
        priority: 'high',
        symbols: ['AAPL260321C00150000'],
      };

      const result = await service.generateProposalForAction(
        alert,
        action,
        'CORR-123'
      );

      expect(result.success).toBe(true);
      expect(result.proposal).toBeDefined();
      expect(result.proposal?.proposal.contracts.length).toBeGreaterThan(0);
    });

    it('should return error if no positions found', async () => {
      // Create adapter with no positions
      const emptyAdapter = createMockBrokerAdapter([]);
      const emptyService = new AlertActionProposalsService(
        emptyAdapter,
        mockMarketData,
        mockProposalService,
        'TEST-ACCOUNT'
      );

      const alert = createMockAlert();
      const action: AlertRecommendedAction = {
        action: 'exit',
        rationale: 'Close position',
        priority: 'high',
        symbols: ['UNKNOWN'],
      };

      const result = await emptyService.generateProposalForAction(
        alert,
        action,
        'CORR-123'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('No positions found');
    });

    it('should use custom close percent', async () => {
      const alert = createMockAlert();
      const action: AlertRecommendedAction = {
        action: 'trim',
        rationale: 'Take partial profits',
        priority: 'medium',
        symbols: ['AAPL260321C00150000'],
      };

      const result = await service.generateProposalForAction(
        alert,
        action,
        'CORR-123',
        { closePercent: 25 }
      );

      expect(result.success).toBe(true);
    });

    it('should use custom order type', async () => {
      const alert = createMockAlert();
      const action: AlertRecommendedAction = {
        action: 'exit',
        rationale: 'Exit now',
        priority: 'high',
        symbols: ['AAPL260321C00150000'],
      };

      const result = await service.generateProposalForAction(
        alert,
        action,
        'CORR-123',
        { orderType: 'market' }
      );

      expect(result.success).toBe(true);
      expect(result.proposal?.proposal.entryPlan.orderType).toBe('market');
    });
  });

  describe('getProposalsForAlert', () => {
    it('should return undefined for unknown alert', () => {
      const result = service.getProposalsForAlert('UNKNOWN-ID');
      expect(result).toBeUndefined();
    });

    it('should return stored proposals after generation', async () => {
      const alert = createMockAlert();
      await service.generateProposalsForAlert(alert);

      const result = service.getProposalsForAlert(alert.id);
      expect(result).toBeDefined();
      expect(result?.alert.id).toBe(alert.id);
    });
  });

  describe('getAllAlertProposals', () => {
    it('should return empty array initially', () => {
      const result = service.getAllAlertProposals();
      expect(result).toEqual([]);
    });

    it('should return all generated proposals', async () => {
      const alert1 = createMockAlert({ id: 'ALERT-1' });
      const alert2 = createMockAlert({ id: 'ALERT-2' });

      await service.generateProposalsForAlert(alert1);
      await service.generateProposalsForAlert(alert2);

      const result = service.getAllAlertProposals();
      expect(result.length).toBe(2);
    });
  });

  describe('clearProposalsForAlert', () => {
    it('should return false for unknown alert', () => {
      const result = service.clearProposalsForAlert('UNKNOWN-ID');
      expect(result).toBe(false);
    });

    it('should clear proposals and return true', async () => {
      const alert = createMockAlert();
      await service.generateProposalsForAlert(alert);

      expect(service.getProposalsForAlert(alert.id)).toBeDefined();

      const result = service.clearProposalsForAlert(alert.id);
      expect(result).toBe(true);
      expect(service.getProposalsForAlert(alert.id)).toBeUndefined();
    });
  });

  describe('proposal content', () => {
    it('should include alert info in thesis', async () => {
      const alert = createMockAlert({
        title: 'AAPL Critical Move',
        message: 'AAPL moved 15% in one day',
      });

      const result = await service.generateProposalsForAlert(alert);
      const proposal = result.proposals[0]?.proposal;

      // Check that at least one thesis item contains the alert title
      expect(proposal?.proposal.thesis.some((t: string) => t.includes('AAPL Critical Move'))).toBe(true);
    });

    it('should include action rationale in thesis', async () => {
      const alert = createMockAlert({
        recommendedActions: [
          {
            action: 'exit',
            rationale: 'Lock in 50% gains',
            priority: 'medium',
            symbols: ['AAPL260321C00150000'],
          },
        ],
      });

      const result = await service.generateProposalsForAlert(alert);
      const proposal = result.proposals[0]?.proposal;

      // Check that at least one thesis item contains the action rationale
      expect(proposal?.proposal.thesis.some((t: string) => t.includes('Lock in 50% gains'))).toBe(true);
    });

    it('should tag proposal as alert-driven', async () => {
      const alert = createMockAlert();
      const result = await service.generateProposalsForAlert(alert);
      const storedProposal = result.proposals[0]?.proposal;

      expect(storedProposal?.createdBy).toContain(`alert:${alert.id}`);
    });

    it('should include data sources from alert', async () => {
      const alert = createMockAlert();
      const result = await service.generateProposalsForAlert(alert);
      const proposal = result.proposals[0]?.proposal;

      expect(proposal?.proposal.dataUsed.length).toBeGreaterThan(0);
      expect(proposal?.proposal.dataUsed[0]?.reference).toContain(`alert:${alert.id}`);
    });

    it('should map severity to confidence', async () => {
      const criticalAlert = createMockAlert({ severity: 'critical' });
      const warningAlert = createMockAlert({ severity: 'warning', id: 'ALERT-2' });
      const infoAlert = createMockAlert({ severity: 'info', id: 'ALERT-3' });

      const criticalResult = await service.generateProposalsForAlert(criticalAlert);
      const warningResult = await service.generateProposalsForAlert(warningAlert);
      const infoResult = await service.generateProposalsForAlert(infoAlert);

      expect(criticalResult.proposals[0]?.proposal?.proposal.confidence).toBe('high');
      expect(warningResult.proposals[0]?.proposal?.proposal.confidence).toBe('medium');
      expect(infoResult.proposals[0]?.proposal?.proposal.confidence).toBe('low');
    });
  });

  describe('position matching', () => {
    it('should match positions by positionId', async () => {
      const alert = createMockAlert({
        recommendedActions: [
          {
            action: 'exit',
            rationale: 'Exit position',
            priority: 'high',
            symbols: [],
            positionIds: ['POS-1'],
          },
        ],
      });

      const result = await service.generateProposalsForAlert(alert);
      expect(result.proposals[0]?.success).toBe(true);
    });

    it('should match positions by symbol', async () => {
      const alert = createMockAlert({
        recommendedActions: [
          {
            action: 'exit',
            rationale: 'Exit position',
            priority: 'high',
            symbols: ['AAPL260321C00150000'],
          },
        ],
      });

      const result = await service.generateProposalsForAlert(alert);
      expect(result.proposals[0]?.success).toBe(true);
    });

    it('should match positions by underlying', async () => {
      const alert = createMockAlert({
        recommendedActions: [
          {
            action: 'exit',
            rationale: 'Exit all AAPL positions',
            priority: 'high',
            symbols: ['AAPL'],
          },
        ],
      });

      const result = await service.generateProposalsForAlert(alert);
      expect(result.proposals[0]?.success).toBe(true);
    });
  });

  describe('portfolio drawdown alerts', () => {
    it('should handle portfolio-wide exit', async () => {
      const alert = createMockAlert({
        triggerType: 'portfolio_drawdown',
        context: {
          portfolio: {
            totalValue: 100000,
            dailyPnL: -5000,
            dailyPnLPercent: -5,
            unrealizedPnL: -8000,
            unrealizedPnLPercent: -8,
          },
        },
        recommendedActions: [
          {
            action: 'trim',
            rationale: 'Reduce exposure due to drawdown',
            priority: 'high',
            symbols: [],
          },
        ],
      });

      const result = await service.generateProposalsForAlert(alert);
      expect(result.proposals.length).toBe(1);
    });
  });
});

describe('createAlertActionProposalsService', () => {
  it('should create service instance', () => {
    const adapter = createMockBrokerAdapter();
    const marketData = createMockMarketDataService();
    const proposalService = createMockTradeProposalService();

    const service = createAlertActionProposalsService(
      adapter,
      marketData,
      proposalService,
      'TEST-ACCOUNT'
    );

    expect(service).toBeInstanceOf(AlertActionProposalsService);
  });

  it('should accept optional config and audit service', () => {
    const adapter = createMockBrokerAdapter();
    const marketData = createMockMarketDataService();
    const proposalService = createMockTradeProposalService();
    const auditService = createMockAuditLogService();

    const service = createAlertActionProposalsService(
      adapter,
      marketData,
      proposalService,
      'TEST-ACCOUNT',
      { defaultExitPercent: 80 },
      auditService
    );

    expect(service).toBeInstanceOf(AlertActionProposalsService);
  });
});

describe('generateAlertProposal', () => {
  it('should generate single proposal', async () => {
    const adapter = createMockBrokerAdapter([createMockPosition()]);
    const marketData = createMockMarketDataService({
      'AAPL260321C00150000': {
        symbol: 'AAPL260321C00150000',
        bid: 3.4,
        ask: 3.6,
        mid: 3.5,
        last: 3.5,
        volume: 500,
      },
    });
    const proposalService = createMockTradeProposalService();

    const alert = createMockAlert();
    const action: AlertRecommendedAction = {
      action: 'exit',
      rationale: 'Close position',
      priority: 'high',
      symbols: ['AAPL260321C00150000'],
    };

    const result = await generateAlertProposal(
      alert,
      action,
      adapter,
      marketData,
      proposalService,
      'TEST-ACCOUNT'
    );

    expect(result.success).toBe(true);
    expect(result.alertId).toBe(alert.id);
    expect(result.action).toBe(action);
  });
});
