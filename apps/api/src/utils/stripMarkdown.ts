/**
 * Strip markdown formatting from LLM output.
 *
 * LLMs default to markdown even when told not to.
 * This function cleans output for clinical documents that will be
 * printed, exported to PDF, or stored as plain text in the EMR.
 */

export function stripMarkdown(text: string): string {
  if (!text) return '';

  let result = text;

  // Remove bold: **text** or __text__
  result = result.replace(/\*\*(.+?)\*\*/g, '$1');
  result = result.replace(/__(.+?)__/g, '$1');

  // Remove italic: *text* or _text_ (but not bullet dashes or underscores in words)
  result = result.replace(/(?<!\w)\*([^*\n]+?)\*(?!\w)/g, '$1');
  result = result.replace(/(?<!\w)_([^_\n]+?)_(?!\w)/g, '$1');

  // Remove headings: ### Heading → HEADING
  result = result.replace(/^#{1,6}\s+(.+)$/gm, (_match, heading) => heading.toUpperCase());

  // Remove code blocks: ```lang\ncode\n``` → code
  result = result.replace(/```[\w]*\n?([\s\S]*?)```/g, '$1');

  // Remove inline code: `text` → text
  result = result.replace(/`([^`]+)`/g, '$1');

  // Remove blockquotes: > text → text
  result = result.replace(/^>\s?/gm, '');

  // Remove horizontal rules: --- or *** or ___
  result = result.replace(/^[-*_]{3,}\s*$/gm, '');

  // Convert markdown links: [text](url) → text
  result = result.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

  // Convert markdown images: ![alt](url) → [alt]
  result = result.replace(/!\[([^\]]*)\]\([^)]+\)/g, '[$1]');

  // Convert bullet markers: * item or + item → - item (standardise)
  result = result.replace(/^\s*[*+]\s/gm, '- ');

  // Remove excessive blank lines (max 2 consecutive)
  result = result.replace(/\n{3,}/g, '\n\n');

  return result.trim();
}

/**
 * Convert markdown to simple HTML for rich-text display.
 * Used when we WANT formatted output (e.g. in the AI chat panel).
 */
export function markdownToHtml(text: string): string {
  if (!text) return '';

  let html = escapeHtml(text);

  // Bold: **text** → <strong>text</strong>
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');

  // Italic: *text* → <em>text</em>
  html = html.replace(/(?<!\w)\*([^*\n]+?)\*(?!\w)/g, '<em>$1</em>');

  // Headings: ### text → <h3>text</h3>
  html = html.replace(/^######\s+(.+)$/gm, '<h6>$1</h6>');
  html = html.replace(/^#####\s+(.+)$/gm, '<h5>$1</h5>');
  html = html.replace(/^####\s+(.+)$/gm, '<h4>$1</h4>');
  html = html.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^#\s+(.+)$/gm, '<h1>$1</h1>');

  // Inline code: `code` → <code>code</code>
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Line breaks
  html = html.replace(/\n/g, '<br>');

  return html;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
