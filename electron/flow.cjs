'use strict';

/**
 * Integración con Google Flow para `generate_image`.
 *
 * Google **no publica una API de Flow**: no hay endpoint, clave ni SDK. Lo único
 * que existe es la web, así que esta integración la maneja con el navegador
 * integrado de la app, usando la sesión de Google que el usuario ya tenga
 * abierta. No cuesta dinero y no necesita ninguna clave.
 *
 * Consecuencias que hay que tener presentes:
 * - **Es frágil**: si Google cambia el marcado de Flow, los selectores fallan.
 *   Por eso se prueban varias formas de encontrar cada elemento y, si ninguna
 *   vale, se devuelve un error que dice exactamente qué no se encontró.
 * - **No es una API**: se conduce una interfaz. Un cambio de diseño la rompe.
 * - **Usa la sesión del usuario**: si no ha iniciado sesión, Flow pedirá login.
 */

const fsp = require('node:fs/promises');
const path = require('node:path');

/** URL de Flow. */
const URL_FLOW = 'https://flow.google.com/';

/** Cuánto se espera a que aparezca la imagen generada, en ms. */
const ESPERA_IMAGEN_MS = 180_000;

/** Cada cuánto se comprueba si ya hay imagen, en ms. */
const INTERVALO_MS = 2_000;

/** Partición persistente donde vive la sesión de Google de la app. */
const PARTICION_GOOGLE = 'persist:opengravity-flow';

/** Cookies con las que Google marca una sesión iniciada. */
const COOKIE_SESION = /^(SID|SAPISID|APISID|HSID|SSID|__Secure-3PSID|__Secure-1PSID)$/;

/**
 * ¿Hay una cuenta de Google conectada en el navegador integrado?
 *
 * Se consulta antes de abrir Flow: así un usuario nuevo recibe la instrucción
 * de conectar la cuenta en vez de una ventana de login abierta por detrás y un
 * error 25 s después.
 */
async function cuentaGoogleConectada() {
  try {
    // `electron` solo existe en el proceso principal; se carga aquí para que
    // los tests de flow.cjs sigan funcionando en Node sin Electron.
    const { session } = require('electron');
    const sesion = session.fromPartition(PARTICION_GOOGLE);
    const cookies = [
      ...(await sesion.cookies.get({ domain: '.google.com' })),
      ...(await sesion.cookies.get({ domain: '.accounts.google.com' })),
    ];
    return { conectada: cookies.some((c) => COOKIE_SESION.test(c.name)), cookies: cookies.length };
  } catch (error) {
    return { conectada: false, cookies: 0, error: String(error) };
  }
}

/** Mensaje único para cuando Flow manda a la pantalla de acceso de Google. */
function errorDeLogin() {
  return (
    'Flow pide iniciar sesión. En Ajustes > Google pulsa «Conectar» y entra con tu ' +
    'cuenta en la ventana que se abre; la sesión queda guardada para las próximas ' +
    'veces. Después, vuelve a pedir la imagen.'
  );
}

/**
 * Ejecuta JS en la página.
 *
 * Si `win` es una ventana de Electron, se usa su `webContents`. Si es un objeto
 * con `evaluar` —el Chrome del usuario conectado por CDP—, se delega en él.
 */
async function evaluar(win, script) {
  if (typeof win?.evaluar === 'function') return win.evaluar(script);
  return win.webContents.executeJavaScript(script, true);
}

/** Navega a una URL en cualquiera de los dos tipos de navegador. */
async function navegar(win, url) {
  if (typeof win?.navegar === 'function') return win.navegar(url);
  return win.loadURL(url);
}

/** URL actual, en cualquiera de los dos tipos. */
async function urlActual(win) {
  if (typeof win?.url === 'function') return win.url();
  try {
    return win.webContents.getURL();
  } catch {
    return '';
  }
}

/**
 * Encuentra la caja de prompt y escribe en ella.
 *
 * Se prueban textarea, input de texto y `contenteditable`, en ese orden: Flow
 * ha usado las tres formas y no hay garantía de cuál esté activa. El texto se
 * escribe con entrada real del navegador (`webContents.insertText`), no
 * manipulando el DOM: el editor de Flow es ProseMirror y descarta los cambios
 * que no llegan por su ruta de entrada.
 */
/**
 * Busca elementos también dentro de los iframes del mismo origen.
 *
 * Medido: Flow redirige a `flow.google.com` y su editor vive **dentro de un
 * iframe**. Buscar solo en el documento principal no encuentra nada, así que
 * todas las búsquedas pasan por este ayudante.
 */
const BUSCAR_EN_IFRAMES = `
  const todos = (selector) => {
    const salida = [...document.querySelectorAll(selector)];
    for (const marco of document.querySelectorAll('iframe')) {
      try {
        const doc = marco.contentDocument;
        if (doc) salida.push(...doc.querySelectorAll(selector));
      } catch {
        // iframe de otro origen: no accesible desde aquí
      }
    }
    return salida;
  };
`;

