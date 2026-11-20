import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { validarUrlPublica, descargarTexto } = require('../electron/red-segura.cjs');

test('un dominio que resuelve a loopback se rechaza y no se descarga', async () => {
  const server = http.createServer((req, res) => res.end('secreto-local'));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    const url = `http://foo.127.0.0.1.nip.io:${port}/`;
    const validacion = await validarUrlPublica(url);
    assert.equal(validacion.ok, false);
    const descarga = await descargarTexto(url, { maxBytes: 100 });
    assert.equal(descarga.ok, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
