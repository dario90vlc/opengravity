'use strict';

/**
 * Índice de código.
 *
 * Tres capas, de más barata a más cara:
 *
 *   1. Símbolos  — extrae funciones, clases y tipos por lenguaje con regex.
 *                  Responde «dónde está X» en milisegundos.
 *   2. Léxico    — BM25 sobre los tokens de cada fichero. Ordena por relevancia,
 *                  no por orden alfabético como un grep.
 *   3. Embeddings — opcional. Reordena los mejores candidatos del léxico con
 *                  similitud semántica usando Ollama local.
 *
 * El índice se guarda en disco y se refresca por fecha de modificación.
 */

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const IGNORED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', '.next', '.cache', 'coverage',
  'target', 'bin', 'obj', '.venv', 'venv', '__pycache__', '.idea', '.vscode',
  'renderer/monaco',
]);

const BINARY_EXT = /\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|tar|exe|dll|so|dylib|node|woff2?|ttf|eot|mp[34]|wav|wasm|asar|lock)$/i;

const MAX_FILES = 2000;
const MAX_FILE_BYTES = 200_000;
const MAX_TOKENS_PER_FILE = 40_000;

/** Patrones de símbolos por familia de lenguaje. */
const SYMBOL_PATTERNS = [
  // function foo(...)  /  async function foo(...)
  { kind: 'function', re: /(?:^|\n)\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g },
  // const foo = (...) =>  /  const foo = function
  { kind: 'function', re: /(?:^|\n)\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/g },
  // class Foo
  { kind: 'class', re: /(?:^|\n)\s*(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/g },
  // interface Foo / type Foo =
  { kind: 'type', re: /(?:^|\n)\s*(?:export\s+)?(?:interface|type|enum)\s+([A-Za-z_$][\w$]*)/g },
  // def foo(...)  (Python)
  { kind: 'function', re: /(?:^|\n)\s*(?:async\s+)?def\s+([A-Za-z_][\w]*)\s*\(/g },
  // func foo(...)  (Go)
  { kind: 'function', re: /(?:^|\n)\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_][\w]*)\s*\(/g },
  // fn foo(...)  (Rust)
  { kind: 'function', re: /(?:^|\n)\s*(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_][\w]*)/g },
  // struct Foo / impl Foo  (Rust)
  { kind: 'class', re: /(?:^|\n)\s*(?:pub\s+)?(?:struct|impl|trait)\s+([A-Za-z_][\w]*)/g },
  // public/private ... foo(...) {  (Java/Kotlin/C#)
  { kind: 'function', re: /(?:^|\n)\s*(?:public|private|protected|static|internal|override|async|\s)*[\w<>[\]]+\s+([A-Za-z_][\w]*)\s*\([^;]*\)\s*\{/g },
];

/** Tokeniza: minúsculas, separa camelCase y snake_case. */
function tokenize(text) {
  const tokens = [];
  const words = text.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];

  for (const word of words) {
    if (word.length < 2) continue;
    tokens.push(word.toLowerCase());

    // camelCase → camel, case
    const parts = word.match(/[A-Z]?[a-z]+|[A-Z]+(?![a-z])/g);
    if (parts && parts.length > 1) {
      for (const part of parts) {
        if (part.length > 1) tokens.push(part.toLowerCase());
      }
    }
  }

  return tokens;
}

