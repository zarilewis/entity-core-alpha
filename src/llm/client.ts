/**
 * LLM Client
 *
 * Simple LLM client for entity-core internal processing.
 * Used for extraction, summarization, and other background tasks.
 *
 * Uses OpenAI-compatible API protocol.
 */

/**
 * Configuration for the LLM client.
 */
export interface LLMConfig {
  /** API key for authentication */
  apiKey: string;
  /** Base URL for the API */
  baseUrl: string;
  /** Model to use */
  model: string;
  /** Temperature for sampling (0-2, lower = more deterministic) */
  temperature?: number;
  /** Maximum tokens in response */
  maxTokens?: number;
}

/**
 * Chat message for the API.
 */
interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * Response from the completion API.
 */
interface CompletionResponse {
  choices: Array<{
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
}

/**
 * Error from the LLM API.
 */
export class LLMError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "LLMError";
  }
}

/**
 * Simple LLM client for entity-core.
 * Provides non-streaming completion for background tasks.
 */
export class LLMClient {
  private readonly config: LLMConfig;

  constructor(config: LLMConfig) {
    this.config = config;
  }

  /**
   * Complete a prompt with a simple string response.
   *
   * @param prompt - The prompt to complete
   * @param options - Optional parameters
   * @returns The completion text
   */
  async complete(
    prompt: string,
    options?: {
      systemPrompt?: string;
      temperature?: number;
      maxTokens?: number;
    },
  ): Promise<string> {
    const messages: ChatMessage[] = [];

    if (options?.systemPrompt) {
      messages.push({ role: "system", content: options.systemPrompt });
    }

    messages.push({ role: "user", content: prompt });

    const response = await this.makeRequest(messages, options);

    if (!response.ok) {
      await this.handleErrorResponse(response);
    }

    const data = await response.json() as CompletionResponse;

    if (!data.choices || data.choices.length === 0) {
      throw new LLMError("No completion returned", "NO_COMPLETION");
    }

    return data.choices[0].message.content;
  }

  /**
   * Complete with a JSON response.
   * Attempts to parse the response as JSON.
   */
  async completeJSON<T>(
    prompt: string,
    options?: {
      systemPrompt?: string;
      temperature?: number;
      maxTokens?: number;
    },
  ): Promise<T> {
    const response = await this.complete(prompt, options);

    // Try to extract JSON from the response
    // Sometimes models wrap JSON in markdown code blocks
    let jsonStr = response.trim();

    // Remove markdown code blocks if present
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }

    try {
      return JSON.parse(jsonStr) as T;
    } catch (e) {
      throw new LLMError(
        `Failed to parse JSON response: ${e instanceof Error ? e.message : String(e)}`,
        "PARSE_ERROR",
      );
    }
  }

  /**
   * Make the HTTP request to the API.
   */
  private async makeRequest(
    messages: ChatMessage[],
    options?: { temperature?: number; maxTokens?: number },
  ): Promise<Response> {
    const body: Record<string, unknown> = {
      model: this.config.model,
      messages,
      stream: false,
    };

    // Use option override, then config default
    const temperature = options?.temperature ?? this.config.temperature;
    if (temperature !== undefined) {
      body.temperature = temperature;
    }

    const maxTokens = options?.maxTokens ?? this.config.maxTokens;
    if (maxTokens !== undefined) {
      body.max_tokens = maxTokens;
    }

    try {
      return await fetch(this.config.baseUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(body),
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown network error";
      throw new LLMError(`Network error: ${message}`, "NETWORK_ERROR");
    }
  }

  /**
   * Handle an error response from the API.
   */
  private async handleErrorResponse(response: Response): Promise<never> {
    let errorMessage = `API request failed with status ${response.status}`;
    let errorCode: string | undefined;

    try {
      const errorBody = await response.json();
      if (errorBody.error) {
        errorMessage = errorBody.error.message || errorMessage;
        errorCode = errorBody.error.code;
      }
    } catch {
      errorMessage = `${errorMessage}: ${response.statusText}`;
    }

    throw new LLMError(errorMessage, errorCode, response.status);
  }
}

/**
 * Create an LLM client from environment variables.
 *
 * Required env vars:
 * - ENTITY_CORE_LLM_API_KEY: API key for the LLM
 *
 * Optional env vars:
 * - ENTITY_CORE_LLM_BASE_URL: API base URL (default: z.ai endpoint)
 * - ENTITY_CORE_LLM_MODEL: Model to use (default: glm-4.7)
 * - ENTITY_CORE_LLM_TEMPERATURE: Temperature for sampling (default: 0.3 for extraction)
 * - ENTITY_CORE_LLM_MAX_TOKENS: Max tokens in response (default: 2000)
 *
 * Falls back to Psycheros env vars (ZAI_*) if entity-core specific vars not set.
 */
export function createLLMClient(): LLMClient | null {
  // Try entity-core specific vars first, fall back to Psycheros vars
  const apiKey = Deno.env.get("ENTITY_CORE_LLM_API_KEY") ||
    Deno.env.get("ZAI_API_KEY");

  if (!apiKey) {
    console.log(
      "[LLM] No ENTITY_CORE_LLM_API_KEY or ZAI_API_KEY set - extraction features disabled",
    );
    return null;
  }

  const baseUrl = Deno.env.get("ENTITY_CORE_LLM_BASE_URL") ||
    Deno.env.get("ZAI_BASE_URL") ||
    "https://api.z.ai/api/coding/paas/v4/chat/completions";

  const model = Deno.env.get("ENTITY_CORE_LLM_MODEL") ||
    Deno.env.get("ZAI_MODEL") ||
    "glm-4.7";

  const temperatureStr = Deno.env.get("ENTITY_CORE_LLM_TEMPERATURE");
  const temperature = temperatureStr ? parseFloat(temperatureStr) : 0.3; // Lower temp for extraction

  const maxTokensStr = Deno.env.get("ENTITY_CORE_LLM_MAX_TOKENS");
  const maxTokens = maxTokensStr ? parseInt(maxTokensStr, 10) : 4000;

  const config: LLMConfig = {
    apiKey,
    baseUrl,
    model,
    temperature,
    maxTokens,
  };

  console.log(
    `[LLM] Client initialized with model: ${config.model}, temperature: ${config.temperature}, maxTokens: ${config.maxTokens}`,
  );
  return new LLMClient(config);
}
