/**
 * Traducciones de la interfaz.
 *
 * Cada entrada lleva el texto en inglés y en español. El motor busca por
 * cualquiera de los dos y devuelve el del idioma activo; así no hay que
 * reescribir cada cadena fuente ni mantener claves inventadas.
 */
window.I18N_STRINGS = [
  // --- Núcleo y ajustes generales ---
  { en: 'Settings', es: 'Ajustes' },
  { en: 'Settings…', es: 'Ajustes…' },
  { en: 'New Conversation', es: 'Nueva conversación' },
  { en: 'Workspace', es: 'Espacio de trabajo' },
  { en: 'General', es: 'General' },
  { en: 'Language', es: 'Idioma' },
  { en: 'Interface language.', es: 'Idioma de la interfaz.' },
  { en: 'Interface Layout', es: 'Disposición de la interfaz' },
  { en: 'Subagent wait', es: 'Espera de subagentes' },
  { en: 'How long the turn waits for parallel subagents before merging what arrived.', es: 'Cuánto espera el turno a los subagentes en paralelo antes de fusionar lo que haya llegado.' },
  { en: '1 minute', es: '1 minuto' },
  { en: '2 minutes', es: '2 minutos' },
  { en: '3 minutes', es: '3 minutos' },
  { en: '5 minutes', es: '5 minutos' },
  { en: 'No limit', es: 'Sin límite' },
  { en: 'Knowledge Work', es: 'Trabajo de conocimiento' },
  { en: 'Software Engineering', es: 'Ingeniería de software' },
  { en: 'Simplified interface for research, writing, and everyday tasks.', es: 'Interfaz sencilla para investigación, redacción y tareas cotidianas.' },
  { en: 'Full interface for coding, developer tools, and managing agents.', es: 'Interfaz completa para código, herramientas de desarrollo y agentes.' },
  { en: 'Auto', es: 'Automático' },
  { en: 'English', es: 'English' },
  { en: 'Español', es: 'Español' },
  { en: 'Follows the system language.', es: 'Sigue el idioma del sistema.' },

  // --- Barra de título y menús ---
  { en: 'View', es: 'Ver' },
  { en: 'Window', es: 'Ventana' },
  { en: 'Minimize', es: 'Minimizar' },
  { en: 'Maximize', es: 'Maximizar' },
  { en: 'Maximize or restore', es: 'Maximizar o restaurar' },
  { en: 'Close', es: 'Cerrar' },
  { en: 'Quit', es: 'Salir' },
  { en: 'Open Folder…', es: 'Abrir carpeta…' },
  { en: 'Reload', es: 'Recargar' },
  { en: 'Reload window', es: 'Recargar ventana' },
  { en: 'Models…', es: 'Modelos…' },
  { en: 'Appearance…', es: 'Apariencia…' },
  { en: 'Notifications…', es: 'Notificaciones…' },
  { en: 'Zoom In', es: 'Acercar' },
  { en: 'Zoom Out', es: 'Alejar' },
  { en: 'Actual Size', es: 'Tamaño real' },
  { en: 'Developer Tools', es: 'Herramientas de desarrollo' },
  { en: 'Toggle Sidebar', es: 'Mostrar u ocultar barra lateral' },
  { en: 'Toggle Terminal', es: 'Mostrar u ocultar terminal' },
  { en: 'Toggle Overview Panel', es: 'Mostrar u ocultar panel de resumen' },
  { en: 'Toggle Auxiliary Pane', es: 'Mostrar u ocultar panel auxiliar' },
  { en: 'Search Conversations', es: 'Buscar conversaciones' },
  { en: 'Search conversations…', es: 'Buscar conversaciones…' },
  { en: 'Close notice', es: 'Cerrar aviso' },
  { en: 'More actions', es: 'Más acciones' },
  { en: 'Turns', es: 'Turnos' },

  // --- Barra lateral ---
  { en: 'Go Back', es: 'Ir atrás' },
  { en: 'Go Forward', es: 'Ir adelante' },
  { en: 'Automations', es: 'Automatizaciones' },
  { en: 'Customizations', es: 'Personalizaciones' },
  { en: 'Projects', es: 'Proyectos' },
  { en: 'Conversations', es: 'Conversaciones' },
  { en: 'Display Options', es: 'Opciones de visualización' },
  { en: 'Create New Project', es: 'Crear proyecto' },
  { en: 'No Project', es: 'Sin proyecto' },
  { en: 'No conversations', es: 'Sin conversaciones' },
  { en: 'No results', es: 'Sin resultados' },
  { en: 'Options', es: 'Opciones' },
  { en: 'Open', es: 'Abrir' },
  { en: 'Delete conversation', es: 'Borrar conversación' },
  { en: 'Show all projects', es: 'Mostrar todos los proyectos' },
  { en: 'Hide archived', es: 'Ocultar archivados' },
  { en: 'Workspace settings', es: 'Ajustes del workspace' },
  { en: 'now', es: 'ahora' },

  // --- Automations y tareas programadas ---
  { en: 'Create with Prompt', es: 'Crear con prompt' },
  { en: 'New', es: 'Nuevo' },
  { en: 'No automations yet', es: 'Todavía no hay automatizaciones' },
  {
    en: "Run a prompt on a schedule, like a morning summary of yesterday's changes. Runs show up here.",
    es: 'Ejecuta un prompt con una programación, como un resumen matinal de los cambios de ayer. Las ejecuciones aparecen aquí.',
  },
  { en: '(no text)', es: '(sin texto)' },
  { en: 'recurring', es: 'recurrente' },
  { en: 'failed', es: 'falló' },
  { en: 'ran', es: 'ejecutada' },
  { en: 'No scheduled tasks.', es: 'Sin tareas programadas.' },
  { en: 'Run', es: 'Ejecutar' },
  { en: 'Enable', es: 'Activar' },
  { en: 'Pause', es: 'Pausar' },
  { en: 'Delete', es: 'Borrar' },
  { en: 'delete', es: 'borrar' },
  { en: 'restore', es: 'restaurar' },
  { en: 'What should the agent do', es: 'Qué debe hacer el agente' },
  { en: 'Every', es: 'Cada' },
  { en: 'minutes', es: 'minutos' },
  { en: 'hours', es: 'horas' },
  { en: 'Add', es: 'Añadir' },

  // --- Hilo y mensajes ---
  { en: 'Copy', es: 'Copiar' },
  { en: 'Undo to this point', es: 'Deshacer hasta este punto' },
  { en: 'There is nothing to undo up to that step.', es: 'No hay nada que deshacer hasta ese paso.' },
  { en: 'Could not undo to that step.', es: 'No se pudo deshacer hasta ese paso.' },
  { en: 'Undone to that point.', es: 'Deshecho hasta ese punto.' },
  { en: 'Undo to here', es: 'Deshacer hasta aquí' },
  { en: 'new', es: 'nuevo' },
  { en: 'Reject', es: 'Rechazar' },
  { en: 'Apply', es: 'Aplicar' },
  { en: 'Applied', es: 'Aplicado' },
  { en: 'Rejected', es: 'Rechazado' },
  { en: 'just now', es: 'ahora mismo' },
  { en: 'Thinking', es: 'Pensando' },
  { en: 'Good response', es: 'Buena respuesta' },
  { en: 'Bad response', es: 'Mala respuesta' },
  { en: 'Stop', es: 'Detener' },
  { en: 'Send', es: 'Enviar' },
  { en: 'Send message', es: 'Enviar mensaje' },
  { en: 'The agent is working…', es: 'El agente está trabajando…' },
  { en: 'Turn ended with errors.', es: 'El turno terminó con errores.' },
  { en: 'A background task finished. The agent continues.', es: 'Una tarea de fondo terminó. El agente continúa.' },
  {
    en: 'A background task finished. The agent will resume it when done.',
    es: 'Una tarea de fondo terminó. El agente la retomará al acabar.',
  },
  { en: 'Generated image', es: 'Imagen generada' },
  { en: 'Generating image...', es: 'Generando imagen...' },
  { en: 'Browser capture', es: 'Captura del navegador' },
  { en: 'Open capture', es: 'Abrir captura' },
  { en: 'No changes pending review.', es: 'Sin cambios pendientes de revisar.' },
  { en: 'No file open.', es: 'Ningún fichero abierto.' },
  { en: 'The built-in browser is not available yet.', es: 'El navegador integrado aún no está disponible.' },

  // --- Plan, preguntas y revisión ---
  { en: 'Plan rejected', es: 'Plan rechazado' },
  { en: 'What will be done', es: 'Qué se hará' },
  { en: 'Detail (optional)', es: 'Detalle (opcional)' },
  { en: 'Collapse', es: 'Plegar' },
  { en: 'I need a decision', es: 'Necesito una decisión' },
  { en: 'Other (write your answer)', es: 'Otro (escribe tu respuesta)' },
  { en: 'Type your answer', es: 'Escribe tu respuesta' },
  { en: 'Dictate', es: 'Dictar' },
  { en: 'Skip', es: 'Omitir' },
  { en: 'Submit ⏎', es: 'Enviar ⏎' },
  { en: 'Review', es: 'Revisar' },
  {
    en: 'You can edit the steps before approving. The agent will receive the plan exactly as you leave it.',
    es: 'Puedes editar los pasos antes de aprobar. El agente recibirá el plan tal como lo dejes.',
  },

  // --- Composer y popovers ---
  { en: 'Ask anything, @ to mention, / for actions', es: 'Pregunta lo que sea, @ para mencionar, / para acciones' },
  { en: 'Add context', es: 'Añadir contexto' },
  { en: 'Record voice memo', es: 'Grabar nota de voz' },
  { en: 'Model', es: 'Modelo' },
  { en: 'Commands', es: 'Comandos' },
  { en: 'Files', es: 'Ficheros' },
  { en: 'no model', es: 'sin modelo' },
  { en: 'Low', es: 'Bajo' },
  { en: 'Medium', es: 'Medio' },
  { en: 'High', es: 'Alto' },
  { en: 'Usage: /browser <url>', es: 'Uso: /browser <url>' },
  { en: 'This system does not offer speech recognition.', es: 'Este sistema no ofrece reconocimiento de voz.' },
  { en: 'Ask for a numbered plan before changing code', es: 'Pedir un plan numerado antes de cambiar código' },
  { en: 'Start a new conversation', es: 'Empezar una conversación nueva' },
  { en: 'Open settings', es: 'Abrir los ajustes' },
  { en: 'Open a URL in the built-in browser', es: 'Abrir una URL en el navegador integrado' },
  { en: 'Stop the current run', es: 'Detener la ejecución en curso' },
  { en: 'See all commands', es: 'Ver todos los comandos' },
  { en: 'No commands match.', es: 'Ningún comando coincide.' },

  // --- Paleta de comandos ---
  { en: 'Run the tests', es: 'Ejecutar los tests' },
  { en: 'Could not run the tests.', es: 'No se pudieron ejecutar los tests.' },
  { en: 'Open file…', es: 'Abrir fichero…' },
  { en: 'Attach file to message', es: 'Adjuntar fichero al mensaje' },
  { en: 'Attach file…', es: 'Adjuntar fichero…' },
  { en: 'Mention from project', es: 'Mencionar del proyecto' },
  { en: 'Add image…', es: 'Añadir imagen…' },
  { en: 'Attach image', es: 'Adjuntar imagen' },
  { en: 'Images', es: 'Imágenes' },
  { en: 'Rebuild index', es: 'Reconstruir índice' },
  { en: 'Change model', es: 'Cambiar de modelo' },
  { en: 'New line', es: 'Nueva línea' },
  { en: 'Close settings', es: 'Cerrar ajustes' },

  // --- Barra lateral derecha / panel auxiliar ---
  { en: 'Open File', es: 'Abrir fichero' },
  { en: 'Open file', es: 'Abrir fichero' },
  { en: 'Browser', es: 'Navegador' },
  { en: 'New Tab', es: 'Nueva pestaña' },
  { en: 'Split Editor', es: 'Dividir editor' },
  { en: 'Search for files, commands or tools', es: 'Buscar ficheros, comandos o herramientas' },
  { en: 'Search or enter a URL', es: 'Busca o escribe una URL' },
  { en: 'New terminal', es: 'Nueva terminal' },
  { en: 'Back to list', es: 'Volver a la lista' },
  { en: 'Interrupt', es: 'Interrumpir' },
  { en: 'Maximize panel', es: 'Maximizar panel' },
  { en: 'Close panel', es: 'Cerrar panel' },
  { en: 'Terminal options', es: 'Opciones de terminal' },
  { en: 'Type a command…', es: 'Escribe un comando…' },
  { en: 'Terminals', es: 'Terminales' },
  { en: 'Close this terminal', es: 'Cerrar esta terminal' },
  { en: 'No integrated terminal', es: 'Sin terminal integrada' },
  { en: 'running', es: 'activa' },

  // --- Editor y explorador ---
  { en: 'Unsaved', es: 'sin guardar' },
  { en: 'Saved', es: 'guardado' },
  { en: 'no LSP', es: 'sin LSP' },
  { en: 'No LSP server for this file.', es: 'Sin servidor LSP para este fichero.' },
  { en: 'No quick fixes on this line.', es: 'No hay quick fixes en esta línea.' },
  { en: 'Action applied.', es: 'Acción aplicada.' },
  { en: 'Could not apply.', es: 'No se pudo aplicar.' },
  { en: 'Monaco is not available.', es: 'Monaco no está disponible.' },
  { en: 'No files', es: 'Sin ficheros' },
  { en: 'not built', es: 'sin construir' },
  { en: 'not available', es: 'no disponible' },
  { en: 'indexing…', es: 'indexando…' },
  { en: 'calculating embeddings…', es: 'calculando embeddings…' },

  // --- Overview: git, índice, terminal ---
  { en: 'Overview', es: 'Resumen' },
  { en: 'Customize Sections', es: 'Personalizar secciones' },
  { en: 'Extensions', es: 'Extensiones' },
  { en: 'Source Control', es: 'Control de código fuente' },
  { en: 'Abort merge', es: 'Abortar fusión' },
  { en: 'Commit message', es: 'Mensaje de commit' },
  { en: 'History', es: 'Historial' },
  { en: 'Explorer', es: 'Explorador' },
  { en: 'Index', es: 'Índice' },
  { en: 'Precompute embeddings', es: 'Precalcular embeddings' },
  { en: 'No files yet', es: 'Sin archivos todavía' },
  { en: 'edited', es: 'editado' },
  { en: 'read', es: 'leído' },
  { en: 'No MCP plugins', es: 'Sin plugins MCP' },
  { en: 'on', es: 'activado' },
  { en: 'off', es: 'desactivado' },
  { en: 'no remote', es: 'sin remoto' },
  { en: 'Up to date', es: 'al día' },
  { en: 'No changes', es: 'Sin cambios' },
  { en: 'modified', es: 'modificado' },
  { en: 'added', es: 'añadido' },
  { en: 'deleted', es: 'borrado' },
  { en: 'renamed', es: 'renombrado' },
  { en: 'untracked', es: 'sin seguimiento' },
  { en: 'Ours', es: 'Mía' },
  { en: 'Theirs', es: 'Suya' },
  { en: 'Keep the local version', es: 'Quedarse con la versión local' },
  { en: 'Keep the remote version', es: 'Quedarse con la del remoto' },
  { en: 'Unstage', es: 'Quitar del índice' },
  { en: 'Stage', es: 'Añadir al índice' },
  { en: 'Stage this hunk', es: 'Preparar este bloque' },
  { en: 'No commits', es: 'Sin commits' },
  { en: 'Changes staged', es: 'Cambios en el índice' },
  {
    en: 'Unstaged changes — press + on a block to stage it',
    es: 'Cambios sin preparar — pulsa + en un bloque para prepararlo',
  },
  { en: 'No differences to show.', es: 'Sin diferencias que mostrar.' },
  { en: 'Hunk removed from index.', es: 'Bloque quitado del índice.' },
  { en: 'Hunk staged.', es: 'Bloque preparado en el índice.' },
  { en: 'Type a commit message.', es: 'Escribe un mensaje de commit.' },
  { en: 'Commit created.', es: 'Commit creado.' },
  { en: 'could not get the diff', es: 'no se pudo obtener el diff' },
  { en: '(no branch)', es: '(sin rama)' },
  { en: 'Fetch completed.', es: 'Fetch completado.' },
  { en: 'Pull completed.', es: 'Pull completado.' },
  { en: 'Push completed.', es: 'Push completado.' },
  { en: 'Merge aborted.', es: 'Fusión abortada.' },

  // --- Buscar y reemplazar ---
  { en: 'Find and replace', es: 'Buscar y reemplazar' },
  { en: 'Search in project', es: 'Buscar en el proyecto' },
  { en: 'Match case', es: 'Distinguir mayúsculas' },
  { en: 'Whole word', es: 'Palabra completa' },
  { en: 'Regular expression', es: 'Expresión regular' },
  { en: 'Replace with', es: 'Reemplazar por' },
  { en: 'Replace all', es: 'Reemplazar todo' },

  // --- Modales de nombre y reversión ---
  { en: 'Rename conversation', es: 'Renombrar conversación' },
  { en: 'Rename conversation…', es: 'Renombrar conversación…' },
  { en: 'Archive conversation', es: 'Archivar conversación' },
  { en: 'Export as Markdown', es: 'Exportar como Markdown' },
  { en: 'Cancel', es: 'Cancelar' },
  { en: 'Undo', es: 'Deshacer' },
  { en: 'Save', es: 'Guardar' },
  { en: 'Rename', es: 'Renombrar' },
  { en: 'Accept', es: 'Aceptar' },

  // --- Secciones de ajustes: cabeceras ---
  { en: 'Application', es: 'Aplicación' },
  { en: 'Appearance', es: 'Apariencia' },
  { en: 'Shortcuts', es: 'Atajos' },
  { en: 'Notifications', es: 'Notificaciones' },
  { en: 'Models', es: 'Modelos' },
  { en: 'Models & Usage', es: 'Modelos y uso' },
  { en: 'Workspace rules', es: 'Reglas del workspace' },
  {
    en: 'AGENTS.md and .agents/rules/*.md go into the system prompt with their own budget. They are read at every turn.',
    es: 'AGENTS.md y .agents/rules/*.md entran al prompt de sistema con su propio presupuesto. Se leen en cada turno.',
  },
  { en: 'Load workspace rules', es: 'Cargar reglas del workspace' },
  { en: "If off, the agent won't see the project's conventions.", es: 'Si está apagado, el agente no ve las convenciones del proyecto.' },
  { en: 'Budget', es: 'Presupuesto' },
  {
    en: 'Tokens reserved for rules. What does not fit is replaced by the file path.',
    es: 'Tokens reservados para las reglas. Lo que no cabe se sustituye por la ruta del fichero.',
  },
  { en: 'Extended thinking', es: 'Pensamiento extendido' },
  { en: 'Think', es: 'Pensar' },
  { en: 'Give Feedback', es: 'Enviar comentarios' },
  { en: 'Account', es: 'Cuenta' },
  { en: 'Show All', es: 'Mostrar todos' },
  { en: 'Show Less', es: 'Mostrar menos' },
  { en: 'Not in Project', es: 'Fuera de proyecto' },
  { en: 'Local user', es: 'Usuario local' },
  { en: 'no account', es: 'sin cuenta' },
  { en: 'Back', es: 'Volver' },
  { en: 'Manage project folders and settings.', es: 'Gestiona las carpetas y los ajustes del proyecto.' },
  {
    en: 'Configure agent execution, queued message delivery, and permissions.',
    es: 'Configura la ejecución del agente, la entrega de mensajes en cola y los permisos.',
  },
  { en: 'Account and plan information.', es: 'Información de la cuenta y del plan.' },
  {
    en: 'Configure the visual theme and presentation preferences.',
    es: 'Configura el tema visual y las preferencias de presentación.',
  },
  { en: 'Manage notification preferences.', es: 'Gestiona las preferencias de notificación.' },
  { en: 'Choose the provider and model the agent uses.', es: 'Elige el proveedor y el modelo que usa el agente.' },
  { en: 'Settings for conversations outside a project.', es: 'Ajustes para las conversaciones que no están dentro de un proyecto.' },
  { en: 'Tell us what is broken or missing.', es: 'Cuéntanos qué falla o qué falta.' },
  {
    en: 'Configure default behaviors, skills and MCP servers.',
    es: 'Configura comportamientos por defecto, skills y servidores MCP.',
  },
  {
    en: 'Workspace, remote control and application behavior.',
    es: 'Espacio de trabajo, control remoto y comportamiento de la aplicación.',
  },
  { en: 'Connect your account to generate images with Flow.', es: 'Conecta tu cuenta para generar imágenes con Flow.' },
  {
    en: 'Developer-only tools. These settings are stored locally and do not affect other users.',
    es: 'Herramientas solo para desarrollo. Estos ajustes se guardan en local y no afectan a otros usuarios.',
  },
  { en: 'Available keyboard shortcuts.', es: 'Atajos de teclado disponibles.' },
  { en: 'Tool Permissions', es: 'Permisos por herramienta' },
  {
    en: 'Per-tool permissions. They take priority over the global preset.',
    es: 'Permisos por herramienta. Tienen prioridad sobre el preset global.',
  },
  { en: 'Network Access Rules', es: 'Reglas de acceso a la red' },
  {
    en: 'Allowed and denied domains for reading and browsing.',
    es: 'Dominios permitidos y denegados para lectura y navegación.',
  },
  { en: 'MCP servers connected at the start of each turn.', es: 'Servidores MCP que se conectan al arrancar cada turno.' },

  // --- Ajustes: General ---
  { en: 'Global Permissions', es: 'Permisos globales' },
  {
    en: 'Configure global allowed and denied resource permissions. Learn more.',
    es: 'Configura los permisos globales de recursos permitidos y denegados. Más información.',
  },
  { en: 'Permission Preset', es: 'Preset de permisos' },
  { en: 'Controls the actions the agent can take.', es: 'Controla las acciones que puede realizar el agente.' },
  { en: 'Request Review', es: 'Pedir revisión' },
  { en: 'Every command requires approval.', es: 'Cada comando requiere aprobación.' },
  { en: 'Default', es: 'Predeterminado' },
  { en: 'Ask before sensitive operations.', es: 'Pregunta antes de las operaciones sensibles.' },
  { en: 'Auto (Preview)', es: 'Automático (vista previa)' },
  { en: 'Decide alone whether the command may run.', es: 'Decide por su cuenta si el comando puede ejecutarse.' },
  { en: 'Run without restrictions.', es: 'Ejecuta sin restricciones.' },
  { en: 'Modify permissions for file, terminal, and MCP tools.', es: 'Modifica los permisos de las herramientas de ficheros, terminal y MCP.' },
  { en: 'Configure allowed and denied URLs for reading.', es: 'Configura las URL permitidas y denegadas para lectura.' },
  { en: 'Agent Behavior', es: 'Comportamiento del agente' },
  { en: 'Plan Review Policy', es: 'Política de revisión del plan' },
  { en: 'Whether the agent asks you to review its documents.', es: 'Si el agente te pide revisar sus documentos.' },
  { en: 'Always Ask', es: 'Preguntar siempre' },
  { en: 'Always Allow', es: 'Permitir siempre' },
  { en: 'Always Review', es: 'Revisar siempre' },
  { en: 'Never', es: 'Nunca' },
  { en: 'Execution', es: 'Ejecución' },
  { en: 'Queued Messages', es: 'Mensajes en cola' },
  { en: 'Configure when follow-up messages are sent.', es: 'Configura cuándo se envían los mensajes de seguimiento.' },
  { en: 'Queue', es: 'En cola' },
  { en: 'Send Immediately', es: 'Enviar de inmediato' },
  { en: 'Built-in Browser', es: 'Navegador integrado' },
  {
    en: 'Configure link opening and built-in browser preferences.',
    es: 'Configura la apertura de enlaces y las preferencias del navegador integrado.',
  },
  { en: 'Open Links In', es: 'Abrir enlaces en' },
  { en: 'Where links open by default when clicked.', es: 'Dónde se abren los enlaces al pulsarlos.' },
  { en: 'Choose where links open by default when clicked.', es: 'Elige dónde se abren los enlaces al pulsarlos.' },
  { en: 'External Browser', es: 'Navegador externo' },
  { en: 'Download Location', es: 'Carpeta de descargas' },
  {
    en: 'Folder where files downloaded in the built-in browser are saved.',
    es: 'Carpeta donde se guardan los ficheros descargados en el navegador integrado.',
  },
  { en: 'Browsing History', es: 'Historial de navegación' },
  {
    en: 'Clear visited URLs and autocomplete suggestions from the built-in browser.',
    es: 'Borra las URL visitadas y las sugerencias del navegador integrado.',
  },
  { en: 'Clear', es: 'Borrar' },
  { en: 'Change…', es: 'Cambiar…' },
  { en: 'Forward', es: 'Adelante' },
  {
    en: 'Configure built-in browser, link opening, and browser subagent preferences.',
    es: 'Configura el navegador integrado, la apertura de enlaces y el subagente de navegador.',
  },
  {
    en: 'Configure allowed and denied URLs for the browser subagent. It runs in the built-in browser, so no separate browser install is needed.',
    es: 'Configura las URL permitidas y denegadas del subagente de navegador. Usa el navegador integrado, así que no hace falta instalar otro.',
  },
  { en: 'Enter a URL (e.g. http://localhost:8080)', es: 'Escribe una URL (p. ej. http://localhost:8080)' },
  { en: 'Browser Subagent', es: 'Subagente de navegador' },
  {
    en: 'The browser subagent requires Google Chrome to be installed. Invoke it by typing /browser in the input box.',
    es: 'El subagente de navegador requiere Google Chrome instalado. Se invoca escribiendo /browser en el cuadro de entrada.',
  },
  { en: 'Browser Actuation Rules', es: 'Reglas de actuación del navegador' },
  {
    en: 'Shares the network rules: the built-in browser only opens allowed domains.',
    es: 'Comparte las reglas de red: el navegador integrado solo abre dominios permitidos.',
  },
  { en: 'Edit', es: 'Editar' },

  // --- Ajustes: Cuenta ---
  { en: 'Local profile. Used to greet you in the prompt and shown in the sidebar.', es: 'Perfil local. Se usa para saludarte en el prompt y para mostrarlo en la barra lateral.' },
  { en: 'Name', es: 'Nombre' },
  { en: 'The agent uses it to address you.', es: 'El agente lo usa para dirigirse a ti.' },
  { en: 'Email', es: 'Correo electrónico' },
  { en: 'Informational only, stored on your machine.', es: 'Solo informativo, se guarda en tu equipo.' },
  { en: 'No plan attached: you use your own API keys or local models.', es: 'Sin plan asociado: usas tus propias claves de API o modelos locales.' },
  { en: 'Developer', es: 'Desarrollador' },
  { en: 'Development tools and advanced sandbox.', es: 'Herramientas de desarrollo y sandbox avanzado.' },
  { en: 'Your name', es: 'Tu nombre' },
  { en: 'you@example.com', es: 'tu@correo.com' },

  // --- Ajustes: Apariencia ---
  { en: 'Interface contrast. Applied instantly.', es: 'Contraste de la interfaz. Se aplica al instante.' },
  { en: 'Theme', es: 'Tema' },
  { en: 'System', es: 'Sistema' },
  { en: 'Contrast', es: 'Contraste' },
  { en: 'Dark', es: 'Oscuro' },
  { en: 'Default Dark', es: 'Oscuro predeterminado' },
  { en: 'Legacy Dark', es: 'Oscuro clásico' },
  { en: 'Light', es: 'Claro' },
  { en: 'Default Light', es: 'Claro predeterminado' },
  { en: 'Legacy Light', es: 'Claro clásico' },
  { en: 'Light Theme', es: 'Tema claro' },
  { en: 'Dark or light. Applied instantly.', es: 'Oscuro o claro. Se aplica al instante.' },
  { en: 'Interface contrast.', es: 'Contraste de la interfaz.' },
  { en: 'Strong', es: 'Fuerte' },
  { en: 'Dark Theme', es: 'Tema oscuro' },
  { en: 'Dark theme colors. Applied live and saved.', es: 'Colores del tema oscuro. Se aplican en vivo y se guardan.' },
  { en: 'Light theme colors. Applied live and saved.', es: 'Colores del tema claro. Se aplican en vivo y se guardan.' },
  { en: 'Preset', es: 'Preajuste' },
  { en: 'Predefined combination.', es: 'Combinación predefinida.' },
  { en: 'Background', es: 'Fondo' },
  { en: 'Canvas background.', es: 'Fondo del lienzo.' },
  { en: 'Foreground', es: 'Primer plano' },
  { en: 'Text color.', es: 'Color del texto.' },
  { en: 'Accent', es: 'Acento' },
  { en: 'Accent and focus color.', es: 'Color de acento y foco.' },
  { en: 'Code Preview', es: 'Vista previa de código' },
  { en: 'Reset to preset', es: 'Restablecer al preajuste' },
  { en: 'Reset colors', es: 'Restablecer colores' },
  { en: 'Restore the default palette.', es: 'Vuelve a la paleta por defecto.' },
  { en: 'Reset', es: 'Restablecer' },

  // --- Ajustes: Notificaciones ---
  { en: 'Enable Notifications for Agent', es: 'Activar notificaciones del agente' },
  {
    en: 'Show system notifications when your action is required or the agent finishes.',
    es: 'Muestra notificaciones del sistema cuando se requiere tu acción o el agente termina.',
  },
  { en: 'Sound', es: 'Sonido' },
  { en: 'Enable Sounds for Agent', es: 'Activar sonidos del agente' },
  {
    en: 'Play a sound when your action is required or the agent finishes.',
    es: 'Reproduce un sonido cuando se requiere tu acción o el agente termina.',
  },
  { en: 'Volume', es: 'Volumen' },
  { en: 'Agent sound volume.', es: 'Volumen de los sonidos del agente.' },

  // --- Ajustes: Modelos ---
  { en: 'no key', es: 'sin clave' },
  { en: 'no models', es: 'sin modelos' },
  { en: 'Provider', es: 'Proveedor' },
  { en: 'custom', es: 'personalizado' },
  { en: 'remote', es: 'remoto' },
  { en: 'API key', es: 'Clave de API' },
  { en: 'Saved on this machine (settings.json).', es: 'Guardada en este equipo (settings.json).' },
  {
    en: 'Paste your key. It is saved in settings.json on your machine.',
    es: 'Pega tu clave. Se guarda en settings.json de tu equipo.',
  },
  {
    en: 'Optional. Only if you enabled "Require Authentication" on the local server.',
    es: 'Opcional. Solo si activaste «Require Authentication» en el servidor local.',
  },
  { en: 'Endpoint URL', es: 'URL del endpoint' },
  { en: 'Choose a provider', es: 'Elige un proveedor' },
  { en: 'Proceed', es: 'Continuar' },
  { en: 'Keyboard shortcuts', es: 'Atajos de teclado' },
  {
    en: 'Keyboard shortcuts for quick navigation and control.',
    es: 'Atajos de teclado para navegar y controlar la app.',
  },
  { en: 'Detection', es: 'Detección' },
  { en: 'Detect again', es: 'Detectar de nuevo' },
  { en: 'Close tab', es: 'Cerrar pestaña' },
  {
    en: 'Using a saved key shared with the other OpenCode provider.',
    es: 'Usando una clave guardada compartida con el otro proveedor de OpenCode.',
  },
  { en: 'not running', es: 'no está en marcha' },
  { en: 'could not connect', es: 'no se pudo conectar' },
  { en: 'reports no models', es: 'no reporta modelos' },
  { en: 'set the endpoint URL', es: 'configura la URL del endpoint' },
  { en: 'missing the API key', es: 'falta la clave de API' },
  {
    en: 'Base without trailing slash, for example https://api.example.com/v1',
    es: 'Base sin barra final, por ejemplo https://api.ejemplo.com/v1',
  },
  { en: 'Detected automatically from the provider.', es: 'Se detecta automáticamente desde el proveedor.' },
  { en: 'Model provider. Paste your key here or define it in the environment.', es: 'Proveedor de modelo. Pega tu clave aquí o defínela en el entorno.' },
  { en: 'No provider available.', es: 'Ningún proveedor disponible.' },
  { en: 'Semantic index', es: 'Índice semántico' },
  { en: 'What computes the vectors for code search.', es: 'Con qué se calculan los vectores para la búsqueda de código.' },
  { en: 'Embeddings provider', es: 'Proveedor de embeddings' },
  { en: 'Ollama is local and free; OpenAI and Gemini give better quality.', es: 'Ollama es local y gratis; OpenAI y Gemini dan mejor calidad.' },
  { en: "Empty uses each provider's default.", es: 'Vacío usa el predeterminado de cada proveedor.' },
  { en: "Empty uses the provider's. Useful for compatible servers.", es: 'Vacío usa la del proveedor. Útil para servidores compatibles.' },
  { en: 'Semantic weight', es: 'Peso semántico' },
  { en: '0 uses text matching only, 1 similarity only. Default 0.45.', es: '0 usa solo coincidencia de texto, 1 solo similitud. Por defecto 0,45.' },
  { en: 'Precompute vectors', es: 'Precalcular vectores' },
  { en: 'Walks the index and computes missing embeddings.', es: 'Recorre el índice y calcula los embeddings que falten.' },
  { en: 'Precompute', es: 'Precalcular' },
  { en: 'Could not compute the vectors.', es: 'No se pudieron calcular los vectores.' },
  {
    en: 'Ollama did not respond: check that it is running and that the embeddings model exists.',
    es: 'Ollama no respondió: revisa que esté corriendo y que el modelo de embeddings exista.',
  },
  { en: 'No providers available. Start Ollama locally (ollama serve) or set a key in the environment: OPENAI_API_KEY, ANTHROPIC_API_KEY or GEMINI_API_KEY.', es: 'No hay proveedores disponibles. Arranca Ollama en local (ollama serve) o define una clave en el entorno: OPENAI_API_KEY, ANTHROPIC_API_KEY o GEMINI_API_KEY.' },
  {
    en: 'No provider available. Set a key or start Ollama.',
    es: 'No hay ningún proveedor disponible. Configura una clave o arranca Ollama.',
  },
  { en: 'Open models', es: 'Abrir modelos' },
  {
    en: 'The saved provider is no longer available. Choose another model.',
    es: 'El proveedor guardado ya no está disponible. Elige otro modelo.',
  },
  { en: 'Choose model', es: 'Elegir modelo' },

  // --- Ajustes: Personalizaciones ---
  { en: 'Instructions added to the prompt when enabled.', es: 'Instrucciones que se añaden al prompt cuando están activadas.' },
  { en: 'No skills', es: 'Sin skills' },
  { en: 'No skills available.', es: 'No hay skills disponibles.' },
  { en: 'MCP servers the agent connects each turn.', es: 'Servidores MCP que el agente conecta en cada turno.' },
  { en: 'No plugins', es: 'Sin plugins' },
  { en: 'Add an MCP server to get started.', es: 'Añade un servidor MCP para empezar.' },
  { en: 'Add plugin', es: 'Añadir plugin' },
  { en: 'Manage the list of MCP servers.', es: 'Gestiona la lista de servidores MCP.' },

  // --- Ajustes: Aplicación ---
  { en: 'Folder the agent works in.', es: 'Carpeta sobre la que trabaja el agente.' },
  { en: 'Change', es: 'Cambiar' },
  { en: 'Current path', es: 'Ruta actual' },
  { en: 'Remote Control', es: 'Control remoto' },
  { en: 'Local HTTP server to send prompts from outside.', es: 'Servidor HTTP local para enviar prompts desde fuera.' },
  { en: 'Status', es: 'Estado' },
  { en: 'Stopped.', es: 'Detenido.' },
  { en: 'active', es: 'activo' },
  { en: 'stopped', es: 'detenido' },
  { en: 'Port', es: 'Puerto' },
  { en: 'Local server port.', es: 'Puerto local del servidor.' },
  { en: 'If set, the client must send it in the token field.', es: 'Si lo defines, el cliente debe enviarlo en el campo token.' },
  { en: 'Stop server', es: 'Detener servidor' },
  { en: 'Start server', es: 'Iniciar servidor' },
  { en: 'Listens only on 127.0.0.1.', es: 'Escucha solo en 127.0.0.1.' },
  { en: 'Start', es: 'Iniciar' },
  { en: 'optional', es: 'opcional' },

  // --- Ajustes: Google ---
  { en: 'Google account', es: 'Cuenta de Google' },
  { en: 'Required to generate images with Flow.', es: 'Necesaria para generar imágenes con Flow.' },
  { en: 'Connected', es: 'Conectada' },
  { en: 'Connected', es: 'Conectado' },
  { en: 'Not connected', es: 'Sin conectar' },
  { en: 'Disconnect', es: 'Desconectar' },
  { en: 'Connect', es: 'Conectar' },
  { en: 'Sign in in the window that just opened.', es: 'Inicia sesión en la ventana que se ha abierto.' },
  { en: 'Google account connected successfully.', es: 'Cuenta de Google conectada correctamente.' },
  { en: 'Use my Chrome', es: 'Usar mi Chrome' },
  {
    en: 'Opens your Chrome with your session already signed in, without re-entering credentials.',
    es: 'Abre tu Chrome con su sesión ya iniciada, sin volver a meter credenciales.',
  },
  { en: 'Chrome not found', es: 'Chrome no encontrado' },
  { en: 'Chrome opened with your session. You can now generate images.', es: 'Chrome abierto con tu sesión. Ya puedes generar imágenes.' },
  { en: 'Could not open Chrome.', es: 'No se pudo abrir Chrome.' },
  { en: 'Image generation', es: 'Generación de imágenes' },
  {
    en: 'Google does not publish a Flow API, so the app drives it with its built-in browser using your session. It needs no keys and costs no money. If Google changes its interface, the tool may stop finding the controls.',
    es: 'Google no publica una API de Flow, así que la app lo maneja con su navegador integrado usando tu sesión. No necesita claves ni cuesta dinero. Si Google cambia su interfaz, la herramienta puede dejar de encontrar los controles.',
  },
  {
    en: 'Experimental: generates images with `generate_image`. Depends on the Flow interface; if Google changes it, it may stop working.',
    es: 'Experimental: genera imágenes con `generate_image`. Depende de la interfaz de Flow; si Google la cambia, puede dejar de funcionar.',
  },
  { en: 'Open Flow', es: 'Abrir Flow' },

  // --- Ajustes: Proyecto ---
  { en: 'Folders', es: 'Carpetas' },
  { en: 'Project', es: 'Proyecto' },
  { en: 'No project is open.', es: 'No hay ningún proyecto abierto.' },
  { en: 'Add Folder', es: 'Añadir carpeta' },
  { en: 'Switch project from the sidebar.', es: 'Cambia de proyecto desde la barra lateral.' },
  {
    en: 'The breakdown shows token usage of customizations: rules, skills and MCP. If the budget is exceeded, long rules become pointers and large customizations are excluded automatically.',
    es: 'El desglose muestra el uso de tokens de las personalizaciones: reglas, skills y MCP. Si se pasa del presupuesto, las reglas largas se convierten en punteros y las personalizaciones grandes se excluyen solas.',
  },
  { en: 'Token usage', es: 'Uso de tokens' },
  { en: 'No active customizations.', es: 'No hay personalizaciones activas.' },
  { en: 'Development tools, stored locally only.', es: 'Herramientas de desarrollo, guardadas solo en local.' },
  { en: 'This project has no skills of its own.', es: 'Este proyecto no tiene skills propias.' },
  { en: 'Danger Zone', es: 'Zona de peligro' },
  { en: 'Delete Project', es: 'Borrar proyecto' },
  { en: 'Deleting the project is not available from here.', es: 'Borrar el proyecto no está disponible desde aquí.' },

  // --- Ajustes: Developer ---
  { en: 'Security', es: 'Seguridad' },
  { en: 'Advanced agent and process sandbox controls.', es: 'Controles avanzados del agente y del sandbox de procesos.' },
  { en: 'Security Monitor', es: 'Monitor de seguridad' },
  {
    en: 'Scores each action from 0 to 10 before running it and blocks dangerous ones: mass deletions, exfiltration, credentials, disabling TLS, weakening tests.',
    es: 'Puntúa cada acción de 0 a 10 antes de ejecutarla y bloquea lo peligroso: borrados masivos, exfiltración, credenciales, desactivar TLS, debilitar tests.',
  },
  { en: 'Blocks anything scoring above the threshold.', es: 'Bloquea lo que puntúe por encima del umbral.' },
  { en: 'Asks before running anything doubtful.', es: 'Pregunta antes de ejecutar lo dudoso.' },
  { en: 'Uses the classifier to decide.', es: 'Usa el clasificador para decidir.' },
  { en: 'Does not review any action.', es: 'No revisa ninguna acción.' },
  { en: 'Workspace Sandbox', es: 'Sandbox del workspace' },
  {
    en: 'Restricts file paths to the workspace, sets the cwd for commands and removes credential environment variables. On Windows it adds a Job Object with memory, process and CPU limits that kills the tree on exit.',
    es: 'Restringe las rutas de fichero al workspace, fija el cwd de los comandos y quita del entorno las variables con credenciales. En Windows añade un Job Object con límites de memoria, procesos y CPU que termina el árbol al salir.',
  },
  { en: 'Sandbox Limits', es: 'Límites del sandbox' },
  {
    en: 'Process sandbox limits. On Windows a Job Object applies them; on Linux/macOS, ulimit. Enabled by "Workspace Sandbox".',
    es: 'Límites del sandbox de procesos. En Windows los aplica un Job Object; en Linux/macOS, ulimit. Se activan con «Workspace Sandbox».',
  },
  { en: 'Memory (MB)', es: 'Memoria (MB)' },
  { en: 'Maximum memory for the command and its children (Windows; omitted on POSIX).', es: 'Memoria máxima para el comando y sus hijos (Windows; en POSIX se omite).' },
  { en: 'Processes', es: 'Procesos' },
  { en: 'Maximum number of live processes in the tree.', es: 'Número máximo de procesos vivos del árbol.' },
  { en: 'CPU seconds', es: 'Segundos de CPU' },
  { en: 'Maximum CPU time before the tree is killed.', es: 'Tiempo de CPU máximo antes de terminar el árbol.' },
  { en: 'Debugging', es: 'Depuración' },
  { en: 'Show the system prompt', es: 'Mostrar el prompt del sistema' },
  { en: 'Adds the turn prompt to the thread, collapsed under its character count.', es: 'Añade al hilo el prompt del turno, plegado bajo su recuento de caracteres.' },
  { en: 'Show token usage per turn', es: 'Mostrar el uso de tokens por turno' },
  { en: 'Adds model input and output at the end of each response.', es: 'Añade entradas y salidas del modelo al pie de cada respuesta.' },
  { en: 'Trajectory', es: 'Trayectoria' },
  { en: 'Trajectory path', es: 'Ruta de las trayectorias' },
  { en: 'Snapshot files per conversation, in the data folder.', es: 'Ficheros de snapshot por conversación, en la carpeta de datos.' },
  { en: 'Trajectories are stored in userData/trajectory.', es: 'Las trayectorias están en userData/trajectory.' },
  { en: 'Open folder', es: 'Abrir carpeta' },

  // --- Ajustes: Atajos ---
  { en: 'Conversation', es: 'Conversación' },
  { en: 'Input box shortcuts.', es: 'Atajos del cuadro de entrada.' },

  // --- Ajustes: Herramientas y red ---
  {
    en: 'inherit uses the global preset. allow never asks. ask always asks. deny blocks.',
    es: 'inherit usa el preset global. allow nunca pregunta. ask siempre pregunta. deny bloquea.',
  },
  { en: 'No tools', es: 'Sin herramientas' },
  { en: 'Could not read the catalogue.', es: 'No se pudo leer el catálogo.' },
  { en: 'Allowed domains', es: 'Dominios permitidos' },
  { en: 'One per line. If the list is empty, everything not denied is allowed.', es: 'Uno por línea. Si la lista está vacía, se permite todo lo que no esté denegado.' },
  { en: 'Allow', es: 'Permitir' },
  { en: 'Subdomains included.', es: 'Subdominios incluidos.' },
  { en: 'Denied domains', es: 'Dominios denegados' },
  { en: 'They take priority over allowed ones.', es: 'Tienen prioridad sobre las permitidas.' },
  { en: 'Deny', es: 'Denegar' },
  { en: 'Applied before allow.', es: 'Se aplica antes que allow.' },

  // --- Ajustes: Servidores MCP ---
  { en: 'MCP servers', es: 'Servidores MCP' },
  {
    en: 'Launched over stdio at the start of each turn and closed when it ends. "Test" starts the server, counts its tools and closes it.',
    es: 'Se lanzan por stdio al empezar cada turno y se cierran al terminar. «Probar» arranca el servidor, cuenta sus herramientas y lo cierra.',
  },
  { en: 'No servers', es: 'Sin servidores' },
  {
    en: 'Local catalogue of open source MCP servers. They install as normal plugins; there are no accounts, plans or payments.',
    es: 'Catálogo local de servidores MCP open source. Se instalan como plugins normales; no hay cuentas, planes ni pagos.',
  },
  { en: 'All installed', es: 'Todo instalado' },
  { en: 'Loading catalogue…', es: 'Cargando catálogo…' },
  { en: 'New server', es: 'Nuevo servidor' },
  { en: 'Name, command, arguments and optional environment variables.', es: 'Nombre, comando, argumentos y variables de entorno opcionales.' },
  { en: 'Test', es: 'Probar' },
  { en: 'Remove', es: 'Quitar' },
  { en: 'Install', es: 'Instalar' },
  { en: 'disabled', es: 'desactivado' },
  { en: 'untested', es: 'sin probar' },
  { en: 'testing…', es: 'probando…' },
  { en: 'Name and command are required.', es: 'Nombre y comando son obligatorios.' },

  // --- Ajustes: Conversaciones ---
  { en: 'How history is stored and how long it is kept.', es: 'Cómo se guardan y cuánto se conserva el historial.' },
  { en: 'Save history', es: 'Guardar historial' },
  { en: 'Conversations are written to disk in JSONL format.', es: 'Las conversaciones se escriben en disco en formato JSONL.' },
  { en: 'Retention days', es: 'Días de retención' },
  { en: 'Older conversations are deleted at startup and every 6 hours.', es: 'Las conversaciones más antiguas se borran al arrancar y cada 6 horas.' },
  { en: 'Clean up now', es: 'Limpiar ahora' },
  {
    en: 'Applies retention now and reports how many conversations were deleted.',
    es: 'Aplica la retención en este momento y dice cuántas conversaciones borró.',
  },
  { en: 'Clean up', es: 'Limpiar' },
  { en: 'Retention is disabled (Never).', es: 'La retención está desactivada (Nunca).' },
  { en: 'Export', es: 'Exportar' },
  { en: 'Export current conversation', es: 'Exportar conversación actual' },
  { en: 'Saves the history to disk as Markdown.', es: 'Guarda el historial como Markdown en el disco.' },
  { en: 'Saved conversations', es: 'Conversaciones guardadas' },
  { en: 'History available', es: 'Historial disponible' },
  { en: 'Open history', es: 'Abrir historial' },

  // --- Ajustes: Comentarios ---
  { en: 'Report a problem', es: 'Informar de un problema' },
  { en: 'Describe what you expected and what happened.', es: 'Describe qué esperabas y qué ocurrió.' },
  { en: 'Open an issue', es: 'Abrir una incidencia' },
  { en: 'Creates a report with the project context.', es: 'Crea un informe con el contexto del proyecto.' },
  { en: 'Copy diagnostics', es: 'Copiar diagnóstico' },
  { en: 'Copies version, provider and model to the clipboard.', es: 'Copia versión, proveedor y modelo al portapapeles.' },
  { en: 'Links', es: 'Enlaces' },
  { en: 'Documentation', es: 'Documentación' },
  { en: 'Known issues', es: 'Problemas conocidos' },

  // --- Etiquetas de herramientas y monitor ---
  { en: 'Planner', es: 'Planificador' },
  { en: 'Browser subagent', es: 'Subagente de navegador' },
  { en: 'Ran list files in current directory', es: 'Listó los ficheros del directorio actual' },
  { en: 'Ran read file', es: 'Leyó el fichero' },
  { en: 'Ran', es: 'Ejecutó' },
  { en: 'Ran search', es: 'Buscó' },
  { en: 'Ran write file', es: 'Escribió el fichero' },
  { en: 'Ran edit file', es: 'Editó el fichero' },
  { en: 'Ran edit several parts of a file', es: 'Editó varias partes de un fichero' },
  { en: 'Ran the test suite', es: 'Ejecutó la suite de tests' },
  { en: 'Ran open URL', es: 'Abrió la URL' },
  { en: 'Ran commands', es: 'Ejecutó comandos' },
  { en: 'Monitor could not classify this action', es: 'El monitor no pudo clasificar esta acción' },

  // --- Diálogos nativos y notificaciones del sistema ---
  { en: 'Agent permission', es: 'Permiso del agente' },
  { en: 'Allow anyway', es: 'Permitir igualmente' },
  { en: 'The agent wants to edit a Jupyter notebook', es: 'El agente quiere editar un cuaderno de Jupyter' },
  { en: 'The agent finished with errors.', es: 'El agente terminó con errores.' },
  { en: 'The agent has finished.', es: 'El agente ha terminado.' },
];

