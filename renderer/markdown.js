'use strict';

/**
 * Renderizador de Markdown mínimo y seguro.
 *
 * Sin dependencias. Escapa el HTML primero, así que el texto del modelo nunca
 * puede inyectar etiquetas. Soporta lo que usa un chat de código:
 *
 *   - bloques de código ``` con lenguaje
 *   - código en línea `x`
 *   - negrita **x**, cursiva *x*, tachado ~~x~~
 *   - encabezados # ## ###
 *   - listas - / * / 1.
 *   - enlaces [texto](url)
 *   - reglas horizontales ---
 *   - párrafos y saltos de línea
 *
 * Se expone como `window.Markdown.render(text)`.
 */

(function () {
  /** Escapa los caracteres peligrosos de HTML. */
  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /** Deshace el escapado aplicado al principio, para re-tokenizar el código. */
  function unescapeHtml(text) {
    return String(text)
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&');
  }

  /** Aplica los estilos en línea (negrita, cursiva, código, enlaces). */
  function inline(text) {
    let out = text;

    // Código en línea primero: su contenido no debe procesarse más.
    const codeSlots = [];
    out = out.replace(/`([^`]+)`/g, (_match, code) => {
      codeSlots.push(`<code class="md-code">${code}</code>`);
      return `\u0000${codeSlots.length - 1}\u0000`;
    });

    // Negrita, cursiva, tachado.
    out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    out = out.replace(/~~([^~]+)~~/g, '<del>$1</del>');

    // Enlaces: solo http(s) y rutas relativas.
    out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_match, label, href) => {
      const safe = /^(https?:\/\/|file:\/\/|\/|#)/i.test(href) ? href : '#';
      return `<a href="${safe}" class="md-link">${label}</a>`;
    });

    // Restaura el código en línea.
    out = out.replace(/\u0000(\d+)\u0000/g, (_match, index) => codeSlots[Number(index)] ?? '');

    return out;
  }

  /**
   * Fórmulas: se extraen ANTES de escapar y se sustituyen al final.
   *
   * KaTeX devuelve HTML propio, así que no puede pasar por `escapeHtml`; y el
   * contenido de los bloques de código no debe convertirse, de ahí que el
   * patrón respete vallas e código en línea. `trust: false` impide que una
   * fórmula genere HTML a medida (`\href`, `\htmlClass`).
   */
  const MARCA_INICIO = '\uE000';
  const MARCA_FIN = '\uE001';

  function formulaAVista(tex, esBloque) {
    if (!window.katex || typeof window.katex.renderToString !== 'function') {
      return escapeHtml(esBloque ? `$$${tex}$$` : `$${tex}$`);
    }
    try {
      return window.katex.renderToString(tex, {
        displayMode: esBloque,
        throwOnError: false,
        trust: false,
        strict: 'ignore',
      });
    } catch {
      return escapeHtml(esBloque ? `$$${tex}$$` : `$${tex}$`);
    }
  }

  /** Sustituye fórmulas por marcas y devuelve también el HTML de cada una. */
  function extraerFormulas(texto) {
    const formulas = [];
    const marcador = (html) => {
      formulas.push(html);
      return `${MARCA_INICIO}${formulas.length - 1}${MARCA_FIN}`;
    };

    const patron =
      /(```[\s\S]*?```|`[^`\n]+`)|(\$\$[\s\S]+?\$\$)|(?<![\\$])\$(?!\s)([^$\n]+?)(?<!\s)\$/g;

    const conMarcas = texto.replace(patron, (todo, codigo, bloque, enLinea) => {
      if (codigo) return todo;
      if (bloque) return marcador(formulaAVista(bloque.slice(2, -2).trim(), true));
      if (enLinea) return marcador(formulaAVista(enLinea, false));
      return todo;
    });

    return { conMarcas, formulas };
  }

  /**
   * Convierte Markdown a HTML.
   * El texto de entrada se escapa antes de nada.
   */
  function render(markdown, opciones = {}) {
    const raw = String(markdown ?? '');
    // Normaliza encabezados pegados a texto previo sin salto de línea (ej: "texto.## Encabezado")
    const normalizado = raw.replace(/([^\n])\s*(#{1,4}\s+)/g, '$1\n\n$2');
    const { conMarcas, formulas } = extraerFormulas(normalizado);
    const source = escapeHtml(conMarcas).replace(/\r\n/g, '\n');
    const lines = source.split('\n');

    const html = [];
    let index = 0;

    const esSeparadorTabla = (s) =>
      Boolean(s) && /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)+\|?\s*$/.test(s);

    while (index < lines.length) {
      const line = lines[index] ?? '';

      // --- Bloque de código ---
      const fence = line.match(/^\s*```(\w*)\s*$/);
      if (fence) {
        const language = fence[1] ?? '';
        const body = [];
        index += 1;
        while (index < lines.length && !/^\s*```\s*$/.test(lines[index] ?? '')) {
          body.push(lines[index] ?? '');
          index += 1;
        }
        index += 1; // salta el cierre
        const cls = language ? ` class="language-${language}"` : '';
        // El documento ya viene escapado; se revierte para que el resaltador
        // vea las comillas y operadores reales.
        const source = unescapeHtml(body.join('\n'));
        // Durante streaming no se resalta: el tokenizador es costoso y el
        // bloque aún puede cambiar. Se hace cuando el mensaje termina.
        const highlighted =
          !opciones.streaming && window.Highlight && language
            ? window.Highlight.render(source, language)
            : escapeHtml(source);
        html.push(
          `<div class="md-pre"><div class="md-pre__lang">${language || 'texto'}</div>` +
            `<pre><code${cls}>${highlighted}</code></pre></div>`,
        );
        continue;
      }

      // --- Tabla (GFM: con o sin pipes en los bordes) ---
      const siguienteLinea = lines[index + 1] ?? '';
      if (line.includes('|') && esSeparadorTabla(siguienteLinea)) {
        const parseRow = (row) => {
          let r = row.trim();
          if (r.startsWith('|')) r = r.slice(1);
          if (r.endsWith('|')) r = r.slice(0, -1);
          return r.split('|').map((cell) => cell.trim());
        };

        const header = parseRow(line);
        index += 2; // cabecera + separador

        const rows = [];
        while (index < lines.length) {
          const current = lines[index] ?? '';
          if (current.trim().length === 0) break;
          if (!current.includes('|')) break;
          if (/^\s*```/.test(current) || /^(#{1,4})\s+/.test(current) || /^\s*---+\s*$/.test(current)) break;
          const cells = parseRow(current);
          while (cells.length < header.length) cells.push('');
          rows.push(cells);
          index += 1;
        }

        const thead = `<thead><tr>${header.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead>`;
        const tbody = `<tbody>${rows
          .map((cells) => `<tr>${cells.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`)
          .join('')}</tbody>`;

        html.push(`<div class="md-table-scroll"><table class="md-table">${thead}${tbody}</table></div>`);
        continue;
      }

      // --- Regla horizontal ---
      if (/^\s*---+\s*$/.test(line)) {
        html.push('<hr class="md-hr" />');
        index += 1;
        continue;
      }

      // --- Encabezados ---
      const heading = line.match(/^(#{1,4})\s+(.*)$/);
      if (heading) {
        const level = heading[1].length;
        html.push(`<h${level} class="md-h md-h${level}">${inline(heading[2])}</h${level}>`);
        index += 1;
        continue;
      }

      // --- Listas ---
      const bullet = line.match(/^\s*[-*+]\s+(.*)$/);
      const ordered = line.match(/^\s*\d+[.)]\s+(.*)$/);
      if (bullet || ordered) {
        const tag = bullet ? 'ul' : 'ol';
        const items = [];
        while (index < lines.length) {
          const current = lines[index] ?? '';
          const match = bullet ? current.match(/^\s*[-*+]\s+(.*)$/) : current.match(/^\s*\d+[.)]\s+(.*)$/);
          if (!match) break;
          items.push(`<li>${inline(match[1])}</li>`);
          index += 1;
        }
        html.push(`<${tag} class="md-list">${items.join('')}</${tag}>`);
        continue;
      }

      // --- Línea en blanco ---
      if (line.trim().length === 0) {
        index += 1;
        continue;
      }

      // --- Párrafo (hasta línea en blanco o bloque especial) ---
      const paragraph = [];
      while (index < lines.length) {
        const current = lines[index] ?? '';
        if (current.trim().length === 0) break;
        if (/^\s*```/.test(current)) break;
        if (/^(#{1,4})\s+/.test(current)) break;
        if (/^\s*[-*+]\s+/.test(current)) break;
        if (/^\s*\d+[.)]\s+/.test(current)) break;
        if (/^\s*---+\s*$/.test(current)) break;
        if (current.includes('|') && esSeparadorTabla(lines[index + 1] ?? '')) break;
        paragraph.push(inline(current));
        index += 1;
      }

      if (paragraph.length > 0) {
        html.push(`<p class="md-p">${paragraph.join('<br />')}</p>`);
      }
    }

    return html
      .join('')
      .replace(
        new RegExp(`${MARCA_INICIO}(\\d+)${MARCA_FIN}`, 'g'),
        (_todo, indice) => formulas[Number(indice)] ?? '',
      );
  }

  const Markdown = { render };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Markdown;
  }
  if (typeof window !== 'undefined') {
    window.Markdown = Markdown;
  }
})();