async function escribirPrompt(win, texto) {
  const preparado = await evaluar(
    win,
    `(() => {
      ${BUSCAR_EN_IFRAMES}

      const todosLosCampos = [
        ...todos('textarea'),
        ...todos('input[type="text"]'),
        ...todos('[contenteditable="true"]'),
        ...todos('[role="textbox"]'),
      ].filter((el) => el.offsetParent !== null);

      /*
       * No vale coger el primero: en el panel del proyecto el primer campo es la
       * BÚSQUEDA, y escribir ahí no genera nada. Se prefiere el que se identifica
       * como prompt (placeholder, aria-label o atributos) y, si ninguno lo hace,
       * el ÚLTIMO, que es donde Flow pone la caja de generación.
       */
      const parecePrompt = (el) => {
        const pistas = [
          el.getAttribute('placeholder'),
          el.getAttribute('aria-label'),
          el.getAttribute('data-placeholder'),
          el.getAttribute('data-testid'),
          el.className,
        ]
          .filter(Boolean)
          .join(' ');
        return /prompt|describe|descripci|imagine|imagina|scene|escena|what do you want|qué quieres/i.test(pistas);
      };

      const porPista = todosLosCampos.find(parecePrompt);
      const candidatos = porPista ? [porPista] : todosLosCampos.slice(-1);

      if (candidatos.length === 0) {
        // Diagnóstico: qué hay de verdad en la página, para no fallar a ciegas.
        return {
          ok: false,
          error: 'sin-caja',
          diagnostico: {
            url: location.href,
            titulo: document.title,
            texto: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 300),
            textareas: document.querySelectorAll('textarea').length,
            editables: document.querySelectorAll('[contenteditable="true"]').length,
            textbox: document.querySelectorAll('[role="textbox"]').length,
            inputs: document.querySelectorAll('input').length,
            iframes: document.querySelectorAll('iframe').length,
          },
        };
      }
      const elegido = candidatos[0];
      elegido.focus();
      return {
        ok: true,
        campo: {
          tag: elegido.tagName.toLowerCase(),
          placeholder: elegido.getAttribute('placeholder') ?? null,
          aria: elegido.getAttribute('aria-label') ?? null,
          total: todosLosCampos.length,
          porPista: Boolean(porPista),
        },
      };
    })()`,
  );

  if (!preparado?.ok) return preparado;

  /*
   * Escribir en el DOM no basta.
   *
   * Medido en Flow: asignar `textContent` (o `execCommand('insertText')`) dejó
   * el botón «Iniciar generación» en `disabled` y el clic no generó nada. No es
   * fiable porque el editor es ProseMirror y su estado interno manda. La
   * entrada real del navegador sí lo actualiza: `insertText` es la misma ruta
   * que usa el teclado.
   */
  const wc = win?.webContents;
  if (!wc || typeof wc.insertText !== 'function') {
    return { ok: false, error: 'el navegador no puede escribir texto en la página' };
  }

  // Reemplaza lo que hubiera: si no, el prompt se pega al anterior.
  if (typeof wc.selectAll === 'function') wc.selectAll();
  wc.insertText(String(texto));

  await new Promise((r) => setTimeout(r, 350));

  // Si el editor no lo aceptó, se dice aquí y no 3 minutos después como «sin imagen».
  const verificado = await evaluar(
    win,
    `(() => {
      /* texto-en-editor */
      ${BUSCAR_EN_IFRAMES}
      const esperado = ${JSON.stringify(String(texto).trim())};
      const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim();
      const campos = [
        ...todos('[contenteditable="true"]'),
        ...todos('textarea'),
      ].filter((el) => el.offsetParent !== null);
      const leidos = campos.map((el) => norm(el.value ?? el.innerText ?? ''));
      return { ok: leidos.some((t) => t.includes(norm(esperado))), leidos };
    })()`,
  );

  if (!verificado?.ok) {
    return {
      ok: false,
      error: 'el editor de Flow no aceptó el texto',
      campo: preparado.campo,
      leido: verificado?.leidos ?? null,
    };
  }

  return { ok: true, campo: preparado.campo, via: 'insertText' };
}

/**
 * Aplica una proporción (1:1, 16:9…) si Flow la ofrece.
 *
 * Se busca un botón o desplegable que mencione proporción o aspect y se elige la
 * opción que coincida. No se inventa nada: si no aparece, se devuelve el motivo.
 */