// Frases partidas por elementos inline (kbd, strong…) o con variables.
window.I18N_STRINGS.push(
  { en: 'Type', es: 'Escribe' },
  { en: 'and select', es: 'y selecciona' },
  { en: 'to have the agent generate a plan.', es: 'para que el agente genere un plan.' },
  { en: 'to send.', es: 'para enviar.' },
);

// Ajustes: descripciones del catálogo de herramientas (Tool Permissions),
// skills integradas y catálogo de plugins (Marketplace).
window.I18N_STRINGS.push(
  {
    en: 'Reads a text file and returns its content. Uses paths relative to the working directory. ' +
      'For large files, request a range with startLine/endLine instead of reading it whole: ' +
      'it returns the header with the total line count and the range you requested.',
    es: 'Lee un fichero de texto y devuelve su contenido. Usa rutas relativas al directorio de trabajo. ' +
      'Para ficheros grandes, pide un rango con startLine/endLine en vez de leerlo entero: ' +
      'devuelve la cabecera con el total de líneas y el rango que has pedido.',
  },
  {
    en: 'Lists the contents of a directory. Returns names ending in `/` if they are directories.',
    es: 'Lista el contenido de un directorio. Devuelve nombres con `/` al final si son directorios.',
  },
  {
    en: 'Creates a new file with the given content. For a file that ALREADY exists it does not work ' +
      'by default: use `edit_file` (one fragment) or `multi_replace` (several sections), which ' +
      'preserve the rest. If you really want to rewrite it whole, pass `overwrite: true`.',
    es: 'Crea un fichero nuevo con el contenido indicado. Para un fichero que YA existe no sirve ' +
      'por defecto: usa `edit_file` (un fragmento) o `multi_replace` (varios tramos), que ' +
      'conservan el resto. Si de verdad quieres reescribirlo entero, pasa `overwrite: true`.',
  },
  {
    en: 'Downloads the content of an http(s) URL and returns the text. Respects the network ' +
      'access rules configured in Settings.',
    es: 'Descarga el contenido de una URL http(s) y devuelve el texto. ' +
      'Respeta las reglas de acceso a red configuradas en Ajustes.',
  },
  {
    en: 'Opens a URL. Depending on the “Open Links In” preference, it opens in the built-in ' +
      'browser or in the system browser.',
    es: 'Abre una URL. Según la preferencia «Open Links In» se abre en el navegador ' +
      'integrado o en el navegador del sistema.',
  },
  {
    en: 'Opens a URL in the built-in browser and waits for it to load. ' +
      'Then you can read its content or interact with it.',
    es: 'Abre una URL en el navegador integrado y espera a que cargue. ' +
      'Después puedes leer su contenido o interactuar con ella.',
  },
  {
    en: 'Returns the visible text of the open page and its title. Use it to read what is on screen.',
    es: 'Devuelve el texto visible de la página abierta y su título. Úsalo para leer qué hay en pantalla.',
  },
  {
    en: 'Clicks the first element that matches a CSS selector.',
    es: 'Hace clic en el primer elemento que coincida con un selector CSS.',
  },
  {
    en: 'Runs JavaScript in the open page and returns the result. ' +
      'May ask for approval before running.',
    es: 'Ejecuta JavaScript en la página abierta y devuelve el resultado. ' +
      'Puede pedir aprobación antes de ejecutar.',
  },
  {
    en: 'Navigates the built-in browser tab to another URL and waits for it to load. ' +
      'Use browser_open to open the browser the first time.',
    es: 'Navega la pestaña del navegador integrado a otra URL y espera a que cargue. ' +
      'Usa browser_open para abrir el navegador la primera vez.',
  },
  {
    en: 'Lists the visible interactive elements of the page with a CSS selector, their text and ' +
      'position. Use it before clicking or filling something in, instead of guessing selectors.',
    es: 'Lista los elementos interactivos visibles de la página con un selector CSS, su texto y ' +
      'posición. Úsala antes de hacer clic o rellenar algo, en vez de adivinar selectores.',
  },
  {
    en: 'Writes text into a field (input, textarea, select or contenteditable) and notifies the ' +
      'page with input/change events, as if the user had typed it.',
    es: 'Escribe texto en un campo (input, textarea, select o contenteditable) y avisa a la ' +
      'página con los eventos input/change, como si el usuario lo hubiera escrito.',
  },
  {
    en: 'Types text with real browser input into the given element (or the one that already ' +
      'has focus). Use it when the page ignores programmatic filling (rich editors).',
    es: 'Escribe texto con entrada real del navegador en el elemento indicado (o en el que ya ' +
      'tiene el foco). Úsala cuando la página ignore el relleno programático (editores enriquecidos).',
  },
  {
    en: 'Presses a real key on the page: Enter, Tab, Escape, Backspace, Delete, arrows, ' +
      'Home, End, PageUp, PageDown, Space or a letter/digit.',
    es: 'Pulsa una tecla real en la página: Enter, Tab, Escape, Backspace, Delete, flechas, ' +
      'Home, End, PageUp, PageDown, Space o una letra/dígito.',
  },
  {
    en: 'Selects an option of a <select> by its value.',
    es: 'Selecciona una opción de un <select> por su valor.',
  },
  {
    en: 'Scrolls the page or a specific element: positive dy goes down, negative goes up.',
    es: 'Desplaza la página o un elemento concreto: dy positivo baja, negativo sube.',
  },
  {
    en: 'Moves the real mouse over an element (to open menus or tooltips).',
    es: 'Mueve el ratón real sobre un elemento (para abrir menús o tooltips).',
  },
  {
    en: 'Waits until a selector, a text or a URL appears. It stops as soon as the condition is met.',
    es: 'Espera hasta que aparezca un selector, un texto o una URL. Se para en cuanto se cumple.',
  },
  {
    en: 'Runs a sequence of browser actions (open, navigate, click, fill, type, press, hover, ' +
      'scroll, select, wait, read) and stops at the first error.',
    es: 'Ejecuta una secuencia de acciones del navegador (open, navigate, click, fill, type, ' +
      'press, hover, scroll, select, wait, read) y se detiene en el primer error.',
  },
  {
    en: 'Searches a regular expression in the project files and returns matches with ' +
      'path and line number. It is how you find where something is used.',
    es: 'Busca una expresión regular en los ficheros del proyecto y devuelve coincidencias con ' +
      'ruta y número de línea. Es la forma de encontrar dónde se usa algo.',
  },
  {
    en: 'Replaces an exact fragment of a file with another. Much safer than write_file: ' +
      'it only changes what is indicated and keeps the rest. `oldText` must appear exactly once.',
    es: 'Reemplaza un fragmento exacto de un fichero por otro. Mucho más seguro que write_file: ' +
      'solo cambia lo indicado y conserva el resto. `oldText` debe aparecer exactamente una vez.',
  },
  {
    en: 'Generates an image from a description using Google Flow in the built-in browser. ' +
      'It uses the Google session you already have open, so it needs no key and costs no money. ' +
      'If Flow asks you to sign in, open it with `browser_open` and sign in before trying again.',
    es: 'Genera una imagen a partir de una descripción usando Google Flow en el navegador ' +
      'integrado. Usa la sesión de Google que ya tengas abierta, así que no necesita clave ' +
      'ni cuesta dinero. Si Flow pide iniciar sesión, ábrelo con `browser_open` e inicia ' +
      'sesión antes de volver a intentarlo.',
  },
  {
    en: 'Applies several replacements to a file in a single call, each one limited to a line ' +
      'range. Each piece is applied to the result of the previous one and, if one fails, none is ' +
      'applied: the file stays intact. Use it to fix several sections of the same file without ' +
      'rewriting it whole or chaining several edit_file calls.',
    es: 'Aplica varios reemplazos a un fichero en una sola llamada, cada uno acotado a un rango ' +
      'de líneas. Cada trozo se aplica sobre el resultado del anterior y, si uno falla, no se ' +
      'aplica ninguno: el fichero queda intacto. Úsalo para corregir varios tramos de un mismo ' +
      'fichero sin reescribirlo entero ni encadenar varios edit_file.',
  },
  {
    en: 'Runs a JavaScript fragment as a temporary agent extension. ' +
      'It runs with Node in the sandbox, receives `args` and returns whatever it writes to the ' +
      'console. For project code, use run_workflow.',
    es: 'Ejecuta un fragmento de JavaScript como una extensión temporal del agente. ' +
      'Corre con Node en el sandbox, recibe `args` y devuelve lo que escriba por ' +
      'consola. Para código de proyecto, usa run_workflow.',
  },
  {
    en: 'Runs a shell command in the project directory. It waits at most ' +
      'waitDurationSeconds and, if the command has not finished, moves it to the background and ' +
      'returns a CommandId you can check with command_status. ' +
      'Use isBackground=true for development servers, watchers and tunnels.',
    es: 'Ejecuta un comando de shell en el directorio del proyecto. Espera como mucho ' +
      'waitDurationSeconds y, si el comando no ha terminado, lo pasa a segundo plano y ' +
      'devuelve un CommandId que puedes consultar con command_status. ' +
      'Usa isBackground=true para servidores de desarrollo, watchers y túneles.',
  },
  {
    en: 'Checks the status and output of a command started with run_command. ' +
      'It waits up to WaitDurationSeconds for it to finish before returning the status.',
    es: 'Consulta el estado y la salida de un comando lanzado con run_command. ' +
      'Espera hasta WaitDurationSeconds a que termine antes de devolver el estado.',
  },
  {
    en: 'Manages background tasks: list (list), status (status and log), ' +
      'kill (cancel) and send_input (send text to stdin).',
    es: 'Gestiona las tareas en segundo plano: list (listar), status (estado y log), ' +
      'kill (cancelar) y send_input (enviar texto al stdin).',
  },
  {
    en: 'Searches the web and returns a list of results with title, URL and excerpt. ' +
      'Use it when you need current information that is not in the code or the local documentation.',
    es: 'Busca en la web y devuelve una lista de resultados con título, URL y extracto. ' +
      'Úsala cuando necesites información actual que no está en el código ni en la documentación local.',
  },
  {
    en: 'Reads a specific symbol from a file (a function, method, class or type) instead of the ' +
      'whole file. If you omit nodePath, it lists the file symbols so you can choose. ' +
      'It saves many tokens compared to read_file.',
    es: 'Lee un símbolo concreto de un fichero (una función, método, clase o tipo) en vez del ' +
      'fichero entero. Si omites nodePath, lista los símbolos del fichero para que elijas. ' +
      'Ahorra muchos tokens frente a read_file.',
  },
  {
    en: 'Runs a project workflow (a Python or Node script in .opengravity/workflows/). ' +
      'Workflows receive their arguments as a JSON object. ' +
      'If you give neither name nor script, it lists the available workflows.',
    es: 'Ejecuta un workflow del proyecto (script de Python o Node en .opengravity/workflows/). ' +
      'Los workflows reciben sus argumentos como un objeto JSON. ' +
      'Si no das nombre ni script, lista los workflows disponibles.',
  },
  {
    en: 'Searches the project index and returns the most relevant files with their symbols. ' +
      'It ranks by relevance, not literal text. Use it before exploring blindly.',
    es: 'Busca en el índice del proyecto y devuelve los ficheros más relevantes con sus símbolos. ' +
      'Ordénalo por relevancia, no por texto literal. Úsalo antes de explorar a ciegas.',
  },
  {
    en: 'Reads and edits the cells of a Jupyter notebook (.ipynb) without rewriting the ' +
      'whole file. Actions: `list` (index, type and summary of each cell), `get` ' +
      '(text of one cell), `add` (insert a cell), `update` (change type or content), ' +
      '`delete` (remove one) and `create` (new empty notebook).',
    es: 'Lee y edita las celdas de un cuaderno de Jupyter (.ipynb) sin reescribir el ' +
      'fichero entero. Acciones: `list` (índice, tipo y resumen de cada celda), `get` ' +
      '(texto de una celda), `add` (insertar una celda), `update` (cambiar tipo o ' +
      'contenido), `delete` (borrar una) y `create` (cuaderno nuevo vacío).',
  },
  {
    en: 'Stores and queries facts that must survive across conversations: user preferences, ' +
      'architecture decisions, how the project is set up. ' +
      'Use it when the user tells you something you will want to remember next time.',
    es: 'Guarda y consulta hechos que deben sobrevivir entre conversaciones: preferencias ' +
      'del usuario, decisiones de arquitectura, cómo está montado el proyecto. ' +
      'Úsala cuando el usuario te diga algo que querrás recordar la próxima vez.',
  },
  {
    en: 'Lists or loads the project skills. Skills are concrete procedures ' +
      'that the project defines in .agents/skills/. Load one before following its steps.',
    es: 'Lista o carga las skills del proyecto. Las skills son procedimientos concretos ' +
      'que el proyecto define en .agents/skills/. Carga una antes de seguir sus pasos.',
  },
  {
    en: 'Sends a message to a subagent that is working, to correct its course without ' +
      'killing it or relaunching it. It reaches its conversation between steps. ' +
      'Use `@children` to broadcast to all running subagents.',
    es: 'Envía un mensaje a un subagente que está trabajando, para corregirle el rumbo sin ' +
      'matarlo ni relanzarlo. Llega a su conversación entre pasos. Usa `@children` para ' +
      'difundir a todos los que estén corriendo.',
  },
  {
    en: 'Presents a step plan and waits for user approval.',
    es: 'Presenta un plan de pasos y espera la aprobación del usuario.',
  },
  {
    en: 'Asks the user questions with options and waits for their answer.',
    es: 'Hace preguntas al usuario con opciones y espera su respuesta.',
  },
  {
    en: 'Delegates a browsing task to a subagent with its own context.',
    es: 'Delega una tarea de navegación a un subagente con su propio contexto.',
  },
  {
    en: 'Launches several subagents in parallel, each with its own context.',
    es: 'Lanza varios subagentes en paralelo, cada uno con su propio contexto.',
  },
  {
    en: 'Schedules a reminder for later, once or repeated with a cron expression.',
    es: 'Programa un aviso para más tarde, una vez o repetido con una expresión cron.',
  },
  {
    en: 'Saves a reusable subagent with a name, role and its own system prompt.',
    es: 'Guarda un subagente reutilizable con nombre, rol y system prompt propio.',
  },
  {
    en: 'Lists or cancels running subagents.',
    es: 'Lista o cancela los subagentes en ejecución.',
  },
  {
    en: 'Runs the project test suite and returns a summary.',
    es: 'Ejecuta la suite de tests del proyecto y devuelve un resumen.',
  },

  // Skills integradas (Ajustes › Skills).
  { en: 'Respond in Spanish', es: 'Responder en español' },
  { en: 'Forces the language of responses.', es: 'Fuerza el idioma de las respuestas.' },
  { en: 'Concise replies', es: 'Respuestas concisas' },
  { en: 'No detours or unnecessary summaries.', es: 'Sin rodeos ni resúmenes innecesarios.' },
  { en: 'Suggest tests', es: 'Proponer tests' },
  { en: 'Suggests tests when changing logic.', es: 'Sugiere pruebas al cambiar lógica.' },
  { en: 'Explain reasoning', es: 'Explicar el razonamiento' },
  { en: 'Justifies every design decision.', es: 'Justifica cada decisión de diseño.' },

  // Catálogo de plugins (Ajustes › Plugins › Marketplace).
  {
    en: 'Reads and writes workspace files. Starts in the project directory.',
    es: 'Lee y escribe archivos del workspace. Arranca en el directorio del proyecto.',
  },
  {
    en: 'Persistent memory in a graph of entities and relations.',
    es: 'Memoria persistente en un grafo de entidades y relaciones.',
  },
  {
    en: 'Breaks problems into reviewable reasoning steps.',
    es: 'Descompone problemas en pasos de razonamiento revisables.',
  },
  {
    en: 'Reference protocol server with example tools.',
    es: 'Servidor de referencia del protocolo, con herramientas de ejemplo.',
  },
);

