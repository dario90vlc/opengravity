// Trayectoria: la estructura de pasos que Antigravity usa en vez de un simple
// historial de mensajes.
//
// Cada paso guarda qué herramienta corrió, con qué argumentos, qué ficheros tocó y
// el contenido que tenían **antes**. Con eso, revertir a un paso concreto es
// recortar la trayectoria y restaurar los snapshots de los pasos posteriores.
//
// Los snapshots se persisten en disco por conversación, así que el revert por paso
// sigue funcionando después de cerrar la app.

const fsp = require('node:fs/promises');
const path = require('node:path');
const { redactarDatos } = require('./hooks.cjs');

/** Tope de pasos recordados por conversación. */
const MAX_PASOS = 400;

/** Tope de bytes en disco por conversación: al pasarse se tiran los pasos más viejos. */
const MAX_BYTES = 12_000_000;

/** Retardo del volcado a disco, para no escribir en cada snapshot. */
const DEBOUNCE_MS = 500;

/** Carpeta donde se guardan las trayectorias. La fija `configurar()`. */
let carpetaBase = null;

/** Estado en memoria por conversación. */
const trayectorias = new Map();

/** Temporizadores de volcado por conversación. */
const pendientes = new Map();

/** Configura la carpeta de persistencia. */
function configurar(directorio) {
  carpetaBase = directorio || null;
}

function rutaDe(conversacion) {
  if (!carpetaBase) return null;
  // El id de sesión es seguro, pero se sanea por si llega algo raro.
  const limpio = String(conversacion).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80);
  return path.join(carpetaBase, `${limpio}.json`);
}

function crearTrayectoria(conversacion) {
  return { conversacion: String(conversacion), pasos: [], porIndice: new Map(), cargada: false };
}

/** Serializa una trayectoria a un objeto plano. */
function serializar(trayectoria) {
  return {
    version: 1,
    conversacion: trayectoria.conversacion,
    guardadoEn: new Date().toISOString(),
    pasos: trayectoria.pasos.map((paso) => ({
      indice: paso.indice,
      herramienta: paso.herramienta,
      argumentos: paso.argumentos,
      llamadaId: paso.llamadaId,
      mensaje: paso.mensaje,
      turno: paso.turno ?? null,
      inicio: paso.inicio,
      fin: paso.fin,
      esError: paso.esError,
      resultado: paso.resultado,
      ficheros: Object.fromEntries(paso.ficheros),
    })),
  };
}

/** Reconstruye una trayectoria desde el JSON guardado. */
function deserializar(datos, conversacion) {
  const trayectoria = crearTrayectoria(conversacion);
  const pasos = Array.isArray(datos?.pasos) ? datos.pasos : [];

  for (const bruto of pasos) {
    const paso = {
      indice: Number(bruto?.indice ?? 0),
      herramienta: String(bruto?.herramienta ?? ''),
      argumentos: bruto?.argumentos ?? {},
      llamadaId: typeof bruto?.llamadaId === 'string' ? bruto.llamadaId : null,
      mensaje: bruto?.mensaje ?? null,
      turno: typeof bruto?.turno === 'number' ? bruto.turno : null,
      inicio: bruto?.inicio,
      fin: bruto?.fin,
      resultado: bruto?.resultado,
      esError: bruto?.esError === true,
      ficheros: new Map(Object.entries(bruto?.ficheros ?? {})),
    };
    trayectoria.pasos.push(paso);
    trayectoria.porIndice.set(paso.indice, paso);
  }

  trayectoria.cargada = true;
  return trayectoria;
}

/** Carga del disco si hace falta. */
async function asegurar(conversacion) {
  const clave = String(conversacion ?? 'sin-conversacion');
  let trayectoria = trayectorias.get(clave);
  if (!trayectoria) {
    trayectoria = crearTrayectoria(clave);
    trayectorias.set(clave, trayectoria);
  }
  if (trayectoria.cargada || !carpetaBase) {
    trayectoria.cargada = true;
    return trayectoria;
  }

  const ruta = rutaDe(clave);
  try {
    const crudo = await fsp.readFile(ruta, 'utf8');
    const datos = JSON.parse(crudo);
    const cargada = deserializar(datos, clave);
    // Se conserva la referencia del Map para no romper a quien la tenga.
    trayectoria.pasos = cargada.pasos;
    trayectoria.porIndice = cargada.porIndice;
    trayectoria.cargada = true;
  } catch {
    trayectoria.cargada = true;
  }

  return trayectoria;
}

