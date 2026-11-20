/**
 * Cliente MCP sobre stdio.
 *
 * Lanza un servidor MCP como proceso hijo y habla JSON-RPC 2.0 por su
 * stdin/stdout. Sin dependencias: solo `node:child_process`.
 *
 * Con esto el agente puede usar cualquier servidor MCP del ecosistema
 * (`chrome-devtools-mcp`, `server-filesystem`, `server-git`, …) sin cambiar
 * el bucle.
 *
 * @example
 * const client = await StdioMcpClient.start({
 *   command: 'npx',
 *   args: ['-y', '@modelcontextprotocol/server-filesystem', '.'],
 * });
 * const tools = await toolsFromMcpServer(client);
 * await client.close();
 */

import { spawn, type ChildProcess } from 'node:child_process';
import {
  McpError,
  isNotification,
  isResponse,
  isServerRequest,
  type JsonRpcFailure,
  type JsonRpcId,
  type JsonRpcSuccess,
} from './protocol.js';
import {
  MCP_PROTOCOL_VERSION,
  type McpCallResult,
  type McpClientLike,
  type McpToolDescriptor,
} from './types.js';

/**
 * Variables que no se heredan al servidor MCP.
 *
 * Mismo criterio que `electron/hooks.cjs` para los comandos del agente: un
 * servidor de terceros no hereda la clave del modelo ni tokens de la nube.
 * `test/mcp-entorno.test.mjs` comprueba que las dos listas coincidan.
 */
const VARIABLE_SECRETA =
  /(api[_-]?key|secret|passw|credential|token|^aws_|^openai_|^anthropic_|^gemini_|^google_application_credentials$|^ssh_auth_sock$)/i;

/** Copia el entorno quitando las credenciales. */
export function entornoSanitizado(env: NodeJS.ProcessEnv): Record<string, string> {
  const limpio: Record<string, string> = {};
  for (const [clave, valor] of Object.entries(env)) {
    if (valor === undefined) continue;
    if (VARIABLE_SECRETA.test(clave)) continue;
    limpio[clave] = valor;
  }
  return limpio;
}

export interface StdioMcpOptions {
  /** Ejecutable del servidor MCP (`npx`, `node`, `uvx`, ruta absoluta…). */
  command: string;
  args?: string[];
  /** Variables de entorno extra, fusionadas con las del proceso actual. */
  env?: Record<string, string>;
  cwd?: string;
  /** Timeout por petición, en ms. Por defecto 30 000. */
  timeoutMs?: number;
  /** Recibe la salida de error del servidor (logs, diagnósticos). */
  onStderr?: (chunk: string) => void;
  /** Recibe notificaciones del servidor (`notifications/*`). */
  onNotification?: (method: string, params: unknown) => void;
  /** Identidad que se anuncia en el handshake. */
  clientName?: string;
  clientVersion?: string;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: NodeJS.Timeout;
  method: string;
}

/** Servidor MCP hablado por stdio. */
export interface McpResourceDescriptor {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface McpPromptDescriptor {
  name: string;
  description?: string;
  arguments?: Array<{ name: string; description?: string; required?: boolean }>;
}

export class StdioMcpClient implements McpClientLike {
  private readonly child: ChildProcess;
  private readonly pending = new Map<JsonRpcId, PendingRequest>();
  private readonly timeoutMs: number;
  private readonly onNotification: ((method: string, params: unknown) => void) | undefined;

  private serverInfoValue: { name: string; version: string } | undefined;
  private buffer = '';
  private nextId = 1;
  private closed = false;

  private constructor(
    child: ChildProcess,
    timeoutMs: number,
    onNotification: ((method: string, params: unknown) => void) | undefined,
  ) {
    this.child = child;
    this.timeoutMs = timeoutMs;
    this.onNotification = onNotification;
    this.attach();
  }

  /** Identidad que devolvió el servidor en el handshake. */
  get serverInfo(): { name: string; version: string } | undefined {
    return this.serverInfoValue;
  }

