'use strict';

/**
 * Workspace remoto en modo espejo.
 *
 * El agente, LSP, índice y git trabajan sobre una copia local del proyecto; un
 * watcher sube cada cambio por SFTP. Así las herramientas existentes siguen
 * siendo locales y el host remoto conserva los ficheros.
 */

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

class RemoteProject {
  constructor(workspace) {
    this.workspace = workspace;
    this.watcher = null;
    this.root = '';
    this.remoteRoot = '';
    this.pendientes = new Map();
    this.cerrado = false;
  }

  rutaEspejo(config, userDataPath) {
    const id = crypto
      .createHash('sha256')
      .update(`${config.user}@${config.host}:${config.port}${config.remotePath}`)
      .digest('hex')
      .slice(0, 16);
    return path.join(userDataPath, 'remote-workspaces', id);
  }

  async abrirExistente(config, userDataPath) {
    this.cerrar();
    const root = this.rutaEspejo(config, userDataPath);
    try {
      if (!(await fsp.stat(root)).isDirectory()) return null;
    } catch {
      return null;
    }
    this.root = root;
    this.remoteRoot = config.remotePath;
    this.cerrado = false;
    this.watcher = fs.watch(root, { recursive: true }, (_event, filename) => {
      if (!filename || this.cerrado) return;
      this.programar(String(filename).replace(/\\/g, '/'));
    });
    return { root, remoteRoot: config.remotePath };
  }

  async abrir(config, userDataPath) {
    this.cerrar();
    const root = this.rutaEspejo(config, userDataPath);
    await fsp.rm(root, { recursive: true, force: true });
    await fsp.mkdir(root, { recursive: true });

    await this.workspace.descargar(config.remotePath, root);
    this.root = root;
    this.remoteRoot = config.remotePath;
    this.cerrado = false;
    this.watcher = fs.watch(root, { recursive: true }, (_event, filename) => {
      if (!filename || this.cerrado) return;
      const relativo = String(filename).replace(/\\/g, '/');
      if (relativo.split('/').some((parte) => parte === 'node_modules')) return;
      this.programar(relativo);
    });
    return { root, remoteRoot: config.remotePath };
  }

  programar(relativo) {
    const anterior = this.pendientes.get(relativo);
    if (anterior) clearTimeout(anterior);
    this.pendientes.set(
      relativo,
      setTimeout(() => {
        this.pendientes.delete(relativo);
        void this.sincronizar(relativo);
      }, 250),
    );
  }

  async sincronizar(relativo) {
    if (!this.root || !this.remoteRoot || this.cerrado) return;
    const local = path.resolve(this.root, String(relativo));
    if (local !== this.root && !local.startsWith(this.root + path.sep)) return;
    const remoto = path.posix.join(this.remoteRoot, String(relativo));
    try {
      const info = await fsp.stat(local).catch(() => null);
      if (!info) {
        await this.workspace.unlink(remoto).catch(() => {});
        return;
      }
      if (info.isDirectory()) return;
      await this.workspace.subir(local, remoto);
    } catch (error) {
      console.error(`[remote] no se pudo sincronizar ${relativo}: ${error?.message ?? error}`);
    }
  }

  cerrar() {
    this.cerrado = true;
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    for (const timer of this.pendientes.values()) clearTimeout(timer);
    this.pendientes.clear();
    this.root = '';
    this.remoteRoot = '';
  }
}

module.exports = { RemoteProject };