/** Deja caer los pasos más viejos hasta que quepa en el tope de bytes. */
function podarPorTamano(trayectoria) {
  let datos = serializar(trayectoria);
  let bytes = Buffer.byteLength(JSON.stringify(datos), 'utf8');
  if (bytes <= MAX_BYTES) return;

  // Se tiran pasos por delante hasta bajar del tope, dejando siempre los últimos.
  while (bytes > MAX_BYTES && trayectoria.pasos.length > 1) {
    const sobrante = trayectoria.pasos.shift();
    trayectoria.porIndice.delete(sobrante.indice);
    datos = serializar(trayectoria);
    bytes = Buffer.byteLength(JSON.stringify(datos), 'utf8');
  }
}

/** Escribe la trayectoria en disco. */
async function volcar(conversacion) {
  const clave = String(conversacion ?? 'sin-conversacion');
  const trayectoria = trayectorias.get(clave);
  if (!trayectoria || !carpetaBase) return;
  /*
   * No sobrescribir el fichero con una trayectoria vacía que todavía no se ha
   * cargado: el primer paso nuevo borraría todos los snapshots anteriores. Si
   * no existe fichero es una conversación nueva y sí se puede crear.
   */
  if (!trayectoria.cargada) {
    const ruta = rutaDe(clave);
    if (!ruta) return;
    try {
      await fsp.access(ruta);
      return;
    } catch {
      trayectoria.cargada = true;
    }
  }

  podarPorTamano(trayectoria);

  try {
    await fsp.mkdir(carpetaBase, { recursive: true });
    await fsp.writeFile(rutaDe(clave), JSON.stringify(serializar(trayectoria)), 'utf8');
  } catch {
    // sin persistencia se sigue funcionando en memoria
  }
}

/** Programa un volcado, agrupando ráfagas de cambios. */
function programarVolcado(conversacion) {
  if (!carpetaBase) return;
  const clave = String(conversacion ?? 'sin-conversacion');

  const anterior = pendientes.get(clave);
  if (anterior) clearTimeout(anterior);

  const temporizador = setTimeout(() => {
    pendientes.delete(clave);
    void volcar(clave);
  }, DEBOUNCE_MS);

  temporizador.unref?.();
  pendientes.set(clave, temporizador);
}

/** Vuelca ahora todo lo pendiente. Se llama al cerrar la app. */
async function volcarTodo() {
  for (const [clave, temporizador] of pendientes) {
    clearTimeout(temporizador);
    pendientes.delete(clave);
    await volcar(clave);
  }
}

/** Devuelve (creando si hace falta) la trayectoria de una conversación. */
function trayectoriaDe(conversacion) {
  const clave = String(conversacion ?? 'sin-conversacion');
  let trayectoria = trayectorias.get(clave);
  if (!trayectoria) {
    trayectoria = crearTrayectoria(clave);
    trayectorias.set(clave, trayectoria);
  }
  return trayectoria;
}

/** Siguiente índice libre de la conversación (monotónico, no por turno). */
function siguienteIndice(trayectoria) {
  let maximo = 0;
  for (const paso of trayectoria.pasos) if (paso.indice > maximo) maximo = paso.indice;
  return maximo + 1;
}

/**
 * Abre un paso de la trayectoria.
 *
 * @param {string} conversacion
 * @param {object} datos
 * @param {number} datos.indice            índice del paso en el turno
 * @param {string} datos.herramienta
 * @param {object} [datos.argumentos]
 * @param {number|null} [datos.mensaje]    índice del mensaje al empezar el paso
 */
