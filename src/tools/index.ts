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

// Tools
export {
  createPortfolioSnapshotTool,
  buildPortfolioSnapshot,
  getPortfolioSnapshot,
  type PortfolioSnapshotToolContext,
} from './portfolio-snapshot.js';
