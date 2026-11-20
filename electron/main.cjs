'use strict';

/**
 * Proceso principal de la app de escritorio.
 *
 * Reproduce la arquitectura que documentamos en docs/analysis:
 *
 *   renderer (UI)  ──IPC──▶  main (esta capa)  ──▶  motor del agente
 *
 * El renderer no tiene acceso a Node (`nodeIntegration: false`,
 * `contextIsolation: true`). Todo pasa por los canales IPC que expone
 * `preload.cjs`. Los nombres siguen el patrón `dominio:accion`.
 *
 * El motor (providers, agente, MCP, persistencia) está compilado en `dist/` y
 * se carga con `import()` dinámico, así este fichero puede ser CommonJS.
 */

const { app, BrowserWindow, ipcMain, dialog, shell, Menu, protocol, net, safeStorage } = require('electron');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const os = require('node:os');
const { isUtf8 } = require('node:buffer');
const fsp = require('node:fs/promises');
const http = require('node:http');
const {
  isUrlAllowed,
  makeFetchUrlTool,
  makeOpenUrlTool,
  openBuiltInBrowser,
  browserEvaluate,
  makeSearchFilesTool,
  makeFileSearchTool,
  makeEditFileTool,
  makeMultiReplaceTool,
  makeRunCommandTool,
  makeCommandStatusTool,
  makeManageTaskTool,
  makeSearchWebTool,
  makeViewCodeItemTool,
  makeEditNotebookTool,
  makeGenerateImageTool,
  makeRunWorkflowTool,
  makeRunExtensionCodeTool,
  makeBrowserTools,
} = require('./tools-extra.cjs');
const sshRemoto = require('./ssh.cjs');
const { RemoteProject } = require('./remote-project.cjs');
const sshfs = require('./sshfs.cjs');
const remoteProject = new RemoteProject(sshRemoto.workspace);
const { diffLines, compactDiff } = require('./diff.cjs');
const { conMonitorDeSeguridad } = require('./guardian.cjs');
const {
  conHooks,
  aplicarHooksDeTexto,
  aplicarHooksDeRazonamiento,
  redactarDatos,
  redactarSecretos,
  dentroDelWorkspace,
} = require('./hooks.cjs');
const trayectoria = require('./trajectory.cjs');
const { restoreSnapshots } = require('./checkpoints.cjs');
const { registrarRaiz, rutaAutorizada, olvidarRaices } = require('./rutas.cjs');
const { validarUrlPublica } = require('./red-segura.cjs');
const { SKILL_CATALOG, buildPromptExtras } = require('./prompt-extras.cjs');

const { correrEnParalelo } = require('./subagent-merge.cjs');
const { resetSessionState } = require('./session-state.cjs');
const { CicloDePlan, PROMPT_PLANNER, PROMPT_EXECUTOR, HERRAMIENTAS_DE_LECTURA } = require('./plan-mode.cjs');
const { descubrirSkills, bloqueDeSkills, makeSkillTool } = require('./skills.cjs');
const { descubrirReglas, bloqueDeReglas, RULES_BUDGET_TOKENS } = require('./rules.cjs');
const { resolverRutaApp } = require('./protocol-path.cjs');
const { compilarCron, siguienteEjecucion, describirCron } = require('./cron.cjs');
const subagentes = require('./subagents.cjs');
const contexto = require('./contexto.cjs');
const pensamiento = require('./pensamiento.cjs');
const { cargarCatalogo } = require('./marketplace.cjs');
const worktreeMod = require('./worktree.cjs');
const testrunner = require('./testrunner.cjs');
const { AlmacenDeMemoria, makeMemoryTool, bloqueDeMemorias } = require('./memory.cjs');
const { guardarEnCola, escribirAtomico, serializar } = require('./settings-store.cjs');
const { descifrarClaves, prepararPrefsParaDisco } = require('./secret-store.cjs');
const { puedeRenombrarAutomatico } = require('./title-policy.cjs');
const updater = require('./updater.cjs');
const {
  nombreProyecto: nombreDelProyecto,
  normalizarProyectos,
  registrarEnLista,
} = require('./projects.cjs');

/** IDs cuyo título se fijó a mano: la generación automática no los toca. */
const titulosManuales = new Set();

/**
 * Esquema propio `app://`.
 *
 * Necesario para que los workers de Monaco carguen: Chromium bloquea los
 * workers desde `file://`.
 */
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
  },
]);

/** Motor cargado una sola vez, también bajo llamadas concurrentes. */
let engine = null;
let enginePromise = null;

async function getEngine() {
  if (engine) return engine;
  if (enginePromise) return enginePromise;

  enginePromise = (async () => {
    const [loop, storeModule, registry, toolRegistry, fsTools] = await Promise.all([
      import('../dist/agent/loop.js'),
      import('../dist/persistence/jsonl-store.js'),
      import('../dist/providers/registry.js'),
      import('../dist/tools/registry.js'),
      import('../dist/tools/fs.js'),
    ]);

    engine = {
      runAgent: loop.runAgent,
      JsonlSessionStore: storeModule.JsonlSessionStore,
      createProvider: registry.createProvider,
      detectAvailableProviders: registry.detectAvailableProviders,
      soportaPensamiento: registry.soportaPensamiento,
      PROVIDER_CATALOG: registry.PROVIDER_CATALOG,
      ToolRegistry: toolRegistry.ToolRegistry,
      fileSystemTools: fsTools.fileSystemTools,
    };
    return engine;
  })();

  try {
    return await enginePromise;
  } finally {
    enginePromise = null;
  }
}

/** Ejecuta un comando en el host remoto para el modo directo. */
function makeRemoteCommandTool() {
  return {
    name: 'run_command',
    description:
      'Ejecuta un comando de shell en el host SSH remoto. El directorio de trabajo ' +
      'es la carpeta remota configurada. Devuelve stdout, stderr y el código de salida.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Línea de comandos exacta.' },
        cwd: { type: 'string', description: 'Directorio relativo a la raíz remota.' },
        waitDurationSeconds: { type: 'number', description: 'Timeout en segundos.' },
      },
      required: ['command'],
    },
    async execute(args) {
      try {
        const cfg = sshRemoto.configuracion(state.prefs);
        await sshRemoto.workspace.conectar(cfg);
        const cwd = path.posix.resolve(cfg.remotePath, String(args?.cwd ?? '.'));
        const timeoutMs = Math.max(1000, Number(args?.waitDurationSeconds ?? 30) * 1000);
        const salida = await sshRemoto.workspace.exec(String(args?.command ?? ''), cwd, timeoutMs);
        const texto = [salida.stdout, salida.stderr].filter(Boolean).join('\n').trim();
        return {
          content: texto || `(sin salida; código ${salida.code})`,
          isError: Number(salida.code) !== 0,
          meta: { command: args?.command, remote: true },
        };
      } catch (error) {
        return { content: `Error SSH: ${error instanceof Error ? error.message : String(error)}`, isError: true };
      }
    },
  };
}

/** Ejecuta un comando en el host y devuelve el mismo formato que run_command. */
async function ejecutarComandoRemoto(command, cwd = null, timeoutMs = 30000) {
  const cfg = sshRemoto.configuracion(state.prefs);
  await sshRemoto.workspace.conectar(cfg);
  const salida = await sshRemoto.workspace.exec(
    String(command),
    cwd ? path.posix.resolve(cfg.remotePath, String(cwd)) : cfg.remotePath,
    timeoutMs,
  );
  const texto = [salida.stdout, salida.stderr].filter(Boolean).join('\n').trim();
  return {
    content: texto || `(sin salida; código ${salida.code})`,
    isError: Number(salida.code) !== 0,
    code: salida.code,
  };
}

/**
 * Carpeta de trabajo inicial.
 *
 * El `.exe` portable arranca desde su carpeta temporal de extracción y el
 * instalado desde la carpeta de instalación: ninguna es un workspace válido.
 * Sin `lastWorkspace` se empieza en Documentos. En desarrollo se respeta la
 * carpeta desde la que se lanzó.
 */
function cwdInicial() {
  if (!app.isPackaged) return process.cwd();
  try {
    return app.getPath('documents');
  } catch {
    return os.homedir();
  }
}

/*
 * Pruebas de instalador: una copia de la app puede usar datos temporales sin
 * tocar las conversaciones ni las preferencias del usuario.
 */
if (process.env.OPENGRAVITY_USER_DATA) {
  try {
    const datos = path.resolve(process.env.OPENGRAVITY_USER_DATA);
    require('node:fs').mkdirSync(datos, { recursive: true });
    app.setPath('userData', datos);
  } catch {
    // sin aislamiento se sigue con el userData normal
  }
}

/**
 * gopls lanza `go list` en un subproceso. Si Go se instaló después de abrir la
 * app, el PATH heredado no lo ve aunque el binario exista; se añade aquí.
 */
function asegurarGoEnPath(goRoot = '') {
  const fsSync = require('node:fs');
  const gopath = String(process.env.GOPATH ?? '').split(path.delimiter)[0];
  const candidatos = [];
  if (goRoot) {
    let raiz = String(goRoot).trim().replace(/[\\/]+$/, '');
    if (/go\.exe$/i.test(raiz)) raiz = path.dirname(raiz);
    const bin = path.basename(raiz).toLowerCase() === 'bin' ? raiz : path.join(raiz, 'bin');
    candidatos.push(bin);
  }
  candidatos.push(
    process.env.GOROOT ? path.join(process.env.GOROOT, 'bin') : '',
    path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Go', 'bin'),
    path.join(process.env['ProgramFiles(x86)'] ?? '', 'Go', 'bin'),
    path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Go', 'bin'),
    'C:\\Go\\bin',
    path.join(gopath, 'bin'),
    path.join(process.env.USERPROFILE ?? '', 'go', 'bin'),
    process.env.GOBIN ?? '',
  );
  try {
    const sdk = path.join(process.env.USERPROFILE ?? '', 'sdk');
    for (const version of fsSync.readdirSync(sdk)) {
      candidatos.push(path.join(sdk, version, 'bin'));
    }
  } catch {
    // No hay SDK de versiones; es opcional.
  }
  const carpetas = new Set(process.env.PATH?.split(';') ?? []);
  let cambiado = false;
  for (const carpeta of candidatos) {
    if (!carpeta || carpetas.has(carpeta)) continue;
    const tieneGo = fsSync.existsSync(path.join(carpeta, 'go.exe'));
    const tieneGopls = fsSync.existsSync(path.join(carpeta, 'gopls.exe'));
    if (!tieneGo && !tieneGopls) continue;
    process.env.PATH = `${carpeta};${process.env.PATH ?? ''}`;
    carpetas.add(carpeta);
    cambiado = true;
  }
  return cambiado;
}

asegurarGoEnPath();

/** Un workspace guardado puede haber sido renombrado o borrado. */
async function esDirectorio(ruta) {
  try {
    const info = await fsp.stat(ruta);
    return info.isDirectory();
  } catch {
    return false;
  }
}

/** Estado de la sesión de trabajo. */
const state = {
  /** Raíz del workspace abierto. */
  cwd: cwdInicial(),
  /** Proyecto asociado a la conversación actual; null es «No Project». */
  project: null,
  /** Proyectos conocidos, persistidos aparte del historial. */
  projects: [],
  providerId: null,
  model: null,
  sessionId: null,
  /** Historial de la conversación actual. */
  messages: [],
  busy: false,
  /** Preferencias de la UI (permisos, apariencia, notificaciones…). */
  prefs: {},
};

// Mientras se carga una sesión no se puede enviar ni empezar otra carga: el
// estado global cambiaría bajo el turno en preparación.
let cargandoSesion = false;
// Un revert restaura ficheros y reescribe la sesión en varios awaits; mientras
// dura no se puede cargar/crear otra conversación ni enviar un turno.
let revirtiendo = false;

/** Descargas del navegador integrado, de la más reciente a la más antigua. */
const descargas = [];
let contadorDescargas = 0;

/*
 * La carpeta de arranque es raíz autorizada desde el primer instante: sin esto,
 * una instalación sin `settings.json` (primer arranque) no podría listar su
 * propio workspace. `loadSettings` añade la última carpeta usada en cuanto la lee.
 */
registrarRaiz(state.cwd);

/**
 * Añade o actualiza un proyecto conocido. No persiste: lo hace saveSettings.
 * El proyecto es una carpeta y sobrevive aunque no tenga conversaciones.
 */
function registrarProyecto(cwd) {
  const ruta = path.resolve(String(cwd ?? ''));
  if (!ruta) return null;
  state.projects = registrarEnLista(state.projects, ruta);
  return state.projects.find((p) => p.path === ruta) ?? null;
}

// ---------------------------------------------------------------------------
// Preferencias persistentes (proveedor y modelo elegidos)
// ---------------------------------------------------------------------------

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

/** Almacén de memoria entre conversaciones. */
let almacenMemoria = null;
function getMemoria() {
  if (!almacenMemoria) {
    almacenMemoria = new AlmacenDeMemoria(path.join(app.getPath('userData'), 'memories.json'));
  }
  return almacenMemoria;
}

// La carpeta de trayectorias depende de `app.getPath`, que solo existe tras el arranque.
app.whenReady().then(() => {
  try {
    trayectoria.configurar(path.join(app.getPath('userData'), 'trajectory'));
    subagentes.configurar(path.join(app.getPath('userData'), 'subagents.json'));
  } catch {
    // sin persistencia se sigue funcionando en memoria
  }
});

async function loadSettings() {
  let workspaceCorregido = false;
  try {
    const raw = await fsp.readFile(settingsPath(), 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.providerId === 'string') state.providerId = parsed.providerId;
    if (parsed && typeof parsed.model === 'string') state.model = parsed.model;
    if (parsed && typeof parsed.lastWorkspace === 'string') {
      if (await esDirectorio(parsed.lastWorkspace)) {
        state.cwd = parsed.lastWorkspace;
        registrarRaiz(state.cwd);
      } else {
        // El proyecto guardado ya no existe: se abre el workspace por defecto
        // en vez de dejar al agente apuntando a una ruta fantasma.
        state.cwd = cwdInicial();
        registrarRaiz(state.cwd);
        workspaceCorregido = true;
      }
    }
    if (parsed && Array.isArray(parsed.projects)) {
      state.projects = normalizarProyectos(parsed.projects);
    }

    /*
     * `project` se añadió después de `lastWorkspace`. Una instalación antigua
     * sin la clave trataba el workspace como proyecto; se conserva esa lectura
     * para no convertir de golpe todas sus conversaciones en «No Project».
     */
    const proyectoGuardado = parsed && typeof parsed.project === 'string' ? parsed.project : null;
    const proyectoPorMigracion = parsed && !('project' in parsed) ? state.cwd : null;
    const candidato = proyectoGuardado ?? proyectoPorMigracion;
    if (candidato) {
      const absoluto = path.resolve(candidato);
      state.project = (await esDirectorio(absoluto)) ? absoluto : null;
    }
    if (state.project) registrarProyecto(state.project);

    if (parsed && parsed.prefs && typeof parsed.prefs === 'object') {
      const prefs = { ...parsed.prefs };
      const clavesEnClaro = Boolean(prefs.apiKeys && Object.keys(prefs.apiKeys).length > 0);

      // Las claves cifradas vuelven a memoria en claro; `apiKeys` en claro (de
      // versiones anteriores) es más reciente y manda sobre el blob.
      if (prefs.apiKeysEnc) {
        const claves = descifrarClaves(prefs.apiKeysEnc, safeStorage);
        if (claves) {
          delete prefs.apiKeysEnc;
          prefs.apiKeys = { ...claves, ...(prefs.apiKeys ?? {}) };
        }
      }

      state.prefs = prefs;

      if (state.cwd && state.cwd.includes(`${path.sep}remote-workspaces${path.sep}`)) {
        try {
          const cfg = sshRemoto.configuracion(state.prefs);
          await sshRemoto.workspace.conectar(cfg);
          const mirror = await remoteProject.abrirExistente(cfg, app.getPath('userData'));
          if (mirror) {
            state.remote = {
              host: cfg.host,
              port: cfg.port,
              user: cfg.user,
              remotePath: cfg.remotePath,
              label: `ssh://${cfg.user}@${cfg.host}:${cfg.port}${cfg.remotePath}`,
            };
          }
        } catch {
          // Sin conexión el espejo sigue disponible en local.
        }
      }

      // Migración única: un settings.json antiguo con claves en claro se
      // reescribe cifrado. Sin cifrado disponible no se toca el disco.
      if (clavesEnClaro && !parsed.prefs.apiKeysEnc && safeStorage.isEncryptionAvailable()) {
        await saveSettings();
      }
    }
  } catch {
    // sin preferencias guardadas: se usan los valores por defecto
  }

  if (workspaceCorregido) {
    // Guardar después de cargar prefs: así no se reescribe el fichero a medias.
    await saveSettings().catch(() => {});
  }
}

async function saveSettings() {
  await fsp.mkdir(app.getPath('userData'), { recursive: true });

  // Se parte de lo que ya había en disco: si un valor es nulo ahora mismo
  // (por ejemplo el modelo aún no elegido), no se borra el que estaba.
  let previo = {};
  try {
    previo = JSON.parse(await fsp.readFile(settingsPath(), 'utf8')) ?? {};
  } catch {
    previo = {};
  }

  const prefsParaDisco = prepararPrefsParaDisco(state.prefs, previo.prefs, safeStorage);

  const payload = {
    providerId: state.providerId ?? previo.providerId ?? null,
    model: state.model ?? previo.model ?? null,
    lastWorkspace: state.cwd ?? previo.lastWorkspace ?? null,
    project: state.project ?? null,
    projects: state.projects,
    remote: state.remote ?? null,
    prefs: prefsParaDisco,
  };

  // Escritura atómica y en cola: nunca queda un settings.json a medias.
  await guardarEnCola(settingsPath(), payload);
}

/**
 * Construye las sobrescrituras que espera `createProvider` a partir de los
 * proveedores personalizables guardados en las preferencias.
 */

/**
 * Proveedores que comparten una única clave (OPENCODE_API_KEY sirve para Zen y
 * Go). Sin esto, pegar la clave en uno deja al otro como «sin clave».
 */
const CLAVES_COMPARTIDAS = {
  'opencode-zen': 'opencode-go',
  'opencode-go': 'opencode-zen',
};

/**
 * Texto de una redacción de secretos.
 *
 * El redactor devuelve `{ texto, encontrados }`; en disco va solo el texto.
 * Guardar el objeto entero dejaba `[object Object]` al reabrir el hilo.
 */
function textoRedactado(contenido) {
  const redaccion = redactarSecretos(contenido);
  return typeof redaccion === 'string' ? redaccion : String(redaccion?.texto ?? '');
}

/**
 * Copia persistible de los mensajes: sin secretos en el texto ni en los
 * argumentos de las herramientas. Las imágenes no se tocan: son base64 y una
 * sustitución las corrompería.
 */
function mensajesParaDisco(messages) {
  // Las notas internas (nudge, revisión de plan) no son mensajes del usuario:
  // se quedan en el turno, pero no se guardan ni reaparecen al reabrir.
  return messages.filter((message) => message.internal !== true).map((message) => ({
    ...message,
    // Nunca se guarda un objeto como contenido: en disco queda texto o nada.
    content: textoRedactado(
      typeof message.content === 'string' ? message.content : String(message.content ?? ''),
    ),
    ...(message.toolCalls ? { toolCalls: redactarDatos(message.toolCalls) } : {}),
  }));
}

function buildProviderConfig() {
  const baseUrls = {};
  const apiKeys = {};

  // Claves guardadas desde la UI (valen para cualquier proveedor).
  for (const [id, value] of Object.entries(state.prefs.apiKeys ?? {})) {
    if (typeof value === 'string' && value.trim().length > 0) {
      apiKeys[id] = value.trim();
    }
  }

  // Proveedores personalizables: URL y clave propios.
  for (const [id, entry] of Object.entries(state.prefs.customProviders ?? {})) {
    if (!entry || typeof entry !== 'object') continue;
    if (typeof entry.baseUrl === 'string' && entry.baseUrl.trim().length > 0) {
      baseUrls[id] = entry.baseUrl.trim();
    }
    if (typeof entry.apiKey === 'string' && entry.apiKey.trim().length > 0) {
      apiKeys[id] = entry.apiKey.trim();
    }
  }

  for (const [id, hermano] of Object.entries(CLAVES_COMPARTIDAS)) {
    if (!apiKeys[id] && apiKeys[hermano]) apiKeys[id] = apiKeys[hermano];
  }

  return { baseUrls, apiKeys };
}

/*
 * Entorno: sin esto el agente no sabe en qué sistema está y usa comandos de Unix
 * en Windows (`find /`, `/c/Users/...`), que fallan. Medido en una sesión real:
 * eso lo llevó a 32 pasos de bucle intentando averiguar por qué no encontraba el
 * proyecto, cuando el problema era que sus órdenes no existían en este sistema.
 */
const ENTORNO =
  process.platform === 'win32'
    ? 'Entorno: Windows. La shell de run_command es PowerShell. Usa rutas con barra ' +
      'invertida o relativa (src\\carrito.mjs), NO rutas tipo /c/Users/... y NO ' +
      'comandos de Unix como find, grep, ls o cd con rutas absolutas: no existen. ' +
      'Para listar usa list_directory; para buscar, search_files; para rutas, ' +
      'relativas al directorio de trabajo.'
    : `Entorno: ${process.platform}. Shell POSIX.`;

const SYSTEM_PROMPT = `<identity>
You are Antigravity, a powerful agentic AI assistant designed by the Google Deepmind team.
You are working with a USER to solve their task.
The USER will send you requests, which you must always prioritize addressing. User requests are enclosed within <USER_REQUEST> tags.
</identity>

<environment>
${ENTORNO}
</environment>

<guidelines>
Follow these behavioral guidelines at all times:
- Inspect code before making assertions about it. Cite concrete file paths when discussing code.
- If you have not verified something directly, state it explicitly rather than making assumptions.
- Responde siempre en el idioma del usuario (por defecto español si el usuario escribe en español).
- Comprueba la premisa antes de trabajar (importante):
  Muchas tareas afirman algo que puede no ser cierto ("los tests fallan", "esto está roto", "el bug está en X"). Compruébalo en los primeros pasos.
  Si lo que observas contradice la premisa, PARA y dilo. No busques otra explicación ni supongas tests ocultos.
- Eficiencia: cada llamada a herramienta cuenta. Cuando tengas suficiente información para responder, DEJA de usar herramientas y responde. No leas ficheros innecesarios.
- Never defeat or bypass an access control, permission check, credential requirement, network/proxy restriction, or sandbox/environment boundary.
</guidelines>

<communication_style>
- Keep your responses concise.
- Format your responses in github-style markdown.
- LaTeX math (KaTeX) is rendered inline with \\(...\\) or $...$, and display with \\[...\\] or $$...$$. Escape literal dollars in prose as \\$ (\\$100).
- You MUST create clickable links for all files you reference. Use github style markdown links with the file:// scheme (e.g., [notes.md](file:///path/to/notes.md), or [notes.md](file:///path/to/notes.md#L10-L20) to link to specific lines). For Windows, use forward slashes for paths.
</communication_style>

<messaging>
You are connected to a messaging system where you may receive messages from: agents, background tasks, user-queued messages.

## Receiving Messages
You receive messages automatically at the start of each invocation. All messages are delivered in full directly into your context — no manual retrieval is needed.

## Reactive Wakeup (No Polling Needed)
The system automatically resumes your execution when:
- A message arrives from a subagent or peer agent
- A background task completes or sends you a notification
- A user-queued message is ready to be dequeued

This means you do NOT need to poll in a loop while waiting for messages or updates. After launching anything that performs work asynchronously, you may continue other work or simply stop by calling no more tools. The system will notify you when there is something to process.
</messaging>

<subagents>
## Invoking Subagents
Subagents can be invoked using the invoke_subagent tool. Standard available subagents:
- self: Subagent that inherits the parent agent's full configuration including tools, system prompt, and model. Use when you need isolated execution with write permissions.
- research: Research subagent with read-only tools for exploring the codebase, searching the web, and reading files. Delegate when broad code inspection is required without altering files.
- browser: Browser subagent that operates the built-in browser to navigate and interact with live web pages (clicking, filling forms, scrolling, inspecting UI state).

## Communicating with Another Agent
Use the send_message tool to send a message to another agent by its conversation ID (returned by invoke_subagent). Do NOT use send_message to communicate with the user.
</subagents>

<artifacts>
Artifacts are special markdown (.md) documents that you can create to present structured information to the user.
# When to Use Artifacts
- Extensive reports and analysis summaries
- Persistent information you'll update over time (task lists, experiment logs)
- Don't use artifacts for simple one-off answers or asking questions.
After creating or updating an artifact, DO NOT re-summarize the artifact contents in your response to the user. Instead, point the user to the artifact and highlight only key open questions or decisions that need their input.
</artifacts>

Herramientas de código:
- search_files busca una expresión regular en el proyecto. Úsala para encontrar dónde se usa algo antes de leer ficheros a ciegas.
- edit_file reemplaza un fragmento exacto. Prefiérelo siempre a write_file: conserva el resto del fichero.
- multi_replace hace VARIOS reemplazos acotados por rango en una sola llamada.
- run_command ejecuta comandos (tests, build, git). Úsala para comprobar que tu cambio funciona.
- write_file solo para ficheros nuevos o reescrituras completas deliberadas.`;

/**
 * Instrucción extra según la política de revisión de planes.
 * Es una preferencia real: cambia lo que el agente hace, no solo lo que se guarda.
 */
/** Traduce el nivel de esfuerzo del composer a una instrucción del sistema. */
/**
 * Presupuesto de contexto en caracteres para el modelo activo.
 * Se asume ~4 caracteres por token y se deja un 25% de margen para la respuesta.
 */
/**
 * Configuración de embeddings según lo que esté disponible.
 *
 * Prioridad: proveedor activo si sabe hacer embeddings, luego Ollama local.
 * Si no hay nada, el índice sigue funcionando en modo léxico.
 */
function embeddingConfig() {
  const preferido = state.prefs.embeddingProvider ?? 'auto';
  const url = state.prefs.embeddingUrl;
  const model = state.prefs.embeddingModel;
  const peso = Number.isFinite(Number(state.prefs.embeddingWeight))
    ? Number(state.prefs.embeddingWeight)
    : 0.45;

  if (preferido === 'openai') {
    return {
      provider: 'openai',
      url: url ?? state.prefs.embeddingBaseUrl ?? 'https://api.openai.com/v1',
      model: model ?? 'text-embedding-3-small',
      apiKey: process.env.OPENAI_API_KEY ?? state.prefs.embeddingApiKey ?? '',
      weight: peso,
    };
  }

  if (preferido === 'gemini') {
    return {
      provider: 'gemini',
      url: url ?? 'https://generativelanguage.googleapis.com/v1beta',
      model: model ?? 'text-embedding-004',
      apiKey: process.env.GEMINI_API_KEY ?? '',
      weight: peso,
    };
  }

  return {
    provider: 'ollama',
    url: url ?? 'http://127.0.0.1:11434',
    model: model ?? 'nomic-embed-text',
    weight: peso,
  };
}

/** Ventanas de contexto que el proveedor declaró para cada modelo, por `proveedor:modelo`. */
const ventanasDeclaradas = new Map();
/** Capacidades declaradas por Ollama para el modelo activo. */
const capacidadesOllama = new Map();

/** Guarda la ventana de un modelo (solo si es un número con sentido). */
function recordarVentana(providerId, modelId, tokens) {
  const valor = Number(tokens);
  if (!Number.isFinite(valor) || valor <= 0) return;
  ventanasDeclaradas.set(`${providerId}:${modelId}`, valor);
}

/** Ventana declarada para ese modelo, o `undefined` si no la dijo. */
function ventanaDeclaradaDe(providerId, modelId) {
  return ventanasDeclaradas.get(`${providerId}:${modelId}`);
}

/**
 * Pregunta a Ollama la ventana real del modelo (`POST /api/show`).
 *
 * `/api/tags` no la trae, y los modelos locales suelen venir con una ventana
 * pequeña por defecto: mandarles el historial calculado para 128k hace que el
 * turno falle entero por exceso de contexto. Falla en silencio y sin bloquear:
 * si no contesta a tiempo, queda el valor por defecto.
 */
async function recordarVentanaOllama(modelId) {
  if (!modelId) return;
  if (ventanaDeclaradaDe('ollama', modelId) !== undefined || capacidadesOllama.has(modelId)) return;
  const base = String(state.prefs?.customProviders?.ollama?.baseUrl ?? 'http://127.0.0.1:11434').replace(/\/+$/, '');
  try {
    const respuesta = await fetch(`${base}/api/show`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: modelId }),
      signal: AbortSignal.timeout(2_500),
    });
    if (!respuesta.ok) return;
    const payload = await respuesta.json();
    const tokens = contexto.ventanaDeOllama(payload);
    if (tokens) recordarVentana('ollama', modelId, tokens);
    const capacidades = contexto.capacidadesDeOllama(payload);
    if (capacidades) capacidadesOllama.set(modelId, capacidades);
  } catch {
    // Sin red, sin Ollama o lento: se sigue con el valor por defecto.
  }
}

/**
 * Ventana real del modelo activo, en tokens. El bucle la usa para descontar
 * prompt y herramientas del presupuesto, y Ollama la recibe como `num_ctx`.
 */
function ventanaDelTurno(modelId) {
  const proveedor = state.providerId ?? '';
  const modelo = modelId ?? state.model ?? '';
  return contexto.ventanaDeModelo({
    providerId: proveedor,
    modelId: modelo,
    reportada: ventanaDeclaradaDe(proveedor, modelo),
  });
}

/**
 * Ajustes de pensamiento que hay que mandar al proveedor para el nivel elegido.
 *
 * El nivel no puede quedarse en una frase del prompt: cada familia tiene su
 * campo (`reasoning_effort`, `budget_tokens`, `thinkingLevel`) y es lo que de
 * verdad cambia cuánto piensa el modelo. Los que no lo soportan no reciben nada.
 */
function ajustesDePensamientoDelTurno(effort, modelId) {
  // El catálogo vive en el motor, que es asíncrono: se lee del caché ya cargado.
  // Antes se usaba un `PROVIDER_CATALOG` que solo existía dentro de otro manejador,
  // así que cualquier turno fallaba con un ReferenceError.
  const catalogo = engine?.PROVIDER_CATALOG;
  const spec = Array.isArray(catalogo)
    ? catalogo.find((entry) => entry.id === state.providerId)
    : null;
  return pensamiento.ajustesDePensamiento({
    nivel: effort,
    tipo: spec ? spec.kind : null,
    proveedor: state.providerId,
    modelo: modelId ?? state.model ?? null,
  });
}

/**
 * Recordatorio breve para el prompt. El esfuerzo real viaja en la petición;
 * esto solo orienta el estilo, y solo cuando el proveedor no acepta el campo.
 */
function effortInstruction(effort, ajustes) {
  const nivel = pensamiento.normalizarNivel(effort);
  if (!nivel) return '';
  const yaViaja = Boolean(
    ajustes && (ajustes.reasoningEffort || ajustes.thinkingBudget || ajustes.thinkingLevel),
  );
  if (yaViaja) return '';

  const map = {
    minimal: 'Responde con lo mínimo: la respuesta más corta que resuelva la petición.',
    low: 'Responde de forma directa y breve, con los mínimos pasos necesarios.',
    medium: 'Equilibra brevedad y rigor: explica lo justo antes de actuar.',
    high: 'Razona con detalle, verifica cada paso y revisa el resultado antes de responder.',
    xhigh: 'Descompón el problema, contrasta cada hipótesis con evidencia y revisa el resultado dos veces.',
    max: 'Razona al máximo: enumera alternativas, descarta las que no aguanten evidencia y verifica el resultado antes de responder.',
  };

  return `\n\n[Esfuerzo de razonamiento: ${nivel}] ${map[nivel] ?? ''}`;
}

function planReviewInstruction(policy) {
  switch (policy) {
    case 'Always Review':
      return (
        '\n\n## Plan mode (obligatorio)' +
        '\nAntes de usar cualquier otra herramienta, llama a `present_plan` con los pasos que vas a seguir.' +
        '\nEspera la respuesta. Si el usuario aprueba, ejecuta los pasos en orden.' +
        '\nSi la rechaza, lee su motivo, ajusta el plan y vuelve a llamar a `present_plan`.' +
        '\nNo toques ficheros ni ejecutes comandos antes de la aprobación.'
      );

    case 'Never':
      return (
        '\n\n## Plan mode (desactivado)' +
        '\nProcede directamente sin presentar planes, incluso si el cambio afecta a varios ficheros.'
      );

    default:
      // 'Always Ask': decide según la forma de la tarea, con una regla concreta.
      return (
        '\n\n## Plan mode (según la tarea)' +
        '\nLlama a `present_plan` antes de actuar cuando se cumpla cualquiera de estas condiciones:' +
        '\n- la tarea requiere 3 o más pasos con herramientas,' +
        '\n- vas a modificar o borrar ficheros,' +
        '\n- vas a ejecutar comandos que cambian el estado del proyecto.' +
        '\nPara preguntas, lecturas y consultas de una sola herramienta, responde directamente sin plan.'
      );
  }
}

