/**
 * Tests for Alert Monitoring Service
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  AlertMonitorService,
  createAlertMonitorService,
  type AlertMonitorConfig,
} from './alert-monitor.js';
import type { BrokerAdapter, AccountSummary, Position, Quote } from '../types/broker.js';
import type { MarketDataService } from './market-data.js';
import {
  type AlertTriggerConfig,
  type UnderlyingMoveConfig,
  type PremiumTargetConfig,
  type BidAskWideningConfig,
  type PortfolioDrawdownConfig,
  type EarningsApproachingConfig,
  DEFAULT_ALERT_PREFERENCES,
} from '../types/alerts.js';

// Mock dependencies
function createMockAdapter(): BrokerAdapter {
  return {
    getAccountSummary: vi.fn(),
    getPositions: vi.fn(),
    getOpenOrders: vi.fn(),
    getOrder: vi.fn(),
    placeOrder: vi.fn(),
    cancelOrder: vi.fn(),
    getQuote: vi.fn(),
    getOptionChain: vi.fn(),
    validateConnection: vi.fn(),
    disconnect: vi.fn(),
  };
}

function createMockMarketDataService(): MarketDataService {
  return {
    getQuote: vi.fn(),
    getOptionChain: vi.fn(),
    getHistoricalBars: vi.fn(),
    clearCache: vi.fn(),
    clearSymbolCache: vi.fn(),
    getCacheStats: vi.fn(),
    setQuoteCacheTTL: vi.fn(),
    setChainCacheTTL: vi.fn(),
  } as unknown as MarketDataService;
}

function createMockAccountSummary(overrides?: Partial<AccountSummary>): AccountSummary {
  return {
    netLiquidation: 100000,
    buyingPower: 50000,
    cash: 25000,
    dailyPnL: -500,
    unrealizedPnL: -2000,
    currency: 'USD',
    asOf: new Date(),
    ...overrides,
  };
}

function createMockPosition(overrides?: Partial<Position>): Position {
  return {
    id: 'pos-1',
    symbol: 'AAPL',
    quantity: 10,
    averageCost: 150,
    currentPrice: 160,
    marketValue: 1600,
    unrealizedPnL: 100,
    unrealizedPnLPercent: 6.67,
    assetClass: 'option',
    ...overrides,
  };
}

function createMockQuote(overrides?: Partial<Quote>): Quote {
  return {
    symbol: 'AAPL',
    bid: 149.5,
    ask: 150.5,
    mid: 150,
    last: 150,
    volume: 1000000,
    asOf: new Date(),
    ...overrides,
  };
}

describe('AlertMonitorService', () => {
  let adapter: BrokerAdapter;
  let marketDataService: MarketDataService;
  let service: AlertMonitorService;

  beforeEach(() => {
    adapter = createMockAdapter();
    marketDataService = createMockMarketDataService();
    vi.mocked(adapter.getAccountSummary).mockResolvedValue(createMockAccountSummary());
    vi.mocked(adapter.getPositions).mockResolvedValue([createMockPosition()]);
    vi.mocked(marketDataService.getQuote).mockResolvedValue(createMockQuote());

    service = createAlertMonitorService(adapter, marketDataService, 'test-account');
  });

  describe('initialization', () => {
    it('creates service with default config', () => {
      expect(service).toBeInstanceOf(AlertMonitorService);
      expect(service.isPollingActive()).toBe(false);
    });

    it('creates service with custom config', () => {
      const config: AlertMonitorConfig = {
        pollingIntervalMs: 30000,
        maxAlerts: 50,
        maxTriggers: 25,
      };
      const customService = createAlertMonitorService(
        adapter,
        marketDataService,
        'test-account',
        config
      );
      expect(customService).toBeInstanceOf(AlertMonitorService);
    });
  });

  describe('trigger management', () => {
    it('creates a trigger', () => {
      const config: UnderlyingMoveConfig = {
        type: 'underlying_move',
        symbol: 'AAPL',
        movePercent: 5,
        direction: 'both',
        timeWindowMinutes: 1440,
      };

      const trigger = service.createTrigger('AAPL Price Alert', 'Alert on 5% move', config);

      expect(trigger.id).toBeDefined();
      expect(trigger.name).toBe('AAPL Price Alert');
      expect(trigger.description).toBe('Alert on 5% move');
      expect(trigger.enabled).toBe(true);
      expect(trigger.config).toEqual(config);
      expect(trigger.fireCount).toBe(0);
    });

    it('gets a trigger by ID', () => {
      const config: UnderlyingMoveConfig = {
        type: 'underlying_move',
        symbol: 'AAPL',
        movePercent: 5,
        direction: 'both',
        timeWindowMinutes: 1440,
      };

      const created = service.createTrigger('Test', 'Test', config);
      const retrieved = service.getTrigger(created.id);

      expect(retrieved).toEqual(created);
    });

    it('returns undefined for non-existent trigger', () => {
      const trigger = service.getTrigger('non-existent');
      expect(trigger).toBeUndefined();
    });

    it('gets all triggers', () => {
      const config1: UnderlyingMoveConfig = {
        type: 'underlying_move',
        symbol: 'AAPL',
        movePercent: 5,
        direction: 'both',
        timeWindowMinutes: 1440,
      };
      const config2: PremiumTargetConfig = {
        type: 'premium_target',
        symbol: 'AAPL',
        targetProfitPercent: 50,
      };

      service.createTrigger('Trigger 1', 'Desc 1', config1);
      service.createTrigger('Trigger 2', 'Desc 2', config2);

      const triggers = service.getAllTriggers();
      expect(triggers).toHaveLength(2);
    });

    it('gets triggers by type', () => {
      const moveConfig: UnderlyingMoveConfig = {
        type: 'underlying_move',
        symbol: 'AAPL',
        movePercent: 5,
        direction: 'both',
        timeWindowMinutes: 1440,
      };
      const premiumConfig: PremiumTargetConfig = {
        type: 'premium_target',
        symbol: 'AAPL',
        targetProfitPercent: 50,
      };

      service.createTrigger('Move Alert', 'Move', moveConfig);
      service.createTrigger('Premium Alert', 'Premium', premiumConfig);

      const moveTriggers = service.getTriggersByType('underlying_move');
      expect(moveTriggers).toHaveLength(1);
      expect(moveTriggers[0].name).toBe('Move Alert');
    });

    it('updates a trigger', () => {
      const config: UnderlyingMoveConfig = {
        type: 'underlying_move',
        symbol: 'AAPL',
        movePercent: 5,
        direction: 'both',
        timeWindowMinutes: 1440,
      };

      const trigger = service.createTrigger('Original', 'Desc', config);
      const updated = service.updateTrigger(trigger.id, { name: 'Updated' });

      expect(updated.name).toBe('Updated');
      expect(updated.description).toBe('Desc');
    });

    it('throws when updating non-existent trigger', () => {
      expect(() => service.updateTrigger('non-existent', { name: 'New' })).toThrow(
        'Trigger not found'
      );
    });

    it('enables and disables a trigger', () => {
      const config: UnderlyingMoveConfig = {
        type: 'underlying_move',
        symbol: 'AAPL',
        movePercent: 5,
        direction: 'both',
        timeWindowMinutes: 1440,
      };

      const trigger = service.createTrigger('Test', 'Test', config);
      expect(trigger.enabled).toBe(true);

      const disabled = service.disableTrigger(trigger.id);
      expect(disabled.enabled).toBe(false);

      const enabled = service.enableTrigger(trigger.id);
      expect(enabled.enabled).toBe(true);
    });

    it('deletes a trigger', () => {
      const config: UnderlyingMoveConfig = {
        type: 'underlying_move',
        symbol: 'AAPL',
        movePercent: 5,
        direction: 'both',
        timeWindowMinutes: 1440,
      };

      const trigger = service.createTrigger('Test', 'Test', config);
      const deleted = service.deleteTrigger(trigger.id);

      expect(deleted).toBe(true);
      expect(service.getTrigger(trigger.id)).toBeUndefined();
    });

    it('returns false when deleting non-existent trigger', () => {
      const deleted = service.deleteTrigger('non-existent');
      expect(deleted).toBe(false);
    });

    it('validates trigger config on create', () => {
      const invalidConfig = {
        type: 'premium_target',
        targetProfitPercent: 50,
        // Missing both positionId and symbol
      } as PremiumTargetConfig;

      expect(() => service.createTrigger('Invalid', 'Invalid', invalidConfig)).toThrow(
        'Invalid trigger config'
      );
    });

    it('enforces max triggers limit', () => {
      const smallService = createAlertMonitorService(
        adapter,
        marketDataService,
        'test-account',
        { maxTriggers: 2 }
      );

      const config: UnderlyingMoveConfig = {
        type: 'underlying_move',
        symbol: 'AAPL',
        movePercent: 5,
        direction: 'both',
        timeWindowMinutes: 1440,
      };

      smallService.createTrigger('Trigger 1', 'Desc', config);
      smallService.createTrigger('Trigger 2', 'Desc', config);

      expect(() => smallService.createTrigger('Trigger 3', 'Desc', config)).toThrow(
        'Maximum triggers limit'
      );
    });
  });

  describe('alert scanning', () => {
    it('scans with no triggers', async () => {
      const result = await service.scan();

      expect(result.triggersEvaluated).toBe(0);
      expect(result.alertsGenerated).toBe(0);
      expect(result.alerts).toHaveLength(0);
    });

    it('skips disabled triggers', async () => {
      const config: UnderlyingMoveConfig = {
        type: 'underlying_move',
        symbol: 'AAPL',
        movePercent: 5,
        direction: 'both',
        timeWindowMinutes: 1440,
      };

      const trigger = service.createTrigger('Test', 'Test', config);
      service.disableTrigger(trigger.id);

      const result = await service.scan();

      expect(result.triggersEvaluated).toBe(0);
    });

    it('generates alert for underlying move', async () => {
      const config: UnderlyingMoveConfig = {
        type: 'underlying_move',
        symbol: 'AAPL',
        movePercent: 5,
        direction: 'both',
        timeWindowMinutes: 1440,
      };

      service.createTrigger('AAPL Move', 'Alert on move', config);

      // Simulate price history with a large move
      // First scan to establish baseline
      vi.mocked(marketDataService.getQuote).mockResolvedValueOnce(
        createMockQuote({ last: 100, mid: 100, bid: 99.5, ask: 100.5 })
      );
      await service.scan();

      // Second scan with price move
      vi.mocked(marketDataService.getQuote).mockResolvedValueOnce(
        createMockQuote({ last: 110, mid: 110, bid: 109.5, ask: 110.5 })
      );
      const result = await service.scan();

      expect(result.alertsGenerated).toBe(1);
      expect(result.alerts[0].triggerType).toBe('underlying_move');
      expect(result.alerts[0].severity).toBeDefined();
    });

    it('generates alert for premium target hit', async () => {
      const config: PremiumTargetConfig = {
        type: 'premium_target',
        symbol: 'AAPL',
        targetProfitPercent: 5, // Low target to trigger
      };

      service.createTrigger('AAPL Premium', 'Alert on profit', config);

      // Mock position with profit
      vi.mocked(adapter.getPositions).mockResolvedValue([
        createMockPosition({
          symbol: 'AAPL',
          averageCost: 100,
          currentPrice: 110, // 10% gain
          unrealizedPnL: 100,
          unrealizedPnLPercent: 10,
        }),
      ]);

      const result = await service.scan();

      expect(result.alertsGenerated).toBe(1);
      expect(result.alerts[0].triggerType).toBe('premium_target');
    });

    it('generates alert for portfolio drawdown', async () => {
      const config: PortfolioDrawdownConfig = {
        type: 'portfolio_drawdown',
        maxDailyLossPercent: 0.1, // Very low threshold
      };

      service.createTrigger('Drawdown Alert', 'Alert on loss', config);

      // Mock account with loss
      vi.mocked(adapter.getAccountSummary).mockResolvedValue(
        createMockAccountSummary({
          netLiquidation: 100000,
          dailyPnL: -500, // -0.5% which exceeds 0.1%
        })
      );

      const result = await service.scan();

      expect(result.alertsGenerated).toBe(1);
      expect(result.alerts[0].triggerType).toBe('portfolio_drawdown');
    });

    it('generates alert for bid-ask widening', async () => {
      const config: BidAskWideningConfig = {
        type: 'bid_ask_widening',
        symbol: 'AAPL',
        spreadThresholdPercent: 1, // Low threshold
      };

      service.createTrigger('Spread Alert', 'Alert on spread', config);

      // Mock quote with wide spread
      vi.mocked(marketDataService.getQuote).mockResolvedValue(
        createMockQuote({
          bid: 95,
          ask: 105,
          mid: 100,
          last: 100,
        }) // 10% spread
      );

      const result = await service.scan();

      expect(result.alertsGenerated).toBe(1);
      expect(result.alerts[0].triggerType).toBe('bid_ask_widening');
    });

    it('generates alert for earnings approaching', async () => {
      const config: EarningsApproachingConfig = {
        type: 'earnings_approaching',
        symbol: 'AAPL',
        daysBeforeEarnings: 7,
      };

      service.createTrigger('Earnings Alert', 'Alert on earnings', config);

      // Set mock earnings date 3 days from now
      const earningsDate = new Date();
      earningsDate.setDate(earningsDate.getDate() + 3);
      service.setMockEarningsDate('AAPL', earningsDate);

      const result = await service.scan();

      expect(result.alertsGenerated).toBe(1);
      expect(result.alerts[0].triggerType).toBe('earnings_approaching');
    });

    it('increments trigger fire count on alert', async () => {
      const config: PremiumTargetConfig = {
        type: 'premium_target',
        symbol: 'AAPL',
        targetProfitPercent: 5,
      };

      const trigger = service.createTrigger('Test', 'Test', config);
      expect(trigger.fireCount).toBe(0);

      vi.mocked(adapter.getPositions).mockResolvedValue([
        createMockPosition({
          symbol: 'AAPL',
          averageCost: 100,
          currentPrice: 110,
        }),
      ]);

      await service.scan();

      const updated = service.getTrigger(trigger.id);
      expect(updated?.fireCount).toBe(1);
      expect(updated?.lastFiredAt).toBeDefined();
    });
  });

  describe('alert management', () => {
    beforeEach(async () => {
      // Create a trigger that will fire
      const config: PremiumTargetConfig = {
        type: 'premium_target',
        symbol: 'AAPL',
        targetProfitPercent: 5,
      };
      service.createTrigger('Test', 'Test', config);

      vi.mocked(adapter.getPositions).mockResolvedValue([
        createMockPosition({
          symbol: 'AAPL',
          averageCost: 100,
          currentPrice: 110,
        }),
      ]);

      await service.scan();
    });

    it('gets all alerts', () => {
      const alerts = service.getAllAlerts();
      expect(alerts).toHaveLength(1);
    });

    it('gets active alerts', () => {
      const alerts = service.getActiveAlerts();
      expect(alerts).toHaveLength(1);
      expect(alerts[0].status).toBe('active');
    });

    it('acknowledges an alert', () => {
      const alerts = service.getAllAlerts();
      const acknowledged = service.acknowledgeAlert(alerts[0].id);

      expect(acknowledged?.status).toBe('acknowledged');
      expect(acknowledged?.acknowledgedAt).toBeDefined();
    });

    it('dismisses an alert', () => {
      const alerts = service.getAllAlerts();
      const dismissed = service.dismissAlert(alerts[0].id);

      expect(dismissed?.status).toBe('dismissed');
      expect(dismissed?.dismissedAt).toBeDefined();
    });

    it('adds notes to an alert', () => {
      const alerts = service.getAllAlerts();
      const withNotes = service.addNotesToAlert(alerts[0].id, 'My notes');

      expect(withNotes?.userNotes).toBe('My notes');
    });

    it('dismisses all alerts', () => {
      const count = service.dismissAllAlerts();
      expect(count).toBe(1);

      const active = service.getActiveAlerts();
      expect(active).toHaveLength(0);
    });

    it('returns null when operating on non-existent alert', () => {
      expect(service.acknowledgeAlert('non-existent')).toBeNull();
      expect(service.dismissAlert('non-existent')).toBeNull();
      expect(service.addNotesToAlert('non-existent', 'notes')).toBeNull();
    });
  });

  describe('preferences', () => {
    it('gets default preferences', () => {
      const prefs = service.getPreferences();
      expect(prefs.alertsEnabled).toBe(true);
      expect(prefs.minimumSeverity).toBe('info');
    });

    it('updates preferences', () => {
      const updated = service.updatePreferences({
        minimumSeverity: 'warning',
        autoDismissResolved: false,
      });

      expect(updated.minimumSeverity).toBe('warning');
      expect(updated.autoDismissResolved).toBe(false);
    });

    it('does not change accountId via preferences', () => {
      const prefs = service.getPreferences();
      service.updatePreferences({ accountId: 'different-account' } as never);

      expect(service.getPreferences().accountId).toBe('test-account');
    });

    it('does not scan when alerts disabled', async () => {
      service.updatePreferences({ alertsEnabled: false });

      const config: PremiumTargetConfig = {
        type: 'premium_target',
        symbol: 'AAPL',
        targetProfitPercent: 5,
      };
      service.createTrigger('Test', 'Test', config);

      const result = await service.scan();

      expect(result.triggersEvaluated).toBe(0);
    });
  });

  describe('polling', () => {
    it('starts and stops polling', () => {
      expect(service.isPollingActive()).toBe(false);

      service.startPolling();
      expect(service.isPollingActive()).toBe(true);

      service.stopPolling();
      expect(service.isPollingActive()).toBe(false);
    });

    it('does not start polling twice', () => {
      service.startPolling();
      service.startPolling(); // Should not throw or create duplicate intervals

      expect(service.isPollingActive()).toBe(true);
      service.stopPolling();
    });

    it('tracks last scan time', async () => {
      expect(service.getLastScanTime()).toBeUndefined();

      await service.scan();

      expect(service.getLastScanTime()).toBeInstanceOf(Date);
    });
  });

  describe('statistics', () => {
    it('returns statistics', async () => {
      const config: PremiumTargetConfig = {
        type: 'premium_target',
        symbol: 'AAPL',
        targetProfitPercent: 5,
      };
      service.createTrigger('Test', 'Test', config);
      service.disableTrigger(service.getAllTriggers()[0].id);
      service.createTrigger('Test 2', 'Test', config);

      vi.mocked(adapter.getPositions).mockResolvedValue([
        createMockPosition({
          symbol: 'AAPL',
          averageCost: 100,
          currentPrice: 110,
        }),
      ]);

      await service.scan();

      const stats = service.getStatistics();

      expect(stats.totalTriggers).toBe(2);
      expect(stats.enabledTriggers).toBe(1);
      expect(stats.totalAlerts).toBe(1);
      expect(stats.activeAlerts).toBe(1);
      expect(stats.alertsBySeverity).toBeDefined();
      expect(stats.alertsByType).toBeDefined();
    });
  });

  describe('cleanup', () => {
    it('destroys service and clears data', () => {
      const config: UnderlyingMoveConfig = {
        type: 'underlying_move',
        symbol: 'AAPL',
        movePercent: 5,
        direction: 'both',
        timeWindowMinutes: 1440,
      };
      service.createTrigger('Test', 'Test', config);
      service.startPolling();

      service.destroy();

      expect(service.isPollingActive()).toBe(false);
      expect(service.getAllTriggers()).toHaveLength(0);
      expect(service.getAllAlerts()).toHaveLength(0);
    });
  });
});

describe('Alert Type Helpers', () => {
  describe('determineAlertSeverity', () => {
    it('returns critical for large price moves', async () => {
      const { determineAlertSeverity } = await import('../types/alerts.js');
      const severity = determineAlertSeverity('underlying_move', {
        priceChangePercent: -15,
      });
      expect(severity).toBe('critical');
    });

    it('returns warning for moderate price moves', async () => {
      const { determineAlertSeverity } = await import('../types/alerts.js');
      const severity = determineAlertSeverity('underlying_move', {
        priceChangePercent: 7,
      });
      expect(severity).toBe('warning');
    });

    it('returns info for small price moves', async () => {
      const { determineAlertSeverity } = await import('../types/alerts.js');
      const severity = determineAlertSeverity('underlying_move', {
        priceChangePercent: 3,
      });
      expect(severity).toBe('info');
    });
  });

  describe('generateAlertTitle', () => {
    it('generates title for underlying move', async () => {
      const { generateAlertTitle } = await import('../types/alerts.js');
      const title = generateAlertTitle(
        'underlying_move',
        { type: 'underlying_move', symbol: 'AAPL', movePercent: 5, direction: 'both', timeWindowMinutes: 1440 },
        { priceChangePercent: 5.5 }
      );
      expect(title).toContain('AAPL');
      expect(title).toContain('5.5%');
    });

    it('generates title for premium target', async () => {
      const { generateAlertTitle } = await import('../types/alerts.js');
      const title = generateAlertTitle(
        'premium_target',
        { type: 'premium_target', symbol: 'AAPL', targetProfitPercent: 50 },
        { position: { symbol: 'AAPL', quantity: 10, avgCost: 100, currentValue: 1500, unrealizedPnL: 500, unrealizedPnLPercent: 50 } }
      );
      expect(title).toContain('AAPL');
      expect(title).toContain('50%');
    });
  });

  describe('validateAlertTrigger', () => {
    it('validates valid underlying move config', async () => {
      const { validateAlertTrigger } = await import('../types/alerts.js');
      const result = validateAlertTrigger({
        type: 'underlying_move',
        symbol: 'AAPL',
        movePercent: 5,
        direction: 'both',
        timeWindowMinutes: 1440,
      });
      expect(result.valid).toBe(true);
    });

    it('returns error for invalid config', async () => {
      const { validateAlertTrigger } = await import('../types/alerts.js');
      const result = validateAlertTrigger({
        type: 'underlying_move',
        // Missing required fields
      });
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('warns about aggressive settings', async () => {
      const { validateAlertTrigger } = await import('../types/alerts.js');
      const result = validateAlertTrigger({
        type: 'underlying_move',
        symbol: 'AAPL',
        movePercent: 1, // Very low
        direction: 'both',
        timeWindowMinutes: 30, // Very short
      });
      expect(result.valid).toBe(true);
      expect(result.warnings.length).toBeGreaterThan(0);
    });
  });

  describe('createDefaultTrigger', () => {
    it('creates default underlying move trigger', async () => {
      const { createDefaultTrigger, DEFAULT_ALERT_PREFERENCES } = await import('../types/alerts.js');
      const trigger = createDefaultTrigger('underlying_move', 'TSLA');

      expect(trigger.type).toBe('underlying_move');
      expect((trigger as UnderlyingMoveConfig).symbol).toBe('TSLA');
      expect((trigger as UnderlyingMoveConfig).movePercent).toBe(DEFAULT_ALERT_PREFERENCES.defaultTriggers.defaultMovePercent);
    });

    it('creates default premium target trigger', async () => {
      const { createDefaultTrigger } = await import('../types/alerts.js');
      const trigger = createDefaultTrigger('premium_target', 'AAPL');

      expect(trigger.type).toBe('premium_target');
      expect((trigger as PremiumTargetConfig).symbol).toBe('AAPL');
    });
  });

  describe('shouldShowAlert', () => {
    it('hides alert when alerts disabled', async () => {
      const { shouldShowAlert } = await import('../types/alerts.js');
      const alert = {
        id: '1',
        accountId: 'test',
        triggerId: '1',
        triggerName: 'Test',
        triggerType: 'underlying_move' as const,
        severity: 'warning' as const,
        status: 'active' as const,
        title: 'Test',
        message: 'Test',
        context: {},
        recommendedActions: [],
        triggeredAt: new Date(),
      };

      const result = shouldShowAlert(alert, { ...DEFAULT_ALERT_PREFERENCES, alertsEnabled: false });
      expect(result).toBe(false);
    });

    it('hides alert below minimum severity', async () => {
      const { shouldShowAlert } = await import('../types/alerts.js');
      const alert = {
        id: '1',
        accountId: 'test',
        triggerId: '1',
        triggerName: 'Test',
        triggerType: 'underlying_move' as const,
        severity: 'info' as const,
        status: 'active' as const,
        title: 'Test',
        message: 'Test',
        context: {},
        recommendedActions: [],
        triggeredAt: new Date(),
      };

      const result = shouldShowAlert(alert, { ...DEFAULT_ALERT_PREFERENCES, minimumSeverity: 'warning' });
      expect(result).toBe(false);
    });

    it('shows active alert with matching severity', async () => {
      const { shouldShowAlert } = await import('../types/alerts.js');
      const alert = {
        id: '1',
        accountId: 'test',
        triggerId: '1',
        triggerName: 'Test',
        triggerType: 'underlying_move' as const,
        severity: 'warning' as const,
        status: 'active' as const,
        title: 'Test',
        message: 'Test',
        context: {},
        recommendedActions: [],
        triggeredAt: new Date(),
      };

      const result = shouldShowAlert(alert, DEFAULT_ALERT_PREFERENCES);
      expect(result).toBe(true);
    });
  });
});
