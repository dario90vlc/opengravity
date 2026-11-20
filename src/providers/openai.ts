/**
 * Adaptador OpenAI — API de Chat Completions con streaming SSE.
 *
 * Compatible también con cualquier endpoint OpenAI-compatible (vLLM, LM Studio,
 * OpenRouter, Azure OpenAI…): basta con cambiar `baseUrl`.
 *
 * API: https://platform.openai.com/docs/api-reference/chat
 */

import {
  ProviderError,
  type Capabilities,
  type Chunk,
  type FinishReason,
  type GenerateRequest,
  type Message,
  type ModelInfo,
  type ModelProvider,
  type ToolCall,
} from './types.js';
import {
  DEFAULT_BASE_URLS,
  LIST_TIMEOUT_MS,
  coerceArguments,
  ensureOk,
  fetchWithRetry,
  readSSE,
  textoDeDelta,
  tryParseJSON,
} from './http.js';

export interface OpenAIOptions {
  apiKey?: string;
  baseUrl?: string;
  /** Cabeceras extra, para gateways que requieren cosas propias. */
  headers?: Record<string, string>;
  /** Lista fija de modelos si no quieres consultar `/models`. */
  models?: ModelInfo[];
}

interface OpenAIStreamChunk {
  choices?: Array<{
    delta?: {
      content?: string | null;
      /** Razonamiento de modelos tipo o1/o3, DeepSeek-R1 u OpenRouter. */
      reasoning_content?: string | null;
      reasoning?: string | null;
      tool_calls?: Array<{
        index: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string };
}

export class OpenAIProvider implements ModelProvider {
  readonly id = 'openai';
  readonly capabilities: Capabilities = {
    streaming: true,
    tools: true,
    vision: true,
  };

  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly extraHeaders: Record<string, string>;
  private readonly fixedModels: ModelInfo[] | undefined;

  constructor(options: OpenAIOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URLS.openai).replace(/\/+$/, '');
    this.apiKey = options.apiKey ?? process.env['OPENAI_API_KEY'] ?? '';
    this.extraHeaders = options.headers ?? {};
    this.fixedModels = options.models;
  }

  async listModels(): Promise<ModelInfo[]> {
    if (this.fixedModels) return this.fixedModels;

    /*
     * Sin timeout, un proveedor que no responde dejaba la detección colgada.
     * El endpoint puede devolver `{ data: [...] }` o un array directo, y el
     * `name` es el nombre legible que usa la pasarela.
     */
    const response = await fetch(`${this.baseUrl}/models`, {
      headers: this.headers(),
      signal: AbortSignal.timeout(LIST_TIMEOUT_MS),
    });
    await ensureOk(response, this.id);

    type Entrada = { id?: string; name?: string; context_length?: number; context_window?: number };
    const payload = (await response.json()) as { data?: Entrada[] } | Entrada[];
    const entradas = Array.isArray(payload) ? payload : (payload.data ?? []);

    return entradas
      .filter((entry): entry is Entrada & { id: string } => typeof entry.id === 'string')
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((entry) => {
        /*
         * Algunas pasarelas compatibles con OpenAI declaran la ventana en el
         * listado (`context_length` en OpenRouter, `context_window` en otras).
         * Antes se tiraba y el presupuesto de contexto acababa adivinando por
         * el nombre del modelo. Se acepta el primero que sea un número válido.
         */
        const declarada = Number(entry.context_length ?? entry.context_window);
        return {
          id: entry.id,
          name: typeof entry.name === 'string' && entry.name.trim().length > 0 ? entry.name : entry.id,
          ...(Number.isFinite(declarada) && declarada > 0
            ? { contextWindow: Math.floor(declarada) }
            : {}),
        };
      });
  }

  async *streamGenerate(req: GenerateRequest, signal?: AbortSignal): AsyncIterable<Chunk> {
    const body: Record<string, unknown> = {
      model: req.model,
      messages: toOpenAIMessages(req),
      stream: true,
      stream_options: { include_usage: true },
    };

    if (req.tools && req.tools.length > 0) {
      body.tools = req.tools.map((tool) => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      }));
    }

    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.maxTokens !== undefined) body.max_tokens = req.maxTokens;
    // Esfuerzo de razonamiento con nombre (minimal / low / medium / high).
    // Solo lo manda quien lo soporta: los servidores locales no lo aceptan.
    if (req.reasoningEffort) body.reasoning_effort = req.reasoningEffort;

    let response = await fetchWithRetry(
      `${this.baseUrl}/chat/completions`,
      {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(body),
        ...(signal ? { signal } : {}),
      },
      this.id,
      { signal, retries: 3 },
    );

    /*
     * Algunos endpoints OpenAI-compatible rechazan `stream_options` con 400.
     * Se reintenta una vez sin él en vez de dejar inutilizable el proveedor.
     */
    if (response.status === 400 && 'stream_options' in body) {
      await response.body?.cancel().catch(() => {});
      delete body.stream_options;
      response = await fetchWithRetry(
        `${this.baseUrl}/chat/completions`,
        {
          method: 'POST',
          headers: this.headers(),
          body: JSON.stringify(body),
          ...(signal ? { signal } : {}),
        },
        this.id,
        { signal, retries: 3 },
      );
    }
    await ensureOk(response, this.id);

    if (!response.body) {
      throw new ProviderError(this.id, undefined, 'respuesta sin cuerpo');
    }

    // Los tool calls llegan troceados por índice: hay que acumular los argumentos.
    const pending = new Map<number, { id: string; name: string; args: string }>();
    let finishReason: FinishReason = 'stop';

    for await (const payload of readSSE(response.body, this.id)) {
      const event = tryParseJSON(payload) as OpenAIStreamChunk | undefined;
      if (!event) continue;

      if (event.error?.message) {
        throw new ProviderError(this.id, undefined, event.error.message);
      }

      const choice = event.choices?.[0];

      // Algunas pasarelas mandan listas de partes en vez de texto: se normaliza.
      const reasoning = textoDeDelta(choice?.delta?.reasoning_content ?? choice?.delta?.reasoning);
      if (reasoning.length > 0) {
        yield { type: 'reasoning', text: reasoning };
      }

      const text = textoDeDelta(choice?.delta?.content);
      if (text.length > 0) {
        yield { type: 'text', text };
      }

      for (const fragment of choice?.delta?.tool_calls ?? []) {
        const slot = pending.get(fragment.index) ?? { id: '', name: '', args: '' };
        if (fragment.id) slot.id = fragment.id;
        if (fragment.function?.name) slot.name = fragment.function.name;
        if (fragment.function?.arguments) slot.args += fragment.function.arguments;
        pending.set(fragment.index, slot);
      }

      if (choice?.finish_reason) {
        finishReason = mapFinishReason(choice.finish_reason);
      }

      if (event.usage) {
        yield {
          type: 'usage',
          inputTokens: event.usage.prompt_tokens ?? 0,
          outputTokens: event.usage.completion_tokens ?? 0,
        };
      }
    }

    for (const slot of pending.values()) {
      if (slot.name.length === 0) continue;
      const call: ToolCall = {
        id: slot.id || `call_${crypto.randomUUID()}`,
        name: slot.name,
        arguments: coerceArguments(slot.args),
      };
      yield { type: 'tool_call', call };
    }

    if (pending.size > 0 && finishReason !== 'length') finishReason = 'tool_calls';

    yield { type: 'done', finishReason };
  }

  private headers(): Record<string, string> {
    return {
      'content-type': 'application/json',
      ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
      ...this.extraHeaders,
    };
  }
}

