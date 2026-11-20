/**
 * Bucle del agente.
 *
 * El corazón del sistema: prompt → modelo → herramientas → modelo → … hasta que
 * el modelo deja de pedir herramientas o se alcanza el límite de pasos.
 *
 * Es deliberadamente pequeño y legible. Todo lo demás (UI, MCP, persistencia)
 * se construye alrededor de esto.
 */

import type {
  Chunk,
  FinishReason,
  GenerateRequest,
  ImagePart,
  Message,
  ModelProvider,
  ThinkingBlock,
  ToolCall,
} from '../providers/types.js';
import type { ToolContext } from '../tools/types.js';
import { ventanaDeModelo } from './contexto.js';
import type { ToolRegistry } from '../tools/registry.js';

/**
 * Un 4xx de configuración no se arregla repitiendo la misma petición: solo se
 * reintentan cortes de red, timeouts, 429 y 5xx.
 */
function esErrorPermanente(error: unknown): boolean {
  const texto = (error instanceof Error ? error.message : String(error)).toLowerCase();
  if (/\b(429|500|502|503|504|529)\b/.test(texto)) return false;
  return (
    /\b(400|401|403|404|405|422)\b/.test(texto) ||
    /unauthorized|forbidden|invalid api key|authentication|permission denied|permiso denegado/.test(texto) ||
    /(model|modelo).*(not found|no existe|does not exist|unknown|invalid|unsupported|not available)/.test(texto)
  );
}

export interface AgentOptions {
  provider: ModelProvider;
  model: string;
  tools: ToolRegistry;
  /** Instrucción de sistema. Define el comportamiento del agente. */
  system?: string;
  /** Máximo de idas y vueltas modelo↔herramientas. Corta bucles infinitos. */
  maxSteps?: number;
  temperature?: number;
  maxTokens?: number;
  /** Historial previo, para reanudar una conversación guardada. */
  initialMessages?: Message[];
  /** Imágenes adjuntas al turno actual. */
  images?: ImagePart[];
  /** Tope de caracteres por resultado de herramienta. Por defecto 16 000. */
  maxToolChars?: number;
  /** Presupuesto de caracteres para todo el historial. Por defecto sale del modelo. */
  maxContextChars?: number;
  /**
   * Ventana real del modelo en tokens. Se usa para el presupuesto y para
   * configurar el servidor local (`num_ctx`). Si falta, se deduce del id.
   */
  contextWindow?: number;
  /** Tiempo máximo por herramienta, en ms. Por defecto 120 000. */
  toolTimeoutMs?: number;
  /** Tiempo máximo sin recibir un chunk del proveedor. Por defecto 120 000. */
  streamIdleTimeoutMs?: number;
  /**
   * Pasos consecutivos sin evidencia nueva antes de inyectar una nota de ritmo.
   * 0 desactiva el monitor. Por defecto 3.
   */
  nudgeAfterSteps?: number;
  /**
   * Aviso que se inyecta cuando quedan pocos pasos, para que el agente cierre con
   * lo que tenga en vez de agotar el presupuesto en silencio.
   */
  mensajeFinalObligatorio?: string;
  /**
   * Compuerta de herramientas. Si devuelve un texto, la herramienta NO se ejecuta
   * y ese texto vuelve al modelo como resultado. Es el `plan_mode_gate` de
   * Antigravity: en modo plan se rechazan las herramientas de escritura, y durante
   * una revisión pendiente se rechaza todo salvo la de devolver el control.
   */
  toolGate?: (call: ToolCall, estado: { paso: number }) => string | null;
  /**
   * Mensaje que se inyecta antes de cada paso si devuelve algo. Sirve para las
   * peticiones de revisión del plan, que su motor inserta como pasos ocultos.
   */
  mensajeDeSistema?: (estado: { paso: number }) => string | null;
  /** Caché de prompt en el proveedor. Desactivada por defecto (cambia el coste). */
  cachePrompt?: boolean;
  /**
   * Presupuesto de pensamiento extendido en tokens (Claude y Gemini 2.5+).
   * `0` o ausente deja el comportamiento por defecto del modelo.
   */
  /**
   * Nivel de pensamiento elegido en el composer: minimal, low, medium, high,
   * xhigh o max. Se traduce por proveedor con `ajustesDePensamiento`.
   */
  nivelDePensamiento?: string;
  thinkingBudget?: number;
  reasoningEffort?: string;
  thinkingLevel?: string;
  /** Observador de eventos, para conectar la UI o el log. */
  onEvent?: (event: AgentEvent) => void;
}

/** Eventos que emite el agente durante una ejecución. */
export type AgentEvent =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  /** El proveedor cortó el stream y se reintenta: la UI debe limpiar lo parcial. */
  | { type: 'stream_reset' }
  | { type: 'tool_start'; call: ToolCall }
  | { type: 'tool_end'; call: ToolCall; content: string; isError: boolean; command?: string }
  | { type: 'step'; index: number }
  | { type: 'compacting' }
  | { type: 'nudge'; text: string; stepsWithoutEvidence: number }
  | { type: 'system_step'; text: string }
  | { type: 'usage'; inputTokens: number; outputTokens: number }
  | { type: 'done'; reason: 'stop' | 'max_steps' | 'error'; steps: number; text: string };

