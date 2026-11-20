// Las sesiones guardadas con el contenido como { texto, encontrados } se
// reparan al arrancar: el texto se recupera y el fichero queda válido.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { raiz } from './helpers.mjs';

const { JsonlSessionStore } = await import(
  pathToFileURL(path.join(raiz, 'dist/persistence/jsonl-store.js')).href
);

function montar() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ses-'));
  const store = new JsonlSessionStore({ root: dir });
  return { dir, store, sessions: path.join(dir, 'sessions') };
}

test('recupera el texto de un contenido con forma de objeto', async () => {
  const { dir, store, sessions } = montar();
  try {
    await store.create({ cwd: '/ws', provider: 'openai', model: 'm', title: 'Prueba' });
    const [meta] = await store.list();
    fs.mkdirSync(sessions, { recursive: true });
    const ruta = path.join(sessions, `${meta.id}.jsonl`);
    const linea = {
      at: new Date().toISOString(),
      message: { role: 'assistant', content: { texto: 'Hola mundo', encontrados: [] } },
    };
    fs.writeFileSync(ruta, JSON.stringify(linea) + '\n', 'utf8');

    const antes = await store.load(meta.id);
    assert.equal(typeof antes.messages[0].content, 'object', 'el daño existe antes de reparar');

    const resultado = await store.repararContenidoObjeto();
    assert.equal(resultado.ficheros, 1);
    assert.equal(resultado.mensajes, 1);

    const despues = await store.load(meta.id);
    assert.equal(despues.messages[0].content, 'Hola mundo');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('es idempotente y no toca lo que ya está bien', async () => {
  const { dir, store } = montar();
  try {
    await store.create({ cwd: '/ws', provider: 'openai', model: 'm' });
    const [meta] = await store.list();
    await store.append(meta.id, [{ role: 'user', content: 'texto normal' }]);

    const primera = await store.repararContenidoObjeto();
    assert.equal(primera.mensajes, 0, 'nada que reparar');

    // Y tras reparar una vez, la segunda no vuelve a escribir.
    const ruta = path.join(dir, 'sessions', `${meta.id}.jsonl`);
    const contenido = fs.readFileSync(ruta, 'utf8');
    const segunda = await store.repararContenidoObjeto();
    assert.equal(segunda.ficheros, 0);
    assert.equal(fs.readFileSync(ruta, 'utf8'), contenido);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('un contenido sin texto se deja como está', async () => {
  const { dir, store, sessions } = montar();
  try {
    await store.create({ cwd: '/ws', provider: 'openai', model: 'm' });
    const [meta] = await store.list();
    const ruta = path.join(sessions, `${meta.id}.jsonl`);
    fs.mkdirSync(sessions, { recursive: true });
    fs.writeFileSync(
      ruta,
      JSON.stringify({ at: new Date().toISOString(), message: { role: 'tool', content: { otro: 1 } } }) + '\n',
      'utf8',
    );

    const resultado = await store.repararContenidoObjeto();
    assert.equal(resultado.mensajes, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('la sesión guarda el proyecto, incluido null para No Project', async () => {
  const { dir, store } = montar();
  try {
    const conProyecto = await store.create({
      cwd: '/ws',
      project: '/proyectos/tienda',
      provider: 'openai',
      model: 'm',
    });
    const sinProyecto = await store.create({
      cwd: '/ws',
      project: null,
      provider: 'openai',
      model: 'm',
    });

    assert.equal(conProyecto.project, '/proyectos/tienda');
    assert.equal(sinProyecto.project, null);

    const lista = await store.list();
    assert.equal(lista.find((s) => s.id === conProyecto.id).project, '/proyectos/tienda');
    assert.equal(lista.find((s) => s.id === sinProyecto.id).project, null);

    await store.setProject(conProyecto.id, null);
    const cambiada = (await store.list()).find((s) => s.id === conProyecto.id);
    assert.equal(cambiada.project, null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('appends concurrentes no pierden mensajes ni metadatos', async () => {
  const { dir, store } = montar();
  try {
    const meta = await store.create({ cwd: '/ws', provider: 'openai', model: 'm' });
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        store.append(meta.id, [{ role: 'user', content: `mensaje ${i}` }]),
      ),
    );
    const cargada = await store.load(meta.id);
    assert.equal(cargada.messages.length, 20);
    const indexada = (await store.list()).find((s) => s.id === meta.id);
    assert.equal(indexada.messageCount, 20);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('un índice corrupto se reconstruye desde los JSONL en vez de perder sesiones', async () => {
  const { dir, store } = montar();
  try {
    const meta = await store.create({ cwd: '/ws', provider: 'openai', model: 'm' });
    await store.append(meta.id, [{ role: 'user', content: 'Hola desde el fichero' }]);
    fs.writeFileSync(path.join(dir, 'index.json'), '{ roto', 'utf8');

    const lista = await store.list();
    const recuperada = lista.find((s) => s.id === meta.id);
    assert.ok(recuperada, 'la sesión debe recuperarse del JSONL');
    assert.equal(recuperada.messageCount, 1);
    assert.ok(recuperada.title.length > 0, 'debe conservar un título legible');
    assert.equal(recuperada.provider, 'openai');
    assert.equal(recuperada.cwd, '/ws');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
