#!/usr/bin/env node
/**
 * CLI de Opengravity.
 *
 * Dos superficies:
 *   - interactiva/one-shot: `npm run dev -- "resume este proyecto"`
 *   - headless tipo `agy -p`: `--print`, `--output-format`,
 *     `--effort`, `--mode`, `--sandbox`, `--dangerously-skip-permissions`.
 *
 * El catálogo de herramientas es el mismo que el de la app salvo las que
 * necesitan Electron (navegador, Flow, abrir URL). El motor es `runAgent`.
 */

import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { runAgent } from './agent/loop.js';
import { clasificarAccion } from './agent/classifier.js';
import { ventanaDeModelo } from './agent/contexto.js';
import { crearHerramientasCli } from './cli/tools.js';
import { crearSalida, type FormatoSalida } from './cli/output.js';
import { correrStreamJson } from './cli/stream.js';
import { correrTui, type PreguntaActual } from './cli/tui.js';
import { correrTuiCompleta } from './cli/tui-chat.js';
import {
  configProveedor,
  descifrarClavesApp,
  leerSettingsApp,
  rutaSettingsApp,
  type AppSettings,
  type PermissionsConfig,
} from './cli/settings.js';
import { decidirPorReglas } from './cli/permissions.js';
import { compilarValidador } from './cli/schema.js';
import { makeInvokeSubagentTool, makePresentPlanTool } from './cli/subagents.js';
import { configurarTrayectoria, crearTrayectoriaCli } from './cli/trayectoria.js';
import { PlanSession } from './cli/plan.js';
import { CdpClient, connectToPage } from './editor/cdp.js';
import { editorTools } from './editor/tools.js';
import { StdioMcpClient } from './mcp/stdio-client.js';
import { JsonlSessionStore } from './persistence/jsonl-store.js';
import {
  createProvider,
  detectAvailableProviders,
  findProvider,
  PROVIDER_CATALOG,
} from './providers/registry.js';
import type { Message } from './providers/types.js';
import { toolsFromMcpServer } from './tools/mcp-adapter.js';
import { ToolRegistry } from './tools/registry.js';
import type { Tool } from './tools/types.js';

/*
 * Un `| head` cierra stdout mientras el proceso escribe. Sin esto, Node lanza
 * un EPIPE no capturado y ensucia la salida de cualquier script.
 */
process.stdout.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EPIPE') process.exit(0);
  throw error;
});
process.stderr.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EPIPE') process.exit(0);
  throw error;
});

const requerir = createRequire(import.meta.url);
const reglasMod = requerir('../electron/rules.cjs');
const guardianMod = requerir('../electron/guardian.cjs');
const skillsMod = requerir('../electron/skills.cjs');
const subagentesMod = requerir('../electron/subagents.cjs');
subagentesMod.configurar(resolve(dirname(rutaSettingsApp()), 'subagents.json'));
const pensamiento = requerir('../electron/pensamiento.cjs');
const extra = requerir('../electron/tools-extra.cjs');

interface McpServerSpec {
  command: string;
  args: string[];
}

type Modo = 'default' | 'accept-edits' | 'auto' | 'plan';
type FormatoEntrada = 'text' | 'stream-json';

interface CliOptions {
  provider: string;
  model: string | undefined;
  prompt: string;
  listModelsOnly: boolean;
  listToolsOnly: boolean;
  listSessionsOnly: boolean;
  listProvidersOnly: boolean;
  mcpServers: McpServerSpec[];
  cdpPort: number | undefined;
  session: string | undefined;
  noSave: boolean;
  outputFormat: FormatoSalida;
  inputFormat: FormatoEntrada;
  mode: Modo;
  effort: string | undefined;
  sandbox: boolean;
  skipPermissions: boolean;
  printTimeoutMs: number;
  jsonSchema: string | undefined;
  addDirs: string[];
  help: boolean;
  /** Si el flag se pasó explícitamente, manda sobre settings.json. */
  providerExplicit: boolean;
  modelExplicit: boolean;
  effortExplicit: boolean;
  modeExplicit: boolean;
}

const ENTORNO =
  process.platform === 'win32'
    ? 'Entorno: Windows. La shell de run_command es PowerShell. Usa rutas con barra ' +
      'invertida o relativa; no uses /c/Users/... ni comandos de Unix como find, grep o ls.'
    : `Entorno: ${process.platform}. Shell POSIX.`;

const SYSTEM_PROMPT = `${ENTORNO}

Eres un asistente de programación en la terminal.

Reglas:
- Inspecciona el código antes de afirmar cosas sobre él. Cita rutas concretas.
- Si algo no lo has comprobado, dilo; no lo supongas.
- prefiere search_files/file_search/search_code antes de leer ficheros a ciegas.
- read_file devuelve líneas con prefijo "N | "; ese prefijo no está en el fichero.
- Para cambiar un fichero existente usa edit_file o multi_replace, no write_file.
- run_command ejecuta PowerShell en Windows y /bin/sh en POSIX. run_tests resume la suite.
- Cuando ya tengas suficiente información, responde sin más herramientas.
- Responde en el idioma del usuario.`;

