'use strict';

const { makeEditNotebookTool } = require('./notebook.cjs');
const { dentroDelWorkspace, dentroDeRaices, sanearEntorno } = require('./hooks.cjs');
const { argumentosGuardWin, argumentosHelperWin, limitesDeSandbox, obtenerHelperWin, prefijoPosix } = require('./sandbox.cjs');
const { validarUrlPublica, descargarTexto } = require('./red-segura.cjs');
const { configurarProxyNavegador, detenerProxyNavegador } = require('./browser-proxy.cjs');

/**
 * Herramientas propias del proceso principal.
 *
 * Viven aquí y no en `src/tools` porque necesitan APIs de Electron
 * (`shell`, `BrowserWindow`) y las preferencias del usuario.
 */

/*
 * Electron no está disponible cuando estas fábricas se usan desde el CLI en
 * Node. Las herramientas que lo necesitan (navegador, abrir URL, Flow) no se
 * registran en ese contexto; las de fichero, búsqueda y comandos funcionan.
 */
let shell;
let BrowserWindow;
try {
  const electron = require('electron');
  if (electron && typeof electron === 'object') {
    shell = electron.shell;
    BrowserWindow = electron.BrowserWindow;
  }
} catch {
  // CLI sin Electron
}

/** Carpetas que no aportan a una búsqueda de código ni de nombres. */
const CARPETAS_IGNORADAS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', '.next', 'target', '__pycache__',
  '.venv', 'venv', 'vendor', 'coverage', '.worktrees', '.idea', '.vscode',
]);

/**
 * Coincidencia de globs para `includes`/`excludes` de búsqueda.
 * Cubre `*`, `**` y `?` sin añadir dependencias.
 */
function coincideGlob(patron, ruta) {
  const normal = (valor) => String(valor ?? '').replace(/\\/g, '/').replace(/^\.\//, '');
  const p = normal(patron).trim();
  const r = normal(ruta).trim();
  if (p.length === 0 || r.length === 0) return false;
  const escapar = (texto) => texto.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  // `**/` también vale con cero directorios: `src/**/*.ts` casa con `src/a.ts`.
  const cuerpo = p
    .replace(/\*\*\//g, '\u0001')
    .split('**')
    .map((trozo) => escapar(trozo).replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]'))
    .join('.*')
    .replace(/\u0001/g, '(?:.*/)?');
  const ancla = p.includes('/') ? `^${cuerpo}$` : `(^|.*/)${cuerpo}$`;
  return new RegExp(ancla, 'i').test(r);
}

/**
 * Comprueba una URL contra las listas de permitidas y denegadas.
 *
 * Regla: primero gana la denegada (más específica o no), después la permitida.
 * Si no hay ninguna permitida configurada, todo lo que no esté denegado pasa.
 */
function isUrlAllowed(url, rules, opciones = {}) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { allowed: false, reason: 'URL no válida' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { allowed: false, reason: `protocolo no permitido: ${parsed.protocol}` };
  }

  const host = parsed.hostname.toLowerCase();
  const normalize = (entry) => String(entry).trim().toLowerCase().replace(/^\*\.?/, '');
  const matches = (list) =>
    (list ?? []).map(normalize).filter(Boolean).some((entry) => host === entry || host.endsWith(`.${entry}`));

  const deny = rules?.deny ?? [];
  const allow = rules?.allow ?? [];

  if (matches(deny)) {
    return { allowed: false, reason: `${host} está en la lista de denegadas` };
  }

  /*
   * Sin esto, `fetch_url('http://169.254.169.254/...')` o localhost podía
   * alcanzar servicios locales. Si el usuario lo permite explícitamente en
   * `allow`, se respeta.
   */
  const loopback = host === 'localhost' || host === '::1' || host === '[::1]' || /^127\./.test(host);
  const privada =
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^(fc|fd)[0-9a-f]{2}:/i.test(host) ||
    /^fe80:/i.test(host);
  if ((loopback || privada) && !opciones.allowLocal && !matches(allow)) {
    return {
      allowed: false,
      reason: `${host} es una dirección local o privada; añádela a la lista de permitidas para acceder`,
    };
  }

  if (allow.length > 0 && !matches(allow)) {
    return { allowed: false, reason: `${host} no está en la lista de permitidas` };
  }

  return { allowed: true, reason: null };
}

/** Herramienta: descarga una URL de texto respetando las reglas de red. */
function makeFetchUrlTool(getPrefs) {
  return {
    name: 'fetch_url',
    description:
      'Descarga el contenido de una URL http(s) y devuelve el texto. ' +
      'Respeta las reglas de acceso a red configuradas en Ajustes.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL absoluta a descargar.' },
        maxBytes: { type: 'number', description: 'Máximo de bytes a devolver. Por defecto 200000.' },
      },
      required: ['url'],
    },
    async execute(args) {
      const url = String(args.url ?? '');
      const prefs = getPrefs();
      const verdict = isUrlAllowed(url, prefs.networkRules);

      if (!verdict.allowed) {
        return { content: `Acceso denegado: ${verdict.reason}`, isError: true };
      }

      const maxBytesRaw = Number(args.maxBytes ?? 200_000);
      if (!Number.isFinite(maxBytesRaw) || maxBytesRaw <= 0) {
        return { content: '`maxBytes` debe ser un número positivo.', isError: true };
      }
      const maxBytes = Math.floor(maxBytesRaw);
      const descarga = await descargarTexto(url, {
        headers: { 'user-agent': 'agent-ide/0.1' },
        maxBytes,
      });
      if (!descarga.ok) {
        return { content: `Acceso denegado: ${descarga.error}`, isError: true };
      }
      if (descarga.status < 200 || descarga.status >= 300) {
        return { content: `HTTP ${descarga.status} al pedir ${url}`, isError: true };
      }
      return { content: descarga.texto || '(sin contenido)' };
    },
  };
}

/** Herramienta: abre una URL en el navegador integrado o en el del sistema. */
function makeOpenUrlTool(getPrefs) {
  return {
    name: 'open_url',
    description:
      'Abre una URL. Según la preferencia «Open Links In» se abre en el navegador ' +
      'integrado o en el navegador del sistema.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL absoluta a abrir.' },
      },
      required: ['url'],
    },
    async execute(args) {
      const url = String(args.url ?? '');
      const prefs = getPrefs();
      const verdict = isUrlAllowed(url, prefs.networkRules);

      if (!verdict.allowed) {
        return { content: `Acceso denegado: ${verdict.reason}`, isError: true };
      }

      const publica = await validarUrlPublica(url);
      if (!publica.ok) {
        return { content: `Acceso denegado: ${publica.error}`, isError: true };
      }

      if (prefs.openLinksIn === 'Built-in Browser') {
        await openBuiltInBrowser(url);
        return { content: `Abierta ${url} en el navegador integrado.` };
      }

      await shell.openExternal(url);
      return { content: `Abierta ${url} en el navegador del sistema.` };
    },
  };
}

/** Ventana reutilizable del navegador del agente (sin sesión de Google). */
let builtInBrowser = null;
/** Ventana separada para Flow; conserva su propia sesión de Google. */
let builtInFlowBrowser = null;
const PARTICION_AGENTE = 'persist:opengravity-agent-browser';
const PARTICION_FLOW = 'persist:opengravity-flow';

/**
 * Abre el navegador integrado.
 *
 * `oculto` lo crea sin ventana visible: así `generate_image` puede manejar Flow
 * por detrás, sin que el usuario vea nada. El navegador sigue existiendo y
 * ejecutando JS con normalidad.
 */
async function openBuiltInBrowser(url, opciones = {}) {
  const oculto = opciones.oculto === true;
  const flow = opciones.flow === true;
  const actual = flow ? builtInFlowBrowser : builtInBrowser;

  if (actual && !actual.isDestroyed()) {
    if (!flow) await configurarProxyNavegador(actual.webContents.session);
    if (!oculto && !actual.isVisible()) actual.show();
    actual.loadURL(url);
    if (!oculto) actual.focus();
    return waitForLoad(actual);
  }

  const ventana = new BrowserWindow({
    width: 1100,
    height: 800,
    show: !oculto,
    backgroundColor: '#101010',
    title: url,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      /*
       * El navegador del agente no comparte cookies con la sesión Google del
       * usuario. Flow tiene una partición propia, separada también del panel
       * de navegación normal.
       */
      partition: flow ? PARTICION_FLOW : PARTICION_AGENTE,
      /*
       * Sin esto, Chromium frena las ventanas invisibles: React no pinta y el
       * DOM aparece vacío, así que no se encuentran ni botones ni cajas.
       */
      backgroundThrottling: false,
    },
  });

  if (!flow) await configurarProxyNavegador(ventana.webContents.session);
  ventana.loadURL(url);
  ventana.on('closed', () => {
    if (flow) builtInFlowBrowser = null;
    else builtInBrowser = null;
  });
  if (flow) builtInFlowBrowser = ventana;
  else builtInBrowser = ventana;

  return waitForLoad(ventana);
}

/** Espera a que la ventana termine de cargar (máximo 20 s). */
function waitForLoad(win) {
  return new Promise((resolve) => {
    if (!win || win.isDestroyed()) {
      resolve(false);
      return;
    }

    if (!win.webContents.isLoading()) {
      resolve(true);
      return;
    }

    const timer = setTimeout(() => {
      cleanup();
      resolve(false);
    }, 20000);

    const onLoad = () => {
      cleanup();
      resolve(true);
    };

    const cleanup = () => {
      clearTimeout(timer);
      try {
        win.webContents.off('did-finish-load', onLoad);
      } catch {
        // ventana cerrada
      }
    };

    win.webContents.once('did-finish-load', onLoad);
  });
}

