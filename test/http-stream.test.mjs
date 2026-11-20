import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { fetchWithRetry } from '../dist/providers/http.js';

test('el timeout de cabeceras no corta un cuerpo SSE largo', async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.flushHeaders();
    res.write('data: uno\n\n');
    setTimeout(() => res.end('data: dos\n\n'), 250);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    const response = await fetchWithRetry(
      `http://127.0.0.1:${port}/stream`,
      {},
      'test',
      { timeoutMs: 100, retries: 0 },
    );
    assert.equal(await response.text(), 'data: uno\n\ndata: dos\n\n');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