const PLAN_INSTRUCTION = `

## Modo plan

Empieza planificando: investiga lo necesario y entrega el plan con present_plan
(pasos concretos, rutas y verificaciones). Mientras el plan no esté aprobado no
puedes escribir ni ejecutar comandos. Cuando el usuario lo apruebe, ejecuta los
pasos en orden y verifica el resultado.`;

const ESFUERZO_TEXTO: Record<string, string> = {
  minimal: 'Responde con lo mínimo: la respuesta más corta que resuelva la petición.',
  low: 'Responde de forma directa y breve, con los mínimos pasos.',
  medium: 'Equilibra brevedad y rigor: explica lo justo antes de actuar.',
  high: 'Razona con detalle, verifica cada paso y revisa el resultado.',
  xhigh: 'Descompón el problema, contrasta hipótesis y revisa dos veces.',
  max: 'Razona al máximo, descarta alternativas con evidencia y verifica.',
};

/** Herramientas que escriben en disco. */
const ESCRITURAS: Record<string, true> = {
  write_file: true,
  edit_file: true,
  multi_replace: true,
  edit_notebook: true,
};

/** Herramientas que ejecutan procesos. */
const COMANDOS: Record<string, true> = {
  run_command: true,
  run_workflow: true,
  run_extension_code: true,
  run_tests: true,
  manage_task: true,
  invoke_subagent: true,
};

/** Herramientas con acceso a red. */
const RED: Record<string, true> = {
  search_web: true,
  fetch_url: true,
};

/** Herramientas de lectura conocidas. El resto (MCP) pide permiso por defecto. */
const LECTURAS: Record<string, true> = {
  read_file: true,
  list_directory: true,
  search_files: true,
  file_search: true,
  search_code: true,
  view_code_item: true,
  command_status: true,
  memory: true,
  skill: true,
  present_plan: true,
  editor_visible_text: true,
  editor_current_file: true,
};

function parseDuracion(valor: string): number {
  if (valor === '0' || valor === '0s' || valor === '0ms') return 0;
  const coincidencia = /^(\d+(?:\.\d+)?)(ms|s|m|h)$/.exec(valor);
  if (!coincidencia) {
    throw new Error(`--print-timeout espera un valor como 30s, 5m o 1h; recibido "${valor}"`);
  }
  const cantidad = Number(coincidencia[1]);
  const unidad = coincidencia[2];
  const factor = unidad === 'ms' ? 1 : unidad === 's' ? 1000 : unidad === 'm' ? 60_000 : 3_600_000;
  return Math.round(cantidad * factor);
}

