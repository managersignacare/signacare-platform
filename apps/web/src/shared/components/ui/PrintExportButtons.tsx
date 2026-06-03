import React from 'react';
import { Box, Button, IconButton, Menu, MenuItem, Tooltip, ListItemIcon, ListItemText, Divider } from '@mui/material';
import PrintIcon from '@mui/icons-material/Print';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import { markdownToHtml, stripMarkdown } from '../../utils/markdownToHtml';
import { escapeHtml } from '../../utils/escapeHtml';

interface PrintExportProps {
  /** Content to print/export — can be markdown, HTML, or plain text */
  content: string;
  /** Title shown at top of printed document */
  title?: string;
  /** Subtitle (e.g. patient name, date) */
  subtitle?: string;
  /** Whether content contains markdown */
  isMarkdown?: boolean;
  /** Whether content is already HTML */
  isHtml?: boolean;
  /** Compact mode — show as icon button with dropdown */
  compact?: boolean;
  /** Additional metadata rows for header */
  meta?: Record<string, string>;
}

function buildPrintHtml(opts: { title: string; subtitle?: string; body: string; meta?: Record<string, string> }): string {
  const metaRows = opts.meta ? Object.entries(opts.meta).map(([k, v]) =>
    `<tr><td style="padding:3px 16px 3px 0;font-weight:600;color:#3D484B;font-size:13px;white-space:nowrap">${escapeHtml(k)}:</td><td style="padding:3px 0;color:#555;font-size:13px">${escapeHtml(v)}</td></tr>`
  ).join('') : '';

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(opts.title)}</title>
<style>
  @media print { @page { margin: 20mm; } body { margin: 0; } .no-print { display: none !important; } }
  body { font-family: 'Segoe UI', 'Helvetica Neue', Arial, sans-serif; color: #333; max-width: 800px; margin: 0 auto; padding: 24px; line-height: 1.6; }
  h1 { color: #3D484B; font-size: 20px; margin: 0 0 4px; border-bottom: 3px solid #327C8D; padding-bottom: 8px; }
  h2 { color: #327C8D; font-size: 16px; margin: 20px 0 8px; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
  h3 { color: #3D484B; font-size: 14px; margin: 16px 0 6px; }
  h4 { color: #555; font-size: 13px; margin: 12px 0 4px; }
  p { margin: 0 0 8px; font-size: 13px; }
  ul, ol { margin: 4px 0 8px 20px; padding: 0; font-size: 13px; }
  li { margin: 2px 0; }
  strong { color: #3D484B; }
  hr { border: none; border-top: 1px solid #ddd; margin: 16px 0; }
  table { border-collapse: collapse; }
  .meta { margin: 12px 0 20px; padding: 12px; border: 1px solid #eee; border-radius: 4px; background: #FAFAFA; }
  .subtitle { color: #888; font-size: 12px; margin: 0 0 8px; }
  .footer { margin-top: 32px; border-top: 1px solid #ddd; padding-top: 8px; font-size: 10px; color: #aaa; text-align: center; }
</style></head><body>
<h1>${opts.title}</h1>
${opts.subtitle ? `<div class="subtitle">${opts.subtitle}</div>` : ''}
${metaRows ? `<div class="meta"><table>${metaRows}</table></div>` : ''}
${opts.body}
<div class="footer">Signacare — Confidential Clinical Document — Printed ${new Date().toLocaleString('en-AU')}</div>
</body></html>`;
}

export function PrintExportButtons({ content, title = 'Clinical Document', subtitle, isMarkdown = true, isHtml, compact, meta }: PrintExportProps) {
  const [anchorEl, setAnchorEl] = React.useState<HTMLElement | null>(null);
  const [copied, setCopied] = React.useState(false);

  const htmlBody = isHtml ? content : isMarkdown ? markdownToHtml(content) : `<div style="white-space:pre-wrap;font-size:13px;">${content}</div>`;
  const plainText = isMarkdown ? stripMarkdown(content) : content.replace(/<[^>]*>/g, '');

  const handlePrint = () => {
    setAnchorEl(null);
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(buildPrintHtml({ title, subtitle, body: htmlBody, meta }));
    win.document.close();
    setTimeout(() => win.print(), 300);
  };

  const handlePdf = () => {
    setAnchorEl(null);
    // PDF via print dialog (Save as PDF)
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(buildPrintHtml({ title, subtitle, body: htmlBody, meta }));
    win.document.close();
    setTimeout(() => win.print(), 300);
  };

  const handleCopyText = () => {
    navigator.clipboard.writeText(plainText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    setAnchorEl(null);
  };

  const handleCopyHtml = () => {
    const blob = new Blob([htmlBody], { type: 'text/html' });
    const item = new ClipboardItem({ 'text/html': blob, 'text/plain': new Blob([plainText], { type: 'text/plain' }) });
    navigator.clipboard.write([item]).catch(() => navigator.clipboard.writeText(plainText));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    setAnchorEl(null);
  };

  const handleDownloadHtml = () => {
    setAnchorEl(null);
    const fullHtml = buildPrintHtml({ title, subtitle, body: htmlBody, meta });
    const blob = new Blob([fullHtml], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title.replace(/[^a-zA-Z0-9]/g, '_')}_${new Date().toISOString().split('T')[0]}.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (compact) {
    return (
      <>
        <Tooltip title="Print / Export">
          <IconButton size="small" aria-label="Print or export" onClick={e => setAnchorEl(e.currentTarget)} sx={{ color: 'text.secondary' }}>
            <MoreVertIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Tooltip>
        <Menu anchorEl={anchorEl} open={!!anchorEl} onClose={() => setAnchorEl(null)} slotProps={{ paper: { sx: { minWidth: 180 } } }}>
          <MenuItem onClick={handlePrint}><ListItemIcon><PrintIcon fontSize="small" /></ListItemIcon><ListItemText>Print</ListItemText></MenuItem>
          <MenuItem onClick={handlePdf}><ListItemIcon><PictureAsPdfIcon fontSize="small" /></ListItemIcon><ListItemText>Save as PDF</ListItemText></MenuItem>
          <Divider />
          <MenuItem onClick={handleCopyText}><ListItemIcon><ContentCopyIcon fontSize="small" /></ListItemIcon><ListItemText>{copied ? 'Copied!' : 'Copy Text'}</ListItemText></MenuItem>
          <MenuItem onClick={handleCopyHtml}><ListItemIcon><ContentCopyIcon fontSize="small" /></ListItemIcon><ListItemText>Copy Formatted</ListItemText></MenuItem>
          <Divider />
          <MenuItem onClick={handleDownloadHtml}><ListItemIcon><FileDownloadIcon fontSize="small" /></ListItemIcon><ListItemText>Download HTML</ListItemText></MenuItem>
        </Menu>
      </>
    );
  }

  return (
    <Box sx={{ display: 'flex', gap: 0.5 }}>
      <Tooltip title="Print"><Button size="small" startIcon={<PrintIcon sx={{ fontSize: 14 }} />} onClick={handlePrint} sx={{ fontSize: 11, color: '#3D484B', textTransform: 'none' }}>Print</Button></Tooltip>
      <Tooltip title="Save as PDF (via print dialog)"><Button size="small" startIcon={<PictureAsPdfIcon sx={{ fontSize: 14 }} />} onClick={handlePdf} sx={{ fontSize: 11, color: '#D32F2F', textTransform: 'none' }}>PDF</Button></Tooltip>
      <Tooltip title="Copy to clipboard"><Button size="small" startIcon={<ContentCopyIcon sx={{ fontSize: 14 }} />} onClick={handleCopyText} sx={{ fontSize: 11, color: '#327C8D', textTransform: 'none' }}>{copied ? 'Copied!' : 'Copy'}</Button></Tooltip>
    </Box>
  );
}