/** Ejecuta JS en el navegador integrado y devuelve el resultado serializado. */
async function evalInBrowser(script) {
  if (!builtInBrowser || builtInBrowser.isDestroyed()) {
    return { ok: false, error: 'no hay navegador integrado abierto' };
  }

  try {
    const value = await builtInBrowser.webContents.executeJavaScript(script, true);
    return { ok: true, value };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Herramientas del subagente de navegador.
 * Todas respetan las reglas de red y la política de ejecución de JavaScript.
 */
function makeBrowserTools(getPrefs, askUser) {
  const requirePage = () => {
    if (!builtInBrowser || builtInBrowser.isDestroyed()) {
      return 'No hay navegador abierto. Usa browser_open primero.';
    }
    return null;
  };

  /**
   * Expresión JS que resuelve el elemento interactivo. Antigravity prefiere el
   * UID estable del HUD; el selector CSS sigue sirviendo de respaldo.
   */
  const elementoDe = (args) => {
    const uid = String(args?.uid ?? '').trim();
    if (uid.length > 0) {
      return `document.querySelector('[data-agy-uid="' + CSS.escape(${JSON.stringify(uid)}) + '"]')`;
    }
    const x = Number(args?.x);
    const y = Number(args?.y);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      return `document.elementFromPoint((${x} / 1000) * window.innerWidth, (${y} / 1000) * window.innerHeight)`;
    }
    return `document.querySelector(${JSON.stringify(String(args?.selector ?? ''))})`;
  };

  const etiquetaDe = (args) => {
    const uid = String(args?.uid ?? '').trim();
    if (uid.length > 0) return `UID ${uid}`;
    if (Number.isFinite(Number(args?.x)) && Number.isFinite(Number(args?.y))) {
      return `coordenadas ${args.x},${args.y}`;
    }
    return String(args?.selector ?? '');
  };

  const tools = [
    {
      name: 'browser_open',
      description:
        'Abre una URL en el navegador integrado y espera a que cargue. ' +
        'Después puedes leer su contenido o interactuar con ella.',
      parameters: {
        type: 'object',
        properties: { url: { type: 'string', description: 'URL http(s) a abrir.' } },
        required: ['url'],
      },
      async execute(args) {
        const url = String(args.url ?? '');
        const verdict = isUrlAllowed(url, getPrefs().networkRules);
        if (!verdict.allowed) {
          return { content: `Acceso denegado: ${verdict.reason}`, isError: true };
        }
        const publica = await validarUrlPublica(url);
        if (!publica.ok) {
          return { content: `Acceso denegado: ${publica.error}`, isError: true };
        }

        const loaded = await openBuiltInBrowser(url);
        return {
          content: loaded ? `Abierta ${url}.` : `Abierta ${url}, pero no terminó de cargar en 20 s.`,
        };
      },
    },

    {
      name: 'browser_read',
      description:
        'Devuelve el texto visible de la página abierta y su título. Úsalo para leer qué hay en pantalla.',
      parameters: {
        type: 'object',
        properties: {
          maxChars: { type: 'number', description: 'Máximo de caracteres. Por defecto 6000.' },
        },
        required: [],
      },
      async execute(args) {
        const missing = requirePage();
        if (missing) return { content: missing, isError: true };

        const maxChars = Number(args.maxChars ?? 6000);
        const result = await evalInBrowser(`(() => ({
          title: document.title,
          url: location.href,
          text: document.body ? document.body.innerText : ''
        }))()`);

        if (!result.ok) return { content: result.error, isError: true };

        const { title, url, text } = result.value ?? {};
        const body = String(text ?? '').trim();
        const clipped = body.length > maxChars ? `${body.slice(0, maxChars)}
[truncado]` : body;

        return { content: `# ${title}
${url}

${clipped || '(sin texto visible)'}` };
      },
    },

    {
      name: 'browser_click',
      description:
        'Hace clic en un elemento por UID del HUD (preferido), selector CSS o coordenadas ' +
        'normalizadas [0,1000].',
      parameters: {
        type: 'object',
        properties: {
          uid: { type: 'string', description: 'UID devuelto por browser_snapshot.' },
          selector: { type: 'string', description: 'Selector CSS del elemento.' },
          x: { type: 'number', description: 'Coordenada X normalizada 0-1000.' },
          y: { type: 'number', description: 'Coordenada Y normalizada 0-1000.' },
        },
        required: [],
      },
      async execute(args) {
        const missing = requirePage();
        if (missing) return { content: missing, isError: true };

        const etiqueta = etiquetaDe(args);
        if (etiqueta.length === 0) return { content: 'Falta uid, selector o coordenadas.', isError: true };

        const result = await evalInBrowser(
          `(() => { const el = ${elementoDe(args)}; ` +
            `if (!el) return { found: false }; el.click(); return { found: true, tag: el.tagName.toLowerCase(), uid: el.getAttribute('data-agy-uid') }; })()`,
        );

        if (!result.ok) return { content: result.error, isError: true };
        if (!result.value?.found) {
          return { content: `No se encontró ningún elemento con ${etiqueta}.`, isError: true };
        }

        return { content: `Clic hecho en ${etiqueta} (${result.value.tag}).` };
      },
    },

    {
      name: 'browser_eval',
      description:
        'Ejecuta JavaScript en la página abierta y devuelve el resultado. ' +
        'Puede pedir aprobación antes de ejecutar.',
      parameters: {
        type: 'object',
        properties: { script: { type: 'string', description: 'Expresión JavaScript.' } },
        required: ['script'],
      },
      async execute(args) {
        const script = String(args.script ?? '');
        if (script.length === 0) return { content: 'Falta el script.', isError: true };

        const verdict = await browserEvaluate(script, getPrefs(), askUser);
        if (!verdict.ok) return { content: verdict.error, isError: true };

        const serialized = JSON.stringify(verdict.value, null, 2) ?? 'undefined';
        return {
          content: serialized.length > 8000 ? `${serialized.slice(0, 8000)}
[truncado]` : serialized,
        };
      },
    },

    {
      name: 'browser_navigate',
      description:
        'Navega la pestaña del navegador integrado a otra URL y espera a que cargue. ' +
        'Usa browser_open para abrir el navegador la primera vez.',
      parameters: {
        type: 'object',
        properties: { url: { type: 'string', description: 'URL http(s) de destino.' } },
        required: ['url'],
      },
      async execute(args) {
        const url = String(args.url ?? '');
        const verdict = isUrlAllowed(url, getPrefs().networkRules);
        if (!verdict.allowed) {
          return { content: `Acceso denegado: ${verdict.reason}`, isError: true };
        }
        const publica = await validarUrlPublica(url);
        if (!publica.ok) {
          return { content: `Acceso denegado: ${publica.error}`, isError: true };
        }

        if (!builtInBrowser || builtInBrowser.isDestroyed()) {
          const abierto = await openBuiltInBrowser(url);
          return {
            content: abierto
              ? `Abierta ${url}.`
              : `Abierta ${url}, pero no terminó de cargar en 20 s.`,
          };
        }

        try {
          await builtInBrowser.loadURL(url);
          const cargada = await waitForLoad(builtInBrowser);
          return {
            content: cargada
              ? `Navegada a ${url}.`
              : `Navegada a ${url}, pero no terminó de cargar en 20 s.`,
          };
        } catch (error) {
          return { content: `No se pudo navegar: ${error.message}`, isError: true };
        }
      },
    },

    {
      name: 'browser_snapshot',
      description:
        'Lista los elementos interactivos visibles con un UID estable, selector CSS, texto y ' +
        'posición. Prefiere el UID para clicar o rellenar; el selector sigue disponible.',
      parameters: {
        type: 'object',
        properties: {
          maxItems: { type: 'number', description: 'Máximo de elementos (40 por defecto, tope 120).' },
        },
        required: [],
      },
      async execute(args) {
        const missing = requirePage();
        if (missing) return { content: missing, isError: true };

        const limite = Math.min(120, Math.max(1, Number(args.maxItems ?? 40)));
        const result = await evalInBrowser(`(() => {
          const ruta = (el) => {
            if (el.id) return '#' + CSS.escape(el.id);
            const partes = [];
            let n = el;
            while (n && n.nodeType === 1 && n !== document.body) {
              let parte = n.tagName.toLowerCase();
              if (n.parentElement) {
                const hermanos = [...n.parentElement.children].filter((x) => x.tagName === n.tagName);
                if (hermanos.length > 1) parte += ':nth-of-type(' + (hermanos.indexOf(n) + 1) + ')';
              }
              partes.unshift(parte);
              n = n.parentElement;
            }
            return partes.join(' > ');
          };
          const visibles = [...document.querySelectorAll(
            'a,button,input,textarea,select,[role="button"],[role="textbox"],[contenteditable="true"]',
          )]
            .filter((el) => el.offsetParent !== null && !el.disabled)
            .filter((el) => {
              const r = el.getBoundingClientRect();
              return r.width > 0 && r.height > 0;
            })
            .slice(0, ${limite});
          let siguiente = 0;
          for (const previo of document.querySelectorAll('[data-agy-uid]')) {
            const numero = Number(String(previo.getAttribute('data-agy-uid') || '').replace(/^e/, ''));
            if (Number.isFinite(numero)) siguiente = Math.max(siguiente, numero);
          }
          return visibles.map((el) => {
            const r = el.getBoundingClientRect();
            let uid = el.getAttribute('data-agy-uid');
            if (!uid) {
              uid = 'e' + (++siguiente);
              el.setAttribute('data-agy-uid', uid);
            }
            return {
              uid,
              selector: ruta(el),
              tag: el.tagName.toLowerCase(),
              type: el.getAttribute('type') || null,
              text: (el.innerText || el.value || '').replace(/\\s+/g, ' ').trim().slice(0, 80),
              placeholder: el.getAttribute('placeholder'),
              aria: el.getAttribute('aria-label'),
              href: el.getAttribute('href'),
              x: Math.round(r.x), y: Math.round(r.y),
              w: Math.round(r.width), h: Math.round(r.height),
            };
          });
        })()`);

        if (!result.ok) return { content: result.error, isError: true };
        const items = Array.isArray(result.value) ? result.value : [];
        if (items.length === 0) return { content: 'No hay elementos interactivos visibles.' };

        const lineas = items.map((e, i) => {
          const extra = [
            e.type ? `type=${e.type}` : '',
            e.text ? `«${e.text}»` : '',
            e.placeholder ? `placeholder="${e.placeholder}"` : '',
            e.aria ? `aria="${e.aria}"` : '',
            e.href ? `href="${e.href}"` : '',
          ].filter(Boolean).join(' · ');
          return `${i + 1}. [${e.uid}] ${e.selector} · <${e.tag}> · ${extra || '(sin texto)'} · @(${e.x},${e.y}) ${e.w}x${e.h}`;
        });
        return { content: lineas.join('\n') };
      },
    },

    {
      name: 'browser_fill',
      description:
        'Escribe texto en un campo (input, textarea, select o contenteditable) y avisa a la ' +
        'página con los eventos input/change, como si el usuario lo hubiera escrito.',
      parameters: {
        type: 'object',
        properties: {
          uid: { type: 'string', description: 'UID devuelto por browser_snapshot.' },
          selector: { type: 'string', description: 'Selector CSS del campo.' },
          text: { type: 'string', description: 'Texto a escribir.' },
        },
        required: ['text'],
      },
      async execute(args) {
        const missing = requirePage();
        if (missing) return { content: missing, isError: true };

        const etiqueta = etiquetaDe(args);
        const texto = String(args.text ?? '');
        if (etiqueta.length === 0) return { content: 'Falta uid o selector.', isError: true };

        const result = await evalInBrowser(`(() => {
          const el = ${elementoDe(args)};
          if (!el) return { found: false };
          el.focus();
          if (el.tagName === 'SELECT') {
            el.value = ${JSON.stringify(texto)};
          } else if (el.isContentEditable) {
            el.textContent = ${JSON.stringify(texto)};
          } else {
            const proto = el instanceof HTMLTextAreaElement
              ? HTMLTextAreaElement.prototype
              : HTMLInputElement.prototype;
            const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
            setter.call(el, ${JSON.stringify(texto)});
          }
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return { found: true, tag: el.tagName.toLowerCase(), valor: String(el.value ?? el.textContent ?? '') };
        })()`);

        if (!result.ok) return { content: result.error, isError: true };
        if (!result.value?.found) {
          return { content: `No se encontró ningún campo con ${etiqueta}.`, isError: true };
        }
        return {
          content: `Campo ${etiqueta} rellenado con «${texto}» (${result.value.tag}).`,
        };
      },
    },

    {
      name: 'browser_type',
      description:
        'Escribe texto con entrada real del navegador en el elemento indicado (o en el que ya ' +
        'tiene el foco). Úsala cuando la página ignore el relleno programático (editores enriquecidos).',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Texto a escribir.' },
          uid: { type: 'string', description: 'UID devuelto por browser_snapshot.' },
          selector: { type: 'string', description: 'Selector CSS del campo. Opcional.' },
        },
        required: ['text'],
      },
      async execute(args) {
        const missing = requirePage();
        if (missing) return { content: missing, isError: true };

        const texto = String(args.text ?? '');
        const etiqueta = etiquetaDe(args);
        if (texto.length === 0) return { content: 'Falta el texto.', isError: true };

        if (etiqueta.length > 0) {
          const foco = await evalInBrowser(
            `(() => { const el = ${elementoDe(args)}; ` +
              'if (!el) return false; el.focus(); return true; })()',
          );
          if (!foco.ok) return { content: foco.error, isError: true };
          if (!foco.value) {
            return { content: `No se encontró ningún campo con ${etiqueta}.`, isError: true };
          }
        }

        const wc = builtInBrowser.webContents;
        if (!wc || typeof wc.insertText !== 'function') {
          return { content: 'El navegador no puede escribir texto en la página.', isError: true };
        }
        wc.insertText(texto);
        return { content: `Texto escrito con entrada real (${texto.length} caracteres).` };
      },
    },

    {
      name: 'browser_press',
      description:
        'Pulsa una tecla real en la página: Enter, Tab, Escape, Backspace, Delete, flechas, ' +
        'Home, End, PageUp, PageDown, Space o una letra/dígito.',
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Tecla a pulsar.' },
          uid: { type: 'string', description: 'UID devuelto por browser_snapshot. Opcional.' },
          selector: { type: 'string', description: 'Selector CSS del elemento que recibe el foco. Opcional.' },
        },
        required: ['key'],
      },
      async execute(args) {
        const missing = requirePage();
        if (missing) return { content: missing, isError: true };

        const tecla = String(args.key ?? '');
        const permitidas = [
          'Enter', 'Tab', 'Escape', 'Backspace', 'Delete',
          'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
          'Home', 'End', 'PageUp', 'PageDown', 'Space',
        ];
        if (!permitidas.includes(tecla) && !/^[A-Za-z0-9]$/.test(tecla)) {
          return { content: `Tecla no válida: «${tecla}».`, isError: true };
        }

        const etiqueta = etiquetaDe(args);
        if (etiqueta.length > 0) {
          const foco = await evalInBrowser(
            `(() => { const el = ${elementoDe(args)}; ` +
              'if (!el) return false; el.focus(); return true; })()',
          );
          if (!foco.ok) return { content: foco.error, isError: true };
          if (!foco.value) {
            return { content: `No se encontró ningún elemento con ${etiqueta}.`, isError: true };
          }
        }

        const wc = builtInBrowser.webContents;
        const keyCode = tecla === 'Space' ? ' ' : tecla;
        wc.sendInputEvent({ type: 'keyDown', keyCode });
        wc.sendInputEvent({ type: 'keyUp', keyCode });
        return { content: `Tecla ${tecla} pulsada.` };
      },
    },

    {
      name: 'browser_select',
      description: 'Selecciona una opción de un <select> por su valor.',
      parameters: {
        type: 'object',
        properties: {
          uid: { type: 'string', description: 'UID devuelto por browser_snapshot.' },
          selector: { type: 'string', description: 'Selector CSS del select.' },
          value: { type: 'string', description: 'Value de la opción.' },
        },
        required: ['value'],
      },
      async execute(args) {
        const missing = requirePage();
        if (missing) return { content: missing, isError: true };

        const etiqueta = etiquetaDe(args);
        const value = String(args.value ?? '');
        if (etiqueta.length === 0) return { content: 'Falta uid o selector.', isError: true };
        const result = await evalInBrowser(`(() => {
          const el = ${elementoDe(args)};
          if (!el || el.tagName !== 'SELECT') return { found: false };
          el.value = ${JSON.stringify(value)};
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return { found: true, valor: el.value };
        })()`);

        if (!result.ok) return { content: result.error, isError: true };
        if (!result.value?.found) {
          return { content: `No se encontró un <select> con ${etiqueta}.`, isError: true };
        }
        return { content: `Seleccionado «${result.value.valor}» en ${etiqueta}.` };
      },
    },

    {
      name: 'browser_scroll',
      description: 'Desplaza la página o un elemento concreto: dy positivo baja, negativo sube.',
      parameters: {
        type: 'object',
        properties: {
          dy: { type: 'number', description: 'Píxeles a desplazar. Por defecto 600.' },
          selector: { type: 'string', description: 'Selector CSS del contenedor. Opcional.' },
        },
        required: [],
      },
      async execute(args) {
        const missing = requirePage();
        if (missing) return { content: missing, isError: true };

        const dy = Number(args.dy ?? 600);
        const selector = String(args.selector ?? '');
        const result = await evalInBrowser(`(() => {
          const dy = ${Number.isFinite(dy) ? dy : 600};
          ${selector.length > 0
            ? `const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return { found: false }; el.scrollBy(0, dy); return { found: true, y: el.scrollTop };`
            : 'window.scrollBy(0, dy); return { found: true, y: window.scrollY };'}
        })()`);

        if (!result.ok) return { content: result.error, isError: true };
        if (!result.value?.found) {
          return { content: `No se encontró ningún contenedor con ${selector}.`, isError: true };
        }
        return { content: `Desplazado a y=${result.value.y}.` };
      },
    },

    {
      name: 'browser_hover',
      description:
        'Mueve el ratón real sobre un elemento por UID, selector o coordenadas normalizadas.',
      parameters: {
        type: 'object',
        properties: {
          uid: { type: 'string', description: 'UID devuelto por browser_snapshot.' },
          selector: { type: 'string', description: 'Selector CSS del elemento.' },
          x: { type: 'number', description: 'Coordenada X normalizada 0-1000.' },
          y: { type: 'number', description: 'Coordenada Y normalizada 0-1000.' },
        },
        required: [],
      },
      async execute(args) {
        const missing = requirePage();
        if (missing) return { content: missing, isError: true };

        const etiqueta = etiquetaDe(args);
        if (etiqueta.length === 0) return { content: 'Falta uid, selector o coordenadas.', isError: true };
        const result = await evalInBrowser(`(() => {
          const el = ${elementoDe(args)};
          if (!el) return { found: false };
          const r = el.getBoundingClientRect();
          return { found: true, x: r.x + r.width / 2, y: r.y + r.height / 2 };
        })()`);

        if (!result.ok) return { content: result.error, isError: true };
        if (!result.value?.found) {
          return { content: `No se encontró ningún elemento con ${etiqueta}.`, isError: true };
        }
        builtInBrowser.webContents.sendInputEvent({
          type: 'mouseMove',
          x: Math.round(result.value.x),
          y: Math.round(result.value.y),
        });
        return { content: `Ratón sobre ${etiqueta}.` };
      },
    },

    {
      name: 'browser_wait',
      description:
        'Espera hasta que aparezca un selector, un texto o una URL. Se para en cuanto se cumple.',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'Selector CSS que debe existir.' },
          text: { type: 'string', description: 'Texto que debe aparecer en la página.' },
          url: { type: 'string', description: 'Fragmento que debe contener la URL.' },
          timeoutMs: { type: 'number', description: 'Tiempo máximo en ms. Por defecto 10000.' },
        },
        required: [],
      },
      async execute(args) {
        const missing = requirePage();
        if (missing) return { content: missing, isError: true };

        const selector = String(args.selector ?? '');
        const texto = String(args.text ?? '');
        const url = String(args.url ?? '');
        const condiciones = [];
        if (selector.length > 0) {
          condiciones.push(`document.querySelector(${JSON.stringify(selector)}) !== null`);
        }
        if (texto.length > 0) {
          condiciones.push(`(document.body && document.body.innerText || '').includes(${JSON.stringify(texto)})`);
        }
        if (url.length > 0) {
          condiciones.push(`location.href.includes(${JSON.stringify(url)})`);
        }
        if (condiciones.length === 0) {
          return { content: 'Indica al menos selector, text o url.', isError: true };
        }

        const limite = Math.min(30_000, Math.max(100, Number(args.timeoutMs ?? 10_000)));
        const inicio = Date.now();
        const script = `(() => Boolean(${condiciones.join(' && ')}))()`;

        while (Date.now() - inicio < limite) {
          const result = await evalInBrowser(script);
          if (result.ok && result.value === true) {
            return { content: `Condición cumplida en ${Math.round((Date.now() - inicio) / 1000)}s.` };
          }
          await new Promise((resolve) => setTimeout(resolve, 250));
        }

        return { content: `La espera se agotó tras ${limite} ms.`, isError: true };
      },
    },

    {
      name: 'browser_batch',
      description:
        'Ejecuta una secuencia de acciones del navegador (open, navigate, click, fill, type, ' +
        'press, hover, scroll, select, wait, read) y se detiene en el primer error.',
      parameters: {
        type: 'object',
        properties: {
          steps: {
            type: 'array',
            description: 'Pasos en orden. Cada uno con action y sus parámetros.',
            items: {
              type: 'object',
              properties: {
                action: {
                  type: 'string',
                  enum: ['open', 'navigate', 'click', 'fill', 'type', 'press', 'hover', 'scroll', 'select', 'wait', 'read'],
                },
                url: { type: 'string' },
                selector: { type: 'string' },
                text: { type: 'string' },
                key: { type: 'string' },
                value: { type: 'string' },
                dy: { type: 'number' },
                timeoutMs: { type: 'number' },
              },
              required: ['action'],
            },
          },
        },
        required: ['steps'],
      },
      async execute(args) {
        const pasos = Array.isArray(args.steps) ? args.steps.slice(0, 30) : [];
        if (pasos.length === 0) return { content: 'Faltan pasos.', isError: true };
        // `open` es precisamente el paso que crea la página; exigir una antes
        // hacía imposible el caso más normal.
        if (String(pasos[0]?.action ?? '') !== 'open') {
          const missing = requirePage();
          if (missing) return { content: missing, isError: true };
        }

        const resultados = [];
        for (let i = 0; i < pasos.length; i += 1) {
          const paso = pasos[i];
          const accion = String(paso?.action ?? '');
          const herramienta = tools.find((t) => t.name === `browser_${accion}`);
          if (!herramienta) {
            resultados.push(`Paso ${i + 1} (${accion}): acción desconocida.`);
            return { content: resultados.join('\n'), isError: true };
          }

          const resultado = await herramienta.execute(paso);
          resultados.push(`Paso ${i + 1} (${accion}): ${resultado.content}`);
          if (resultado.isError) {
            return { content: resultados.join('\n'), isError: true };
          }
        }
        return { content: resultados.join('\n') };
      },
    },
  ];

  return tools;
}

