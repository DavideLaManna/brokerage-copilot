/**
 * Tests for MCP Tool Registry
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { z } from 'zod';
import {
  ToolRegistry,
  createToolRegistry,
  getGlobalRegistry,
  resetGlobalRegistry,
} from './registry.js';
import type { MCPToolDefinition, MCPToolResult } from './types.js';

// ============================================================================
// Test Helpers
// ============================================================================

function createMockTool(name: string, handler?: () => Promise<MCPToolResult>): MCPToolDefinition {
  return {
    name,
    description: `Test tool: ${name}`,
    inputSchema: z.object({
      param: z.string().optional(),
    }),
    handler: handler ?? (async () => ({
      success: true,
      data: { result: 'ok' },
      timestamp: new Date().toISOString(),
    })),
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('ToolRegistry', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  describe('register', () => {
    it('should register a tool', () => {
      const tool = createMockTool('test_tool');
      registry.register(tool);

      expect(registry.get('test_tool')).toBe(tool);
    });

    it('should throw error when registering duplicate tool', () => {
      const tool = createMockTool('test_tool');
      registry.register(tool);

      expect(() => registry.register(tool)).toThrow('already registered');
    });

    it('should allow registering multiple different tools', () => {
      registry.register(createMockTool('tool_1'));
      registry.register(createMockTool('tool_2'));
      registry.register(createMockTool('tool_3'));

      expect(registry.list()).toHaveLength(3);
    });
  });

  describe('get', () => {
    it('should return tool by name', () => {
      const tool = createMockTool('my_tool');
      registry.register(tool);

      expect(registry.get('my_tool')).toBe(tool);
    });

    it('should return undefined for unknown tool', () => {
      expect(registry.get('unknown_tool')).toBeUndefined();
    });
  });

  describe('list', () => {
    it('should return empty array when no tools registered', () => {
      expect(registry.list()).toEqual([]);
    });

    it('should return all registered tools', () => {
      registry.register(createMockTool('tool_a'));
      registry.register(createMockTool('tool_b'));

      const tools = registry.list();
      expect(tools).toHaveLength(2);
      expect(tools.map(t => t.name)).toContain('tool_a');
      expect(tools.map(t => t.name)).toContain('tool_b');
    });
  });

  describe('getToolDescriptions', () => {
    it('should return tool names and descriptions', () => {
      registry.register(createMockTool('tool_1'));
      registry.register(createMockTool('tool_2'));

      const descriptions = registry.getToolDescriptions();

      expect(descriptions).toHaveLength(2);
      expect(descriptions[0]).toHaveProperty('name');
      expect(descriptions[0]).toHaveProperty('description');
    });
  });

  describe('execute', () => {
    it('should execute tool and return result', async () => {
      const tool = createMockTool('test_tool', async () => ({
        success: true,
        data: { value: 42 },
        timestamp: new Date().toISOString(),
      }));
      registry.register(tool);

      const result = await registry.execute('test_tool', { param: 'test' });

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ value: 42 });
    });

    it('should return error for unknown tool', async () => {
      const result = await registry.execute('unknown_tool', {});

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
      expect(result.error).toContain('unknown_tool');
    });

    it('should validate input against schema', async () => {
      const tool: MCPToolDefinition = {
        name: 'strict_tool',
        description: 'Tool with strict input',
        inputSchema: z.object({
          required: z.string(),
        }),
        handler: async () => ({
          success: true,
          data: {},
          timestamp: new Date().toISOString(),
        }),
      };
      registry.register(tool);

      // Missing required field
      const result = await registry.execute('strict_tool', {});

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid input');
    });

    it('should handle tool execution errors', async () => {
      const tool = createMockTool('failing_tool', async () => {
        throw new Error('Tool execution failed');
      });
      registry.register(tool);

      const result = await registry.execute('failing_tool', {});

      expect(result.success).toBe(false);
      expect(result.error).toContain('Tool execution failed');
    });

    it('should handle non-Error throws', async () => {
      const tool = createMockTool('weird_tool', async () => {
        throw 'string error'; // eslint-disable-line no-throw-literal
      });
      registry.register(tool);

      const result = await registry.execute('weird_tool', {});

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown error');
    });

    it('should pass validated input to handler', async () => {
      const handler = vi.fn().mockResolvedValue({
        success: true,
        data: {},
        timestamp: new Date().toISOString(),
      });

      const tool: MCPToolDefinition = {
        name: 'input_tool',
        description: 'Tool that receives input',
        inputSchema: z.object({
          value: z.number(),
        }),
        handler,
      };
      registry.register(tool);

      await registry.execute('input_tool', { value: 123 });

      expect(handler).toHaveBeenCalledWith({ value: 123 });
    });
  });

  describe('clear', () => {
    it('should remove all registered tools', () => {
      registry.register(createMockTool('tool_1'));
      registry.register(createMockTool('tool_2'));

      registry.clear();

      expect(registry.list()).toHaveLength(0);
    });
  });
});

describe('createToolRegistry', () => {
  it('should create a new registry instance', () => {
    const registry = createToolRegistry();
    expect(registry).toBeInstanceOf(ToolRegistry);
  });
});

describe('Global Registry', () => {
  beforeEach(() => {
    resetGlobalRegistry();
  });

  it('should return the same instance on multiple calls', () => {
    const registry1 = getGlobalRegistry();
    const registry2 = getGlobalRegistry();

    expect(registry1).toBe(registry2);
  });

  it('should create new instance after reset', () => {
    const registry1 = getGlobalRegistry();
    registry1.register(createMockTool('test'));

    resetGlobalRegistry();
    const registry2 = getGlobalRegistry();

    expect(registry2.list()).toHaveLength(0);
  });
});
