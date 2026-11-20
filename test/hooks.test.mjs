// Hooks: reescritura de argumentos, redacción de secretos, truncado y hooks de texto.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { modulo, temporal } from './helpers.mjs';

const {
  conHooks,
  absolutizarRutas,
  dentroDelWorkspace,
  sanearEntorno,
  redactarSecretos,
  aplicarReglasDeReescritura,
  aplicarHooksDeTexto,
  aplicarHooksDeRazonamiento,
} = modulo('hooks');

describe('absolutizarRutas', () => {
  test('convierte una ruta relativa en absoluta', () => {
    const { args, notas } = absolutizarRutas('read_file', { path: 'src/index.ts' }, () => '/proyecto');
    assert.equal(args.path, path.resolve('/proyecto', 'src/index.ts'));
    assert.equal(notas.length, 1);
  });

  test('deja intacta una ruta que ya es absoluta', () => {
    const absoluta = path.resolve('/otro/sitio/a.ts');
    const { args, notas } = absolutizarRutas('read_file', { path: absoluta }, () => '/proyecto');
    assert.equal(args.path, absoluta);
    assert.equal(notas.length, 0);
  });

  test('no toca herramientas que no llevan ruta', () => {
    const { args, notas } = absolutizarRutas('run_command', { command: 'ls' }, () => '/proyecto');
    assert.deepEqual(args, { command: 'ls' });
    assert.equal(notas.length, 0);
  });

  test('sin workspace no hace nada', () => {
    const { args } = absolutizarRutas('read_file', { path: 'a.ts' }, () => '');
    assert.equal(args.path, 'a.ts');
  });

  test('con el sandbox activo rechaza rutas fuera del workspace', () => {
    const cwd = path.resolve('workspace');
    assert.throws(
      () => absolutizarRutas('read_file', { path: '../fuera.txt' }, () => cwd, true),
      /fuera del workspace/,
    );
    assert.throws(
      () => absolutizarRutas('edit_notebook', { path: path.join(cwd, '..', 'fuera.ipynb') }, () => cwd, true),
      /fuera del workspace/,
    );
    assert.throws(
      () => absolutizarRutas('multi_replace', { path: path.join(cwd, '..', 'fuera.ts') }, () => cwd, true),
      /fuera del workspace/,
    );
    assert.throws(
      () => absolutizarRutas('run_command', { command: 'ls', cwd: '..' }, () => cwd, true),
      /fuera del workspace/,
    );
    // Los alias también deben pasar por el sandbox.
    assert.throws(
      () => absolutizarRutas('read_file', { filePath: '../fuera.txt' }, () => cwd, true),
      /fuera del workspace/,
    );
    assert.throws(
      () => absolutizarRutas('write_file', { Path: '../fuera.txt' }, () => cwd, true),
      /fuera del workspace/,
    );
  });

  test('con el sandbox activo permite una raíz añadida', () => {
    const cwd = path.resolve('workspace');
    const extra = path.resolve(cwd, '..', 'otra-raiz');
    const dentro = path.join(extra, 'nota.txt');
    assert.throws(
      () => absolutizarRutas('read_file', { path: dentro }, () => cwd, true),
      /fuera del workspace/,
    );
    const { args } = absolutizarRutas('read_file', { path: dentro }, () => cwd, true, () => [extra]);
    assert.equal(args.path, dentro);
  });

  test('con el sandbox activo deja pasar rutas internas', () => {
    const cwd = path.resolve('workspace');
    const dentro = path.join(cwd, 'src', 'a.ts');
    const { args } = absolutizarRutas('read_file', { path: dentro }, () => cwd, true);
    assert.equal(args.path, dentro);
  });
});