window.I18N_PATTERNS = [
  { re: /^Worked for (\d+)s$/, toEs: 'Trabajó durante $1 s' },
  { re: /^Trabajó durante (\d+) s$/, toEn: 'Worked for $1s' },
  { re: /^Thought for (\d+)s$/, toEs: 'Pensó durante $1 s' },
  { re: /^Pensó durante (\d+) s$/, toEn: 'Thought for $1s' },
  { re: /^Read (.+)$/, toEs: 'Leyó $1' },
  { re: /^Leyó (.+)$/, toEn: 'Read $1' },
  { re: /^Created (.+)$/, toEs: 'Creó $1' },
  { re: /^Creó (.+)$/, toEn: 'Created $1' },
  { re: /^Edited (.+)$/, toEs: 'Editó $1' },
  { re: /^Editó (.+)$/, toEn: 'Edited $1' },
  { re: /^Searched "(.+)"$/, toEs: 'Buscó "$1"' },
  { re: /^Buscó "(.+)"$/, toEn: 'Searched "$1"' },
  { re: /^Ran open (.+)$/, toEs: 'Abrió $1' },
  { re: /^Abrió (.+)$/, toEn: 'Ran open $1' },
  { re: /^Ran list files in (.+)$/, toEs: 'Listó los archivos de $1' },
  { re: /^Listó los archivos de (.+)$/, toEn: 'Ran list files in $1' },
  { re: /^Ran (.+)$/, toEs: 'Ejecutó $1' },
  { re: /^Ejecutó (.+)$/, toEn: 'Ran $1' },
  { re: /^Turn (\d+) of (\d+)$/, toEs: 'Turno $1 de $2' },
  { re: /^Turno (\d+) de (\d+)$/, toEn: 'Turn $1 of $2' },
  { re: /^(\d+) files? changed$/, toEs: '$1 archivo(s) cambiado(s)' },
  { re: /^(\d+) archivo\(s\) cambiado\(s\)$/, toEn: '$1 file(s) changed' },
  { re: /^Se desharán (\d+) paso\(s\)…$/, toEn: '$1 step(s) will be undone…' },
  { re: /^(\d+) step\(s\) will be undone…$/, toEs: 'Se desharán $1 paso(s)…' },
  { re: /^Borradas (\d+) conversaciones…$/, toEn: 'Deleted $1 conversations…' },
  { re: /^Deleted (\d+) conversations…$/, toEs: 'Borradas $1 conversaciones…' },
  { re: /^(\d+) escrituras…$/, toEn: '$1 writes…' },
  { re: /^(\d+) writes…$/, toEs: '$1 escrituras…' },
  { re: /^Plan aprobado · (\d+) pasos$/, toEn: 'Plan approved · $1 steps' },
  { re: /^Plan approved · (\d+) steps$/, toEs: 'Plan aprobado · $1 pasos' },
  { re: /^Monitor de seguridad: (\d+)\/10 — (.+)$/, toEn: 'Security monitor: $1/10 — $2' },
  { re: /^Security monitor: (\d+)\/10 — (.+)$/, toEs: 'Monitor de seguridad: $1/10 — $2' },
  { re: /^Subagente: (.+)$/, toEn: 'Subagent: $1' },
  { re: /^Subagent: (.+)$/, toEs: 'Subagente: $1' },
  { re: /^Imagen adjunta: (.+)$/, toEn: 'Attached image: $1' },
  { re: /^Attached image: (.+)$/, toEs: 'Imagen adjunta: $1' },

  // Ajustes › Modelos y personalizaciones.
  { re: /^(\d+) configurados · local y en la nube\.$/, toEn: '$1 configured · local and cloud.' },
  { re: /^(\d+) configured · local and cloud\.$/, toEs: '$1 configurados · local y en la nube.' },
  { re: /^(.+) — sin clave$/, toEn: '$1 — no key' },
  { re: /^(.+) — no key$/, toEs: '$1 — sin clave' },
  { re: /^(.+) — no disponible$/, toEn: '$1 — unavailable' },
  { re: /^(.+) — unavailable$/, toEs: '$1 — no disponible' },
  { re: /^(\d+) de (\d+) skills activas\.$/, toEn: '$1 of $2 skills active.' },
  { re: /^(\d+) of (\d+) skills active\.$/, toEs: '$1 de $2 skills activas.' },

  // Ajustes › Danger Zone: borrado del proyecto.
  {
    re: /^Borra (.+) permanentemente, incluidas (\d+) conversaciones activas\.$/,
    toEn: 'Permanently deletes $1, including $2 active conversations.',
  },
  {
    re: /^Permanently deletes (.+), including (\d+) active conversations\.$/,
    toEs: 'Borra $1 permanentemente, incluidas $2 conversaciones activas.',
  },

  // Ajustes › Plugins: la descripción del marketplace se muestra junto al comando.
  {
    re: /^(Lee y escribe archivos del workspace\. Arranca en el directorio del proyecto\.) · (.+)$/,
    toEn: 'Reads and writes workspace files. Starts in the project directory. · $2',
  },
  {
    re: /^(Reads and writes workspace files\. Starts in the project directory\.) · (.+)$/,
    toEs: 'Lee y escribe archivos del workspace. Arranca en el directorio del proyecto. · $2',
  },
  {
    re: /^(Memoria persistente en un grafo de entidades y relaciones\.) · (.+)$/,
    toEn: 'Persistent memory in a graph of entities and relations. · $2',
  },
  {
    re: /^(Persistent memory in a graph of entities and relations\.) · (.+)$/,
    toEs: 'Memoria persistente en un grafo de entidades y relaciones. · $2',
  },
  {
    re: /^(Descompone problemas en pasos de razonamiento revisables\.) · (.+)$/,
    toEn: 'Breaks problems into reviewable reasoning steps. · $2',
  },
  {
    re: /^(Breaks problems into reviewable reasoning steps\.) · (.+)$/,
    toEs: 'Descompone problemas en pasos de razonamiento revisables. · $2',
  },
  {
    re: /^(Servidor de referencia del protocolo, con herramientas de ejemplo\.) · (.+)$/,
    toEn: 'Reference protocol server with example tools. · $2',
  },
  {
    re: /^(Reference protocol server with example tools\.) · (.+)$/,
    toEs: 'Servidor de referencia del protocolo, con herramientas de ejemplo. · $2',
  },
];


