// Hooks de herramienta: el mecanismo que Antigravity usa para reescribir los
// argumentos de una tool call antes de que corra y para sustituir su resultado
// después.
//
// Los suyos son arbitrarios (`pre_invocation_hook_names`). Aquí hay un conjunto
// concreto y útil, más reglas declarativas configurables desde Ajustes.

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const CARPETA_SALIDAS = '.opengravity/tool-output';

/** Herramientas cuyos argumentos de ruta conviene absolutizar. */
const CLAVES_DE_RUTA = {
  read_file: ['path'],
  write_file: ['path'],
  edit_file: ['path', 'target'],
  multi_replace: ['path'],
  edit_notebook: ['path'],
  list_directory: ['path'],
  search_files: ['path', 'directory'],
  file_search: ['path'],
  search_code: ['path'],
  view_code_item: ['path'],
  generate_image: ['path'],
  run_command: ['cwd'],
};

/** Resuelve symlinks/junctions del tramo existente de una ruta. */
function rutaReal(ruta) {
  let actual = path.resolve(ruta);
  const resto = [];

  while (true) {
    try {
      const real = fs.realpathSync.native(actual);
      return resto.length > 0 ? path.join(real, ...resto.reverse()) : real;
    } catch {
      const padre = path.dirname(actual);
      if (padre === actual) return path.resolve(ruta);
      resto.push(path.basename(actual));
      actual = padre;
    }
  }
}

/** ¿La ruta resuelta sigue dentro del workspace? */
function dentroDelWorkspace(cwd, absoluta) {
  const relativa = path.relative(cwd, absoluta);
  return relativa === '' || (relativa !== '..' && !relativa.startsWith(`..${path.sep}`) && !path.isAbsolute(relativa));
}

/** ¿La ruta está dentro del cwd o de alguna raíz añadida con `--add-dir`? */
function dentroDeRaices(cwd, raices, absoluta) {
  const real = rutaReal(absoluta);
  if (dentroDelWorkspace(rutaReal(cwd), real)) return true;
  return (Array.isArray(raices) ? raices : []).some((raiz) =>
    typeof raiz === 'string' && raiz.length > 0 &&
    dentroDelWorkspace(rutaReal(raiz), real),
  );
}

/**
 * Quita del entorno las variables que parecen credenciales.
 *
 * Es la parte de "entorno limpio" del sandbox: un comando no debe heredar la
 * clave del modelo, tokens de GitHub/Slack ni credenciales de la nube.
 */
const VARIABLE_SECRETA =
  /(api[_-]?key|secret|passw|credential|token|^aws_|^openai_|^anthropic_|^gemini_|^google_application_credentials$|^ssh_auth_sock$)/i;

function sanearEntorno(env) {
  const limpio = {};
  for (const [clave, valor] of Object.entries(env ?? {})) {
    if (VARIABLE_SECRETA.test(clave)) continue;
    limpio[clave] = valor;
  }
  return limpio;
}

/**
 * Pre-hook: convierte rutas relativas en absolutas respecto al workspace.
 *
 * Sin esto el agente falla con ENOENT cuando pasa una ruta relativa, y entonces
 * explora a ciegas gastando pasos. Se midió en una prueba real: 48 761 tokens
 * frente a 3 341 tras arreglar el directorio de trabajo.
 */