function mapFinishReason(reason: string): FinishReason {
  switch (reason) {
    case 'tool_calls':
    case 'function_call':
      return 'tool_calls';
    case 'length':
      return 'length';
    case 'stop':
      return 'stop';
    default:
      return 'stop';
  }
}

function toOpenAIMessages(req: GenerateRequest): unknown[] {
  const messages: unknown[] = [];

  if (req.system) {
    messages.push({ role: 'system', content: req.system });
  }

  for (const message of req.messages) {
    messages.push(toOpenAIMessage(message));
  }

  return messages;
}

function toOpenAIMessage(message: Message): unknown {
  if (message.role === 'assistant' && message.toolCalls && message.toolCalls.length > 0) {
    return {
      role: 'assistant',
      content: message.content || null,
      tool_calls: message.toolCalls.map((call) => ({
        id: call.id,
        type: 'function',
        function: { name: call.name, arguments: JSON.stringify(call.arguments) },
      })),
    };
  }

  if (message.role === 'tool') {
    return {
      role: 'tool',
      tool_call_id: message.toolCallId ?? '',
      content: message.content,
    };
  }

  // Mensaje de usuario con imágenes: OpenAI usa partes tipadas.
  if (message.role === 'user' && message.images && message.images.length > 0) {
    const parts: unknown[] = [{ type: 'text', text: message.content }];
    for (const image of message.images) {
      parts.push({
        type: 'image_url',
        image_url: { url: `data:${image.mimeType};base64,${image.data}` },
      });
    }
    return { role: 'user', content: parts };
  }

  return { role: message.role, content: message.content };
}
