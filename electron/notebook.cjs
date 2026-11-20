'use strict';

/**
 * `edit_notebook`: operaciones sobre las celdas de un `.ipynb`.
 *
 * Igual que en Antigravity, con las mismas acciones: `list`, `get`, `add`,
 * `update`, `delete`, `create`. El fichero es JSON con `cells[]`, cada una con
 * `cell_type` (`code` o `markdown`), `source` (lista de líneas) y, si es código,
 * `outputs` y `execution_count`.
 *
 * Se trabaja sobre el objeto y se escribe al final, así que una acción inválida
 * no deja el cuaderno a medias.
 */

const path = require('node:path');
const fsp = require('node:fs/promises');

const ACCIONES = new Set(['list', 'get', 'add', 'update', 'delete', 'create']);

/** Cuaderno vacío con la forma que espera Jupyter. */
function cuadernoVacio() {
  return {
    cells: [],
    metadata: {},
    nbformat: 4,
    nbformat_minor: 5,
  };
}

/** Texto de una celda, uniendo su `source`. */
function textoDeCelda(celda) {
  const fuente = celda?.source ?? celda?.input ?? '';
  return Array.isArray(fuente) ? fuente.join('') : String(fuente);
}

/** Convierte texto en el `source` que usa el formato. */
function fuenteDesde(texto) {
  const lineas = String(texto ?? '').split('\n');
  return lineas.map((linea, i) => (i < lineas.length - 1 ? `${linea}\n` : linea));
}

/** Resumen corto de una celda, para `list`. */
function resumenDeCelda(celda, indice) {
  const texto = textoDeCelda(celda).replace(/\s+/g, ' ').trim();
  const recorte = texto.length > 70 ? `${texto.slice(0, 70)}…` : texto;
  return `${indice} [${celda?.cell_type ?? 'code'}] ${recorte}`;
}

/**
 * Aplica una acción al cuaderno. Devuelve `{ cuaderno, mensaje, salida }` o
 * `{ error }` sin tocar nada.
 */
function aplicarAccion(cuaderno, args) {
  const accion = String(args?.action ?? '').toLowerCase();
  if (!ACCIONES.has(accion)) {
    return { error: `Acción desconocida: «${accion}». Usa ${[...ACCIONES].join(', ')}.` };
  }

  const celda = cuaderno.cells ?? [];
  const indice = args?.cellIndex === undefined ? null : Number(args.cellIndex);

  switch (accion) {
    case 'list': {
      if (celda.length === 0) return { mensaje: 'El cuaderno no tiene celdas.', salida: [] };
      return {
        mensaje: `${celda.length} celdas:`,
        salida: celda.map((c, i) => resumenDeCelda(c, i)),
      };
    }

    case 'get': {
      if (indice === null || !Number.isInteger(indice) || indice < 0 || indice >= celda.length) {
        return { error: `cellIndex fuera de rango (0-${Math.max(0, celda.length - 1)}).` };
      }
      return {
        mensaje: `Celda ${indice} (${celda[indice].cell_type}):`,
        salida: [textoDeCelda(celda[indice])],
      };
    }

    case 'add': {
      const tipo = String(args?.cellType ?? 'code') === 'markdown' ? 'markdown' : 'code';
      const nueva = {
        cell_type: tipo,
        metadata: {},
        source: fuenteDesde(args?.cellContent ?? ''),
      };
      if (tipo === 'code') {
        nueva.execution_count = null;
        nueva.outputs = [];
      }

      const posicion =
        indice === null || !Number.isInteger(indice) || indice < 0 || indice > celda.length
          ? celda.length
          : indice;

      celda.splice(posicion, 0, nueva);
      return { mensaje: `Celda ${tipo} añadida en la posición ${posicion}.` };
    }

    case 'update': {
      if (indice === null || !Number.isInteger(indice) || indice < 0 || indice >= celda.length) {
        return { error: `cellIndex fuera de rango (0-${Math.max(0, celda.length - 1)}).` };
      }
      if (args?.cellType) {
        const tipo = String(args.cellType) === 'markdown' ? 'markdown' : 'code';
        celda[indice].cell_type = tipo;
        // nbformat exige outputs/execution_count en celdas code y prohíbe
        // salidas en markdown; al cambiar de tipo hay que normalizar.
        if (tipo === 'markdown') {
          delete celda[indice].outputs;
          delete celda[indice].execution_count;
        } else {
          celda[indice].outputs ??= [];
          celda[indice].execution_count ??= null;
        }
      }
      if (args?.cellContent !== undefined) {
        celda[indice].source = fuenteDesde(args.cellContent);
        // Al cambiar el código, la salida anterior deja de valer.
        if (celda[indice].cell_type === 'code') {
          celda[indice].outputs = [];
          celda[indice].execution_count = null;
        }
      }
      return { mensaje: `Celda ${indice} actualizada.` };
    }

    case 'delete': {
      if (indice === null || !Number.isInteger(indice) || indice < 0 || indice >= celda.length) {
        return { error: `cellIndex fuera de rango (0-${Math.max(0, celda.length - 1)}).` };
      }
      celda.splice(indice, 1);
      return { mensaje: `Celda ${indice} borrada. Quedan ${celda.length}.` };
    }

    case 'create': {
      if (celda.length > 0) {
        return { error: 'El cuaderno ya tiene celdas. Usa `add` para añadir más.' };
      }
      celda.push({
        cell_type: 'code',
        metadata: {},
        source: fuenteDesde(args?.cellContent ?? ''),
        execution_count: null,
        outputs: [],
      });
      return { mensaje: 'Cuaderno creado con una celda de código.' };
    }

    default:
      return { error: 'Acción no soportada.' };
  }
}

