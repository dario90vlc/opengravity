'use strict';

/**
 * Montaje directo del workspace remoto con SSHFS-Win.
 *
 * `sshfs-win cmd` mantiene el proceso de montaje vivo y permite usar una clave
 * distinta de la predeterminada. Sin espejo: la app trabaja sobre la unidad.
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const SSHFS = 'C:\\Program Files\\SSHFS-Win\\bin\\sshfs-win.exe';
const montajes = new Map();

function disponible() {
  return process.platform === 'win32' && fs.existsSync(SSHFS);
}

function letraLibre() {
  return 'PQRSTUVWXYZ'.split('').find((letra) => !fs.existsSync(`${letra}:\\`)) ?? null;
}

async function montar(config) {
  if (!disponible()) return { ok: false, error: 'SSHFS-Win no está instalado (WinFsp + SSHFS-Win).' };
  const letra = letraLibre();
  if (!letra) return { ok: false, error: 'no hay letra de unidad libre' };
  if (!config.keyPath || !fs.existsSync(config.keyPath)) {
    return { ok: false, error: 'SSHFS directo necesita una clave privada válida' };
  }

  const opciones = [
    'cmd',
    '-o', `IdentityFile=${config.keyPath}`,
    '-o', 'StrictHostKeyChecking=accept-new',
    '-o', 'PreferredAuthentications=publickey',
    '-o', 'port=' + config.port,
    '-o', 'uid=-1',
    '-o', 'gid=-1',
    // El montaje remoto no debe quedar escribible por otras cuentas locales.
    '-o', 'umask=077',
    '-o', 'create_umask=077',
    `${config.user}@${config.host}:${config.remotePath}`,
    `${letra}:`,
  ];

  let stderr = '';
  const child = spawn(SSHFS, opciones, { windowsHide: true });
  child.stderr?.on('data', (data) => { stderr += data.toString(); });
  child.on('exit', () => {
    montajes.delete(`${letra}:`);
    if (fs.existsSync(`${letra}:\\`)) {
      try { require('node:child_process').execFileSync('net', ['use', `${letra}:`, '/delete', '/y'], { windowsHide: true }); } catch {}
    }
  });

  const inicio = Date.now();
  while (Date.now() - inicio < 12000) {
    if (fs.existsSync(`${letra}:\\`)) {
      montajes.set(`${letra}:`, child);
      return { ok: true, drive: `${letra}:`, path: `${letra}:\\` };
    }
    if (child.exitCode !== null) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  try { child.kill(); } catch {}
  return { ok: false, error: stderr.trim() || 'SSHFS no completó el montaje' };
}

async function desmontar(drive) {
  if (!drive) return { ok: true };
  const child = montajes.get(drive);
  montajes.delete(drive);
  try { child?.kill(); } catch {}
  try {
    require('node:child_process').execFileSync('net', ['use', drive, '/delete', '/y'], { windowsHide: true });
  } catch {}
  return { ok: true };
}

async function desmontarTodos() {
  for (const drive of [...montajes.keys()]) await desmontar(drive);
}

module.exports = { disponible, montar, desmontar, desmontarTodos };