  /**
   * Lanza el servidor y completa el handshake MCP.
   * Resuelve solo cuando el servidor ha aceptado `initialize`.
   */
  static async start(options: StdioMcpOptions): Promise<StdioMcpClient> {
    const timeoutMs = options.timeoutMs ?? 30_000;

    // En Windows, `npx`/`uvx` son scripts .cmd y no se pueden lanzar directos.
    const onWindows = process.platform === 'win32';
    const needsShell = onWindows && !/\.(exe|cmd|bat|com)$/i.test(options.command);

    const child = spawn(
      needsShell ? 'cmd.exe' : options.command,
      needsShell ? ['/c', options.command, ...(options.args ?? [])] : options.args ?? [],
      {
        ...(options.cwd ? { cwd: options.cwd } : {}),
        // Las credenciales del proceso no viajan al servidor; las que el usuario
        // declare en su configuración, sí.
        env: { ...entornoSanitizado(process.env), ...options.env },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      },
    );

    if (options.onStderr && child.stderr) {
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk: string) => options.onStderr?.(chunk));
    }

    const client = new StdioMcpClient(child, timeoutMs, options.onNotification);

    // Si el proceso no llega a arrancar, el handshake fallará con un error claro.
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => {
        reject(new McpError(-32000, `no se pudo lanzar "${options.command}": ${error.message}`));
      };
      child.once('error', onError);
      child.once('spawn', () => {
        child.off('error', onError);
        resolve();
      });
    });

    try {
      const result = (await client.request('initialize', {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: {} },
        clientInfo: {
          name: options.clientName ?? 'agent-ide',
          version: options.clientVersion ?? '0.1.0',
        },
      })) as { serverInfo?: { name?: string; version?: string } } | undefined;

      client.serverInfoValue = {
        name: result?.serverInfo?.name ?? options.command,
        version: result?.serverInfo?.version ?? 'desconocida',
      };

      // Notificación obligatoria tras un initialize correcto.
      client.notify('notifications/initialized', {});
    } catch (error) {
      // Un handshake fallido no debe dejar el proceso hijo vivo.
      await client.close().catch(() => {});
      throw error;
    }

    return client;
  }

  /** Catálogo de herramientas del servidor. */
  async listTools(): Promise<McpToolDescriptor[]> {
    const descriptors: McpToolDescriptor[] = [];
    let cursor: string | undefined;
    let paginas = 0;

    do {
      const result = (await this.request('tools/list', cursor ? { cursor } : {})) as
        | {
            tools?: Array<{ name?: string; description?: string; inputSchema?: Record<string, unknown> }>;
            nextCursor?: string;
          }
        | undefined;

      for (const tool of result?.tools ?? []) {
        if (typeof tool.name !== 'string') continue;
        descriptors.push({
          name: tool.name,
          ...(tool.description !== undefined ? { description: tool.description } : {}),
          ...(tool.inputSchema !== undefined ? { inputSchema: tool.inputSchema } : {}),
        });
      }
      cursor = typeof result?.nextCursor === 'string' ? result.nextCursor : undefined;
      paginas += 1;
    } while (cursor && paginas < 50);

    return descriptors;
  }

  /** Invoca una herramienta y aplana su contenido a texto. */
  async callTool(name: string, args: Record<string, unknown>): Promise<McpCallResult> {
    const result = (await this.request('tools/call', { name, arguments: args })) as
      | { content?: unknown; isError?: boolean }
      | undefined;

    return {
      text: flattenContent(result?.content),
      isError: result?.isError === true,
    };
  }

  /** Recursos que expone el servidor. */
  async listResources(): Promise<McpResourceDescriptor[]> {
    const recursos: McpResourceDescriptor[] = [];
    let cursor: string | undefined;
    let paginas = 0;

    do {
      const result = (await this.request('resources/list', cursor ? { cursor } : {})) as
        | {
            resources?: Array<{
              uri?: string;
              name?: string;
              description?: string;
              mimeType?: string;
            }>;
            nextCursor?: string;
          }
        | undefined;

      for (const recurso of result?.resources ?? []) {
        if (typeof recurso.uri !== 'string') continue;
        recursos.push({
          uri: recurso.uri,
          name: typeof recurso.name === 'string' ? recurso.name : recurso.uri,
          ...(recurso.description !== undefined ? { description: recurso.description } : {}),
          ...(recurso.mimeType !== undefined ? { mimeType: recurso.mimeType } : {}),
        });
      }
      cursor = typeof result?.nextCursor === 'string' ? result.nextCursor : undefined;
      paginas += 1;
    } while (cursor && paginas < 50);

    return recursos;
  }

  /** Lee un recurso y aplana su contenido a texto. */
  async readResource(uri: string): Promise<{ text: string; mimeType?: string }> {
    const result = (await this.request('resources/read', { uri })) as
      | {
          contents?: Array<{ uri?: string; text?: string; blob?: string; mimeType?: string }>;
        }
      | undefined;

    const partes: string[] = [];
    let mimeType: string | undefined;

    for (const contenido of result?.contents ?? []) {
      if (typeof contenido.text === 'string') partes.push(contenido.text);
      else if (typeof contenido.blob === 'string') {
        partes.push(`[binario ${contenido.mimeType ?? 'desconocido'}, ${contenido.blob.length} bytes en base64]`);
      }
      if (contenido.mimeType && !mimeType) mimeType = contenido.mimeType;
    }

    return {
      text: partes.length > 0 ? partes.join('\n\n') : '(el recurso no devolvió contenido de texto)',
      ...(mimeType !== undefined ? { mimeType } : {}),
    };
  }

  /** Plantillas de prompt que expone el servidor. */
  async listPrompts(): Promise<McpPromptDescriptor[]> {
    const prompts: McpPromptDescriptor[] = [];
    let cursor: string | undefined;
    let paginas = 0;

    do {
      const result = (await this.request('prompts/list', cursor ? { cursor } : {})) as
        | {
            prompts?: Array<{
              name?: string;
              description?: string;
              arguments?: Array<{ name?: string; description?: string; required?: boolean }>;
            }>;
            nextCursor?: string;
          }
        | undefined;

      for (const prompt of result?.prompts ?? []) {
        if (typeof prompt.name !== 'string') continue;
        prompts.push({
          name: prompt.name,
          ...(prompt.description !== undefined ? { description: prompt.description } : {}),
          ...(Array.isArray(prompt.arguments)
            ? {
                arguments: prompt.arguments
                  .filter((arg) => typeof arg?.name === 'string')
                  .map((arg) => ({
                    name: String(arg.name),
                    ...(arg.description !== undefined ? { description: arg.description } : {}),
                    ...(arg.required !== undefined ? { required: arg.required } : {}),
                  })),
              }
            : {}),
        });
      }
      cursor = typeof result?.nextCursor === 'string' ? result.nextCursor : undefined;
      paginas += 1;
    } while (cursor && paginas < 50);

    return prompts;
  }

  /** Obtiene un prompt ya rellenado con sus argumentos. */
  async getPrompt(
    name: string,
    args: Record<string, string>,
  ): Promise<{ text: string; description?: string }> {
    const result = (await this.request('prompts/get', { name, arguments: args })) as
      | {
          description?: string;
          messages?: Array<{ role?: string; content?: unknown }>;
        }
      | undefined;

    const partes: string[] = [];
    for (const mensaje of result?.messages ?? []) {
      const rol = typeof mensaje.role === 'string' ? mensaje.role : 'user';
      partes.push(`[${rol}] ${flattenContent(mensaje.content)}`);
    }

    return {
      text: partes.length > 0 ? partes.join('\n\n') : '(el prompt no devolvió mensajes)',
      ...(result?.description !== undefined ? { description: result.description } : {}),
    };
  }

  /** Cierra stdin y espera a que el proceso termine; fuerza SIGKILL si se resiste. */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(new McpError(-32000, 'cliente cerrado'));
    }
    this.pending.clear();

    if (this.child.exitCode !== null) return;

    await new Promise<void>((resolve) => {
      const kill = setTimeout(() => {
        this.child.kill('SIGKILL');
        resolve();
      }, 2_000);

      this.child.once('exit', () => {
        clearTimeout(kill);
        resolve();
      });

      try {
        this.child.stdin?.end();
      } catch {
        // stdin ya cerrado
      }
    });
  }

  /** Envía una notificación (sin respuesta esperada). */
  notify(method: string, params: unknown): void {
    if (this.closed) return;
    this.write({ jsonrpc: '2.0', method, params });
  }

  private request(method: string, params: unknown): Promise<unknown> {
    if (this.closed) {
      return Promise.reject(new McpError(-32000, 'cliente cerrado'));
    }

    const id = this.nextId;
    this.nextId += 1;

    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new McpError(-32000, `timeout de ${this.timeoutMs} ms en "${method}"`));
      }, this.timeoutMs);

      this.pending.set(id, { resolve, reject, timer, method });
      if (!this.write({ jsonrpc: '2.0', id, method, params })) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new McpError(-32000, 'stdin del servidor MCP no disponible'));
      }
    });
  }

  /** Devuelve false en vez de lanzar: se llama desde handlers de stdout. */
  private write(message: unknown): boolean {
    const stdin = this.child.stdin;
    if (!stdin || stdin.destroyed) return false;
    /*
     * Un servidor que muere mientras se le escribe emite EPIPE en stdin: sin
     * manejador, Node lo lanza como error no capturado y tumba el proceso
     * principal de Electron.
     */
    try {
      stdin.write(`${JSON.stringify(message)}\n`);
      return true;
    } catch {
      return false;
    }
  }

  private attach(): void {
    // Un solo listener: añadirlo en cada write disparaba MaxListeners.
    this.child.stdin?.on('error', () => {});
    const stdout = this.child.stdout;
    if (stdout) {
      stdout.setEncoding('utf8');
      stdout.on('data', (chunk: string) => this.consume(chunk));
    }

    this.child.once('exit', (code, signal) => {
      if (this.closed) return;
      const reason = signal ? `señal ${signal}` : `código ${code ?? 'desconocido'}`;
      for (const [, entry] of this.pending) {
        clearTimeout(entry.timer);
        entry.reject(new McpError(-32000, `servidor MCP terminó (${reason}) durante "${entry.method}"`));
      }
      this.pending.clear();
    });
  }

  /** Acumula bytes y procesa mensajes completos (uno por línea). */
  private consume(chunk: string): void {
    this.buffer += chunk;

    let newline = this.buffer.indexOf('\n');
    while (newline !== -1) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (line.length > 0) this.handleLine(line);
      newline = this.buffer.indexOf('\n');
    }
  }

  private handleLine(line: string): void {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      // Línea no JSON: algunos servidores escriben logs por stdout.
      return;
    }

    if (isResponse(message)) {
      this.settle(message);
      return;
    }

    if (isServerRequest(message)) {
      // No soportamos sampling ni roots todavía: respondemos method-not-found
      // para que el servidor no se quede bloqueado esperando.
      this.write({
        jsonrpc: '2.0',
        id: message.id,
        error: { code: -32601, message: `método no soportado: ${message.method}` },
      });
      return;
    }

    if (isNotification(message)) {
      this.onNotification?.(message.method, message.params);
    }
  }

  private settle(response: JsonRpcSuccess | JsonRpcFailure): void {
    const entry = this.pending.get(response.id);
    if (!entry) return;

    this.pending.delete(response.id);
    clearTimeout(entry.timer);

    if ('error' in response) {
      entry.reject(new McpError(response.error.code, response.error.message, response.error.data));
      return;
    }

    entry.resolve(response.result);
  }
}