describe('sandbox de workspace', () => {
  const cwd = path.resolve('workspace');

  test('dentroDelWorkspace distingue dentro, borde y fuera', () => {
    assert.equal(dentroDelWorkspace(cwd, cwd), true);
    assert.equal(dentroDelWorkspace(cwd, path.join(cwd, 'src', 'a.ts')), true);
    assert.equal(dentroDelWorkspace(cwd, path.join(cwd, '..', 'a.ts')), false);
    assert.equal(dentroDelWorkspace(cwd, path.resolve(cwd, '..')), false);
  });

  test('sanearEntorno quita credenciales y conserva el entorno básico', () => {
    const limpio = sanearEntorno({
      PATH: '/bin',
      HOME: '/home/u',
      SystemRoot: 'C:\\Windows',
      NODE_ENV: 'test',
      OPENAI_API_KEY: 'sk-x',
      GITHUB_TOKEN: 'ghp_x',
      AWS_SECRET_ACCESS_KEY: 'x',
      DB_PASSWORD: 'x',
      MY_API_KEY: 'x',
    });
    assert.deepEqual(Object.keys(limpio).sort(), ['HOME', 'NODE_ENV', 'PATH', 'SystemRoot'].sort());
  });

  test('sanearEntorno quita claves y tokens, pero conserva PATH', () => {
    const limpio = sanearEntorno({
      PATH: 'C:\\Windows',
      OPENCODE_API_KEY: 'sk-secreta',
      GITHUB_TOKEN: 'ghp_secreto',
      HOME: 'C:\\Users\\x',
    });

    assert.equal(limpio.PATH, 'C:\\Windows');
    assert.equal(limpio.HOME, 'C:\\Users\\x');
    assert.equal(limpio.OPENCODE_API_KEY, undefined);
    assert.equal(limpio.GITHUB_TOKEN, undefined);
  });

  test('conHooks corta la herramienta antes de ejecutarla', async () => {
    const falsa = {
      name: 'read_file',
      description: 'lee',
      parameters: { type: 'object', properties: {} },
      async execute() {
        return { content: 'no debería ejecutarse' };
      },
    };
    const envuelta = conHooks(falsa, {
      getCwd: () => cwd,
      getLimite: () => 16000,
      getRestringir: () => true,
    });
    await assert.rejects(() => envuelta.execute({ path: '../fuera.txt' }, {}), /fuera del workspace/);
  });
});

describe('aplicarReglasDeReescritura', () => {
  const reglas = [
    { name: 'sin rm', tool: 'run_command', field: 'command', pattern: '\\brm\\b', replacement: 'echo' },
    { name: 'cualquiera', field: 'path', pattern: 'secreto', replacement: 'publico' },
  ];

  test('aplica una regla a la herramienta que le toca', () => {
    const { args, notas } = aplicarReglasDeReescritura('run_command', { command: 'rm -rf build' }, reglas);
    assert.equal(args.command, 'echo -rf build');
    assert.equal(notas.length, 1);
  });

  test('ignora las reglas de otras herramientas', () => {
    const { args } = aplicarReglasDeReescritura('read_file', { command: 'rm -rf build' }, reglas);
    assert.equal(args.command, 'rm -rf build');
  });

  test('una regla sin herramienta se aplica a todas', () => {
    const { args } = aplicarReglasDeReescritura('read_file', { path: 'secreto.ts' }, reglas);
    assert.equal(args.path, 'publico.ts');
  });

  test('una expresión regular inválida se ignora sin romper', () => {
    const { args, notas } = aplicarReglasDeReescritura(
      'read_file',
      { path: 'a.ts' },
      [{ field: 'path', pattern: '([', replacement: 'x' }],
    );
    assert.equal(args.path, 'a.ts');
    assert.equal(notas.length, 0);
  });
});

