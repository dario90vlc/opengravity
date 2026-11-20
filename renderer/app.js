'use strict';

/**
 * Lógica del renderer.
 *
 * Sin frameworks y sin build: DOM directo. Toda la comunicación con el motor
 * pasa por `window.api` (ver electron/preload.cjs).
 */

const $ = (id) => document.getElementById(id);

const els = {
  projectName: $('project-name'),
  projectPill: $('project-pill-label'),
  conversationList: $('conversation-list'),
  thread: $('thread'),
  threadInner: $('thread-inner'),
  threadEmpty: $('thread-empty'),
  input: $('composer-input'),
  form: $('composer-form'),
  send: $('btn-send'),
  modelLabel: $('model-label'),
  effortLabel: $('effort-label'),
  btnNew: $('btn-new-conversation'),
  btnNew2: $('btn-new-conversation-2'),
  btnNewLogo: $('btn-new-conversation-3'),
  btnNewSection: $('btn-new-conversation-4'),
  btnToggleSidebar: $('btn-toggle-sidebar'),
  btnGoBack: $('btn-go-back'),
  btnGoForward: $('btn-go-forward'),
  btnDisplayOptions: $('btn-display-options'),
  btnOpenWorkspace: $('btn-open-workspace'),
  btnSettings: $('btn-settings'),
  btnModel: $('btn-model-selector'),
  btnSearch: $('btn-search'),
  btnProjectSelector: $('btn-project-selector'),

  modelPopover: $('model-popover'),
  modelPopoverBody: $('model-popover-body'),
  commandPopover: $('command-popover'),
  commandPopoverBody: $('command-popover-body'),
  mentionPopover: $('mention-popover'),
  mentionPopoverBody: $('mention-popover-body'),

  auxPanel: $('aux-panel'),
  terminalXterm: $('terminal-xterm'),
  terminalLegacy: $('terminal-legacy'),
  terminalOutput: $('terminal-output'),
  terminalInput: $('terminal-input'),
  terminalCwd: $('terminal-cwd'),

  editorPane: $('editor-pane'),
  overviewPanel: $('overview-panel'),
  editorTabs: $('editor-tabs'),
  editorPath: $('editor-path'),
  editorState: $('editor-state'),
  editorLsp: $('editor-lsp'),

  menubar: $('menubar'),
  sidebar: document.querySelector('.sidebar'),
  divider: document.querySelector('.divider'),
  btnToggleTop: $('btn-toggle-sidebar-top'),
  sidebarSearch: $('sidebar-search'),
  searchInput: $('search-input'),
  contextMenu: $('context-menu'),

  settingsModal: $('settings-modal'),
};

/** Estado local de la UI. */
/**
 * Niveles de pensamiento, de menos a más esfuerzo.
 *
 * La escala es la del motor del agente: cada nivel se traduce al campo que
 * entiende el proveedor (`reasoning_effort`, presupuesto de tokens o
 * `thinkingLevel`), así que elegir aquí cambia de verdad cuánto piensa.
 */
const ESCALA_DE_ESFUERZO = ['Minimal', 'Low', 'Medium', 'High', 'XHigh', 'Max'];

/** Qué significa cada nivel, para el tooltip. */
const ETIQUETA_DE_ESFUERZO = {
  Minimal: 'Respuesta más corta posible',
  Low: 'Directo, pocos pasos',
  Medium: 'Equilibrio entre brevedad y rigor',
  High: 'Razona y verifica antes de responder',
  XHigh: 'Descompone, contrasta y revisa dos veces',
  Max: 'Razonamiento máximo: alternativas y verificación',
};
const ui = {
  busy: false,
  busyConversation: null,
  loadingConversation: false,
  planEjecutando: false,
  // Despertares de tareas que llegaron con el turno ocupado.
  despertaresPendientes: [],
  activeConversation: null,
  streamingEl: null,
  /** Catálogo de proveedores con disponibilidad y modelos. */
  providers: [],
  providerId: null,
  model: null,
  cwd: null,
  /** Proyecto asociado a la conversación actual; null es «No Project». */
  project: null,
  /** Proyectos registrados por el proceso principal. */
  projects: [],
  /** La conversación actual no está asociada a un proyecto. */
  noProject: false,
  /** Sesiones cargadas, para filtrar sin volver a consultar. */
  sessions: [],
  /** Texto del buscador de conversaciones. */
  query: '',
  /** Barra lateral colapsada. */
  sidebarCollapsed: false,
  effort: 'Medium',
  overviewView: null,
  dictation: null,
  pendingImages: [],
  reasoningEl: null,
  reasoningText: '',
  reasoningStartedAt: 0,
  subagentGroups: new Map(),
  referencesRegistered: false,
  tabs: [],
  activeTab: null,
  editors: [null, null],
  activeGroup: 0,
  split: false,
  /** Preferencias activas (contraste, sonido, cola…). */
  prefs: {},
  /** Nombre de la cuenta del sistema, para el saludo del estado vacío. */
  userName: '',
  /** Pensamiento extendido activado en el chat (solo si el modelo lo admite). */
  thinking: false,
  /** Mensajes pendientes cuando el agente está ocupado. */
  queue: [],
  /** Cambia en cada apertura de conversación: descarta cargas viejas. */
  loadToken: 0,
  /** Catálogo de herramientas con su permiso. */
  tools: [],
  /** Catálogo de skills. */
  skills: [],
  /** Estado del servidor de control remoto. */
  remote: { running: false, url: null },
  /** Texto acumulado del mensaje en curso, para re-renderizar el markdown. */
  streamingText: '',
  attachments: [],
  /** Indica si se ejecutaron herramientas antes del siguiente trozo de texto en el mismo turno. */
  huboHerramientasEnTurno: false,
  /** Grupo colapsable "Worked for" de la ejecución en curso. */
  toolGroup: null,
  /** Resumen del turno que envuelve pensamiento y herramientas. */
  workWrapper: null,
  /** Archivos que el agente ha tocado en esta conversación. */
  touchedFiles: new Map(),
  /** Panel de overview visible. */
  overviewOpen: false,
  /** Tarjeta de plan pendiente de decisión (aprobarla o escribir para revisar). */
  planCard: null,
  /** Elemento del indicador de carga en curso. */
  loadingEl: null,
  /** Temporizador del indicador. */
  loadingTimer: null,
  /** Índice seleccionado en la paleta de comandos. */
  commandIndex: 0,
  /** Comandos que coinciden con lo escrito. */
  commandMatches: [],
  /** Índice de ficheros del workspace. */
  fileIndex: [],
  /** Menciones que coinciden con lo escrito. */
  mentionMatches: [],
  /** Índice seleccionado en la paleta de menciones. */
  mentionIndex: 0,
  /** Fichero abierto en el editor. */
  editorPath: null,
  /** Contenido original, para detectar cambios sin guardar. */
  editorOriginal: '',
  /** Diagnósticos LSP del fichero abierto. */
  diagnostics: [],
  /** Entradas de autocompletado visibles. */
  completions: [],
  /** Índice seleccionado en el autocompletado. */
  completionIndex: 0,
  /** Temporizador del aviso de cambios al LSP. */
  lspChangeTimer: null,
};

/**
 * Comandos del composer, invocados escribiendo `/`.
 * Es lo que promete el placeholder «/ for actions».
 */
const COMMANDS = [
  { id: 'plan', label: '/plan', hint: 'Pedir un plan numerado antes de cambiar código' },
  { id: 'model', label: '/model', hint: 'Cambiar de modelo' },
  { id: 'clear', label: '/clear', hint: 'Empezar una conversación nueva' },
  { id: 'settings', label: '/settings', hint: 'Abrir los ajustes' },
  { id: 'browser', label: '/browser <url>', hint: 'Abrir una URL en el navegador integrado' },
  { id: 'btw', label: '/btw <pregunta>', hint: 'Pregunta lateral sin tocar el hilo' },
  { id: 'ssh', label: '/ssh', hint: 'Abrir una terminal SSH remota' },
  { id: 'remote', label: '/remote [ruta]', hint: 'Abrir el navegador de ficheros remoto' },
  { id: 'stop', label: '/stop', hint: 'Detener la ejecución en curso' },
  { id: 'help', label: '/help', hint: 'Ver todos los comandos' },
];

/**
 * Etiquetas legibles de las herramientas.
 * Antigravity no muestra el nombre técnico: muestra qué hizo.
 */
/*
 * Etiquetas de herramienta en lenguaje natural, como las suyas: describen la
 * intención («list files in current directory»), no la función.
 * Medido en su DOM: el nivel de cada llamada es una fila de 32 px, radio 8,
 * 4px 8px, 14/20, en `--muted-foreground`, con sangrado de 12 px por nivel.
 */
const TOOL_LABELS = {
  read_file: 'read file',
  list_directory: 'list directory contents',
  write_file: 'write file',
  edit_file: 'edit file',
  multi_replace: 'edit several parts of file',
  run_command: 'run command',
  run_tests: 'run tests',
  command_status: 'check command status',
  search_files: 'search in files',
  file_search: 'find files',
  search_code: 'search code',
  search_web: 'search the web',
  fetch_url: 'fetch URL',
  open_url: 'open URL',
  view_code_item: 'read a symbol',
  list_resources: 'list MCP resources',
  read_resource: 'read MCP resource',
  list_prompts: 'list MCP prompts',
  use_prompt: 'use MCP prompt',
  define_subagent: 'define a subagent',
  invoke_subagent: 'launch subagents',
  manage_subagent: 'manage subagents',
  send_message: 'message a subagent',
  manage_task: 'manage background tasks',
  ask_user_question: 'ask the user',
  notify_user: 'schedule a notice',
  present_plan: 'present a plan',
  run_workflow: 'run a workflow',
  browser_open: 'open the browser',
  browser_read: 'read the page',
  browser_click: 'click on the page',
  browser_eval: 'run JS on the page',
};

/**
 * Texto de la llamada, como el suyo: «Ran <acción en palabras>».
 *
 * Medido en su DOM: cada fila de llamada dice «Ran list files in current
 * directory» o «Ran count files including hidden» — una frase que describe la
 * intención, no el nombre de la herramienta.
 */
function friendlyTool(name, args) {
  const a = args ?? {};
  const base = TOOL_LABELS[name] ?? String(name).replace(/_/g, ' ');

  const detalle =
    a.path ?? a.Path ?? a.filePath ?? a.TargetFile ?? a.file ?? a.pattern ?? a.query ?? a.Query ?? a.url ?? a.Url ?? a.command ?? a.CommandLine;

  const corto =
    typeof detalle === 'string' && detalle.length > 0 && detalle.length <= 60 ? detalle : null;

  switch (name) {
    case 'list_directory':
      return corto && corto !== '.' ? `Ran list files in ${corto}` : 'Ran list files in current directory';
    case 'read_file':
      return corto ? `Read ${corto}` : 'Read file';
    case 'run_command': {
      /*
       * Su fila es «Ran <frase de la tarea>» («Ran verify date calculation»).
       * El comando exacto va dentro de la tarjeta; aquí va el `taskName` o el comando.
       */
      const tarea = typeof a.taskName === 'string' && a.taskName.trim().length > 0
        ? a.taskName.trim().slice(0, 60)
        : (typeof a.toolSummary === 'string' && a.toolSummary.trim().length > 0
          ? a.toolSummary.trim().slice(0, 60)
          : (typeof a.command === 'string' && a.command.trim().length > 0
            ? a.command.trim().slice(0, 60)
            : (typeof a.CommandLine === 'string' && a.CommandLine.trim().length > 0
              ? a.CommandLine.trim().slice(0, 60)
              : '')));
      return tarea ? `Ran ${tarea}` : 'Ran command';
    }
    case 'search_files':
    case 'file_search':
    case 'search_code':
      return corto ? `Searched "${corto}"` : 'Searched';
    case 'write_file':
      return corto ? `Created ${corto}` : 'Created file';
    case 'edit_file':
      return corto ? `Edited ${corto}` : 'Edited file';
    case 'multi_replace':
      return corto ? `Edited ${corto}` : 'Edited several parts of a file';
    case 'run_tests':
      return 'Ran the test suite';
    case 'fetch_url':
    case 'open_url':
      return corto ? `Ran open ${corto}` : 'Ran open URL';
    default:
      return corto ? `Ran ${base}: ${corto}` : `Ran ${base}`;
  }
}

// ---------------------------------------------------------------------------
// Render de conversaciones
// ---------------------------------------------------------------------------

async function refreshConversations() {
  try {
    ui.sessions = await window.api.listSessions();
  } catch {
    ui.sessions = [];
  }

  renderConversations();
  marcarConversacionOcupada();
  renderPaneTitle();
}

/** Marca la conversación que está ejecutando el agente. */
function marcarConversacionOcupada() {
  for (const fila of document.querySelectorAll('.conversation[data-session-id]')) {
    fila.classList.toggle(
      'is-busy',
      Boolean(ui.busy && fila.dataset.sessionId === (ui.busyConversation ?? ui.activeConversation)),
    );
  }
}

function renderConversations() {
  els.conversationList.replaceChildren();

  const query = ui.query.trim().toLowerCase();

  /*
   * Medido: 5 de 43 conversaciones eran «Nueva conversación» sin usar, y su
   * interfaz no las lista. Se descartan salvo que estén abiertas o que el
   * usuario esté buscando algo.
   */
  const sinUsar = (session) =>
    (session.title ?? '') === 'Nueva conversación' && session.id !== ui.activeConversation;

  const visible = (query
    ? ui.sessions.filter((session) => (session.title ?? '').toLowerCase().includes(query))
    : ui.sessions
  ).filter((session) => !sinUsar(session));

  if (visible.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'sidebar__empty';
    empty.textContent = query ? 'Sin resultados' : 'Sin conversaciones';
    els.conversationList.append(empty);
    return;
  }

  /*
   * Medido en su DOM: las conversaciones de un proyecto van anidadas bajo su
   * fila, con `padding-left: 30px` (título en x=38). Las demás van en la lista
   * de «Conversations». Se separan por `cwd`.
   */
  const delProyecto = visible.filter(
    (s) => ui.project && ((s.project ?? s.cwd) === ui.project),
  );
  const otras = visible.filter(
    (s) => !ui.project || (s.project ?? s.cwd) !== ui.project,
  );

  const listaProyecto = document.getElementById('project-conversations');
  if (listaProyecto) listaProyecto.replaceChildren();

  const crearFila = (session, anidada) => {
    const row = document.createElement('div');
    row.className = anidada ? 'conversation conversation--project-child' : 'conversation';
    if (session.id === ui.activeConversation) row.classList.add('is-active');
    row.dataset.sessionId = session.id;
    row.title = session.title;

    const title = document.createElement('span');
    title.className = 'conversation__title';
    title.textContent = session.title;
    row.append(title);

    // Hora relativa a la derecha, como en su interfaz (12m, 1h, 9d).
    const time = document.createElement('span');
    time.className = 'conversation__time';
    time.textContent = relativeTime(session.updatedAt ?? session.createdAt);
    row.append(time);

    const kebab = document.createElement('button');
    kebab.className = 'conversation__kebab';
    // Icono, no el glifo ⋯: el original dibuja un svg de 16 px.
    kebab.innerHTML = window.Icon('more', 16);
    kebab.title = 'Opciones';
    kebab.addEventListener('click', (event) => {
      event.stopPropagation();
      openContextMenu(event.clientX, event.clientY, [
        {
          label: 'Abrir',
          onClick: () => openConversation(session.id),
        },
        {
          label: 'Borrar conversación',
          danger: true,
          onClick: () => deleteConversation(session.id),
        },
      ]);
    });
    row.append(kebab);

    row.addEventListener('click', () => openConversation(session.id));
    return row;
  };

  // Anidadas bajo el proyecto, y el resto en «Conversations».
  for (const session of delProyecto) {
    const fila = crearFila(session, true);
    (listaProyecto ?? els.conversationList).append(fila);
  }
  for (const session of otras) {
    els.conversationList.append(crearFila(session, false));
  }

  // Si no queda ninguna conversación suelta, el bloque de «Conversations» se oculta.
  const seccion = els.conversationList.closest('.sidebar__section');
  if (seccion) seccion.hidden = otras.length === 0;
}

async function deleteConversation(id) {
  if (ui.busy) {
    addNotice('No se puede borrar una conversación mientras el agente trabaja.', 'info');
    return;
  }
  try {
    await window.api.deleteSession(id);
    if (ui.activeConversation === id) newConversation();
    await refreshConversations();
  } catch (error) {
    console.error('No se pudo borrar la conversación:', error);
  }
}

// ---------------------------------------------------------------------------
// Menú contextual
// ---------------------------------------------------------------------------

function openContextMenu(x, y, items) {
  const menu = els.contextMenu;
  menu.replaceChildren();

  for (const item of items) {
    const btn = document.createElement('button');
    btn.className = 'menu__item';
    btn.textContent = item.label;
    if (item.selected) btn.classList.add('is-selected');
    if (item.danger) btn.style.color = 'var(--danger)';
    btn.addEventListener('click', () => {
      closeContextMenu();
      item.onClick();
    });
    menu.append(btn);
  }

  menu.removeAttribute('hidden');
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;

  // Ajuste si se sale por la derecha o por abajo.
  const rect = menu.getBoundingClientRect();
  if (rect.right > window.innerWidth - 8) menu.style.left = `${window.innerWidth - rect.width - 8}px`;
  if (rect.bottom > window.innerHeight - 8) menu.style.top = `${window.innerHeight - rect.height - 8}px`;
}

function closeContextMenu() {
  els.contextMenu.setAttribute('hidden', '');
}

/* ===================== Selector de proyecto ===================== */

let projectMenu = null;
let projectSubmenu = null;

/** Cierra el selector y su submenú. */
function cerrarProjectMenu() {
  projectMenu?.remove();
  projectSubmenu?.remove();
  projectMenu = null;
  projectSubmenu = null;
  document.getElementById('btn-project-selector-inline')?.setAttribute('aria-expanded', 'false');
}

/** Proyectos registrados, de más reciente a más antiguo. */
function proyectosRecientes() {
  return (ui.projects ?? [])
    .filter((p) => p && typeof p.path === 'string')
    .map((p) => ({
      cwd: p.path,
      name: p.name || nombreProyecto(p.path),
      updatedAt: Date.parse(p.lastUsed ?? '') || 0,
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

function nombreProyecto(cwd) {
  const proyecto = (ui.projects ?? []).find((p) => p.path === cwd);
  return proyecto?.name || basename(cwd) || String(cwd ?? '');
}

/** Relee la lista persistida de proyectos. */
async function cargarProyectos() {
  try {
    ui.projects = (await window.api.listProjects()) ?? [];
  } catch {
    ui.projects = [];
  }
}

/** Refleja en la barra y el selector el proyecto activo. */
function reflejarProyecto(cwd, etiqueta) {
  ui.cwd = cwd;
  ui.project = cwd;
  ui.noProject = false;
  const nombre = etiqueta || nombreProyecto(cwd);
  els.projectName.textContent = nombre;
  if (els.projectPill) els.projectPill.textContent = nombre;
  actualizarEtiquetaProyecto(nombre);
  window.SettingsUI?.refresh?.();
}

/** Refleja un estado «No Project» sin tocar el workspace de las herramientas. */
function reflejarSinProyecto() {
  ui.project = null;
  ui.noProject = true;
  els.projectName.textContent = 'No Project';
  if (els.projectPill) els.projectPill.textContent = 'No Project';
  actualizarEtiquetaProyecto('No Project');
  window.SettingsUI?.refresh?.();
}

/** Activa un proyecto reciente sin abrir el diálogo del sistema. */
async function seleccionarProyecto(cwd) {
  if (ui.busy) { addNotice('Espera a que el agente termine o pulsa Detener antes de cambiar de proyecto.', 'info'); return; }
  if (!cwd) return;
  cerrarProjectMenu();
  const resultado = await window.api.selectProject(cwd);
  if (!resultado || resultado.ok === false) {
    addNotice(resultado?.error ?? 'No se pudo abrir el proyecto.', 'error');
    return;
  }
  ui.cwd = resultado.cwd;
  reflejarProyecto(resultado.project ?? resultado.cwd);
  await cargarProyectos();
  await refreshConversations();
  await loadFileIndex();
  await refreshGit();
}

/** Activa un proyecto remoto ya descargado en el espejo local. */
async function abrirProyectoRemoto(resultado) {
  if (ui.busy) { addNotice('Espera a que el agente termine o pulsa Detener antes de cambiar de proyecto.', 'info'); return; }
  if (!resultado?.ok) {
    addNotice(resultado?.error ?? 'No se pudo abrir el proyecto remoto.', 'error');
    return;
  }
  ui.remoteWorkspace = resultado.remote ?? null;
  ui.cwd = resultado.cwd;
  reflejarProyecto(resultado.cwd, resultado.remote?.label);
  await cargarProyectos();
  await refreshConversations();
  await loadFileIndex();
  await refreshGit();
}

/** «No Project»: no cambia el workspace; solo desasocia la conversación actual. */
async function seleccionarSinProyecto() {
  if (ui.busy) { addNotice('Espera a que el agente termine o pulsa Detener antes de cambiar de proyecto.', 'info'); return; }
  cerrarProjectMenu();
  const resultado = await window.api.clearProject();
  if (!resultado || resultado.ok === false) {
    addNotice(resultado?.error ?? 'No se pudo desasociar el proyecto.', 'error');
    return;
  }
  reflejarSinProyecto();
  await refreshConversations();
}

/** Fila de un proyecto dentro de Recent o This Computer. */
function filaProyecto(proyecto, { primero = false } = {}) {
  const nombre = proyecto.name || nombreProyecto(proyecto.cwd);
  const fila = document.createElement('div');
  fila.className = 'project-menu__item';
  if (primero) fila.classList.add('is-highlighted');
  fila.setAttribute('role', 'menuitem');
  fila.tabIndex = 0;
  fila.title = proyecto.cwd;

  const icono = document.createElement('span');
  icono.className = 'project-menu__icon';
  icono.innerHTML = window.Icon('project', 16);
  icono.setAttribute('data-project-icon', 'folder');

  const texto = document.createElement('span');
  texto.className = 'project-menu__label';
  texto.textContent = nombre;
  texto.title = nombre;

  const ajustes = document.createElement('button');
  ajustes.type = 'button';
  ajustes.className = 'project-menu__gear';
  ajustes.setAttribute('aria-label', 'Project Settings');
  ajustes.title = 'Project Settings';
  ajustes.innerHTML = window.Icon('settings', 14);
  ajustes.addEventListener('click', async (event) => {
    event.stopPropagation();
    await seleccionarProyecto(proyecto.cwd);
    window.SettingsUI.open('project');
  });

  fila.append(icono, texto, ajustes);
  fila.addEventListener('click', () => void seleccionarProyecto(proyecto.cwd));
  fila.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      void seleccionarProyecto(proyecto.cwd);
    }
  });
  return fila;
}

/** Fila con icono para las acciones fijas del pie. */
function filaAccionEtiqueta({ icono, texto, onClick }) {
  const fila = document.createElement('div');
  fila.className = 'project-menu__item';
  fila.setAttribute('role', 'menuitem');
  fila.tabIndex = 0;
  const ic = document.createElement('span');
  ic.className = 'project-menu__icon';
  ic.innerHTML = window.Icon(icono, 16);
  const label = document.createElement('span');
  label.className = 'project-menu__label';
  label.textContent = texto;
  fila.append(ic, label);
  fila.addEventListener('click', onClick);
  fila.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onClick();
    }
  });
  return fila;
}

/** Submenú «This Computer» con búsqueda. */
function abrirThisComputer(menu, ancla) {
  projectSubmenu?.remove();
  const submenu = document.createElement('div');
  submenu.className = 'project-menu project-menu--submenu';
  submenu.setAttribute('role', 'menu');

  const buscador = document.createElement('label');
  buscador.className = 'project-menu__search';
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Search Projects…';
  input.setAttribute('aria-label', 'Search Projects…');
  buscador.append(input);

  const lista = document.createElement('div');
  lista.className = 'project-menu__list';

  const pintar = () => {
    const filtro = input.value.trim().toLowerCase();
    lista.replaceChildren();
    const proyectos = proyectosRecientes().filter((p) =>
      (p.name || nombreProyecto(p.cwd)).toLowerCase().includes(filtro),
    );
    for (const proyecto of proyectos) lista.append(filaProyecto(proyecto));
    if (proyectos.length === 0) {
      const vacio = document.createElement('div');
      vacio.className = 'project-menu__empty';
      vacio.textContent = 'Sin proyectos';
      lista.append(vacio);
    }
  };
  input.addEventListener('input', pintar);
  pintar();

  submenu.append(buscador, lista);
  document.body.append(submenu);

  const menuRect = menu.getBoundingClientRect();
  const anclaRect = ancla.getBoundingClientRect();
  submenu.style.left = `${Math.min(window.innerWidth - submenu.offsetWidth - 8, menuRect.right - 1)}px`;
  submenu.style.top = `${Math.max(8, anclaRect.top - 4)}px`;
  projectSubmenu = submenu;
  input.focus();
}

/** Abre el menú del selector de proyecto. */
function abrirProjectSelector(anchor = document.getElementById('btn-project-selector-inline')) {
  if (!anchor) return;
  cerrarProjectMenu();
  closeContextMenu();
  anchor.setAttribute('aria-expanded', 'true');

  const menu = document.createElement('div');
  menu.className = 'project-menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', 'Select project');

  const scroll = document.createElement('div');
  scroll.className = 'project-menu__list';
  const recientes = proyectosRecientes();

  if (recientes.length > 0) {
    const cabecera = document.createElement('div');
    cabecera.className = 'project-menu__section';
    cabecera.setAttribute('role', 'presentation');
    cabecera.textContent = 'Recent';
    scroll.append(cabecera);
    recientes.forEach((proyecto, indice) => {
      scroll.append(filaProyecto(proyecto, { primero: indice === 0 }));
    });
  }

  const thisComputer = filaAccionEtiqueta({
    icono: 'computer',
    texto: 'This Computer',
    onClick: (event) => {
      event.stopPropagation();
      abrirThisComputer(menu, thisComputer);
    },
  });
  scroll.append(thisComputer);

  const nuevo = filaAccionEtiqueta({
    icono: 'addProject',
    texto: 'New Project',
    onClick: async () => {
      cerrarProjectMenu();
      const resultado = await window.api.createProject();
      if (!resultado) return;
      if (resultado.ok === false) {
        addNotice(resultado.error ?? 'No se pudo crear el proyecto.', 'error');
        return;
      }
      ui.cwd = resultado.cwd;
      await cargarProyectos();
      reflejarProyecto(resultado.project ?? resultado.cwd);
      await refreshConversations();
    },
  });
  scroll.append(nuevo);

  const sinProyecto = filaAccionEtiqueta({
    icono: 'projectOff',
    texto: 'No Project',
    onClick: seleccionarSinProyecto,
  });
  scroll.append(sinProyecto);

  menu.append(scroll);
  document.body.append(menu);

  const rect = anchor.getBoundingClientRect();
  menu.style.left = `${Math.min(window.innerWidth - menu.offsetWidth - 8, rect.left + 2.5)}px`;
  menu.style.top = `${Math.max(8, rect.top - menu.offsetHeight - 4)}px`;
  projectMenu = menu;
}

// ---------------------------------------------------------------------------
// Barra lateral
// ---------------------------------------------------------------------------

function setSidebarCollapsed(collapsed) {
  ui.sidebarCollapsed = collapsed;
  els.sidebar.classList.toggle('is-collapsed', collapsed);
  els.divider.classList.toggle('is-collapsed', collapsed);
  // La rejilla del cuerpo es la que anima el ancho de la columna.
  document.querySelector('.body')?.classList.toggle('is-sidebar-collapsed', collapsed);
  window.api.setPrefs({ sidebarCollapsed: collapsed }).catch(() => {});
}

function toggleSidebar() {
  setSidebarCollapsed(!ui.sidebarCollapsed);
}

function toggleSearch(force) {
  const show = force ?? els.sidebarSearch.hasAttribute('hidden');
  if (show) {
    els.sidebarSearch.removeAttribute('hidden');
    els.searchInput.focus();
    els.searchInput.select();
  } else {
    els.sidebarSearch.setAttribute('hidden', '');
    ui.query = '';
    els.searchInput.value = '';
    renderConversations();
  }
}

// ---------------------------------------------------------------------------
// Menús de la barra de título
// ---------------------------------------------------------------------------

function closeMenus() {
  for (const panel of document.querySelectorAll('.menu__panel')) {
    panel.setAttribute('hidden', '');
  }
  for (const btn of document.querySelectorAll('[data-menu]')) {
    btn.classList.remove('is-open');
  }
}

function toggleMenu(name) {
  const panel = document.querySelector(`[data-panel="${name}"]`);
  const button = document.querySelector(`[data-menu="${name}"]`);
  if (!panel || !button) return;

  const wasOpen = !panel.hasAttribute('hidden');
  closeMenus();
  if (!wasOpen) {
    panel.removeAttribute('hidden');
    button.classList.add('is-open');
  }
}

async function runMenuAction(action) {
  closeMenus();

  switch (action) {
    case 'open-workspace':
      await changeWorkspace();
      break;
    case 'reload':
      window.location.reload();
      break;
    case 'settings':
      window.SettingsUI.open();
      break;
    case 'settings-models':
      window.SettingsUI.open('models');
      break;
    case 'settings-appearance':
      window.SettingsUI.open('appearance');
      break;
    case 'settings-notifications':
      window.SettingsUI.open('notifications');
      break;
    case 'toggle-sidebar':
      toggleSidebar();
      break;
    case 'search':
      if (ui.sidebarCollapsed) setSidebarCollapsed(false);
      toggleSearch(true);
      break;
    case 'minimize':
      await window.api.minimize();
      break;
    case 'toggle-maximize':
      await window.api.toggleMaximize();
      break;
    case 'close':
      await window.api.closeWindow();
      break;
    case 'zoom-in':
      await window.api.zoom(0.5);
      break;
    case 'zoom-out':
      await window.api.zoom(-0.5);
      break;
    case 'zoom-reset':
      await window.api.zoom(0);
      break;
    case 'devtools':
      await window.api.toggleDevTools();
      break;
    default:
      console.warn('acción de menú desconocida:', action);
  }
}

async function changeWorkspace() {
  if (ui.busy) { addNotice('Espera a que el agente termine o pulsa Detener antes de cambiar de proyecto.', 'info'); return; }
  const result = await window.api.openWorkspace();
  if (!result) return;
  await cargarProyectos();
  reflejarProyecto(result.cwd);
  await refreshConversations();
  await loadFileIndex();
  await refreshGit();
}

// ---------------------------------------------------------------------------
// Mensajes
// ---------------------------------------------------------------------------

function clearThread() {
  els.threadInner.replaceChildren();
  ui.streamingEl = null;
  ui.streamingText = '';
  ui.huboHerramientasEnTurno = false;
  ui.toolGroup = null;
  ui.workWrapper = null;
  ui.subagentGroups = new Map();
  ui.plannerGroup = null;
  ui.reasoningEl = null;
  ui.reasoningText = '';
  ui.touchedFiles = new Map();
  renderNavigator();
  renderOverview();
  updateEmptyState();
}

function addUserMessage(text, messageIndex) {
  const wrap = document.createElement('div');
  wrap.className = 'msg msg--user';
  if (typeof messageIndex === 'number') wrap.dataset.messageIndex = String(messageIndex);

  // Estructura medida en su DOM: burbuja ancha con texto y barra flotante.
  const bubble = document.createElement('div');
  bubble.className = 'msg__bubble';

  const inner = document.createElement('div');
  inner.className = 'msg__bubble-inner';
  inner.textContent = text;

  const bar = document.createElement('div');
  bar.className = 'msg__hover-bar';

  const now = new Date();
  const time = document.createElement('span');
  time.className = 'msg__hover-time';
  time.textContent = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.className = 'msg__hover-btn';
  copyBtn.setAttribute('aria-label', 'Copy');
  copyBtn.innerHTML = window.Icon('copy', 14);
  copyBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(text).catch(() => {});
  });

  const revertBtn = document.createElement('button');
  revertBtn.type = 'button';
  revertBtn.className = 'msg__hover-btn';
  revertBtn.setAttribute('aria-label', 'Undo to this point');
  revertBtn.dataset.testid = 'revert-button';
  revertBtn.innerHTML = window.Icon('undo', 14);
  revertBtn.addEventListener('click', () => {
    // El índice del DOM no sirve: el historial incluye mensajes `tool` que no
    // se pintan como `.msg`. Se usa el índice real guardado por el motor.
    const guardado = Number(wrap.dataset.messageIndex);
    if (Number.isFinite(guardado) && wrap.dataset.messageIndex !== undefined) {
      revertTo(guardado);
      return;
    }
    const messages = [...els.threadInner.querySelectorAll('.msg')];
    const index = messages.indexOf(wrap);
    if (index >= 0) revertTo(index);
  });

  bar.append(time, copyBtn, revertBtn);
  bubble.append(inner, bar);

  wrap.append(bubble);
  els.threadInner.append(wrap);
  renderNavigator();
  updateEmptyState();
  scrollToBottom();
}

function addAssistantMessage() {
  // Un marcador de imagen de un turno anterior no debe quedarse colgado.
  document.querySelectorAll('[data-image-loading]').forEach((m) => m.remove());

  const wrap = document.createElement('div');
  wrap.className = 'msg msg--assistant';

  const bubble = document.createElement('div');
  bubble.className = 'msg__bubble msg__bubble--md';
  bubble.textContent = '';

  wrap.append(bubble);
  els.threadInner.append(wrap);
  ui.streamingEl = bubble;
  ui.streamingText = '';
  scrollToBottom();
  return bubble;
}

/**
 * Tarjeta de diff.
 *
 * Muestra el cambio propuesto por el agente. Con `proposalId` pide aprobación;
 * sin él, solo informa de un cambio ya aplicado.
 */