function parseArgs(argv: string[]): CliOptions {
  let provider = 'ollama';
  let model: string | undefined;
  let promptFlag: string | undefined;
  let listModelsOnly = false;
  let listToolsOnly = false;
  let listSessionsOnly = false;
  let listProvidersOnly = false;
  let noSave = false;
  let session: string | undefined;
  let cdpPort: number | undefined;
  let outputFormat: FormatoSalida = 'text';
  let inputFormat: FormatoEntrada = 'text';
  let mode: Modo = 'default';
  let effort: string | undefined;
  let sandbox = false;
  let skipPermissions = false;
  let printTimeoutMs = 0;
  let jsonSchema: string | undefined;
  let help = false;
  let providerExplicit = false;
  let modelExplicit = false;
  let effortExplicit = false;
  let modeExplicit = false;
  const addDirs: string[] = [];
  const mcpServers: McpServerSpec[] = [];
  const words: string[] = [];

  const valor = (indice: number, flag: string): string => {
    const siguiente = argv[indice + 1];
    if (siguiente === undefined) throw new Error(`${flag} requiere un valor`);
    return siguiente;
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) continue;

    switch (arg) {
      case '--help':
      case '-h':
        help = true;
        break;

      case '--list':
        listModelsOnly = true;
        break;

      case '--tools':
        listToolsOnly = true;
        break;

      case '--list-sessions':
        listSessionsOnly = true;
        break;

      case '--list-providers':
        listProvidersOnly = true;
        break;

      case '--no-save':
        noSave = true;
        break;

      case '-p':
      case '--print':
      case '--prompt':
        promptFlag = valor(index, arg);
        index += 1;
        break;

      case '-c':
      case '--continue':
        session = 'last';
        break;

      case '--conversation':
      case '--session': {
        session = valor(index, arg);
        index += 1;
        break;
      }

      case '--provider': {
        provider = valor(index, arg);
        providerExplicit = true;
        index += 1;
        break;
      }

      case '--model': {
        model = valor(index, arg);
        modelExplicit = true;
        index += 1;
        break;
      }

      case '--effort': {
        effort = valor(index, arg);
        effortExplicit = true;
        index += 1;
        if (!pensamiento.normalizarNivel(effort)) {
          throw new Error(`--effort inválido: "${effort}". Usa low, medium, high, xhigh o max.`);
        }
        break;
      }

      case '--mode': {
        const elegido = valor(index, arg);
        index += 1;
        if (!['default', 'accept-edits', 'auto', 'plan'].includes(elegido)) {
          throw new Error(`--mode inválido: "${elegido}". Usa default, accept-edits, auto o plan.`);
        }
        mode = elegido as Modo;
        modeExplicit = true;
        break;
      }

      case '--output-format': {
        const elegido = valor(index, arg);
        index += 1;
        if (!['text', 'json', 'stream-json'].includes(elegido)) {
          throw new Error(`--output-format inválido: "${elegido}".`);
        }
        outputFormat = elegido as FormatoSalida;
        break;
      }

      case '--input-format': {
        const elegido = valor(index, arg);
        index += 1;
        if (!['text', 'stream-json'].includes(elegido)) {
          throw new Error(`--input-format inválido: "${elegido}".`);
        }
        inputFormat = elegido as FormatoEntrada;
        break;
      }

      case '--json-schema':
        jsonSchema = valor(index, arg);
        index += 1;
        break;

      case '--print-timeout':
        printTimeoutMs = parseDuracion(valor(index, arg));
        index += 1;
        break;

      case '--sandbox':
        sandbox = true;
        break;

      case '--dangerously-skip-permissions':
        skipPermissions = true;
        break;

      case '--add-dir':
        addDirs.push(valor(index, arg));
        index += 1;
        break;

      case '--cdp': {
        const puerto = Number(valor(index, arg));
        index += 1;
        if (!Number.isInteger(puerto) || puerto <= 0) {
          throw new Error('--cdp espera un puerto válido');
        }
        cdpPort = puerto;
        break;
      }

      case '--mcp-command':
        mcpServers.push({ command: valor(index, arg), args: [] });
        index += 1;
        break;

      case '--mcp-arg': {
        const ultimo = mcpServers[mcpServers.length - 1];
        if (!ultimo) throw new Error('--mcp-arg debe ir después de --mcp-command');
        ultimo.args.push(valor(index, arg));
        index += 1;
        break;
      }

      case '--':
        words.push(...argv.slice(index + 1));
        index = argv.length;
        break;

      default:
        if (arg.startsWith('-')) throw new Error(`opción desconocida: ${arg}`);
        words.push(arg);
        break;
    }
  }

  return {
    provider,
    model,
    prompt: promptFlag ?? words.join(' ').trim(),
    listModelsOnly,
    listToolsOnly,
    listSessionsOnly,
    listProvidersOnly,
    mcpServers,
    cdpPort,
    session,
    noSave,
    outputFormat,
    inputFormat,
    mode,
    effort,
    sandbox,
    skipPermissions,
    printTimeoutMs,
    jsonSchema,
    addDirs,
    help,
    providerExplicit,
    modelExplicit,
    effortExplicit,
    modeExplicit,
  };
}

function printUsage(): void {
  process.stdout.write(`Opengravity CLI

Uso:
  npm run dev -- [opciones] "encargo"
  npm run dev                                  # TUI si hay terminal
  npm run dev -- -p "encargo" --output-format json

Opciones:
  -p, --print, --prompt <texto>   Ejecuta un encargo y sale
  --provider <id>                 Proveedor (ollama, openai, anthropic, gemini…)
  --model <id>                    Modelo
  --effort <nivel>                low, medium, high, xhigh, max
  --mode <modo>                   default, accept-edits, auto, plan
  --output-format <formato>       text (defecto), json, stream-json
  --input-format <formato>        text (defecto) o stream-json (requiere salida stream-json)
  --json-schema <esquema|ruta>    Pide y valida una respuesta JSON (Ajv)
  --print-timeout <duración>      30s, 5m, 1h; 0 sin límite
  --sandbox                       Confina las herramientas al workspace
  --dangerously-skip-permissions  Aprueba todas las herramientas
  --add-dir <ruta>                Añade una raíz legible/editable (repetible)
  -c, --continue                  Reanuda la conversación más reciente
  --conversation <id>             Reanuda una conversación
  --session <id|last>             Alias de --conversation
  --cdp <puerto>                  Conecta las herramientas del editor por CDP
  --mcp-command <cmd>             Servidor MCP (repetible)
  --mcp-arg <arg>                 Argumento del último servidor MCP
  --tools                         Lista el catálogo de herramientas
  --list                          Lista modelos del proveedor
  --list-providers                Lista proveedores
  --list-sessions                 Lista conversaciones guardadas
  --no-save                       No guarda la conversación
  -h, --help                      Esta ayuda
`);
}

async function cargarEsquema(valor: string | undefined): Promise<unknown> {
  if (!valor) return undefined;
  const limpio = valor.trim();
  if (limpio.startsWith('{') || limpio.startsWith('[')) return JSON.parse(limpio);
  if (['string', 'number', 'integer', 'boolean'].includes(limpio)) return { type: limpio };
  try {
    return JSON.parse(await readFile(limpio, 'utf8'));
  } catch {
    throw new Error(`--json-schema no es JSON ni un fichero legible: ${limpio}`);
  }
}