/** Convierte el array `content` de MCP a texto plano. */
function flattenContent(content: unknown): string {
  // Un bloque suelto (los prompts devuelven `content` como objeto, no como array).
  if (content && typeof content === 'object' && !Array.isArray(content)) {
    const bloque = content as { type?: string; text?: string; resource?: { text?: string } };
    if (bloque.type === 'text' && typeof bloque.text === 'string') return bloque.text;
    if (bloque.type === 'resource' && typeof bloque.resource?.text === 'string') {
      return bloque.resource.text;
    }
    if (typeof (content as { text?: unknown }).text === 'string') {
      return String((content as { text: string }).text);
    }
  }

  if (!Array.isArray(content)) {
    return content === undefined ? '' : JSON.stringify(content);
  }

  const parts: string[] = [];
  for (const item of content) {
    if (!item || typeof item !== 'object') {
      parts.push(String(item));
      continue;
    }
    const block = item as { type?: string; text?: string; resource?: { text?: string } };
    if (block.type === 'text' && typeof block.text === 'string') {
      parts.push(block.text);
    } else if (block.type === 'resource' && typeof block.resource?.text === 'string') {
      parts.push(block.resource.text);
    } else {
      parts.push(JSON.stringify(block));
    }
  }

  return parts.join('\n');
}
