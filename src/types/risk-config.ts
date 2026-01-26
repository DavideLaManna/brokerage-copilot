/**
 * Risk Configuration Types
 *
 * Schema for user risk limits that the system enforces on all operations.
 * These settings help prevent over-leveraging and maintain trading discipline.
 */

import { z } from 'zod';

// ============================================================================
// Risk Configuration Schema
// ============================================================================

/**
 * Zod schema for validating risk configuration inputs
 */
export const RiskConfigSchema = z.object({
  /**
   * Maximum risk per trade as a percentage of account value (0-100)
   * Example: 2 means no single trade can risk more than 2% of the account
   */
  maxRiskPerTradePercent: z
    .number()
    .min(0, 'Max risk per trade must be at least 0%')
    .max(100, 'Max risk per trade cannot exceed 100%'),

  /**
   * Maximum risk per underlying as a percentage of account value (0-100)
   * Example: 10 means total exposure to one underlying cannot exceed 10% of account
   */
  maxRiskPerUnderlyingPercent: z
    .number()
    .min(0, 'Max risk per underlying must be at least 0%')
    .max(100, 'Max risk per underlying cannot exceed 100%'),

  /**
   * Maximum daily loss in dollars before trading is disabled
   */
  maxDailyLoss: z
    .number()
    .min(0, 'Max daily loss must be a positive number')
    .finite('Max daily loss must be a finite number'),

  /**
   * Maximum number of open positions allowed
   */
  maxOpenPositions: z
    .number()
    .int('Max open positions must be an integer')
    .min(1, 'Max open positions must be at least 1')
    .max(1000, 'Max open positions cannot exceed 1000'),

  /**
   * Maximum contracts per position
   */
  maxContractsPerPosition: z
    .number()
    .int('Max contracts must be an integer')
    .min(1, 'Max contracts per position must be at least 1')
    .max(10000, 'Max contracts per position cannot exceed 10000'),

  /**
   * Minimum days to expiration for new option positions
   */
  minDTE: z
    .number()
    .int('Min DTE must be an integer')
    .min(0, 'Min DTE cannot be negative'),

  /**
   * Maximum days to expiration for new option positions
   */
  maxDTE: z
    .number()
    .int('Max DTE must be an integer')
    .min(1, 'Max DTE must be at least 1'),
});

/**
 * Inferred TypeScript type from Zod schema
 */
export type RiskConfig = z.infer<typeof RiskConfigSchema>;

// ============================================================================
// Additional Validation
// ============================================================================

/**
 * Schema with cross-field validation (minDTE < maxDTE)
 */
export const RiskConfigWithValidationSchema = RiskConfigSchema.refine(
  (data) => data.minDTE < data.maxDTE,
  {
    message: 'Min DTE must be less than Max DTE',
    path: ['minDTE'],
  }
);

// ============================================================================
// Default Configuration
// ============================================================================

/**
 * Conservative default risk configuration for new users
 */
export const DEFAULT_RISK_CONFIG: RiskConfig = {
  maxRiskPerTradePercent: 2,
  maxRiskPerUnderlyingPercent: 10,
  maxDailyLoss: 1000,
  maxOpenPositions: 10,
  maxContractsPerPosition: 10,
  minDTE: 7,
  maxDTE: 60,
};

// ============================================================================
// Stored Configuration Format
// ============================================================================

/**
 * Risk configuration as stored in the database/file
 */
export interface StoredRiskConfig {
  /** Unique identifier for the configuration */
  id: string;
  /** User or account this config belongs to */
  accountId: string;
  /** The actual risk configuration */
  config: RiskConfig;
  /** When the config was created */
  createdAt: Date;
  /** When the config was last updated */
  updatedAt: Date;
  /** Optional description/name for the config */
  name?: string;
  /** Whether this config is currently active */
  isActive: boolean;
}

/**
 * Zod schema for stored risk config
 */
export const StoredRiskConfigSchema = z.object({
  id: z.string().uuid(),
  accountId: z.string().min(1),
  config: RiskConfigSchema,
  createdAt: z.date(),
  updatedAt: z.date(),
  name: z.string().optional(),
  isActive: z.boolean(),
});

// ============================================================================
// Validation Result Types
// ============================================================================

/**
 * Result of validating a risk configuration
 */
export interface RiskConfigValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate a risk configuration
 */
export function validateRiskConfig(config: unknown): RiskConfigValidationResult {
  const result = RiskConfigWithValidationSchema.safeParse(config);
  const warnings: string[] = [];

  if (!result.success) {
    return {
      valid: false,
      errors: result.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`),
      warnings: [],
    };
  }

  // Add warnings for aggressive settings
  const data = result.data;

  if (data.maxRiskPerTradePercent > 5) {
    warnings.push('Max risk per trade exceeds 5% - this is aggressive');
  }

  if (data.maxRiskPerUnderlyingPercent > 20) {
    warnings.push('Max risk per underlying exceeds 20% - high concentration risk');
  }

  if (data.maxContractsPerPosition > 50) {
    warnings.push('Max contracts per position exceeds 50 - consider reducing');
  }

  if (data.minDTE < 3) {
    warnings.push('Min DTE under 3 days - high gamma risk near expiration');
  }

  return {
    valid: true,
    errors: [],
    warnings,
  };
}

// ============================================================================
// Configuration Display Helpers
// ============================================================================

/**
 * Format risk config for display
 */
export function formatRiskConfigForDisplay(config: RiskConfig): Record<string, string> {
  return {
    'Max Risk Per Trade': `${config.maxRiskPerTradePercent}%`,
    'Max Risk Per Underlying': `${config.maxRiskPerUnderlyingPercent}%`,
    'Max Daily Loss': `$${config.maxDailyLoss.toLocaleString()}`,
    'Max Open Positions': config.maxOpenPositions.toString(),
    'Max Contracts Per Position': config.maxContractsPerPosition.toString(),
    'DTE Range': `${config.minDTE} - ${config.maxDTE} days`,
  };
}