async function connectMcpServers(
  specs: McpServerSpec[],
  tools: ToolRegistry,
  preparar: (tool: Tool) => Tool = (tool) => tool,
): Promise<StdioMcpClient[]> {
  const clients: StdioMcpClient[] = [];

  for (const spec of specs) {
    const label = [spec.command, ...spec.args].join(' ');
    try {
      const client = await StdioMcpClient.start({
        command: spec.command,
        args: spec.args,
        onStderr: (chunk) => process.stderr.write(`[mcp] ${chunk}`),
      });
      clients.push(client);

      const mcpTools = await toolsFromMcpServer(client);
      const prefix = client.serverInfo?.name ?? 'mcp';

      for (const tool of mcpTools) {
        const conNombre = tools.has(tool.name)
          ? { ...tool, name: `${prefix}_${tool.name}` }
          : tool;
        tools.register(preparar(conNombre));
      }

      process.stderr.write(
        `MCP "${prefix}" v${client.serverInfo?.version ?? '?'}: ${mcpTools.length} herramientas\n`,
      );
    } catch (error) {
      process.stderr.write(
        `No se pudo iniciar MCP "${label}": ${error instanceof Error ? error.message : String(error)}\n`,
      );
    }
  }

  return clients;
}

function prefsCli(options: CliOptions, settings: AppSettings): Record<string, unknown> {
  const prefs = settings.prefs ?? {};
  const permisos = settings.permissions ?? prefs.permissions;
  const raices = options.addDirs.map((ruta) => resolve(process.cwd(), ruta));
  return {
    cwd: process.cwd(),
    // El flag solo puede endurecer; si la app ya confina, sigue confinado.
    restrictToWorkspace: options.sandbox || prefs.restrictToWorkspace === true,
    ...(raices.length > 0 ? { allowedRoots: raices } : {}),
    ...(prefs.networkRules !== undefined ? { networkRules: prefs.networkRules } : {}),
    ...(prefs.toolPermissions ? { toolPermissions: prefs.toolPermissions } : {}),
    ...(permisos ? { permissions: permisos } : {}),
  };
}

function esMutacion(tool: string, args: Record<string, unknown>): boolean {
  if (tool === 'edit_notebook') {
    return ['add', 'update', 'delete', 'create'].includes(String(args.action ?? '').toLowerCase());
  }
  if (tool === 'memory') {
    return ['add', 'forget'].includes(String(args.action ?? '').toLowerCase());
  }
  return ESCRITURAS[tool] === true;
}

function permisoDeModo(options: CliOptions): string {
  if (options.skipPermissions) return 'always-proceed';
  if (options.mode === 'accept-edits') return 'accept-edits';
  if (options.mode === 'auto') return 'auto';
  if (options.mode === 'plan') return 'plan';
  return 'request-review';
}

/**
 * Puerta de permisos del CLI. No hay TUI para preguntar: en headless una
 * acción que requeriría aprobación se rechaza con un mensaje que dice cómo
 * habilitarla (`--dangerously-skip-permissions` o un modo más amplio).
 */
type ClasificadorDeSeguridad = (info: {
  herramienta: string;
  argumentos: Record<string, unknown>;
}) => Promise<{ severity: number; reason: string } | null>;

