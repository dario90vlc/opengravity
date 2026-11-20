'use strict';

/**
 * Cliente LSP mínimo.
 *
 * Habla Language Server Protocol por stdio: JSON-RPC 2.0 con cabeceras
 * `Content-Length`, igual que MCP pero con framing distinto (MCP usa líneas).
 *
 * Cubre lo que necesita el editor: inicialización, apertura y cambios de
 * documento, diagnósticos, autocompletado e ir a definición.
 */

const { spawn } = require('node:child_process');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

/**
 * En Windows los lanzadores npm (`pyright-langserver`, `typescript-language-server`)
 * son `.cmd`: `spawn` no los ejecuta sin un shell. Se resuelve el shim y se
 * lanza con `cmd.exe`, citando cada argumento.
 */
function resolverShimWindows(comando) {
  if (process.platform !== 'win32') return null;
  const texto = String(comando);

  if (path.isAbsolute(texto)) {
    return /\.(cmd|bat)$/i.test(texto) ? texto : null;
  }

  const extensiones = ['.cmd', '.bat', '.exe', ''];
  for (const carpeta of String(process.env.PATH ?? '').split(path.delimiter)) {
    for (const extension of extensiones) {
      const candidato = path.join(carpeta, `${texto}${extension}`);
      if (!require('node:fs').existsSync(candidato)) continue;
      return /\.(cmd|bat)$/i.test(candidato) ? candidato : null;
    }
  }
  return null;
}

/** Cita un argumento para `cmd.exe /c`; las rutas con espacios son lo normal. */
function citarParaCmd(argumento) {
  const texto = String(argumento);
  return /[\s"&|<>^()%!]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
}

/** Arranca el servidor, atravesando el shim `.cmd` cuando haga falta. */
function lanzarServidor(comando, argumentos, cwd) {
  const shim = resolverShimWindows(comando);
  if (shim) {
    const linea = [shim, ...argumentos].map(citarParaCmd).join(' ');
    return spawn(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', linea], {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      windowsVerbatimArguments: true,
    });
  }
  return spawn(comando, argumentos, {
    cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
}

/** Comandos por defecto según el lenguaje. El usuario puede sobrescribirlos. */
const DEFAULT_SERVERS = {
  typescript: { command: 'typescript-language-server', args: ['--stdio'] },
  javascript: { command: 'typescript-language-server', args: ['--stdio'] },
  python: { command: 'pyright-langserver', args: ['--stdio'] },
  go: { command: 'gopls', args: [] },
  rust: { command: 'rust-analyzer', args: [] },
  json: { command: 'vscode-json-language-server', args: ['--stdio'] },
};

/** Lenguaje LSP a partir de la extensión del fichero. */
function languageForPath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.ts':
    case '.tsx':
    case '.mts':
    case '.cts':
      return 'typescript';
    case '.js':
    case '.jsx':
    case '.mjs':
    case '.cjs':
      return 'javascript';
    case '.py':
      return 'python';
    case '.go':
      return 'go';
    case '.rs':
      return 'rust';
    case '.json':
      return 'json';
    default:
      return null;
  }
}

/** Identificador de lenguaje para `textDocument`. */
function lspLanguageId(language) {
  return language === 'javascript' ? 'javascript' : language;
}

/**
 * Pyright publica `file:///c%3A/...` y Node genera `file:///C:/...`. Los mapas
 * de diagnósticos tienen que usar la misma clave o el editor se queda a cero.
 */
function normalizarUri(uri) {
  return String(uri).replace(
    /^file:\/\/\/([A-Za-z])(%3A|:)/i,
    (_todo, letra) => `file:///${String(letra).toLowerCase()}:`,
  );
}

class LspClient {
  constructor(options) {
    this.language = options.language;
    this.rootPath = options.rootPath;
    this.child = null;
    this.buffer = Buffer.alloc(0);
    this.nextId = 1;
    this.pending = new Map();
    this.opened = new Map(); // uri -> version
    this.textos = new Map(); // uri -> último buffer enviado al servidor
    this.diagnostics = new Map(); // uri -> diagnósticos
    this.ready = false;
    this.onDiagnostics = options.onDiagnostics ?? (() => {});
    this.onLog = options.onLog ?? (() => {});
  }