describe('redactarSecretos', () => {
  const casos = [
    ['clave de OpenAI', 'OPENAI_KEY="sk-abcdefghijklmnopqrstuvwxyz123456"'],
    ['token de GitHub', 'const t = "ghp_1234567890abcdefghij1234567890abcdef";'],
    ['clave de AWS', 'AKIAIOSFODNN7EXAMPLE'],
    ['bearer', 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz123'],
  ];

  for (const [nombre, entrada] of casos) {
    test(`redacta ${nombre}`, () => {
      const { texto, encontrados } = redactarSecretos(entrada);
      assert.ok(encontrados.length > 0, 'debería detectar algo');
      assert.ok(!texto.includes('sk-abcdefghijklmnopqrstuvwxyz'), texto);
      assert.ok(!texto.includes('ghp_1234567890'), texto);
      assert.ok(!texto.includes('AKIAIOSFODNN7EXAMPLE'), texto);
      assert.ok(!texto.includes('abcdefghijklmnopqrstuvwxyz123'), texto);
    });
  }

  test('conserva la clave y tapa solo el valor en una asignación', () => {
    const { texto } = redactarSecretos('api_key = "abcdefghijklmnop1234"');
    assert.match(texto, /api_key/);
    assert.match(texto, /REDACTADO/);
    assert.ok(!texto.includes('abcdefghijklmnop1234'));
  });

  test('no toca un texto sin secretos', () => {
    const original = 'const nombre = "proyecto";';
    const { texto, encontrados } = redactarSecretos(original);
    assert.equal(texto, original);
    assert.equal(encontrados.length, 0);
  });
});

describe('conHooks', () => {
  test('absolutiza antes de ejecutar y avisa en el resultado', async () => {
    const falsa = {
      name: 'read_file',
      async execute(args) {
        return { content: `recibido: ${args.path}` };
      },
    };
    const envuelta = conHooks(falsa, { getCwd: () => '/proyecto', getLimite: () => 16000 });
    const resultado = await envuelta.execute({ path: 'a.ts' });
    assert.match(resultado.content, /recibido: .*a\.ts/);
    assert.match(resultado.content, /\[hooks\]/);
  });

  test('redacta secretos en la salida', async () => {
    const falsa = {
      name: 'read_file',
      async execute() {
        return { content: 'OPENAI_KEY="sk-abcdefghijklmnopqrstuvwxyz123456"' };
      },
    };
    const envuelta = conHooks(falsa, { getCwd: () => '/proyecto', getLimite: () => 16000 });
    const resultado = await envuelta.execute({});
    assert.match(resultado.content, /REDACTADO/);
    assert.ok(!resultado.content.includes('sk-abcdefghijklmnopqrstuvwxyz'));
  });

  test('guarda en disco lo que pasa del límite y devuelve un preview', async () => {
    const { dir, limpiar } = temporal('hooks');
    try {
      const falsa = {
        name: 'run_command',
        async execute() {
          return { content: 'x'.repeat(20000) };
        },
      };
      const envuelta = conHooks(falsa, { getCwd: () => dir, getLimite: () => 5000 });
      const resultado = await envuelta.execute({});

      assert.ok(resultado.content.length < 20000, 'debería recortarse');
      assert.match(resultado.content, /truncada/);

      const carpeta = path.join(dir, '.opengravity', 'tool-output');
      const ficheros = fs.readdirSync(carpeta);
      assert.equal(ficheros.length, 1);
      assert.equal(fs.statSync(path.join(carpeta, ficheros[0])).size, 20000);
    } finally {
      limpiar();
    }
  });

  test('un resultado corto y limpio pasa sin tocar', async () => {
    const falsa = {
      name: 'read_file',
      async execute() {
        return { content: 'contenido normal' };
      },
    };
    const envuelta = conHooks(falsa, { getCwd: () => '/proyecto', getLimite: () => 16000 });
    const resultado = await envuelta.execute({});
    assert.equal(resultado.content, 'contenido normal');
  });
});

describe('aplicarHooksDeTexto', () => {
  test('quita el marcado de tool-call filtrado', () => {
    const { texto, notas } = aplicarHooksDeTexto(
      'Voy a leerlo.\n<|tool_call|>{"name":"read_file"}<|/tool_call|>\nListo.',
    );
    assert.ok(!texto.includes('tool_call'));
    assert.match(texto, /Listo\./);
    assert.ok(notas.length > 0);
  });

  test('quita una frase de relleno inicial cuando se le pide', () => {
    const { texto } = aplicarHooksDeTexto('Como modelo de lenguaje, no puedo acceder. Aquí tienes el resultado.', {
      quitarRelleno: true,
    });
    assert.equal(texto, 'Aquí tienes el resultado.');
  });

  test('aplica reglas declarativas', () => {
    const { texto } = aplicarHooksDeTexto('La ruta es C:\\Users\\x\\src.', {
      reglas: [{ name: 'barras', scope: 'text', pattern: '\\\\', replacement: '/', flags: 'g' }],
    });
    assert.equal(texto, 'La ruta es C:/Users/x/src.');
  });

  test('no devuelve un mensaje vacío aunque las reglas se lo coman', () => {
    const original = 'Como modelo de lenguaje, no puedo acceder a eso.';
    const { texto } = aplicarHooksDeTexto(original, { quitarRelleno: true });
    assert.ok(texto.trim().length > 0, 'nunca debe quedar vacío');
    assert.equal(texto, original);
  });

  test('un texto limpio no genera notas', () => {
    const { texto, notas } = aplicarHooksDeTexto('Respuesta normal.');
    assert.equal(texto, 'Respuesta normal.');
    assert.equal(notas.length, 0);
  });
});

describe('aplicarHooksDeRazonamiento', () => {
  test('deja pasar un razonamiento corto', () => {
    const { texto, recortado } = aplicarHooksDeRazonamiento('pienso poco', { limite: 100 });
    assert.equal(texto, 'pienso poco');
    assert.equal(recortado, false);
  });

  test('recorta por encima del límite y lo dice', () => {
    const { texto, recortado } = aplicarHooksDeRazonamiento('x'.repeat(300), { limite: 100 });
    assert.equal(recortado, true);
    assert.ok(texto.length < 300);
    assert.match(texto, /recortado/);
  });
});
