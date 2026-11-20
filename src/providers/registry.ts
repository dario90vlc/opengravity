/**
 * Registro de proveedores.
 *
 * Punto único de creación: el resto del sistema pide un `ModelProvider` por id
 * y no conoce las clases concretas. Los endpoints viven en `catalog.ts`.
 */

import { AnthropicProvider, type AnthropicOptions } from './anthropic.js';
import {
  PROVIDER_CATALOG,
  findProvider,
  hasCredentials,
  resolveApiKey,
  resolveBaseUrl,
  type ProviderKind,
} from './catalog.js';
import { GeminiProvider, type GeminiOptions } from './gemini.js';
import { OllamaProvider, type OllamaOptions } from './ollama.js';
import { OpenAIProvider, type OpenAIOptions } from './openai.js';
import type { ModelProvider } from './types.js';

/** Identificador de proveedor. Los del catálogo, o uno propio. */
export type ProviderId = string;

/**
 * Identificador de sesión estable por proceso.
 * OpenCode lo usa para enrutar y cachear prompts; enviar uno distinto en cada
 * petición empeora el rendimiento.
 */
const SESSION_ID = `agent-ide-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;

/** Sobrescrituras por proveedor (opcional; el catálogo ya trae los valores). */
export interface ProviderConfig {
  ollama?: OllamaOptions;
  openai?: OpenAIOptions;
  anthropic?: AnthropicOptions;
  gemini?: GeminiOptions;
  /** Sobrescritura de endpoint para cualquier id del catálogo. */
  baseUrls?: Record<string, string>;
  /** Sobrescritura de clave para cualquier id del catálogo. */
  apiKeys?: Record<string, string>;
}

/**
 * Crea un proveedor por id resolviendo endpoint y clave.
 *
 * @example
 * const provider = createProvider('openrouter');
 * const models = await provider.listModels();
 */
export function createProvider(id: ProviderId, config: ProviderConfig = {}): ModelProvider {
  const spec = findProvider(id);
  if (!spec) {
    const known = PROVIDER_CATALOG.map((entry) => entry.id).join(', ');
    throw new Error(`proveedor desconocido: "${id}". Disponibles: ${known}`);
  }

  const baseUrl = (config.baseUrls?.[id] ?? resolveBaseUrl(spec)).replace(/\/+$/, '');
  const apiKey = config.apiKeys?.[id] ?? resolveApiKey(spec);

  if (baseUrl.length === 0) {
    throw new Error(
      `el proveedor "${id}" necesita una URL de endpoint. Configúrala en Settings › Models.`,
    );
  }

  // Cabeceras fijas del catálogo + cabecera de sesión de OpenCode.
  const headers: Record<string, string> = { ...(spec.headers ?? {}) };
  if (spec.opencode) headers['x-opencode-session'] = SESSION_ID;

  switch (spec.kind) {
    case 'ollama':
      return new OllamaProvider({ ...config.ollama, baseUrl });

    case 'openai':
      return new OpenAIProvider({ ...config.openai, baseUrl, apiKey, headers });

    case 'anthropic':
      return new AnthropicProvider({ ...config.anthropic, baseUrl, apiKey, headers });

    case 'gemini':
      return new GeminiProvider({ ...config.gemini, baseUrl, apiKey });

    default: {
      const exhaustive: never = spec.kind;
      throw new Error(`tipo de proveedor no soportado: ${String(exhaustive)}`);
    }
  }
}

/**
 * ¿Este modelo admite pensamiento extendido explícito?
 *
 * Solo se ofrece donde el adaptador sabe pedirlo y el modelo lo soporta:
 * Claude 3.7+ y Gemini 2.5+. En el resto el razonamiento, si existe, lo emite
 * el propio modelo sin configuración; no se le pide nada ni se cambia de modelo.
 */
export function soportaPensamiento(
  kind: ProviderKind,
  model: string,
  providerId?: string,
): boolean {
  const id = String(model ?? '').toLowerCase();
  if (kind === 'openai') {
    /*
     * Solo los modelos de razonamiento de OpenAI aceptan `reasoning_effort`.
     * Se exige el proveedor `openai`: las pasarelas compatibles (Groq,
     * OpenRouter, un servidor local) no tienen por qué aceptar el campo.
     */
    return providerId === 'openai' && /^(o[134]|gpt-5)/.test(id);
  }
  if (kind === 'anthropic') {
    /*
     * El adaptador pide `thinking: {type:"enabled", budget_tokens}`, que solo
     * aceptan 3.7–4.6. Claude 4.7+ y 5.x solo admiten `adaptive` y rechazan
     * `enabled` con 400, así que ahí el botón no se ofrece.
     */
    // La fecha del id (`claude-sonnet-4-20250514`) no es la versión menor.
    const version = id.match(/claude-(?:[a-z]+-)?(\d+)(?:[.-](\d{1,2}))?(?=$|-)/);
    if (!version) return false;
    const mayor = Number(version[1]);
    const menor = Number(version[2] ?? 0);
    return (mayor === 3 && menor >= 7) || (mayor === 4 && menor <= 6);
  }
  if (kind === 'gemini') return /gemini-(?:2\.5|[3-9])/.test(id);
  return false;
}

/** Proveedores del catálogo que tienen credenciales ahora mismo. */
export function providersWithCredentials(): string[] {
  return PROVIDER_CATALOG.filter(hasCredentials).map((entry) => entry.id);
}

/**
 * Detecta qué proveedores responden de verdad.
 *
 * Comprueba credenciales primero (barato) y solo entonces consulta el listado
 * de modelos. Los locales se prueban siempre: si no están corriendo, fallan.
 */
export async function detectAvailableProviders(
  config: ProviderConfig = {},
): Promise<string[]> {
  /*
   * Las claves guardadas en Ajustes cuentan igual que las del entorno: antes
   * solo se miraba el entorno y un usuario que pegaba su clave aparecía sin
   * proveedores. Se consultan en paralelo y cada fallo se descarta solo.
   */
  const candidatos = PROVIDER_CATALOG.filter((spec) => {
    const guardada = config.apiKeys?.[spec.id];
    const delEntorno = spec.envKey ? process.env[spec.envKey] : undefined;
    if (spec.envKey !== null && !guardada && !delEntorno) return false;
    // Los personalizables solo se prueban si el usuario ya puso una URL.
    if (spec.custom && !(config.baseUrls?.[spec.id] ?? resolveBaseUrl(spec))) return false;
    return true;
  });

  const resultados = await Promise.all(
    candidatos.map(async (spec) => {
      try {
        const models = await createProvider(spec.id, config).listModels();
        return models.length > 0 ? spec.id : null;
      } catch {
        return null;
      }
    }),
  );

  return resultados.filter((id): id is string => id !== null);
}

export { AnthropicProvider, GeminiProvider, OllamaProvider, OpenAIProvider };
export type { AnthropicOptions, GeminiOptions, OllamaOptions, OpenAIOptions };
export { PROVIDER_CATALOG, findProvider } from './catalog.js';