function addDiffCard(payload, proposalId) {
  const card = document.createElement('div');
  card.className = 'diff-card';

  const header = document.createElement('div');
  header.className = 'diff-card__header';

  const title = document.createElement('span');
  title.className = 'diff-card__path';
  title.textContent = payload.path;
  title.title = payload.path;

  const stats = document.createElement('span');
  stats.className = 'diff-card__stats';
  const add = document.createElement('span');
  add.className = 'diff-card__add';
  add.textContent = `+${payload.additions}`;
  const del = document.createElement('span');
  del.className = 'diff-card__del';
  del.textContent = `−${payload.removals}`;
  stats.append(add, del);

  header.append(title, stats);
  if (payload.isNew) {
    const badge = document.createElement('span');
    badge.className = 'diff-card__badge';
    badge.textContent = 'nuevo';
    header.append(badge);
  }

  const body = document.createElement('div');
  body.className = 'diff-card__body';

  for (const row of payload.rows ?? []) {
    const line = document.createElement('div');
    line.className = `diff-line diff-line--${row.type}`;

    const num = document.createElement('span');
    num.className = 'diff-line__num';
    num.textContent = row.type === 'add' ? String(row.newLine ?? '') : String(row.oldLine ?? '');

    const sign = document.createElement('span');
    sign.className = 'diff-line__sign';
    sign.textContent = row.type === 'add' ? '+' : row.type === 'remove' ? '−' : ' ';

    const text = document.createElement('span');
    text.className = 'diff-line__text';
    text.textContent = row.text;

    line.append(num, sign, text);
    body.append(line);
  }

  card.append(header, body);

  if (proposalId) {
    const actions = document.createElement('div');
    actions.className = 'diff-card__actions';

    const reject = document.createElement('button');
    reject.type = 'button';
    reject.className = 'btn';
    reject.textContent = 'Rechazar';

    const accept = document.createElement('button');
    accept.type = 'button';
    accept.className = 'btn btn--primary';
    accept.textContent = 'Aplicar';

    card.dataset.proposalId = String(proposalId);
    const resolve = async (accepted) => {
      accept.disabled = true;
      reject.disabled = true;
      const respuesta = await window.api.respondDiff(proposalId, accepted);
      if (respuesta && respuesta.ok === false) {
        actions.replaceChildren(rowText('La propuesta ya no está disponible'));
        card.classList.add('is-cancelled');
        return;
      }
      actions.replaceChildren(rowText(accepted ? 'Aplicado' : 'Rechazado'));
    };

    reject.addEventListener('click', () => resolve(false));
    accept.addEventListener('click', () => resolve(true));

    actions.append(reject, accept);
    card.append(actions);
  } else {
    const note = document.createElement('div');
    note.className = 'diff-card__applied';
    note.textContent = 'Aplicado';
    card.append(note);
  }

  els.threadInner.append(card);
  scrollToBottom();
  return card;
}

/**
 * Barra de acciones bajo una respuesta, como la de Antigravity:
 * marca de tiempo + copiar + deshacer.
 */
function addMessageToolbar(keepCount, markdown, etiquetaDeTiempo) {
  const bar = document.createElement('div');
  bar.className = 'msg__toolbar';

  const time = document.createElement('span');
  time.className = 'msg__time';
  time.textContent = etiquetaDeTiempo ?? 'just now';

  const actions = document.createElement('div');
  actions.className = 'msg__actions';

  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.className = 'msg__action';
  copyBtn.title = 'Copiar';
  copyBtn.setAttribute('aria-label', 'Copiar');
  copyBtn.innerHTML = window.Icon('copy', 16);
  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(markdown ?? '');
      copyBtn.style.color = 'var(--success)';
      setTimeout(() => {
        copyBtn.style.color = '';
      }, 1200);
    } catch {
      // portapapeles no disponible
    }
  });

  actions.append(copyBtn);

  // Reacciones 👍 / 👎 persistidas por turno.
  const reactionKey = `${ui.activeConversation ?? 'new'}:${keepCount ?? 'x'}`;
  const stored = (ui.prefs.reactions ?? {})[reactionKey] ?? null;

  const makeReaction = (kind, symbol, label) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'msg__action';
    btn.title = label;
    btn.setAttribute('aria-label', label);
    btn.innerHTML = window.Icon(symbol, 16);
    if (stored === kind) btn.classList.add('is-active');

    btn.addEventListener('click', () => {
      const all = { ...(ui.prefs.reactions ?? {}) };
      const next = all[reactionKey] === kind ? null : kind;
      if (next) all[reactionKey] = next;
      else delete all[reactionKey];

      ui.prefs.reactions = all;
      window.api.setPrefs({ reactions: all }).catch(() => {});

      for (const sibling of actions.querySelectorAll('[data-reaction]')) {
        sibling.classList.toggle('is-active', sibling.dataset.reaction === next);
      }
    });

    btn.dataset.reaction = kind;
    return btn;
  };

  actions.append(
    makeReaction('up', 'thumbUp', 'Buena respuesta'),
    makeReaction('down', 'thumbDown', 'Mala respuesta'),
  );

  if (typeof keepCount === 'number' && keepCount >= 0) {
    const undoBtn = document.createElement('button');
    undoBtn.type = 'button';
    undoBtn.className = 'msg__action';
    undoBtn.title = 'Deshacer hasta aquí';
    undoBtn.setAttribute('aria-label', 'Deshacer hasta aquí');
    undoBtn.innerHTML = window.Icon('undo', 16);
    undoBtn.addEventListener('click', () => revertTo(keepCount));
    actions.append(undoBtn);
  }

  bar.append(time, actions);
  els.threadInner.append(bar);
  return bar;
}

/**
 * Muestra el indicador de trabajo con tiempo transcurrido.
 * Equivale a `agent-loading` de Antigravity.
 */
function showLoading() {
  hideLoading();

  const row = document.createElement('div');
  row.className = 'agent-loading';

  const spinner = document.createElement('span');
  spinner.className = 'agent-loading__spinner';

  const label = document.createElement('span');
  label.className = 'agent-loading__label';
  label.textContent = 'Trabajando…';

  const elapsed = document.createElement('span');
  elapsed.className = 'agent-loading__elapsed';
  elapsed.textContent = '0s';

  row.append(spinner, label, elapsed);
  els.threadInner.append(row);
  ui.loadingEl = row;

  const startedAt = Date.now();
  ui.loadingTimer = setInterval(() => {
    const seconds = Math.round((Date.now() - startedAt) / 1000);
    elapsed.textContent = `${seconds}s`;
  }, 1000);

  scrollToBottom();
}

/** Retira el indicador de trabajo. */
function hideLoading() {
  if (ui.loadingTimer) {
    clearInterval(ui.loadingTimer);
    ui.loadingTimer = null;
  }
  if (ui.loadingEl) {
    ui.loadingEl.remove();
    ui.loadingEl = null;
  }
}

/** Convierte el botón de enviar en botón de parar mientras el agente trabaja. */
function setSendMode(busy) {
  if (!els.send) return;

  if (busy) {
    els.send.disabled = false;
    els.send.classList.add('is-stop');
    els.send.title = 'Detener';
    els.send.innerHTML =
      '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><rect x="4" y="4" width="8" height="8" rx="1.5" /></svg>';
  } else {
    els.send.classList.remove('is-stop');
    els.send.title = 'Enviar';
    els.send.innerHTML = window.Icon('send', 16);
  }
}

/** Anota el archivo que tocó una herramienta, para el panel de Files. */
function noteTouchedFile(call) {
  const path = call.arguments && call.arguments.path;
  if (typeof path !== 'string' || path.length === 0) return;

  const kind = call.name === 'write_file' ? 'written' : 'read';
  const previous = ui.touchedFiles.get(path);
  if (!previous || kind === 'written') {
    ui.touchedFiles.set(path, kind);
  }
  renderOverview();
}

// ---------------------------------------------------------------------------
// Navegador de turnos
// ---------------------------------------------------------------------------

/** Tiempo relativo corto: 12m, 1h, 9d. */
function relativeTime(value) {
  if (!value) return '';
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return '';

  const minutes = Math.floor((Date.now() - then) / 60000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;

  return `${Math.floor(days / 7)}w`;
}

/** Abre el gestor de tareas programadas. */
async function openScheduled() {
  const modal = document.getElementById('scheduled-modal');
  if (!modal) return;

  modal.removeAttribute('hidden');
  await renderScheduled();
}

/** Abre la vista de Automations, como la suya: a página completa. */
async function openAutomations() {
  const vista = document.getElementById('automations-view');
  const main = document.querySelector('.content__main');
  if (!vista || !main) return;

  /*
   * Si ya está abierta, no se vuelve a ocultar el hilo: la segunda pasada
   * guardaba como estado original `hidden` (ya oculto) y al cerrar dejaba el
   * área de contenido en blanco, sin hilo ni composer.
   */
  if (!vista.hidden) {
    await renderAutomations();
    return;
  }

  // La vista sustituye al hilo y al composer mientras está abierta.
  vista.hidden = false;
  for (const hijo of main.children) {
    if (hijo === vista) continue;
    // Solo se guarda el estado original una vez.
    if (hijo.dataset.ocultoPorAutomations === undefined) {
      hijo.dataset.ocultoPorAutomations = hijo.hidden ? '1' : '0';
    }
    hijo.hidden = true;
  }

  await renderAutomations();
}

/** Cierra la vista de Automations y devuelve el hilo. */
function closeAutomations() {
  const vista = document.getElementById('automations-view');
  const main = document.querySelector('.content__main');
  if (!vista || !main) return;

  vista.hidden = true;
  for (const hijo of main.children) {
    if (hijo === vista) continue;
    if (hijo.dataset.ocultoPorAutomations === undefined) continue;
    hijo.hidden = hijo.dataset.ocultoPorAutomations === '1';
    delete hijo.dataset.ocultoPorAutomations;
  }

  // Una pregunta que llegó con la vista abierta se muestra ahora.
  const askHost = document.getElementById('ask-host');
  if (askHost?.dataset.preguntaPendiente === '1') {
    askHost.hidden = false;
    delete askHost.dataset.preguntaPendiente;
  }
}

/** Pinta la lista de automatizaciones o su estado vacío. */
async function renderAutomations() {
  const cuerpo = document.getElementById('automations-body');
  if (!cuerpo) return;

  cuerpo.replaceChildren();

  let tareas = [];
  try {
    tareas = (await window.api.listScheduled?.()) ?? [];
  } catch {
    tareas = [];
  }

  if (!Array.isArray(tareas) || tareas.length === 0) {
    const titulo = document.createElement('p');
    titulo.className = 'automations__empty-title';
    titulo.textContent = 'No automations yet';

    const desc = document.createElement('p');
    desc.className = 'automations__empty-desc';
    desc.textContent =
      "Run a prompt on a schedule, like a morning summary of yesterday's changes. " +
      'Runs show up here.';

    cuerpo.append(titulo, desc);
    return;
  }

  for (const tarea of tareas) {
    const fila = document.createElement('div');
    fila.className = 'automations__row';

    const texto = document.createElement('div');
    texto.className = 'automations__row-text';
    texto.textContent = tarea.prompt ?? tarea.message ?? '(sin texto)';

    const cuando = document.createElement('span');
    cuando.className = 'automations__row-when';
    // Las tareas guardan `nextRunAt` o `at`, no un texto de programación.
    const fecha = tarea.nextRunAt ?? tarea.at ?? null;
    cuando.textContent =
      tarea.mode === 'cron'
        ? (tarea.cron ?? 'recurrente')
        : fecha
          ? new Date(fecha).toLocaleString('es-ES', {
              day: '2-digit',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
            })
          : '';

    fila.append(texto, cuando);

    /*
     * Historial de ejecuciones, como su «Runs show up here»: las últimas veces
     * que se disparó, con su hora.
     */
    const runs = Array.isArray(tarea.runs) ? tarea.runs.slice(-3).reverse() : [];
    if (runs.length > 0) {
      const historial = document.createElement('div');
      historial.className = 'automations__runs';
      for (const run of runs) {
        const linea = document.createElement('span');
        linea.className = 'automations__run';
        linea.textContent = run.ok === false ? 'falló' : 'ejecutada';
        const hora = document.createElement('span');
        hora.className = 'automations__run-when';
        hora.textContent = run.at
          ? new Date(run.at).toLocaleString('es-ES', {
              day: '2-digit',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
            })
          : '';
        linea.append(' ', hora);
        historial.append(linea);
      }
      texto.append(historial);
    }

    cuerpo.append(fila);
  }
}

/** Cierra el gestor de tareas programadas. */
function closeScheduled() {
  document.getElementById('scheduled-modal')?.setAttribute('hidden', '');
}

/** Pinta la lista de tareas programadas. */
async function renderScheduled() {
  const list = document.getElementById('scheduled-list');
  if (!list) return;

  let tasks = [];
  try {
    tasks = await window.api.listScheduled();
  } catch {
    tasks = [];
  }

  list.replaceChildren();

  if (tasks.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'scheduled__empty';
    empty.textContent = 'Sin tareas programadas.';
    list.append(empty);
    return;
  }

  for (const task of tasks) {
    const row = document.createElement('div');
    row.className = task.enabled === false ? 'scheduled__item is-off' : 'scheduled__item';

    const text = document.createElement('span');
    text.className = 'scheduled__prompt-text';
    text.textContent = task.prompt;
    text.title = task.prompt;

    const meta = document.createElement('span');
    meta.className = 'scheduled__meta';
    const unidad = task.unit === 'hours' ? 'h' : 'min';
    meta.textContent = `cada ${task.every}${unidad}`;

    const actions = document.createElement('div');
    actions.className = 'scheduled__item-actions';

    const run = document.createElement('button');
    run.type = 'button';
    run.className = 'btn';
    run.textContent = 'Ejecutar';
    run.addEventListener('click', async () => {
      await window.api.runScheduled(task.id);
      closeScheduled();
    });

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'btn';
    toggle.textContent = task.enabled === false ? 'Activar' : 'Pausar';
    toggle.addEventListener('click', async () => {
      await window.api.toggleScheduled(task.id, task.enabled === false);
      await renderScheduled();
    });

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'btn';
    remove.textContent = 'Borrar';
    remove.addEventListener('click', async () => {
      await window.api.deleteScheduled(task.id);
      await renderScheduled();
    });

    actions.append(run, toggle, remove);
    row.append(text, meta, actions);
    list.append(row);
  }
}

/**
 * Convierte la salida de una herramienta en algo legible.
 * Cada tipo tiene su representación: árbol, terminal, código, imagen…
 */
function renderToolOutput(name, content, isError) {
  // El aviso de hooks es para el modelo, no para la interfaz.
  const limpio = String(content ?? '').replace(/\n*\[hooks\][^\n]*/g, '').trimEnd();
  if (isError) return monoBlock(limpio, 'tool-out tool-out--error');

  switch (name) {
    case 'list_directory':
      // Su bloque de terminal muestra el listado como texto plano, sin árbol
      // ni iconos: es una salida de shell, no un explorador.
      return monoBlock(limpio, 'tool-out tool-out--ok');
    case 'run_command':
      return renderTerminal(limpio);
    case 'read_file':
      return renderCode(limpio);
    case 'write_file':
    case 'edit_file':
      return monoBlock(limpio, 'tool-out tool-out--ok');
    case 'search_files':
    case 'file_search':
    case 'search_code':
      return renderSearchResults(limpio);
    case 'browser_read':
    case 'browser_open':
      return renderBrowserResult(limpio);
    default:
      return monoBlock(content, 'tool-out');
  }
}

/**
 * Pinta en el hilo la imagen que generó `generate_image`.
 *
 * Se usa tanto al terminar la herramienta como al abrir una conversación
 * guardada: el historial solo trae el texto «Guardada en …», así que sin esto
 * la imagen desaparece al reiniciar la app.
 *
 * Se prefiere el fichero guardado: la URL de Flow exige la sesión del navegador
 * oculto y el CSP del hilo (`img-src 'self' data:`) bloquea las remotas. Se
 * pide su contenido como data URL.
 */
function pintarImagenGenerada(content) {
  const guardada = /Guardada en (.+?)\.?\s*$/m.exec(String(content ?? ''))?.[1]?.trim();
  const urlRemota = /URL:\s*(https?:\/\/\S+)/.exec(String(content ?? ''))?.[1];
  if (!guardada && !urlRemota) return;

  const img = document.createElement('img');
  img.className = 'generated-image';
  img.alt = 'Imagen generada';
  // Sin tamaño hasta que cargue: evita un hueco roto mientras llega el data URL.
  img.style.visibility = 'hidden';
  img.onload = () => {
    img.style.visibility = '';
    scrollToBottom();
  };
  img.onerror = () => img.remove();
  insertarAntesDeLaRespuesta(img);

  if (guardada) {
    window.api
      .imageAsDataUrl?.(guardada)
      .then((r) => {
        if (r?.ok && r.dataUrl) img.src = r.dataUrl;
        else img.remove();
      })
      .catch(() => img.remove());
  } else {
    img.src = urlRemota;
  }

  scrollToBottom();
}

/** Bloque monoespaciado simple. */
function monoBlock(text, className) {
  const pre = document.createElement('pre');
  pre.className = className;
  pre.textContent = text;
  return pre;
}

/** Árbol de directorio: las entradas que acaban en «/» son carpetas. */
/** Salida de terminal: separa stdout y stderr con su color. */
function renderTerminal(content) {
  const box = document.createElement('pre');
  box.className = 'tool-out tool-terminal';

  const parts = content.split(/^--- (stdout|stderr) ---$/m);
  if (parts.length === 1) {
    box.textContent = content;
    return box;
  }

  for (let i = 1; i < parts.length; i += 2) {
    const kind = parts[i];
    const body = (parts[i + 1] ?? '').trim();
    if (body.length === 0) continue;

    const section = document.createElement('span');
    section.className = kind === 'stderr' ? 'tool-terminal__err' : 'tool-terminal__out';
    section.textContent = body + '\n';
    box.append(section);
  }

  return box;
}

/** Código con números de línea (máximo 40 líneas visibles). */
function renderCode(content) {
  const box = document.createElement('div');
  box.className = 'tool-code';

  const lines = content.split('\n');
  const shown = lines.slice(0, 40);

  shown.forEach((line, index) => {
    const row = document.createElement('div');
    row.className = 'tool-code__row';

    const num = document.createElement('span');
    num.className = 'tool-code__num';
    num.textContent = String(index + 1);

    const text = document.createElement('span');
    text.className = 'tool-code__text';
    text.textContent = line.length > 0 ? line : ' ';

    row.append(num, text);
    box.append(row);
  });

  if (lines.length > shown.length) {
    const more = document.createElement('div');
    more.className = 'tool-code__more';
    more.textContent = `… ${lines.length - shown.length} líneas más`;
    box.append(more);
  }

  return box;
}

/** Resultados de búsqueda agrupados por fichero. */
function renderSearchResults(content) {
  const box = document.createElement('div');
  box.className = 'tool-search';

  const lines = content.split('\n').filter((line) => line.trim().length > 0);
  if (lines.length === 0) return monoBlock('Sin resultados', 'tool-out');

  for (const line of lines) {
    const match = /^([^:]+):(\d+):\s?(.*)$/.exec(line);

    const row = document.createElement('div');
    row.className = 'tool-search__row';

    if (match) {
      const file = document.createElement('span');
      file.className = 'tool-search__file';
      file.textContent = `${match[1]}:${match[2]}`;

      const text = document.createElement('span');
      text.className = 'tool-search__text';
      text.textContent = match[3];

      row.append(file, text);
    } else {
      const text = document.createElement('span');
      text.className = 'tool-search__text';
      text.textContent = line;
      row.append(text);
    }

    box.append(row);
  }

  return box;
}

/** Resultado del navegador: si trae una captura en base64, la dibuja. */
function renderBrowserResult(content) {
  const base64 = /data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]{200,})/.exec(content);
  if (base64) {
    const box = document.createElement('div');
    box.className = 'tool-shot';

    const img = document.createElement('img');
    img.className = 'tool-shot__img';
    img.src = `data:image/${base64[1]};base64,${base64[2]}`;
    img.alt = 'Captura del navegador';

    const link = document.createElement('a');
    link.className = 'tool-shot__link';
    link.href = img.src;
    link.textContent = 'Abrir captura';
    link.addEventListener('click', (event) => event.stopPropagation());

    box.append(img, link);
    return box;
  }

  return monoBlock(content, 'tool-out');
}

/**
 * Tarjeta de plan, en línea en el hilo, como su artefacto.
 *
 * Medido en Antigravity 2.32 (artifact-card): 768 px, borde 1, p-2 (8),
 * my-0.5 (2), rounded-xl (12), gap-1 (4); cabecera con icono de fichero de 16
 * y la etiqueta «Plan» en pastilla 16/24 medio; resumen en secondary-foreground
 * con clamp de 3 líneas; botón primario «Proceed» de 28 px (h-7, px-2.5,
 * rounded-md, gap-1.5) con la pista «Ctrl+↵» a 14 px al 50 %. El documento del
 * plan se despliega con la cabecera.
 */
function showPlanCard(plan) {
  if (!els.threadInner) return;

  const card = document.createElement('div');
  card.className = 'artifact-card';
  card.dataset.testid = 'artifact-card';

  const header = document.createElement('div');
  header.className = 'artifact-card__header';
  header.dataset.testid = 'artifact-card-header';

  const title = document.createElement('button');
  title.type = 'button';
  title.className = 'artifact-card__title';
  title.setAttribute('aria-expanded', 'false');

  const icon = document.createElement('span');
  icon.className = 'artifact-card__icon';
  icon.innerHTML = window.Icon('files', 16);
  const label = document.createElement('span');
  label.className = 'artifact-card__label';
  label.textContent = 'Plan';
  title.append(icon, label);

  const summary = document.createElement('span');
  summary.className = 'artifact-card__summary';
  summary.textContent = plan.title ?? 'Plan';

  header.append(title, summary);

  const steps = document.createElement('ol');
  steps.className = 'artifact-card__steps';
  steps.hidden = true;
  for (const step of plan.steps ?? []) {
    const item = document.createElement('li');
    item.textContent = step.title;
    if (step.detail) {
      const detail = document.createElement('span');
      detail.className = 'artifact-card__detail';
      detail.textContent = step.detail;
      item.append(detail);
    }
    steps.append(item);
  }

  title.addEventListener('click', () => {
    steps.hidden = !steps.hidden;
    title.setAttribute('aria-expanded', String(!steps.hidden));
  });

  const actions = document.createElement('div');
  actions.className = 'artifact-card__actions';

  const proceed = document.createElement('button');
  proceed.type = 'button';
  proceed.className = 'artifact-card__proceed';
  proceed.append(document.createTextNode('Proceed'));
  const hint = document.createElement('span');
  hint.className = 'artifact-card__hint';
  hint.textContent = 'Ctrl+↵';
  proceed.append(hint);
  actions.append(proceed);

  card.append(header, steps, actions);
  els.threadInner.append(card);
  scrollToBottom();

  const alPulsar = (event) => {
    if (event.ctrlKey && event.key === 'Enter' && ui.planCard?.card === card) {
      event.preventDefault();
      terminar(true, '');
    }
  };

  /** Cierra la tarjeta y entrega la decisión al proceso principal. */
  const terminar = (approved, feedback) => {
    actions.remove();
    if (feedback) {
      const note = document.createElement('div');
      note.className = 'artifact-card__feedback';
      note.textContent = feedback;
      card.append(note);
    }
    card.classList.toggle('is-approved', approved);
    card.classList.toggle('is-rejected', !approved);
    document.removeEventListener('keydown', alPulsar);
    ui.planCard = null;
    window.api
      .respondPlan({ id: plan.id, approved, feedback: feedback ?? '', steps: plan.steps })
      .catch(() => {});
  };

  proceed.addEventListener('click', () => terminar(true, ''));
  document.addEventListener('keydown', alPulsar);

  ui.planCard = {
    card,
    /** Rechazo escribiendo en el composer: el proceso principal resuelve el plan. */
    rechazar: (texto) => {
      actions.remove();
      const note = document.createElement('div');
      note.className = 'artifact-card__feedback';
      note.textContent = texto;
      card.append(note);
      card.classList.add('is-rejected');
      document.removeEventListener('keydown', alPulsar);
      ui.planCard = null;
    },
  };
}

/** Muestra la tarjeta de preguntas y devuelve las respuestas del usuario. */
/**
 * Tarjeta de decisión, **en línea dentro del hilo**, como la suya.
 *
 * Medido en su DOM: 766 px de ancho (todo el hilo), radio **20**, fondo
 * `rgb(19,19,23)`, `padding: 6px`; cabecera con icono de 20×21, la pregunta a
 * 14/20 y un botón de plegar de 24×24; opciones en filas de **30 px** numeradas
 * («1 (Recommended) Daily») y un único botón **Submit**.
 *
 * Antes era un overlay centrado que tapaba la app: se leía como un diálogo
 * aparte cuando en realidad es parte de la conversación.
 */
function showQuestionCard(payload) {
  const preguntas = Array.isArray(payload?.questions) ? payload.questions : [];
  if (preguntas.length === 0) return;

  const seleccion = preguntas.map(() => new Set());
  const escritas = preguntas.map(() => '');

  const card = document.createElement('div');
  card.className = 'ask-card';

  const responder = (respuestas) => {
    // Se anima la salida antes de quitarla: 120ms, el mismo fade al revés.
    card.classList.add('is-closing');
    setTimeout(() => {
      const host = document.getElementById('ask-host');
      if (host) {
        host.replaceChildren();
        host.hidden = true;
        delete host.dataset.preguntaPendiente;
      }
      card.remove();
    }, 120);
    window.api.respondQuestion({ id: payload.id, answers: respuestas }).catch(() => {});
  };

  preguntas.forEach((pregunta, indice) => {
    const head = document.createElement('div');
    head.className = 'ask-card__head';

    const icono = document.createElement('span');
    icono.className = 'ask-card__icon';
    icono.dataset.testid = 'ask-question-header-icon';
    icono.textContent = '?';

    const texto = document.createElement('span');
    texto.className = 'ask-card__question';
    texto.dataset.testid = 'ask-question-header-text';
    texto.textContent = pregunta.question ?? '';

    const plegar = document.createElement('button');
    plegar.type = 'button';
    plegar.className = 'ask-card__collapse';
    plegar.dataset.testid = 'ask-question-collapse-button';
    plegar.setAttribute('aria-label', 'Plegar');
    plegar.innerHTML = window.Icon('chevron', 16);

    const cerrar = document.createElement('button');
    cerrar.type = 'button';
    cerrar.className = 'ask-card__collapse';
    cerrar.setAttribute('aria-label', 'Cerrar');
    cerrar.innerHTML = window.Icon('close', 16);
    cerrar.onclick = () => responder(null);

    head.append(icono, texto, plegar, cerrar);

    const cuerpo = document.createElement('div');
    cuerpo.className = 'ask-card__body';

    plegar.addEventListener('click', () => {
      const abierto = cuerpo.hidden === false;
      cuerpo.hidden = abierto;
      plegar.classList.toggle('is-collapsed', abierto);
    });

    const filas = [];
    const opciones = pregunta.options ?? [];

    opciones.forEach((opcion, posicion) => {
      const fila = document.createElement('button');
      fila.type = 'button';
      fila.className = 'ask-card__option';

      const numero = document.createElement('span');
      numero.className = 'ask-card__num';
      numero.textContent = String(posicion + 1);

      const etiqueta = document.createElement('span');
      etiqueta.className = 'ask-card__label';
      /*
       * Su formato es «1 (Recommended) Daily»: la marca va ANTES de la etiqueta,
       * no después.
       */
      const recomendada = /recommended/i.test(opcion.label ?? '') || opcion.recommended === true;
      const limpia = String(opcion.label ?? '').replace(/\s*\(recommended\)\s*/i, ' ').trim();
      etiqueta.textContent = recomendada ? `(Recommended) ${limpia}` : limpia;

      fila.append(numero, etiqueta);

      if (opcion.description) {
        const detalle = document.createElement('span');
        detalle.className = 'ask-card__desc';
        detalle.textContent = opcion.description;
        fila.append(detalle);
      }

      fila.onclick = () => {
        if (pregunta.allowMultiple === true) {
          if (seleccion[indice].has(opcion.label)) seleccion[indice].delete(opcion.label);
          else seleccion[indice].add(opcion.label);
        } else {
          seleccion[indice].clear();
          seleccion[indice].add(opcion.label);
        }
        for (const otra of filas) otra.classList.remove('is-selected');
        for (const otra of filas) {
          const etiquetaOtra = otra.querySelector('.ask-card__label')?.textContent ?? '';
          if ([...seleccion[indice]].some((s) => etiquetaOtra.startsWith(s))) {
            otra.classList.add('is-selected');
          }
        }
      };

      filas.push(fila);
      cuerpo.append(fila);
    });

    /*
     * «Other (write your answer)» es la ÚLTIMA OPCIÓN, no un campo aparte: al
     * pulsarla se convierte en una fila de texto, como en su tarjeta.
     */
    const otra = document.createElement('button');
    otra.type = 'button';
    otra.className = 'ask-card__option ask-card__option--other';

    const numOtra = document.createElement('span');
    numOtra.className = 'ask-card__num';
    numOtra.textContent = String(opciones.length + 1);

    const etiquetaOtra = document.createElement('span');
    etiquetaOtra.className = 'ask-card__label';
    etiquetaOtra.textContent = 'Other (write your answer)';

    otra.append(numOtra, etiquetaOtra);

    const libre = document.createElement('input');
    libre.type = 'text';
    libre.className = 'ask-card__input';
    libre.placeholder = 'Escribe tu respuesta';
    libre.hidden = true;
    libre.oninput = () => {
      escritas[indice] = libre.value;
    };

    otra.onclick = () => {
      libre.hidden = false;
      otra.classList.add('is-selected');
      libre.focus();
    };

    cuerpo.append(otra, libre);

    const pie = document.createElement('div');
    pie.className = 'ask-card__foot';

    const micro = document.createElement('button');
    micro.type = 'button';
    micro.className = 'ask-card__mic';
    micro.setAttribute('aria-label', 'Dictar');
    micro.innerHTML = window.Icon('mic', 16);
    micro.onclick = () => libre.focus();

    const omitir = document.createElement('button');
    omitir.type = 'button';
    omitir.className = 'ask-card__skip';
    omitir.textContent = 'Skip';
    omitir.onclick = () => responder(null);

    const enviar = document.createElement('button');
    enviar.type = 'button';
    enviar.className = 'ask-card__submit';
    enviar.textContent = 'Submit ⏎';
    enviar.onclick = () => {
      const respuestas = preguntas.map((_, i) => {
        const elegidas = [...seleccion[i]];
        if (escritas[i].trim().length > 0) elegidas.push(escritas[i].trim());
        return elegidas;
      });
      responder(respuestas);
    };

    pie.append(micro, omitir, enviar);
    cuerpo.append(pie);

    card.append(head, cuerpo);
  });

  /*
   * Se ancla sobre el composer, como la suya: no va en el flujo del hilo, sino
   * fija encima del campo de escritura.
   */
  const host = document.getElementById('ask-host');
  if (host) {
    host.replaceChildren(card);
    /*
     * La vista de Automations sustituye al hilo y al composer. Si la pregunta
     * llega mientras está abierta, no debe flotar encima de esa vista: se deja
     * guardada y aparece al volver a la conversación.
     */
    const automationsAbierta = document.getElementById('automations-view')?.hidden === false;
    host.hidden = automationsAbierta;
    if (automationsAbierta) host.dataset.preguntaPendiente = '1';
  } else {
    els.threadInner.append(card);
  }
  card.querySelector('.ask-card__input')?.focus();
}

/**
 * Tarjeta «Changed files» del turno. Reproduce la de Antigravity: cabecera
 * plegable con el número de ficheros, el total de líneas y el botón Review;
 * al abrirse, una fila por fichero con su ruta y sus líneas.
 */