function abrirPaso(conversacion, datos) {
  const trayectoria = trayectoriaDe(conversacion);
  /*
   * El índice lo asigna la trayectoria, no el llamante: antes se reiniciaba en
   * cada turno, así que los pasos del turno 2 repetían los números del turno 1 y
   * revertir a «el paso 2» alcanzaba también pasos del turno anterior.
   */
  const indice = siguienteIndice(trayectoria);

  const paso = {
    indice,
    herramienta: String(datos.herramienta ?? ''),
    argumentos: redactarDatos(datos.argumentos ?? {}),
    llamadaId: typeof datos.llamadaId === 'string' ? datos.llamadaId : null,
    mensaje: datos.mensaje ?? null,
    /* Índice del mensaje con el que empezó el turno: permite revertir por mensaje. */
    turno: typeof datos.turno === 'number' ? datos.turno : null,
    inicio: new Date().toISOString(),
    ficheros: new Map(),
    resultado: undefined,
    esError: false,
  };

  trayectoria.pasos.push(paso);
  trayectoria.porIndice.set(indice, paso);

  if (trayectoria.pasos.length > MAX_PASOS) {
    const sobrantes = trayectoria.pasos.splice(0, trayectoria.pasos.length - MAX_PASOS);
    for (const viejo of sobrantes) trayectoria.porIndice.delete(viejo.indice);
  }

  programarVolcado(conversacion);
  return paso;
}

/** Devuelve el paso abierto más reciente, o null. */
function pasoActual(conversacion) {
  const trayectoria = trayectorias.get(String(conversacion ?? 'sin-conversacion'));
  if (!trayectoria || trayectoria.pasos.length === 0) return null;
  return trayectoria.pasos[trayectoria.pasos.length - 1];
}

/**
 * Anota que un paso va a modificar un fichero, guardando su contenido previo.
 *
 * Solo se guarda la primera vez **dentro del paso**: si el mismo paso escribe dos
 * veces el mismo fichero, lo que interesa restaurar es el estado anterior al paso.
 */
function anotarEscritura(conversacion, absolutePath, contenidoAntes, llamadaId) {
  const trayectoria = trayectorias.get(String(conversacion ?? 'sin-conversacion'));
  const paso = llamadaId && trayectoria
    ? [...trayectoria.pasos].reverse().find((p) => p.llamadaId === llamadaId && !p.fin)
    : pasoActual(conversacion);
  if (!paso) return false;
  if (paso.ficheros.has(absolutePath)) return false;

  /*
   * Se guarda el contenido completo. Antes se recortaba a 1 MB y «deshacer»
   * escribía ese recorte: un fichero de 1,2 MB quedaba en 1 MB, sin aviso.
   * La poda por conversación (MAX_BYTES) se encarga del crecimiento.
   */
  paso.ficheros.set(absolutePath, contenidoAntes ?? null);
  programarVolcado(conversacion);
  return true;
}

/** Cierra un paso con su resultado. */
function cerrarUnPaso(conversacion, paso, resultado) {
  if (!paso) return;
  paso.resultado = String(resultado?.contenido ?? '').slice(0, 500);
  paso.esError = resultado?.esError === true;
  paso.fin = new Date().toISOString();
  programarVolcado(conversacion);
}

/** Cierra el paso abierto con su resultado. */
function cerrarPaso(conversacion, resultado) {
  cerrarUnPaso(conversacion, pasoActual(conversacion), resultado);
}

/**
 * Cierra el paso de una llamada concreta. Con varias herramientas en paralelo,
 * cerrar siempre el último paso atribuía todos los resultados al mismo.
 */
function cerrarPasoPorLlamada(conversacion, llamadaId, resultado) {
  const trayectoria = trayectorias.get(String(conversacion ?? 'sin-conversacion'));
  const paso = trayectoria
    ? [...trayectoria.pasos].reverse().find((p) => p.llamadaId === llamadaId && !p.fin)
    : null;
  cerrarUnPaso(conversacion, paso ?? pasoActual(conversacion), resultado);
}

/** Lista los pasos con lo justo para mostrarlos en la UI. */
function listarPasos(conversacion) {
  const trayectoria = trayectorias.get(String(conversacion ?? 'sin-conversacion'));
  if (!trayectoria) return [];

  return trayectoria.pasos.map((paso) => ({
    indice: paso.indice,
    herramienta: paso.herramienta,
    mensaje: paso.mensaje,
    inicio: paso.inicio,
    esError: paso.esError,
    ficheros: [...paso.ficheros.keys()],
  }));
}

/**
 * Prepara la reversión a un paso: qué habría que hacer con cada fichero.
 *
 * No toca nada en disco; devuelve el plan para que la UI lo muestre primero.
 */
