/**
 * Services Exports
 */

export {
  BrokerConnectionService,
  createBrokerConnectionService,
  type ConnectionState,
  type ConnectionResult,
} from './broker-connection.js';

export {
  RiskConfigService,
  createRiskConfigServiceFromEnv,
  type RiskConfigServiceOptions,
} from './risk-config.js';

export {
  MarketDataService,
  createMarketDataService,
  type MarketDataServiceConfig,
  type CacheStats,
} from './market-data.js';

export {
  RiskEngine,
  createRiskEngine,
  validateOrder,
  type RiskCheckType,
  type RiskCheckResult,
  type OrderValidationResult,
  type ValidationContext,
  type RiskEngineConfig,
  type RiskEngineLogger,
} from './risk-engine.js';

export {
  calculateSpreadPercent,
  computeSpreadPercent,
  getLiquidityRating,
  getLiquidityDescription,
  computeLiquidityMetrics,
  addLiquidityToContract,
  addLiquidityToChain,
  filterByLiquidity,
  sortByLiquidity,
  getChainLiquiditySummary,
  DEFAULT_LIQUIDITY_CONFIG,
  type LiquidityRating,
  type LiquidityMetrics,
  type LiquidityScoringConfig,
  type OptionContractWithLiquidity,
  type OptionChainWithLiquidity,
} from './liquidity.js';

export {
  ExposureCalculator,
  createExposureCalculator,
  calculatePortfolioExposure,
  getExceedingLimitUnderlyings,
  formatExposureForDisplay,
  type UnderlyingExposure,
  type PositionSummary,
  type AggregatedGreeks,
  type PortfolioExposure,
  type ExposureCalculatorConfig,
} from './exposure-calculator.js';

export {
  calculatePortfolioGreeks,
  calculateDetailedPortfolioGreeks,
  formatGreekValue,
  formatPortfolioGreeksForDisplay,
  getGreeksInterpretation,
  checkGreeksRisk,
  type PortfolioGreeks,
  type GreekValue,
  type PositionGreeksBreakdown,
  type DetailedPortfolioGreeks,
} from './portfolio-greeks.js';

export {
  TradeProposalService,
  createTradeProposalServiceFromEnv,
  type TradeProposalServiceOptions,
  type ProposalQueryOptions,
} from './trade-proposal.js';

export {
  calculateSMA,
  calculateEMA,
  calculateRSI,
  calculateATR,
  calculateTrueRange,
  getRSIInterpretation,
  getATRInterpretation,
  analyzeTrend,
  computeTechnicalIndicators,
  filterIndicators,
  formatRSIInterpretation,
  formatATRInterpretation,
  formatTrendInterpretation,
  DEFAULT_TECHNICALS_CONFIG,
  type TechnicalIndicatorsConfig,
  type RSIResult,
  type RSIInterpretation,
  type MovingAverageResult,
  type ATRResult,
  type ATRInterpretation,
  type TrendAnalysis,
  type TechnicalAnalysis,
  type ComputeTechnicalsInput,
  type IndicatorType,
} from './technical-indicators.js';