function crearTarjetaCambios(cambios) {
  const traducir = (texto) => window.I18n?.t(texto) ?? texto;
  const entradas = Array.isArray(cambios?.entries)
    ? cambios.entries
    : (cambios?.paths ?? []).map((ruta) => ({ path: ruta, additions: 0, removals: 0 }));
  if (!entradas.length) return null;

  const files = entradas.length;
  const additions = Number.isFinite(cambios.additions)
    ? cambios.additions
    : entradas.reduce((total, entrada) => total + (Number(entrada.additions) || 0), 0);
  const removals = Number.isFinite(cambios.removals)
    ? cambios.removals
    : entradas.reduce((total, entrada) => total + (Number(entrada.removals) || 0), 0);

  const card = document.createElement('div');
  card.className = 'changed-files';
  card.dataset.testid = 'changed-files-card';

  const header = document.createElement('div');
  header.className = 'changed-files__header';
  header.dataset.testid = 'changed-files-card-header';
  header.setAttribute('role', 'button');
  header.setAttribute('aria-expanded', 'false');
  header.tabIndex = 0;

  const izquierda = document.createElement('div');
  izquierda.className = 'changed-files__left';

  const etiqueta = document.createElement('span');
  etiqueta.className = 'changed-files__files';
  etiqueta.textContent = traducir(`${files} file${files === 1 ? '' : 's'} changed`);

  const estadisticas = document.createElement('span');
  estadisticas.className = 'changed-files__stats';
  const mas = document.createElement('span');
  mas.className = 'changed-files__add';
  mas.textContent = `+${additions}`;
  const menos = document.createElement('span');
  menos.className = 'changed-files__del';
  menos.textContent = `-${removals}`;
  estadisticas.append(mas, menos);

  const chevron = document.createElement('span');
  chevron.className = 'changed-files__chevron';
  chevron.innerHTML = window.Icon('chevron', 14);

  izquierda.append(etiqueta, estadisticas, chevron);

  const review = document.createElement('button');
  review.type = 'button';
  review.className = 'changed-files__review';
  review.dataset.testid = 'changed-files-card-review';
  const reviewIcono = document.createElement('span');
  reviewIcono.className = 'changed-files__review-icon';
  reviewIcono.innerHTML = window.Icon('review', 14);
  const reviewTexto = document.createElement('span');
  reviewTexto.textContent = traducir('Review');
  review.append(reviewIcono, reviewTexto);

  header.append(izquierda, review);

  const bodyWrap = document.createElement('div');
  bodyWrap.className = 'changed-files__body-wrap';
  bodyWrap.hidden = true;

  const body = document.createElement('div');
  body.className = 'changed-files__body';

  for (const entrada of entradas) {
    const ruta = String(entrada.path ?? '');
    if (!ruta) continue;
    const normal = ruta.replace(/\\/g, '/');
    const nombre = normal.split('/').pop() || normal;
    const corte = normal.lastIndexOf('/');
    const directorio = corte > 0 ? normal.slice(0, corte) : '';

    const fila = document.createElement('div');
    fila.className = 'changed-files__file';
    fila.dataset.testid = 'changed-files-card-file';
    fila.dataset.fileUri = `file:///${encodeURI(ruta.replace(/\\/g, '/').replace(/^\/?/, ''))}`;
    fila.setAttribute('role', 'button');
    fila.setAttribute('aria-label', `${nombre} ${directorio} +${Number(entrada.additions) || 0} -${Number(entrada.removals) || 0}`.trim());
    fila.tabIndex = 0;

    const icono = document.createElement('span');
    icono.className = 'changed-files__file-icon';
    icono.innerHTML = window.Icon('files', 16);

    const nombreEl = document.createElement('span');
    nombreEl.className = 'changed-files__file-name';
    nombreEl.dataset.testid = 'file-title-name';
    nombreEl.textContent = nombre;

    const dirEl = document.createElement('span');
    dirEl.className = 'changed-files__file-dir';
    const dirTexto = document.createElement('span');
    dirTexto.textContent = directorio;
    dirEl.append(dirTexto);

    const filaStats = document.createElement('span');
    filaStats.className = 'changed-files__file-stats';
    const filaMas = document.createElement('span');
    filaMas.className = 'changed-files__add';
    filaMas.textContent = `+${Number(entrada.additions) || 0}`;
    const filaMenos = document.createElement('span');
    filaMenos.className = 'changed-files__del';
    filaMenos.textContent = `-${Number(entrada.removals) || 0}`;
    filaStats.append(filaMas, filaMenos);

    fila.append(icono, nombreEl, dirEl, filaStats);
    fila.addEventListener('click', () => void openInEditor(ruta));
    fila.addEventListener('keydown', (evento) => {
      if (evento.key === 'Enter' || evento.key === ' ') {
        evento.preventDefault();
        void openInEditor(ruta);
      }
    });
    body.append(fila);
  }

  bodyWrap.append(body);

  let abierto = false;
  const alternar = () => {
    abierto = !abierto;
    header.classList.toggle('is-expanded', abierto);
    header.setAttribute('aria-expanded', String(abierto));
    bodyWrap.hidden = !abierto;
  };
  header.addEventListener('click', (evento) => {
    if (evento.target.closest('button')) return;
    alternar();
  });
  header.addEventListener('keydown', (evento) => {
    if (evento.key === 'Enter' || evento.key === ' ') {
      evento.preventDefault();
      alternar();
    }
  });
  review.addEventListener('click', (evento) => {
    evento.stopPropagation();
    if (typeof toggleOverview === 'function') {
      toggleOverview(true, 'auto');
      selectOverviewView('review');
    }
  });

  card.append(header, bodyWrap);
  return card;
}

/** Inserta la tarjeta al final del turno, antes del pie de hora y acciones. */
function insertarTarjetaCambios(card) {
  const pies = els.threadInner.querySelectorAll('.msg__toolbar');
  const ultimoPie = pies[pies.length - 1];
  if (ultimoPie) els.threadInner.insertBefore(card, ultimoPie);
  else els.threadInner.append(card);
}

/** Añade la tarjeta del turno recién terminado con los cambios del checkpoint. */
async function addTurnReviewCard() {
  const conversacion = ui.activeConversation;
  let cambios;
  try {
    cambios = await window.api.turnChanges();
  } catch {
    return;
  }
  // Si el usuario cambió de conversación mientras llegaba la respuesta, la
  // tarjeta del turno anterior no puede aparecer en la nueva.
  if (conversacion !== ui.activeConversation) return;
  if (!cambios || !cambios.files) return;

  const card = crearTarjetaCambios(cambios);
  if (!card) return;
  card.dataset.live = '1';
  document.querySelector('.changed-files[data-live="1"]')?.remove();
  insertarTarjetaCambios(card);
  scrollToBottom();
}

/** Muestra un aviso en la barra de título. */
function showAnnouncement(text, action) {
  const box = document.getElementById('titlebar-announce');
  const label = document.getElementById('announce-text');
  const button = document.getElementById('announce-action');
  if (!box || !label) return;

  label.textContent = text;
  box.removeAttribute('hidden');

  if (button) {
    if (action && action.label) {
      button.hidden = false;
      button.textContent = action.label;
      button.onclick = () => {
        box.setAttribute('hidden', '');
        action.onClick?.();
      };
    } else {
      button.hidden = true;
      button.onclick = null;
    }
  }
}

/** Oculta el aviso de la barra de título. */
function hideAnnouncement() {
  document.getElementById('titlebar-announce')?.setAttribute('hidden', '');
}

/** Comandos que ofrece la paleta (Ctrl+K). */
const PALETTE_COMMANDS = [
  { label: 'Nueva conversación', hint: 'Ctrl+N', run: () => newConversation() },
  { label: 'Buscar conversaciones', hint: 'Ctrl+M', run: () => toggleSearch(true) },
  { label: 'Ajustes', hint: '', run: () => window.SettingsUI.open() },
  { label: 'Modelos', hint: '', run: () => window.SettingsUI.open('models') },
  { label: 'Apariencia', hint: '', run: () => window.SettingsUI.open('appearance') },
  { label: 'Mostrar u ocultar barra lateral', hint: '', run: () => toggleSidebar() },
  {
    label: 'Ejecutar los tests',
    hint: '',
    run: async () => {
      const resultado = await window.api.testsRun();
      if (!resultado?.ok) {
        showAnnouncement(resultado?.error ?? 'No se pudieron ejecutar los tests.');
      }
    },
  },
  { label: 'Mostrar u ocultar terminal', hint: 'Ctrl+`', run: () => toggleTerminal() },
  { label: 'Mostrar u ocultar panel de resumen', hint: '', run: () => toggleOverview() },
  { label: 'Abrir fichero…', hint: '', run: () => runNewTabAction('open-file') },
  { label: 'Adjuntar fichero al mensaje', hint: '', run: () => attachFile() },
  { label: 'Reconstruir índice', hint: '', run: () => document.getElementById('index-build')?.click() },
  { label: 'Recargar ventana', hint: '', run: () => window.location.reload() },
  { label: 'Herramientas de desarrollo', hint: '', run: () => window.api.toggleDevTools() },
];

let paletteItems = [];
let paletteIndex = 0;

/** Abre la paleta de comandos. */
function openPalette() {
  const modal = document.getElementById('palette-modal');
  const input = document.getElementById('palette-input');
  if (!modal || !input) return;

  modal.removeAttribute('hidden');
  input.value = '';
  renderPalette('');
  input.focus();
}

/** Cierra la paleta. */
function closePalette() {
  document.getElementById('palette-modal')?.setAttribute('hidden', '');
}

/** Pinta los comandos que coinciden con el filtro. */
function renderPalette(query) {
  const list = document.getElementById('palette-list');
  if (!list) return;

  const q = query.trim().toLowerCase();
  paletteItems = q
    ? PALETTE_COMMANDS.filter((command) => command.label.toLowerCase().includes(q))
    : PALETTE_COMMANDS;

  paletteIndex = 0;
  list.replaceChildren();

  if (paletteItems.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'palette__empty';
    empty.textContent = 'Ningún comando coincide.';
    list.append(empty);
    return;
  }

  paletteItems.forEach((command, index) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'palette__item';
    if (index === 0) item.classList.add('is-active');

    const label = document.createElement('span');
    label.textContent = command.label;
    item.append(label);

    if (command.hint) {
      const hint = document.createElement('span');
      hint.className = 'palette__hint';
      hint.textContent = command.hint;
      item.append(hint);
    }

    item.addEventListener('click', () => {
      closePalette();
      command.run();
    });

    list.append(item);
  });
}

/** Mueve la selección dentro de la paleta. */
function movePaletteSelection(delta) {
  if (paletteItems.length === 0) return;

  paletteIndex = (paletteIndex + delta + paletteItems.length) % paletteItems.length;
  const nodes = document.querySelectorAll('.palette__item');
  nodes.forEach((node, index) => node.classList.toggle('is-active', index === paletteIndex));
  nodes[paletteIndex]?.scrollIntoView({ block: 'nearest' });
}

/** Muestra u oculta el panel auxiliar (editor / nueva pestaña). */
function toggleEditorPane(force) {
  const open = force ?? els.editorPane.hidden;

  // Los dos paneles laterales no caben a la vez sin ahogar el chat.
  if (open && !els.overviewPanel.hidden) toggleOverview(false);

  els.editorPane.hidden = !open;

  const button = document.getElementById('toggle-aux-pane');
  if (button) button.setAttribute('aria-pressed', String(open));

  if (open) renderEditorTabs();
}

/** Acciones de la vista de nueva pestaña del panel auxiliar. */
async function runNewTabAction(action) {
  switch (action) {
    case 'open-file': {
      const filePath = await window.api.openFileDialog();
      if (filePath) await openInEditor(filePath);
      break;
    }
    case 'terminal':
      await toggleTerminal(true);
      break;
    case 'review':
      await toggleOverview(true);
      selectOverviewView('review');
      break;
    case 'browser':
      await window.api.openBrowser('https://duckduckgo.com');
      break;
    default:
      break;
  }
}

/**
 * Pide un nombre de conversación con el modal propio.
 *
 * `window.prompt` no existe en Electron, así que sin esto no hay forma de
 * renombrar desde la UI. Resuelve con el nombre o `null` si se cancela.
 */
function pedirNombreDeConversacion(actual) {
  return pedirNombre(actual, { titulo: 'Renombrar conversación', boton: 'Guardar' });
}

/** Pide un nombre de símbolo para el rename del LSP propio. */
function pedirNombreDeSimbolo(actual) {
  return pedirNombre(actual, { titulo: 'Renombrar símbolo', boton: 'Renombrar' });
}

function pedirNombre(actual, { titulo = 'Renombrar conversación', boton = 'Guardar' } = {}) {
  const modal = document.getElementById('rename-modal');
  const input = document.getElementById('rename-input');
  const confirm = document.getElementById('rename-confirm');
  const title = modal?.querySelector('.revert__title');
  if (!modal || !input || !confirm) return Promise.resolve(null);
  if (title) title.textContent = titulo;
  confirm.textContent = boton;

  return new Promise((resolve) => {
    let resuelto = false;
    // Escape funciona con el foco fuera del input (Ctrl+N, paleta, etc.).
    const alPulsarEscape = (evento) => {
      if (evento.key !== 'Escape') return;
      evento.preventDefault();
      cerrar(null);
    };
    const cerrar = (valor) => {
      if (resuelto) return;
      resuelto = true;
      modal.setAttribute('hidden', '');
      document.removeEventListener('keydown', alPulsarEscape);
      modal.onclick = null;
      input.onkeydown = null;
      confirm.onclick = null;
      resolve(valor);
    };

    const guardar = () => {
      const nuevo = input.value.trim();
      cerrar(nuevo && nuevo !== actual ? nuevo : null);
    };

    input.value = actual;
    modal.removeAttribute('hidden');
    document.addEventListener('keydown', alPulsarEscape);
    input.focus();
    input.select();

    confirm.onclick = guardar;
    input.onkeydown = (evento) => {
      if (evento.key !== 'Enter') return;
      evento.preventDefault();
      guardar();
    };
    // Backdrop y Cancelar comparten `data-close-rename`: una sola delegación por apertura.
    modal.onclick = (evento) => {
      if (evento.target.closest?.('[data-close-rename]')) cerrar(null);
    };
  });
}

/** Renombra la conversación activa. */
async function renameConversation() {
  // El id se captura antes del modal: mientras está abierto la conversación
  // activa puede cambiar y el rename debe aplicarse a la original.
  const id = ui.activeConversation;
  if (!id) return;

  const session = ui.sessions.find((item) => item.id === id);
  const actual = session?.title ?? '';
  const nuevo = await pedirNombreDeConversacion(actual);
  if (!nuevo) return;

  await window.api.renameSession(id, nuevo);
  await refreshConversations();
  renderPaneTitle();
}

/** Archiva (quita de la lista) la conversación activa. */
async function archiveConversation() {
  if (!ui.activeConversation) return;

  await window.api.deleteSession(ui.activeConversation);
  newConversation();
  await refreshConversations();
}

/** Exporta la conversación activa a Markdown. */
async function exportConversation() {
  if (!ui.activeConversation) return;

  const result = await window.api.exportSession(ui.activeConversation);
  if (result?.ok) {
    // La trayectoria viaja al lado cuando la hay: el receptor ve qué tocó cada paso.
    addNotice(
      result.trajectory
        ? `Conversación exportada a ${result.path} (con su trayectoria)`
        : `Conversación exportada a ${result.path}`,
      'info',
    );
  }
}

/** Pinta el título de la conversación en la barra del panel. */
function renderPaneTitle() {
  const el = document.getElementById('pane-title');
  if (!el) return;

  const session = ui.sessions.find((item) => item.id === ui.activeConversation);
  el.textContent = session?.title ?? 'Nueva conversación';
}

/** Presets de permisos, los mismos que ofrece Ajustes. */
const PRESETS = ['Request Review', 'Default', 'Auto (Preview)', 'Turbo'];

/** Pinta el nombre del preset en la píldora del composer. */
function renderPresetLabel() {
  const label = document.getElementById('preset-label');
  if (label) label.textContent = ui.prefs.permissionPreset ?? 'Turbo';
}

/** Cambia el preset de permisos y lo persiste. */
async function setPermissionPreset(preset) {
  ui.prefs.permissionPreset = preset;
  renderPresetLabel();

  // Avisos de arranque: primero lo que bloquea, luego lo opcional.
  const disponibles = ui.providers.filter((entry) => entry.available);
  if (disponibles.length === 0) {
    showAnnouncement('No hay ningún proveedor disponible. Configura una clave o arranca Ollama.', {
      label: 'Abrir modelos',
      onClick: () => window.SettingsUI.open('models'),
    });
  } else if (!ui.providers.some((entry) => entry.id === ui.providerId)) {
    showAnnouncement('El proveedor guardado ya no está disponible. Elige otro modelo.', {
      label: 'Elegir modelo',
      onClick: () => window.SettingsUI.open('models'),
    });
  }
  window.SettingsUI?.refresh();

  try {
    await window.api.setPrefs({ permissionPreset: preset });
  } catch (error) {
    console.error('No se pudo guardar el preset:', error);
  }
}

/** Abre un fichero del disco y lo añade como mención al mensaje. */
async function attachFile() {
  try {
    const filePath = await window.api.openFileDialog();
    if (!filePath) return;

    const relative = await window.api.relativePath(filePath).catch(() => filePath);
    insertIntoInput(`@${relative} `);
  } catch (error) {
    console.error('No se pudo adjuntar el fichero:', error);
  }
}

/** Adjunta una imagen: se guarda en la carpeta temporal y se menciona. */
async function attachImage() {
  try {
    const filePath = await window.api.openImageDialog();
    if (!filePath) return;

    const relative = await window.api.relativePath(filePath).catch(() => filePath);
    insertIntoInput(`@${relative} `);
    ui.pendingImages = [...(ui.pendingImages ?? []), relative];
    addNotice(`Imagen adjunta: ${relative}. Se enviará al modelo con el mensaje.`, 'info');
  } catch (error) {
    console.error('No se pudo adjuntar la imagen:', error);
  }
}

/** Abre el selector de menciones con "@". */
function insertMentionTrigger() {
  insertIntoInput('@');
}

/** Inserta texto en la posición del cursor. */
function insertIntoInput(text) {
  const start = els.input.selectionStart ?? els.input.value.length;
  const end = els.input.selectionEnd ?? start;
  const value = els.input.value;

  els.input.value = `${value.slice(0, start)}${text}${value.slice(end)}`;
  const caret = start + text.length;
  els.input.setSelectionRange(caret, caret);
  els.input.focus();
  autoGrow();
  updateSendState();
}

/** Dictado por voz con la API de reconocimiento del navegador. */
function toggleDictation() {
  const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;

  if (!Recognition) {
    addNotice('Este sistema no ofrece reconocimiento de voz.', 'warning');
    return;
  }

  if (ui.dictation) {
    ui.dictation.stop();
    return;
  }

  const recognition = new Recognition();
  recognition.lang = 'es-ES';
  recognition.continuous = false;
  recognition.interimResults = true;

  const base = els.input.value;
  const button = document.getElementById('btn-voice');
  button?.classList.add('is-recording');

  recognition.onresult = (event) => {
    let text = '';
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      text += event.results[i][0].transcript;
    }
    els.input.value = `${base}${base && !base.endsWith(' ') ? ' ' : ''}${text}`;
    autoGrow();
    updateSendState();
  };

  recognition.onerror = (event) => {
    if (event.error !== 'aborted') {
      addNotice(`No se pudo dictar: ${event.error}`, 'warning');
    }
  };

  recognition.onend = () => {
    ui.dictation = null;
    button?.classList.remove('is-recording');
    els.input.focus();
  };

  ui.dictation = recognition;
  recognition.start();
}

/** Cambia la vista del panel de overview. */
function selectOverviewView(name) {
  ui.overviewView = name;

  for (const row of document.querySelectorAll('.overview-row')) {
    row.classList.toggle('is-active', row.dataset.panel === name);
  }

  for (const view of document.querySelectorAll('.overview-panel__body > [data-view]')) {
    view.hidden = view.dataset.view !== name;
  }

  // Sin selección el cuerpo queda vacío, como su panel recién abierto.
  const body = document.getElementById('overview-body');
  if (body) body.hidden = !name;

  // La fila Terminal abre la terminal real.
  if (name === 'terminal') toggleTerminal(true);
  if (name === 'review') { void refreshPullRequests(); void refreshWorkflows(); }
}

/** Marca el área principal como vacía para centrar el composer. */
function updateEmptyState() {
  const main = document.querySelector('.content__main');
  if (!main) return;

  const hasMessages = els.thread.querySelector('.msg') !== null;
  main.classList.toggle('is-empty', !hasMessages);

  /*
   * Medido en su DOM: en conversación nueva el panel de resumen no existe
   * (`overview-panel` ni siquiera está en el árbol). Con mensajes, sí aparece.
   * Si el usuario lo cierra a mano, se respeta y no se vuelve a abrir solo.
   */
  if (!hasMessages) {
    if (ui.overviewOpen) toggleOverview(false, 'auto');
  } else if (!ui.overviewUserClosed && !ui.overviewOpen) {
    toggleOverview(true, 'auto');
  }

  // El estado vacío desaparece en cuanto entra el primer mensaje.
  const empty = document.getElementById('thread-empty');
  if (empty && hasMessages) empty.remove();
}