/**
 * Envuelve una herramienta con la puerta de permisos.
 *
 * Precedencia: permiso explícito por herramienta > preset global.
 *   - `deny`  → nunca se ejecuta.
 *   - `allow` → se ejecuta sin preguntar.
 *   - `ask`   → siempre pregunta.
 *   - `inherit` (o sin valor) → decide el preset.
 */
let moduloSnapshotGit = null;
const cargarSnapshotGit = () => {
  moduloSnapshotGit ??= import('../dist/cli/git-snapshot.js');
  return moduloSnapshotGit;
};

/**
 * Ejecuta un comando con foto git antes/después para que el revert del paso
 * también pueda deshacer ficheros que el shell cambió.
 */
async function ejecutarComandoConSnapshot(tool, args, ctx) {
  let foto = null;
  let anotar = null;
  try {
    const modulo = await cargarSnapshotGit();
    foto = await modulo.prepararSnapshotGit(ctx.cwd);
    anotar = modulo.anotarCambiosGit;
  } catch {
    // Sin módulo o sin git se ejecuta igual: el revert no podrá cubrir el shell.
  }

  try {
    const resultado = await tool.execute(args, ctx);
    if (foto && anotar) {
      await anotar(foto, ctx.cwd, claveDeTrayectoria(), ctx.callId, trayectoria).catch(() => {});
    }
    return resultado;
  } catch (error) {
    if (foto && anotar) {
      await anotar(foto, ctx.cwd, claveDeTrayectoria(), ctx.callId, trayectoria).catch(() => {});
    }
    throw error;
  }
}

function guardTool(tool, preset, prefs, getWindow) {
  // Plan y subagente tienen su propio flujo: sus herramientas ya piden permiso.
  if (tool.name === 'present_plan' || tool.name === 'browser_task') return tool;

  const explicit = prefs.toolPermissions?.[tool.name] ?? 'inherit';

  if (explicit === 'deny') {
    return {
      ...tool,
      async execute() {
        return { content: `La herramienta ${tool.name} está denegada en Ajustes › Tool Permissions.`, isError: true };
      },
    };
  }

  /*
   * `edit_notebook` solo escribe en add/update/delete/create: list y get son
   * lecturas. Antes la herramienta entera se colaba sin permiso ni checkpoint.
   * `run_workflow` ejecuta código y se trata como comando, igual que run_command.
   */
  const esMutacion = (args) => {
    if (tool.name === 'edit_notebook') {
      return ['add', 'update', 'delete', 'create'].includes(
        String(args?.action ?? '').toLowerCase(),
      );
    }
    return (
      tool.name === 'write_file' ||
      tool.name === 'edit_file' ||
      tool.name === 'multi_replace'
    );
  };
  const esComando = () =>
    tool.name === 'run_command' ||
    tool.name === 'run_workflow' ||
    tool.name === 'run_extension_code' ||
    tool.name === 'run_tests' ||
    tool.name === 'generate_image';

  // Programar es una mutación persistente: aunque no escriba en el workspace,
  // debe pasar por la puerta de permisos.
  const esProgramacion = tool.name === 'notify_user' || tool.name === 'schedule';

  return {
    ...tool,
    async execute(args, ctx) {
      /*
       * Un subagente de una conversación anterior no puede seguir tocando el
       * workspace de la conversación abierta. Sus escrituras ya no tienen un
       * turno activo donde pedir aprobación ni dónde registrar el undo.
       */
      if (ctx?.sessionId && state.sessionId && ctx.sessionId !== state.sessionId) {
        return {
          content: 'La conversación cambió antes de completar la herramienta; se canceló.',
          isError: true,
        };
      }
      const writes = esMutacion(args);
      /*
       * «Pedir revisión» es para acciones que cambian algo: escrituras,
       * comandos y red. Antes preguntaba también por cada lectura, así que
       * abrir un fichero costaba un diálogo nativo.
       */
      const presetAsks =
        (preset === 'Request Review' || preset === 'Default') &&
        (writes || esComando() || esProgramacion);
      const needsAsk =
        explicit === 'ask' ||
        (explicit === 'inherit' &&
          (presetAsks ||
            // Una tool MCP es opaca: no sabemos si lee, escribe o ejecuta.
            (tool.mcp === true &&
              (preset === 'Request Review' || preset === 'Default'))));

      if (!needsAsk && !writes) {
        return tool.name === 'run_command'
          ? ejecutarComandoConSnapshot(tool, args, ctx)
          : tool.execute(args, ctx);
      }

      // Las escrituras pasan por una tarjeta de diff, no por un diálogo nativo.
      if (writes) {
        if (!needsAsk) {
          // Sin revisión previa, pero con snapshot para poder deshacer después.
          await registrarSnapshotDeEscritura(args, ctx);
          return tool.execute(args, ctx);
        }

        // El diff JSON de un cuaderno no aporta; se pide permiso y se guarda snapshot.
        if (tool.name === 'edit_notebook') {
          await registrarSnapshotDeEscritura(args, ctx);
          const aprobado = await askPermission(
            getWindow(),
            'El agente quiere editar un cuaderno de Jupyter',
            JSON.stringify(args, null, 2).slice(0, 400),
          );
          if (!aprobado) {
            return { content: 'El usuario denegó la edición del cuaderno.', isError: true };
          }
          return tool.execute(args, ctx);
        }

        return executeWriteWithDiff(tool, args, ctx, getWindow(), needsAsk);
      }

      const approved = await askPermission(
        getWindow(),
        `El agente quiere ejecutar «${tool.name}»`,
        JSON.stringify(args, null, 2).slice(0, 400),
      );

      if (!approved) {
        return { content: `El usuario denegó la herramienta ${tool.name}.`, isError: true };
      }

      return tool.name === 'run_command'
        ? ejecutarComandoConSnapshot(tool, args, ctx)
        : tool.execute(args, ctx);
    },
  };
}

/**
 * Calcula el diff de una escritura, lo muestra en el hilo y aplica el cambio
 * solo si el usuario lo acepta (o si el preset lo permite automáticamente).
 */
/**
 * Registra el snapshot de un fichero antes de escribirlo, sin preguntar nada.
 *
 * Hace falta porque en los presets que no piden revisión el flujo del diff no se
 * ejecuta, y sin esto no habría nada que deshacer.
 */
async function registrarSnapshotDeEscritura(args, ctx) {
  const relativa = String(args.path ?? '');
  if (relativa.length === 0) return;

  const absoluta = path.resolve(ctx.cwd, relativa);
  try {
    const antes = await fsp.readFile(absoluta, 'utf8');
    recordCheckpoint(absoluta, antes, ctx.callId, ctx.sessionId, ctx.turno);
  } catch {
    // El fichero no existe todavía: se marca como nuevo.
    recordCheckpoint(absoluta, null, ctx.callId, ctx.sessionId, ctx.turno);
  }
}

async function executeWriteWithDiff(tool, args, ctx, win, needsAsk) {
  const relative = String(args.path ?? '');
  const absolute = path.resolve(ctx.cwd, relative);

  let before = '';
  let isNew = false;

  try {
    before = await fsp.readFile(absolute, 'utf8');
  } catch {
    isNew = true;
  }

  // Para edit_file el resultado se calcula aplicando el reemplazo.
  let proposed;
  if (tool.name === 'edit_file') {
    if (Array.isArray(args.edits) && args.edits.length > 0) {
      const { aplicarReemplazos } = require('./multi-replace.cjs');
      const resultado = aplicarReemplazos(before, args.edits);
      if (resultado.error) {
        return { content: `${resultado.error} No se cambió nada.`, isError: true };
      }
      proposed = resultado.texto;
    } else {
      let oldText = String(args.oldText ?? '');
      let newText = String(args.newText ?? '');
      // Misma normalización CRLF que la herramienta real; si no, la tarjeta
      // rechazaba un cambio que edit_file sí sabía aplicar.
      if (!before.includes(oldText) && before.includes('\r\n') && !oldText.includes('\r\n')) {
        oldText = oldText.replace(/\n/g, '\r\n');
        newText = newText.replace(/\n/g, '\r\n');
      } else if (!before.includes(oldText) && !before.includes('\r\n') && oldText.includes('\r\n')) {
        oldText = oldText.replace(/\r\n/g, '\n');
        newText = newText.replace(/\r\n/g, '\n');
      }
      if (oldText.length === 0 || !before.includes(oldText)) {
        return { content: `oldText no aparece en ${relative}.`, isError: true };
      }
      proposed = before.replace(oldText, () => newText);
    }
  } else if (tool.name === 'multi_replace') {
    /*
     * Antes se usaba `args.content`, que multi_replace no tiene: la tarjeta
     * mostraba el fichero entero como borrado. Se calcula el resultado real con
     * las mismas reglas que ejecutará la herramienta.
     */
    const { aplicarReemplazos } = require('./multi-replace.cjs');
    const resultado = aplicarReemplazos(before, args.edits);
    if (resultado.error) {
      return { content: `${resultado.error} No se cambió nada.`, isError: true };
    }
    proposed = resultado.texto;
  } else {
    proposed = String(args.content ?? '');
  }

  recordCheckpoint(absolute, isNew ? null : before, ctx.callId, ctx.sessionId, ctx.turno);

  const { rows, additions, removals, approximate } = diffLines(before, proposed);
  const payload = {
    path: relative,
    rows: compactDiff(rows),
    additions,
    removals,
    approximate,
    isNew,
  };

  if (needsAsk) {
    const accepted = await requestDiffApproval(win, payload);
    if (!accepted) {
      return { content: `El usuario rechazó el cambio en ${relative}.`, isError: true };
    }
  } else if (win && !win.isDestroyed()) {
    win.webContents.send('diff:applied', payload);
  }

  const applied = await tool.execute(args, ctx);
  if (!applied.isError) scheduleIndexRefresh();
  return applied;
}

// ---------------------------------------------------------------------------
// Índice de código
// ---------------------------------------------------------------------------

const { CodeIndex } = require('./indexer.cjs');
const { makeCodeSearchTool } = require('./code-search.cjs');

/** Índice de código del workspace. */
const codeIndex = new CodeIndex({ root: process.cwd() });

/** Construye (o refresca) el índice. */
ipcMain.handle('index:build', async () => {
  const stats = await codeIndex.build(state.cwd);
  return { ok: true, ...stats };
});

/** Reindexado automático con retardo, tras guardar un fichero. */
let indexRefreshTimer = null;

function scheduleIndexRefresh() {
  if (indexRefreshTimer) clearTimeout(indexRefreshTimer);
  indexRefreshTimer = setTimeout(async () => {
    indexRefreshTimer = null;
    try {
      await codeIndex.build(state.cwd);
    } catch {
      // el refresco es best-effort
    }
  }, 1500);
}

/** Ruta del caché de embeddings. */
function embeddingsPath() {
  return path.join(app.getPath('userData'), 'embeddings.json');
}

/** Precalcula embeddings de los ficheros del índice. */
ipcMain.handle('index:warm', async () => {
  if (codeIndex.size === 0) await codeIndex.build(state.cwd);

  const ollamaUrl = state.prefs.embeddingUrl ?? 'http://127.0.0.1:11434';
  const model = state.prefs.embeddingModel ?? 'nomic-embed-text';

  const config = embeddingConfig();
  /*
   * La URL sale de las preferencias, que escribe el renderer: sin esta
   * comprobación, un prefs:set cambiaba el destino de los embeddings y con él
   * se iban el código del workspace y la clave del proveedor.
   */
  const veredicto = isUrlAllowed(String(config.url), state.prefs.networkRules, {
    allowLocal: config.provider === 'ollama',
  });
  if (!veredicto.allowed) {
    return { ok: false, error: `URL de embeddings rechazada: ${veredicto.reason}` };
  }
  const result = await codeIndex.warmEmbeddings(config, 300);
  await codeIndex.saveEmbeddings(embeddingsPath());

  return { ok: true, ...result };
});

/** Dónde se usa un símbolo del índice. */
ipcMain.handle('index:references', async (_event, name) => {
  if (codeIndex.size === 0) return { ok: false, results: [] };
  const results = codeIndex.findReferences(String(name ?? ''), 20);
  return { ok: true, results };
});

/** Estado del índice. *//** Estado del índice. */
ipcMain.handle('index:status', async () => {
  return { ok: true, root: state.cwd, ...codeIndex.stats() };
});

/** Búsqueda en el índice: símbolos, léxico o híbrido. */
ipcMain.handle('index:search', async (_event, payload) => {
  const query = String(payload?.query ?? '').trim();
  if (query.length === 0) return { ok: false, error: 'consulta vacía', results: [] };

  if (codeIndex.size === 0) {
    await codeIndex.build(state.cwd);
  }

  const mode = String(payload?.mode ?? 'auto');
  const limit = Math.min(40, Number(payload?.limit ?? 15));

  if (mode === 'symbol') {
    return { ok: true, mode: 'symbol', results: codeIndex.searchSymbols(query, limit) };
  }

  const results = codeIndex.searchLexical(query, limit);

  if (mode === 'lexical') {
    return { ok: true, mode: 'lexical', results };
  }

  // Híbrido: reordena combinando BM25 con similitud semántica.
  const config = embeddingConfig();
  const veredicto = isUrlAllowed(String(config.url), state.prefs.networkRules, {
    allowLocal: config.provider === 'ollama',
  });
  if (!veredicto.allowed) {
    return {
      ok: true,
      mode: 'lexical',
      results,
      warning: `reordenamiento semántico omitido: ${veredicto.reason}`,
    };
  }
  const reranked = await codeIndex.rerankWithEmbeddings(query, results, config);

  return { ok: true, mode: 'hybrid', results: reranked };
});

// ---------------------------------------------------------------------------
// LSP
// ---------------------------------------------------------------------------

const { LspClient, languageForPath, DEFAULT_SERVERS } = require('./lsp.cjs');
const { pathToFileURL } = require('node:url');
const fsSync = require('node:fs');

/** Clientes LSP por lenguaje. */
const lspClients = new Map();
// Arranques en curso: dos pestañas pueden pedir el mismo servidor a la vez.
const lspStarts = new Map();

/** Resuelve el servidor de TypeScript incluido en el proyecto. */
function bundledTsServer() {
  const cli = path.join(app.getAppPath(), 'node_modules', 'typescript-language-server', 'lib', 'cli.mjs');
  return fsSync.existsSync(cli) ? { command: 'node', args: [cli, '--stdio'] } : null;
}

/** ¿Existe el ejecutable en PATH? En Windows los lanzadores npm son .cmd. */
function comandoEnPath(nombre) {
  const extensiones = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  for (const carpeta of String(process.env.PATH ?? '').split(path.delimiter)) {
    for (const extension of extensiones) {
      if (fsSync.existsSync(path.join(carpeta, `${nombre}${extension}`))) return true;
    }
  }
  return false;
}

/** Comando del servidor para un lenguaje, con sobrescritura del usuario. */
function serverFor(language) {
  const custom = state.prefs.lspServers?.[language];
  if (custom && typeof custom.command === 'string' && custom.command.trim().length > 0) {
    return {
      command: custom.command.trim(),
      args: Array.isArray(custom.args) ? custom.args.map(String) : [],
    };
  }

  if (language === 'typescript' || language === 'javascript') {
    const bundled = bundledTsServer();
    if (bundled) return bundled;
  }

  if (language === 'python') {
    // pylsp arranca como ejecutable; el shim .cmd de pyright no lo hace sin shell.
    const candidatos = [
      { command: 'pylsp', args: [] },
      { command: 'pyright-langserver', args: ['--stdio'] },
    ];
    const elegido = candidatos.find((c) => comandoEnPath(c.command));
    if (elegido) return elegido;
  }

  return DEFAULT_SERVERS[language] ?? null;
}

/** Obtiene (o arranca) el cliente LSP del lenguaje del fichero. */
async function ensureLspClient(filePath) {
  const language = languageForPath(filePath);
  if (!language) return { ok: false, error: 'lenguaje sin servidor LSP' };

  if (language === 'go') {
    // gopls necesita `go` en PATH; sin esto el diagnóstico sería engañoso.
    asegurarGoEnPath(state.prefs.goRoot);
    if (!comandoEnPath('go')) {
      return {
        ok: false,
        error: 'Go no está en PATH. Define GOROOT o añade su carpeta bin al PATH.',
      };
    }
  }

  const existing = lspClients.get(language);
  if (existing && existing.ready) return { ok: true, client: existing, language };

  const enCurso = lspStarts.get(language);
  if (enCurso) return enCurso;

  const arranque = (async () => {
    const server = serverFor(language);
    if (!server) return { ok: false, error: `no hay servidor LSP para ${language}` };

    const existeServidor = path.isAbsolute(server.command)
      ? fsSync.existsSync(server.command)
      : comandoEnPath(server.command);
    if (!existeServidor) {
      return {
        ok: false,
        error: `No se encontró ${server.command}. Instálalo o configura su ruta en lspServers.`,
      };
    }

    const client = new LspClient({
      language,
      rootPath: state.cwd,
      onDiagnostics: (uri, diagnostics) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('lsp:diagnostics', { uri, diagnostics });
        }
      },
      onLog: (text) => console.error(`[lsp ${language}] ${text}`),
    });

    client.setServerCommand(server);

    try {
      await client.start();
      lspClients.set(language, client);
      return { ok: true, client, language };
    } catch (error) {
      client.stop();
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, error: `no se pudo arrancar ${server.command}: ${message}` };
    }
  })();

  lspStarts.set(language, arranque);
  try {
    return await arranque;
  } finally {
    lspStarts.delete(language);
  }
}
/** Abre un documento en el servidor del lenguaje. */
ipcMain.handle('lsp:open', async (_event, payload) => {
  const filePath = String(payload?.path ?? '');
  const content = String(payload?.content ?? '');
  const absolute = path.resolve(state.cwd, filePath);

  const ensured = await ensureLspClient(absolute);
  if (!ensured.ok) return ensured;

  const uri = pathToFileURL(absolute).href;
  ensured.client.didOpen(uri, content);

  return {
    ok: true,
    language: ensured.language,
    uri,
    diagnostics: ensured.client.diagnosticsFor(uri),
  };
});

/** Notifica cambios de contenido. */
ipcMain.handle('lsp:change', async (_event, payload) => {
  const filePath = String(payload?.path ?? '');
  const content = String(payload?.content ?? '');
  const absolute = path.resolve(state.cwd, filePath);

  const language = languageForPath(absolute);
  const client = language ? lspClients.get(language) : null;
  if (!client || !client.ready) return { ok: false, error: 'sin servidor LSP' };

  client.didChange(pathToFileURL(absolute).href, content);
  return { ok: true };
});

/** Autocompletado en una posición. */
ipcMain.handle('lsp:complete', async (_event, payload) => {
  const filePath = String(payload?.path ?? '');
  const absolute = path.resolve(state.cwd, filePath);
  const language = languageForPath(absolute);
  const client = language ? lspClients.get(language) : null;
  if (!client || !client.ready) return { ok: false, error: 'sin servidor LSP', items: [] };

  try {
    const result = await client.completion(
      pathToFileURL(absolute).href,
      Number(payload?.line ?? 0),
      Number(payload?.character ?? 0),
    );

    const list = Array.isArray(result) ? result : (result?.items ?? []);
    const items = list.slice(0, 50).map((item) => ({
      label: String(item.label ?? ''),
      kind: item.kind ?? 0,
      detail: item.detail ?? null,
    }));

    return { ok: true, items };
  } catch (error) {
    return { ok: false, error: error.message, items: [] };
  }
});

