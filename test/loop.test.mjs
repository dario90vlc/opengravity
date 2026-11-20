// Bucle del agente con un proveedor falso: compuerta, mensaje inyectado, monitor de
// ritmo, lotes en paralelo, timeout por herramienta y tope de pasos.
//
// El bucle vive en TypeScript, así que se prueba sobre `dist/`. `npm test` compila
// antes con el script `pretest`, para que no se pueda probar un dist viejo.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { raiz } from './helpers.mjs';

const { runAgent } = await import(pathToFileURL(path.join(raiz, 'dist/agent/loop.js')).href);
const { ToolRegistry } = await import(pathToFileURL(path.join(raiz, 'dist/tools/registry.js')).href);

/**
 * Proveedor falso: cada llamada a `streamGenerate` emite lo que devuelva `guion`.
 * `guion` recibe el número de llamada y devuelve un array de chunks.
 */
function proveedorFalso(guion) {
  let llamada = 0;
  return {
    id: 'falso',
    async *streamGenerate() {
      llamada += 1;
      for (const chunk of guion(llamada)) yield chunk;
    },
  };
}

/** Respuesta de un paso que pide una herramienta y termina el turno. */
const pideHerramienta = (nombre, args, id = 'c') => [
  { type: 'tool_call', call: { id, name: nombre, arguments: args } },
  { type: 'done', finishReason: 'tool_calls' },
];

/** Respuesta final de texto. */
const responde = (texto) => [
  { type: 'text', text: texto },
  { type: 'done', finishReason: 'stop' },
];

/** Herramienta de lectura que devuelve lo que le pidan. */
const herramienta = (nombre, ejecutar) => ({
  name: nombre,
  description: nombre,
  parameters: { type: 'object', properties: {} },
  async execute(args) {
    return ejecutar(args);
  },
});

describe('compuerta de herramientas', () => {
  test('una herramienta rechazada no se ejecuta y el rechazo llega al modelo', async () => {
    let ejecutada = false;
    const tools = new ToolRegistry().registerAll([
      herramienta('peligrosa', async () => {
        ejecutada = true;
        return { content: 'no debería llegar aquí' };
      }),
    ]);

    const resultados = [];
    const resultado = await runAgent(
      {
        provider: proveedorFalso((n) => (n === 1 ? pideHerramienta('peligrosa', {}) : responde('fin'))),
        model: 'x',
        tools,
        maxSteps: 3,
        toolGate: () => 'bloqueada por la compuerta',
        onEvent: (e) => {
          if (e.type === 'tool_end') resultados.push(e.content);
        },
      },
      'haz algo',
      {},
    );

    assert.equal(ejecutada, false, 'la herramienta no debe ejecutarse');
    assert.equal(resultados[0], 'bloqueada por la compuerta');
    assert.equal(resultado.reason, 'stop');
  });

  test('la compuerta recibe el nombre de la herramienta y el paso', async () => {
    const vistos = [];
    await runAgent(
      {
        provider: proveedorFalso((n) => (n === 1 ? pideHerramienta('eco', {}) : responde('fin'))),
        model: 'x',
        tools: new ToolRegistry().registerAll([herramienta('eco', async () => ({ content: 'ok' }))]),
        maxSteps: 3,
        toolGate: (call, estado) => {
          vistos.push([call.name, estado.paso]);
          return null;
        },
      },
      'haz algo',
      {},
    );
    assert.deepEqual(vistos, [['eco', 1]]);
  });
});

