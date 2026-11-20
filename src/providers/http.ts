/**
 * Utilidades compartidas por los adaptadores de proveedor.
 * Sin dependencias externas: solo `fetch` nativo de Node 20+.
 */

import { ProviderError } from './types.js';

/**
 * Tiempo máximo para listar modelos.
 *
 * La detección recorre proveedores en serie: uno que no responde no puede
 * dejar la lista de modelos (y los ajustes) esperando para siempre.
 */
export const LIST_TIMEOUT_MS = 12_000;

/**
 * Lee un cuerpo `text/event-stream` y entrega cada evento `data:` ya parseado.
 *
 * OpenAI, Anthropic y Gemini usan SSE. En vez de repetir el parser en cada
 * adaptador, se centraliza aquí.
 */
export async function* readSSE(
  body: ReadableStream<Uint8Array>,
  providerId: string,
): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let buffer = '';

  const reader = body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      /*
       * Los eventos SSE se separan por línea en blanco. El estándar permite
       * CRLF, y hay pasarelas que lo usan: buscar solo `\n\n` dejaba el turno
       * sin eventos o con un bloque ilegible.
       */
      let separador = /\r?\n\r?\n/.exec(buffer);
      while (separador) {
        const rawEvent = buffer.slice(0, separador.index);
        buffer = buffer.slice(separador.index + separador[0].length);

        const datos: string[] = [];
        for (const line of rawEvent.split(/\r?\n/)) {
          const trimmed = line.trimStart();
          if (!trimmed.startsWith('data:')) continue;

          const payload = trimmed.slice(5).trim();
          if (payload.length === 0) continue;
          if (payload === '[DONE]') return;
          datos.push(payload);
        }
        // SSE permite partir un JSON en varias líneas `data:`; se unen antes
        // de parsear, como exige el estándar.
        if (datos.length > 0) yield datos.join('\n');

        separador = /\r?\n\r?\n/.exec(buffer);
      }
    }
  } finally {
    /*
     * Al recibir `[DONE]` salimos sin consumir el resto del cuerpo. Si no se
     * cancela, la conexión queda ocupada y la siguiente petición al mismo
     * endpoint espera indefinidamente (por ejemplo, el título de la sesión
     * después del turno). Cancelar cierra ese cuerpo y libera la conexión.
     */
    try {
      await reader.cancel();
    } catch {
      // el cuerpo ya estaba cerrado
    }
    reader.releaseLock();
  }

  // Resto sin terminador: algunos servidores no cierran con línea en blanco.
  const cola = buffer
    .split(/\r?\n/)
    .map((linea) => linea.trimStart())
    .filter((linea) => linea.startsWith('data:'))
    .map((linea) => linea.slice(5).trim())
    .filter((linea) => linea.length > 0 && linea !== '[DONE]');
  if (cola.length > 0) yield cola.join('\n');
}

/**
 * Lee un cuerpo NDJSON (una línea = un objeto JSON).
 * Ollama usa este formato en `/api/chat`.
 */
export async function* readNDJSON(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let buffer = '';

  const reader = body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      let newline = buffer.indexOf('\n');
      while (newline !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line.length > 0) yield line;
        newline = buffer.indexOf('\n');
      }
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // el cuerpo ya estaba cerrado
    }
    reader.releaseLock();
  }

  const tail = buffer.trim();
  if (tail.length > 0) yield tail;
}

/** Parsea JSON sin lanzar; devuelve `undefined` si el texto no es JSON válido. */
export function tryParseJSON(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Convierte los argumentos de una herramienta a objeto.
 * Algunos modelos devuelven string JSON en lugar de objeto.
 */
export function coerceArguments(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === 'string') {
    const parsed = tryParseJSON(value);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  }
  return {};
}

/** Lanza `ProviderError` si la respuesta HTTP no es 2xx, con el cuerpo como detalle. */
export async function ensureOk(
  response: Response,
  providerId: string,
): Promise<void> {
  if (response.ok) return;

  let detail = '';
  try {
    detail = (await response.text()).slice(0, 500);
  } catch {
    detail = '<sin cuerpo>';
  }
  throw new ProviderError(providerId, response.status, `HTTP ${response.status}: ${detail}`);
}

/** Códigos HTTP que merece la pena reintentar. */
const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

/** Espera entre reintentos: base exponencial con algo de jitter. */
function backoffDelay(attempt: number, baseMs: number): number {
  const exponential = baseMs * 2 ** (attempt - 1);
  const jitter = Math.random() * baseMs * 0.5;
  return Math.min(exponential + jitter, 20_000);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    const alAbortar = () => done();
    function done(): void {
      clearTimeout(timer);
      signal?.removeEventListener('abort', alAbortar);
      resolve();
    }
    signal?.addEventListener('abort', alAbortar, { once: true });
  });
}

