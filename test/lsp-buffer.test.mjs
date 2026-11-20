import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { LspClient } = require('../electron/lsp.cjs');

test('LspClient conserva el último buffer enviado para aplicar ediciones', () => {
  const client = new LspClient({ language: 'python', rootPath: '/ws' });
  const uri = 'file:///ws/a.py';
  client.didOpen(uri, 'uno');
  assert.equal(client.textoDe(uri), 'uno');
  client.didChange(uri, 'uno dos');
  assert.equal(client.textoDe(uri), 'uno dos');
  assert.equal(client.textoDe('file:///ws/otro.py'), undefined);
  client.stop();
  assert.equal(client.textoDe(uri), undefined);
});