/** Resultado final de una ejecución del agente. */
export interface AgentResult {
  /** Texto final que el modelo produjo en el último paso. */
  text: string;
  /** Historial completo, incluidos los turnos de herramienta. */
  messages: Message[];
  /**
   * Solo lo que añadió este turno, sin recortes ni compactación. Es lo que se
   * guarda en disco: `messages` puede haber perdido mensajes por presupuesto,
   * así que cortarlo por posición deja fuera el prompt del usuario.
   */
  appended: Message[];
  steps: number;
  reason: 'stop' | 'max_steps' | 'error';
}

/**
 * Ejecuta el agente hasta que termine.
 *
 * @example
 * const result = await runAgent({
 *   provider: createProvider('ollama'),
 *   model: 'qwen2.5-coder',
 *   tools: registry,
 *   system: 'Eres un asistente que edita código.',
 * }, 'Lee src/index.ts y resume qué hace');
 */
export async function runAgent(
  options: AgentOptions,
  userInput: string,
  ctx: Omit<ToolContext, 'signal'> & { signal?: AbortSignal } = { cwd: process.cwd() },
): Promise<AgentResult> {
  const maxSteps = options.maxSteps ?? 12;
  /*
   * Las definiciones de herramienta viajan en cada petición y también ocupan
   * ventana. Se serializan una vez: el registro no cambia durante el turno.
   */
  const toolDefinitions = options.tools.definitions();
  const overheadChars =
    (options.system?.length ?? 0) + JSON.stringify(toolDefinitions).length;
  /** Lo que añade este turno, intacto: es lo que se guarda en disco. */
  const appended: Message[] = [];
  const add = (message: Message): void => {
    messages.push(message);
    appended.push(message);
  };
  let messages: Message[] = [...(options.initialMessages ?? [])];
  add({
    role: 'user',
    content: userInput,
    ...(options.images && options.images.length > 0 ? { images: options.images } : {}),
  });
  let finalText = '';
  let steps = 0;
  let totalInput = 0;
  let totalOutput = 0;

  // Monitor de ritmo: si el agente da vueltas sin obtener información nueva, se le
  // inyecta una nota para que replantee. No es un límite de pasos, es un detector
  // de estancamiento, igual que el hook de "evidence velocity" de Antigravity.
  const nudgeAfter = options.nudgeAfterSteps ?? 3;
  let pasosSinEvidencia = 0;
  const huellasVistas = new Set<string>();

  /*
   * Bucle de razonamiento: el modelo puede variar las herramientas y obtener
   * contenido distinto —así que desde la evidencia hay progreso— mientras repite
   * una y otra vez la misma conclusión. Medido en una sesión real: 22 pasos
   * diciendo «los tests pasan, pero el usuario dice que fallan».
   */
  let conclusionRepetida = 0;
  let ultimaConclusion: Set<string> | null = null;
  let avisosDeConclusion = 0;

  for (let step = 0; step < maxSteps; step += 1) {
    steps = step + 1;
    options.onEvent?.({ type: 'step', index: steps });

    /*
     * Cierre forzado: a falta de dos pasos se le pide que responda con lo que
     * tenga. Sin esto, un subagente puede agotar sus pasos sin devolver nada y el
     * padre se queda sin su parte del trabajo.
     */
    if (
      options.mensajeFinalObligatorio &&
      maxSteps - steps <= 1 &&
      !messages.some((m) => m.content === options.mensajeFinalObligatorio)
    ) {
      add({ role: 'user', content: options.mensajeFinalObligatorio, internal: true });
      options.onEvent?.({ type: 'system_step', text: options.mensajeFinalObligatorio });
    }

    // Mensaje de sistema inyectado (peticiones de revisión del plan).
    const inyectado = options.mensajeDeSistema?.({ paso: steps });
    if (inyectado) {
      add({ role: 'user', content: inyectado, internal: true });
      options.onEvent?.({ type: 'system_step', text: inyectado });
    }

    // Ajusta el historial al presupuesto antes de cada llamada.
    // Primero intenta resumir con el modelo; si no puede, recorta caracteres.
    const budget =
      options.maxContextChars ??
      presupuestoPorDefecto({
        providerId: options.provider?.id ?? '',
        modelId: options.model,
        contextWindow: options.contextWindow,
        overheadChars,
      });
    const usados = messages.reduce((sum, m) => sum + pesoDeMensaje(m), 0);

    if (usados > budget) {
      options.onEvent?.({ type: 'compacting' });
      const resumido = await compactHistory(
        messages,
        options.provider,
        options.model,
        budget,
        ctx.signal,
      );
      messages = fitContext(resumido ?? messages, budget);
    }

    const request: GenerateRequest = {
      model: options.model,
      messages,
      tools: toolDefinitions,
      ...(options.contextWindow ? { contextWindow: options.contextWindow } : {}),
      ...(options.system !== undefined ? { system: options.system } : {}),
      ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
      ...(options.maxTokens !== undefined ? { maxTokens: options.maxTokens } : {}),
      /*
       * Caché de prompt desde el segundo paso: el prefijo (sistema + herramientas)
       * se reutiliza, así que la escritura de 1,25× se amortiza y las lecturas
       * cuestan 0,1×. En un turno de un solo paso no se activa: ahí no hay
       * reutilización y saldría más caro.
       */
      cachePrompt: options.cachePrompt !== false && step > 0,
      ...(options.thinkingBudget && options.thinkingBudget > 0
        ? { thinkingBudget: options.thinkingBudget }
        : {}),
      ...(options.reasoningEffort ? { reasoningEffort: options.reasoningEffort } : {}),
      ...(options.thinkingLevel ? { thinkingLevel: options.thinkingLevel } : {}),
    };

    const toolCalls: ToolCall[] = [];
    const thinkingBlocks: ThinkingBlock[] = [];
    let text = '';
    // Razonamiento del paso: sirve para detectar bucles de conclusión repetida.
    let razonamiento = '';
    let turnInput = 0;
    let turnOutput = 0;
    // En un objeto para que TS no estreche el tipo: la asignación ocurre en un cierre.
    const turn: { finishReason: FinishReason } = { finishReason: 'stop' };

    const idleMs = options.streamIdleTimeoutMs ?? 60_000;

    // Un corte a mitad de stream no debe matar el turno: se reintenta una vez.
    for (let intento = 1; intento <= 2; intento += 1) {
      const controlador = new AbortController();
      let temporizador: NodeJS.Timeout | undefined;
      let expirado = false;
      const abortar = () => controlador.abort();
      ctx.signal?.addEventListener('abort', abortar, { once: true });
      if (ctx.signal?.aborted) controlador.abort();
      const renovar = () => {
        clearTimeout(temporizador);
        temporizador = setTimeout(() => {
          expirado = true;
          controlador.abort();
        }, idleMs);
        temporizador.unref?.();
      };
      renovar();

      try {
        for await (const chunk of options.provider.streamGenerate(request, controlador.signal)) {
          renovar();
          handleChunk(chunk, {
            onText: (delta) => {
              text += delta;
              options.onEvent?.({ type: 'text', text: delta });
            },
            onReasoning: (delta) => {
              razonamiento += delta;
              options.onEvent?.({ type: 'reasoning', text: delta });
            },
            onThinkingBlock: (block) => thinkingBlocks.push(block),
            onToolCall: (call) => toolCalls.push(call),
            onDone: (reason) => {
              turn.finishReason = reason;
            },
            onUsage: (input, output) => {
              turnInput += input;
              turnOutput += output;
            },
          });
        }
        break;
      } catch (error) {
        if (ctx.signal?.aborted) throw error;
        if (expirado) {
          throw new Error(
            `El proveedor dejó de enviar datos durante ${Math.round(idleMs / 1000)} s.`,
          );
        }
        if (intento === 2 || esErrorPermanente(error)) throw error;

        // Se descarta lo parcial: el reintento vuelve a emitir desde el inicio.
        text = '';
        razonamiento = '';
        toolCalls.length = 0;
        thinkingBlocks.length = 0;
        turnInput = 0;
        turnOutput = 0;
        options.onEvent?.({ type: 'stream_reset' });
        options.onEvent?.({ type: 'step', index: steps });
        await new Promise<void>((resolve) => setTimeout(resolve, 400));
      } finally {
        clearTimeout(temporizador);
        ctx.signal?.removeEventListener('abort', abortar);
      }
    }

    finalText = text;
    totalInput += turnInput;
    totalOutput += turnOutput;

    /*
     * Corte por longitud: los argumentos de las herramientas llegan a medias, así
     * que ejecutarlas sería correrlas con `{}` y gastar el turno en errores que el
     * modelo no puede diagnosticar. Se para y se le dice al usuario.
     */
    if (toolCalls.length > 0 && turn.finishReason === 'length') {
      const aviso = text.trim().length > 0 ? text : 'La respuesta del modelo se cortó por longitud.';
      add({ role: 'assistant', content: aviso });
      options.onEvent?.({
        type: 'system_step',
        text: 'La respuesta se cortó por longitud: no se ejecutaron las herramientas incompletas.',
      });
      options.onEvent?.({ type: 'usage', inputTokens: totalInput, outputTokens: totalOutput });
      options.onEvent?.({ type: 'done', reason: 'stop', steps, text: aviso });
      return { text: aviso, messages, appended, steps, reason: 'stop' };
    }

    if (turn.finishReason === 'error') {
      const aviso = text.trim().length > 0
        ? text
        : 'El proveedor cortó la respuesta antes de terminar (filtro de seguridad o error del modelo).';
      add({ role: 'assistant', content: aviso });
      options.onEvent?.({ type: 'usage', inputTokens: totalInput, outputTokens: totalOutput });
      options.onEvent?.({ type: 'done', reason: 'error', steps, text: aviso });
      return { text: aviso, messages, appended, steps, reason: 'error' };
    }

    // Sin herramientas: el agente ha terminado su respuesta.
    if (toolCalls.length === 0 || turn.finishReason !== 'tool_calls') {
      add({ role: 'assistant', content: text });
      options.onEvent?.({ type: 'usage', inputTokens: totalInput, outputTokens: totalOutput });
      options.onEvent?.({ type: 'done', reason: 'stop', steps, text });
      return { text, messages, appended, steps, reason: 'stop' };
    }

    // Con herramientas: se registra el turno del asistente y se ejecutan.
    // Los bloques de pensamiento viajan con él: Anthropic los exige al
    // devolver el `tool_result` y Gemini 3 su firma.
    add({
      role: 'assistant',
      content: text,
      toolCalls,
      ...(thinkingBlocks.length > 0 ? { thinkingBlocks } : {}),
    });

    const maxToolChars = options.maxToolChars ?? DEFAULT_MAX_TOOL_CHARS;

    /*
     * `generate_image` necesita más margen que el resto: conduce un navegador y
     * espera a que Flow termine de generar. Con el tope genérico de 120 s, el
     * timeout saltaba justo antes de que la espera de imagen pudiera informar.
     *
     * El tope se calcula POR LLAMADA: antes se usaba el nombre de la primera
     * llamada del lote, así que una imagen que no fuese la primera se cortaba a
     * los 120 s.
     */
    /*
     * Las herramientas interactivas esperan al usuario (plan, preguntas, diff,
     * permiso). Sus propias tarjetas caducan a los 10 minutos; el timeout de la
     * herramienta debe ser mayor, o el turno se corta mientras la tarjeta sigue
     * abierta. Antes eran 120 s y ese desajuste perdía la respuesta del usuario.
     */
    const TIMEOUT_LARGO_MS = 11 * 60_000;
    const TIMEOUTS_LARGOS: Record<string, number> = {
      generate_image: 240_000,
      present_plan: TIMEOUT_LARGO_MS,
      ask_question: TIMEOUT_LARGO_MS,
      ask_user_question: TIMEOUT_LARGO_MS,
      enter_plan_mode: TIMEOUT_LARGO_MS,
      write_file: TIMEOUT_LARGO_MS,
      edit_file: TIMEOUT_LARGO_MS,
      multi_replace: TIMEOUT_LARGO_MS,
      edit_notebook: TIMEOUT_LARGO_MS,
      run_command: TIMEOUT_LARGO_MS,
      run_workflow: TIMEOUT_LARGO_MS,
      run_extension_code: TIMEOUT_LARGO_MS,
      browser_task: TIMEOUT_LARGO_MS,
    };

    const runOne = async (call: ToolCall) => {
      // Una cancelación no debe ejecutar ni la compuerta ni la herramienta.
      if (ctx.signal?.aborted) {
        return { call, content: 'Cancelado por el usuario.', isError: true };
      }

      // Compuerta: si la política la rechaza, no llega a ejecutarse.
      const rechazo = options.toolGate?.(call, { paso: steps });
      if (rechazo) {
        return { call, content: rechazo, isError: true };
      }

      const toolTimeout =
        TIMEOUTS_LARGOS[call.name] ?? options.toolTimeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS;

      /*
       * El timeout debe abortar también la herramienta, no solo dejar de
       * esperar: si no, un comando o una escritura sigue viva después de que el
       * turno la haya dado por colgada. El controlador se encadena al signal
       * del turno para que Stop llegue igualmente.
       */
      const toolController = new AbortController();
      const abortar = () => toolController.abort();
      ctx.signal?.addEventListener('abort', abortar, { once: true });
      if (ctx.signal?.aborted) toolController.abort();

      let timeoutId: NodeJS.Timeout | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          toolController.abort();
          reject(new Error(`la herramienta ${call.name} superó ${Math.round(toolTimeout / 1000)}s`));
        }, toolTimeout);
        timeoutId.unref?.();
      });

      // Si la tool ignora la señal, esta carrera libera el turno igualmente.
      let quitarCancelacion = () => {};
      const cancelacion = new Promise<never>((_, reject) => {
        if (!ctx.signal) return;
        const alCancelar = () => reject(new Error('cancelado por el usuario'));
        ctx.signal.addEventListener('abort', alCancelar, { once: true });
        if (ctx.signal.aborted) alCancelar();
        quitarCancelacion = () => ctx.signal?.removeEventListener('abort', alCancelar);
      });

      let result;
      try {
        result = await Promise.race([
          options.tools.execute(call.name, call.arguments, {
            cwd: ctx.cwd,
            callId: call.id,
            signal: toolController.signal,
            ...(ctx.sessionId !== undefined ? { sessionId: ctx.sessionId } : {}),
            ...(ctx.turno !== undefined ? { turno: ctx.turno } : {}),
            ...(ctx.log ? { log: ctx.log } : {}),
          }),
          timeout,
          cancelacion,
        ]);
      } catch (error) {
        if (ctx.signal?.aborted) {
          return { call, content: 'Cancelado por el usuario.', isError: true };
        }
        const message = error instanceof Error ? error.message : String(error);
        return { call, content: `Fallo en ${call.name}: ${message}`, isError: true };
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
        quitarCancelacion();
        ctx.signal?.removeEventListener('abort', abortar);
      }

      return {
        call,
        content: clampToolResult(result.content, maxToolChars),
        isError: result.isError ?? false,
        ...(result.meta?.command ? { command: result.meta.command } : {}),
      };
    };

    for (const call of toolCalls) options.onEvent?.({ type: 'tool_start', call });

    const results: Array<{ call: ToolCall; content: string; isError: boolean; command?: string }> = [];

    /*
     * Ejecución por lotes: las llamadas de solo lectura consecutivas van en
     * paralelo; las que escriben, ejecutan comandos o piden confirmación cortan
     * el lote y van solas. Así se respeta el orden que pidió el modelo (una
     * lectura posterior a una escritura la ve) sin renunciar al paralelismo.
     */
    let lote: ToolCall[] = [];

    const volcarLote = async () => {
      if (lote.length === 0) return;
      const hechas = await Promise.all(lote.map(runOne));
      results.push(...hechas);
      lote = [];
    };

    for (const call of toolCalls) {
      // La familia browser_ comparte una única pestaña: también va en serie.
      if (SERIAL_TOOLS[call.name] === true || call.name.startsWith('browser_')) {
        await volcarLote();
        results.push(await runOne(call));
        continue;
      }
      lote.push(call);
    }

    await volcarLote();

    // Se emiten y se añaden en el orden original, aunque hayan corrido a la vez.
    let evidenciaNueva = false;

    for (const result of results) {
      options.onEvent?.({
        type: 'tool_end',
        call: result.call,
        content: result.content,
        isError: result.isError,
        ...(result.command ? { command: result.command } : {}),
      });

      add({
        role: 'tool',
        content: result.content,
        toolCallId: result.call.id,
        name: result.call.name,
      });

      // Huella = qué se pidió + qué se obtuvo. Repetir la misma llamada con la
      // misma respuesta no aporta nada; obtener algo distinto sí cuenta.
      const huella = huellaDeEvidencia(result.call, result.content);
      if (!huellasVistas.has(huella)) {
        huellasVistas.add(huella);
        evidenciaNueva = true;
      }
    }

    /*
     * Un paso sin herramientas también es un paso sin evidencia.
     *
     * Antes la condición exigía `results.length > 0`, así que un bucle de puro
     * razonamiento —el modelo repitiendo «los tests pasan, pero el usuario dice
     * que fallan» sin llamar a nada— era invisible para el monitor y podía dar
     * vueltas indefinidamente. Medido en una sesión real: 25 repeticiones
     * seguidas sin que el nudge se disparara ni una vez.
     */
    /*
     * Huella del razonamiento, tolerante a la paráfrasis: minúsculas, sin
     * cifras ni puntuación, solo palabras significativas, ordenadas. Tres pasos
     * seguidos concluyendo lo mismo cuentan como bucle aunque las herramientas
     * hayan devuelto cosas distintas.
     */
    const conclusionTexto = razonamiento || (toolCalls.length === 0 ? text : '');
    const conclusion = huellaDeRazonamiento(conclusionTexto);
    if (conclusion.size >= 5) {
      // Se compara por parecido, no por igualdad: parafrasear la misma idea
      // cambia las palabras, pero no el conjunto significativo.
      if (ultimaConclusion && similitudDeConjuntos(conclusion, ultimaConclusion) >= 0.5) {
        conclusionRepetida += 1;
      } else {
        conclusionRepetida = 0;
      }
      ultimaConclusion = conclusion;
    }

    /*
     * Una sola oportunidad de rectificar.
     *
     * A los `nudgeAfter` pasos con la misma conclusión se avisa. Si sigue igual
     * otros tantos, se corta: medido en una sesión real, el agente recibió el
     * aviso y siguió hasta agotar los pasos, así que insistir no sirve. El
     * contador NO se reinicia al avisar, para poder medir la reincidencia.
     */
    if (nudgeAfter > 0 && conclusionRepetida >= nudgeAfter && avisosDeConclusion === 0) {
      avisosDeConclusion += 1;
      const nota = notaDeConclusionRepetida();
      options.onEvent?.({ type: 'nudge', text: nota, stepsWithoutEvidence: nudgeAfter });
      add({ role: 'user', content: nota, internal: true });
    }

    if (nudgeAfter > 0 && conclusionRepetida >= nudgeAfter * 2) {
      {
        const cierre =
          'He parado el turno: llevaba varios pasos llegando a la misma conclusión sin avanzar. ' +
          'Lo más probable es que la premisa de la tarea no encaje con lo que hay en el proyecto. ' +
          'Dime qué esperas encontrar y lo reviso con otra estrategia.';
        options.onEvent?.({ type: 'text', text: cierre });
        options.onEvent?.({ type: 'usage', inputTokens: totalInput, outputTokens: totalOutput });
        options.onEvent?.({ type: 'done', reason: 'stop', steps, text: cierre });
        return { text: cierre, messages, appended, steps, reason: 'stop' };
      }
    }

    if (nudgeAfter > 0) {
      const huboEvidencia = results.length > 0 && evidenciaNueva;
      pasosSinEvidencia = huboEvidencia ? 0 : pasosSinEvidencia + 1;

      if (pasosSinEvidencia >= nudgeAfter) {
        const nota = notaDeRitmo(pasosSinEvidencia);
        pasosSinEvidencia = 0;

        options.onEvent?.({
          type: 'nudge',
          text: nota,
          stepsWithoutEvidence: nudgeAfter,
        });

        // Va como mensaje de usuario porque no todos los proveedores aceptan un
        // mensaje de sistema a mitad de conversación.
        add({ role: 'user', content: nota, internal: true });
      }
    }
  }

  options.onEvent?.({ type: 'usage', inputTokens: totalInput, outputTokens: totalOutput });
  options.onEvent?.({ type: 'done', reason: 'max_steps', steps, text: finalText });
  return { text: finalText, messages, appended, steps, reason: 'max_steps' };
}

