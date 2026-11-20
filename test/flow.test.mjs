import test from 'node:test';
import assert from 'node:assert/strict';

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const {
  generarEnFlow,
  escribirPrompt,
  comprobarQueEsImagen,
  guardarImagen,
  URL_FLOW,
  ESPERA_IMAGEN_MS,
} = require('../electron/flow.cjs');

/**
 * Ventana falsa: imita lo mínimo de un BrowserWindow para poder probar el flujo
 * sin Electron ni una cuenta de Google.
 */
function ventanaFalsa({ url = 'https://flow.google.com/', respuestas = {}, navegaA = null, aceptaTexto = true } = {}) {
  const llamadas = [];
  let cargada = url;
  let textoEditor = '';

  return {
    llamadas,
    isDestroyed: () => false,
    webContents: {
      getURL: () => cargada,
      // Entrada real del navegador: es la única que el editor de Flow acepta.
      escrituras: [],
      seleccionado: false,
      selectAll() {
        this.seleccionado = true;
      },
      insertText(texto) {
        this.escrituras.push(texto);
        if (aceptaTexto) textoEditor = texto;
      },
      // El clic de generar usa entrada de ratón real, no eventos sintéticos.
      entrada: [],
      sendInputEvent(ev) {
        this.entrada.push(ev);
      },
      executeJavaScript: async (script) => {
        llamadas.push(script);
        // Cada guion se identifica por un fragmento suyo.
        if (script.includes('texto-en-editor')) {
          return { ok: aceptaTexto, leidos: [textoEditor] };
        }
        // El selector de modo es obligatorio antes de generar.
        if (script.includes('Activador de ajustes')) return respuestas.ajustes ?? { ok: true };
        if (script.includes('imagen.click')) {
          return respuestas.modo ?? { ok: true, etiqueta: 'Imagen', marcadoAntes: true };
        }
        if (script.includes('activos.some')) {
          return respuestas.modoConfirmado ?? {
            ok: true,
            enImagen: true,
            modelo: 'Nano Banana',
          };
        }
        if (script.includes('sin selector de modelo')) {
          return respuestas.selectorModelo ?? { ok: true, actual: 'Nano Banana' };
        }
        if (script.includes('modelos: items.map')) {
          return respuestas.modeloFinal ?? { ok: true, modelo: 'Nano Banana' };
        }
        if (script.includes('yaHayEditor')) return respuestas.editor ?? { ok: true, yaDentro: true };
        if (script.includes('sin-caja')) return respuestas.escribir ?? { ok: true };
        if (script.includes('sin boton de generar')) return respuestas.pulsar ?? { ok: true, x: 100, y: 200 };
        // Reintento de espera del editor: solo devuelve el recuento.
        if (script.includes("todos('textarea').length")) return respuestas.listo ?? true;
        if (script.includes('accounts')) return respuestas.login ?? false;
        if (script.includes('currentSrc')) return respuestas.imagenes ?? [];
        return null;
      },
    },
    async loadURL(u) {
      cargada = navegaA ?? u;
      llamadas.push(`loadURL:${u}`);
    },
  };
}

test('URL_FLOW apunta a la portada de Flow', () => {
  // Medido: labs.google redirige a flow.google.com, que es la portada; el editor
  // está en /project/<uuid> y se entra desde ahí.
  assert.match(URL_FLOW, /flow\.google\.com/);
});

test('sin prompt es error', async () => {
  const r = await generarEnFlow(ventanaFalsa(), { prompt: '   ' });
  assert.equal(r.ok, false);
  assert.match(r.error, /vacío/);
});

test('sin ventana es error', async () => {
  const r = await generarEnFlow(null, { prompt: 'un gato' });
  assert.equal(r.ok, false);
  assert.match(r.error, /navegador/);
});

test('si pide login lo dice en vez de fallar por falta de caja', async () => {
  const r = await generarEnFlow(ventanaFalsa({ respuestas: { login: true } }), { prompt: 'un gato' });
  assert.equal(r.ok, false);
  assert.match(r.error, /iniciar sesión/i);
});

test('si Flow redirige a la pantalla de acceso, no espera al editor', async () => {
  const login = 'https://accounts.google.com/v3/signin/identifier';
  const win = ventanaFalsa({ url: login, navegaA: login });
  const r = await generarEnFlow(win, { prompt: 'un gato' });
  assert.equal(r.ok, false);
  assert.match(r.error, /Ajustes > Google/i);
  assert.match(r.error, /Conectar/i);
});

test('si no encuentra la caja de prompt lo dice', async () => {
  const r = await generarEnFlow(
    ventanaFalsa({ respuestas: { escribir: { ok: false, error: 'sin-caja' } } }),
    { prompt: 'un gato' },
  );
  assert.equal(r.ok, false);
  assert.match(r.error, /caja de prompt/);
});