/** Extrae símbolos de un contenido. */
function extractSymbols(content) {
  const symbols = [];
  const lines = content.split('\n');

  for (const { kind, re } of SYMBOL_PATTERNS) {
    re.lastIndex = 0;
    let match;
    while ((match = re.exec(content)) !== null) {
      const name = match[1];
      if (!name || name.length < 2) continue;

      const line = content.slice(0, match.index).split('\n').length;
      symbols.push({ name, kind, line });
      if (symbols.length > 800) return symbols;
    }
  }

  // Elimina duplicados por nombre+línea.
  const seen = new Set();
  return symbols.filter((symbol) => {
    const key = `${symbol.name}:${symbol.line}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

class CodeIndex {
  constructor(options = {}) {
    this.root = options.root ?? process.cwd();
    this.files = new Map(); // relativePath -> { mtime, size, length, tf: Map, symbols }
    this.docFreq = new Map(); // term -> nº de ficheros que lo contienen
    this.totalLength = 0;
    this.builtAt = null;
    this.building = false;
    this.pendingRoot = null;
    this.embeddingCache = new Map(); // chunkId -> vector
  }

  /** Índice vacío. */
  clear() {
    this.files.clear();
    this.docFreq.clear();
    this.totalLength = 0;
    this.builtAt = null;
    this.embeddingCache.clear();
  }

  get size() {
    return this.files.size;
  }

  /** Recorre el proyecto y (re)indexa los ficheros que cambiaron. */
  async build(rootPath) {
    const root = path.resolve(rootPath ?? this.root);
    if (this.building) {
      // El caller cambió de proyecto mientras había un build en curso: se
      // encola el último y se ejecuta al terminar, en vez de perderlo.
      this.pendingRoot = root;
      return this.stats();
    }
    this.building = true;

    try {
      const found = [];
      await this.walk(root, 0, found, root);

      // Un índice de otro proyecto no sirve para reutilizar entradas: las
      // rutas relativas pueden coincidir y los contenidos no.
      const previousFiles = this.root === root ? this.files : new Map();
      const nextFiles = new Map();
      let totalLength = 0;
      const docFreq = new Map();

      // Reutiliza la entrada anterior si el fichero no ha cambiado.
      let reutilizados = 0;

      for (const relative of found) {
        const absolute = path.join(this.root, relative);

        let info;
        try {
          info = await fsp.stat(absolute);
        } catch {
          continue;
        }

        const anterior = previousFiles.get(relative);
        if (anterior && anterior.mtime === info.mtimeMs && anterior.size === info.size) {
          nextFiles.set(relative, anterior);
          totalLength += anterior.length;
          for (const term of anterior.tf.keys()) {
            docFreq.set(term, (docFreq.get(term) ?? 0) + 1);
          }
          reutilizados += 1;
          continue;
        }

        const previous = previousFiles.get(relative);
        let entry;

        // Reutiliza si no cambió.
        if (previous && previous.mtime === info.mtimeMs && previous.size === info.size) {
          entry = previous;
        } else {
          let content;
          try {
            content = await fsp.readFile(absolute, 'utf8');
          } catch {
            continue;
          }
          if (content.length > MAX_FILE_BYTES) continue;

          const tokens = tokenize(content).slice(0, MAX_TOKENS_PER_FILE);
          const tf = new Map();
          for (const token of tokens) tf.set(token, (tf.get(token) ?? 0) + 1);

          entry = {
            mtime: info.mtimeMs,
            size: info.size,
            length: tokens.length,
            tf,
            symbols: extractSymbols(content),
          };
        }

        nextFiles.set(relative, entry);
        totalLength += entry.length;
        for (const term of entry.tf.keys()) {
          docFreq.set(term, (docFreq.get(term) ?? 0) + 1);
        }
      }

      this.files = nextFiles;
      this.docFreq = docFreq;
      this.totalLength = totalLength;
      this.root = root;
      this.builtAt = Date.now();
      this.lastReused = reutilizados;
      this.references = null; // se reconstruyen bajo demanda

      return { ...this.stats(), reused: reutilizados };
    } finally {
      this.building = false;
      const pendiente = this.pendingRoot;
      this.pendingRoot = null;
      if (pendiente) {
        // No se await: el build llamador ya puede responder; el siguiente
        // reemplaza el índice cuando termine.
        void this.build(pendiente).catch(() => {});
      }
    }
  }

  async walk(directory, depth, out, root = this.root) {
    if (out.length >= MAX_FILES || depth > 8) return;

    let entries;
    try {
      entries = await fsp.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (out.length >= MAX_FILES) return;
      if (entry.name.startsWith('.') && entry.name !== '.env.example') continue;
      if (IGNORED_DIRS.has(entry.name)) continue;
      if (BINARY_EXT.test(entry.name)) continue;

      const absolute = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        await this.walk(absolute, depth + 1, out, root);
      } else if (entry.isFile()) {
        out.push(path.relative(root, absolute).split(path.sep).join('/'));
      }
    }
  }

  /** Busca símbolos por nombre. */
  /**
   * Usos reales de un identificador en un fichero TS/JS, con el parser de
   * TypeScript. A diferencia de una regex, no cuenta comentarios ni cadenas.
   * Devuelve `[{ line }]` o `null` si el fichero no es TS/JS.
   */
  findIdentifierUsages(file, name) {
    if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(file)) return null;

    let ts;
    try {
      ts = require('typescript');
    } catch {
      return null;
    }

    let contenido = this.files.get(file)?.content;
    if (!contenido) {
      try {
        contenido = fs.readFileSync(path.join(this.root, file), 'utf8');
      } catch {
        return null;
      }
    }

    const scriptKind = /\.tsx$/i.test(file)
      ? ts.ScriptKind.TSX
      : /\.(js|jsx|mjs|cjs)$/i.test(file)
        ? ts.ScriptKind.JS
        : ts.ScriptKind.TS;

    let fuente;
    try {
      fuente = ts.createSourceFile(file, contenido, ts.ScriptTarget.Latest, true, scriptKind);
    } catch {
      return null;
    }

    const usos = [];

    const visitar = (nodo) => {
      if (ts.isIdentifier(nodo) && nodo.text === name) {
        const { line } = fuente.getLineAndCharacterOfPosition(nodo.getStart(fuente));
        usos.push({ line: line + 1 });
      }
      ts.forEachChild(nodo, visitar);
    };

    visitar(fuente);
    return usos;
  }

  /**
   * Construye el mapa de referencias: qué símbolo aparece en qué ficheros.  /**
   * Construye el mapa de referencias: qué símbolo aparece en qué ficheros.
   *
   * Es un índice de texto, no de AST: busca el nombre del símbolo como palabra
   * completa en el contenido de los demás ficheros. Suficiente para responder
   * «¿dónde se usa esto?» sin un analizador por lenguaje.
   */
  buildReferences() {
    const refs = new Map();

    // Símbolos declarados: son los únicos que se buscan.
    const nombres = new Set();
    for (const [, entry] of this.files) {
      for (const symbol of entry.symbols ?? []) {
        if (symbol.name.length >= 3) nombres.add(symbol.name);
      }
    }

    if (nombres.size === 0) {
      this.references = refs;
      return 0;
    }

    // Una sola pasada por fichero: se parsea una vez y se recogen todos los
    // identificadores, en lugar de reparsear por cada nombre.
    for (const [file, entry] of this.files) {
      let contenido = entry.content;
      if (!contenido) {
        try {
          contenido = fs.readFileSync(path.join(this.root, file), 'utf8');
        } catch {
          continue;
        }
      }

      const encontrados = this.collectIdentifiers(file, contenido, nombres);

      for (const [nombre, lineas] of encontrados) {
        const lista = refs.get(nombre) ?? [];
        lista.push({ file, count: lineas.length, line: lineas[0], exact: this.isScript(file) });
        refs.set(nombre, lista);
      }
    }

    // Ordena los usos de cada símbolo por número de apariciones.
    for (const [nombre, lista] of refs) {
      lista.sort((a, b) => b.count - a.count);
      refs.set(nombre, lista.slice(0, 20));
    }

    this.references = refs;
    return refs.size;
  }

  /** ¿El fichero se puede analizar con el parser de TypeScript? */
  isScript(file) {
    return /\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(file);
  }

  /**
   * Identificadores de un fichero que coinciden con los nombres buscados.
   *
   * TS/JS se parsean: los comentarios y las cadenas quedan fuera. El resto de
   * lenguajes usan coincidencia de palabra completa sobre el texto.
   * Devuelve `Map<nombre, number[]>` con las líneas.
   */
  collectIdentifiers(file, contenido, nombres) {
    const salida = new Map();

    if (this.isScript(file)) {
      let ts;
      try {
        ts = require('typescript');
      } catch {
        ts = null;
      }

      if (ts) {
        const scriptKind = /\.tsx$/i.test(file)
          ? ts.ScriptKind.TSX
          : /\.(js|jsx|mjs|cjs)$/i.test(file)
            ? ts.ScriptKind.JS
            : ts.ScriptKind.TS;

        let fuente;
        try {
          fuente = ts.createSourceFile(file, contenido, ts.ScriptTarget.Latest, true, scriptKind);
        } catch {
          fuente = null;
        }

        if (fuente) {
          const visitar = (nodo) => {
            if (ts.isIdentifier(nodo) && nombres.has(nodo.text)) {
              const { line } = fuente.getLineAndCharacterOfPosition(nodo.getStart(fuente));
              const lineas = salida.get(nodo.text) ?? [];
              lineas.push(line + 1);
              salida.set(nodo.text, lineas);
            }
            ts.forEachChild(nodo, visitar);
          };
          visitar(fuente);
          return salida;
        }
      }
    }

    // Resto: una pasada por nombre sobre el texto.
    for (const nombre of nombres) {
      const patron = new RegExp(`\\b${nombre.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
      const lineas = [];
      let match;
      while ((match = patron.exec(contenido)) !== null) {
        lineas.push(contenido.slice(0, match.index).split('\n').length);
        if (lineas.length > 50) break;
      }
      if (lineas.length > 0) salida.set(nombre, lineas);
    }

    return salida;
  }

  /** Dónde se usa un símbolo. Devuelve [] si no está indexado. */
  findReferences(name, limit = 20) {
    if (!this.references) this.buildReferences();
    const usos = this.references.get(name) ?? [];
    return usos.slice(0, limit).map((uso) => ({ ...uso, symbol: name }));
  }

  searchSymbols(query, limit = 20) {
    const needle = query.toLowerCase();
    const results = [];

    for (const [file, entry] of this.files) {
      for (const symbol of entry.symbols) {
        if (!symbol.name.toLowerCase().includes(needle)) continue;
        results.push({ file, name: symbol.name, kind: symbol.kind, line: symbol.line, score: 100 });
        if (results.length > 400) break;
      }
    }

    return results
      .sort((a, b) => a.name.length - b.name.length || a.name.localeCompare(b.name))
      .slice(0, limit);
  }

  /**
   * Búsqueda léxica BM25.
   * Devuelve los ficheros ordenados por relevancia, con las líneas que coinciden.
   */
  searchLexical(query, limit = 20) {
    const terms = [...new Set(tokenize(query))];
    if (terms.length === 0 || this.files.size === 0) return [];

    const k1 = 1.2;
    const b = 0.75;
    const avgLength = this.totalLength / Math.max(1, this.files.size);

    const scored = [];

    for (const [file, entry] of this.files) {
      let score = 0;

      for (const term of terms) {
        const freq = entry.tf.get(term);
        if (!freq) continue;

        const df = this.docFreq.get(term) ?? 0;
        const idf = Math.log(1 + (this.files.size - df + 0.5) / (df + 0.5));
        const norm = 1 - b + b * (entry.length / Math.max(1, avgLength));
        score += idf * ((freq * (k1 + 1)) / (freq + k1 * norm));
      }

      // Bonus si un símbolo del fichero coincide con algún término.
      if (score > 0) {
        for (const symbol of entry.symbols) {
          const name = symbol.name.toLowerCase();
          if (terms.some((term) => name.includes(term))) {
            score += 2.5;
            break;
          }
        }
      }

      // Penaliza documentación cuando la consulta parece código.
      if (score > 0 && /\.(md|txt)$/i.test(file)) score *= 0.55;

      if (score > 0) scored.push({ file, score, entry });
    }

    scored.sort((a, b2) => b2.score - a.score);

    return scored.slice(0, limit).map((item) => ({
      file: item.file,
      score: Math.round(item.score * 100) / 100,
      symbols: item.entry.symbols.slice(0, 5).map((s) => `${s.kind} ${s.name} (L${s.line})`),
    }));
  }

  /**
   * Reordena candidatos combinando la señal léxica (BM25) con la semántica.
   *
   * El peso del embedding es configurable: con 0 devuelve el orden léxico,
   * con 1 se fía solo de la similitud. Por defecto 0.45, que en pruebas
   * mantiene la precisión del BM25 sin perder los aciertos semánticos.
   *
   * Si el proveedor de embeddings falla, devuelve los candidatos tal cual:
   * la búsqueda nunca empeora por no tener red.
   */
  async rerankWithEmbeddings(query, candidates, config = {}) {
    if (candidates.length < 2) return candidates;

    const weight = Number.isFinite(config.weight) ? Math.min(1, Math.max(0, config.weight)) : 0.45;

    try {
      const queryVector = await this.embed(query, config);
      if (!queryVector) return candidates;

      // Una sola llamada para todos los candidatos, no una por candidato.
      const textos = candidates.map((c) => `${c.file} ${(c.symbols ?? []).join(' ')}`);
      const vectores = await this.embedBatch(textos, config);

      const maxLexical = Math.max(...candidates.map((c) => c.score), 1);

      const reranked = candidates.map((candidate, index) => {
        const vector = vectores[index];
        const lexico = candidate.score / maxLexical;

        if (!vector) return { ...candidate, lexicalScore: candidate.score };

        const semantico = cosine(queryVector, vector);
        return {
          ...candidate,
          lexicalScore: candidate.score,
          semanticScore: Math.round(semantico * 1000) / 1000,
          score: Math.round((lexico * (1 - weight) + semantico * weight) * 1000) / 1000,
        };
      });

      return reranked.sort((a, b) => b.score - a.score);
    } catch {
      return candidates;
    }
  }

  /** Embeddings de varios textos, en una sola petición si el proveedor lo permite. */
  async embedBatch(texts, config) {
    const provider = config.provider ?? 'ollama';

    // OpenAI-compatible acepta un array y devuelve todos los vectores.
    if (provider === 'openai') {
      const pendientes = [];
      const indices = [];

      texts.forEach((text, index) => {
        const key = `${config.model}:${text.slice(0, 200)}`;
        const cached = this.embeddingCache.get(key);
        if (cached) return;
        pendientes.push(text);
        indices.push(index);
      });

      const resultados = texts.map((text) => {
        const key = `${config.model}:${text.slice(0, 200)}`;
        return this.embeddingCache.get(key) ?? null;
      });

      if (pendientes.length > 0) {
        try {
          const response = await fetch(`${config.url}/embeddings`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
            },
            body: JSON.stringify({ model: config.model, input: pendientes }),
            signal: AbortSignal.timeout(30000),
          });

          if (response.ok) {
            const payload = await response.json();
            const data = Array.isArray(payload.data) ? payload.data : [];
            for (let i = 0; i < data.length; i += 1) {
              const vector = data[i]?.embedding;
              const target = indices[i];
              if (!Array.isArray(vector) || target === undefined) continue;
              resultados[target] = vector;
              this.embeddingCache.set(`${config.model}:${pendientes[i].slice(0, 200)}`, vector);
            }
          }
        } catch {
          // sin red: se queda con lo que hubiera en caché
        }
      }

      return resultados;
    }

    // Ollama y Gemini no tienen lote cómodo: se piden de uno en uno.
    const out = [];
    for (const text of texts) out.push(await this.embed(text, config));
    return out;
  }

  /**
   * Vector de un texto. Acepta `{ url, model, provider, apiKey }`.
   * Por compatibilidad sigue aceptando `(text, url, model)`.
   */
  async embed(text, configOrUrl, legacyModel) {
    const config =
      typeof configOrUrl === 'string'
        ? { url: configOrUrl, model: legacyModel, provider: 'ollama' }
        : (configOrUrl ?? {});

    const model = config.model ?? 'nomic-embed-text';
    const provider = config.provider ?? 'ollama';
    const key = `${provider}:${model}:${text.slice(0, 200)}`;
    if (this.embeddingCache.has(key)) return this.embeddingCache.get(key);

    try {
      let vector = null;

      if (provider === 'gemini') {
        const response = await fetch(
          `${config.url}/models/${model}:embedContent?key=${encodeURIComponent(config.apiKey ?? '')}`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ content: { parts: [{ text }] } }),
            signal: AbortSignal.timeout(15000),
          },
        );
        if (response.ok) {
          const payload = await response.json();
          const values = payload.embedding?.values;
          if (Array.isArray(values)) vector = values;
        }
      } else if (provider === 'openai') {
        const response = await fetch(`${config.url}/embeddings`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
          },
          body: JSON.stringify({ model, input: text }),
          signal: AbortSignal.timeout(15000),
        });
        if (response.ok) {
          const payload = await response.json();
          const values = payload.data?.[0]?.embedding;
          if (Array.isArray(values)) vector = values;
        }
      } else {
        const response = await fetch(`${config.url}/api/embeddings`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ model, prompt: text }),
          signal: AbortSignal.timeout(15000),
        });
        if (response.ok) {
          const payload = await response.json();
          if (Array.isArray(payload.embedding)) vector = payload.embedding;
        }
      }

      if (vector) this.embeddingCache.set(key, vector);
      return vector;
    } catch {
      return null;
    }
  }

  /** Carga la caché de embeddings desde disco. */
  async loadEmbeddings(filePath) {
    try {
      const raw = await fsp.readFile(filePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        for (const [key, value] of Object.entries(parsed)) {
          if (Array.isArray(value)) this.embeddingCache.set(key, value);
        }
      }
      return this.embeddingCache.size;
    } catch {
      return 0;
    }
  }

  /** Guarda la caché de embeddings (máximo ~4000 entradas). */
  async saveEmbeddings(filePath) {
    try {
      const entries = [...this.embeddingCache.entries()].slice(-4000);
      await fsp.writeFile(filePath, JSON.stringify(Object.fromEntries(entries)), 'utf8');
      return entries.length;
    } catch {
      return 0;
    }
  }

  /** Texto representativo de un fichero para embeber. */
  chunkText(file, entry) {
    const symbols = entry.symbols
      .slice(0, 25)
      .map((symbol) => `${symbol.kind} ${symbol.name}`)
      .join(' ');
    const topTerms = [...entry.tf.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 60)
      .map(([term]) => term)
      .join(' ');

    return `${file}\n${symbols}\n${topTerms}`.slice(0, 1200);
  }

  /**
   * Precalcula embeddings de todos los ficheros del índice.
   * Usa `/api/embed` (lote) si está disponible y cae a `/api/embeddings`.
   */
  async warmEmbeddings(configOrUrl, modelOrLimit, maybeLimit = 300) {
    // Compatibilidad: (url, model, limit) o ({ url, model, provider }, limit)
    const config =
      typeof configOrUrl === 'string'
        ? { url: configOrUrl, model: modelOrLimit, provider: 'ollama' }
        : (configOrUrl ?? { url: 'http://127.0.0.1:11434', model: 'nomic-embed-text', provider: 'ollama' });

    const model = config.model ?? 'nomic-embed-text';
    const limit = typeof modelOrLimit === 'number' ? modelOrLimit : maybeLimit;

    // Con proveedores sin lote se delega en embed(), que cachea.
    if (config.provider && config.provider !== 'ollama') {
      const entries = [...this.files.entries()].slice(0, limit);
      let embedded = 0;
      let skipped = 0;

      for (const [file, entry] of entries) {
        const text = this.chunkText(file, entry);
        const key = `${config.provider}:${model}:${text.slice(0, 200)}`;
        if (this.embeddingCache.has(key)) {
          skipped += 1;
          continue;
        }
        const vector = await this.embed(text, config);
        if (vector) embedded += 1;
      }

      return { embedded, skipped, total: entries.length, provider: config.provider };
    }

    const ollamaUrl = config.url;
    const pending = [...this.files.entries()].slice(0, limit);
    let embedded = 0;
    let skipped = 0;

    // Lote: Ollama 0.3+ acepta { model, input: [...] }
    const batchSize = 16;

    for (let index = 0; index < pending.length; index += batchSize) {
      const batch = pending.slice(index, index + batchSize);

      const missing = batch.filter(([file, entry]) => {
        const key = `${model}:${this.chunkText(file, entry).slice(0, 200)}`;
        return !this.embeddingCache.has(key);
      });

      skipped += batch.length - missing.length;
      if (missing.length === 0) continue;

      const inputs = missing.map(([file, entry]) => this.chunkText(file, entry));

      try {
        const response = await fetch(`${ollamaUrl}/api/embed`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ model, input: inputs }),
          signal: AbortSignal.timeout(60000),
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const payload = await response.json();
        const vectors = payload.embeddings ?? [];

        if (Array.isArray(vectors) && vectors.length === missing.length) {
          missing.forEach(([file, entry], position) => {
            const key = `${model}:${this.chunkText(file, entry).slice(0, 200)}`;
            this.embeddingCache.set(key, vectors[position]);
            embedded += 1;
          });
          continue;
        }

        throw new Error('respuesta sin embeddings');
      } catch {
        // Sin lote: intenta uno a uno.
        for (const [file, entry] of missing) {
          const text = this.chunkText(file, entry);
          const vector = await this.embed(text, ollamaUrl, model);
          if (vector) embedded += 1;
          else skipped += 1;
        }
      }
    }

    return { embedded, skipped, cached: this.embeddingCache.size };
  }

  stats() {
    let symbols = 0;
    for (const entry of this.files.values()) symbols += entry.symbols.length;

    return {
      files: this.files.size,
      symbols,
      terms: this.docFreq.size,
      builtAt: this.builtAt,
      building: this.building,
    };
  }
}

/** Similitud coseno. */
function cosine(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const length = Math.min(a.length, b.length);

  for (let index = 0; index < length; index += 1) {
    dot += a[index] * b[index];
    na += a[index] * a[index];
    nb += b[index] * b[index];
  }

  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

module.exports = { CodeIndex, tokenize, extractSymbols };