/** Pinta los puntos de navegación a la izquierda del hilo. */
function renderNavigator() {
  const nav = $('conversation-navigator');
  if (!nav) return;

  const turns = [...els.thread.querySelectorAll('.msg--user')];
  nav.replaceChildren();

  if (turns.length === 0) {
    nav.hidden = true;
    return;
  }

  nav.hidden = false;
  const list = document.createElement('ol');
  list.className = 'nav-dots';

  turns.forEach((turn, index) => {
    const li = document.createElement('li');
    li.className = 'nav-dots__item';

    const dot = document.createElement('button');
    dot.type = 'button';
    dot.className = 'nav-dots__dot';
    dot.setAttribute('aria-label', `Turno ${index + 1} de ${turns.length}`);
    dot.title = `Turno ${index + 1}`;

    dot.addEventListener('click', () => {
      turn.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    li.append(dot);
    list.append(li);
  });

  nav.append(list);
}

// ---------------------------------------------------------------------------
// Panel de overview
// ---------------------------------------------------------------------------

/** Muestra u oculta el panel lateral derecho. */
function toggleOverview(force) {
  // Mutuamente excluyente con el panel auxiliar.
  if (force === true && !els.editorPane.hidden) toggleEditorPane(false);
  // Solo un cierre explícito del usuario se recuerda. El ocultado automático del
  // estado vacío no cuenta, o el panel no volvería a abrirse nunca.
  if (arguments[1] !== 'auto') {
    if (force === false) ui.overviewUserClosed = true;
    if (force === true) ui.overviewUserClosed = false;
  }
  const open = force ?? !ui.overviewOpen;
  ui.overviewOpen = open;

  const panel = $('overview-panel');
  const host = document.getElementById('overview-host');
  const toggle = $('toggle-overview-panel');
  if (!panel) return;

  // El panel vive dentro de una tarjeta flotante: se oculta la tarjeta.
  if (host) host.hidden = !open;
  panel.hidden = false;
  /*
   * La tarjeta mide 320 + 8 de margen. En ventanas estrechas se reserva su
   * hueco para que no tape el hilo ni el composer; la media query decide
   * cuándo hace falta.
   */
  document.querySelector('.content__main')?.classList.toggle('has-overview', open);
  if (toggle) toggle.setAttribute('aria-pressed', String(open));
  if (open) renderOverview();
}

/** Rellena el panel con archivos, plugins, revisión y terminal. */
function renderOverview() {
  const panel = $('overview-panel');
  const host = document.getElementById('overview-host');
  if (!panel || !ui.overviewOpen || (host && host.hidden)) return;

  void refreshGit();
  void refreshGitLog();
  void refreshIndexStatus();
  if (ui.overviewView === 'review') { void refreshPullRequests(); void refreshWorkflows(); }
  renderFileTree();

  const pluginsBody = $('overview-plugins');

  if (pluginsBody) {
    pluginsBody.replaceChildren();
    const plugins = ui.prefs.plugins ?? [];
    if (plugins.length === 0) {
      pluginsBody.append(rowText('Sin plugins MCP'));
    } else {
      for (const plugin of plugins) {
        const row = document.createElement('div');
        row.className = 'overview-item';
        const name = document.createElement('span');
        name.className = 'overview-item__name';
        name.textContent = plugin.name;
        const badge = document.createElement('span');
        badge.className = 'overview-item__badge';
        badge.textContent = plugin.enabled === false ? 'off' : 'on';
        row.append(name, badge);
        pluginsBody.append(row);
      }
    }
  }
}

function rowText(text) {
  const el = document.createElement('div');
  el.className = 'overview-empty';
  el.textContent = text;
  return el;
}

/** Añade a una fila de herramienta el botón para deshacer hasta ese paso. */
function añadirBotonDeshacer(row) {
  const indice = Number(row.dataset.stepIndex);
  if (!Number.isFinite(indice) || indice <= 0) return;
  if (row.querySelector('.work-row__undo')) return;

  const boton = document.createElement('button');
  boton.type = 'button';
  boton.className = 'work-row__undo';
  boton.title = 'Deshacer hasta aquí';
  boton.textContent = 'Deshacer hasta aquí';
  boton.onclick = (evento) => {
    evento.stopPropagation();
    revertToStep(indice);
  };

  row.append(boton);
}

/** Muestra el plan de reversión a un paso y, si se confirma, lo aplica. */
async function revertToStep(indice) {
  let plan;
  try {
    plan = await window.api.trajectoryPreview(indice);
  } catch {
    plan = { ok: false };
  }

  const modal = document.getElementById('revert-modal');
  const desc = document.getElementById('revert-desc');
  const list = document.getElementById('revert-list');
  const confirm = document.getElementById('revert-confirm');

  if (!plan?.ok) {
    showAnnouncement(plan?.error ?? 'No hay nada que deshacer hasta ese paso.');
    return;
  }

  if (modal && desc && list && confirm) {
    desc.textContent =
      `Se desharán ${plan.pasosDeshacer} paso(s) y se tocarán ${plan.cambios.length} fichero(s) en disco.`;

    list.replaceChildren();
    for (const cambio of plan.cambios) {
      const fila = document.createElement('div');
      fila.className = 'revert__row';

      const etiqueta = document.createElement('span');
      etiqueta.className = cambio.action === 'borrar' ? 'revert__tag is-delete' : 'revert__tag';
      etiqueta.textContent = cambio.action;

      const nombre = document.createElement('span');
      nombre.className = 'revert__path';
      nombre.textContent = cambio.path;
      nombre.title = cambio.path;

      fila.append(etiqueta, nombre);
      list.append(fila);
    }

    modal.removeAttribute('hidden');

    confirm.onclick = async () => {
      modal.setAttribute('hidden', '');
      const resultado = await window.api.trajectoryRevert(indice);
      if (resultado?.ok) {
        // Se recarga la conversación, igual que hace el revert por turno.
        if (ui.activeConversation) {
          await openConversation(ui.activeConversation);
        } else {
          clearThread();
        }
        addNotice(
          `Deshechos ${resultado.pasosDeshacer} paso(s). ` +
            `Se restauraron ${resultado.restaurados} fichero(s) en disco. ` +
            'La conversación no se recorta; para eso usa el revert por turno.',
          'info',
        );
      } else {
        addNotice(resultado?.error ?? 'No se pudo deshacer hasta ese paso.', 'error');
      }
    };
  }
}

/** Muestra la vista previa y, si se confirma, deshace hasta ese punto. */
async function revertTo(keepCount) {
  let preview;
  try {
    preview = await window.api.revertPreview(keepCount);
  } catch {
    preview = { ok: false, files: [], messages: 0 };
  }

  const modal = document.getElementById('revert-modal');
  const desc = document.getElementById('revert-desc');
  const list = document.getElementById('revert-list');
  const confirm = document.getElementById('revert-confirm');

  if (modal && desc && list && confirm) {
    const files = preview?.files ?? [];
    desc.textContent = files.length
      ? `Se quitarán ${preview.messages} mensaje(s) y se restaurarán ${files.length} fichero(s) en disco.`
      : `Se quitarán ${preview?.messages ?? 0} mensaje(s). No hay ficheros que restaurar.`;

    list.replaceChildren();
    for (const file of files) {
      const row = document.createElement('div');
      row.className = 'revert__row';

      const tag = document.createElement('span');
      tag.className = file.action === 'delete' ? 'revert__tag is-delete' : 'revert__tag';
      tag.textContent = file.action === 'delete' ? 'borrar' : 'restaurar';

      const name = document.createElement('span');
      name.className = 'revert__path';
      name.textContent = file.path;
      name.title = file.path;

      row.append(tag, name);
      list.append(row);
    }

    modal.removeAttribute('hidden');

    confirm.onclick = async () => {
      modal.setAttribute('hidden', '');
      await applyRevert(keepCount);
    };
    return;
  }

  await applyRevert(keepCount);
}

/** Aplica la reversión ya confirmada. */
async function applyRevert(keepCount) {
  const result = await window.api.revertChat(keepCount);
  if (!result.ok) {
    addNotice(`No se pudo deshacer: ${result.error}`, 'error');
    return;
  }

  if (ui.activeConversation) {
    await openConversation(ui.activeConversation);
  } else {
    clearThread();
  }

  const files = Number(result.restoredFiles ?? 0);
  addNotice(
    files > 0
      ? `Deshecho hasta ese punto. Se restauraron ${files} ${files === 1 ? 'fichero' : 'ficheros'} en disco.`
      : 'Deshecho hasta ese punto.',
    'info',
  );
}

/** Aviso al pie del turno cuando el agente no llegó a responder. */
function showFinalNotice(event) {
  const reason = event.reason;

  if (reason === 'max_steps') {
    addNotice(
      `Se alcanzó el límite de ${event.maxSteps ?? '?'} pasos y el agente se detuvo sin responder. ` +
        'Pídele que continúe, o divide la tarea en partes más pequeñas.',
      'warning',
    );
    return;
  }

  if (reason === 'error') {
    addNotice('El turno terminó con errores.', 'error');
  }
}

/** Bloque de aviso dentro del hilo. */
function addNotice(message, kind) {
  const el = document.createElement('div');
  el.className = `msg__notice msg__notice--${kind ?? 'info'}`;
  el.textContent = message;
  els.threadInner.append(el);
  scrollToBottom();
}

/** Pinta el markdown acumulado en el mensaje en curso. */
function renderStreamingMarkdown(final = false) {
  if (!ui.streamingEl) return;
  // Un frame como máximo: los deltas llegan más rápido de lo que conviene
  // re-renderizar el Markdown completo.
  if (!final && ui.renderFrame) return;
  if (ui.renderFrame) {
    cancelAnimationFrame(ui.renderFrame);
    ui.renderFrame = null;
  }
  if (final) {
    ui.streamingEl.innerHTML = window.Markdown.render(ui.streamingText);
    return;
  }
  ui.renderFrame = requestAnimationFrame(() => {
    ui.renderFrame = null;
    if (!ui.streamingEl) return;
    ui.streamingEl.innerHTML = window.Markdown.render(ui.streamingText, { streaming: true });
  });
}

/** Crea (o reutiliza) el grupo del subagente de navegador. */
function ensureSubagentGroup(id, opciones = {}) {
  const clave = id ?? 'browser';
  ui.subagentGroups = ui.subagentGroups ?? new Map();
  const existente = ui.subagentGroups.get(clave);
  if (existente) return existente;

  const wrap = document.createElement('div');
  wrap.className = 'work-group work-group--nested';

  const header = document.createElement('button');
  header.type = 'button';
  header.className = 'work-group__header';
  header.setAttribute('aria-expanded', 'true');
  header.dataset.testid = 'subagent-group';

  const label = document.createElement('span');
  label.className = 'work-group__label';
  label.textContent = opciones.label ?? 'Browser subagent';

  const chevron = document.createElement('span');
  chevron.className = 'work-group__chevron';
  chevron.innerHTML = window.Icon('chevron', 14);

  header.append(label, chevron);

  const body = document.createElement('div');
  body.className = 'work-group__body';

  header.addEventListener('click', () => {
    const open = header.getAttribute('aria-expanded') === 'true';
    header.setAttribute('aria-expanded', String(!open));
    body.hidden = open;
  });

  wrap.append(header, body);

  // Por defecto dentro del grupo del turno; si se indica padre, dentro de él.
  (opciones.parent ?? ensureToolGroup()).body.append(wrap);

  const grupo = { wrap, header, label, body, rows: new Map() };
  ui.subagentGroups.set(clave, grupo);
  return grupo;
}

/** Añade texto del planificador a su grupo, como una nota atenuada. */
function appendPlannerText(texto) {
  const grupo = ensurePlannerGroup();
  let linea = grupo.body.querySelector('.planner-text');
  if (!linea) {
    linea = document.createElement('div');
    linea.className = 'planner-text';
    grupo.body.append(linea);
  }
  linea.textContent += texto;
  scrollToBottom();
}

/** Grupo del turno del planificador, para colgar de él sus herramientas. */
function ensurePlannerGroup() {
  if (ui.plannerGroup) return ui.plannerGroup;

  const wrap = document.createElement('div');
  wrap.className = 'work-group work-group--nested';

  const header = document.createElement('button');
  header.type = 'button';
  header.className = 'work-group__header';
  header.setAttribute('aria-expanded', 'true');
  header.dataset.testid = 'planner-group';

  const label = document.createElement('span');
  label.className = 'work-group__label';
  label.textContent = 'Planificador';

  const chevron = document.createElement('span');
  chevron.className = 'work-group__chevron';
  chevron.innerHTML = window.Icon('chevron', 14);

  header.append(label, chevron);

  const body = document.createElement('div');
  body.className = 'work-group__body';

  header.addEventListener('click', () => {
    const open = header.getAttribute('aria-expanded') === 'true';
    header.setAttribute('aria-expanded', String(!open));
    body.hidden = open;
  });

  wrap.append(header, body);
  ensureToolGroup().body.append(wrap);

  const grupo = { wrap, header, label, body, rows: new Map() };
  ui.plannerGroup = grupo;
  return grupo;
}

/**
 * Inserta un bloque de trabajo antes de la respuesta en curso.
 *
 * Antigravity apila pensamiento y herramientas ENCIMA del texto final. Si el
 * primer `text` del turno ya creó la burbuja, añadir al final dejaría los pasos
 * debajo de la respuesta.
 */
function insertarAntesDeLaRespuesta(nodo) {
  const respuesta = ui.streamingEl?.parentElement;
  if (respuesta && respuesta.parentElement === els.threadInner) {
    els.threadInner.insertBefore(nodo, respuesta);
  } else {
    els.threadInner.append(nodo);
  }
}

/**
 * Crea un colapsable con la forma exacta de los suyos.
 *
 * Medido en su DOM: el resumen del turno (`worked-for`) nace ABIERTO y los
 * bloques internos (`tool-group`, `thinking`) nacen CERRADOS.
 */
function crearColapsable(texto, testid, abiertoPorDefecto = false) {
  const header = document.createElement('button');
  header.type = 'button';
  header.className = 'work-group__header';
  header.setAttribute('aria-expanded', String(abiertoPorDefecto));
  if (testid) header.dataset.testid = testid;

  const label = document.createElement('span');
  label.className = 'work-group__label';
  label.textContent = texto;

  const chevron = document.createElement('span');
  chevron.className = 'work-group__chevron';
  chevron.innerHTML = window.Icon('chevron', 14);

  header.append(label, chevron);

  const body = document.createElement('div');
  body.className = 'work-group__body';
  body.hidden = !abiertoPorDefecto;

  header.addEventListener('click', () => {
    const open = header.getAttribute('aria-expanded') === 'true';
    header.setAttribute('aria-expanded', String(!open));
    body.hidden = open;
  });

  return { header, label, body };
}

/**
 * Crea el resumen del turno («Working…» → «Worked for Ns»).
 *
 * En Antigravity este bloque envuelve el pensamiento y los grupos de
 * herramientas: el pensamiento no es una fila de primer nivel. Se crea con el
 * primer paso (razonamiento o herramienta) y se finaliza al cerrar el turno.
 */
function ensureWorkWrapper() {
  if (ui.workWrapper) return ui.workWrapper;

  const wrap = document.createElement('div');
  wrap.className = 'work-group';
  const outer = crearColapsable('Working…', 'worked-for-collapsible', true);
  wrap.append(outer.header, outer.body);
  insertarAntesDeLaRespuesta(wrap);

  ui.workWrapper = {
    wrap,
    header: outer.header,
    label: outer.label,
    body: outer.body,
    startedAt: Date.now(),
  };
  return ui.workWrapper;
}

/** Crea el colapsable «Thought for Ns» dentro del resumen del turno. */
function ensureReasoningBlock() {
  if (ui.reasoningEl) return ui.reasoningEl;

  const wrapper = ensureWorkWrapper();
  const block = crearColapsable('Thinking…', 'thinking-collapsible-trigger', true);

  const text = document.createElement('div');
  text.className = 'reasoning__text';
  block.body.append(text);

  const wrap = document.createElement('div');
  wrap.className = 'work-group work-group--nested';
  wrap.append(block.header, block.body);
  wrapper.body.append(wrap);

  ui.reasoningEl = { wrap, header: block.header, label: block.label, body: block.body, text };
  ui.reasoningText = '';
  ui.reasoningStartedAt = Date.now();

  return ui.reasoningEl;
}

/**
 * Quita los escapes de JSON que a veces llegan en el razonamiento.
 *
 * Medido en una sesión real: el bloque mostraba `\"renombra el parametro...\"`
 * con las barras invertidas a la vista, porque el texto venía escapado.
 */
function desescapar(texto) {
  return String(texto)
    .replace(/\\"/g, '"')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\\\/g, '\\');
}

/** Cierra el bloque de razonamiento con su duración. */
function finishReasoningBlock() {
  const block = ui.reasoningEl;
  if (!block) return;

  const seconds = Math.max(1, Math.round((Date.now() - ui.reasoningStartedAt) / 1000));
  block.label.textContent = `Thought for ${seconds}s`;
  /*
   * No se reabre al terminar: en su DOM el bloque queda cerrado. Abrirlo aquí
   * anulaba el estado inicial cerrado y convertía el hilo en una pared de texto.
   */
  block.header.setAttribute('aria-expanded', 'false');
  block.body.hidden = true;

  ui.reasoningEl = null;
}

function ensureToolGroup() {
  if (ui.toolGroup) return ui.toolGroup;

  const wrapper = ensureWorkWrapper();

  /*
   * Antigravity anida un grupo de herramientas dentro de «Worked for» y lo
   * resume por intención: «Explored, ran commands, edited files». Las filas
   * de cada llamada viven dentro de ese grupo.
   */
  const sub = document.createElement('div');
  sub.className = 'work-group work-group--nested';
  const inner = crearColapsable('Ran commands', 'tool-group-collapsible');
  sub.append(inner.header, inner.body);
  wrapper.body.append(sub);

  ui.toolGroup = {
    wrap: wrapper.wrap,
    header: wrapper.header,
    label: wrapper.label,
    body: inner.body,
    inner: { header: inner.header, label: inner.label, body: inner.body },
    startedAt: wrapper.startedAt,
    rows: new Map(),
  };

  return ui.toolGroup;
}

/** Qué se escribió en la «terminal» de la tarjeta: el comando, o la llamada. */
function descripcionDeComando(name, args) {
  const a = args ?? {};
  const comando =
    a.command ?? a.CommandLine ?? a.cmd ?? a.query ?? a.Query ?? a.pattern ?? a.path ?? a.Path ?? a.filePath ?? a.TargetFile ?? a.url ?? a.Url;
  if (typeof comando === 'string' && comando.length > 0) return comando.slice(0, 200);
  if (a && Object.keys(a).length > 0) return `${name} ${JSON.stringify(a).slice(0, 160)}`;
  return name;
}

/**
 * Añade una acción al grupo de trabajo.
 * Formato de Antigravity: «Ran <descripción legible>», desplegable con la salida.
 */
function addToolRow(name, args, callId, target, stepIndex) {
  const group = target ?? ensureToolGroup();

  const row = document.createElement('div');
  row.className = 'work-row is-running';
  row.dataset.tool = name;
  row.dataset.callId = callId ?? '';
  if (Number.isFinite(stepIndex)) row.dataset.stepIndex = String(stepIndex);

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'work-row__header';
  btn.setAttribute('aria-expanded', 'false');

  const etiqueta = friendlyTool(name, args);
  const what = document.createElement('span');
  what.className = 'work-row__what';
  what.textContent = etiqueta;
  what.title = etiqueta;
  const stats = window.ToolSummary?.estadisticasDeCambio(name, args);
  if (stats) {
    const caja = document.createElement('span');
    caja.className = 'work-row__stats';
    const add = document.createElement('span');
    add.className = 'work-row__add';
    add.textContent = `+${stats.additions}`;
    const del = document.createElement('span');
    del.className = 'work-row__del';
    del.textContent = `-${stats.removals}`;
    caja.append(add, del);
    what.append(document.createTextNode(' '), caja);
  }

  const chevron = document.createElement('span');
  chevron.className = 'work-row__chevron';
  chevron.innerHTML = window.Icon('chevron', 14);

  btn.append(what, chevron);

  /*
   * Tarjeta de terminal, como la suya: cabecera con `$` y el comando en mono
   * (6px 12px, 12/16, con borde inferior) y la salida debajo. Medido: radio 8,
   * fondo el del lienzo, borde y sombra suave.
   */
  const terminal = document.createElement('div');
  terminal.className = 'work-row__terminal';
  terminal.hidden = true;

  const cmd = document.createElement('div');
  cmd.className = 'work-row__cmd';
  const prompt = document.createElement('span');
  prompt.className = 'work-row__prompt';
  prompt.textContent = '$';
  cmd.append(prompt, document.createTextNode(descripcionDeComando(name, args)));

  const out = document.createElement('pre');
  out.className = 'work-row__output';

  terminal.append(cmd, out);

  btn.addEventListener('click', () => {
    const open = btn.getAttribute('aria-expanded') === 'true';
    btn.setAttribute('aria-expanded', String(!open));
    terminal.hidden = open;
  });

  row.append(btn, terminal);
  group.body.append(row);

  const entrada = { row, out, cmd, name };
  if (callId) group.rows.set(callId, entrada);
  if (args && Object.keys(args).length > 0) {
    out.textContent = JSON.stringify(args, null, 2);
  }

  return entrada;

  scrollToBottom();
  return row;
}

function formatArgs(args) {
  if (!args || typeof args !== 'object') return '';
  const entries = Object.entries(args).slice(0, 2);
  if (entries.length === 0) return '';

  return (
    '(' +
    entries
      .map(([key, value]) => {
        const raw = typeof value === 'string' ? value : JSON.stringify(value);
        const short = raw.length > 40 ? raw.slice(0, 37) + '…' : raw;
        return `${key}: ${short}`;
      })
      .join(', ') +
    ')'
  );
}

function scrollToBottom() {
  els.thread.scrollTop = els.thread.scrollHeight;
}

// ---------------------------------------------------------------------------
// Eventos del agente
// ---------------------------------------------------------------------------

/**
 * Fila de la herramienta a la que va el veredicto: primero por id de llamada,
 * que es lo único que distingue dos llamadas simultáneas al mismo comando; si
 * el evento no trae id, por herramienta.
 */
function buscarFilaDeHerramienta(nombre, callId) {
  const filas = [...document.querySelectorAll('.work-row')].map((row) => ({
    tool: row.dataset.tool,
    callId: row.dataset.callId,
    running: row.classList.contains('is-running'),
    row,
  }));
  return window.GuardianRow.chooseRow(filas, nombre, callId)?.row ?? null;
}

/** Pinta el veredicto del monitor en la fila de la herramienta. */
function marcarGuardian(fila, texto, clase) {
  let nota = fila.querySelector('.work-row__guardian');
  if (!nota) {
    nota = document.createElement('div');
    nota.className = 'work-row__guardian';
    fila.append(nota);
  }
  nota.className = `work-row__guardian ${clase}`;
  nota.textContent = texto;
}

/** Añade una nota del sistema al hilo (por ejemplo, el monitor de ritmo). */
function addSystemNote(texto) {
  // Fuera de la burbuja que se re-renderiza: si va dentro, el siguiente trozo
  // de Markdown la borra con innerHTML.
  const nota = document.createElement('div');
  nota.className = 'system-note';
  nota.textContent = texto.replace(/^\[monitor de ritmo\]\s*/, '');
  els.threadInner.append(nota);
  scrollToBottom();
}

function handleChatEvent(event) {
  // Los eventos de un subagente de otra conversación ya no pertenecen al hilo
  // visible; se descartan en vez de mezclarse con la sesión actual. Con una
  // conversación nueva (activeConversation null) solo se aceptan si hay turno.
  if (event.subagent && event.sessionId) {
    if (ui.activeConversation) {
      if (event.sessionId !== ui.activeConversation) return;
    } else if (!ui.busy) {
      return;
    }
  }
  switch (event.type) {
    case 'text': {
      if (event.planner) {
        // El texto del planificador no es la respuesta al usuario: va en su grupo.
        appendPlannerText(event.text);
        break;
      }
      finishReasoningBlock();
      if (!ui.streamingEl) addAssistantMessage();

      // Si hubo herramientas intermedias en este turno, asegurar separación de párrafo limpio
      if (ui.huboHerramientasEnTurno) {
        if (ui.streamingText.length > 0 && !ui.streamingText.endsWith('\n\n')) {
          ui.streamingText = ui.streamingText.trimEnd() + '\n\n';
        }
        ui.huboHerramientasEnTurno = false;
      }

      ui.streamingText += event.text;
      renderStreamingMarkdown();
      scrollToBottom();
      break;
    }

    case 'guardian_check': {
      // El clasificador con modelo está evaluando esta acción.
      const fila = buscarFilaDeHerramienta(event.herramienta, event.callId);
      if (fila) fila.classList.add('is-checking');
      break;
    }

    case 'guardian_result': {
      const fila = buscarFilaDeHerramienta(event.herramienta, event.callId);
      if (!fila) break;
      fila.classList.remove('is-checking');

      if (event.fallo) {
        marcarGuardian(fila, 'El monitor no pudo clasificar esta acción', 'is-neutral');
        break;
      }

      if (Number(event.severidad) >= 2) {
        marcarGuardian(
          fila,
          `Monitor de seguridad: ${event.severidad}/10 — ${event.motivo}` +
            (event.cacheado ? ' (en caché)' : ''),
          Number(event.severidad) >= 5 ? 'is-danger' : 'is-warn',
        );
      }
      break;
    }

    case 'stream_reset': {
      // El proveedor cortó y se reintenta: fuera el texto y el razonamiento parciales.
      ui.streamingText = '';
      ui.huboHerramientasEnTurno = false;
      if (ui.streamingEl) renderStreamingMarkdown();
      ui.reasoningEl?.wrap.remove();
      ui.reasoningEl = null;
      ui.reasoningText = '';
      break;
    }

    case 'text_replace': {
      // Los hooks de texto reescribieron la respuesta: se repinta la definitiva.
      if (!ui.streamingEl) break;
      ui.streamingText = event.text;
      renderStreamingMarkdown();
      break;
    }

    case 'reasoning_replace': {
      // El razonamiento se recortó por tamaño.
      const block = ensureReasoningBlock();
      ui.reasoningText = event.text;
      block.text.textContent = event.text;
      break;
    }

    case 'tests_result': {
      // Resultado de la suite: aviso en la barra y, si hay fallos, el detalle.
      const resumen = event.resumen ?? {};
      const texto = event.bien === null
        ? `Tests: ${resumen.pasan ?? '?'} pasan (resultado desconocido)`
        : event.bien
          ? `Tests: ${resumen.pasan ?? '?'} pasan`
          : `Tests: ${resumen.pasan ?? '?'} pasan, ${resumen.fallan ?? '?'} fallan`;

      showAnnouncement(texto);

      if (Array.isArray(resumen.fallos) && resumen.fallos.length > 0) {
        const bloque = document.createElement('div');
        bloque.className = 'tests-failures';

        const titulo = document.createElement('div');
        titulo.className = 'tests-failures__title';
        titulo.textContent = `${resumen.fallos.length} test(s) fallando`;
        bloque.append(titulo);

        for (const fallo of resumen.fallos.slice(0, 20)) {
          const linea = document.createElement('div');
          linea.className = 'tests-failures__item';
          linea.textContent = fallo.nombre;
          bloque.append(linea);
        }

        (ui.streamingEl ?? els.threadInner).append(bloque);
        scrollToBottom();
      }
      break;
    }

    case 'system_note': {
      // Nota del monitor de ritmo: se muestra en el hilo como aviso discreto.
      finishReasoningBlock();
      addSystemNote(event.text);
      scrollToBottom();
      break;
    }

    /*
     * Prompt de sistema del turno (Ajustes › Depuración › Mostrar el prompt).
     * Va plegado: son varios miles de caracteres y no deben tapar la respuesta.
     */
    case 'system_prompt': {
      const caja = document.createElement('details');
      caja.className = 'debug-prompt';
      const resumen = document.createElement('summary');
      resumen.className = 'debug-prompt__summary';
      resumen.textContent = `Prompt de sistema · ${String(event.text ?? '').length.toLocaleString()} caracteres`;
      const cuerpo = document.createElement('pre');
      cuerpo.className = 'debug-prompt__body';
      cuerpo.textContent = String(event.text ?? '');
      caja.append(resumen, cuerpo);
      els.threadInner.append(caja);
      scrollToBottom();
      break;
    }

    case 'reasoning': {
      const block = ensureReasoningBlock();
      ui.reasoningText += event.text;
      block.text.textContent = desescapar(ui.reasoningText);
      scrollToBottom();
      break;
    }

    case 'tool_start': {
      ui.huboHerramientasEnTurno = true;
      finishReasoningBlock();

      /*
       * Marcador mientras se genera la imagen. Desaparece al llegar el
       * resultado; si falla, también.
       */
      if (event.call?.name === 'generate_image') {
        const marcador = document.createElement('div');
        marcador.className = 'generated-image--loading';
        marcador.dataset.imageLoading = '1';

        const etiqueta = document.createElement('span');
        etiqueta.className = 'generated-image__label';
        etiqueta.textContent = 'Generando imagen...';
        marcador.append(etiqueta);

        els.threadInner.append(marcador);
        scrollToBottom();
      }
      if (event.subagent) {
        // Un subagente lanzado por el planificador se anida dentro de su grupo.
        const sub = ensureSubagentGroup(event.subagent, {
          parent: event.planner ? ensurePlannerGroup() : undefined,
          label: event.subagentLabel ? `Subagente: ${event.subagentLabel}` : undefined,
        });
        addToolRow(event.call.name, event.call.arguments, event.call.id, sub);
        break;
      }
      if (event.planner) {
        addToolRow(event.call.name, event.call.arguments, event.call.id, ensurePlannerGroup());
        break;
      }
      noteTouchedFile(event.call);
      addToolRow(event.call.name, event.call.arguments, event.call.id, null, event.stepIndex);
      break;
    }

    case 'tool_end': {
      let entry = ui.toolGroup?.rows.get(event.call.id);
      if (!entry && ui.subagentGroups) {
        for (const grupo of ui.subagentGroups.values()) {
          entry = grupo.rows.get(event.call.id);
          if (entry) break;
        }
      }
      // El marcador de imagen se retira siempre, haya imagen o error.
      document.querySelector('[data-image-loading]')?.remove();

      if (entry) {
        entry.row.classList.remove('is-running');
        entry.row.classList.add(event.isError ? 'is-error' : 'is-done');

        if (event.call?.name === 'generate_image') {
          pintarImagenGenerada(event.content);
        }

        // La cabecera muestra la orden que la herramienta declara haber hecho.
        if (event.command && entry.cmd) {
          entry.cmd.replaceChildren();
          const p = document.createElement('span');
          p.className = 'work-row__prompt';
          p.textContent = '$';
          entry.cmd.append(p, document.createTextNode(String(event.command)));
        }

        entry.out.replaceChildren(renderToolOutput(entry.name, event.content ?? '', event.isError));
        añadirBotonDeshacer(entry.row);
      }
      break;
    }

    case 'aborted': {
      // Las tarjetas interactivas ya se resolvieron en el proceso principal:
      // quitarlas evita que un clic posterior parezca aplicarlas.
      ui.planCard?.rechazar('Turno detenido.');
      ui.planCard = null;
      ui.planEjecutando = false;
      for (const card of els.threadInner.querySelectorAll('.diff-card[data-proposal-id]')) {
        card.querySelector('.diff-card__actions')?.replaceChildren(rowText('Turno cancelado'));
        delete card.dataset.proposalId;
      }
      const hostPregunta = document.getElementById('ask-host');
      if (hostPregunta) {
        hostPregunta.replaceChildren();
        hostPregunta.hidden = true;
        delete hostPregunta.dataset.preguntaPendiente;
      }
      if (event.sessionId) {
        ui.activeConversation = event.sessionId;
        renderPaneTitle();
        void refreshConversations();
      }
      hideLoading();
      finishToolGroup();
      ui.streamingEl = null;
      ui.streamingText = '';
      ui.huboHerramientasEnTurno = false;
      addNotice('Turno detenido.', 'info');
      break;
    }

    case 'plan_handoff': {
      ui.planEjecutando = event.fase === 'ejecutando';
      break;
    }

    case 'error': {
      const bubble = ui.streamingEl ?? addAssistantMessage();
      bubble.classList.add('is-error');
      bubble.textContent = `Error: ${event.message}`;
      break;
    }

    case 'busy':
      setBusy(event.busy);
      if (!event.busy) drenarCola();
      break;

    case 'session_title': {
      // El título semántico llega después de «final»: se refresca la lista.
      void refreshConversations();
      break;
    }

    case 'final':
      if (event.sessionId) {
        ui.activeConversation = event.sessionId;
        if (ui.busy) ui.busyConversation = event.sessionId;
        marcarConversacionOcupada();
        renderPaneTitle();
      }
      hideLoading();
      ui.planEjecutando = false;
      ui.lastAssistantText = ui.streamingText;
      renderStreamingMarkdown(true);
      ui.streamingEl = null;
      ui.streamingText = '';
      ui.huboHerramientasEnTurno = false;
      finishToolGroup();
      playChime();
      showFinalNotice(event);
      // La burbuja de usuario de este turno conoce su índice real en el
      // historial, no la posición entre los `.msg` visibles.
      const usuarios = els.threadInner.querySelectorAll('.msg--user');
      const ultimoUsuario = usuarios[usuarios.length - 1];
      if (ultimoUsuario && typeof event.keepCount === 'number') {
        ultimoUsuario.dataset.messageIndex = String(event.keepCount);
      }
      addMessageToolbar(event.keepCount, ui.lastAssistantText ?? '');
      void addTurnReviewCard();
      refreshConversations();
      // La cola no toca el composer: lo que el usuario esté escribiendo se queda.
      // El envío real espera a `busy:false`, que llega después de guardar en disco.
      drenarCola();
      break;

    default:
      break;
  }
}

/**
 * Entrega los despertares acumulados, de uno en uno.
 *
 * Se llama al cerrar un turno: si el usuario estaba escribiendo cuando una tarea
 * terminó, su resultado se inyecta aquí en vez de perderse.
 */
function entregarDespertares() {
  if (ui.busy || ui.despertaresPendientes.length === 0) return;

  const texto = ui.despertaresPendientes.shift();
  addNotice('Una tarea de fondo terminó. El agente continúa.', 'ok');
  window.api.sendPrompt({ text: texto }).catch(() => {});
}

function setBusy(busy) {
  ui.busy = busy;
  ui.busyConversation = busy ? (ui.activeConversation ?? null) : null;
  if (!busy) ui.planEjecutando = false;
  marcarConversacionOcupada();
  els.input.placeholder = busy
    ? 'El agente está trabajando…'
    : 'Ask anything, @ to mention, / for actions';

  if (!busy) {
    // Un turno acaba de cerrarse: si quedaban despertares, entran ahora.
    setTimeout(() => entregarDespertares(), 0);
  }

  if (busy) {
    ui.toolGroup = null;
    ui.subagentGroups = new Map();
    ui.plannerGroup = null;
    ui.reasoningEl = null;
    ui.reasoningText = '';
    showLoading();
  } else {
    hideLoading();
  }

  setSendMode(busy);
  updateSendState();
}

/** Resumen de herramientas por intención, en el módulo testeable. */
function resumirHerramientas(nombres, traducir) {
  return window.ToolSummary?.resumirHerramientas(nombres, traducir) ?? 'Ran commands';
}

/**
 * Vuelve a pintar los resúmenes de herramientas con el idioma actual.
 * El texto se genera por categorías, así que no basta con traducir el nodo.
 */
function actualizarResumenesHerramientas() {
  const traducir = (texto) => window.I18n?.t(texto) ?? texto;
  for (const header of document.querySelectorAll('[data-testid="tool-group-collapsible"][data-tools]')) {
    const label = header.querySelector('.work-group__label');
    if (!label) continue;
    const nombres = header.dataset.tools.split(',').filter(Boolean);
    label.textContent = resumirHerramientas(nombres, traducir);
  }
}

document.addEventListener('i18n:change', actualizarResumenesHerramientas);

/** Cierra el grupo de trabajo con el tiempo total, como Antigravity. */
function finishToolGroup() {
  finishReasoningBlock();

  const wrapper = ui.workWrapper;
  const group = ui.toolGroup;
  if (!wrapper && !group) return;

  const started = wrapper?.startedAt ?? group.startedAt;
  const seconds = Math.max(1, Math.round((Date.now() - started) / 1000));
  const label = wrapper?.label ?? group.label;
  label.textContent = `Worked for ${seconds}s`;

  // Medido en 2.32: el turno terminado queda CERRADO («Worked for 1m ›»), con
  // los bloques internos dentro. Antes se dejaba desplegado y la pared de
  // filas de pensamiento tapaba la respuesta.
  const header = wrapper?.header ?? group.header;
  header.setAttribute('aria-expanded', 'false');
  const cuerpo = wrapper?.body ?? group.body;
  if (cuerpo) cuerpo.hidden = true;

  if (group?.inner) {
    /*
     * Con una sola llamada no hay fila de grupo: en 2.32 el «Ran <descripción>»
     * cuelga directamente del resumen del turno. «Ran commands» solo aparece
     * cuando hay varias llamadas.
     */
    const filas = [...group.inner.body.querySelectorAll('.work-row')];
    if (filas.length === 1 && wrapper?.body) {
      const sub = group.inner.header.parentElement;
      const fila = filas[0];
      fila.remove();
      sub?.remove();
      wrapper.body.append(fila);
    } else {
      const nombres = [...group.rows.values()].map((fila) => fila.name);
      const traducir = (texto) => window.I18n?.t(texto) ?? texto;
      group.inner.label.textContent = resumirHerramientas(nombres, traducir);
      group.inner.header.dataset.tools = nombres.join(',');
      group.inner.header.setAttribute('aria-expanded', 'false');
      group.inner.body.hidden = true;
    }
  }

  ui.workWrapper = null;
  ui.toolGroup = null;
  ui.subagentGroups = new Map();
  ui.plannerGroup = null;
  ui.reasoningEl = null;
  ui.reasoningText = '';
}

// ---------------------------------------------------------------------------
// Envío
// ---------------------------------------------------------------------------

/** Adjuntos pegados o arrastrados al composer. */
const MAX_ADJUNTO = 10 * 1024 * 1024;

function tamanoLegible(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function renderAttachments() {
  const host = $('composer-attachments');
  if (!host) return;
  host.replaceChildren();
  host.hidden = ui.attachments.length === 0;
  for (const adjunto of ui.attachments) {
    const chip = document.createElement('div');
    chip.className = 'composer-attachment';
    if (adjunto.mime?.startsWith('image/')) {
      const preview = document.createElement('img');
      preview.src = adjunto.dataUrl;
      preview.alt = adjunto.name;
      chip.append(preview);
    }
    const texto = document.createElement('span');
    texto.className = 'composer-attachment__name';
    texto.textContent = adjunto.name;
    texto.title = `${adjunto.name} · ${tamanoLegible(adjunto.size)}`;
    const quitar = document.createElement('button');
    quitar.type = 'button';
    quitar.className = 'composer-attachment__remove';
    quitar.setAttribute('aria-label', `Quitar ${adjunto.name}`);
    quitar.textContent = '×';
    quitar.addEventListener('click', () => {
      ui.attachments = ui.attachments.filter((item) => item.id !== adjunto.id);
      renderAttachments();
      updateSendState();
    });
    chip.append(texto, quitar);
    host.append(chip);
  }
}

function leerArchivo(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('no se pudo leer el archivo'));
    reader.readAsDataURL(file);
  });
}

let lecturasPendientes = Promise.resolve();

function agregarArchivos(files) {
  // Si el usuario pulsa Enter mientras FileReader lee, el envío debe esperar:
  // antes el adjunto llegaba tarde y viajaba con el mensaje siguiente.
  const tarea = lecturasPendientes.then(async () => {
    for (const file of [...files]) {
      if (file.size > MAX_ADJUNTO) {
        addNotice(`${file.name || 'Archivo'}: máximo 10 MB.`, 'error');
        continue;
      }
      try {
        const dataUrl = await leerArchivo(file);
        ui.attachments.push({
          id: `adj-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          name: file.name || 'archivo',
          mime: file.type || 'application/octet-stream',
          size: file.size,
          dataUrl,
        });
      } catch (error) {
        addNotice(`No se pudo adjuntar ${file.name || 'archivo'}: ${error?.message ?? error}`, 'error');
      }
    }
    renderAttachments();
    updateSendState();
  });
  lecturasPendientes = tarea.catch(() => {});
  return tarea;
}

function manejarPegado(event) {
  const items = [...(event.clipboardData?.items ?? [])];
  const files = items
    .filter((item) => item.kind === 'file')
    .map((item) => item.getAsFile())
    .filter(Boolean);
  if (files.length === 0) return;
  event.preventDefault();
  void agregarArchivos(files);
}

function manejarDrop(event) {
  const files = [...(event.dataTransfer?.files ?? [])];
  if (files.length === 0) return;
  event.preventDefault();
  void agregarArchivos(files);
}

/** ¿Se puede empezar un turno ahora? Con un plan pendiente, sí: es la revisión. */
function puedeEnviar() {
  return !ui.loadingConversation && (!ui.busy || Boolean(ui.planCard));
}

async function send() {
  await lecturasPendientes;
  const text = els.input.value.trim();
  const adjuntos = ui.attachments.slice();
  if ((text.length === 0 && adjuntos.length === 0) || !puedeEnviar()) return;

  els.input.value = '';
  ui.attachments = [];
  renderAttachments();
  autoGrow();
  updateSendState();

  await sendText(text, adjuntos);
}

/**
 * Envía un texto ya decidido. No lee ni escribe el composer: así la cola no
 * pisa lo que el usuario está escribiendo.
 */
async function sendText(texto, adjuntos = []) {
  const text = String(texto ?? '').trim();
  if (ui.loadingConversation) {
    addNotice('Espera a que termine de abrir la conversación.', 'info');
    return false;
  }
  if ((text.length === 0 && adjuntos.length === 0) || !puedeEnviar()) return false;

  if (els.threadEmpty) els.threadEmpty.remove();

  hideCommandPalette();
  hideMentionPalette();

  const mentions = collectMentions(text);
  const etiquetaAdjuntos = adjuntos.map((adjunto) => adjunto.name).join(', ');
  addUserMessage(text || etiquetaAdjuntos);
  if (ui.planCard) ui.planCard.rechazar(text);

  let result;
  try {
    result = await window.api.sendPrompt({
      text,
      mentions,
      attachments: adjuntos.map((adjunto) => ({
        name: adjunto.name,
        mime: adjunto.mime,
        dataUrl: adjunto.dataUrl,
        size: adjunto.size,
      })),
      effort: ui.effort,
      preset: ui.prefs.permissionPreset ?? 'Turbo',
      // Solo cuenta si el modelo actual lo admite; el proceso principal lo valida otra vez.
      thinking: ui.thinking === true && modeloAdmitePensamiento(),
    });
  } catch (error) {
    const bubble = addAssistantMessage();
    bubble.classList.add('is-error');
    bubble.textContent = `Error: ${error?.message ?? error}`;
    return false;
  }
  if (!result?.ok && result?.error) {
    const bubble = addAssistantMessage();
    bubble.classList.add('is-error');
    bubble.textContent = `Error: ${result.error}`;
  }
  // El texto con un plan pendiente no inicia un turno: no hay que borrar el
  // streaming parcial que ya estaba en pantalla.
  if (result?.planFeedback) return true;
  ui.streamingEl = null;
  ui.streamingText = '';
  ui.huboHerramientasEnTurno = false;
  return true;
}

/** Envía el siguiente mensaje en cola si el turno anterior ya terminó. */
function drenarCola() {
  if (ui.busy || ui.queue.length === 0) return;
  const next = ui.queue.shift();
  void enviarEncolado(next);
}

/** Envío de la cola: si no llegó a salir, el mensaje vuelve a la cabeza. */
async function enviarEncolado(text) {
  const ok = await sendText(text);
  if (!ok) ui.queue.unshift(text);
}

// ---------------------------------------------------------------------------
// Conversaciones guardadas
// ---------------------------------------------------------------------------

/** Texto visible de un mensaje de usuario; oculta los envoltorios internos. */
function textoVisibleDeUsuario(content) {
  let texto = String(content ?? '');
  const peticion = /<USER_REQUEST>\s*([\s\S]*?)\s*<\/USER_REQUEST>/i.exec(texto);
  if (peticion) texto = peticion[1];
  texto = texto.replace(/<ADDITIONAL_METADATA>[\s\S]*?<\/ADDITIONAL_METADATA>/gi, '').trim();
  return texto;
}

async function openConversation(id) {
  if (ui.loadingConversation) {
    addNotice('Espera a que termine de abrir la conversación.', 'info');
    return;
  }
  if (ui.busy) {
    addNotice('El agente está trabajando en esta conversación. Espera o pulsa Detener.', 'info');
    return;
  }
  // Si la vista de Automations está abierta, se cierra: ocupa el área del hilo.
  closeAutomations();
  /*
   * Token de generación: si el usuario abre otra conversación mientras esta
   * carga, la respuesta lenta ya no repinta encima de la elegida.
   */
  const token = ++ui.loadToken;
  ui.loadingConversation = true;
  try {
    const loaded = await window.api.loadSession(id);
    if (token !== ui.loadToken) return;
    if (!loaded || loaded.ok === false) {
      addNotice(loaded?.error ?? 'No se pudo abrir la conversación.', 'error');
      return;
    }

    ui.activeConversation = loaded.meta.id;
    ui.cwd = loaded.meta.cwd ?? ui.cwd;
    ui.project =
      loaded.project ??
      (loaded.meta.project === null ? null : loaded.meta.project ?? loaded.meta.cwd ?? null);
    if (ui.project) reflejarProyecto(ui.project);
    else reflejarSinProyecto();
    renderPaneTitle();

    clearThread();

    // Los mensajes `tool` no guardan argumentos; la llamada que los originó
    // está en el mensaje `assistant` anterior. Se usan para que el historial
    // pinte el comando y no un genérico «Ran command».
    const llamadasPorId = new Map();
    for (const message of loaded.messages) {
      if (message.role !== 'assistant' || !Array.isArray(message.toolCalls)) continue;
      for (const llamada of message.toolCalls) {
        if (llamada?.id) llamadasPorId.set(llamada.id, llamada);
      }
    }

    // El historial guarda las llamadas de escritura, así que la tarjeta de
    // ficheros cambiados se reconstruye por turno con sus estadísticas.
    let cambiosPendientes = new Map();
    const sumarCambio = (llamada) => {
      const nombre = llamada?.name;
      if (!['write_file', 'edit_file', 'multi_replace'].includes(nombre)) return;
      let args = llamada.arguments ?? {};
      if (typeof args === 'string') {
        try {
          args = JSON.parse(args);
        } catch {
          return;
        }
      }
      const ruta = args.path ?? args.file_path ?? args.filePath;
      if (typeof ruta !== 'string' || !ruta) return;
      const stats = window.ToolSummary?.estadisticasDeCambio(nombre, args) ?? {
        additions: 0,
        removals: 0,
      };
      const previo = cambiosPendientes.get(ruta) ?? { path: ruta, additions: 0, removals: 0 };
      previo.additions += stats.additions ?? 0;
      previo.removals += stats.removals ?? 0;
      cambiosPendientes.set(ruta, previo);
    };
    const vaciarCambios = () => {
      if (!cambiosPendientes.size) return;
      const entries = [...cambiosPendientes.values()];
      const card = crearTarjetaCambios({
        files: entries.length,
        additions: entries.reduce((total, e) => total + e.additions, 0),
        removals: entries.reduce((total, e) => total + e.removals, 0),
        entries,
      });
      if (card) insertarTarjetaCambios(card);
      cambiosPendientes = new Map();
    };

    let indiceDeMensaje = 0;
    for (const message of loaded.messages) {
      indiceDeMensaje += 1;
      if (message.role === 'user') {
        /*
         * Los mensajes internos (nudges, avisos de tareas) viajan como `user`
         * para el modelo, pero no los escribió el usuario. Si se pintan como
         * burbuja de usuario, el historial parece una conversación ajena.
         */
        const texto = String(message.content);
        // Sesiones antiguas guardaron mensajes internos sin la bandera.
        const interna =
          message.internal === true ||
          /^\[(monitor de ritmo|tarea terminada|revisión de plan|memoria activada)\b/i.test(texto);
        if (interna) {
          const nota = document.createElement('div');
          nota.className = 'system-note';
          nota.textContent = texto.replace(/^\[monitor de ritmo\]\s*/, '');
          els.threadInner.append(nota);
          continue;
        }
        vaciarCambios();
        const visible = textoVisibleDeUsuario(message.content);
        if (visible) addUserMessage(visible, indiceDeMensaje - 1);
      } else if (message.role === 'assistant') {
        for (const llamada of message.toolCalls ?? []) sumarCambio(llamada);
        if (message.content) {
          const wrap = document.createElement('div');
          wrap.className = 'msg msg--assistant';
          const bubble = document.createElement('div');
          bubble.className = 'msg__bubble msg__bubble--md';
          bubble.innerHTML = window.Markdown.render(message.content);
          wrap.append(bubble);
          els.threadInner.append(wrap);

          // El pie también en el historial: hora, copiar y votos.
          const cuando = message.createdAt ?? loaded.meta.updatedAt ?? loaded.meta.createdAt;
          addMessageToolbar(
            // Índice real del mensaje: hace única la reacción y permite undo
            // también en el historial reabierto.
            indiceDeMensaje - 1,
            message.content,
            cuando ? relativeTime(cuando) : undefined,
          );
        }
      } else if (message.role === 'tool') {
        // Una fila de historial ya está terminada: se pinta con su salida y sin
        // dejarla marcada como «en ejecución».
        // El callId sintético hace que la fila quede registrada en el grupo, que es
        // de donde sale la línea de resumen del turno.
        const llamada = message.toolCallId ? llamadasPorId.get(message.toolCallId) : null;
        const fila = addToolRow(
          llamada?.name ?? message.name ?? 'tool',
          llamada?.arguments ?? {},
          `hist-${indiceDeMensaje}`,
        );
        if (fila) {
          fila.row.classList.remove('is-running');
          fila.row.classList.add('is-done');
          fila.out.replaceChildren(renderToolOutput(fila.name, message.content ?? '', false));
          // El historial solo guarda «Guardada en …»: la imagen se repinta aquí.
          if (fila.name === 'generate_image') pintarImagenGenerada(message.content);
        }
      }
    }

    vaciarCambios();

    // Sin esto, una conversación guardada se queda en «Working…» para siempre.
    finishToolGroup();

    renderNavigator();
    scrollToBottom();
    refreshConversations();
    // La conversación puede traer otro workspace: árbol y git deben seguirlo.
    void loadFileIndex();
    void refreshGit();
  } catch (error) {
    console.error(error);
    addNotice('No se pudo abrir la conversación.', 'error');
  } finally {
    if (token === ui.loadToken) ui.loadingConversation = false;
  }
}

async function newConversation() {
  // Antes solo se limpiaba la UI: el motor seguía con `state.sessionId` y el
  // mensaje nuevo se añadía a la conversación anterior. Hay que resetearlo.
  if (ui.loadingConversation) {
    addNotice('Espera a que termine de abrir la conversación.', 'info');
    return false;
  }
  if (ui.busy) {
    addNotice('El agente está trabajando. Espera o pulsa Detener antes de crear otra conversación.', 'info');
    return false;
  }
  try {
    const resultado = await window.api.newSession();
    if (resultado && resultado.ok === false) {
      addNotice(resultado.error ?? 'No se pudo crear la conversación.', 'error');
      return false;
    }
  } catch {
    // sin IPC se mantiene el flujo local
  }
  closeAutomations();
  ui.activeConversation = null;
  renderPaneTitle();
  clearThread();

  const empty = document.createElement('div');
  empty.className = 'thread__empty';
  empty.id = 'thread-empty';
  // Mismo estado vacío que el del HTML: marca de agua + saludo por nombre.
  empty.innerHTML =
    '<span class="thread__empty-mark"></span>' +
    '<div class="thread__empty-title"></div>';
  els.threadInner.append(empty);
  aplicarSaludo(empty);

  els.input.focus();
  refreshConversations();
  return true;
}

// ---------------------------------------------------------------------------
// Textarea
// ---------------------------------------------------------------------------

function autoGrow() {
  els.input.style.height = 'auto';
  els.input.style.height = Math.min(els.input.scrollHeight, 200) + 'px';
}

function updateSendState() {
  if (ui.busy) {
    els.send.disabled = false;
    els.send.classList.remove('is-ready');
    return;
  }

  const ready = els.input.value.trim().length > 0 || ui.attachments.length > 0;
  els.send.disabled = !ready;
  els.send.classList.toggle('is-ready', ready);
}

// ---------------------------------------------------------------------------
// Proveedores y modelo
// ---------------------------------------------------------------------------

async function loadProviders(force = false) {
  try {
    const lista = force && window.api.refreshProviders
      ? await window.api.refreshProviders()
      : await window.api.listProviders();
    if (Array.isArray(lista)) ui.providers = lista;
  } catch {
    // sin respuesta nueva: se mantiene lo que ya había
  }

  /*
   * Si el proveedor actual ya reporta modelos y el guardado no está entre ellos
   * (nunca se eligió, o desapareció), se elige el primero DE ESE PROVEEDOR.
   * No se cambia de proveedor ni se toca otro modelo.
   */
  const actual = ui.providers.find((provider) => provider.id === ui.providerId);
  if (actual && actual.models.length > 0) {
    const vigente = actual.models.some((model) => model.id === ui.model);
    if (!vigente) {
      ui.model = actual.models[0].id;
      window.api.setModel({ provider: ui.providerId, model: ui.model }).catch(() => {});
    }
  }

  renderModelLabel();
  renderModelPopover();
  window.SettingsUI?.refresh();
}

function currentProvider() {
  return ui.providers.find((provider) => provider.id === ui.providerId) ?? null;
}

function renderModelLabel() {
  renderThinkingToggle();
  const provider = currentProvider();
  const elegido = provider?.models?.find((model) => model.id === ui.model);
  if (elegido) {
    els.modelLabel.textContent = elegido.name || elegido.id;
    return;
  }
  if (ui.model) {
    els.modelLabel.textContent = ui.model;
    return;
  }

  els.modelLabel.textContent = provider ? `${provider.label} · sin modelo` : 'sin modelo';
}

/** ¿El modelo seleccionado admite pensamiento extendido explícito? */
function modeloAdmitePensamiento() {
  const provider = currentProvider();
  return Boolean(provider?.models?.find((model) => model.id === ui.model)?.thinking);
}

/**
 * Muestra u oculta el botón de pensamiento del chat.
 *
 * Nunca cambia de modelo: si el actual no lo admite, el botón desaparece y el
 * turno se envía sin pensamiento.
 */
function renderThinkingToggle() {
  const boton = $('btn-thinking');
  if (!boton) return;

  const admite = modeloAdmitePensamiento();
  if (!admite) ui.thinking = false;
  boton.hidden = !admite;
  boton.classList.toggle('is-active', admite && ui.thinking);
  boton.setAttribute('aria-pressed', String(admite && ui.thinking));
}

function renderModelPopover() {
  els.modelPopoverBody.replaceChildren();

  const available = ui.providers.filter((provider) => provider.available);

  if (available.length === 0) {
    const note = document.createElement('div');
    note.className = 'popover__note';
    note.textContent =
      'No hay proveedores disponibles. Arranca Ollama en local (ollama serve) o define una clave en el entorno: OPENAI_API_KEY, ANTHROPIC_API_KEY o GEMINI_API_KEY.';
    els.modelPopoverBody.append(note);
    return;
  }

  for (const provider of available) {
    const groupTitle = document.createElement('div');
    groupTitle.className = 'popover__group-title';
    groupTitle.textContent = provider.label;
    els.modelPopoverBody.append(groupTitle);

    for (const model of provider.models) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'popover__item';
      if (provider.id === ui.providerId && model.id === ui.model) {
        item.classList.add('is-selected');
      }
      item.textContent = model.name;

      item.addEventListener('click', async () => {
        await selectModel(provider.id, model.id);
        hideModelPopover();
      });

      els.modelPopoverBody.append(item);
    }
  }
}

async function selectModel(providerId, modelId) {
  ui.providerId = providerId;
  ui.model = modelId;
  renderModelLabel();
  window.SettingsUI?.refresh();

  try {
    await window.api.setModel({ provider: providerId, model: modelId });
  } catch (error) {
    console.error('No se pudo guardar el modelo:', error);
  }
}

function toggleModelPopover() {
  const isHidden = els.modelPopover.hasAttribute('hidden');
  if (isHidden) {
    renderModelPopover();
    els.modelPopover.removeAttribute('hidden');
  } else {
    hideModelPopover();
  }
}

function hideModelPopover() {
  els.modelPopover.setAttribute('hidden', '');
}

// ---------------------------------------------------------------------------
// Ajustes
// ---------------------------------------------------------------------------

function openSettings() {
  // Ajustes es un modal sobre el hilo: Automations no debe quedarse detrás.
  closeAutomations();
  window.SettingsUI.open();
}

function closeSettings() {
  window.SettingsUI.close();
}

// ---------------------------------------------------------------------------
// Preferencias aplicadas
// ---------------------------------------------------------------------------

let activeMonacoThemeName = 'agent-dark';
let activeXtermTheme = null;
const systemColorScheme =
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null;

function applyMonacoTheme(monacoTheme) {
  const monaco = window.MonacoApp?.monaco;
  if (!monaco || !monacoTheme) return;
  monaco.editor.defineTheme('opengravity-dynamic', monacoTheme);
  monaco.editor.setTheme('opengravity-dynamic');
  activeMonacoThemeName = 'opengravity-dynamic';
}

function applyXtermTheme(xtermTheme) {
  if (!xtermTheme) return;
  activeXtermTheme = xtermTheme;
  if (typeof terminales === 'undefined') return;
  for (const entrada of terminales.values()) {
    if (entrada?.xterm?.options) {
      entrada.xterm.options.theme = xtermTheme;
    }
  }
}

function applyTheme(prefs) {
  const prefersDark = systemColorScheme ? systemColorScheme.matches : true;
  const root = document.documentElement.style;

  if (window.ThemeEngine) {
    const tokens = window.ThemeEngine.buildThemeTokens(prefs, prefersDark);
    document.documentElement.dataset.theme = tokens.mode;
    document.documentElement.dataset.contrast = tokens.contrast;
    document.documentElement.dataset.preset = tokens.presetId.toLowerCase().replace(/\s+/g, '-');
    for (const [variable, value] of Object.entries(tokens.cssVars)) {
      root.setProperty(variable, value);
    }
    applyMonacoTheme(tokens.monacoTheme);
    applyXtermTheme(tokens.xtermTheme);
    return;
  }

  document.documentElement.dataset.contrast =
    prefs?.themeContrast === 'Strong' ? 'strong' : 'default';
  document.documentElement.dataset.theme = prefs?.theme === 'Light' ? 'light' : 'dark';
}

if (systemColorScheme && typeof systemColorScheme.addEventListener === 'function') {
  systemColorScheme.addEventListener('change', () => {
    if (ui.prefs?.theme === 'System') {
      applyTheme(ui.prefs);
      requestAnimationFrame(() => { void window.api.refreshTitlebar?.(); });
    }
  });
}

/** Aplica las preferencias que cambian la interfaz. */
function applyPrefs(prefs) {
  if (!prefs) return;
  ui.prefs = { ...ui.prefs, ...prefs };

  // Nivel de esfuerzo del modelo (Low / Medium / High).
  if (typeof ui.prefs.effort === 'string' && ui.prefs.effort) {
    ui.effort = ui.prefs.effort;
    if (els.effortLabel) els.effortLabel.textContent = ui.effort;
  }

  applyTheme(ui.prefs);

  // La barra nativa se pinta después de aplicar los tokens, también al
  // arrancar con un tema guardado.
  requestAnimationFrame(() => { void window.api.refreshTitlebar?.(); });
  setTimeout(() => { void window.api.refreshTitlebar?.(); }, 350);

  if (window.I18n) {
    if (ui.prefs.uiLanguage === 'Español') ui.prefs.uiLanguage = 'es';
    if (ui.prefs.uiLanguage === 'English') ui.prefs.uiLanguage = 'en';
    const idioma = window.I18n.resolveLanguage(ui.prefs.uiLanguage);
    window.I18n.setLanguage(idioma);
  }
}

/** Nombre del saludo: el del perfil o, si está vacío, el de la cuenta del sistema. */
function nombreDeSaludo() {
  const perfil = String(ui.prefs.profile?.name ?? '').trim();
  const sistema = String(ui.userName ?? '').trim();
  const nombre = perfil || sistema;
  return nombre ? nombre.charAt(0).toUpperCase() + nombre.slice(1) : '';
}

/**
 * Saludo del estado vacío. Medido en su DOM: «Hey Darío, what should we build
 * today?», 24/32 con tracking -0.36; en español se mantiene la misma fórmula.
 */
function textoDeSaludo() {
  const nombre = nombreDeSaludo();
  if (window.I18n?.language === 'es') {
    return nombre ? `Hola ${nombre}, ¿qué construimos hoy?` : 'Hola, ¿qué construimos hoy?';
  }
  return nombre ? `Hey ${nombre}, what should we build today?` : 'Hey, what should we build today?';
}

/** Pinta el saludo donde exista el estado vacío. */
function aplicarSaludo(raiz = document) {
  const titulo = raiz.querySelector?.('.thread__empty-title');
  if (titulo) titulo.textContent = textoDeSaludo();
}

/** Cabecera de sección plegable, como la suya. */
function conectarSeccionPlegable(botonId, listaId) {
  const boton = $(botonId);
  const lista = $(listaId);
  if (!boton || !lista) return;

  boton.addEventListener('click', () => {
    const plegada = !lista.hidden;
    lista.hidden = plegada;
    boton.setAttribute('aria-expanded', String(!plegada));
    boton.closest('.sidebar__section')?.classList.toggle('is-collapsed', plegada);
  });
}

/** Carga una URL en el webview, esperando a que esté listo si hace falta. */
let navegadorCargar = null;
/** Pestaña del navegador en la fila superior del panel. */
let navegadorAbierto = false;
let navegadorTitulo = '';

/** URL del webview; antes de engancharse, `getURL` lanza y se trata como vacía. */
function urlDelNavegador(vista) {
  try {
    return String(vista.getURL?.() ?? '');
  } catch {
    return '';
  }
}

/** Cablea el navegador integrado una sola vez. */
function conectarNavegador() {
  const vista = document.getElementById('aux-browser-view');
  if (!vista || navegadorCargar) return;

  const entrada = document.getElementById('aux-browser-input');
  const atras = document.getElementById('aux-browser-back');
  const adelante = document.getElementById('aux-browser-forward');
  const recargar = document.getElementById('aux-browser-reload');
  const formulario = document.getElementById('aux-browser-form');
  const findbar = document.getElementById('aux-browser-findbar');
  const findInput = document.getElementById('aux-browser-find-input');
  const findStatus = document.getElementById('aux-browser-find-status');

  let findRequest = 0;

  const cerrarFind = () => {
    if (!findbar) return;
    findbar.hidden = true;
    if (findStatus) findStatus.textContent = '';
    try {
      vista.stopFindInPage('clearSelection');
    } catch {
      // webview todavía no enganchado
    }
  };

  const abrirFind = () => {
    if (!findbar || !findInput) return;
    findbar.hidden = false;
    findInput.focus();
    findInput.select();
  };

  const buscarEnPagina = (adelante = true) => {
    if (!findInput) return;
    const texto = findInput.value.trim();
    if (!texto) {
      cerrarFind();
      return;
    }
    try {
      findRequest = vista.findInPage(texto, { forward: adelante, findNext: true });
    } catch {
      // el webview puede no estar listo todavía
    }
  };

  const mostrarUrl = () => {
    if (!entrada) return;
    const url = urlDelNavegador(vista);
    if (!url || url === 'about:blank') return;
    entrada.value = url.replace(/^https?:\/\//i, '').replace(/\/$/, '');
    if (atras) atras.disabled = !vista.canGoBack?.();
    if (adelante) adelante.disabled = !vista.canGoForward?.();
  };

  /*
   * El webview no se engancha hasta que el panel es visible; `loadURL` falla
   * antes. El atributo `src` sí navega en cuanto se engancha, sin condición.
   */
  navegadorCargar = (url) => {
    /*
     * `setAttribute('src')` no navega si el valor ya estaba (el webview lo
     * conserva de la primera carga), así que reescribir la misma URL no hacía
     * nada. `loadURL` navega siempre; antes de engancharse lanza, y ahí sí vale
     * el atributo.
     */
    try {
      vista.loadURL(url).catch(() => vista.setAttribute('src', url));
    } catch {
      vista.setAttribute('src', url);
    }
  };

  vista.addEventListener('dom-ready', mostrarUrl);
  vista.addEventListener('page-title-updated', (event) => {
    navegadorTitulo = String(event.title ?? '').trim();
    pintarPestanasTerminal();
  });
  for (const evento of ['did-navigate', 'did-navigate-in-page', 'did-stop-loading']) {
    vista.addEventListener(evento, mostrarUrl);
  }
  vista.addEventListener('did-start-loading', () => {
    if (atras) atras.disabled = !vista.canGoBack?.();
    if (adelante) adelante.disabled = !vista.canGoForward?.();
  });

  atras?.addEventListener('click', () => {
    if (vista.canGoBack?.()) vista.goBack();
  });
  adelante?.addEventListener('click', () => {
    if (vista.canGoForward?.()) vista.goForward();
  });
  recargar?.addEventListener('click', () => vista.reload());
  formulario?.addEventListener('submit', (event) => {
    event.preventDefault();
    const texto = String(entrada?.value ?? '').trim();
    if (!texto) return;
    navegadorCargar?.(/^[a-z][a-z0-9+.-]*:\/\//i.test(texto) ? texto : `https://${texto}`);
    vista.focus();
  });

  document.getElementById('aux-browser-find')?.addEventListener('click', abrirFind);
  document.getElementById('aux-browser-find-close')?.addEventListener('click', cerrarFind);
  findInput?.addEventListener('input', () => buscarEnPagina(true));
  findInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      buscarEnPagina(!event.shiftKey);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      cerrarFind();
    }
  });
  vista.addEventListener('found-in-page', (event) => {
    if (!findStatus) return;
    const { matches = 0, activeMatchOrdinal = 0 } = event.result ?? {};
    findStatus.textContent = matches > 0 ? `${activeMatchOrdinal}/${matches}` : '0/0';
  });
  vista.addEventListener('before-input-event', (event) => {
    const input = event.input ?? {};
    if ((input.control || input.meta) && String(input.key).toLowerCase() === 'f') {
      event.preventDefault();
      abrirFind();
    }
  });
  document.addEventListener('keydown', (event) => {
    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'f') return;
    const panel = document.getElementById('aux-view-browser');
    if (!panel || panel.hidden) return;
    event.preventDefault();
    abrirFind();
  });

  const botonDescargas = document.getElementById('aux-browser-downloads');
  const panelDescargas = document.getElementById('aux-browser-downloads-panel');
  const renderDescargas = (lista = []) => {
    if (!panelDescargas) return;
    panelDescargas.replaceChildren();

    if (!Array.isArray(lista) || lista.length === 0) {
      const vacio = document.createElement('div');
      vacio.className = 'aux-browser__download-empty';
      vacio.textContent = 'Sin descargas';
      panelDescargas.append(vacio);
      return;
    }

    for (const descarga of lista) {
      const fila = document.createElement('button');
      fila.type = 'button';
      fila.className = 'aux-browser__download';

      const nombre = document.createElement('span');
      nombre.textContent = String(descarga.filename ?? 'Descarga');

      const estado = document.createElement('span');
      estado.className = 'aux-browser__download-state';
      estado.textContent = String(descarga.state ?? 'progressing');

      fila.append(nombre, estado);
      fila.addEventListener('click', () => {
        void window.api.downloadsOpen?.(descarga.id);
      });
      panelDescargas.append(fila);
    }
  };

  botonDescargas?.addEventListener('click', async () => {
    if (!panelDescargas) return;
    panelDescargas.hidden = !panelDescargas.hidden;
    if (!panelDescargas.hidden) {
      try {
        renderDescargas(await window.api.downloadsList?.());
      } catch {
        renderDescargas([]);
      }
    }
  });

  try {
    window.api.onDownloadsUpdate?.(renderDescargas);
  } catch {
    // sin puente de descargas se mantiene el rellenado bajo demanda
  }
}

/** Muestra el navegador en el panel y carga su página de inicio la primera vez. */
function abrirNavegadorLateral() {
  conectarNavegador();
  const vista = document.getElementById('aux-browser-view');
  if (!vista) return;

  if (!navegadorAbierto) {
    navegadorAbierto = true;
    pintarPestanasTerminal();
  }

  const actual = urlDelNavegador(vista);
  if (actual === '' || actual === 'about:blank') navegadorCargar?.('https://www.google.com/');
}

/** Cierra la pestaña del navegador y vuelve al lanzador. */
function cerrarNavegador() {
  navegadorAbierto = false;
  pintarPestanasTerminal();
  seleccionarVistaAux('launcher');
}

/** Carga herramientas, skills y estado del control remoto. */
async function loadCatalogues() {
  try {
    ui.tools = await window.api.listTools();
  } catch {
    ui.tools = [];
  }
  try {
    ui.skills = await window.api.listSkills();
  } catch {
    ui.skills = [];
  }
  try {
    ui.remote = await window.api.remoteStatus();
  } catch {
    ui.remote = { running: false, url: null };
  }
}

/** Arranca o detiene el servidor de control remoto. */
async function toggleRemote() {
  try {
    if (ui.remote.running) {
      await window.api.remoteStop();
    } else {
      await window.api.remoteStart();
    }
  } catch (error) {
    console.error('Control remoto:', error);
  }
  ui.remote = await window.api.remoteStatus();
  window.SettingsUI.refresh();
}

/** Pitido de fin de turno, con el volumen configurado. */
function playChime() {
  if (ui.prefs.sounds !== true) return;

  const volume = Math.max(0, Math.min(100, Number(ui.prefs.volume ?? 100))) / 100;
  if (volume === 0) return;

  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;

    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(660, ctx.currentTime + 0.12);

    gain.gain.setValueAtTime(volume * 0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.22);

    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.24);

    osc.addEventListener('ended', () => ctx.close().catch(() => {}));
  } catch {
    // el audio es best-effort
  }
}