describe('mensaje de sistema inyectado', () => {
  test('se inyecta antes de cada paso y se emite el evento', async () => {
    const inyectados = [];
    const recibidos = [];

    const proveedor = {
      id: 'falso',
      llamadas: 0,
      async *streamGenerate(req) {
        this.llamadas += 1;
        // Se guarda cuántos mensajes de usuario lleva el historial en cada llamada.
        recibidos.push(req.messages.filter((m) => m.role === 'user').length);
        const chunks = this.llamadas === 1 ? pideHerramienta('eco', {}) : responde('fin');
        for (const chunk of chunks) yield chunk;
      },
    };

    await runAgent(
      {
        provider: proveedor,
        model: 'x',
        tools: new ToolRegistry().registerAll([herramienta('eco', async () => ({ content: 'ok' }))]),
        maxSteps: 4,
        mensajeDeSistema: ({ paso }) => `[aviso del paso ${paso}]`,
        onEvent: (e) => {
          if (e.type === 'system_step') inyectados.push(e.text);
        },
      },
      'haz algo',
      {},
    );

    assert.deepEqual(inyectados, ['[aviso del paso 1]', '[aviso del paso 2]']);
    assert.deepEqual(recibidos, [2, 3], 'cada llamada lleva el mensaje original más los inyectados');
  });

  test('sin mensaje no se emite nada', async () => {
    const inyectados = [];
    await runAgent(
      {
        provider: proveedorFalso(() => responde('hola')),
        model: 'x',
        tools: new ToolRegistry().registerAll([]),
        maxSteps: 2,
        mensajeDeSistema: () => null,
        onEvent: (e) => {
          if (e.type === 'system_step') inyectados.push(e.text);
        },
      },
      'haz algo',
      {},
    );
    assert.equal(inyectados.length, 0);
  });
});