/** Herramientas donde un resultado corto idéntico aún puede ser progreso. */
const TOOLS_CON_PROGRESO: Record<string, true> = {
  run_command: true,
  run_workflow: true,
  run_extension_code: true,
  write_file: true,
  edit_file: true,
  multi_replace: true,
  edit_notebook: true,
};

/**
 * Herramientas que no se pueden lanzar en paralelo con seguridad.
 *
 * Todo lo que escribe en el workspace (incluidos los cuadernos y los workflows)
 * o comparte un recurso global (el navegador integrado y su generación de
 * imágenes) corta el lote y corre solo. Antes solo se serializaban write/edit:
 * dos `multi_replace` o un `edit_notebook` podían pisarse.
 */
const SERIAL_TOOLS: Record<string, true> = {
  run_command: true,
  run_workflow: true,
  run_tests: true,
  write_file: true,
  edit_file: true,
  multi_replace: true,
  edit_notebook: true,
  present_plan: true,
  enter_plan_mode: true,
  generate_image: true,
  browser_task: true,
};

/** Hash barato y estable, suficiente para comparar resultados. */
function hashTexto(texto: string): string {
  let hash = 5381;
  for (let i = 0; i < texto.length; i += 1) {
    hash = ((hash << 5) + hash + texto.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}

/** Huella de la evidencia que aporta una llamada: qué pidió y qué obtuvo. */
function huellaDeEvidencia(call: ToolCall, contenido: string): string {
  /*
   * La huella es la INFORMACIÓN, no la llamada. Pero cuando la información es
   * trivial (`exit code: 0`, «Editado x») la llamada es lo único que distingue
   * progreso de repetición: tres comandos distintos sin salida no son un
   * estancamiento. En resultados largos se ignora la llamada para que una
   * variación de argumentos con el mismo texto siga contando como repetición.
   */
  /*
   * Se quita el aviso de hooks antes de hashear: los hooks añaden
   * `[hooks] Hooks: path: "…" → ruta absoluta` a CADA resultado, con una ruta
   * distinta cada vez. Eso hacía único cada contenido y la huella no coincidía
   * nunca, así que el monitor no veía jamás una repetición.
   */
  const limpio = contenido.replace(/\n*\[hooks\][^\n]*/g, '').trim();
  /*
   * En lecturas, un resultado corto repetido es estancamiento aunque cambien
   * los argumentos. En comandos y escrituras, un resultado corto idéntico
   * («exit code: 0», «Editado») sí puede ser progreso: la orden es lo que
   * distingue un comando de otro.
   */
  const porLaLlamada = TOOLS_CON_PROGRESO[call.name] === true;
  const detalle = porLaLlamada && limpio.length < 200
    ? `${call.name}|${JSON.stringify(call.arguments)}|`
    : '';
  return hashTexto(`${detalle}${limpio}`);
}

/**
 * Huella del razonamiento de un paso, tolerante a la paráfrasis.
 *
 * Se normaliza el texto y se comparan los CONJUNTOS de palabras, no el orden ni
 * la redacción. Así «All tests pass. But user says suite fails» y «The tests pass
 * currently. Wait, the user says they fail» producen la misma huella, que es lo
 * que hace falta para detectar un bucle de conclusión repetida.
 *
 * Se ignoran las palabras cortas y las vacías porque son las que más varían al
 * parafrasear.
 */
function huellaDeRazonamiento(texto: string): Set<string> {
  const palabras = texto
    .toLowerCase()
    .replace(/[^a-záéíóúñü0-9\s]/g, ' ')
    .split(/\s+/)
    .map((p) => (p.length > 4 && p.endsWith('s') ? p.slice(0, -1) : p))
    .filter((p) => p.length > 3 && !PALABRAS_VACIAS.has(p));

  // El orden de la frase no debe importar: se compara el conjunto.
  return new Set(palabras);
}

/**
 * Coeficiente de solapamiento: palabras comunes sobre el conjunto MÁS PEQUEÑO.
 *
 * Jaccard (comunes sobre la unión) castiga demasiado las paráfrasis: dos frases
 * que dicen lo mismo con rodeos comparten pocas palabras de diez. Medido con las
 * frases reales del bucle, Jaccard daba 0,27-0,31 y el solapamiento da 0,5-0,57.
 */
function similitudDeConjuntos(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let comunes = 0;
  for (const palabra of a) if (b.has(palabra)) comunes += 1;
  const menor = Math.min(a.size, b.size);
  if (menor < 4 || comunes < 3) return 0;
  return comunes / menor;
}

const PALABRAS_VACIAS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'your', 'you', 'are', 'was',
  'were', 'have', 'has', 'can', 'could', 'would', 'should', 'please', 'into',
  'about', 'what', 'when', 'where', 'which', 'will', 'but', 'not', 'maybe',
  'perhaps', 'quiz', 'quizá', 'pero', 'para', 'como', 'este', 'esta', 'esto',
  'because', 'porque', 'they', 'them', 'their', 'there', 'then', 'than', 'let',
  'lets', 'look', 'looks', 'well', 'still', 'again', 'same', 'very', 'just',
]);