function planDeReversion(conversacion, indiceDestino) {
  const trayectoria = trayectorias.get(String(conversacion ?? 'sin-conversacion'));
  if (!trayectoria) return { ok: false, error: 'no hay trayectoria para esta conversación' };

  const destino = Number(indiceDestino);
  return planPara(trayectoria, trayectoria.pasos.filter((paso) => paso.indice > destino));
}

/**
 * Plan para el revert por turno de mensajes: se deshacen los pasos del turno
 * que empieza en el mensaje `keep` y los siguientes.
 *
 * Los pasos viejos (anteriores a guardar `turno`) no se pueden situar en un
 * turno concreto: cuentan como turno 0, así que solo salen al revertir todo.
 * shortcut: sin migración de trayectorias antiguas; se resuelve solo al
 * descartarlas por antigüedad (30 días por defecto).
 */
function planDeReversionPorMensaje(conversacion, keep) {
  const trayectoria = trayectorias.get(String(conversacion ?? 'sin-conversacion'));
  if (!trayectoria) return { ok: false, error: 'no hay trayectoria para esta conversación' };

  const desde = Math.max(0, Number(keep) || 0);
  return planPara(trayectoria, trayectoria.pasos.filter((paso) => (paso.turno ?? 0) >= desde));
}

function planPara(trayectoria, posteriores) {
  if (posteriores.length === 0) {
    return { ok: false, error: 'no hay pasos posteriores que revertir' };
  }

  // El estado a restaurar es el snapshot más antiguo de cada fichero afectado:
  // se recorre de más nuevo a más viejo y gana la última escritura del recorrido.
  const porFichero = new Map();
  for (const paso of [...posteriores].sort((a, b) => b.indice - a.indice)) {
    for (const [ruta, contenido] of paso.ficheros) porFichero.set(ruta, contenido);
  }

  const cambios = [...porFichero.entries()].map(([ruta, contenido]) => ({
    ruta,
    accion: contenido === null ? 'borrar' : 'restaurar',
    // El contenido se devuelve para poder restaurar sin volver a consultar.
    contenido,
  }));

  const primerPosterior = [...posteriores].sort((a, b) => a.indice - b.indice)[0];

  return {
    ok: true,
    cambios,
    mensaje: typeof primerPosterior.mensaje === 'number' ? primerPosterior.mensaje : null,
    pasosDeshacer: posteriores.length,
  };
}

/**
 * Aplica la reversión. `seleccionar` decide qué pasos se deshacen; se restauran
 * sus snapshots y luego se descartan de la trayectoria.
 */
async function revertirCon(conversacion, plan, seleccionar) {
  if (!plan.ok) return { ok: false, error: plan.error, restaurados: 0 };

  const trayectoria = trayectorias.get(String(conversacion ?? 'sin-conversacion'));
  if (!trayectoria) return { ok: false, error: 'no hay trayectoria para esta conversación', restaurados: 0 };

  const posteriores = trayectoria.pasos.filter(seleccionar);

  const porFichero = new Map();
  for (const paso of [...posteriores].sort((a, b) => b.indice - a.indice)) {
    for (const [ruta, contenido] of paso.ficheros) porFichero.set(ruta, contenido);
  }

  let restaurados = 0;
  const failures = [];
  for (const [ruta, contenido] of porFichero) {
    try {
      if (contenido === null) {
        await fsp.rm(ruta, { force: true });
      } else {
        await fsp.writeFile(ruta, contenido, 'utf8');
      }
      restaurados += 1;
    } catch (error) {
      failures.push(ruta);
    }
  }

  // Si algún fichero no se pudo restaurar, no se descartan sus pasos: si no,
  // la UI decía «deshecho» y ya no había forma de reintentarlo.
  if (failures.length > 0) {
    return {
      ok: false,
      error: `No se pudieron restaurar ${failures.length} fichero(s).`,
      restaurados,
      failures,
      mensaje: plan.mensaje,
      pasosDeshacer: 0,
    };
  }

  trayectoria.pasos = trayectoria.pasos.filter((paso) => !seleccionar(paso));
  trayectoria.porIndice.clear();
  for (const paso of trayectoria.pasos) trayectoria.porIndice.set(paso.indice, paso);

  programarVolcado(conversacion);

  return { ok: true, restaurados, mensaje: plan.mensaje, pasosDeshacer: posteriores.length };
}