async function aplicarProporcion(win, proporcion) {
  const literal = JSON.stringify(String(proporcion));

  return evaluar(
    win,
    `(() => {
      const objetivo = ${literal};
      const visibles = [...document.querySelectorAll('button, [role="button"], [role="combobox"]')]
        .filter((b) => b.offsetParent !== null);

      const disparador = visibles.find((b) =>
        /aspect|proporci|ratio|\b1:1\b|\b16:9\b|\b9:16\b/i.test(
          (b.textContent || '') + ' ' + (b.getAttribute('aria-label') || ''),
        ),
      );
      if (!disparador) return { ok: false, error: 'Flow no muestra selector de proporción.' };

      disparador.click();

      // Las opciones suelen aparecer en un portal aparte del disparador.
      const opciones = [...document.querySelectorAll('[role="option"], [role="menuitem"], button')]
        .filter((o) => o.offsetParent !== null && (o.textContent || '').trim() === objetivo);

      if (opciones.length === 0) {
        return { ok: false, error: 'Flow no ofrece la proporción ' + objetivo + '.' };
      }

      opciones[0].click();
      return { ok: true };
    })()`,
  );
}

/**
 * Pone Flow en modo IMAGEN.
 *
 * Medido en su DOM: el popup de ajustes tiene un grupo `flow-toggles` con dos
 * `button[role=radio]` — **«imageImagen»** y **«videocamVídeo»** — que arranca en
 * vídeo. Se pulsa el de imagen y después se elige el modelo `Nano Banana`.
 *
 * Es obligatorio: en modo vídeo el desplegable de modelos solo ofrece Veo, y
 * generar ahí produce un vídeo, no una imagen.
 */
async function seleccionarModoImagen(win) {
  try {
    /*
     * El popup vive detrás de «Activador de ajustes»; sin abrirlo no existe
     * ninguno de sus controles.
     */
    const abrirAjustes = await evaluar(
      win,
      `(() => {
        ${BUSCAR_EN_IFRAMES}
        const vis = (e) => e.offsetParent !== null;
        const activador = [...todos('[aria-label="Activador de ajustes"]')].filter(vis)[0];
        if (!activador) return { ok: false, error: 'sin activador de ajustes' };
        activador.click();
        return { ok: true };
      })()`,
    );
    if (!abrirAjustes?.ok) return abrirAjustes;

    await new Promise((r) => setTimeout(r, 2000));

    // 1. Pulsar el radio de imagen.
    const modo = await evaluar(
      win,
      `(() => {
        ${BUSCAR_EN_IFRAMES}
        const vis = (e) => e.offsetParent !== null;
        const radios = [...todos('button[role="radio"], [role="radio"]')].filter(vis);
        const esImagen = (b) => /image|imagen/i.test(b.textContent || '');
        const esVideo = (b) => /videocam|vídeo|video/i.test(b.textContent || '');

        const imagen = radios.find((b) => esImagen(b) && !esVideo(b));
        if (!imagen) {
          return {
            ok: false,
            error: 'no encontré el conmutador Imagen/Vídeo',
            radios: radios.map((b) => (b.textContent || '').trim().slice(0, 18)).slice(0, 8),
          };
        }
        imagen.click();

        // Tras el clic, el radio debe quedar marcado. Si no, seguir generaría un vídeo.
        const marcado = (b) =>
          b.getAttribute('aria-checked') === 'true' ||
          b.getAttribute('aria-selected') === 'true' ||
          /is-selected|is-active|selected|active/.test(b.className || '') ||
          b.classList.contains('mat-mdc-radio-checked');

        return {
          ok: true,
          etiqueta: (imagen.textContent || '').trim().slice(0, 20),
          marcadoAntes: marcado(imagen),
        };
      })()`,
    );
    if (!modo?.ok) return modo;

    await new Promise((r) => setTimeout(r, 2500));

    /*
     * Comprobación obligatoria: si el modo no quedó en imagen, se aborta. Generar
     * en modo vídeo gasta créditos y devuelve un vídeo en vez de una imagen.
     */
    const confirmado = await evaluar(
      win,
      `(() => {
        ${BUSCAR_EN_IFRAMES}
        const vis = (e) => e.offsetParent !== null;
        const radios = [...todos('button[role="radio"], [role="radio"]')].filter(vis);
        const marcado = (b) =>
          b.getAttribute('aria-checked') === 'true' ||
          b.getAttribute('aria-selected') === 'true' ||
          /is-selected|is-active|selected|active/.test(b.className || '');

        const activos = radios.filter(marcado).map((b) => (b.textContent || '').trim().slice(0, 18));
        const enImagen = activos.some((t) => /imagen|image/i.test(t) && !/vídeo|video/i.test(t));

        // El desplegable de modelos es el otro indicador: en imagen ofrece Nano Banana.
        const modelo = [...todos('[aria-label="Seleccionar familia de modelos"]')].filter(vis)[0];
        const textoModelo = (modelo?.textContent || '').trim().slice(0, 40);
        const tieneBanana = /nano banana/i.test(textoModelo);

        return {
          ok: enImagen || tieneBanana,
          activos,
          modelo: textoModelo,
          error: enImagen || tieneBanana
            ? null
            : 'el modo no quedó en imagen; aborto para no generar un vídeo',
        };
      })()`,
    );
    if (!confirmado?.ok) return confirmado;

    // 2. Elegir un modelo de imagen en el desplegable.
    const selector = await evaluar(
      win,
      `(() => {
        ${BUSCAR_EN_IFRAMES}
        const vis = (e) => e.offsetParent !== null;
        const disp = [...todos('[aria-label="Seleccionar familia de modelos"]')].filter(vis)[0]
          || [...todos('*')].filter(vis).find((e) => /nano banana/i.test(e.textContent || '') && e.children.length <= 3);
        if (!disp) return { ok: false, error: 'sin selector de modelo' };
        disp.click();
        return { ok: true, actual: (disp.textContent || '').trim().slice(0, 30) };
      })()`,
    );
    if (!selector?.ok) return selector;

    await new Promise((r) => setTimeout(r, 1800));

    return await evaluar(
      win,
      `(() => {
        ${BUSCAR_EN_IFRAMES}
        const vis = (e) => e.offsetParent !== null;
        const items = [...todos('[role="menuitem"], [role="option"], li, button')].filter(vis);
        const banana = items.find((e) => /nano banana/i.test(e.textContent || ''));
        if (!banana) {
          return {
            ok: false,
            error: 'en modo imagen no apareció ningún modelo Nano Banana',
            modelos: items.map((e) => (e.textContent || '').trim().slice(0, 20)).filter(Boolean).slice(0, 8),
          };
        }
        banana.click();
        return { ok: true, modelo: (banana.textContent || '').trim().slice(0, 30) };
      })()`,
    );
  } catch (error) {
    return { ok: false, error: `error al poner modo imagen: ${error.message}` };
  }
}

