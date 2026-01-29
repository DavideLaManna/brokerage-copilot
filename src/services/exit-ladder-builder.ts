/**
 * Exit Ladder Builder Service
 *
 * Builds staged profit-taking orders (exit ladders) from existing positions.
 * Allows users to systematically lock in gains at predetermined price targets.
 *
 * Example targets: [+25%, +50%, +100%] premium gain
 * - At 25% profit: close 1/3 of position
 * - At 50% profit: close 1/3 of position
 * - At 100% profit: close remaining 1/3
 */

import { randomUUID } from 'crypto';
import { z } from 'zod';
import type {
  Position,
  OrderRequest,
  AccountSummary,
  Quote,
  OptionContract,
} from '../types/broker.js';
import type { RiskConfig } from '../types/risk-config.js';
import type { DraftOrder, BuildDraftOrdersResult } from './draft-order-builder.js';
import { generateIdempotencyKey, generateCorrelationId } from './draft-order-builder.js';
import { RiskEngine, type OrderValidationResult, type ValidationContext } from './risk-engine.js';

// ============================================================================
// Types
// ============================================================================

/**
 * A single rung in an exit ladder
 */
export interface ExitLadderRung {
  /** Target profit percentage (e.g., 25 means +25% profit) */
  targetProfitPercent: number;
  /** Percentage of remaining position to close at this target (1-100) */
  closePercent: number;
}

export const ExitLadderRungSchema = z.object({
  targetProfitPercent: z.number().positive('Target profit must be positive'),
  closePercent: z.number().min(1).max(100, 'Close percent must be 1-100'),
});

/**
 * Configuration for building an exit ladder
 */
export interface ExitLadderConfig {
  /** Ladder rungs defining profit targets and close percentages */
  rungs: ExitLadderRung[];
  /** Order type for exit orders (default: 'limit') */
  orderType?: 'limit' | 'market';
  /** Time in force for exit orders (default: 'gtc') */
  timeInForce?: 'day' | 'gtc' | 'ioc' | 'fok';
  /** Whether to validate each order against risk rules (default: true) */
  validateOrders?: boolean;
}

export const ExitLadderConfigSchema = z.object({
  rungs: z.array(ExitLadderRungSchema).min(1, 'At least one rung required'),
  orderType: z.enum(['limit', 'market']).optional(),
  timeInForce: z.enum(['day', 'gtc', 'ioc', 'fok']).optional(),
  validateOrders: z.boolean().optional(),
});

/**
 * Default exit ladder configuration with common profit targets
 */
export const DEFAULT_EXIT_LADDER_CONFIG: Required<Omit<ExitLadderConfig, 'rungs'>> = {
  orderType: 'limit',
  timeInForce: 'gtc',
  validateOrders: true,
};

/**
 * Common preset ladder configurations
 */
export const PRESET_LADDERS = {
  /** Conservative: take profits early and often */
  conservative: [
    { targetProfitPercent: 15, closePercent: 34 },
    { targetProfitPercent: 30, closePercent: 33 },
    { targetProfitPercent: 50, closePercent: 33 },
  ] as ExitLadderRung[],
  /** Standard: balanced profit targets */
  standard: [
    { targetProfitPercent: 25, closePercent: 34 },
    { targetProfitPercent: 50, closePercent: 33 },
    { targetProfitPercent: 100, closePercent: 33 },
  ] as ExitLadderRung[],
  /** Aggressive: let winners run longer */
  aggressive: [
    { targetProfitPercent: 50, closePercent: 25 },
    { targetProfitPercent: 100, closePercent: 25 },
    { targetProfitPercent: 200, closePercent: 50 },
  ] as ExitLadderRung[],
} as const;

/**
 * A calculated order in the exit ladder
 */
export interface ExitLadderOrder {
  /** The draft order ready for submission */
  draftOrder: DraftOrder;
  /** Which rung this order corresponds to */
  rungIndex: number;
  /** Target profit percentage for this rung */
  targetProfitPercent: number;
  /** Calculated exit price based on target profit */
  exitPrice: number;
  /** Number of contracts to close */
  contractsToClose: number;
  /** Current price used for calculation */
  currentPrice: number;
  /** Cost basis used for calculation */
  costBasis: number;
  /** Estimated credit if filled (positive = receive cash) */
  estimatedCredit: number;
  /** Estimated profit if filled */
  estimatedProfit: number;
  /** Risk validation result (if validation was performed) */
  validationResult?: OrderValidationResult;
}

