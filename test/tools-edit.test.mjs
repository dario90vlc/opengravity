import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { makeEditFileTool } = require('../electron/tools-extra.cjs');

test('edit_file exige unicidad por defecto', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'og-edit-'));
  try {
    const ruta = join(dir, 'a.txt');
    await writeFile(ruta, 'a a a', 'utf8');
    const tool = makeEditFileTool(() => dir);
    const resultado = await tool.execute({ path: 'a.txt', oldText: 'a', newText: 'b' });
    assert.equal(resultado.isError, true);
    assert.match(resultado.content, /3 veces/);
    assert.equal(await readFile(ruta, 'utf8'), 'a a a');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('edit_file con allowMultiple reemplaza todas las apariciones', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'og-edit-'));
  try {
    const ruta = join(dir, 'a.txt');
    await writeFile(ruta, 'a a a', 'utf8');
    const tool = makeEditFileTool(() => dir);
    const resultado = await tool.execute({
      path: 'a.txt',
      oldText: 'a',
      newText: 'b',
      allowMultiple: true,
    });
    assert.equal(resultado.isError, undefined);
    assert.match(resultado.content, /3 apariciones/);
    assert.equal(await readFile(ruta, 'utf8'), 'b b b');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('edit_file con edits[] aplica varios tramos de una vez', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'og-edit-'));
  try {
    const ruta = join(dir, 'a.txt');
    await writeFile(ruta, 'uno\ndos\ntres', 'utf8');
    const tool = makeEditFileTool(() => dir);
    const resultado = await tool.execute({
      path: 'a.txt',
      edits: [
        { startLine: 1, endLine: 1, targetContent: 'uno', replacementContent: 'UNO' },
        { startLine: 3, endLine: 3, targetContent: 'tres', replacementContent: 'TRES' },
      ],
    });
    assert.equal(resultado.isError, undefined);
    assert.match(resultado.content, /2 tramos/);
    assert.equal(await readFile(ruta, 'utf8'), 'UNO\ndos\nTRES');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('edit_file acepta alias Target y Replacement y tolera CRLF/LF', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'og-edit-'));
  try {
    const ruta = join(dir, 'a.txt');
    await writeFile(ruta, 'primera\r\nsegunda\r\ntercera', 'utf8');
    const tool = makeEditFileTool(() => dir);
    const resultado = await tool.execute({
      Path: 'a.txt',
      Target: 'segunda\ntercera',
      Replacement: 'dos\ntres',
    });
    assert.equal(resultado.isError, undefined);
    assert.match(resultado.content, /Editado a\.txt/);
    const contenido = await readFile(ruta, 'utf8');
    assert.ok(contenido.includes('dos\r\ntres'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('edit_file no interpreta $& del texto nuevo como grupo de reemplazo', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'og-edit-'));
  try {
    const ruta = join(dir, 'a.txt');
    await writeFile(ruta, 'valor', 'utf8');
    const tool = makeEditFileTool(() => dir);
    const resultado = await tool.execute({
      path: 'a.txt',
      oldText: 'valor',
      newText: 'literal $& y $$ y $1',
    });
    assert.equal(resultado.isError, undefined);
    assert.equal(await readFile(ruta, 'utf8'), 'literal $& y $$ y $1');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