/**
 * Ejecuta JavaScript dentro del navegador integrado.
 * Solo se permite si la política de ejecución lo autoriza.
 */
async function browserEvaluate(script, prefs, askUser) {
  const policy = prefs.browserJsPolicy ?? 'Request Review';

  if (policy === 'Never') {
    return { ok: false, error: 'La política de ejecución de JavaScript está en «Never».' };
  }

  if (!builtInBrowser || builtInBrowser.isDestroyed()) {
    return { ok: false, error: 'No hay navegador integrado abierto. Usa open_url primero.' };
  }

  if (policy === 'Request Review') {
    const verdict = await askUser(
      'El agente quiere ejecutar JavaScript en el navegador integrado',
      script.slice(0, 400),
    );
    if (!verdict) return { ok: false, error: 'El usuario denegó la ejecución.' };
  }

  try {
    const value = await builtInBrowser.webContents.executeJavaScript(script, true);
    return { ok: true, value };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Herramienta: buscar texto en los ficheros del workspace (tipo grep). */
function makeSearchFilesTool(getCwd) {
  return {
    name: 'search_files',
    description:
      'Busca texto en los ficheros del proyecto y devuelve coincidencias con ruta y número ' +
      'de línea. Acepta regex o texto literal, distingue mayúsculas si se pide y filtra por ' +
      'globs de fichero. Con matchPerLine=false devuelve solo las rutas que coinciden.',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Texto o expresión regular (JavaScript) a buscar.' },
        path: { type: 'string', description: 'Subdirectorio donde buscar. Por defecto la raíz.' },
        isRegex: {
          type: 'boolean',
          description: 'true (por defecto) interpreta pattern como regex; false lo trata literal.',
        },
        caseSensitive: {
          type: 'boolean',
          description: 'true distingue mayúsculas y minúsculas; por defecto no.',
        },
        includes: {
          type: 'array',
          items: { type: 'string' },
          description: 'Globs de fichero a incluir, por ejemplo ["src/**/*.ts"].',
        },
        excludes: {
          type: 'array',
          items: { type: 'string' },
          description: 'Globs de fichero a excluir, por ejemplo ["**/*.test.ts"].',
        },
        matchPerLine: {
          type: 'boolean',
          description: 'true (por defecto) devuelve cada línea; false solo rutas únicas.',
        },
        maxResults: { type: 'number', description: 'Máximo de coincidencias. Por defecto 60.' },
      },
      required: ['pattern'],
    },
    async execute(args, ctx) {
      const fsp = require('node:fs/promises');
      const path = require('node:path');
      const base = ctx?.cwd ?? getCwd();

      const rootPath = args.path ?? args.Path ?? '.';
      const root = path.resolve(base, String(rootPath));
      const maxResults = Math.max(1, Math.min(400, Number(args.maxResults ?? 60)));
      const matchPerLine = args.matchPerLine !== false;
      const includes = Array.isArray(args.includes) ? args.includes.map(String) : [];
      const excludes = Array.isArray(args.excludes) ? args.excludes.map(String) : [];

      let regex;
      try {
        const patron = String(args.pattern ?? args.query ?? args.regex ?? '');
        const cuerpo = args.isRegex === false
          ? patron.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          : patron;
        regex = new RegExp(cuerpo, args.caseSensitive === true ? '' : 'i');
      } catch (error) {
        return { content: `Expresión no válida: ${error.message}`, isError: true };
      }

      const BINARY = /\.(png|jpg|jpeg|gif|webp|ico|pdf|zip|gz|exe|dll|so|dylib|node|woff2?|ttf|mp[34]|wasm)$/i;

      const results = [];
      let scanned = 0;

      async function walk(directory, depth) {
        if (results.length >= maxResults || depth > 8) return;

        let entries;
        try {
          entries = await fsp.readdir(directory, { withFileTypes: true });
        } catch {
          return;
        }

        for (const entry of entries) {
          if (results.length >= maxResults) return;
          if (CARPETAS_IGNORADAS.has(entry.name) || entry.name.startsWith('.git')) continue;

          const absolute = path.join(directory, entry.name);

          if (entry.isDirectory()) {
            await walk(absolute, depth + 1);
            continue;
          }

          if (!entry.isFile() || BINARY.test(entry.name)) continue;
          if (scanned > 8000) return;
          scanned += 1;

          const relative = path.relative(base, absolute).split(path.sep).join('/');
          if (includes.length > 0 && !includes.some((glob) => coincideGlob(glob, relative))) {
            continue;
          }
          if (excludes.some((glob) => coincideGlob(glob, relative))) continue;

          let text;
          try {
            const info = await fsp.stat(absolute);
            if (info.size > 1_500_000) continue;
            text = await fsp.readFile(absolute, 'utf8');
          } catch {
            continue;
          }

          if (!matchPerLine) {
            if (!regex.test(text)) continue;
            results.push(relative);
            continue;
          }

          const lines = text.split('\n');

          for (let index = 0; index < lines.length; index += 1) {
            if (!regex.test(lines[index])) continue;
            const snippet = lines[index].trim().slice(0, 200);
            results.push(`${relative}:${index + 1}: ${snippet}`);
            if (results.length >= maxResults) break;
          }
        }
      }

      await walk(root, 0);

      if (results.length === 0) {
        return { content: `Sin coincidencias para /${args.pattern}/ en ${args.path ?? '.'}.` };
      }

      return { content: results.join('\n') };
    },
  };
}