// ---------------------------------------------------------------------------
// Menciones @
// ---------------------------------------------------------------------------

/** Carga el índice de ficheros del workspace (una vez por workspace). */
async function loadFileIndex() {
  const workspace = ui.cwd;
  let indice;
  try {
    indice = await window.api.indexFiles();
  } catch {
    indice = [];
  }
  // Otra apertura de proyecto pudo terminar antes: su índice es el válido.
  if (ui.cwd !== workspace) return;
  ui.fileIndex = indice;
  renderFileTree();
}

/** Detecta si el cursor está escribiendo una mención `@`. */
function currentMentionQuery() {
  const value = els.input.value;
  const caret = els.input.selectionStart ?? value.length;
  const before = value.slice(0, caret);
  const at = before.lastIndexOf('@');

  if (at === -1) return null;
  // Solo si el @ está al inicio o tras un espacio, y no hay espacio después.
  if (at > 0 && !/\s/.test(before[at - 1])) return null;

  const fragment = before.slice(at + 1);
  if (/\s/.test(fragment)) return null;

  return { at, query: fragment.toLowerCase() };
}

/** Muestra u oculta la paleta de ficheros. */
function updateMentionPalette() {
  const mention = currentMentionQuery();
  if (!mention) {
    hideMentionPalette();
    return;
  }

  const matches = ui.fileIndex
    .filter((path) => path.toLowerCase().includes(mention.query))
    .slice(0, 30);

  ui.mentionMatches = matches;
  ui.mentionIndex = Math.min(ui.mentionIndex, Math.max(0, matches.length - 1));

  if (matches.length === 0) {
    hideMentionPalette();
    return;
  }

  els.mentionPopoverBody.replaceChildren();

  matches.forEach((path, index) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'popover__item';
    if (index === ui.mentionIndex) item.classList.add('is-selected');

    const label = document.createElement('span');
    label.className = 'mention__path';
    label.textContent = path;

    item.append(label);
    item.addEventListener('mousedown', (event) => {
      event.preventDefault();
      insertMention(path);
    });

    els.mentionPopoverBody.append(item);
  });

  els.mentionPopover.removeAttribute('hidden');
}

function hideMentionPalette() {
  els.mentionPopover.setAttribute('hidden', '');
  ui.mentionMatches = [];
  ui.mentionIndex = 0;
}

/** Sustituye el fragmento `@...` por la ruta elegida. */
function insertMention(path) {
  const mention = currentMentionQuery();
  if (!mention) return;

  const value = els.input.value;
  const caret = els.input.selectionStart ?? value.length;
  const next = `${value.slice(0, mention.at)}@${path} ${value.slice(caret)}`;

  els.input.value = next;
  hideMentionPalette();
  autoGrow();
  updateSendState();
  els.input.focus();
}

/** Rutas mencionadas en el texto actual. */
function collectMentions(text) {
  const found = [];
  for (const match of String(text).matchAll(/@([\w./-]+)/g)) {
    const path = match[1];
    if (ui.fileIndex.includes(path) && !found.includes(path)) found.push(path);
  }
  return found;
}

// ---------------------------------------------------------------------------
// Editor de código (Monaco)
// ---------------------------------------------------------------------------

/** Instancia de Monaco y del editor. */
let monacoEditor = null;
let monacoApi = null;
let cargandoMonaco = null;

/** Carga Monaco solo cuando aparece el primer editor o la primera división. */
function cargarMonaco() {
  if (window.MonacoApp?.monaco) return Promise.resolve(window.MonacoApp.monaco);
  if (cargandoMonaco) return cargandoMonaco;
  cargandoMonaco = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'monaco/monaco.js';
    script.onload = () => {
      if (window.MonacoApp?.monaco) resolve(window.MonacoApp.monaco);
      else reject(new Error('Monaco cargó sin API'));
    };
    script.onerror = () => reject(new Error('No se pudo cargar Monaco'));
    document.head.append(script);
  });
  return cargandoMonaco;
}

/** Lenguaje de Monaco según la extensión. */
function monacoLanguage(filePath) {
  const ext = String(filePath).split('.').pop()?.toLowerCase() ?? '';
  const map = {
    js: 'javascript',
    mjs: 'javascript',
    cjs: 'javascript',
    jsx: 'javascript',
    ts: 'typescript',
    tsx: 'typescript',
    json: 'json',
    css: 'css',
    scss: 'scss',
    html: 'html',
    md: 'markdown',
    py: 'python',
    go: 'go',
    rs: 'rust',
    sh: 'shell',
    yml: 'yaml',
    yaml: 'yaml',
    sql: 'sql',
    r: 'r',
    rmd: 'markdown',
  };
  return map[ext] ?? 'plaintext';
}

/** Monaco no incluye R: registro mínimo para resaltarlo. */
function registrarLenguajeR(monaco) {
  if (!monaco?.languages || monaco.languages.getLanguages().some((l) => l.id === 'r')) return;
  monaco.languages.register({ id: 'r' });
  monaco.languages.setMonarchTokensProvider('r', {
    tokenizer: {
      root: [
        [/#.*$/, 'comment'],
        [/[a-zA-Z_.][\w.]*/, {
          cases: {
            '@keywords': 'keyword',
            '@default': 'identifier',
          },
        }],
        [/"(?:[^"\\]|\\.)*"/, 'string'],
        [/'(?:[^'\\]|\\.)*'/, 'string'],
        [/\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/, 'number'],
        [/[{}()\[\]]/, '@brackets'],
        [/[<>!=]=?|&&|\|\||<-|->|%[^%]+%/, 'operator'],
      ],
    },
    keywords: ['if', 'else', 'repeat', 'while', 'function', 'for', 'in', 'next', 'break', 'TRUE', 'FALSE', 'NULL', 'Inf', 'NaN', 'NA'],
  });
  monaco.languages.setLanguageConfiguration('r', {
    comments: { lineComment: '#' },
    brackets: [['{', '}'], ['[', ']'], ['(', ')']],
    autoClosingPairs: [
      { open: '{', close: '}' }, { open: '[', close: ']' }, { open: '(', close: ')' },
      { open: '"', close: '"' }, { open: "'", close: "'" },
    ],
  });
}

/** Crea el editor de un grupo (0 = izquierda, 1 = derecha). */
function ensureMonaco(group = 0) {
  if (ui.editors[group]) return ui.editors[group];

  monacoApi = window.MonacoApp?.monaco;
  if (!monacoApi) {
    console.error('Monaco no está disponible');
    return null;
  }
  registrarLenguajeR(monacoApi);
  applyTheme(ui.prefs);

  const contenedor = document.getElementById(group === 0 ? 'editor-monaco' : 'editor-monaco-2');
  if (!contenedor) return null;

  const instancia = monacoApi.editor.create(contenedor, {
    theme: activeMonacoThemeName,
    automaticLayout: true,
    fontSize: 12,
    lineHeight: 19,
    fontFamily: "ui-monospace, 'Cascadia Code', Consolas, monospace",
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    renderLineHighlight: 'line',
    smoothScrolling: true,
    cursorBlinking: 'smooth',
    padding: { top: 8, bottom: 8 },
    tabSize: 2,
    wordWrap: 'off',
    scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
  });

  instancia.onDidChangeModelContent(() => {
    if (ui.activeGroup !== group) return;
    updateEditorState();
    scheduleLspChange();
  });

  // Al enfocar un grupo, pasa a ser el activo.
  instancia.onDidFocusEditorText(() => {
    if (ui.activeGroup === group) return;
    ui.activeGroup = group;
    const tab = ui.tabs.find((t) => t.group === group && t.path === ui.activeTab);
    if (!tab) {
      const primera = ui.tabs.find((t) => t.group === group);
      if (primera) activateTab(primera.path);
    }
    renderEditorTabs();
  });

  instancia.addCommand(monacoApi.KeyMod.CtrlCmd | monacoApi.KeyCode.KeyS, () => saveEditor());
  instancia.addCommand(monacoApi.KeyCode.F12, () => instancia.getAction('editor.action.revealDefinition').run());
  instancia.addCommand(monacoApi.KeyCode.F2, () => void renombrarEditor());
  instancia.addCommand(
    monacoApi.KeyMod.Shift | monacoApi.KeyMod.Alt | monacoApi.KeyCode.KeyF,
    () => void formatearEditor(),
  );
  instancia.addCommand(monacoApi.KeyMod.CtrlCmd | monacoApi.KeyCode.Space, () =>
    instancia.getAction('editor.action.triggerSuggest').run(),
  );

  // Buscar y reemplazar dentro del fichero abierto.
  instancia.addCommand(monacoApi.KeyMod.CtrlCmd | monacoApi.KeyCode.KeyF, () =>
    instancia.getAction('actions.find').run(),
  );
  instancia.addCommand(monacoApi.KeyMod.CtrlCmd | monacoApi.KeyCode.KeyH, () =>
    instancia.getAction('editor.action.startFindReplaceAction').run(),
  );
  instancia.addCommand(monacoApi.KeyCode.F3, () =>
    instancia.getAction('editor.action.nextMatchFindAction').run(),
  );

  ui.editors[group] = instancia;
  if (group === 0) monacoEditor = instancia;

  if (!ui.marcadoresEnganchados) {
    ui.marcadoresEnganchados = true;
    monacoApi.editor.onDidChangeMarkers((uris) => {
      const actual = monacoEditor?.getModel();
      if (!actual) return;
      if (!uris.some((uri) => uri.toString() === actual.uri.toString())) return;
      actualizarMarcadoresMonaco();
    });
  }

  return instancia;
}

/** Activa o desactiva la vista dividida. */
async function toggleSplit(force) {
  const abrir = force ?? !ui.split;
  if (abrir === ui.split) return;

  ui.split = abrir;
  await cargarMonaco();
  const grupo1 = document.getElementById('editor-group-1');
  if (grupo1) grupo1.hidden = !abrir;

  if (abrir) {
    const derecho = ensureMonaco(1);
    // El fichero activo se queda a la izquierda; el hueco derecho queda libre.
    const activo = ui.tabs.find((t) => t.path === ui.activeTab);
    if (activo) activo.group = 0;
    ui.activeGroup = 1;
    derecho.setModel(null);
  } else {
    // Todo vuelve al grupo 0 y se cierra el editor derecho.
    for (const tab of ui.tabs) tab.group = 0;
    if (ui.editors[1]) {
      ui.editors[1].dispose();
      ui.editors[1] = null;
    }
    ui.activeGroup = 0;
  }

  renderEditorTabs();

  // Si se deshace la división, el activo vuelve al editor izquierdo.
  if (!abrir) {
    const activo = ui.tabs.find((t) => t.path === ui.activeTab);
    if (activo) activateTab(activo.path);
  }

  monacoApi?.editor.remeasureFonts?.();
}

const EXTENSIONES_DE_MEDIO = new Set(['.pdf', '.mp3', '.wav', '.ogg', '.oga', '.m4a', '.aac', '.flac', '.webm']);

function esMedio(path) {
  return EXTENSIONES_DE_MEDIO.has(String(path).toLowerCase().slice(String(path).lastIndexOf('.')));
}

function ocultarMedio() {
  const view = $('media-view');
  if (view) view.hidden = true;
}

function mostrarMedio(tab) {
  const view = $('media-view');
  if (!view) return;
  view.replaceChildren();
  if (tab.mediaKind === 'pdf') {
    const marco = document.createElement('iframe');
    marco.title = basename(tab.path);
    marco.src = tab.mediaUrl;
    view.append(marco);
  } else {
    const audio = document.createElement('audio');
    audio.controls = true;
    audio.autoplay = false;
    audio.src = tab.mediaUrl;
    view.append(audio);
  }
  view.hidden = false;
  const monaco = $('editor-monaco');
  if (monaco) monaco.style.display = 'none';
}