describe('monitor de ritmo', () => {
  test('un agente que repite lo mismo recibe avisos', async () => {
    const avisos = [];
    const resultado = await runAgent(
      {
        provider: proveedorFalso((n) => pideHerramienta('eco', { igual: true }, `c${n}`)),
        model: 'x',
        tools: new ToolRegistry().registerAll([
          herramienta('eco', async () => ({ content: 'siempre lo mismo' })),
        ]),
        maxSteps: 8,
        nudgeAfterSteps: 3,
        onEvent: (e) => {
          if (e.type === 'nudge') avisos.push(e.stepsWithoutEvidence);
        },
      },
      'haz algo',
      {},
    );

    assert.equal(resultado.steps, 8);
    assert.equal(avisos.length, 2, 'a los 3 y a los 6 pasos');
    assert.deepEqual(avisos, [3, 3]);
  });

  test('un agente que obtiene cosas nuevas no recibe ninguno', async () => {
    const avisos = [];
    let i = 0;
    await runAgent(
      {
        provider: proveedorFalso((n) => pideHerramienta('variado', { i: n }, `c${n}`)),
        model: 'x',
        tools: new ToolRegistry().registerAll([
          herramienta('variado', async (args) => {
            i += 1;
            return { content: `resultado ${args.i}-${i}` };
          }),
        ]),
        maxSteps: 8,
        nudgeAfterSteps: 3,
        onEvent: (e) => {
          if (e.type === 'nudge') avisos.push(e.text);
        },
      },
      'haz algo',
      {},
    );
    assert.equal(avisos.length, 0);
  });

  test('repetir la misma información con argumentos distintos cuenta como estancamiento', async () => {
    // El caso medido en una sesión real: el agente variaba los argumentos de la
    // llamada pero recibía siempre el mismo contenido. Antes cada variación
    // contaba como evidencia nueva y el monitor nunca se disparaba.
    const avisos = [];
    await runAgent(
      {
        provider: proveedorFalso((n) => pideHerramienta('leer', { fichero: `distinto-${n}` }, `c${n}`)),
        model: 'x',
        tools: new ToolRegistry().registerAll([
          herramienta('leer', async () => ({ content: 'el mismo contenido de siempre' })),
        ]),
        maxSteps: 8,
        nudgeAfterSteps: 3,
        onEvent: (e) => {
          if (e.type === 'nudge') avisos.push(e.stepsWithoutEvidence);
        },
      },
      'arregla el bug',
      {},
    );

    assert.ok(avisos.length >= 2, `se esperaban al menos 2 avisos, hubo ${avisos.length}`);
  });

  test('un bucle de conclusión repetida recibe avisos aunque las herramientas varíen', async () => {
    // El caso medido: el agente obtiene contenido distinto en cada paso, así que
    // desde la evidencia hay progreso, pero repite la misma conclusión.
    const avisos = [];
    const conclusiones = [
      'All tests pass. But the user says the suite fails. Maybe there are hidden tests.',
      'The tests pass currently. Wait, the user says they fail. Maybe the working directory differs.',
      'Interesting. Tests pass. The user says fails. Maybe hidden tests exist somewhere.',
      'Tests pass currently. The user says they fail. Perhaps the directory is different.',
      'Tests pass. User says fails. Maybe there are hidden tests in the directory.',
      'The tests pass. User says they fail. Perhaps another directory has the real tests.',
    ];

    await runAgent(
      {
        provider: proveedorFalso((n) => [
          { type: 'reasoning', text: conclusiones[(n - 1) % conclusiones.length] },
          ...pideHerramienta('leer', { fichero: `distinto-${n}` }, `c${n}`),
        ]),
        model: 'x',
        tools: new ToolRegistry().registerAll([
          herramienta('leer', async (args) => ({ content: `contenido distinto ${args.fichero}` })),
        ]),
        maxSteps: 8,
        nudgeAfterSteps: 3,
        onEvent: (e) => {
          if (e.type === 'nudge') avisos.push(e.text);
        },
      },
      'arregla el bug',
      {},
    );

    assert.ok(avisos.length >= 1, `se esperaba al menos 1 aviso, hubo ${avisos.length}`);
    assert.match(avisos[0], /misma conclusión/);
  });

  test('tras dos avisos de conclusión repetida el turno se corta', async () => {
    // Escalada: un aviso es una oportunidad de rectificar; si el modelo sigue
    // igual, insistir solo gasta tokens. Medido: el aviso se disparaba y el
    // bucle seguía hasta agotar los pasos.
    const conclusiones = [
      'All tests pass. But the user says the suite fails. Maybe there are hidden tests.',
      'The tests pass currently. Wait, the user says they fail. Maybe the working directory differs.',
      'Interesting. Tests pass. The user says fails. Maybe hidden tests exist somewhere.',
      'Tests pass currently. The user says they fail. Perhaps the directory is different.',
      'Tests pass. User says fails. Maybe there are hidden tests in the directory.',
      'The tests pass. User says they fail. Perhaps another directory has the real tests.',
      'Tests pass here. The user says they fail. Maybe hidden tests exist in the directory.',
      'The tests pass. User says they fail. Perhaps the directory has different tests.',
    ];

    const resultado = await runAgent(
      {
        provider: proveedorFalso((n) => [
          { type: 'reasoning', text: conclusiones[(n - 1) % conclusiones.length] },
          ...pideHerramienta('leer', { fichero: `distinto-${n}` }, `c${n}`),
        ]),
        model: 'x',
        tools: new ToolRegistry().registerAll([
          herramienta('leer', async (args) => ({ content: `contenido distinto ${args.fichero}` })),
        ]),
        maxSteps: 20,
        nudgeAfterSteps: 3,
        onEvent: () => {},
      },
      'arregla el bug',
      {},
    );

    assert.equal(resultado.reason, 'stop', 'debe cortar antes de agotar los pasos');
    assert.ok(resultado.steps < 20, `no debe llegar al límite, llegó a ${resultado.steps}`);
    assert.match(resultado.text, /He parado el turno/);
  });

  test('el sufijo [hooks] no impide detectar la repetición', async () => {
    // Los hooks añaden una ruta distinta a cada resultado, así que sin
    // normalizar, ningún contenido coincide nunca y el monitor no ve repetir.
    const avisos = [];
    await runAgent(
      {
        provider: proveedorFalso((n) => pideHerramienta('leer', { fichero: `f-${n}` }, `c${n}`)),
        model: 'x',
        tools: new ToolRegistry().registerAll([
          herramienta('leer', async (args) => ({
            content: `mismo contenido\n\n[hooks] Hooks: path: "${args.fichero}" → ruta absoluta.`,
          })),
        ]),
        maxSteps: 8,
        nudgeAfterSteps: 3,
        onEvent: (e) => {
          if (e.type === 'nudge') avisos.push(e.text);
        },
      },
      'arregla el bug',
      {},
    );

    assert.ok(avisos.length >= 1, `se esperaba al menos 1 aviso, hubo ${avisos.length}`);
  });

  test('el aviso de cierre llega cuando quedan pocos pasos', async () => {
    // Un subagente que agota los pasos sin concluir deja al padre sin respuesta.
    const eventos = [];
    await runAgent(
      {
        provider: proveedorFalso((n) => pideHerramienta('eco', { n }, `c${n}`)),
        model: 'x',
        tools: new ToolRegistry().registerAll([
          herramienta('eco', async (args) => ({ content: `r${args.n}` })),
        ]),
        maxSteps: 6,
        nudgeAfterSteps: 0,
        mensajeFinalObligatorio: 'Responde AHORA con lo que sepas.',
        onEvent: (e) => {
          if (e.type === 'system_step') eventos.push(e.text);
        },
      },
      'investiga',
      {},
    );

    assert.ok(eventos.length >= 1, 'debe inyectarse el aviso');
    assert.match(eventos[0], /Responde AHORA/);
  });

  test('con nudgeAfterSteps a 0 no se avisa nunca', async () => {
    const avisos = [];
    await runAgent(
      {
        provider: proveedorFalso((n) => pideHerramienta('eco', {}, `c${n}`)),
        model: 'x',
        tools: new ToolRegistry().registerAll([herramienta('eco', async () => ({ content: 'igual' }))]),
        maxSteps: 6,
        nudgeAfterSteps: 0,
        onEvent: (e) => {
          if (e.type === 'nudge') avisos.push(e.text);
        },
      },
      'haz algo',
      {},
    );
    assert.equal(avisos.length, 0);
  });
});