/**
 * Herramienta: buscar ficheros por nombre.
 *
 * `search_files` busca contenido; esta busca nombres, que es lo que hace
 * `file_search` en Antigravity. Acepta un fragmento (`carrito`) o un patrón
 * con `*` y `?` dentro del nombre (`*.test.ts`).
 */
function makeFileSearchTool(getCwd) {
  return {
    name: 'file_search',
    description:
      'Busca ficheros por nombre en el proyecto. Acepta un fragmento (`config`) o un ' +
      'patrón con `*` y `?` (`*.test.ts`). Devuelve rutas relativas o absolutas.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Fragmento del nombre o patrón con * y ?.' },
        path: { type: 'string', description: 'Subdirectorio donde buscar. Por defecto la raíz.' },
        includes: {
          type: 'array',
          items: { type: 'string' },
          description: 'Globs de ruta a incluir, por ejemplo ["src/**/*.ts"].',
        },
        excludes: {
          type: 'array',
          items: { type: 'string' },
          description: 'Globs de ruta a excluir, por ejemplo ["**/*.test.ts"].',
        },
        fullPath: {
          type: 'boolean',
          description: 'true devuelve rutas absolutas; por defecto relativas.',
        },
        maxResults: { type: 'number', description: 'Máximo de resultados. Por defecto 80.' },
      },
      required: ['query'],
    },
    async execute(args, ctx) {
      const fsp = require('node:fs/promises');
      const path = require('node:path');
      const base = ctx?.cwd ?? getCwd();

      const consulta = String(args.query ?? args.pattern ?? args.Query ?? '').trim();
      if (consulta.length === 0) return { content: 'Falta la consulta.', isError: true };

      const root = path.resolve(base, String(args.path ?? args.Path ?? '.'));
      const maxResults = Math.max(1, Math.min(400, Number(args.maxResults ?? 80)));
      const includes = Array.isArray(args.includes) ? args.includes.map(String) : [];
      const excludes = Array.isArray(args.excludes) ? args.excludes.map(String) : [];
      const fullPath = args.fullPath === true;
      const esGlob = consulta.includes('*') || consulta.includes('?');
      const patron = esGlob
        ? new RegExp(
            `^${consulta
              .replace(/[.+^${}()|[\]\\]/g, '\\$&')
              .replace(/\*/g, '.*')
              .replace(/\?/g, '.')}$`,
            'i',
          )
        : null;
      const aguja = consulta.toLowerCase();
      const resultados = [];
      let escaneados = 0;

      async function walk(directory, depth) {
        if (resultados.length >= maxResults || depth > 8 || escaneados > 8000) return;
        let entries;
        try {
          entries = await fsp.readdir(directory, { withFileTypes: true });
        } catch {
          return;
        }

        for (const entry of entries) {
          if (resultados.length >= maxResults || escaneados > 8000) return;
          if (CARPETAS_IGNORADAS.has(entry.name) || entry.name.startsWith('.git')) continue;
          const absolute = path.join(directory, entry.name);

          if (entry.isDirectory()) {
            await walk(absolute, depth + 1);
            continue;
          }
          if (!entry.isFile()) continue;
          escaneados += 1;

          const coincide = patron
            ? patron.test(entry.name)
            : entry.name.toLowerCase().includes(aguja);
          if (!coincide) continue;

          const relative = path.relative(base, absolute).split(path.sep).join('/');
          if (includes.length > 0 && !includes.some((glob) => coincideGlob(glob, relative))) {
            continue;
          }
          if (excludes.some((glob) => coincideGlob(glob, relative))) continue;
          resultados.push(fullPath ? absolute : relative);
        }
      }

      await walk(root, 0);
      if (resultados.length === 0) {
        return { content: `Sin ficheros que coincidan con «${consulta}» en ${args.path ?? '.'}.` };
      }
      return { content: resultados.join('\n') };
    },
  };
}

/** Herramienta: editar un fichero reemplazando un fragmento exacto. */
function makeEditFileTool(getCwd) {
  return {
    name: 'edit_file',
    description:
      'Reemplaza un fragmento exacto de un fichero por otro. Mucho más seguro que write_file: ' +
      'solo cambia lo indicado y conserva el resto. Por defecto `oldText` debe aparecer una vez; ' +
      'con allowMultiple se reemplazan todas sus apariciones. También acepta `edits[]` para ' +
      'aplicar varios tramos en una sola llamada, como multi_replace.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Ruta del fichero.' },
        oldText: { type: 'string', description: 'Texto exacto a reemplazar.' },
        newText: { type: 'string', description: 'Texto nuevo. Vacío para borrar.' },
        allowMultiple: {
          type: 'boolean',
          description: 'true reemplaza todas las apariciones de oldText; por defecto exige una sola.',
        },
        edits: {
          type: 'array',
          description: 'Varios tramos a reemplazar de forma transaccional. Alternativa a oldText/newText.',
          items: {
            type: 'object',
            properties: {
              startLine: { type: 'number', description: 'Primera línea del tramo (1-based).' },
              endLine: { type: 'number', description: 'Última línea del tramo (1-based, inclusiva).' },
              targetContent: { type: 'string', description: 'Texto exacto a sustituir dentro del tramo.' },
              replacementContent: { type: 'string', description: 'Texto nuevo. Vacío para borrar.' },
            },
            required: ['startLine', 'targetContent', 'replacementContent'],
          },
        },
      },
      required: ['path'],
    },
    async execute(args, ctx) {
      const fsp = require('node:fs/promises');
      const path = require('node:path');

      const relative = String(args.path ?? args.Path ?? args.filePath ?? args.file_path ?? '');
      const oldText = String(args.oldText ?? args.Target ?? args.target ?? args.old_string ?? args.old_text ?? args.original ?? '');
      const newText = String(args.newText ?? args.Replacement ?? args.replacement ?? args.new_string ?? args.new_text ?? args.updated ?? '');
      const absolute = path.resolve(ctx?.cwd ?? getCwd(), relative);

      let current;
      try {
        current = await fsp.readFile(absolute, 'utf8');
      } catch (error) {
        return { content: `No se pudo leer ${relative}: ${error.message}`, isError: true };
      }

      const edits = Array.isArray(args.edits) ? args.edits : [];
      if (edits.length > 0) {
        const { aplicarReemplazos } = require('./multi-replace.cjs');
        const resultado = aplicarReemplazos(current, edits);
        if (resultado.error) {
          return { content: `${resultado.error} No se cambió nada.`, isError: true };
        }
        await fsp.writeFile(absolute, resultado.texto, 'utf8');
        return { content: `Editado ${relative} (${resultado.aplicados} tramos).` };
      }

      if (oldText.length === 0) {
        return { content: 'oldText no puede estar vacío.', isError: true };
      }

      let effectiveOld = oldText;
      let effectiveNew = newText;
      let occurrences = current.split(effectiveOld).length - 1;

      // Normalización de saltos de línea CRLF/LF en Windows
      if (occurrences === 0 && current.includes('\r\n') && !effectiveOld.includes('\r\n')) {
        const crlfOld = effectiveOld.replace(/\n/g, '\r\n');
        if (current.includes(crlfOld)) {
          effectiveOld = crlfOld;
          effectiveNew = effectiveNew.replace(/\n/g, '\r\n');
          occurrences = current.split(effectiveOld).length - 1;
        }
      } else if (occurrences === 0 && !current.includes('\r\n') && effectiveOld.includes('\r\n')) {
        const lfOld = effectiveOld.replace(/\r\n/g, '\n');
        if (current.includes(lfOld)) {
          effectiveOld = lfOld;
          effectiveNew = effectiveNew.replace(/\r\n/g, '\n');
          occurrences = current.split(effectiveOld).length - 1;
        }
      }

      if (occurrences === 0) {
        return { content: `oldText no aparece en ${relative}. Léelo con read_file y copia el fragmento exacto.`, isError: true };
      }
      const allowMultiple = args.allowMultiple === true || args.AllowMultiple === true;
      if (occurrences > 1 && !allowMultiple) {
        return {
          content: `oldText aparece ${occurrences} veces en ${relative}. Incluye más contexto o usa allowMultiple.`,
          isError: true,
        };
      }

      // Reemplazo literal: `String.replace` con string interpreta `$&`, `$1`…
      // y corrompía el fichero cuando el texto nuevo los contenía.
      const siguiente = allowMultiple
        ? current.split(effectiveOld).join(effectiveNew)
        : current.replace(effectiveOld, () => effectiveNew);
      await fsp.writeFile(absolute, siguiente, 'utf8');
      return {
        content: `Editado ${relative}${occurrences > 1 ? ` (${occurrences} apariciones)` : ''}.`,
      };
    },
  };
}