/** Nota que se inyecta cuando el razonamiento se repite. */
function notaDeConclusionRepetida(): string {
  return (
    '[monitor de ritmo] Llevas varios pasos llegando a la misma conclusión con ' +
    'palabras distintas. Eso no es avanzar: es dar vueltas. Si la premisa de la ' +
    'tarea no encaja con lo que observas, dilo explícitamente al usuario en vez de ' +
    'seguir buscando una explicación. No repitas el mismo razonamiento otra vez.'
  );
}

/** Nota de ritmo que se inyecta cuando el agente se estanca. */
function notaDeRitmo(pasos: number): string {
  return (
    `[monitor de ritmo] Llevas ${pasos} pasos seguidos sin obtener información nueva: ` +
    'estás repitiendo llamadas que ya te dieron lo mismo. Para y replantea. ' +
    'Cambia de estrategia, usa otra herramienta, o explica al usuario qué te bloquea y qué necesitas. ' +
    'No repitas la última llamada.'
  );
}

/** Tope por defecto de caracteres en un resultado de herramienta. */
const DEFAULT_MAX_TOOL_CHARS = 16_000;

/**
 * Presupuesto por defecto de caracteres para el historial completo.
 *
 * Sale de la ventana del modelo, no de una constante. Se descuentan el prompt
 * de sistema y las definiciones de herramienta, que también viajan en la
 * petición: sin eso, un modelo de 8k recibía un presupuesto que no cabía ni
 * con el historial vacío. Se deja un 15% para la respuesta.
 */