window.I18N_STRINGS.push(
  { en: 'Read file', es: 'Leyó fichero' },
  { en: 'Created file', es: 'Creó fichero' },
  { en: 'Edited file', es: 'Editó fichero' },
  { en: 'Edited several parts of a file', es: 'Editó varias partes de un fichero' },
  { en: 'Searched', es: 'Buscó' },
  { en: 'explored', es: 'exploró' },
  { en: 'explored file', es: 'exploró un fichero' },
  { en: 'explored files', es: 'exploró ficheros' },
  { en: 'ran command', es: 'ejecutó un comando' },
  { en: 'ran commands', es: 'ejecutó comandos' },
  { en: 'edited file', es: 'editó un fichero' },
  { en: 'edited files', es: 'editó ficheros' },
  { en: 'generated image', es: 'generó una imagen' },
  { en: 'generated images', es: 'generó imágenes' },
  { en: 'searched the web', es: 'buscó en la web' },
  { en: 'used the browser', es: 'usó el navegador' },
  { en: 'delegated a task', es: 'delegó una tarea' },
  { en: 'delegated tasks', es: 'delegó tareas' },
  { en: 'presented a plan', es: 'presentó un plan' },
  { en: 'reviewed the plan', es: 'revisó el plan' },
  { en: 'asked a question', es: 'hizo una pregunta' },
  { en: 'used memory', es: 'usó memoria' },
  { en: 'read a skill', es: 'leyó una skill' },
  { en: 'ran a workflow', es: 'ejecutó un workflow' },
  { en: 'ran extension code', es: 'ejecutó código de extensión' },
  { en: 'scheduled a reminder', es: 'programó un aviso' },
  { en: 'Created', es: 'Creó' },
  { en: 'Edited', es: 'Editó' },
  { en: 'Read', es: 'Leyó' },
);