/**
 * Descarta el banner de cookies.
 *
 * Medido: Flow muestra «Entendido» en la portada y en el proyecto, y ese overlay
 * se queda encima interceptando los clics. Sin quitarlo, pulsar «generar» no
 * hace nada.
 */
async function quitarConsentimiento(win) {
  try {
    return await evaluar(
      win,
      `(() => {
        ${BUSCAR_EN_IFRAMES}
        const botones = [...todos('button'), ...todos('[role="button"]')].filter((b) => b.offsetParent !== null);
        const aceptar = botones.find((b) =>
          /^(entendido|aceptar todo|accept all|i agree|got it|ok)$/i.test((b.textContent || '').trim()),
        );
        if (!aceptar) return { habia: false };
        aceptar.click();
        return { habia: true, etiqueta: (aceptar.textContent || '').trim() };
      })()`,
    );
  } catch {
    return { habia: false };
  }
}

/**
 * Entra al editor de Flow desde la portada.
 *
 * Se intenta primero «Try it now!» —crea un proyecto nuevo— y, si no está, el
 * primer proyecto existente. Devuelve `{ ok }` o `{ ok: false, error }`.
 */
async function entrarAlEditor(win) {
  const estado = await evaluar(
    win,
    `(() => {
      if (/accounts\\.google\\.com|\\/signin\\b|ServiceLogin/i.test(location.href)) {
        return { ok: false, error: 'login' };
      }
      const yaHayEditor = document.querySelectorAll('textarea').length > 0 ||
        document.querySelectorAll('[contenteditable="true"]').length > 0;
      if (yaHayEditor) return { ok: true, yaDentro: true };

      const botones = [...document.querySelectorAll('button, a')].filter((b) => b.offsetParent !== null);

      // Medido: la portada ofrece «Nuevo proyecto» además de «Try it now!».
      const probar = botones.find((b) =>
        /try it now|probar ahora|nuevo proyecto|new project|crear proyecto|empezar|start/i.test(
          (b.textContent || '').trim() + ' ' + (b.getAttribute('aria-label') || ''),
        ),
      );
      if (probar) {
        probar.click();
        return { ok: true, via: 'try-it-now' };
      }

      const proyecto = [...document.querySelectorAll('a[href*="/project/"]')][0];
      if (proyecto) {
        proyecto.click();
        return { ok: true, via: 'proyecto' };
      }

      return {
        ok: false,
        error: 'la portada no ofrece «Try it now!» ni proyectos',
        diagnostico: {
          url: location.href,
          botones: botones.length,
          enlaces: document.querySelectorAll('a').length,
          texto: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 220),
        },
      };
    })()`,
  );

  if (!estado?.ok) {
    return {
      ok: false,
      error: estado?.error ?? 'sin entrada al editor',
      diagnostico: estado?.diagnostico ?? null,
    };
  }

  /*
   * El editor tarda en montar. Se comprueba con reintentos en vez de esperar un
   * tiempo fijo: la primera consulta puede caer antes de que React pinte la caja.
   */
  const limite = Date.now() + 25_000;
  while (Date.now() < limite) {
    await new Promise((r) => setTimeout(r, 2_000));

    const listo = await evaluar(
      win,
      `(() => {
        ${BUSCAR_EN_IFRAMES}
        if (/accounts\\.google\\.com|\\/signin\\b|ServiceLogin/i.test(location.href)) {
          return { login: true };
        }
        const texto = (document.body.innerText || '').replace(/\\s+/g, ' ');
        if (/(Inicia|Iniciar) sesión|Sign in|Utiliza tu cuenta de Google|Correo electrónico o teléfono/i.test(texto)) {
          return { login: true };
        }
        return todos('textarea').length + todos('[contenteditable="true"]').length > 0;
      })()`,
    );

    if (listo === true) return { ok: true, via: estado.via ?? 'directo' };
    if (listo && listo.login) return { ok: false, error: 'login' };
  }

  return { ok: false, error: 'entré al proyecto pero la caja de prompt no apareció en 25 s' };
}

