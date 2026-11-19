import test from 'node:test';
import assert from 'node:assert/strict';
import '../renderer/themes.js';

const ThemeEngine = globalThis.ThemeEngine;

test('expone los 12 presets oscuros exactos en orden', () => {
  const expected = [
    ['Default Dark', '#070708', '#FFFFFF', '#2F71E3'],
    ['Legacy Dark', '#101010', '#CCCCCC', '#007ACC'],
    ['Catppuccin', '#24273A', '#CAD3F5', '#C6A0F6'],
    ['Dracula', '#282A36', '#F8F8F2', '#BD93F9'],
    ['Everforest', '#2D353B', '#D3C6AA', '#A7C080'],
    ['Gruvbox Material', '#141617', '#D4BE98', '#E78A4E'],
    ['Monokai', '#272822', '#F8F8F2', '#F92672'],
    ['Nord', '#2E3440', '#D8DEE9', '#88C0D0'],
    ['One Dark Pro', '#282C34', '#ABB2BF', '#61AFEF'],
    ['Tokyo Night', '#1A1B26', '#A9B1D6', '#7AA2F7'],
    ['Solarized Dark', '#002B36', '#93A1A1', '#268BD2'],
    ['Vesper', '#101010', '#FFFFFF', '#FFC799'],
  ];

  assert.equal(ThemeEngine.DARK_PRESETS.length, 12);
  assert.deepEqual(
    ThemeEngine.DARK_PRESETS.map((p) => [p.id, p.background, p.foreground, p.accent]),
    expected,
  );
});

test('expone los 7 presets claros exactos en orden', () => {
  const expected = [
    ['Default Light', '#FFFFFF', '#0A0A0C', '#2F71E3'],
    ['Legacy Light', '#F9F9F9', '#101010', '#007ACC'],
    ['Catppuccin', '#EAECF0', '#4C4F69', '#8839EF'],
    ['Everforest', '#F8F0DC', '#5C6A72', '#4E7525'],
    ['Gruvbox Material', '#F9F5D7', '#4F3829', '#C35E0A'],
    ['One Light', '#F5F5F5', '#383A42', '#4078F2'],
    ['Solarized Light', '#FAF4E5', '#435155', '#CB4B16'],
  ];

  assert.equal(ThemeEngine.LIGHT_PRESETS.length, 7);
  assert.deepEqual(
    ThemeEngine.LIGHT_PRESETS.map((p) => [p.id, p.background, p.foreground, p.accent]),
    expected,
  );
});

test('normalizeHex limpia formatos cortos, largos e inválidos', () => {
  assert.equal(ThemeEngine.normalizeHex('#f92672'), '#F92672');
  assert.equal(ThemeEngine.normalizeHex('272822'), '#272822');
  assert.equal(ThemeEngine.normalizeHex(' #abc '), '#AABBCC');
  assert.equal(ThemeEngine.normalizeHex('#12345'), null);
  assert.equal(ThemeEngine.normalizeHex('zzzzzz'), null);
  assert.equal(ThemeEngine.normalizeHex(null), null);
});

test('hexToHsv y hsvToHex conservan los colores en ida y vuelta', () => {
  for (const hex of ['#000000', '#FFFFFF', '#F92672', '#272822', '#2F71E3', '#FFC799', '#002B36']) {
    const hsv = ThemeEngine.hexToHsv(hex);
    const roundTrip = ThemeEngine.hsvToHex(hsv.h, hsv.s, hsv.v);
    const a = ThemeEngine.hexToRgb(hex);
    const b = ThemeEngine.hexToRgb(roundTrip);
    assert.ok(Math.abs(a.r - b.r) <= 1 && Math.abs(a.g - b.g) <= 1 && Math.abs(a.b - b.b) <= 1, `${hex} -> ${roundTrip}`);
  }
});

