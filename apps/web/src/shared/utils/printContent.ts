/**
 * Opens a new browser window with the given content formatted for printing,
 * then triggers the browser print dialog. Used for notes, letters, reports, etc.
 */
export function printContent(opts: {
  title: string;
  subtitle?: string;
  body: string;
}): void {
  const w = window.open('', '_blank');
  if (!w) return;
  const escaped = opts.body
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');
  w.document.write(`<html>
<head><title>${opts.title}</title>
<style>
  body { font-family: 'Albert Sans', Arial, sans-serif; margin: 40px; font-size: 13px; line-height: 1.7; color: #333; }
  h1 { font-size: 18px; margin-bottom: 4px; }
  .subtitle { font-size: 12px; color: #666; margin-bottom: 24px; }
  .body { white-space: pre-wrap; }
  @media print { body { margin: 20px; } }
</style></head>
<body>
  <h1>${opts.title}</h1>
  ${opts.subtitle ? `<div class="subtitle">${opts.subtitle}</div>` : ''}
  <div class="body">${escaped}</div>
</body></html>`);
  w.document.close();
  w.print();
}