function presupuestoPorDefecto(options: {
  providerId?: string;
  modelId?: string;
  contextWindow?: number;
  overheadChars?: number;
}): number {
  const tokens = options.contextWindow ?? ventanaDeModelo(options);
  const disponibles = Math.floor(tokens * 4 * 0.85) - (options.overheadChars ?? 0);
  return Math.max(2_000, disponibles);
}

/** Tiempo máximo por defecto de una herramienta antes de darla por colgada. */
const DEFAULT_TOOL_TIMEOUT_MS = 120_000;

/**
 * Resume los turnos más antiguos con el propio modelo.
 *
 * Devuelve el historial compactado, o `null` si no hay nada que resumir o la
 * llamada falla (en ese caso el llamante recurre al recorte por caracteres).
 *
 * Solo se corta en un mensaje `user`, que es donde empieza un turno: así no
 * quedan `tool_result` sin su `tool_call`, que los proveedores rechazan.
 */
async function compactHistory(
  messages: Message[],
  provider: ModelProvider,
  model: string,
  budget: number,
  signal?: AbortSignal,
): Promise<Message[] | null> {
  /*
   * Se resume aproximadamente la mitad más antigua, no solo el primer turno.
   * Así una conversación larga no paga un resumen nuevo en cada paso ni
   * produce un «resumen del resumen» que pierde decisiones.
   */
  const objetivo = Math.max(0, budget * 0.5);
  let acumulado = 0;
  let candidato = messages.length;
  for (let i = messages.length - 1; i >= 1; i -= 1) {
    const mensaje = messages[i];
    if (!mensaje) continue;
    acumulado += pesoDeMensaje(mensaje);
    if (acumulado >= objetivo) {
      candidato = i;
      break;
    }
  }

  /*
   * Punto de corte: preferible un `user` (empieza turno), pero un turno largo
   * con muchas herramientas no tiene ninguno, así que también vale un
   * `assistant` con tool calls: sus resultados van justo detrás y el par
   * queda completo en la cola.
   */
  let cut = -1;
  for (let i = Math.max(1, candidato); i < messages.length; i += 1) {
    if (messages[i]?.role === 'user') {
      cut = i;
      break;
    }
  }
  if (cut < 0) {
    for (let i = Math.max(2, candidato); i < messages.length; i += 1) {
      const message = messages[i];
      if (message?.role === 'assistant' && (message.toolCalls?.length ?? 0) > 0) {
        cut = i;
        break;
      }
    }
  }
  // Si el objetivo cae después del último corte posible, se resume lo que hay.
  if (cut < 0) {
    for (let i = 1; i < messages.length; i += 1) {
      if (messages[i]?.role === 'user') {
        cut = i;
        break;
      }
    }
  }

  if (cut < 1) return null;

  const head = messages.slice(0, cut);
  const tail = messages.slice(cut);
  if (head.length === 0) return null;

  const transcript = head
    .map((m) => {
      const text = m.content.replace(/\s+/g, ' ').slice(0, 1200);
      return `${m.role}: ${text}`;
    })
    .join('\n')
    // El propio resumen no puede ser más grande que el presupuesto que intenta
    // aliviar; antes se enviaba un transcript completo y el proveedor lo rechazaba.
    .slice(0, Math.max(4_000, Math.floor(budget * 0.6)));

  let summary = '';
  const controlador = new AbortController();
  const temporizador = setTimeout(() => controlador.abort(), 20_000);
  temporizador.unref?.();
  const abortarExterno = () => controlador.abort();
  signal?.addEventListener('abort', abortarExterno, { once: true });
  if (signal?.aborted) controlador.abort();

  try {
    for await (const chunk of provider.streamGenerate(
      {
        model,
        system:
          'Resume el historial de una conversación de trabajo en un párrafo compacto. ' +
          'Conserva: decisiones tomadas, ficheros tocados, comandos ejecutados y sus resultados, ' +
          'y cualquier dato que haga falta para continuar. Descarta conversación de relleno.',
        messages: [{ role: 'user', content: transcript }],
        maxTokens: Math.min(1200, Math.floor(budget / 8)),
      },
      controlador.signal,
    )) {
      if (chunk.type === 'text') summary += chunk.text;
    }
  } catch {
    return null;
  } finally {
    clearTimeout(temporizador);
    signal?.removeEventListener('abort', abortarExterno);
  }

  const limpio = summary.trim();
  if (limpio.length === 0) return null;

  return [
    {
      role: 'user',
      content: `[Resumen de los ${head.length} mensajes anteriores]\n${limpio}`,
    },
    ...tail,
  ];
}

