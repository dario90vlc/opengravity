/**
 * Adaptador Gemini — Generative Language API con streaming SSE.
 *
 * Diferencias que absorbe:
 *  - El rol del modelo es `model`, no `assistant`.
 *  - Los tool calls son `functionCall` dentro de `parts`.
 *  - Los resultados de herramientas son `functionResponse` en un turno `user`.
 *  - La API key va como query param, no como cabecera.
 *
 * API: https://ai.google.dev/api/generate-content
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
  tryParseJSON,
  textoDeDelta,
} from './http.js';

export interface GeminiOptions {
  apiKey?: string;
  baseUrl?: string;
}

const FALLBACK_MODELS: ModelInfo[] = [
  { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', contextWindow: 1_000_000 },
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', contextWindow: 1_000_000 },
  { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', contextWindow: 1_000_000 },
];

interface GeminiPart {
  text?: string;
  /** Gemini marca los fragmentos de razonamiento con `thought: true`. */
  thought?: boolean;
  functionCall?: { name?: string; args?: unknown };
  functionResponse?: { name?: string; response?: unknown };
  /** Firma que Gemini 3 exige devolver junto al `functionCall`. */
  thoughtSignature?: string;
}

export class GeminiProvider implements ModelProvider {
  readonly id = 'gemini';
  readonly capabilities: Capabilities = {
    streaming: true,
    tools: true,
    vision: true,
  };

  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(options: GeminiOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URLS.gemini).replace(/\/+$/, '');
    this.apiKey = options.apiKey ?? process.env['GEMINI_API_KEY'] ?? '';
  }

  async listModels(): Promise<ModelInfo[]> {
    // Sin clave, lista curada; con clave, los errores se propagan para que la
    // detección no dé por bueno un endpoint que no responde.
    if (!this.apiKey) return FALLBACK_MODELS;

    const response = await fetch(`${this.baseUrl}/models?key=${encodeURIComponent(this.apiKey)}`, {
      signal: AbortSignal.timeout(LIST_TIMEOUT_MS),
    });
    await ensureOk(response, this.id);

    const payload = (await response.json()) as {
      models?: Array<{ name?: string; displayName?: string; inputTokenLimit?: number }>;
    };

    const models = (payload.models ?? [])
      .filter((entry) => entry.name?.startsWith('models/gemini'))
      .map((entry) => ({
        id: (entry.name ?? '').replace(/^models\//, ''),
        name: entry.displayName ?? entry.name ?? '',
        ...(entry.inputTokenLimit !== undefined ? { contextWindow: entry.inputTokenLimit } : {}),
      }));

    return models.length > 0 ? models : FALLBACK_MODELS;
  }

  async *streamGenerate(req: GenerateRequest, signal?: AbortSignal): AsyncIterable<Chunk> {
    const body: Record<string, unknown> = {
      contents: toGeminiContents(req.messages),
    };

    if (req.system) {
      body.systemInstruction = { parts: [{ text: req.system }] };
    }

    if (req.tools && req.tools.length > 0) {
      body.tools = [
        {
          functionDeclarations: req.tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
          })),
        },
      ];
    }

    const generationConfig: Record<string, unknown> = {};
    if (req.temperature !== undefined) generationConfig.temperature = req.temperature;
    if (req.maxTokens !== undefined) generationConfig.maxOutputTokens = req.maxTokens;

    /*
     * Gemini 2.5+ ya piensa por su cuenta, pero solo devuelve los pensamientos
     * si se piden con `includeThoughts`. En modelos anteriores el campo no
     * existe, así que solo se envía cuando el id lo indica.
     */
    if (/gemini-(2\.5|[3-9])/i.test(req.model)) {
      const presupuesto = Number(req.thinkingBudget ?? 0);
      /*
       * `thinkingBudget` solo existe hasta 2.5: en Gemini 3+ está deprecado
       * (se controla con `thinkingLevel`) y en Gemini 4 devuelve 400.
       *
       * Sin presupuesto ni nivel no se manda `thinkingConfig`: pedir
       * `includeThoughts` siempre encendía el razonamiento aunque el usuario
       * lo hubiera apagado.
       */
      const thinkingConfig = {
        includeThoughts: true,
        ...(presupuesto > 0 && /^gemini-2\.5/i.test(req.model) ? { thinkingBudget: presupuesto } : {}),
        ...(req.thinkingLevel ? { thinkingLevel: req.thinkingLevel } : {}),
      };
      if (thinkingConfig.thinkingBudget || thinkingConfig.thinkingLevel) {
        generationConfig.thinkingConfig = thinkingConfig;
      }
    }

    if (Object.keys(generationConfig).length > 0) body.generationConfig = generationConfig;

    const url =
      `${this.baseUrl}/models/${encodeURIComponent(req.model)}:streamGenerateContent` +
      `?alt=sse&key=${encodeURIComponent(this.apiKey)}`;

    const response = await fetchWithRetry(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    }, this.id, { signal, retries: 3 });
    await ensureOk(response, this.id);

    if (!response.body) {
      throw new ProviderError(this.id, undefined, 'respuesta sin cuerpo');
    }

    let sawToolCall = false;
    let finishReason: FinishReason = 'stop';
    // Gemini 3 puede adjuntar la firma a la parte de pensamiento/texto previa,
    // no solo al functionCall; se arrastra hasta la llamada.
    let firmaPendiente = '';
    let inputTokens = 0;
    let outputTokens = 0;

    for await (const payload of readSSE(response.body, this.id)) {
      const event = tryParseJSON(payload) as
        | {
            candidates?: Array<{
              content?: { parts?: GeminiPart[] };
              finishReason?: string;
            }>;
            usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
            error?: { message?: string };
          }
        | undefined;

      if (!event) continue;

      if (event.error?.message) {
        throw new ProviderError(this.id, undefined, event.error.message);
      }

      for (const candidate of event.candidates ?? []) {
        for (const part of candidate.content?.parts ?? []) {
          if (typeof part.thoughtSignature === 'string' && part.thoughtSignature.length > 0) {
            firmaPendiente = part.thoughtSignature;
          }
          const trozo = textoDeDelta(part.text);
          if (trozo.length > 0) {
            // Los fragmentos de pensamiento no son respuesta visible.
            if (part.thought) yield { type: 'reasoning', text: trozo };
            else yield { type: 'text', text: trozo };
          }

          if (part.functionCall?.name) {
            sawToolCall = true;
            const call: ToolCall = {
              id: `call_${crypto.randomUUID()}`,
              name: part.functionCall.name,
              arguments: coerceArguments(part.functionCall.args),
              ...(firmaPendiente || part.thoughtSignature
                ? { providerMeta: { thoughtSignature: firmaPendiente || part.thoughtSignature } }
                : {}),
            };
            yield { type: 'tool_call', call };
          }
        }

        if (candidate.finishReason) {
          finishReason = mapFinishReason(candidate.finishReason);
        }
      }

      if (event.usageMetadata) {
        inputTokens = event.usageMetadata.promptTokenCount ?? inputTokens;
        outputTokens = event.usageMetadata.candidatesTokenCount ?? outputTokens;
      }
    }

    if (inputTokens > 0 || outputTokens > 0) {
      yield { type: 'usage', inputTokens, outputTokens };
    }

    yield { type: 'done', finishReason: sawToolCall && finishReason === 'stop' ? 'tool_calls' : finishReason };
  }
}