function conPermisos(
  tool: Tool,
  options: CliOptions,
  prefs: Record<string, unknown>,
  confirmar?: (tool: string, args: Record<string, unknown>, motivo: string) => Promise<boolean>,
  clasificar?: ClasificadorDeSeguridad,
  planEnEjecucion?: () => boolean,
): Tool {
  if (options.skipPermissions) return tool;

  return {
    ...tool,
    async execute(args, ctx) {
      const muta = esMutacion(tool.name, args);
      const comando = COMANDOS[tool.name] === true;
      const red = RED[tool.name] === true;
      const conocida = LECTURAS[tool.name] === true || muta || comando || red;
      const desconocida = !conocida;

      const explicit =
        (prefs.toolPermissions as Record<string, string> | undefined)?.[tool.name] ?? 'inherit';
      const regla = decidirPorReglas(
        tool.name,
        args,
        prefs.permissions as PermissionsConfig | undefined,
        typeof prefs.cwd === 'string' ? prefs.cwd : process.cwd(),
      );

      const negar = (motivo: string) => ({
        content:
          `[permiso] «${tool.name}»: ${motivo}. ` +
          'Usa --dangerously-skip-permissions, una regla allow o un modo más amplio.',
        isError: true,
      });

      /*
       * Monitor estático de seguridad, la misma rúbrica A–M que usa la app.
       * Un deny del monitor no lo desbloquea una regla allow: es la capa que
       * impide exfiltración, shells inversos o elevación de privilegios.
       */
      const monitor = guardianMod.evaluarAccion({ toolName: tool.name, args });
      if (monitor.decision === 'deny') {
        return negar(`monitor de seguridad: ${monitor.reason}`);
      }

      /*
       * Clasificador con el modelo, opt-in (`securityMonitor: 'llm'`). La app
       * lo usa como segunda capa sobre la rúbrica estática; aquí solo se pide
       * para acciones que no son rutina limpia, para no gastar tokens en cada
       * lectura.
       */
      if (clasificar && tool.name !== 'present_plan' && (!LECTURAS[tool.name] || monitor.severity > 0)) {
        const clasificacion = await clasificar({ herramienta: tool.name, argumentos: args });
        if (clasificacion && clasificacion.severity >= 5) {
          return negar(
            `clasificador de seguridad (${clasificacion.severity}/10): ${clasificacion.reason}`,
          );
        }
      }

      // `present_plan` es la entrega del planner: debe pasar aunque el modo sea
      // de solo lectura. El resto de escrituras espera a que el plan se apruebe.
      if (
        options.mode === 'plan' &&
        tool.name !== 'present_plan' &&
        planEnEjecucion?.() !== true &&
        (muta || comando || red || desconocida)
      ) {
        return negar('el modo plan es de solo lectura');
      }

      if (regla === 'deny' || explicit === 'deny') return negar('denegado por configuración');
      if (explicit === 'allow' || regla === 'allow') return tool.execute(args, ctx);
      if (explicit === 'ask' || regla === 'ask') {
        const aprobado = confirmar ? await confirmar(tool.name, args, 'requiere aprobación explícita') : false;
        if (aprobado) return tool.execute(args, ctx);
        return negar('requiere aprobación explícita');
      }

      const planEjecutando = options.mode === 'plan' && planEnEjecucion?.() === true;
      const permitida =
        tool.name === 'present_plan'
          ? true
          : planEjecutando
          ? !(red || desconocida)
          : options.mode === 'plan'
          ? !(muta || comando || red || desconocida)
          : options.mode === 'accept-edits'
            ? !(comando || red || desconocida)
            : options.mode === 'auto'
              ? !(red || desconocida)
              : !(muta || comando || red || desconocida);

      if (permitida) return tool.execute(args, ctx);

      const aprobado = confirmar
        ? await confirmar(tool.name, args, `requiere aprobación en modo ${options.mode}`)
        : false;
      if (aprobado) return tool.execute(args, ctx);

      return negar(`requiere aprobación en modo ${options.mode}`);
    },
  };
}

