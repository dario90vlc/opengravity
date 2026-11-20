import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { iniciarProxyNavegador, detenerProxyNavegador } = require('../electron/browser-proxy.cjs');

test('el proxy del navegador rechaza un DNS que resuelve a loopback', async () => {
  const local = http.createServer((req, res) => res.end('secreto-local'));
  await new Promise((resolve) => local.listen(0, '127.0.0.1', resolve));
  const proxy = await iniciarProxyNavegador();
  const [host, puerto] = proxy.split(':');
  try {
    const { port } = local.address();
    const respuesta = await new Promise((resolve, reject) => {
      const peticion = http.request(
        {
          host,
          port: Number(puerto),
          path: `http://foo.127.0.0.1.nip.io:${port}/`,
          headers: { host: 'foo.127.0.0.1.nip.io' },
        },
        (res) => {
          let texto = '';
          res.on('data', (trozo) => (texto += trozo));
          res.on('end', () => resolve({ status: res.statusCode, texto }));
        },
      );
      peticion.on('error', reject);
      peticion.end();
    });
    assert.equal(respuesta.status, 403);
    assert.match(respuesta.texto, /local o privada/);
  } finally {
    local.close();
    detenerProxyNavegador();
  }
});
