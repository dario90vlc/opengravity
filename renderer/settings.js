'use strict';

/**
 * Panel de ajustes.
 *
 * Reproduce la estructura de la UI analizada: navegación lateral por secciones
 * y, en cada una, grupos de filas con etiqueta, descripción y control.
 *
 * Se expone como `window.SettingsUI` para que `app.js` lo abra y refresque sin
 * compartir estado interno.
 */

(function () {
  const $ = (id) => document.getElementById(id);

  const els = {
    modal: $('settings-modal'),
    nav: $('settings-nav'),
    title: $('settings-title'),
    subtitle: $('settings-subtitle'),
    body: $('settings-body'),
    back: $('settings-back'),
    feedback: $('settings-feedback'),
    projects: $('settings-projects'),
    projectsMore: $('settings-projects-more'),
  };

  /** Valores por defecto de las preferencias. */
  const DEFAULTS = {
    permissionPreset: 'Turbo',
    planReviewPolicy: 'Always Ask',
    queuedMessages: 'Queue',
    openLinksIn: 'External Browser',
    downloadPath: '',
    browserJsPolicy: 'Request Review',
    rulesEnabled: true,
    rulesBudget: 20000,
    restrictToWorkspace: false,
    goRoot: '',
    sandboxMemoryMB: 1024,
    sandboxMaxProcesses: 32,
    sandboxCpuSeconds: 300,
    theme: 'Dark',
    themeContrast: 'Default',
    darkPreset: 'Default Dark',
    notifications: true,
    sounds: false,
    volume: 100,
    remoteControl: false,
    ssh: { host: '', port: 22, user: '', remotePath: '/', keyPath: '', hostFingerprint: '' },
    uiLanguage: 'auto',
  };

  /** Se rellena desde `app.js`. */
  let bridge = null;

  /** Preferencias actuales. */
  let prefs = { ...DEFAULTS };

  /** Último estado del actualizador enviado por el proceso principal. */
  let updateState = null;

  /** Sección activa. */
  let active = 'general';

  /** Proyectos conocidos por las conversaciones guardadas. */
  let proyectos = [];
  let proyectoActivo = null;
  let mostrarTodosLosProyectos = false;
  /** Carpeta de descargas del sistema, para enseñarla mientras no haya pref. */
  let downloadDir = '';

  // -------------------------------------------------------------------------
  // Descripciones de sección
  // -------------------------------------------------------------------------

  const SECTIONS = {
    general: {
      title: 'General',
      subtitle: 'Configure agent execution, queued message delivery, and permissions.',
    },
    account: {
      title: 'Google',
      subtitle: 'Cuenta de Google para Flow y la generación de imágenes.',
    },
    appearance: {
      title: 'Appearance',
      subtitle: 'Configura el tema visual y las preferencias de presentación.',
    },
    notifications: {
      title: 'Notifications',
      subtitle: 'Gestiona las preferencias de notificación.',
    },
    models: {
      title: 'Models & Usage',
      subtitle: 'Elige el proveedor y el modelo que usa el agente.',
    },
    browser: {
      title: 'Browser',
      subtitle: 'Configure built-in browser, link opening, and browser subagent preferences.',
    },
    conversations: {
      title: 'Conversations',
      // Su subtítulo, literal.
      subtitle: 'Ajustes para las conversaciones que no están dentro de un proyecto.',
    },
    feedback: {
      title: 'Give Feedback',
      subtitle: 'Cuéntanos qué falla o qué falta.',
    },
    customizations: {
      title: 'Customizations',
      subtitle: 'Configura comportamientos por defecto, skills y servidores MCP.',
    },
    application: {
      title: 'Application',
      subtitle: 'Espacio de trabajo, control remoto y comportamiento de la aplicación.',
    },
    google: {
      title: 'Google',
      subtitle: 'Conecta tu cuenta para generar imágenes con Flow.',
      parent: 'account',
    },
    project: {
      title: 'Projects',
      subtitle: 'Manage project folders and settings.',
    },
    developer: {
      title: 'Developer',
      subtitle:
        'Herramientas solo para desarrollo. Estos ajustes se guardan en local y no ' +
        'afectan a otros usuarios.',
    },
    shortcuts: {
      title: 'Shortcuts',
      subtitle: 'Atajos de teclado disponibles.',
    },
    // --- Sub-paneles ---
    tools: {
      title: 'Tool Permissions',
      subtitle: 'Permisos por herramienta. Tienen prioridad sobre el preset global.',
      parent: 'general',
    },
    network: {
      title: 'Network Access Rules',
      subtitle: 'Dominios permitidos y denegados para lectura y navegación.',
      parent: 'general',
    },
    plugins: {
      title: 'Plugins',
      subtitle: 'Servidores MCP que se conectan al arrancar cada turno.',
      parent: 'customizations',
    },
  };

  // -------------------------------------------------------------------------
  // Constructores de controles
  // -------------------------------------------------------------------------

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  /**
   * Desplegable propio, con las medidas de Antigravity:
   * panel 268x199 con radio 12, padding 4 y gap 1; opción de 47 px, radio 7,
   * 13/19.5, texto inactivo rgb(188,189,198) y activo blanco con check.
   *
   * Un `<select>` nativo se pinta con el tema del sistema y salía blanco sobre
   * la interfaz oscura, así que no sirve.
   */
  /** Cierra todos los desplegables abiertos. */
  function cerrarDesplegables() {
    for (const p of document.querySelectorAll('.dropdown__panel')) p.hidden = true;
    for (const t of document.querySelectorAll('.dropdown__trigger')) t.setAttribute('aria-expanded', 'false');
  }

  /*
   * Un solo listener para todos los desplegables. `makeSelect` registraba dos
   * por instancia y cada render de Ajustes dejaba dos más sobre nodos muertos.
   * Los clicks dentro del desplegable no llegan aquí: el trigger y el wrapper
   * cortan la propagación.
   */
  document.addEventListener('click', () => cerrarDesplegables());
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') cerrarDesplegables();
  });

  /**
   * Tarjetas de «Interface Layout».
   *
   * Medidas del original: 306×112, rejilla de dos columnas con gap 12, relleno
   * 14, radio 12. La elegida lleva el primario al 10 % y `aria-pressed`.
   */
  function makeLayoutCards() {
    const grid = el('div', 'layout-cards');
    const actual = prefs.persona ?? 'engineering';

    const perfiles = [
      {
        id: 'knowledge-work',
        titulo: 'Knowledge Work',
        descripcion: 'Simplified interface for research, writing, and everyday tasks.',
        icono: 'files',
      },
      {
        id: 'engineering',
        titulo: 'Software Engineering',
        descripcion: 'Full interface for coding, developer tools, and managing agents.',
        icono: 'terminal',
      },
    ];

    for (const perfil of perfiles) {
      const card = el('button', 'layout-card');
      card.type = 'button';
      card.setAttribute('aria-pressed', String(perfil.id === actual));
      card.classList.toggle('is-selected', perfil.id === actual);

      const icono = el('span', 'layout-card__icon');
      icono.innerHTML = window.Icon(perfil.icono, 16);
      card.append(icono);
      card.append(el('span', 'layout-card__title', perfil.titulo));
      card.append(el('span', 'layout-card__desc', perfil.descripcion));

      card.addEventListener('click', () => {
        setPref('persona', perfil.id);
        for (const otra of grid.querySelectorAll('.layout-card')) {
          const activa = otra === card;
          otra.setAttribute('aria-pressed', String(activa));
          otra.classList.toggle('is-selected', activa);
        }
      });

      grid.append(card);
    }

    return grid;
  }

  function makeSelect({ options, value, onChange, wide }) {
    const normalizadas = options.map((o) => (typeof o === 'string' ? { label: o } : o));
    const valorDe = (opcion) => opcion.value ?? opcion.label;
    const wrap = el('div', wide ? 'dropdown dropdown--wide' : 'dropdown');

    const trigger = el('button', 'dropdown__trigger');
    trigger.type = 'button';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');

    const rotulo = el('span', 'dropdown__value', '');
    const chevron = el('span', 'dropdown__chevron');
    chevron.innerHTML = window.Icon('chevronDown', 16);
    trigger.append(rotulo, chevron);

    const panel = el('div', 'dropdown__panel');
    panel.hidden = true;
    panel.setAttribute('role', 'listbox');

    let seleccionada = value;

    const pintar = () => {
      panel.replaceChildren();
      rotulo.textContent = normalizadas.find((o) => valorDe(o) === seleccionada)?.label ?? '';

      for (const opcion of normalizadas) {
        const item = el('button', 'dropdown__item');
        item.type = 'button';
        item.setAttribute('role', 'option');
        if (valorDe(opcion) === seleccionada) {
          item.classList.add('is-active');
          item.setAttribute('aria-selected', 'true');
        }

        const texto = el('span', 'dropdown__item-text');
        const titulo = el('span', 'dropdown__item-label', opcion.label);
        texto.append(titulo);
        if (opcion.description) {
          texto.append(el('span', 'dropdown__item-desc', opcion.description));
        }

        item.append(texto);
        if (valorDe(opcion) === seleccionada) {
          const check = el('span', 'dropdown__check');
          check.innerHTML = window.Icon('check', 16);
          item.append(check);
        }

        item.addEventListener('click', () => {
          seleccionada = valorDe(opcion);
          pintar();
          panel.hidden = true;
          trigger.setAttribute('aria-expanded', 'false');
          onChange(seleccionada);
        });

        panel.append(item);
      }
    };

    pintar();

    trigger.addEventListener('click', (event) => {
      event.stopPropagation();
      const abrir = panel.hidden;
      // Cierra cualquier otro desplegable abierto: dos a la vez se solapan.
      cerrarDesplegables();
      panel.hidden = !abrir;
      trigger.setAttribute('aria-expanded', String(abrir));
    });

    // El cierre al pulsar fuera y con Escape lo resuelve el listener global.
    wrap.addEventListener('click', (event) => event.stopPropagation());

    wrap.append(trigger, panel);
    return wrap;
  }

  function makeSegmented({ options, value, onChange }) {
    const wrap = el('div', 'segmented');
    for (const option of options) {
      const btn = el('button', 'segmented__btn', option);
      btn.type = 'button';
      if (option === value) btn.classList.add('is-active');
      btn.addEventListener('click', () => {
        for (const child of wrap.children) child.classList.remove('is-active');
        btn.classList.add('is-active');
        onChange(option);
      });
      wrap.append(btn);
    }
    return wrap;
  }

  function makeToggle({ value, onChange }) {
    const btn = el('button', value ? 'switch is-on' : 'switch');
    btn.type = 'button';
    btn.setAttribute('role', 'switch');
    btn.setAttribute('aria-checked', String(value));
    btn.addEventListener('click', () => {
      const next = !btn.classList.contains('is-on');
      btn.classList.toggle('is-on', next);
      btn.setAttribute('aria-checked', String(next));
      onChange(next);
    });
    return btn;
  }

  function makeButton({ label, onClick }) {
    const btn = el('button', 'btn', label);
    btn.type = 'button';
    btn.addEventListener('click', onClick);
    return btn;
  }

  /** Campo de texto para los proveedores personalizables. */
  function makeInput({ value, placeholder, type, onCommit }) {
    const input = document.createElement('input');
    input.type = type ?? 'text';
    input.className = 'text-input';
    input.placeholder = placeholder ?? '';
    input.value = value ?? '';
    input.spellcheck = false;

    const commit = () => onCommit(input.value.trim());
    input.addEventListener('change', commit);
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        commit();
      }
    });

    return input;
  }

  function makeSlider({ value, onChange }) {
    const wrap = el('div', 'slider');
    const input = document.createElement('input');
    input.type = 'range';
    input.min = '0';
    input.max = '100';
    input.value = String(value);
    const out = el('span', 'slider__value', `${value}%`);

    input.addEventListener('input', () => {
      out.textContent = `${input.value}%`;
      onChange(Number(input.value));
    });

    wrap.append(input, out);
    return wrap;
  }

  // -------------------------------------------------------------------------
  // Constructores de estructura
  // -------------------------------------------------------------------------

  function makeRow({ label, desc, hint, control, badge, className }) {
    const row = el('div', className ? `row ${className}` : 'row');
    const main = el('div', 'row__main');

    const labelEl = el('div', 'row__label');
    labelEl.append(document.createTextNode(label));
    if (badge !== undefined) labelEl.append(el('span', 'count-badge', String(badge)));
    main.append(labelEl);

    if (desc) main.append(el('div', 'row__desc', desc));

    if (hint) {
      const hintEl = el('div', 'row__hint');
      hintEl.append(hint);
      main.append(hintEl);
    }

    row.append(main);

    if (control) {
      const controlWrap = el('div', 'row__control');
      controlWrap.append(control);
      row.append(controlWrap);
    }

    return row;
  }

  function makeGroup(rows) {
    const group = el('div', 'row-group');
    for (const row of rows) group.append(row);
    return group;
  }

  /**
   * Sección con cabecera desplegable, como la suya.
   *
   * Medido en su DOM: el título es `text-sm font-medium` (14 px), al lado un
   * contador de **10 px** semibold en pastilla (`bg-secondary`, `px-1.5 py-0.5`,
   * `rounded-full`, con borde) y un chevron de 16 que gira 90° al abrir.
   */
  function makeSection({ title, desc, rows, count, abierta = true, grouped = true }) {
    const section = el('section');

    const head = el('button', 'settings__section-head');
    head.type = 'button';
    head.setAttribute('aria-expanded', String(abierta));

    head.append(el('h3', 'settings__section-title', title));

    if (typeof count === 'number') {
      head.append(el('span', 'settings__section-count', String(count)));
    }

    const chevron = el('span', 'settings__section-chevron');
    chevron.innerHTML = window.Icon('chevron', 16);
    head.append(chevron);

    if (desc) section.append(el('p', 'settings__section-desc', desc));

    const cuerpo = el('div', 'settings__section-body');
    if (grouped) {
      cuerpo.append(makeGroup(rows));
    } else {
      const contenedor = el('div', 'row-groupless');
      contenedor.append(...rows);
      cuerpo.append(contenedor);
    }
    cuerpo.hidden = !abierta;

    head.addEventListener('click', () => {
      const abrir = head.getAttribute('aria-expanded') !== 'true';
      head.setAttribute('aria-expanded', String(abrir));
      cuerpo.hidden = !abrir;
    });

    section.append(head, cuerpo);
    return section;
  }

  function makeInfo(text) {
    const block = el('div', 'info-block');
    block.textContent = text;
    return block;
  }

  // -------------------------------------------------------------------------
  // Persistencia
  // -------------------------------------------------------------------------

  function setPref(key, value) {
    const anterior = prefs[key];
    prefs[key] = value;
    /*
     * Si el disco falla, el interruptor no puede quedarse encendido mintiendo:
     * se vuelve al valor anterior, se repinta y se avisa. Antes el error se
     * tragaba con un `.catch(() => {})`.
     */
    const guardado = window.api
      .setPrefs({ [key]: value })
      .then((respuesta) => {
        if (respuesta && respuesta.ok === false) throw new Error(respuesta.error ?? 'no se pudo guardar');
        return respuesta;
      })
      .catch((error) => {
        prefs[key] = anterior;
        if (typeof bridge?.onPrefChange === 'function') {
          bridge.onPrefChange(key, anterior, prefs);
        }
        bridge?.addNotice?.(
          `No se pudo guardar «${key}»: ${error?.message ?? error}`,
          'error',
        );
        // No se relanza: los llamantes son toggles sin await y quedaría
        // una promesa rechazada sin dueño.
        return null;
      });
    // Avisa a la app para que aplique el cambio (contraste, sonido, cola…).
    if (bridge && typeof bridge.onPrefChange === 'function') {
      bridge.onPrefChange(key, value, prefs);
    }
    return guardado;
  }

  // -------------------------------------------------------------------------
  // Render por sección
  // -------------------------------------------------------------------------

  function renderGeneral() {
    const state = bridge.getState();
    const availableProviders = state.providers.filter((entry) => entry.available).length;

    return [
      /*
       * Interface Layout: medido en el original (306×112, rejilla de 2, gap 12,
       * relleno 14, radio 12; la elegida va con el primario al 10 %). No cambia
       * la interfaz: cambia el perfil con el que trabaja el agente.
       */
      makeSection({
        title: 'Interface Layout',
        // Las tarjetas ya tienen su propio borde; el row-group las unía en una celda.
        grouped: false,
        rows: [
          makeLayoutCards(),
        ],
      }),
      makeSection({
        title: 'Global Permissions',
        desc: 'Configure global allowed and denied resource permissions. Learn more.',
        rows: [
          makeRow({
            label: 'Permission Preset',
            desc: 'Controls the actions the agent can take.',
            control: makeSelect({
              options: [
                { label: 'Request Review', description: 'Every command requires approval.' },
                { label: 'Default', description: 'Ask before sensitive operations.' },
                { label: 'Auto (Preview)', description: 'Decide alone whether the command may run.' },
                { label: 'Turbo', description: 'Run without restrictions.' },
              ],
              value: prefs.permissionPreset,
              onChange: (value) => setPref('permissionPreset', value),
            }),
          }),
          makeRow({
            label: 'Tool Permissions',
            desc: 'Modify permissions for file, terminal, and MCP tools.',
            badge: 8,
            control: makeButton({ label: 'Open', onClick: () => selectSection('tools') }),
          }),
          makeRow({
            label: 'Network Access Rules',
            desc: 'Configure allowed and denied URLs for reading.',
            control: makeButton({ label: 'Open', onClick: () => selectSection('network') }),
          }),
        ],
      }),

      makeSection({
        title: 'Agent Behavior',
        desc: null,
        rows: [
          makeRow({
            label: 'Plan Review Policy',
            desc: 'Whether the agent asks you to review its documents.',
            hint: buildPlanHint(),
            control: makeSelect({
              options: ['Always Ask', 'Always Review', 'Never'],
              value: prefs.planReviewPolicy,
              onChange: (value) => setPref('planReviewPolicy', value),
            }),
          }),
        ],
      }),

      makeSection({
        title: 'Execution',
        desc: null,
        rows: [
          makeRow({
            label: 'Queued Messages',
            desc: 'Configure when follow-up messages are sent.',
            hint: buildShortcutHint(),
            control: makeSegmented({
              options: ['Queue', 'Send Immediately'],
              value: prefs.queuedMessages,
              onChange: (value) => setPref('queuedMessages', value),
            }),
          }),
          // Su General termina con este acceso a la lista de atajos.
          makeRow({
            label: 'Keyboard shortcuts',
            desc: 'Keyboard shortcuts for quick navigation and control.',
            control: makeButton({ label: 'Open', onClick: () => selectSection('shortcuts') }),
          }),
          /*
           * Equivalente a `merge_subagents_latency_ms`: cuánto espera el turno a
           * los subagentes lanzados a la vez antes de fusionar lo que haya.
           */
          makeRow({
            label: 'Subagent wait',
            desc: 'How long the turn waits for parallel subagents before merging what arrived.',
            control: makeSelect({
              options: [
                { label: '1 minute', value: 60_000 },
                { label: '2 minutes', value: 120_000 },
                { label: '3 minutes', value: 180_000 },
                { label: '5 minutes', value: 300_000 },
                { label: 'No limit', value: 0 },
              ],
              value: Number(prefs.subagentMergeLatencyMs ?? 180_000),
              onChange: (value) => setPref('subagentMergeLatencyMs', Number(value)),
            }),
          }),
        ],
      }),

      makeInfo(
        `${availableProviders} of ${state.providers.length} model providers available. ` +
          'Configure them in Models.',
      ),
    ];
  }

  /** Sección Browser: mismas filas que la suya, medidas en 2.31. */
  function renderBrowser() {
    const ruta = prefs.downloadPath || downloadDir || '';

    const controlUbicacion = document.createElement('div');
    controlUbicacion.className = 'row__inline';
    if (ruta) controlUbicacion.append(el('span', 'row__value', ruta));
    controlUbicacion.append(
      makeButton({
        label: 'Change…',
        onClick: async () => {
          const resultado = await window.api.chooseDownloadDir();
          if (!resultado?.ok) return;
          prefs.downloadPath = resultado.path;
          downloadDir = resultado.path;
          render();
        },
      }),
    );

    return [
      makeSection({
        title: 'Built-in Browser',
        desc: null,
        rows: [
          makeRow({
            label: 'Open Links In',
            desc: 'Choose where links open by default when clicked.',
            control: makeSegmented({
              options: ['External Browser', 'Built-in Browser'],
              value: prefs.openLinksIn,
              onChange: (value) => setPref('openLinksIn', value),
            }),
          }),
          makeRow({
            label: 'Download Location',
            desc: 'Folder where files downloaded in the built-in browser are saved.',
            control: controlUbicacion,
          }),
          makeRow({
            label: 'Browsing History',
            desc: 'Clear visited URLs and autocomplete suggestions from the built-in browser.',
            control: makeButton({
              label: 'Clear',
              onClick: async () => {
                await window.api.clearBrowserHistory();
                try {
                  document.getElementById('aux-browser-view')?.clearHistory?.();
                } catch {
                  // sin webview montado
                }
                showNotice('Historial del navegador borrado.');
              },
            }),
          }),
        ],
      }),
      makeSection({
        title: 'Browser Subagent',
        desc: null,
        rows: [
          makeRow({
            label: 'Browser Actuation Rules',
            desc:
              'Configure allowed and denied URLs for the browser subagent. It runs in the ' +
              'built-in browser, so no separate browser install is needed.',
            control: makeButton({ label: 'Edit', onClick: () => selectSection('network') }),
          }),
        ],
      }),
    ];
  }

  function buildPlanHint() {
    const frag = document.createDocumentFragment();
    frag.append(document.createTextNode('Type '));
    frag.append(el('span', 'kbd', '/'));
    frag.append(document.createTextNode(' and select '));
    frag.append(el('span', 'kbd', 'plan'));
    frag.append(document.createTextNode(' to have the agent generate a plan.'));
    return frag;
  }

  function buildShortcutHint() {
    const frag = document.createDocumentFragment();
    frag.append(document.createTextNode('Keyboard shortcuts '));
    frag.append(el('span', 'kbd', 'Ctrl'));
    frag.append(document.createTextNode(' + '));
    frag.append(el('span', 'kbd', 'Enter'));
    frag.append(document.createTextNode(' to send.'));
    return frag;
  }

  function renderAccount() {
    const profile = prefs.profile ?? {};

    const nameInput = makeInput({
      value: profile.name ?? '',
      placeholder: 'Tu nombre',
      onCommit: (value) => setPref('profile', { ...(prefs.profile ?? {}), name: value }),
    });

    const emailInput = makeInput({
      value: profile.email ?? '',
      placeholder: 'tu@correo.com',
      onCommit: (value) => setPref('profile', { ...(prefs.profile ?? {}), email: value }),
    });

    return [
      makeSection({
        title: 'Account',
        desc: 'Perfil local. Se usa para saludarte en el prompt y para mostrarlo en la barra lateral.',
        rows: [
          makeRow({ label: 'Nombre', desc: 'El agente lo usa para dirigirse a ti.', control: nameInput }),
          makeRow({ label: 'Email', desc: 'Solo informativo, se guarda en tu equipo.', control: emailInput }),
          makeRow({
            label: 'Plan',
            desc: 'Sin plan asociado: usas tus propias claves de API o modelos locales.',
            control: el('span', 'count-badge', 'Local'),
          }),
          makeRow({
            label: 'Google',
            desc: 'Conecta tu cuenta para generar imágenes con Flow.',
            control: makeButton({
              label: 'Abrir',
              onClick: () => selectSection('google'),
            }),
          }),
          makeRow({
            label: 'Developer',
            desc: 'Herramientas de desarrollo y sandbox avanzado.',
            control: makeButton({
              label: 'Abrir',
              onClick: () => selectSection('developer'),
            }),
          }),
        ],
      }),
    ];
  }

  function renderAppearance() {
    const colors = prefs.themeColors ?? {};

    /** Valor efectivo de un token, en hex, para el selector de color. */
    const tokenHex = (variable, fallback) => {
      const sondeo = document.createElement('span');
      sondeo.style.color = getComputedStyle(document.documentElement).getPropertyValue(variable).trim();
      document.body.append(sondeo);
      const rgb = getComputedStyle(sondeo).color;
      sondeo.remove();
      const match = /^rgb\((\d+),?\s+(\d+),?\s+(\d+)\)$/.exec(rgb);
      if (!match) return fallback;
      return `#${[1, 2, 3].map((i) => Number(match[i]).toString(16).padStart(2, '0')).join('')}`;
    };

    const colorInput = (key, variable, fallback) => {
      const input = document.createElement('input');
      input.type = 'color';
      input.className = 'color-input';
      input.value = colors[key] ?? tokenHex(variable, fallback);
      input.addEventListener('input', () => {
        const next = { ...(prefs.themeColors ?? {}), [key]: input.value };
        setPref('themeColors', next);
      });
      return input;
    };

    const resetBtn = makeButton({
      label: 'Restablecer',
      onClick: () => {
        setPref('themeColors', {});
        render();
      },
    });

    return [
      makeSection({
        title: 'Appearance',
        desc: 'Contraste de la interfaz. Se aplica al instante.',
        rows: [
          makeRow({
            label: 'Tema',
            desc: 'Oscuro o claro. Se aplica al instante.',
            control: makeSegmented({
              options: ['Dark', 'Light'],
              value: prefs.theme ?? 'Dark',
              onChange: (value) => { setPref('theme', value); render(); },
            }),
          }),
          makeRow({
            label: 'Theme',
            desc: 'Contraste de la interfaz.',
            control: makeSegmented({
              options: ['Default', 'Strong'],
              value: prefs.themeContrast,
              onChange: (value) => { setPref('themeContrast', value); render(); },
            }),
          }),
        ],
      }),
      makeSection({
        title: 'Dark Theme',
        desc: 'Colores del tema oscuro. Se aplican en vivo y se guardan.',
        rows: [
          makeRow({
            label: 'Preset',
            desc: 'Combinación predefinida.',
            control: makeSelect({
              options: ['Default Dark', 'Nord'],
              value: prefs.darkPreset,
              onChange: (value) => { setPref('darkPreset', value); render(); },
              wide: true,
            }),
          }),
          makeRow({ label: 'Background', desc: 'Fondo del lienzo.', control: colorInput('background', '--background', '#101010') }),
          makeRow({ label: 'Foreground', desc: 'Color del texto.', control: colorInput('foreground', '--foreground', '#cccccc') }),
          makeRow({ label: 'Accent', desc: 'Color de acento y foco.', control: colorInput('accent', '--primary', '#007acc') }),
          makeRow({ label: 'Restablecer colores', desc: 'Vuelve a la paleta por defecto.', control: resetBtn }),
        ],
      }),
    ];
  }

  function renderNotifications() {
    return [
      makeSection({
        title: 'General',
        desc: 'Gestiona las preferencias de notificación.',
        rows: [
          makeRow({
            label: 'Enable Notifications for Agent',
            desc: 'Muestra notificaciones del sistema cuando se requiere tu acción o el agente termina.',
            control: makeToggle({
              value: prefs.notifications,
              onChange: (value) => setPref('notifications', value),
            }),
          }),
        ],
      }),
      makeSection({
        title: 'Sound',
        desc: null,
        rows: [
          makeRow({
            label: 'Enable Sounds for Agent',
            desc: 'Reproduce un sonido cuando se requiere tu acción o el agente termina.',
            control: makeToggle({
              value: prefs.sounds,
              onChange: (value) => setPref('sounds', value),
            }),
          }),
          makeRow({
            label: 'Volume',
            desc: 'Volumen de los sonidos del agente.',
            control: makeSlider({
              value: prefs.volume,
              onChange: (value) => setPref('volume', value),
            }),
          }),
        ],
      }),
    ];
  }

  function renderModels() {
    const state = bridge.getState();
    const providers = state.providers ?? [];
    const actual = providers.find((entry) => entry.id === state.providerId) ?? null;

    /** Estado corto de un proveedor para el desplegable. */
    const estadoDe = (entry) => {
      if (entry.available) return `${entry.models.length} modelos`;
      if (!entry.hasKey && entry.needsKey) return 'sin clave';
      return entry.reason || 'no disponible';
    };

    /*
     * Desplegable propio, no un <select> nativo: en Windows el nativo pinta su
     * lista blanca encima del modal y con el tamaño de todo el catálogo.
     */
    const providerSelect = makeSelect({
      wide: true,
      value: state.providerId ?? '',
      options: [
        { value: '', label: 'Elige un proveedor' },
        ...providers.map((entry) => ({
          value: entry.id,
          label: entry.label,
          description: estadoDe(entry),
        })),
      ],
      onChange: (id) => {
        // El relleno no es una elección: pulsarlo dejaba el agente sin proveedor.
        if (!id) return;
        const elegido = providers.find((entry) => entry.id === id);
        bridge.onSelectModel(id, elegido?.models?.[0]?.id ?? null);
      },
    });

    const modelos = actual?.models ?? [];
    const guardado = state.model ?? '';
    const valido = modelos.some((model) => model.id === guardado);

    const modelSelect = makeSelect({
      wide: true,
      value: valido ? guardado : '',
      options:
        modelos.length > 0
          ? modelos.map((model) => ({ value: model.id, label: model.name || model.id }))
          : [{ value: '', label: 'sin modelos' }],
      onChange: (id) => bridge.onSelectModel(state.providerId, id || null),
    });

    const rows = [
      makeRow({
        label: 'Proveedor',
        desc: `${providers.filter((entry) => entry.available).length} de ${providers.length} disponibles.`,
        control: providerSelect,
      }),
      makeRow({
        label: 'Endpoint',
        desc: actual ? actual.baseUrl || '—' : '—',
        control: actual
          ? el(
              'span',
              'count-badge',
              actual.local ? 'local' : actual.custom ? 'personalizado' : 'remoto',
            )
          : null,
      }),
    ];

    // --- Clave de API: para todos los que la aceptan ---
    if (actual && actual.needsKey) {
      const saved = (prefs.apiKeys ?? {})[actual.id] ?? '';
      const placeholder = actual.selfHosted
        ? 'opcional'
        : actual.hasEnvKey
          ? `detectada en ${actual.envKey}`
          : actual.envKey
            ? actual.envKey
            : 'sk-…';

      rows.push(
        makeRow({
          label: 'Clave de API',
          desc: saved
            ? 'Guardada en este equipo (settings.json).'
            : actual.selfHosted
              ? 'Opcional. Solo si activaste «Require Authentication» en el servidor local.'
              : actual.hasEnvKey
                ? `Usando la variable de entorno ${actual.envKey}.`
                : actual.hasKey
                  ? 'Usando una clave guardada compartida con el otro proveedor de OpenCode.'
                  : 'Pega tu clave. Se guarda en settings.json de tu equipo.',
          control: makeInput({
            value: saved,
            placeholder,
            type: 'password',
            onCommit: (value) => {
              const all = { ...(prefs.apiKeys ?? {}) };
              if (value.length > 0) all[actual.id] = value;
              else delete all[actual.id];
              void setPref('apiKeys', all).then(() => bridge.reloadProviders());
            },
          }),
        }),
      );
    }

    // --- URL del endpoint: personalizables y servidores propios ---
    if (actual && (actual.custom || actual.selfHosted)) {
      const stored = (prefs.customProviders ?? {})[actual.id] ?? {};
      rows.push(
        makeRow({
          label: 'URL del endpoint',
          desc: 'Base sin barra final, por ejemplo https://api.ejemplo.com/v1',
          control: makeInput({
            value: stored.baseUrl ?? '',
            placeholder: actual.baseUrl || 'https://…',
            onCommit: (value) => updateCustomProvider(actual.id, { baseUrl: value }),
          }),
        }),
      );
    }

    const detalle = actual
      ? actual.available
        ? `${actual.models.length} modelos detectados en ${actual.label}.`
        : `No se pudo consultar ${actual.label}: ${actual.reason || 'sin modelos'}.`
      : 'Elige un proveedor para consultar sus modelos.';

    rows.push(
      makeRow({
        label: 'Modelo',
        desc: valido || modelos.length === 0
          ? 'Se detecta automáticamente desde el proveedor.'
          : `El modelo guardado (${guardado}) no está en la lista; elige otro.`,
        control: modelSelect,
      }),
      makeRow({
        label: 'Detección',
        desc: detalle,
        control: makeButton({
          label: 'Detectar de nuevo',
          onClick: () => {
            showNotice('Consultando proveedores…');
            bridge.refreshProviders?.();
          },
        }),
      }),
    );

    const available = providers.filter((entry) => entry.available);
    const hint =
      available.length === 0
        ? providers
            .filter((entry) => entry.reason)
            .map((entry) => `${entry.label}: ${entry.reason}`)
            .join(' · ')
        : `${available.length} de ${providers.length} proveedores disponibles.`;

    return [
      makeSection({
        title: 'Provider',
        desc: 'Proveedor de modelo. Pega tu clave aquí o defínela en el entorno.',
        rows,
      }),
      makeInfo(
        available.length === 0
          ? `Ningún proveedor disponible. ${hint}.`
          : hint,
      ),
    ];
  }

  /** Guarda URL o clave de un proveedor personalizable y refresca. */
  function updateCustomProvider(id, patch) {
    const all = { ...(prefs.customProviders ?? {}) };
    all[id] = { ...(all[id] ?? {}), ...patch };
    void setPref('customProviders', all).then(() => bridge.reloadProviders());
  }

  /** Sección de embeddings del índice de código. */
  function embeddingsSection() {
    return makeSection({
      title: 'Índice semántico',
      desc: 'Con qué se calculan los vectores para la búsqueda de código.',
      rows: [
        makeRow({
          label: 'Proveedor de embeddings',
          desc: 'Ollama es local y gratis; OpenAI y Gemini dan mejor calidad.',
          control: makeSelect({
            options: ['auto', 'ollama', 'openai', 'gemini'],
            value: prefs.embeddingProvider ?? 'auto',
            onChange: (value) => setPref('embeddingProvider', value),
            wide: true,
          }),
        }),
        makeRow({
          label: 'Modelo',
          desc: 'Vacío usa el predeterminado de cada proveedor.',
          control: (() => {
            const input = el('input', 'text-input');
            input.placeholder = 'nomic-embed-text';
            input.value = prefs.embeddingModel ?? '';
            input.addEventListener('change', () => setPref('embeddingModel', input.value.trim()));
            return input;
          })(),
        }),
        makeRow({
          label: 'URL del endpoint',
          desc: 'Vacío usa la del proveedor. Útil para servidores compatibles.',
          control: (() => {
            const input = el('input', 'text-input');
            input.placeholder = 'http://127.0.0.1:11434';
            input.value = prefs.embeddingUrl ?? '';
            input.addEventListener('change', () => setPref('embeddingUrl', input.value.trim()));
            return input;
          })(),
        }),
        makeRow({
          label: 'Peso semántico',
          desc: '0 usa solo coincidencia de texto, 1 solo similitud. Por defecto 0,45.',
          control: makeSelect({
            options: ['0', '0.25', '0.45', '0.7', '1'],
            value: String(prefs.embeddingWeight ?? '0.45'),
            onChange: (value) => setPref('embeddingWeight', value),
          }),
        }),
        makeRow({
          label: 'Precalcular vectores',
          desc: 'Recorre el índice y calcula los embeddings que falten.',
          control: makeButton({
            label: 'Precalcular',
            onClick: async () => {
              const result = await window.api.indexWarm();
              showNotice(
                result?.ok
                  ? `Vectores calculados: ${result.embedded ?? 0}, ya existentes: ${result.skipped ?? 0}.`
                  : 'No se pudieron calcular los vectores.',
              );
              render();
            },
          }),
        }),
      ],
    });
  }

  function renderCustomizations() {
    const skills = bridge.getSkills ? bridge.getSkills() : [];
    const plugins = prefs.plugins ?? [];

    const skillRows = skills.map((skill) =>
      makeRow({
        label: skill.name,
        desc: skill.description,
        control: makeToggle({
          value: skill.enabled,
          onChange: (value) => {
            const next = { ...(prefs.skills ?? {}), [skill.id]: value };
            setPref('skills', next);
            if (bridge.refreshSkills) bridge.refreshSkills();
          },
        }),
      }),
    );

    const pluginRows = plugins.map((plugin) =>
      makeRow({
        label: plugin.name,
        desc: `${plugin.command} ${(plugin.args ?? []).join(' ')}`.trim(),
        control: makeToggle({
          value: plugin.enabled !== false,
          onChange: (value) => {
            const next = plugins.map((entry) =>
              entry.id === plugin.id ? { ...entry, enabled: value } : entry,
            );
            setPref('plugins', next);
            render();
          },
        }),
      }),
    );

    return [
      makeSection({
        title: 'Workspace rules',
        desc:
          'AGENTS.md and .agents/rules/*.md go into the system prompt with their own ' +
          'budget. They are read at every turn.',
        rows: [
          makeRow({
            label: 'Load workspace rules',
            desc: "If off, the agent won't see the project's conventions.",
            control: makeToggle({
              value: prefs.rulesEnabled !== false,
              onChange: (value) => setPref('rulesEnabled', value),
            }),
          }),
          makeRow({
            label: 'Budget',
            desc: 'Tokens reserved for rules. What does not fit is replaced by the file path.',
            control: makeSelect({
              wide: true,
              value: String(prefs.rulesBudget ?? 20000),
              options: [
                { value: '4000', label: '4 000 tokens' },
                { value: '8000', label: '8 000 tokens' },
                { value: '20000', label: '20 000 tokens' },
                { value: '40000', label: '40 000 tokens' },
              ],
              onChange: (value) => setPref('rulesBudget', Number(value)),
            }),
          }),
        ],
      }),
      embeddingsSection(),
      makeSection({
        title: 'Skills',
        desc: 'Instrucciones que se añaden al prompt cuando están activadas.',
        count: skillRows.length,
        rows:
          skillRows.length > 0
            ? skillRows
            : [makeRow({ label: 'Sin skills', desc: 'No hay skills disponibles.', control: null })],
      }),
      makeSection({
        title: 'Plugins',
        desc: 'Servidores MCP que el agente conecta en cada turno.',
        count: pluginRows.length,
        rows: [
          ...(pluginRows.length > 0
            ? pluginRows
            : [makeRow({ label: 'Sin plugins', desc: 'Añade un servidor MCP para empezar.', control: null })]),
          makeRow({
            label: 'Añadir plugin',
            desc: 'Gestiona la lista de servidores MCP.',
            control: makeButton({ label: 'Abrir', onClick: () => selectSection('plugins') }),
          }),
        ],
      }),
    ];
  }

  function renderApplication() {
    const state = bridge.getState();
    const remote = bridge.getRemote ? bridge.getRemote() : { running: false, url: null };

    const pathRow = el('code');
    pathRow.textContent = state.cwd ?? '—';
    pathRow.style.cssText =
      'font-family:ui-monospace,Consolas,monospace;font-size:12px;color:var(--secondary-foreground);' +
      'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:320px;display:block';

    const portInput = makeInput({
      value: String(prefs.remotePort ?? 4789),
      placeholder: '4789',
      onCommit: (value) => {
        const port = Number(value);
        if (Number.isInteger(port) && port > 0) setPref('remotePort', port);
      },
    });

    const tokenInput = makeInput({
      value: prefs.remoteToken ?? '',
      placeholder: 'opcional',
      onCommit: (value) => setPref('remoteToken', value),
    });

    const remoteStatus = el(
      'span',
      'count-badge',
      remote.running ? 'activo' : 'detenido',
    );

    return [
      makeSection({
        title: 'General',
        rows: [
          makeRow({
            label: 'Language',
            desc: 'Interface language.',
            control: makeSelect({
              options: [
                { value: 'auto', label: 'Auto', description: 'Follows the system language.' },
                { value: 'en', label: 'English', description: '' },
                { value: 'es', label: 'Español', description: '' },
              ],
              value:
                prefs.uiLanguage === 'Español'
                  ? 'es'
                  : prefs.uiLanguage === 'English'
                    ? 'en'
                    : (prefs.uiLanguage ?? 'auto'),
              onChange: (value) => {
                setPref('uiLanguage', value);
                const idioma = window.I18n?.resolveLanguage(value) ?? 'en';
                window.I18n?.setLanguage(idioma);
                window.I18n?.translateDom(document);
                render();
              },
            }),
          }),
          makeRow({
            label: 'Workspace',
            desc: 'Carpeta sobre la que trabaja el agente.',
            control: makeButton({ label: 'Cambiar', onClick: () => bridge.onChangeWorkspace() }),
          }),
          makeRow({ label: 'Ruta actual', desc: null, control: pathRow }),
        ],
      }),
      makeSection({
        title: 'SSH Remote',
        desc: 'Terminal y ficheros de un host SSH. La clave se usa solo para autenticar; no se guarda ningún secreto. El modo directo requiere WinFsp + SSHFS-Win.',
        rows: (() => {
          const ssh = { ...(DEFAULTS.ssh ?? {}), ...(prefs.ssh ?? {}) };
          const actualizar = (clave, valor) =>
            setPref('ssh', { ...(DEFAULTS.ssh ?? {}), ...(prefs.ssh ?? {}), [clave]: valor });
          return [
            makeRow({ label: 'Host', desc: 'Nombre o IP del servidor.', control: makeInput({ value: ssh.host, placeholder: '127.0.0.1', onCommit: (value) => actualizar('host', value.trim()) }) }),
            makeRow({ label: 'Port', desc: 'Puerto SSH.', control: makeInput({ value: String(ssh.port), placeholder: '22', onCommit: (value) => actualizar('port', Number(value) || 22) }) }),
            makeRow({ label: 'User', desc: 'Usuario remoto.', control: makeInput({ value: ssh.user, placeholder: 'root', onCommit: (value) => actualizar('user', value.trim()) }) }),
            makeRow({ label: 'Remote path', desc: 'Carpeta remota que se abre al conectar.', control: makeInput({ value: ssh.remotePath, placeholder: '/root', onCommit: (value) => actualizar('remotePath', value.trim() || '/') }) }),
            makeRow({ label: 'Private key', desc: 'Ruta local a la clave privada; vacío usa ssh-agent.', control: makeInput({ value: ssh.keyPath, placeholder: 'C:/Users/tu/.ssh/id_ed25519', onCommit: (value) => actualizar('keyPath', value.trim()) }) }),
            makeRow({ label: 'Host fingerprint', desc: 'SHA-256 opcional para SFTP/terminal; SSHFS usa known_hosts.', control: makeInput({ value: ssh.hostFingerprint ?? '', placeholder: 'SHA256:…', onCommit: (value) => actualizar('hostFingerprint', value.trim()) }) }),
            makeRow({
              label: 'Probar conexión',
              desc: 'Abre una sesión SFTP y lista la carpeta remota.',
              control: makeButton({
                label: 'Probar',
                onClick: async () => {
                  const resultado = await window.api.sshTest();
                  bridge?.addNotice?.(
                    resultado.ok
                      ? `SSH: ${resultado.user}@${resultado.host}:${resultado.port} · ${resultado.entries} entradas`
                      : `SSH: ${resultado.error}`,
                    resultado.ok ? 'ok' : 'error',
                  );
                },
              }),
            }),
            makeRow({
              label: 'Terminal remota',
              desc: 'Abre una shell interactiva en el host configurado.',
              control: makeButton({
                label: 'Abrir',
                onClick: () => {
                  window.SettingsUI.close();
                  bridge?.openSshTerminal?.();
                },
              }),
            }),
            makeRow({
              label: 'Proyecto espejo',
              desc: 'Fallback: descarga el proyecto en un espejo local y lo sincroniza.',
              control: makeButton({
                label: 'Abrir proyecto',
                onClick: async () => {
                  const resultado = await window.api.sshOpenProject();
                  if (!resultado?.ok) {
                    bridge?.addNotice?.(`SSH: ${resultado?.error ?? 'no se pudo abrir'}`, 'error');
                    return;
                  }
                  window.SettingsUI.close();
                  bridge?.openRemoteProject?.(resultado);
                },
              }),
            }),
            makeRow({
              label: 'Proyecto directo',
              desc: 'Modo directo: monta la carpeta remota como unidad. Requiere WinFsp + SSHFS-Win.',
              control: makeButton({
                label: 'Montar',
                onClick: async () => {
                  const resultado = await window.api.sshMountProject();
                  if (!resultado?.ok) {
                    bridge?.addNotice?.(`SSH directo: ${resultado?.error ?? 'no se pudo montar'}`, 'error');
                    return;
                  }
                  window.SettingsUI.close();
                  bridge?.openRemoteProject?.(resultado);
                },
              }),
            }),
          ];
        })(),
      }),
      makeSection({
        title: 'GitHub',
        desc: 'Token opcional para pull requests de repositorios privados.',
        rows: (() => {
          const token = (prefs.apiKeys ?? {}).github ?? '';
          return [
            makeRow({
              label: 'Token',
              desc: token ? 'Guardado cifrado en este equipo.' : 'Sin token: solo repos públicos.',
              control: makeInput({
                value: token,
                placeholder: 'ghp_…',
                type: 'password',
                onCommit: (value) => {
                  const all = { ...(prefs.apiKeys ?? {}) };
                  if (value.length > 0) all.github = value;
                  else delete all.github;
                  void setPref('apiKeys', all);
                },
              }),
            }),
          ];
        })(),
      }),
      makeSection({
        title: 'Updates',
        desc:
          'Descarga e instala nuevas versiones publicadas en GitHub. Sin telemetría; ' +
          'la app solo consulta releases de Opengravity.',
        rows: (() => {
          const u = updateState ?? { status: 'idle', currentVersion: state.version ?? '' };
          const etiquetas = {
            idle: 'Ready',
            checking: 'Checking for updates…',
            'up-to-date': 'Up to date',
            available: 'Update available',
            downloading: `Downloading… ${u.progress ?? 0}%`,
            verifying: 'Verifying checksum…',
            downloaded: 'Ready to restart',
            error: 'Update error',
            portable: 'Portable build',
            development: 'Development build',
            unsupported: 'Updates are Windows-only',
          };
          const estado = etiquetas[u.status] ?? u.status;
          let detalle = `Current version: ${u.currentVersion ?? state.version ?? '—'}`;
          if (u.availableVersion) detalle += ` · Available: ${u.availableVersion}`;
          if (u.status === 'error' && u.error) detalle += ` · ${u.error}`;
          if (u.status === 'portable') detalle = 'This portable build cannot self-update. Download the new release.';

          let control;
          if (u.status === 'available') {
            control = makeButton({
              label: 'Download',
              onClick: () => void window.api.downloadUpdate?.(),
            });
          } else if (u.status === 'downloaded') {
            control = makeButton({
              label: 'Restart and update',
              onClick: () => void window.api.installUpdate?.(),
            });
          } else if (u.status === 'portable' || u.status === 'development' || u.status === 'unsupported') {
            control = makeButton({
              label: 'Open release',
              onClick: () => void window.api.openUpdateRelease?.(),
            });
          } else {
            control = makeButton({
              label: 'Check for updates',
              onClick: () => void window.api.checkUpdates?.(),
            });
          }

          return [
            makeRow({
              label: 'Version',
              desc: detalle,
              control: el('span', 'count-badge', estado),
            }),
            makeRow({
              label: 'Update',
              desc: u.releaseName ? `${u.releaseName}` : 'Stable channel from GitHub Releases.',
              control,
            }),
          ];
        })(),
      }),
      makeSection({
        title: 'Remote Control',
        desc: 'Servidor HTTP local para enviar prompts desde fuera.',
        rows: [
          makeRow({
            label: 'Estado',
            desc: remote.url ? `POST ${remote.url}/prompt` : 'Detenido.',
            control: remoteStatus,
          }),
          makeRow({ label: 'Puerto', desc: 'Puerto local del servidor.', control: portInput }),
          makeRow({
            label: 'Token',
            desc: 'Si lo defines, el cliente debe enviarlo en el campo token.',
            control: tokenInput,
          }),
          makeRow({
            label: remote.running ? 'Detener servidor' : 'Iniciar servidor',
            desc: 'Escucha solo en 127.0.0.1.',
            control: makeButton({
              label: remote.running ? 'Detener' : 'Iniciar',
              onClick: () => (bridge.toggleRemote ? bridge.toggleRemote() : undefined),
            }),
          }),
        ],
      }),
    ];
  }

  /**
   * Cuenta de Google.
   *
   * `generate_image` usa Flow, que exige sesión de Google. Aquí se conecta una
   * vez: se abre el navegador integrado para iniciar sesión y la partición
   * persistente conserva las cookies entre arranques.
   */
  function renderGoogle() {
    const estado = { conectada: false, revisando: true };

    const fila = makeRow({
      label: 'Cuenta de Google',
      desc: 'Necesaria para generar imágenes con Flow.',
      control: null,
    });

    const control = fila.querySelector('.row__control') ?? fila;

    const pintar = (conectada) => {
      control.replaceChildren();

      const etiqueta = el('span', 'google-state', conectada ? 'Conectada' : 'Sin conectar');
      etiqueta.classList.toggle('is-on', conectada);
      control.append(etiqueta);

      const boton = makeButton({
        label: conectada ? 'Desconectar' : 'Conectar',
        onClick: async () => {
          if (conectada) {
            await window.api.googleDisconnect?.();
            pintar(false);
          } else {
            await window.api.googleConnect?.();
            addNotice?.('Inicia sesión en la ventana que se ha abierto.', 'ok');
            // Sondeo durante 2 minutos para detectar cuando se inicia sesión
            const inicio = Date.now();
            const timer = setInterval(async () => {
              if (Date.now() - inicio > 120000) {
                clearInterval(timer);
                return;
              }
              const st = await window.api.googleStatus?.().catch(() => null);
              if (st?.conectada) {
                clearInterval(timer);
                estado.conectada = true;
                pintar(true);
                addNotice?.('Cuenta de Google conectada correctamente.', 'ok');
              }
            }, 2500);
          }
        },
      });
      control.append(boton);
    };

    pintar(false);
    window.api
      .googleStatus?.()
      .then((r) => {
        estado.conectada = r?.conectada === true;
        estado.revisando = false;
        pintar(estado.conectada);
      })
      .catch(() => pintar(false));


    return [
      makeSection({
        title: 'Google',
        rows: [fila],
      }),
      makeSection({
        title: 'Generación de imágenes',
        desc:
          'Google no publica una API de Flow, así que la app lo maneja con su navegador ' +
          'integrado usando tu sesión. No necesita claves ni cuesta dinero. Si Google ' +
          'cambia su interfaz, la herramienta puede dejar de encontrar los controles.',
        rows: [
          makeRow({
            label: 'Flow',
            desc: 'Experimental: genera imágenes con `generate_image`. Depende de la interfaz de Flow; si Google la cambia, puede dejar de funcionar.',
            control: makeButton({
              label: 'Abrir Flow',
              onClick: () => {
                window.api.openBrowser?.('https://flow.google.com/').catch(() => {});
              },
            }),
          }),
        ],
      }),
    ];
  }

  /**
   * Ajustes del proyecto abierto.
   *
   * Medido en su DOM: cuatro subsecciones — **Folders** (la carpeta actual y
   * «Add Folder»), **Customizations** (uso de tokens), **Skills** (las del
   * proyecto) y **Danger Zone** («Delete Project … including N active
   * conversations»).
   */
  function renderProject() {
    const estado = bridge?.getState?.() ?? {};
    const cwd = proyectoActivo || estado.project || estado.cwd || '';
    const nombre = cwd.split(/[\\/]/).filter(Boolean).pop() || 'Proyecto';
    const skills = bridge.getSkills ? bridge.getSkills() : [];
    const conversaciones = (bridge.getState?.()?.sessions ?? []).length;

    const skillRows = skills.map((skill) =>
      makeRow({
        label: skill.name,
        desc: skill.description,
        control: makeToggle({
          value: skill.enabled,
          onChange: (value) => {
            setPref('skills', { ...(prefs.skills ?? {}), [skill.id]: value });
            if (bridge.refreshSkills) bridge.refreshSkills();
          },
        }),
      }),
    );

    return [
      makeSection({
        title: 'Folders',
        count: cwd ? 1 : 0,
        rows: [
          makeRow({
            label: `${nombre}/`,
            desc: cwd || 'No hay ningún proyecto abierto.',
            control: makeButton({
              label: 'Add Folder',
              onClick: () => {
                // La carpeta del proyecto se cambia desde la barra lateral.
                addNotice?.('Cambia de proyecto desde la barra lateral.', 'ok');
              },
            }),
          }),
        ],
      }),
      makeSection({
        title: 'Customizations',
        desc:
          'El desglose muestra el uso de tokens de las personalizaciones: reglas, ' +
          'skills y MCP. Si se pasa del presupuesto, las reglas largas se convierten en ' +
          'punteros y las personalizaciones grandes se excluyen solas.',
        rows: [
          makeRow({
            label: 'Uso de tokens',
            desc:
              skills.length === 0
                ? 'No hay personalizaciones activas.'
                : `${skills.filter((s) => s.enabled).length} de ${skills.length} skills activas.`,
            control: makeButton({
              label: 'Abrir',
              onClick: () => selectSection('customizations'),
            }),
          }),
          makeRow({
            label: 'Developer',
            desc: 'Herramientas de desarrollo, guardadas solo en local.',
            control: makeButton({
              label: 'Abrir',
              onClick: () => selectSection('developer'),
            }),
          }),
        ],
      }),
      makeSection({
        title: 'Skills',
        count: skillRows.length,
        rows:
          skillRows.length > 0
            ? skillRows
            : [makeRow({ label: 'Sin skills', desc: 'Este proyecto no tiene skills propias.', control: null })],
      }),
      makeSection({
        title: 'Danger Zone',
        rows: [
          makeRow({
            label: 'Delete Project',
            desc: `Borra ${nombre} permanentemente, incluidas ${conversaciones} conversaciones activas.`,
            control: makeButton({
              label: 'Delete Project',
              onClick: () => {
                // No se borra nada sin una confirmación explícita del usuario.
                addNotice?.('Borrar el proyecto no está disponible desde aquí.', 'error');
              },
            }),
          }),
        ],
      }),
    ];
  }

  /**
   * Developer: en su versión son herramientas de desarrollo que se guardan en
   * local. Aquí se exponen las que tiene sentido en una app open source.
   */
  function renderDeveloper() {
    return [
      makeSection({
        title: 'Security',
        desc: 'Controles avanzados del agente y del sandbox de procesos.',
        rows: [
          makeRow({
            label: 'Security Monitor',
            desc:
              'Puntúa cada acción de 0 a 10 antes de ejecutarla y bloquea lo peligroso: ' +
              'borrados masivos, exfiltración, credenciales, desactivar TLS, debilitar tests.',
            control: makeSelect({
              options: [
                { label: 'block', description: 'Bloquea lo que puntúe por encima del umbral.' },
                { label: 'ask', description: 'Pregunta antes de ejecutar lo dudoso.' },
                { label: 'llm', description: 'Usa el clasificador para decidir.' },
                { label: 'off', description: 'No revisa ninguna acción.' },
              ],
              value: prefs.securityMonitor ?? 'block',
              onChange: (value) => setPref('securityMonitor', value),
            }),
          }),
          makeRow({
            label: 'Workspace Sandbox',
            desc:
              'Restringe las rutas de fichero al workspace, fija el cwd de los comandos y ' +
              'quita del entorno las variables con credenciales. En Windows añade un Job ' +
              'Object con límites de memoria, procesos y CPU que termina el árbol al salir.',
            control: makeToggle({
              value: prefs.restrictToWorkspace === true,
              onChange: (value) => setPref('restrictToWorkspace', value),
            }),
          }),
        ],
      }),
      makeSection({
        title: 'Go',
        desc: 'Ruta de la instalación de Go para gopls; útil si Go no está en PATH.',
        rows: [
          makeRow({
            label: 'GOROOT',
            desc:
              'Carpeta de Go, su subcarpeta bin o go.exe. Se usa al abrir un fichero Go ' +
              'y se guarda solo en local.',
            control: makeInput({
              value: prefs.goRoot ?? '',
              placeholder: 'C:\\Program Files\\Go',
              onCommit: (value) => setPref('goRoot', value),
            }),
          }),
        ],
      }),
      makeSection({
        title: 'Sandbox Limits',
        desc:
          'Límites del sandbox de procesos. En Windows los aplica un Job Object; en ' +
          'Linux/macOS, ulimit. Se activan con «Workspace Sandbox».',
        rows: [
          makeRow({
            label: 'Memory (MB)',
            desc: 'Memoria máxima para el comando y sus hijos (Windows; en POSIX se omite).',
            control: makeInput({
              type: 'number',
              value: String(prefs.sandboxMemoryMB ?? 1024),
              onCommit: (value) => setPref('sandboxMemoryMB', Number(value) || 1024),
            }),
          }),
          makeRow({
            label: 'Processes',
            desc: 'Número máximo de procesos vivos del árbol.',
            control: makeInput({
              type: 'number',
              value: String(prefs.sandboxMaxProcesses ?? 32),
              onCommit: (value) => setPref('sandboxMaxProcesses', Number(value) || 32),
            }),
          }),
          makeRow({
            label: 'CPU seconds',
            desc: 'Tiempo de CPU máximo antes de terminar el árbol.',
            control: makeInput({
              type: 'number',
              value: String(prefs.sandboxCpuSeconds ?? 300),
              onCommit: (value) => setPref('sandboxCpuSeconds', Number(value) || 300),
            }),
          }),
        ],
      }),

      makeSection({
        title: 'Depuración',
        rows: [
          makeRow({
            label: 'Mostrar el prompt del sistema',
            desc: 'Añade al hilo el prompt del turno, plegado bajo su recuento de caracteres.',
            control: makeToggle({
              value: prefs.debugShowSystemPrompt === true,
              onChange: (value) => setPref('debugShowSystemPrompt', value),
            }),
          }),
          makeRow({
            label: 'Mostrar el uso de tokens por turno',
            desc: 'Añade entradas y salidas del modelo al pie de cada respuesta.',
            control: makeToggle({
              value: prefs.debugShowTokens === true,
              onChange: (value) => setPref('debugShowTokens', value),
            }),
          }),
        ],
      }),
      makeSection({
        title: 'Trayectoria',
        rows: [
          makeRow({
            label: 'Ruta de las trayectorias',
            desc: 'Ficheros de snapshot por conversación, en la carpeta de datos.',
            control: makeButton({
              label: 'Abrir carpeta',
              onClick: () => {
                // No hay API para revelar la carpeta: se avisa en vez de fingir.
                window.api.notify?.('Las trayectorias están en userData/trajectory.') ??
                  alert('Las trayectorias están en userData/trajectory.');
              },
            }),
          }),
        ],
      }),
    ];
  }

  function renderShortcuts() {
    const rows = [
      ['Enviar mensaje', ['Ctrl', 'Enter']],
      ['Nueva línea', ['Shift', 'Enter']],
      ['Cerrar ajustes', ['Esc']],
      ['Nueva conversación', ['Ctrl', 'N']],
      ['Cambiar de modelo', ['Ctrl', 'M']],
    ];

    return [
      makeSection({
        title: 'Conversation',
        desc: 'Atajos del cuadro de entrada.',
        rows: rows.map(([label, keys]) => {
          const frag = document.createDocumentFragment();
          keys.forEach((key, index) => {
            if (index > 0) frag.append(document.createTextNode(' + '));
            frag.append(el('span', 'kbd', key));
          });
          return makeRow({ label, desc: null, control: frag });
        }),
      }),
    ];
  }

  /** Textarea simple con commit al cambiar. */
  function makeTextarea({ value, placeholder, rows, onCommit }) {
    const area = document.createElement('textarea');
    area.className = 'text-area';
    area.rows = rows ?? 5;
    area.placeholder = placeholder ?? '';
    area.value = value ?? '';
    area.spellcheck = false;
    area.addEventListener('change', () => onCommit(area.value));
    area.addEventListener('blur', () => onCommit(area.value));
    return area;
  }

  function renderTools() {
    const tools = bridge.getTools ? bridge.getTools() : [];

    const rows = tools.map((tool) => {
      const current = tool.permission ?? 'inherit';
      return makeRow({
        label: tool.name,
        desc: tool.description,
        control: makeSegmented({
          options: ['inherit', 'allow', 'ask', 'deny'],
          value: current,
          onChange: (value) => {
            const next = { ...(prefs.toolPermissions ?? {}) };
            if (value === 'inherit') delete next[tool.name];
            else next[tool.name] = value;
            setPref('toolPermissions', next);
          },
        }),
      });
    });

    return [
      makeSection({
        title: 'Permisos por herramienta',
        desc: 'inherit usa el preset global. allow nunca pregunta. ask siempre pregunta. deny bloquea.',
        rows:
          rows.length > 0
            ? rows
            : [makeRow({ label: 'Sin herramientas', desc: 'No se pudo leer el catálogo.', control: null })],
      }),
    ];
  }

  function renderNetwork() {
    const rules = prefs.networkRules ?? { allow: [], deny: [] };

    const allowArea = makeTextarea({
      value: (rules.allow ?? []).join('\n'),
      placeholder: 'github.com\napi.openai.com',
      onCommit: (value) =>
        setPref('networkRules', {
          ...(prefs.networkRules ?? {}),
          allow: value.split('\n').map((line) => line.trim()).filter(Boolean),
        }),
    });

    const denyArea = makeTextarea({
      value: (rules.deny ?? []).join('\n'),
      placeholder: 'example.com',
      onCommit: (value) =>
        setPref('networkRules', {
          ...(prefs.networkRules ?? {}),
          deny: value.split('\n').map((line) => line.trim()).filter(Boolean),
        }),
    });

    return [
      makeSection({
        title: 'Dominios permitidos',
        desc: 'Uno por línea. Si la lista está vacía, se permite todo lo que no esté denegado.',
        rows: [makeRow({ label: 'Allow', desc: 'Subdominios incluidos.', control: allowArea })],
      }),
      makeSection({
        title: 'Dominios denegados',
        desc: 'Tienen prioridad sobre las permitidas.',
        rows: [makeRow({ label: 'Deny', desc: 'Se aplica antes que allow.', control: denyArea })],
      }),
    ];
  }

  /** Catálogo local de MCP: se carga una vez por sesión de ajustes. */
  let catalogoMcp = null;
  let catalogoMcpCargando = false;

  function renderPlugins() {
    const plugins = prefs.plugins ?? [];

    if (!catalogoMcp && !catalogoMcpCargando && window.api.marketplaceList) {
      catalogoMcpCargando = true;
      window.api
        .marketplaceList()
        .then((lista) => {
          catalogoMcp = Array.isArray(lista) ? lista : [];
        })
        .catch(() => {
          catalogoMcp = [];
        })
        .finally(() => {
          catalogoMcpCargando = false;
          render();
        });
    }

    const nameInput = el('input', 'text-input');
    nameInput.placeholder = 'filesystem';

    const commandInput = el('input', 'text-input');
    commandInput.placeholder = 'npx';

    const argsInput = el('input', 'text-input');
    argsInput.placeholder = '-y @modelcontextprotocol/server-filesystem .';

    const envInput = el('input', 'text-input');
    envInput.placeholder = 'TOKEN=abc, RUTA=/tmp';

    const addBtn = makeButton({
      label: 'Añadir',
      onClick: async () => {
        const name = nameInput.value.trim();
        const command = commandInput.value.trim();

        if (name.length === 0 || command.length === 0) {
          showNotice('Nombre y comando son obligatorios.');
          return;
        }

        // Variables de entorno: "CLAVE=valor, CLAVE2=valor2".
        const env = {};
        for (const pair of envInput.value.split(',')) {
          const [key, ...rest] = pair.split('=');
          if (key && key.trim()) env[key.trim()] = rest.join('=').trim();
        }

        await setPref('plugins', [
          ...plugins,
          {
            id: `plugin-${Date.now().toString(36)}`,
            name,
            command,
            args: argsInput.value.trim().split(/\s+/).filter(Boolean),
            env,
            enabled: true,
          },
        ]);
        render();
      },
    });

    /** Fila de un servidor con su estado, interruptor y acciones. */
    const serverRow = (plugin) => {
      const status = el('span', 'plugin-status');
      status.textContent = plugin.enabled === false ? 'desactivado' : 'sin probar';

      const toggle = makeToggle({
        value: plugin.enabled !== false,
        onChange: (value) => {
          setPref(
            'plugins',
            plugins.map((entry) => (entry.id === plugin.id ? { ...entry, enabled: value } : entry)),
          );
          render();
        },
      });

      const probe = makeButton({
        label: 'Probar',
        onClick: async () => {
          status.textContent = 'probando…';
          status.classList.remove('is-ok', 'is-error');

          const result = await window.api.probeMcp({
            command: plugin.command,
            args: plugin.args ?? [],
            env: plugin.env ?? {},
          });

          if (result.ok) {
            status.textContent = `${result.tools.length} herramienta(s)`;
            status.classList.add('is-ok');
            status.title = result.tools.map((tool) => tool.name).join(', ');
          } else {
            status.textContent = 'error';
            status.classList.add('is-error');
            status.title = result.error;
          }
        },
      });

      const remove = makeButton({
        label: 'Quitar',
        onClick: () => {
          setPref('plugins', plugins.filter((entry) => entry.id !== plugin.id));
          render();
        },
      });

      const controls = el('div', 'inline-fields');
      controls.append(status, probe, toggle, remove);

      return makeRow({
        label: plugin.name,
        desc: `${plugin.command} ${(plugin.args ?? []).join(' ')}`.trim(),
        control: controls,
      });
    };

    const rows = plugins.map(serverRow);

    const instalados = new Set(plugins.map((entrada) => String(entrada.name)));
    const catalogo = (catalogoMcp ?? []).filter((entrada) => !instalados.has(entrada.name));
    const catalogoRows = catalogo.map((entrada) =>
      makeRow({
        label: entrada.name,
        desc: `${entrada.description} · ${entrada.command} ${entrada.args.join(' ')}`,
        control: makeButton({
          label: 'Instalar',
          onClick: () => {
            setPref('plugins', [
              ...plugins,
              {
                id: `mcp-${entrada.id}`,
                name: entrada.name,
                command: entrada.command,
                args: [...entrada.args],
                env: { ...entrada.env },
                enabled: true,
              },
            ]);
            render();
          },
        }),
      }),
    );

    const addRow = makeRow({
      label: 'Nuevo servidor',
      desc: 'Nombre, comando, argumentos y variables de entorno opcionales.',
      control: el('div', 'inline-fields'),
      className: 'row--stacked',
    });
    addRow
      .querySelector('.inline-fields')
      .append(nameInput, commandInput, argsInput, envInput, addBtn);

    return [
      makeSection({
        title: 'Servidores MCP',
        desc: 'Se lanzan por stdio al empezar cada turno y se cierran al terminar. «Probar» arranca el servidor, cuenta sus herramientas y lo cierra.',
        rows: rows.length > 0 ? rows : [makeRow({ label: 'Sin servidores', desc: null, control: null })],
      }),
      makeSection({
        title: 'Marketplace',
        desc:
          'Catálogo local de servidores MCP open source. Se instalan como plugins ' +
          'normales; no hay cuentas, planes ni pagos.',
        rows:
          catalogoRows.length > 0
            ? catalogoRows
            : [
                makeRow({
                  label: catalogoMcp ? 'Todo instalado' : 'Cargando catálogo…',
                  desc: null,
                  control: null,
                }),
              ],
      }),
      makeSection({ title: 'Añadir', desc: null, rows: [addRow] }),
    ];
  }

  function renderConversations() {
    const state = bridge.getState();
    const skills = bridge.getSkills ? bridge.getSkills() : [];

    /*
     * Medido en su DOM: esta sección empieza con **Customizations** (el desglose
     * de tokens) y **Skills**, igual que la del proyecto, y después el historial.
     */
    const skillRows = skills.map((skill) =>
      makeRow({
        label: skill.name,
        desc: skill.description,
        control: makeToggle({
          value: skill.enabled,
          onChange: (value) => {
            setPref('skills', { ...(prefs.skills ?? {}), [skill.id]: value });
            if (bridge.refreshSkills) bridge.refreshSkills();
          },
        }),
      }),
    );

    return [
      makeSection({
        title: 'Customizations',
        desc:
          'El desglose muestra el uso de tokens de las personalizaciones: reglas, ' +
          'skills y MCP. Si se pasa del presupuesto, las reglas largas se convierten en ' +
          'punteros y las personalizaciones grandes se excluyen solas.',
        rows: [
          makeRow({
            label: 'Uso de tokens',
            desc:
              skills.length === 0
                ? 'No hay personalizaciones activas.'
                : `${skills.filter((s) => s.enabled).length} de ${skills.length} skills activas.`,
            control: makeButton({
              label: 'Abrir',
              onClick: () => selectSection('customizations'),
            }),
          }),
        ],
      }),
      makeSection({
        title: 'Skills',
        count: skillRows.length,
        rows:
          skillRows.length > 0
            ? skillRows
            : [makeRow({ label: 'Sin skills', desc: 'No hay skills disponibles.', control: null })],
      }),
      makeSection({
        title: 'History',
        desc: 'Cómo se guardan y cuánto se conserva el historial.',
        rows: [
          makeRow({
            label: 'Guardar historial',
            desc: 'Las conversaciones se escriben en disco en formato JSONL.',
            control: makeToggle({
              value: prefs.saveHistory !== false,
              onChange: (value) => setPref('saveHistory', value),
            }),
          }),
          makeRow({
            label: 'Días de retención',
            desc: 'Las conversaciones más antiguas se borran al arrancar y cada 6 horas.',
            control: makeSelect({
              options: ['7', '30', '90', 'Nunca'],
              value: String(prefs.retentionDays ?? '30'),
              onChange: (value) => setPref('retentionDays', value),
            }),
          }),
          makeRow({
            label: 'Limpiar ahora',
            desc: 'Aplica la retención en este momento y dice cuántas conversaciones borró.',
            control: makeButton({
              label: 'Limpiar',
              onClick: async () => {
                const result = await window.api.applyRetention();
                if (result?.skipped) showNotice('La retención está desactivada (Nunca).');
                else showNotice(`Borradas ${result?.removed ?? 0} conversaciones de más de ${result?.days} días.`);
                render();
              },
            }),
          }),
        ],
      }),
      makeSection({
        title: 'Export',
        desc: null,
        rows: [
          makeRow({
            label: 'Exportar conversación actual',
            desc: 'Guarda el historial como Markdown en el disco.',
            control: makeButton({
              label: 'Export',
              onClick: () => bridge.exportActiveConversation?.(),
            }),
          }),
          makeRow({
            label: 'Conversaciones guardadas',
            desc: `${state ? 'Historial disponible' : ''}`,
            control: makeButton({
              label: 'Abrir historial',
              onClick: () => {
                selectSection('general');
                bridge.openSearch?.();
              },
            }),
          }),
        ],
      }),
    ];
  }

  function renderFeedback() {
    const link = (label, url) =>
      makeRow({
        label,
        desc: url,
        control: makeButton({ label: 'Abrir', onClick: () => window.api.openExternal(url) }),
      });

    return [
      makeSection({
        title: 'Report a problem',
        desc: 'Describe qué esperabas y qué ocurrió.',
        rows: [
          makeRow({
            label: 'Abrir una incidencia',
            desc: 'Crea un informe con el contexto del proyecto.',
            control: makeButton({
              label: 'Abrir',
              onClick: () => window.api.openExternal('https://github.com'),
            }),
          }),
          makeRow({
            label: 'Copiar diagnóstico',
            desc: 'Copia versión, proveedor y modelo al portapapeles.',
            control: makeButton({
              label: 'Copiar',
              onClick: () => {
                const state = bridge.getState();
                const text = [
                  `proveedor: ${state?.providerId ?? '—'}`,
                  `modelo: ${state?.model ?? '—'}`,
                  `workspace: ${state?.cwd ?? '—'}`,
                  `plataforma: ${navigator.platform}`,
                ].join('\n');
                navigator.clipboard.writeText(text).catch(() => {});
              },
            }),
          }),
        ],
      }),
      makeSection({
        title: 'Links',
        desc: null,
        rows: [
          link('Documentación', 'https://github.com'),
          link('Problemas conocidos', 'https://github.com'),
        ],
      }),
    ];
  }

  const RENDERERS = {
    general: renderGeneral,
    account: renderAccount,
    appearance: renderAppearance,
    notifications: renderNotifications,
    conversations: renderConversations,
    feedback: renderFeedback,
    models: renderModels,
    browser: renderBrowser,
    customizations: renderCustomizations,
    application: renderApplication,
    shortcuts: renderShortcuts,
    google: renderGoogle,
    project: renderProject,
    developer: renderDeveloper,
    tools: renderTools,
    network: renderNetwork,
    plugins: renderPlugins,
  };

  // -------------------------------------------------------------------------
  // Navegación y ciclo de vida
  // -------------------------------------------------------------------------

  function render() {
    const meta = SECTIONS[active] ?? SECTIONS.general;
    if (active === 'project') {
      const cwd = proyectoActivo || bridge?.getState?.()?.cwd || '';
      const nombre = cwd.split(/[\\/]/).filter(Boolean).pop();
      els.title.textContent = nombre || meta.title;
      els.subtitle.textContent = 'Manage project folders and settings.';
    } else {
      els.title.textContent = meta.title;
      els.subtitle.textContent = meta.subtitle;
    }
    els.back.hidden = !meta.parent;

    els.body.replaceChildren();
    const renderer = RENDERERS[active] ?? renderGeneral;
    for (const node of renderer()) els.body.append(node);

    const testids = {
      general: 'General',
      application: 'App',
      appearance: 'Appearance',
      shortcuts: 'Shortcuts',
      notifications: 'Notifications',
      models: 'Models',
      browser: 'Browser',
      conversations: 'Conversations',
      account: 'Account',
      feedback: 'Provide Feedback',
    };
    for (const btn of els.nav.querySelectorAll('[data-section]')) {
      btn.classList.toggle('is-active', btn.dataset.section === active);
      const testid = testids[btn.dataset.section];
      if (testid) btn.dataset.testid = `settings-nav-item-${testid}`;
    }
    els.feedback?.classList.toggle('is-active', active === 'feedback');
    renderProyectos();
  }

  function selectSection(section) {
    active = section;
    render();
    els.body.scrollTop = 0;
  }

  /** Pinta las entradas de proyecto; Antigravity muestra tres y «Show All». */
  function renderProyectos() {
    if (!els.projects) return;
    const actual = bridge?.getState?.()?.project ?? '';
    const lista = proyectos.length > 0 ? proyectos : actual ? [actual] : [];
    const visibles = mostrarTodosLosProyectos ? lista : lista.slice(0, 3);

    els.projects.replaceChildren();
    for (const cwd of visibles) {
      const nombre = String(cwd).split(/[\\/]/).filter(Boolean).pop() || 'Project';
      const boton = document.createElement('button');
      boton.type = 'button';
      boton.className = 'settings__nav-item';
      boton.textContent = nombre;
      boton.title = cwd;
      boton.dataset.cwd = cwd;
      const activo = (proyectoActivo || actual) === cwd && active === 'project';
      boton.classList.toggle('is-active', activo);
      boton.addEventListener('click', () => {
        proyectoActivo = cwd;
        selectSection('project');
      });
      els.projects.append(boton);
    }

    if (els.projectsMore) {
      // El original lo enseña en cuanto hay proyectos; con tres, también.
      els.projectsMore.hidden = lista.length === 0;
      els.projectsMore.textContent = mostrarTodosLosProyectos ? 'Show Less' : 'Show All';
    }
  }

  async function cargarProyectos() {
    const state = bridge?.getState?.() ?? {};
    const registrados = Array.isArray(state.projects) ? state.projects : [];
    let cwds = registrados.map((p) => p.path).filter(Boolean);
    if (cwds.length === 0) {
      try {
        const sesiones = (await window.api.listSessions()) || [];
        const vistos = new Set();
        for (const sesion of sesiones) {
          const cwd = sesion.project ?? sesion.cwd;
          if (cwd && !vistos.has(cwd)) {
            vistos.add(cwd);
            cwds.push(cwd);
          }
        }
      } catch {
        cwds = [];
      }
    }
    const actual = state.project ?? '';
    if (actual && !cwds.includes(actual)) cwds = [actual, ...cwds];
    proyectos = cwds;
    renderProyectos();
  }

  /** Devuelve el foco a donde estaba al abrir: al cerrar, el teclado no se pierde. */
  let focoPrevio = null;

  function open(section) {
    if (section && SECTIONS[section]) active = section;
    focoPrevio = document.activeElement;
    // El resto de la app queda inerte mientras el diálogo está abierto.
    document.querySelector('.app')?.setAttribute('inert', '');
    void cargarProyectos();
    window.api
      .updatesState?.()
      .then((estado) => {
        updateState = estado;
        if (active === 'application' && !els.modal.hasAttribute('hidden')) render();
      })
      .catch(() => {});
    window.api
      .getDownloadDir()
      .then((resultado) => {
        downloadDir = resultado?.path ?? '';
        if (active === 'browser' && !els.modal.hasAttribute('hidden')) render();
      })
      .catch(() => {});

    // Relee las preferencias: pueden haber cambiado desde la app.
    window.api
      .getPrefs()
      .then((stored) => {
        if (stored && typeof stored === 'object') {
          prefs = { ...DEFAULTS, ...stored };
          render();
        }
      })
      .catch(() => {});
    els.modal.removeAttribute('hidden');
    render();
    // Al abrir, la sección empieza arriba; el scroll de la vez anterior dejaba
    // el contenido cortado bajo la cabecera.
    els.body.scrollTop = 0;

    // Foco dentro del diálogo: con Tab no se recorre la interfaz tapada.
    const primero = els.modal.querySelector('.settings__nav-item.is-active, button, [href], input');
    if (primero && typeof primero.focus === 'function') primero.focus();
  }

  function close() {
    /*
     * Un campo con el foco (la clave recién pegada) se confirma al cerrar:
     * ocultar el modal sin blur perdía lo escrito.
     */
    const activo = document.activeElement;
    if (activo && els.modal.contains(activo) && typeof activo.blur === 'function') activo.blur();
    els.modal.setAttribute('hidden', '');
    document.querySelector('.app')?.removeAttribute('inert');
    if (focoPrevio && typeof focoPrevio.focus === 'function') focoPrevio.focus();
    focoPrevio = null;
  }

  function showNotice(message) {
    console.info('[settings]', message);
  }

  function init(options) {
    bridge = options;

    window.api.onUpdateEvent?.((estado) => {
      updateState = estado;
      if (active === 'application' && !els.modal.hasAttribute('hidden')) render();
    });

    for (const btn of els.nav.querySelectorAll('[data-section]')) {
      btn.addEventListener('click', () => selectSection(btn.dataset.section));
    }

    els.back.addEventListener('click', () => {
      const meta = SECTIONS[active];
      selectSection(meta && meta.parent ? meta.parent : 'general');
    });

    els.feedback.addEventListener('click', () => selectSection('feedback'));
    els.projectsMore?.addEventListener('click', () => {
      mostrarTodosLosProyectos = !mostrarTodosLosProyectos;
      renderProyectos();
    });

    window.api
      .getPrefs()
      .then((stored) => {
        if (stored && typeof stored === 'object') prefs = { ...DEFAULTS, ...stored };
      })
      .catch(() => {});
  }

  window.SettingsUI = {
    init,
    open,
    close,
    refresh: () => {
      if (!els.modal.hasAttribute('hidden')) render();
    },
    isOpen: () => !els.modal.hasAttribute('hidden'),
  };
})();
