'use strict';

/**
 * Buscar y reemplazar en todo el proyecto.
 *
 * El motor vive aquí, separado de Electron, para poder probarlo con `node:test`
 * sin arrancar la app. Todo lo que recorre disco entra por parámetro.
 */

const path = require('node:path');
const fsp = require('node:fs/promises');

/** Carpetas que nunca se recorren: mismas reglas que el índice. */
const CARPETAS_IGNORADAS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', '.next', '.cache', 'coverage',
  'target', 'bin', 'obj', '.venv', 'venv', '__pycache__', '.idea', '.vscode',
  'renderer/monaco',
]);

const EXT_BINARIA = /\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|tar|exe|dll|so|dylib|node|woff2?|ttf|eot|mp[34]|wav|wasm|asar|lock)$/i;

const MAX_FICHEROS = 4000;
const MAX_BYTES = 2_000_000;
const MAX_RESULTADOS = 500;

/** Escapa un texto para usarlo como patrón literal. */
function escaparRegex(texto) {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Construye el buscador a partir de la consulta y sus opciones.
 * Devuelve una función que, dado un texto, enumera las coincidencias.
 */
function crearBuscador(consulta, opciones = {}) {
  const {
    regex = false,
    sensibleAMayusculas = false,
    palabraCompleta = false,
    multilinea = false,
  } = opciones;

  if (typeof consulta !== 'string' || consulta.length === 0) {
    return () => [];
  }

  let cuerpo = regex ? consulta : escaparRegex(consulta);
  if (palabraCompleta) cuerpo = `\\b(?:${cuerpo})\\b`;

  let patron;
  try {
    // `m` hace que ^ y $ valgan por línea, que es lo que espera quien
    // reemplaza «espacios al final de línea».
    const banderas = `g${sensibleAMayusculas ? '' : 'i'}${multilinea ? 'm' : ''}`;
    patron = new RegExp(cuerpo, banderas);
  } catch {
    // Expresión regular inválida mientras se escribe: no hay resultados, pero
    // tampoco se rompe la interfaz.
    return () => [];
  }

  return (texto) => {
    const encontrados = [];
    patron.lastIndex = 0;
    let coincidencia;
    while ((coincidencia = patron.exec(texto)) !== null) {
      encontrados.push({
        indice: coincidencia.index,
        longitud: coincidencia[0].length,
        texto: coincidencia[0],
      });
      // Una coincidencia vacía haría un bucle infinito.
      if (coincidencia[0].length === 0) patron.lastIndex += 1;
      if (encontrados.length > 5000) break;
    }
    return encontrados;
  };
}

/** Cuenta las líneas hasta `indice`, para dar línea y columna humanas. */
function posicionDe(texto, indice) {
  let linea = 1;
  let inicioDeLinea = 0;
  for (let i = 0; i < indice; i += 1) {
    if (texto.charCodeAt(i) === 10) {
      linea += 1;
      inicioDeLinea = i + 1;
    }
  }
  return { linea, columna: indice - inicioDeLinea + 1 };
}

/** Texto de la línea que contiene `indice`. */
function lineaEn(texto, indice) {
  const inicio = texto.lastIndexOf('\n', indice - 1) + 1;
  const finBruto = texto.indexOf('\n', indice);
  const fin = finBruto === -1 ? texto.length : finBruto;
  return texto.slice(inicio, fin);
}

/**
 * Busca en un contenido y devuelve las coincidencias con su posición.
 * `ruta` solo se copia al resultado, para agrupar luego.
 */
function buscarEnContenido(contenido, buscador, ruta, limite = MAX_RESULTADOS) {
  const resultados = [];
  // Una sola pasada para los inicios de línea; antes se recorría el fichero
  // entero por cada coincidencia.
  const inicios = [0];
  for (let i = 0; i < contenido.length; i += 1) {
    if (contenido.charCodeAt(i) === 10) inicios.push(i + 1);
  }
  const posicion = (indice) => {
    let bajo = 0;
    let alto = inicios.length - 1;
    while (bajo <= alto) {
      const medio = Math.floor((bajo + alto) / 2);
      if (inicios[medio] <= indice) bajo = medio + 1;
      else alto = medio - 1;
    }
    const lineaIndex = Math.max(0, alto);
    return {
      linea: lineaIndex + 1,
      columna: indice - inicios[lineaIndex] + 1,
      texto: contenido.slice(
        inicios[lineaIndex],
        lineaIndex + 1 < inicios.length ? inicios[lineaIndex + 1] - 1 : contenido.length,
      ),
    };
  };
  for (const hallazgo of buscador(contenido)) {
    const ubicacion = posicion(hallazgo.indice);
    resultados.push({
      ruta,
      linea: ubicacion.linea,
      columna: ubicacion.columna,
      texto: ubicacion.texto,
      coincidencia: hallazgo.texto,
      indice: hallazgo.indice,
      longitud: hallazgo.longitud,
    });
    if (resultados.length >= limite) break;
  }
  return resultados;
}

/**
 * Reemplaza todas las coincidencias de un contenido.
 * Devuelve el texto nuevo y cuántas sustituyó. Con `preservarMayusculas`,
 * adapta el reemplazo a cómo estaba escrito el original.
 */
function reemplazarEnContenido(contenido, buscador, reemplazo, opciones = {}) {
  const { preservarMayusculas = false } = opciones;
  const hallazgos = buscador(contenido);
  if (hallazgos.length === 0) return { contenido, cambios: 0 };

  let salida = '';
  let cursor = 0;

  for (const hallazgo of hallazgos) {
    salida += contenido.slice(cursor, hallazgo.indice);

    let texto = reemplazo;
    if (preservarMayusculas && hallazgo.texto.length > 0) {
      if (hallazgo.texto === hallazgo.texto.toUpperCase()) texto = reemplazo.toUpperCase();
      else if (/^[A-Z]/.test(hallazgo.texto)) {
        texto = reemplazo.charAt(0).toUpperCase() + reemplazo.slice(1);
      }
    }

    salida += texto;
    cursor = hallazgo.indice + hallazgo.longitud;
  }

  salida += contenido.slice(cursor);
  return { contenido: salida, cambios: hallazgos.length };
}

/** Lista los ficheros de texto del proyecto, saltando carpetas y binarios. */
async function listarFicheros(raiz, opciones = {}) {
  const { limite = MAX_FICHEROS, maxBytes = MAX_BYTES } = opciones;
  const salida = [];

  const recorrer = async (directorio) => {
    if (salida.length >= limite) return;

    let entradas;
    try {
      entradas = await fsp.readdir(directorio, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entrada of entradas) {
      if (salida.length >= limite) return;
      if (entrada.name.startsWith('.')) continue;
      if (CARPETAS_IGNORADAS.has(entrada.name)) continue;
      if (EXT_BINARIA.test(entrada.name)) continue;

      const absoluta = path.join(directorio, entrada.name);

      if (entrada.isDirectory()) {
        await recorrer(absoluta);
        continue;
      }
      if (!entrada.isFile()) continue;

      try {
        const info = await fsp.stat(absoluta);
        if (info.size > maxBytes) continue;
      } catch {
        continue;
      }

      salida.push(path.relative(raiz, absoluta).split(path.sep).join('/'));
    }
  };

  await recorrer(raiz);
  return salida;
}

module.exports = {
  crearBuscador,
  buscarEnContenido,
  reemplazarEnContenido,
  listarFicheros,
  posicionDe,
  lineaEn,
  escaparRegex,
  CARPETAS_IGNORADAS,
  MAX_RESULTADOS,
};