/** Ir a definición. */
ipcMain.handle('lsp:definition', async (_event, payload) => {
  const filePath = String(payload?.path ?? '');
  const absolute = path.resolve(state.cwd, filePath);
  const language = languageForPath(absolute);
  const client = language ? lspClients.get(language) : null;
  if (!client || !client.ready) return { ok: false, error: 'sin servidor LSP' };

  try {
    const result = await client.definition(
      pathToFileURL(absolute).href,
      Number(payload?.line ?? 0),
      Number(payload?.character ?? 0),
    );

    const first = Array.isArray(result) ? result[0] : result;
    if (!first || !first.uri) return { ok: false, error: 'sin definición' };

    return {
      ok: true,
      path: rutaDeUri(first.uri),
      line: first.range?.start?.line ?? 0,
    };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

/**
 * URI del LSP a ruta local.
 *
 * Hace falta porque `uri.replace('file://','')` deja `\C:\a\b.ts` en Windows y
 * no decodifica `%20`: abrir el fichero fallaba y la acción se reportaba como
 * hecha.
 */
function rutaDeUri(uri) {
  try {
    return fileURLToPath(String(uri));
  } catch {
    return String(uri);
  }
}

/** Convierte una posición LSP (línea/carácter) a índice de cadena. */
function positionToOffset(content, line, character) {
  let offset = 0;
  let currentLine = 0;

  while (currentLine < line) {
    const next = content.indexOf('\n', offset);
    if (next === -1) return content.length;
    offset = next + 1;
    currentLine += 1;
  }

  return Math.min(content.length, offset + character);
}

/** Aplica una lista de TextEdits a un contenido, de atrás hacia delante. */
function applyTextEdits(content, edits) {
  const sorted = [...edits].sort((a, b) => {
    const al = a.range.start.line;
    const bl = b.range.start.line;
    if (al !== bl) return bl - al;
    return b.range.start.character - a.range.start.character;
  });

  let result = content;
  for (const edit of sorted) {
    const start = positionToOffset(result, edit.range.start.line, edit.range.start.character);
    const end = positionToOffset(result, edit.range.end.line, edit.range.end.character);
    result = result.slice(0, start) + edit.newText + result.slice(end);
  }
  return result;
}

/** Renombra un símbolo en todo el workspace. */
ipcMain.handle('lsp:rename', async (_event, payload) => {
  const filePath = String(payload?.path ?? '');
  const absolute = path.resolve(state.cwd, filePath);
  const language = languageForPath(absolute);
  const client = language ? lspClients.get(language) : null;

  if (!client || !client.ready) return { ok: false, error: 'sin servidor LSP' };

  const newName = String(payload?.newName ?? '').trim();
  if (newName.length === 0) return { ok: false, error: 'nombre vacío' };

  try {
    const uri = pathToFileURL(absolute).href;
    const position = {
      line: Number(payload?.line ?? 0),
      character: Number(payload?.character ?? 0),
    };

    /*
     * Algunos servidores (rust-analyzer, pyright) necesitan el
     * prepareRename para resolver el símbolo antes del rename. Si no lo
     * implementan, se ignora y se prueba el rename directo.
     */
    try {
      await client.request('textDocument/prepareRename', { textDocument: { uri }, position });
    } catch {
      // servidor sin prepareRename
    }

    const result = await client.request('textDocument/rename', {
      textDocument: { uri },
      position,
      newName,
    });

    /*
     * gopls y rust-analyzer devuelven `documentChanges` en vez de `changes`.
     * Aplanarlos aquí evita que un rename válido se descarte como vacío.
     */
    const changes = { ...(result?.changes ?? {}) };
    for (const cambio of result?.documentChanges ?? []) {
      if (cambio?.textDocument?.uri && Array.isArray(cambio.edits)) {
        changes[cambio.textDocument.uri] = cambio.edits;
      }
    }
    const entries = Object.entries(changes);

    if (entries.length === 0) return { ok: false, error: 'el servidor no propuso cambios' };

    let touched = 0;

    for (const [uri, edits] of entries) {
      let target;
      try {
        target = fileURLToPath(String(uri));
      } catch {
        continue; // no es un file:// (p. ej. untitled:)
      }
      try {
        // Si el documento está abierto, el servidor calculó las posiciones
        // sobre el buffer, no sobre el disco: aplicar el edit al disco con un
        // buffer sucio desplazaba y corrompía el fichero.
        const current = client.textoDe(uri) ?? await fsp.readFile(target, 'utf8');
        const siguiente = applyTextEdits(current, edits);
        await fsp.writeFile(target, siguiente, 'utf8');
        if (client.textoDe(uri) !== undefined) client.didChange(uri, siguiente);
        touched += 1;
      } catch {
        // fichero ilegible: se omite
      }
    }

    return { ok: true, files: touched };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

/** Formatea un documento. */
ipcMain.handle('lsp:format', async (_event, payload) => {
  const filePath = String(payload?.path ?? '');
  const absolute = path.resolve(state.cwd, filePath);
  const language = languageForPath(absolute);
  const client = language ? lspClients.get(language) : null;

  if (!client || !client.ready) return { ok: false, error: 'sin servidor LSP' };

  try {
    const edits = await client.request('textDocument/formatting', {
      textDocument: { uri: pathToFileURL(absolute).href },
      options: { tabSize: 2, insertSpaces: true },
    });

    if (!Array.isArray(edits) || edits.length === 0) {
      return { ok: true, content: String(payload?.content ?? ''), changed: false };
    }

    return {
      ok: true,
      content: applyTextEdits(String(payload?.content ?? ''), edits),
      changed: true,
    };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

/** Estado de los servidores LSP. */
ipcMain.handle('lsp:status', async () => {
  const languages = ['typescript', 'javascript', 'python', 'go', 'rust', 'json'];
  return languages.map((language) => ({
    language,
    running: Boolean(lspClients.get(language)?.ready),
    server: serverFor(language),
  }));
});

// ---------------------------------------------------------------------------
// Git
// ---------------------------------------------------------------------------

/** Ejecuta git en el workspace y devuelve la salida. */
/**
 * Prueba un servidor MCP: arranca el proceso, pide su lista de herramientas
 * y lo cierra. Sirve para validar la configuración desde Ajustes.
 */
ipcMain.handle('mcp:probe', async (_event, server) => {
  if (!server || !server.command) {
    return { ok: false, error: 'falta el comando' };
  }

  /*
   * Solo se prueban servidores que ya están guardados en la configuración: el
   * renderer no puede lanzar un proceso cualquiera por este canal. La fila de
   * Ajustes solo ofrece «Probar» después de guardar, así que el uso normal no
   * cambia.
   */
  const comando = String(server.command).trim();
  const args = (Array.isArray(server.args) ? server.args : []).map(String);
  const guardado = (state.prefs.plugins ?? []).some(
    (plugin) =>
      String(plugin.command ?? '').trim() === comando &&
      JSON.stringify((plugin.args ?? []).map(String)) === JSON.stringify(args),
  );
  if (!guardado) {
    return { ok: false, error: 'guarda el servidor antes de probarlo' };
  }

  let client = null;

  try {
    const { StdioMcpClient } = await import('../dist/mcp/stdio-client.js');

    client = await StdioMcpClient.start({
      command: server.command,
      args: Array.isArray(server.args) ? server.args : [],
      env: server.env ?? {},
      cwd: state.cwd,
    });

    const tools = await client.listTools();
    return {
      ok: true,
      tools: tools.map((tool) => ({ name: tool.name, description: tool.description ?? '' })),
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    await client?.close().catch(() => {});
  }
});

/** Catálogo local de servidores MCP, sin red ni cuentas. */
ipcMain.handle('marketplace:list', async () => cargarCatalogo());

/** Estado de los servidores MCP configurados, sin arrancarlos. */
ipcMain.handle('mcp:list', async () => {
  const plugins = state.prefs.plugins ?? [];
  return plugins.map((plugin) => ({
    id: plugin.id,
    name: plugin.name,
    command: plugin.command,
    args: plugin.args ?? [],
    enabled: plugin.enabled !== false,
  }));
});

/** Tipo MIME de una imagen por su extensión, o null si no lo es. */
function imageMimeType(filePath) {
  const ext = path.extname(String(filePath)).toLowerCase();
  const map = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
  };
  return map[ext] ?? null;
}

function runGit(args, timeoutMs = 20000) {
  return new Promise((resolve) => {
    const { execFile } = require('node:child_process');

    execFile(
      'git',
      args,
      { cwd: state.cwd, timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout, stderr) => {
        resolve({
          ok: !error,
          stdout: String(stdout ?? ''),
          stderr: String(stderr ?? '') || (error ? error.message : ''),
        });
      },
    );
  });
}

/** Estado del repositorio: rama y ficheros modificados. */
/** Envía los commits locales a la rama remota. */
ipcMain.handle('git:push', async (_event, options = {}) => {
  const args = ['push'];
  if (options.setUpstream) args.push('-u', 'origin', 'HEAD');
  const result = await runGit(args, 60000);
  return { ok: result.ok, output: (result.stdout + result.stderr).trim() };
});

/** Trae y fusiona los cambios del remoto. */
ipcMain.handle('git:pull', async () => {
  const result = await runGit(['pull', '--no-edit'], 60000);
  return { ok: result.ok, output: (result.stdout + result.stderr).trim() };
});

/** Trae referencias del remoto sin fusionar. */
ipcMain.handle('git:fetch', async () => {
  const result = await runGit(['fetch', '--all', '--prune'], 60000);
  return { ok: result.ok, output: (result.stdout + result.stderr).trim() };
});

/** Estado de seguimiento respecto al remoto. */
ipcMain.handle('git:tracking', async () => {
  const result = await runGit(['status', '--porcelain=v1', '-b']);
  if (!result.ok) return { ok: false, ahead: 0, behind: 0, upstream: null, remote: false };

  const line = result.stdout.split('\n').find((entry) => entry.startsWith('##')) ?? '';
  const ahead = Number(/ahead (\d+)/.exec(line)?.[1] ?? 0);
  const behind = Number(/behind (\d+)/.exec(line)?.[1] ?? 0);
  const upstream = /\.\.\.(\S+)/.exec(line)?.[1] ?? null;

  const remotes = await runGit(['remote']);
  const remote = remotes.ok && remotes.stdout.trim().length > 0;

  return { ok: true, ahead, behind, upstream, remote, detached: line.includes('HEAD detached') };
});

/**
 * Pull requests del repositorio remoto. Solo lectura.
 */
/** Lista los workflows del proyecto. */
ipcMain.handle('workflows:list', async () => {
  const carpeta = path.join(state.cwd, '.opengravity', 'workflows');
  try {
    const ficheros = await fsp.readdir(carpeta);
    const salida = [];
    for (const fichero of ficheros.filter((f) => /\.(py|mjs|js)$/.test(f)).sort()) {
      const base = fichero.replace(/\.(py|mjs|js)$/, '');
      let descripcion = '';
      try {
        const meta = JSON.parse(await fsp.readFile(path.join(carpeta, `${base}.workflow.json`), 'utf8'));
        descripcion = typeof meta.description === 'string' ? meta.description : '';
      } catch {}
      salida.push({ name: base, description: descripcion });
    }
    return { ok: true, workflows: salida };
  } catch {
    return { ok: true, workflows: [] };
  }
});

/** Ejecuta un workflow sin argumentos desde la UI. */
ipcMain.handle('workflows:run', async (_event, nombre) => {
  try {
    const ejecutar = makeRunCommandTool(() => state.cwd, () => state.prefs);
    const tool = makeRunWorkflowTool(() => state.cwd, (a, c) => ejecutar.execute(a, c));
    const resultado = await tool.execute({ name: String(nombre ?? '') }, { cwd: state.cwd });
    return { ok: !resultado.isError, content: resultado.content };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('github:pulls', async () => {
  const remote = await runGit(['remote', 'get-url', 'origin']);
  if (!remote.ok) return { ok: false, error: 'este proyecto no tiene remoto origin' };
  const match = /github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/i.exec(remote.stdout.trim());
  if (!match) return { ok: false, error: 'el remoto no es de github.com' };
  const owner = match[1];
  const repo = match[2];
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'Opengravity',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  const token = state.prefs.apiKeys?.github || process.env.GITHUB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    const response = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls?state=all&sort=updated&direction=desc&per_page=20`,
      { headers },
    );
    if (!response.ok) return { ok: false, error: `GitHub respondió ${response.status}` };
    const data = await response.json();
    return {
      ok: true,
      repo: `${owner}/${repo}`,
      pulls: (Array.isArray(data) ? data : []).map((pr) => ({
        number: pr.number, title: pr.title, state: pr.state, draft: pr.draft === true,
        url: pr.html_url, author: pr.user?.login ?? '', head: pr.head?.ref ?? '', base: pr.base?.ref ?? '',
      })),
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

/** Resuelve un conflicto aceptando una de las dos versiones. */
ipcMain.handle('git:resolve', async (_event, filePath, side) => {
  const flag = side === 'ours' ? '--ours' : '--theirs';
  const checkout = await runGit(['checkout', flag, '--', filePath]);
  if (!checkout.ok) return { ok: false, output: checkout.stderr.trim() };

  const add = await runGit(['add', '--', filePath]);
  return { ok: add.ok, output: (checkout.stdout + add.stderr).trim() };
});

/** Aborta una fusión en curso. */
ipcMain.handle('git:abort-merge', async () => {
  const result = await runGit(['merge', '--abort']);
  return { ok: result.ok, output: (result.stdout + result.stderr).trim() };
});

ipcMain.handle('git:status', async () => {
  const result = await runGit(['status', '--porcelain=v1', '-b']);

  if (!result.ok) {
    return { ok: false, error: result.stderr.trim() || 'git no disponible', branch: null, files: [] };
  }

  let branch = null;
  const files = [];

  for (const line of result.stdout.split('\n')) {
    if (line.startsWith('##')) {
      branch = line.slice(2).trim().split('...')[0].trim();
      continue;
    }
    if (line.length < 4) continue;

    const stagedCode = line[0];
    const unstagedCode = line[1];
    const path = line.slice(3).trim();

    files.push({
      path,
      staged: stagedCode !== ' ' && stagedCode !== '?',
      status: stagedCode !== ' ' && stagedCode !== '?' ? stagedCode : unstagedCode,
      untracked: stagedCode === '?',
    });
  }

  return { ok: true, branch, files };
});

/** Diff unificado de un fichero (o de todo el repo). */
ipcMain.handle('git:diff', async (_event, payload) => {
  const relative = String(payload?.path ?? '');
  const staged = payload?.staged === true;

  const args = ['diff', '--no-color', '-U3'];
  if (staged) args.push('--cached');
  if (relative.length > 0) args.push('--', relative);

  let result = await runGit(args);

  // Fichero sin seguimiento: git diff no muestra nada.
  if (result.ok && result.stdout.trim().length === 0 && relative.length > 0) {
    const tracked = await runGit(['ls-files', '--error-unmatch', relative]);
    if (!tracked.ok) {
      const fspLocal = require('node:fs/promises');
      try {
        const content = await fspLocal.readFile(rutaAutorizada(state.cwd, relative), 'utf8');
        const lines = content.split('\n').map((text, index) => ({
          type: 'add',
          text,
          oldLine: null,
          newLine: index + 1,
        }));
        return { ok: true, rows: lines.slice(0, 500), untracked: true };
      } catch {
        return { ok: false, error: 'no se pudo leer el fichero' };
      }
    }
  }

  if (!result.ok) {
    return { ok: false, error: result.stderr.trim() || 'git diff falló' };
  }

  const rows = [];
  for (const line of result.stdout.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff ') || line.startsWith('index ')) {
      continue;
    }
    if (line.startsWith('@@')) {
      rows.push({ type: 'gap', text: line, oldLine: null, newLine: null });
      continue;
    }
    if (line.startsWith('+')) {
      rows.push({ type: 'add', text: line.slice(1), oldLine: null, newLine: null });
      continue;
    }
    if (line.startsWith('-')) {
      rows.push({ type: 'remove', text: line.slice(1), oldLine: null, newLine: null });
      continue;
    }
    rows.push({ type: 'context', text: line.slice(1), oldLine: null, newLine: null });
  }

  return { ok: true, rows: rows.slice(0, 2000) };
});

/** Añade ficheros al índice. */
ipcMain.handle('git:stage', async (_event, paths) => {
  const list = Array.isArray(paths) ? paths.map(String) : [];
  if (list.length === 0) return { ok: false, error: 'sin ficheros' };
  const result = await runGit(['add', '--', ...list]);
  return result.ok ? { ok: true } : { ok: false, error: result.stderr.trim() };
});

/** Quita ficheros del índice. */
ipcMain.handle('git:unstage', async (_event, paths) => {
  const list = Array.isArray(paths) ? paths.map(String) : [];
  if (list.length === 0) return { ok: false, error: 'sin ficheros' };
  const result = await runGit(['reset', 'HEAD', '--', ...list]);
  return result.ok ? { ok: true } : { ok: false, error: result.stderr.trim() };
});

/** Lista de ramas locales. */
ipcMain.handle('git:branches', async () => {
  const result = await runGit(['branch', '--format=%(refname:short)%09%(HEAD)']);
  if (!result.ok) return { ok: false, error: result.stderr.trim(), branches: [] };

  const branches = result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, head] = line.split('\t');
      return { name, current: head === '*' };
    });

  return { ok: true, branches };
});

/** Cambia de rama. */
ipcMain.handle('git:checkout', async (_event, branch) => {
  const name = String(branch ?? '').trim();
  if (name.length === 0) return { ok: false, error: 'rama vacía' };
  // Una «rama» que empieza por guion es un flag: `git checkout -f` tira los
  // cambios sin commit. Nunca se pasa tal cual a git.
  if (name.startsWith('-')) return { ok: false, error: 'nombre de rama no válido' };

  const result = await runGit(['checkout', name], 30000);
  return result.ok
    ? { ok: true, output: result.stdout.trim() }
    : { ok: false, error: (result.stderr || result.stdout).trim() };
});

/** Historial reciente. */
ipcMain.handle('git:log', async (_event, payload) => {
  const limit = Math.min(50, Number(payload?.limit ?? 15));

  const result = await runGit([
    'log',
    `-${limit}`,
    '--pretty=format:%h%x09%an%x09%ar%x09%s',
  ]);

  if (!result.ok) return { ok: false, error: result.stderr.trim(), commits: [] };

  const commits = result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [hash, author, when, subject] = line.split('\t');
      return { hash, author, when, subject };
    });

  return { ok: true, commits };
});

/** Diff por hunks de un fichero, para poder prepararlos de uno en uno. */
ipcMain.handle('git:diff-hunks', async (_event, payload) => {
  const relative = String(payload?.path ?? '');
  const staged = payload?.staged === true;

  const args = ['diff', '--no-color', '-U3'];
  if (staged) args.push('--cached');
  args.push('--', relative);

  const result = await runGit(args);
  if (!result.ok) return { ok: false, error: result.stderr.trim(), hunks: [] };

  // Fichero sin seguimiento: no hay diff. Se ofrece el contenido completo como
  // un único bloque, y el stage se resuelve con `git add`.
  if (result.stdout.trim().length === 0 && relative.length > 0) {
    const tracked = await runGit(['ls-files', '--error-unmatch', relative]);
    if (!tracked.ok) {
      try {
        const content = await fsp.readFile(rutaAutorizada(state.cwd, relative), 'utf8');
        const all = content.split('\n').slice(0, 400);
        return {
          ok: true,
          untracked: true,
          header: '',
          hunks: [
            {
              index: 0,
              header: `@@ fichero nuevo (${all.length} líneas) @@`,
              additions: all.length,
              removals: 0,
              preview: all.map((text) => `+${text}`),
              patch: '',
            },
          ],
        };
      } catch {
        return { ok: true, header: '', hunks: [] };
      }
    }
  }

  const lines = result.stdout.split('\n');
  const header = [];
  const hunks = [];
  let current = null;

  for (const line of lines) {
    if (line.startsWith('@@')) {
      if (current) hunks.push(current);
      current = { header: line, lines: [line], additions: 0, removals: 0 };
      continue;
    }

    if (!current) {
      // Cabecera del diff (diff --git, index, ---, +++)
      if (line.length > 0) header.push(line);
      continue;
    }

    if (line.startsWith('+') && !line.startsWith('+++')) current.additions += 1;
    if (line.startsWith('-') && !line.startsWith('---')) current.removals += 1;
    current.lines.push(line);
  }

  if (current) hunks.push(current);

  return {
    ok: true,
    header: header.join('\n'),
    hunks: hunks.map((hunk, index) => ({
      index,
      header: hunk.header,
      additions: hunk.additions,
      removals: hunk.removals,
      preview: hunk.lines.slice(0, 40),
      patch: hunk.lines.join('\n'),
    })),
  };
});

/** Prepara o revierte un solo hunk. */
ipcMain.handle('git:apply-hunk', async (_event, payload) => {
  const relative = String(payload?.path ?? '');
  const staged = payload?.staged === true;
  const patch = String(payload?.patch ?? '');
  const header = String(payload?.header ?? '');

  if (patch.length === 0 || header.length === 0) {
    return { ok: false, error: 'hunk vacío' };
  }

  const fullPatch = `${header}\n${patch}\n`;

  const args = ['apply', '--cached', '--unidiff-zero'];
  if (staged) args.push('--reverse');

  const { execFile } = require('node:child_process');

  return new Promise((resolve) => {
    const child = execFile('git', args, { cwd: state.cwd, timeout: 20000 }, (error, stdout, stderr) => {
      if (error) {
        resolve({ ok: false, error: String(stderr || error.message).trim() });
        return;
      }
      resolve({ ok: true, output: String(stdout).trim() });
    });

    try {
      child.stdin.write(fullPatch);
      child.stdin.end();
    } catch {
      resolve({ ok: false, error: 'no se pudo enviar el parche' });
    }
  });
});

/** Crea un commit con lo que haya en el índice. */
ipcMain.handle('git:commit', async (_event, message) => {
  const text = String(message ?? '').trim();
  if (text.length === 0) return { ok: false, error: 'mensaje vacío' };

  const result = await runGit(['commit', '-m', text], 60000);
  return result.ok
    ? { ok: true, output: result.stdout.trim() }
    : { ok: false, error: (result.stderr || result.stdout).trim() };
});

// ---------------------------------------------------------------------------
// Terminal integrada (PTY real si está disponible)
// ---------------------------------------------------------------------------

/** node-pty es opcional: si no carga, se usa el ejecutor de comandos. */
let nodePty = null;
try {
  // eslint-disable-next-line global-require
  nodePty = require('@lydell/node-pty');
} catch {
  nodePty = null;
}


/**
 * Sesiones PTY abiertas, indexadas por id. Antes había una sola variable
 * global: con varias terminales cada una necesita su proceso y su ciclo de vida.
 */
const ptySesiones = new Map();

/** Id por defecto cuando el renderer no manda ninguno. */
const PTY_POR_DEFECTO = 'terminal-1';

/** Cierra todas las sesiones PTY. Se llama al salir de la app. */
function cerrarTodasLasPty() {
  for (const sesion of ptySesiones.values()) {
    try {
      sesion.child.kill();
    } catch {
      // ya cerrada
    }
  }
  ptySesiones.clear();
}

ipcMain.handle('terminal:pty-status', async () => ({
  available: Boolean(nodePty),
  running: ptySesiones.size > 0,
  sesiones: [...ptySesiones.keys()],
}));

/** Prueba la configuración SSH y conecta el cliente SFTP. */
ipcMain.handle('ssh:test', async () => {
  try {
    const cfg = sshRemoto.configuracion(state.prefs);
    await sshRemoto.workspace.conectar(cfg);
    const entries = await sshRemoto.workspace.listar(cfg.remotePath);
    return { ok: true, host: cfg.host, port: cfg.port, user: cfg.user, path: cfg.remotePath, entries: entries.length };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('ssh:open-project', async () => {
  try {
    const cfg = sshRemoto.configuracion(state.prefs);
    await sshRemoto.workspace.conectar(cfg);
    const mirror = await remoteProject.abrir(cfg, app.getPath('userData'));
    state.cwd = mirror.root;
    state.project = mirror.root;
    state.remote = {
      host: cfg.host, port: cfg.port, user: cfg.user, remotePath: cfg.remotePath,
      label: `ssh://${cfg.user}@${cfg.host}:${cfg.port}${cfg.remotePath}`,
    };
    registrarRaiz(state.cwd);
    registrarProyecto(state.cwd);
    terminalCwd = null;
    await cerrarPlugins();
    await actualizarProyectoDeSesion(state.project);
    await saveSettings();
    return { ok: true, cwd: state.cwd, project: state.project, remote: state.remote };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('ssh:list', async (_event, remotePath) => {
  try {
    const cfg = sshRemoto.configuracion(state.prefs);
    await sshRemoto.workspace.conectar(cfg);
    return { ok: true, path: remotePath || cfg.remotePath, entries: await sshRemoto.workspace.listar(remotePath || cfg.remotePath) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('ssh:read', async (_event, remotePath) => {
  try {
    const cfg = sshRemoto.configuracion(state.prefs);
    await sshRemoto.workspace.conectar(cfg);
    return { ok: true, path: remotePath, content: await sshRemoto.workspace.leer(remotePath) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('ssh:exec', async (_event, payload) => {
  try {
    const cfg = sshRemoto.configuracion(state.prefs);
    await sshRemoto.workspace.conectar(cfg);
    const cwd = path.posix.resolve(cfg.remotePath, String(payload?.cwd ?? '.'));
    const result = await sshRemoto.workspace.exec(String(payload?.command ?? ''), cwd, Number(payload?.timeoutMs ?? 30000));
    return { ok: true, ...result };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('ssh:write', async (_event, payload) => {
  try {
    const cfg = sshRemoto.configuracion(state.prefs);
    await sshRemoto.workspace.conectar(cfg);
    return await sshRemoto.workspace.escribir(String(payload?.path ?? ''), String(payload?.content ?? ''));
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('ssh:disconnect', async () => {
  if (state.remote?.direct) await sshfs.desmontar(state.remote.drive);
  remoteProject.cerrar();
  state.remote = null;
  await sshRemoto.workspace.cerrar();
  return { ok: true };
});

/** Monta el proyecto remoto como unidad directa, sin espejo. */
ipcMain.handle('ssh:mount-project', async () => {
  try {
    if (state.remote?.direct && state.remote.drive) {
      return { ok: true, cwd: state.cwd, project: state.project, remote: state.remote };
    }
    const cfg = sshRemoto.configuracion(state.prefs);
    const montado = await sshfs.montar(cfg);
    if (!montado.ok) return montado;
    remoteProject.cerrar();
    state.cwd = montado.path;
    state.project = montado.path;
    state.remote = {
      host: cfg.host, port: cfg.port, user: cfg.user, remotePath: cfg.remotePath,
      drive: montado.drive, direct: true,
      label: `ssh://${cfg.user}@${cfg.host}:${cfg.port}${cfg.remotePath}`,
    };
    registrarRaiz(state.cwd);
    registrarProyecto(state.cwd);
    terminalCwd = null;
    await cerrarPlugins();
    await actualizarProyectoDeSesion(state.project);
    await saveSettings();
    return { ok: true, cwd: state.cwd, project: state.project, remote: state.remote };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

/** Arranca una shell interactiva en un PTY nuevo. */
ipcMain.handle('terminal:start-pty', async (event, payload = {}) => {
  if (!nodePty) return { ok: false, error: 'PTY no disponible' };

  const id = String(payload?.id ?? PTY_POR_DEFECTO);
  if (ptySesiones.has(id)) return { ok: true, id };

  let shell = process.platform === 'win32' ? 'powershell.exe' : process.env.SHELL || '/bin/bash';
  let args = process.platform === 'win32' ? ['-NoLogo'] : [];

  if (payload?.kind === 'ssh') {
    let cfg;
    try { cfg = sshRemoto.configuracion(state.prefs); }
    catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
    const comillas = (value) => `'${String(value).replace(/'/g, "'\\''")}'`;
    const sshExe = process.platform === 'win32'
      ? path.join(process.env.WINDIR ?? 'C:\\Windows', 'System32', 'OpenSSH', 'ssh.exe')
      : 'ssh';
    shell = require('node:fs').existsSync(sshExe) ? sshExe : 'ssh.exe';
    args = ['-p', String(cfg.port), '-o', 'StrictHostKeyChecking=accept-new'];
    if (cfg.keyPath) args.push('-i', cfg.keyPath);
    if (cfg.remotePath) args.push('-t');
    args.push(`${cfg.user}@${cfg.host}`);
    if (cfg.remotePath) args.push(`cd ${comillas(cfg.remotePath)} && exec $SHELL -l`);
  }

  try {
    const child = nodePty.spawn(shell, args, {
      name: 'xterm-color',
      cols: Math.max(20, Number(payload?.cols ?? state.prefs.terminalCols ?? 100)),
      rows: Math.max(5, Number(payload?.rows ?? state.prefs.terminalRows ?? 24)),
      cwd: currentTerminalCwd(),
      env: process.env,
    });

    child.onData((data) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send('terminal:data', { chunk: data, raw: true, id });
      }
    });

    child.onExit(({ exitCode }) => {
      ptySesiones.delete(id);
      if (!event.sender.isDestroyed()) {
        event.sender.send('terminal:done', { code: exitCode, id });
      }
    });

    ptySesiones.set(id, { child, shell });
    return { ok: true, id, shell };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

/** Escribe en un PTY (teclas o texto). */
ipcMain.handle('terminal:pty-write', async (_event, payload) => {
  const id = typeof payload === 'object' && payload !== null ? String(payload.id ?? PTY_POR_DEFECTO) : PTY_POR_DEFECTO;
  const datos = typeof payload === 'object' && payload !== null ? payload.data : payload;

  const sesion = ptySesiones.get(id);
  if (!sesion) return { ok: false, error: 'PTY no iniciado' };

  try {
    sesion.child.write(String(datos ?? ''));
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

/** Redimensiona un PTY. */
ipcMain.handle('terminal:pty-resize', async (_event, payload) => {
  const id = String(payload?.id ?? PTY_POR_DEFECTO);
  const sesion = ptySesiones.get(id);
  if (!sesion) return { ok: false };

  try {
    sesion.child.resize(
      Math.max(20, Number(payload?.cols ?? 100)),
      Math.max(5, Number(payload?.rows ?? 24)),
    );
    return { ok: true };
  } catch {
    return { ok: false };
  }
});

/** Cierra un PTY concreto, o todos si no se indica ninguno. */
ipcMain.handle('terminal:pty-kill', async (_event, payload) => {
  const id = payload?.id;

  if (id === undefined) {
    cerrarTodasLasPty();
    return { ok: true };
  }

  const clave = String(id);
  const sesion = ptySesiones.get(clave);
  if (!sesion) return { ok: false };

  try {
    sesion.child.kill();
  } catch {
    // ya cerrada
  }
  ptySesiones.delete(clave);
  return { ok: true };
});

// ---------------------------------------------------------------------------
// Terminal integrada
// ---------------------------------------------------------------------------

/** Directorio actual de la terminal (persiste entre comandos). */
let terminalCwd = null;

/** Proceso de terminal en curso. */
let terminalProcess = null;

function currentTerminalCwd() {
  return terminalCwd ?? state.cwd;
}

/**
 * Ejecuta un comando en la terminal y transmite su salida por `terminal:data`.
 * No es un PTY: no hay aplicaciones de pantalla completa ni control de cursor.
 */
ipcMain.handle('terminal:run', async (event, payload) => {
  if (terminalProcess) {
    return { ok: false, error: 'ya hay un comando en ejecución' };
  }

  const command = String(payload?.command ?? '').trim();
  if (command.length === 0) return { ok: false, error: 'comando vacío' };

  const send = (channel, data) => {
    if (!event.sender.isDestroyed()) event.sender.send(channel, data);
  };

  // `cd` se resuelve aquí para que persista entre comandos.
  const cdMatch = command.match(/^cd(?:\s+(.+))?$/);
  if (cdMatch) {
    const target = (cdMatch[1] ?? '').replace(/^["']|["']$/g, '').trim();
    const next = path.resolve(currentTerminalCwd(), target.length > 0 ? target : '.');

    try {
      const info = await fsp.stat(next);
      if (!info.isDirectory()) return { ok: false, error: 'no es un directorio' };
      terminalCwd = next;
      send('terminal:data', { chunk: `${next}\n` });
      send('terminal:done', { code: 0 });
      return { ok: true };
    } catch {
      send('terminal:data', { chunk: `cd: no existe ${next}\n` });
      send('terminal:done', { code: 1 });
      return { ok: true };
    }
  }

  if (command === 'clear' || command === 'cls') {
    send('terminal:clear', {});
    send('terminal:done', { code: 0 });
    return { ok: true };
  }

  const { spawn } = require('node:child_process');

  terminalProcess = spawn(command, {
    cwd: currentTerminalCwd(),
    shell: true,
    windowsHide: true,
  });

  terminalProcess.stdout.on('data', (chunk) => {
    send('terminal:data', { chunk: chunk.toString() });
  });
  terminalProcess.stderr.on('data', (chunk) => {
    send('terminal:data', { chunk: chunk.toString() });
  });

  terminalProcess.on('error', (error) => {
    send('terminal:data', { chunk: `${error.message}\n` });
  });

  terminalProcess.on('close', (code) => {
    terminalProcess = null;
    send('terminal:done', { code: code ?? 0 });
  });

  return { ok: true };
});

/** Interrumpe el comando en curso. */
ipcMain.handle('terminal:kill', async () => {
  if (!terminalProcess) return { ok: false };
  try {
    terminalProcess.kill('SIGKILL');
  } catch {
    // ya terminado
  }
  terminalProcess = null;
  return { ok: true };
});

/** Directorio actual de la terminal. */
ipcMain.handle('terminal:cwd', async () => currentTerminalCwd());

/** Propuesta de cambio pendiente de aprobación. */
const turnCheckpoints = new Map();

/** Turno en curso (clave de checkpoint). */
let currentTurnKey = null;
/** Tareas programadas por el agente en este turno. */
let tareasAgenteDelTurno = new Set();

/**
 * Guarda el estado original de un fichero antes de modificarlo.
 * Solo se guarda la primera vez por turno: es el estado al inicio del turno.
 */
function recordCheckpoint(
  absolutePath,
  originalContent,
  llamadaId,
  sessionId = state.sessionId,
  turno = currentTurnKey,
) {
  const sesion = String(sessionId ?? state.sessionId ?? 'actual');
  const esSesionActual = !sessionId || sessionId === state.sessionId;
  const esTurnoActual = turno == null || turno === currentTurnKey;

  // La tarjeta de revisión y el checkpoint rápido son del turno activo. Un
  // subagente que termina después no debe ensuciar el turno de otra sesión.
  if (esSesionActual && esTurnoActual && !cambiosDelTurno.some((entrada) => entrada.absolute === absolutePath)) {
    cambiosDelTurno.push({ absolute: absolutePath, original: originalContent });
  }

  // La trayectoria sí guarda el snapshot en la sesión que originó la escritura.
  trayectoria.anotarEscritura(sesion, absolutePath, originalContent, llamadaId);

  if (!esSesionActual || currentTurnKey === null || turno !== currentTurnKey) return;
  const snapshot = turnCheckpoints.get(currentTurnKey);
  if (!snapshot || snapshot.has(absolutePath)) return;
  snapshot.set(absolutePath, originalContent);
}

/** Clave de trayectoria de la conversación en curso. */
function claveDeTrayectoria() {
  return String(state.sessionId ?? 'actual');
}


/**
 * Quick fixes del LSP para la posición o el diagnóstico indicado.
 * Devuelve solo acciones aplicables aquí: las que traen ediciones propias o un
 * comando que sabemos ejecutar.
 */
ipcMain.handle('lsp:code-actions', async (_event, payload = {}) => {
  const filePath = String(payload.path ?? '');
  const absolute = path.resolve(state.cwd, filePath);
  const language = languageForPath(absolute);
  const client = language ? lspClients.get(language) : null;

  if (!client || !client.ready) return { ok: false, error: 'sin servidor LSP', acciones: [] };

  const uri = pathToFileURL(absolute).href;
  const rango = payload.range ?? {
    start: { line: Number(payload.line ?? 0), character: 0 },
    end: { line: Number(payload.line ?? 0), character: 999 },
  };

  // Diagnósticos del rango pedido: el servidor los usa para afinar la respuesta.
  const diagnosticos = (client.diagnosticsFor(uri) ?? []).filter((d) => {
    const linea = d.range?.start?.line ?? -1;
    return linea >= (rango.start.line ?? 0) && linea <= (rango.end.line ?? 0);
  });

  try {
    const resultado = await client.codeAction(uri, rango, diagnosticos);
    const acciones = (Array.isArray(resultado) ? resultado : [])
      .filter((a) => a && (a.edit || a.command))
      .map((a, indice) => ({
        id: `${indice}:${a.title ?? ''}`,
        titulo: a.title ?? '(sin título)',
        kind: a.kind ?? '',
        tieneEdiciones: Boolean(a.edit),
        comando: a.command ? { command: a.command.command, arguments: a.command.arguments ?? [] } : null,
      }));

    return { ok: true, acciones, diagnosticos: diagnosticos.length };
  } catch (error) {
    return { ok: false, error: error.message ?? String(error), acciones: [] };
  }
});

/**
 * Aplica una acción de código concreta: vuelve a pedir la lista, toma la del
 * índice pedido, aplica sus ediciones y guarda.
 */
ipcMain.handle('lsp:apply-action', async (_event, payload = {}) => {
  const { aplicarWorkspaceEdit } = require('./lsp-edits.cjs');

  const filePath = String(payload.path ?? '');
  const absolute = path.resolve(state.cwd, filePath);
  const language = languageForPath(absolute);
  const client = language ? lspClients.get(language) : null;

  if (!client || !client.ready) return { ok: false, error: 'sin servidor LSP' };

  const uri = pathToFileURL(absolute).href;
  const rango = payload.range ?? {
    start: { line: Number(payload.line ?? 0), character: 0 },
    end: { line: Number(payload.line ?? 0), character: 999 },
  };

  const diagnosticos = (client.diagnosticsFor(uri) ?? []).filter((d) => {
    const linea = d.range?.start?.line ?? -1;
    return linea >= (rango.start.line ?? 0) && linea <= (rango.end.line ?? 0);
  });

  try {
    const resultado = await client.codeAction(uri, rango, diagnosticos);
    const acciones = (Array.isArray(resultado) ? resultado : []).filter((a) => a && (a.edit || a.command));
    const accion = acciones[Number(payload.indice ?? 0)];
    if (!accion) return { ok: false, error: 'la acción ya no está disponible' };

    // Comando sin ediciones: lo ejecuta el servidor.
    if (!accion.edit && accion.command) {
      await client.executeCommand(accion.command.command, accion.command.arguments);
      return { ok: true, ficheros: 0, comando: true };
    }

    // Ediciones: se leen los ficheros afectados, se aplican y se guardan.
    const textos = new Map();
    const rutas = new Map();

    const uris = new Set(Object.keys(accion.edit?.changes ?? {}));
    for (const cambio of accion.edit?.documentChanges ?? []) {
      if (cambio?.textDocument?.uri) uris.add(cambio.textDocument.uri);
    }

    for (const u of uris) {
      const destino = rutaDeUri(u);
      try {
        // Mismo criterio que rename: si el documento está abierto, el servidor
        // calculó el edit sobre su buffer, no sobre el fichero del disco.
        textos.set(u, client.textoDe(u) ?? await fsp.readFile(destino, 'utf8'));
        rutas.set(u, destino);
      } catch {
        // Fichero ilegible: se omite.
      }
    }

    const cambios = aplicarWorkspaceEdit(textos, accion.edit);
    let ficheros = 0;

    for (const [u, contenido] of cambios) {
      const destino = rutas.get(u);
      if (!destino) continue;
      recordCheckpoint(destino, textos.get(u) ?? '');
      await fsp.writeFile(destino, contenido, 'utf8');
      ficheros += 1;

      // Mantener versión y buffer del servidor al día. Un `version: null`
      // dejaba que el editor reenviara una versión repetida que el servidor
      // descartaba, desalineando las siguientes ediciones.
      if (client.textoDe(u) !== undefined) {
        try {
          client.didChange(u, contenido);
        } catch {
          // Si falla, el servidor se resincroniza al reabrir.
        }
      }
    }

    return { ok: true, ficheros };
  } catch (error) {
    return { ok: false, error: error.message ?? String(error) };
  }
});

/**
 * Buscar y reemplazar en todo el proyecto.
 * Recorre el workspace con las mismas exclusiones que el índice y devuelve las
 * coincidencias agrupadas por fichero.
 */
ipcMain.handle('search:run', async (_event, payload = {}) => {
  const { buscarEnContenido, crearBuscador, listarFicheros } = require('./search.cjs');

  const consulta = String(payload.consulta ?? '');
  if (consulta.length === 0) return { resultados: [], ficheros: 0, truncado: false };

  const buscar = crearBuscador(consulta, payload.opciones ?? {});
  const raiz = state.cwd;
  const rutas = await listarFicheros(raiz);

  const resultados = [];
  const limite = 500;

  for (const relativa of rutas) {
    if (resultados.length >= limite) break;
    let contenido;
    try {
      const buffer = await fsp.readFile(path.join(raiz, relativa));
      // No convertir Latin-1/Windows-1252 a UTF-8: corrompe acentos al reemplazar.
      if (!isUtf8(buffer)) continue;
      contenido = buffer.toString('utf8');
    } catch {
      continue;
    }
    const hallazgos = buscarEnContenido(contenido, buscar, relativa, limite - resultados.length);
    resultados.push(...hallazgos);
  }

  return {
    resultados: resultados.map(({ indice, longitud, ...resto }) => resto),
    ficheros: new Set(resultados.map((r) => r.ruta)).size,
    truncado: resultados.length >= limite,
  };
});

/** Reemplaza en todo el proyecto. Devuelve cuántos ficheros y coincidencias tocó. */
ipcMain.handle('search:replace', async (_event, payload = {}) => {
  const { crearBuscador, listarFicheros, reemplazarEnContenido } = require('./search.cjs');

  const consulta = String(payload.consulta ?? '');
  if (consulta.length === 0) return { ficheros: 0, cambios: 0 };

  const buscar = crearBuscador(consulta, payload.opciones ?? {});
  const reemplazo = String(payload.reemplazo ?? '');
  const raiz = state.cwd;

  let ficheros = 0;
  let cambios = 0;

  for (const relativa of await listarFicheros(raiz)) {
    const absoluta = path.join(raiz, relativa);
    let contenido;
    try {
      const buffer = await fsp.readFile(absoluta);
      if (!isUtf8(buffer)) continue;
      contenido = buffer.toString('utf8');
    } catch {
      continue;
    }

    const resultado = reemplazarEnContenido(contenido, buscar, reemplazo, payload.opciones ?? {});
    if (resultado.cambios === 0) continue;

    // Snapshot antes de tocar: así el cambio también se puede deshacer.
    recordCheckpoint(absoluta, contenido);

    try {
      await fsp.writeFile(absoluta, resultado.contenido, 'utf8');
      ficheros += 1;
      cambios += resultado.cambios;
    } catch {
      // Sin permisos o fichero bloqueado: se ignora ese fichero.
    }
  }

  return { ficheros, cambios };
});

/**
 * Cambios del turno en curso: ruta y contenido previo de cada fichero escrito.
 * `turnCheckpoints` se indexa por el turno y se limpia al revertir; esto es un
 * registro plano que sobrevive hasta el final del turno para poder pintar la
 * tarjeta de revisión.
 */
let cambiosDelTurno = [];

/**
 * Restaura los ficheros a su estado en el punto indicado.
 * Se aplican los snapshots del más nuevo al más antiguo, cada uno con su
 * propio contenido, de modo que el resultado final sea el estado del turno
 * más antiguo que se revierte. Los snapshots con fallos se conservan.
 */
async function restoreCheckpoints(keepCount) {
  const keys = [...turnCheckpoints.keys()]
    .filter((key) => key >= keepCount)
    .sort((a, b) => b - a);

  const resultado = await restoreSnapshots({
    keys,
    checkpoints: turnCheckpoints,
    writeFile: fsp.writeFile,
    rm: fsp.rm,
  });
  const { failures } = resultado;

  /*
   * Si no había snapshots en memoria —tras reiniciar la app, el caso normal— y
   * no hubo fallos, se usa la trayectoria persistida. Con fallos no se toca la
   * trayectoria: primero se reintenta lo que falló.
   */
  if (resultado.restored === 0 && failures.length === 0 && state.sessionId) {
    try {
      await trayectoria.asegurar(state.sessionId);
      const plan = trayectoria.planDeReversionPorMensaje(state.sessionId, keepCount);
      if (plan.ok) {
        for (const cambio of plan.cambios ?? []) {
          try {
            if (cambio.accion === 'borrar') {
              await fsp.rm(cambio.ruta, { force: true });
            } else {
              if (typeof cambio.contenido === 'string') {
                await fsp.writeFile(cambio.ruta, cambio.contenido, 'utf8');
                resultado.restored += 1;
              }
            }
          } catch (error) {
            failures.push({
              path: cambio.ruta,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      }
    } catch {
      // sin trayectoria no hay nada que restaurar
    }
  }

  /*
   * Los pasos del turno revertido se descartan: si se quedan en la trayectoria,
   * un revert posterior vuelve a aplicar sus snapshots.
   */
  if (failures.length === 0 && state.sessionId) {
    try {
      await trayectoria.asegurar(state.sessionId);
      await trayectoria.descartarDesdeMensaje(state.sessionId, keepCount);
    } catch {
      // sin trayectoria no hay nada que descartar
    }
  }

  return { restored: resultado.restored, failures };
}

/** Propuestas de diff esperando respuesta del usuario. */
const pendingDiffs = new Map();

/**
 * Envía una propuesta de diff al renderer y espera aceptación o rechazo.
 * Si nadie responde en 10 minutos, se rechaza.
 */
function requestDiffApproval(win, payload) {
  return new Promise((resolve) => {
    const id = `diff_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

    const timer = setTimeout(() => {
      pendingDiffs.delete(id);
      resolve(false);
    }, 10 * 60 * 1000);

    pendingDiffs.set(id, (accepted) => {
      clearTimeout(timer);
      resolve(accepted);
    });

    win.webContents.send('diff:proposal', { id, ...payload });
  });
}

// ---------------------------------------------------------------------------
// Plan mode
// ---------------------------------------------------------------------------

/** Planes esperando revisión del usuario. */
const pendingPlans = new Map();

/** Muestra una tarjeta de plan y espera la decisión del usuario. */
function requestPlanApproval(win, plan) {
  return new Promise((resolve) => {
    const id = `plan_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

    const timer = setTimeout(() => {
      pendingPlans.delete(id);
      resolve({ approved: false, feedback: 'tiempo de espera agotado' });
    }, 10 * 60 * 1000);

    pendingPlans.set(id, (decision) => {
      clearTimeout(timer);
      resolve(decision);
    });

    win.webContents.send('plan:proposal', { id, ...plan });
  });
}

/** El renderer responde a una propuesta de plan. */
ipcMain.handle('plan:respond', async (_event, payload) => {
  const id = String(payload?.id ?? '');
  const entry = pendingPlans.get(id);
  if (!entry) return { ok: false, error: 'plan no encontrado' };

  pendingPlans.delete(id);
  entry({
    approved: payload.approved === true,
    feedback: typeof payload.feedback === 'string' ? payload.feedback.slice(0, 2000) : '',
    // El plan que vuelve es el que el usuario editó, no el que propuso el agente.
    steps: Array.isArray(payload.steps)
      ? payload.steps.slice(0, 40).map((step) => ({
          title: String(step?.title ?? '').slice(0, 400),
          detail: step?.detail ? String(step.detail).slice(0, 800) : '',
        }))
      : null,
  });
  return { ok: true };
});

/** Preguntas esperando respuesta del usuario. */
const pendingQuestions = new Map();

/** Muestra una tarjeta de preguntas y espera la respuesta del usuario. */
function requestUserQuestion(win, preguntas) {
  return new Promise((resolve) => {
    const id = `q_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

    const timer = setTimeout(() => {
      pendingQuestions.delete(id);
      resolve(null);
    }, 10 * 60 * 1000);

    pendingQuestions.set(id, (respuesta) => {
      clearTimeout(timer);
      resolve(respuesta);
    });

    win.webContents.send('question:ask', { id, questions: preguntas });
  });
}

/** El renderer responde a una tarjeta de preguntas. */
ipcMain.handle('question:respond', async (_event, payload) => {
  const id = String(payload?.id ?? '');
  const entry = pendingQuestions.get(id);
  if (!entry) return { ok: false, error: 'pregunta no encontrada' };

  pendingQuestions.delete(id);
  entry(payload?.answers ?? null);
  return { ok: true };
});

/** Lista los pasos de la trayectoria de la conversación en curso. */
ipcMain.handle('trajectory:list', async () => {
  // La carga es perezosa: hay que asegurarla antes de leer.
  await trayectoria.asegurar(claveDeTrayectoria());
  return { pasos: trayectoria.listarPasos(claveDeTrayectoria()) };
});

/** Prepara la reversión a un paso: qué se restauraría y qué se borraría. */
ipcMain.handle('trajectory:preview', async (_event, payload) => {
  await trayectoria.asegurar(claveDeTrayectoria());
  const indice = Number(payload?.indice ?? 0);
  const plan = trayectoria.planDeReversion(claveDeTrayectoria(), indice);
  if (!plan.ok) return plan;

  return {
    ok: true,
    indice,
    pasosDeshacer: plan.pasosDeshacer,
    mensaje: plan.mensaje,
    cambios: plan.cambios.map((cambio) => ({
      path: path.relative(state.cwd, cambio.ruta) || cambio.ruta,
      action: cambio.accion,
    })),
  };
});

/** Revierte la conversación a un paso concreto. */
ipcMain.handle('trajectory:revert', async (_event, payload) => {
  if (state.busy || cargandoSesion || revirtiendo) {
    return { ok: false, error: 'espera a que el agente termine' };
  }
  const clave = claveDeTrayectoria();
  const sessionId = state.sessionId;
  revirtiendo = true;
  try {
    await trayectoria.asegurar(clave);
    const indice = Number(payload?.indice ?? 0);
    const resultado = await trayectoria.revertirA(clave, indice);
    if (!resultado.ok) return resultado;
    if (state.sessionId !== sessionId) {
      return { ok: false, error: 'la conversación cambió durante el revert' };
    }

  /*
   * Solo se restauran ficheros. El historial NO se recorta aquí: durante el turno
   * `state.messages` todavía no refleja lo que el bucle tiene en memoria, así que el
   * índice guardado no es fiable y recortar borraría la conversación entera. Para
   * deshacer también los mensajes está el revert por turno, que sí conoce su corte.
   */
    return resultado;
  } finally {
    revirtiendo = false;
  }
});

/** El renderer responde a una propuesta de diff. */
ipcMain.handle('diff:respond', async (_event, payload) => {
  const entry = pendingDiffs.get(String(payload?.id ?? ''));
  if (!entry) return { ok: false, error: 'propuesta no encontrada' };
  pendingDiffs.delete(String(payload.id));
  entry(payload.accepted === true);
  return { ok: true };
});

/** Diálogo nativo de permiso. Devuelve `true` si el usuario acepta. */
async function askPermission(win, message, detail) {
  const result = await dialog.showMessageBox(win, {
    type: 'question',
    buttons: ['Permitir', 'Denegar'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
    title: 'Permiso del agente',
    message,
    detail,
  });
  return result.response === 0;
}

// ---------------------------------------------------------------------------
// Almacén de sesiones
// ---------------------------------------------------------------------------

/** Instancia perezosa del almacén de sesiones. */
let store = null;

async function getStore() {
  if (store) return store;
  const { JsonlSessionStore } = await getEngine();
  store = new JsonlSessionStore();
  return store;
}

/** Mantiene la conversación abierta alineada con el proyecto elegido. */
async function actualizarProyectoDeSesion(project) {
  if (!state.sessionId) return;
  try {
    const sessions = await getStore();
    await enColaTienda(() => sessions.setProject(state.sessionId, project));
  } catch {
    // best-effort: el estado en memoria ya representa la elección
  }
}

/**
 * Pide al modelo un título corto y semántico para la conversación.
 *
 * Antigravity no recorta el prompt: genera un título. Se hace en una llamada
 * aparte, después del turno, para no retrasar la respuesta. Si falla, el título
 * heurístico que ya escribió el almacén se queda como estaba.
 */
async function generarTituloDeConversacion(provider, model, textoUsuario, textoAsistente) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  let titulo = '';
  try {
    const peticion = {
      model,
      maxTokens: 256,
      temperature: 0.2,
      system:
        'Eres un generador de títulos de conversación. Devuelve SOLO un título en ' +
        'inglés de 3 a 6 palabras, en Title Case, sin comillas ni punto final.',
      messages: [
        {
          role: 'user',
          content:
            `Usuario: ${String(textoUsuario).slice(0, 2000)}\n` +
            `Asistente: ${String(textoAsistente).slice(0, 2000)}`,
        },
      ],
    };
    for await (const chunk of provider.streamGenerate(peticion, controller.signal)) {
      if (chunk.type === 'text') titulo += chunk.text;
      if (chunk.type === 'done') break;
    }
  } finally {
    clearTimeout(timer);
  }

  titulo = titulo
    .replace(/\s+/g, ' ')
    .replace(/^[\s"'`«»“”]+|[\s"'`«»“”]+$/g, '')
    .replace(/[.。]+$/g, '')
    .trim();
  if (titulo.length === 0) return null;
  return titulo.split(' ').slice(0, 6).join(' ').slice(0, 80);
}

// ---------------------------------------------------------------------------
// Ventana
// ---------------------------------------------------------------------------

/** Ventana principal de la aplicación. */
let mainWindow = null;

/**
 * Pinta la barra de título nativa con los colores del tema en uso.
 *
 * Los valores salen del CSS ya aplicado (`--sidebar` y `--foreground`), así que
 * la paleta sigue teniendo un solo sitio: `styles.css`.
 */
async function aplicarBarraDeTitulo() {
  if (!mainWindow || process.platform === 'darwin') return;
  try {
    const [fondo, simbolo] = await mainWindow.webContents.executeJavaScript(
      `(() => {
        const estilo = getComputedStyle(document.querySelector('.sidebar') || document.body);
        const raiz = getComputedStyle(document.documentElement);
        const aHex = (valor) => {
          const canvas = document.createElement('canvas');
          canvas.width = 1;
          canvas.height = 1;
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = valor;
          ctx.fillRect(0, 0, 1, 1);
          const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
          if (a === 0) return null;
          return '#' + [r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('');
        };
        return [aHex(estilo.backgroundColor), aHex(raiz.color)];
      })()`,
    );
    if (fondo && simbolo) {
      mainWindow.setTitleBarOverlay({ color: fondo, symbolColor: simbolo, height: 35 });
      return { fondo, simbolo };
    }
  } catch {
    // si el renderer aún no está listo se queda el color por defecto
  }
  return null;
}

function createWindow() {
  // Sin menú nativo: la app tiene su propia barra de título.
  Menu.setApplicationMenu(null);

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#191a1c',
    icon: path.join(app.getAppPath(), 'assets', 'icon.ico'),
    show: true,
    titleBarStyle: 'hidden',
    // Los botones de ventana los dibuja el sistema (como el original): el color
    // se sincroniza con el tema en aplicarBarraDeTitulo().
    ...(process.platform === 'darwin' ? {} : { titleBarOverlay: { color: '#111114', symbolColor: '#eaebf1', height: 35 } }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Vista Browser del panel lateral: un <webview> con la partición persistente.
      webviewTag: true,
    },
  });

  /*
   * El webview lo crea el renderer con su propia partición; se fuerza aquí para
   * que ninguna página adjunte preload ni integración de Node.
   */
  mainWindow.webContents.on('will-attach-webview', (_event, webPreferences) => {
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    webPreferences.partition = 'persist:opengravity-browser';
  });

  /*
   * La ventana principal solo debe mostrar la interfaz de la app (app://).
   * Si la página navegara a un sitio externo, esa página recibiría el preload y
   * con él todos los canales IPC: escritura de ficheros, terminal, ajustes.
   * Los enlaces externos ya se abren fuera, así que aquí se bloquea el resto.
   */
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!String(url).startsWith('app://local/')) event.preventDefault();
  });

  // Nada de ventanas nuevas desde la interfaz: los enlaces van al navegador.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });

  mainWindow.loadURL('app://local/renderer/index.html');

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
    void aplicarBarraDeTitulo();
    setTimeout(() => void aplicarBarraDeTitulo(), 600);
    mainWindow.on('focus', () => void aplicarBarraDeTitulo());
    updater.configurar({
      onState: (estado) => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('updates:event', estado);
      },
    });
  });
  // Si ready-to-show tarda por carga de recursos, forzar show
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      mainWindow.show();
      mainWindow.focus();
    }
  }, 1000);
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------

/** Sincroniza los botones nativos con el tema ya aplicado en el renderer. */
ipcMain.handle('window:titlebar', async () => {
  const colores = await aplicarBarraDeTitulo();
  return { ok: true, ...(colores ?? {}) };
});

/** Estado inicial que necesita la UI para pintarse. */
ipcMain.handle('app:state', async () => {
  // No esperar a descubrir 22 proveedores para pintar la ventana. La UI pide
  // el catálogo en segundo plano con providers:list.
  const catalogo = catalogoProveedores.valor ?? [];

  const providers = catalogo.filter((entry) => entry.available).map((entry) => entry.id);
  const actual = catalogo.find((entry) => entry.id === state.providerId);
  const models = (actual?.models ?? []).map((model) => ({ id: model.id, name: model.name }));

  return {
    cwd: state.cwd,
    project: state.project,
    projects: [...state.projects].sort((a, b) => String(b.lastUsed).localeCompare(String(a.lastUsed))),
    providerId: state.providerId,
    model: state.model,
    remote: state.remote ?? null,
    providers,
    models: models.map((model) => ({ id: model.id, name: model.name })),
    sessionId: state.sessionId,
    busy: state.busy,
    userName: state.prefs.profile?.name?.trim() || os.userInfo().username,
  };
});

/** Actualizaciones desde GitHub Releases. */
ipcMain.handle('updates:state', () => updater.getState());
ipcMain.handle('updates:check', () => updater.check());
ipcMain.handle('updates:download', () => updater.download());
ipcMain.handle('updates:install', () => updater.install());
ipcMain.handle('updates:open-release', () => updater.openRelease());

/** Detecta el framework de tests del proyecto. */
ipcMain.handle('tests:detect', async () => testrunner.detectarFramework(state.cwd));

/** Ejecuta la suite de tests y devuelve el resumen ya parseado. */
ipcMain.handle('tests:run', async () => {
  const detectado = await testrunner.detectarFramework(state.cwd);
  if (!detectado) {
    return { ok: false, error: 'no se encontró cómo correr los tests en este proyecto' };
  }

  let salida;
  if (state.remote?.direct) {
    try {
      salida = await ejecutarComandoRemoto(detectado.comando, null, 60000);
    } catch (error) {
      salida = { content: `Error SSH: ${error instanceof Error ? error.message : String(error)}`, isError: true };
    }
  } else {
    const ejecutar = makeRunCommandTool(() => state.cwd, () => state.prefs);
    salida = await ejecutar.execute({
      command: detectado.comando,
      cwd: state.cwd,
      waitDurationSeconds: 10000,
      taskName: 'Test run',
    }, { sessionId: state.sessionId, turno: currentTurnKey });
  }

  const resumen = testrunner.parsearSalida(salida.content);
  const codigoDetectado = /exit code: (-?\d+)/.exec(salida.content);
  const codigo = codigoDetectado
    ? Number(codigoDetectado[1])
    : Number.isFinite(Number(salida.code))
      ? Number(salida.code)
      : null;
  const sigueEnSegundoPlano = /sigue en ejecución|CommandId:/i.test(salida.content);
  const bien = codigo === null || sigueEnSegundoPlano
    ? null
    : testrunner.exito(codigo, resumen);

  const resultado = {
    framework: detectado.nombre,
    comando: detectado.comando,
    resumen,
    bien,
    cuando: new Date().toISOString(),
    salida: resumen.reconocido ? undefined : salida.content.slice(0, 20000),
  };

  state.ultimosTests = resultado;
  mainWindow?.webContents.send('chat:event', { type: 'tests_result', ...resultado });
  return { ok: true, ...resultado };
});

/**
 * Catálogo de proveedores con disponibilidad y modelos.
 *
 * Cada proveedor se consulta en paralelo y con timeout propio: uno que no
 * responde no retrasa al resto. El resultado se cachea unos segundos para que
 * abrir Ajustes varias veces no repita 20 peticiones.
 */
let catalogoProveedores = { at: 0, valor: null };
const CATALOGO_TTL_MS = 20_000;

/** Texto corto y legible para la UI a partir del error de un proveedor. */
function resumirErrorProveedor(mensaje) {
  const texto = String(mensaje ?? '').trim();
  const json = texto.match(/\{[\s\S]*\}/);
  if (json) {
    try {
      const data = JSON.parse(json[0]);
      const detalle = data?.error?.message ?? data?.message;
      if (typeof detalle === 'string' && detalle.trim().length > 0) {
        return detalle.trim().slice(0, 160).replace(/[.\s]+$/, '');
      }
    } catch {
      // no era JSON: se recorta el texto tal cual
    }
  }
  return texto.replace(/^\[\w+\]\s*/, '').slice(0, 160).replace(/[.\s]+$/, '');
}

/** Invalida el catálogo cacheado (cambio de clave, URL o preferencias). */
function invalidarCatalogoProveedores() {
  catalogoProveedores = { at: 0, valor: null };
}

async function listarProveedores(force = false) {
  if (!force && catalogoProveedores.valor && Date.now() - catalogoProveedores.at < CATALOGO_TTL_MS) {
    return catalogoProveedores.valor;
  }

  const { createProvider, PROVIDER_CATALOG, soportaPensamiento } = await getEngine();
  const config = buildProviderConfig();

  const result = await Promise.all(
    PROVIDER_CATALOG.map(async (spec) => {
      let available = false;
      let models = [];
      let reason = null;

      const hasBaseUrl = !spec.custom || Boolean(config.baseUrls[spec.id]);
      const savedKey = config.apiKeys[spec.id];
      const envValue = spec.envKey ? process.env[spec.envKey] : null;

      // Los locales no necesitan clave; el resto sí (guardada o del entorno).
      const hasKey = spec.envKey === null && !spec.custom ? true : Boolean(savedKey || envValue);

      if (!hasBaseUrl) {
        reason = 'configura la URL del endpoint';
      } else if (!hasKey) {
        reason = spec.envKey ? `falta ${spec.envKey} o una clave guardada` : 'falta la clave de API';
      } else {
        try {
          const provider = createProvider(spec.id, config);
          const listed = await provider.listModels();
          models = listed.map((model) => {
            // La ventana que declara el proveedor se guarda: es el dato bueno
            // para el presupuesto de contexto y antes se descartaba aquí.
            recordarVentana(spec.id, model.id, model.contextWindow);
            return {
              id: model.id,
              name: model.name,
              thinking: soportaPensamiento(spec.kind, model.id, spec.id),
            };
          });
          available = models.length > 0;
          if (!available) reason = 'no reporta modelos';
        } catch (cause) {
          const mensaje = cause instanceof Error ? cause.message : String(cause);
          // Los errores de red de `fetch` no dicen nada útil al usuario.
          reason = /fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|socket hang up/i.test(mensaje)
            ? spec.local
              ? 'no está en marcha'
              : 'no se pudo conectar'
            : resumirErrorProveedor(mensaje);
        }
      }

      return {
        id: spec.id,
        label: spec.label,
        kind: spec.kind,
        local: Boolean(spec.local),
        custom: Boolean(spec.custom),
        selfHosted: Boolean(spec.selfHosted),
        envKey: spec.envKey,
        needsKey: spec.envKey !== null || Boolean(spec.custom) || Boolean(spec.selfHosted),
        hasKey,
        hasEnvKey: Boolean(envValue),
        note: spec.note ?? null,
        baseUrl: config.baseUrls[spec.id] ?? spec.baseUrl,
        available,
        models,
        reason,
      };
    }),
  );

  catalogoProveedores = { at: Date.now(), valor: result };
  return result;
}

ipcMain.handle('providers:list', async () => listarProveedores(false));

/** Fuerza una detección nueva, saltando la caché. */
ipcMain.handle('providers:refresh', async () => listarProveedores(true));

/** Lista de proyectos conocidos. */
ipcMain.handle('projects:list', async () => {
  return [...state.projects].sort((a, b) => String(b.lastUsed).localeCompare(String(a.lastUsed)));
});

/** Activa un proyecto conocido, sin diálogo. */
ipcMain.handle('project:select', async (_event, target) => {
  if (state.busy || cargandoSesion || revirtiendo) return { ok: false, error: 'espera a que el agente termine' };
  const cwd = path.resolve(String(target ?? ''));
  const proyecto = state.projects.find((p) => path.resolve(p.path) === cwd);
  if (!proyecto || !(await esDirectorio(cwd))) {
    return { ok: false, error: 'El proyecto ya no existe o no está registrado.' };
  }

  remoteProject.cerrar();
  if (state.remote?.direct) await sshfs.desmontar(state.remote.drive);
  state.remote = null;
  state.cwd = cwd;
  state.project = cwd;
  olvidarRaices();
  registrarRaiz(cwd);
  registrarProyecto(cwd);
  terminalCwd = null;
  await cerrarPlugins();
  await actualizarProyectoDeSesion(state.project);
  try {
    await saveSettings();
  } catch {
    // El estado ya es válido aunque falle el disco.
  }
  return { ok: true, cwd, project: state.project };
});

/** Desasocia la conversación de cualquier proyecto sin cambiar el workspace. */
ipcMain.handle('project:none', async () => {
  if (state.busy || cargandoSesion || revirtiendo) return { ok: false, error: 'espera a que el agente termine' };
  state.project = null;
  await actualizarProyectoDeSesion(null);
  try {
    await saveSettings();
  } catch {
    // best-effort: la UI ya refleja el cambio
  }
  return { ok: true, project: null, cwd: state.cwd };
});

/** Crea una carpeta nueva y la registra como proyecto. */
ipcMain.handle('project:create', async (_event, target) => {
  if (state.busy || cargandoSesion || revirtiendo) return { ok: false, error: 'espera a que el agente termine' };
  let cwd;
  if (process.env.OPENGRAVITY_TEST === '1' && typeof target === 'string' && target.trim()) {
    // Hook de verificación: solo existe en el modo de pruebas.
    cwd = path.resolve(target.trim());
  } else if (
    process.env.OPENGRAVITY_TEST === '1' &&
    typeof process.env.OPENGRAVITY_TEST_NEW_PROJECT === 'string' &&
    process.env.OPENGRAVITY_TEST_NEW_PROJECT.trim()
  ) {
    // Sustituye solo el diálogo nativo; el clic del menú sigue siendo real.
    cwd = path.resolve(process.env.OPENGRAVITY_TEST_NEW_PROJECT.trim());
  } else {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'New Project',
      buttonLabel: 'Create Project',
      defaultPath: path.join(app.getPath('documents'), 'New Project'),
      properties: ['createDirectory'],
    });
    if (result.canceled || !result.filePath) return null;
    cwd = path.resolve(result.filePath);
  }
  if (state.busy || cargandoSesion || revirtiendo) return { ok: false, error: 'espera a que el agente termine' };
  try {
    await fsp.mkdir(cwd, { recursive: false });
  } catch (error) {
    return { ok: false, error: `No se pudo crear el proyecto: ${error?.message ?? error}` };
  }

  remoteProject.cerrar();
  if (state.remote?.direct) await sshfs.desmontar(state.remote.drive);
  state.remote = null;
  state.cwd = cwd;
  state.project = cwd;
  olvidarRaices();
  registrarRaiz(cwd);
  registrarProyecto(cwd);
  terminalCwd = null;
  await cerrarPlugins();
  await actualizarProyectoDeSesion(state.project);
  try {
    await saveSettings();
  } catch {
    // best-effort
  }
  return { ok: true, cwd, project: state.project };
});

/** Quita un proyecto del selector; no borra su carpeta. */
ipcMain.handle('project:remove', async (_event, target) => {
  if (state.busy || cargandoSesion || revirtiendo) return { ok: false, error: 'espera a que el agente termine' };
  const cwd = path.resolve(String(target ?? ''));
  state.projects = state.projects.filter((p) => path.resolve(p.path) !== cwd);
  if (state.project === cwd) {
    state.project = null;
    await actualizarProyectoDeSesion(null);
  }
  try {
    await saveSettings();
  } catch {
    // best-effort
  }
  return { ok: true, project: state.project, projects: state.projects };
});

/** Abre un directorio como workspace. */
ipcMain.handle('workspace:open', async () => {
  if (state.busy || cargandoSesion || revirtiendo) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Abrir carpeta',
  });

  if (result.canceled || result.filePaths.length === 0) return null;
  if (state.busy || cargandoSesion || revirtiendo) {
    return { cwd: state.cwd, cancelled: true };
  }

  remoteProject.cerrar();
  if (state.remote?.direct) await sshfs.desmontar(state.remote.drive);
  state.remote = null;
  state.cwd = result.filePaths[0];
  state.project = state.cwd;
  olvidarRaices();
  registrarRaiz(state.cwd);
  registrarProyecto(state.cwd);
  terminalCwd = null;
  await actualizarProyectoDeSesion(state.project);
  // Los servidores MCP se arrancaron con el cwd anterior.
  await cerrarPlugins();

  // El workspace ya está activo en memoria: si falla el disco no se revierte,
  // pero el rechazo debe quedar consumido aquí (el renderer no lo captura).
  try {
    await saveSettings();
    return { cwd: state.cwd };
  } catch (err) {
    console.error(`[settings] no se pudieron guardar las preferencias: ${err?.message ?? err}`);
    return { cwd: state.cwd, settingsError: true };
  }
});

/** Cambia el workspace a una carpeta ya conocida (proyectos recientes). */
ipcMain.handle('workspace:set', async (_event, target) => {
  if (state.busy || cargandoSesion || revirtiendo) return { ok: false, error: 'espera a que el agente termine' };
  const cwd = path.resolve(String(target ?? ''));
  if (!(await esDirectorio(cwd))) {
    return { ok: false, error: 'La carpeta del proyecto ya no existe.' };
  }

  /*
   * El renderer solo puede activar proyectos que ya aparecen en el historial;
   * así este canal no sirve para autorizar una carpeta arbitraria sin diálogo.
   */
  const store = await getStore();
  const sesiones = await store.list();
  const conocido =
    cwd === path.resolve(state.cwd) ||
    sesiones.some((sesion) => sesion?.cwd && path.resolve(sesion.cwd) === cwd);
  if (!conocido) {
    return { ok: false, error: 'Ese proyecto no está en el historial. Ábrelo con New Project.' };
  }

  // Cambiar a un proyecto local no puede seguir ejecutando comandos en el SSH
  // del proyecto anterior.
  remoteProject.cerrar();
  if (state.remote?.direct) await sshfs.desmontar(state.remote.drive);
  state.remote = null;
  state.cwd = cwd;
  state.project = cwd;
  olvidarRaices();
  registrarRaiz(state.cwd);
  registrarProyecto(state.cwd);
  terminalCwd = null;
  await cerrarPlugins();
  await actualizarProyectoDeSesion(state.project);

  try {
    await saveSettings();
    return { ok: true, cwd: state.cwd, project: state.project, projects: state.projects };
  } catch (err) {
    console.error(`[settings] no se pudieron guardar las preferencias: ${err?.message ?? err}`);
    return { ok: true, cwd: state.cwd, project: state.project, projects: state.projects, settingsError: true };
  }
});

/** Abre el diálogo de selección de fichero. */
ipcMain.handle('dialog:open-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    title: 'Abrir fichero',
  });

  if (result.canceled || result.filePaths.length === 0) return null;
  // La carpeta del fichero elegido pasa a ser legible para el editor.
  registrarRaiz(path.dirname(result.filePaths[0]));
  return result.filePaths[0];
});

/** Abre el diálogo de selección de imagen. */
ipcMain.handle('dialog:open-image', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    title: 'Adjuntar imagen',
    filters: [{ name: 'Imágenes', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] }],
  });

  if (result.canceled || result.filePaths.length === 0) return null;
  // La carpeta del fichero elegido pasa a ser legible para el editor.
  registrarRaiz(path.dirname(result.filePaths[0]));
  return result.filePaths[0];
});

/** Ruta relativa al workspace. */
ipcMain.handle('fs:relative', (_event, target) => {
  if (!target) return '';
  return path.relative(state.cwd, target) || path.basename(target);
});

/** Lista un directorio del workspace. */
ipcMain.handle('fs:list', async (_event, dirPath) => {
  const target = rutaAutorizada(state.cwd, dirPath || '.');
  const entries = await fsp.readdir(target, { withFileTypes: true });

  return entries
    .filter((entry) => entry.name !== 'node_modules' && entry.name !== '.git')
    .map((entry) => ({
      name: entry.name,
      path: path.join(dirPath || '.', entry.name),
      isDirectory: entry.isDirectory(),
    }))
    .sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory) || a.name.localeCompare(b.name));
});

/** Lee un fichero del workspace. */
ipcMain.handle('fs:read', async (_event, filePath) => {
  const target = rutaAutorizada(state.cwd, filePath);
  const info = await fsp.stat(target);

  if (info.size > 2_000_000) {
    throw new Error(`fichero demasiado grande (${Math.round(info.size / 1024)} KB)`);
  }

  const content = await fsp.readFile(target, 'utf8');
  return { path: filePath, content };
});

/** Devuelve un fichero binario como data URL para el visor de audio/PDF. */
ipcMain.handle('fs:data-url', async (_event, filePath) => {
  const target = rutaAutorizada(state.cwd, filePath);
  const info = await fsp.stat(target);
  if (info.size > 50 * 1024 * 1024) {
    return { ok: false, error: `fichero demasiado grande (${Math.round(info.size / 1024 / 1024)} MB)` };
  }
  const mimes = {
    '.pdf': 'application/pdf', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
    '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.m4a': 'audio/mp4',
    '.aac': 'audio/aac', '.flac': 'audio/flac', '.webm': 'audio/webm',
  };
  const ext = path.extname(target).toLowerCase();
  const mime = mimes[ext];
  if (!mime) return { ok: false, error: 'formato de medio no soportado' };
  const buffer = await fsp.readFile(target);
  return { ok: true, url: `data:${mime};base64,${buffer.toString('base64')}`, mime };
});

/** Escribe un fichero del workspace (guardado del editor). */
ipcMain.handle('fs:write', async (_event, payload) => {
  const relative = String(payload?.path ?? '');
  const content = String(payload?.content ?? '');
  const absolute = rutaAutorizada(state.cwd, relative);

  await fsp.writeFile(absolute, content, 'utf8');
  scheduleIndexRefresh();
  return { ok: true, path: relative };
});

/** Índice de ficheros del workspace, acotado, para menciones y explorador. */
ipcMain.handle('fs:index', async () => {
  const IGNORED = new Set([
    'node_modules', '.git', 'dist', 'build', 'out', '.next', '.cache',
    'target', 'bin', 'obj', '.venv', 'venv', '__pycache__',
  ]);
  const MAX_FILES = 3000;

  const files = [];

  async function walk(directory, depth) {
    if (files.length >= MAX_FILES || depth > 8) return;

    let entries;
    try {
      entries = await fsp.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (files.length >= MAX_FILES) return;
      if (entry.name.startsWith('.') && entry.name !== '.env.example') continue;
      if (IGNORED.has(entry.name)) continue;

      const absolute = path.join(directory, entry.name);
      const relative = path.relative(state.cwd, absolute).split(path.sep).join('/');

      if (entry.isDirectory()) {
        await walk(absolute, depth + 1);
      } else if (entry.isFile()) {
        files.push(relative);
      }
    }
  }

  await walk(state.cwd, 0);
  return files.sort();
});

/** Cambia proveedor y/o modelo. */
ipcMain.handle('settings:set', async (_event, payload) => {
  if (payload && typeof payload.provider === 'string') {
    state.providerId = payload.provider;
    state.model = null;
  }
  if (payload && typeof payload.model === 'string') {
    state.model = payload.model;
  }
  // Fire-and-forget: la ventana real del modelo local, sin retrasar el ajuste.
  if (state.providerId === 'ollama') void recordarVentanaOllama(state.model);
  await saveSettings();
  return { providerId: state.providerId, model: state.model };
});

const MASCARA_SECRETO = '••••••••';

/** Lee las preferencias sin entregar secretos en claro al renderer. */
ipcMain.handle('prefs:get', async () => {
  const vista = { ...state.prefs };
  if (vista.apiKeys && typeof vista.apiKeys === 'object') {
    vista.apiKeys = Object.fromEntries(
      Object.entries(vista.apiKeys).map(([id, valor]) => [id, valor ? MASCARA_SECRETO : '']),
    );
  }
  if (typeof vista.remoteToken === 'string' && vista.remoteToken.length > 0) {
    vista.remoteToken = MASCARA_SECRETO;
  }
  return vista;
});
/** Actualiza preferencias (merge superficial) y las persiste. */
ipcMain.handle('prefs:set', async (_event, patchOriginal) => {
  const patch = patchOriginal && typeof patchOriginal === 'object' ? { ...patchOriginal } : patchOriginal;
  if (patch && typeof patch === 'object' && patch.apiKeys && typeof patch.apiKeys === 'object') {
    // La máscara no debe sobrescribir una clave real, y `null` la borra.
    const claves = { ...(state.prefs.apiKeys ?? {}) };
    for (const [id, valor] of Object.entries(patch.apiKeys)) {
      if (valor === null) delete claves[id];
      else if (typeof valor === 'string' && valor !== MASCARA_SECRETO) claves[id] = valor;
    }
    patch.apiKeys = claves;
  }
  if (patch && patch.remoteToken === MASCARA_SECRETO) delete patch.remoteToken;
  if (patch && typeof patch === 'object') {
    const cambiaElTema =
      'theme' in patch || 'themeContrast' in patch || 'accent' in patch;
    state.prefs = { ...state.prefs, ...patch };
    // Una clave o una URL nueva cambia qué proveedores responden.
    invalidarCatalogoProveedores();
    if ('lspServers' in patch || 'goRoot' in patch) {
      // El siguiente lspOpen debe usar el comando o la ruta nueva.
      for (const client of lspClients.values()) client.stop();
      lspClients.clear();
    }
    if ('plugins' in patch) await cerrarPlugins();
    await saveSettings();
    if (cambiaElTema) {
      // El renderer aplica los tokens al recibir las prefs; se espera un tick.
      setTimeout(() => void aplicarBarraDeTitulo(), 50);
    }
  }
  return state.prefs;
});

/** Borra una conversación. */
ipcMain.handle('sessions:delete', async (_event, id) => {
  if (state.busy || cargandoSesion || revirtiendo) return { ok: false, error: 'espera a que el agente termine' };
  const sessions = await getStore();
  await enColaTienda(() => sessions.delete(String(id)));
  await trayectoria.olvidarTrayectoria(String(id)).catch(() => {});
  for (let i = colaResultadosSubagentes.length - 1; i >= 0; i -= 1) {
    if (colaResultadosSubagentes[i]?.sessionId === String(id)) colaResultadosSubagentes.splice(i, 1);
  }
  return { ok: true };
});

// ---------------------------------------------------------------------------
// Controles de ventana
// ---------------------------------------------------------------------------

ipcMain.handle('window:minimize', () => {
  mainWindow?.minimize();
});

ipcMain.handle('window:toggle-maximize', async () => {
  if (!mainWindow) return false;

  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();

  // El cambio es asíncrono en Windows: espera al evento antes de responder.
  await new Promise((resolve) => setTimeout(resolve, 120));
  return mainWindow.isMaximized();
});

ipcMain.handle('window:close', () => {
  mainWindow?.close();
});

ipcMain.handle('window:toggle-devtools', () => {
  mainWindow?.webContents.toggleDevTools();
});

ipcMain.handle('window:zoom', (_event, delta) => {
  const contents = mainWindow?.webContents;
  if (!contents) return 0;
  if (delta === 0) contents.setZoomLevel(0);
  else contents.setZoomLevel(contents.getZoomLevel() + Number(delta));
  return contents.getZoomLevel();
});

/** Estado de la ventana: sirve para comprobar que sigue siendo redimensionable. */
ipcMain.handle('window:info', () => {
  if (!mainWindow) return null;
  return {
    resizable: mainWindow.isResizable(),
    maximizable: mainWindow.isMaximizable(),
    minimizable: mainWindow.isMinimizable(),
    isMaximized: mainWindow.isMaximized(),
    bounds: mainWindow.getBounds(),
  };
});

/** Redimensiona la ventana (solo para comprobaciones). */
ipcMain.handle('window:set-size', (_event, width, height) => {
  if (!mainWindow) return null;
  mainWindow.setSize(Math.round(width), Math.round(height));
  return mainWindow.getBounds();
});

ipcMain.handle('window:is-maximized', () => mainWindow?.isMaximized() ?? false);

/**
 * Conexión con la cuenta de Google.
 *
 * `generate_image` usa Flow, que necesita una sesión de Google. En vez de pedir
 * claves, se abre el navegador integrado para que el usuario inicie sesión una
 * vez: la partición `persist:opengravity-browser` conserva las cookies entre
 * arranques, así que después ya no hay que repetirlo.
 */
/**
 * Despertar reactivo.
 *
 * El blueprint de Antigravity insiste en que no debe haber polling: cuando una
 * tarea de fondo termina, el motor **despierta** al agente e inyecta el
 * resultado. Sin esto, el agente deja una tarea viva y solo se entera si se le
 * ocurre preguntar con `command_status` — si no, muere en el vacío.
 *
 * Si el turno sigue abierto, el resultado entra como nota de sistema en el
 * siguiente paso. Si ya terminó, se arranca un turno nuevo con el resultado.
 */
function alTerminarUnaTarea(tarea) {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  const salida = `${tarea.stdout ?? ''}${tarea.stderr ?? ''}`.trim();
  const recorte = salida.length > 4000 ? `${salida.slice(0, 4000)}\n[recortado]` : salida;
  const codigo = tarea.exitCode ?? 'desconocido';

  const texto =
    `[tarea terminada] «${tarea.nombre}» acabó con código ${codigo}.\n\n` +
    (recorte.length > 0 ? recorte : '(sin salida)');

  mainWindow.webContents.send('task:finished', {
    id: tarea.id,
    nombre: tarea.nombre,
    exitCode: tarea.exitCode,
    salida: recorte,
    sessionId: tarea.sessionId ?? null,
  });

  /*
   * Una tarea lanzada en otra conversación no puede despertar la actual. Se
   * descarta su nota; su salida sigue disponible con command_status.
   */
  if (tarea.sessionId && state.sessionId && tarea.sessionId !== state.sessionId) {
    return;
  }

  // Con el turno abierto, la nota entra en el siguiente paso del bucle.
  notaDeTareaPendiente = texto;

  // Con el turno cerrado, se despierta uno nuevo.
  if (!state.busy) {
    notaDeTareaPendiente = null;
    mainWindow.webContents.send('task:wake', {
      texto,
      sessionId: tarea.sessionId ?? state.sessionId ?? null,
    });
  }
}

/** Nota de una tarea que terminó mientras el turno seguía abierto. */
let notaDeTareaPendiente = null;

/**
 * Devuelve una imagen local como data URL para pintarla en el hilo.
 *
 * Las imágenes que genera Flow se sirven desde su dominio y necesitan la sesión
 * del navegador oculto: el hilo no la tiene, así que `<img src="https://…">`
 * sale roto. Se lee el fichero ya guardado y se entrega embebido.
 */
ipcMain.handle('image:as-data-url', async (_event, rutaRelativa) => {
  try {
    const absoluta = rutaAutorizada(state.cwd, rutaRelativa);
    const datos = await fsp.readFile(absoluta);

    const extension = path.extname(absoluta).toLowerCase();
    const tipo =
      extension === '.jpg' || extension === '.jpeg'
        ? 'image/jpeg'
        : extension === '.webp'
          ? 'image/webp'
          : extension === '.gif'
            ? 'image/gif'
            : 'image/png';

    return { ok: true, dataUrl: `data:${tipo};base64,${datos.toString('base64')}` };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
});

/**
 * Genera una imagen con Flow.
 *
 * Vive aquí y no solo en el agente para poder probarlo aislado: cuando el agente
 * se atasca en un bucle, esta llamada sigue diciendo si Flow funciona o no.
 */
ipcMain.handle('image:generate', async (_event, payload) => {
  try {
    const { generarEnFlow, URL_FLOW, cuentaGoogleConectada, errorDeLogin } = require('./flow.cjs');

    const prompt = String(payload?.prompt ?? '').trim();
    if (prompt.length === 0) return { ok: false, error: 'falta el prompt' };

    const cuenta = await cuentaGoogleConectada();
    if (!cuenta.conectada) return { ok: false, error: errorDeLogin() };

    let navegador = require('./tools-extra.cjs').navegadorIntegrado(true);
    if (!navegador) {
      openBuiltInBrowser(URL_FLOW, { oculto: true, flow: true });
      await new Promise((r) => setTimeout(r, 8000));
      navegador = require('./tools-extra.cjs').navegadorIntegrado(true);
    }
    if (!navegador) return { ok: false, error: 'no se pudo abrir el navegador integrado' };

    const destino = payload?.path ? rutaAutorizada(state.cwd, String(payload.path)) : null;

    return await generarEnFlow(navegador, {
      prompt,
      destino,
      aspectRatio: payload?.aspectRatio,
    });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('google:status', async () => {
  return require('./flow.cjs').cuentaGoogleConectada();
});

/** Abre el navegador integrado en Flow; si no hay sesión, Flow pide el login. */
ipcMain.handle('google:connect', async () => {
  const { openBuiltInBrowser } = require('./tools-extra.cjs');
  try {
    await openBuiltInBrowser('https://accounts.google.com/ServiceLogin?continue=https://flow.google.com/', { flow: true });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
});

/** Cierra la sesión de Google borrando las cookies de esa partición. */
ipcMain.handle('google:disconnect', async () => {
  const { session } = require('electron');
  try {
    const sesion = session.fromPartition('persist:opengravity-flow');
    await sesion.clearStorageData({ storages: ['cookies'] });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
});

/** Herramienta: enviar un mensaje a un subagente vivo. */
function makeSendMessageTool() {
  return {
    name: 'send_message',
    description:
      'Envía un mensaje a un subagente que está trabajando, para corregirle el rumbo sin ' +
      'matarlo ni relanzarlo. Llega a su conversación entre pasos. Usa `@children` para ' +
      'difundir a todos los que estén corriendo.',
    parameters: {
      type: 'object',
      properties: {
        recipientId: {
          type: 'string',
          description: 'Id del subagente (por ejemplo `sub-3`), o `@children` para todos.',
        },
        message: { type: 'string', description: 'Qué quieres decirle.' },
      },
      required: ['recipientId', 'message'],
    },
    async execute(args) {
      const entregados = subagentes.enviarMensaje(
        String(args.recipientId ?? '@children'),
        String(args.message ?? ''),
      );

      if (entregados === 0) {
        const vivos = subagentes.listarEnEjecucion();
        return {
          content:
            vivos.length === 0
              ? 'No hay ningún subagente corriendo ahora mismo.'
              : `No encontré ese destinatario. Vivos: ${vivos.map((v) => `${v.id} (${v.nombre})`).join(', ')}.`,
          isError: true,
        };
      }

      return { content: `Mensaje entregado a ${entregados} subagente(s).` };
    },
  };
}

/** Herramientas disponibles con su permiso efectivo. */
ipcMain.handle('tools:list', async () => {
  const { fileSystemTools } = await getEngine();
  const all = [
    ...fileSystemTools,
    makeSearchFilesTool(() => state.cwd),
    makeFileSearchTool(() => state.cwd),
    makeCodeSearchTool(codeIndex, () => state.cwd),
    makeEditFileTool(() => state.cwd),
    makeMultiReplaceTool(() => state.cwd),
    makeEditNotebookTool(() => state.cwd),
    makeGenerateImageTool(() => state.cwd),
    ...(state.remote?.direct ? [makeRemoteCommandTool()] : [makeRunCommandTool(() => state.cwd, () => state.prefs)]),
    makeCommandStatusTool(),
    makeManageTaskTool(),
    makeSearchWebTool(() => state.prefs),
    makeViewCodeItemTool(() => state.cwd),
    makeMemoryTool(getMemoria(), () => state.cwd),
    makeSkillTool(() => descubrirSkills(state.cwd)),
    makeRunWorkflowTool(() => state.cwd, (a, c) => makeRunCommandTool(() => state.cwd, () => state.prefs).execute(a, c)),
    makeRunExtensionCodeTool(() => state.cwd, (a, c) => makeRunCommandTool(() => state.cwd, () => state.prefs).execute(a, c)),
    ...makeBrowserTools(() => state.prefs, (message, detail) =>
      askPermission(mainWindow, message, detail),
    ),
    makeFetchUrlTool(() => state.prefs),
    makeOpenUrlTool(() => state.prefs),
  ];

  // Las dos que tienen flujo propio también aparecen en Ajustes.
  all.push(
    {
      name: 'present_plan',
      description: 'Presenta un plan de pasos y espera la aprobación del usuario.',
    },
    {
      name: 'ask_user_question',
      description: 'Hace preguntas al usuario con opciones y espera su respuesta.',
    },
    {
      name: 'browser_task',
      description: 'Delega una tarea de navegación a un subagente con su propio contexto.',
    },
    {
      name: 'enter_plan_mode',
      description: 'Devuelve el control al planificador con un informe de estado.',
    },
    makeSendMessageTool(),
  {
    name: 'invoke_subagent',
      description: 'Lanza varios subagentes en paralelo, cada uno con su propio contexto.',
    },
    {
      name: 'notify_user',
      description: 'Programa un aviso para más tarde, una vez o repetido con una expresión cron.',
    },
    {
      name: 'define_subagent',
      description: 'Guarda un subagente reutilizable con nombre, rol y system prompt propio.',
    },
    {
      name: 'manage_subagent',
      description: 'Lista o cancela los subagentes en ejecución.',
    },
    {
      name: 'run_tests',
      description: 'Ejecuta la suite de tests del proyecto y devuelve un resumen.',
    },
  );

  return all.map((tool) => ({
    name: tool.name,
    description: tool.description,
    permission: state.prefs.toolPermissions?.[tool.name] ?? 'inherit',
  }));
});

/** Catálogo de skills con su estado. */
ipcMain.handle('skills:list', async () => {
  const enabled = state.prefs.skills ?? {};

  // Skills del proyecto, leídas del disco.
  let delProyecto = [];
  try {
    delProyecto = await descubrirSkills(state.cwd);
  } catch {
    delProyecto = [];
  }

  const fijas = SKILL_CATALOG.map((skill) => ({
    id: skill.id,
    name: skill.name,
    description: skill.description,
    enabled: enabled[skill.id] === true,
    source: 'app',
  }));

  const disco = delProyecto.map((skill) => ({
    id: skill.name,
    name: skill.name,
    description: skill.description || skill.relative,
    enabled: true,
    source: 'workspace',
    relative: skill.relative,
  }));

  return [...disco, ...fijas];
});

/** Perfil local. */
ipcMain.handle('profile:get', async () => state.prefs.profile ?? { name: '', email: '' });

/** Historial de descargas de esta sesión. */
ipcMain.handle('downloads:list', async () => descargas);
ipcMain.handle('downloads:open', async (_event, id) => {
  const entrada = descargas.find((d) => d.id === String(id));
  if (!entrada) return { ok: false, error: 'descarga no encontrada' };
  shell.showItemInFolder(entrada.path);
  return { ok: true };
});

/** Carpeta de descargas del navegador integrado. */
ipcMain.handle('app:downloads-dir', async () => ({
  path: state.prefs.downloadPath || app.getPath('downloads'),
}));

/** Elige y guarda una carpeta de descargas nueva. */
ipcMain.handle('app:choose-download-dir', async () => {
  const resultado = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory'],
  });
  if (resultado.canceled || !resultado.filePaths[0]) return { ok: false };

  state.prefs = { ...state.prefs, downloadPath: resultado.filePaths[0] };
  await saveSettings();
  return { ok: true, path: resultado.filePaths[0] };
});

/**
 * Borra el historial del navegador integrado.
 *
 * Solo hay caché y navegación de la sesión persistente: no se guardan URLs
 * visitadas en disco. El renderer limpia además el historial del webview.
 */
ipcMain.handle('browser:clear-history', async () => {
  const { session } = require('electron');
  try {
    await Promise.all([
      session.fromPartition('persist:opengravity-browser').clearCache(),
      session.fromPartition('persist:opengravity-agent-browser').clearCache(),
      session.fromPartition('persist:opengravity-flow').clearCache(),
    ]);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
});

/** Abre una URL en el navegador del sistema. */
ipcMain.handle('shell:open-external', async (_event, url) => {
  const verdict = isUrlAllowed(String(url), state.prefs.networkRules);
  if (!verdict.allowed) return { ok: false, error: verdict.reason };
  const publica = await validarUrlPublica(String(url));
  if (!publica.ok) return { ok: false, error: publica.error };
  await shell.openExternal(String(url));
  return { ok: true };
});

/** Abre una URL en el navegador integrado. */
ipcMain.handle('browser:open', async (_event, url) => {
  const verdict = isUrlAllowed(String(url), state.prefs.networkRules);
  if (!verdict.allowed) return { ok: false, error: verdict.reason };
  const publica = await validarUrlPublica(String(url));
  if (!publica.ok) return { ok: false, error: publica.error };
  await openBuiltInBrowser(String(url));
  return { ok: true };
});

/** Ejecuta JavaScript en el navegador integrado (sujeto a política). */
ipcMain.handle('browser:evaluate', async (_event, script) => {
  return browserEvaluate(String(script), state.prefs, (message, detail) =>
    askPermission(mainWindow, message, detail),
  );
});

// ---------------------------------------------------------------------------
// Control remoto
// ---------------------------------------------------------------------------

/** Servidor HTTP de control remoto, cuando está activo. */
let remoteServer = null;
let remoteInfo = null;

function stopRemote() {
  return new Promise((resolve) => {
    if (!remoteServer) {
      remoteInfo = null;
      resolve();
      return;
    }
    remoteServer.close(() => {
      remoteServer = null;
      remoteInfo = null;
      resolve();
    });
  });
}

/**
 * Levanta un servidor HTTP local que permite enviar prompts desde fuera.
 *
 *   POST /prompt   { "text": "...", "token": "..." }
 *   GET  /status   → { ok, url, hasToken }
 */
/**
 * Compara el token recibido con el esperado en tiempo constante.
 *
 * `a !== b` termina en el primer byte distinto: con suficientes intentos se
 * puede reconstruir el token carácter a carácter midiendo lo que tarda.
 */
function mismoToken(recibido, esperado) {
  const a = Buffer.from(String(recibido ?? ''), 'utf8');
  const b = Buffer.from(String(esperado ?? ''), 'utf8');
  if (a.length !== b.length) return false;

  let diferencia = 0;
  for (let i = 0; i < a.length; i += 1) diferencia |= a[i] ^ b[i];
  return diferencia === 0;
}

async function startRemote() {
  if (remoteServer) return remoteInfo;

  const port = Number(state.prefs.remotePort ?? 4789);
  /*
   * Sin token, cualquiera que llegue a 127.0.0.1 podría lanzar prompts al agente
   * (el renderer los envía solo, sin confirmación). Si el usuario no ha puesto
   * uno, se genera y se guarda en vez de arrancar el servidor abierto.
   */
  let token = String(state.prefs.remoteToken ?? '').trim();
  if (token.length === 0) {
    token = require('node:crypto').randomBytes(24).toString('hex');
    state.prefs = { ...state.prefs, remoteToken: token };
    await saveSettings();
  }

  remoteServer = http.createServer((req, res) => {
    const send = (code, payload) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(payload));
    };

    if (req.method === 'GET' && req.url === '/status') {
      send(200, { ok: true, url: remoteInfo?.url ?? null, hasToken: token.length > 0 });
      return;
    }

    if (req.method !== 'POST' || req.url !== '/prompt') {
      send(404, { ok: false, error: 'ruta no encontrada' });
      return;
    }

    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 100_000) req.destroy();
    });

    req.on('end', () => {
      let payload;
      try {
        payload = JSON.parse(body);
      } catch {
        send(400, { ok: false, error: 'JSON no válido' });
        return;
      }

      if (!mismoToken(payload.token, token)) {
        send(401, { ok: false, error: 'token incorrecto' });
        return;
      }

      const text = String(payload.text ?? '').trim();
      if (text.length === 0) {
        send(400, { ok: false, error: 'falta el campo text' });
        return;
      }

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('remote:prompt', text);
      }

      send(200, { ok: true, accepted: true });
    });
  });

  await new Promise((resolve, reject) => {
    remoteServer.once('error', reject);
    remoteServer.listen(port, '127.0.0.1', resolve);
  });

  remoteInfo = { url: `http://127.0.0.1:${port}`, hasToken: token.length > 0 };
  return remoteInfo;
}

ipcMain.handle('remote:status', async () => ({
  running: remoteServer !== null,
  url: remoteInfo?.url ?? null,
  hasToken: String(state.prefs.remoteToken ?? '').trim().length > 0,
  port: Number(state.prefs.remotePort ?? 4789),
}));

ipcMain.handle('remote:start', async () => {
  try {
    const info = await startRemote();
    return { ok: true, ...info };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('remote:stop', async () => {
  await stopRemote();
  return { ok: true };
});

/** Lista sesiones guardadas. */
/** Exporta una conversación a Markdown en el disco. */
ipcMain.handle('sessions:export', async (_event, id) => {
  const sessions = await getStore();
  const session = await sessions.load(id);

  const lines = [`# ${session.meta.title}`, ''];
  for (const message of session.messages) {
    const who = message.role === 'user' ? 'Usuario' : message.role === 'assistant' ? 'Agente' : message.role;
    lines.push(`## ${who}`, '');
    const content = Array.isArray(message.content)
      ? message.content.map((part) => (part.type === 'text' ? part.text : `[${part.type}]`)).join('\n')
      : String(message.content ?? '');
    lines.push(content, '');
  }

  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Exportar conversación',
    defaultPath: `${session.meta.title.replace(/[^\w\s-]/g, '').trim() || 'conversacion'}.md`,
    filters: [{ name: 'Markdown', extensions: ['md'] }],
  });

  if (result.canceled || !result.filePath) return { ok: false };
  await fsp.writeFile(result.filePath, lines.join('\n'), 'utf8');

  /*
   * Trayectoria junto al Markdown: sin servidor propio no hay «compartir» con
   * un enlace, pero el receptor puede ver qué tocó cada paso. Es el
   * `ShareTrajectoryByUser` del original resuelto como fichero autocontenido.
   */
  let trayectoriaExportada = null;
  try {
    await trayectoria.asegurar(id);
    const ruta = trayectoria.rutaDeTrayectoria(id);
    if (ruta) {
      const destino = result.filePath.replace(/\.md$/i, '') + '.trajectory.json';
      await fsp.copyFile(ruta, destino);
      trayectoriaExportada = destino;
    }
  } catch {
    // sin trayectoria se exporta solo la conversación
  }

  return { ok: true, path: result.filePath, trajectory: trayectoriaExportada };
});

/** Renombra una conversación. */
ipcMain.handle('sessions:rename', async (_event, id, title) => {
  titulosManuales.add(String(id));
  const sessions = await getStore();
  try {
    await enColaTienda(() => sessions.rename(id, String(title ?? '').slice(0, 120)));
  } catch (error) {
    // Si no se guardó, el título automático puede seguir gestionando la sesión.
    titulosManuales.delete(String(id));
    throw error;
  }
  return { ok: true };
});

/**
 * Borra las conversaciones más antiguas que la retención configurada.
 * `retentionDays` puede ser «Nunca», que desactiva la limpieza.
 */
async function applyRetention() {
  const pref = state.prefs.retentionDays ?? '30';
  if (String(pref) === 'Nunca') return { ok: true, removed: 0, skipped: true };

  const days = Number(pref);
  if (!Number.isFinite(days) || days <= 0) return { ok: true, removed: 0, skipped: true };

  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const sessions = await getStore();
  const all = await sessions.list();

  let removed = 0;

  for (const meta of all) {
    const when = new Date(meta.updatedAt ?? meta.createdAt ?? 0).getTime();
    if (!Number.isFinite(when) || when >= cutoff) continue;

    // La conversación abierta no se toca.
    if (meta.id === state.sessionId) continue;

    try {
      await enColaTienda(() => sessions.delete(meta.id));
      await trayectoria.olvidarTrayectoria(meta.id).catch(() => {});
      removed += 1;
    } catch {
      // si una falla, se sigue con el resto
    }
  }

  return { ok: true, removed, days };
}

/** Apaga los cron no-daemon creados por el agente en el turno que termina. */
async function cerrarTareasAgenteDelTurno() {
  if (tareasAgenteDelTurno.size === 0) return;
  const ids = new Set(tareasAgenteDelTurno);
  tareasAgenteDelTurno = new Set();
  await mutarScheduled((tareas) => {
    let changed = false;
    for (const tarea of tareas) {
      if (!ids.has(tarea.id)) continue;
      if (tarea.createdBy === 'agent' && tarea.mode === 'cron' && tarea.isDaemon !== true) {
        tarea.enabled = false;
        changed = true;
      }
    }
    return { escribir: changed, resultado: null };
  }).catch(() => {});
}

/** Aplica la retención ahora y devuelve cuántas se borraron. */
ipcMain.handle('sessions:apply-retention', async () => applyRetention());

ipcMain.handle('sessions:list', async () => {
  const sessions = await getStore();
  return sessions.list();
});

/** Empieza una conversación nueva de verdad: resetea el hilo del motor. */
ipcMain.handle('sessions:new', async () => {
  if (state.busy || cargandoSesion || revirtiendo) return { ok: false, error: 'el agente está trabajando' };
  resetSessionState(state, turnCheckpoints, cambiosDelTurno);
  currentTurnKey = null;
  return { ok: true };
});

/** Carga una sesión en el estado actual. */
ipcMain.handle('sessions:load', async (_event, id) => {
  if (state.busy) return { ok: false, error: 'el agente está trabajando' };
  if (cargandoSesion || revirtiendo) return { ok: false, error: 'ya se está cargando otra conversación' };
  cargandoSesion = true;
  try {
    const sessions = await getStore();
    const loaded = await sessions.load(id);

    // Cargar otra conversación no puede heredar sus checkpoints ni su tarjeta de
    // revisión: un revert posterior desharía ficheros de la sesión anterior.
    resetSessionState(state, turnCheckpoints, cambiosDelTurno);
    currentTurnKey = null;

    // Si la conversación es local, no heredar el modo remoto de la anterior.
    const cwdCargado = String(loaded.meta.cwd ?? '');
    const esRemota = cwdCargado.includes(`${path.sep}remote-workspaces${path.sep}`);
    if (state.remote && !esRemota) {
      remoteProject.cerrar();
      if (state.remote.direct) await sshfs.desmontar(state.remote.drive);
      state.remote = null;
    }

    state.sessionId = loaded.meta.id;
    state.messages = loaded.messages;
    state.providerId = loaded.meta.provider;
    state.model = loaded.meta.model;

    // La conversación puede traer su propio workspace. Si ya no existe, no se
    // arrastra la ruta fantasma a los siguientes turnos.
    const cwdAnterior = state.cwd;
    if (typeof loaded.meta.cwd === 'string' && (await esDirectorio(loaded.meta.cwd))) {
      state.cwd = loaded.meta.cwd;
      if (path.resolve(state.cwd) !== path.resolve(cwdAnterior)) olvidarRaices();
      registrarRaiz(state.cwd);
    } else if (!(await esDirectorio(state.cwd))) {
      state.cwd = cwdInicial();
      olvidarRaices();
      registrarRaiz(state.cwd);
    }

    /*
     * Sesiones anteriores a `project` se agrupan bajo su cwd, que es lo que la
     * interfaz mostraba antes. Las nuevas guardan null explícito para No Project.
     */
    const proyectoCargado = 'project' in loaded.meta ? loaded.meta.project : loaded.meta.cwd;
    state.project =
      typeof proyectoCargado === 'string' && (await esDirectorio(proyectoCargado))
        ? path.resolve(proyectoCargado)
        : null;
    if (state.project) registrarProyecto(state.project);

    // Cargar el historial debe cargar también sus snapshots. Si no, el primer
    // paso nuevo escribe una trayectoria vacía y borra el undo anterior.
    try {
      await trayectoria.asegurar(loaded.meta.id);
    } catch {
      // sin trayectoria se sigue, pero no se debe escribir una vacía
    }

    return { meta: loaded.meta, project: state.project, messages: loaded.messages };
  } finally {
    cargandoSesion = false;
  }
});

/// Control de cancelación de la ejecución en curso.
let currentAbort = null;
let abortSolicitado = false;

/**
 * Deshace hasta el mensaje indicado: trunca el historial y reescribe la sesión.
 * Equivale al botón «Undo to this point» de Antigravity.
 */
// ---------------------------------------------------------------------------
// Tareas programadas
// ---------------------------------------------------------------------------

/** Ruta del fichero de tareas programadas. */
function scheduledPath() {
  return path.join(app.getPath('userData'), 'scheduled.json');
}

/** Lee las tareas programadas del disco. */
async function readScheduled() {
  try {
    const raw = await fsp.readFile(scheduledPath(), 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Guarda las tareas programadas. */
async function writeScheduled(tasks) {
  // Atómico y en cola: el tick del minuto y el guardado del usuario escriben el
  // mismo fichero, y con writeFile directo el último ganaba con datos viejos.
  await guardarEnCola(scheduledPath(), tasks);
}

/**
 * Lee, muta y guarda las tareas programadas en una sola operación serializada.
 *
 * Sin esto, dos writers (el tick y un guardado del usuario) leen la misma lista
 * y el segundo escribe su copia vieja: la tarea nueva desaparece. `mutar`
 * devuelve `{ escribir, resultado }`.
 */
function mutarScheduled(mutar) {
  return serializar(async () => {
    const tareas = await readScheduled();
    const salida = await mutar(tareas);
    if (!salida || salida.escribir !== false) {
      await escribirAtomico(scheduledPath(), tareas);
    }
    return salida?.resultado;
  });
}

/** Lista las tareas programadas. */
ipcMain.handle('scheduled:list', async () => {
  const tasks = await readScheduled();
  return tasks.map((task) => ({
    ...task,
    due: task.enabled !== false && new Date(task.nextRunAt ?? 0).getTime() <= Date.now(),
  }));
});

/** Crea o actualiza una tarea programada. */
ipcMain.handle('scheduled:save', async (_event, task) => {
  const id = task.id ?? `t${Date.now().toString(36)}`;

  const modo = task.mode === 'once' || task.mode === 'cron' ? task.mode : 'interval';

  let nextRunAt = task.nextRunAt ?? new Date().toISOString();

  if (modo === 'once' && task.at) {
    nextRunAt = new Date(task.at).toISOString();
  } else if (modo === 'cron' && task.cron) {
    try {
      const proxima = siguienteEjecucion(compilarCron(task.cron));
      if (!proxima) return { ok: false, error: 'la expresión cron no tiene próxima ejecución' };
      nextRunAt = proxima.toISOString();
    } catch {
      return { ok: false, error: 'expresión cron inválida' };
    }
  }

  const next = {
    id,
    prompt: String(task.prompt ?? '').slice(0, 4000),
    mode: modo,
    every: Math.max(1, Math.floor(Number(task.every ?? 60))),
    unit: task.unit === 'hours' ? 'hours' : 'minutes',
    cron: modo === 'cron' ? String(task.cron ?? '') : null,
    at: modo === 'once' ? String(task.at ?? '') : null,
    maxTriggers: Number.isFinite(Number(task.maxTriggers)) ? Number(task.maxTriggers) : null,
    triggers: Number(task.triggers ?? 0),
    createdBy: task.createdBy === 'agent' ? 'agent' : 'user',
    isDaemon: task.isDaemon === true,
    enabled: task.enabled !== false,
    nextRunAt,
    lastRunAt: task.lastRunAt ?? null,
  };

  return mutarScheduled((tasks) => {
    const index = tasks.findIndex((entry) => entry.id === id);
    if (index >= 0) tasks[index] = { ...tasks[index], ...next };
    else tasks.push(next);
    return { resultado: { ok: true, id } };
  });
});

/** Borra una tarea programada. */
ipcMain.handle('scheduled:delete', async (_event, id) => {
  return mutarScheduled((tasks) => {
    const sobran = tasks.filter((task) => task.id !== id);
    tasks.length = 0;
    tasks.push(...sobran);
    return { resultado: { ok: true } };
  });
});

/** Activa o desactiva una tarea. */
ipcMain.handle('scheduled:toggle', async (_event, id, enabled) => {
  return mutarScheduled((tasks) => {
    const found = tasks.find((task) => task.id === id);
    if (!found) return { escribir: false, resultado: { ok: true } };
    found.enabled = Boolean(enabled);
    return { resultado: { ok: true } };
  });
});

/** Ejecuta ahora una tarea, sin esperar a su hora. */
ipcMain.handle('scheduled:run', async (_event, id) => {
  const tasks = await readScheduled();
  const found = tasks.find((task) => task.id === id);
  if (!found) return { ok: false, error: 'tarea no encontrada' };

  mainWindow?.webContents.send('scheduled:fire', { id: found.id, prompt: found.prompt });
  return { ok: true };
});

/** Cancela los avisos únicos marcados con cancelOn "any". */
async function cancelarAvisosPendientes() {
  return mutarScheduled((tareas) => {
    let cambiado = false;

    for (const tarea of tareas) {
      if (tarea.mode !== 'once') continue;
      if (tarea.enabled === false) continue;
      if (tarea.cancelOn !== 'any') continue;

      tarea.enabled = false;
      tarea.canceladoEn = new Date().toISOString();
      cambiado = true;
    }

    return { escribir: cambiado, resultado: cambiado };
  });
}

/** Comprueba cada minuto si hay tareas vencidas. */
function startScheduler() {
  setInterval(async () => {
    if (state.busy) return;

    const disparos = [];
    // Tick y guardado comparten el mismo candado que la UI: leer fuera de él
    // resucitaba tareas borradas o perdía tareas nuevas.
    await mutarScheduled((tasks) => {
      let changed = false;

    for (const task of tasks) {
      if (task.enabled === false) continue;
      if (new Date(task.nextRunAt ?? 0).getTime() > Date.now()) continue;

      task.lastRunAt = new Date().toISOString();
      task.triggers = Number(task.triggers ?? 0) + 1;

      /*
       * Historial de ejecuciones, como el suyo («Runs show up here»).
       * Se guardan las últimas 20 para no engordar el fichero.
       */
      if (!Array.isArray(task.runs)) task.runs = [];
      task.runs.push({ at: task.lastRunAt, ok: true });
      if (task.runs.length > 20) task.runs = task.runs.slice(-20);

      changed = true;

      // Un aviso de una sola vez se apaga al dispararse.
      if (task.mode === 'once') {
        task.enabled = false;
      } else if (task.mode === 'cron' && task.cron) {
        try {
          const proxima = siguienteEjecucion(compilarCron(task.cron));
          if (!proxima) {
            task.enabled = false;
            continue;
          }
          const base = proxima;
          // El jitter dispersa el disparo para que varias tareas de la misma hora no
          // salgan todas en el mismo segundo.
          const dispersion = Number(task.jitterSeconds ?? 0);
          if (dispersion > 0) base.setSeconds(base.getSeconds() + Math.floor(Math.random() * dispersion));
          task.nextRunAt = base.toISOString();
        } catch {
          task.enabled = false;
        }
      } else {
        const step = (task.unit === 'hours' ? 3600000 : 60000) * Number(task.every ?? 60);
        task.nextRunAt = new Date(Date.now() + step).toISOString();
      }

      // Tope de disparos: se apaga al llegar.
      if (Number.isFinite(task.maxTriggers) && task.maxTriggers !== null) {
        if (task.triggers >= Number(task.maxTriggers)) task.enabled = false;
      }

      disparos.push({ id: task.id, prompt: task.prompt });
    }

      return { escribir: changed, resultado: null };
    });

    for (const disparo of disparos) {
      mainWindow?.webContents.send('scheduled:fire', disparo);
    }
  }, 60000).unref?.();
}

/**
 * Cambios del turno en curso: cuántos ficheros se tocaron y cuántas líneas se
 * añadieron y quitaron. Se compara el snapshot del checkpoint con el contenido
 * actual, así que vale tanto si hubo tarjeta de diff como si no.
 */
ipcMain.handle('chat:turn-changes', async () => {
  if (cambiosDelTurno.length === 0) {
    return { files: 0, additions: 0, removals: 0, paths: [] };
  }

  const { diffLines } = require('./diff.cjs');
  let additions = 0;
  let removals = 0;
  const paths = [];
  const entries = [];

  for (const { absolute, original } of cambiosDelTurno) {
    let actual = '';
    try {
      actual = await fsp.readFile(absolute, 'utf8');
    } catch {
      actual = '';
    }

    const antes = original ?? '';
    if (antes === actual) continue;

    const stats = diffLines(antes, actual);
    const suma = stats.additions ?? 0;
    const resta = stats.removals ?? 0;
    additions += suma;
    removals += resta;
    const ruta = path.relative(state.cwd, absolute) || absolute;
    paths.push(ruta);
    entries.push({ path: ruta, additions: suma, removals: resta });
  }

  return { files: paths.length, additions, removals, paths, entries };
});

/** Vista previa de lo que deshará `chat:revert`. */
ipcMain.handle('chat:revert-preview', async (_event, keepCount) => {
  const keep = Math.max(0, Math.floor(Number(keepCount)));

  const keys = [...turnCheckpoints.keys()]
    .filter((key) => key >= keep)
    .sort((a, b) => b - a);

  const files = new Map();

  for (const key of keys) {
    const snapshot = turnCheckpoints.get(key);
    if (!snapshot) continue;

    for (const [absolute, original] of snapshot) {
      // Gana el snapshot más antiguo: es el estado al que se vuelve.
      files.set(absolute, {
        path: path.relative(state.cwd, absolute) || path.basename(absolute),
        action: original === null ? 'delete' : 'restore',
      });
    }
  }

  /*
   * Si no hay checkpoints en memoria —el caso normal tras reiniciar la app— se
   * consulta la trayectoria persistida. Antes el preview devolvía una lista de
   * ficheros vacía tras reiniciar aunque la trayectoria estuviera en disco, así
   * que el usuario veía «no hay nada que deshacer» cuando sí lo había.
   */
  if (files.size === 0 && state.sessionId) {
    try {
      await trayectoria.asegurar(state.sessionId);
      const plan = trayectoria.planDeReversionPorMensaje(state.sessionId, keep);
      if (plan.ok) {
        for (const cambio of plan.cambios ?? []) {
          files.set(cambio.ruta, {
            path: path.relative(state.cwd, cambio.ruta) || path.basename(cambio.ruta),
            action: cambio.accion === 'borrar' ? 'delete' : 'restore',
          });
        }
      }
    } catch {
      // Sin trayectoria: se queda la lista vacía.
    }
  }

  return {
    ok: true,
    messages: state.messages.length - keep,
    files: [...files.values()],
  };
});

ipcMain.handle('chat:revert', async (_event, keepCount) => {
  if (state.busy || cargandoSesion || revirtiendo) {
    return { ok: false, error: 'espera a que el agente termine' };
  }

  // Capturar la sesión al empezar: si cambia durante el revert, el truncado
  // no puede aplicarse a la conversación nueva.
  const sessionId = state.sessionId;
  const mensajes = state.messages;

  revirtiendo = true;
  try {
    const keep = Math.max(0, Math.floor(Number(keepCount)));
    const resultado = await restoreCheckpoints(keep);

    if (resultado.failures.length > 0) {
      return {
        ok: false,
        error: `No se pudieron restaurar ${resultado.failures.length} fichero(s). No se recortó la conversación.`,
        restoredFiles: resultado.restored,
        failures: resultado.failures,
      };
    }

    if (state.sessionId !== sessionId) {
      return { ok: false, error: 'la conversación cambió durante el revert' };
    }
    state.messages = mensajes.slice(0, keep);

    if (sessionId) {
      try {
        const sessions = await getStore();
        await enColaTienda(() => sessions.rewrite(sessionId, state.messages));
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    }

    return { ok: true, messages: state.messages.length, restoredFiles: resultado.restored };
  } finally {
    revirtiendo = false;
  }
});

/** Cancela la ejecución actual del agente. */
ipcMain.handle('chat:abort', async () => {
  abortSolicitado = true;

  // Una tarjeta abierta no debe sobrevivir al turno que la pidió. Al resolverla
  // el tool deja de esperar; el bucle verá la señal abortada en la siguiente
  // llamada al proveedor y cerrará el turno.
  for (const [id, resolver] of [...pendingPlans]) {
    pendingPlans.delete(id);
    resolver({ approved: false, feedback: 'turno cancelado por el usuario' });
  }
  for (const [id, resolver] of [...pendingQuestions]) {
    pendingQuestions.delete(id);
    resolver(null);
  }
  for (const [id, resolver] of [...pendingDiffs]) {
    pendingDiffs.delete(id);
    resolver(false);
  }

  if (currentAbort) {
    currentAbort.abort();
    return { ok: true };
  }
  return { ok: false };
});

/*
 * Servidores MCP: se arrancan una vez por workspace y configuración, no en
 * cada turno. Antes cada mensaje pagaba el handshake de npx/uvx y la lista de
 * herramientas; con varios plugins eso son segundos por turno.
 */
let cachePlugins = {
  clave: null,
  clientes: [],
  porNombre: new Map(),
  herramientas: [],
  errores: [],
};

/** Resúmenes de subagentes pendientes, etiquetados por conversación de origen. */
const colaResultadosSubagentes = [];

function entregarResultadoSubagente(texto, sessionId = state.sessionId) {
  if (!texto) return;
  const origen = sessionId ?? null;
  // Un resultado de otra conversación no puede inyectarse en la actual; se
  // conserva para cuando el usuario vuelva a abrirla.
  if (origen && state.sessionId && origen !== state.sessionId) {
    colaResultadosSubagentes.push({ sessionId: origen, texto });
    return;
  }
  if (state.busy) {
    colaResultadosSubagentes.push({ sessionId: origen, texto });
    return;
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('task:wake', { texto, sessionId: origen });
  }
}

/** Extrae los resúmenes que pertenecen a la sesión indicada. */
function extraerResultadosSubagentes(sessionId) {
  const actuales = [];
  const resto = [];
  for (const entrada of colaResultadosSubagentes) {
    if (!entrada.sessionId || entrada.sessionId === sessionId) actuales.push(entrada.texto);
    else resto.push(entrada);
  }
  colaResultadosSubagentes.length = 0;
  colaResultadosSubagentes.push(...resto);
  return actuales;
}

async function cerrarPlugins() {
  const actual = cachePlugins;
  cachePlugins = { clave: null, clientes: [], porNombre: new Map(), herramientas: [], errores: [] };
  await Promise.all(actual.clientes.map((client) => client.close().catch(() => {})));
}

async function cargarPlugins(cwd, prefs) {
  const activos = (prefs.plugins ?? []).filter((entry) => entry.enabled !== false);
  const clave = JSON.stringify({ cwd, plugins: activos });
  if (cachePlugins.clave === clave) return { ...cachePlugins, nuevo: false };

  await cerrarPlugins();

  const { StdioMcpClient } = await import('../dist/mcp/stdio-client.js');
  const { toolsFromMcpServer } = await import('../dist/tools/mcp-adapter.js');
  const clientes = [];
  const porNombre = new Map();
  const herramientas = [];
  const errores = [];

  for (const plugin of activos) {
    const nombre = String(plugin.name ?? plugin.id ?? 'plugin');
    try {
      const client = await StdioMcpClient.start({
        command: plugin.command,
        args: Array.isArray(plugin.args) ? plugin.args : [],
        cwd,
        onStderr: (chunk) => console.error(`[plugin ${nombre}] ${chunk}`),
      });
      clientes.push(client);
      porNombre.set(nombre, client);
      herramientas.push(...(await toolsFromMcpServer(client)));
    } catch (error) {
      errores.push({
        nombre,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  cachePlugins = { clave, clientes, porNombre, herramientas, errores };
  return { ...cachePlugins, nuevo: true };
}

/** Pregunta lateral sin hilo, sin tools y sin persistencia. */
ipcMain.handle('chat:side', async (_event, payload) => {
  const text = (typeof payload === 'string' ? payload : String(payload?.text ?? '')).trim();
  if (text.length === 0) return { ok: false, error: 'pregunta vacía' };
  if (!state.providerId) return { ok: false, error: 'selecciona un proveedor de modelo' };
  const { runAgent, createProvider, ToolRegistry } = await getEngine();
  const provider = createProvider(state.providerId, buildProviderConfig());
  if (!state.model) {
    try {
      const models = await provider.listModels();
      state.model = models[0]?.id ?? null;
      if (state.model) recordarVentana(state.providerId, state.model, models[0].contextWindow);
    } catch { state.model = null; }
  }
  if (!state.model) return { ok: false, error: 'el proveedor no reporta modelos' };
  try {
    const resultado = await runAgent(
      {
        provider, model: state.model, tools: new ToolRegistry(),
        system: 'Responde de forma breve (máximo 3 frases) a una pregunta lateral. No modifiques ficheros, no ejecutes comandos y no uses herramientas.',
        maxSteps: 1, contextWindow: ventanaDelTurno(state.model),
      },
      text, { cwd: state.cwd },
    );
    return { ok: true, text: (resultado.text ?? '').trim() };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

/** Envía un turno al agente y transmite los eventos por `chat:event`. */
ipcMain.handle('chat:send', async (event, payload) => {
  /*
   * Con un plan pendiente, escribir en el composer es la forma de pedir
   * cambios: su artefacto solo ofrece «Proceed». El mensaje se usa como motivo
   * del rechazo y el turno en curso sigue con el plan revisado.
   */
  const textoEntrante = (typeof payload === 'string' ? payload : String(payload?.text ?? '')).trim();
  if (pendingPlans.size > 0 && textoEntrante.length > 0) {
    for (const [id, resolver] of [...pendingPlans]) {
      pendingPlans.delete(id);
      resolver({ approved: false, feedback: textoEntrante.slice(0, 2000), steps: null });
    }
    return { ok: true, planFeedback: true };
  }

  if (state.busy || cargandoSesion || revirtiendo) {
    return { ok: false, error: 'el agente ya está trabajando' };
  }

  /*
   * Reserva el turno antes del primer await. Si no, una carga de sesión o un
   * segundo envío pueden colarse mientras se leen adjuntos y se prepara el
   * proveedor, cuando `state.busy` todavía valía false.
   */
  state.busy = true;
  tareasAgenteDelTurno = new Set();
  const controller = new AbortController();
  currentAbort = controller;
  abortSolicitado = false;
  if (!event.sender.isDestroyed()) {
    event.sender.send('chat:event', { type: 'busy', busy: true });
  }

  try {
  const text = typeof payload === 'string' ? payload : String(payload?.text ?? '');
  const mentions = Array.isArray(payload?.mentions) ? payload.mentions.slice(0, 20) : [];
  const attachments = Array.isArray(payload?.attachments) ? payload.attachments.slice(0, 20) : [];

  const images = [];
  const attachmentBlocks = [];
  for (const attachment of attachments) {
    if (!attachment || typeof attachment !== 'object') continue;
    const nombre = String(attachment.name ?? 'archivo').slice(0, 160);
    const mime = String(attachment.mime ?? 'application/octet-stream');
    const dataUrl = String(attachment.dataUrl ?? '');
    const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl);
    if (!match) {
      attachmentBlocks.push(`### ${nombre}\n(adjunto inválido)`);
      continue;
    }
    const buffer = Buffer.from(match[3], match[2] ? 'base64' : 'utf8');
    if (buffer.length > 10 * 1024 * 1024) {
      attachmentBlocks.push(`### ${nombre}\n(adjunto demasiado grande, máx. 10 MB)`);
      continue;
    }
    if (mime.startsWith('image/')) {
      if (buffer.length > 8 * 1024 * 1024) {
        attachmentBlocks.push(`### ${nombre}\n(imagen demasiado grande, máx. 8 MB)`);
        continue;
      }
      images.push({ mimeType: mime, data: buffer.toString('base64') });
      attachmentBlocks.push(`### ${nombre}\n(imagen adjunta)`);
      continue;
    }
    const esTexto =
      mime.startsWith('text/') ||
      /json|xml|csv|yaml|javascript|typescript|markdown|x-sh|sql/i.test(mime) ||
      /\.(txt|md|js|ts|tsx|jsx|json|css|html|py|go|rs|java|c|cpp|h|hpp|sh|yml|yaml|toml|xml|csv|log)$/i.test(nombre);
    if (esTexto) {
      const content = buffer.toString('utf8');
      const bounded = content.length > 40000 ? `${content.slice(0, 40000)}\n[truncado]` : content;
      attachmentBlocks.push('### ' + nombre + '\n```\n' + bounded + '\n```');
    } else {
      attachmentBlocks.push(`### ${nombre}\n(adjunto ${mime}, ${buffer.length} bytes)`);
    }
  }

  // El botón de pensamiento decide si el nivel de esfuerzo llega al proveedor.
  const effort =
    payload?.thinking === true && typeof payload?.effort === 'string' ? payload.effort : null;
  if (typeof payload?.preset === 'string') {
    state.prefs.permissionPreset = payload.preset;
  }

  let input = text.trim();
  if (input.length === 0 && images.length === 0 && attachmentBlocks.length === 0) {
    return { ok: false, error: 'mensaje vacío' };
  }
  if (input.length === 0) input = 'Analiza los archivos adjuntos.';

  // Un aviso pendiente con cancelOn "any" se cancela en cuanto el usuario escribe:
  // para eso estaba, para no avisar de algo que ya se está hablando.
  try {
    await cancelarAvisosPendientes();
  } catch {
    // si falla la cancelación, el mensaje sigue su curso
  }

  // Adjunta el contenido de los ficheros mencionados con @.
  // Las imágenes no se leen como texto: van como partes binarias al modelo.
  if (mentions.length > 0) {
    const blocks = [];
    for (const relative of mentions) {
      const absolute = rutaAutorizada(state.cwd, relative);
      const mime = imageMimeType(relative);

      if (mime) {
        try {
          const buffer = await fsp.readFile(absolute);
          if (buffer.length > 8 * 1024 * 1024) {
            blocks.push(`### ${relative}\n(imagen demasiado grande, máx. 8 MB)`);
            continue;
          }
          images.push({ mimeType: mime, data: buffer.toString('base64') });
          blocks.push(`### ${relative}\n(imagen adjunta)`);
        } catch {
          blocks.push(`### ${relative}\n(no se pudo leer la imagen)`);
        }
        continue;
      }

      try {
        const content = await fsp.readFile(absolute, 'utf8');
        const bounded = content.length > 40000 ? `${content.slice(0, 40000)}\n[truncado]` : content;
        blocks.push(`### ${relative}\n\`\`\`\n${bounded}\n\`\`\``);
      } catch {
        blocks.push(`### ${relative}\n(no se pudo leer)`);
      }
    }
    input = `${input}\n\nFicheros adjuntos:\n\n${blocks.join('\n\n')}`;
  }

  if (attachmentBlocks.length > 0) {
    input = `${input}\n\nArchivos adjuntos:\n\n${attachmentBlocks.join('\n\n')}`;
  }

  if (!(await esDirectorio(state.cwd))) {
    return {
      ok: false,
      error: 'El workspace ya no existe. Abre otra carpeta antes de enviar el mensaje.',
    };
  }

  const {
    runAgent,
    createProvider,
    ToolRegistry,
    fileSystemTools,
    PROVIDER_CATALOG,
    soportaPensamiento,
  } = await getEngine();

  if (!state.providerId) {
    return { ok: false, error: 'selecciona un proveedor de modelo' };
  }

  const provider = createProvider(state.providerId, buildProviderConfig());

  if (!state.model) {
    try {
      const models = await provider.listModels();
      const elegido = models[0];
      state.model = elegido ? elegido.id : null;
      // La ventana del modelo elegido, para el presupuesto de contexto.
      if (elegido) recordarVentana(state.providerId, elegido.id, elegido.contextWindow);
    } catch {
      state.model = null;
    }
  }

  /*
   * Ollama no declara la ventana en `/api/tags`: se pregunta aparte. De la
   * misma respuesta salen sus capacidades (`tools`, `vision`). Es una consulta
   * cacheada; solo la primera vez cuesta hasta 2,5 s.
   */
  if (state.providerId === 'ollama' && state.model) {
    await recordarVentanaOllama(state.model);
  }

  if (!state.model) {
    return { ok: false, error: 'el proveedor no reporta modelos' };
  }

  const capacidades = capacidadesOllama.get(state.model);
  if (capacidades?.tools === false) {
    return {
      ok: false,
      error: `El modelo «${state.model}» no declara soporte de herramientas en Ollama. Elige uno con tools.`,
    };
  }
  if (capacidades?.vision === false && images.length > 0) {
    return {
      ok: false,
      error: `El modelo «${state.model}» no admite imágenes. Quita los adjuntos o elige un modelo de visión.`,
    };
  }

  // Sesión: se crea la primera vez, salvo que el historial esté desactivado.
  if (!state.sessionId && state.prefs.saveHistory !== false) {
    try {
      const sessions = await getStore();
      const created = await enColaTienda(() => sessions.create({
        provider: state.providerId,
        model: state.model,
        cwd: state.cwd,
        project: state.project,
      }));
      state.sessionId = created.id;
    } catch {
      state.sessionId = null;
    }
  }

  const preset = state.prefs.permissionPreset ?? 'Turbo';
  const prefs = state.prefs;

  /*
   * Herramientas que ve el AGENTE. `tools:list` (el catálogo de Ajustes) es otra
   * lista distinta: añadir algo solo allí lo deja invisible para el agente.
   * Pasó con `edit_notebook` y `generate_image`.
   */
  // El gancho de despertar se registra una vez, junto a las herramientas.
  try {
    require('./tools-extra.cjs').setAlTerminarTarea(alTerminarUnaTarea);
  } catch {
    // sin gancho, el agente sigue funcionando con command_status
  }

  const baseTools = [
    ...fileSystemTools,
    makeSearchFilesTool(() => state.cwd),
    makeFileSearchTool(() => state.cwd),
    makeCodeSearchTool(codeIndex, () => state.cwd),
    makeEditFileTool(() => state.cwd),
    makeMultiReplaceTool(() => state.cwd),
    makeEditNotebookTool(() => state.cwd),
    makeGenerateImageTool(() => state.cwd),
    ...(state.remote?.direct ? [makeRemoteCommandTool()] : [makeRunCommandTool(() => state.cwd, () => state.prefs)]),
    makeCommandStatusTool(),
    makeManageTaskTool(),
    makeSearchWebTool(() => state.prefs),
    makeViewCodeItemTool(() => state.cwd),
    makeMemoryTool(getMemoria(), () => state.cwd),
    makeSkillTool(() => descubrirSkills(state.cwd)),
    makeRunWorkflowTool(() => state.cwd, (a, c) => makeRunCommandTool(() => state.cwd, () => state.prefs).execute(a, c)),
    makeRunExtensionCodeTool(() => state.cwd, (a, c) => makeRunCommandTool(() => state.cwd, () => state.prefs).execute(a, c)),
    ...makeBrowserTools(() => state.prefs, (message, detail) =>
      askPermission(mainWindow, message, detail),
    ),
    makeFetchUrlTool(() => state.prefs),
    makeOpenUrlTool(() => state.prefs),
  ];

  // Subagente de navegador: bucle propio, contexto propio.
  // La tarea entra como texto y sale un resumen; sus pasos no contaminan el hilo principal.
  const browserSubagent = {
    name: 'browser_task',
    description:
      'Delega una tarea de navegación a un subagente con su propio contexto. ' +
      'Úsala para investigar en la web, rellenar formularios o extraer datos de una página. ' +
      'Devuelve un resumen del resultado, no la transcripción completa.',
    parameters: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description: 'Qué debe conseguir el subagente, en una frase concreta.',
        },
        url: {
          type: 'string',
          description: 'Página por la que empezar (opcional).',
        },
      },
      required: ['task'],
    },
    async execute(args) {
      const task = String(args?.task ?? '').trim();
      if (task.length === 0) return { content: 'Falta la tarea.', isError: true };

      const startUrl = typeof args?.url === 'string' ? args.url : '';
      const entrada = startUrl ? `${task}\n\nEmpieza en: ${startUrl}` : task;

      const subTools = new ToolRegistry().registerAll(
        makeBrowserTools(() => state.prefs, (message, detail) =>
          askPermission(mainWindow, message, detail),
        ),
      );

      const subSend = (event) => {
        // Los pasos del subagente se marcan para que la UI los anide.
        send({ ...event, subagent: 'browser' });
      };

      try {
        const result = await runAgent(
          {
            provider,
            model: state.model,
            tools: subTools,
            system:
              'Eres un subagente de navegador. Completa la tarea usando solo las herramientas de navegador. ' +
              'Cuando termines, responde con un resumen conciso de lo que encontraste o hiciste: ' +
              'hechos, datos y URLs relevantes. No incluyas la transcripción de cada clic.',
            maxSteps: 14,
            contextWindow: ventanaDelTurno(state.model),
            onEvent: subSend,
          },
          entrada,
          { cwd: state.cwd, signal: controller.signal },
        );

        const resumen = (result.text ?? '').trim();
        return {
          content: resumen.length > 0 ? resumen : 'El subagente terminó sin producir un resumen.',
          isError: false,
        };
      } catch (error) {
        return {
          content: `El subagente falló: ${error instanceof Error ? error.message : String(error)}`,
          isError: true,
        };
      }
    },
  };

  // Preguntas al usuario: bloquea el turno hasta que responda.
  const askQuestionTool = {
    name: 'ask_question',
    description:
      'Ask the user one or more multiple-choice questions, e.g. to clarify requirements, and wait for the answers. ' +
      "Don't use it for trivial yes/no questions; ask those in plain text.",
    parameters: {
      type: 'object',
      properties: {
        questions: {
          type: 'array',
          description: 'The questions to ask the user.',
          items: {
            type: 'object',
            properties: {
              question: {
                type: 'string',
                description: "The question, without 'select all that apply' or similar; the UI adds that.",
              },
              header: {
                type: 'string',
                description: 'Short header label for the question (max 16 chars).',
              },
              options: {
                type: 'array',
                description:
                  "Answers to choose from, unnumbered and without an 'Other' option; the UI adds both. " +
                  "Put a recommended answer first, prefixed with '(Recommended)'.",
                items: {
                  anyOf: [
                    { type: 'string' },
                    {
                      type: 'object',
                      properties: {
                        label: { type: 'string' },
                        description: { type: 'string' },
                        recommendedReason: { type: 'string' },
                      },
                    },
                  ],
                },
              },
              is_multi_select: {
                type: 'boolean',
                description: 'Whether the user can select several options.',
              },
              allowMultiple: {
                type: 'boolean',
                description: 'Alias for is_multi_select.',
              },
            },
            required: ['question', 'options'],
          },
        },
      },
      required: ['questions'],
    },
    async execute(args) {
      const crudas = Array.isArray(args?.questions) ? args.questions : [];
      if (crudas.length === 0) {
        return { content: 'No hay preguntas que hacer.', isError: true };
      }

      // Normaliza tanto strings de Antigravity como objetos con label/description
      const preguntas = crudas.map((p) => {
        const allowMultiple = Boolean(p.is_multi_select ?? p.isMultiSelect ?? p.allowMultiple);
        const options = (Array.isArray(p.options) ? p.options : []).map((opt) => {
          if (typeof opt === 'string') {
            const esRec = /^\(recommended\)/i.test(opt.trim());
            return {
              label: opt.trim(),
              description: '',
              recommended: esRec,
            };
          }
          return {
            label: String(opt?.label ?? opt ?? ''),
            description: String(opt?.description ?? ''),
            recommended: Boolean(opt?.recommended ?? /recommended/i.test(String(opt?.label ?? ''))),
            recommendedReason: opt?.recommendedReason ? String(opt.recommendedReason) : '',
          };
        });
        return {
          question: String(p.question ?? ''),
          header: p.header ? String(p.header) : '',
          allowMultiple,
          options,
        };
      });

      const respuesta = await requestUserQuestion(mainWindow, preguntas);
      if (respuesta === null) {
        return {
          content: 'El usuario no respondió (se agotó el tiempo de espera).',
          isError: true,
        };
      }

      const lineas = preguntas.map((pregunta, indice) => {
        const dada = respuesta[indice];
        const texto = Array.isArray(dada) ? dada.join(', ') : String(dada ?? '');
        return `- ${pregunta.question} → ${texto.length > 0 ? texto : '(sin respuesta)'}`;
      });

      return { content: `Respuestas del usuario:\n${lineas.join('\n')}` };
    },
  };

  const askUserTool = {
    ...askQuestionTool,
    name: 'ask_user_question',
  };

  // Plan mode: el agente propone pasos y el usuario decide antes de ejecutar.
  const planTool = {
    name: 'present_plan',
    description:
      'Presenta un plan de pasos al usuario y espera su aprobación antes de ejecutar nada. ' +
      'Úsala al empezar una tarea con varios pasos cuando la política de revisión lo pida.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Título corto del plan.' },
        steps: {
          type: 'array',
          description: 'Pasos ordenados del plan.',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Qué se hará.' },
              detail: { type: 'string', description: 'Detalle opcional.' },
            },
            required: ['title'],
          },
        },
      },
      required: ['title', 'steps'],
    },
    async execute(args) {
      const plan = {
        title: String(args?.title ?? 'Plan'),
        steps: Array.isArray(args?.steps)
          ? args.steps.slice(0, 40).map((step) => ({
              title: String(step?.title ?? ''),
              detail: step?.detail ? String(step.detail) : '',
            }))
          : [],
      };

      const decision = await requestPlanApproval(mainWindow, plan);

      if (!decision.approved) {
        const motivo = decision.feedback ? ` Motivo: ${decision.feedback}` : '';
        return {
          content: `El usuario rechazó el plan.${motivo} Propón uno revisado.`,
          isError: true,
        };
      }

      // El usuario puede haber editado los pasos: ese es el plan vigente.
      const definitivo = Array.isArray(decision.steps) && decision.steps.length > 0
        ? decision.steps
        : plan.steps;

      const cambiado =
        definitivo.length !== plan.steps.length ||
        definitivo.some((paso, i) => paso.title !== (plan.steps[i]?.title ?? ''));

      // El plan aprobado arranca el ciclo: a partir de aquí se cuenta para la revisión.
      ciclo.entregarPlan({ steps: definitivo });

      const listado = definitivo
        .map((paso, i) => `${i + 1}. ${paso.title}${paso.detail ? ` — ${paso.detail}` : ''}`)
        .join('\n');

      return {
        content:
          `Plan aprobado por el usuario (${definitivo.length} pasos). ` +
          (cambiado ? 'OJO: el usuario lo editó, este es el plan vigente, no el que propusiste.\n\n' : '') +
          `${listado}\n\nEjecútalo en este orden.` +
          PROMPT_EXECUTOR,
        isError: false,
      };
    },
  };

  // Modo `llm` = estático + clasificador con el modelo (cuesta tokens).
  const modoSeguridad = prefs.securityMonitor ?? 'block';
  const modoMonitor = modoSeguridad === 'llm' ? 'block' : modoSeguridad;
  const usarClasificador = modoSeguridad === 'llm';

  /** Trayectoria reciente, para el nivel 2 del clasificador. */
  const trayectoriaReciente = () => {
    const pasos = [];
    for (const mensaje of state.messages.slice(-24)) {
      if (mensaje.role === 'assistant' && Array.isArray(mensaje.toolCalls)) {
        for (const call of mensaje.toolCalls) {
          pasos.push({ herramienta: call.name, argumentos: call.arguments ?? {} });
        }
      } else if (mensaje.role === 'tool') {
        const ultimo = pasos[pasos.length - 1];
        if (ultimo && ultimo.resultado === undefined) {
          ultimo.resultado = String(mensaje.content ?? '').slice(0, 800);
          ultimo.esError = false;
        }
      }
    }
    return pasos;
  };

  const clasificarConModelo = usarClasificador
    ? async (info) => {
        try {
          const { clasificarAccion } = await import('../dist/agent/classifier.js');
          const resultado = await clasificarAccion(
            { herramienta: info.herramienta, argumentos: info.argumentos },
            trayectoriaReciente(),
            {
              provider,
              model: state.model,
              modeloRapido: prefs.classifierModel || undefined,
              umbralNivel1: Number(prefs.classifierThreshold ?? 1),
              timeoutMs: Number(prefs.classifierTimeoutMs ?? 20000),
            },
          );
          return resultado;
        } catch {
          return null;
        }
      }
    : undefined;

  // Orden de envoltura: hooks (pre reescribe args) → monitor (evalúa lo que de
  // verdad se va a ejecutar) → permisos → herramienta. La salida vuelve al revés.




  /** Herramienta: guardar un subagente reutilizable. */
  const defineSubagentTool = {
    name: 'define_subagent',
    description:
      'Define un subagente reutilizable con nombre, rol y system prompt propio. Después ' +
      'puedes lanzarlo con invoke_subagent pasando solo su nombre y la tarea.',
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description:
            'Nombre único. Empieza por letra o número y usa solo letras, números, _, - y .',
        },
        role: {
          type: 'string',
          description: 'Su papel en 2-5 palabras, como un puesto de trabajo.',
        },
        description: {
          type: 'string',
          description: 'Qué hace y cuándo usarlo. Es lo que lees tú para decidir invocarlo.',
        },
        systemPrompt: {
          type: 'string',
          description:
            'Su instrucción de sistema completa. Si lo omites se usa el prompt genérico de ' +
            'subagente con el rol que hayas dado.',
        },
        allowWrites: {
          type: 'boolean',
          description: 'Darle también escritura y ejecución. Por defecto solo lee.',
        },
        allowMcp: {
          type: 'boolean',
          description:
            'Darle acceso a las herramientas de los servidores MCP conectados. ' +
            'Por defecto no las tiene.',
        },
        allowSubagents: {
          type: 'boolean',
          description:
            'Permitirle lanzar subagentes anidados de SOLO LECTURA (un nivel, con el ' +
            'presupuesto del turno). Por defecto no puede delegar.',
        },
        tools: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Opcional. Lista de nombres de herramientas que puede usar. Solo puede quitar: ' +
            'no da escritura ni MCP si allowWrites/allowMcp están apagados. Vacío = todas ' +
            'las de su nivel de permiso.',
        },
      },
      required: ['name', 'role', 'description'],
    },
    async execute(args) {
      try {
        const entrada = await subagentes.definir(args ?? {});
        return {
          content:
            `Subagente definido: ${entrada.name} (${entrada.role}). ` +
            `Puedes lanzarlo con invoke_subagent indicando definition: "${entrada.name}".`,
        };
      } catch (error) {
        return {
          content: `No se pudo definir: ${error instanceof Error ? error.message : String(error)}`,
          isError: true,
        };
      }
    },
  };

  /** Herramienta: gestionar los subagentes en ejecución. */
  const manageSubagentTool = {
    name: 'manage_subagent',
    description:
      'Gestiona los subagentes: list (los que están corriendo), list_peers (los hermanos), ' +
      'kill (cancelar unos) y kill_all (cancelar todos).',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'list_peers', 'kill', 'kill_all'],
          description: 'La acción a realizar.',
        },
        ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Ids de los subagentes a matar. Obligatorio para kill.',
        },
      },
      required: ['action'],
    },
    async execute(args) {
      const accion = String(args?.action ?? 'list');

      if (accion === 'list' || accion === 'list_peers') {
        const vivos = subagentes.listarEnEjecucion();
        // El agente principal no tiene padre: sus «hermanos» son los de primer nivel.
        const lista = accion === 'list_peers' ? vivos.filter((s) => !s.padre) : vivos;
        if (lista.length === 0) {
          return { content: 'No hay subagentes en ejecución.' };
        }
        const lineas = lista.map(
          (s) =>
            `- ${s.id} · ${s.nombre} (${s.rol}) · ${s.estado} · ${s.segundos}s` +
            (s.padre ? ` · hijo de ${s.padre}` : ''),
        );
        return {
          content:
            `${lista.length} subagente(s)${accion === 'list_peers' ? ' hermanos' : ''}:\n` +
            lineas.join('\n'),
        };
      }

      if (accion === 'kill') {
        const ids = Array.isArray(args?.ids) ? args.ids.map(String) : [];
        if (ids.length === 0) return { content: 'kill necesita ids.', isError: true };
        const muertos = subagentes.matar(ids);
        return {
          content: muertos > 0 ? `Cancelados ${muertos} subagente(s).` : 'No se encontró ninguno de esos ids.',
          isError: muertos === 0,
        };
      }

      const muertos = subagentes.matar([]);
      return {
        content: muertos > 0 ? `Cancelados ${muertos} subagente(s).` : 'No había ninguno en ejecución.',
      };
    },
  };


  // -------------------------------------------------------------------------
  // Runner de tests
  // -------------------------------------------------------------------------

  /** Último resultado, para que la UI lo muestre sin volver a correr nada. */
  state.ultimosTests = state.ultimosTests ?? null;

  const runTestsTool = {
    name: 'run_tests',
    description:
      'Ejecuta la suite de tests del proyecto y devuelve un resumen: cuántos pasan, ' +
      'cuántos fallan y qué tests fallan. Detecta el framework solo. Úsala antes de dar ' +
      'un cambio por bueno.',
    parameters: {
      type: 'object',
      properties: {
        waitDurationSeconds: {
          type: 'number',
          description:
            'Milisegundos a esperar a que termine antes de pasarlo a segundo plano ' +
            '(0–10000). Por defecto 10000.',
        },
      },
    },
    async execute(args, ctx) {
      const detectado = await testrunner.detectarFramework(state.cwd);
      if (!detectado) {
        return {
          content:
            'No he encontrado cómo se corren los tests en este proyecto: no hay ' +
            'scripts.test en package.json ni configuración de pytest, cargo o go.',
          isError: true,
        };
      }

      let salida;
      if (state.remote?.direct) {
        try {
          salida = await ejecutarComandoRemoto(
            detectado.comando,
            null,
            Number(args?.waitDurationSeconds ?? 10000),
          );
        } catch (error) {
          salida = { content: `Error SSH: ${error instanceof Error ? error.message : String(error)}`, isError: true };
        }
      } else {
        const ejecutar = makeRunCommandTool(() => state.cwd, () => state.prefs);
        salida = await ejecutar.execute({
          command: detectado.comando,
          cwd: state.cwd,
          waitDurationSeconds: Number(args?.waitDurationSeconds ?? 10000),
          taskName: 'Test run',
        }, ctx);
      }

      const resumen = testrunner.parsearSalida(salida.content);
      const codigoDetectado = /exit code: (-?\d+)/.exec(salida.content);
      const codigo = codigoDetectado
        ? Number(codigoDetectado[1])
        : Number.isFinite(Number(salida.code))
          ? Number(salida.code)
          : null;
      const sigueEnSegundoPlano = /sigue en ejecución|CommandId:/i.test(salida.content);
      /*
       * `run_command` devuelve el control a los 10 s y la suite sigue viva. No
       * hay código de salida: asumir 0 convertía «aún ejecutándose» en «pasa».
       */
      if (codigo === null || sigueEnSegundoPlano) {
        const aviso =
          `La suite sigue ejecutándose en segundo plano` +
          ` (${sigueEnSegundoPlano ? 'CommandId en la salida' : 'sin exit code'}). ` +
          'No puedo confirmar que pase; consulta el comando o vuelve a ejecutar run_tests.';
        state.ultimosTests = {
          framework: detectado.nombre,
          comando: detectado.comando,
          resumen,
          bien: null,
          cuando: new Date().toISOString(),
        };
        send({ type: 'tests_result', ...state.ultimosTests });
        return {
          content: `${aviso}\n\n${salida.content.slice(0, 4000)}`,
          isError: true,
        };
      }
      const bien = testrunner.exito(codigo, resumen);

      state.ultimosTests = {
        framework: detectado.nombre,
        comando: detectado.comando,
        resumen,
        bien,
        cuando: new Date().toISOString(),
      };
      send({ type: 'tests_result', ...state.ultimosTests });

      if (!resumen.reconocido) {
        // Sin resumen legible se devuelve la salida cruda: mejor eso que inventar cifras.
        return {
          content:
            `${detectado.nombre} terminó con código ${codigo}. No supe leer el resumen, ` +
            `así que aquí está la salida:\n\n${salida.content.slice(0, 4000)}`,
          isError: !bien,
        };
      }

      const partes = [
        `${detectado.nombre}: ${resumen.pasan} pasan, ${resumen.fallan} fallan` +
          (resumen.total !== null ? ` (${resumen.total} en total)` : ''),
        bien ? 'La suite pasa.' : 'La suite falla.',
      ];

      if (resumen.fallos.length > 0) {
        partes.push('Fallos:\n' + resumen.fallos.map((f) => `- ${f.nombre}`).join('\n'));
      }

      return { content: partes.join('\n'), isError: !bien };
    },
  };

  // -------------------------------------------------------------------------
  // notify_user: temporizadores y cron
  // -------------------------------------------------------------------------

  /**
   * Herramienta con la que el agente se programa a sí mismo (schedule / notify_user).
   *
   * Un aviso crea una tarea en el planificador de siempre, así que dispara igual que
   * las que crea el usuario: conversación nueva con el mensaje dentro.
   */
  const notifyUserTool = {
    name: 'notify_user',
    description:
      'Programa un aviso: un mensaje que te llegará más tarde, una vez o repetido. ' +
      'Úsala cuando el usuario pida que le avises en un rato, o para revisar algo cada cierto tiempo.',
    parameters: {
      type: 'object',
      properties: {
        Prompt: {
          type: 'string',
          description: 'Message sent to you as a high-priority notification when the timer fires or the cron triggers.',
        },
        message: {
          type: 'string',
          description:
            'El mensaje que te llegará cuando se dispare. Escríbelo como una instrucción ' +
            'para ti, no como un texto para el usuario: tiene que entenderse sin esta conversación.',
        },
        DurationSeconds: {
          type: 'number',
          description: 'Seconds to wait for a one-shot timer. Mutually exclusive with CronExpression.',
        },
        durationSeconds: {
          type: 'number',
          description:
            'Segundos a esperar para un aviso único. Mutuamente excluyente con cronExpression.',
        },
        CronExpression: {
          type: 'string',
          description:
            'Expresión cron de 5 campos para un aviso recurrente, por ejemplo "*/5 * * * *" ' +
            'cada cinco minutos o "0 9 * * 1-5" a las 9 de lunes a viernes. ' +
            'Mutuamente excluyente con durationSeconds.',
        },
        cronExpression: {
          type: 'string',
        },
        MaxIterations: {
          type: 'number',
          description: 'Cuántas veces puede dispararse antes de apagarse. Por defecto, sin límite.',
        },
        maxTriggers: {
          type: 'number',
        },
        IsDaemon: {
          type: 'boolean',
          description:
            'true solo si es un trabajo independiente que debe seguir disparándose cuando ' +
            'esta tarea ya haya terminado. Por defecto false.',
        },
        isStanding: {
          type: 'boolean',
        },
        TimerCondition: {
          type: 'string',
          enum: ['never', 'any'],
          description:
            'Para un aviso único: "any" lo cancela si el usuario escribe antes de que ' +
            'llegue. "never" (por defecto) lo deja llegar siempre.',
        },
        cancelOn: {
          type: 'string',
          enum: ['never', 'any'],
        },
        ExactTiming: {
          type: 'boolean',
          description: 'Cron only. Set true only when the schedule must fire without jitter.',
        },
        jitterSeconds: {
          type: 'number',
          description:
            'Solo para cron: dispersa hasta N segundos el disparo, para que varias tareas ' +
            'programadas a la misma hora no salgan todas de golpe.',
        },
      },
    },
    async execute(args) {
      const mensaje = String(args?.Prompt ?? args?.prompt ?? args?.message ?? '').trim();
      if (mensaje.length === 0) return { content: 'Falta el mensaje (Prompt).', isError: true };

      const duracionVal = args?.DurationSeconds ?? args?.durationSeconds;
      const tieneDuracion = Number.isFinite(Number(duracionVal));
      const cronVal = args?.CronExpression ?? args?.cronExpression;
      const tieneCron = typeof cronVal === 'string' && cronVal.trim().length > 0;

      if (tieneDuracion === tieneCron) {
        return {
          content: 'Da exactamente uno de DurationSeconds o CronExpression.',
          isError: true,
        };
      }

      const id = `n${Date.now().toString(36)}`;

      if (tieneDuracion) {
        const segundos = Math.max(5, Math.min(30 * 24 * 3600, Number(duracionVal)));
        const condicion = String(args?.TimerCondition ?? args?.timerCondition ?? args?.cancelOn ?? 'never').trim();
        const cancelOn = condicion.length > 0 ? condicion : 'never';

        const aviso = {
          id,
          prompt: mensaje,
          mode: 'once',
          at: new Date(Date.now() + segundos * 1000).toISOString(),
          nextRunAt: new Date(Date.now() + segundos * 1000).toISOString(),
          triggers: 0,
          maxTriggers: 1,
          cancelOn,
          createdBy: 'agent',
          enabled: true,
          lastRunAt: null,
        };

        await mutarScheduled((tareas) => {
          tareas.push(aviso);
          return { resultado: null };
        });
        tareasAgenteDelTurno.add(id);

        const cuando = new Date(Date.now() + segundos * 1000);
        return {
          content:
            `Aviso programado (${id}) para dentro de ${segundos} s, a las ${cuando.toLocaleString()}. ` +
            'Se disparará en una conversación nueva con tu mensaje.',
        };
      }

      let compilado;
      try {
        compilado = compilarCron(cronVal);
      } catch (error) {
        return { content: `Expresión cron inválida: ${error.message}`, isError: true };
      }

      const proxima = siguienteEjecucion(compilado);
      if (!proxima) {
        return {
          content: 'Esa expresión no se cumple nunca en los próximos dos años.',
          isError: true,
        };
      }

      const exact = args?.ExactTiming === true || args?.exactTiming === true;
      const jitter = exact ? 0 : Math.max(0, Math.min(600, Number(args?.jitterSeconds ?? 0) || 0));
      const maxIter = Number(args?.MaxIterations ?? args?.maxIterations ?? args?.maxTriggers);
      const isDaemon = args?.IsDaemon === true || args?.isDaemon === true || args?.isStanding === true;

      const recurrente = {
        id,
        prompt: mensaje,
        mode: 'cron',
        cron: compilado.expresion,
        nextRunAt: proxima.toISOString(),
        triggers: 0,
        maxTriggers: Number.isFinite(maxIter) ? maxIter : null,
        jitterSeconds: jitter,
        createdBy: 'agent',
        isDaemon,
        enabled: true,
        lastRunAt: null,
      };

      await mutarScheduled((tareas) => {
        tareas.push(recurrente);
        return { resultado: null };
      });
      tareasAgenteDelTurno.add(id);

      return {
        content:
          `Aviso recurrente programado (${id}): ${compilado.expresion}. ` +
          `${describirCron(compilado.expresion)}. ` +
          (isDaemon
            ? 'Es un trabajo independiente: seguirá aunque termine la tarea actual.'
            : 'Se apagará cuando la tarea actual termine si no lo mantienes.'),
      };
    },
  };

  const scheduleTool = {
    ...notifyUserTool,
    name: 'schedule',
    description:
      'Schedule a one-shot timer (DurationSeconds) or a recurring cron job (CronExpression) that notifies you via Prompt. ' +
      'Set IsDaemon only for a cron that should keep firing after the current task is done. ' +
      'Set ExactTiming only when a cron must fire at the exact wall-clock time without jitter. ' +
      'Use the manage_task tool to cancel active schedules, and never use a shell sleep command as a timer.',
  };

  /*
   * Herramientas MCP en crudo, para poder dárselas a un subagente que tenga
   * `allowMcp`. Se rellena en el bucle de plugins, que corre más abajo.
   */
  const mcpToolDefs = [];

  // -------------------------------------------------------------------------
  // Subagentes en paralelo
  // -------------------------------------------------------------------------

  /**
   * Herramienta general de delegación: lanza varios subagentes a la vez, cada uno
   * con su propio contexto, y devuelve solo sus resúmenes.
   *
   * Por defecto solo llevan herramientas de lectura. Escribir en el proyecto desde
   * un subagente es algo que se pide explícitamente, no lo que pasa por defecto.
   */
  /** Un fallo de resolución del modelo sí justifica reintentar con el default. */
  function esErrorDeModelo(error) {
    const texto = (error instanceof Error ? error.message : String(error)).toLowerCase();
    return /(model|modelo).*(not found|no existe|does not exist|unknown|invalid|unsupported|not available)|404/.test(
      texto,
    );
  }

  /** Presupuesto compartido por el turno, incluidos los subagentes anidados. */
  const presupuestoSubagentes = {
    usados: 0,
    max: Math.max(1, Number(prefs.maxSubagentsPerTurn ?? 8)),
  };

  const invokeSubagentTool = {
    name: 'invoke_subagent',
    description:
      'Launch a subagent. It runs in the background with its own prompt and sends you a message when it completes or needs guidance; there is no need to poll. ' +
      'Standard available types include "self" (inherits full tools), "research" (read-only codebase/web survey), and "browser" (navigates web pages). ' +
      'Supports either direct arguments (TypeName, Role, Prompt, Model, Workspace) or multiple parallel subagents via subagents array.',
    parameters: {
      type: 'object',
      properties: {
        TypeName: {
          type: 'string',
          description: "Type name of the subagent to invoke: 'self', 'research', 'browser', or a custom subagent name.",
        },
        Role: {
          type: 'string',
          description: "A 2-5 word description of the subagent's role (e.g. 'Codebase Researcher').",
        },
        Prompt: {
          type: 'string',
          description: 'A clear, actionable task description for the subagent.',
        },
        Model: {
          type: 'string',
          enum: ['inherit', 'flash_lite', 'flash', 'pro'],
          description: "Model for the subagent: 'inherit' (default uses parent model), 'flash_lite', 'flash', 'pro'.",
        },
        Workspace: {
          type: 'string',
          enum: ['inherit', 'branch', 'share'],
          description: "Workspace mode: 'inherit' (default) or 'share' (isolated worktree).",
        },
        subagents: {
          type: 'array',
          description: 'Los subagentes a lanzar en paralelo.',
          items: {
            type: 'object',
            properties: {
              definition: {
                type: 'string',
                description:
                  'Nombre de una definición guardada con `define_subagent`. Hereda su rol, ' +
                  'system prompt, permisos y allowSubagents; puedes añadir `prompt` para la ' +
                  'tarea concreta.',
              },
              name: {
                type: 'string',
                description: 'Nombre corto, para identificar su resultado.',
              },
              role: {
                type: 'string',
                description:
                  'Su papel en 2-5 palabras, como un puesto de trabajo. ' +
                  'Ejemplos: "Codebase Researcher", "Database Debugger".',
              },
              prompt: {
                type: 'string',
                description:
                  'La tarea concreta. Sé específico sobre qué debe averiguar y qué debe devolver.',
              },
              allowWrites: {
                type: 'boolean',
                description:
                  'true para darle también escritura y ejecución. Úsalo solo si de verdad ' +
                  'necesitas que un subagente modifique algo.',
              },
              workspace: {
                type: 'string',
                enum: ['inherit', 'share', 'branch'],
                description:
                  'inherit (por defecto): trabaja en tu mismo directorio. share: trabaja en un ' +
                  'git worktree aislado, con su propia rama, y sus cambios no tocan tu rama.',
              },
            },
            required: [],
          },
        },
      },
    },
    async execute(args, ctx) {
      let pedidos = [];
      if (Array.isArray(args?.subagents) && args.subagents.length > 0) {
        pedidos = args.subagents.slice(0, 5);
      } else {
        const typeName = String(
          args?.TypeName ?? args?.typeName ?? args?.definition ?? args?.name ?? ''
        ).trim();
        const prompt = String(args?.Prompt ?? args?.prompt ?? '').trim();
        const role = String(args?.Role ?? args?.role ?? (typeName.length > 0 ? typeName : 'subagent')).trim();
        const ws = String(args?.Workspace ?? args?.workspace ?? 'inherit').trim();
        const model = String(args?.Model ?? args?.model ?? 'inherit').trim();

        if (typeName.length > 0 || prompt.length > 0) {
          pedidos = [{
            name: typeName.length > 0 ? typeName : 'subagent',
            definition: typeName.length > 0 ? typeName : undefined,
            role,
            prompt,
            workspace: ws === 'branch' ? 'share' : ws,
            model,
            allowWrites: typeName.toLowerCase() === 'self',
          }];
        }
      }

      if (pedidos.length === 0) {
        return { content: 'No hay subagentes que lanzar. Especifica TypeName, Role y Prompt.', isError: true };
      }
      const sessionIdOrigen = state.sessionId;
      if (
        !pedidos.every(
          (sub) =>
            sub &&
            (typeof sub.name === 'string' || typeof sub.definition === 'string'),
        )
      ) {
        return {
          content: 'Cada subagente necesita `name` o `definition` (y opcionalmente `prompt`).',
          isError: true,
        };
      }

      const padreSolicitado = typeof args?.__padre === 'string' ? args.__padre : null;
      const profundidad = Number(args?.__profundidad ?? 0);
      const soloLectura = args?.__soloLectura === true;
      if (presupuestoSubagentes.usados + pedidos.length > presupuestoSubagentes.max) {
        return {
          content:
            `El turno ya lanzó ${presupuestoSubagentes.usados} subagente(s) y el máximo es ` +
            `${presupuestoSubagentes.max}. Resume lo que tengas en vez de delegar más.`,
          isError: true,
        };
      }
      presupuestoSubagentes.usados += pedidos.length;

      // Herramientas de solo lectura, envueltas con el guard de permisos.
      const deLectura = baseTools.filter((tool) => HERRAMIENTAS_DE_LECTURA.has(tool.name));
      const deEscritura = baseTools.filter((tool) => !HERRAMIENTAS_DE_LECTURA.has(tool.name));

      const lanzar = async (sub, indice, senalExterna, senalPadre) => {
        // Capturar la identidad al lanzar: el subagente puede terminar después
        // de que el usuario cambie de conversación.
        const sessionIdSub = state.sessionId;
        const turnoSub = currentTurnKey;
        const cwdBaseSub = state.cwd;

        // Si viene `definition`, se resuelve contra las guardadas con define_subagent.
        let definicion = null;
        const referencia = sub?.definition ?? sub?.name;
        if (typeof referencia === 'string' && sub?.prompt === undefined) {
          definicion = await subagentes.buscar(referencia);
          if (!definicion) {
            return {
              nombre: String(referencia),
              rol: '',
              resumen: '',
              error: `no existe la definición de subagente "${referencia}"`,
            };
          }
        } else if (typeof sub?.definition === 'string') {
          definicion = await subagentes.buscar(sub.definition);
        }

        const nombre = String(definicion?.name ?? sub?.name ?? `subagente-${indice + 1}`);
        const rol = String(definicion?.role ?? sub?.role ?? 'investigador');
        const tarea = String(sub?.prompt ?? definicion?.description ?? '').trim();
        const esSelf = nombre.toLowerCase() === 'self' || definicion?.name === 'self';
        const esBrowser = nombre.toLowerCase() === 'browser' || definicion?.name === 'browser';
        const esResearch = nombre.toLowerCase() === 'research' || definicion?.name === 'research';
        const permiteEscritura = !soloLectura && (esSelf || sub?.allowWrites === true || definicion?.allowWrites === true);

        if (tarea.length === 0) {
          return { nombre, rol, resumen: '', error: 'sin tarea' };
        }

        const permiteMcp = !soloLectura && (sub?.allowMcp === true || definicion?.allowMcp === true);

        let disponibles;
        if (esBrowser) {
          disponibles = makeBrowserTools(() => state.prefs, (message, detail) =>
            askPermission(mainWindow, message, detail),
          );
        } else if (esResearch) {
          disponibles = deLectura;
        } else {
          disponibles = permiteEscritura ? [...deLectura, ...deEscritura] : deLectura;
        }

        if (permiteMcp && !esBrowser) disponibles = [...disponibles, ...mcpToolDefs];
        // El grant solo puede quitar herramientas de las ya permitidas por nivel.
        disponibles = subagentes.filtrarPorGrant(disponibles, definicion?.tools);

        const grant = definicion?.tools ?? [];
        const permiteSubagentes =
          !soloLectura &&
          !esBrowser &&
          (sub?.allowSubagents === true || definicion?.allowSubagents === true) &&
          (grant.length === 0 || grant.includes('invoke_subagent'));

        /*
         * Aislamiento de workspace.
         *
         * Un subagente con escritura que comparte directorio se pisa con sus
         * hermanos y con el padre. Con `share` trabaja sobre un git worktree con
         * su propia rama, y lo que escriba no toca la rama de trabajo.
         */
        let worktree = null;
        let cwdSubagente = state.cwd;
        if (sub?.workspace === 'share' || definicion?.workspace === 'share') {
          const creado = await worktreeMod.crear(state.cwd, `${nombre}`);
          if (creado.ok) {
            worktree = creado;
            cwdSubagente = creado.ruta;
          } else {
            // Sin worktree el subagente sigue, pero en el directorio común.
            send({
              type: 'notice',
              level: 'warn',
              text: `«${nombre}» no pudo aislarse (${creado.motivo}); trabajará en el directorio común.`,
            });
          }
        }

        const controlador = new AbortController();
        // Si el usuario cancela el turno padre, sus subagentes también paran.
        senalPadre?.addEventListener('abort', () => controlador.abort(), { once: true });
        if (senalPadre?.aborted) controlador.abort();
        /*
         * El presupuesto de fusión cancela este subagente concreto a través de
         * su señal. El registro conserva su propio controlador para que
         * `manage_subagent` lo siga viendo y pueda cancelarlo a mano.
         */
        senalExterna?.addEventListener('abort', () => controlador.abort(), { once: true });
        if (senalExterna?.aborted) controlador.abort();
        const identificador = subagentes.registrar({
          nombre,
          rol,
          controller: controlador,
          padre: padreSolicitado,
          profundidad,
        });

        /*
         * Delegación anidada: un solo nivel, solo en el workspace compartido y
         * con hijos de solo lectura. Los nietos no reciben invoke_subagent, así
         * que la profundidad está acotada por construcción; el presupuesto se
         * comparte con el turno.
         */
        if (permiteSubagentes && !worktree) {
          disponibles.push({
            name: 'invoke_subagent',
            description:
              'Lanza subagentes de SOLO LECTURA desde este subagente. No pueden escribir, ' +
              'usar MCP ni delegar a su vez; el presupuesto del turno es compartido.',
            parameters: invokeSubagentTool.parameters,
            async execute(nietos, ctxNietos) {
              const lista = (Array.isArray(nietos?.subagents) ? nietos.subagents : []).map(
                (nieto) => ({
                  ...nieto,
                  definition: undefined,
                  allowWrites: false,
                  allowMcp: false,
                  allowSubagents: false,
                  workspace: 'inherit',
                }),
              );
              return invokeSubagentTool.execute({
                subagents: lista,
                __padre: identificador,
                __profundidad: profundidad + 1,
                __soloLectura: true,
                __bloquear: true,
              }, ctxNietos);
            },
          });
        }

        const hooksSubagente = {
          getCwd: () => cwdSubagente,
          getReglas: () => prefs.hookRules ?? [],
          getLimite: () => Number(prefs.toolOutputLimit ?? 16000),
          getRestringir: () => state.prefs.restrictToWorkspace === true,
        };
        const herramientas = new ToolRegistry().registerAll(
          disponibles.map((tool) =>
            // En un subagente el monitor bloquea sin preguntar: no debe abrir diálogos.
            conHooks(
              conMonitorDeSeguridad(guardTool(tool, preset, prefs, () => mainWindow), {
                modo: modoMonitor === 'off' ? 'off' : 'block',
                confirmar: async () => false,
              }),
              hooksSubagente,
            ),
          ),
        );
        const emitir = (payload) => {
          if (payload.type === 'text' || payload.type === 'reasoning') return;

          // La trayectoria también registra los pasos del subagente en SU sesión.
          if (payload.type === 'tool_start') {
            trayectoria.abrirPaso(sessionIdSub, {
              herramienta: payload.call?.name ?? '',
              argumentos: payload.call?.arguments ?? {},
              llamadaId: payload.call?.id ?? null,
              mensaje: null,
              turno: turnoSub,
            });
          } else if (payload.type === 'tool_end') {
            trayectoria.cerrarPasoPorLlamada(sessionIdSub, payload.call?.id ?? null, {
              contenido: payload.content,
              esError: payload.isError,
            });
          }

          send({
            ...payload,
            subagent: identificador,
            subagentLabel: nombre,
            sessionId: sessionIdSub,
            ...(enTurnoDelPlanner ? { planner: true } : {}),
          });
        };

        // Los pasos y snapshots van a la conversación capturada, no a la que
        // esté abierta cuando el subagente termine.
        await trayectoria.asegurar(sessionIdSub).catch(() => {});

        const ejecutarAgente = (modelo) => runAgent(
            {
              provider,
              model: modelo,
              tools: herramientas,
              system:
                (definicion?.systemPrompt && definicion.systemPrompt.length > 0
                  ? definicion.systemPrompt
                  : `Eres un subagente con el papel de ${rol}. Trabajas para otro agente, no ` +
                    'para el usuario. Completa la tarea con las herramientas que tienes y ' +
                    'responde con un resumen conciso de lo que encontraste: hechos, rutas y ' +
                    'datos concretos. No incluyas la transcripción de cada paso.') +
                bloqueReglas +
                (permiteEscritura
                  ? ''
                  : ' No puedes modificar ficheros ni ejecutar comandos: si algo requiere ' +
                    'cambiarlo, dilo en el resumen y no lo intentes.') +
                (permiteMcp || mcpToolDefs.length === 0
                  ? ''
                  : ' Tampoco tienes acceso a las herramientas de los servidores MCP.') +
                (permiteSubagentes && !worktree
                  ? ' Puedes delegar en subagentes de solo lectura con invoke_subagent.'
                  : ''),
              maxSteps: Number(prefs.subagentMaxSteps ?? 10),
              /*
               * Un subagente que agota los pasos sin concluir deja al padre sin
               * respuesta. Medido: uno de dos no devolvió resumen y el principal
               * tuvo que leer el fichero él mismo, perdiendo el paralelismo.
               */
              mensajeFinalObligatorio:
                'Te quedan pocos pasos. Responde AHORA con lo que hayas averiguado, ' +
                'aunque sea parcial: qué encontraste, qué rutas y qué no pudiste ver.',
              contextWindow: ventanaDelTurno(modelo),
              onEvent: emitir,
              // Recoge lo que le manden con send_message entre pasos.
              mensajeDeSistema: () => subagentes.recogerMensajes(identificador),
            },
            tarea,
            {
              cwd: cwdSubagente,
              signal: controlador.signal,
              sessionId: sessionIdSub,
              turno: turnoSub,
            },
          );

        try {
          let resultado;
          try {
            resultado = await ejecutarAgente(state.model);
          } catch (error) {
            // El modelo del padre puede no existir en el proveedor del
            // subagente; solo ese fallo se reintenta con el default.
            if (!state.model || !esErrorDeModelo(error)) throw error;
            resultado = await ejecutarAgente('');
          }

          subagentes.marcarTerminado(identificador, 'terminado');

          let notaWorktree = '';
          if (worktree) {
            const cierre = await worktreeMod.cerrar(worktree.baseCwd ?? state.cwd, worktree);
            if (cierre.conservado) notaWorktree = `\n\n${cierre.nota}`;
          }

          return {
            nombre,
            rol,
            resumen: `${(resultado.text ?? '').trim()}${notaWorktree}`,
            error: null,
            sessionId: sessionIdSub,
          };
        } catch (error) {
          subagentes.marcarTerminado(identificador, 'error');
          if (worktree) {
            await worktreeMod.cerrar(worktree.baseCwd ?? cwdBaseSub, worktree).catch(() => {});
          }
          return {
            nombre,
            rol,
            resumen: '',
            error: error instanceof Error ? error.message : String(error),
            sessionId: sessionIdSub,
          };
        } finally {
          // Se deja un rato en el registro para que manage_subagent lo vea, y se libera.
          setTimeout(() => subagentes.liberar(identificador), 60_000).unref?.();
        }
      };

      /*
       * Ramas en paralelo con espera máxima (el `merge_subagents_latency_ms` del
       * original): lo que no llegue a tiempo se cancela y se fusiona el resto.
       *
       * No se espera aquí: el padre recupera el control y puede usar
       * send_message/manage_subagent mientras trabajan. El resumen entra como
       * mensaje de sistema en el siguiente paso o despierta un turno nuevo.
       */
      const presupuestoFusion = Number(prefs.subagentMergeLatencyMs ?? 180_000);
      const tareas = pedidos.map((sub, indice) => ({
        nombre: String(sub?.name ?? sub?.definition ?? `subagente-${indice + 1}`),
        ejecutar: (senal) => lanzar(sub, indice, senal, ctx?.signal),
      }));
      const formatear = (carrera) => {
        const resultados = carrera.resultados.map(
          (r) =>
            r.valor ?? { nombre: r.nombre, rol: '', resumen: '', error: r.error ?? 'sin resultado' },
        );
        const partes = resultados.map((r) =>
          r.error
            ? `## ${r.nombre} (${r.rol}) — FALLÓ\n${r.error}`
            : `## ${r.nombre} (${r.rol})\n${r.resumen.length > 0 ? r.resumen : '(sin resumen)'}`,
        );
        const fallos = resultados.filter((r) => r.error).length;
        return (
          `${resultados.length} subagente(s) terminaron` +
          (carrera.vencidos > 0 ? `, ${carrera.vencidos} cancelado(s) por tiempo` : '') +
          (fallos > carrera.vencidos ? `, ${fallos - carrera.vencidos} con error` : '') +
          `:\n\n${partes.join('\n\n')}`
        );
      };

      /*
       * Los nietos de un subagente bloquean: su padre necesita el resumen en el
       * mismo turno y no tiene la supervisión del usuario. El agente principal,
       * en cambio, recupera el control y puede mandar mensajes o matarlos.
       */
      if (args?.__bloquear === true) {
        const carrera = await correrEnParalelo(tareas, { presupuestoMs: presupuestoFusion });
        return { content: formatear(carrera), isError: false };
      }

      void correrEnParalelo(tareas, { presupuestoMs: presupuestoFusion })
        .then((carrera) => entregarResultadoSubagente(formatear(carrera), sessionIdOrigen))
        .catch((error) => {
          entregarResultadoSubagente(
            `Los subagentes fallaron: ${error instanceof Error ? error.message : String(error)}`,
            sessionIdOrigen,
          );
        });

      return {
        content:
          `Lanzados ${pedidos.length} subagente(s) en paralelo. ` +
          'Siguen trabajando; usa manage_subagent para ver sus ids y send_message para ' +
          'corregirles el rumbo. Los resúmenes llegarán como mensajes del sistema.',
        isError: false,
      };
    },
  };

  // -------------------------------------------------------------------------
  // Plan mode como ciclo planner ↔ executor
  // -------------------------------------------------------------------------

  const ciclo = new CicloDePlan({
    cada: Number(prefs.planReviewInterval ?? 8),
    maxRevisiones: Number(prefs.maxPlanReviews ?? 6),
    // Con 'Always Review' el turno empieza planificando: sin plan no se escribe.
    empezarPlanificando: (prefs.planReviewPolicy ?? 'Always Ask') === 'Always Review',
  });

  /** Lo que devuelve el turno del planner, si llega a entregar. */
  let entregaDelPlanner = null;

  /** true mientras corre el turno del planner, para etiquetar sus eventos. */
  let enTurnoDelPlanner = false;

  /** Herramienta del planner: entregar el plan y devolver el control. */
  const exitPlanTool = {
    name: 'exit_plan_mode',
    description:
      'Entrega el plan al ejecutor y le devuelve el control. Úsala cuando ya hayas ' +
      'revisado la ejecución: con los pasos que quedan, con un plan revisado, o parando.',
    parameters: {
      type: 'object',
      properties: {
        decision: {
          type: 'string',
          enum: ['continuar', 'revisar', 'parar'],
          description:
            'continuar: la ejecución va bien, entrega los pasos que quedan. ' +
            'revisar: se ha desviado, entrega un plan nuevo. parar: está terminada o el usuario pidió parar.',
        },
        summary: {
          type: 'string',
          description: 'Qué le dices al ejecutor en una o dos frases.',
        },
        steps: {
          type: 'array',
          description: 'Pasos que quedan por hacer (para continuar o revisar).',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Qué se hará.' },
              detail: { type: 'string', description: 'Detalle opcional.' },
            },
            required: ['title'],
          },
        },
      },
      required: ['decision', 'summary'],
    },
    async execute(args) {
      entregaDelPlanner = {
        decision: String(args?.decision ?? 'continuar'),
        summary: String(args?.summary ?? ''),
        steps: Array.isArray(args?.steps)
          ? args.steps.slice(0, 40).map((paso) => ({
              title: String(paso?.title ?? ''),
              detail: paso?.detail ? String(paso.detail) : '',
            }))
          : [],
      };
      return { content: 'Entregado al ejecutor.' };
    },
  };

  /** Herramienta del ejecutor: devolver el control al planificador. */
  const enterPlanTool = {
    name: 'enter_plan_mode',
    description:
      'Devuelve el control al planificador con un informe de estado. Obligatoria cuando ' +
      'hay una revisión pendiente: hasta que la llames, ninguna otra herramienta funciona.',
    parameters: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          description:
            'Informe de estado: qué pasos están hechos, qué verificaciones se ejecutaron y ' +
            'qué mostraron, los fallos repetidos, el trabajo fuera del plan, y qué queda.',
        },
      },
      required: ['reason'],
    },
    async execute(args) {
      const informe = String(args?.reason ?? '').slice(0, 4000);
      const handback = ciclo.devolverControl(informe);

      send({ type: 'plan_handoff', fase: 'revisando' });

      // Turno real del planner: otro system prompt y solo herramientas de lectura.
      entregaDelPlanner = null;
      const invokeSubagentBlocking = {
        ...invokeSubagentTool,
        async execute(args, ctx) {
          // El planificador solo verifica: sus subagentes tampoco escriben.
          return invokeSubagentTool.execute(
            { ...args, __bloquear: true, __soloLectura: true },
            ctx,
          );
        },
      };
      const hooksPlanner = {
        getCwd: () => state.cwd,
        getReglas: () => prefs.hookRules ?? [],
        getLimite: () => Number(prefs.toolOutputLimit ?? 16000),
        getRestringir: () => state.prefs.restrictToWorkspace === true,
      };
      const herramientasDelPlanner = new ToolRegistry().registerAll(
        [
          exitPlanTool,
          // El planner puede mandar verificaciones en paralelo sin ejecutar él nada.
          // Bloquea: necesita los resúmenes para decidir en este mismo turno.
          invokeSubagentBlocking,
          ...baseTools.filter((t) => HERRAMIENTAS_DE_LECTURA.has(t.name)),
        ].map((tool) =>
          conHooks(guardTool(tool, preset, prefs, () => mainWindow), hooksPlanner),
        ),
      );

      enTurnoDelPlanner = true;
      try {
        await runAgent(
          {
            provider,
            model: state.model,
            tools: herramientasDelPlanner,
            // La persona también manda en el sub-turno del planificador.
            system:
              SYSTEM_PROMPT + bloqueReglas + buildPromptExtras(state.prefs) + PROMPT_PLANNER + handback,
            maxSteps: 6,
            contextWindow: ventanaDelTurno(state.model),
            onEvent: (payload) => {
              // Todo el turno del planner se marca para que la UI lo agrupe.
              if (payload.type === 'usage' || payload.type === 'done') return;
              if (payload.type === 'tool_start' || payload.type === 'tool_end') {
                send({ ...payload, planner: true });
                return;
              }
              send({ ...payload, planner: true });
            },
          },
          'Revisa la ejecución y entrega con exit_plan_mode.',
          { cwd: state.cwd, signal: controller.signal },
        );
      } catch (error) {
        ciclo.cancelarRevision();
        return {
          content:
            'El planificador falló: ' +
            (error instanceof Error ? error.message : String(error)) +
            '. Continúa con el plan actual y avisa al usuario.',
          isError: true,
        };
      } finally {
        enTurnoDelPlanner = false;
      }

      const entrega = entregaDelPlanner;
      send({ type: 'plan_handoff', fase: 'entregado', decision: entrega?.decision ?? null });

      if (!entrega) {
        ciclo.cancelarRevision();
        return {
          content:
            'El planificador no entregó nada. Continúa con el plan actual y avisa al usuario.',
          isError: true,
        };
      }

      if (entrega.decision === 'parar') {
        return {
          content:
            `El planificador decidió PARAR: ${entrega.summary}\n\n` +
            'No sigas ejecutando. Informa al usuario de que la tarea está terminada o detenida.',
          isError: false,
        };
      }

      const pasos = entrega.steps.length > 0 ? entrega.steps : (ciclo.plan?.steps ?? []);
      ciclo.entregarPlan({ steps: pasos });

      const listado = pasos
        .map((paso, i) => `${i + 1}. ${paso.title}${paso.detail ? ` — ${paso.detail}` : ''}`)
        .join('\n');

      return {
        content:
          `El planificador respondió (${entrega.decision}): ${entrega.summary}\n\n` +
          `Plan vigente:\n${listado}\n\nContinúa desde ahí.`,
        isError: false,
      };
    },
  };

  const hookOptions = {
    getCwd: () => state.cwd,
    getReglas: () => prefs.hookRules ?? [],
    getLimite: () => Number(prefs.toolOutputLimit ?? 16000),
    getRestringir: () => state.prefs.restrictToWorkspace === true,
  };

  const opcionesMonitor = {
    modo: modoMonitor,
    ...(clasificarConModelo ? { clasificar: clasificarConModelo } : {}),
    alClasificar: (info) => {
      if (info.fase === 'inicio') {
        send({ type: 'guardian_check', herramienta: info.herramienta, callId: info.callId });
      } else if (info.clasificacion) {
        send({
          type: 'guardian_result',
          herramienta: info.herramienta,
          callId: info.callId,
          severidad: info.clasificacion.severity,
          motivo: info.clasificacion.reason,
          nivel: info.clasificacion.nivel,
          cacheado: info.clasificacion.cacheado,
        });
      } else {
        send({ type: 'guardian_result', herramienta: info.herramienta, callId: info.callId, fallo: true });
      }
    },
    confirmar: async (info) => {
      const ventana = mainWindow;
      if (!ventana) return false;

      const detalle =
        `Severidad ${info.severidad}/10\n\n` +
        `Señales detectadas:\n${info.senales.map((s) => `· ${s}`).join('\n') || '· (ninguna)'}\n\n` +
        `Argumentos:\n${JSON.stringify(info.args, null, 2).slice(0, 600)}`;

      const respuesta = await dialog.showMessageBox(ventana, {
        type: 'warning',
        buttons: ['Cancelar', 'Permitir igualmente'],
        defaultId: 0,
        cancelId: 0,
        title: 'Monitor de seguridad',
        message: `El monitor de seguridad ha marcado «${info.herramienta}»`,
        detail: detalle,
      });

      return respuesta.response === 1;
    },
  };

  /** Envuelve una tool con permisos, monitor de seguridad y hooks. */
  const envolverTool = (tool) =>
    conHooks(
      conMonitorDeSeguridad(guardTool(tool, preset, prefs, () => mainWindow), opcionesMonitor),
      hookOptions,
    );

  const guardedTools = [planTool, askQuestionTool, askUserTool, enterPlanTool, invokeSubagentTool, defineSubagentTool, manageSubagentTool, makeSendMessageTool(), scheduleTool, notifyUserTool, runTestsTool, browserSubagent, ...baseTools].map(envolverTool);

  const tools = new ToolRegistry().registerAll(guardedTools);

  // `send` se define antes que nada que lo use: el bucle de plugins y las
  // herramientas de MCP ya lo necesitan al construirse.
  const send = (payload) => {
    if (!event.sender.isDestroyed()) {
      event.sender.send('chat:event', payload);
    }
  };

  // Plugins: servidores MCP persistentes, reutilizados entre turnos.
  const plugins = await cargarPlugins(state.cwd, prefs);
  const mcpClients = plugins.porNombre;

  if (plugins.nuevo) {
    for (const error of plugins.errores) {
      send({ type: 'error', message: `Plugin ${error.nombre}: ${error.message}` });
    }
  }

  for (const tool of plugins.herramientas) {
    let name = tool.name;
    let sufijo = 2;
    while (tools.has(name)) {
      name = `${tool.name}_${sufijo}`;
      sufijo += 1;
    }
    const conNombre = { ...tool, name, mcp: true };
    mcpToolDefs.push(conNombre);
    tools.register(envolverTool(conNombre));
  }
  // Recursos y prompts de MCP: herramientas genéricas que reciben el servidor.
  if (mcpClients.size > 0) {
    const resolver = (nombre) => {
      const buscado = String(nombre ?? '').trim();
      if (buscado.length === 0) return mcpClients.size === 1 ? [...mcpClients.values()][0] : null;
      for (const [clave, cliente] of mcpClients) {
        if (clave.toLowerCase() === buscado.toLowerCase()) return cliente;
      }
      return null;
    };

    const nombres = () => [...mcpClients.keys()].join(', ');

    tools.register(
      conMonitorDeSeguridad(guardTool(
        {
          name: 'list_resources',
          description:
            'Lista los recursos que exponen los servidores MCP conectados. ' +
            'Si hay varios servidores, indica cuál te interesa.',
          parameters: {
            type: 'object',
            properties: {
              server: { type: 'string', description: 'Nombre del servidor MCP. Opcional.' },
            },
          },
          async execute(args) {
            const buscado = String(args?.server ?? '').trim();
            const objetivos = buscado.length > 0
              ? [[buscado, resolver(buscado)]]
              : [...mcpClients.entries()];

            const partes = [];
            for (const [nombre, cliente] of objetivos) {
              if (!cliente) {
                return { content: `No existe el servidor MCP "${nombre}". Hay: ${nombres()}`, isError: true };
              }
              try {
                const recursos = await cliente.listResources();
                partes.push(
                  recursos.length === 0
                    ? `## ${nombre}\n(sin recursos)`
                    : `## ${nombre}\n` +
                        recursos
                          .map((r) => `- ${r.uri} · ${r.name}${r.description ? ` — ${r.description}` : ''}`)
                          .join('\n'),
                );
              } catch (error) {
                partes.push(`## ${nombre}\nError: ${error instanceof Error ? error.message : String(error)}`);
              }
            }
            return { content: partes.join('\n\n') };
          },
        },
        preset,
        prefs,
        () => mainWindow,
      ), opcionesMonitor),
    );

    tools.register(
      conMonitorDeSeguridad(guardTool(
        {
          name: 'read_resource',
          description:
            'Lee un recurso concreto de un servidor MCP: un fichero, una tabla o cualquier ' +
            'dato que el servidor exponga por URI. Primero lista con `list_resources` para ' +
            'saber qué hay y con qué URI.',
          parameters: {
            type: 'object',
            properties: {
              server: { type: 'string', description: 'Nombre del servidor MCP.' },
              uri: { type: 'string', description: 'URI del recurso, tal como la lista list_resources.' },
            },
            required: ['server', 'uri'],
          },
          async execute(args) {
            const cliente = resolver(args?.server);
            if (!cliente) {
              return { content: `No existe el servidor MCP "${args?.server}". Hay: ${nombres()}`, isError: true };
            }
            try {
              const leido = await cliente.readResource(String(args?.uri ?? ''));
              return {
                content:
                  `Recurso ${args.uri}` +
                  (leido.mimeType ? ` (${leido.mimeType})` : '') +
                  `:\n\n${leido.text}`,
              };
            } catch (error) {
              return {
                content: `No se pudo leer: ${error instanceof Error ? error.message : String(error)}`,
                isError: true,
              };
            }
          },
        },
        preset,
        prefs,
        () => mainWindow,
      ), opcionesMonitor),
    );

    tools.register(
      conMonitorDeSeguridad(guardTool(
        {
          name: 'list_prompts',
          description: 'Lista las plantillas de prompt que exponen los servidores MCP.',
          parameters: {
            type: 'object',
            properties: {
              server: { type: 'string', description: 'Nombre del servidor MCP. Opcional.' },
            },
          },
          async execute(args) {
            const buscado = String(args?.server ?? '').trim();
            const objetivos = buscado.length > 0 ? [[buscado, resolver(buscado)]] : [...mcpClients.entries()];

            const partes = [];
            for (const [nombre, cliente] of objetivos) {
              if (!cliente) {
                return { content: `No existe el servidor MCP "${nombre}". Hay: ${nombres()}`, isError: true };
              }
              try {
                const prompts = await cliente.listPrompts();
                partes.push(
                  prompts.length === 0
                    ? `## ${nombre}\n(sin prompts)`
                    : `## ${nombre}\n` +
                        prompts
                          .map((p) => {
                            const argsTexto = (p.arguments ?? [])
                              .map((a) => `${a.name}${a.required ? '*' : ''}`)
                              .join(', ');
                            return `- ${p.name}${argsTexto ? ` (${argsTexto})` : ''}${p.description ? ` — ${p.description}` : ''}`;
                          })
                          .join('\n'),
                );
              } catch (error) {
                partes.push(`## ${nombre}\nError: ${error instanceof Error ? error.message : String(error)}`);
              }
            }
            return { content: partes.join('\n\n') };
          },
        },
        preset,
        prefs,
        () => mainWindow,
      ), opcionesMonitor),
    );

    tools.register(
      conMonitorDeSeguridad(guardTool(
        {
          name: 'use_prompt',
          description: 'Obtiene una plantilla de prompt de un servidor MCP, ya rellenada con sus argumentos.',
          parameters: {
            type: 'object',
            properties: {
              server: { type: 'string', description: 'Nombre del servidor MCP.' },
              name: { type: 'string', description: 'Nombre del prompt, tal como lo lista list_prompts.' },
              arguments: {
                type: 'object',
                description: 'Valores de los argumentos del prompt. Todos como texto.',
              },
            },
            required: ['server', 'name'],
          },
          async execute(args) {
            const cliente = resolver(args?.server);
            if (!cliente) {
              return { content: `No existe el servidor MCP "${args?.server}". Hay: ${nombres()}`, isError: true };
            }
            const valores = {};
            for (const [clave, valor] of Object.entries(args?.arguments ?? {})) {
              valores[clave] = String(valor);
            }
            try {
              const prompt = await cliente.getPrompt(String(args?.name ?? ''), valores);
              return { content: prompt.text };
            } catch (error) {
              return {
                content: `No se pudo obtener: ${error instanceof Error ? error.message : String(error)}`,
                isError: true,
              };
            }
          },
        },
        preset,
        prefs,
        () => mainWindow,
      ), opcionesMonitor),
    );
  }


  // Memoria entre conversaciones: solo se inyecta al empezar un hilo, no en cada
  // turno, para no reenviar los mismos recuerdos una y otra vez.
  let bloqueMemorias = '';
  if (state.messages.length === 0 && state.prefs.memoryEnabled !== false) {
    try {
      const recuerdos = await getMemoria().relevant(
        state.cwd,
        Number(state.prefs.memoriesToConsider ?? 6),
      );
      bloqueMemorias = bloqueDeMemorias(recuerdos);
      if (recuerdos.length > 0) {
        await getMemoria().marcarUsadas(recuerdos.map((m) => m.id));
      }
    } catch {
      bloqueMemorias = '';
    }
  }

  /** Memorias activadas por tocar un fichero, pendientes de entrar en el siguiente paso. */
  const memoriasPorGlob = new Map();

  const initialCount = state.messages.length;
  currentTurnKey = initialCount;
  cambiosDelTurno = [];

  // Acumuladores para los hooks de texto.
  let textoDelTurno = '';
  let razonamientoDelTurno = '';

  // Skills del workspace: solo el catálogo entra en contexto, el cuerpo se carga
  // bajo demanda con la herramienta `skill`.
  let skillsDelProyecto = [];
  try {
    skillsDelProyecto = await descubrirSkills(state.cwd);
  } catch {
    skillsDelProyecto = [];
  }

  /*
   * Reglas del proyecto: AGENTS.md y .agents/rules, con presupuesto propio.
   * Antes no se cargaban y el agente ignoraba las convenciones del repo.
   */
  let bloqueReglas = '';
  if (state.prefs.rulesEnabled !== false) {
    try {
      const reglas = await descubrirReglas(state.cwd);
      const tokens = Number(state.prefs.rulesBudget ?? RULES_BUDGET_TOKENS);
      bloqueReglas = bloqueDeReglas(reglas, tokens * 4);
    } catch {
      bloqueReglas = '';
    }
  }
  if (!turnCheckpoints.has(initialCount)) turnCheckpoints.set(initialCount, new Map());

  // El nivel elegido se traduce al campo que entiende este proveedor, solo
  // cuando el usuario ha encendido el pensamiento.
  const nivelDePensamientoDelTurno = ajustesDePensamientoDelTurno(effort, state.model);

  try {
    const systemPrompt =
      SYSTEM_PROMPT +
      bloqueReglas +
      planReviewInstruction(state.prefs.planReviewPolicy ?? 'Always Ask') +
      bloqueDeSkills(skillsDelProyecto) +
      effortInstruction(effort, nivelDePensamientoDelTurno) +
      buildPromptExtras(state.prefs) +
      bloqueMemorias;

    /*
     * Depuración: el interruptor de Ajustes promete enseñar el prompt de cada
     * turno. Se manda como evento propio, una vez, y la interfaz lo pliega.
     */
    if (state.prefs.debugShowSystemPrompt === true) {
      send({ type: 'system_prompt', text: systemPrompt });
    }

    const entradaFormateada = input.includes('<USER_REQUEST>')
      ? input
      : `<USER_REQUEST>\n${input}\n</USER_REQUEST>\n<ADDITIONAL_METADATA>\nThe current local time is: ${new Date().toISOString()}.\n</ADDITIONAL_METADATA>`;

    const result = await runAgent(
      {
        provider,
        model: state.model,
        tools,
        system: systemPrompt,
        ...nivelDePensamientoDelTurno,
        maxSteps: Number(state.prefs.maxSteps ?? 40),

        contextWindow: ventanaDelTurno(state.model),
        maxToolChars: 16_000,
        toolTimeoutMs: Number(state.prefs.toolTimeoutMs ?? 120_000),
        // Plan mode: la compuerta rechaza herramientas según la fase del ciclo.
        toolGate: (call) => {
          const rechazo = ciclo.compuerta(call);
          if (!rechazo) ciclo.contarInvocacion();
          return rechazo;
        },
        mensajeDeSistema: () => {
          const partes = [];
          // Memorias por patrón de fichero: entran una sola vez, en el paso siguiente.
          if (memoriasPorGlob.size > 0) {
            partes.push([...memoriasPorGlob.values()].join('\n'));
            memoriasPorGlob.clear();
          }
          // Una tarea terminada mientras el turno seguía abierto entra aquí.
          if (notaDeTareaPendiente) {
            partes.push(notaDeTareaPendiente);
            notaDeTareaPendiente = null;
          }
          const avisoDelPlan = ciclo.mensajePendiente();
          if (avisoDelPlan) partes.push(avisoDelPlan);
          // Resúmenes de subagentes que terminaron entre pasos, aunque el
          // turno que los lanzó ya haya cerrado.
          const resultadosSubagentes = extraerResultadosSubagentes(state.sessionId);
          if (resultadosSubagentes.length > 0) {
            partes.push(...resultadosSubagentes);
          }
          return partes.length > 0 ? partes.join('\n\n') : null;
        },
        ...(images.length > 0 ? { images } : {}),
        ...(state.messages.length > 0 ? { initialMessages: state.messages } : {}),
        onEvent: (payload) => {
          /*
           * Hooks sobre el texto del modelo. Los deltas se muestran tal cual para no
           * romper el streaming; al terminar se aplican las reglas y, si algo cambió,
           * se manda el texto definitivo para que la UI lo repinte.
           */
          if (payload.type === 'stream_reset') {
            textoDelTurno = '';
            razonamientoDelTurno = '';
            send({ type: 'stream_reset' });
            return;
          }

          if (payload.type === 'text') {
            textoDelTurno += payload.text;
          } else if (payload.type === 'reasoning') {
            razonamientoDelTurno += payload.text;
            const recorte = aplicarHooksDeRazonamiento(razonamientoDelTurno, {
              limite: Number(prefs.reasoningLimit ?? 20000),
            });
            if (recorte.recortado) {
              razonamientoDelTurno = recorte.texto;
              send({ type: 'reasoning_replace', text: recorte.texto });
              return;
            }
          } else if (payload.type === 'done') {
            const aplicado = aplicarHooksDeTexto(textoDelTurno, {
              reglas: prefs.textHooks ?? [],
              quitarRelleno: prefs.stripBoilerplate === true,
            });
            if (aplicado.notas.length > 0 && aplicado.texto !== textoDelTurno) {
              send({ type: 'text_replace', text: aplicado.texto });
            }
          }

          // El monitor de ritmo se muestra como nota del sistema, no como mensaje.
          if (payload.type === 'nudge') {
            send({ type: 'system_note', text: payload.text });
            return;
          }

          // Trayectoria: cada llamada a herramienta es un paso con sus snapshots.
          if (payload.type === 'tool_start') {
            // La trayectoria asigna el índice: es monotónico por conversación.
            const paso = trayectoria.abrirPaso(claveDeTrayectoria(), {
              herramienta: payload.call?.name ?? '',
              argumentos: payload.call?.arguments ?? {},
              llamadaId: payload.call?.id ?? null,
              mensaje: null,
              turno: currentTurnKey,
            });
            /*
             * Memoria por patrón de fichero (`CORTEX_MEMORY_TRIGGER_GLOB`): si la
             * herramienta escribe en un fichero que una memoria declara, esa
             * memoria entra en el siguiente paso. Solo al escribir, para no
             * inundar el contexto con cada lectura.
             */
            if (['write_file', 'edit_file', 'multi_replace'].includes(payload.call?.name)) {
              const args = payload.call?.arguments ?? {};
              const ruta = args.path ?? args.file_path ?? args.filePath;
              if (typeof ruta === 'string' && ruta.length > 0 && memoriasPorGlob.size < 3) {
                const relativa = path.isAbsolute(ruta) ? path.relative(state.cwd, ruta) : ruta;
                void getMemoria()
                  .porGlob([relativa, ruta])
                  .then((encontradas) => {
                    for (const memoria of encontradas) {
                      if (memoriasPorGlob.has(memoria.id)) continue;
                      memoriasPorGlob.set(memoria.id, `[memoria activada por ${memoria.ruta}] ${memoria.texto}`);
                    }
                  })
                  .catch(() => {});
              }
            }
            // La fila de la UI necesita saber a qué paso corresponde para el revert.
            send({ ...payload, stepIndex: paso?.indice ?? null });
            return;
          } else if (payload.type === 'tool_end') {
            trayectoria.cerrarPasoPorLlamada(claveDeTrayectoria(), payload.call?.id ?? null, {
              contenido: payload.content,
              esError: payload.isError,
            });
          }

          send(payload);
        },
      },
      entradaFormateada,
      {
        cwd: state.cwd,
        signal: controller.signal,
        sessionId: state.sessionId,
        turno: currentTurnKey,
      },
    );

    state.messages = result.messages;

    // `saveHistory` desactivado = la conversación vive solo en memoria.
    if (state.sessionId && state.prefs.saveHistory !== false) {
      try {
        const sessions = await getStore();
        // En disco, sin secretos evidentes: el historial se relee al reabrir.
        await enColaTienda(() => sessions.append(state.sessionId, mensajesParaDisco(result.appended)));
      } catch {
        // guardar es best-effort: no rompe la conversación
      }
    }

    send({
      type: 'final',
      reason: result.reason,
      steps: result.steps,
      maxSteps: Number(state.prefs.maxSteps ?? 40),
      keepCount: initialCount,
      sessionId: state.sessionId,
    });

    // Primer turno: sustituye el título recortado por uno semántico, como su
    // interfaz. Se lanza después de «final» para no retrasar la respuesta.
    if (initialCount === 0 && state.sessionId && state.prefs.saveHistory !== false) {
      const sessionId = state.sessionId;
      const rawUsuario = result.messages.find((m) => m.role === 'user')?.content ?? '';
      const matchRequest = rawUsuario.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/);
      const primerUsuario = matchRequest ? matchRequest[1].trim() : rawUsuario;
      const ultimoAsistente =
        [...result.messages].reverse().find((m) => m.role === 'assistant' && m.content)?.content ?? '';
      let providerTitulo;
      try {
        providerTitulo = createProvider(state.providerId, buildProviderConfig());
      } catch {
        providerTitulo = provider;
      }
      void generarTituloDeConversacion(providerTitulo, state.model, primerUsuario, ultimoAsistente)
        .then(async (titulo) => {
          if (!titulo) return;
          if (!puedeRenombrarAutomatico(titulosManuales, sessionId)) return;
          const sessions = await getStore();
          await enColaTienda(() => sessions.rename(sessionId, titulo));
          send({ type: 'session_title', sessionId, title: titulo });
        })
        .catch((error) => {
          console.error('[titulo] fallo', error?.message ?? error);
        });
    }

    if (state.prefs.notifications === true) {
      try {
        const { Notification } = require('electron');
        if (Notification.isSupported()) {
          new Notification({
            title: 'Opengravity',
            body: result.reason === 'error' ? 'El agente terminó con errores.' : 'El agente ha terminado.',
          }).show();
        }
      } catch {
        // las notificaciones son best-effort
      }
    }
    return { ok: true, sessionId: state.sessionId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (abortSolicitado && controller.signal.aborted) {
      send({ type: 'aborted', sessionId: state.sessionId });
      return { ok: true, aborted: true };
    }
    send({ type: 'error', message });
    return { ok: false, error: message };
  } finally {
    currentAbort = null;
    abortSolicitado = false;
    currentTurnKey = null;
    state.busy = false;
    send({ type: 'busy', busy: false });
    void cerrarTareasAgenteDelTurno();

    // Si un subagente terminó justo cuando el turno cerraba, su resumen no
    // puede quedarse en el array: se entrega como despertar.
    const resultadosSubagentes = extraerResultadosSubagentes(state.sessionId);
    if (resultadosSubagentes.length > 0 && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('task:wake', {
        texto: resultadosSubagentes.join('\n\n'),
        sessionId: state.sessionId,
      });
    }
  }
  } catch (error) {
    // El try interno cubre el bucle; esto cubre fallos de preparación
    // (proveedor desconocido, sesión, plugins). Sin esto el invoke se rechaza
    // y la UI se queda sin burbuja de error.
    const message = error instanceof Error ? error.message : String(error);
    if (!event.sender.isDestroyed()) {
      event.sender.send('chat:event', { type: 'error', message });
    }
    return { ok: false, error: message };
  } finally {
    // Solo se libera aquí si el turno no llegó a la compuerta de ejecución
    // (mensaje vacío, workspace ausente, proveedor sin modelos...).
    if (state.busy) {
      state.busy = false;
      currentAbort = null;
      abortSolicitado = false;
      if (!event.sender.isDestroyed()) {
        event.sender.send('chat:event', { type: 'busy', busy: false });
      }
    }
  }
});

// ---------------------------------------------------------------------------
// Ciclo de vida
// ---------------------------------------------------------------------------

app.whenReady().then(async () => {
  await loadSettings();

  // La poda usa la preferencia ya cargada; antes corría con prefs vacías y
  // siempre aplicaba 30 días.
  const diasTrayectoria = Number(state.prefs.trajectoryRetentionDays ?? 30);
  if (Number.isFinite(diasTrayectoria) && diasTrayectoria > 0) {
    trayectoria.podarAntiguas(diasTrayectoria).catch(() => {});
  }

  // TOFU SSH: la primera huella se guarda; las siguientes deben coincidir.
  sshRemoto.workspace.setOnHostKey((host, port, fingerprint) => {
    const clave = `${host}:${port}`;
    if (state.prefs.sshTrusted?.[clave] === fingerprint) return;
    state.prefs = {
      ...state.prefs,
      sshTrusted: { ...(state.prefs.sshTrusted ?? {}), [clave]: fingerprint },
    };
    saveSettings().catch(() => {});
  });

  // Fixture de los verificadores: proyecto desechable sin tocar Ajustes.
  const testProjectIndex = process.argv.indexOf('--opengravity-test-new-project');
  if (testProjectIndex >= 0 && process.argv[testProjectIndex + 1]) {
    const proyectoTemporal = path.resolve(process.argv[testProjectIndex + 1]);
    await fsp.mkdir(proyectoTemporal, { recursive: true });
    state.cwd = proyectoTemporal;
    state.project = proyectoTemporal;
    registrarRaiz(state.cwd);
    registrarProyecto(state.cwd);
  }

  /*
   * Descargas del navegador integrado: van a la carpeta elegida en Ajustes o a
   * la de Descargas del sistema, sin preguntar cada vez.
   */
  try {
    const { session } = require('electron');
    const sesionNavegador = session.fromPartition('persist:opengravity-browser');
    sesionNavegador.on('will-download', (_event, item) => {
      const carpeta = state.prefs.downloadPath || app.getPath('downloads');
      const destino = path.join(carpeta, item.getFilename());
      item.setSavePath(destino);
      contadorDescargas += 1;
      const entrada = {
        id: `dl-${Date.now()}-${contadorDescargas}`,
        filename: item.getFilename(),
        url: item.getURL(),
        path: destino,
        totalBytes: item.getTotalBytes(),
        receivedBytes: item.getReceivedBytes(),
        state: 'progressing',
        startedAt: new Date().toISOString(),
      };
      descargas.unshift(entrada);
      if (descargas.length > 20) descargas.length = 20;
      const emitir = () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('downloads:update', descargas);
        }
      };
      emitir();
      item.on('updated', () => {
        entrada.receivedBytes = item.getReceivedBytes();
        entrada.totalBytes = item.getTotalBytes();
        emitir();
      });
      item.once('done', (_e, estado) => {
        entrada.state = String(estado);
        entrada.receivedBytes = item.getReceivedBytes();
        emitir();
      });
    });
  } catch {
    // sin sesión de navegador no hay descargas que redirigir
  }

  // Tareas programadas: revisa cada minuto.
  startScheduler();

  // Retención de historial: al arrancar y cada 6 horas.
  applyRetention().catch(() => {});
  setInterval(() => applyRetention().catch(() => {}), 6 * 60 * 60 * 1000).unref?.();

  // Sirve el renderer bajo app:// para habilitar workers.
  protocol.handle('app', async (request) => {
    /* Contención: resolverRutaApp resuelve la ruta contra la raíz de la app y
     * comprueba que no se salga. Sin esto, `app://local/..%5C..%5CUsers%5Cx`
     * (barra invertida codificada) se resolvía fuera y devolvía ficheros
     * ajenos a la aplicación. */
    const raizApp = path.resolve(app.getAppPath());
    const filePath = resolverRutaApp(raizApp, request.url);
    if (filePath === null) {
      return new Response('no encontrado', { status: 404 });
    }
    return net.fetch(pathToFileURL(filePath).href);
  });

  createWindow();

  // El motor, la reparación de sesiones y los embeddings no retrasan la ventana.
  void getEngine().catch((error) => {
    console.error('No se pudo cargar el motor:', error);
  });

  try {
    await codeIndex.loadEmbeddings(embeddingsPath());
  } catch {
    // sin cache previa
  }

  /*
   * Reparación única: sesiones guardadas con el contenido como objeto
   * ({ texto, encontrados }) se quedaban en «[object Object]» al reabrir.
   */
  try {
    const store = await getStore();
    if (typeof store.repararContenidoObjeto === 'function') {
      const arreglo = await store.repararContenidoObjeto();
      if (arreglo.mensajes > 0) {
        console.log();
      }
    }
  } catch (error) {
    console.error('[sesiones] no se pudo reparar el contenido:', error);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

/**
 * Limpieza de salida. Devuelve una promesa que hay que esperar.
 *
 * El orden importa: primero se cierran las terminales y los comandos (que son
 * los que tienen hijos vivos), y solo después se suelta lo demás.
 */
async function limpiezaAlSalir() {
  // Suelta la unidad SSHFS antes de que muera el proceso.
  try { await sshfs.desmontarTodos(); } catch {}
  try {
    cerrarTodasLasPty();
  } catch {
    // sin terminales abiertas
  }

  try {
    // Mata también los comandos en segundo plano y sus árboles de procesos.
    await require('./tools-extra.cjs').matarTodasLasTareas();
  } catch {
    // sin tareas o módulo no cargado
  }

  // La terminal simple no está en el mapa de tareas del agente: se cierra aquí.
  if (terminalProcess) {
    try {
      await require('./tools-extra.cjs').matarTarea({
        id: 'terminal',
        pid: terminalProcess.pid,
      });
    } catch {
      // ya terminado
    }
    terminalProcess = null;
  }

  for (const [, client] of lspClients) {
    try {
      client.stop();
    } catch {
      // ya cerrado
    }
  }
  lspClients.clear();

  // El proxy del navegador del agente no debe quedar vivo.
  try {
    require('./tools-extra.cjs').detenerProxyNavegador();
  } catch {
    // módulo no cargado
  }

  // Los servidores MCP persistentes mueren con la app.
  await cerrarPlugins().catch(() => {});

  // Los snapshots de trayectoria se vuelcan aquí para no perder el último turno.
  try {
    await trayectoria.volcarTodo();
  } catch {
    // sin nada que volcar
  }

  await stopRemote();
}

let saliendo = false;

/*
 * Al cerrar, la app aplaza su salida hasta que la limpieza termina. Antes
 * lanzaba `taskkill` y salía sin esperar: el proceso moría primero y los
 * comandos en segundo plano se quedaban vivos, sin ventana que los cerrara.
 * El plazo es la red de seguridad: pase lo que pase, la app se cierra.
 */
app.on('before-quit', (event) => {
  if (saliendo) return;
  event.preventDefault();
  saliendo = true;

  const plazo = new Promise((listo) => {
    const t = setTimeout(listo, 4000);
    t.unref?.();
  });

  Promise.race([limpiezaAlSalir(), plazo])
    .catch(() => {})
    .finally(() => app.exit(0));
});
