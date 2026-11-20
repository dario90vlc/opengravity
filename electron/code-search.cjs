'use strict';

/**
 * Herramienta `search_code`, compartida por la app y el CLI.
 *
 * El índice (`CodeIndex`) lo construye quien llama: la app ya lo tiene para el
 * editor y el CLI puede crear el suyo sin arrastrar Electron.
 */
function makeCodeSearchTool(codeIndex, getCwd) {
  return {
    name: 'search_code',
    description:
      'Busca en el índice del proyecto y devuelve los ficheros más relevantes con sus símbolos. ' +
      'Ordénalo por relevancia, no por texto literal. Úsalo antes de explorar a ciegas.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Qué buscas, en lenguaje natural o un nombre.' },
        mode: {
          type: 'string',
          description: 'symbol (nombres), lexical (palabras) o auto (híbrido).',
        },
        limit: { type: 'number', description: 'Máximo de resultados. Por defecto 10.' },
      },
      required: ['query'],
    },
    async execute(args, ctx) {
      const query = String(args.query ?? '').trim();
      if (query.length === 0) return { content: 'Consulta vacía.', isError: true };
      const base = ctx?.cwd ?? getCwd();

      if (codeIndex.size === 0 || codeIndex.root !== base) await codeIndex.build(base);
      if (codeIndex.root !== base) {
        return {
          content: 'El índice del proyecto aún se está construyendo. Inténtalo de nuevo en unos segundos.',
          isError: true,
        };
      }

      const mode = String(args.mode ?? 'auto');
      const limit = Math.min(30, Number(args.limit ?? 10));

      const results =
        mode === 'symbol'
          ? codeIndex.searchSymbols(query, limit)
          : codeIndex.searchLexical(query, limit);

      if (results.length === 0) {
        return { content: `Sin resultados para «${query}».` };
      }

      const lines = results.map((entry) => {
        if (mode === 'symbol') {
          return `${entry.file}:${entry.line} — ${entry.kind} ${entry.name}`;
        }
        const symbols = entry.symbols.length > 0 ? `\n    ${entry.symbols.join(', ')}` : '';
        return `${entry.file} (score ${entry.score})${symbols}`;
      });

      return { content: lines.join('\n') };
    },
  };
}

module.exports = { makeCodeSearchTool };
