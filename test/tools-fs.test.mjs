import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileTool } from '../dist/tools/fs.js';

test('read_file rechaza rangos y maxBytes no numéricos', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'og-fs-'));
  try {
    const ruta = join(dir, 'a.txt');
    await writeFile(ruta, 'uno\ndos\n', 'utf8');
    const rango = await readFileTool.execute(
      { path: 'a.txt', startLine: 'abc' },
      { cwd: dir },
    );
    assert.equal(rango.isError, true);
    assert.match(rango.content, /startLine/);

    const bytes = await readFileTool.execute(
      { path: 'a.txt', maxBytes: 'muchos' },
      { cwd: dir },
    );
    assert.equal(bytes.isError, true);
    assert.match(bytes.content, /maxBytes/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