/**
 * Herramienta: generar imágenes con Google Flow.
 *
 * Flow no tiene API, así que se conduce su web en el navegador integrado con la
 * sesión de Google del usuario. No cuesta dinero ni necesita claves, pero es
 * frágil: si Google cambia su interfaz, los selectores dejan de encontrar los
 * elementos y la herramienta lo dice en vez de fallar en silencio.
 */
function makeGenerateImageTool(getCwd) {
  return {
    name: 'generate_image',
    description:
      'Genera una imagen a partir de una descripción usando Google Flow en el navegador ' +
      'integrado. Usa la sesión de Google que ya tengas abierta, así que no necesita clave ' +
      'ni cuesta dinero. Si Flow pide iniciar sesión, ábrelo con `browser_open` e inicia ' +
      'sesión antes de volver a intentarlo.',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Qué imagen generar, en detalle.' },
        path: {
          type: 'string',
          description: 'Ruta donde guardar la imagen. Si se omite, solo se devuelve la URL.',
        },
        aspectRatio: {
          type: 'string',
          description: 'Proporción de la imagen, por ejemplo 1:1, 16:9 o 9:16. Opcional.',
        },
      },
      required: ['prompt'],
    },
    async execute(args, ctx) {
      const { generarEnFlow, URL_FLOW, cuentaGoogleConectada, errorDeLogin } = require('./flow.cjs');
      const nodePath = require('node:path');
      const base = ctx?.cwd ?? getCwd();

      const prompt = String(args?.prompt ?? '').trim();
      if (prompt.length === 0) return { content: 'Falta el parámetro `prompt`.', isError: true };

      const cuenta = await cuentaGoogleConectada();
      if (!cuenta.conectada) {
        return {
          content:
            errorDeLogin() + '\n\nDespués de iniciar sesión, vuelve a intentar la generación.',
          isError: true,
        };
      }

      /*
       * Se abre OCULTO: el usuario no ve ninguna ventana. El navegador existe,
       * ejecuta JS y mantiene la sesión, pero no se muestra.
       */
      let navegadorFlow = typeof navegadorIntegrado === 'function'
        ? navegadorIntegrado(true)
        : builtInFlowBrowser;
      if (!navegadorFlow || navegadorFlow.isDestroyed()) {
        openBuiltInBrowser(URL_FLOW, { oculto: true, flow: true });
        await new Promise((r) => setTimeout(r, 6000));
        navegadorFlow = navegadorIntegrado(true);
      }
      if (!navegadorFlow) {
        return { content: 'No se pudo abrir el navegador de Flow.', isError: true };
      }

      /*
       * Siempre se guarda un fichero, aunque no se pida `path`: el hilo pinta la
       * imagen como data URL porque su CSP (`img-src 'self' data:`) bloquea las
       * URL remotas de Flow. Con solo la URL, la imagen no se vería.
       */
      const destino = args?.path
        ? nodePath.resolve(base, String(args.path))
        : nodePath.join(
            base,
            '.opengravity',
            'images',
            `flow-${new Date().toISOString().replace(/[:.]/g, '-')}`,
          );

      const resultado = await generarEnFlow(navegadorFlow, {
        prompt,
        destino,
        aspectRatio: args?.aspectRatio,
      });

      if (!resultado.ok) {
        return {
          content:
            `${resultado.error}\n\n` +
            'Puedes abrir Flow a mano con `browser_open` en ' + URL_FLOW + ' para revisar su estado.',
          isError: true,
        };
      }
      if (resultado.error) {
        return {
          content: `Imagen generada pero no se pudo guardar: ${resultado.error}`,
          isError: true,
        };
      }

      const donde = resultado.ruta ? `Guardada en ${resultado.ruta}.` : `URL: ${resultado.url}`;
      return { content: `Imagen generada. ${donde}` };
    },
  };
}

/** Herramienta: operar sobre las celdas de un cuaderno de Jupyter. */
function makeMultiReplaceTool(getCwd) {
  return {
    name: 'multi_replace',
    description:
      'Aplica varios reemplazos a un fichero en una sola llamada, cada uno acotado a un rango ' +
      'de líneas. Cada trozo se aplica sobre el resultado del anterior y, si uno falla, no se ' +
      'aplica ninguno: el fichero queda intacto. Úsalo para corregir varios tramos de un mismo ' +
      'fichero sin reescribirlo entero ni encadenar varios edit_file.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Ruta del fichero.' },
        edits: {
          type: 'array',
          description: 'Trozos a reemplazar, en orden.',
          items: {
            type: 'object',
            properties: {
              startLine: { type: 'number', description: 'Primera línea del tramo (1-based).' },
              endLine: { type: 'number', description: 'Última línea del tramo (1-based, inclusiva).' },
              targetContent: { type: 'string', description: 'Texto exacto a sustituir dentro del tramo.' },
              replacementContent: { type: 'string', description: 'Texto nuevo. Vacío para borrar.' },
            },
            required: ['startLine', 'targetContent', 'replacementContent'],
          },
        },
      },
      required: ['path', 'edits'],
    },
    async execute(args, ctx) {
      const fsp = require('node:fs/promises');
      const path = require('node:path');
      const { aplicarReemplazos } = require('./multi-replace.cjs');

      const relative = String(args.path ?? '');
      const absolute = path.resolve(ctx?.cwd ?? getCwd(), relative);

      let current;
      try {
        current = await fsp.readFile(absolute, 'utf8');
      } catch (error) {
        return { content: `No se pudo leer ${relative}: ${error.message}`, isError: true };
      }

      const resultado = aplicarReemplazos(current, args.edits);
      if (resultado.error) {
        return { content: `${resultado.error} No se cambió nada.`, isError: true };
      }

      await fsp.writeFile(absolute, resultado.texto, 'utf8');
      return { content: `Aplicados ${resultado.aplicados} reemplazos en ${relative}.` };
    },
  };
}

// --- Comandos en segundo plano -------------------------------------------------
//
// Igual que el agente de Antigravity: run_command espera como mucho
// waitDurationSeconds y, si el comando sigue vivo, lo deja en segundo plano y
// devuelve un CommandId. Así se puede arrancar un servidor de desarrollo y seguir
// trabajando sin quedarse colgado.

const tareas = new Map();
let contadorTareas = 0;

/**
 * Despertar reactivo.
 *
 * Cuando una tarea que quedó en segundo plano termina, se avisa aquí. El proceso
 * principal lo usa para reanudar el turno e inyectar el resultado, en vez de
 * esperar a que el modelo pregunte con `command_status`.
 */
let alTerminarTarea = null;

function setAlTerminarTarea(fn) {
  alTerminarTarea = typeof fn === 'function' ? fn : null;
}
const MAX_SALIDA = 60000;

function resumenSalida(tarea, limite) {
  const max = limite ?? MAX_SALIDA;
  const partes = [];
  if (tarea.done) partes.push(`exit code: ${tarea.exitCode}`);
  else partes.push(`estado: en ejecución (pid ${tarea.pid ?? '?'})`);
  if (tarea.stdout.trim().length > 0) partes.push(`--- stdout ---\n${tarea.stdout.slice(0, max)}`);
  if (tarea.stderr.trim().length > 0) partes.push(`--- stderr ---\n${tarea.stderr.slice(0, max)}`);
  if (tarea.stdout.length > max || tarea.stderr.length > max) {
    partes.push(`(salida recortada a ${max} caracteres por flujo)`);
  }
  return partes.join('\n');
}

/**
 * Termina una tarea y todo su árbol.
 *
 * En Windows, `child.kill()` solo mata el shell; `taskkill /T` mata los hijos.
 * En POSIX, el comando corre en su propio grupo (`detached`) y se mata el grupo.
 * El guard del Job Object se mata también: al cerrar su handle se libera el job.
 */
/**
 * Termina una tarea y todo su árbol, y **espera** a que el sistema lo confirme.
 *
 * Devolver una promesa no es un lujo: al cerrar la app, `before-quit` lanzaba
 * `taskkill` y salía sin mirar atrás, así que el proceso moría antes que sus
 * hijos y quedaban vivos. Quien quiera cerrar limpio tiene que poder esperar.
 */
