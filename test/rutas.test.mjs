// El renderer solo puede tocar el workspace y las carpetas que el usuario abrió
// a mano. Sin esto, un `api.readFile('..\\..\\.ssh\\id_rsa')` devolvía la clave.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const rutas = require('../electron/rutas.cjs');

const cwd = path.join(os.tmpdir(), 'ws-prueba');

beforeEach(() => {
  rutas.olvidarRaices();
  rutas.registrarRaiz(cwd);
});

test('una ruta dentro del workspace se resuelve', () => {
  assert.equal(rutas.rutaAutorizada(cwd, 'src/a.ts'), path.join(cwd, 'src', 'a.ts'));
  assert.equal(rutas.rutaAutorizada(cwd, '.'), cwd);
});

test('salir del workspace con .. se rechaza', () => {
  assert.throws(() => rutas.rutaAutorizada(cwd, '..\\secreto.txt'), /fuera del workspace/);
  assert.throws(() => rutas.rutaAutorizada(cwd, path.join(cwd, '..', 'otro.txt')), /fuera del workspace/);
});

test('una ruta absoluta de fuera se rechaza', () => {
  assert.throws(() => rutas.rutaAutorizada(cwd, path.join(os.homedir(), '.ssh', 'id_rsa')), /fuera del workspace/);
});

test('el prefijo de otro directorio no vale como estar dentro', () => {
  // "ws-prueba2" empieza por "ws-prueba" pero no está dentro.
  assert.throws(() => rutas.rutaAutorizada(cwd, `${cwd}2/a.txt`), /fuera del workspace/);
});

test('una carpeta abierta desde el diálogo queda autorizada', () => {
  const otra = path.join(os.tmpdir(), 'otra-carpeta');
  rutas.registrarRaiz(otra);
  assert.equal(rutas.rutaAutorizada(cwd, path.join(otra, 'f.txt')), path.join(otra, 'f.txt'));
});

test('un enlace que sale del workspace se rechaza', (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'rutas-symlink-'));
  try {
    const workspace = path.join(base, 'ws');
    const fuera = path.join(base, 'fuera');
    fs.mkdirSync(workspace);
    fs.mkdirSync(fuera);
    fs.writeFileSync(path.join(fuera, 'secreto.txt'), 'no');

    try {
      fs.symlinkSync(fuera, path.join(workspace, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
    } catch {
      t.skip('el sistema no permite crear enlaces en esta prueba');
      return;
    }

    rutas.registrarRaiz(workspace);
    assert.throws(
      () => rutas.rutaAutorizada(workspace, path.join('escape', 'secreto.txt')),
      /fuera del workspace/,
    );
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});
