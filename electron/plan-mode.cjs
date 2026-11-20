// Plan mode como ciclo planner ↔ executor, tal como funciona en Antigravity.
//
// No es una aprobación única: el planner entrega un plan, el executor lo trabaja, y
// cada N invocaciones el executor tiene que devolver el control con un informe de
// estado. Mientras la revisión está pendiente, la compuerta rechaza cualquier otra
// herramienta. El planner entonces responde continuar, revisar el plan o parar.
//
// Las plantillas de los mensajes son las del binario (offset 59 633 897), adaptadas
// al español y sin los placeholders de rol.

/**
 * Pasos que SOLO leen: se permiten en modo planner.
 *
 * Todo lo que escribe, ejecuta comandos o interactúa con una sesión (formularios
 * del navegador, stdin de una tarea en segundo plano) queda fuera: con esas
 * herramientas, un plan inyectado ejecutaría código antes de que el usuario
 * apruebe nada.
 */
const HERRAMIENTAS_DE_LECTURA = new Set([
  'read_file',
  'view_code_item',
  'list_directory',
  'search_files',
  'file_search',
  'search_code',
  'search_web',
  'fetch_url',
  'browser_read',
  'browser_navigate',
  'browser_snapshot',
  'browser_scroll',
  'browser_wait',
  'editor_current_file',
  'editor_visible_text',
  'command_status',
  'memory',
  'skill',
  'ask_user_question',
]);

/** Instrucción de sistema del planner. */
const PROMPT_PLANNER = `

## Modo plan: eres el PLANIFICADOR

Ahora mismo NO ejecutas: planificas. Las herramientas que modifican algo (escribir,
editar, ejecutar comandos) están bloqueadas hasta que entregues un plan.

Explora lo que necesites con herramientas de solo lectura y, cuando tengas claro el
trabajo, llama a \`exit_plan_mode\` con la lista de pasos. El usuario puede editar esos
pasos antes de aprobarlos: lo que recibas de vuelta es el plan definitivo, no el tuyo.

No empieces a ejecutar por tu cuenta. Ese es el trabajo del ejecutor.`;

/** Instrucción de sistema del executor. */
const PROMPT_EXECUTOR = `

## Modo plan: eres el EJECUTOR

Tienes un plan aprobado. Trabájalo paso a paso, verificando lo que haces.

Cada cierto número de invocaciones tendrás que devolver el control al planificador
llamando a \`enter_plan_mode\` con un informe de estado. Mientras esa revisión esté
pendiente, cualquier otra herramienta será rechazada: no lo intentes, llama primero a
\`enter_plan_mode\`.

Si el usuario te escribe mientras trabajas, tampoco actúes sobre su mensaje: devuelve
el control con un informe y deja que el planificador decida.`;

/** Petición de revisión periódica (plantilla `review_request`). */
function peticionDeRevision({ desde, cada }) {
  return (
    `[revisión de plan] Han pasado ${desde} invocaciones desde que se entregó el plan, ` +
    `y el planificador revisa la ejecución cada ${cada}.\n\n` +
    'Llama a `enter_plan_mode` ahora, con un informe de estado como motivo: qué pasos ' +
    'del plan están hechos, qué verificaciones se ejecutaron y qué mostraron, los fallos ' +
    'repetidos, el trabajo hecho fuera del plan, y qué queda.\n\n' +
    'No llames a ninguna otra herramienta primero: se rechazarán hasta que hayas ' +
    'devuelto el control. El planificador te devolverá un plan desde el que continuar, ' +
    'o parará si la tarea está terminada.'
  );
}

/** Petición de revisión por interrupción del usuario (plantilla `interruption_request`). */
function peticionPorInterrupcion() {
  return (
    '[revisión de plan] El usuario ha escrito mientras trabajabas.\n\n' +
    'Todos los mensajes del usuario los atiende el planificador, así que llama a ' +
    '`enter_plan_mode` ahora con un informe de estado como motivo: qué pasos están ' +
    'hechos, qué verificaciones se ejecutaron y qué mostraron, y qué queda. No actúes ' +
    'sobre su mensaje por tu cuenta.\n\n' +
    'No llames a ninguna otra herramienta primero: se rechazarán hasta que hayas ' +
    'devuelto el control.'
  );
}

/** Texto que recibe el planner al recuperar el control (plantilla `handback`). */
function handback({ informe }) {
  return (
    '[revisión de plan] El modo plan está activo: este turno lo corre el planificador. ' +
    'El ejecutor ha devuelto el control con el informe de abajo, porque necesitaba una ' +
    'decisión, porque tocaba revisión, o porque el usuario escribió mientras trabajaba.\n\n' +
    'Revisa la ejecución hasta ahora contra el plan. Lee ficheros o ejecuta comandos de ' +
    'observación si necesitas comprobarlo. Después haz exactamente una de estas cosas:\n' +
    '- La ejecución va bien, o la duda tiene respuesta: entrega con `exit_plan_mode` los ' +
    'pasos que quedan (puede ser corto), anotando lo ya hecho.\n' +
    '- La ejecución se ha desviado o el plan era erróneo: entrega con `exit_plan_mode` un ' +
    'plan revisado que diga qué deshacer, qué hacer en su lugar y cómo verificarlo.\n' +
    '- La tarea está terminada y verificada, o el usuario pidió parar: dilo al usuario y ' +
    'termina.\n\n' +
    'No ejecutes el plan tú mismo: ese es el trabajo del ejecutor.\n\n' +
    `Informe del ejecutor:\n\n${informe}`
  );
}