/** Abre audio o PDF en el panel auxiliar sin pasar por Monaco. */
async function openMedia(path) {
  toggleEditorPane(true);
  const abierta = ui.tabs.find((tab) => tab.path === path);
  if (abierta) {
    activateTab(path);
    return;
  }

  let resultado;
  try {
    resultado = await window.api.readFileDataUrl(path);
  } catch (error) {
    resultado = { ok: false, error: error?.message ?? String(error) };
  }
  if (!resultado?.ok) {
    addNotice(`No se pudo abrir ${path}: ${resultado?.error ?? 'error'}`, 'error');
    return;
  }

  const extension = path.toLowerCase().slice(path.lastIndexOf('.'));
  const tab = {
    path,
    kind: 'media',
    mediaKind: extension === '.pdf' ? 'pdf' : 'audio',
    mediaUrl: resultado.url,
    model: null,
    original: '',
    language: extension === '.pdf' ? 'PDF' : 'Audio',
    group: ui.split ? ui.activeGroup : 0,
    viewState: null,
    lsp: '',
    diagnostics: [],
  };
  ui.tabs.push(tab);
  activateTab(path);
}

/** Abre un fichero en el editor. */
async function openInEditor(path, linea, columna) {
  if (esMedio(path)) {
    await openMedia(path);
    return;
  }
  await cargarMonaco();
  toggleEditorPane(true);
  const editor = ensureMonaco();
  if (!editor) {
    addNotice('Monaco no está disponible.', 'error');
    return;
  }

  els.editorPane.hidden = false;

  // Si ya está abierto, solo se activa.
  const abierta = ui.tabs.find((tab) => tab.path === path);
  if (abierta) {
    activateTab(path);
    return;
  }

  try {
    const file = await window.api.readFile(path);

    // Otra apertura del mismo fichero pudo terminar antes: reutilizarla en vez
    // de crear dos pestañas y destruir el modelo que ya usa la primera.
    const yaAbierta = ui.tabs.find((tab) => tab.path === file.path);
    if (yaAbierta) {
      activateTab(yaAbierta.path);
      return;
    }

    const language = monacoLanguage(file.path);
    const uri = monacoApi.Uri.parse(`inmemory://model/${file.path}`);

    const existente = monacoApi.editor.getModel(uri);
    if (existente) {
      const enUso = ui.tabs.find((tab) => tab.model === existente);
      if (enUso) {
        activateTab(enUso.path);
        return;
      }
      existente.dispose();
    }

    const model = monacoApi.editor.createModel(file.content, language, uri);

    ui.tabs.push({
      path: file.path,
      model,
      original: file.content,
      language,
      viewState: null,
      lsp: null,
      group: ui.split ? ui.activeGroup : 0,
    });

    activateTab(file.path);

    /*
     * También se abre el LSP para JS/TS: Monaco pinta los marcadores del
     * worker, pero las acciones de código y el rename del servidor necesitan
     * el cliente LSP. Si no hay servidor, queda el lenguaje de Monaco.
     */
    const tab = ui.tabs.find((t) => t.path === file.path);
    if (tab) {
      const opened = await window.api.lspOpen({ path: file.path, content: file.content });
      tab.lsp = opened.ok ? opened.language : language;
      tab.lspUri = opened.ok ? opened.uri : null;
      tab.diagnostics = opened.ok ? (opened.diagnostics ?? []) : [];
      if (ui.activeTab === file.path) {
        ui.diagnostics = tab.diagnostics;
        els.editorLsp.textContent = tab.lsp;
        renderDiagnostics();
      }
    }
  } catch (error) {
    addNotice(`No se pudo abrir ${path}: ${error.message ?? error}`, 'error');
  }

  // Salto a la coincidencia: centrar la línea y marcar el carácter.
  if (typeof linea === 'number' && linea > 0) {
    const editor = ensureMonaco();
    if (editor) {
      editor.revealLineInCenter(linea);
      editor.setPosition({ lineNumber: linea, column: columna ?? 1 });
      editor.focus();
    }
  }
}

/** Formatea con Monaco o con el LSP propio. */
async function formatearEditor() {
  const editor = ensureMonaco();
  const tab = ui.tabs.find((t) => t.path === ui.activeTab);
  if (!editor || !tab) return;

  if (['javascript', 'typescript', 'json', 'css', 'html'].includes(tab.lsp)) {
    await editor.getAction('editor.action.formatDocument')?.run();
    return;
  }

  const model = editor.getModel();
  const resultado = await window.api.lspFormat({ path: tab.path, content: editor.getValue() });
  if (!resultado?.ok) {
    addNotice(resultado?.error ?? 'No se pudo formatear.', 'error');
    return;
  }
  if (!resultado.changed) {
    addNotice('El formato no cambió.', 'info');
    return;
  }
  // El usuario pudo cambiar de pestaña mientras el LSP formateaba.
  if (!model || editor.getModel() !== model || ui.activeTab !== tab.path) return;
  editor.setValue(resultado.content);
  updateEditorState();
  addNotice('Formateado con el LSP.', 'ok');
}

/** Renombra con Monaco o con el LSP propio. */
async function renombrarEditor() {
  const editor = ensureMonaco();
  const tab = ui.tabs.find((t) => t.path === ui.activeTab);
  if (!editor || !tab) return;

  if (['javascript', 'typescript', 'json', 'css', 'html'].includes(tab.lsp)) {
    await editor.getAction('editor.action.rename')?.run();
    return;
  }

  if (ui.tabs.some((t) => t.model && t.original !== t.model.getValue())) {
    addNotice('Guarda los ficheros modificados antes de renombrar con el LSP.', 'warning');
    return;
  }

  const posicion = editor.getPosition();
  if (!posicion) return;
  const nuevo = await pedirNombreDeSimbolo('');
  if (!nuevo) return;

  const resultado = await window.api.lspRename({
    path: tab.path,
    line: posicion.lineNumber - 1,
    character: posicion.column - 1,
    newName: nuevo,
  });
  if (!resultado?.ok) {
    addNotice(resultado?.error ?? 'No se pudo renombrar.', 'error');
    return;
  }

  const file = await window.api.readFile(tab.path);
  if (!tab.model) return;
  tab.model.setValue(file.content);
  tab.original = file.content;
  if (ui.activeTab === tab.path) {
    ui.editorOriginal = file.content;
    updateEditorState();
  }
  addNotice(`Renombrado en ${resultado.files} fichero(s).`, 'ok');
}

/* ===================== Quick fixes del LSP ===================== */

let menuQuickFixes = null;

/** Cierra el menú de quick fixes si está abierto. */
function cerrarQuickFixes() {
  if (menuQuickFixes) {
    menuQuickFixes.remove();
    menuQuickFixes = null;
  }
}

/**
 * Muestra las acciones de código disponibles en la línea del cursor.
 * Se ancla al indicador de problemas del editor.
 */
async function mostrarQuickFixes() {
  cerrarQuickFixes();

  const editor = ensureMonaco();
  const tab = ui.tabs.find((t) => t.path === ui.activeTab);
  if (!editor || !tab) return;

  const posicion = editor.getPosition();
  if (!posicion) return;

  /*
   * gopls rechaza un final más allá de la línea. El ancho real evita
   * "column is beyond end of line" en quick fixes de Go y Rust.
   */
  const linea = posicion.lineNumber - 1;
  const finLinea = Math.max(0, (editor.getModel()?.getLineMaxColumn(posicion.lineNumber) ?? 1) - 1);
  const rango = {
    start: { line: linea, character: 0 },
    end: { line: linea, character: finLinea },
  };

  let respuesta;
  try {
    respuesta = await window.api.lspCodeActions({ path: tab.path, range: rango, line: rango.start.line });
  } catch (error) {
    addNotice(`Sin quick fixes: ${error.message ?? error}`, 'error');
    return;
  }

  if (!respuesta || !respuesta.ok) {
    addNotice(respuesta?.error ?? 'Sin servidor LSP para este fichero.', 'error');
    return;
  }

  if (respuesta.acciones.length === 0) {
    addNotice('No hay quick fixes en esta línea.', 'ok');
    return;
  }

  const menu = document.createElement('div');
  menu.className = 'quickfix-menu';

  const cabecera = document.createElement('div');
  cabecera.className = 'quickfix-menu__head';
  cabecera.textContent = `L${posicion.lineNumber}`;
  menu.append(cabecera);

  respuesta.acciones.forEach((accion, indice) => {
    const boton = document.createElement('button');
    boton.type = 'button';
    boton.className = 'quickfix-menu__item';
    boton.textContent = accion.titulo;
    if (accion.kind) boton.title = accion.kind;

    boton.addEventListener('click', async () => {
      cerrarQuickFixes();
      if (ui.tabs.some((t) => t.model && t.original !== t.model.getValue())) {
        addNotice('Guarda los ficheros modificados antes de aplicar un quick fix.', 'warning');
        return;
      }
      try {
        const r = await window.api.lspApplyAction({ path: tab.path, indice, range: rango });
        if (r && r.ok) {
          addNotice(
            r.comando ? 'Acción aplicada.' : `Aplicado: ${r.ficheros} fichero${r.ficheros === 1 ? '' : 's'}.`,
            'ok',
          );
          // Recargar el modelo desde disco: el cambio lo hizo el proceso principal.
          await openInEditor(tab.path, posicion.lineNumber, posicion.column);
        } else {
          addNotice(r?.error ?? 'No se pudo aplicar.', 'error');
        }
      } catch (error) {
        addNotice(`No se pudo aplicar: ${error.message ?? error}`, 'error');
      }
    });

    menu.append(boton);
  });

  document.body.append(menu);
  menuQuickFixes = menu;

  // Anclar bajo el indicador de problemas del editor.
  const ancla = els.editorLsp ?? editor.getDomNode();
  const caja = ancla.getBoundingClientRect();
  const alto = menu.getBoundingClientRect().height;
  menu.style.left = `${Math.round(Math.max(8, caja.left - 40))}px`;
  menu.style.top = `${Math.round(Math.min(window.innerHeight - alto - 8, caja.bottom + 6))}px`;
}

/** Refleja en el estado los errores nativos de Monaco (JS/TS/JSON/CSS/HTML). */
function actualizarMarcadoresMonaco() {
  if (!monacoApi || !monacoEditor) return;
  const model = monacoEditor.getModel();
  if (!model) return;
  const tab = ui.tabs.find((t) => t.path === ui.activeTab);
  if (!tab) return;

  const markers = monacoApi.editor.getModelMarkers({ resource: model.uri });
  if (markers.length === 0) {
    if (tab.lsp) els.editorLsp.textContent = tab.lsp;
    els.editorLsp.classList.remove('has-errors');
    els.editorLsp.removeAttribute('title');
    return;
  }

  els.editorLsp.textContent = `${markers.length} ${markers.length === 1 ? 'problema' : 'problemas'}`;
  els.editorLsp.classList.add('has-errors');
  els.editorLsp.title = markers
    .slice(0, 5)
    .map((marker) => `L${marker.startLineNumber}: ${marker.message}`)
    .join('\n');
}

/** Engancha el indicador de problemas al menú de quick fixes. */
function initQuickFixes() {
  if (els.editorLsp) {
    els.editorLsp.style.cursor = 'pointer';
    els.editorLsp.addEventListener('click', () => void mostrarQuickFixes());
  }

  document.addEventListener('keydown', (event) => {
    // Ctrl+. es el atajo habitual de «acciones de código».
    if ((event.ctrlKey || event.metaKey) && event.key === '.') {
      event.preventDefault();
      void mostrarQuickFixes();
    }
    if (event.key === 'Escape') cerrarQuickFixes();
  });

  document.addEventListener('click', (event) => {
    if (menuQuickFixes && !menuQuickFixes.contains(event.target) && event.target !== els.editorLsp) {
      cerrarQuickFixes();
    }
  });
}

/* ===================== Buscar y reemplazar ===================== */

const buscarUi = { abierto: false, opciones: { sensibleAMayusculas: false, palabraCompleta: false, regex: false }, ultimo: null, temporizador: null };

/** Abre o cierra el panel de búsqueda. */
function toggleSearchPanel(abrir) {
  const modal = document.getElementById('search-modal');
  if (!modal) return;

  buscarUi.abierto = abrir ?? !buscarUi.abierto;
  modal.hidden = !buscarUi.abierto;

  if (buscarUi.abierto) {
    const input = document.getElementById('search-input');
    input.focus();
    input.select();
    if (input.value.trim()) ejecutarBusqueda();
  }
}

/** Lee las opciones marcadas en el panel. */
function opcionesDeBusqueda() {
  return {
    sensibleAMayusculas: document.getElementById('search-case').classList.contains('is-active'),
    palabraCompleta: document.getElementById('search-word').classList.contains('is-active'),
    regex: document.getElementById('search-regex').classList.contains('is-active'),
  };
}

/** Pinta las coincidencias agrupadas por fichero. */
function pintarResultados(datos) {
  const lista = document.getElementById('search-results');
  const estado = document.getElementById('search-status');
  lista.replaceChildren();

  if (!datos || datos.resultados.length === 0) {
    estado.textContent = document.getElementById('search-input').value.trim()
      ? 'Sin resultados'
      : '';
    return;
  }

  estado.textContent = `${datos.resultados.length} coincidencia${datos.resultados.length === 1 ? '' : 's'} en ${datos.ficheros} fichero${datos.ficheros === 1 ? '' : 's'}${datos.truncado ? ' (truncado)' : ''}`;

  const porFichero = new Map();
  for (const r of datos.resultados) {
    if (!porFichero.has(r.ruta)) porFichero.set(r.ruta, []);
    porFichero.get(r.ruta).push(r);
  }

  for (const [ruta, hits] of porFichero) {
    const bloque = document.createElement('div');
    bloque.className = 'search-file';

    const cabecera = document.createElement('div');
    cabecera.className = 'search-file__head';
    const nombre = document.createElement('span');
    nombre.textContent = ruta;
    const cuenta = document.createElement('span');
    cuenta.className = 'search-file__count';
    cuenta.textContent = String(hits.length);
    cabecera.append(nombre, cuenta);
    bloque.append(cabecera);

    for (const hit of hits.slice(0, 50)) {
      const boton = document.createElement('button');
      boton.type = 'button';
      boton.className = 'search-hit';

      const numero = document.createElement('span');
      numero.className = 'search-hit__line';
      numero.textContent = String(hit.linea);

      const texto = document.createElement('span');
      // Marcar la coincidencia dentro de la línea.
      const antes = hit.texto.slice(0, Math.max(0, hit.columna - 1));
      const desde = Math.max(0, hit.columna - 1);
      const marca = document.createElement('span');
      marca.className = 'search-hit__mark';
      marca.textContent = hit.coincidencia;
      texto.append(
        document.createTextNode(antes),
        marca,
        document.createTextNode(hit.texto.slice(desde + hit.coincidencia.length)),
      );

      boton.append(numero, texto);
      boton.addEventListener('click', () => {
        toggleSearchPanel(false);
        openInEditor(hit.ruta, hit.linea, hit.columna);
      });
      bloque.append(boton);
    }

    lista.append(bloque);
  }
}

/** Lanza la búsqueda en el proyecto. */
async function ejecutarBusqueda() {
  const consulta = document.getElementById('search-input').value;
  if (!consulta.trim()) {
    pintarResultados(null);
    return;
  }

  buscarUi.opciones = opcionesDeBusqueda();
  try {
    const datos = await window.api.searchRun({ consulta, opciones: buscarUi.opciones });
    buscarUi.ultimo = { consulta, datos };
    pintarResultados(datos);
  } catch (error) {
    document.getElementById('search-status').textContent = `Error: ${error.message ?? error}`;
  }
}

/** Reemplaza en todo el proyecto y refresca. */
async function reemplazarTodo() {
  const consulta = document.getElementById('search-input').value;
  const reemplazo = document.getElementById('search-replace').value;
  if (!consulta.trim()) return;

  try {
    const r = await window.api.searchReplace({
      consulta,
      reemplazo,
      opciones: opcionesDeBusqueda(),
    });
    addNotice(`Reemplazadas ${r.cambios} coincidencias en ${r.ficheros} ficheros.`, 'ok');
    await ejecutarBusqueda();
  } catch (error) {
    addNotice(`No se pudo reemplazar: ${error.message ?? error}`, 'error');
  }
}

/** Conecta el panel una sola vez. */
function initSearchPanel() {
  const modal = document.getElementById('search-modal');
  if (!modal) return;

  const input = document.getElementById('search-input');
  input.addEventListener('input', () => {
    clearTimeout(buscarUi.temporizador);
    buscarUi.temporizador = setTimeout(ejecutarBusqueda, 180);
  });

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      clearTimeout(buscarUi.temporizador);
      ejecutarBusqueda();
    }
    if (event.key === 'Escape') toggleSearchPanel(false);
  });

  for (const id of ['search-case', 'search-word', 'search-regex']) {
    const boton = document.getElementById(id);
    boton.addEventListener('click', () => {
      boton.classList.toggle('is-active');
      ejecutarBusqueda();
    });
  }

  document.getElementById('search-close').addEventListener('click', () => toggleSearchPanel(false));
  document.getElementById('search-replace-all').addEventListener('click', reemplazarTodo);
  modal.querySelector('[data-close-search]').addEventListener('click', () => toggleSearchPanel(false));

  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      toggleSearchPanel(true);
    }
  });
}

/** Activa una pestaña ya abierta y restaura su vista. */
function activateTab(path) {
  const tab = ui.tabs.find((t) => t.path === path);
  if (!tab) return;

  const group = ui.split ? (tab.group ?? 0) : 0;
  if (tab.kind === 'media') {
    ui.activeGroup = group;
    ui.activeTab = path;
    ui.editorPath = path;
    ui.editorOriginal = '';
    els.editorPath.textContent = path;
    els.editorLsp.textContent = tab.language;
    els.editorState.textContent = '';
    ui.diagnostics = [];
    renderDiagnostics();
    mostrarMedio(tab);
    renderEditorTabs();
    return;
  }

  ocultarMedio();
  const editor = ensureMonaco(group);
  if (!editor) return;

  // Guarda la vista del que se abandona, en su propio grupo.
  const anterior = ui.tabs.find((t) => t.path === ui.activeTab && t.group === ui.activeGroup);
  const editorAnterior = ui.editors[ui.activeGroup];
  if (anterior && editorAnterior && editorAnterior.getModel() === anterior.model) {
    anterior.viewState = editorAnterior.saveViewState();
  }

  ui.activeGroup = group;
  ui.activeTab = path;
  ui.editorPath = path;
  ui.editorOriginal = tab.original;
  monacoEditor = editor;

  editor.setModel(tab.model);
  if (tab.viewState) editor.restoreViewState(tab.viewState);

  els.editorPath.textContent = path;
  els.editorLsp.textContent = tab.lsp ?? tab.language;
  ui.diagnostics = tab.diagnostics ?? [];
  renderDiagnostics();
  updateEditorState();
  renderEditorTabs();
  editor.focus();
}

/** Cierra una pestaña; si era la activa, pasa a la vecina. */
function closeTab(path) {
  const index = ui.tabs.findIndex((tab) => tab.path === path);
  if (index < 0) return;

  const tab = ui.tabs[index];
  if (tab?.model && tab.original !== tab.model.getValue()) {
    if (!window.confirm(`«${tab.path}» tiene cambios sin guardar. ¿Cerrar igualmente?`)) return;
  }

  const [cerrada] = ui.tabs.splice(index, 1);
  cerrada.model?.dispose();

  if (ui.activeTab === path) {
    const vecina = ui.tabs[index] ?? ui.tabs[index - 1] ?? null;
    ui.activeTab = null;
    ui.editorPath = null;
    if (vecina) activateTab(vecina.path);
    else {
      ensureMonaco(0)?.setModel(null);
      if (ui.editors[1]) ui.editors[1].setModel(null);
      els.editorPath.textContent = '';
      els.editorLsp.textContent = '';
      els.editorState.textContent = '';
    }
  }

  renderEditorTabs();
}

/** Cierra todas las pestañas y oculta el panel. */
function closeEditor() {
  if (ui.tabs.some((tab) => tab.model && tab.original !== tab.model.getValue())) {
    if (!window.confirm('Hay pestañas con cambios sin guardar. ¿Cerrar el editor igualmente?')) return;
  }
  for (const tab of ui.tabs) tab.model?.dispose();
  ui.tabs = [];
  ui.activeTab = null;
  ui.editorPath = null;
  ui.editorOriginal = '';
  for (const editor of ui.editors) editor?.setModel(null);
  els.editorPane.hidden = true;
  ocultarMedio();
  renderEditorTabs();
}

function renderEditorTabs() {
  els.editorTabs.replaceChildren();

  const newtab = document.getElementById('newtab-view');
  const monaco = document.getElementById('editor-monaco');
  const status = document.querySelector('.editor__status');

  // Sin pestañas: vista de nueva pestaña, como su panel auxiliar.
  if (ui.tabs.length === 0) {
    newtab?.removeAttribute('hidden');
    ocultarMedio();
    if (monaco) monaco.style.display = 'none';
    if (status) status.style.display = 'none';
    els.editorTabs.append(makeNewTabButton());
    els.editorTabs.append(makeSplitButton());
    return;
  }

  newtab?.setAttribute('hidden', '');
  const tabActiva = ui.tabs.find((tab) => tab.path === ui.activeTab);
  const media = $('media-view');
  if (tabActiva?.kind === 'media') {
    if (monaco) monaco.style.display = 'none';
    if (media) media.hidden = false;
  } else {
    if (monaco) monaco.style.display = '';
    if (media) media.hidden = true;
  }
  if (status) status.style.display = '';

  for (const tab of ui.tabs) {
    const el = document.createElement('div');
    const activa = tab.path === ui.activeTab && (tab.group ?? 0) === ui.activeGroup;
    el.className = activa ? 'editor__tab is-active' : 'editor__tab';
    if (ui.split && tab.group === 1) el.classList.add('is-right');
    el.title = tab.path;
    el.addEventListener('click', () => activateTab(tab.path));

    const name = document.createElement('span');
    name.textContent = basename(tab.path);

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'editor__tab-close';
    close.innerHTML = window.Icon('close', 12);
    close.title = 'Cerrar';
    close.addEventListener('click', (event) => {
      event.stopPropagation();
      closeTab(tab.path);
    });

    el.append(name, close);
    els.editorTabs.append(el);
  }

  els.editorTabs.append(makeNewTabButton());
  els.editorTabs.append(makeSplitButton());
}

/** Botón de vista dividida, a la derecha de la tira. */
function makeSplitButton() {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = ui.split ? 'editor__new-tab is-active' : 'editor__new-tab';
  btn.setAttribute('aria-label', 'Split Editor');
  btn.title = 'Dividir editor';
  btn.innerHTML =
    '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">' +
    '<path d="M2 2h5v12H2zM9 2h5v12H9z" opacity="0.9"/></svg>';
  btn.style.marginLeft = 'auto';
  btn.addEventListener('click', () => toggleSplit());
  return btn;
}

/** Botón «+» de la tira de pestañas. */
function makeNewTabButton() {
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'editor__new-tab';
  add.setAttribute('aria-label', 'New Tab');
  add.innerHTML = window.Icon('plus', 14);
  add.addEventListener('click', () => {
    window.api
      .openFileDialog()
      .then((filePath) => {
        if (filePath) openInEditor(filePath);
      })
      .catch(() => {});
  });
  return add;
}

/** Actualiza el estado guardado/sin guardar. */
function updateEditorState() {
  if (!monacoEditor || !ui.editorPath) return;

  const tab = ui.tabs.find((t) => t.path === ui.activeTab);
  const dirty = monacoEditor.getValue() !== (tab?.original ?? ui.editorOriginal);
  els.editorState.textContent = dirty ? 'sin guardar' : 'guardado';
  els.editorState.classList.toggle('is-dirty', dirty);
}

/** Avisa al LSP propio con retardo. */
function scheduleLspChange() {
  if (!ui.editorPath || !monacoEditor) return;

  const tab = ui.tabs.find((t) => t.path === ui.activeTab);
  if (tab?.kind === 'remote') return;
  const language = monacoLanguage(ui.editorPath);
  if (['javascript', 'typescript', 'json', 'css', 'html'].includes(language)) return;

  if (ui.lspChangeTimer) clearTimeout(ui.lspChangeTimer);
  // Capturar al programar: si el usuario cambia de pestaña en 500 ms, el
  // cambio debe ir al fichero que lo originó, no al que esté activo después.
  const ruta = ui.editorPath;
  const contenido = monacoEditor.getValue();
  ui.lspChangeTimer = setTimeout(() => {
    window.api.lspChange({ path: ruta, content: contenido }).catch(() => {});
  }, 500);
}

/** Guarda el fichero abierto. */
async function saveEditor() {
  if (!ui.editorPath || !monacoEditor) return;

  // Capturar antes del await: el usuario puede cambiar de pestaña o seguir
  // escribiendo mientras el disco responde. Leer al volver marcaba como
  // guardado texto que aún no se había escrito.
  const ruta = ui.editorPath;
  const contenido = monacoEditor.getValue();
  const tab = ui.tabs.find((t) => t.path === ui.activeTab);

  try {
    if (tab?.kind === 'remote') {
      const guardado = await window.api.sshWrite({
        path: tab.remotePath,
        content: contenido,
      });
      if (!guardado?.ok) throw new Error(guardado?.error ?? 'no se pudo guardar');
    } else {
      await window.api.writeFile(ruta, contenido);
    }

    // El original vive en la pestaña: así el estado «sin guardar» es por fichero.
    if (tab) tab.original = contenido;
    if (ui.editorPath === ruta) {
      ui.editorOriginal = contenido;
      updateEditorState();
    }
    renderEditorTabs();
  } catch (error) {
    addNotice(`No se pudo guardar: ${error.message ?? error}`, 'error');
  }
}

/** Pinta los diagnósticos del LSP propio como marcadores de Monaco. */
function renderDiagnostics() {
  if (!monacoEditor || !monacoApi) return;

  const model = monacoEditor.getModel();
  if (!model) return;

  if (!ui.diagnostics || ui.diagnostics.length === 0) {
    monacoApi.editor.setModelMarkers(model, 'lsp', []);
    els.editorLsp.classList.remove('has-errors');
    return;
  }

  const markers = ui.diagnostics.map((diagnostic) => ({
    severity:
      diagnostic.severity === 1
        ? monacoApi.MarkerSeverity.Error
        : monacoApi.MarkerSeverity.Warning,
    message: diagnostic.message ?? '',
    startLineNumber: (diagnostic.range?.start?.line ?? 0) + 1,
    startColumn: (diagnostic.range?.start?.character ?? 0) + 1,
    endLineNumber: (diagnostic.range?.end?.line ?? 0) + 1,
    endColumn: (diagnostic.range?.end?.character ?? 0) + 1,
  }));

  monacoApi.editor.setModelMarkers(model, 'lsp', markers);

  els.editorLsp.textContent = `${markers.length} ${markers.length === 1 ? 'problema' : 'problemas'}`;
  els.editorLsp.classList.add('has-errors');
  els.editorLsp.title = ui.diagnostics
    .slice(0, 5)
    .map((d) => `L${(d.range?.start?.line ?? 0) + 1}: ${d.message}`)
    .join('\n');
}

// ---------------------------------------------------------------------------
// Explorador de ficheros
// ---------------------------------------------------------------------------

/** Construye un árbol anidado a partir de rutas planas. */
function buildTree(paths) {
  const root = { name: '', dirs: new Map(), files: [] };

  for (const path of paths) {
    const parts = String(path).split('/');
    let node = root;

    for (let index = 0; index < parts.length - 1; index += 1) {
      const part = parts[index];
      if (!node.dirs.has(part)) node.dirs.set(part, { name: part, dirs: new Map(), files: [] });
      node = node.dirs.get(part);
    }

    node.files.push({ name: parts[parts.length - 1], path });
  }

  return root;
}

/** Pinta el árbol de ficheros en el panel. */
function renderFileTree() {
  const container = $('file-tree');
  if (!container) return;

  container.replaceChildren();

  if (ui.fileIndex.length === 0) {
    container.append(rowText('Sin ficheros'));
    return;
  }

  const tree = buildTree(ui.fileIndex);
  const expanded = ui.treeExpanded ?? new Set(['src', 'electron', 'renderer']);

  const renderNode = (node, prefix, depth) => {
    // Carpetas primero, ordenadas.
    const dirs = [...node.dirs.values()].sort((a, b) => a.name.localeCompare(b.name));

    for (const dir of dirs) {
      const key = prefix.length > 0 ? `${prefix}/${dir.name}` : dir.name;
      const isOpen = expanded.has(key);

      const row = document.createElement('div');
      row.className = 'tree__row tree__row--dir';
      row.style.paddingLeft = `${depth * 10}px`;

      const chevron = document.createElement('span');
      chevron.className = 'tree__chevron';
      chevron.innerHTML = window.Icon('chevron', 12);
      chevron.style.transform = isOpen ? 'rotate(90deg)' : 'none';

      const label = document.createElement('span');
      label.className = 'tree__label';
      label.textContent = dir.name;

      row.append(chevron, label);
      row.addEventListener('click', () => {
        if (expanded.has(key)) expanded.delete(key);
        else expanded.add(key);
        ui.treeExpanded = expanded;
        renderFileTree();
      });

      container.append(row);

      if (isOpen) renderNode(dir, key, depth + 1);
    }

    // Ficheros.
    for (const file of node.files.sort((a, b) => a.name.localeCompare(b.name))) {
      const row = document.createElement('div');
      row.className = 'tree__row tree__row--file';
      row.style.paddingLeft = `${depth * 10 + 14}px`;
      row.title = file.path;

      const label = document.createElement('span');
      label.className = 'tree__label';
      label.textContent = file.name;

      row.append(label);
      row.addEventListener('click', () => openInEditor(file.path));
      container.append(row);
    }
  };

  renderNode(tree, '', 0);
}

// ---------------------------------------------------------------------------
// Índice de código
// ---------------------------------------------------------------------------

/** Muestra el estado del índice en el panel. */
async function refreshIndexStatus() {
  const el = $('index-status');
  if (!el) return;

  try {
    const status = await window.api.indexStatus();
    el.textContent =
      status.files === 0 ? 'sin construir' : `${status.files} ficheros · ${status.symbols} símbolos`;
  } catch {
    el.textContent = 'no disponible';
  }
}

/** Reconstruye el índice. */
async function rebuildIndex() {
  const el = $('index-status');
  if (el) el.textContent = 'indexando…';

  try {
    const stats = await window.api.indexBuild();
    if (el) el.textContent = `${stats.files} ficheros · ${stats.symbols} símbolos`;
    addNotice(`Índice listo: ${stats.files} ficheros, ${stats.symbols} símbolos.`, 'info');
  } catch (error) {
    if (el) el.textContent = 'error';
    addNotice(`No se pudo indexar: ${error.message ?? error}`, 'error');
  }
}

/** Precalcula embeddings con Ollama. */
async function warmIndex() {
  const el = $('index-status');
  if (el) el.textContent = 'calculando embeddings…';

  try {
    const result = await window.api.indexWarm();
    if (el) el.textContent = `${result.cached} vectores en caché`;
    addNotice(
      result.embedded > 0
        ? `Embeddings: ${result.embedded} nuevos, ${result.skipped} ya en caché.`
        : 'Ollama no respondió: revisa que esté corriendo y que el modelo de embeddings exista.',
      result.embedded > 0 ? 'info' : 'warning',
    );
  } catch (error) {
    if (el) el.textContent = 'error';
    addNotice(`No se pudieron calcular: ${error.message ?? error}`, 'error');
  }
}

// ---------------------------------------------------------------------------
// Git
// ---------------------------------------------------------------------------

/** Colores y etiquetas por código de estado de git. */
const GIT_STATUS = {
  M: { label: 'M', title: 'modificado', cls: 'is-modified' },
  A: { label: 'A', title: 'añadido', cls: 'is-added' },
  D: { label: 'D', title: 'borrado', cls: 'is-deleted' },
  R: { label: 'R', title: 'renombrado', cls: 'is-modified' },
  '?': { label: 'U', title: 'sin seguimiento', cls: 'is-untracked' },
};

/** Refresca el estado del repositorio en el panel. */
/** Pinta el estado ahead/behind y si hay conflictos. */
function renderTracking(tracking) {
  const label = document.getElementById('git-tracking');
  const conflict = document.getElementById('git-conflict');
  const conflictText = document.getElementById('git-conflict-text');

  if (label) {
    if (!tracking.remote) {
      label.textContent = 'sin remoto';
    } else if (tracking.ahead === 0 && tracking.behind === 0) {
      label.textContent = 'al día';
    } else {
      const parts = [];
      if (tracking.ahead > 0) parts.push(`↑${tracking.ahead}`);
      if (tracking.behind > 0) parts.push(`↓${tracking.behind}`);
      label.textContent = parts.join(' ');
    }
  }

  if (conflict) {
    const merging = tracking.detached === false && tracking.behind > 0;
    conflict.hidden = !merging;
    if (merging && conflictText) {
      conflictText.textContent = `Hay ${tracking.behind} commit(s) por detrás del remoto.`;
    }
  }
}