/**
 * Ejecuta una petición HTTP con reintentos.
 *
 * Reintenta errores de red y códigos transitorios (429, 5xx). Respeta
 * `Retry-After` si el servidor lo envía. Un 4xx distinto de 408/429 no se
 * reintenta: la petición está mal y repetirla no ayuda.
 */
export async function fetchWithRetry(
  input: string,
  init: RequestInit,
  providerId: string,
  options: { retries?: number; baseMs?: number; signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<Response> {
  const retries = options.retries ?? 3;
  const baseMs = options.baseMs ?? 700;
  const signal = options.signal ?? init.signal ?? undefined;
  const attemptTimeout = options.timeoutMs ?? 45_000;

  let lastError: unknown = null;

  for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
    if (signal?.aborted) throw new ProviderError(providerId, undefined, 'petición cancelada');

    /*
     * El timeout debe gobernar solo la espera de cabeceras. Si se pasa
     * `AbortSignal.timeout` al fetch, ese signal sigue atado al cuerpo y corta
     * cualquier stream de más de 45 s; el bucle del agente tiene su propio
     * timeout por inactividad, mucho más apropiado.
     */
    const controlador = new AbortController();
    const abortarPorSenal = () => controlador.abort();
    if (signal) {
      signal.addEventListener('abort', abortarPorSenal, { once: true });
      if (signal.aborted) controlador.abort();
    }
    const temporizador = setTimeout(() => controlador.abort(), attemptTimeout);

    let response;
    try {
      response = await fetch(input, { ...init, signal: controlador.signal });
    } finally {
      clearTimeout(temporizador);
    }

    try {
      if (response.ok || !RETRYABLE_STATUS.has(response.status) || attempt > retries) {
        // La escucha se conserva: el mismo signal debe poder cortar el cuerpo.
        return response;
      }

      // 429/503 pueden pedir una espera concreta.
      const retryAfter = Number(response.headers.get('retry-after') ?? '');
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : backoffDelay(attempt, baseMs);

      lastError = new ProviderError(
        providerId,
        response.status,
        `HTTP ${response.status} (reintento ${attempt}/${retries})`,
      );

      // Cerrar el cuerpo antes de esperar: si no, la conexión queda ocupada.
      try {
        await response.body?.cancel();
      } catch {
        // el cuerpo ya estaba cerrado
      }

      signal?.removeEventListener('abort', abortarPorSenal);
      await sleep(Math.min(waitMs, 60_000), signal);
    } catch (error) {
      signal?.removeEventListener('abort', abortarPorSenal);
      // Errores de red o timeout de intento: reintentar tiene sentido salvo cancelación explícita.
      if (signal?.aborted) throw error;

      lastError = error;
      if (attempt > retries) break;
      await sleep(backoffDelay(attempt, baseMs), signal);
    }
  }

  if (lastError instanceof Error) throw lastError;
  throw new ProviderError(providerId, undefined, 'la petición falló tras varios intentos');
}

/** Base URL por defecto de cada proveedor, sobreescribible por configuración. *//** Base URL por defecto de cada proveedor, sobreescribible por configuración. */
export const DEFAULT_BASE_URLS = {
  ollama: 'http://127.0.0.1:11434',
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
} as const;

/**
 * Texto de un delta, sea cual sea la forma en que llegue.
 *
 * La API de OpenAI define `content` como cadena, pero varias pasarelas
 * compatibles mandan una lista de partes (`[{ type: 'text', text: '…' }]`) y
 * algunos modelos mandan un objeto. Concatenar eso tal cual producía el literal
 * «[object Object]» en el hilo, así que se normaliza aquí, en el borde.
 */
export function textoDeDelta(valor: unknown): string {
  if (typeof valor === 'string') return valor;
  if (Array.isArray(valor)) {
    let texto = '';
    for (const parte of valor) {
      if (typeof parte === 'string') {
        texto += parte;
        continue;
      }
      if (parte && typeof parte === 'object') {
        const registro = parte as { text?: unknown; content?: unknown };
        if (typeof registro.text === 'string') texto += registro.text;
        else if (typeof registro.content === 'string') texto += registro.content;
      }
    }
    return texto;
  }
  if (valor && typeof valor === 'object') {
    const registro = valor as { text?: unknown; content?: unknown };
    if (typeof registro.text === 'string') return registro.text;
    if (typeof registro.content === 'string') return registro.content;
  }
  return '';
}