async function matarTarea(tarea) {
  if (!tarea) return;

  const pid = tarea.pid;
  if (!pid) {
    try {
      tarea.guard?.kill();
    } catch {
      // ya terminado
    }
    return;
  }

  if (process.platform === 'win32') {
    /*
     * Tarea lanzada por el helper nativo: el comando se creó suspendido y ya
     * está en el Job, así que cerrar el helper (KILL_ON_JOB_CLOSE) termina todo
     * el árbol. No hace falta taskkill.
     */
    if (tarea.helper) {
      try {
        tarea.child?.kill();
      } catch {
        // ya terminado
      }
      return;
    }

    /*
     * Respaldo con el guard PowerShell: primero se mata el árbol; el guard
     * observa la salida del target y limpia el job. Matar el guard antes podía
     * dejar escapar al hijo.
     */
    if (process.env.OG_SANDBOX_DEBUG === '1') {
      console.log(`[sandbox] matar ${tarea.id} pid=${pid} guard=${tarea.guard?.pid ?? 'ninguno'}`);
    }
    try {
      /*
       * Se espera a que `taskkill /T /F` termine: sus hijos no existen hasta
       * que regresa, y al cerrar la app eso es justo lo que hay que asegurar.
       * El plazo evita quedarse colgado si el sistema no responde.
       */
      const tk = require('node:child_process').spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      });
      await new Promise((listo) => {
        const plazo = setTimeout(() => {
          try {
            tk.kill();
          } catch {
            // ya terminado
          }
          listo();
        }, 5000);
        plazo.unref?.();
        tk.on('close', (code) => {
          clearTimeout(plazo);
          if (process.env.OG_SANDBOX_DEBUG === '1') {
            console.log(`[sandbox] taskkill ${pid} → ${code}`);
          }
          listo();
        });
        tk.on('error', (error) => {
          clearTimeout(plazo);
          if (process.env.OG_SANDBOX_DEBUG === '1') {
            console.log(`[sandbox] taskkill ${pid} error: ${error.message}`);
          }
          listo();
        });
      });
    } catch {
      // taskkill no disponible
    }

    if (tarea.guard) {
      const guard = tarea.guard;
      const temporizador = setTimeout(() => {
        try {
          guard.kill();
        } catch {
          // ya terminado
        }
      }, 2000);
      temporizador.unref?.();
    }

    try {
      tarea.child?.kill('SIGKILL');
    } catch {
      // ya terminado
    }
    return;
  }

  try {
    if (tarea.grupo) process.kill(-pid, 'SIGKILL');
    else tarea.child?.kill('SIGKILL');
  } catch {
    try {
      tarea.child?.kill('SIGKILL');
    } catch {
      // ya terminado
    }
  }
}

/**
 * Herramienta: ejecutar un fragmento de JavaScript como extensión temporal.
 *
 * Es el equivalente open source de `run_extension_code`: no hay una API
 * propietaria de extensiones, así que el código corre con Node en el mismo
 * sandbox que `run_command`, con `args` disponible en el script.
 */
function makeRunExtensionCodeTool(getCwd, ejecutarComando) {
  const workflow = makeRunWorkflowTool(getCwd, ejecutarComando);
  return {
    name: 'run_extension_code',
    description:
      'Ejecuta un fragmento de JavaScript como una extensión temporal del agente. ' +
      'Corre con Node en el sandbox, recibe `args` y devuelve lo que escriba por ' +
      'consola. Para código de proyecto, usa run_workflow.',
    parameters: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: 'Código JavaScript (ESM). El objeto args está disponible en el script.',
        },
        args: {
          type: 'object',
          description: 'Datos de entrada para la extensión.',
        },
        waitMillis: {
          type: 'number',
          description:
            'Milisegundos a esperar antes de pasarla a segundo plano (0–10000). ' +
            'Por defecto 10000.',
        },
      },
      required: ['code'],
    },
    async execute(args, ctx) {
      const codigo = String(args?.code ?? '');
      if (codigo.trim().length === 0) {
        return { content: 'No hay código que ejecutar.', isError: true };
      }
      const script =
        "import { readFileSync } from 'node:fs';\n" +
        "const args = JSON.parse(readFileSync(process.argv[2], 'utf8'));\n" +
        codigo;
      return workflow.execute({
        script,
        language: 'node',
        args: args?.args ?? {},
        waitMillis: args?.waitMillis,
      }, ctx);
    },
  };
}

/**
 * Termina todas las tareas, por ejemplo al cerrar la app.
 *
 * Espera a que cada árbol esté muerto de verdad. Sin esto, quien llama cree
 * que ya limpió y sale, y los procesos hijos sobreviven a la ventana.
 */
async function matarTodasLasTareas() {
  const pendientes = [...tareas.values()].map((tarea) => matarTarea(tarea));
  await Promise.allSettled(pendientes);
}

/** Herramienta: ejecutar un comando en el workspace, sin bloquear indefinidamente. */
function makeRunCommandTool(getCwd, getPrefs) {
  return {
    name: 'run_command',
    description:
      'Ejecuta un comando de shell en el directorio del proyecto. Espera como mucho ' +
      'waitDurationSeconds y, si el comando no ha terminado, lo pasa a segundo plano y ' +
      'devuelve un CommandId que puedes consultar con command_status. ' +
      'Usa isBackground=true para servidores de desarrollo, watchers y túneles.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'La línea de comandos exacta a ejecutar.' },
        cwd: {
          type: 'string',
          description: 'Directorio de trabajo del comando. Por defecto, el del proyecto.',
        },
        waitDurationSeconds: {
          type: 'number',
          description:
            'Milisegundos a esperar antes de pasarlo a segundo plano (500–10000). ' +
            'Usa 5000–10000 para comandos que deberían terminar; 500 para los de fondo.',
        },
        taskName: {
          type: 'string',
          description:
            'Frase nominal de 2–5 palabras que describa la tarea, con mayúscula inicial. ' +
            'Ejemplos: "Git status check", "Unit test execution", "Dev server startup".',
        },
        isBackground: {
          type: 'boolean',
          description:
            'true para procesos de soporte que deben seguir corriendo indefinidamente ' +
            '(servidores de desarrollo, watchers, túneles). false para comandos normales.',
        },
        input: {
          type: 'string',
          description:
            'Texto a enviar al stdin del comando. Incluye \\n literales si hace falta enviarlo.',
        },
        terminate: {
          type: 'boolean',
          description:
            'Si es true, termina el comando. Exactamente uno de input y terminate.',
        },
      },
      required: ['command'],
    },
    async execute(args, ctx) {
      const { spawn } = require('node:child_process');

      const rawCmd = args.command ?? args.CommandLine ?? args.cmd ?? '';
      const command = String(rawCmd);
      if (command.length === 0) {
        return { content: 'Falta el comando.', isError: true };
      }

      const esperaRaw = args.waitDurationSeconds ?? (args.WaitMsBeforeAsync ? Math.round(Number(args.WaitMsBeforeAsync) / 1000) : undefined);
      const esperaMs = Math.min(10000, Math.max(500, Number(esperaRaw ?? 8000)));
      const prefs = typeof getPrefs === 'function' ? getPrefs() : {};
      const restringir = prefs?.restrictToWorkspace === true;

      const path = require('node:path');
      const workspace = ctx?.cwd ?? getCwd();
      const cwd = args.cwd ? path.resolve(workspace, String(args.cwd)) : workspace;

      /*
       * El comando nunca hereda variables con credenciales: el saneado es
       * incondicional y el cwd solo se restringe con el sandbox activo. No es un
       * jail del SO: un comando puede salir del directorio por su cuenta; eso
       * requiere AppContainer o namespaces y queda para la fase 2.
       */
      const raices = Array.isArray(prefs?.allowedRoots) ? prefs.allowedRoots : [];
      if (restringir && !dentroDeRaices(workspace, raices, cwd)) {
        return {
          content:
            `El sandbox de workspace está activo y «${cwd}» queda fuera de ` +
            `«${workspace}» y de las raíces añadidas. Usa un directorio permitido.`,
          isError: true,
        };
      }
      const entorno = sanearEntorno(process.env);

      const id = `cmd-${++contadorTareas}`;
      const taskName = String(args.taskName ?? args.toolSummary ?? args.summary ?? command.slice(0, 40));
      const isBg = args.isBackground === true || args.IsDaemon === true;
      const tarea = {
        id,
        nombre: taskName,
        comando: command,
        cwd,
        sessionId: ctx?.sessionId ?? null,
        turno: ctx?.turno ?? null,
        stdout: '',
        stderr: '',
        done: false,
        exitCode: null,
        pid: null,
        inicio: Date.now(),
        fondo: isBg,
        child: null,
      };

      const limites = limitesDeSandbox(prefs);
      const usaSandbox = restringir;

      let child = null;
      let viaHelper = false;

      if (usaSandbox && process.platform === 'win32') {
        const helper = await obtenerHelperWin();
        if (helper) {
          child = spawn(
            helper,
            argumentosHelperWin({
              cwd,
              limites,
              parentPid: process.pid,
              command,
            }),
            {
              cwd,
              windowsHide: true,
              stdio: 'pipe',
              env: entorno,
            },
          );
          viaHelper = true;
          if (process.env.OG_SANDBOX_DEBUG === '1') {
            console.log(`[sandbox] helper ${helper} target-cmd=${command.slice(0, 60)}`);
          }
        }
      }

      if (!child) {
        if (process.platform === 'win32') {
          /*
           * El prompt y la tarjeta de `list_directory` hablan de PowerShell.
           * `shell: true` lanzaba cmd.exe, así que `Get-ChildItem` y `$env:`
           * fallaban. `-EncodedCommand` evita pelear con las comillas de la
           * orden: la cadena viaja en base64 UTF-16LE.
           */
          const encoded = Buffer.from(
            `$ProgressPreference='SilentlyContinue'; ${command}`,
            'utf16le',
          ).toString('base64');
          child = spawn(
            'powershell.exe',
            ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
            { cwd, windowsHide: true, env: entorno },
          );
        } else {
          const comandoFinal = usaSandbox
            ? `${prefijoPosix(limites)}${command}`
            : command;
          child = spawn(comandoFinal, {
            cwd,
            shell: true,
            windowsHide: true,
            ...(usaSandbox ? { detached: true } : {}),
            env: entorno,
          });
        }
      }

      tarea.child = child;
      tarea.pid = child.pid;
      tarea.grupo = usaSandbox && process.platform !== 'win32';
      tarea.sandbox = usaSandbox;
      tarea.helper = viaHelper;

      if (process.env.OG_SANDBOX_DEBUG === '1' && viaHelper) {
        child.on('exit', (code, signal) => {
          console.log(`[sandbox] helper ${child.pid} exit=${code} signal=${signal}`);
        });
        child.stderr.on('data', (chunk) => {
          console.log(`[sandbox] stderr ${chunk.toString().slice(0, 160)}`);
        });
      }

      /*
       * Respaldo: si el lanzador nativo no se pudo compilar, el guard PowerShell
       * aplica los límites que puede al shell. La ruta buena es el helper, que
       * arranca el comando suspendido y lo asigna al Job antes de ejecutarlo.
       */
      if (!viaHelper && usaSandbox && process.platform === 'win32' && child.pid) {
        try {
          const guard = spawn(
            'powershell.exe',
            argumentosGuardWin({ pid: child.pid, parentPid: process.pid, limites }),
            { windowsHide: true, stdio: 'ignore' },
          );
          guard.on('error', () => {
            tarea.guard = null;
          });
          tarea.guard = guard;
          if (process.env.OG_SANDBOX_DEBUG === '1') {
            console.log(`[sandbox] guard ${guard.pid} target=${child.pid}`);
          }
        } catch {
          tarea.guard = null;
        }
      }
      tareas.set(id, tarea);

      child.stdout.on('data', (chunk) => {
        if (tarea.stdout.length < MAX_SALIDA) tarea.stdout += chunk.toString();
      });
      child.stderr.on('data', (chunk) => {
        if (tarea.stderr.length < MAX_SALIDA) tarea.stderr += chunk.toString();
      });
      // El error de stdin es asíncrono (EPIPE al morir el hijo); sin listener
      // se convierte en un uncaughtException y tumba Electron.
      child.stdin.on('error', () => {});
      child.on('error', (error) => {
        tarea.done = true;
        tarea.exitCode = -1;
        tarea.stderr += `\nNo se pudo ejecutar: ${error.message}`;
      });
      child.on('close', (code) => {
        tarea.done = true;
        tarea.exitCode = code;

        // Solo despierta si el turno ya se había desentendido de ella.
        if (tarea.avisarAlTerminar && alTerminarTarea) {
          try {
            alTerminarTarea(tarea);
          } catch {
            // el aviso nunca debe romper el proceso
          }
        }
      });

      if (typeof args.input === 'string') {
        try {
          child.stdin.write(args.input);
        } catch {
          // stdin ya cerrado
        }
      }
      if (args.terminate === true) {
        matarTarea(tarea);
      }

      // Espera acotada: si no termina, se devuelve el id y sigue en segundo plano.
      await new Promise((resolve) => {
        if (tarea.done) return resolve();
        const temporizador = setTimeout(resolve, esperaMs);
        child.once('close', () => {
          clearTimeout(temporizador);
          resolve();
        });
      });

      if (tarea.done) {
        return {
          content: `[${tarea.nombre}] ${resumenSalida(tarea)}`,
          isError: tarea.exitCode !== 0,
        };
      }

      // Queda en segundo plano: cuando termine, despertará al agente.
      tarea.avisarAlTerminar = true;

      return {
        content:
          `[${tarea.nombre}] sigue en ejecución tras ${esperaMs} ms.\n` +
          `CommandId: ${id}\n` +
          `Consúltalo con command_status (CommandId "${id}").\n\n` +
          resumenSalida(tarea, 4000),
      };
    },
  };
}