/**
 * Máquina de estados del plan para un turno.
 *
 * Fases: `planificando` → `ejecutando` → (`revisando` → `ejecutando`)*
 */
class CicloDePlan {
  constructor({ cada = 8, maxRevisiones = 6, empezarPlanificando = false } = {}) {
    // Sin plan pedido, el turno es libre: la compuerta deja pasar todo.
    this.fase = empezarPlanificando ? 'planificando' : 'libre';
    this.cada = Math.max(1, Number(cada));
    this.maxRevisiones = Math.max(0, Number(maxRevisiones));
    this.invocaciones = 0;
    this.revisiones = 0;
    this.plan = null;
    this.informe = null;
    this.revisionPendiente = false;
    this.interrupcion = false;
  }

  /** ¿Toca devolver el control? */
  revisionVencida() {
    return (
      this.fase === 'ejecutando' &&
      this.invocaciones >= this.cada &&
      this.revisiones < this.maxRevisiones
    );
  }

  /** Texto a inyectar antes del siguiente paso, si hay algo que decir. */
  mensajePendiente() {
    /*
     * En planificación la compuerta ya bloquea las escrituras, pero nada obliga
     * a entregar el plan: medido en vivo, el agente pasó 16 pasos explorando sin
     * llamar nunca a `present_plan`, así que el ciclo no avanzaba jamás.
     *
     * Se le da un margen corto para mirar lo imprescindible y luego se le exige
     * el plan. Insistir cada paso es lo único que lo garantiza.
     */
    if (this.fase === 'planificando') {
      this.pasosPlanificando = (this.pasosPlanificando ?? 0) + 1;
      if (this.pasosPlanificando >= 3) {
        return (
          'Ya has explorado lo suficiente. NO uses más herramientas de lectura: ' +
          'entrega ahora el plan con `present_plan`, con los pasos concretos que vas a ' +
          'seguir. Es obligatorio antes de tocar nada.'
        );
      }
      return null;
    }

    if (this.fase !== 'ejecutando') return null;

    if (this.interrupcion) {
      this.interrupcion = false;
      this.revisionPendiente = true;
      return peticionPorInterrupcion();
    }

    if (this.revisionVencida()) {
      this.revisionPendiente = true;
      return peticionDeRevision({ desde: this.invocaciones, cada: this.cada });
    }

    return null;
  }

  /**
   * Compuerta de herramientas.
   *
   * En modo planner se bloquea todo lo que no sea leer. Con una revisión pendiente
   * se bloquea todo salvo devolver el control.
   */
  compuerta(call) {
    if (this.fase === 'libre' || this.fase === 'terminado') return null;

    // Tanto al planificar como al revisar, el turno es del planner: solo lectura,
    // más las herramientas con las que entrega el plan.
    if (this.fase === 'planificando' || this.fase === 'revisando') {
      if (HERRAMIENTAS_DE_LECTURA.has(call.name)) return null;
      // `present_plan` es la entrega del agente principal; `exit_plan_mode` la del
      // sub-turno del planner. Cada uno tiene la suya.
      if (call.name === 'present_plan' || call.name === 'exit_plan_mode') return null;

      // Devolver el control no tiene sentido cuando aún no hay plan que ejecutar.
      if (call.name === 'enter_plan_mode') {
        return (
          'Todavía no hay plan aprobado: no puedes devolver el control. Entrega el plan ' +
          'con `present_plan` y espera la aprobación del usuario.'
        );
      }

      return (
        `En modo plan no puedes usar «${call.name}»: las herramientas que modifican algo ` +
        'están bloqueadas hasta que entregues el plan con `present_plan`. Explora con ' +
        'herramientas de solo lectura.'
      );
    }

    if (this.revisionPendiente && call.name !== 'enter_plan_mode') {
      return (
        'Hay una revisión de plan pendiente: ninguna herramienta funciona hasta que ' +
        'devuelvas el control con `enter_plan_mode` y un informe de estado.'
      );
    }

    return null;
  }

  /** El executor devuelve el control. */
  devolverControl(informe) {
    this.informe = String(informe ?? '').slice(0, 4000);
    this.invocaciones = 0;
    this.revisionPendiente = false;
    this.fase = 'revisando';
    this.revisiones += 1;
    return handback({ informe: this.informe });
  }

  /** El planner falló o no respondió: el ejecutor puede seguir con el plan actual. */
  cancelarRevision() {
    this.revisionPendiente = false;
    this.fase = 'ejecutando';
  }

  /** El planner entrega el plan y vuelve a ejecutarse. */
  entregarPlan(plan) {
    this.plan = plan;
    this.invocaciones = 0;
    this.revisionPendiente = false;
    this.fase = 'ejecutando';
    return this.fase;
  }

  /** Cuenta una invocación de herramienta del executor. */
  contarInvocacion() {
    if (this.fase === 'ejecutando') this.invocaciones += 1;
  }

  /** Se acabaron las revisiones disponibles. */
  sinRevisiones() {
    return this.revisiones >= this.maxRevisiones;
  }

  get resumen() {
    return {
      fase: this.fase,
      invocaciones: this.invocaciones,
      cada: this.cada,
      revisiones: this.revisiones,
      revisionPendiente: this.revisionPendiente,
    };
  }
}

module.exports = {
  CicloDePlan,
  PROMPT_PLANNER,
  PROMPT_EXECUTOR,
  HERRAMIENTAS_DE_LECTURA,
  peticionDeRevision,
  peticionPorInterrupcion,
  handback,
};