async function construirSistema(cwd: string, options: CliOptions, esquema: unknown): Promise<string> {
  let sistema = SYSTEM_PROMPT;

  try {
    const reglas = await reglasMod.descubrirReglas(cwd);
    sistema += reglasMod.bloqueDeReglas(reglas, reglasMod.RULES_BUDGET_TOKENS * 4);
  } catch {
    // sin reglas
  }

  try {
    const skills = await skillsMod.descubrirSkills(cwd);
    sistema += skillsMod.bloqueDeSkills(skills);
  } catch {
    // sin skills
  }

  if (options.mode === 'plan') sistema += PLAN_INSTRUCTION;

  if (options.effort) {
    const nivel = pensamiento.normalizarNivel(options.effort);
    if (nivel) sistema += `\n\n[Esfuerzo de razonamiento: ${nivel}] ${ESFUERZO_TEXTO[nivel] ?? ''}`;
  }

  if (esquema) {
    sistema +=
      '\n\n## Salida estructurada\nResponde únicamente con un JSON válido que cumpla este esquema:\n' +
      JSON.stringify(esquema);
  }

  return sistema;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const store = new JsonlSessionStore();

  if (options.help) {
    printUsage();
    return;
  }

  // Ajustes compartidos con la app; los flags explícitos mandan.
  const settings = await leerSettingsApp();
  if (!options.providerExplicit && typeof settings.providerId === 'string') {
    options.provider = settings.providerId;
  }
  if (!options.modelExplicit && typeof settings.model === 'string') {
    options.model = settings.model;
  }
  if (!options.effortExplicit && typeof settings.prefs?.effort === 'string') {
    options.effort = settings.prefs.effort;
  }
  if (
    !options.modeExplicit &&
    typeof settings.prefs?.agentMode === 'string' &&
    ['default', 'accept-edits', 'auto', 'plan'].includes(settings.prefs.agentMode)
  ) {
    options.mode = settings.prefs.agentMode as Modo;
  }

  if (options.listProvidersOnly) {
    process.stdout.write('Proveedores disponibles:\n\n');
    for (const spec of PROVIDER_CATALOG) {
      const key = spec.envKey ?? '(sin clave)';
      const local = spec.local ? ' · local' : '';
      process.stdout.write(`  ${spec.id.padEnd(12)} ${spec.label}\n`);
      process.stdout.write(`  ${''.padEnd(12)} ${spec.baseUrl}\n`);
      process.stdout.write(`  ${''.padEnd(12)} clave: ${key}${local}\n`);
      if (spec.note) process.stdout.write(`  ${''.padEnd(12)} ${spec.note}\n`);
      process.stdout.write('\n');
    }
    return;
  }

  if (options.listSessionsOnly) {
    const sessions = await store.list();
    if (sessions.length === 0) {
      process.stdout.write('No hay sesiones guardadas.\n');
      return;
    }
    process.stdout.write('Sesiones guardadas:\n\n');
    for (const session of sessions) {
      process.stdout.write(`  ${session.id}\n`);
      process.stdout.write(`    ${session.title}\n`);
      process.stdout.write(
        `    ${session.provider}/${session.model} · ${session.messageCount} mensajes · ${session.updatedAt}\n`,
      );
    }
    return;
  }

  if (options.listToolsOnly) {
    const tools = new ToolRegistry();
    for (const tool of crearHerramientasCli({ cwd: process.cwd(), prefs: prefsCli(options, settings) })) {
      tools.register(tool);
    }
    const clients = await connectMcpServers(options.mcpServers, tools);
    try {
      const dependientesDelModelo = [
        {
          name: 'invoke_subagent',
          description: 'Lanza subagentes en paralelo con su propio contexto.',
        },
        {
          name: 'present_plan',
          description: 'Presenta un plan; en la TUI pide aprobación.',
        },
      ];
      process.stdout.write('\nHerramientas disponibles:\n');
      for (const definition of [...tools.definitions(), ...dependientesDelModelo]) {
        process.stdout.write(`  ${definition.name} — ${definition.description.split('\n')[0]}\n`);
      }
    } finally {
      await Promise.all(clients.map((client) => client.close()));
    }
    return;
  }

  const clavesDescifradas = await descifrarClavesApp(rutaSettingsApp(), settings);
  const providerConfig = configProveedor(settings, clavesDescifradas);
  const available = await detectAvailableProviders(providerConfig);
  if (available.length === 0) {
    process.stderr.write(
      'No hay proveedores disponibles.\n' +
        '  · Ollama: instala https://ollama.com y ejecuta `ollama serve`\n' +
        '  · OpenAI: exporta OPENAI_API_KEY\n' +
        '  · Anthropic: exporta ANTHROPIC_API_KEY\n' +
        '  · Gemini: exporta GEMINI_API_KEY\n',
    );
    process.exitCode = 1;
    return;
  }

  process.stderr.write(`Proveedores detectados: ${available.join(', ')}\n`);

  if (!available.includes(options.provider)) {
    process.stderr.write(`El proveedor "${options.provider}" no está disponible.\n`);
    process.exitCode = 1;
    return;
  }

  const provider = createProvider(options.provider, providerConfig);
  const models = await provider.listModels();

  if (options.listModelsOnly) {
    process.stdout.write(`\nModelos de ${options.provider}:\n`);
    for (const model of models) {
      const context = model.contextWindow
        ? ` — ${model.contextWindow.toLocaleString('es')} tokens`
        : '';
      process.stdout.write(`  ${model.id}${context}\n`);
    }
    return;
  }

  const selectedModel = options.model ?? models[0]?.id;
  if (!selectedModel) {
    process.stderr.write(`El proveedor "${options.provider}" no reporta modelos. Usa --model.\n`);
    process.exitCode = 1;
    return;
  }
  if (options.model && models.length > 0 && !models.some((model) => model.id === options.model)) {
    process.stderr.write(
      `Modelo "${options.model}" no reconocido por ${options.provider}. ` +
        'Usa --list para ver los disponibles.\n',
    );
    process.exitCode = 1;
    return;
  }

  if (options.mode === 'auto' && !options.sandbox) {
    process.stderr.write('aviso: --mode auto requiere --sandbox; se usa default.\n');
    options.mode = 'default';
  }

  const preguntar: PreguntaActual = {};
  const confirmar = (tool: string, args: Record<string, unknown>, motivo: string) =>
    preguntar.actual?.(tool, args, motivo) ?? Promise.resolve(false);

  const prefs = prefsCli(options, settings);
  const plan = new PlanSession(options.mode === 'plan');
  const clasificar: ClasificadorDeSeguridad | undefined =
    settings.prefs?.securityMonitor === 'llm'
      ? async (info) => {
          try {
            return await clasificarAccion(
              { herramienta: info.herramienta, argumentos: info.argumentos },
              [],
              {
                provider,
                model: selectedModel,
                modeloRapido:
                  typeof settings.prefs?.classifierModel === 'string'
                    ? settings.prefs.classifierModel
                    : undefined,
                umbralNivel1: Number(settings.prefs?.classifierThreshold ?? 1),
                timeoutMs: Number(settings.prefs?.classifierTimeoutMs ?? 20_000),
              },
            );
          } catch {
            return null;
          }
        }
      : undefined;
  const conPermisosCli = (
    tool: Tool,
    confirmarFn = confirmar,
  ) => conPermisos(tool, options, prefs, confirmarFn, clasificar, () => plan.ejecutando());

  configurarTrayectoria(join(dirname(rutaSettingsApp()), 'trajectory'));
  const trayectoriaCli = crearTrayectoriaCli(randomUUID(), process.cwd());

  const tools = new ToolRegistry();
  for (const tool of crearHerramientasCli({ cwd: process.cwd(), prefs })) {
    tools.register(conPermisosCli(trayectoriaCli.envolver(tool)));
  }

  const mcpClients = await connectMcpServers(
    options.mcpServers,
    tools,
    (tool) => conPermisosCli(trayectoriaCli.envolver(tool)),
  );

  let cdpClient: CdpClient | undefined;
  if (options.cdpPort !== undefined) {
    try {
      cdpClient = await connectToPage(`http://127.0.0.1:${options.cdpPort}`);
      for (const tool of editorTools(cdpClient)) {
        tools.register(conPermisosCli(trayectoriaCli.envolver(tool)));
      }
      process.stderr.write(`Editor conectado por CDP en el puerto ${options.cdpPort}\n`);
    } catch (error) {
      process.stderr.write(
        `No se pudo conectar al editor en el puerto ${options.cdpPort}: ` +
          `${error instanceof Error ? error.message : String(error)}\n`,
      );
    }
  }

  const esTui =
    options.prompt.length === 0 &&
    options.inputFormat === 'text' &&
    options.outputFormat === 'text' &&
    process.stdin.isTTY === true;

  try {
    if (!esTui && options.inputFormat !== 'stream-json' && options.prompt.length === 0) {
      printUsage();
      process.exitCode = 2;
      return;
    }
    if (options.inputFormat === 'stream-json' && options.outputFormat !== 'stream-json') {
      process.stderr.write(
        '--input-format stream-json requiere --output-format stream-json.\n',
      );
      process.exitCode = 2;
      return;
    }
    if (options.inputFormat === 'stream-json' && options.prompt.length > 0) {
      process.stderr.write('aviso: en modo stream-json el prompt de -p se ignora; usa stdin.\n');
    }

    process.stderr.write(`Modelo: ${selectedModel}\n`);
    process.stderr.write(`Herramientas: ${tools.names().join(', ')}\n`);

    let sessionId: string | undefined;
    let initialMessages: Message[] = [];

    if (!options.noSave) {
      try {
        if (options.session !== undefined) {
          const target = options.session === 'last' ? (await store.latest())?.id : options.session;
          if (!target) throw new Error('no hay sesiones guardadas que reanudar');

          const loaded = await store.load(target);
          sessionId = loaded.meta.id;
          initialMessages = loaded.messages;
          process.stderr.write(`Sesión ${sessionId} reanudada (${initialMessages.length} mensajes)\n`);
        } else {
          const created = await store.create({
            provider: options.provider,
            model: selectedModel,
            cwd: process.cwd(),
          });
          sessionId = created.id;
          process.stderr.write(`Sesión nueva: ${sessionId}\n`);
        }
      } catch (error) {
        process.stderr.write(
          `No se pudo abrir la sesión (${error instanceof Error ? error.message : String(error)}). ` +
            'Se continúa sin guardar.\n',
        );
        sessionId = undefined;
      }
    }

    if (sessionId !== undefined) {
      trayectoriaCli.cambiar(sessionId);
    }
    trayectoriaCli.marcarTurno(initialMessages.length);

    const esquema = await cargarEsquema(options.jsonSchema);
    const validarEsquema = esquema ? compilarValidador(esquema) : undefined;
    const sistemaBase = await construirSistema(process.cwd(), options, esquema);
    const sistema = plan.sistema(sistemaBase, options.mode);
    const ajustes = pensamiento.ajustesDePensamiento({
      nivel: options.effort,
      tipo: findProvider(options.provider)?.kind ?? null,
      proveedor: options.provider,
      modelo: selectedModel,
    });

    const ventanaParaModelo = (modelo: string) =>
      ventanaDeModelo({
        providerId: options.provider,
        modelId: modelo,
        reportada: models.find((model) => model.id === modelo)?.contextWindow,
      });
    const contextWindow = ventanaParaModelo(selectedModel);
    const estadoTui = { model: selectedModel, mode: options.mode as Modo };

    // Herramientas que dependen del modelo activo y de la puerta de permisos.
    tools.register(
      conPermisosCli(
        trayectoriaCli.envolver(
          makeInvokeSubagentTool({
            cwd: process.cwd(),
            prefs,
            provider,
            model: selectedModel,
            getModel: () => estadoTui.model,
            contextWindow,
            getContextWindow: () => ventanaParaModelo(estadoTui.model),
            ajustes,
            preparar: (tool) =>
              trayectoriaCli.envolver(conPermisosCli(tool)),
          }),
        ),
      ),
    );
    tools.register(
      conPermisosCli(trayectoriaCli.envolver(makePresentPlanTool(preguntar, plan))),
    );

    const turnosIniciales = initialMessages.filter((message) => message.role === 'user').length;
    const conversationId = trayectoriaCli.id();
    const numTurns = turnosIniciales + (options.inputFormat === 'stream-json' ? 0 : 1);
    const salida = crearSalida({
      formato: options.outputFormat,
      conversationId,
      cwd: process.cwd(),
      tools: tools.names(),
      permissionMode: permisoDeModo(options),
      model: selectedModel,
      ...(options.effort ? { effort: options.effort } : {}),
      numTurns,
      ...(esquema ? { jsonSchema: esquema } : {}),
    });

    if (options.inputFormat === 'stream-json') {
      process.exitCode = await correrStreamJson({
        salida,
        provider,
        model: selectedModel,
        tools,
        system: sistema,
        contextWindow,
        ajustes,
        initialMessages,
        numTurns: turnosIniciales,
        ...(sessionId ? { sessionId } : {}),
        ...(options.noSave ? {} : { store }),
        ...(esquema ? { jsonSchema: esquema } : {}),
        ...(validarEsquema ? { validar: validarEsquema } : {}),
        printTimeoutMs: options.printTimeoutMs,
      });
      return;
    }

    if (esTui) {
      process.exitCode = await (process.env.OPENGRAVITY_LINE_TUI === '1' ? correrTui : correrTuiCompleta)({
        provider,
        estado: estadoTui,
        modelos: models.map((model) => model.id),
        sandbox: options.sandbox || prefs.restrictToWorkspace === true,
        tools,
        ventanaPara: ventanaParaModelo,
        ajustes,
        initialMessages,
        numTurns: turnosIniciales,
        salida,
        sistemaPara: (modo) =>
          construirSistema(process.cwd(), { ...options, mode: modo as Modo }, esquema),
        aplicarModo: (modo) => {
          options.mode = modo as Modo;
        },
        ...(sessionId ? { sessionId } : {}),
        ...(options.noSave ? {} : { store }),
        ...(esquema ? { jsonSchema: esquema } : {}),
        ...(validarEsquema ? { validar: validarEsquema } : {}),
        cwd: process.cwd(),
        permisos: prefs.permissions ?? settings.permissions,
        mcp: Array.isArray(settings.prefs?.plugins)
          ? settings.prefs.plugins.map((plugin: unknown) => {
              const entrada = plugin as { name?: unknown; id?: unknown };
              return String(entrada.name ?? entrada.id ?? 'mcp');
            })
          : [],
        skills: () => skillsMod.descubrirSkills(process.cwd()),
        agentes: () => subagentesMod.listarDefiniciones(),
        trayectoria: trayectoriaCli,
        plan,
        preguntar,
      });
      return;
    }

    const controlador = new AbortController();
    let tiempoAgotado = false;
    const temporizador =
      options.printTimeoutMs > 0
        ? setTimeout(() => {
            tiempoAgotado = true;
            controlador.abort();
          }, options.printTimeoutMs)
        : undefined;

    try {
      const result = await runAgent(
        {
          provider,
          model: selectedModel,
          tools,
          system: sistema,
          maxSteps: 40,
          contextWindow,
          toolGate: (call) => plan.compuerta(call),
          mensajeDeSistema: () => plan.mensajePendiente(),
          ...ajustes,
          ...(initialMessages.length > 0 ? { initialMessages } : {}),
          onEvent: salida.onEvent,
        },
        options.prompt,
        { cwd: process.cwd(), signal: controlador.signal },
      );

      let structuredOutput: unknown;
      let error: string | undefined;
      let status: 'SUCCESS' | 'ERROR' | 'CANCELED' = 'SUCCESS';

      if (esquema) {
        try {
          structuredOutput = JSON.parse(result.text);
          const fallo = validarEsquema?.(structuredOutput);
          if (fallo) {
            error = fallo;
            status = 'ERROR';
          }
        } catch {
          error = 'La respuesta no es JSON válido para --json-schema.';
          status = 'ERROR';
        }
      }

      if (sessionId !== undefined) {
        try {
          await store.append(sessionId, result.appended.filter((message) => message.internal !== true));
          process.stderr.write(`Sesión guardada: ${sessionId}\n`);
        } catch (saveError) {
          process.stderr.write(
            `No se pudo guardar la sesión: ${saveError instanceof Error ? saveError.message : String(saveError)}\n`,
          );
        }
      }

      salida.final(result, error, structuredOutput, status);
      if (status !== 'SUCCESS') process.exitCode = 1;
    } catch (error) {
      const mensaje = tiempoAgotado
        ? `Tiempo de espera agotado (${options.printTimeoutMs} ms).`
        : error instanceof Error
          ? error.message
          : String(error);
      salida.final(null, mensaje, undefined, tiempoAgotado ? 'CANCELED' : 'ERROR');
      process.exitCode = 1;
    } finally {
      if (temporizador) clearTimeout(temporizador);
    }
  } finally {
    cdpClient?.close();
    await Promise.all(mcpClients.map((client) => client.close().catch(() => {})));
    await extra.matarTodasLasTareas().catch(() => {});
    await trayectoriaCli.volcar().catch(() => {});
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
