import { escapeHtml } from './escapeHtml';

interface OpenInNewWindowOptions {
  title: string;
  subtitle?: string;
  content: string;
  /** If true, content is already HTML. If false, render as preformatted text. */
  isHtml?: boolean;
  meta?: Record<string, string>;
}

/**
 * Opens content in a new formatted browser window for viewing/printing.
 * Used for notes, letters, reports, and any clinical content.
 */
export function openInNewWindow({ title, subtitle, content, isHtml, meta }: OpenInNewWindowOptions): void {
  const w = window.open('', '_blank');
  if (!w) return;

  const metaRows = meta
    ? Object.entries(meta)
        .filter(([, v]) => v)
        .map(([k, v]) => `<tr><td style="font-weight:600;padding:2px 12px 2px 0;color:#555">${escapeHtml(k)}</td><td style="padding:2px 0">${escapeHtml(v)}</td></tr>`)
        .join('')
    : '';

  const contentHtml = isHtml
    ? content
    : `<pre style="white-space:pre-wrap;word-wrap:break-word;font-family:inherit;font-size:inherit;line-height:1.6;margin:0">${escapeHtml(content)}</pre>`;

  w.document.write(`<!DOCTYPE html><html><head><title>${escapeHtml(title)}</title>
<style>
  body { font-family: 'Segoe UI', 'Albert Sans', sans-serif; font-size: 11pt; margin: 0; padding: 24px 32px; color: #222; max-width: 900px; margin: 0 auto; transition: font-size 0.2s; }
  .header { border-bottom: 2px solid #327C8D; padding-bottom: 8px; margin-bottom: 16px; }
  .title { font-size: 16pt; font-weight: 700; color: #327C8D; margin: 0; }
  .subtitle { font-size: 10pt; color: #666; margin-top: 4px; }
  .meta-table { font-size: 10pt; margin-bottom: 16px; border-collapse: collapse; }
  .content-box { padding: 16px; background: #FAFAFA; border: 1px solid #E0E0E0; border-radius: 6px; min-height: 200px; font-size: inherit; }
  .toolbar { display: flex; gap: 8px; margin-bottom: 12px; align-items: center; flex-wrap: wrap; }
  .toolbar button { padding: 6px 16px; border: 1px solid #327C8D; background: #fff; color: #327C8D; border-radius: 4px; cursor: pointer; font-size: 10pt; }
  .toolbar button:hover { background: #327C8D; color: #fff; }
  .toolbar .font-group { display: flex; gap: 2px; margin-left: auto; border: 1px solid #ddd; border-radius: 4px; overflow: hidden; }
  .toolbar .font-btn { padding: 5px 12px; border: none; background: #fff; color: #555; cursor: pointer; font-weight: 600; border-right: 1px solid #eee; }
  .toolbar .font-btn:last-child { border-right: none; }
  .toolbar .font-btn:hover { background: #E0F2F1; }
  .toolbar .font-btn.active { background: #327C8D; color: #fff; }
  .font-label { font-size: 9pt; color: #999; margin-right: 4px; }
  .footer { margin-top: 16px; border-top: 1px solid #E0E0E0; padding-top: 8px; font-size: 9pt; color: #999; }
  @media print { .toolbar { display: none; } body { padding: 12mm; } }
</style></head><body>
<div class="header">
  <div class="title">${escapeHtml(title)}</div>
  ${subtitle ? `<div class="subtitle">${escapeHtml(subtitle)}</div>` : ''}
</div>
${metaRows ? `<table class="meta-table">${metaRows}</table>` : ''}
<div class="toolbar">
  <button onclick="window.print()">Print</button>
  <button onclick="window.close()">Close</button>
  <div class="font-group">
    <span class="font-label" style="padding:5px 4px">Font:</span>
    <button class="font-btn" onclick="setFontSize(9, this)" title="Small">A<sup style='font-size:7px'>-</sup></button>
    <button class="font-btn active" onclick="setFontSize(11, this)" title="Normal">A</button>
    <button class="font-btn" onclick="setFontSize(14, this)" title="Large">A<sup style='font-size:9px'>+</sup></button>
    <button class="font-btn" onclick="setFontSize(18, this)" title="Extra Large">A<sup style='font-size:10px'>++</sup></button>
  </div>
</div>
<div class="content-box">${contentHtml}</div>
<div class="footer">Opened: ${new Date().toLocaleString('en-AU')} | Signacare EMR</div>
<script>
  function setFontSize(pt, btn) {
    document.body.style.fontSize = pt + 'pt';
    var all = document.querySelectorAll('.font-btn');
    for (var i = 0; i < all.length; i++) { all[i].classList.remove('active'); }
    btn.classList.add('active');
  }
</script>
</body></html>`);
  w.document.close();
  w.focus();
}

/** Channel used to notify parent when a note is saved in a child window */
export const NOTE_SAVED_CHANNEL = 'signacare-note-saved';

interface OpenEditableOptions {
  title: string;
  subtitle?: string;
  content: string;
  meta?: Record<string, string>;
  /** Full PATCH URL for saving, e.g. '/api/v1/patients/{pid}/notes/{nid}' */
  patchUrl: string;
}

/**
 * Opens a note in a new browser window with an editable textarea.
 * Save Draft and Save & Sign buttons call the API directly via fetch.
 * On success, broadcasts via BroadcastChannel so the parent can refresh.
 */