/** Revierte a un paso concreto (el revert de una fila de herramienta). */
async function revertirA(conversacion, indiceDestino) {
  const destino = Number(indiceDestino);
  const plan = planDeReversion(conversacion, destino);
  return revertirCon(conversacion, plan, (paso) => paso.indice > destino);
}

/** Revierte los pasos del turno que empieza en el mensaje `keep` (revert por turno). */
async function revertirAMensaje(conversacion, keep) {
  const desde = Math.max(0, Number(keep) || 0);
  const plan = planDeReversionPorMensaje(conversacion, desde);
  return revertirCon(conversacion, plan, (paso) => (paso.turno ?? 0) >= desde);
}

/**
 * Descarta los pasos del turno `keep` y siguientes sin tocar ficheros.
 *
 * Se usa cuando los snapshots ya se restauraron desde memoria
 * (`restoreCheckpoints`): sin esto quedan pasos viejos que un revert posterior
 * volvería a aplicar.
 */
function descartarDesdeMensaje(conversacion, keep) {
  const trayectoria = trayectorias.get(String(conversacion ?? 'sin-conversacion'));
  if (!trayectoria) return 0;

  const desde = Math.max(0, Number(keep) || 0);
  const antes = trayectoria.pasos.length;
  trayectoria.pasos = trayectoria.pasos.filter((paso) => (paso.turno ?? 0) < desde);
  trayectoria.porIndice.clear();
  for (const paso of trayectoria.pasos) trayectoria.porIndice.set(paso.indice, paso);
  if (trayectoria.pasos.length !== antes) programarVolcado(conversacion);
  return antes - trayectoria.pasos.length;
}

/** Olvida la trayectoria de una conversación y borra su fichero. */
async function olvidarTrayectoria(conversacion) {
  const clave = String(conversacion ?? 'sin-conversacion');
  trayectorias.delete(clave);

  const temporizador = pendientes.get(clave);
  if (temporizador) {
    clearTimeout(temporizador);
    pendientes.delete(clave);
  }

  const ruta = rutaDe(clave);
  if (ruta) await fsp.rm(ruta, { force: true }).catch(() => {});
  return true;
}

/**
 * Borra las trayectorias más antiguas que `diasMaximos`.
 *
 * Sin esto la carpeta crece sin límite: cada conversación con escrituras deja un
 * fichero con copias de ficheros dentro.
 */
async function podarAntiguas(diasMaximos = 30) {
  if (!carpetaBase) return 0;

  let entradas;
  try {
    entradas = await fsp.readdir(carpetaBase);
  } catch {
    return 0;
  }

  const limite = Date.now() - diasMaximos * 86_400_000;
  let borradas = 0;

  for (const nombre of entradas) {
    if (!nombre.endsWith('.json')) continue;
    const ruta = path.join(carpetaBase, nombre);
    try {
      const info = await fsp.stat(ruta);
      if (info.mtimeMs >= limite) continue;
      // Si la conversación está viva en memoria, no se toca.
      const clave = nombre.replace(/\.json$/, '');
      if (trayectorias.has(clave)) continue;
      await fsp.rm(ruta, { force: true });
      borradas += 1;
    } catch {
      // se ignora
    }
  }

  return borradas;
}

/** Tamaño total ocupado en disco, para diagnóstico. */
async function tamanoEnDisco() {
  if (!carpetaBase) return 0;
  let total = 0;
  try {
    const entradas = await fsp.readdir(carpetaBase);
    for (const nombre of entradas) {
      if (!nombre.endsWith('.json')) continue;
      try {
        const info = await fsp.stat(path.join(carpetaBase, nombre));
        total += info.size;
      } catch {
        // se ignora
      }
    }
  } catch {
    return 0;
  }
  return total;
}

module.exports = {
  configurar,
  asegurar,
  abrirPaso,
  cerrarPaso,
  cerrarPasoPorLlamada,
  anotarEscritura,
  pasoActual,
  listarPasos,
  planDeReversion,
  planDeReversionPorMensaje,
  rutaDeTrayectoria: rutaDe,
  revertirA,
  revertirAMensaje,
  descartarDesdeMensaje,
  olvidarTrayectoria,
  podarAntiguas,
  volcar,
  volcarTodo,
  tamanoEnDisco,
};
