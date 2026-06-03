// apps/web/src/shared/utils/escapeHtml.ts
//
// HTML escaping for use in template literals rendered via document.write() / innerHTML.
// Prevents XSS from patient names, clinical content, and other user data.

const ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

const ESCAPE_REGEX = /[&<>"']/g;

/**
 * Escape HTML special characters in a string.
 * Use this whenever interpolating user data into HTML template literals.
 */
export function escapeHtml(str: string | null | undefined): string {
  if (!str) return '';
  return String(str).replace(ESCAPE_REGEX, (ch) => ESCAPE_MAP[ch] ?? ch);
}