function mapFinishReason(reason: string): FinishReason {
  switch (reason) {
    case 'MAX_TOKENS':
      return 'length';
    case 'SAFETY':
    case 'RECITATION':
      return 'error';
    default:
      return 'stop';
  }
}

function toGeminiContents(messages: Message[]): unknown[] {
  const contents: Array<{ role: 'user' | 'model'; parts: unknown[] }> = [];

  for (const message of messages) {
    if (message.role === 'system') continue; // va en `systemInstruction`

    if (message.role === 'assistant' && message.toolCalls && message.toolCalls.length > 0) {
      const parts: unknown[] = [
        ...(message.content ? [{ text: message.content }] : []),
        ...message.toolCalls.map((call) => ({
          functionCall: { name: call.name, args: call.arguments },
          ...(typeof call.providerMeta?.thoughtSignature === 'string'
            ? { thoughtSignature: call.providerMeta.thoughtSignature }
            : {}),
        })),
      ];

      const last = contents[contents.length - 1];
      if (last && last.role === 'model') {
        last.parts.push(...parts);
      } else {
        contents.push({
          role: 'model',
          parts,
        });
      }
      continue;
    }

    if (message.role === 'tool') {
      const responsePart = {
        functionResponse: {
          name: message.name ?? 'tool',
          response: { result: message.content },
        },
      };

      const last = contents[contents.length - 1];
      if (last && last.role === 'user') {
        last.parts.push(responsePart);
      } else {
        contents.push({
          role: 'user',
          parts: [responsePart],
        });
      }
      continue;
    }

    // Mensaje de usuario con imágenes: Gemini usa `inlineData`.
    if (message.role === 'user' && message.images && message.images.length > 0) {
      const parts: unknown[] = [
        ...(message.content ? [{ text: message.content }] : []),
        ...message.images.map((image) => ({
          inlineData: { mimeType: image.mimeType, data: image.data },
        })),
      ];

      const last = contents[contents.length - 1];
      if (last && last.role === 'user') {
        last.parts.push(...parts);
      } else {
        contents.push({
          role: 'user',
          parts,
        });
      }
      continue;
    }

    const role = message.role === 'assistant' ? 'model' : 'user';
    const parts: unknown[] = [{ text: message.content ?? '' }];

    const last = contents[contents.length - 1];
    if (last && last.role === role) {
      last.parts.push(...parts);
    } else {
      contents.push({ role, parts });
    }
  }

  return contents;
}
