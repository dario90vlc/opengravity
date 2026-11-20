import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const code = readFileSync(new URL('../renderer/markdown.js', import.meta.url), 'utf8');
const context = { window: {} };
vm.createContext(context);
vm.runInContext(code, context);
const Markdown = context.window.Markdown;

test('encabezados pegados a texto previo se separan y renderizan como h2', () => {
  const md = 'Voy a ver primero qué hay en el directorio de trabajo.## Escritorio: C:\\Desktop (~45 GB)';
  const html = Markdown.render(md);
  assert.match(html, /<p class="md-p">Voy a ver primero qué hay en el directorio de trabajo\.<\/p>/);
  assert.match(html, /<h2 class="md-h md-h2">Escritorio: C:\\Desktop \(~45 GB\)<\/h2>/);
});

test('tablas estándar con pipes en los extremos renderizan correctamente', () => {
  const md = [
    '| Columna 1 | Columna 2 |',
    '| --- | --- |',
    '| Valor A | Valor B |',
    '| Valor C | Valor D |',
  ].join('\n');
  const html = Markdown.render(md);
  assert.match(html, /<table class="md-table">/);
  assert.match(html, /<th>Columna 1<\/th><th>Columna 2<\/th>/);
  assert.match(html, /<td>Valor A<\/td><td>Valor B<\/td>/);
  assert.match(html, /<td>Valor C<\/td><td>Valor D<\/td>/);
});

test('tablas sin pipes en los extremos (como en respuestas LLM GFM) renderizan todas las filas en el tbody', () => {
  const md = [
    'Carpeta | Tamaño | Contenido',
    '--- | --- | ---',
    'VOZ LOCAL | 18,3 GB | Lo más pesado. Python (`motor.py`, `medir.py`)',
    'emulador android | 10,9 GB | Emulador (imágenes de sistema)',
    'MEDIA | 8,3 GB | `stem/`, `youtube-studio-90d/`',
  ].join('\n');
  const html = Markdown.render(md);

  assert.match(html, /<div class="md-table-scroll"><table class="md-table">/);
  assert.match(html, /<thead><tr><th>Carpeta<\/th><th>Tamaño<\/th><th>Contenido<\/th><\/tr><\/thead>/);
  assert.match(html, /<td>VOZ LOCAL<\/td><td>18,3 GB<\/td><td>Lo más pesado\. Python \(<code class="md-code">motor\.py<\/code>, <code class="md-code">medir\.py<\/code>\)<\/td>/);
  assert.match(html, /<td>emulador android<\/td><td>10,9 GB<\/td><td>Emulador \(imágenes de sistema\)<\/td>/);
  assert.match(html, /<td>MEDIA<\/td><td>8,3 GB<\/td><td><code class="md-code">stem\/<\/code>, <code class="md-code">youtube-studio-90d\/<\/code><\/td>/);
  // Ninguna fila debe haber caído fuera de la tabla en un <p>
  assert.doesNotMatch(html, /<p class="md-p">VOZ LOCAL/);
});

test('los enlaces file:// del agente se conservan para abrir el editor', () => {
  const html = Markdown.render('[src/app.ts](file:///C:/proyecto/src/app.ts#L10-L20)');
  assert.match(html, /href="file:\/\/\/C:\/proyecto\/src\/app\.ts#L10-L20"/);
  assert.match(html, />src\/app\.ts<\/a>/);
});

test('un esquema no permitido no se convierte en enlace ejecutable', () => {
  const html = Markdown.render('[pulsa](javascript:alert(1))');
  assert.doesNotMatch(html, /href="javascript:/i);
});
