'use strict';

/**
 * Rutas que el renderer puede leer y escribir.
 *
 * El renderer no debe tocar el disco entero: solo el workspace abierto y las
 * carpetas que el usuario eligió a mano en un diálogo. Un fichero abierto desde
 * el diálogo autoriza su carpeta, no todo el disco.
 */

const path = require('node:path');
const { dentroDelWorkspace, rutaReal } = require('./hooks.cjs');

/** Raíces autorizadas, ya resueltas. */
const raices = new Set();

/** Autoriza una carpeta (workspace o carpeta de un fichero elegido). */
function registrarRaiz(absoluta) {
  if (typeof absoluta === 'string' && absoluta.length > 0) raices.add(path.resolve(absoluta));
}

/** Resuelve una ruta del renderer y falla si queda fuera de las raíces. */
function rutaAutorizada(cwd, pedida) {
  const absoluta = path.resolve(String(cwd ?? ''), String(pedida ?? ''));
  const real = rutaReal(absoluta);
  for (const raiz of raices) {
    if (dentroDelWorkspace(rutaReal(raiz), real)) return absoluta;
  }
  throw new Error(`ruta fuera del workspace: ${pedida}`);
}

/** Solo para pruebas: olvida las raíces registradas. */
function olvidarRaices() {
  raices.clear();
}

module.exports = { registrarRaiz, rutaAutorizada, olvidarRaices };
