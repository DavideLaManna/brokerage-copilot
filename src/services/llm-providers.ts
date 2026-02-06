/**
 * LLM Provider Implementations
 *
 * Real implementations for OpenAI and Anthropic APIs.
 */

import type {
  LLMProvider,
  LLMCompletionOptions,
  LLMCompletionResult,
} from './article-summarizer.js';

/**
 * OpenAI API response types
 */
interface OpenAIChatCompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: {
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * OpenAI LLM Provider
 *
 * Uses the OpenAI Chat Completions API
 */
export class OpenAIProvider implements LLMProvider {
  private apiKey: string;
  private baseUrl: string;
  private defaultModel: string;

  constructor(options?: {
    apiKey?: string;
    baseUrl?: string;
    defaultModel?: string;
  }) {
    this.apiKey = options?.apiKey || process.env.OPENAI_API_KEY || '';
    this.baseUrl = options?.baseUrl || 'https://api.openai.com/v1';
    this.defaultModel = options?.defaultModel || 'gpt-4o-mini';

    if (!this.apiKey) {
      throw new Error(
        'OpenAI API key is required. Set OPENAI_API_KEY environment variable or pass apiKey option.'
      );
    }
  }

  async complete(
    prompt: string,
    options?: LLMCompletionOptions
  ): Promise<LLMCompletionResult> {
    const model = options?.model || this.defaultModel;
    const maxTokens = options?.maxTokens || 1024;
    const temperature = options?.temperature ?? 0.3;

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
        max_tokens: maxTokens,
        temperature,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
    }

    const data = (await response.json()) as OpenAIChatCompletionResponse;

    const content = data.choices[0]?.message?.content || '';
    const tokensUsed = data.usage?.total_tokens || 0;

    return {
      text: content,
      tokensUsed,
      model: data.model,
    };
  }
}

/**
 * Anthropic API response types
 */
interface AnthropicMessageResponse {
  id: string;
  type: string;
  role: string;
  content: {
    type: string;
    text: string;
  }[];
  model: string;
  stop_reason: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

/**
 * Anthropic (Claude) LLM Provider
 *
 * Uses the Anthropic Messages API
 */
export class AnthropicProvider implements LLMProvider {
  private apiKey: string;
  private baseUrl: string;
  private defaultModel: string;

  constructor(options?: {
    apiKey?: string;
    baseUrl?: string;
    defaultModel?: string;
  }) {
    this.apiKey = options?.apiKey || process.env.ANTHROPIC_API_KEY || '';
    this.baseUrl = options?.baseUrl || 'https://api.anthropic.com/v1';
    this.defaultModel = options?.defaultModel || 'claude-3-haiku-20240307';

    if (!this.apiKey) {
      throw new Error(
        'Anthropic API key is required. Set ANTHROPIC_API_KEY environment variable or pass apiKey option.'
      );
    }
  }

  async complete(
    prompt: string,
    options?: LLMCompletionOptions
  ): Promise<LLMCompletionResult> {
    const model = options?.model || this.defaultModel;
    const maxTokens = options?.maxTokens || 1024;
    const temperature = options?.temperature ?? 0.3;

    const response = await fetch(`${this.baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        temperature,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Anthropic API error: ${response.status} - ${errorText}`);
    }

    const data = (await response.json()) as AnthropicMessageResponse;

    const content = data.content[0]?.text || '';
    const tokensUsed = (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0);

    return {
      text: content,
      tokensUsed,
      model: data.model,
    };
  }
}

/**
 * Create an LLM provider based on environment configuration
 *
 * Checks for OPENAI_API_KEY first, then ANTHROPIC_API_KEY.
 * Falls back to mock provider if neither is available.
 */
export function createLLMProviderFromEnv(): LLMProvider | null {
  // Try OpenAI first
  if (process.env.OPENAI_API_KEY) {
    try {
      return new OpenAIProvider();
    } catch {
      console.warn('Failed to create OpenAI provider');
    }
  }

  // Try Anthropic
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      return new AnthropicProvider();
    } catch {
      console.warn('Failed to create Anthropic provider');
    }
  }

  // No provider available
  return null;
}

/**
 * Get the name of the configured LLM provider
 */
export function getLLMProviderName(): string {
  if (process.env.OPENAI_API_KEY) {
    return 'OpenAI';
  }
  if (process.env.ANTHROPIC_API_KEY) {
    return 'Anthropic';
  }
  return 'Mock';
}
