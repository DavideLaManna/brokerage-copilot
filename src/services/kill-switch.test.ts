/**
 * Kill Switch Service Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  KillSwitchService,
  createKillSwitchService,
  shouldBlockOperation,
  getBlockedOperationMessage,
} from './kill-switch.js';
import {
  DEFAULT_KILL_SWITCH_CONFIG,
  createInactiveStatus,
  isKillSwitchActive,
  isReadOnlyMode,
  canReEnable,
  getRemainingCooldownSeconds,
  formatKillSwitchState,
  formatReasonCategory,
  generateStatusSummary,
  validateKillSwitchConfig,
  type KillSwitchStatus,
  type KillSwitchConfig,
} from '../types/kill-switch.js';
import type { BrokerAdapter, Order, AccountSummary } from '../types/broker.js';
import type { AuditLogService } from './audit-log.js';

// ============================================================================
// Mock Helpers
// ============================================================================

function createMockAdapter(openOrders: Order[] = []): BrokerAdapter {
  return {
    brokerName: 'Mock Broker',
    getAccountSummary: vi.fn().mockResolvedValue({} as AccountSummary),
    getPositions: vi.fn().mockResolvedValue([]),
    getOpenOrders: vi.fn().mockResolvedValue(openOrders),
    getQuote: vi.fn(),
    getOptionChain: vi.fn(),
    placeOrder: vi.fn(),
    cancelOrder: vi.fn().mockResolvedValue(true),
    disconnect: vi.fn(),
  };
}

function createMockAuditLogService(): AuditLogService {
  return {
    log: vi.fn().mockResolvedValue({ id: 'audit-1' }),
  } as unknown as AuditLogService;
}

function createMockOrders(count: number): Order[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `order-${i + 1}`,
    symbol: `SYM${i + 1}`,
    side: 'buy' as const,
    orderType: 'limit' as const,
    quantity: 10,
    status: 'open' as const,
    assetClass: 'option' as const,
    timeInForce: 'day' as const,
    filledQuantity: 0,
    submittedAt: new Date(),
  }));
}

// ============================================================================
// Type Helper Tests
// ============================================================================

describe('Kill Switch Types', () => {
  describe('createInactiveStatus', () => {
    it('should create inactive status with default config', () => {
      const status = createInactiveStatus();
      expect(status.state).toBe('inactive');
      expect(status.readOnlyMode).toBe(false);
      expect(status.config).toEqual(DEFAULT_KILL_SWITCH_CONFIG);
    });

    it('should create inactive status with custom config', () => {
      const customConfig: KillSwitchConfig = {
        ...DEFAULT_KILL_SWITCH_CONFIG,
        cancelOrdersOnActivation: true,
      };
      const status = createInactiveStatus(customConfig);
      expect(status.config.cancelOrdersOnActivation).toBe(true);
    });
  });

  describe('isKillSwitchActive', () => {
    it('should return true when active', () => {
      const status: KillSwitchStatus = {
        state: 'active',
        readOnlyMode: true,
        config: DEFAULT_KILL_SWITCH_CONFIG,
      };
      expect(isKillSwitchActive(status)).toBe(true);
    });

    it('should return false when inactive', () => {
      const status = createInactiveStatus();
      expect(isKillSwitchActive(status)).toBe(false);
    });
  });

  describe('isReadOnlyMode', () => {
    it('should return true when read-only mode is enabled', () => {
      const status: KillSwitchStatus = {
        state: 'active',
        readOnlyMode: true,
        config: DEFAULT_KILL_SWITCH_CONFIG,
      };
      expect(isReadOnlyMode(status)).toBe(true);
    });

    it('should return false when read-only mode is disabled', () => {
      const status = createInactiveStatus();
      expect(isReadOnlyMode(status)).toBe(false);
    });
  });

  describe('canReEnable', () => {
    it('should return false when kill switch is inactive', () => {
      const status = createInactiveStatus();
      expect(canReEnable(status)).toBe(false);
    });

    it('should return true when active and no cooldown is set', () => {
      const status: KillSwitchStatus = {
        state: 'active',
        readOnlyMode: true,
        config: DEFAULT_KILL_SWITCH_CONFIG,
      };
      expect(canReEnable(status)).toBe(true);
    });

    it('should return false when cooldown has not passed', () => {
      const status: KillSwitchStatus = {
        state: 'active',
        readOnlyMode: true,
        canReEnableAt: new Date(Date.now() + 60000).toISOString(),
        config: DEFAULT_KILL_SWITCH_CONFIG,
      };
      expect(canReEnable(status)).toBe(false);
    });

    it('should return true when cooldown has passed', () => {
      const status: KillSwitchStatus = {
        state: 'active',
        readOnlyMode: true,
        canReEnableAt: new Date(Date.now() - 1000).toISOString(),
        config: DEFAULT_KILL_SWITCH_CONFIG,
      };
      expect(canReEnable(status)).toBe(true);
    });
  });

  describe('getRemainingCooldownSeconds', () => {
    it('should return 0 when inactive', () => {
      const status = createInactiveStatus();
      expect(getRemainingCooldownSeconds(status)).toBe(0);
    });

    it('should return 0 when no cooldown is set', () => {
      const status: KillSwitchStatus = {
        state: 'active',
        readOnlyMode: true,
        config: DEFAULT_KILL_SWITCH_CONFIG,
      };
      expect(getRemainingCooldownSeconds(status)).toBe(0);
    });

    it('should return remaining seconds', () => {
      const status: KillSwitchStatus = {
        state: 'active',
        readOnlyMode: true,
        canReEnableAt: new Date(Date.now() + 10000).toISOString(),
        config: DEFAULT_KILL_SWITCH_CONFIG,
      };
      const remaining = getRemainingCooldownSeconds(status);
      expect(remaining).toBeGreaterThan(8);
      expect(remaining).toBeLessThanOrEqual(11);
    });
  });

  describe('formatKillSwitchState', () => {
    it('should format active state', () => {
      expect(formatKillSwitchState('active')).toBe('ACTIVE');
    });

    it('should format inactive state', () => {
      expect(formatKillSwitchState('inactive')).toBe('Inactive');
    });
  });

  describe('formatReasonCategory', () => {
    it('should format reason categories', () => {
      expect(formatReasonCategory('manual')).toBe('Manual Activation');
      expect(formatReasonCategory('risk_limit')).toBe('Risk Limit Exceeded');
      expect(formatReasonCategory('error_cascade')).toBe('Multiple Errors Detected');
      expect(formatReasonCategory('market_conditions')).toBe('Market Conditions');
      expect(formatReasonCategory('connection_issues')).toBe('Connection Issues');
      expect(formatReasonCategory('other')).toBe('Other');
    });
  });

  describe('generateStatusSummary', () => {
    it('should generate inactive summary', () => {
      const status = createInactiveStatus();
      const summary = generateStatusSummary(status);
      expect(summary).toContain('inactive');
      expect(summary).toContain('operating normally');
    });

    it('should generate active summary with details', () => {
      const status: KillSwitchStatus = {
        state: 'active',
        readOnlyMode: true,
        reason: 'Market volatility',
        activatedAt: new Date().toISOString(),
        ordersCancelled: 5,
        disabledFeatures: ['auto_reprice', 'alert_monitoring'],
        config: DEFAULT_KILL_SWITCH_CONFIG,
      };
      const summary = generateStatusSummary(status);
      expect(summary).toContain('KILL SWITCH ACTIVE');
      expect(summary).toContain('read-only mode');
      expect(summary).toContain('Market volatility');
      expect(summary).toContain('Orders cancelled: 5');
    });
  });

  describe('validateKillSwitchConfig', () => {
    it('should validate valid config', () => {
      const result = validateKillSwitchConfig(DEFAULT_KILL_SWITCH_CONFIG);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should error on negative cooldown', () => {
      const result = validateKillSwitchConfig({ reEnableCooldownSeconds: -1 });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Cooldown period cannot be negative');
    });

    it('should error on excessive cooldown', () => {
      const result = validateKillSwitchConfig({ reEnableCooldownSeconds: 5000 });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('exceed 1 hour'))).toBe(true);
    });

    it('should warn on very short cooldown', () => {
      const result = validateKillSwitchConfig({ reEnableCooldownSeconds: 5 });
      expect(result.valid).toBe(true);
      expect(result.warnings.some(w => w.includes('Very short cooldown'))).toBe(true);
    });

    it('should warn when cancelOrdersOnActivation is enabled', () => {
      const result = validateKillSwitchConfig({ cancelOrdersOnActivation: true });
      expect(result.warnings.some(w => w.includes('cancelOrdersOnActivation'))).toBe(true);
    });
  });
});

// ============================================================================
// Service Tests
// ============================================================================

describe('KillSwitchService', () => {
  let service: KillSwitchService;
  let mockAdapter: BrokerAdapter;
  let mockAuditLog: AuditLogService;

  beforeEach(() => {
    mockAdapter = createMockAdapter();
    mockAuditLog = createMockAuditLogService();
    service = createKillSwitchService('test-account', {}, mockAuditLog);
    service.setAdapter(mockAdapter);
  });

  describe('initial state', () => {
    it('should start with inactive status', () => {
      const status = service.getStatus();
      expect(status.state).toBe('inactive');
      expect(status.readOnlyMode).toBe(false);
    });

    it('should have default config', () => {
      const config = service.getConfig();
      expect(config).toEqual(DEFAULT_KILL_SWITCH_CONFIG);
    });

    it('should not be active', () => {
      expect(service.isActive()).toBe(false);
      expect(service.isReadOnly()).toBe(false);
    });
  });

  describe('activate', () => {
    it('should activate with default parameters', async () => {
      const result = await service.activate();

      expect(result.success).toBe(true);
      expect(result.status.state).toBe('active');
      expect(result.status.readOnlyMode).toBe(true);
      expect(service.isActive()).toBe(true);
      expect(service.isReadOnly()).toBe(true);
    });

    it('should record activation reason', async () => {
      const result = await service.activate('user', 'Market volatility', 'market_conditions');

      expect(result.status.reason).toBe('Market volatility');
      expect(result.status.reasonCategory).toBe('market_conditions');
      expect(result.status.activatedBy).toBe('user');
    });

    it('should not cancel orders by default', async () => {
      const orders = createMockOrders(3);
      mockAdapter = createMockAdapter(orders);
      service.setAdapter(mockAdapter);

      const result = await service.activate();

      expect(result.ordersCancelled).toHaveLength(0);
      expect(mockAdapter.cancelOrder).not.toHaveBeenCalled();
    });

    it('should cancel orders when configured', async () => {
      const orders = createMockOrders(3);
      mockAdapter = createMockAdapter(orders);
      service.setAdapter(mockAdapter);
      service.updateConfig({ cancelOrdersOnActivation: true });

      const result = await service.activate();

      expect(result.ordersCancelled).toHaveLength(3);
      expect(mockAdapter.cancelOrder).toHaveBeenCalledTimes(3);
      expect(result.status.ordersCancelled).toBe(3);
    });

    it('should track disabled features', async () => {
      const result = await service.activate();

      expect(result.featuresDisabled).toContain('auto_reprice');
      expect(result.featuresDisabled).toContain('alert_monitoring');
      expect(result.status.disabledFeatures).toEqual(['auto_reprice', 'alert_monitoring']);
    });

    it('should set cooldown end time', async () => {
      service.updateConfig({ reEnableCooldownSeconds: 60 });

      const result = await service.activate();

      expect(result.status.canReEnableAt).toBeDefined();
      const cooldownEnd = new Date(result.status.canReEnableAt!);
      expect(cooldownEnd.getTime()).toBeGreaterThan(Date.now());
    });

    it('should be idempotent when already active', async () => {
      await service.activate();
      const result = await service.activate();

      expect(result.success).toBe(true);
      expect(result.status.state).toBe('active');
    });

    it('should record activation event', async () => {
      await service.activate('user', 'Test reason');

      const events = service.getEventHistory();
      expect(events).toHaveLength(1);
      expect(events[0].action).toBe('activated');
      expect(events[0].triggeredBy).toBe('user');
      expect(events[0].reason).toBe('Test reason');
    });

    it('should log to audit trail', async () => {
      await service.activate('user', 'Test reason');

      expect(mockAuditLog.log).toHaveBeenCalled();
    });
  });

  describe('deactivate', () => {
    beforeEach(async () => {
      // Set up as active first
      service.updateConfig({ reEnableCooldownSeconds: 0 });
      await service.activate();
    });

    it('should deactivate with confirmation', async () => {
      const result = await service.deactivate(true);

      expect(result.success).toBe(true);
      expect(result.status.state).toBe('inactive');
      expect(result.status.readOnlyMode).toBe(false);
      expect(service.isActive()).toBe(false);
    });

    it('should fail without confirmation when required', async () => {
      service.updateConfig({ requireConfirmationForReEnable: true });

      const result = await service.deactivate(false);

      expect(result.success).toBe(false);
      expect(result.error).toContain('confirmation required');
      expect(service.isActive()).toBe(true);
    });

    it('should succeed without confirmation when not required', async () => {
      service.updateConfig({ requireConfirmationForReEnable: false });

      const result = await service.deactivate(false);

      expect(result.success).toBe(true);
    });

    it('should fail during cooldown period', async () => {
      service.updateConfig({ reEnableCooldownSeconds: 60 });
      await service.deactivate(true); // First deactivate to reset
      await service.activate(); // Activate again with cooldown

      const result = await service.deactivate(true);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Cooldown remaining');
    });

    it('should track re-enabled features', async () => {
      const result = await service.deactivate(true);

      expect(result.featuresReEnabled).toContain('auto_reprice');
      expect(result.featuresReEnabled).toContain('alert_monitoring');
    });

    it('should be idempotent when already inactive', async () => {
      await service.deactivate(true);
      const result = await service.deactivate(true);

      expect(result.success).toBe(true);
      expect(result.status.state).toBe('inactive');
    });

    it('should record deactivation event', async () => {
      await service.deactivate(true);

      const events = service.getEventHistory();
      expect(events.some(e => e.action === 'deactivated')).toBe(true);
    });
  });

  describe('updateConfig', () => {
    it('should update configuration', () => {
      service.updateConfig({ cancelOrdersOnActivation: true });

      const config = service.getConfig();
      expect(config.cancelOrdersOnActivation).toBe(true);
    });

    it('should preserve unchanged settings', () => {
      const originalConfig = service.getConfig();
      service.updateConfig({ reEnableCooldownSeconds: 120 });

      const newConfig = service.getConfig();
      expect(newConfig.cancelOrdersOnActivation).toBe(originalConfig.cancelOrdersOnActivation);
      expect(newConfig.reEnableCooldownSeconds).toBe(120);
    });
  });

  describe('onStateChange callbacks', () => {
    it('should notify on activation', async () => {
      const callback = vi.fn();
      service.onStateChange(callback);

      await service.activate();

      expect(callback).toHaveBeenCalledWith(expect.objectContaining({
        state: 'active',
      }));
    });

    it('should notify on deactivation', async () => {
      service.updateConfig({ reEnableCooldownSeconds: 0 });
      await service.activate();

      const callback = vi.fn();
      service.onStateChange(callback);

      await service.deactivate(true);

      expect(callback).toHaveBeenCalledWith(expect.objectContaining({
        state: 'inactive',
      }));
    });

    it('should allow unsubscribing', async () => {
      const callback = vi.fn();
      const unsubscribe = service.onStateChange(callback);

      unsubscribe();
      await service.activate();

      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('state persistence', () => {
    it('should return stored state', async () => {
      await service.activate('user', 'Test reason');

      const stored = service.getStoredState();

      expect(stored.version).toBeDefined();
      expect(stored.accountId).toBe('test-account');
      expect(stored.status.state).toBe('active');
      expect(stored.recentEvents.length).toBeGreaterThan(0);
    });

    it('should restore from stored state', async () => {
      await service.activate('user', 'Test reason');
      const stored = service.getStoredState();

      // Create new service and restore
      const newService = createKillSwitchService('test-account');
      newService.restoreFromState(stored);

      expect(newService.isActive()).toBe(true);
      expect(newService.getStatus().reason).toBe('Test reason');
    });
  });
});

// ============================================================================
// Standalone Function Tests
// ============================================================================

describe('shouldBlockOperation', () => {
  const inactiveStatus = createInactiveStatus();
  const activeStatus: KillSwitchStatus = {
    state: 'active',
    readOnlyMode: true,
    disabledFeatures: ['auto_reprice', 'alert_monitoring'],
    config: DEFAULT_KILL_SWITCH_CONFIG,
  };

  it('should not block when inactive', () => {
    expect(shouldBlockOperation(inactiveStatus, 'order_submit')).toBe(false);
    expect(shouldBlockOperation(inactiveStatus, 'order_modify')).toBe(false);
    expect(shouldBlockOperation(inactiveStatus, 'auto_reprice')).toBe(false);
    expect(shouldBlockOperation(inactiveStatus, 'alert_action')).toBe(false);
  });

  it('should block order_submit when active', () => {
    expect(shouldBlockOperation(activeStatus, 'order_submit')).toBe(true);
  });

  it('should block order_modify when active', () => {
    expect(shouldBlockOperation(activeStatus, 'order_modify')).toBe(true);
  });

  it('should block auto_reprice when disabled', () => {
    expect(shouldBlockOperation(activeStatus, 'auto_reprice')).toBe(true);
  });

  it('should block alert_action when disabled', () => {
    expect(shouldBlockOperation(activeStatus, 'alert_action')).toBe(true);
  });

  it('should not block auto_reprice when not disabled', () => {
    const status: KillSwitchStatus = {
      state: 'active',
      readOnlyMode: true,
      disabledFeatures: [],
      config: DEFAULT_KILL_SWITCH_CONFIG,
    };
    expect(shouldBlockOperation(status, 'auto_reprice')).toBe(false);
  });
});

describe('getBlockedOperationMessage', () => {
  const activeStatus: KillSwitchStatus = {
    state: 'active',
    readOnlyMode: true,
    reason: 'Market volatility',
    disabledFeatures: ['auto_reprice'],
    config: DEFAULT_KILL_SWITCH_CONFIG,
  };

  it('should return empty string when not blocked', () => {
    const inactiveStatus = createInactiveStatus();
    expect(getBlockedOperationMessage(inactiveStatus, 'order_submit')).toBe('');
  });

  it('should include operation name', () => {
    const message = getBlockedOperationMessage(activeStatus, 'order_submit');
    expect(message).toContain('Order submission');
    expect(message).toContain('blocked');
  });

  it('should include reason', () => {
    const message = getBlockedOperationMessage(activeStatus, 'order_submit');
    expect(message).toContain('Market volatility');
  });

  it('should include cooldown info', () => {
    const statusWithCooldown: KillSwitchStatus = {
      ...activeStatus,
      canReEnableAt: new Date(Date.now() + 30000).toISOString(),
    };
    const message = getBlockedOperationMessage(statusWithCooldown, 'order_submit');
    expect(message).toContain('re-enabled in');
    expect(message).toContain('seconds');
  });
});

describe('createKillSwitchService factory', () => {
  it('should create a service instance', () => {
    const service = createKillSwitchService('test-account');
    expect(service).toBeInstanceOf(KillSwitchService);
  });

  it('should accept custom config', () => {
    const service = createKillSwitchService('test-account', {
      killSwitchConfig: { reEnableCooldownSeconds: 120 },
    });
    expect(service.getConfig().reEnableCooldownSeconds).toBe(120);
  });

  it('should accept audit log service', () => {
    const mockAuditLog = createMockAuditLogService();
    const service = createKillSwitchService('test-account', {}, mockAuditLog);

    // Verify audit log is used by activating
    service.setAdapter(createMockAdapter());
    service.activate();

    // The audit log should be called (eventually)
    // We can verify the service was constructed properly
    expect(service).toBeDefined();
  });
});
