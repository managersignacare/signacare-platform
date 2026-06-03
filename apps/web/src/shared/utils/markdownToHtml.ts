/**
 * Lightweight Markdown → HTML converter for clinical text.
 * Handles: **bold**, *italic*, headings (#), lists (- / 1.), line breaks.
 * No external dependency needed.
 */

export function markdownToHtml(md: string): string {
  if (!md) return '';

  // Step 1: Extract and convert markdown tables BEFORE escaping HTML
  const tableRegex = /(?:^|\n)((?:\|[^\n]+\|\n)+)/g;
  const tables: { placeholder: string; html: string }[] = [];
  let tableIdx = 0;
  const processed = md.replace(tableRegex, (match) => {
    const rows = match.trim().split('\n').filter(r => r.trim());
    if (rows.length < 2) return match;

    // Check if row 2 is a separator (|---|---|)
    const isSeparator = (row: string) => /^\|[\s-:|]+\|$/.test(row.trim());
    const hasSep = rows.length >= 2 && isSeparator(rows[1]);
    const dataRows = hasSep ? [rows[0], ...rows.slice(2)] : rows;

    const parseCells = (row: string) =>
      row.split('|').slice(1, -1).map(c => c.trim());

    const headerCells = parseCells(dataRows[0]);
    const bodyRows = dataRows.slice(1);

    const thead = `<thead><tr>${headerCells.map(c => `<th>${escapeHtml(c)}</th>`).join('')}</tr></thead>`;
    const tbody = bodyRows.length
      ? `<tbody>${bodyRows.map(r => {
          const cells = parseCells(r);
          return `<tr>${cells.map(c => `<td>${formatCell(c)}</td>`).join('')}</tr>`;
        }).join('')}</tbody>`
      : '';

    const placeholder = `__TABLE_${tableIdx++}__`;
    tables.push({ placeholder, html: `<table>${thead}${tbody}</table>` });
    return `\n${placeholder}\n`;
  });

  let html = processed
    // Escape HTML entities (but not in table placeholders)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // UPPERCASE SECTION HEADINGS (clinical format: "SUBJECTIVE:", "PLAN:")
    .replace(/^([A-Z][A-Z\s/&()-]{2,}):(.*)$/gm, '&lt;h3&gt;$1&lt;/h3&gt;$2')
    // Markdown headings
    .replace(/^#### (.+)$/gm, '<h4>$1</h4>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    // Bold + Italic
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(?<!\w)\*([^*\n]+?)\*(?!\w)/g, '<em>$1</em>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // Unordered lists
    .replace(/^[-•] (.+)$/gm, '<li>$1</li>')
    // Ordered lists
    .replace(/^\d+[.)]\s+(.+)$/gm, '<li>$1</li>')
    // Horizontal rules
    .replace(/^[-*_]{3,}$/gm, '<hr/>')
    // Line breaks (double newline = paragraph, single = br)
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br/>');

  // Fix escaped heading tags
  html = html.replace(/&lt;(\/?)h([1-4])&gt;/g, '<$1h$2>');

  // Wrap consecutive <li> in <ul>
  html = html.replace(/(<li>.*?<\/li>)(?:<br\/>)?/g, '$1');
  html = html.replace(/((?:<li>.*?<\/li>)+)/g, '<ul>$1</ul>');

  html = `<p>${html}</p>`.replace(/<p><\/p>/g, '').replace(/<p><h/g, '<h').replace(/<\/h(\d)><\/p>/g, '</h$1>');

  // Restore tables
  for (const t of tables) {
    html = html.replace(new RegExp(`<p>.*?${t.placeholder}.*?</p>|${t.placeholder}`, 'g'), t.html);
  }

  return html;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatCell(cell: string): string {
  // Handle **bold** inside table cells
  return escapeHtml(cell).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

/**
 * Strip markdown formatting to plain text.
 * Used when copying to clipboard, exporting to PDF, or saving as clinical note.
 */
export function stripMarkdown(md: string): string {
  if (!md) return '';
  return md
    // Bold/italic
    .replace(/\*\*\*(.+?)\*\*\*/g, '$1')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/(?<!\w)\*([^*\n]+?)\*(?!\w)/g, '$1')
    // Headings → UPPERCASE
    .replace(/^#{1,6}\s+(.+)$/gm, (_m, h) => h.toUpperCase())
    // Code
    .replace(/```[\w]*\n?([\s\S]*?)```/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    // Blockquotes
    .replace(/^>\s?/gm, '')
    // Links
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // Images
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '[$1]')
    // HRs
    .replace(/^[-*_]{3,}\s*$/gm, '')
    // Standardise bullets
    .replace(/^\s*[*+]\s/gm, '- ')
    // Collapse blank lines
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