test('resolveThemeMode soporta Dark, Light y System', () => {
  assert.equal(ThemeEngine.resolveThemeMode('Dark', false), 'dark');
  assert.equal(ThemeEngine.resolveThemeMode('Light', true), 'light');
  assert.equal(ThemeEngine.resolveThemeMode('System', true), 'dark');
  assert.equal(ThemeEngine.resolveThemeMode('System', false), 'light');
  assert.equal(ThemeEngine.resolveThemeMode(undefined, false), 'dark');
});

test('mantiene retrocompatibilidad de themeColors y aísla Dark de Light', () => {
  const prefs = {
    theme: 'Dark',
    darkPreset: 'Monokai',
    lightPreset: 'Gruvbox Material',
    themeColors: { accent: '#00ffaa' },
    lightThemeColors: { background: '#ffffff' },
  };

  const darkEffective = ThemeEngine.getEffectiveColors('dark', prefs);
  assert.deepEqual(darkEffective, {
    background: '#272822',
    foreground: '#F8F8F2',
    accent: '#00FFAA',
  });

  const lightEffective = ThemeEngine.getEffectiveColors('light', prefs);
  assert.deepEqual(lightEffective, {
    background: '#FFFFFF',
    foreground: '#4F3829',
    accent: '#C35E0A',
  });
});

test('isPresetModified detecta cambios respecto al preset activo', () => {
  assert.equal(ThemeEngine.isPresetModified('dark', { darkPreset: 'Monokai' }), false);
  assert.equal(
    ThemeEngine.isPresetModified('dark', { darkPreset: 'Monokai', themeColors: { background: '#272822' } }),
    false,
  );
  assert.equal(
    ThemeEngine.isPresetModified('dark', { darkPreset: 'Monokai', themeColors: { background: '#888F67' } }),
    true,
  );
  assert.equal(
    ThemeEngine.isPresetModified('light', { lightPreset: 'Default Light', lightThemeColors: { accent: '#F92672' } }),
    true,
  );
});

test('contrastForeground garantiza texto legible sobre acentos claros y oscuros', () => {
  assert.equal(ThemeEngine.contrastForeground('#2F71E3'), '#FFFFFF');
  assert.equal(ThemeEngine.contrastForeground('#F92672'), '#FFFFFF');
  assert.equal(ThemeEngine.contrastForeground('#FFC799'), '#0A0A0C');
  assert.equal(ThemeEngine.contrastForeground('#A7C080'), '#0A0A0C');
});

test('buildThemeTokens deriva superficies, contraste Strong, Monaco y xterm', () => {
  const monokaiDefault = ThemeEngine.buildThemeTokens({
    theme: 'Dark',
    themeContrast: 'Default',
    darkPreset: 'Monokai',
  });
  assert.equal(monokaiDefault.mode, 'dark');
  assert.equal(monokaiDefault.cssVars['--background'], '#272822');
  assert.equal(monokaiDefault.cssVars['--foreground'], '#F8F8F2');
  assert.equal(monokaiDefault.cssVars['--primary'], '#F92672');
  assert.equal(monokaiDefault.cssVars['--syntax-keyword'], '#F92672');
  assert.notEqual(monokaiDefault.cssVars['--sidebar'], monokaiDefault.cssVars['--background']);
  assert.ok(monokaiDefault.cssVars['--composer-bg']);
  assert.ok(monokaiDefault.cssVars['--composer-card']);
  assert.ok(monokaiDefault.cssVars['--segment-bg']);
  assert.ok(monokaiDefault.cssVars['--segment-active']);
  assert.equal(monokaiDefault.cssVars['--editor-tab-active'], monokaiDefault.cssVars['--card']);
  assert.equal(monokaiDefault.cssVars['--color-background'], '#272822');
  assert.equal(monokaiDefault.monacoTheme.base, 'vs-dark');
  assert.equal(monokaiDefault.monacoTheme.colors['editor.background'], '#272822');
  assert.ok(monokaiDefault.monacoTheme.rules.every((r) => !String(r.foreground).startsWith('#')));
  assert.equal(monokaiDefault.xtermTheme.background, '#272822');

  const monokaiStrong = ThemeEngine.buildThemeTokens({
    theme: 'Dark',
    themeContrast: 'Strong',
    darkPreset: 'Monokai',
  });
  assert.equal(monokaiStrong.contrast, 'strong');
  assert.equal(monokaiStrong.cssVars['--background'], '#272822');
  assert.notEqual(monokaiStrong.cssVars['--border'], monokaiDefault.cssVars['--border']);
  assert.notEqual(monokaiStrong.cssVars['--card'], monokaiDefault.cssVars['--card']);

  const gruvboxLight = ThemeEngine.buildThemeTokens({
    theme: 'Light',
    themeContrast: 'Strong',
    lightPreset: 'Gruvbox Material',
  });
  assert.equal(gruvboxLight.mode, 'light');
  assert.equal(gruvboxLight.cssVars['--background'], '#F9F5D7');
  assert.equal(gruvboxLight.cssVars['--primary'], '#C35E0A');
  assert.equal(gruvboxLight.monacoTheme.base, 'vs');
  assert.equal(gruvboxLight.xtermTheme.background, '#F9F5D7');
});