/** Herramienta: operar sobre las celdas de un cuaderno de Jupyter. */
function makeEditNotebookTool(getCwd) {
  return {
    name: 'edit_notebook',
    description:
      'Lee y edita las celdas de un cuaderno de Jupyter (.ipynb) sin reescribir el ' +
      'fichero entero. Acciones: `list` (índice, tipo y resumen de cada celda), `get` ' +
      '(texto de una celda), `add` (insertar una celda), `update` (cambiar tipo o ' +
      'contenido), `delete` (borrar una) y `create` (cuaderno nuevo vacío).',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Ruta del .ipynb.' },
        action: {
          type: 'string',
          enum: [...ACCIONES],
          description: 'Qué hacer con el cuaderno.',
        },
        cellIndex: {
          type: 'number',
          description: 'Índice de la celda (0-based). Obligatorio para get, update y delete.',
        },
        cellType: {
          type: 'string',
          enum: ['code', 'markdown'],
          description: 'Tipo de celda, para add y update.',
        },
        cellContent: {
          type: 'string',
          description: 'Contenido de la celda, para add, update y create.',
        },
      },
      required: ['path', 'action'],
    },
    async execute(args, ctx) {
      const relativa = String(args?.path ?? '');
      if (relativa.length === 0) return { content: 'Falta el parámetro `path`.', isError: true };

      const absoluta = path.resolve(ctx?.cwd ?? getCwd(), relativa);
      const accion = String(args?.action ?? '').toLowerCase();

      /*
       * `create` parte de un cuaderno vacío y escribe: sin esta comprobación
       * sobrescribe una libreta existente y borra celdas y salidas, sin
       * checkpoint que lo deshaga.
       */
      if (accion === 'create' && (await fsp.access(absoluta).then(() => true, () => false))) {
        return {
          content: `${relativa} ya existe. Usa \`add\` para añadir celdas o \`update\` para editarlas.`,
          isError: true,
        };
      }

      let cuaderno = cuadernoVacio();

      if (accion !== 'create') {
        let crudo;
        try {
          crudo = await fsp.readFile(absoluta, 'utf8');
        } catch (error) {
          return { content: `No se pudo leer ${relativa}: ${error.message}`, isError: true };
        }

        try {
          cuaderno = JSON.parse(crudo);
        } catch (error) {
          return { content: `${relativa} no es un .ipynb válido: ${error.message}`, isError: true };
        }

        if (!Array.isArray(cuaderno.cells)) cuaderno.cells = [];
      }

      const resultado = aplicarAccion(cuaderno, args);
      if (resultado.error) return { content: resultado.error, isError: true };

      // Solo se escribe si hubo cambio real en el cuaderno.
      if (['add', 'update', 'delete', 'create'].includes(accion)) {
        try {
          await fsp.writeFile(absoluta, `${JSON.stringify(cuaderno, null, 1)}\n`, 'utf8');
        } catch (error) {
          return { content: `No se pudo escribir ${relativa}: ${error.message}`, isError: true };
        }
      }

      const detalle = Array.isArray(resultado.salida) && resultado.salida.length > 0
        ? `\n${resultado.salida.join('\n')}`
        : '';

      return { content: `${resultado.mensaje}${detalle}` };
    },
  };
}

module.exports = { makeEditNotebookTool, aplicarAccion, textoDeCelda, fuenteDesde };