async function refreshGit() {
  const branchEl = $('git-branch-select');
  const filesEl = $('git-files');
  if (!branchEl || !filesEl) return;

  const workspace = ui.cwd;
  let status;
  try {
    status = await window.api.gitStatus();
  } catch {
    status = { ok: false, error: 'git no disponible' };
  }
  if (ui.cwd !== workspace) return;

  if (!status.ok) {
    branchEl.replaceChildren();
    filesEl.replaceChildren();
    void refreshGitLog();
    return;
  }

  // Selector de ramas.
  let branches = [];
  try {
    const result = await window.api.gitBranches();
    branches = result.branches ?? [];
  } catch {
    branches = [];
  }
  if (ui.cwd !== workspace) return;

  branchEl.replaceChildren();
  for (const branch of branches) {
    const option = document.createElement('option');
    option.value = branch.name;
    option.textContent = branch.name;
    if (branch.current) option.selected = true;
    branchEl.append(option);
  }
  if (branches.length === 0) {
    const option = document.createElement('option');
    option.textContent = status.branch ?? '(sin rama)';
    branchEl.append(option);
  }

  // Estado respecto al remoto (ahead / behind).
  let tracking = { ahead: 0, behind: 0, upstream: null, remote: false };
  try {
    tracking = await window.api.gitTracking();
  } catch {
    /* sin remoto */
  }
  renderTracking(tracking);

  filesEl.replaceChildren();

  if (status.files.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'overview-empty';
    empty.textContent = 'Sin cambios';
    filesEl.append(empty);
    return;
  }

  for (const file of status.files) {
    const meta = GIT_STATUS[file.status] ?? GIT_STATUS.M;

    const row = document.createElement('div');
    row.className = 'git-file';

    const badge = document.createElement('span');
    badge.className = `git-file__badge ${meta.cls}`;
    badge.textContent = meta.label;
    badge.title = meta.title;

    const name = document.createElement('span');
    name.className = 'git-file__name';
    name.textContent = file.path;
    name.title = file.path;

    // Fichero en conflicto: ofrece quedarse con una de las dos versiones.
    if (file.status === 'UU' || file.status === 'AA' || file.status === 'DD' || file.status === 'AU' || file.status === 'UA') {
      const resolve = document.createElement('div');
      resolve.className = 'git-file__resolve';

      for (const side of ['ours', 'theirs']) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn';
        btn.textContent = side === 'ours' ? 'Mía' : 'Suya';
        btn.title = side === 'ours' ? 'Quedarse con la versión local' : 'Quedarse con la del remoto';
        btn.addEventListener('click', async (event) => {
          event.stopPropagation();
          await window.api.gitResolve(file.path, side);
          refreshGit();
        });
        resolve.append(btn);
      }

      row.append(badge, name, resolve);
      filesEl.append(row);
      continue;
    }

    const action = document.createElement('button');
    action.type = 'button';
    action.className = 'git-file__action';
    action.textContent = file.staged ? '−' : '+';
    action.title = file.staged ? 'Quitar del índice' : 'Añadir al índice';
    action.addEventListener('click', async (event) => {
      event.stopPropagation();
      if (file.staged) await window.api.gitUnstage([file.path]);
      else await window.api.gitStage([file.path]);
      refreshGit();
    });

    row.append(badge, name, action);
    row.title = `${file.path} — clic para ver el diff`;
    row.addEventListener('click', () => openGitDiff(file));
    filesEl.append(row);
  }
}

/** Pinta el historial de commits. */
async function refreshGitLog() {
  const container = $('git-log');
  if (!container) return;

  let result;
  try {
    result = await window.api.gitLog({ limit: 12 });
  } catch {
    result = { ok: false, commits: [] };
  }

  container.replaceChildren();

  if (!result.ok || result.commits.length === 0) {
    container.append(rowText('Sin commits'));
    return;
  }

  for (const commit of result.commits) {
    const row = document.createElement('div');
    row.className = 'git-commit-row';
    row.title = `${commit.hash} · ${commit.author} · ${commit.when}\n${commit.subject}`;

    const hash = document.createElement('span');
    hash.className = 'git-commit-row__hash';
    hash.textContent = commit.hash;

    const subject = document.createElement('span');
    subject.className = 'git-commit-row__subject';
    subject.textContent = commit.subject;

    row.append(hash, subject);
    container.append(row);
  }
}

/** Pull requests del remoto; solo lectura. */
let pullRequestsCache = { at: 0, result: null };

async function refreshPullRequests(force = false) {
  const container = $('github-pulls');
  if (!container) return;
  if (!force && pullRequestsCache.result && Date.now() - pullRequestsCache.at < 60_000) {
    renderPullRequests(pullRequestsCache.result);
    return;
  }

  container.replaceChildren(rowText('Cargando pull requests…'));
  let result;
  try {
    result = await window.api.githubPulls();
  } catch (error) {
    result = { ok: false, error: error?.message ?? String(error) };
  }
  pullRequestsCache = { at: Date.now(), result };
  renderPullRequests(result);
}

function renderPullRequests(result) {
  const container = $('github-pulls');
  if (!container) return;
  container.replaceChildren();
  if (!result?.ok) {
    container.append(rowText(result?.error ?? 'No se pudieron cargar los pull requests'));
    return;
  }
  if (!Array.isArray(result.pulls) || result.pulls.length === 0) {
    container.append(rowText(`Sin pull requests en ${result.repo}`));
    return;
  }

  for (const pr of result.pulls) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'git-commit-row pr-row';
    row.title = `#${pr.number} · ${pr.author} · ${pr.head} → ${pr.base}`;

    const numero = document.createElement('span');
    numero.className = 'git-commit-row__hash';
    numero.textContent = `#${pr.number}`;
    const titulo = document.createElement('span');
    titulo.className = 'git-commit-row__subject';
    titulo.textContent = `${pr.draft ? 'Draft · ' : ''}${pr.title}`;
    const estado = document.createElement('span');
    estado.className = 'pr-row__state';
    estado.textContent = pr.state;
    row.append(numero, titulo, estado);
    row.addEventListener('click', () => {
      window.api
        .openBrowser(pr.url)
        .then((result) => {
          if (result?.ok === false) window.api.openExternal(pr.url);
        })
        .catch(() => window.api.openExternal(pr.url));
    });
    container.append(row);
  }
}

/** Lista y ejecuta workflows del proyecto desde Overview. */
async function refreshWorkflows() {
  const container = $('workflows-list');
  if (!container) return;
  container.replaceChildren();
  let result;
  try { result = await window.api.workflowsList(); } catch (error) { result = { ok: false, error: error?.message ?? String(error) }; }
  if (!result?.ok) { container.append(rowText(result?.error ?? 'No se pudieron listar los workflows')); return; }
  if (!result.workflows || result.workflows.length === 0) { container.append(rowText('Sin workflows en este proyecto')); return; }
  for (const workflow of result.workflows) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'git-commit-row pr-row';
    row.title = workflow.name;
    const name = document.createElement('span');
    name.className = 'git-commit-row__subject';
    name.textContent = workflow.name;
    const run = document.createElement('span');
    run.className = 'pr-row__state';
    run.textContent = 'run';
    row.append(name, run);
    row.addEventListener('click', async () => {
      row.disabled = true;
      run.textContent = 'running';
      const output = await window.api.workflowsRun(workflow.name);
      row.disabled = false;
      run.textContent = output?.ok ? 'done' : 'error';
      addNotice(
        output?.ok ? `Workflow ${workflow.name}: ${String(output.content ?? '').slice(0, 600)}` : `Workflow ${workflow.name}: ${output?.error ?? output?.content ?? 'error'}`,
        output?.ok ? 'ok' : 'error',
      );
    });
    container.append(row);
  }
}

/** Cambia de rama. */
async function checkoutBranch(branch) {
  const result = await window.api.gitCheckout(branch);
  if (!result.ok) {
    addNotice(`No se pudo cambiar a ${branch}: ${result.error}`, 'error');
    return;
  }
  addNotice(`Rama: ${branch}`, 'info');
  await refreshGit();
  await loadFileIndex();
}

/** Abre el diff de un fichero en el modal, con hunks preparables. */
async function openGitDiff(file) {
  const modal = $('git-diff-modal');
  const body = $('git-diff-body');
  if (!modal || !body) return;

  $('git-diff-title').textContent = file.path;
  $('git-diff-subtitle').textContent = file.staged
    ? 'Cambios en el índice'
    : 'Cambios sin preparar — pulsa + en un bloque para prepararlo';
  body.replaceChildren();
  modal.removeAttribute('hidden');

  let hunks;
  try {
    hunks = await window.api.gitDiffHunks({ path: file.path, staged: file.staged });
  } catch (error) {
    body.append(rowText(error.message ?? 'no se pudo obtener el diff'));
    return;
  }

  if (!hunks.ok) {
    body.append(rowText(hunks.error ?? 'no se pudo obtener el diff'));
    return;
  }

  if (!hunks.hunks || hunks.hunks.length === 0) {
    body.append(rowText('Sin diferencias que mostrar.'));
    return;
  }

  for (const hunk of hunks.hunks) {
    const block = document.createElement('div');
    block.className = 'hunk';

    const bar = document.createElement('div');
    bar.className = 'hunk__bar';

    const label = document.createElement('span');
    label.className = 'hunk__label';
    label.textContent = `${hunk.header}  +${hunk.additions} −${hunk.removals}`;

    const action = document.createElement('button');
    action.type = 'button';
    action.className = 'hunk__action';
    action.textContent = file.staged ? '−' : '+';
    action.title = file.staged ? 'Quitar del índice' : 'Preparar este bloque';

    action.addEventListener('click', async () => {
      action.disabled = true;

      // Fichero nuevo: se prepara entero con git add.
      const result = hunks.untracked
        ? await window.api.gitStage([file.path])
        : await window.api.gitApplyHunk({
            path: file.path,
            staged: file.staged,
            header: hunks.header,
            patch: hunk.patch,
          });

      if (!result.ok) {
        addNotice(`No se pudo aplicar el bloque: ${result.error}`, 'error');
        action.disabled = false;
        return;
      }

      addNotice(
        file.staged ? 'Bloque quitado del índice.' : 'Bloque preparado en el índice.',
        'info',
      );
      await refreshGit();
      await openGitDiff(file);
    });

    bar.append(label, action);

    const lines = document.createElement('div');
    lines.className = 'hunk__lines';

    for (const line of hunk.preview) {
      if (line.startsWith('@@')) continue;

      const row = document.createElement('div');
      const type = line.startsWith('+') ? 'add' : line.startsWith('-') ? 'remove' : 'context';
      row.className = `diff-line diff-line--${type}`;

      const sign = document.createElement('span');
      sign.className = 'diff-line__sign';
      sign.textContent = type === 'add' ? '+' : type === 'remove' ? '−' : ' ';

      const text = document.createElement('span');
      text.className = 'diff-line__text';
      text.textContent = line.slice(1);

      row.append(sign, text);
      lines.append(row);
    }

    block.append(bar, lines);
    body.append(block);
  }
}

function closeGitDiff() {
  const modal = $('git-diff-modal');
  if (modal) modal.setAttribute('hidden', '');
}

/** Hace commit con el mensaje escrito. */
async function commitChanges() {
  const input = $('git-message');
  if (!input) return;

  const message = input.value.trim();
  if (message.length === 0) {
    addNotice('Escribe un mensaje de commit.', 'warning');
    return;
  }

  const result = await window.api.gitCommit(message);
  if (!result.ok) {
    addNotice(`Commit falló: ${result.error}`, 'error');
    return;
  }

  input.value = '';
  addNotice(result.output || 'Commit creado.', 'info');
  refreshGit();
}

// ---------------------------------------------------------------------------
// Terminal
// ---------------------------------------------------------------------------

/**
 * Convierte códigos ANSI SGR a HTML con colores.
 * Cubre los 16 colores básicos, negrita y reset.
 */
function ansiToHtml(text) {
  const COLORS = [
    '#000000', '#f87171', '#4ade80', '#fbbf24', '#38bdf8', '#c084fc', '#22d3ee', '#cccccc',
    '#666666', '#ff8a8a', '#7ee787', '#ffd166', '#7dd3fc', '#d8b4fe', '#67e8f9', '#ffffff',
  ];

  let html = '';
  let open = false;
  let index = 0;

  const escape = (value) =>
    value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  while (index < text.length) {
    const esc = text.indexOf('\u001b[', index);
    if (esc === -1) {
      html += escape(text.slice(index));
      break;
    }

    html += escape(text.slice(index, esc));

    const end = text.indexOf('m', esc);
    if (end === -1) break;

    const codes = text.slice(esc + 2, end).split(';').map(Number);
    if (open) {
      html += '</span>';
      open = false;
    }

    for (const code of codes) {
      if (code === 0) continue;
      if (code === 1) {
        html += '<span style="font-weight:600">';
        open = true;
        continue;
      }
      const colorIndex = code >= 30 && code <= 37 ? code - 30 : code >= 90 && code <= 97 ? code - 90 + 8 : -1;
      if (colorIndex >= 0) {
        html += `<span style="color:${COLORS[colorIndex]}">`;
        open = true;
      }
    }

    index = end + 1;
  }

  if (open) html += '</span>';
  return html;
}

/** ¿Estamos en modo PTY interactivo? */
let ptyActive = false;

/** Terminales abiertas: id → { xterm, fit, contenedor, nombre }. */
const terminales = new Map();
let terminalActiva = null;
let contadorTerminales = 0;

/** Tema de xterm, igual en todas las terminales. */
const TEMA_XTERM = {
  background: '#101010',
  foreground: '#cccccc',
  cursor: '#cccccc',
  selectionBackground: '#264f78',
  black: '#101010',
  red: '#f87171',
  green: '#4ade80',
  yellow: '#fbbf24',
  blue: '#38bdf8',
  magenta: '#c084fc',
  cyan: '#22d3ee',
  white: '#cccccc',
  brightBlack: '#666666',
  brightRed: '#ff8a8a',
  brightGreen: '#7ee787',
  brightYellow: '#ffd166',
  brightBlue: '#7dd3fc',
  brightMagenta: '#d8b4fe',
  brightCyan: '#67e8f9',
  brightWhite: '#ffffff',
};

/** Crea una terminal nueva con su propio xterm y su pestaña. */
function crearTerminal(idSugerido, opciones = {}) {
  if (!window.XtermApp) return null;

  contadorTerminales += 1;
  const id = idSugerido ?? `terminal-${contadorTerminales}`;
  if (terminales.has(id)) return terminales.get(id);

  const { Terminal, FitAddon } = window.XtermApp;

  // Contenedor propio: las terminales se apilan y solo una se ve.
  const contenedor = document.createElement('div');
  contenedor.className = 'terminal__instance';
  contenedor.dataset.terminal = id;
  contenedor.hidden = true;
  els.terminalXterm.append(contenedor);

  const term = new Terminal({
    fontFamily: "ui-monospace, 'Cascadia Code', Consolas, monospace",
    fontSize: 12,
    lineHeight: 1.35,
    cursorBlink: true,
    convertEol: true,
    scrollback: 5000,
    theme: activeXtermTheme ?? TEMA_XTERM,
  });

  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(contenedor);

  // Teclas → PTY de esta terminal.
  term.onData((data) => {
    window.api.terminalPtyWrite({ id, data });
  });

  // `id` es la clave del mapa y del PTY; `nombre` solo se muestra.
  const entrada = {
    id,
    xterm: term,
    fit,
    contenedor,
    nombre: opciones.nombre ?? id,
    kind: opciones.kind ?? 'local',
  };

  /*
   * La referencia al observer se guarda en la entrada: un `ResizeObserver` sin
   * referencias fuertes lo recolecta el GC, y entonces el ajuste inicial
   * funciona pero los redimensionados posteriores dejan de llegar.
   */
  entrada.observer = new ResizeObserver(() => ajustarTerminal(id));
  entrada.observer.observe(contenedor);

  terminales.set(id, entrada);
  pintarPestanasTerminal();
  return entrada;
}

/**
 * Ajusta una terminal a su contenedor.
 *
 * Se usa `proposeDimensions()` y se llama a `resize()` directamente en vez de
 * `fit.fit()`: medido en vivo, el addon proponía 202 columnas para 1440 px y
 * después no aplicaba el cambio, dejando la terminal en el tamaño anterior.
 */
function ajustarTerminal(id) {
  const entrada = terminales.get(id);
  if (!entrada || entrada.contenedor.hidden) return;

  let dims = null;
  try {
    dims = entrada.fit.proposeDimensions();
  } catch {
    dims = null;
  }

  if (!dims || !Number.isFinite(dims.cols) || !Number.isFinite(dims.rows)) return;
  if (dims.cols < 2 || dims.rows < 1) return;

  try {
    if (entrada.xterm.cols !== dims.cols || entrada.xterm.rows !== dims.rows) {
      entrada.xterm.resize(dims.cols, dims.rows);
    }
    window.api.terminalPtyResize({ id, cols: dims.cols, rows: dims.rows });
  } catch {
    // el contenedor aún no tiene tamaño
  }
}

/** Pinta la lista de terminales de la derecha. */
function renderFilasDeTerminales() {
  const destino = document.getElementById('terminal-rows');
  if (!destino) return;

  destino.replaceChildren();

  for (const [id, entrada] of terminales) {
    const fila = document.createElement('button');
    fila.type = 'button';
    fila.className = 'terminal__row';
    if (id === terminalActiva) {
      fila.classList.add('is-active');
      fila.setAttribute('aria-current', 'true');
    }

    const icono = document.createElement('span');
    icono.className = 'terminal__row-icon';
    icono.innerHTML = window.Icon('terminal', 16);

    const nombre = document.createElement('span');
    nombre.textContent = entrada.nombre;

    fila.append(icono, nombre);
    fila.addEventListener('click', () => activarTerminal(id));
    destino.append(fila);
  }
}

/** Pinta las pestañas y marca la activa. */
function pintarPestanasTerminal() {
  const barra = document.getElementById('terminal-tabs');
  if (!barra) return;

  barra.replaceChildren();

  /*
   * Su barra mezcla vistas y terminales: la primera pestaña es «Open File».
   * Medido en su DOM: pestaña de 28 px con icono y etiqueta, activa si esa vista
   * está abierta.
   */
  const vista = document.createElement('div');
  vista.className = 'terminal__tab';
  vista.dataset.auxView = 'open-file';

  const iconoVista = document.createElement('span');
  iconoVista.className = 'terminal__tab-icon';
  iconoVista.innerHTML = window.Icon('files', 16);

  const etiquetaVista = document.createElement('span');
  etiquetaVista.textContent = 'Open File';

  vista.append(iconoVista, etiquetaVista);
  vista.addEventListener('click', () => void abrirPanelLateral('open-file'));
  if (!document.getElementById('aux-view-open-file')?.hidden) vista.classList.add('is-active');
  barra.append(vista);

  if (navegadorAbierto) {
    const pestana = document.createElement('div');
    pestana.className = 'terminal__tab';
    pestana.dataset.auxView = 'browser';
    pestana.classList.toggle(
      'is-active',
      !document.getElementById('aux-view-browser')?.hidden,
    );

    const iconoNavegador = document.createElement('span');
    iconoNavegador.className = 'terminal__tab-icon';
    iconoNavegador.innerHTML = window.Icon('globe', 14);

    const tituloNavegador = document.createElement('span');
    tituloNavegador.textContent = navegadorTitulo || 'Google';
    tituloNavegador.addEventListener('click', () => void abrirPanelLateral('browser'));

    const cerrarNavegadorTab = document.createElement('span');
    cerrarNavegadorTab.className = 'terminal__tab-close';
    cerrarNavegadorTab.textContent = '×';
    cerrarNavegadorTab.title = 'Cerrar pestaña';
    cerrarNavegadorTab.addEventListener('click', (event) => {
      event.stopPropagation();
      cerrarNavegador();
    });

    pestana.append(iconoNavegador, tituloNavegador, cerrarNavegadorTab);
    barra.append(pestana);
  }

  for (const [id, entrada] of terminales) {
    const pestana = document.createElement('div');
    pestana.className = 'terminal__tab';
    pestana.dataset.terminal = id;
    if (id === terminalActiva && !document.getElementById('aux-view-terminal')?.hidden) {
      pestana.classList.add('is-active');
    }

    const etiqueta = document.createElement('span');
    etiqueta.textContent = entrada.nombre;
    etiqueta.addEventListener('click', () => {
      // Con el navegador delante, activar la terminal no basta: su vista sigue oculta.
      seleccionarVistaAux('terminal');
      activarTerminal(id);
    });

    const cerrar = document.createElement('span');
    cerrar.className = 'terminal__tab-close';
    cerrar.textContent = '×';
    cerrar.title = 'Cerrar esta terminal';
    cerrar.addEventListener('click', (event) => {
      event.stopPropagation();
      void cerrarTerminal(id);
    });

    pestana.append(etiqueta, cerrar);
    barra.append(pestana);
  }

  renderOverviewTerminal();
  renderFilasDeTerminales();
}

/** Rellena la vista Terminal del panel de resumen. */
function renderOverviewTerminal() {
  const destino = document.getElementById('overview-terminal');
  if (!destino) return;

  destino.replaceChildren();

  if (terminales.size === 0) {
    const vacio = document.createElement('div');
    vacio.className = 'overview-empty';
    vacio.textContent = 'Sin terminal integrada';
    destino.append(vacio);
    return;
  }

  for (const [id, entrada] of terminales) {
    const fila = document.createElement('button');
    fila.type = 'button';
    fila.className = 'overview-terminal-row';
    if (id === terminalActiva) fila.classList.add('is-active');

    const nombre = document.createElement('span');
    nombre.className = 'overview-terminal-row__name';
    nombre.textContent = entrada.nombre;

    const estado = document.createElement('span');
    estado.className = 'overview-terminal-row__state';
    estado.textContent = id === terminalActiva ? 'activa' : '';

    fila.append(nombre, estado);
    fila.addEventListener('click', () => {
      toggleTerminal(true);
      activarTerminal(id);
    });
    destino.append(fila);
  }
}

/** Muestra una terminal y oculta las demás. */
function activarTerminal(id) {
  const entrada = terminales.get(id);
  if (!entrada) return;

  terminalActiva = id;

  for (const [otroId, otra] of terminales) {
    otra.contenedor.hidden = otroId !== id;
  }

  pintarPestanasTerminal();

  // Cabecera secundaria: su nombre de shell en 16/24, como en Antigravity.
  const rotulo = document.getElementById('terminal-shell');
  if (rotulo) rotulo.textContent = entrada.nombre;

  // El contenedor acaba de mostrarse: la primera medida puede salir con la
  // maquetación a medias. Se ajusta ahora y se reintenta al asentarse.
  const ajustar = () => {
    ajustarTerminal(id);
    try {
      entrada.xterm.focus();
    } catch {
      // sin foco disponible
    }
  };

  requestAnimationFrame(() => {
    ajustar();
    requestAnimationFrame(ajustar);
  });
  setTimeout(ajustar, 150);
}

/** Cierra una terminal y mata su PTY. */
async function cerrarTerminal(id) {
  const entrada = terminales.get(id);
  if (!entrada) return;

  try {
    await window.api.terminalPtyKill({ id });
  } catch {
    // el proceso ya no estaba
  }

  try {
    entrada.observer?.disconnect();
  } catch {
    // ya liberado
  }

  try {
    entrada.xterm.dispose();
  } catch {
    // ya liberado
  }

  entrada.contenedor.remove();
  terminales.delete(id);

  if (terminalActiva === id) {
    const siguiente = terminales.keys().next();
    terminalActiva = siguiente.done ? null : siguiente.value;
    if (terminalActiva) activarTerminal(terminalActiva);
  }

  pintarPestanasTerminal();

  // Sin terminales abiertas, se oculta el panel.
  if (terminales.size === 0) {
    els.auxPanel.hidden = true;
    document.querySelector('.body')?.classList.remove('is-terminal-open');
    document.body.classList.remove('aux--browser');
    const boton = $('toggle-terminal');
    if (boton) boton.setAttribute('aria-pressed', 'false');
  }
}

/** Abre una terminal más y la activa. */
async function nuevaTerminal() {
  const entrada = crearTerminal();
  if (!entrada) return;

  await ensurePty(entrada.id);
  activarTerminal(entrada.id);
}

/** Pinta la carpeta remota configurada y permite navegar por SFTP. */
async function renderRemoteFiles(remotePath) {
  const lista = $('remote-list');
  const estado = $('remote-status');
  const input = $('remote-path');
  if (!lista) return;

  const cfg = ui.prefs?.ssh ?? {};
  const ruta = String(remotePath || input?.value || cfg.remotePath || '/').trim() || '/';
  if (input) input.value = ruta;
  if (estado) estado.textContent = 'Conectando…';
  lista.replaceChildren();

  let resultado;
  try {
    resultado = await window.api.sshList(ruta);
  } catch (error) {
    resultado = { ok: false, error: error?.message ?? String(error) };
  }

  if (!resultado?.ok) {
    if (estado) estado.textContent = resultado?.error ?? 'Error de SSH';
    return;
  }

  if (estado) estado.textContent = `${cfg.user ?? ''}@${cfg.host ?? ''}:${ruta}`;
  const entradas = [...(resultado.entries ?? [])].sort(
    (a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name),
  );
  if (entradas.length === 0) {
    lista.append(rowText('Carpeta vacía'));
    return;
  }

  for (const entrada of entradas) {
    const fila = document.createElement('button');
    fila.type = 'button';
    fila.className = 'remote-entry';
    const icono = document.createElement('span');
    icono.className = 'remote-entry__icon';
    icono.textContent = entrada.directory ? '▸' : '·';
    const nombre = document.createElement('span');
    nombre.className = 'remote-entry__name';
    nombre.textContent = entrada.name;
    const tam = document.createElement('span');
    tam.className = 'remote-entry__size';
    tam.textContent = entrada.directory ? '' : `${Math.max(1, Math.round(entrada.size / 1024))} KB`;
    fila.append(icono, nombre, tam);
    fila.addEventListener('click', () => {
      if (entrada.directory) void renderRemoteFiles(entrada.path);
      else void openRemoteFile(entrada.path);
    });
    lista.append(fila);
  }
}

/** Abre un fichero remoto en una pestaña normal de Monaco. */
async function openRemoteFile(remotePath) {
  const cfg = ui.prefs?.ssh ?? {};
  const display = `ssh://${cfg.user ?? ''}@${cfg.host ?? ''}${remotePath}`;
  const existente = ui.tabs.find((tab) => tab.path === display);
  if (existente) {
    activateTab(display);
    return;
  }

  let resultado;
  try {
    resultado = await window.api.sshRead(remotePath);
  } catch (error) {
    resultado = { ok: false, error: error?.message ?? String(error) };
  }
  if (!resultado?.ok) {
    addNotice(`No se pudo leer ${remotePath}: ${resultado?.error ?? 'error'}`, 'error');
    return;
  }

  await cargarMonaco();
  toggleEditorPane(true);
  const editor = ensureMonaco();
  if (!editor) return;
  const language = monacoLanguage(remotePath);
  const uri = monacoApi.Uri.parse(`inmemory://ssh/${encodeURIComponent(remotePath)}`);
  const anterior = monacoApi.editor.getModel(uri);
  if (anterior) anterior.dispose();
  const model = monacoApi.editor.createModel(resultado.content, language, uri);
  ui.tabs.push({
    path: display,
    kind: 'remote',
    remotePath,
    model,
    original: resultado.content,
    language,
    viewState: null,
    lsp: null,
    group: ui.split ? ui.activeGroup : 0,
  });
  activateTab(display);
}

/** Abre una terminal SSH con la configuración de Ajustes. */
async function abrirTerminalSsh() {
  const ssh = ui.prefs?.ssh ?? {};
  if (!String(ssh.host ?? '').trim() || !String(ssh.user ?? '').trim()) {
    addNotice('Configura host y usuario SSH en Ajustes > Application.', 'error');
    window.SettingsUI.open('application');
    return;
  }

  const panel = els.auxPanel;
  if (!panel) return;
  panel.hidden = false;
  document.querySelector('.body')?.classList.add('is-terminal-open');
  $('toggle-terminal')?.setAttribute('aria-pressed', 'true');
  seleccionarVistaAux('terminal');

  const id = `ssh-${Date.now().toString(36)}`;
  const entrada = crearTerminal(id, {
    kind: 'ssh',
    nombre: `ssh ${ssh.user}@${ssh.host}`,
  });
  if (!entrada) return;
  const pty = await ensurePty(id);
  if (!pty) {
    addNotice('No se pudo abrir SSH. Revisa host, clave y servidor.', 'error');
    cerrarTerminal(id);
    return;
  }
  activarTerminal(id);
}

/** Arranca el PTY de una terminal si está disponible. */
async function ensurePty(id) {
  try {
    const status = await window.api.terminalPtyStatus();
    if (!status.available) return null;

    const entrada = terminales.get(id);
    const arrancado = await window.api.terminalStartPty({ id, kind: entrada?.kind ?? 'local' });
    if (!arrancado || !arrancado.ok) return null;
    if (entrada) entrada.pty = true;
    ptyActive = true;

    // Antigravity nombra la pestaña con la shell, no con un índice.
    const shell = arrancado.shell ? String(arrancado.shell).split(/[\\/]/).pop() : null;
    if (shell && entrada && entrada.kind !== 'ssh') {
      entrada.nombre = shell;
      pintarPestanasTerminal();
    }

    return shell ?? 'pty';
  } catch {
    return null;
  }
}

/** Rellena la vista Review con los cambios del turno en curso. */
async function renderAuxReview() {
  const destino = document.getElementById('aux-view-review');
  if (!destino) return;

  destino.replaceChildren();

  let cambios;
  try {
    cambios = await window.api.turnChanges();
  } catch {
    cambios = null;
  }

  if (!cambios || !cambios.files) {
    const vacio = document.createElement('div');
    vacio.className = 'aux__empty';
    vacio.textContent = 'Sin cambios pendientes de revisar.';
    destino.append(vacio);
    return;
  }

  const resumen = document.createElement('div');
  resumen.className = 'aux__summary';
  resumen.textContent = `${cambios.files} file${cambios.files === 1 ? '' : 's'} changed`;
  const mas = document.createElement('span');
  mas.className = 'aux__add';
  mas.textContent = `+${cambios.additions}`;
  const menos = document.createElement('span');
  menos.className = 'aux__del';
  menos.textContent = `-${cambios.removals}`;
  resumen.append(' ', mas, ' ', menos);
  destino.append(resumen);

  for (const ruta of cambios.paths ?? []) {
    const fila = document.createElement('button');
    fila.type = 'button';
    fila.className = 'aux__file';
    fila.textContent = ruta;
    fila.addEventListener('click', () => {
      cerrarPanelLateral();
      void openInEditor(ruta);
    });
    destino.append(fila);
  }
}

/** Rellena la vista Open File con las pestañas del editor. */
function renderAuxOpenFile() {
  const destino = document.getElementById('aux-view-open-file');
  if (!destino) return;

  destino.replaceChildren();

  if (!ui.tabs || ui.tabs.length === 0) {
    const vacio = document.createElement('div');
    vacio.className = 'aux__empty';
    vacio.textContent = 'Ningún fichero abierto.';
    destino.append(vacio);
    return;
  }

  for (const tab of ui.tabs) {
    const fila = document.createElement('button');
    fila.type = 'button';
    fila.className = 'aux__file';
    if (tab.path === ui.activeTab) fila.classList.add('is-active');

    const nombre = document.createElement('span');
    nombre.className = 'aux__file-name';
    nombre.textContent = tab.path.split(/[\\/]/).pop();

    const carpeta = document.createElement('span');
    carpeta.className = 'aux__file-path';
    carpeta.textContent = tab.path.split(/[\\/]/).slice(0, -1).join('/');

    fila.append(nombre, carpeta);
    fila.addEventListener('click', () => {
      cerrarPanelLateral();
      void openInEditor(tab.path);
    });
    destino.append(fila);
  }
}

/** Muestra una vista del panel lateral y oculta las demás. */
function seleccionarVistaAux(nombre) {
  const panel = els.auxPanel;
  if (!panel) return;

  const lanzador = document.getElementById('aux-launcher');
  const esLanzador = !nombre || nombre === 'launcher';

  if (lanzador) lanzador.hidden = !esLanzador;

  /*
   * En la fila superior solo aparecen las pestañas y sus botones cuando hay una
   * vista abierta; en el lanzador quedan solo los iconos del panel, como el suyo.
   */
  const esTerminal = nombre === 'terminal';
  const esNavegador = nombre === 'browser';
  /*
   * Su panel se ensancha al abrir el navegador (medido: 786 px). El límite de
   * 320 px deja sitio al hilo en ventanas estrechas.
   */
  document.body.classList.toggle('aux--browser', esNavegador);
  const tabs = document.getElementById('terminal-tabs');
  if (tabs) tabs.hidden = !(esTerminal || esNavegador);

  const add = document.getElementById('terminal-add');
  if (add) add.hidden = !esTerminal;

  const back = document.getElementById('aux-tab-back');
  if (back) back.hidden = esLanzador;

  const kill = document.getElementById('aux-kill');
  if (kill) kill.hidden = !esTerminal;

  for (const vista of panel.querySelectorAll('.aux__view')) {
    vista.hidden = vista.id !== `aux-view-${nombre}`;
  }

  for (const item of panel.querySelectorAll('.aux__item')) {
    item.classList.toggle('is-active', item.dataset.auxView === nombre);
  }

  if (nombre === 'terminal') {
    // La terminal necesita medirse cuando su vista ya es visible.
    if (terminalActiva) activarTerminal(terminalActiva);
  }

  if (nombre === 'review') void renderAuxReview();
  if (nombre === 'open-file') renderAuxOpenFile();
  if (nombre === 'remote') void renderRemoteFiles();
  if (nombre === 'browser') abrirNavegadorLateral();
}

/** Abre el panel lateral en una vista concreta. */
async function abrirPanelLateral(vista) {
  const panel = els.auxPanel;
  if (!panel) return;

  panel.hidden = false;
  document.querySelector('.body')?.classList.add('is-terminal-open');
  $('toggle-terminal')?.setAttribute('aria-pressed', 'true');

  seleccionarVistaAux(vista ?? 'launcher');

  if (vista === 'terminal') {
    /*
     * Abrir la vista desde el lanzador debe mostrar el mismo terminal que
     * `toggleTerminal`. Antes el contenedor xterm quedaba oculto y solo se veía
     * la terminal legacy.
     */
    const hayXterm = Boolean(window.XtermApp);
    if (els.terminalXterm) els.terminalXterm.hidden = !hayXterm;
    if (els.terminalLegacy) els.terminalLegacy.hidden = hayXterm;

    if (terminales.size === 0) {
      const entrada = crearTerminal();
      if (entrada) {
        ptyActive = Boolean(await ensurePty(entrada.id));
        activarTerminal(entrada.id);
      }
    } else if (terminalActiva) {
      activarTerminal(terminalActiva);
    }
  }
}

/** Cierra el panel lateral. */
function cerrarPanelLateral() {
  if (!els.auxPanel) return;
  els.auxPanel.hidden = true;
  document.querySelector('.body')?.classList.remove('is-terminal-open');
  $('toggle-terminal')?.setAttribute('aria-pressed', 'false');
}