test('buildThemeTokens conserva valores exactos medidos en v0.2.0 para Default Dark y Nord', () => {
  const defaultDark = ThemeEngine.buildThemeTokens({
    theme: 'Dark',
    themeContrast: 'Default',
    darkPreset: 'Default Dark',
  });
  assert.equal(defaultDark.cssVars['--background'], '#070708');
  assert.equal(defaultDark.cssVars['--card'], '#131317');
  assert.equal(defaultDark.cssVars['--sidebar'], '#111114');
  assert.equal(defaultDark.cssVars['--composer-bg'], '#0D0D11');
  assert.equal(defaultDark.cssVars['--composer-card'], '#15151A');
  assert.equal(defaultDark.cssVars['--segment-bg'], '#111115');
  assert.equal(defaultDark.cssVars['--segment-active'], '#24252A');
  assert.equal(defaultDark.cssVars['--editor-tab-active'], '#2C2C2C');

  const defaultStrong = ThemeEngine.buildThemeTokens({
    theme: 'Dark',
    themeContrast: 'Strong',
    darkPreset: 'Default Dark',
  });
  assert.equal(defaultStrong.cssVars['--background'], '#050507');
  assert.equal(defaultStrong.cssVars['--card'], '#17171C');
  assert.equal(defaultStrong.cssVars['--sidebar'], '#121216');
  assert.equal(defaultStrong.cssVars['--muted-foreground'], '#A8A9B2');
  assert.equal(defaultStrong.cssVars['--secondary-foreground'], '#EAEBF1');

  const nordDefault = ThemeEngine.buildThemeTokens({
    theme: 'Dark',
    themeContrast: 'Default',
    darkPreset: 'Nord',
  });
  assert.equal(nordDefault.cssVars['--composer-bg'], '#333945');
  assert.equal(nordDefault.cssVars['--composer-ring'], '#333945');
  assert.equal(nordDefault.cssVars['--primary-foreground'], '#2E3440');
  assert.equal(nordDefault.cssVars['--syntax-property'], '#88C0D0');
  assert.equal(nordDefault.cssVars['--syntax-constant'], '#8FBCBB');
  assert.equal(nordDefault.cssVars['--selection-background'], 'rgba(136, 192, 208, 0.4)');

  const nordStrong = ThemeEngine.buildThemeTokens({
    theme: 'Dark',
    themeContrast: 'Strong',
    darkPreset: 'Nord',
  });
  assert.equal(nordStrong.cssVars['--composer-bg'], '#343A46');
  assert.equal(nordStrong.cssVars['--composer-ring'], '#343A46');
});