function absolutizarRutas(toolName, args, getCwd, restringir = false, getRoots) {
  const claves = CLAVES_DE_RUTA[toolName];
  if (!claves) return { args, notas: [] };

  const cwd = getCwd();
  if (!cwd) return { args, notas: [] };

  const nuevos = { ...args };
  const notas = [];

  // Las herramientas aceptan alias (`Path`, `filePath`…) por compatibilidad.
  // El sandbox y la tarjeta de diff solo miran la clave canónica, así que se
  // normaliza aquí antes de cualquier comprobación.
  const ALIAS = {
    path: ['Path', 'filePath', 'file_path'],
    target: ['Target'],
    directory: ['dirPath', 'dir_path'],
    cwd: ['Cwd'],
  };
  for (const clave of claves) {
    if (nuevos[clave] !== undefined) continue;
    const alias = (ALIAS[clave] ?? []).find((nombre) => typeof nuevos[nombre] === 'string');
    if (alias) nuevos[clave] = nuevos[alias];
  }

  for (const clave of claves) {
    const valor = nuevos[clave];
    if (typeof valor !== 'string' || valor.length === 0) continue;

    const absoluta = path.isAbsolute(valor) ? path.normalize(valor) : path.resolve(cwd, valor);

    /*
     * Sandbox de workspace (fase 1): las herramientas de fichero no pueden
     * salir del directorio de trabajo. Es una comprobación de ruta, no un
     * sandbox del SO: un comando de shell todavía puede salir por su cuenta.
     */
    if (restringir && !dentroDeRaices(cwd, getRoots?.(), absoluta)) {
      throw new Error(
        `La ruta «${valor}» queda fuera del workspace y el sandbox de workspace está activo.`,
      );
    }

    if (!path.isAbsolute(valor)) {
      nuevos[clave] = absoluta;
      notas.push(`${clave}: "${valor}" → ruta absoluta`);
    }
  }

  return { args: nuevos, notas };
}

/** Pre-hook: aplica las reglas de reescritura declaradas en Ajustes. */
function aplicarReglasDeReescritura(toolName, args, reglas) {
  if (!Array.isArray(reglas) || reglas.length === 0) return { args, notas: [] };

  const nuevos = { ...args };
  const notas = [];

  for (const regla of reglas) {
    if (!regla || typeof regla !== 'object') continue;
    if (regla.tool && regla.tool !== toolName) continue;

    const campo = String(regla.field ?? '');
    const valor = nuevos[campo];
    if (typeof valor !== 'string') continue;

    let patron;
    try {
      patron = new RegExp(String(regla.pattern ?? ''), String(regla.flags ?? 'g'));
    } catch {
      continue;
    }

    const antes = valor;
    const despues = valor.replace(patron, String(regla.replacement ?? ''));
    if (despues !== antes) {
      nuevos[campo] = despues;
      notas.push(`regla "${regla.name ?? regla.pattern}" reescribió ${campo}`);
    }
  }

  return { args: nuevos, notas };
}

// --- Post-hooks --------------------------------------------------------------