describe('ejecución en paralelo', () => {
  /** Herramienta que apunta cuándo empieza y cuándo acaba. */
  const conRegistro = (nombre, registro, espera = 20) => ({
    name: nombre,
    description: nombre,
    parameters: { type: 'object', properties: {} },
    async execute(args) {
      registro.push(`inicio:${args.id}`);
      await new Promise((r) => setTimeout(r, espera));
      registro.push(`fin:${args.id}`);
      return { content: `hecho ${args.id}` };
    },
  });

  test('dos lecturas seguidas corren a la vez', async () => {
    const registro = [];
    await runAgent(
      {
        provider: proveedorFalso((n) =>
          n === 1
            ? [
                { type: 'tool_call', call: { id: 'a', name: 'leer', arguments: { id: 'a' } } },
                { type: 'tool_call', call: { id: 'b', name: 'leer', arguments: { id: 'b' } } },
                { type: 'done', finishReason: 'tool_calls' },
              ]
            : responde('fin'),
        ),
        model: 'x',
        tools: new ToolRegistry().registerAll([conRegistro('leer', registro)]),
        maxSteps: 3,
      },
      'haz algo',
      {},
    );

    assert.deepEqual(registro.slice(0, 2), ['inicio:a', 'inicio:b'], 'ambas deben empezar antes de acabar ninguna');
    assert.ok(registro.indexOf('fin:a') < registro.indexOf('inicio:a') + 4);
  });

  test('una herramienta serial corta el lote', async () => {
    const registro = [];
    await runAgent(
      {
        provider: proveedorFalso((n) =>
          n === 1
            ? [
                { type: 'tool_call', call: { id: 'a', name: 'leer', arguments: { id: 'a' } } },
                { type: 'tool_call', call: { id: 'b', name: 'run_command', arguments: { id: 'b' } } },
                { type: 'tool_call', call: { id: 'c', name: 'leer', arguments: { id: 'c' } } },
                { type: 'done', finishReason: 'tool_calls' },
              ]
            : responde('fin'),
        ),
        model: 'x',
        tools: new ToolRegistry().registerAll([
          conRegistro('leer', registro),
          conRegistro('run_command', registro),
        ]),
        maxSteps: 3,
      },
      'haz algo',
      {},
    );

    // 'a' corre y termina, luego 'b' (serial), luego 'c'.
    assert.equal(registro[0], 'inicio:a');
    assert.ok(registro.indexOf('fin:a') < registro.indexOf('inicio:b'), 'el serial espera al lote anterior');
    assert.ok(registro.indexOf('fin:b') < registro.indexOf('inicio:c'), 'y el siguiente lote espera al serial');
  });

  test('multi_replace también corta el lote', async () => {
    const registro = [];
    await runAgent(
      {
        provider: proveedorFalso((n) =>
          n === 1
            ? [
                { type: 'tool_call', call: { id: 'a', name: 'leer', arguments: { id: 'a' } } },
                { type: 'tool_call', call: { id: 'b', name: 'multi_replace', arguments: { id: 'b' } } },
                { type: 'tool_call', call: { id: 'c', name: 'leer', arguments: { id: 'c' } } },
                { type: 'done', finishReason: 'tool_calls' },
              ]
            : responde('fin'),
        ),
        model: 'x',
        tools: new ToolRegistry().registerAll([
          conRegistro('leer', registro),
          conRegistro('multi_replace', registro),
        ]),
        maxSteps: 3,
      },
      'haz algo',
      {},
    );

    assert.ok(
      registro.indexOf('fin:a') < registro.indexOf('inicio:b') &&
        registro.indexOf('fin:b') < registro.indexOf('inicio:c'),
      'multi_replace debe serializarse como el resto de escrituras',
    );
  });

  test('la familia browser_ comparte pestaña y va en serie', async () => {
    const registro = [];
    await runAgent(
      {
        provider: proveedorFalso((n) =>
          n === 1
            ? [
                { type: 'tool_call', call: { id: 'a', name: 'leer', arguments: { id: 'a' } } },
                { type: 'tool_call', call: { id: 'b', name: 'browser_fill', arguments: { id: 'b' } } },
                { type: 'tool_call', call: { id: 'c', name: 'leer', arguments: { id: 'c' } } },
                { type: 'done', finishReason: 'tool_calls' },
              ]
            : responde('fin'),
        ),
        model: 'x',
        tools: new ToolRegistry().registerAll([
          conRegistro('leer', registro),
          conRegistro('browser_fill', registro),
        ]),
        maxSteps: 3,
      },
      'haz algo',
      {},
    );

    assert.equal(registro[0], 'inicio:a');
    assert.ok(registro.indexOf('fin:a') < registro.indexOf('inicio:b'), 'el navegador espera al lote anterior');
    assert.ok(registro.indexOf('fin:b') < registro.indexOf('inicio:c'), 'y el siguiente lote espera al navegador');
  });
});

