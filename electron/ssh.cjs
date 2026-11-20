'use strict';

/**
 * Cliente SSH para el workspace remoto.
 *
 * `ssh2` se usa solo para SFTP; la terminal interactiva la abre el `ssh` del
 * sistema, que respeta known_hosts y el agente de claves del usuario.
 */

const fsp = require('node:fs/promises');
const path = require('node:path');
const { Client } = require('ssh2');

function configuracion(prefs) {
  const ssh = prefs?.ssh ?? {};
  const host = String(ssh.host ?? '').trim();
  const user = String(ssh.user ?? '').trim();
  if (!host || !user) throw new Error('configura host y usuario SSH');
  return {
    host,
    user,
    port: Math.max(1, Math.min(65535, Number(ssh.port ?? 22) || 22)),
    keyPath: String(ssh.keyPath ?? '').trim(),
    remotePath: String(ssh.remotePath ?? '').trim() || '/',
    password: String(ssh.password ?? ''),
    // Huella manual o la primera vista aceptada (TOFU persistido). Una cadena
    // vacía en `ssh.hostFingerprint` no debe ocultar la huella aprendida.
    hostFingerprint:
      String(ssh.hostFingerprint ?? '').trim() ||
      String(prefs?.sshTrusted?.[`${host}:${Number(ssh.port ?? 22) || 22}`] ?? '').trim(),
  };
}

class SshWorkspace {
  constructor() {
    this.client = null;
    this.sftp = null;
    this.conectando = null;
    this.firma = '';
    this.onHostKey = null;
  }

  /** Registra una huella nueva para persistirla (TOFU). */
  setOnHostKey(fn) {
    this.onHostKey = typeof fn === 'function' ? fn : null;
  }

  async conectar(config) {
    const cfg = configuracion({ ssh: config });
    const firma = JSON.stringify(cfg);
    if (this.client && this.firma === firma) return this;
    await this.cerrar();

    this.firma = firma;
    this.client = new Client();
    this.conectando = new Promise((resolve, reject) => {
      const client = this.client;
      client.once('ready', () => {
        client.sftp((error, sftp) => {
          if (error) reject(error);
          else {
            this.sftp = sftp;
            resolve(this);
          }
        });
      });
      client.once('error', reject);
      client.once('close', () => {
        if (this.client === client) {
          this.client = null;
          this.sftp = null;
          this.firma = '';
        }
      });

      const opciones = {
        host: cfg.host,
        port: cfg.port,
        username: cfg.user,
        readyTimeout: 12000,
        // TOFU: si el usuario fija una huella, se comprueba; si no, se acepta
        // la primera conexión. El terminal usa known_hosts del sistema.
        hostVerifier: (key) => {
          if (!cfg.hostFingerprint) return true;
          const crypto = require('node:crypto');
          const hash = crypto.createHash('sha256').update(key).digest('base64').replace(/=+$/, '');
          const esperada = cfg.hostFingerprint.replace(/^SHA256:/, '').replace(/=+$/, '');
          if (!esperada) {
            // Primera conexión: se confía y se guarda la huella. Las siguientes
            // se comparan contra ella; un MITM posterior no pasa.
            this.onHostKey?.(cfg.host, cfg.port, hash);
            return true;
          }
          return hash === esperada;
        },
      };
      if (cfg.keyPath) opciones.privateKey = require('node:fs').readFileSync(cfg.keyPath);
      if (cfg.password) opciones.password = cfg.password;
      client.connect(opciones);
    });

    try {
      return await this.conectando;
    } finally {
      this.conectando = null;
    }
  }

  async listar(remotePath) {
    if (!this.sftp) throw new Error('SSH no conectado');
    const base = String(remotePath || '/');
    const entries = await new Promise((resolve, reject) => {
      this.sftp.readdir(base, (error, list) => (error ? reject(error) : resolve(list)));
    });
    return entries.map((entry) => ({
      name: entry.filename,
      path: path.posix.join(base, entry.filename),
      directory: entry.attrs.isDirectory(),
      size: entry.attrs.size,
      mode: entry.attrs.mode,
    }));
  }

  async leer(remotePath) {
    if (!this.sftp) throw new Error('SSH no conectado');
    const info = await new Promise((resolve, reject) => {
      this.sftp.stat(remotePath, (error, attrs) => (error ? reject(error) : resolve(attrs)));
    });
    if (info.size > 2_000_000) throw new Error('fichero remoto demasiado grande (máx. 2 MB)');
    const data = await new Promise((resolve, reject) => {
      this.sftp.readFile(remotePath, (error, buffer) => (error ? reject(error) : resolve(buffer)));
    });
    return data.toString('utf8');
  }