window.I18N_STRINGS.push(
  { en: '1 file changed', es: '1 fichero cambiado' },
);

window.I18N_PATTERNS.push(
  { re: /^(\d+) files changed$/, toEs: '$1 ficheros cambiados' },
  { re: /^(\d+) ficheros cambiados$/, toEn: '$1 files changed' },
  // Estados y detalles de la sección Models.
  { re: /^(\d+) de (\d+) disponibles\.$/, toEn: '$1 of $2 available.' },
  { re: /^(\d+) of (\d+) available\.$/, toEs: '$1 de $2 disponibles.' },
  { re: /^(\d+) modelos detectados en (.+)\.$/, toEn: '$1 models detected in $2.' },
  { re: /^(\d+) models detected in (.+)\.$/, toEs: '$1 modelos detectados en $2.' },
  { re: /^No se pudo consultar (.+): (.+)\.$/, toEn: 'Could not query $1: $2.' },
  { re: /^Could not query (.+): (.+)\.$/, toEs: 'No se pudo consultar $1: $2.' },
  { re: /^falta (\S+) o una clave guardada$/, toEn: 'missing $1 or a saved key' },
  { re: /^missing (\S+) or a saved key$/, toEs: 'falta $1 o una clave guardada' },
  { re: /^detectada en (\S+)$/, toEn: 'detected in $1' },
  { re: /^detected in (\S+)$/, toEs: 'detectada en $1' },
  { re: /^Usando la variable de entorno (\S+)\.$/, toEn: 'Using the environment variable $1.' },
  { re: /^Using the environment variable (\S+)\.$/, toEs: 'Usando la variable de entorno $1.' },
  {
    re: /^El modelo guardado \((.+)\) no está en la lista; elige otro\.$/,
    toEn: 'The saved model ($1) is not in the list; choose another.',
  },
  {
    re: /^The saved model \((.+)\) is not in the list; choose another\.$/,
    toEs: 'El modelo guardado ($1) no está en la lista; elige otro.',
  },
);