export function openEditableInNewWindow({ title, subtitle, content, meta, patchUrl }: OpenEditableOptions): void {
  const w = window.open('', '_blank');
  if (!w) return;

  const metaRows = meta
    ? Object.entries(meta)
        .filter(([, v]) => v)
        .map(([k, v]) => `<tr><td style="font-weight:600;padding:2px 12px 2px 0;color:#555">${escapeHtml(k)}</td><td style="padding:2px 0">${escapeHtml(v)}</td></tr>`)
        .join('')
    : '';

  // Escape content for embedding in a textarea (HTML entities inside <textarea> are rendered as text)
  const escapedContent = escapeHtml(content);

  w.document.write(`<!DOCTYPE html><html><head><title>Edit: ${escapeHtml(title)}</title>
<style>
  body { font-family: 'Segoe UI', 'Albert Sans', sans-serif; font-size: 11pt; margin: 0; padding: 24px 32px; color: #222; max-width: 900px; margin: 0 auto; }
  .header { border-bottom: 2px solid #b8621a; padding-bottom: 8px; margin-bottom: 16px; }
  .title { font-size: 16pt; font-weight: 700; color: #b8621a; margin: 0; }
  .draft-badge { display: inline-block; background: #FFF3E0; color: #E65100; padding: 2px 8px; border-radius: 4px; font-size: 10pt; font-weight: 600; margin-left: 8px; }
  .subtitle { font-size: 10pt; color: #666; margin-top: 4px; }
  .meta-table { font-size: 10pt; margin-bottom: 16px; border-collapse: collapse; }
  .editor { width: 100%; min-height: 400px; padding: 12px; font-family: 'Courier New', monospace; font-size: 12pt; line-height: 1.6; border: 2px solid #E0E0E0; border-radius: 6px; resize: vertical; box-sizing: border-box; }
  .editor:focus { border-color: #327C8D; outline: none; }
  .toolbar { display: flex; gap: 8px; margin: 16px 0; }
  .btn { padding: 8px 20px; border: none; border-radius: 4px; cursor: pointer; font-size: 11pt; font-weight: 600; }
  .btn-draft { background: #fff; border: 2px solid #327C8D; color: #327C8D; }
  .btn-draft:hover { background: #E0F2F1; }
  .btn-sign { background: #b8621a; color: #fff; }
  .btn-sign:hover { background: #d6741f; }
  .btn-cancel { background: #f5f5f5; color: #666; border: 1px solid #ddd; }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .status-msg { margin-top: 8px; padding: 8px 12px; border-radius: 4px; font-size: 11pt; }
  .status-success { background: #E8F5E9; color: #2E7D32; }
  .status-error { background: #FDECEA; color: #D32F2F; }
  .footer { margin-top: 16px; border-top: 1px solid #E0E0E0; padding-top: 8px; font-size: 9pt; color: #999; }
</style></head><body>
<div class="header">
  <span class="title">${escapeHtml(title)}</span><span class="draft-badge">DRAFT</span>
  ${subtitle ? `<div class="subtitle">${escapeHtml(subtitle)}</div>` : ''}
</div>
${metaRows ? `<table class="meta-table">${metaRows}</table>` : ''}
<textarea id="editor" class="editor">${escapedContent}</textarea>
<div class="toolbar">
  <button class="btn btn-cancel" onclick="window.close()">Cancel</button>
  <button class="btn btn-draft" id="btnDraft" onclick="saveNote('draft')">Save Draft</button>
  <button class="btn btn-sign" id="btnSign" onclick="saveNote('signed')">Save & Sign</button>
</div>
<div id="statusMsg"></div>
<div class="footer">Editing: ${new Date().toLocaleString('en-AU')} | Signacare EMR</div>
<script>
  var patchUrl = ${JSON.stringify(patchUrl)};

  async function saveNote(status) {
    var editor = document.getElementById('editor');
    var btnDraft = document.getElementById('btnDraft');
    var btnSign = document.getElementById('btnSign');
    var statusMsg = document.getElementById('statusMsg');
    var content = editor.value;

    btnDraft.disabled = true;
    btnSign.disabled = true;
    statusMsg.className = '';
    statusMsg.textContent = 'Saving...';

    try {
      var body = { content: content };
      if (status === 'signed') body.status = 'signed';
      var resp = await fetch(patchUrl, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': '1' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      if (!resp.ok) {
        var errData = await resp.json().catch(function() { return {}; });
        throw new Error(errData.error || 'HTTP ' + resp.status);
      }
      statusMsg.className = 'status-msg status-success';
      statusMsg.textContent = status === 'signed' ? 'Note signed successfully.' : 'Draft saved.';

      // Notify parent window to refresh
      try {
        var ch = new BroadcastChannel('${NOTE_SAVED_CHANNEL}');
        ch.postMessage({ action: 'note-saved', status: status });
        ch.close();
      } catch(e) { /* BroadcastChannel not supported */ }

      if (status === 'signed') {
        editor.disabled = true;
        btnDraft.style.display = 'none';
        btnSign.style.display = 'none';
        document.querySelector('.draft-badge').textContent = 'SIGNED';
        document.querySelector('.draft-badge').style.background = '#E8F5E9';
        document.querySelector('.draft-badge').style.color = '#2E7D32';
      }
    } catch (err) {
      statusMsg.className = 'status-msg status-error';
      statusMsg.textContent = 'Failed: ' + err.message;
    } finally {
      btnDraft.disabled = false;
      btnSign.disabled = false;
    }
  }
</script>
</body></html>`);
  w.document.close();
  w.focus();
}