describe('límites', () => {
  test('un tope de pasos corta el bucle', async () => {
    const resultado = await runAgent(
      {
        provider: proveedorFalso((n) => pideHerramienta('eco', {}, `c${n}`)),
        model: 'x',
        tools: new ToolRegistry().registerAll([herramienta('eco', async () => ({ content: 'x' }))]),
        maxSteps: 4,
      },
      'haz algo',
      {},
    );
    assert.equal(resultado.steps, 4);
    assert.equal(resultado.reason, 'max_steps');
  });

  test('una herramienta colgada se corta por tiempo', async () => {
    const inicio = Date.now();
    const resultado = await runAgent(
      {
        provider: proveedorFalso((n) => (n === 1 ? pideHerramienta('lenta', {}) : responde('fin'))),
        model: 'x',
        tools: new ToolRegistry().registerAll([
          herramienta('lenta', async () => {
            await new Promise((r) => setTimeout(r, 5000));
            return { content: 'nunca llega' };
          }),
        ]),
        maxSteps: 3,
        toolTimeoutMs: 200,
      },
      'haz algo',
      {},
    );

    const transcurrido = Date.now() - inicio;
    assert.ok(transcurrido < 2000, `debería cortar rápido, tardó ${transcurrido}ms`);
    assert.equal(resultado.reason, 'stop');
  });

  test('una herramienta que lanza devuelve error sin romper el turno', async () => {
    const errores = [];
    const resultado = await runAgent(
      {
        provider: proveedorFalso((n) => (n === 1 ? pideHerramienta('falla', {}) : responde('fin'))),
        model: 'x',
        tools: new ToolRegistry().registerAll([
          herramienta('falla', async () => {
            throw new Error('explotó');
          }),
        ]),
        maxSteps: 3,
        onEvent: (e) => {
          if (e.type === 'tool_end') errores.push(e);
        },
      },
      'haz algo',
      {},
    );

    assert.equal(errores[0].isError, true);
    assert.match(errores[0].content, /explotó/);
    assert.equal(resultado.reason, 'stop');
  });

  test('una herramienta desconocida devuelve error y no rompe', async () => {
    const errores = [];
    await runAgent(
      {
        provider: proveedorFalso((n) => (n === 1 ? pideHerramienta('inexistente', {}) : responde('fin'))),
        model: 'x',
        tools: new ToolRegistry().registerAll([]),
        maxSteps: 3,
        onEvent: (e) => {
          if (e.type === 'tool_end') errores.push(e);
        },
      },
      'haz algo',
      {},
    );
    assert.equal(errores[0].isError, true);
  });
});