  /** Arranca el servidor y completa el handshake. */
  async start() {
    const { command, args } = this.serverCommand;
    this.child = lanzarServidor(command, args, this.rootPath);

    this.child.stdout.on('data', (chunk) => this.consume(chunk));
    this.child.stderr.on('data', (chunk) => this.onLog(String(chunk).slice(0, 400)));
    this.child.stdin?.on('error', () => {});

    // Sin esto, una petición en vuelo espera los 15 s aunque el servidor haya
    // muerto; el SIGKILL de OOM es el caso típico.
    const fallarPendientes = (motivo) => {
      for (const [, entry] of this.pending) {
        clearTimeout(entry.timer);
        entry.reject(new Error(motivo));
      }
      this.pending.clear();
    };

    this.child.on('error', (error) => {
      this.onLog(`no se pudo arrancar ${command}: ${error.message}`);
      this.ready = false;
      fallarPendientes(`servidor LSP no disponible: ${error.message}`);
    });

    this.child.on('exit', () => {
      this.ready = false;
      fallarPendientes('servidor LSP terminó');
    });

    const rootUri = pathToFileURL(this.rootPath).href;

    const result = await this.request('initialize', {
      processId: process.pid,
      rootUri,
      capabilities: {
        textDocument: {
          synchronization: { dynamicRegistration: false },
          completion: { completionItem: { snippetSupport: false } },
          hover: { contentFormat: ['plaintext', 'markdown'] },
          definition: {},
          codeAction: {
            codeActionLiteralSupport: {
              codeActionKind: {
                valueSet: [
                  'quickfix',
                  'refactor',
                  'refactor.extract',
                  'refactor.inline',
                  'source.fixAll',
                  'source.organizeImports',
                ],
              },
            },
          },
          publishDiagnostics: {},
        },
        workspace: { configuration: true, workspaceFolders: true },
      },
      workspaceFolders: [
        { uri: rootUri, name: path.basename(this.rootPath) },
      ],
    });

    this.ready = true;
    this.notify('initialized', {});
    return result;
  }

  get serverCommand() {
    return this.serverCommandOverride ?? DEFAULT_SERVERS[this.language] ?? null;
  }

  setServerCommand(override) {
    this.serverCommandOverride = override;
  }

  /** Abre un documento si no estaba abierto. */
  didOpen(uri, text) {
    if (this.opened.has(uri)) {
      this.didChange(uri, text);
      return;
    }
    this.opened.set(uri, 1);
    this.textos.set(uri, text);
    this.notify('textDocument/didOpen', {
      textDocument: {
        uri,
        languageId: lspLanguageId(this.language),
        version: 1,
        text,
      },
    });
  }

  /** Notifica un cambio de contenido. */
  didChange(uri, text) {
    const version = (this.opened.get(uri) ?? 0) + 1;
    this.opened.set(uri, version);
    this.textos.set(uri, text);
    this.notify('textDocument/didChange', {
      textDocument: { uri, version },
      contentChanges: [{ text }],
    });
  }

  /** Pide autocompletado en una posición. */
  completion(uri, line, character) {
    return this.request('textDocument/completion', {
      textDocument: { uri },
      position: { line, character },
    });
  }

  /** Pide ir a definición. */
  definition(uri, line, character) {
    return this.request('textDocument/definition', {
      textDocument: { uri },
      position: { line, character },
    });
  }

  /** Pide las acciones de código (quick fixes) para un rango. */
  codeAction(uri, rango, diagnosticos) {
    return this.request('textDocument/codeAction', {
      textDocument: { uri },
      range: rango,
      context: { diagnostics: diagnosticos ?? [] },
    });
  }

  /** Ejecuta un comando del servidor. */
  executeCommand(comando, argumentos) {
    return this.request('workspace/executeCommand', {
      command: comando,
      arguments: argumentos ?? [],
    });
  }