/**
 * Envía con Enter desde la propia caja de prompt.
 *
 * Es el segundo intento cuando el clic no arrancó nada. También va por entrada
 * real: un `KeyboardEvent` sintético no llega al editor de ProseMirror.
 */
async function enviarConEnter(win) {
  const foco = await evaluar(
    win,
    `(() => {
      ${BUSCAR_EN_IFRAMES}
      const campos = [
        ...todos('[contenteditable="true"]'),
        ...todos('textarea'),
      ].filter((el) => el.offsetParent !== null);
      if (campos.length === 0) return { ok: false, error: 'sin-campo' };

      campos[campos.length - 1].focus();
      return { ok: true };
    })()`,
  );
  if (!foco?.ok) return foco;

  const wc = win?.webContents;
  if (!wc?.sendInputEvent) return { ok: false, error: 'sin webContents para enviar teclas' };

  wc.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
  wc.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
  return { ok: true };
}

/** Pulsa el botón de generar, por texto o por tipo submit. */
async function pulsarGenerar(win) {
  /*
   * Primero se localiza el botón y se obtienen sus coordenadas.
   *
   * Medido: el botón real es button[aria-label="Iniciar generación"], dentro de
   * flow-generate-icon-button. Ese contenedor es solo el tooltip.
   */
  const posicion = await evaluar(
    win,
    `(() => {
      ${BUSCAR_EN_IFRAMES}
      const norm = (s) => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      // No se descarta «disabled»: hace falta verlo para explicar por qué no genera.
      const vis = (e) => e.offsetParent !== null;

      const boton =
        [...todos('button, [role="button"]')]
          .filter(vis)
          .find((b) => norm(b.getAttribute('aria-label')).startsWith('iniciar generacion')) ||
        [...todos('flow-generate-icon-button button')].filter(vis)[0] ||
        [...todos('button')].filter(vis).find((b) => (b.textContent || '').trim() === 'arrow_forward');

      if (!boton) return { ok: false, error: 'sin boton de generar' };

      const r = boton.getBoundingClientRect();
      return {
        ok: true,
        x: Math.round(r.left + r.width / 2),
        y: Math.round(r.top + r.height / 2),
        etiqueta: (boton.getAttribute('aria-label') || boton.textContent || '').trim().slice(0, 30),
        deshabilitado: boton.disabled === true,
      };
    })()`,
  );

  if (!posicion?.ok) return posicion;

  /*
   * Un botón deshabilitado ignora el clic, incluso con entrada real. Es lo que
   * pasa si el editor no llegó a registrar el prompt, así que se avisa aquí en
   * vez de esperar tres minutos a que «aparezca una imagen».
   */
  if (posicion.deshabilitado) {
    return { ok: false, error: 'el botón de generar está deshabilitado: Flow no registró el prompt' };
  }

  /*
   * Se pulsa con entrada de ratón real (`sendInputEvent`), igual que el usuario.
   * Un `button.click()` también llega a Angular, pero con el botón deshabilitado
   * no hace nada; la comprobación de arriba es la que evita ese falso negativo.
   */
  const wc = win?.webContents;
  if (!wc) return { ok: false, error: 'el navegador no expone webContents para enviar entrada' };

  const { x, y } = posicion;
  wc.sendInputEvent({ type: 'mouseMove', x, y });
  await new Promise((r) => setTimeout(r, 120));
  wc.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
  await new Promise((r) => setTimeout(r, 90));
  wc.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });

  return { ok: true, etiqueta: posicion.etiqueta, x, y, via: 'sendInputEvent' };
}

/**
 * Busca una imagen generada que no estuviera antes.
 *
 * Se guardan las `src` que ya existían y se espera a una nueva: así no se
 * devuelve una imagen de la galería previa como si fuera el resultado.
 */
async function instantaneaDeImagenes(win) {
  const srcs = await evaluar(
    win,
    `(() => { ${BUSCAR_EN_IFRAMES}
      return [...todos('img')]
        .filter((i) => i.naturalWidth >= 200)
        .map((i) => i.currentSrc || i.src)
        .filter(Boolean);
    })()`,
  );
  return new Set(Array.isArray(srcs) ? srcs : []);
}