describe('eventos', () => {
  test('emite step, tool_start, tool_end, usage y done', async () => {
    const tipos = [];
    await runAgent(
      {
        provider: proveedorFalso((n) =>
          n === 1
            ? [
                { type: 'tool_call', call: { id: 'a', name: 'eco', arguments: {} } },
                { type: 'done', finishReason: 'tool_calls' },
              ]
            : responde('listo'),
        ),
        model: 'x',
        tools: new ToolRegistry().registerAll([herramienta('eco', async () => ({ content: 'ok' }))]),
        maxSteps: 4,
        onEvent: (e) => tipos.push(e.type),
      },
      'haz algo',
      {},
    );

    for (const esperado of ['step', 'tool_start', 'tool_end', 'text', 'usage', 'done']) {
      assert.ok(tipos.includes(esperado), `falta el evento ${esperado}`);
    }
  });
});

test('un reintento descarta el texto parcial y avisa a la UI', async () => {
  let llamada = 0;
  const proveedor = {
    id: 'falso',
    async *streamGenerate() {
      llamada += 1;
      if (llamada === 1) {
        yield { type: 'reasoning', text: 'razonamiento parcial' };
        yield { type: 'text', text: 'texto parcial' };
        throw new Error('corte de red');
      }
      yield { type: 'reasoning', text: 'razonamiento bueno' };
      yield { type: 'text', text: 'respuesta buena' };
      yield { type: 'done', finishReason: 'stop' };
    },
  };

  const eventos = [];
  const resultado = await runAgent(
    {
      provider: proveedor,
      model: 'falso',
      tools: new ToolRegistry(),
      onEvent: (evento) => eventos.push(evento.type),
    },
    'hola',
  );

  assert.equal(resultado.text, 'respuesta buena');
  assert.ok(eventos.includes('stream_reset'), 'la UI debe poder limpiar lo parcial');
});

test('un 404 de modelo no se reintenta', async () => {
  let llamadas = 0;
  const proveedor = {
    id: 'falso',
    async *streamGenerate() {
      llamadas += 1;
      throw new Error('HTTP 404: model not found');
    },
  };

  await assert.rejects(
    runAgent({ provider: proveedor, model: 'inexistente', tools: new ToolRegistry() }, 'hola'),
    /404/,
  );
  assert.equal(llamadas, 1);
});

test('los argumentos de una herramienta cuentan en el presupuesto de contexto', async () => {
  /*
   * Antes solo se sumaba `content`: el `write_file` de un fichero grande viaja
   * en `toolCalls`, así que el recorte nunca se activaba y el proveedor
   * rechazaba el turno por tamaño.
   */
  let llamada = 0;
  const proveedor = {
    id: 'falso',
    async *streamGenerate(req) {
      if (String(req.system ?? '').startsWith('Resume')) {
        yield { type: 'text', text: 'resumen' };
        yield { type: 'done', finishReason: 'stop' };
        return;
      }
      llamada += 1;
      if (llamada === 1) {
        yield {
          type: 'tool_call',
          call: { id: 'c1', name: 'write_file', arguments: { content: 'x'.repeat(5000) } },
        };
        yield { type: 'done', finishReason: 'tool_calls' };
        return;
      }
      yield { type: 'text', text: 'listo' };
      yield { type: 'done', finishReason: 'stop' };
    },
  };

  const herramientas = new ToolRegistry().register({
    name: 'write_file',
    description: 'escribe',
    parameters: { type: 'object', properties: { content: { type: 'string' } } },
    async execute() {
      return { content: 'ok' };
    },
  });

  const eventos = [];
  await runAgent(
    {
      provider: proveedor,
      model: 'falso',
      tools: herramientas,
      maxContextChars: 1000,
      onEvent: (evento) => eventos.push(evento.type),
    },
    'hola',
  );

  assert.ok(eventos.includes('compacting'), 'el turno debe compactar antes del segundo paso');
});

test('un corte por longitud no ejecuta herramientas incompletas', async () => {
  let ejecutada = false;
  const herramientas = new ToolRegistry().register({
    name: 'write_file',
    description: 'escribe',
    parameters: { type: 'object', properties: { path: { type: 'string' } } },
    async execute() {
      ejecutada = true;
      return { content: 'escrito' };
    },
  });

  // Argumentos vacíos + finishReason 'length': es lo que el adaptador produce
  // cuando el modelo se corta a mitad de la llamada.
  const proveedor = proveedorFalso(() => [
    { type: 'tool_call', call: { id: 'c1', name: 'write_file', arguments: {} } },
    { type: 'done', finishReason: 'length' },
  ]);

  const eventos = [];
  const resultado = await runAgent(
    { provider: proveedor, model: 'falso', tools: herramientas, onEvent: (e) => eventos.push(e) },
    'escribe el fichero',
  );

  assert.equal(ejecutada, false, 'la herramienta truncada no debe ejecutarse');
  assert.equal(resultado.reason, 'stop');
  assert.ok(
    eventos.some((e) => e.type === 'system_step' && e.text.includes('cortó por longitud')),
    'la UI debe saber que se cortó',
  );
});

