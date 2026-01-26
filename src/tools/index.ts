/**
 * MCP Tools Module
 *
 * Tools for LLM agents to interact with the trading system via Model Context Protocol.
 */

// Types
export type {
  MCPToolDefinition,
  MCPToolResult,
  MCPToolRegistry,
  PortfolioSnapshot,
  SnapshotPosition,
  SnapshotOrder,
  SnapshotAccountSummary,
  SnapshotExposure,
  SnapshotGreeks,
  GetPortfolioSnapshotInput,
} from './types.js';

export { GetPortfolioSnapshotInputSchema } from './types.js';

// Registry
export {
  ToolRegistry,
  createToolRegistry,
  getGlobalRegistry,
  resetGlobalRegistry,
} from './registry.js';

// Tools - Portfolio Snapshot
export {
  createPortfolioSnapshotTool,
  buildPortfolioSnapshot,
  getPortfolioSnapshot,
  type PortfolioSnapshotToolContext,
} from './portfolio-snapshot.js';

// Tools - Option Chain
export {
  createOptionChainTool,
  buildOptionChainSnapshot,
  getOptionChain,
  GetOptionChainInputSchema,
  type OptionChainToolContext,
  type GetOptionChainInput,
  type OptionChainSnapshot,
  type SnapshotOptionContract,
  type SnapshotExpiration,
} from './option-chain.js';

// Tools - Technical Indicators
export {
  createTechnicalIndicatorsTool,
  buildTechnicalIndicatorsSnapshot,
  computeTechnicals,
  ComputeTechnicalsInputSchema,
  type TechnicalIndicatorsToolContext,
  type ComputeTechnicalsInput,
  type TechnicalIndicatorsSnapshot,
} from './technical-indicators.js';