/** Herramienta: consultar el estado de un comando lanzado con run_command. */
function makeCommandStatusTool() {
  return {
    name: 'command_status',
    description:
      'Consulta el estado y la salida de un comando lanzado con run_command. ' +
      'Espera hasta WaitDurationSeconds a que termine antes de devolver el estado.',
    parameters: {
      type: 'object',
      properties: {
        commandId: {
          type: 'string',
          description: 'El CommandId devuelto por una llamada previa a run_command.',
        },
        waitDurationSeconds: {
          type: 'number',
          description:
            'Milisegundos a esperar a que el comando termine antes de devolver el estado ' +
            '(0–10000). Si termina antes, devuelve enseguida. 0 devuelve el estado ya.',
        },
        outputCharacterCount: {
          type: 'number',
          description: 'Cuántos caracteres de salida devolver. Lo más pequeño posible.',
        },
      },
      required: ['commandId'],
    },
    async execute(args) {
      const tarea = tareas.get(String(args.commandId ?? ''));
      if (!tarea) {
        return { content: `No existe el comando ${args.commandId}.`, isError: true };
      }

      const esperaMs = Math.min(10000, Math.max(0, Number(args.waitDurationSeconds ?? 3000)));
      if (!tarea.done && esperaMs > 0) {
        await new Promise((resolve) => {
          const temporizador = setTimeout(resolve, esperaMs);
          tarea.child.once('close', () => {
            clearTimeout(temporizador);
            resolve();
          });
        });
      }

      const limite = Number(args.outputCharacterCount ?? MAX_SALIDA);
      return {
        content: `[${tarea.nombre}] ${resumenSalida(tarea, limite)}`,
        isError: tarea.done && tarea.exitCode !== 0,
      };
    },
  };
}

/** Herramienta: gestionar las tareas en segundo plano. */
function makeManageTaskTool() {
  return {
    name: 'manage_task',
    description:
      'Gestiona las tareas en segundo plano: list (listar), status (estado y log), ' +
      'kill (cancelar) y send_input (enviar texto al stdin).',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'kill', 'status', 'send_input'],
          description: 'La acción a realizar.',
        },
        taskId: {
          type: 'string',
          description: 'El id de la tarea. Obligatorio para kill, status y send_input.',
        },
        input: {
          type: 'string',
          description: 'El texto a enviar al stdin de la tarea. Obligatorio para send_input.',
        },
      },
      required: ['action'],
    },
    async execute(args) {
      const accion = String(args.action ?? 'list');

      if (accion === 'list') {
        if (tareas.size === 0) return { content: 'No hay tareas en segundo plano.' };
        const lineas = [...tareas.values()].map((t) => {
          const segundos = Math.round((Date.now() - t.inicio) / 1000);
          const estado = t.done ? `terminada (exit ${t.exitCode})` : 'en ejecución';
          return `- ${t.id} · ${t.nombre} · ${estado} · ${segundos}s · ${t.comando.slice(0, 60)}`;
        });
        return { content: lineas.join('\n') };
      }

      const tarea = tareas.get(String(args.taskId ?? ''));
      if (!tarea) return { content: `No existe la tarea ${args.taskId}.`, isError: true };

      if (accion === 'kill') {
        matarTarea(tarea);
        return { content: `Tarea ${tarea.id} (${tarea.nombre}) terminada.` };
      }

      if (accion === 'send_input') {
        if (typeof args.input !== 'string') {
          return { content: 'send_input necesita input.', isError: true };
        }
        if (tarea.done || !tarea.child?.stdin || tarea.child.stdin.destroyed) {
          return { content: `La tarea ${tarea.id} ya terminó; no admite stdin.`, isError: true };
        }
        try {
          tarea.child.stdin.write(args.input);
          return { content: `Enviado a ${tarea.id}.` };
        } catch (error) {
          return { content: `No se pudo escribir: ${error.message}`, isError: true };
        }
      }

      return { content: `[${tarea.nombre}] ${resumenSalida(tarea)}` };
    },
  };
}

/** Herramienta: buscar en la web sin clave de API. */
function makeSearchWebTool(getPrefs) {
  return {
    name: 'search_web',
    description:
      'Busca en la web y devuelve una lista de resultados con título, URL y extracto. ' +
      'Úsala cuando necesites información actual que no está en el código ni en la documentación local.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'La búsqueda. Si el nombre del producto tiene variantes, incluye una o dos variantes ' +
            'de palabra clave en la misma consulta (nombre completo, abreviatura y la capacidad).',
        },
        domain: {
          type: 'string',
          description: 'Dominio opcional que quieres priorizar en los resultados.',
        },
        maxResults: {
          type: 'number',
          description: 'Número máximo de resultados. Por defecto 5, como mucho 15.',
        },
      },
      required: ['query'],
    },
    async execute(args) {
      const consulta = String(args.query ?? '').trim();
      if (consulta.length === 0) return { content: 'Falta la consulta.', isError: true };

      const prefs = getPrefs();
      const maximo = Math.min(15, Math.max(1, Number(args.maxResults ?? 5)));
      const dominio = String(args.domain ?? '').trim();
      const busqueda = dominio.length > 0 ? `${consulta} site:${dominio}` : consulta;

      // DuckDuckGo no pide clave ni cuenta: coste cero y sin telemetría propia.
      const url = 'https://html.duckduckgo.com/html/';
      const verdict = isUrlAllowed(url, prefs.networkRules);
      if (!verdict.allowed) {
        return { content: `Acceso denegado: ${verdict.reason}`, isError: true };
      }

      try {
        const respuesta = await descargarTexto(url, {
          method: 'POST',
          headers: {
            'user-agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36',
            'content-type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({ q: busqueda, kl: 'wt-wt' }).toString(),
          maxBytes: 2_000_000,
          timeoutMs: 20_000,
        });

        if (!respuesta.ok) {
          return { content: `Acceso denegado: ${respuesta.error}`, isError: true };
        }
        if (respuesta.status < 200 || respuesta.status >= 300) {
          return { content: `La búsqueda falló con estado ${respuesta.status}.`, isError: true };
        }

        const html = respuesta.texto;
        const resultados = parsearDuckDuckGo(html, maximo);

        if (resultados.length === 0) {
          return { content: `Sin resultados para "${consulta}".` };
        }

        const lineas = resultados.map((r, indice) => {
          const partes = [`${indice + 1}. ${r.titulo}`, `   ${r.url}`];
          if (r.extracto.length > 0) partes.push(`   ${r.extracto}`);
          return partes.join('\n');
        });

        return { content: `Resultados para "${consulta}":\n\n${lineas.join('\n\n')}` };
      } catch (error) {
        return {
          content: `No se pudo buscar: ${error instanceof Error ? error.message : String(error)}`,
          isError: true,
        };
      }
    },
  };
}

/** Extrae los resultados del HTML de DuckDuckGo sin dependencias. */
function parsearDuckDuckGo(html, maximo) {
  const resultados = [];

  const bloque = /<a[^>]+class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  const extracto = /<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/g;

  const textos = [];
  let m;
  while ((m = extracto.exec(html)) !== null) {
    textos.push(limpiarHtml(m[1]));
  }

  let indice = 0;
  while ((m = bloque.exec(html)) !== null && resultados.length < maximo) {
    let destino = m[1];

    // DuckDuckGo envuelve los enlaces en /l/?uddg=<url codificada>.
    const envuelto = destino.match(/[?&]uddg=([^&]+)/);
    if (envuelto) {
      try {
        destino = decodeURIComponent(envuelto[1]);
      } catch {
        // se deja tal cual
      }
    }

    if (destino.startsWith('//')) destino = `https:${destino}`;

    resultados.push({
      titulo: limpiarHtml(m[2]),
      url: destino,
      extracto: textos[indice] ?? '',
    });
    indice += 1;
  }

  return resultados;
}