/**
 * Result of building an exit ladder
 */
export interface ExitLadderProposal {
  /** Unique proposal ID */
  proposalId: string;
  /** Source position */
  position: Position;
  /** Individual ladder orders */
  orders: ExitLadderOrder[];
  /** Correlation ID linking all orders */
  correlationId: string;
  /** Total contracts being exited across all rungs */
  totalContractsToExit: number;
  /** Contracts remaining after ladder completes */
  contractsRemaining: number;
  /** Total estimated credit if all orders fill */
  totalEstimatedCredit: number;
  /** Total estimated profit if all orders fill */
  totalEstimatedProfit: number;
  /** Summary of validation results */
  validationSummary: {
    /** Whether all orders passed validation */
    allPassed: boolean;
    /** Number of orders that passed */
    passedCount: number;
    /** Number of orders that failed */
    failedCount: number;
    /** Aggregated failure reasons */
    failureReasons: string[];
  };
  /** Warnings about the ladder */
  warnings: string[];
  /** Configuration used to build the ladder */
  config: ExitLadderConfig;
  /** Timestamp when proposal was created */
  createdAt: Date;
}

/**
 * Validation context for exit ladder orders
 */
export interface ExitLadderValidationContext {
  /** Risk configuration */
  riskConfig: RiskConfig;
  /** Account summary */
  account: AccountSummary;
  /** Current positions (excluding the position being exited) */
  otherPositions: Position[];
  /** Quote for the contract being exited */
  quote?: Quote | OptionContract;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Calculate the exit price for a given profit target
 *
 * @param costBasis - Average cost per contract
 * @param targetProfitPercent - Target profit percentage (e.g., 25 for +25%)
 * @returns Exit price that would achieve the target profit
 */
export function calculateExitPrice(costBasis: number, targetProfitPercent: number): number {
  const exitPrice = costBasis * (1 + targetProfitPercent / 100);
  // Round to 2 decimal places (standard option pricing)
  return Math.round(exitPrice * 100) / 100;
}

/**
 * Calculate the number of contracts to close for a rung
 *
 * @param totalQuantity - Total position quantity
 * @param closePercent - Percentage to close (1-100)
 * @param previouslyClosed - Contracts already allocated to earlier rungs
 * @param isLastRung - Whether this is the last rung (should take remaining)
 * @returns Number of contracts to close (integer, at least 1 if position available)
 */
export function calculateContractsToClose(
  totalQuantity: number,
  closePercent: number,
  previouslyClosed: number,
  isLastRung: boolean = false
): number {
  const remainingQuantity = totalQuantity - previouslyClosed;
  if (remainingQuantity <= 0) {
    return 0;
  }

  // If this is the last rung, take all remaining contracts
  if (isLastRung) {
    return remainingQuantity;
  }

  // Calculate contracts based on percentage of ORIGINAL quantity
  const contractsFromPercent = Math.floor((totalQuantity * closePercent) / 100);

  // Ensure at least 1 contract if there are contracts remaining
  const contracts = Math.max(1, contractsFromPercent);

  // Don't exceed remaining quantity
  return Math.min(contracts, remainingQuantity);
}

/**
 * Validate that rungs close approximately 100% of the position
 *
 * @param rungs - Exit ladder rungs
 * @returns Validation result
 */
export function validateRungPercentages(rungs: ExitLadderRung[]): {
  valid: boolean;
  totalPercent: number;
  warning?: string;
} {
  const totalPercent = rungs.reduce((sum, rung) => sum + rung.closePercent, 0);

  if (totalPercent < 95) {
    return {
      valid: false,
      totalPercent,
      warning: `Rungs only close ${totalPercent}% of position - ${100 - totalPercent}% will remain`,
    };
  }

  if (totalPercent > 100) {
    return {
      valid: false,
      totalPercent,
      warning: `Rungs attempt to close ${totalPercent}% - exceeds 100%`,
    };
  }

  return { valid: true, totalPercent };
}

/**
 * Validate an exit ladder configuration
 */
export function validateExitLadderConfig(config: ExitLadderConfig): {
  valid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Validate schema
  const schemaResult = ExitLadderConfigSchema.safeParse(config);
  if (!schemaResult.success) {
    errors.push(...schemaResult.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`));
    return { valid: false, errors, warnings };
  }

  // Validate rungs are in ascending order by profit target
  const sortedRungs = [...config.rungs].sort(
    (a, b) => a.targetProfitPercent - b.targetProfitPercent
  );
  const isSorted = config.rungs.every(
    (rung, i) => rung.targetProfitPercent === sortedRungs[i]!.targetProfitPercent
  );
  if (!isSorted) {
    warnings.push('Rungs are not in ascending order by profit target - consider reordering');
  }

  // Validate total close percentage
  const percentResult = validateRungPercentages(config.rungs);
  if (!percentResult.valid && percentResult.warning) {
    if (percentResult.totalPercent > 100) {
      errors.push(percentResult.warning);
    } else {
      warnings.push(percentResult.warning);
    }
  }

  // Check for duplicate profit targets
  const targets = config.rungs.map((r) => r.targetProfitPercent);
  const uniqueTargets = new Set(targets);
  if (uniqueTargets.size !== targets.length) {
    errors.push('Duplicate profit targets found - each rung must have a unique target');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// ============================================================================
// Exit Ladder Builder
// ============================================================================

/**
 * Build an exit ladder proposal from a position
 *
 * Creates a structured proposal with multiple limit sell orders at calculated
 * profit target prices. Each order is validated against risk rules.
 *
 * @param position - The position to create exit orders for
 * @param config - Exit ladder configuration (rungs, order type, etc.)
 * @param validationContext - Optional context for risk validation
 * @returns Exit ladder proposal ready for approval
 */
export function proposeExitLadder(
  position: Position,
  config: ExitLadderConfig,
  validationContext?: ExitLadderValidationContext
): ExitLadderProposal {
  const warnings: string[] = [];
  const proposalId = randomUUID();
  const correlationId = generateCorrelationId();
  const createdAt = new Date();

  // Merge with defaults
  const mergedConfig: Required<ExitLadderConfig> = {
    ...DEFAULT_EXIT_LADDER_CONFIG,
    ...config,
    rungs: config.rungs,
  };

  // Validate configuration
  const configValidation = validateExitLadderConfig(mergedConfig);
  if (!configValidation.valid) {
    warnings.push(...configValidation.errors);
  }
  warnings.push(...configValidation.warnings);

  // Validate position is suitable for exit ladder
  if (position.quantity <= 0) {
    warnings.push('Position quantity must be positive (long position) for exit ladder');
  }

  if (position.assetClass !== 'option') {
    warnings.push('Exit ladders are designed for option positions');
  }

  // Create risk engine for validation
  const riskEngine = mergedConfig.validateOrders ? new RiskEngine() : undefined;

  // Build orders for each rung
  const orders: ExitLadderOrder[] = [];
  let contractsAllocated = 0;
  let totalEstimatedCredit = 0;
  let totalEstimatedProfit = 0;
  const failureReasons: string[] = [];

  const totalQuantity = Math.abs(position.quantity);
  const costBasis = position.averageCost;
  const currentPrice = position.currentPrice;

  // Sort rungs by profit target (lowest first)
  const sortedRungs = [...mergedConfig.rungs].sort(
    (a, b) => a.targetProfitPercent - b.targetProfitPercent
  );

  for (let i = 0; i < sortedRungs.length; i++) {
    const rung = sortedRungs[i]!;
    const isLastRung = i === sortedRungs.length - 1;

    // Calculate contracts for this rung
    const contractsToClose = calculateContractsToClose(
      totalQuantity,
      rung.closePercent,
      contractsAllocated,
      isLastRung
    );

    if (contractsToClose === 0) {
      warnings.push(
        `Rung ${i + 1} (${rung.targetProfitPercent}% target): no contracts remaining to allocate`
      );
      continue;
    }

    // Calculate exit price for this target
    const exitPrice = calculateExitPrice(costBasis, rung.targetProfitPercent);

    // Check if exit price makes sense
    if (exitPrice <= 0) {
      warnings.push(
        `Rung ${i + 1}: calculated exit price ${exitPrice} is invalid (cost basis: ${costBasis})`
      );
      continue;
    }

    // Build the order request
    const orderRequest: OrderRequest = {
      symbol: position.optionDetails?.optionSymbol || position.symbol,
      assetClass: position.assetClass,
      side: 'sell', // Exit = sell for long positions
      orderType: mergedConfig.orderType,
      timeInForce: mergedConfig.timeInForce,
      quantity: contractsToClose,
      limitPrice: mergedConfig.orderType === 'limit' ? exitPrice : undefined,
      clientOrderId: generateIdempotencyKey(),
      optionDetails: position.optionDetails
        ? {
            underlying: position.optionDetails.underlying,
            strike: position.optionDetails.strike,
            expiration: position.optionDetails.expiration,
            optionType: position.optionDetails.optionType,
          }
        : undefined,
    };

    // Calculate financials
    const multiplier = position.optionDetails?.multiplier || 100;
    const estimatedCredit = exitPrice * contractsToClose * multiplier;
    const costForContracts = costBasis * contractsToClose * multiplier;
    const estimatedProfit = estimatedCredit - costForContracts;

    // Create draft order
    const draftOrder: DraftOrder = {
      orderRequest,
      idempotencyKey: orderRequest.clientOrderId!,
      proposalId,
      legIndex: i,
      contractInfo: {
        underlying: position.optionDetails?.underlying || position.symbol,
        strike: position.optionDetails?.strike || 0,
        expiration: position.optionDetails?.expiration || new Date(),
        optionType: position.optionDetails?.optionType || 'call',
        side: 'sell',
        quantity: contractsToClose,
        targetPrice: exitPrice,
      },
      estimatedCost: -estimatedCredit, // Negative because we're receiving credit
      createdAt,
    };

    // Validate order if context provided
    let validationResult: OrderValidationResult | undefined;
    if (riskEngine && validationContext) {
      const validationCtx: ValidationContext = {
        config: validationContext.riskConfig,
        account: validationContext.account,
        positions: validationContext.otherPositions,
        quote: validationContext.quote,
      };
      validationResult = riskEngine.validateOrder(orderRequest, validationCtx);

      if (!validationResult.valid) {
        failureReasons.push(
          `Rung ${i + 1} (${rung.targetProfitPercent}% target): ${validationResult.rejectionReasons.join(', ')}`
        );
      }
    }

    // Add to orders
    orders.push({
      draftOrder,
      rungIndex: i,
      targetProfitPercent: rung.targetProfitPercent,
      exitPrice,
      contractsToClose,
      currentPrice,
      costBasis,
      estimatedCredit,
      estimatedProfit,
      validationResult,
    });

    contractsAllocated += contractsToClose;
    totalEstimatedCredit += estimatedCredit;
    totalEstimatedProfit += estimatedProfit;
  }

  // Calculate contracts remaining
  const contractsRemaining = totalQuantity - contractsAllocated;

  if (contractsRemaining > 0 && contractsRemaining < totalQuantity) {
    warnings.push(
      `${contractsRemaining} contract(s) will remain after ladder completes (${Math.round((contractsRemaining / totalQuantity) * 100)}% of position)`
    );
  }

  // Build validation summary
  const passedCount = orders.filter((o) => o.validationResult?.valid !== false).length;
  const failedCount = orders.filter((o) => o.validationResult?.valid === false).length;

  return {
    proposalId,
    position,
    orders,
    correlationId,
    totalContractsToExit: contractsAllocated,
    contractsRemaining,
    totalEstimatedCredit: Math.round(totalEstimatedCredit * 100) / 100,
    totalEstimatedProfit: Math.round(totalEstimatedProfit * 100) / 100,
    validationSummary: {
      allPassed: failedCount === 0,
      passedCount,
      failedCount,
      failureReasons,
    },
    warnings,
    config: mergedConfig,
    createdAt,
  };
}

/**
 * Build an exit ladder proposal using preset targets
 *
 * @param position - The position to create exit orders for
 * @param preset - Preset ladder type ('conservative', 'standard', 'aggressive')
 * @param validationContext - Optional context for risk validation
 * @returns Exit ladder proposal
 */
export function proposeExitLadderPreset(
  position: Position,
  preset: keyof typeof PRESET_LADDERS,
  validationContext?: ExitLadderValidationContext
): ExitLadderProposal {
  const rungs = PRESET_LADDERS[preset];
  return proposeExitLadder(position, { rungs: [...rungs] }, validationContext);
}

/**
 * Build an exit ladder with custom profit targets
 *
 * @param position - The position to create exit orders for
 * @param targets - Array of profit target percentages (e.g., [25, 50, 100])
 * @param validationContext - Optional context for risk validation
 * @returns Exit ladder proposal
 */
export function proposeExitLadderFromTargets(
  position: Position,
  targets: number[],
  validationContext?: ExitLadderValidationContext
): ExitLadderProposal {
  // Distribute close percentages evenly
  const closePercentEach = Math.floor(100 / targets.length);
  const remainder = 100 - closePercentEach * targets.length;

  const rungs: ExitLadderRung[] = targets.map((target, index) => ({
    targetProfitPercent: target,
    // Give any remainder to the last rung
    closePercent: index === targets.length - 1 ? closePercentEach + remainder : closePercentEach,
  }));

  return proposeExitLadder(position, { rungs }, validationContext);
}

// ============================================================================
// Formatting Helpers
// ============================================================================

/**
 * Format an exit ladder order for display
 */
export function formatExitLadderOrder(order: ExitLadderOrder): string {
  const { targetProfitPercent, exitPrice, contractsToClose, estimatedCredit, estimatedProfit } =
    order;
  const validStatus = order.validationResult?.valid === false ? ' [FAILED]' : '';

  return (
    `Rung ${order.rungIndex + 1}: Sell ${contractsToClose}x @ $${exitPrice.toFixed(2)} ` +
    `(+${targetProfitPercent}% target) → $${estimatedCredit.toFixed(2)} credit, ` +
    `$${estimatedProfit.toFixed(2)} profit${validStatus}`
  );
}

/**
 * Format an entire exit ladder proposal for display
 */
export function formatExitLadderProposal(proposal: ExitLadderProposal): string {
  const lines: string[] = [];
  const { position, orders, totalEstimatedCredit, totalEstimatedProfit, validationSummary } =
    proposal;

  // Header
  const symbol = position.optionDetails?.optionSymbol || position.symbol;
  lines.push(`Exit Ladder for ${symbol}`);
  lines.push(`Position: ${Math.abs(position.quantity)} contracts @ $${position.averageCost.toFixed(2)} avg cost`);
  lines.push(`Current Price: $${position.currentPrice.toFixed(2)}`);
  lines.push('');

  // Orders
  lines.push('Exit Orders:');
  for (const order of orders) {
    lines.push(`  ${formatExitLadderOrder(order)}`);
  }
  lines.push('');

  // Summary
  lines.push(`Total Contracts to Exit: ${proposal.totalContractsToExit}`);
  if (proposal.contractsRemaining > 0) {
    lines.push(`Contracts Remaining: ${proposal.contractsRemaining}`);
  }
  lines.push(`Total Estimated Credit: $${totalEstimatedCredit.toFixed(2)}`);
  lines.push(`Total Estimated Profit: $${totalEstimatedProfit.toFixed(2)}`);
  lines.push('');

  // Validation summary
  if (validationSummary.failedCount > 0) {
    lines.push(`Validation: ${validationSummary.passedCount} passed, ${validationSummary.failedCount} failed`);
    for (const reason of validationSummary.failureReasons) {
      lines.push(`  ! ${reason}`);
    }
  } else if (validationSummary.passedCount > 0) {
    lines.push(`Validation: All ${validationSummary.passedCount} orders passed`);
  }

  // Warnings
  if (proposal.warnings.length > 0) {
    lines.push('');
    lines.push('Warnings:');
    for (const warning of proposal.warnings) {
      lines.push(`  - ${warning}`);
    }
  }

  return lines.join('\n');
}

/**
 * Convert exit ladder proposal to BuildDraftOrdersResult format
 * for compatibility with existing order submission infrastructure
 */
export function toBuiltDraftOrdersResult(proposal: ExitLadderProposal): BuildDraftOrdersResult {
  return {
    orders: proposal.orders.map((o) => o.draftOrder),
    warnings: proposal.warnings,
    totalEstimatedCost: -proposal.totalEstimatedCredit, // Negative = credit
    correlationId: proposal.correlationId,
    proposalId: proposal.proposalId,
  };
}
