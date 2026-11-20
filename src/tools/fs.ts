/**
 * Herramientas de sistema de ficheros.
 *
 * Mínimas y sin dependencias: leer, listar y escribir. Son las que necesita el
 * agente para trabajar sobre un repo. Las de shell/git llegarían aparte.
 */

import { access, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { defineTool } from './types.js';

/** Resuelve una ruta relativa contra el `cwd` del agente. */
function resolvePath(cwd: string, path: string): string {
  return resolve(cwd, path);
}

export const readFileTool = defineTool({
  name: 'read_file',
  description:
    'Lee un fichero de texto y devuelve su contenido. Usa rutas relativas al directorio de trabajo.\n' +
    'Para ficheros grandes, pide un rango con startLine/endLine en vez de leerlo entero: ' +
    'devuelve la cabecera con el total de líneas y el rango que has pedido. Cada línea ' +
    'lleva un prefijo `N | `; ese prefijo no forma parte del fichero, no lo copies a ' +
    'edit_file ni a multi_replace.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Ruta del fichero, relativa al directorio de trabajo.' },
      startLine: {
        type: 'number',
        description: 'Primera línea a devolver (1-based, incluida).',
      },
      endLine: {
        type: 'number',
        description: 'Última línea a devolver (1-based, incluida).',
      },
      maxBytes: {
        type: 'number',
        description: 'Máximo de bytes a devolver. Por defecto 200000.',
      },
      lineNumbers: {
        type: 'boolean',
        description:
          'Prefija cada línea con su número (por defecto true). Necesario para ' +
          'multi_replace, que trabaja con rangos de línea.',
      },
    },
    required: ['path'],
  },
  async execute(args, ctx) {
    const rawPath = args['path'] ?? args['Path'] ?? args['filePath'] ?? args['file_path'] ?? '';
    const path = String(rawPath);
    if (path.length === 0) {
      return { content: 'Falta el parámetro `path`.', isError: true };
    }

    const absolute = resolvePath(ctx.cwd, path);
    const maxBytesRaw = Number(args['maxBytes'] ?? args['MaxBytes'] ?? 200_000);
    if (!Number.isFinite(maxBytesRaw) || maxBytesRaw <= 0) {
      return { content: '`maxBytes` debe ser un número positivo.', isError: true };
    }
    const maxBytes = Math.floor(maxBytesRaw);

    const info = await stat(absolute);
    if (info.isDirectory()) {
      return { content: `${path} es un directorio, no un fichero.`, isError: true };
    }

    const content = await readFile(absolute, 'utf8');

    /*
     * Lectura paginada.
     *
     * Leer un fichero de 2 MB para devolver 200 KB gasta memoria y tiempo en cada
     * llamada, y el agente casi siempre quiere una zona concreta. Con un rango se
     * parte el fichero y se devuelve solo lo pedido, con el total para que sepa
     * cuánto queda.
     */
    const startLineRaw = args['startLine'] ?? args['StartLine'] ?? args['start_line'];
    const endLineRaw = args['endLine'] ?? args['EndLine'] ?? args['end_line'];
    const pideRango = startLineRaw !== undefined || endLineRaw !== undefined;
    const numerar = args['lineNumbers'] !== false;

    if (pideRango) {
      const lineas = content.split('\n');
      const total = lineas.length;
      const desdeRaw = startLineRaw === undefined ? 1 : Number(startLineRaw);
      const hastaRaw = endLineRaw === undefined ? null : Number(endLineRaw);
      if (!Number.isFinite(desdeRaw) || desdeRaw < 1 || (hastaRaw !== null && (!Number.isFinite(hastaRaw) || hastaRaw < 1))) {
        return { content: '`startLine` y `endLine` deben ser enteros positivos.', isError: true };
      }

      const desde = Math.max(1, Math.floor(desdeRaw));
      const hasta = Math.min(total, Math.floor(hastaRaw ?? desde + 199));
      if (hasta < desde) {
        return {
          content: `Rango vacío: startLine ${desde} es mayor que endLine ${hasta} (el fichero tiene ${total} líneas).`,
          isError: true,
        };
      }

      let trozo = lineas
        .slice(desde - 1, hasta)
        .map((linea, indice) => (numerar ? `${String(desde + indice).padStart(4)} | ${linea}` : linea))
        .join('\n');
      if (trozo.length > maxBytes) trozo = trozo.slice(0, maxBytes);

      return {
        content:
          `[${path}: líneas ${desde}-${hasta} de ${total}]\n` +
          trozo +
          (hasta < total ? `\n\n[quedan ${total - hasta} líneas; pide desde ${hasta + 1}]` : ''),
      };
    }

    const total = content.split('\n').length;
    const conNumeros = numerar
      ? content
          .split('\n')
          .map((linea, indice) => `${String(indice + 1).padStart(4)} | ${linea}`)
          .join('\n')
      : content;

    const truncated = conNumeros.length > maxBytes;
    const body = truncated ? conNumeros.slice(0, maxBytes) : conNumeros;
    const cabecera = numerar ? `[${path}: ${total} líneas]\n` : '';

    return {
      content: truncated
        ? `${cabecera}${body}\n\n[truncado: ${conNumeros.length} bytes totales, mostrados ${maxBytes}. ` +
          'Pide un rango con startLine/endLine para leer el resto.]'
        : `${cabecera}${body}`,
    };
  },
});

