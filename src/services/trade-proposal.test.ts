/**
 * Tests for Trade Proposal Service
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  TradeProposalService,
  type TradeProposalServiceOptions,
} from './trade-proposal.js';
import {
  type TradeProposal,
  type ProposalContract,
  type EntryPlan,
  type ExitPlan,
  type RiskAssessment,
  type DataSource,
  TradeProposalSchema,
  ProposalContractSchema,
  EntryPlanSchema,
  ExitPlanSchema,
  RiskAssessmentSchema,
  validateTradeProposal,
  formatStrategyType,
  formatConfidence,
  formatProposalStatus,
  calculateProposalCost,
  getProposalSummary,
} from '../types/trade-proposal.js';

// Test constants
const TEST_MASTER_PASSWORD = 'test-password-123';
const TEST_PROPOSAL_DIR = '.test-proposals';

// Helper to create a valid proposal
function createValidProposal(overrides?: Partial<TradeProposal>): TradeProposal {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 30);

  return {
    strategyType: 'long_call',
    underlying: 'AAPL',
    contracts: [
      {
        optionSymbol: 'AAPL240315C00180000',
        underlying: 'AAPL',
        strike: 180,
        expiration: tomorrow,
        optionType: 'call',
        side: 'buy',
        quantity: 1,
        targetPrice: 5.0,
      },
    ],
    thesis: ['Bullish on AAPL due to strong iPhone sales'],
    catalysts: ['Earnings report next week'],
    entryPlan: {
      orderType: 'limit',
      limitPrice: 5.0,
      timeInForce: 'day',
    },
    exitPlan: {
      profitTargets: [{ percentGain: 50, closePercent: 100 }],
      stopLoss: { type: 'percent', value: 50 },
    },
    risk: {
      maxLoss: 500,
      maxLossPercent: 1,
    },
    confidence: 'medium',
    dataUsed: [
      {
        sourceType: 'market_data',
        description: 'Current option prices',
        retrievedAt: new Date(),
      },
    ],
    ...overrides,
  };
}

// Cleanup helper
function cleanupTestDir(): void {
  if (fs.existsSync(TEST_PROPOSAL_DIR)) {
    const files = fs.readdirSync(TEST_PROPOSAL_DIR);
    for (const file of files) {
      fs.unlinkSync(path.join(TEST_PROPOSAL_DIR, file));
    }
    fs.rmdirSync(TEST_PROPOSAL_DIR);
  }
}

// ============================================================================
// Schema Tests
// ============================================================================

describe('Trade Proposal Schema', () => {
  describe('ProposalContractSchema', () => {
    it('should validate a valid contract', () => {
      const contract: ProposalContract = {
        optionSymbol: 'AAPL240315C00180000',
        underlying: 'AAPL',
        strike: 180,
        expiration: new Date('2024-03-15'),
        optionType: 'call',
        side: 'buy',
        quantity: 1,
      };
      const result = ProposalContractSchema.safeParse(contract);
      expect(result.success).toBe(true);
    });

    it('should reject negative strike', () => {
      const contract = {
        optionSymbol: 'TEST',
        underlying: 'TEST',
        strike: -180,
        expiration: new Date(),
        optionType: 'call',
        side: 'buy',
        quantity: 1,
      };
      const result = ProposalContractSchema.safeParse(contract);
      expect(result.success).toBe(false);
    });

    it('should reject zero quantity', () => {
      const contract = {
        optionSymbol: 'TEST',
        underlying: 'TEST',
        strike: 180,
        expiration: new Date(),
        optionType: 'call',
        side: 'buy',
        quantity: 0,
      };
      const result = ProposalContractSchema.safeParse(contract);
      expect(result.success).toBe(false);
    });

    it('should reject non-integer quantity', () => {
      const contract = {
        optionSymbol: 'TEST',
        underlying: 'TEST',
        strike: 180,
        expiration: new Date(),
        optionType: 'call',
        side: 'buy',
        quantity: 1.5,
      };
      const result = ProposalContractSchema.safeParse(contract);
      expect(result.success).toBe(false);
    });
  });

  describe('EntryPlanSchema', () => {
    it('should validate a limit order entry', () => {
      const entry: EntryPlan = {
        orderType: 'limit',
        limitPrice: 5.0,
        timeInForce: 'day',
      };
      const result = EntryPlanSchema.safeParse(entry);
      expect(result.success).toBe(true);
    });

    it('should validate a market order entry', () => {
      const entry: EntryPlan = {
        orderType: 'market',
        timeInForce: 'day',
        slippagePercent: 1,
      };
      const result = EntryPlanSchema.safeParse(entry);
      expect(result.success).toBe(true);
    });

    it('should reject invalid slippage percentage', () => {
      const entry = {
        orderType: 'market',
        timeInForce: 'day',
        slippagePercent: 150,
      };
      const result = EntryPlanSchema.safeParse(entry);
      expect(result.success).toBe(false);
    });
  });

  describe('ExitPlanSchema', () => {
    it('should validate a complete exit plan', () => {
      const exit: ExitPlan = {
        profitTargets: [
          { percentGain: 25, closePercent: 50 },
          { percentGain: 50, closePercent: 50 },
        ],
        stopLoss: { type: 'percent', value: 50 },
        maxHoldDays: 30,
      };
      const result = ExitPlanSchema.safeParse(exit);
      expect(result.success).toBe(true);
    });

    it('should require at least one profit target', () => {
      const exit = {
        profitTargets: [],
        stopLoss: { type: 'percent', value: 50 },
      };
      const result = ExitPlanSchema.safeParse(exit);
      expect(result.success).toBe(false);
    });

    it('should reject invalid profit target percentages', () => {
      const exit = {
        profitTargets: [{ percentGain: -10, closePercent: 100 }],
      };
      const result = ExitPlanSchema.safeParse(exit);
      expect(result.success).toBe(false);
    });
  });

  describe('RiskAssessmentSchema', () => {
    it('should validate a complete risk assessment', () => {
      const risk: RiskAssessment = {
        maxLoss: 500,
        maxLossPercent: 1,
        riskRewardRatio: 2,
        probabilityOfProfit: 45,
        breakEvenPrices: [185],
      };
      const result = RiskAssessmentSchema.safeParse(risk);
      expect(result.success).toBe(true);
    });

    it('should reject negative max loss', () => {
      const risk = {
        maxLoss: -500,
      };
      const result = RiskAssessmentSchema.safeParse(risk);
      expect(result.success).toBe(false);
    });

    it('should reject probability over 100', () => {
      const risk = {
        maxLoss: 500,
        probabilityOfProfit: 150,
      };
      const result = RiskAssessmentSchema.safeParse(risk);
      expect(result.success).toBe(false);
    });
  });

  describe('TradeProposalSchema', () => {
    it('should validate a complete trade proposal', () => {
      const proposal = createValidProposal();
      const result = TradeProposalSchema.safeParse(proposal);
      expect(result.success).toBe(true);
    });

    it('should require at least one contract', () => {
      const proposal = createValidProposal({ contracts: [] });
      const result = TradeProposalSchema.safeParse(proposal);
      expect(result.success).toBe(false);
    });

    it('should require at least one thesis point', () => {
      const proposal = createValidProposal({ thesis: [] });
      const result = TradeProposalSchema.safeParse(proposal);
      expect(result.success).toBe(false);
    });

    it('should allow empty catalysts', () => {
      const proposal = createValidProposal({ catalysts: [] });
      const result = TradeProposalSchema.safeParse(proposal);
      expect(result.success).toBe(true);
    });
  });
});

// ============================================================================
// Validation Tests
// ============================================================================

describe('Trade Proposal Validation', () => {
  it('should validate a valid proposal with no errors', () => {
    const proposal = createValidProposal();
    const result = validateTradeProposal(proposal);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should warn about high confidence with few data sources', () => {
    const proposal = createValidProposal({
      confidence: 'high',
      dataUsed: [{ sourceType: 'market_data', description: 'Prices', retrievedAt: new Date() }],
    });
    const result = validateTradeProposal(proposal);
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.includes('High confidence'))).toBe(true);
  });

  it('should warn about missing stop loss', () => {
    const proposal = createValidProposal({
      exitPlan: {
        profitTargets: [{ percentGain: 50, closePercent: 100 }],
      },
    });
    const result = validateTradeProposal(proposal);
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.includes('No stop loss'))).toBe(true);
  });

  it('should warn about large position sizes', () => {
    const proposal = createValidProposal();
    proposal.contracts[0].quantity = 15;
    const result = validateTradeProposal(proposal);
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.includes('Large position'))).toBe(true);
  });

  it('should warn about market orders without slippage', () => {
    const proposal = createValidProposal({
      entryPlan: {
        orderType: 'market',
        timeInForce: 'day',
      },
    });
    const result = validateTradeProposal(proposal);
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.includes('Market order'))).toBe(true);
  });

  it('should warn about profit targets not totaling 100%', () => {
    const proposal = createValidProposal({
      exitPlan: {
        profitTargets: [{ percentGain: 50, closePercent: 50 }],
        stopLoss: { type: 'percent', value: 50 },
      },
    });
    const result = validateTradeProposal(proposal);
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.includes('50% of position'))).toBe(true);
  });

  it('should warn about no catalysts', () => {
    const proposal = createValidProposal({ catalysts: [] });
    const result = validateTradeProposal(proposal);
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.includes('No catalysts'))).toBe(true);
  });

  it('should warn about short DTE options', () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 3);
    const proposal = createValidProposal();
    proposal.contracts[0].expiration = tomorrow;
    const result = validateTradeProposal(proposal);
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.includes('DTE'))).toBe(true);
  });

  it('should return errors for invalid proposals', () => {
    const result = validateTradeProposal({});
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// Helper Function Tests
// ============================================================================

describe('Trade Proposal Helpers', () => {
  describe('formatStrategyType', () => {
    it('should format all strategy types', () => {
      expect(formatStrategyType('long_call')).toBe('Long Call');
      expect(formatStrategyType('long_put')).toBe('Long Put');
      expect(formatStrategyType('short_call')).toBe('Short Call');
      expect(formatStrategyType('short_put')).toBe('Short Put');
      expect(formatStrategyType('covered_call')).toBe('Covered Call');
      expect(formatStrategyType('cash_secured_put')).toBe('Cash-Secured Put');
      expect(formatStrategyType('vertical_spread')).toBe('Vertical Spread');
      expect(formatStrategyType('calendar_spread')).toBe('Calendar Spread');
      expect(formatStrategyType('iron_condor')).toBe('Iron Condor');
      expect(formatStrategyType('straddle')).toBe('Straddle');
      expect(formatStrategyType('strangle')).toBe('Strangle');
      expect(formatStrategyType('custom')).toBe('Custom Strategy');
    });
  });

  describe('formatConfidence', () => {
    it('should format all confidence levels', () => {
      expect(formatConfidence('low')).toBe('Low Confidence');
      expect(formatConfidence('medium')).toBe('Medium Confidence');
      expect(formatConfidence('high')).toBe('High Confidence');
    });
  });

  describe('formatProposalStatus', () => {
    it('should format all statuses', () => {
      expect(formatProposalStatus('draft')).toBe('Draft');
      expect(formatProposalStatus('approved')).toBe('Approved');
      expect(formatProposalStatus('rejected')).toBe('Rejected');
      expect(formatProposalStatus('executed')).toBe('Executed');
    });
  });

  describe('calculateProposalCost', () => {
    it('should calculate debit for long positions', () => {
      const proposal = createValidProposal();
      proposal.contracts[0].targetPrice = 5.0;
      proposal.contracts[0].quantity = 2;
      const cost = calculateProposalCost(proposal);
      expect(cost).toBe(1000); // 5 * 2 * 100
    });

    it('should calculate credit for short positions', () => {
      const proposal = createValidProposal();
      proposal.contracts[0].side = 'sell';
      proposal.contracts[0].targetPrice = 5.0;
      proposal.contracts[0].quantity = 2;
      const cost = calculateProposalCost(proposal);
      expect(cost).toBe(-1000); // -(5 * 2 * 100)
    });

    it('should calculate net for spread positions', () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 30);
      const proposal = createValidProposal({
        strategyType: 'vertical_spread',
        contracts: [
          {
            optionSymbol: 'AAPL240315C00180000',
            underlying: 'AAPL',
            strike: 180,
            expiration: tomorrow,
            optionType: 'call',
            side: 'buy',
            quantity: 1,
            targetPrice: 5.0,
          },
          {
            optionSymbol: 'AAPL240315C00185000',
            underlying: 'AAPL',
            strike: 185,
            expiration: tomorrow,
            optionType: 'call',
            side: 'sell',
            quantity: 1,
            targetPrice: 3.0,
          },
        ],
      });
      const cost = calculateProposalCost(proposal);
      expect(cost).toBe(200); // (5 - 3) * 1 * 100
    });

    it('should handle undefined target prices as 0', () => {
      const proposal = createValidProposal();
      proposal.contracts[0].targetPrice = undefined;
      const cost = calculateProposalCost(proposal);
      expect(cost).toBe(0);
    });
  });

  describe('getProposalSummary', () => {
    it('should return a readable summary', () => {
      const proposal = createValidProposal();
      proposal.contracts[0].targetPrice = 5.0;
      const summary = getProposalSummary(proposal);
      expect(summary).toContain('Long Call');
      expect(summary).toContain('AAPL');
      expect(summary).toContain('1 contracts');
      expect(summary).toContain('debit');
    });

    it('should indicate credit for selling', () => {
      const proposal = createValidProposal();
      proposal.contracts[0].side = 'sell';
      proposal.contracts[0].targetPrice = 5.0;
      const summary = getProposalSummary(proposal);
      expect(summary).toContain('credit');
    });
  });
});

// ============================================================================
// Service Tests
// ============================================================================

describe('TradeProposalService', () => {
  let service: TradeProposalService;
  const testAccountId = 'test-account-123';

  beforeEach(async () => {
    cleanupTestDir();
    service = new TradeProposalService({
      masterPassword: TEST_MASTER_PASSWORD,
      proposalDir: TEST_PROPOSAL_DIR,
    });
    await service.initialize();
  });

  afterEach(() => {
    service.clearMemory();
    cleanupTestDir();
  });

  describe('constructor', () => {
    it('should throw if password is too short', () => {
      expect(() => {
        new TradeProposalService({ masterPassword: 'short' });
      }).toThrow('Master password must be at least 8 characters');
    });

    it('should accept a valid password', () => {
      expect(() => {
        new TradeProposalService({ masterPassword: TEST_MASTER_PASSWORD });
      }).not.toThrow();
    });
  });

  describe('createProposal', () => {
    it('should create a proposal with draft status by default', async () => {
      const proposal = createValidProposal();
      const stored = await service.createProposal(testAccountId, proposal);

      expect(stored.id).toBeDefined();
      expect(stored.accountId).toBe(testAccountId);
      expect(stored.status).toBe('draft');
      expect(stored.proposal.underlying).toBe('AAPL');
      expect(stored.createdAt).toBeInstanceOf(Date);
      expect(stored.updatedAt).toBeInstanceOf(Date);
    });

    it('should create a proposal with custom status', async () => {
      const proposal = createValidProposal();
      const stored = await service.createProposal(testAccountId, proposal, {
        status: 'approved',
      });
      expect(stored.status).toBe('approved');
    });

    it('should create a proposal with createdBy', async () => {
      const proposal = createValidProposal();
      const stored = await service.createProposal(testAccountId, proposal, {
        createdBy: 'portfolio-review-agent',
      });
      expect(stored.createdBy).toBe('portfolio-review-agent');
    });

    it('should throw on invalid proposal', async () => {
      const invalidProposal = { ...createValidProposal(), contracts: [] };
      await expect(service.createProposal(testAccountId, invalidProposal)).rejects.toThrow(
        'Invalid trade proposal'
      );
    });
  });

  describe('getProposal', () => {
    it('should retrieve a proposal by ID', async () => {
      const proposal = createValidProposal();
      const created = await service.createProposal(testAccountId, proposal);
      const retrieved = service.getProposal(testAccountId, created.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe(created.id);
    });

    it('should return null for non-existent proposal', () => {
      const retrieved = service.getProposal(testAccountId, 'non-existent-id');
      expect(retrieved).toBeNull();
    });

    it('should return null for wrong account', async () => {
      const proposal = createValidProposal();
      const created = await service.createProposal(testAccountId, proposal);
      const retrieved = service.getProposal('other-account', created.id);
      expect(retrieved).toBeNull();
    });
  });

  describe('getAllProposals', () => {
    it('should return all proposals for an account', async () => {
      const proposal1 = createValidProposal({ underlying: 'AAPL' });
      const proposal2 = createValidProposal({ underlying: 'MSFT' });

      await service.createProposal(testAccountId, proposal1);
      await service.createProposal(testAccountId, proposal2);

      const all = service.getAllProposals(testAccountId);
      expect(all).toHaveLength(2);
    });

    it('should filter by status', async () => {
      const proposal1 = createValidProposal();
      const proposal2 = createValidProposal();

      await service.createProposal(testAccountId, proposal1, { status: 'draft' });
      await service.createProposal(testAccountId, proposal2, { status: 'approved' });

      const drafts = service.getAllProposals(testAccountId, { status: 'draft' });
      expect(drafts).toHaveLength(1);
      expect(drafts[0].status).toBe('draft');
    });

    it('should filter by multiple statuses', async () => {
      await service.createProposal(testAccountId, createValidProposal(), { status: 'draft' });
      await service.createProposal(testAccountId, createValidProposal(), { status: 'approved' });
      await service.createProposal(testAccountId, createValidProposal(), { status: 'rejected' });

      const filtered = service.getAllProposals(testAccountId, {
        status: ['draft', 'approved'],
      });
      expect(filtered).toHaveLength(2);
    });

    it('should filter by underlying', async () => {
      await service.createProposal(testAccountId, createValidProposal({ underlying: 'AAPL' }));
      await service.createProposal(testAccountId, createValidProposal({ underlying: 'MSFT' }));

      const filtered = service.getAllProposals(testAccountId, { underlying: 'AAPL' });
      expect(filtered).toHaveLength(1);
      expect(filtered[0].proposal.underlying).toBe('AAPL');
    });

    it('should limit results', async () => {
      await service.createProposal(testAccountId, createValidProposal());
      await service.createProposal(testAccountId, createValidProposal());
      await service.createProposal(testAccountId, createValidProposal());

      const limited = service.getAllProposals(testAccountId, { limit: 2 });
      expect(limited).toHaveLength(2);
    });

    it('should sort by newest first by default', async () => {
      const p1 = await service.createProposal(testAccountId, createValidProposal());
      await new Promise((r) => setTimeout(r, 10));
      const p2 = await service.createProposal(testAccountId, createValidProposal());

      const all = service.getAllProposals(testAccountId);
      expect(all[0].id).toBe(p2.id);
      expect(all[1].id).toBe(p1.id);
    });

    it('should sort by oldest first when specified', async () => {
      const p1 = await service.createProposal(testAccountId, createValidProposal());
      await new Promise((r) => setTimeout(r, 10));
      const p2 = await service.createProposal(testAccountId, createValidProposal());

      const all = service.getAllProposals(testAccountId, { sortOrder: 'oldest' });
      expect(all[0].id).toBe(p1.id);
      expect(all[1].id).toBe(p2.id);
    });
  });

  describe('updateProposal', () => {
    it('should update proposal content', async () => {
      const proposal = createValidProposal({ underlying: 'AAPL' });
      const created = await service.createProposal(testAccountId, proposal);

      const updated = await service.updateProposal(testAccountId, created.id, {
        underlying: 'MSFT',
      });

      expect(updated.proposal.underlying).toBe('MSFT');
      expect(updated.updatedAt.getTime()).toBeGreaterThan(created.updatedAt.getTime());
    });

    it('should throw on non-existent proposal', async () => {
      // First create a proposal so the account exists
      await service.createProposal(testAccountId, createValidProposal());
      // Then try to update a non-existent one
      await expect(
        service.updateProposal(testAccountId, 'non-existent', { underlying: 'MSFT' })
      ).rejects.toThrow('not found');
    });

    it('should throw on executed proposal', async () => {
      const proposal = createValidProposal();
      const created = await service.createProposal(testAccountId, proposal);
      await service.approveProposal(testAccountId, created.id);
      await service.markExecuted(testAccountId, created.id, 'order-123');

      await expect(
        service.updateProposal(testAccountId, created.id, { underlying: 'MSFT' })
      ).rejects.toThrow('Cannot update an executed proposal');
    });

    it('should validate updated proposal', async () => {
      const proposal = createValidProposal();
      const created = await service.createProposal(testAccountId, proposal);

      await expect(
        service.updateProposal(testAccountId, created.id, { contracts: [] })
      ).rejects.toThrow('Invalid trade proposal');
    });
  });

  describe('status transitions', () => {
    it('should approve a draft proposal', async () => {
      const created = await service.createProposal(testAccountId, createValidProposal());
      const approved = await service.approveProposal(testAccountId, created.id);
      expect(approved.status).toBe('approved');
    });

    it('should reject a draft proposal', async () => {
      const created = await service.createProposal(testAccountId, createValidProposal());
      const rejected = await service.rejectProposal(testAccountId, created.id, 'Too risky');

      expect(rejected.status).toBe('rejected');
      expect(rejected.rejectionReason).toBe('Too risky');
    });

    it('should mark approved proposal as executed', async () => {
      const created = await service.createProposal(testAccountId, createValidProposal());
      await service.approveProposal(testAccountId, created.id);
      const executed = await service.markExecuted(testAccountId, created.id, 'order-456');

      expect(executed.status).toBe('executed');
      expect(executed.executedOrderId).toBe('order-456');
    });

    it('should not allow invalid status transitions', async () => {
      const created = await service.createProposal(testAccountId, createValidProposal());

      // Can't go directly from draft to executed
      await expect(
        service.updateStatus(testAccountId, created.id, 'executed')
      ).rejects.toThrow('Invalid status transition');
    });

    it('should not allow transitions from executed', async () => {
      const created = await service.createProposal(testAccountId, createValidProposal());
      await service.approveProposal(testAccountId, created.id);
      await service.markExecuted(testAccountId, created.id, 'order-789');

      await expect(
        service.updateStatus(testAccountId, created.id, 'draft')
      ).rejects.toThrow('Invalid status transition');
    });

    it('should allow re-drafting a rejected proposal', async () => {
      const created = await service.createProposal(testAccountId, createValidProposal());
      await service.rejectProposal(testAccountId, created.id, 'Not now');
      const reDrafted = await service.updateStatus(testAccountId, created.id, 'draft');

      expect(reDrafted.status).toBe('draft');
    });
  });

  describe('deleteProposal', () => {
    it('should delete a draft proposal', async () => {
      const created = await service.createProposal(testAccountId, createValidProposal());
      const result = await service.deleteProposal(testAccountId, created.id);

      expect(result).toBe(true);
      expect(service.getProposal(testAccountId, created.id)).toBeNull();
    });

    it('should delete a rejected proposal', async () => {
      const created = await service.createProposal(testAccountId, createValidProposal());
      await service.rejectProposal(testAccountId, created.id, 'reason');
      const result = await service.deleteProposal(testAccountId, created.id);

      expect(result).toBe(true);
    });

    it('should not delete an approved proposal', async () => {
      const created = await service.createProposal(testAccountId, createValidProposal());
      await service.approveProposal(testAccountId, created.id);

      await expect(service.deleteProposal(testAccountId, created.id)).rejects.toThrow(
        'Cannot delete approved proposal'
      );
    });

    it('should not delete an executed proposal', async () => {
      const created = await service.createProposal(testAccountId, createValidProposal());
      await service.approveProposal(testAccountId, created.id);
      await service.markExecuted(testAccountId, created.id, 'order-123');

      await expect(service.deleteProposal(testAccountId, created.id)).rejects.toThrow(
        'Cannot delete executed proposal'
      );
    });

    it('should return false for non-existent proposal', async () => {
      const result = await service.deleteProposal(testAccountId, 'non-existent');
      expect(result).toBe(false);
    });
  });

  describe('persistence', () => {
    it('should persist proposals across service restarts', async () => {
      const proposal = createValidProposal({ underlying: 'GOOG' });
      const created = await service.createProposal(testAccountId, proposal);
      service.clearMemory();

      // Create new service and initialize
      const newService = new TradeProposalService({
        masterPassword: TEST_MASTER_PASSWORD,
        proposalDir: TEST_PROPOSAL_DIR,
      });
      await newService.initialize();

      const loaded = newService.getProposal(testAccountId, created.id);
      expect(loaded).not.toBeNull();
      expect(loaded?.proposal.underlying).toBe('GOOG');
      expect(loaded?.createdAt).toBeInstanceOf(Date);

      newService.clearMemory();
    });

    it('should persist status changes', async () => {
      const created = await service.createProposal(testAccountId, createValidProposal());
      await service.approveProposal(testAccountId, created.id);
      service.clearMemory();

      const newService = new TradeProposalService({
        masterPassword: TEST_MASTER_PASSWORD,
        proposalDir: TEST_PROPOSAL_DIR,
      });
      await newService.initialize();

      const loaded = newService.getProposal(testAccountId, created.id);
      expect(loaded?.status).toBe('approved');

      newService.clearMemory();
    });

    it('should delete file when all proposals removed', async () => {
      const created = await service.createProposal(testAccountId, createValidProposal());
      await service.deleteProposal(testAccountId, created.id);

      const files = fs.readdirSync(TEST_PROPOSAL_DIR);
      expect(files).toHaveLength(0);
    });
  });

  describe('statistics', () => {
    it('should count proposals by status', async () => {
      await service.createProposal(testAccountId, createValidProposal(), { status: 'draft' });
      await service.createProposal(testAccountId, createValidProposal(), { status: 'draft' });
      await service.createProposal(testAccountId, createValidProposal(), { status: 'approved' });

      const counts = service.countByStatus(testAccountId);
      expect(counts.draft).toBe(2);
      expect(counts.approved).toBe(1);
      expect(counts.rejected).toBe(0);
      expect(counts.executed).toBe(0);
    });

    it('should return statistics', async () => {
      await service.createProposal(testAccountId, createValidProposal({ underlying: 'AAPL' }));
      await service.createProposal(testAccountId, createValidProposal({ underlying: 'AAPL' }));
      await service.createProposal(testAccountId, createValidProposal({ underlying: 'MSFT' }));

      const stats = service.getStatistics(testAccountId);
      expect(stats.total).toBe(3);
      expect(stats.byUnderlying['AAPL']).toBe(2);
      expect(stats.byUnderlying['MSFT']).toBe(1);
    });
  });

  describe('multi-account isolation', () => {
    it('should keep proposals separate per account', async () => {
      await service.createProposal('account-1', createValidProposal());
      await service.createProposal('account-1', createValidProposal());
      await service.createProposal('account-2', createValidProposal());

      expect(service.getAllProposals('account-1')).toHaveLength(2);
      expect(service.getAllProposals('account-2')).toHaveLength(1);
    });
  });
});