test('si no encuentra el botón lo dice', async () => {
  const r = await generarEnFlow(
    ventanaFalsa({ respuestas: { pulsar: { ok: false, error: 'sin-boton' } } }),
    { prompt: 'un gato' },
  );
  assert.equal(r.ok, false);
  assert.match(r.error, /botón de generar/);
});

test('sin imagen nueva avisa del límite o de la espera', async () => {
  const r = await generarEnFlow(ventanaFalsa(), { prompt: 'un gato', esperaMs: 1 });
  assert.equal(r.ok, false);
  assert.match(r.error, /ninguna imagen nueva/);
});

test('con imagen nueva devuelve su URL', async () => {
  // La URL se valida descargándola: se sirve un PNG mínimo.
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg',
    'base64',
  );
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    arrayBuffer: async () => png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength),
  });

  let llamada = 0;
  const win = ventanaFalsa();
  // La primera lectura son las previas; la segunda ya trae la nueva.
  const base = win.webContents.executeJavaScript;
  win.webContents.executeJavaScript = async (script) => {
    if (script.includes('currentSrc')) {
      llamada += 1;
      return llamada === 1 ? ['https://x/vieja.png'] : ['https://x/vieja.png', 'https://x/nueva.png'];
    }
    return base(script);
  };

  const r = await generarEnFlow(win, { prompt: 'un gato', esperaMs: 10_000 });
  assert.equal(r.ok, true);
  assert.equal(r.url, 'https://x/nueva.png');
  globalThis.fetch = fetchOriginal;
});

test('escribe con entrada real del navegador, no manipulando el DOM', async () => {
  const win = ventanaFalsa();
  const r = await escribirPrompt(win, 'un gato');

  assert.equal(r.ok, true);
  // Medido: con textContent (o execCommand) el botón de generar se quedó
  // deshabilitado; solo la entrada real del navegador lo habilita siempre.
  assert.deepEqual(win.webContents.escrituras, ['un gato']);
  assert.equal(win.webContents.seleccionado, true, 'debe reemplazar el texto anterior');
});

test('si el editor no acepta el texto, falla en vez de esperar una imagen', async () => {
  const win = ventanaFalsa({ aceptaTexto: false });
  const r = await escribirPrompt(win, 'un gato');

  assert.equal(r.ok, false);
  assert.match(r.error, /no aceptó el texto/);
});

test('descarga la imagen con la sesión del navegador, no con fetch de Node', async () => {
  // Medido: https://flow.google.com/asb/… sin cookies devuelve 200 + HTML,
  // así que validar con el fetch de Node rechaza imágenes válidas.
  const webp = Buffer.from('RIFF0000WEBPVP8 ', 'ascii');
  const fetchOriginal = globalThis.fetch;
  let nodeLlamado = false;
  globalThis.fetch = async () => {
    nodeLlamado = true;
    return { ok: true, status: 200, arrayBuffer: async () => Buffer.from('<!DOCTYPE html>') };
  };

  const win = ventanaFalsa();
  win.webContents.session = {
    fetch: async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => webp.buffer.slice(webp.byteOffset, webp.byteOffset + webp.byteLength),
    }),
  };

  const r = await comprobarQueEsImagen(win, 'https://flow.google.com/asb/ANqv');
  assert.equal(r.ok, true);
  assert.equal(nodeLlamado, false, 'no debe caer al fetch sin sesión');

  globalThis.fetch = fetchOriginal;
});

test('guarda con la extensión que corresponde a los bytes', async () => {
  const fsp = await import('node:fs/promises');
  const os = await import('node:os');
  const path = await import('node:path');

  const webp = Buffer.from('RIFF0000WEBPVP8 ', 'ascii');
  const win = ventanaFalsa();
  win.webContents.session = {
    fetch: async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => webp.buffer.slice(webp.byteOffset, webp.byteOffset + webp.byteLength),
    }),
  };

  const carpeta = await fsp.mkdtemp(path.join(os.tmpdir(), 'flow-'));
  const ruta = await guardarImagen('https://flow.google.com/asb/ANqv', path.join(carpeta, 'imagen.png'), win);

  assert.match(ruta, /\.webp$/);
  assert.equal((await fsp.readFile(ruta)).length, webp.length);
  await fsp.rm(carpeta, { recursive: true, force: true });
});

test('si ya está en Flow no vuelve a navegar', async () => {
  const win = ventanaFalsa();
  await generarEnFlow(win, { prompt: 'un gato', esperaMs: 1 });
  assert.equal(win.llamadas.some((l) => l.startsWith('loadURL:')), false);
});

test('si no está en Flow navega a él', async () => {
  const win = ventanaFalsa({ url: 'https://ejemplo.com' });
  await generarEnFlow(win, { prompt: 'un gato', esperaMs: 1 });
  assert.ok(win.llamadas.some((l) => l === `loadURL:${URL_FLOW}`));
});

test('el tiempo de espera por defecto es razonable', () => {
  assert.ok(ESPERA_IMAGEN_MS >= 60_000);
});
