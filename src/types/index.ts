/**
 * Type Exports
 *
 * Central export point for all type definitions.
 */

// Broker types and interfaces
export type {
  OptionType,
  OrderSide,
  OrderType,
  TimeInForce,
  OrderStatus,
  BrokerType,
  AccountSummary,
  Position,
  OptionDetails,
  Greeks,
  Order,
  OrderRequest,
  Quote,
  OptionContract,
  OptionChain,
  OptionChainRequest,
  BrokerAdapter,
} from './broker.js';

// Zod schemas for runtime validation
export {
  AccountSummarySchema,
  GreeksSchema,
  OptionDetailsSchema,
  PositionSchema,
  OrderRequestSchema,
  OptionChainRequestSchema,
} from './broker.js';

// Error types
export {
  BrokerErrorCode,
  BrokerError,
  AuthenticationError,
  RateLimitError,
  OrderError,
  isBrokerError,
  isRetryableError,
} from './errors.js';

// Rate limit types and utilities
export type {
  RateLimitConfig,
  RateLimiterState,
} from './rate-limits.js';

export {
  RATE_LIMIT_CONFIGS,
  getRateLimitConfig,
  calculateRequestDelay,
  createRateLimiterState,
} from './rate-limits.js';

// Risk configuration types
export type {
  RiskConfig,
  StoredRiskConfig,
  RiskConfigValidationResult,
} from './risk-config.js';

export {
  RiskConfigSchema,
  RiskConfigWithValidationSchema,
  StoredRiskConfigSchema,
  DEFAULT_RISK_CONFIG,
  validateRiskConfig,
  formatRiskConfigForDisplay,
} from './risk-config.js';

// Trade proposal types
export type {
  ProposalStatus,
  ConfidenceLevel,
  StrategyType,
  ProposalContract,
  EntryPlan,
  ProfitTarget,
  StopLoss,
  ExitPlan,
  RiskAssessment,
  DataSource,
  TradeProposal,
  StoredTradeProposal,
  TradeProposalValidationResult,
} from './trade-proposal.js';

export {
  ProposalContractSchema,
  EntryPlanSchema,
  ProfitTargetSchema,
  StopLossSchema,
  ExitPlanSchema,
  RiskAssessmentSchema,
  DataSourceSchema,
  TradeProposalSchema,
  StoredTradeProposalSchema,
  validateTradeProposal,
  formatStrategyType,
  formatConfidence,
  formatProposalStatus,
  calculateProposalCost,
  getProposalSummary,
} from './trade-proposal.js';

// Audit log types
export type {
  AuditEventType,
  AuditActor,
  InitiatorTag,
  AuditLogEntry,
  AuditDataSource,
  AuditEventDetails,
  RecommendationDetails,
  ApprovalDetails,
  RejectionDetails,
  ExecutionDetails,
  CancellationDetails,
  ModificationDetails,
  FillDetails,
  RiskCheckDetails,
  ConfigChangeDetails,
  ConnectionDetails,
  ErrorDetails,
  StoredAuditLogEntry,
  AuditLogQueryOptions,
  AuditLogQueryResult,
} from './audit-log.js';

export {
  AuditDataSourceSchema,
  RecommendationDetailsSchema,
  ApprovalDetailsSchema,
  RejectionDetailsSchema,
  ExecutionDetailsSchema,
  CancellationDetailsSchema,
  ModificationDetailsSchema,
  FillDetailsSchema,
  RiskCheckDetailsSchema,
  ConfigChangeDetailsSchema,
  ConnectionDetailsSchema,
  ErrorDetailsSchema,
  AuditEventDetailsSchema,
  AuditLogEntrySchema,
  StoredAuditLogEntrySchema,
  getInitiatorTag,
  formatEventType,
  formatActor,
  generateEventSummary,
  validateAuditLogEntry,
  AUDIT_LOG_SCHEMA_VERSION,
} from './audit-log.js';
