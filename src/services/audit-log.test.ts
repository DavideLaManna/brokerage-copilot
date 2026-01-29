/**
 * AuditLogService Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { AuditLogService, createAuditLogServiceFromEnv, createAuditLogger } from './audit-log.js';
import {
  type AuditLogEntry,
  type StoredAuditLogEntry,
  AuditLogEntrySchema,
  StoredAuditLogEntrySchema,
  getInitiatorTag,
  formatEventType,
  formatActor,
  generateEventSummary,
  validateAuditLogEntry,
  AUDIT_LOG_SCHEMA_VERSION,
} from '../types/audit-log.js';

const TEST_PASSWORD = 'test-password-for-audit-logs';
const TEST_AUDIT_DIR = '.test-audit-logs';

describe('Audit Log Types', () => {
  describe('getInitiatorTag', () => {
    it('returns human_initiated for user actor', () => {
      expect(getInitiatorTag('user')).toBe('human_initiated');
    });

    it('returns agent_initiated for agent actor', () => {
      expect(getInitiatorTag('agent')).toBe('agent_initiated');
    });

    it('returns system_initiated for system actor', () => {
      expect(getInitiatorTag('system')).toBe('system_initiated');
    });

    it('returns system_initiated for broker actor', () => {
      expect(getInitiatorTag('broker')).toBe('system_initiated');
    });
  });

  describe('formatEventType', () => {
    it('formats recommendation', () => {
      expect(formatEventType('recommendation')).toBe('Recommendation');
    });

    it('formats approval', () => {
      expect(formatEventType('approval')).toBe('Approval');
    });

    it('formats execution', () => {
      expect(formatEventType('execution')).toBe('Execution');
    });

    it('formats risk_check', () => {
      expect(formatEventType('risk_check')).toBe('Risk Check');
    });

    it('formats config_change', () => {
      expect(formatEventType('config_change')).toBe('Config Change');
    });
  });

  describe('formatActor', () => {
    it('formats user', () => {
      expect(formatActor('user')).toBe('User');
    });

    it('formats agent', () => {
      expect(formatActor('agent')).toBe('AI Agent');
    });

    it('formats system', () => {
      expect(formatActor('system')).toBe('System');
    });

    it('formats broker', () => {
      expect(formatActor('broker')).toBe('Broker');
    });
  });

  describe('generateEventSummary', () => {
    it('generates summary for recommendation', () => {
      const summary = generateEventSummary('recommendation', 'agent', {
        type: 'recommendation',
        strategyType: 'long_call',
        underlying: 'AAPL',
        confidence: 'high',
        thesis: ['Bullish momentum'],
        catalysts: ['Earnings'],
        contractCount: 1,
      });
      expect(summary).toBe('AI Agent recommended long_call on AAPL (high confidence)');
    });

    it('generates summary for approval', () => {
      const summary = generateEventSummary('approval', 'user', {
        type: 'approval',
        strategyType: 'vertical_spread',
        underlying: 'TSLA',
        orderCount: 2,
        estimatedCost: 500,
        riskChecksPassed: true,
      });
      expect(summary).toBe('User approved vertical_spread on TSLA (2 orders)');
    });

    it('generates summary for rejection with reason', () => {
      const summary = generateEventSummary('rejection', 'user', {
        type: 'rejection',
        strategyType: 'short_put',
        underlying: 'NVDA',
        reason: 'Too risky',
        rejectedBy: 'user',
      });
      expect(summary).toBe('User rejected short_put on NVDA: Too risky');
    });

    it('generates summary for successful execution', () => {
      const summary = generateEventSummary('execution', 'system', {
        type: 'execution',
        symbol: 'AAPL240216C00185000',
        side: 'buy',
        quantity: 5,
        orderType: 'limit',
        idempotencyKey: '12345',
        brokerOrderId: 'BR123',
        success: true,
      });
      expect(summary).toBe('System submitted BUY 5x AAPL240216C00185000 (Order #BR123)');
    });

    it('generates summary for failed execution', () => {
      const summary = generateEventSummary('execution', 'system', {
        type: 'execution',
        symbol: 'AAPL240216C00185000',
        side: 'buy',
        quantity: 5,
        orderType: 'limit',
        idempotencyKey: '12345',
        success: false,
        errorMessage: 'Insufficient funds',
      });
      expect(summary).toBe('System failed to submit BUY 5x AAPL240216C00185000');
    });

    it('generates summary for successful cancellation', () => {
      const summary = generateEventSummary('cancellation', 'user', {
        type: 'cancellation',
        symbol: 'AAPL',
        brokerOrderId: 'BR456',
        success: true,
      });
      expect(summary).toBe('User canceled order #BR456 on AAPL');
    });

    it('generates summary for fill', () => {
      const summary = generateEventSummary('fill', 'broker', {
        type: 'fill',
        symbol: 'AAPL240216C00185000',
        brokerOrderId: 'BR789',
        filledQuantity: 3,
        totalQuantity: 5,
        fillPrice: 3.25,
        isComplete: false,
      });
      expect(summary).toBe('Order #BR789 partially filled: 3/5 @ $3.25');
    });

    it('generates summary for risk check', () => {
      const summary = generateEventSummary('risk_check', 'system', {
        type: 'risk_check',
        trigger: 'pre_trade',
        symbol: 'AAPL',
        passed: true,
        checks: [],
        totalChecks: 5,
        passedChecks: 5,
      });
      expect(summary).toBe('System risk check passed (5/5 checks) for AAPL');
    });

    it('generates summary for config change', () => {
      const summary = generateEventSummary('config_change', 'user', {
        type: 'config_change',
        configType: 'risk_config',
        field: 'maxRiskPerTradePercent',
        previousValue: 2,
        newValue: 3,
      });
      expect(summary).toBe('User changed risk_config setting: maxRiskPerTradePercent');
    });

    it('generates summary for connection', () => {
      const summary = generateEventSummary('connection', 'user', {
        type: 'connection',
        action: 'connect',
        brokerType: 'tradier',
        success: true,
      });
      expect(summary).toBe('User connect to tradier succeeded');
    });

    it('generates summary for error', () => {
      const summary = generateEventSummary('error', 'system', {
        type: 'error',
        category: 'broker',
        errorMessage: 'Connection timeout',
        operation: 'placeOrder',
        recoverable: true,
      });
      expect(summary).toBe('broker error during placeOrder: Connection timeout');
    });
  });

  describe('validateAuditLogEntry', () => {
    it('validates a correct entry', () => {
      const entry: AuditLogEntry = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        timestamp: new Date().toISOString(),
        eventType: 'recommendation',
        actor: 'agent',
        accountId: 'account123',
        initiatorTag: 'agent_initiated',
        details: {
          type: 'recommendation',
          strategyType: 'long_call',
          underlying: 'AAPL',
          confidence: 'high',
          thesis: ['Bullish momentum'],
          catalysts: ['Earnings'],
          contractCount: 1,
        },
        summary: 'Test recommendation',
      };
      const result = validateAuditLogEntry(entry);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('rejects entry with invalid eventType', () => {
      const entry = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        timestamp: new Date().toISOString(),
        eventType: 'invalid_type',
        actor: 'agent',
        accountId: 'account123',
        initiatorTag: 'agent_initiated',
        details: {
          type: 'recommendation',
          strategyType: 'long_call',
          underlying: 'AAPL',
          confidence: 'high',
          thesis: ['Bullish'],
          catalysts: [],
          contractCount: 1,
        },
        summary: 'Test',
      };
      const result = validateAuditLogEntry(entry);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('rejects entry with missing required field', () => {
      const entry = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        timestamp: new Date().toISOString(),
        eventType: 'recommendation',
        // missing actor
        accountId: 'account123',
        initiatorTag: 'agent_initiated',
        details: {
          type: 'recommendation',
          strategyType: 'long_call',
          underlying: 'AAPL',
          confidence: 'high',
          thesis: ['Bullish'],
          catalysts: [],
          contractCount: 1,
        },
        summary: 'Test',
      };
      const result = validateAuditLogEntry(entry);
      expect(result.valid).toBe(false);
    });
  });

  describe('AUDIT_LOG_SCHEMA_VERSION', () => {
    it('is a positive number', () => {
      expect(AUDIT_LOG_SCHEMA_VERSION).toBeGreaterThan(0);
    });
  });
});

describe('AuditLogService', () => {
  let service: AuditLogService;

  beforeEach(async () => {
    // Clean up test directory
    if (fs.existsSync(TEST_AUDIT_DIR)) {
      fs.rmSync(TEST_AUDIT_DIR, { recursive: true });
    }

    service = new AuditLogService({
      masterPassword: TEST_PASSWORD,
      auditLogDir: TEST_AUDIT_DIR,
    });
    await service.initialize();
  });

  afterEach(() => {
    service.clearMemory();
    if (fs.existsSync(TEST_AUDIT_DIR)) {
      fs.rmSync(TEST_AUDIT_DIR, { recursive: true });
    }
  });

  describe('constructor', () => {
    it('throws if password is too short', () => {
      expect(
        () =>
          new AuditLogService({
            masterPassword: 'short',
            auditLogDir: TEST_AUDIT_DIR,
          })
      ).toThrow('Master password must be at least 8 characters');
    });

    it('creates service with valid password', () => {
      const svc = new AuditLogService({
        masterPassword: TEST_PASSWORD,
        auditLogDir: TEST_AUDIT_DIR,
      });
      expect(svc).toBeDefined();
    });
  });

  describe('log', () => {
    it('logs a recommendation event', async () => {
      const entry = await service.log({
        accountId: 'test-account',
        eventType: 'recommendation',
        actor: 'agent',
        details: {
          type: 'recommendation',
          strategyType: 'long_call',
          underlying: 'AAPL',
          confidence: 'high',
          thesis: ['Bullish momentum'],
          catalysts: ['Earnings report'],
          contractCount: 2,
          estimatedMaxLoss: 500,
        },
        proposalId: '550e8400-e29b-41d4-a716-446655440000',
      });

      expect(entry.id).toBeDefined();
      expect(entry.eventType).toBe('recommendation');
      expect(entry.actor).toBe('agent');
      expect(entry.initiatorTag).toBe('agent_initiated');
      expect(entry.summary).toContain('AI Agent recommended long_call on AAPL');
    });

    it('logs an approval event', async () => {
      const entry = await service.log({
        accountId: 'test-account',
        eventType: 'approval',
        actor: 'user',
        details: {
          type: 'approval',
          strategyType: 'vertical_spread',
          underlying: 'TSLA',
          orderCount: 2,
          estimatedCost: 350,
          riskChecksPassed: true,
        },
      });

      expect(entry.eventType).toBe('approval');
      expect(entry.initiatorTag).toBe('human_initiated');
    });

    it('throws on invalid entry', async () => {
      await expect(
        service.log({
          accountId: 'test-account',
          eventType: 'recommendation',
          actor: 'agent',
          details: {
            type: 'recommendation',
            strategyType: '', // empty string should fail validation
            underlying: 'AAPL',
            confidence: 'high',
            thesis: [],
            catalysts: [],
            contractCount: 0, // should be positive
          } as any,
        })
      ).rejects.toThrow();
    });
  });

  describe('specialized log methods', () => {
    it('logs recommendation', async () => {
      const entry = await service.logRecommendation({
        accountId: 'test-account',
        strategyType: 'long_put',
        underlying: 'SPY',
        confidence: 'medium',
        thesis: ['Bearish outlook'],
        catalysts: ['Fed meeting'],
        contractCount: 1,
        estimatedMaxLoss: 200,
        estimatedMaxLossPercent: 0.5,
      });

      expect(entry.eventType).toBe('recommendation');
      expect(entry.details.type).toBe('recommendation');
    });

    it('logs approval', async () => {
      const entry = await service.logApproval({
        accountId: 'test-account',
        strategyType: 'covered_call',
        underlying: 'GOOGL',
        orderCount: 1,
        estimatedCost: -150,
        riskChecksPassed: true,
        warnings: ['Low liquidity'],
      });

      expect(entry.eventType).toBe('approval');
      expect(entry.actor).toBe('user');
    });

    it('logs rejection', async () => {
      const entry = await service.logRejection({
        accountId: 'test-account',
        strategyType: 'iron_condor',
        underlying: 'AMZN',
        reason: 'Risk too high',
        rejectedBy: 'user',
      });

      expect(entry.eventType).toBe('rejection');
      expect((entry.details as any).reason).toBe('Risk too high');
    });

    it('logs execution', async () => {
      const entry = await service.logExecution({
        accountId: 'test-account',
        symbol: 'AAPL240216C00185000',
        underlying: 'AAPL',
        side: 'buy',
        quantity: 5,
        orderType: 'limit',
        limitPrice: 3.5,
        idempotencyKey: '550e8400-e29b-41d4-a716-446655440000',
        brokerOrderId: 'BR12345',
        success: true,
      });

      expect(entry.eventType).toBe('execution');
      expect((entry.details as any).success).toBe(true);
    });

    it('logs cancellation', async () => {
      const entry = await service.logCancellation({
        accountId: 'test-account',
        symbol: 'TSLA',
        brokerOrderId: 'BR67890',
        reason: 'Changed mind',
        success: true,
      });

      expect(entry.eventType).toBe('cancellation');
    });

    it('logs fill', async () => {
      const entry = await service.logFill({
        accountId: 'test-account',
        symbol: 'NVDA240315P00500000',
        brokerOrderId: 'BR11111',
        filledQuantity: 3,
        totalQuantity: 5,
        fillPrice: 12.5,
        isComplete: false,
        commission: 0.65,
      });

      expect(entry.eventType).toBe('fill');
      expect(entry.actor).toBe('broker');
    });

    it('logs risk check', async () => {
      const entry = await service.logRiskCheck({
        accountId: 'test-account',
        trigger: 'pre_trade',
        symbol: 'META',
        passed: false,
        checks: [
          {
            checkType: 'risk_per_trade',
            passed: false,
            actualValue: 5.5,
            limit: 2,
            message: 'Risk per trade exceeds limit',
          },
          {
            checkType: 'buying_power',
            passed: true,
            actualValue: 1000,
            limit: 500,
            message: 'Sufficient buying power',
          },
        ],
      });

      expect(entry.eventType).toBe('risk_check');
      expect((entry.details as any).passed).toBe(false);
      expect((entry.details as any).totalChecks).toBe(2);
      expect((entry.details as any).passedChecks).toBe(1);
    });

    it('logs config change', async () => {
      const entry = await service.logConfigChange({
        accountId: 'test-account',
        configType: 'risk_config',
        field: 'maxDailyLoss',
        previousValue: 1000,
        newValue: 1500,
        configId: 'config-123',
      });

      expect(entry.eventType).toBe('config_change');
    });

    it('logs connection', async () => {
      const entry = await service.logConnection({
        accountId: 'test-account',
        action: 'connect',
        brokerType: 'tradier',
        success: true,
      });

      expect(entry.eventType).toBe('connection');
    });

    it('logs error', async () => {
      const entry = await service.logError({
        accountId: 'test-account',
        category: 'broker',
        errorCode: 'TIMEOUT',
        errorMessage: 'Connection timeout after 30s',
        operation: 'getPositions',
        recoverable: true,
      });

      expect(entry.eventType).toBe('error');
      expect(entry.actor).toBe('system');
    });
  });

  describe('query', () => {
    beforeEach(async () => {
      // Add test entries
      await service.logRecommendation({
        accountId: 'test-account',
        strategyType: 'long_call',
        underlying: 'AAPL',
        confidence: 'high',
        thesis: ['Bullish'],
        catalysts: [],
        contractCount: 1,
      });
      await service.logApproval({
        accountId: 'test-account',
        strategyType: 'long_call',
        underlying: 'AAPL',
        orderCount: 1,
        estimatedCost: 300,
        riskChecksPassed: true,
      });
      await service.logExecution({
        accountId: 'test-account',
        symbol: 'AAPL240216C00185000',
        side: 'buy',
        quantity: 1,
        orderType: 'limit',
        idempotencyKey: '550e8400-e29b-41d4-a716-446655440001',
        success: true,
        brokerOrderId: 'BR001',
      });
    });

    it('returns all entries by default', () => {
      const result = service.query('test-account');
      expect(result.entries).toHaveLength(3);
      expect(result.totalCount).toBe(3);
      expect(result.hasMore).toBe(false);
    });

    it('filters by event type', () => {
      const result = service.query('test-account', {
        eventTypes: ['recommendation'],
      });
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].eventType).toBe('recommendation');
    });

    it('filters by multiple event types', () => {
      const result = service.query('test-account', {
        eventTypes: ['recommendation', 'approval'],
      });
      expect(result.entries).toHaveLength(2);
    });

    it('filters by actor', () => {
      const result = service.query('test-account', {
        actor: 'user',
      });
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].actor).toBe('user');
    });

    it('filters by initiator tag', () => {
      const result = service.query('test-account', {
        initiatorTag: 'agent_initiated',
      });
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].initiatorTag).toBe('agent_initiated');
    });

    it('paginates results', () => {
      const result = service.query('test-account', {
        limit: 2,
        offset: 0,
      });
      expect(result.entries).toHaveLength(2);
      expect(result.hasMore).toBe(true);

      const result2 = service.query('test-account', {
        limit: 2,
        offset: 2,
      });
      expect(result2.entries).toHaveLength(1);
      expect(result2.hasMore).toBe(false);
    });

    it('sorts ascending', () => {
      const result = service.query('test-account', {
        sortOrder: 'asc',
      });
      const timestamps = result.entries.map((e) => new Date(e.timestamp).getTime());
      expect(timestamps[0]).toBeLessThanOrEqual(timestamps[1]!);
    });

    it('sorts descending by default', () => {
      const result = service.query('test-account');
      const timestamps = result.entries.map((e) => new Date(e.timestamp).getTime());
      expect(timestamps[0]).toBeGreaterThanOrEqual(timestamps[1]!);
    });

    it('returns empty for unknown account', () => {
      const result = service.query('unknown-account');
      expect(result.entries).toHaveLength(0);
      expect(result.totalCount).toBe(0);
    });
  });

  describe('getEntry', () => {
    it('returns entry by ID', async () => {
      const logged = await service.logConnection({
        accountId: 'test-account',
        action: 'validate',
        brokerType: 'tradier',
        success: true,
      });

      const retrieved = service.getEntry('test-account', logged.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(logged.id);
    });

    it('returns null for unknown entry', () => {
      const retrieved = service.getEntry('test-account', 'unknown-id');
      expect(retrieved).toBeNull();
    });

    it('returns null for unknown account', () => {
      const retrieved = service.getEntry('unknown-account', 'any-id');
      expect(retrieved).toBeNull();
    });
  });

  describe('getProposalHistory', () => {
    it('returns all entries for a proposal', async () => {
      const proposalId = '550e8400-e29b-41d4-a716-446655440002';

      await service.logRecommendation({
        accountId: 'test-account',
        strategyType: 'long_call',
        underlying: 'MSFT',
        confidence: 'high',
        thesis: ['Bullish'],
        catalysts: [],
        contractCount: 1,
        proposalId,
      });
      await service.logApproval({
        accountId: 'test-account',
        strategyType: 'long_call',
        underlying: 'MSFT',
        orderCount: 1,
        estimatedCost: 200,
        riskChecksPassed: true,
        proposalId,
      });

      const history = service.getProposalHistory('test-account', proposalId);
      expect(history).toHaveLength(2);
      expect(history[0].eventType).toBe('recommendation');
      expect(history[1].eventType).toBe('approval');
    });
  });

  describe('getCorrelatedEntries', () => {
    it('returns entries with same correlation ID', async () => {
      const correlationId = '550e8400-e29b-41d4-a716-446655440003';

      await service.logExecution({
        accountId: 'test-account',
        symbol: 'SPY240216C00500000',
        side: 'buy',
        quantity: 1,
        orderType: 'limit',
        idempotencyKey: '550e8400-e29b-41d4-a716-446655440004',
        success: true,
        brokerOrderId: 'BR101',
        correlationId,
      });
      await service.logExecution({
        accountId: 'test-account',
        symbol: 'SPY240216P00490000',
        side: 'sell',
        quantity: 1,
        orderType: 'limit',
        idempotencyKey: '550e8400-e29b-41d4-a716-446655440005',
        success: true,
        brokerOrderId: 'BR102',
        correlationId,
      });

      const correlated = service.getCorrelatedEntries('test-account', correlationId);
      expect(correlated).toHaveLength(2);
    });
  });

  describe('getEntriesGroupedByDay', () => {
    it('groups entries by day', async () => {
      await service.logConnection({
        accountId: 'test-account',
        action: 'connect',
        brokerType: 'tradier',
        success: true,
      });

      const grouped = service.getEntriesGroupedByDay('test-account');
      expect(grouped.size).toBe(1);

      const today = new Date().toISOString().split('T')[0]!;
      expect(grouped.has(today)).toBe(true);
    });
  });

  describe('getStatistics', () => {
    it('returns statistics for account', async () => {
      await service.logRecommendation({
        accountId: 'test-account',
        strategyType: 'long_call',
        underlying: 'AAPL',
        confidence: 'high',
        thesis: ['Bullish'],
        catalysts: [],
        contractCount: 1,
      });
      await service.logApproval({
        accountId: 'test-account',
        strategyType: 'long_call',
        underlying: 'AAPL',
        orderCount: 1,
        estimatedCost: 300,
        riskChecksPassed: true,
      });

      const stats = service.getStatistics('test-account');
      expect(stats.total).toBe(2);
      expect(stats.byEventType['recommendation']).toBe(1);
      expect(stats.byEventType['approval']).toBe(1);
      expect(stats.byActor['agent']).toBe(1);
      expect(stats.byActor['user']).toBe(1);
    });
  });

  describe('persistence', () => {
    it('persists entries to disk', async () => {
      await service.logConnection({
        accountId: 'test-account',
        action: 'connect',
        brokerType: 'tradier',
        success: true,
      });

      // Verify file exists
      const expectedFile = path.join(TEST_AUDIT_DIR, 'audit-log-test-account.json');
      expect(fs.existsSync(expectedFile)).toBe(true);
    });

    it('loads entries after restart', async () => {
      await service.logRecommendation({
        accountId: 'test-account',
        strategyType: 'straddle',
        underlying: 'QQQ',
        confidence: 'medium',
        thesis: ['Volatility play'],
        catalysts: ['Earnings'],
        contractCount: 2,
      });

      // Create new service (simulates restart)
      const newService = new AuditLogService({
        masterPassword: TEST_PASSWORD,
        auditLogDir: TEST_AUDIT_DIR,
      });
      await newService.initialize();

      const result = newService.query('test-account');
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].eventType).toBe('recommendation');

      newService.clearMemory();
    });

    it('handles multiple accounts separately', async () => {
      await service.logConnection({
        accountId: 'account-1',
        action: 'connect',
        brokerType: 'tradier',
        success: true,
      });
      await service.logConnection({
        accountId: 'account-2',
        action: 'connect',
        brokerType: 'alpaca',
        success: true,
      });

      expect(service.getEntryCount('account-1')).toBe(1);
      expect(service.getEntryCount('account-2')).toBe(1);

      // Verify separate files
      expect(fs.existsSync(path.join(TEST_AUDIT_DIR, 'audit-log-account-1.json'))).toBe(true);
      expect(fs.existsSync(path.join(TEST_AUDIT_DIR, 'audit-log-account-2.json'))).toBe(true);
    });
  });

  describe('clearAccount', () => {
    it('removes all entries for an account', async () => {
      await service.logConnection({
        accountId: 'test-account',
        action: 'connect',
        brokerType: 'tradier',
        success: true,
      });

      expect(service.getEntryCount('test-account')).toBe(1);

      await service.clearAccount('test-account');

      expect(service.getEntryCount('test-account')).toBe(0);
      expect(fs.existsSync(path.join(TEST_AUDIT_DIR, 'audit-log-test-account.json'))).toBe(false);
    });
  });

  describe('getTotalEntryCount', () => {
    it('returns total across all accounts', async () => {
      await service.logConnection({
        accountId: 'account-1',
        action: 'connect',
        brokerType: 'tradier',
        success: true,
      });
      await service.logConnection({
        accountId: 'account-2',
        action: 'connect',
        brokerType: 'alpaca',
        success: true,
      });

      expect(service.getTotalEntryCount()).toBe(2);
    });
  });
});

describe('createAuditLogger', () => {
  let service: AuditLogService;

  beforeEach(async () => {
    if (fs.existsSync(TEST_AUDIT_DIR)) {
      fs.rmSync(TEST_AUDIT_DIR, { recursive: true });
    }

    service = new AuditLogService({
      masterPassword: TEST_PASSWORD,
      auditLogDir: TEST_AUDIT_DIR,
    });
    await service.initialize();
  });

  afterEach(() => {
    service.clearMemory();
    if (fs.existsSync(TEST_AUDIT_DIR)) {
      fs.rmSync(TEST_AUDIT_DIR, { recursive: true });
    }
  });

  it('creates a standalone log function', async () => {
    const log = createAuditLogger(service);

    const entry = await log({
      accountId: 'test-account',
      eventType: 'connection',
      actor: 'user',
      details: {
        type: 'connection',
        action: 'disconnect',
        brokerType: 'tradier',
        success: true,
      },
    });

    expect(entry.eventType).toBe('connection');
    expect(service.getEntryCount('test-account')).toBe(1);
  });
});

describe('createAuditLogServiceFromEnv', () => {
  beforeEach(() => {
    if (fs.existsSync(TEST_AUDIT_DIR)) {
      fs.rmSync(TEST_AUDIT_DIR, { recursive: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(TEST_AUDIT_DIR)) {
      fs.rmSync(TEST_AUDIT_DIR, { recursive: true });
    }
    delete process.env['TEST_AUDIT_PASSWORD'];
    delete process.env['TEST_AUDIT_DIR'];
  });

  it('creates service from env vars', async () => {
    process.env['TEST_AUDIT_PASSWORD'] = TEST_PASSWORD;
    process.env['TEST_AUDIT_DIR'] = TEST_AUDIT_DIR;

    const service = await createAuditLogServiceFromEnv('TEST_AUDIT_PASSWORD', 'TEST_AUDIT_DIR');

    expect(service).toBeDefined();

    await service.logConnection({
      accountId: 'test',
      action: 'connect',
      brokerType: 'tradier',
      success: true,
    });

    expect(service.getEntryCount('test')).toBe(1);

    service.clearMemory();
  });

  it('throws if password not set', async () => {
    await expect(
      createAuditLogServiceFromEnv('NONEXISTENT_PASSWORD_VAR', 'TEST_AUDIT_DIR')
    ).rejects.toThrow('Master password not found');
  });
});

describe('AuditLogService note operations', () => {
  let service: AuditLogService;
  const testAccountId = 'test-notes-account';

  beforeEach(async () => {
    // Clean up test directory
    if (fs.existsSync(TEST_AUDIT_DIR)) {
      fs.rmSync(TEST_AUDIT_DIR, { recursive: true });
    }

    service = new AuditLogService({
      masterPassword: TEST_PASSWORD,
      auditLogDir: TEST_AUDIT_DIR,
    });
    await service.initialize();
  });

  afterEach(() => {
    service.clearMemory();
    if (fs.existsSync(TEST_AUDIT_DIR)) {
      fs.rmSync(TEST_AUDIT_DIR, { recursive: true });
    }
  });

  describe('addNote', () => {
    it('adds a note to an existing entry', async () => {
      // Create an entry first
      const entry = await service.logConnection({
        accountId: testAccountId,
        action: 'connect',
        brokerType: 'tradier',
        success: true,
      });

      // Add a note
      const updatedEntry = await service.addNote(testAccountId, entry.id, 'Test note content');

      expect(updatedEntry).not.toBeNull();
      expect(updatedEntry!.notes).toHaveLength(1);
      expect(updatedEntry!.notes![0]!.text).toBe('Test note content');
      expect(updatedEntry!.notes![0]!.id).toBeDefined();
      expect(updatedEntry!.notes![0]!.addedAt).toBeDefined();
    });

    it('adds multiple notes to an entry', async () => {
      const entry = await service.logConnection({
        accountId: testAccountId,
        action: 'connect',
        brokerType: 'tradier',
        success: true,
      });

      await service.addNote(testAccountId, entry.id, 'First note');
      const updatedEntry = await service.addNote(testAccountId, entry.id, 'Second note');

      expect(updatedEntry!.notes).toHaveLength(2);
      expect(updatedEntry!.notes![0]!.text).toBe('First note');
      expect(updatedEntry!.notes![1]!.text).toBe('Second note');
    });

    it('returns null for non-existent entry', async () => {
      const result = await service.addNote(testAccountId, 'non-existent-id', 'Note text');
      expect(result).toBeNull();
    });

    it('returns null for non-existent account', async () => {
      const result = await service.addNote('non-existent-account', 'entry-id', 'Note text');
      expect(result).toBeNull();
    });
  });

  describe('updateNote', () => {
    it('updates an existing note', async () => {
      const entry = await service.logConnection({
        accountId: testAccountId,
        action: 'connect',
        brokerType: 'tradier',
        success: true,
      });

      const entryWithNote = await service.addNote(testAccountId, entry.id, 'Original text');
      const noteId = entryWithNote!.notes![0]!.id;

      const updatedEntry = await service.updateNote(testAccountId, entry.id, noteId, 'Updated text');

      expect(updatedEntry).not.toBeNull();
      expect(updatedEntry!.notes![0]!.text).toBe('Updated text');
      expect(updatedEntry!.notes![0]!.updatedAt).toBeDefined();
    });

    it('returns null for non-existent note', async () => {
      const entry = await service.logConnection({
        accountId: testAccountId,
        action: 'connect',
        brokerType: 'tradier',
        success: true,
      });

      const result = await service.updateNote(testAccountId, entry.id, 'non-existent-note', 'Text');
      expect(result).toBeNull();
    });

    it('returns null for entry without notes', async () => {
      const entry = await service.logConnection({
        accountId: testAccountId,
        action: 'connect',
        brokerType: 'tradier',
        success: true,
      });

      const result = await service.updateNote(testAccountId, entry.id, 'note-id', 'Text');
      expect(result).toBeNull();
    });
  });

  describe('deleteNote', () => {
    it('deletes an existing note', async () => {
      const entry = await service.logConnection({
        accountId: testAccountId,
        action: 'connect',
        brokerType: 'tradier',
        success: true,
      });

      const entryWithNote = await service.addNote(testAccountId, entry.id, 'Note to delete');
      const noteId = entryWithNote!.notes![0]!.id;

      const updatedEntry = await service.deleteNote(testAccountId, entry.id, noteId);

      expect(updatedEntry).not.toBeNull();
      expect(updatedEntry!.notes).toBeUndefined();
    });

    it('removes notes array when last note is deleted', async () => {
      const entry = await service.logConnection({
        accountId: testAccountId,
        action: 'connect',
        brokerType: 'tradier',
        success: true,
      });

      const entryWithNote = await service.addNote(testAccountId, entry.id, 'Only note');
      const noteId = entryWithNote!.notes![0]!.id;

      const updatedEntry = await service.deleteNote(testAccountId, entry.id, noteId);

      expect(updatedEntry!.notes).toBeUndefined();
    });

    it('keeps other notes when one is deleted', async () => {
      const entry = await service.logConnection({
        accountId: testAccountId,
        action: 'connect',
        brokerType: 'tradier',
        success: true,
      });

      await service.addNote(testAccountId, entry.id, 'Keep this note');
      const entryWithNotes = await service.addNote(testAccountId, entry.id, 'Delete this note');
      const noteToDeleteId = entryWithNotes!.notes![1]!.id;

      const updatedEntry = await service.deleteNote(testAccountId, entry.id, noteToDeleteId);

      expect(updatedEntry!.notes).toHaveLength(1);
      expect(updatedEntry!.notes![0]!.text).toBe('Keep this note');
    });

    it('returns null for non-existent note', async () => {
      const entry = await service.logConnection({
        accountId: testAccountId,
        action: 'connect',
        brokerType: 'tradier',
        success: true,
      });

      await service.addNote(testAccountId, entry.id, 'Existing note');

      const result = await service.deleteNote(testAccountId, entry.id, 'non-existent-note');
      expect(result).toBeNull();
    });
  });

  describe('note persistence', () => {
    it('persists notes across service restarts', async () => {
      // Create entry with note
      const entry = await service.logConnection({
        accountId: testAccountId,
        action: 'connect',
        brokerType: 'tradier',
        success: true,
      });

      await service.addNote(testAccountId, entry.id, 'Persisted note');
      service.clearMemory();

      // Create new service instance and reload
      const newService = new AuditLogService({
        masterPassword: TEST_PASSWORD,
        auditLogDir: TEST_AUDIT_DIR,
      });
      await newService.initialize();

      // Verify note was persisted
      const loadedEntry = newService.getEntry(testAccountId, entry.id);
      expect(loadedEntry).not.toBeNull();
      expect(loadedEntry!.notes).toHaveLength(1);
      expect(loadedEntry!.notes![0]!.text).toBe('Persisted note');

      newService.clearMemory();
    });
  });
});
