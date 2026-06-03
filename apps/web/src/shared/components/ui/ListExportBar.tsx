/**
 * ListExportBar — Drop-in export/print toolbar for any list or table.
 *
 * Usage:
 *   <ListExportBar
 *     title="Patient List"
 *     columns={['UR', 'Name', 'DOB', 'Team', 'Clinician']}
 *     rows={patients.map(p => [p.urNumber, `${p.familyName}, ${p.givenName}`, p.dob, p.team, p.clinician])}
 *   />
 *
 * For notes/documents (non-tabular), use PrintExportButtons instead.
 */
import React, { useCallback } from 'react';
import { escapeHtml } from '../../utils/escapeHtml';
import { Box, Button, IconButton, Menu, MenuItem, ListItemIcon, ListItemText, Divider, Tooltip } from '@mui/material';
import PrintIcon from '@mui/icons-material/Print';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import TableChartIcon from '@mui/icons-material/TableChart';

interface ListExportBarProps {
  /** Document title for print header */
  title: string;
  /** Optional subtitle (date range, filters applied, etc.) */
  subtitle?: string;
  /** Column headers */
  columns: string[];
  /** Row data — each row is an array of cell values matching columns */
  rows: (string | number | null | undefined)[][];
  /** Compact mode — single icon button with dropdown */
  compact?: boolean;
  /** Optional extra metadata for the print header */
  meta?: Record<string, string>;
}

