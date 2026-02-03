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

// Order repricing types
export type {
  RepricingConfig,
  RepricingProposalStatus,
  RepricingProposal,
  StoredRepricingProposal,
  OrderModification,
  OrderModificationResult,
  RepricingScanResult,
} from './repricing.js';

export {
  RepricingConfigSchema,
  RepricingProposalSchema,
  DEFAULT_REPRICING_CONFIG,
  REPRICING_SCHEMA_VERSION,
  calculateDeviationPercent,
  calculateProposedPrice,
  orderQualifiesForRepricing,
  generateRepricingRationale,
  formatRepricingProposal,
  validateRepricingConfig,
} from './repricing.js';

// Alert types
export type {
  AlertTriggerType,
  AlertSeverity,
  AlertStatus,
  UnderlyingMoveConfig,
  PremiumTargetConfig,
  EarningsApproachingConfig,
  BidAskWideningConfig,
  PortfolioDrawdownConfig,
  AlertTriggerConfig,
  AlertTrigger,
  StoredAlertTrigger,
  AlertRecommendedAction,
  AlertContext,
  AlertEvent,
  StoredAlertEvent,
  AlertPreferences,
} from './alerts.js';

export {
  UnderlyingMoveConfigSchema,
  PremiumTargetConfigSchema,
  EarningsApproachingConfigSchema,
  BidAskWideningConfigSchema,
  PortfolioDrawdownConfigSchema,
  AlertTriggerConfigSchema,
  AlertTriggerSchema,
  StoredAlertTriggerSchema,
  AlertContextSchema,
  AlertRecommendedActionSchema,
  AlertEventSchema,
  StoredAlertEventSchema,
  AlertPreferencesSchema,
  DEFAULT_ALERT_PREFERENCES,
  ALERTS_SCHEMA_VERSION,
  determineAlertSeverity,
  generateRecommendedActions,
  generateAlertTitle,
  generateAlertMessage,
  formatAlertTriggerType,
  formatAlertSeverity,
  formatAlertStatus,
  shouldShowAlert,
  validateAlertTrigger,
  createDefaultTrigger,
} from './alerts.js';

// Kill switch types
export type {
  KillSwitchState,
  KillSwitchActivator,
  KillSwitchReasonCategory,
  KillSwitchConfig,
  KillSwitchStatus,
  KillSwitchActivationResult,
  KillSwitchDeactivationResult,
  KillSwitchEvent,
  StoredKillSwitchState,
} from './kill-switch.js';

export {
  KillSwitchConfigSchema,
  KillSwitchStatusSchema,
  KillSwitchEventSchema,
  StoredKillSwitchStateSchema,
  DEFAULT_KILL_SWITCH_CONFIG,
  KILL_SWITCH_SCHEMA_VERSION,
  isKillSwitchActive,
  isReadOnlyMode,
  canReEnable,
  getRemainingCooldownSeconds,
  formatKillSwitchState,
  formatReasonCategory,
  createInactiveStatus,
  generateStatusSummary,
  validateKillSwitchConfig,
} from './kill-switch.js';

// Spread types
export type {
  SpreadSubtype,
  SpreadLeg,
  SpreadDefinition,
  SpreadOrderRequest,
  SpreadToOrdersResult,
  OptionsLevel,
  BrokerOptionsCapabilities,
  SpreadCapabilityRequirement,
  SpreadRiskMetrics,
} from './spreads.js';

export {
  SpreadSubtypeSchema,
  SpreadLegSchema,
  SpreadDefinitionSchema,
  SpreadOrderRequestSchema,
  BrokerOptionsCapabilitiesSchema,
  SpreadRiskMetricsSchema,
  determineSpreadSubtype,
  getSpreadCapabilityRequirements,
  canTradeSpread,
  contractsToSpreadLegs,
  createDefaultCapabilities,
  formatSpreadSubtype,
  isMultiLegStrategy,
  getExpectedLegCount,
} from './spreads.js';