/** Espera a que aparezca una imagen nueva. Devuelve su URL o null. */
async function esperarImagenNueva(win, previas, limiteMs = ESPERA_IMAGEN_MS) {
  const inicio = Date.now();

  while (Date.now() - inicio < limiteMs) {
    await new Promise((r) => setTimeout(r, INTERVALO_MS));

    let actuales;
    try {
      actuales = await evaluar(
        win,
        `(() => { ${BUSCAR_EN_IFRAMES}
          // Solo las que ya están cargadas y son grandes: descarta avatares.
          return [...todos('img')]
            .filter((i) => i.naturalWidth >= 200)
            .map((i) => i.currentSrc || i.src)
            .filter(Boolean);
        })()`,
      );
    } catch {
      // La página pudo navegar: se sigue intentando hasta el límite.
      continue;
    }

    /*
     * No se filtra por el patrón de la URL.
     *
     * Medido: Flow sirve las imágenes generadas en
     * `https://flow.google.com/asb/ANqv…`, sin extensión y fuera de
     * googleusercontent — así que cualquier filtro por patrón las descartaba
     * todas. Se devuelven las nuevas y la validación real la hace la descarga,
     * comprobando los bytes.
     */
    const nuevas = (actuales ?? []).filter((src) => !previas.has(src));
    // Los avatares y logos estáticos no son el resultado.
    const utiles = nuevas.filter((src) => !/gstatic\.com|\/ogw\//i.test(src));
    if (utiles.length > 0) return utiles[0];
  }

  return null;
}

/** Tipo real según los primeros bytes, o null si no son de imagen. */
function tipoDeImagen(buffer) {
  if (!buffer || buffer.length < 12) return null;

  // PNG
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'png';
  // JPEG
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpeg';
  // WebP (RIFF....WEBP)
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  // GIF
  if (buffer.toString('ascii', 0, 3) === 'GIF') return 'gif';

  return null;
}

/** Extensión que corresponde a cada tipo. */
const EXTENSIONES = { png: '.png', jpeg: '.jpg', webp: '.webp', gif: '.gif' };

/** ¿Los primeros bytes corresponden a una imagen de verdad? */
function esImagen(buffer) {
  return tipoDeImagen(buffer) !== null;
}

/**
 * Descarga los bytes de una imagen con la sesión del navegador.
 *
 * Medido: Flow sirve las imágenes en `https://flow.google.com/asb/…` y esa URL
 * exige las cookies de Google. El `fetch` de Node no las tiene: devuelve 200
 * pero con una página HTML en vez de la imagen. La sesión del navegador
 * integrado sí las envía.
 */
async function descargarImagen(win, url) {
  // Un `blob:` solo se puede leer desde la página que lo creó.
  if (/^blob:/i.test(url)) {
    const dataUrl = win ? await blobADataUrl(win, url) : null;
    const base64 = dataUrl ? /^data:[^;]+;base64,(.*)$/s.exec(dataUrl)?.[1] : null;
    if (!base64) throw new Error('no se pudo leer el blob de la imagen');
    return Buffer.from(base64, 'base64');
  }

  const sesion = win?.webContents?.session;
  const respuesta =
    sesion && typeof sesion.fetch === 'function' ? await sesion.fetch(url) : await fetch(url);

  if (!respuesta.ok) throw new Error(`la descarga devolvió ${respuesta.status}`);
  return Buffer.from(await respuesta.arrayBuffer());
}

/**
 * Comprueba que una URL devuelve una imagen, sin guardarla.
 *
 * Rechaza vídeos: Flow genera imagen y vídeo en el mismo sitio, y un `.mp4`
 * guardado como `.png` no lo abre nadie.
 */
async function comprobarQueEsImagen(win, url) {
  try {
    const buffer = await descargarImagen(win, url);
    if (esImagen(buffer)) return { ok: true };

    const tipo = buffer.subarray(0, 12).toString('ascii').replace(/[^\x20-\x7e]/g, '.');
    return { ok: false, motivo: `no es una imagen (empieza por «${tipo}»)` };
  } catch (error) {
    return { ok: false, motivo: error.message };
  }
}

/**
 * Convierte una URL `blob:` en una data URL leyéndola dentro de la página.
 *
 * Desde el proceso principal no se puede hacer `fetch` de un `blob:`: solo
 * existe en el contexto del navegador que lo creó.
 */
async function blobADataUrl(win, url) {
  const literal = JSON.stringify(url);
  return evaluar(
    win,
    `(async () => {
      try {
        const r = await fetch(${literal});
        const b = await r.blob();
        return await new Promise((resolve) => {
          const lector = new FileReader();
          lector.onload = () => resolve(lector.result);
          lector.onerror = () => resolve(null);
          lector.readAsDataURL(b);
        });
      } catch {
        return null;
      }
    })()`,
  );
}

async function guardarImagen(url, destino, win) {
  const buffer = await descargarImagen(win, url);
  const tipo = tipoDeImagen(buffer);
  if (!tipo) {
    throw new Error(`lo descargado no es una imagen (${buffer.length} bytes de otro tipo)`);
  }

  /*
   * La extensión se corrige según los bytes: Flow puede devolver JPEG aunque la
   * ruta pedida acabe en .png, y el MIME que luego usa el hilo sale de la
   * extensión. Sin esto, el fichero se guarda con un tipo que no le corresponde.
   */
  const esperada = EXTENSIONES[tipo];
  const actual = path.extname(destino).toLowerCase();
  const archivo = actual === esperada
    ? destino
    : (actual ? destino.slice(0, -actual.length) : destino) + esperada;

  await fsp.mkdir(path.dirname(archivo), { recursive: true });
  await fsp.writeFile(archivo, buffer);
  return archivo;
}

/**
 * Genera una imagen en Flow.
 *
 * `win` es el BrowserWindow del navegador integrado, ya creado. Devuelve
 * `{ ok, url, ruta }` o `{ ok: false, error }` con el motivo exacto.
 */
async function generarEnFlow(win, { prompt, destino, esperaMs, aspectRatio } = {}) {
  const traza = [];
  const anotar = (paso, resultado) => traza.push(`${paso}: ${JSON.stringify(resultado).slice(0, 90)}`);

  const texto = String(prompt ?? '').trim();
  if (texto.length === 0) return { ok: false, error: 'El prompt está vacío.' };
  if (!win || win.isDestroyed()) return { ok: false, error: 'No hay navegador abierto.' };

  // Solo se navega si no se está ya en Flow: recargar perdería el estado.
  let actual = await urlActual(win);

  // Vale tanto la portada nueva como la ruta antigua que redirige a ella.
  if (!/flow\.google\.com|labs\.google\/fx\/tools\/flow/i.test(actual)) {
    await navegar(win, URL_FLOW);
    // La app de Flow tarda en montar; sin esta espera no hay caja de prompt.
    await new Promise((r) => setTimeout(r, 6_000));
    actual = await urlActual(win);
  }

  /*
   * Si no hay sesión, Flow redirige a accounts.google.com. Se comprueba la URL
   * además del texto: la pantalla usa «Inicia sesión», que no coincidía con
   * «Iniciar sesión» y dejaba al usuario esperando 25 s delante de un login.
   */
  if (/accounts\.google\.com|\/signin\b|ServiceLogin/i.test(actual)) {
    return { ok: false, error: errorDeLogin() };
  }

  const pideLogin = await evaluar(
    win,
    `(() => {
      const texto = (document.body.innerText || '').replace(/\\s+/g, ' ');
      return /(Inicia|Iniciar) sesión|Sign in|Utiliza tu cuenta de Google|Correo electrónico o teléfono/i.test(texto)
        || /accounts\\.google\\.com|\\/signin\\b|ServiceLogin/i.test(location.href);
    })()`,
  );
  if (pideLogin) {
    return { ok: false, error: errorDeLogin() };
  }

  /*
   * Proporción, si se pidió. Flow la expone en un selector junto al prompt; si
   * no se encuentra, se sigue con la que tenga puesta en vez de fallar: la
   * imagen sale igual, solo con otra forma.
   */
  let avisoProporcion = null;
  if (aspectRatio) {
    const aplicada = await aplicarProporcion(win, aspectRatio);
    if (!aplicada.ok) avisoProporcion = aplicada.error;
  }

  /*
   * La portada de Flow no tiene editor: hay que entrar a un proyecto. Se prueba
   * «Try it now!» y, si no aparece, el primer proyecto de la lista. Medido: la
   * portada enlaza a `/project/<uuid>` y no expone ninguna caja de texto.
   */
  // El banner de cookies tapa la interfaz y se come los clics.
  const consentimiento = await quitarConsentimiento(win);
  if (consentimiento?.habia) await new Promise((r) => setTimeout(r, 800));

  let entrada = await entrarAlEditor(win);
  if (!entrada.ok && entrada.error === 'login') {
    return { ok: false, error: errorDeLogin() };
  }
  if (!entrada.ok) {
    const d = entrada.diagnostico;
    const extra = d
      ? ` Página: ${d.url} · botones ${d.botones} · enlaces ${d.enlaces} · texto: «${d.texto}»`
      : '';
    return { ok: false, error: `No pude entrar al editor de Flow: ${entrada.error}.${extra}` };
  }

  // Dentro del proyecto el banner reaparece: se quita otra vez.
  const consentimiento2 = await quitarConsentimiento(win);
  if (consentimiento2?.habia) await new Promise((r) => setTimeout(r, 800));

  // Sin esto, Flow puede generar un VÍDEO en vez de una imagen.
  const modo = await seleccionarModoImagen(win);
  anotar('modo', modo);
  if (!modo?.ok) {
    return {
      ok: false,
      error:
        'Flow no quedó en modo Imagen; aborto para no generar un vídeo. ' +
        (modo?.error ?? 'No encontré el conmutador de modo.'),
    };
  }
  await new Promise((r) => setTimeout(r, 1500));

  const previas = await instantaneaDeImagenes(win);

  const escrito = await escribirPrompt(win, texto);
  anotar('escribir', { ok: escrito?.ok, campo: escrito?.campo });
  if (!escrito?.ok) {
    const d = escrito?.diagnostico;
    const detalle = d
      ? ` Página: ${d.url} · título «${d.titulo}» · textareas ${d.textareas} · ` +
        `editables ${d.editables} · textbox ${d.textbox} · inputs ${d.inputs} · ` +
        `iframes ${d.iframes} · texto: «${d.texto}»`
      : '';
    const motivo =
      escrito?.error === 'sin-caja'
        ? 'No encontré la caja de prompt de Flow. Su interfaz pudo cambiar.'
        : `No pude escribir en la caja de prompt de Flow: ${escrito?.error ?? 'error desconocido'}.`;
    return {
      ok: false,
      error: motivo + detalle,
      diagnostico: d ?? null,
      leido: escrito?.leido ?? null,
    };
  }

  await new Promise((r) => setTimeout(r, 500));

  const pulsado = await pulsarGenerar(win);
  anotar('pulsar', pulsado);
  if (!pulsado?.ok) {
    const motivo = pulsado?.error ? `: ${pulsado.error}` : '. Su interfaz pudo cambiar.';
    return { ok: false, error: `No pude pulsar el botón de generar de Flow${motivo}`, traza };
  }

  // Si el botón no arrancó la generación, se prueba a enviar con Enter.
  let url = await esperarImagenNueva(win, previas, 25_000);

  if (!url) {
    const enter = await enviarConEnter(win);
    if (enter?.ok) {
      url = await esperarImagenNueva(win, previas, esperaMs ?? ESPERA_IMAGEN_MS);
    }
  }

  if (!url) {
    /*
     * Diagnóstico: qué produjo Flow. Las imágenes pueden llegar como <img>,
     * como `background-image` o dibujadas en un <canvas>, y sin esto no hay
     * forma de saber cuál de las tres es.
     */
    let visto = null;
    try {
      visto = await evaluar(
        win,
        `(() => {
          ${BUSCAR_EN_IFRAMES}
          const fondos = todos('*')
            .map((e) => getComputedStyle(e).backgroundImage)
            .filter((b) => b && b !== 'none' && b.startsWith('url(')).length;
          return {
            imgs: todos('img').length,
            fondos,
            canvas: todos('canvas').length,
            video: todos('video').length,
            // Las primeras URLs, para saber por qué no se aceptan.
            urls: todos('img').map((i) => (i.currentSrc || i.src || '').slice(0, 90)).slice(0, 8),
            texto: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 200),
          };
        })()`,
      );
    } catch {
      visto = null;
    }

    const campo = escrito?.campo;
    const dondeEscribi = campo
      ? ` Escribí en <${campo.tag}> de ${campo.total} campos` +
        ` (placeholder ${campo.placeholder ?? 'ninguno'}, aria ${campo.aria ?? 'ninguno'}` +
        `, por pista: ${campo.porPista ? 'sí' : 'no'}).`
      : '';

    const detalle = (visto
      ? ` En la página: ${visto.imgs} imágenes, ${visto.fondos} fondos con url(), ` +
        `${visto.canvas} canvas, ${visto.video} vídeos. URLs: ${JSON.stringify(visto.urls)}. ` +
        `Texto: «${visto.texto}»`
      : '') + dondeEscribi;

    return {
      ok: false,
      error:
        'Flow no devolvió ninguna imagen nueva en el tiempo de espera. Puede que estés sin ' +
        'créditos, que haya un límite diario, o que la generación siga en curso.' +
        detalle +
        ` Traza: ${traza.join(' · ')}`,
      diagnostico: visto,
      traza,
    };
  }

  /*
   * Sin destino también se valida: la URL puede apuntar a un VÍDEO (Flow genera
   * los dos) y devolverla como imagen sería mentir.
   */
  if (!destino) {
    const comprobacion = await comprobarQueEsImagen(win, url);
    if (!comprobacion.ok) {
      return {
        ok: false,
        error:
          `Flow generó algo en ${url.slice(0, 60)}… pero no es una imagen ` +
          `(${comprobacion.motivo}). Puede que el proyecto esté en modo vídeo.`,
      };
    }
    return { ok: true, url, avisoProporcion };
  }

  try {
    const ruta = await guardarImagen(url, destino, win);
    return { ok: true, url, ruta };
  } catch (error) {
    return { ok: true, url, error: `La imagen se generó pero no se pudo guardar: ${error.message}` };
  }
}

module.exports = {
  URL_FLOW,
  ESPERA_IMAGEN_MS,
  PARTICION_GOOGLE,
  cuentaGoogleConectada,
  errorDeLogin,
  generarEnFlow,
  escribirPrompt,
  pulsarGenerar,
  aplicarProporcion,
  entrarAlEditor,
  quitarConsentimiento,
  enviarConEnter,
  seleccionarModoImagen,
  esperarImagenNueva,
  instantaneaDeImagenes,
  guardarImagen,
  esImagen,
  tipoDeImagen,
  blobADataUrl,
  comprobarQueEsImagen,
};
