(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ThemeEngine = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const CODE_PREVIEW_SNIPPET = [
    '// Greet a user by name',
    'const greet = (name: string) => {',
    '  return `Hello, ${name}!`;',
    '};',
  ].join('\n');

  const DARK_SYNTAX_BASE = {
    defaultFg: '#F8F8F2',
    comment: '#8292A2',
    punctuation: '#F8F8F2',
    property: '#F92672',
    tag: '#F92672',
    constant: '#F92672',
    number: '#AE81FF',
    string: '#A6E22E',
    attrName: '#A6E22E',
    builtin: '#A6E22E',
    operator: '#F8F8F2',
    variable: '#F8F8F2',
    attrValue: '#E6DB74',
    keyword: '#66D9EF',
    function: '#E6DB74',
    className: '#E6DB74',
    regex: '#FD971F',
  };

  const LIGHT_SYNTAX_BASE = {
    defaultFg: '#24292E',
    comment: '#6A737D',
    punctuation: '#24292E',
    property: '#D73A49',
    tag: '#22863A',
    constant: '#005CC5',
    number: '#005CC5',
    string: '#032F62',
    attrName: '#6F42C1',
    builtin: '#005CC5',
    operator: '#D73A49',
    variable: '#24292E',
    attrValue: '#032F62',
    keyword: '#D73A49',
    function: '#6F42C1',
    className: '#6F42C1',
    regex: '#032F62',
  };

  function makeSyntax(base, overrides) {
    return Object.freeze({ ...base, ...overrides });
  }

  const DARK_PRESETS = Object.freeze([
    Object.freeze({
      id: 'Default Dark',
      label: 'Default Dark',
      background: '#070708',
      foreground: '#FFFFFF',
      accent: '#2F71E3',
      syntax: makeSyntax(DARK_SYNTAX_BASE, {}),
    }),
    Object.freeze({
      id: 'Legacy Dark',
      label: 'Legacy Dark',
      background: '#101010',
      foreground: '#CCCCCC',
      accent: '#007ACC',
      syntax: makeSyntax(DARK_SYNTAX_BASE, {
        defaultFg: '#D4D4D4',
        comment: '#6A9955',
        keyword: '#569CD6',
        string: '#CE9178',
        number: '#B5CEA8',
        function: '#DCDCAA',
        className: '#4EC9B0',
        builtin: '#4EC9B0',
        property: '#9CDCFE',
        variable: '#9CDCFE',
        tag: '#569CD6',
        constant: '#4FC1FF',
        attrName: '#9CDCFE',
        attrValue: '#CE9178',
        regex: '#D16969',
      }),
    }),
    Object.freeze({
      id: 'Catppuccin',
      label: 'Catppuccin',
      background: '#24273A',
      foreground: '#CAD3F5',
      accent: '#C6A0F6',
      syntax: makeSyntax(DARK_SYNTAX_BASE, {
        defaultFg: '#CAD3F5',
        comment: '#6E738D',
        punctuation: '#939AB7',
        keyword: '#C6A0F6',
        string: '#A6DA95',
        number: '#F5A97F',
        function: '#8AADF4',
        className: '#EED49F',
        builtin: '#ED8796',
        property: '#8BD5CA',
        tag: '#ED8796',
        constant: '#F5A97F',
        operator: '#91D7E3',
        variable: '#CAD3F5',
        attrName: '#EED49F',
        attrValue: '#A6DA95',
        regex: '#F5BDE6',
      }),
    }),
    Object.freeze({
      id: 'Dracula',
      label: 'Dracula',
      background: '#282A36',
      foreground: '#F8F8F2',
      accent: '#BD93F9',
      syntax: makeSyntax(DARK_SYNTAX_BASE, {
        defaultFg: '#F8F8F2',
        comment: '#6272A4',
        punctuation: '#F8F8F2',
        keyword: '#FF79C6',
        string: '#F1FA8C',
        number: '#BD93F9',
        function: '#50FA7B',
        className: '#8BE9FD',
        builtin: '#8BE9FD',
        property: '#66D9EF',
        tag: '#FF79C6',
        constant: '#BD93F9',
        operator: '#FF79C6',
        variable: '#F8F8F2',
        attrName: '#50FA7B',
        attrValue: '#F1FA8C',
        regex: '#FFB86C',
      }),
    }),
    Object.freeze({
      id: 'Everforest',
      label: 'Everforest',
      background: '#2D353B',
      foreground: '#D3C6AA',
      accent: '#A7C080',
      syntax: makeSyntax(DARK_SYNTAX_BASE, {
        defaultFg: '#D3C6AA',
        comment: '#859289',
        punctuation: '#9DA9A0',
        keyword: '#E67E80',
        string: '#A7C080',
        number: '#D699B6',
        function: '#A7C080',
        className: '#DBBC7F',
        builtin: '#83C092',
        property: '#7FBBB3',
        tag: '#E67E80',
        constant: '#D699B6',
        operator: '#E69875',
        variable: '#D3C6AA',
        attrName: '#DBBC7F',
        attrValue: '#A7C080',
        regex: '#E69875',
      }),
    }),
    Object.freeze({
      id: 'Gruvbox Material',
      label: 'Gruvbox Material',
      background: '#141617',
      foreground: '#D4BE98',
      accent: '#E78A4E',
      syntax: makeSyntax(DARK_SYNTAX_BASE, {
        defaultFg: '#D4BE98',
        comment: '#928374',
        punctuation: '#A89984',
        keyword: '#EA6962',
        string: '#A9B665',
        number: '#D3869B',
        function: '#A9B665',
        className: '#D8A657',
        builtin: '#7DAEA3',
        property: '#7DAEA3',
        tag: '#EA6962',
        constant: '#D3869B',
        operator: '#E78A4E',
        variable: '#D4BE98',
        attrName: '#D8A657',
        attrValue: '#A9B665',
        regex: '#E78A4E',
      }),
    }),
    Object.freeze({
      id: 'Monokai',
      label: 'Monokai',
      background: '#272822',
      foreground: '#F8F8F2',
      accent: '#F92672',
      syntax: makeSyntax(DARK_SYNTAX_BASE, {
        defaultFg: '#F8F8F2',
        comment: '#75715E',
        punctuation: '#F8F8F2',
        keyword: '#F92672',
        string: '#E6DB74',
        number: '#AE81FF',
        function: '#A6E22E',
        className: '#A6E22E',
        builtin: '#66D9EF',
        property: '#A6E22E',
        tag: '#F92672',
        constant: '#AE81FF',
        operator: '#F92672',
        variable: '#F8F8F2',
        attrName: '#A6E22E',
        attrValue: '#E6DB74',
        regex: '#FD971F',
      }),
    }),
    Object.freeze({
      id: 'Nord',
      label: 'Nord',
      background: '#2E3440',
      foreground: '#D8DEE9',
      accent: '#88C0D0',
      syntax: makeSyntax(DARK_SYNTAX_BASE, {
        defaultFg: '#D8DEE9',
        comment: '#616E88',
        punctuation: '#ECEFF4',
        keyword: '#81A1C1',
        string: '#A3BE8C',
        number: '#B48EAD',
        function: '#88C0D0',
        className: '#8FBCBB',
        builtin: '#88C0D0',
        property: '#88C0D0',
        tag: '#81A1C1',
        constant: '#8FBCBB',
        operator: '#81A1C1',
        variable: '#D8DEE9',
        attrName: '#8FBCBB',
        attrValue: '#A3BE8C',
        regex: '#EBCB8B',
      }),
    }),
    Object.freeze({
      id: 'One Dark Pro',
      label: 'One Dark Pro',
      background: '#282C34',
      foreground: '#ABB2BF',
      accent: '#61AFEF',
      syntax: makeSyntax(DARK_SYNTAX_BASE, {
        defaultFg: '#ABB2BF',
        comment: '#5C6370',
        punctuation: '#ABB2BF',
        keyword: '#C678DD',
        string: '#98C379',
        number: '#D19A66',
        function: '#61AFEF',
        className: '#E5C07B',
        builtin: '#56B6C2',
        property: '#E06C75',
        tag: '#E06C75',
        constant: '#D19A66',
        operator: '#56B6C2',
        variable: '#E06C75',
        attrName: '#D19A66',
        attrValue: '#98C379',
        regex: '#56B6C2',
      }),
    }),
    Object.freeze({
      id: 'Tokyo Night',
      label: 'Tokyo Night',
      background: '#1A1B26',
      foreground: '#A9B1D6',
      accent: '#7AA2F7',
      syntax: makeSyntax(DARK_SYNTAX_BASE, {
        defaultFg: '#A9B1D6',
        comment: '#565F89',
        punctuation: '#89DDFF',
        keyword: '#9D7CD8',
        string: '#9ECE6A',
        number: '#FF9E64',
        function: '#7AA2F7',
        className: '#2AC3DE',
        builtin: '#2AC3DE',
        property: '#73DACA',
        tag: '#F7768E',
        constant: '#FF9E64',
        operator: '#89DDFF',
        variable: '#C0CAF5',
        attrName: '#BB9AF7',
        attrValue: '#9ECE6A',
        regex: '#B4F9F8',
      }),
    }),
    Object.freeze({
      id: 'Solarized Dark',
      label: 'Solarized Dark',
      background: '#002B36',
      foreground: '#93A1A1',
      accent: '#268BD2',
      syntax: makeSyntax(DARK_SYNTAX_BASE, {
        defaultFg: '#93A1A1',
        comment: '#586E75',
        punctuation: '#839496',
        keyword: '#859900',
        string: '#2AA198',
        number: '#D33682',
        function: '#268BD2',
        className: '#B58900',
        builtin: '#268BD2',
        property: '#268BD2',
        tag: '#268BD2',
        constant: '#CB4B16',
        operator: '#859900',
        variable: '#93A1A1',
        attrName: '#93A1A1',
        attrValue: '#2AA198',
        regex: '#DC322F',
      }),
    }),
    Object.freeze({
      id: 'Vesper',
      label: 'Vesper',
      background: '#101010',
      foreground: '#FFFFFF',
      accent: '#FFC799',
      syntax: makeSyntax(DARK_SYNTAX_BASE, {
        defaultFg: '#FFFFFF',
        comment: '#8B8B8B',
        punctuation: '#A0A0A0',
        keyword: '#A0A0A0',
        string: '#99FFE4',
        number: '#FFC799',
        function: '#FFC799',
        className: '#FFC799',
        builtin: '#99FFE4',
        property: '#FFFFFF',
        tag: '#FFC799',
        constant: '#FFC799',
        operator: '#A0A0A0',
        variable: '#FFFFFF',
        attrName: '#A0A0A0',
        attrValue: '#99FFE4',
        regex: '#FF8080',
      }),
    }),
  ]);

  const LIGHT_PRESETS = Object.freeze([
    Object.freeze({
      id: 'Default Light',
      label: 'Default Light',
      background: '#FFFFFF',
      foreground: '#0A0A0C',
      accent: '#2F71E3',
      syntax: makeSyntax(LIGHT_SYNTAX_BASE, {}),
    }),
    Object.freeze({
      id: 'Legacy Light',
      label: 'Legacy Light',
      background: '#F9F9F9',
      foreground: '#101010',
      accent: '#007ACC',
      syntax: makeSyntax(LIGHT_SYNTAX_BASE, {
        defaultFg: '#101010',
        comment: '#008000',
        keyword: '#0000FF',
        string: '#A31515',
        number: '#098658',
        function: '#795E26',
        className: '#267F99',
        builtin: '#267F99',
        property: '#001080',
        tag: '#800000',
        constant: '#0070C1',
        operator: '#101010',
        variable: '#001080',
        attrName: '#E50000',
        attrValue: '#0000FF',
        regex: '#811F3F',
      }),
    }),
    Object.freeze({
      id: 'Catppuccin',
      label: 'Catppuccin',
      background: '#EAECF0',
      foreground: '#4C4F69',
      accent: '#8839EF',
      syntax: makeSyntax(LIGHT_SYNTAX_BASE, {
        defaultFg: '#4C4F69',
        comment: '#8C8FA1',
        punctuation: '#6C6F85',
        keyword: '#8839EF',
        string: '#40A02B',
        number: '#FE640B',
        function: '#1E66F5',
        className: '#DF8E1D',
        builtin: '#D20F39',
        property: '#179299',
        tag: '#D20F39',
        constant: '#FE640B',
        operator: '#04A5E5',
        variable: '#4C4F69',
        attrName: '#DF8E1D',
        attrValue: '#40A02B',
        regex: '#EA76CB',
      }),
    }),
    Object.freeze({
      id: 'Everforest',
      label: 'Everforest',
      background: '#F8F0DC',
      foreground: '#5C6A72',
      accent: '#4E7525',
      syntax: makeSyntax(LIGHT_SYNTAX_BASE, {
        defaultFg: '#5C6A72',
        comment: '#939F91',
        punctuation: '#829181',
        keyword: '#F85552',
        string: '#4E7525',
        number: '#DF69BA',
        function: '#4E7525',
        className: '#DFA000',
        builtin: '#35A77C',
        property: '#3A94C5',
        tag: '#F85552',
        constant: '#DF69BA',
        operator: '#F57D26',
        variable: '#5C6A72',
        attrName: '#DFA000',
        attrValue: '#4E7525',
        regex: '#F57D26',
      }),
    }),
    Object.freeze({
      id: 'Gruvbox Material',
      label: 'Gruvbox Material',
      background: '#F9F5D7',
      foreground: '#4F3829',
      accent: '#C35E0A',
      syntax: makeSyntax(LIGHT_SYNTAX_BASE, {
        defaultFg: '#4F3829',
        comment: '#928374',
        punctuation: '#7C6F64',
        keyword: '#C14A4A',
        string: '#6C782E',
        number: '#945E80',
        function: '#6C782E',
        className: '#B47109',
        builtin: '#45707A',
        property: '#45707A',
        tag: '#C14A4A',
        constant: '#945E80',
        operator: '#C35E0A',
        variable: '#4F3829',
        attrName: '#B47109',
        attrValue: '#6C782E',
        regex: '#C35E0A',
      }),
    }),
    Object.freeze({
      id: 'One Light',
      label: 'One Light',
      background: '#F5F5F5',
      foreground: '#383A42',
      accent: '#4078F2',
      syntax: makeSyntax(LIGHT_SYNTAX_BASE, {
        defaultFg: '#383A42',
        comment: '#A0A1A7',
        punctuation: '#383A42',
        keyword: '#A626A4',
        string: '#50A14F',
        number: '#986801',
        function: '#4078F2',
        className: '#C18401',
        builtin: '#0184BC',
        property: '#E45649',
        tag: '#E45649',
        constant: '#986801',
        operator: '#0184BC',
        variable: '#E45649',
        attrName: '#986801',
        attrValue: '#50A14F',
        regex: '#0184BC',
      }),
    }),
    Object.freeze({
      id: 'Solarized Light',
      label: 'Solarized Light',
      background: '#FAF4E5',
      foreground: '#435155',
      accent: '#CB4B16',
      syntax: makeSyntax(LIGHT_SYNTAX_BASE, {
        defaultFg: '#435155',
        comment: '#93A1A1',
        punctuation: '#657B83',
        keyword: '#859900',
        string: '#2AA198',
        number: '#D33682',
        function: '#268BD2',
        className: '#B58900',
        builtin: '#268BD2',
        property: '#268BD2',
        tag: '#268BD2',
        constant: '#CB4B16',
        operator: '#859900',
        variable: '#435155',
        attrName: '#657B83',
        attrValue: '#2AA198',
        regex: '#DC322F',
      }),
    }),
  ]);

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function normalizeHex(raw) {
    if (typeof raw !== 'string') return null;
    const cleaned = raw.trim().replace(/^#/, '');
    if (/^[0-9a-fA-F]{3}$/.test(cleaned)) {
      const expanded = cleaned
        .split('')
        .map((c) => c + c)
        .join('');
      return `#${expanded.toUpperCase()}`;
    }
    if (/^[0-9a-fA-F]{6}$/.test(cleaned)) {
      return `#${cleaned.toUpperCase()}`;
    }
    return null;
  }

  function hexToRgb(hex) {
    const norm = normalizeHex(hex);
    if (!norm) return null;
    return {
      r: parseInt(norm.slice(1, 3), 16),
      g: parseInt(norm.slice(3, 5), 16),
      b: parseInt(norm.slice(5, 7), 16),
    };
  }

  function rgbToHex(r, g, b) {
    const toByte = (n) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
    return `#${toByte(r)}${toByte(g)}${toByte(b)}`.toUpperCase();
  }

  function hexToHsv(hex) {
    const rgb = hexToRgb(hex);
    if (!rgb) return { h: 0, s: 0, v: 0 };
    const r = rgb.r / 255;
    const g = rgb.g / 255;
    const b = rgb.b / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;

    let h = 0;
    if (delta !== 0) {
      if (max === r) h = 60 * (((g - b) / delta) % 6);
      else if (max === g) h = 60 * ((b - r) / delta + 2);
      else h = 60 * ((r - g) / delta + 4);
    }
    if (h < 0) h += 360;

    const s = max === 0 ? 0 : delta / max;
    const v = max;
    return { h, s, v };
  }

  function hsvToHex(h, s, v) {
    const hue = ((Number(h) % 360) + 360) % 360;
    const sat = clamp(Number(s), 0, 1);
    const val = clamp(Number(v), 0, 1);

    const c = val * sat;
    const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
    const m = val - c;

    let r = 0;
    let g = 0;
    let b = 0;
    if (hue < 60) [r, g, b] = [c, x, 0];
    else if (hue < 120) [r, g, b] = [x, c, 0];
    else if (hue < 180) [r, g, b] = [0, c, x];
    else if (hue < 240) [r, g, b] = [0, x, c];
    else if (hue < 300) [r, g, b] = [x, 0, c];
    else [r, g, b] = [c, 0, x];

    return rgbToHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
  }

  function mixHex(baseHex, targetHex, ratio) {
    const base = hexToRgb(baseHex);
    const target = hexToRgb(targetHex);
    if (!base || !target) return normalizeHex(baseHex) ?? '#000000';
    const t = clamp(ratio, 0, 1);
    return rgbToHex(
      base.r + (target.r - base.r) * t,
      base.g + (target.g - base.g) * t,
      base.b + (target.b - base.b) * t,
    );
  }

  function rgbaFromHex(hex, alpha) {
    const rgb = hexToRgb(hex) ?? { r: 255, g: 255, b: 255 };
    const a = Number(clamp(alpha, 0, 1).toFixed(4));
    return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${a})`;
  }

  function relativeLuminance(hex) {
    const rgb = hexToRgb(hex);
    if (!rgb) return 0;
    const toLinear = (c) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * toLinear(rgb.r) + 0.7152 * toLinear(rgb.g) + 0.0722 * toLinear(rgb.b);
  }

  function contrastForeground(bgHex, darkFallback = '#0A0A0C') {
    return relativeLuminance(bgHex) > 0.36 ? darkFallback : '#FFFFFF';
  }

  function resolveThemeMode(themePref, prefersDark = true) {
    if (themePref === 'Light') return 'light';
    if (themePref === 'Dark') return 'dark';
    if (themePref === 'System') return prefersDark ? 'dark' : 'light';
    return 'dark';
  }

  function getPresetsForMode(mode) {
    return mode === 'light' ? LIGHT_PRESETS : DARK_PRESETS;
  }

  function getPreset(mode, name) {
    const list = getPresetsForMode(mode);
    return list.find((p) => p.id === name) ?? list[0];
  }

  function getCustomColorsForMode(mode, prefs) {
    if (!prefs || typeof prefs !== 'object') return {};
    return mode === 'light' ? (prefs.lightThemeColors ?? {}) : (prefs.themeColors ?? {});
  }

  function getPresetNameForMode(mode, prefs) {
    if (!prefs || typeof prefs !== 'object') {
      return mode === 'light' ? 'Default Light' : 'Default Dark';
    }
    return mode === 'light'
      ? (prefs.lightPreset ?? 'Default Light')
      : (prefs.darkPreset ?? 'Default Dark');
  }

  function getEffectiveColors(mode, prefs) {
    const preset = getPreset(mode, getPresetNameForMode(mode, prefs));
    const overrides = getCustomColorsForMode(mode, prefs);
    return {
      background: normalizeHex(overrides.background) ?? preset.background,
      foreground: normalizeHex(overrides.foreground) ?? preset.foreground,
      accent: normalizeHex(overrides.accent) ?? preset.accent,
    };
  }

  function isPresetModified(mode, prefs) {
    const preset = getPreset(mode, getPresetNameForMode(mode, prefs));
    const effective = getEffectiveColors(mode, prefs);
    return (
      effective.background !== preset.background ||
      effective.foreground !== preset.foreground ||
      effective.accent !== preset.accent
    );
  }

  function syntaxToCssVars(syntax) {
    return {
      '--syntax-default-fg': syntax.defaultFg,
      '--syntax-comment': syntax.comment,
      '--syntax-punctuation': syntax.punctuation,
      '--syntax-property': syntax.property,
      '--syntax-tag': syntax.tag,
      '--syntax-constant': syntax.constant,
      '--syntax-number': syntax.number,
      '--syntax-string': syntax.string,
      '--syntax-attr-name': syntax.attrName,
      '--syntax-builtin': syntax.builtin,
      '--syntax-operator': syntax.operator,
      '--syntax-variable': syntax.variable,
      '--syntax-attr-value': syntax.attrValue,
      '--syntax-keyword': syntax.keyword,
      '--syntax-function': syntax.function,
      '--syntax-class-name': syntax.className,
      '--syntax-regex': syntax.regex,
    };
  }

  function stripHash(hex) {
    return (normalizeHex(hex) ?? '#FFFFFF').slice(1);
  }

  function buildMonacoTheme(mode, colors, syntax, surfaces) {
    const isLight = mode === 'light';
    return {
      base: isLight ? 'vs' : 'vs-dark',
      inherit: true,
      rules: [
        { token: 'comment', foreground: stripHash(syntax.comment), fontStyle: 'italic' },
        { token: 'string', foreground: stripHash(syntax.string) },
        { token: 'number', foreground: stripHash(syntax.number) },
        { token: 'keyword', foreground: stripHash(syntax.keyword) },
        { token: 'type.identifier', foreground: stripHash(syntax.className) },
        { token: 'identifier', foreground: stripHash(syntax.defaultFg) },
        { token: 'delimiter', foreground: stripHash(syntax.punctuation) },
        { token: 'tag', foreground: stripHash(syntax.tag) },
        { token: 'attribute.name', foreground: stripHash(syntax.attrName) },
        { token: 'attribute.value', foreground: stripHash(syntax.attrValue) },
      ],
      colors: {
        'editor.background': colors.background,
        'editor.foreground': syntax.defaultFg,
        'editorLineNumber.foreground': surfaces.mutedFg,
        'editorLineNumber.activeForeground': colors.foreground,
        'editor.selectionBackground': `${colors.accent}44`,
        'editor.lineHighlightBackground': surfaces.card,
        'editorCursor.foreground': colors.accent,
        'editorWidget.background': surfaces.card,
        'editorWidget.border': surfaces.borderHex,
        'editorSuggestWidget.background': surfaces.card,
        'editorSuggestWidget.border': surfaces.borderHex,
        'editorSuggestWidget.selectedBackground': surfaces.secondaryHex,
        'editorHoverWidget.background': surfaces.card,
        'editorHoverWidget.border': surfaces.borderHex,
        'editorError.foreground': isLight ? '#DC2626' : '#F87171',
        'editorWarning.foreground': isLight ? '#B45309' : '#FBBF24',
        'scrollbarSlider.background': `${surfaces.secondaryHex}80`,
        'scrollbarSlider.hoverBackground': `${surfaces.mutedFg}99`,
      },
    };
  }

  function buildXtermTheme(mode, colors, surfaces) {
    if (mode === 'light') {
      return {
        background: colors.background,
        foreground: colors.foreground,
        cursor: colors.accent,
        selectionBackground: `${colors.accent}38`,
        black: '#1A1A1A',
        red: '#DC2626',
        green: '#16A34A',
        yellow: '#B45309',
        blue: colors.accent,
        magenta: '#9333EA',
        cyan: '#0891B2',
        white: '#E5E7EB',
        brightBlack: surfaces.mutedFg,
        brightRed: '#EF4444',
        brightGreen: '#22C55E',
        brightYellow: '#CA8A04',
        brightBlue: '#3B82F6',
        brightMagenta: '#A855F7',
        brightCyan: '#06B6D4',
        brightWhite: colors.background,
      };
    }

    return {
      background: colors.background,
      foreground: colors.foreground,
      cursor: colors.accent,
      selectionBackground: `${colors.accent}44`,
      black: colors.background,
      red: '#F87171',
      green: '#4ADE80',
      yellow: '#FBBF24',
      blue: colors.accent,
      magenta: '#C084FC',
      cyan: '#38BDF8',
      white: colors.foreground,
      brightBlack: surfaces.mutedFg,
      brightRed: '#FCA5A5',
      brightGreen: '#86EFAC',
      brightYellow: '#FDE68A',
      brightBlue: '#93C5FD',
      brightMagenta: '#D8B4FE',
      brightCyan: '#7DD3FC',
      brightWhite: '#FFFFFF',
    };
  }

  function buildThemeTokens(prefs, prefersDark = true) {
    const mode = resolveThemeMode(prefs?.theme, prefersDark);
    const strong = prefs?.themeContrast === 'Strong';
    const preset = getPreset(mode, getPresetNameForMode(mode, prefs));
    const colors = getEffectiveColors(mode, prefs);
    const modified = isPresetModified(mode, prefs);
    const isLight = mode === 'light';
    const isDefaultDarkUnmodified = !isLight && preset.id === 'Default Dark' && !modified;
    const isDefaultLightUnmodified = isLight && preset.id === 'Default Light' && !modified;

    const bg = isDefaultDarkUnmodified && strong ? '#050507' : colors.background;
    const fg = colors.foreground;
    const primary = colors.accent;
    const darkAccentFg = !isLight && relativeLuminance(bg) < 0.08 ? colors.background : '#0A0A0C';
    const primaryFg = contrastForeground(primary, darkAccentFg);

    let sidebar;
    let card;
    let bubbleBg;
    let composerBg;
    let composerCard;
    let composerRing;
    let segmentBg;
    let segmentActive;
    let editorTabActive;
    let muted;
    let mutedFg;
    let secondary;
    let secondaryHex;
    let secondaryFg;
    let sidebarMuted;
    let sidebarSecondary;
    let border;
    let borderHex;
    let cardBorder;
    let accentBg;
    let selectionBg;
    let codeFg;

    if (isLight) {
      sidebar = mixHex(bg, fg, strong ? 0.055 : 0.032);
      card = mixHex(bg, fg, strong ? 0.065 : 0.036);
      bubbleBg = card;
      composerBg = isDefaultLightUnmodified ? '#FFFFFF' : mixHex(bg, fg, strong ? 0.055 : 0.035);
      composerCard = card;
      composerRing = isDefaultLightUnmodified ? '#FFFFFF' : composerBg;
      segmentBg = sidebar;
      segmentActive = bg;
      editorTabActive = card;
      muted = rgbaFromHex(fg, strong ? 0.075 : 0.045);
      mutedFg = mixHex(fg, bg, strong ? 0.34 : 0.46);
      secondaryHex = mixHex(bg, fg, strong ? 0.11 : 0.072);
      secondary = rgbaFromHex(fg, strong ? 0.11 : 0.072);
      secondaryFg = mixHex(fg, bg, strong ? 0.16 : 0.27);
      sidebarMuted = rgbaFromHex(fg, strong ? 0.075 : 0.048);
      sidebarSecondary = rgbaFromHex(fg, strong ? 0.12 : 0.085);
      border = rgbaFromHex(fg, strong ? 0.15 : 0.085);
      borderHex = mixHex(bg, fg, strong ? 0.17 : 0.1);
      cardBorder = rgbaFromHex(fg, strong ? 0.2 : 0.11);
      accentBg = rgbaFromHex(primary, strong ? 0.18 : 0.12);
      selectionBg = rgbaFromHex(primary, 0.2);
      codeFg = mixHex(fg, primary, 0.45);
    } else if (isDefaultDarkUnmodified) {
      sidebar = strong ? '#121216' : '#111114';
      card = strong ? '#17171C' : '#131317';
      bubbleBg = strong ? '#16161A' : '#131317';
      composerBg = '#0D0D11';
      composerCard = '#15151A';
      composerRing = '#0D0D11';
      segmentBg = '#111115';
      segmentActive = '#24252A';
      editorTabActive = '#2C2C2C';
      muted = rgbaFromHex('#FFFFFF', strong ? 0.068 : 0.042);
      mutedFg = strong ? '#A8A9B2' : '#87888F';
      secondary = rgbaFromHex('#FFFFFF', strong ? 0.115 : 0.075);
      secondaryHex = mixHex(bg, '#FFFFFF', strong ? 0.115 : 0.075);
      secondaryFg = strong ? '#EAEBF1' : '#BCBDC6';
      sidebarMuted = rgbaFromHex('#FFFFFF', strong ? 0.08 : 0.048);
      sidebarSecondary = rgbaFromHex('#FFFFFF', strong ? 0.135 : 0.09);
      border = rgbaFromHex('#FFFFFF', strong ? 0.11 : 0.06);
      borderHex = mixHex(bg, '#FFFFFF', strong ? 0.13 : 0.08);
      cardBorder = rgbaFromHex('#FFFFFF', strong ? 0.13 : 0.08);
      accentBg = rgbaFromHex(primary, strong ? 0.22 : 0.16);
      selectionBg = rgbaFromHex(primary, 0.4);
      codeFg = mixHex('#BCBDC6', primary, 0.35);
    } else {
      sidebar = mixHex(bg, '#FFFFFF', strong ? 0.046 : 0.04);
      card = mixHex(bg, '#FFFFFF', strong ? 0.066 : 0.048);
      bubbleBg = card;
      composerBg = mixHex(bg, '#FFFFFF', strong ? 0.03 : 0.024);
      composerCard = card;
      composerRing = composerBg;
      segmentBg = sidebar;
      segmentActive = mixHex(sidebar, '#FFFFFF', strong ? 0.1 : 0.077);
      editorTabActive = card;
      muted = rgbaFromHex('#FFFFFF', strong ? 0.068 : 0.042);
      mutedFg = mixHex(fg, bg, strong ? 0.38 : 0.49);
      secondary = rgbaFromHex('#FFFFFF', strong ? 0.115 : 0.075);
      secondaryHex = mixHex(bg, '#FFFFFF', strong ? 0.115 : 0.075);
      secondaryFg = mixHex(fg, bg, strong ? 0.18 : 0.27);
      sidebarMuted = rgbaFromHex('#FFFFFF', strong ? 0.08 : 0.048);
      sidebarSecondary = rgbaFromHex('#FFFFFF', strong ? 0.135 : 0.09);
      border = rgbaFromHex('#FFFFFF', strong ? 0.11 : 0.06);
      borderHex = mixHex(bg, '#FFFFFF', strong ? 0.13 : 0.08);
      cardBorder = rgbaFromHex('#FFFFFF', strong ? 0.13 : 0.08);
      accentBg = rgbaFromHex(primary, strong ? 0.22 : 0.16);
      selectionBg = rgbaFromHex(primary, 0.4);
      codeFg = mixHex(fg, primary, 0.35);
    }

    const cssVars = {
      '--background': bg,
      '--foreground': fg,
      '--card': card,
      '--card-border': cardBorder,
      '--border': border,
      '--muted': muted,
      '--muted-foreground': mutedFg,
      '--secondary': secondary,
      '--secondary-foreground': secondaryFg,
      '--primary': primary,
      '--primary-foreground': primaryFg,
      '--ring': primary,
      '--accent': accentBg,
      '--accent-foreground': fg,
      '--sidebar': sidebar,
      '--sidebar-muted': sidebarMuted,
      '--sidebar-secondary': sidebarSecondary,
      '--bubble-bg': bubbleBg,
      '--composer-bg': composerBg,
      '--composer-card': composerCard,
      '--composer-ring': composerRing,
      '--segment-bg': segmentBg,
      '--segment-active': segmentActive,
      '--editor-tab-active': editorTabActive,
      '--selection-background': selectionBg,
      '--code-foreground': codeFg,
      '--color-background': bg,
      '--color-foreground': fg,
      '--color-card': card,
      '--color-card-border': cardBorder,
      '--color-border': border,
      '--color-muted': muted,
      '--color-muted-foreground': mutedFg,
      '--color-secondary': secondary,
      '--color-secondary-foreground': secondaryFg,
      '--color-primary': primary,
      '--color-primary-foreground': primaryFg,
      '--color-sidebar': sidebar,
      '--color-sidebar-muted': sidebarMuted,
      '--color-sidebar-secondary': sidebarSecondary,
      '--color-selection-background': selectionBg,
      ...syntaxToCssVars(preset.syntax),
    };

    const surfaces = { card, mutedFg, borderHex, secondaryHex };
    const effectiveColors = { ...colors, background: bg };

    return {
      mode,
      contrast: strong ? 'strong' : 'default',
      presetId: preset.id,
      colors,
      syntax: preset.syntax,
      cssVars,
      monacoTheme: buildMonacoTheme(mode, effectiveColors, preset.syntax, surfaces),
      xtermTheme: buildXtermTheme(mode, effectiveColors, surfaces),
    };
  }

  return {
    CODE_PREVIEW_SNIPPET,
    DARK_PRESETS,
    LIGHT_PRESETS,
    normalizeHex,
    hexToRgb,
    rgbToHex,
    hexToHsv,
    hsvToHex,
    mixHex,
    rgbaFromHex,
    relativeLuminance,
    contrastForeground,
    resolveThemeMode,
    getPresetsForMode,
    getPreset,
    getEffectiveColors,
    isPresetModified,
    buildThemeTokens,
  };
});