/** Muestra u oculta la terminal. */
async function toggleTerminal(force) {
  const open = force ?? els.auxPanel.hidden;

  if (!open) {
    cerrarPanelLateral();
    return;
  }

  /*
   * El contenedor tiene que estar visible ANTES de crear o ajustar la
   * terminal: `FitAddon` mide el elemento, y sobre un `display: none` se queda
   * en el tamaño por defecto (80x24) sin avisar. Por eso el panel se abre
   * primero y la terminal se crea después.
   */
  const yaHayXterm = Boolean(window.XtermApp);
  els.terminalXterm.hidden = !yaHayXterm;
  els.terminalLegacy.hidden = yaHayXterm;

  await abrirPanelLateral('terminal');

  if (terminales.size === 0) {
    // Sin xterm disponible: se cae al ejecutor de comandos.
    els.terminalXterm.hidden = true;
    els.terminalLegacy.hidden = false;
  }

  // El indicador de directorio es opcional: el panel nuevo no lo tiene.
  if (els.terminalCwd) {
    try {
      els.terminalCwd.textContent = terminales.size > 0 ? 'pty' : await window.api.terminalCwd();
    } catch {
      els.terminalCwd.textContent = '';
    }
  }

  els.terminalInput.placeholder = 'Escribe un comando…';
  if (terminales.size === 0) els.terminalInput.focus();
}

/** Añade texto a la salida de la terminal que corresponda. */
function terminalWrite(text, raw, id) {
  const entrada = id ? terminales.get(id) : terminalActiva ? terminales.get(terminalActiva) : null;

  if (entrada) {
    // xterm interpreta ANSI; el texto no-raw del PTY (por ejemplo `[exit N]`)
    // también debe ir aquí, porque la salida legacy está oculta.
    entrada.xterm.write(text);
    return;
  }

  if (raw) {
    els.terminalOutput.innerHTML += ansiToHtml(text);
  } else {
    els.terminalOutput.textContent += text;
  }
  els.terminalOutput.scrollTop = els.terminalOutput.scrollHeight;
}

/** Envía el comando escrito. */
async function terminalSubmit() {
  const command = els.terminalInput.value;

  const activa = terminalActiva ? terminales.get(terminalActiva) : null;
  if (activa?.pty) {
    els.terminalInput.value = '';
    await window.api.terminalPtyWrite({ id: terminalActiva, data: `${command}\r` });
    return;
  }

  const trimmed = command.trim();
  if (trimmed.length === 0) return;

  els.terminalInput.value = '';
  terminalWrite(`$ ${trimmed}\n`);

  const result = await window.api.terminalRun(trimmed);
  if (!result.ok && result.error) {
    terminalWrite(`${result.error}\n`);
  }
}

// ---------------------------------------------------------------------------
// Paleta de comandos
// ---------------------------------------------------------------------------

/** Muestra u oculta la paleta según lo escrito en el composer. */
function updateCommandPalette() {
  const value = els.input.value;

  if (!value.startsWith('/') || value.includes('\n')) {
    hideCommandPalette();
    return;
  }

  const query = value.slice(1).split(' ')[0].toLowerCase();
  ui.commandMatches = COMMANDS.filter((cmd) => cmd.id.startsWith(query));
  ui.commandIndex = Math.min(ui.commandIndex, Math.max(0, ui.commandMatches.length - 1));

  if (ui.commandMatches.length === 0) {
    hideCommandPalette();
    return;
  }

  els.commandPopoverBody.replaceChildren();

  ui.commandMatches.forEach((cmd, index) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'popover__item';
    if (index === ui.commandIndex) item.classList.add('is-selected');

    const label = document.createElement('span');
    label.className = 'cmd__label';
    label.textContent = cmd.label;

    const hint = document.createElement('span');
    hint.className = 'cmd__hint';
    hint.textContent = cmd.hint;

    item.append(label, hint);
    item.addEventListener('mousedown', (event) => {
      event.preventDefault();
      runCommand(cmd);
    });

    els.commandPopoverBody.append(item);
  });

  els.commandPopover.removeAttribute('hidden');
}

function hideCommandPalette() {
  els.commandPopover.setAttribute('hidden', '');
  ui.commandMatches = [];
  ui.commandIndex = 0;
}

/**
 * `/btw`: pregunta lateral en un panel sobre el composer. No añade mensajes al
 * hilo, no usa herramientas y no persiste. Varias preguntas se apilan.
 */
let panelBtw = null;

function abrirPanelBtw() {
  if (panelBtw) {
    panelBtw.panel.hidden = false;
    return panelBtw;
  }

  const panel = document.createElement('section');
  panel.className = 'btw-panel';
  panel.setAttribute('role', 'region');
  panel.setAttribute('aria-label', 'Pregunta lateral');

  const cabecera = document.createElement('div');
  cabecera.className = 'btw-panel__header';
  const titulo = document.createElement('span');
  titulo.className = 'btw-panel__title';
  titulo.textContent = 'Pregunta lateral';
  const cerrar = document.createElement('button');
  cerrar.type = 'button';
  cerrar.className = 'btw-panel__close';
  cerrar.setAttribute('aria-label', 'Cerrar pregunta lateral');
  cerrar.textContent = '✕';
  cerrar.addEventListener('click', () => { panel.hidden = true; });
  cabecera.append(titulo, cerrar);

  const lista = document.createElement('div');
  lista.className = 'btw-panel__list';
  panel.append(cabecera, lista);
  els.form.parentElement.prepend(panel);

  panelBtw = { panel, lista };
  return panelBtw;
}

function preguntarLateral(pregunta) {
  const { panel, lista } = abrirPanelBtw();
  panel.hidden = false;

  const entrada = document.createElement('article');
  entrada.className = 'btw-entry';
  const q = document.createElement('div');
  q.className = 'btw-entry__question';
  q.textContent = pregunta;
  const a = document.createElement('div');
  a.className = 'btw-entry__answer';
  a.textContent = 'Pensando…';
  entrada.append(q, a);
  lista.append(entrada);
  lista.scrollTop = lista.scrollHeight;

  window.api.askSide({ text: pregunta })
    .then((resultado) => {
      if (!resultado?.ok) {
        a.classList.add('is-error');
        a.textContent = `Error: ${resultado?.error ?? 'sin respuesta'}`;
        return;
      }
      a.classList.remove('is-error');
      a.innerHTML = window.Markdown?.render(resultado.text ?? '') || '';
    })
    .catch((error) => {
      a.classList.add('is-error');
      a.textContent = `Error: ${error?.message ?? error}`;
    })
    .finally(() => {
      lista.scrollTop = lista.scrollHeight;
    });
}

/** Ejecuta un comando del composer. */
function runCommand(cmd) {
  hideCommandPalette();
  const raw = els.input.value;
  const rest = raw.slice(1 + cmd.id.length).trim();

  els.input.value = '';
  autoGrow();
  updateSendState();

  switch (cmd.id) {
    case 'plan': {
      const task = rest.length > 0 ? rest : 'la tarea actual';
      els.input.value = `Elabora un plan numerado, sin modificar ficheros todavía, para: ${task}`;
      autoGrow();
      updateSendState();
      submitOrQueue();
      break;
    }

    case 'model':
      toggleModelPopover();
      break;

    case 'clear':
      newConversation();
      break;

    case 'settings':
      window.SettingsUI.open();
      break;

    case 'browser': {
      if (rest.length === 0) {
        addNotice('Uso: /browser <url>', 'info');
        break;
      }
      window.api.openBrowser(rest).then((result) => {
        if (!result.ok) addNotice(`No se pudo abrir: ${result.error}`, 'error');
      });
      break;
    }

    case 'ssh': {
      abrirTerminalSsh();
      break;
    }

    case 'remote': {
      abrirPanelLateral('remote');
      if (rest.length > 0) {
        const input = $('remote-path');
        if (input) input.value = rest;
        void renderRemoteFiles(rest);
      }
      break;
    }

    case 'btw': {
      if (rest.length === 0) {
        addNotice('Uso: /btw <pregunta>', 'info');
        break;
      }
      preguntarLateral(rest);
      break;
    }

    case 'stop':
      stopAgent();
      break;

    case 'help':
      addNotice(
        'Comandos: ' + COMMANDS.map((entry) => `${entry.label} — ${entry.hint}`).join(' · '),
        'info',
      );
      break;

    default:
      break;
  }
}

/** Detiene la ejecución en curso (botón de parar). */
async function stopAgent() {
  if (!ui.busy) return;
  ui.queue = [];
  await window.api.abortChat();
}

/** Encola un mensaje o interrumpe la ejecución, según la preferencia. */
async function submitOrQueue() {
  // Los comandos con argumentos se ejecutan aunque la paleta ya esté cerrada.
  const comandoDirecto = /^\/(btw|ssh|remote)(?:\s|$)/i.exec(els.input.value.trim());
  if (comandoDirecto) {
    runCommand({ id: comandoDirecto[1] });
    return undefined;
  }
  // Con un plan pendiente, el mensaje es la revisión: va directo al turno.
  if (ui.planCard) return send();
  if (!ui.busy) return send();

  if (ui.planEjecutando) {
    const texto = els.input.value.trim();
    if (texto.length === 0) return;
    els.input.value = '';
    autoGrow();
    updateSendState();
    addUserMessage(texto);
    const resultado = await window.api.sendPrompt({ text: texto });
    if (!resultado?.ok) addNotice(resultado?.error ?? 'No se pudo enviar al planificador.', 'error');
    return;
  }

  if (ui.prefs.queuedMessages === 'Send Immediately') {
    await window.api.abortChat();
    // Espera a que el proceso principal cierre el turno antes de enviar.
    for (let i = 0; i < 100 && ui.busy; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    ui.queue = [];
    return send();
  }

  const text = els.input.value.trim();
  if (text.length === 0) return undefined;

  ui.queue.push(text);
  els.input.value = '';
  autoGrow();
  updateSendState();
  return undefined;
}

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------

async function boot() {
  initSearchPanel();
  initQuickFixes();

  let updateNotified = false;
  window.api.onUpdateEvent?.((estado) => {
    if (estado?.status === 'available' && !updateNotified) {
      updateNotified = true;
      addNotice(`Actualización disponible: ${estado.availableVersion ?? 'nueva versión'}.`, 'info');
    }
  });

  window.api.onLspDiagnostics?.(({ uri, diagnostics }) => {
    const normalizarUri = (valor) =>
      String(valor ?? '').replace(
        /^file:\/\/\/([A-Za-z])(%3A|:)/i,
        (_todo, letra) => `file:///${String(letra).toLowerCase()}:`,
      );
    const tab = ui.tabs.find(
      (entrada) => normalizarUri(entrada.lspUri) === normalizarUri(uri),
    );
    if (!tab) return;
    tab.diagnostics = diagnostics ?? [];
    if (tab.path === ui.activeTab) {
      ui.diagnostics = tab.diagnostics;
      renderDiagnostics();
    }
  });

  let state = null;
  try {
    state = await window.api.getState();
  } catch (error) {
    console.error('No se pudo obtener el estado:', error);
  }

  if (state) {
    ui.cwd = state.cwd ?? null;
    ui.project = state.project ?? null;
    ui.projects = Array.isArray(state.projects) ? state.projects : [];
    ui.providerId = state.providerId ?? null;
    ui.model = state.model ?? null;
    ui.userName = state.userName ?? '';
    ui.remoteWorkspace = state.remote ?? null;

    if (ui.project) {
      const nombre = state.remote?.label || nombreProyecto(ui.project);
      els.projectName.textContent = nombre;
      if (els.projectPill) els.projectPill.textContent = nombre;
      actualizarEtiquetaProyecto(nombre);
    } else {
      reflejarSinProyecto();
    }
    ui.activeConversation = state.sessionId ?? null;
  }

  void loadProviders();
  await refreshConversations();

  // Restaura preferencias: barra lateral, contraste, sonido, cola…
  try {
    const stored = await window.api.getPrefs();
    if (stored && typeof stored === 'object') {
      applyPrefs(stored);
      if (stored.sidebarCollapsed === true) setSidebarCollapsed(true);
    }
  } catch {
    // sin preferencias guardadas
  }

  window.api.onChatEvent(handleChatEvent);

  // El saludo depende del perfil y del idioma; se repinta con ambos.
  aplicarSaludo();
  document.addEventListener('i18n:change', () => aplicarSaludo());

  // Cabeceras plegables de la barra lateral (Projects y Conversations).
  conectarSeccionPlegable('btn-toggle-projects', 'project-list');
  conectarSeccionPlegable('btn-toggle-conversations', 'conversation-list');

  // El webview existe desde el arranque: se cablea antes de abrir la vista.
  conectarNavegador();

  // Pensamiento extendido: botón del chat, solo para modelos que lo admiten.
  $('btn-thinking')?.addEventListener('click', () => {
    ui.thinking = !ui.thinking;
    renderThinkingToggle();
  });
  renderThinkingToggle();


  // Selector de modelo
  els.btnModel.addEventListener('click', (event) => {
    event.stopPropagation();
    toggleModelPopover();
  });

  document.addEventListener('click', (event) => {
    if (els.modelPopover.hasAttribute('hidden')) return;
    if (els.modelPopover.contains(event.target)) return;
    if (els.btnModel.contains(event.target)) return;
    hideModelPopover();
  });

  // Ajustes: el panel se gestiona en settings.js
  els.btnSettings.addEventListener('click', openSettings);

  for (const el of document.querySelectorAll('[data-close-settings]')) {
    el.addEventListener('click', closeSettings);
  }

  window.SettingsUI.init({
    getState: () => ({
      providers: ui.providers,
      providerId: ui.providerId,
      model: ui.model,
      cwd: ui.cwd,
    }),
    addNotice: (msg, type) => addNotice(msg, type),
    onSelectModel: (providerId, modelId) => selectModel(providerId, modelId),
    reloadProviders: () => loadProviders(true),
    refreshProviders: () => loadProviders(true),
    onPrefChange: (_key, _value, all) => applyPrefs(all),
    openSshTerminal: () => void abrirTerminalSsh(),
    openRemoteProject: (resultado) => void abrirProyectoRemoto(resultado),
    exportActiveConversation: () => exportConversation(),
    openSearch: () => toggleSearch(true),
    getTools: () => ui.tools,
    getSkills: () => ui.skills,
    refreshSkills: async () => {
      ui.skills = await window.api.listSkills();
      window.SettingsUI.refresh();
    },
    getRemote: () => ui.remote,
    toggleRemote: () => toggleRemote(),
    onChangeWorkspace: () => changeWorkspace(),
  });

  document.addEventListener('keydown', (event) => {
    // Atajos declarados en Settings › Shortcuts.
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'n') {
      event.preventDefault();
      newConversation();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'm') {
      event.preventDefault();
      toggleModelPopover();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      openPalette();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key === '`') {
      event.preventDefault();
      toggleTerminal();
      return;
    }
    if (event.key !== 'Escape') return;
    hideModelPopover();
    closeContextMenu();
    cerrarProjectMenu();
    closePalette();
    document.getElementById('revert-modal')?.setAttribute('hidden', '');
    closeScheduled();
    closeMenus();
    if (window.SettingsUI.isOpen()) window.SettingsUI.close();
    else if (!els.sidebarSearch.hasAttribute('hidden')) toggleSearch(false);
  });

  els.input.addEventListener('paste', manejarPegado);
  const composerCard = els.input.closest('.composer__card');
  composerCard?.addEventListener('dragover', (event) => {
    if (event.dataTransfer?.types?.includes('Files')) event.preventDefault();
  });
  composerCard?.addEventListener('drop', manejarDrop);

  els.form.addEventListener('submit', (event) => {
    event.preventDefault();
    // Con un plan pendiente el botón envía la revisión, no detiene el turno.
    if (ui.planCard) {
      submitOrQueue();
      return;
    }
    if (ui.busy) {
      stopAgent();
      return;
    }
    submitOrQueue();
  });

  els.input.addEventListener('input', () => {
    autoGrow();
    updateSendState();
    updateCommandPalette();
    updateMentionPalette();
  });

  els.input.addEventListener('keydown', (event) => {
    const mentionOpen = !els.mentionPopover.hasAttribute('hidden');

    if (mentionOpen) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        ui.mentionIndex = (ui.mentionIndex + 1) % ui.mentionMatches.length;
        updateMentionPalette();
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        ui.mentionIndex =
          (ui.mentionIndex - 1 + ui.mentionMatches.length) % ui.mentionMatches.length;
        updateMentionPalette();
        return;
      }
      if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey)) {
        event.preventDefault();
        const chosen = ui.mentionMatches[ui.mentionIndex];
        if (chosen) insertMention(chosen);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        hideMentionPalette();
        return;
      }
    }

    const paletteOpen = !els.commandPopover.hasAttribute('hidden');

    if (paletteOpen) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        ui.commandIndex = (ui.commandIndex + 1) % ui.commandMatches.length;
        updateCommandPalette();
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        ui.commandIndex =
          (ui.commandIndex - 1 + ui.commandMatches.length) % ui.commandMatches.length;
        updateCommandPalette();
        return;
      }
      if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey)) {
        event.preventDefault();
        const chosen = ui.commandMatches[ui.commandIndex];
        if (chosen) runCommand(chosen);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        hideCommandPalette();
        return;
      }
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submitOrQueue();
    }
  });

  $('remote-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    void renderRemoteFiles($('remote-path')?.value);
  });
  // --- Botones de la barra lateral -----------------------------------------
  els.btnNew?.addEventListener('click', newConversation);
  // Panel de overview: cada fila muestra su vista.
  for (const row of document.querySelectorAll('.overview-row')) {
    row.addEventListener('click', () => selectOverviewView(row.dataset.panel));
  }

  els.effortLabel?.addEventListener('click', (event) => {
    event.stopPropagation();
    const indice = ESCALA_DE_ESFUERZO.indexOf(ui.effort);
    const next = ESCALA_DE_ESFUERZO[(indice + 1) % ESCALA_DE_ESFUERZO.length];
    ui.effort = next;
    els.effortLabel.textContent = next;
    els.effortLabel.title = ETIQUETA_DE_ESFUERZO[next] ?? '';
    window.api.setPrefs({ effort: next }).catch(() => {});
  });

  els.btnNew2.addEventListener('click', newConversation);
  els.btnNewLogo?.addEventListener('click', newConversation);
  els.btnNewSection?.addEventListener('click', newConversation);
  els.btnToggleSidebar?.addEventListener('click', toggleSidebar);
  els.btnGoBack?.addEventListener('click', () => window.history.back());
  els.btnGoForward?.addEventListener('click', () => window.history.forward());
  els.btnDisplayOptions?.addEventListener('click', (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    openContextMenu(rect.left, rect.bottom + 4, [
      { label: 'Mostrar todos los proyectos', onClick: () => {} },
      { label: 'Ocultar archivados', onClick: () => {} },
    ]);
  });
  els.btnOpenWorkspace.addEventListener('click', changeWorkspace);
  els.btnToggleTop?.addEventListener('click', toggleSidebar);
  els.btnSearch.addEventListener('click', () => toggleSearch());

  const overviewToggle = $('toggle-overview-panel');
  if (overviewToggle) overviewToggle.addEventListener('click', () => toggleOverview());

  els.searchInput.addEventListener('input', () => {
    ui.query = els.searchInput.value;
    renderConversations();
  });

  els.searchInput.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      toggleSearch(false);
    }
  });

  // --- Menús de la barra de título -----------------------------------------
  for (const btn of document.querySelectorAll('[data-menu]')) {
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      toggleMenu(btn.dataset.menu);
    });
  }

  for (const item of document.querySelectorAll('[data-action]')) {
    item.addEventListener('click', (event) => {
      event.stopPropagation();
      runMenuAction(item.dataset.action);
    });
  }

  document.addEventListener('click', (event) => {
    if (els.contextMenu.contains(event.target)) return;
    closeContextMenu();
    if (!event.target.closest?.('.project-menu') && !event.target.closest?.('#btn-project-selector-inline')) {
      cerrarProjectMenu();
    }
    if (!event.target.closest || !event.target.closest('.menu')) closeMenus();
  });

  // --- Accesos rápidos -----------------------------------------------------
  document.getElementById('btn-customizations').addEventListener('click', () => {
    window.SettingsUI.open('customizations');
  });
  document.getElementById('btn-automations').addEventListener('click', () => openAutomations());

  /*
   * «Create with Prompt» es el flujo guiado: se abre el formulario con el foco
   * en la descripción, que es donde se escribe qué debe hacer la automatización.
   */
  /*
   * «Create with Prompt» no es un formulario: medido en su app, abre una
   * conversación nueva con el mensaje ya escrito («Guide me through creating an
   * automated task») y el agente te guía hasta crear la tarea.
   */
  document.getElementById('automations-create')?.addEventListener('click', async () => {
    closeAutomations();
    await newConversation();
    els.input.value = 'Guíame para crear una tarea automatizada';
    autoGrow();
    updateSendState();
    await send();
  });
  document.getElementById('automations-new')?.addEventListener('click', () => openScheduled());

  document.getElementById('scheduled-add')?.addEventListener('click', async () => {
    const prompt = document.getElementById('scheduled-prompt');
    const every = document.getElementById('scheduled-every');
    const unit = document.getElementById('scheduled-unit');
    if (!prompt || !prompt.value.trim()) return;

    await window.api.saveScheduled({
      prompt: prompt.value.trim(),
      every: Number(every?.value ?? 30),
      unit: unit?.value ?? 'minutes',
      nextRunAt: new Date(Date.now() + Number(every?.value ?? 30) * (unit?.value === 'hours' ? 3600000 : 60000)).toISOString(),
    });

    prompt.value = '';
    await renderScheduled();
  });

  for (const node of document.querySelectorAll('[data-close-scheduled]')) {
    node.addEventListener('click', closeScheduled);
  }

  // Plan mode: el agente propone pasos y el usuario decide.
  /*
   * Despertar reactivo: si una tarea de fondo termina con el turno cerrado, se
   * arranca uno nuevo con su resultado, sin que el usuario tenga que preguntar.
   */
  /*
   * El despertar NO se descarta si el usuario está en un turno: se encola y se
   * entrega al terminar. Descartarlo perdía el resultado de la tarea para
   * siempre, que es peor que llegar tarde.
   */
  window.api.onTaskWake?.(({ texto, sessionId }) => {
    // Un despertar de otra conversación no se pinta en la actual.
    if (sessionId) {
      if (ui.activeConversation) {
        if (sessionId !== ui.activeConversation) return;
      } else if (!ui.busy) {
        return;
      }
    }
    ui.despertaresPendientes.push(texto);
    if (ui.busy) {
      addNotice('Una tarea de fondo terminó. El agente la retomará al acabar.', 'ok');
      return;
    }
    entregarDespertares();
  });

  window.api.onPlanProposal((plan) => showPlanCard(plan));
  window.api.onQuestionAsk((payload) => showQuestionCard(payload));

  // Una tarea vencida lanza su prompt en una conversación nueva.
  window.api.onScheduledFire(async (payload) => {
    closeScheduled();
    const creada = await newConversation();
    if (!creada) {
      addNotice('La tarea programada no pudo abrir una conversación nueva.', 'warning');
      return;
    }
    els.input.value = payload.prompt ?? '';
    autoGrow();
    updateSendState();
    await send();
  });
  // Selector de proyecto dentro del composer (estado vacío).
  document.getElementById('btn-project-selector-inline')?.addEventListener('click', (event) => {
    event.stopPropagation();
    if (projectMenu) {
      cerrarProjectMenu();
      return;
    }
    abrirProjectSelector(event.currentTarget);
  });

  els.btnProjectSelector?.addEventListener('click', (event) => {
    event.stopPropagation();
    abrirProjectSelector(els.btnProjectSelector);
  });
  document.getElementById('btn-permissions')?.addEventListener('click', () => {
    window.SettingsUI.open('general');
  });
  // Paleta de comandos: filtro y navegación con teclado.
  const paletteInput = document.getElementById('palette-input');
  paletteInput?.addEventListener('input', () => renderPalette(paletteInput.value));
  paletteInput?.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      movePaletteSelection(1);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      movePaletteSelection(-1);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const command = paletteItems[paletteIndex];
      if (command) {
        closePalette();
        command.run();
      }
    }
  });

  for (const node of document.querySelectorAll('[data-close-palette]')) {
    node.addEventListener('click', closePalette);
  }

  // Git remoto: fetch, pull, push y abortar fusión.
  document.getElementById('git-fetch-btn')?.addEventListener('click', async () => {
    const result = await window.api.gitFetch();
    addNotice(result.ok ? 'Fetch completado.' : `Fetch falló: ${result.output}`, result.ok ? 'info' : 'error');
    await refreshGit();
  });

  document.getElementById('git-pull-btn')?.addEventListener('click', async () => {
    const result = await window.api.gitPull();
    addNotice(result.ok ? 'Pull completado.' : `Pull falló: ${result.output}`, result.ok ? 'info' : 'error');
    await refreshGit();
  });

  document.getElementById('git-push-btn')?.addEventListener('click', async () => {
    const result = await window.api.gitPush({ setUpstream: true });
    addNotice(result.ok ? 'Push completado.' : `Push falló: ${result.output}`, result.ok ? 'info' : 'error');
    await refreshGit();
  });

  document.getElementById('git-abort-btn')?.addEventListener('click', async () => {
    const result = await window.api.gitAbortMerge();
    addNotice(result.ok ? 'Fusión abortada.' : `No se pudo abortar: ${result.output}`, result.ok ? 'info' : 'error');
    await refreshGit();
  });

  for (const node of document.querySelectorAll('[data-close-revert]')) {
    node.addEventListener('click', () => {
      document.getElementById('revert-modal')?.setAttribute('hidden', '');
    });
  }

  document.getElementById('announce-close')?.addEventListener('click', hideAnnouncement);

  document.getElementById('toggle-aux-pane')?.addEventListener('click', () => toggleEditorPane());

  // Tarjetas de la vista de nueva pestaña.
  for (const card of document.querySelectorAll('.newtab__card')) {
    card.addEventListener('click', () => runNewTabAction(card.dataset.newtab));
  }

  document.getElementById('btn-more-actions')?.addEventListener('click', (event) => {
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    openContextMenu(rect.right - 180, rect.bottom + 4, [
      { label: 'Renombrar conversación…', onClick: () => renameConversation() },
      { label: 'Archivar conversación', onClick: () => archiveConversation() },
      { label: 'Exportar como Markdown', onClick: () => exportConversation() },
    ]);
  });

  // Preset de permisos: cambia de verdad lo que el agente puede hacer sin preguntar.
  document.getElementById('btn-turbo').addEventListener('click', (event) => {
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    const actual = ui.prefs.permissionPreset ?? 'Turbo';

    openContextMenu(
      rect.left,
      rect.top - 8,
      PRESETS.map((preset) => ({
        label: preset,
        selected: preset === actual,
        onClick: () => setPermissionPreset(preset),
      })),
    );
  });

  // Adjuntar contexto: fichero del disco, mención o imagen.
  document.getElementById('btn-add-context')?.addEventListener('click', (event) => {
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    openContextMenu(rect.left, rect.top - 8, [
      { label: 'Adjuntar fichero…', onClick: () => attachFile() },
      { label: 'Mencionar del proyecto', onClick: () => insertMentionTrigger() },
      { label: 'Añadir imagen…', onClick: () => attachImage() },
    ]);
  });

  // Dictado real con el reconocimiento de voz del navegador.
  document.getElementById('btn-voice')?.addEventListener('click', () => toggleDictation());

  renderPresetLabel();

  // --- Catalogos y control remoto ------------------------------------------
  await loadCatalogues();

  // --- Terminal -------------------------------------------------------------
  window.api.onTerminalData((payload) => terminalWrite(payload.chunk ?? '', payload.raw === true, payload.id));
  window.api.onTerminalDone(async (payload) => {
    if (payload.code !== 0 && payload.code !== undefined) {
      terminalWrite(`[exit ${payload.code}]\n`, false, payload.id);
    }
    try {
      if (els.terminalCwd) els.terminalCwd.textContent = await window.api.terminalCwd();
    } catch {
      // sin cwd disponible
    }
  });
  window.api.onTerminalClear(() => {
    els.terminalOutput.textContent = '';
  });

  els.terminalInput.addEventListener('keydown', async (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      terminalSubmit();
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      toggleTerminal(false);
      return;
    }

    if (!ptyActive) return;

    // Secuencias de control para el PTY.
    const sequences = {
      ArrowUp: '\u001b[A',
      ArrowDown: '\u001b[B',
      ArrowRight: '\u001b[C',
      ArrowLeft: '\u001b[D',
      Tab: '\t',
      Backspace: '\u007f',
    };

    if (event.ctrlKey && event.key.toLowerCase() === 'c') {
      event.preventDefault();
      await window.api.terminalPtyWrite({ id: terminalActiva, data: '\u0003' });
      return;
    }

    const sequence = sequences[event.key];
    if (sequence) {
      event.preventDefault();
      await window.api.terminalPtyWrite({ id: terminalActiva, data: sequence });
    }
  });

  const terminalToggle = $('toggle-terminal');
  if (terminalToggle) terminalToggle.addEventListener('click', () => toggleTerminal());
  const terminalKill = $('aux-kill');
  if (terminalKill) {
    terminalKill.addEventListener('click', () => {
      // Interrumpir solo la terminal activa, no todas.
      const activa = terminalActiva ? terminales.get(terminalActiva) : null;
      if (activa?.pty && terminalActiva) window.api.terminalPtyKill({ id: terminalActiva });
      else window.api.terminalKill();
    });
  }

  const terminalAdd = $('terminal-add');
  if (terminalAdd) terminalAdd.addEventListener('click', () => void nuevaTerminal());
  const terminalClose = $('aux-tab-back');
  if (terminalClose) {
    // Vuelve a la lista de vistas, no cierra el panel.
    terminalClose.addEventListener('click', () => seleccionarVistaAux('launcher'));
  }

  const auxClose = $('aux-close');
  if (auxClose) auxClose.addEventListener('click', cerrarPanelLateral);

  const auxMaximize = $('aux-maximize');
  if (auxMaximize) {
    auxMaximize.addEventListener('click', () => {
      const cuerpo = document.querySelector('.body');
      cuerpo?.classList.toggle('is-aux-maximized');
      // Al cambiar el ancho hay que reajustar la terminal visible.
      if (terminalActiva) setTimeout(() => ajustarTerminal(terminalActiva), 300);
    });
  }

  for (const item of document.querySelectorAll('.aux__item')) {
    item.addEventListener('click', () => {
      const vista = item.dataset.auxView;
      void abrirPanelLateral(vista);
    });
  }

  // --- Git ------------------------------------------------------------------
  for (const el of document.querySelectorAll('[data-close-git-diff]')) {
    el.addEventListener('click', closeGitDiff);
  }
  // Escape cierra el diff como cualquier otro diálogo; antes solo cerraba la ✕.
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    const modal = $('git-diff-modal');
    if (modal && !modal.hasAttribute('hidden')) {
      event.preventDefault();
      closeGitDiff();
    }
  });
  const indexBtn = $('index-build');
  if (indexBtn) indexBtn.addEventListener('click', rebuildIndex);
  const warmBtn = $('index-warm');
  if (warmBtn) warmBtn.addEventListener('click', warmIndex);

  const branchSelect = $('git-branch-select');
  if (branchSelect) {
    branchSelect.addEventListener('change', () => checkoutBranch(branchSelect.value));
  }

  const commitBtn = $('git-commit-btn');
  if (commitBtn) commitBtn.addEventListener('click', commitChanges);
  const commitInput = $('git-message');
  if (commitInput) {
    commitInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        commitChanges();
      }
    });
  }

  // Editor
  await loadFileIndex();

  window.api.onDiffProposal((payload) => addDiffCard(payload, payload.id));
  window.api.onDiffApplied((payload) => addDiffCard(payload, null));

  window.api.onRemotePrompt((text) => {
    // No pisar lo que el usuario esté escribiendo: el prompt remoto se envía
    // por su propio cauce, o se encola si hay un turno activo.
    if (ui.busy) {
      ui.queue.push(String(text ?? ''));
      return;
    }
    void sendText(String(text ?? ''));
  });

  // --- Enlaces: respeta «Open Links In» ------------------------------------
  document.addEventListener('click', (event) => {
    const anchor = event.target && event.target.closest ? event.target.closest('a[href]') : null;
    if (!anchor) return;

    const href = anchor.getAttribute('href');
    if (!href || href.startsWith('#')) return;

    event.preventDefault();
    const url = anchor.href;

    if (/^file:\/\//i.test(url) || /^file:\/\//i.test(href)) {
      const linea = /#L(\d+)(?:-L?\d+)?$/i.exec(href)?.[1];
      let ruta = decodeURIComponent(href.replace(/^file:\/\/\/?/i, '').replace(/#.*$/, ''));
      // file:///C:/... llega como /C:/... en Windows.
      if (/^\/[A-Za-z]:[\\/]/.test(ruta)) ruta = ruta.slice(1);
      void openInEditor(ruta, linea ? Number(linea) : undefined);
      return;
    }

    if (ui.prefs.openLinksIn === 'Built-in Browser') {
      window.api.openBrowser(url);
    } else {
      window.api.openExternal(url);
    }
  });

  // Iconos reales de la interfaz analizada.
  for (const node of document.querySelectorAll('[data-icon]')) {
    node.innerHTML = window.Icon(node.dataset.icon, 16);
  }

  selectOverviewView(ui.overviewView);
  updateEmptyState();
  updateSendState();
  els.input.focus();
}

function basename(path) {
  if (!path) return 'No Project';
  const parts = String(path).split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

/** Etiqueta del selector de proyecto, también para lectores de pantalla. */
function actualizarEtiquetaProyecto(texto) {
  const inline = document.getElementById('project-inline-label');
  if (inline) inline.textContent = texto;
  const trigger = document.getElementById('btn-project-selector-inline');
  if (trigger) trigger.setAttribute('aria-label', `Select project, current: ${texto}`);
}

boot();
