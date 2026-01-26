/**
 * MCP Tool Registry
 *
 * Central registry for all MCP tools available to LLM agents.
 * Provides registration, discovery, and execution of tools.
 */

import type { MCPToolDefinition, MCPToolResult, MCPToolRegistry } from './types.js';

/**
 * MCP Tool Registry implementation
 *
 * Manages registration and execution of tools for LLM agents.
 */
export class ToolRegistry implements MCPToolRegistry {
  private tools: Map<string, MCPToolDefinition> = new Map();

  /**
   * Register a new tool
   *
   * @param tool - Tool definition to register
   * @throws Error if tool with same name already exists
   */
  register(tool: MCPToolDefinition): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered`);
    }
    this.tools.set(tool.name, tool);
  }

  /**
   * Get a tool by name
   *
   * @param name - Tool name
   * @returns Tool definition or undefined
   */
  get(name: string): MCPToolDefinition | undefined {
    return this.tools.get(name);
  }

  /**
   * List all registered tools
   *
   * @returns Array of all registered tool definitions
   */
  list(): MCPToolDefinition[] {
    return Array.from(this.tools.values());
  }

  /**
   * Get tool names for LLM prompt
   *
   * @returns Array of tool names and descriptions
   */
  getToolDescriptions(): { name: string; description: string }[] {
    return this.list().map((tool) => ({
      name: tool.name,
      description: tool.description,
    }));
  }

  /**
   * Execute a tool by name
   *
   * @param name - Tool name to execute
   * @param input - Input parameters for the tool
   * @returns Tool execution result
   */
  async execute(name: string, input: unknown): Promise<MCPToolResult> {
    const tool = this.tools.get(name);

    if (!tool) {
      return {
        success: false,
        error: `Tool "${name}" not found. Available tools: ${Array.from(this.tools.keys()).join(', ')}`,
        timestamp: new Date().toISOString(),
      };
    }

    try {
      // Validate input against schema
      const parseResult = tool.inputSchema.safeParse(input);
      if (!parseResult.success) {
        return {
          success: false,
          error: `Invalid input for tool "${name}": ${parseResult.error.message}`,
          timestamp: new Date().toISOString(),
        };
      }

      // Execute the tool handler
      const result = await tool.handler(parseResult.data);
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      return {
        success: false,
        error: `Tool execution failed: ${errorMessage}`,
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * Clear all registered tools (for testing)
   */
  clear(): void {
    this.tools.clear();
  }
}

/**
 * Create a new tool registry instance
 */
export function createToolRegistry(): ToolRegistry {
  return new ToolRegistry();
}

/**
 * Global tool registry instance (singleton)
 */
let globalRegistry: ToolRegistry | null = null;

/**
 * Get the global tool registry
 *
 * Creates a new registry if one doesn't exist.
 */
export function getGlobalRegistry(): ToolRegistry {
  if (!globalRegistry) {
    globalRegistry = new ToolRegistry();
  }
  return globalRegistry;
}

/**
 * Reset the global registry (for testing)
 */
export function resetGlobalRegistry(): void {
  globalRegistry = null;
}