export const listDirectoryTool = defineTool({
  name: 'list_directory',
  description:
    'Lista el contenido de un directorio. Devuelve nombres con `/` al final si son directorios.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Ruta del directorio. Por defecto `.`.' },
    },
    required: [],
  },
  async execute(args, ctx) {
    const rawPath = args['path'] ?? args['Path'] ?? args['dirPath'] ?? args['dir_path'] ?? '.';
    const path = String(rawPath);
    const absolute = resolvePath(ctx.cwd, path);

    const entries = await readdir(absolute, { withFileTypes: true });
    const lines = entries
      .filter((entry) => entry.name !== 'node_modules' && entry.name !== '.git')
      .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
      .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name));

    /*
     * El comando que se muestra en la tarjeta de terminal tiene que ser real.
     *
     * Antigravity lista con PowerShell y su cabecera muestra la orden ejecutada
     * (`$ Get-ChildItem …`). Nosotros usamos una herramienta nativa, así que
     * mostrábamos `$ .`, que no dice nada. Se devuelve el comando equivalente
     * para que la interfaz enseñe exactamente lo mismo que la suya.
     */
    /*
     * Se muestra la orden en su forma corta, como la suya (`Get-ChildItem …`),
     * sin `-Path` cuando el directorio es el de trabajo. Listamos ficheros Y
     * carpetas —no solo ficheros como su `-File`— porque sin las carpetas el
     * agente no puede navegar; el comando refleja lo que de verdad se lista.
     */
    const enCwd = path === '.' || path === './' || path === absolute;
    const comando =
      process.platform === 'win32'
        ? enCwd
          ? 'Get-ChildItem -Name'
          : `Get-ChildItem -Path '${path}' -Name`
        : enCwd
          ? 'ls -1'
          : `ls -1 '${path}'`;

    return {
      content: lines.length > 0 ? lines.join('\n') : '(directorio vacío)',
      meta: { command: comando },
    };
  },
});

export const writeFileTool = defineTool({
  name: 'write_file',
  description:
    'Crea un fichero nuevo con el contenido indicado. Para un fichero que YA existe no sirve ' +
    'por defecto: usa `edit_file` (un fragmento) o `multi_replace` (varios tramos), que ' +
    'conservan el resto. Si de verdad quieres reescribirlo entero, pasa `overwrite: true`.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Ruta del fichero, relativa al directorio de trabajo.' },
      content: { type: 'string', description: 'Contenido completo a escribir.' },
      overwrite: {
        type: 'boolean',
        description: 'Reescribir un fichero que ya existe. Por defecto false.',
      },
    },
    required: ['path', 'content'],
  },
  async execute(args, ctx) {
    const rawPath = args['path'] ?? args['Path'] ?? args['filePath'] ?? args['file_path'] ?? '';
    const rawContent = args['content'] ?? args['Content'] ?? args['text'] ?? '';
    const path = String(rawPath);
    const content = String(rawContent);
    if (path.length === 0) {
      return { content: 'Falta el parámetro `path`.', isError: true };
    }

    const absolute = resolvePath(ctx.cwd, path);

    /*
     * Guarda de sobrescritura, como el `Overwrite` de su write_file.
     *
     * Medido: con 30 herramientas el agente elegía write_file para cambiar cuatro
     * líneas de un fichero existente, reescribiéndolo entero. Ninguna regla del
     * prompt lo cambió. Exigir `overwrite: true` lo hace determinista: o el modelo
     * lo pide a propósito, o tiene que usar edit_file / multi_replace.
     */
    const existe = await access(absolute).then(
      () => true,
      () => false,
    );

    const allowOverwrite = args['overwrite'] === true || args['Overwrite'] === true;
    if (existe && !allowOverwrite) {
      return {
        /*
         * El orden importa: se nombra `multi_replace` PRIMERO y la salida de
         * `overwrite` queda al final y sin receta explícita. Medido: con la
         * receta delante, el modelo repetía `write_file` con `overwrite: true`
         * en vez de cambiar de herramienta.
         */
        content:
          `${path} ya existe y no se sobrescribe por defecto. Si el cambio afecta a ` +
          'varios tramos del fichero, usa `multi_replace` (varios reemplazos en una ' +
          'llamada); si es un solo fragmento, `edit_file`. Las dos conservan el resto ' +
          'del fichero. Reescribirlo entero solo tiene sentido si de verdad cambia todo.',
        isError: true,
      };
    }

    await writeFile(absolute, content, 'utf8');

    return { content: `Escritos ${content.length} bytes en ${path}.` };
  },
});

/** Las tres herramientas de fichero, listas para registrar. */
export const fileSystemTools = [readFileTool, listDirectoryTool, writeFileTool];