/** Quita etiquetas y decodifica las entidades más comunes. */
function limpiarHtml(texto) {
  return String(texto)
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Herramienta: leer un símbolo concreto de un fichero. */
function makeViewCodeItemTool(getCwd) {
  return {
    name: 'view_code_item',
    description:
      'Lee un símbolo concreto de un fichero (una función, método, clase o tipo) en vez del ' +
      'fichero entero. Si omites nodePath, lista los símbolos del fichero para que elijas. ' +
      'Ahorra muchos tokens frente a read_file.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Ruta del fichero. Absoluta, o relativa al directorio del proyecto.',
        },
        nodePath: {
          type: 'string',
          description:
            'Ruta del símbolo, por ejemplo "MiClase.miMetodo" o "miFuncion". ' +
            'Si se omite, se listan los símbolos disponibles con sus líneas.',
        },
        maxChars: {
          type: 'number',
          description: 'Máximo de caracteres a devolver. Por defecto 20000.',
        },
      },
      required: ['path'],
    },
    async execute(args, ctx) {
      const fsp = require('node:fs/promises');
      const pathMod = require('node:path');
      const { listCodeItems, readCodeItem } = require('./code-items.cjs');
      const base = ctx?.cwd ?? getCwd();

      const pedida = String(args.path ?? '').trim();
      if (pedida.length === 0) return { content: 'Falta la ruta.', isError: true };

      const absoluta = pathMod.isAbsolute(pedida) ? pedida : pathMod.join(base, pedida);

      let contenido;
      try {
        contenido = await fsp.readFile(absoluta, 'utf8');
      } catch (error) {
        return { content: `No se pudo leer ${pedida}: ${error.message}`, isError: true };
      }

      const relativa = pathMod.relative(base, absoluta) || pedida;
      const nodePath = String(args.nodePath ?? '').trim();

      // Sin nodePath: tabla de contenidos del fichero.
      if (nodePath.length === 0) {
        const items = listCodeItems(absoluta, contenido);
        if (items.length === 0) {
          return {
            content:
              `No se encontraron símbolos en ${relativa}. ` +
              'Usa read_file para ver el contenido completo.',
          };
        }
        const lineas = items.map((item) => `  ${item.startLine}-${item.endLine}\t${item.path} (${item.kind})`);
        return {
          content:
            `Símbolos en ${relativa} (${items.length}):\n` +
            `  líneas\tsímbolo\n${lineas.join('\n')}\n\n` +
            'Pide uno concreto con nodePath para leer su código.',
        };
      }

      const encontrado = readCodeItem(absoluta, contenido, nodePath);

      if (encontrado === null) {
        const items = listCodeItems(absoluta, contenido);
        const disponibles = items.slice(0, 40).map((item) => item.path).join(', ');
        return {
          content:
            `No existe el símbolo "${nodePath}" en ${relativa}.\n` +
            (disponibles.length > 0 ? `Disponibles: ${disponibles}` : 'El fichero no tiene símbolos detectables.'),
          isError: true,
        };
      }

      if (encontrado.ambiguo) {
        return {
          content:
            `"${nodePath}" coincide con varios símbolos. Concreta cuál:\n` +
            encontrado.candidatos.map((c) => `  ${c}`).join('\n'),
          isError: true,
        };
      }

      const maximo = Math.max(500, Number(args.maxChars ?? 20000));
      const recortado = encontrado.texto.length > maximo;
      const cuerpo = recortado ? encontrado.texto.slice(0, maximo) : encontrado.texto;

      // Números de línea, para que el modelo pueda referenciarlos al editar.
      const numerado = cuerpo
        .split('\n')
        .map((linea, indice) => `${String(encontrado.startLine + indice).padStart(5)} | ${linea}`)
        .join('\n');

      return {
        content:
          `${relativa}:${encontrado.startLine}-${encontrado.endLine} — ${encontrado.path} (${encontrado.kind})\n` +
          `${numerado}` +
          (recortado
            ? `\n\n(recortado a ${maximo} caracteres; el símbolo tiene ${encontrado.texto.length})`
            : ''),
      };
    },
  };
}

/**
 * Esquema de argumentos de un workflow.
 *
 * Antigravity valida `Args` contra el esquema de `workflow.json`. Aceptamos las
 * claves habituales (`inputSchema`, `schema`, `argsSchema`) y también `args`,
 * que puede ser el esquema completo o el mapa de propiedades.
 */
function esquemaDeWorkflow(meta) {
  if (!meta || typeof meta !== 'object') return null;
  for (const clave of ['inputSchema', 'InputSchema', 'schema', 'Schema', 'argsSchema', 'ArgsSchema']) {
    const valor = meta[clave];
    if (valor && typeof valor === 'object') return valor;
  }
  const args = meta.args ?? meta.Args;
  if (args && typeof args === 'object') {
    if (args.type || args.properties || args.required) return args;
    return { type: 'object', properties: args };
  }
  return null;
}

/** Valida los argumentos y devuelve un error legible, o `null` si son válidos. */
function validarArgsWorkflow(meta, args) {
  const esquema = esquemaDeWorkflow(meta);
  if (!esquema) return null;

  let Ajv;
  try {
    Ajv = require('ajv');
  } catch {
    return 'no se pudo cargar el validador de esquemas';
  }

  try {
    const ajv = new Ajv({ allErrors: true, strict: false });
    const validar = ajv.compile(esquema);
    if (validar(args ?? {})) return null;
    return (validar.errors ?? [])
      .map((error) => `${error.instancePath || '/'} ${error.message || 'inválido'}`)
      .join('; ');
  } catch (error) {
    return `esquema de workflow inválido: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/** Herramienta: ejecutar un workflow del proyecto. */
function makeRunWorkflowTool(getCwd, ejecutarComando) {
  return {
    name: 'run_workflow',
    description:
      'Ejecuta un workflow del proyecto (script de Python o Node en .opengravity/workflows/). ' +
      'Los workflows reciben sus argumentos como un objeto JSON. ' +
      'Si no das nombre ni script, lista los workflows disponibles.',
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description:
            'Nombre del workflow, sin extensión, tal como aparece al listarlos. ' +
            'Alternativa a script: usa exactamente uno de los dos.',
        },
        script: {
          type: 'string',
          description:
            'Código fuente de un workflow de un solo uso. Requiere language. ' +
            'Alternativa a name: usa exactamente uno de los dos.',
        },
        language: {
          type: 'string',
          enum: ['python', 'node'],
          description: 'Lenguaje del script en línea. Por defecto node.',
        },
        args: {
          type: 'object',
          description:
            'Argumentos del workflow. Se pasan como JSON; el script los lee del fichero ' +
            'cuya ruta recibe en argv[1] (Python) o argv[2] (Node).',
        },
        waitMillis: {
          type: 'number',
          description:
            'Milisegundos a esperar a que termine antes de pasarlo a segundo plano ' +
            '(0–10000). Por defecto 10000 para workflows cortos; usa 0 para lanzarlo y seguir.',
        },
      },
    },
    async execute(args, ctx) {
      const fsp = require('node:fs/promises');
      const os = require('node:os');
      const pathMod = require('node:path');

      const cwd = ctx?.cwd ?? getCwd();
      const carpeta = pathMod.join(cwd, '.opengravity/workflows');

      const nombre = String(args.name ?? '').trim();
      const enLinea = String(args.script ?? '').trim();

      // Sin nombre ni script: listar lo disponible.
      if (nombre.length === 0 && enLinea.length === 0) {
        let ficheros = [];
        try {
          ficheros = await fsp.readdir(carpeta);
        } catch {
          return {
            content:
              `No existe ${pathMod.join('.opengravity', 'workflows')} en el proyecto.\n` +
              'Crea ahí un .py o .mjs para poder invocarlo como workflow.',
          };
        }

        const scripts = ficheros.filter((f) => /\.(py|mjs|js)$/.test(f));
        if (scripts.length === 0) return { content: 'La carpeta de workflows está vacía.' };

        const lineas = [];
        for (const script of scripts.sort()) {
          const base = script.replace(/\.(py|mjs|js)$/, '');
          let descripcion = '';
          try {
            const meta = JSON.parse(
              await fsp.readFile(pathMod.join(carpeta, `${base}.workflow.json`), 'utf8'),
            );
            descripcion = typeof meta.description === 'string' ? ` — ${meta.description}` : '';
          } catch {
            // sin metadatos
          }
          lineas.push(`- ${base}${descripcion}`);
        }

        return { content: `Workflows disponibles:\n${lineas.join('\n')}` };
      }

      // Resolver el script y su lenguaje.
      let rutaScript;
      let lenguaje;
      let temporal = null;
      let metadatos = {};

      if (enLinea.length > 0) {
        lenguaje = String(args.language ?? 'node');
        temporal = pathMod.join(
          os.tmpdir(),
          `workflow-${Date.now().toString(36)}.${lenguaje === 'python' ? 'py' : 'mjs'}`,
        );
        await fsp.writeFile(temporal, enLinea, 'utf8');
        rutaScript = temporal;
      } else {
        const candidatos = [`${nombre}.py`, `${nombre}.mjs`, `${nombre}.js`];
        let encontrado = null;
        for (const candidato of candidatos) {
          const ruta = pathMod.join(carpeta, candidato);
          try {
            await fsp.access(ruta);
            encontrado = ruta;
            break;
          } catch {
            // siguiente
          }
        }

        if (!encontrado) {
          return {
            content: `No existe el workflow "${nombre}". Llama a run_workflow sin argumentos para ver la lista.`,
            isError: true,
          };
        }

        rutaScript = encontrado;
        lenguaje = encontrado.endsWith('.py') ? 'python' : 'node';

        try {
          metadatos = JSON.parse(
            await fsp.readFile(pathMod.join(carpeta, `${nombre}.workflow.json`), 'utf8'),
          );
        } catch {
          // Sin metadatos no hay esquema que validar.
        }
        const errorArgs = validarArgsWorkflow(metadatos, args.args ?? {});
        if (errorArgs) {
          return {
            content: `Argumentos inválidos para el workflow "${nombre}": ${errorArgs}`,
            isError: true,
          };
        }
      }

      // Los argumentos viajan en un fichero: así no hay que escapar nada en Windows.
      const ficheroArgs = pathMod.join(
        os.tmpdir(),
        `workflow-args-${Date.now().toString(36)}.json`,
      );
      await fsp.writeFile(ficheroArgs, JSON.stringify(args.args ?? {}), 'utf8');

      const interprete = lenguaje === 'python' ? 'python' : 'node';
      /*
       * Sin comillas alrededor del intérprete: PowerShell trata `"node"` como
       * una cadena y no lo ejecuta. Las rutas sí van entre comillas.
       */
      const comando = `${interprete} "${rutaScript}" "${ficheroArgs}"`;

      const resultado = await ejecutarComando({
        command: comando,
        cwd,
        waitDurationSeconds: Number(
          args.waitMillis ?? metadatos.workflowWaitMillis ?? metadatos.WorkflowWaitMillis ?? 10000,
        ),
        taskName: `Workflow ${nombre || lenguaje}`,
      }, ctx);

      // Limpieza de los temporales cuando el workflow ya terminó.
      if (temporal) {
        setTimeout(() => fsp.unlink(temporal).catch(() => {}), 30_000).unref?.();
      }
      setTimeout(() => fsp.unlink(ficheroArgs).catch(() => {}), 30_000).unref?.();

      return resultado;
    },
  };
}

/**
 * Devuelve la ventana del navegador integrado, si está viva.
 *
 * La necesita `generate_image` cuando se le llama fuera del agente (por IPC),
 * donde no hay una referencia local a la ventana.
 */
function navegadorIntegrado(flow = false) {
  const ventana = flow ? builtInFlowBrowser : builtInBrowser;
  return ventana && !ventana.isDestroyed() ? ventana : null;
}

module.exports = {
  navegadorIntegrado,
  makeBrowserTools,
  makeSearchFilesTool,
  makeFileSearchTool,
  makeEditFileTool,
  makeMultiReplaceTool,
  makeRunCommandTool,
  matarTodasLasTareas,
  matarTarea,
  setAlTerminarTarea,
  makeCommandStatusTool,
  makeManageTaskTool,
  makeSearchWebTool,
  makeViewCodeItemTool,
  makeEditNotebookTool,
  makeGenerateImageTool,
  makeRunWorkflowTool,
  validarArgsWorkflow,
  esquemaDeWorkflow,
  makeRunExtensionCodeTool,
  isUrlAllowed,
  makeFetchUrlTool,
  makeOpenUrlTool,
  openBuiltInBrowser,
  browserEvaluate,
  detenerProxyNavegador,
};