/** Recorta un resultado de herramienta que exceda el tope. *//** Recorta un resultado de herramienta que exceda el tope. */
function clampToolResult(content: string, max: number): string {
  if (content.length <= max) return content;
  return `${content.slice(0, max)}\n[recortado: ${content.length - max} caracteres más]`;
}

/**
 * Peso de un mensaje en el presupuesto de contexto.
 *
 * El texto es lo que más pesa, pero no lo único: el `write_file` de un fichero
 * grande viaja en `toolCalls` (el mensaje del asistente no tiene texto) y las
 * imágenes van en base64. Contando solo `content`, el recorte nunca se
 * activaba y el proveedor rechazaba el turno por tamaño.
 */
function pesoDeMensaje(message: Message): number {
  let total = message.content.length;
  if (message.toolCalls && message.toolCalls.length > 0) {
    total += JSON.stringify(message.toolCalls).length;
  }
  for (const block of message.thinkingBlocks ?? []) total += block.thinking.length;
  for (const image of message.images ?? []) total += image.data.length;
  return total;
}

/**
 * Ajusta el historial al presupuesto de contexto.
 *
 * Recorta el contenido de los resultados de herramienta más antiguos en lugar
 * de borrar mensajes: así se conserva el emparejamiento `tool_call` ↔
 * `tool_result`, que los proveedores exigen. Si aun así no cabe, recorta el
 * mensaje de usuario por los extremos (nunca lo elimina: sin él, la petición
 * no tiene sentido) y suelta las imágenes adjuntas.
 */
