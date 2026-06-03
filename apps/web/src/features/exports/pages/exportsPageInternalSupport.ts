import { escapeHtml } from '../../../shared/utils/escapeHtml';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../../shared/services/apiClient';
import { exportsKeys } from '../queryKeys';

export type ExportModule = { id: string; label: string };

export const EXPORT_MODULES: ExportModule[] = [
  { id: 'demographics', label: 'Demographics' },
  { id: 'episodes', label: 'Episodes' },
  { id: 'notes', label: 'Clinical Notes' },
  { id: 'medications', label: 'Medications' },
  { id: 'alerts', label: 'Alerts & Plans' },
  { id: 'legal', label: 'Legal / MH Act' },
  { id: 'pathology', label: 'Pathology' },
  { id: 'appointments', label: 'Appointments' },
  { id: 'correspondence', label: 'Correspondence' },
  { id: 'assessments', label: 'Assessments' },
  { id: 'risk', label: 'Risk Assessments' },
  { id: 'referrals', label: 'Referrals' },
];

export function generatePdfHtml(
  title: string,
  sections: { heading: string; content: string }[],
  meta: Record<string, string>,
  opts?: { signerName?: string; signerTitle?: string; signatureDataUrl?: string | null },
): string {
  const metaRows = Object.entries(meta)
    .map(([
      k,
      v,
    ]) => `<tr><td style="padding:4px 12px 4px 0;font-weight:600;color:#3D484B">${escapeHtml(k)}</td><td style="padding:4px 0;color:#555">${escapeHtml(v)}</td></tr>`)
    .join('');
  const sectionHtml = sections
    .map((s) => `<h2 style="color:#327C8D;border-bottom:2px solid #327C8D;padding-bottom:4px;margin-top:24px">${escapeHtml(s.heading)}</h2><div style="white-space:pre-wrap;font-size:13px;line-height:1.6">${escapeHtml(s.content)}</div>`)
    .join('');
  const sigBlock = opts?.signerName
    ? `
<div style="margin-top:40px;border-top:1px solid #ddd;padding-top:16px">
  <div style="color:#555;margin-bottom:8px">Prepared by:</div>
  ${opts.signatureDataUrl ? `<img src="${opts.signatureDataUrl}" alt="Digital signature" style="max-height:50px;max-width:200px;margin-bottom:4px;display:block" />` : ''}
  <div style="font-weight:700;font-size:13px">${escapeHtml(opts.signerName)}</div>
  ${opts.signerTitle ? `<div style="font-size:12px;color:#666">${escapeHtml(opts.signerTitle)}</div>` : ''}
  <div style="font-size:11px;color:#999;margin-top:4px">${new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })}</div>
</div>`
    : '';

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>@media print{body{margin:0}}.page{font-family:'Segoe UI',Arial,sans-serif;max-width:800px;margin:0 auto;padding:40px}
h1{color:#3D484B;font-size:22px;margin-bottom:4px}
.subtitle{color:#888;font-size:13px;margin-bottom:20px}
.meta{margin-bottom:24px;border:1px solid #ddd;border-radius:6px;padding:12px}
.footer{margin-top:40px;border-top:1px solid #ddd;padding-top:8px;font-size:11px;color:#999;text-align:center}
</style></head><body><div class="page">
<h1>${title}</h1><div class="subtitle">Generated ${new Date().toLocaleDateString('en-AU')} at ${new Date().toLocaleTimeString('en-AU')}</div>
<div class="meta"><table>${metaRows}</table></div>
${sectionHtml}
${sigBlock}
<div class="footer">Signacare — Confidential Clinical Document — Page generated ${new Date().toISOString()}</div>
</div></body></html>`;
}

export function usePatientSearch(query: string) {
  return useQuery({
    queryKey: exportsKeys.patientSearch(query),
    queryFn: () => apiClient.get<{ data: { id: string; givenName: string; familyName: string; emrNumber: string }[] }>('patients', { search: query, limit: 20 }),
    enabled: query.length >= 2,
    staleTime: 10_000,
  });
}