/** Patrones de secretos que se redactan en la salida de las herramientas. */
const PATRONES_SECRETO = [
  { nombre: 'clave de OpenAI', re: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
  { nombre: 'clave de Anthropic', re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g },
  { nombre: 'token de Google', re: /\bAIza[A-Za-z0-9_-]{35}\b/g },
  { nombre: 'token de GitHub', re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g },
  { nombre: 'clave de AWS', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { nombre: 'token de Slack', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { nombre: 'bearer', re: /\bBearer\s+[A-Za-z0-9._-]{20,}/g },
  {
    nombre: 'asignación de secreto',
    re: /\b(api[_-]?key|secret|password|passwd|token)\s*[:=]\s*["'][^"'\s]{12,}["']/gi,
  },
  {
    nombre: 'clave privada PEM',
    re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g,
  },
  {
    nombre: 'clave secreta AWS',
    re: /\b(?:aws_secret_access_key|AWS_SECRET_ACCESS_KEY)\s*[:=]\s*["']?[A-Za-z0-9/+=]{40}["']?/g,
  },
];

/**
 * Post-hook: redacta secretos evidentes en la salida.
 *
 * Evita que una credencial leída por accidente acabe en el historial de la
 * conversación y se reenvíe al proveedor del modelo en cada turno.
 */
function redactarSecretos(texto) {
  let resultado = texto;
  const encontrados = [];

  for (const patron of PATRONES_SECRETO) {
    patron.re.lastIndex = 0;
    if (!patron.re.test(resultado)) continue;
    patron.re.lastIndex = 0;
    resultado = resultado.replace(patron.re, (coincidencia) => {
      // En las asignaciones se conserva la clave y se tapa solo el valor.
      const asignacion = coincidencia.match(/^([^:=]+[:=]\s*["'])[^"'\s]{12,}(["'])$/);
      if (asignacion) return `${asignacion[1]}[REDACTADO]${asignacion[2]}`;
      return '[REDACTADO]';
    });
    encontrados.push(patron.nombre);
  }

  return { texto: resultado, encontrados };
}

/**
 * Post-hook: si la salida es enorme, la guarda en disco y devuelve un preview.
 *
 * Es el "truncado de salida a fichero con preview" del binario: el modelo ve lo
 * suficiente para decidir y puede pedir el resto con read_file si lo necesita.
 */
async function truncarAGuardar(texto, { toolName, getCwd, limite }) {
  if (texto.length <= limite) return null;

  const cwd = getCwd();
  if (!cwd) return null;

  const carpeta = path.join(cwd, CARPETA_SALIDAS);
  const marca = new Date().toISOString().replace(/[:.]/g, '-');
  const nombre = `${toolName}-${marca}.txt`;
  const destino = path.join(carpeta, nombre);

  try {
    await fsp.mkdir(carpeta, { recursive: true });
    await fsp.writeFile(destino, texto, 'utf8');
  } catch {
    return null;
  }

  const PREVIEW = 3000;
  const cabeza = texto.slice(0, PREVIEW);
  const relativo = path.relative(cwd, destino).split(path.sep).join('/');

  return {
    texto:
      `${cabeza}\n\n` +
      `… salida truncada: ${texto.length} caracteres en total, se muestran ${PREVIEW}.\n` +
      `El resto está en ${relativo}. Léelo con read_file (usa startLine/endLine) si lo necesitas.`,
    archivo: relativo,
  };
}

/**
 * Envuelve una herramienta con la cadena de hooks.
 *
 * Orden: pre-hooks reescriben los argumentos → se ejecuta lo de dentro → post-hooks
 * transforman el resultado. Al ir por fuera del monitor, este evalúa los argumentos
 * ya reescritos, que son los que de verdad se van a ejecutar.
 */
function conHooks(tool, opciones) {
  return {
    ...tool,
    async execute(args, ctx) {
      const getCwd = opciones.getCwd;
      const notas = [];

      // --- pre ---
      let actuales = args ?? {};
      const ruta = absolutizarRutas(
        tool.name,
        actuales,
        getCwd,
        opciones.getRestringir?.() === true,
        opciones.getRoots,
      );
      actuales = ruta.args;
      notas.push(...ruta.notas);

      const reglas = aplicarReglasDeReescritura(tool.name, actuales, opciones.getReglas?.());
      actuales = reglas.args;
      notas.push(...reglas.notas);

      const resultado = await tool.execute(actuales, ctx);
      if (!resultado || typeof resultado.content !== 'string') return resultado;

      // --- post ---
      let contenido = resultado.content;
      const avisos = [];

      const redaccion = redactarSecretos(contenido);
      if (redaccion.encontrados.length > 0) {
        contenido = redaccion.texto;
        avisos.push(`Se redactaron secretos (${redaccion.encontrados.join(', ')}).`);
      }

      const limite = Number(opciones.getLimite?.() ?? 16000);
      const truncado = await truncarAGuardar(contenido, {
        toolName: tool.name,
        getCwd,
        limite,
      });
      if (truncado) {
        contenido = truncado.texto;
        avisos.push('Resultado sustituido por un preview (el original se guardó en disco).');
      }

      if (notas.length > 0) avisos.push(`Hooks: ${notas.join('; ')}.`);

      if (avisos.length === 0) return resultado;

      return {
        ...resultado,
        content: `${contenido}\n\n[hooks] ${avisos.join(' ')}`,
      };
    },
  };
}

// --- Hooks sobre el texto del modelo -----------------------------------------
//
// Los hooks de herramienta actúan sobre argumentos y resultados. Estos actúan sobre
// lo que el modelo escribe: su respuesta visible y su razonamiento.

/** Restos de marcado de tool-call que algunos proveedores filtran como texto. */
const MARCAS_FILTRADAS = [
  /<\|?tool[_ ]?call\|?>[\s\S]*?(?:<\|?\/tool[_ ]?call\|?>|$)/gi,
  /<\|?function[_ ]?call\|?>[\s\S]*?(?:<\|?\/function[_ ]?call\|?>|$)/gi,
  /<\|?im_start\|?>|<\|?im_end\|?>/gi,
  /<\|?endoftext\|?>/gi,
];

/** Frases de relleno que varios modelos repiten al empezar. */
const RELLENO = [
  /^\s*(?:como (?:un )?(?:modelo|asistente|ia)[^\n.]*\.\s*)/i,
  /^\s*(?:as an ai(?: language model)?[^\n.]*\.\s*)/i,
  /^\s*(?:claro|por supuesto|desde luego)[,!]\s+(?=aqu[ií])/i,
];

/**
 * Aplica los hooks de texto a la respuesta del modelo.
 *
 * @param {string} texto
 * @param {object} opciones
 * @param {Array} [opciones.reglas]   reglas declarativas `{name, pattern, replacement, flags}`
 * @param {boolean} [opciones.limpiarMarcas]  quitar marcado de tool-call filtrado
 * @param {boolean} [opciones.quitarRelleno]  quitar frases de relleno iniciales
 * @returns {{ texto: string, notas: string[] }}
 */
function aplicarHooksDeTexto(texto, opciones = {}) {
  let resultado = String(texto ?? '');
  const notas = [];

  if (opciones.limpiarMarcas !== false) {
    for (const patron of MARCAS_FILTRADAS) {
      patron.lastIndex = 0;
      if (!patron.test(resultado)) continue;
      patron.lastIndex = 0;
      resultado = resultado.replace(patron, '');
      notas.push('se quitó marcado de tool-call filtrado');
    }
  }

  if (opciones.quitarRelleno === true) {
    for (const patron of RELLENO) {
      const antes = resultado;
      resultado = resultado.replace(patron, '');
      if (resultado !== antes) notas.push('se quitó una frase de relleno');
    }
  }

  for (const regla of Array.isArray(opciones.reglas) ? opciones.reglas : []) {
    if (!regla || typeof regla !== 'object') continue;
    if (regla.scope && regla.scope !== 'text') continue;

    let patron;
    try {
      patron = new RegExp(String(regla.pattern ?? ''), String(regla.flags ?? 'g'));
    } catch {
      continue;
    }

    const antes = resultado;
    resultado = resultado.replace(patron, String(regla.replacement ?? ''));
    if (resultado !== antes) {
      notas.push(`regla "${regla.name ?? regla.pattern}" reescribió la respuesta`);
    }
  }

  if (notas.length > 0) {
    resultado = resultado.replace(/\n{3,}/g, '\n\n').trim();
  }

  /*
   * Nunca se devuelve un mensaje vacío. Si las reglas se lo comieron entero (por
   * ejemplo, el modelo solo dijo la frase de relleno), se prefiere el original: una
   * burbuja vacía es peor que una frase sobrante.
   */
  if (resultado.trim().length === 0 && String(texto ?? '').trim().length > 0) {
    return { texto: String(texto), notas: [] };
  }

  return { texto: resultado, notas };
}

/**
 * Aplica los hooks al razonamiento.
 *
 * El razonamiento no se reescribe con reglas: se recorta para que un modelo que
 * divaga no infle la UI ni el historial.
 */
function aplicarHooksDeRazonamiento(texto, opciones = {}) {
  const bruto = String(texto ?? '');
  const limite = Number(opciones.limite ?? 20_000);

  if (bruto.length <= limite) return { texto: bruto, recortado: false };
  return {
    texto: `${bruto.slice(0, limite)}\n\n… razonamiento recortado (${bruto.length} caracteres)`,
    recortado: true,
  };
}

/**
 * Copia de una estructura con los secretos evidentes tapados.
 *
 * Para lo que se escribe en disco (argumentos de herramientas, pasos de
 * trayectoria, mensajes persistidos): una credencial que el agente escribió se
 * quedaría en claro en `userData` para siempre.
 */
function redactarDatos(valor) {
  try {
    const redaccion = redactarSecretos(JSON.stringify(valor));
    // El redactor devuelve { texto, encontrados }; aquí interesa el texto.
    return JSON.parse(typeof redaccion === 'string' ? redaccion : redaccion.texto);
  } catch {
    return valor;
  }
}

module.exports = {
  conHooks,
  absolutizarRutas,
  rutaReal,
  dentroDelWorkspace,
  dentroDeRaices,
  sanearEntorno,
  redactarSecretos,
  redactarDatos,
  truncarAGuardar,
  aplicarReglasDeReescritura,
  aplicarHooksDeTexto,
  aplicarHooksDeRazonamiento,
};
