/**
 * Aislamiento de workspace para subagentes con `git worktree`.
 *
 * Un subagente que escribe comparte directorio con el padre y con sus hermanos:
 * dos que toquen el mismo fichero se pisan y nadie se entera. El blueprint de
 * Antigravity resuelve esto con tres modos — `inherit`, `branch` y `share` — y
 * `share` es el útil: un worktree tiene el mismo historial `.git` pero un
 * directorio de trabajo propio, y cuesta kilobytes en vez de una copia entera.
 *
 * Decisión: **no se fusiona solo**. Al terminar, si el subagente escribió, el
 * worktree se queda y se le dice al padre dónde está. Fusionar sin revisión un
 * cambio que el usuario no ha visto es justo lo que rompe lo que ya funcionaba.
 */

const { execFile } = require('node:child_process');
const { existsSync } = require('node:fs');
const { join } = require('node:path');

/** Ejecuta git y devuelve `{ ok, salida, error }`. Nunca lanza. */
function git(cwd, args) {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        resolve({ ok: false, salida: String(stdout ?? ''), error: String(stderr || error.message) });
        return;
      }
      resolve({ ok: true, salida: String(stdout ?? ''), error: '' });
    });
  });
}

/** ¿El directorio está dentro de un repositorio git con al menos un commit? */
async function esRepoGit(cwd) {
  const dentro = await git(cwd, ['rev-parse', '--is-inside-work-tree']);
  if (!dentro.ok || dentro.salida.trim() !== 'true') {
    return { ok: false, motivo: 'el directorio no es un repositorio git' };
  }

  // Un worktree necesita un commit del que partir; en un repo vacío no hay HEAD.
  const head = await git(cwd, ['rev-parse', '--verify', 'HEAD']);
  if (!head.ok) {
    return { ok: false, motivo: 'el repositorio no tiene ningún commit todavía' };
  }

  return { ok: true };
}

/** Nombre de rama seguro a partir de un nombre libre. */
function ramaDe(nombre) {
  const limpio = String(nombre ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `subagente-${limpio.length > 0 ? limpio : 'tarea'}`;
}

/**
 * Crea un worktree aislado.
 *
 * Devuelve `{ ok, ruta, rama }` o `{ ok: false, motivo }`. Si ya existe uno con
 * ese nombre se le añade un sufijo, para no chocar con una ejecución anterior.
 */
async function crear(cwd, nombre) {
  const comprobacion = await esRepoGit(cwd);
  if (!comprobacion.ok) return { ok: false, motivo: comprobacion.motivo };

  const base = ramaDe(nombre);
  const raiz = join(cwd, '.worktrees');

  let rama = base;
  let ruta = join(raiz, base);
  let intento = 2;
  while (existsSync(ruta)) {
    rama = `${base}-${intento}`;
    ruta = join(raiz, rama);
    intento += 1;
    if (intento > 20) return { ok: false, motivo: 'no encontré un nombre libre para el worktree' };
  }

  const alta = await git(cwd, ['worktree', 'add', '-b', rama, ruta, 'HEAD']);
  if (!alta.ok) {
    return { ok: false, motivo: `git worktree add falló: ${alta.error.trim().slice(0, 200)}` };
  }

  return { ok: true, ruta, rama, baseCwd: cwd };
}

/** ¿El subagente dejó cambios en su worktree? */
async function tieneCambios(ruta) {
  const estado = await git(ruta, ['status', '--porcelain']);
  if (!estado.ok) return false;
  return estado.salida.trim().length > 0;
}

/**
 * Cierra el worktree.
 *
 * Sin cambios se borra entero. Con cambios se queda: el padre recibe la ruta y
 * la rama para revisarlos, y se limpia cuando él decida.
 */
async function cerrar(cwd, { ruta, rama }) {
  if (!ruta) return { ok: true, conservado: false };

  const cambios = await tieneCambios(ruta);

  if (cambios) {
    return {
      ok: true,
      conservado: true,
      ruta,
      rama,
      nota:
        `El subagente dejó cambios en su worktree aislado.\n` +
        `Ruta: ${ruta}\nRama: ${rama}\n` +
        `Revísalos antes de fusionar; no se ha tocado tu rama de trabajo.`,
    };
  }

  /*
   * Un worktree limpio puede tener commits que solo viven en su rama. Borrar la
   * rama con `-D` los perdería sin aviso.
   */
  const cuenta = await git(cwd, ['rev-list', '--count', `HEAD..${rama}`]);
  const commits = Number(cuenta.salida.trim());
  if (cuenta.ok && Number.isFinite(commits) && commits > 0) {
    return {
      ok: true,
      conservado: true,
      ruta,
      rama,
      nota:
        `El subagente dejó ${commits} commit(s) en su worktree aislado.\n` +
        `Ruta: ${ruta}\nRama: ${rama}\n` +
        'Revísalos antes de fusionar; no se ha tocado tu rama de trabajo.',
    };
  }

  const baja = await git(cwd, ['worktree', 'remove', '--force', ruta]);
  // La rama queda aunque el worktree se vaya: es barata y evita perder trabajo.
  if (!baja.ok) {
    return { ok: false, motivo: `git worktree remove falló: ${baja.error.trim().slice(0, 200)}` };
  }

  await git(cwd, ['branch', '-D', rama]);

  return { ok: true, conservado: false };
}

/** Lista los worktrees vivos del proyecto. */
async function listar(cwd) {
  const r = await git(cwd, ['worktree', 'list', '--porcelain']);
  if (!r.ok) return [];
  return r.salida
    .split('\n')
    .filter((l) => l.startsWith('worktree '))
    .map((l) => l.slice('worktree '.length).trim())
    .filter((p) => p.length > 0);
}

module.exports = { esRepoGit, crear, cerrar, tieneCambios, listar, ramaDe, git };