  async escribir(remotePath, content) {
    if (!this.sftp) throw new Error('SSH no conectado');
    await new Promise((resolve, reject) => {
      this.sftp.writeFile(remotePath, String(content ?? ''), (error) => (error ? reject(error) : resolve()));
    });
    return { ok: true, path: remotePath };
  }

  async mkdir(remotePath) {
    if (!this.sftp) throw new Error('SSH no conectado');
    await new Promise((resolve, reject) => {
      this.sftp.mkdir(remotePath, { mode: 0o755 }, (error) => {
        // Ya existe: no es un fallo para el mirror.
        if (error && error.code !== 4) reject(error);
        else resolve();
      });
    });
  }

  async mkdirp(remotePath) {
    const partes = String(remotePath).split('/').filter(Boolean);
    let actual = remotePath.startsWith('/') ? '/' : '';
    for (const parte of partes) {
      actual = actual === '/' ? `/${parte}` : `${actual}/${parte}`;
      await this.mkdir(actual);
    }
  }

  async unlink(remotePath) {
    if (!this.sftp) throw new Error('SSH no conectado');
    await new Promise((resolve, reject) => {
      this.sftp.unlink(remotePath, (error) => (error ? reject(error) : resolve()));
    });
  }

  async rmdir(remotePath) {
    if (!this.sftp) throw new Error('SSH no conectado');
    await new Promise((resolve, reject) => {
      this.sftp.rmdir(remotePath, (error) => (error ? reject(error) : resolve()));
    });
  }

  async subir(localPath, remotePath) {
    if (!this.sftp) throw new Error('SSH no conectado');
    await this.mkdirp(path.posix.dirname(remotePath));
    await new Promise((resolve, reject) => {
      this.sftp.fastPut(localPath, remotePath, (error) => (error ? reject(error) : resolve()));
    });
    return { ok: true, path: remotePath };
  }

  async descargar(remotePath, localPath, opciones = {}) {
    if (!this.sftp) throw new Error('SSH no conectado');
    const omitir = new Set(opciones.omitir ?? ['node_modules', '.venv', 'venv', 'dist', 'build', '.next', '.cache']);
    const maxBytes = Number(opciones.maxBytes ?? 200 * 1024 * 1024);
    const maxFiles = Number(opciones.maxFiles ?? 12000);
    let bytes = 0;
    let files = 0;

    const bajar = async (remoto, local) => {
      const lista = await this.listar(remoto);
      await fsp.mkdir(local, { recursive: true });
      for (const entrada of lista) {
        if (omitir.has(entrada.name)) continue;
        // Un servidor SFTP hostil puede devolver `../` como nombre.
        if (
          typeof entrada.name !== 'string' ||
          entrada.name === '.' ||
          entrada.name === '..' ||
          /[\\/]/.test(entrada.name)
        ) {
          throw new Error(`nombre remoto no válido: ${String(entrada.name).slice(0, 80)}`);
        }
        const destino = path.resolve(local, entrada.name);
        if (destino !== local && !destino.startsWith(local + path.sep)) {
          throw new Error(`ruta remota fuera del espejo: ${entrada.name}`);
        }
        if (entrada.directory) {
          await bajar(entrada.path, destino);
          continue;
        }
        if (files >= maxFiles) throw new Error(`demasiados ficheros remotos (${maxFiles})`);
        if (bytes + entrada.size > maxBytes) throw new Error('workspace remoto demasiado grande (200 MB)');
        await new Promise((resolve, reject) => {
          this.sftp.fastGet(entrada.path, destino, (error) => (error ? reject(error) : resolve()));
        });
        bytes += entrada.size;
        files += 1;
        opciones.onProgress?.({ files, bytes, path: entrada.path });
      }
    };

    await bajar(remotePath, localPath);
    return { ok: true, files, bytes };
  }

  async exec(command, cwd, timeoutMs = 30000) {
    if (!this.client) throw new Error('SSH no conectado');
    const base = String(cwd || '/').replace(/'/g, "'\\''");
    const linea = `cd '${base}' && ${String(command)}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout SSH')), timeoutMs);
      this.client.exec(linea, (error, stream) => {
        if (error) {
          clearTimeout(timer);
          reject(error);
          return;
        }
        let stdout = '';
        let stderr = '';
        stream.on('data', (d) => { stdout += d.toString(); });
        stream.stderr.on('data', (d) => { stderr += d.toString(); });
        stream.on('close', (code) => {
          clearTimeout(timer);
          resolve({ code, stdout, stderr });
        });
      });
    });
  }

  async cerrar() {
    if (this.client) {
      this.client.end();
      this.client = null;
      this.sftp = null;
      this.firma = '';
    }
  }
}

const workspace = new SshWorkspace();

module.exports = { SshWorkspace, configuracion, workspace };