  /** Último texto que el servidor conoce para un documento abierto. */
  textoDe(uri) {
    return this.textos.get(uri);
  }

  /** Diagnósticos conocidos de un fichero. */
  diagnosticsFor(uri) {
    return this.diagnostics.get(normalizarUri(uri)) ?? this.diagnostics.get(uri) ?? [];
  }

  /** Envía una petición y espera respuesta. */
  request(method, params) {
    if (!this.child || this.child.killed) {
      return Promise.reject(new Error('servidor LSP no disponible'));
    }

    const id = this.nextId;
    this.nextId += 1;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`timeout en ${method}`));
      }, 15000);

      this.pending.set(id, { resolve, reject, timer });
      this.send({ jsonrpc: '2.0', id, method, params });
    });
  }

  /** Envía una notificación (sin respuesta). */
  notify(method, params) {
    if (!this.child || this.child.killed) return;
    this.send({ jsonrpc: '2.0', method, params });
  }

  /** Escribe un mensaje con el framing de LSP. */
  send(message) {
    const body = Buffer.from(JSON.stringify(message), 'utf8');
    const header = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'ascii');
    try {
      this.child.stdin.write(Buffer.concat([header, body]));
    } catch {
      // stdin cerrado
    }
  }

  /** Acumula bytes y procesa mensajes completos. */
  consume(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);

    while (true) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) return;

      const header = this.buffer.slice(0, headerEnd).toString('ascii');
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match) {
        this.buffer = this.buffer.slice(headerEnd + 4);
        continue;
      }

      const length = Number(match[1]);
      const bodyStart = headerEnd + 4;
      if (this.buffer.length < bodyStart + length) return;

      const body = this.buffer.slice(bodyStart, bodyStart + length).toString('utf8');
      this.buffer = this.buffer.slice(bodyStart + length);

      let message;
      try {
        message = JSON.parse(body);
      } catch {
        continue;
      }

      this.handle(message);
    }
  }

  handle(message) {
    if (message.id !== undefined && (message.result !== undefined || message.error !== undefined)) {
      const entry = this.pending.get(message.id);
      if (!entry) return;
      this.pending.delete(message.id);
      clearTimeout(entry.timer);
      if (message.error) entry.reject(new Error(message.error.message ?? 'error LSP'));
      else entry.resolve(message.result);
      return;
    }

    if (message.method === 'textDocument/publishDiagnostics') {
      const { uri, diagnostics } = message.params ?? {};
      this.diagnostics.set(normalizarUri(uri), diagnostics ?? []);
      this.onDiagnostics(uri, diagnostics ?? []);
      return;
    }

    /*
     * Peticiones del servidor. Pyright y rust-analyzer piden configuración al
     * arrancar; devolver null a secas puede dejarlos sin analizar el documento.
     */
    if (message.id !== undefined && message.method) {
      let result = null;
      if (message.method === 'workspace/configuration') {
        const items = Array.isArray(message.params?.items) ? message.params.items : [];
        result = items.map(() => ({}));
      } else if (message.method === 'workspace/workspaceFolders') {
        result = [
          {
            uri: pathToFileURL(this.rootPath).href,
            name: path.basename(this.rootPath),
          },
        ];
      } else if (message.method === 'window/showMessageRequest') {
        result = null;
      }
      this.send({ jsonrpc: '2.0', id: message.id, result });
    }
  }

  /** Cierra el servidor. */
  stop() {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error('servidor LSP cerrado'));
    }
    this.pending.clear();
    this.textos.clear();

    try {
      this.notify('shutdown', null);
      this.notify('exit', null);
    } catch {
      // ignorado
    }

    try {
      this.child?.kill();
    } catch {
      // ya cerrado
    }
    this.child = null;
    this.ready = false;
  }
}

module.exports = {
  normalizarUri,
  LspClient,
  languageForPath,
  DEFAULT_SERVERS,
  resolverShimWindows,
  citarParaCmd,
};
