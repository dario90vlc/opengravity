/**
 * Contrato de herramienta.
 *
 * Una herramienta es una función que el modelo puede invocar. El registro
 * (ver `registry.ts`) las expone al proveedor y ejecuta la que el modelo pida.
 *
 * Este diseño es compatible con MCP: un cliente MCP se adapta a `Tool` sin
 * tocar el agente (ver `mcp-adapter.ts`).
 */

import type { JSONSchema } from '../providers/types.js';

/** Contexto de ejecución que recibe cada herramienta. */
export interface ToolContext {
  /** Directorio de trabajo del agente. Las rutas relativas se resuelven aquí. */
  cwd: string;
  /** Señal de cancelación de la operación completa. */
  signal?: AbortSignal;
  /** Logger opcional, para trazar qué hace el agente. */
  log?: (message: string) => void;
  /** Id de la llamada del modelo, para que la UI case el aviso con su fila. */
  callId?: string;
  /** Conversación y turno que originaron la herramienta (subagentes incluidos). */
  sessionId?: string | null;
  turno?: number | null;
}

/** Resultado de una herramienta. */
export interface ToolResult {
  /** Texto que se devuelve al modelo. Debe ser autosuficiente. */
  content: string;
  /** Si es `true`, el agente detiene el bucle y reporta error. */
  isError?: boolean;
  /**
   * Información para la interfaz, no para el modelo.
   * `command` es la orden que se muestra en la tarjeta de terminal.
   */
  meta?: { command?: string };
}

/** Definición ejecutable de una herramienta. */
export interface Tool {
  name: string;
  description: string;
  parameters: JSONSchema;
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
}

/** Azúcar para construir herramientas con tipos inferidos. */
export function defineTool(tool: Tool): Tool {
  return tool;
}