function escapeCsv(val: string | number | null | undefined): string {
  const s = String(val ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function buildCsv(columns: string[], rows: (string | number | null | undefined)[][]): string {
  const header = columns.map(escapeCsv).join(',');
  const body = rows.map(row => row.map(escapeCsv).join(',')).join('\n');
  return `${header}\n${body}`;
}

function buildPrintableTable(opts: {
  title: string;
  subtitle?: string;
  columns: string[];
  rows: (string | number | null | undefined)[][];
  meta?: Record<string, string>;
}): string {
  const metaRows = opts.meta
    ? Object.entries(opts.meta).map(([k, v]) =>
      `<tr><td style="padding:2px 12px 2px 0;font-weight:600;color:#3D484B;font-size:11px">${escapeHtml(k)}:</td><td style="color:#555;font-size:11px">${escapeHtml(v)}</td></tr>`
    ).join('')
    : '';

  const thCells = opts.columns.map(c =>
    `<th style="padding:6px 10px;text-align:left;font-size:11px;font-weight:700;color:#3D484B;border-bottom:2px solid #327C8D;white-space:nowrap">${escapeHtml(c)}</th>`
  ).join('');

  const tbodyRows = opts.rows.map((row, i) => {
    const bg = i % 2 === 0 ? '#fff' : '#FAFAFA';
    const cells = row.map(cell =>
      `<td style="padding:5px 10px;font-size:11px;color:#444;border-bottom:1px solid #eee">${escapeHtml(String(cell ?? ''))}</td>`
    ).join('');
    return `<tr style="background:${bg}">${cells}</tr>`;
  }).join('');

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${opts.title}</title>
<style>
  @media print { @page { margin: 15mm; size: landscape; } body { margin: 0; } }
  body { font-family: 'Segoe UI', 'Helvetica Neue', Arial, sans-serif; color: #333; margin: 0 auto; padding: 16px; }
  table { border-collapse: collapse; width: 100%; }
  .header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 3px solid #327C8D; padding-bottom: 8px; margin-bottom: 12px; }
  .title { font-size: 18px; font-weight: 700; color: #3D484B; margin: 0; }
  .subtitle { font-size: 11px; color: #888; margin: 2px 0 0; }
  .meta { margin-bottom: 12px; }
  .count { font-size: 11px; color: #888; margin-bottom: 8px; }
  .footer { margin-top: 16px; border-top: 1px solid #ddd; padding-top: 6px; font-size: 9px; color: #aaa; text-align: center; }
</style></head><body>
<div class="header">
  <div>
    <div class="title">${opts.title}</div>
    ${opts.subtitle ? `<div class="subtitle">${opts.subtitle}</div>` : ''}
  </div>
  <div style="font-size:10px;color:#aaa">${new Date().toLocaleString('en-AU')}</div>
</div>
${metaRows ? `<div class="meta"><table>${metaRows}</table></div>` : ''}
<div class="count">${opts.rows.length} record${opts.rows.length !== 1 ? 's' : ''}</div>
<table>
  <thead><tr>${thCells}</tr></thead>
  <tbody>${tbodyRows}</tbody>
</table>
<div class="footer">Signacare — Confidential — Printed ${new Date().toLocaleString('en-AU')}</div>
</body></html>`;
}

export function ListExportBar({ title, subtitle, columns, rows, compact, meta }: ListExportBarProps) {
  const [anchorEl, setAnchorEl] = React.useState<HTMLElement | null>(null);

  const handlePrint = useCallback(() => {
    setAnchorEl(null);
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(buildPrintableTable({ title, subtitle, columns, rows, meta }));
    win.document.close();
    setTimeout(() => win.print(), 300);
  }, [title, subtitle, columns, rows, meta]);

  const handleCsv = useCallback(() => {
    setAnchorEl(null);
    const csv = buildCsv(columns, rows);
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }); // BOM for Excel
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title.replace(/[^a-zA-Z0-9]/g, '_')}_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [title, columns, rows]);

  const handlePdf = useCallback(() => {
    setAnchorEl(null);
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(buildPrintableTable({ title, subtitle, columns, rows, meta }));
    win.document.close();
    setTimeout(() => win.print(), 300);
  }, [title, subtitle, columns, rows, meta]);

  if (compact) {
    return (
      <>
        <Tooltip title="Export / Print">
          <IconButton size="small" aria-label="Export or print" onClick={e => setAnchorEl(e.currentTarget)} sx={{ color: '#3D484B' }}>
            <FileDownloadIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Tooltip>
        <Menu anchorEl={anchorEl} open={!!anchorEl} onClose={() => setAnchorEl(null)} slotProps={{ paper: { sx: { minWidth: 180 } } }}>
          <MenuItem onClick={handlePrint}><ListItemIcon><PrintIcon fontSize="small" /></ListItemIcon><ListItemText>Print List</ListItemText></MenuItem>
          <MenuItem onClick={handlePdf}><ListItemIcon><PictureAsPdfIcon fontSize="small" /></ListItemIcon><ListItemText>Save as PDF</ListItemText></MenuItem>
          <Divider />
          <MenuItem onClick={handleCsv}><ListItemIcon><TableChartIcon fontSize="small" /></ListItemIcon><ListItemText>Export CSV</ListItemText></MenuItem>
        </Menu>
      </>
    );
  }

  return (
    <Box sx={{ display: 'flex', gap: 0.5 }}>
      <Tooltip title="Print list">
        <Button size="small" startIcon={<PrintIcon sx={{ fontSize: 14 }} />} onClick={handlePrint}
          sx={{ fontSize: 11, color: '#3D484B', textTransform: 'none' }}>Print</Button>
      </Tooltip>
      <Tooltip title="Save as PDF (via print dialog)">
        <Button size="small" startIcon={<PictureAsPdfIcon sx={{ fontSize: 14 }} />} onClick={handlePdf}
          sx={{ fontSize: 11, color: '#D32F2F', textTransform: 'none' }}>PDF</Button>
      </Tooltip>
      <Tooltip title="Export to CSV (opens in Excel)">
        <Button size="small" startIcon={<TableChartIcon sx={{ fontSize: 14 }} />} onClick={handleCsv}
          sx={{ fontSize: 11, color: '#327C8D', textTransform: 'none' }}>CSV</Button>
      </Tooltip>
    </Box>
  );
}