test('un mensaje de usuario gigante se recorta pero no se pierde', async () => {
  let recibido = null;
  const proveedor = {
    id: 'falso',
    async *streamGenerate(req) {
      // Copia: el bucle sigue usando el array después de esta llamada.
      recibido = req.messages.map((m) => ({ ...m }));
      yield { type: 'text', text: 'ok' };
      yield { type: 'done', finishReason: 'stop' };
    },
  };

  const pegado = 'A'.repeat(20_000) + 'COLA-FINAL';
  const resultado = await runAgent(
    { provider: proveedor, model: 'falso', tools: new ToolRegistry(), maxContextChars: 1000 },
    pegado,
  );

  const enviado = recibido[0];
  assert.ok(
    enviado.content.includes('[recortado por contexto'),
    'el mensaje debe recortarse para caber',
  );
  assert.ok(enviado.content.endsWith('COLA-FINAL'), 'se conserva la cola del mensaje');
  assert.ok(enviado.content.length < pegado.length);
  assert.equal(resultado.appended[0].content, pegado, 'en disco se guarda el mensaje completo');
});

test('las imágenes adjuntas se sueltan cuando no caben en el presupuesto', async () => {
  let recibido = null;
  const proveedor = {
    id: 'falso',
    async *streamGenerate(req) {
      recibido = req.messages.map((m) => ({ ...m }));
      yield { type: 'text', text: 'ok' };
      yield { type: 'done', finishReason: 'stop' };
    },
  };

  await runAgent(
    {
      provider: proveedor,
      model: 'falso',
      tools: new ToolRegistry(),
      maxContextChars: 1000,
      images: [{ mimeType: 'image/png', data: 'x'.repeat(50_000) }],
    },
    '¿qué ves?',
  );

  assert.equal(recibido[0].images, undefined, 'la imagen no debe viajar si no cabe');
});

test('lo que se guarda en disco es lo del turno, aunque el historial se compacte', async () => {
  // El proveedor resume cuando se le pide compactar y responde al turno normal.
  const proveedor = {
    id: 'falso',
    async *streamGenerate(req) {
      if (String(req.system ?? '').startsWith('Resume')) {
        yield { type: 'text', text: 'resumen' };
        yield { type: 'done', finishReason: 'stop' };
        return;
      }
      yield { type: 'text', text: 'hecho' };
      yield { type: 'done', finishReason: 'stop' };
    },
  };

  const resultado = await runAgent(
    {
      provider: proveedor,
      model: 'falso',
      tools: new ToolRegistry(),
      maxContextChars: 800,
      initialMessages: Array.from({ length: 20 }, (_, i) => ({
        role: 'user',
        content: `mensaje ${i} ${'z'.repeat(200)}`,
      })),
    },
    'PROMPT-NUEVO-DEL-USUARIO',
  );

  assert.equal(resultado.appended[0].content, 'PROMPT-NUEVO-DEL-USUARIO');
  assert.ok(resultado.appended.length >= 2, 'el turno del asistente también se guarda');
});
test('las tools reciben sesión, turno y cwd del subagente', async () => {
  let visto = null;
  const tools = new ToolRegistry().registerAll([
    {
      name: 'captura',
      description: 'captura',
      parameters: { type: 'object', properties: {} },
      async execute(_args, ctx) {
        visto = ctx;
        return { content: 'ok' };
      },
    },
  ]);

  await runAgent(
    {
      provider: proveedorFalso((n) => (n === 1 ? pideHerramienta('captura', {}) : responde('fin'))),
      model: 'x',
      tools,
      maxSteps: 3,
    },
    'haz algo',
    { cwd: '/workspace/sub', sessionId: 'sesion-1', turno: 7 },
  );

  assert.equal(visto.cwd, '/workspace/sub');
  assert.equal(visto.sessionId, 'sesion-1');
  assert.equal(visto.turno, 7);
});