function fitContext(messages: Message[], budget: number): Message[] {
  const total = messages.reduce((sum, m) => sum + pesoDeMensaje(m), 0);
  if (total <= budget) return messages;

  // Se trabaja de atrás hacia adelante: lo reciente se conserva intacto.
  const out = messages.map((m) => ({ ...m }));
  let used = 0;

  for (let i = out.length - 1; i >= 0; i -= 1) {
    const message = out[i];
    if (!message) continue;
    used += pesoDeMensaje(message);

    if (used <= budget) continue;

    // Un usuario pegado (un log, un volcado) se queda con cabeza y cola: el
    // proveedor rechaza la petición entera si no cabe, y se pierde el turno.
    if (message.role === 'user') {
      const keep = Math.max(400, Math.floor(budget / 4));
      if (message.content.length > keep) {
        const cola = Math.floor(keep / 4);
        const rest = message.content.length - keep - cola;
        message.content =
          `${message.content.slice(0, keep)}\n[recortado por contexto: ${rest} caracteres]\n` +
          message.content.slice(-cola);
        used -= rest;
      }
      if (message.images && message.images.length > 0) {
        for (const image of message.images) used -= image.data.length;
        delete message.images;
      }
      continue;
    }

    if (message.role !== 'tool' && message.role !== 'assistant') continue;

    /*
     * Los argumentos de un `write_file`/`multi_replace` viejo también pesan en
     * la petición. Antes `fitContext` solo recortaba `content`, así que un
     * historial con tool_calls grandes seguía por encima de la ventana y el
     * proveedor devolvía 400.
     */
    if (message.role === 'assistant' && message.toolCalls && message.toolCalls.length > 0) {
      const antes = pesoDeMensaje(message);
      message.toolCalls = message.toolCalls.map((call) => {
        const crudo = JSON.stringify(call.arguments ?? {});
        return crudo.length > 400
          ? { ...call, arguments: { _truncado: 'argumentos recortados por contexto' } }
          : call;
      });
      used -= antes - pesoDeMensaje(message);
    }

    if (message.content.length <= 300) continue;

    const keep = 300;
    const rest = message.content.length - keep;
    message.content = `${message.content.slice(0, keep)}\n[recortado por contexto: ${rest} caracteres]`;
    used -= rest;
  }

  return out;
}

interface ChunkHandlers {
  onUsage: (input: number, output: number) => void;
  onText: (text: string) => void;
  onReasoning: (text: string) => void;
  onThinkingBlock: (block: ThinkingBlock) => void;
  onToolCall: (call: ToolCall) => void;
  onDone: (reason: 'stop' | 'tool_calls' | 'length' | 'error') => void;
}

function handleChunk(chunk: Chunk, handlers: ChunkHandlers): void {
  switch (chunk.type) {
    case 'text':
      handlers.onText(chunk.text);
      break;
    case 'reasoning':
      handlers.onReasoning(chunk.text);
      break;
    case 'thinking_block':
      handlers.onThinkingBlock(chunk.block);
      break;
    case 'tool_call':
      handlers.onToolCall(chunk.call);
      break;
    case 'done':
      handlers.onDone(chunk.finishReason);
      break;
    case 'usage':
      handlers.onUsage(chunk.inputTokens, chunk.outputTokens);
      break;
  }
}
