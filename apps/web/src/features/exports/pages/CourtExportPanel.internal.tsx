import GavelIcon from '@mui/icons-material/Gavel';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Divider,
  FormControl,
  FormControlLabel,
  Grid,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  TextField,
  Typography,
} from '@mui/material';
import { useState } from 'react';
import { useAuthStore } from '../../../shared/store/authStore';
import { useStaffSignature } from '../../../shared/components/ui/DigitalSignature';
import { apiClient } from '../../../shared/services/apiClient';
import {
  type AlertPlanRow,
  type AppointmentRow,
  type AssessmentRow,
  type EpisodeRow,
  type LegalOrderRow,
  type LetterRow,
  type MedicationRow,
  type NoteRow,
  type PathologyRow,
  type PatientDemographics,
  type ReferralRow,
  type RiskAssessmentRow,
  readArrayPayload,
} from './exportsPageSupport';
import { EXPORT_MODULES, generatePdfHtml, usePatientSearch } from './exportsPageInternalSupport';

export function CourtExportPanel() {
  const [scope, setScope] = useState<'complete' | 'date_range'>('complete');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [organisation, setOrganisation] = useState<'chronological' | 'modules'>('chronological');
  const [selectedModules, setSelectedModules] = useState<string[]>(EXPORT_MODULES.map((m) => m.id));
  const [selectedPatient, setSelectedPatient] = useState<{ id: string; label: string } | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const { data: searchResults } = usePatientSearch(searchInput);
  const [exporting, setExporting] = useState(false);
  const [includeHeader, setIncludeHeader] = useState(true);
  const [includeCoverPage, setIncludeCoverPage] = useState(true);
  const [includePageNumbers, setIncludePageNumbers] = useState(true);
  const [includeSignature, setIncludeSignature] = useState(false);
  const [courtName, setCourtName] = useState('');
  const [matterNumber, setMatterNumber] = useState('');
  const { signature } = useStaffSignature();
  const user = useAuthStore((s) => s.user);

  const handleExport = async () => {
    if (!selectedPatient) return;
    setExporting(true);
    try {
      const pid = selectedPatient.id;
      const strip = (html: string) => (html ?? '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
      const sections: { heading: string; content: string }[] = [];

      const [patient, episodes, notes, meds, alerts, legal, pathology, appts, letters, assessments, risks, referrals] = await Promise.all([
        selectedModules.includes('demographics')
          ? apiClient.get<PatientDemographics>(`patients/${pid}`).catch((err) => { console.warn('ExportsPage: query failed', err); return null; })
          : Promise.resolve<PatientDemographics | null>(null),
        selectedModules.includes('episodes')
          ? apiClient.get<{ data?: EpisodeRow[] } | EpisodeRow[]>(`episodes/patient/${pid}`).then((r) => readArrayPayload<EpisodeRow>(r, ['data'])).catch((err) => { console.warn('ExportsPage: query failed', err); return []; })
          : Promise.resolve<EpisodeRow[]>([]),
        selectedModules.includes('notes')
          ? apiClient.get<{ notes?: NoteRow[] } | NoteRow[]>(`patients/${pid}/notes`).then((r) => readArrayPayload<NoteRow>(r, ['notes', 'data'])).catch((err) => { console.warn('ExportsPage: query failed', err); return []; })
          : Promise.resolve<NoteRow[]>([]),
        selectedModules.includes('medications')
          ? apiClient.get<{ data?: MedicationRow[] } | MedicationRow[]>(`medications/patients/${pid}/medications`).then((r) => readArrayPayload<MedicationRow>(r, ['data'])).catch((err) => { console.warn('ExportsPage: query failed', err); return []; })
          : Promise.resolve<MedicationRow[]>([]),
        selectedModules.includes('alerts')
          ? apiClient.get<{ alerts?: AlertPlanRow[] } | AlertPlanRow[]>(`patients/${pid}/alerts`).then((r) => readArrayPayload<AlertPlanRow>(r, ['alerts', 'data'])).catch((err) => { console.warn('ExportsPage: query failed', err); return []; })
          : Promise.resolve<AlertPlanRow[]>([]),
        selectedModules.includes('legal')
          ? apiClient.get<{ orders?: LegalOrderRow[] } | LegalOrderRow[]>(`patients/${pid}/legal-orders`).then((r) => readArrayPayload<LegalOrderRow>(r, ['orders', 'data'])).catch((err) => { console.warn('ExportsPage: query failed', err); return []; })
          : Promise.resolve<LegalOrderRow[]>([]),
        selectedModules.includes('pathology')
          ? apiClient.get<{ reports?: PathologyRow[] } | PathologyRow[]>(`patients/${pid}/pathology`).then((r) => readArrayPayload<PathologyRow>(r, ['reports', 'data'])).catch((err) => { console.warn('ExportsPage: query failed', err); return []; })
          : Promise.resolve<PathologyRow[]>([]),
        selectedModules.includes('appointments')
          ? apiClient.get<{ data?: AppointmentRow[] } | AppointmentRow[]>('appointments', { patientId: pid }).then((r) => readArrayPayload<AppointmentRow>(r, ['data'])).catch((err) => { console.warn('ExportsPage: query failed', err); return []; })
          : Promise.resolve<AppointmentRow[]>([]),
        selectedModules.includes('correspondence')
          ? apiClient.get<{ data?: LetterRow[] } | LetterRow[]>(`correspondence/letters`, { patientId: pid }).then((r) => readArrayPayload<LetterRow>(r, ['data'])).catch((err) => { console.warn('ExportsPage: query failed', err); return []; })
          : Promise.resolve<LetterRow[]>([]),
        selectedModules.includes('assessments')
          ? apiClient.get<{ data?: AssessmentRow[] } | AssessmentRow[]>(`nursing-assessments`, { patientId: pid }).then((r) => readArrayPayload<AssessmentRow>(r, ['data'])).catch((err) => { console.warn('ExportsPage: query failed', err); return []; })
          : Promise.resolve<AssessmentRow[]>([]),
        selectedModules.includes('risk')
          ? apiClient.get<{ data?: RiskAssessmentRow[] } | RiskAssessmentRow[]>(`risk-assessments/patient/${pid}`).then((r) => readArrayPayload<RiskAssessmentRow>(r, ['data'])).catch((err) => { console.warn('ExportsPage: query failed', err); return []; })
          : Promise.resolve<RiskAssessmentRow[]>([]),
        selectedModules.includes('referrals')
          ? apiClient.get<{ data?: ReferralRow[] } | ReferralRow[]>(`referrals`, { patientId: pid }).then((r) => readArrayPayload<ReferralRow>(r, ['data'])).catch((err) => { console.warn('ExportsPage: query failed', err); return []; })
          : Promise.resolve<ReferralRow[]>([]),
      ]);

      if (patient && selectedModules.includes('demographics')) {
        sections.push({
          heading: 'Demographics',
          content: [
            `Name: ${patient.givenName ?? ''} ${patient.familyName ?? ''}${patient.preferredName ? ` (prefers ${patient.preferredName})` : ''}`,
            `DOB: ${patient.dateOfBirth ?? 'N/A'} | Gender: ${patient.gender ?? 'N/A'} | Pronouns: ${patient.pronouns ?? 'N/A'}`,
            `UR: ${patient.emrNumber ?? 'N/A'} | Medicare: ${patient.medicareNumber ?? 'N/A'} | IHI: ${patient.ihi ?? 'N/A'}`,
            `ATSI Status: ${patient.atsiStatus ?? 'N/A'} | Interpreter: ${patient.interpreterRequired ? `Yes (${patient.interpreterLanguage ?? ''})` : 'No'}`,
            `Address: ${[patient.addressStreet, patient.addressSuburb, patient.addressState, patient.addressPostcode].filter(Boolean).join(', ') || 'N/A'}`,
            `Phone: ${patient.phoneMobile ?? 'N/A'} | Email: ${patient.emailPrimary ?? 'N/A'}`,
            patient.gpName ? `GP: ${patient.gpName} at ${patient.gpPractice ?? ''} (Ph: ${patient.gpPhone ?? 'N/A'})` : '',
            patient.nokName ? `NOK: ${patient.nokName} (${patient.nokRelationship ?? ''}, Ph: ${patient.nokPhone ?? 'N/A'})` : '',
          ].filter(Boolean).join('\n'),
        });
      }

      if (episodes.length && selectedModules.includes('episodes')) {
        sections.push({
          heading: `Episodes (${episodes.length})`,
          content: episodes
            .map((e) => `${e.startDate ?? 'N/A'} — ${e.endDate ?? 'Ongoing'} | ${e.episodeType ?? e.title ?? 'Episode'} | Status: ${e.status ?? 'N/A'} | Dx: ${e.primaryDiagnosis ?? 'N/A'}${e.closureReason ? ` | Closure: ${e.closureReason}` : ''}`)
            .join('\n'),
        });
      }

      if (notes.length && selectedModules.includes('notes')) {
        sections.push({
          heading: `Clinical Notes (${notes.length})`,
          content: notes
            .map((n) => `--- ${n.noteType ?? 'Note'} (${n.createdAt ? new Date(n.createdAt).toLocaleDateString('en-AU') : 'N/A'}) by ${n.authorName ?? 'Unknown'} [${n.status ?? 'draft'}] ---\nTitle: ${n.title ?? 'Untitled'}\n${strip(n.content ?? '')}\n`)
            .join('\n'),
        });
      }

      if (meds.length && selectedModules.includes('medications')) {
        const active = meds.filter((m) => m.status === 'active');
        const ceased = meds.filter((m) => m.status !== 'active');
        let content = '';
        if (active.length) {
          content += `ACTIVE (${active.length}):\n${active
            .map((m) => `  ${m.medicationName ?? 'N/A'} ${m.dose ?? ''} ${m.frequency ?? ''} (${m.route ?? ''})${m.indication ? ` — For: ${m.indication}` : ''}${m.isLai ? ' [LAI]' : ''}${m.isClozapine ? ' [Clozapine]' : ''}`)
            .join('\n')}\n\n`;
        }
        if (ceased.length) {
          content += `CEASED (${ceased.length}):\n${ceased
            .map((m) => `  ${m.medicationName ?? 'N/A'} ${m.dose ?? ''} — ceased${m.ceasedReason ? ` (${m.ceasedReason})` : ''}`)
            .join('\n')}`;
        }
        sections.push({ heading: `Medications (${meds.length})`, content });
      }

      if (alerts.length && selectedModules.includes('alerts')) {
        sections.push({
          heading: `Alerts & Plans (${alerts.length})`,
          content: alerts
            .map((a) => `[${a.severity ?? 'medium'}] ${a.title ?? 'Alert'} — ${a.isActive ? 'ACTIVE' : 'Resolved'}${a.notes ? `\n  ${a.notes}` : ''}`)
            .join('\n'),
        });
      }

      if (legal.length && selectedModules.includes('legal')) {
        sections.push({
          heading: `Legal / MH Act (${legal.length})`,
          content: legal
            .map((l) => `${l.orderTypeName ?? l.orderType ?? 'Order'} | Status: ${l.status ?? 'N/A'} | ${l.startDate ?? 'N/A'} to ${l.endDate ?? 'Ongoing'}${l.tribunalDate ? ` | Tribunal: ${l.tribunalDate}` : ''}`)
            .join('\n'),
        });
      }

      if (pathology.length && selectedModules.includes('pathology')) {
        sections.push({
          heading: `Pathology (${pathology.length})`,
          content: pathology
            .map((p) => `${p.createdAt ? new Date(p.createdAt).toLocaleDateString('en-AU') : 'N/A'} | ${p.label ?? p.testName ?? 'Test'} | ${p.value ?? ''} ${p.unit ?? ''} [${p.flag ?? 'normal'}]`)
            .join('\n'),
        });
      }

      if (appts.length && selectedModules.includes('appointments')) {
        sections.push({
          heading: `Appointments (${appts.length})`,
          content: appts
            .map((a) => `${a.startTime ? new Date(a.startTime).toLocaleString('en-AU') : 'N/A'} | ${a.appointmentType ?? a.type ?? 'Appointment'} | ${a.status ?? 'N/A'}${a.clinicianName ? ` | ${a.clinicianName}` : ''}`)
            .join('\n'),
        });
      }

      if (letters.length && selectedModules.includes('correspondence')) {
        sections.push({
          heading: `Correspondence (${letters.length})`,
          content: letters
            .map((l) => `--- ${l.letterType ?? 'Letter'} (${l.createdAt ? new Date(l.createdAt).toLocaleDateString('en-AU') : 'N/A'}) ---\nSubject: ${l.subject ?? 'N/A'}\nRecipient: ${l.recipientName ?? 'N/A'}\n${strip(l.body ?? l.content ?? '')}\n`)
            .join('\n'),
        });
      }

      if (assessments.length && selectedModules.includes('assessments')) {
        sections.push({
          heading: `Assessments (${assessments.length})`,
          content: assessments
            .map((a) => `${a.createdAt ? new Date(a.createdAt).toLocaleDateString('en-AU') : 'N/A'} | ${a.assessmentType ?? 'Assessment'} | ${a.status ?? 'N/A'}${a.totalScore != null ? ` | Score: ${a.totalScore}` : ''}`)
            .join('\n'),
        });
      }

      if (risks.length && selectedModules.includes('risk')) {
        sections.push({
          heading: `Risk Assessments (${risks.length})`,
          content: risks
            .map((r) => `${r.createdAt ? new Date(r.createdAt).toLocaleDateString('en-AU') : 'N/A'} | Self: ${r.riskSelf ?? r.riskNarrative ?? 'N/A'} | Others: ${r.riskOthers ?? 'N/A'} | Vulnerability: ${r.riskVulnerability ?? 'N/A'}${r.summary ? `\n  ${strip(r.summary)}` : ''}`)
            .join('\n'),
        });
      }

      if (referrals.length && selectedModules.includes('referrals')) {
        sections.push({
          heading: `Referrals (${referrals.length})`,
          content: referrals
            .map((r) => `${r.createdAt ? new Date(r.createdAt).toLocaleDateString('en-AU') : 'N/A'} | ${r.referralType ?? 'Referral'} | Status: ${r.status ?? 'N/A'} | From: ${r.referrerName ?? 'N/A'}${r.reason ? ` | Reason: ${r.reason}` : ''}`)
            .join('\n'),
        });
      }

      if (sections.length === 0) {
        sections.push({ heading: 'No Data', content: 'No records found for the selected modules and patient.' });
      }

      const meta: Record<string, string> = {
        Patient: selectedPatient.label,
        Scope: scope === 'complete' ? 'Complete File' : `${dateFrom} to ${dateTo}`,
        Organisation: organisation === 'chronological' ? 'Chronological Order' : 'Grouped by Module',
        Modules: selectedModules.map((id) => EXPORT_MODULES.find((m) => m.id === id)?.label ?? id).join(', '),
      };
      if (courtName) meta['Court / Tribunal'] = courtName;
      if (matterNumber) meta['Matter Number'] = matterNumber;
      meta['FOI Exempt Content'] = 'EXCLUDED';
      meta['Total Records'] = String(sections.reduce((s, sec) => s + (sec.content.split('\n').length), 0));

      const sigOpts = includeSignature && signature
        ? {
            signerName: `${user?.givenName ?? ''} ${user?.familyName ?? ''}`.trim(),
            signerTitle: user?.role ?? '',
            signatureDataUrl: signature,
          }
        : undefined;
      const html = generatePdfHtml(`Court File — ${selectedPatient.label}`, sections, meta, sigOpts);
      const win = window.open('', '_blank');
      if (win) {
        win.document.write(html);
        win.document.close();
        win.print();
      }
    } finally {
      setExporting(false);
    }
  };

  return (
    <Paper variant="outlined" sx={{ p: 3 }}>
      <Typography variant="h6" fontWeight={600} sx={{ mb: 0.5 }}>Court File Export</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Generate a complete or date-ranged clinical file for court proceedings. Exported as PDF with optional cover page, chronological or
        module-based organisation.
      </Typography>

      <Grid container spacing={3}>
        <Grid size={{ xs: 12 }}>
          <Autocomplete
            options={(searchResults?.data ?? []).map((p) => ({ id: p.id, label: `${p.familyName}, ${p.givenName} (${p.emrNumber})` }))}
            value={selectedPatient}
            onChange={(_, v) => setSelectedPatient(v)}
            inputValue={searchInput}
            onInputChange={(_, v) => setSearchInput(v)}
            isOptionEqualToValue={(opt, val) => opt.id === val.id}
            renderInput={(params) => <TextField {...params} label="Select Patient *" size="small" placeholder="Search by name or UR..." />}
          />
        </Grid>

        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            label="Court / Tribunal Name"
            fullWidth
            size="small"
            value={courtName}
            onChange={(e) => setCourtName(e.target.value)}
            placeholder="e.g. Mental Health Tribunal, County Court"
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            label="Matter / File Number"
            fullWidth
            size="small"
            value={matterNumber}
            onChange={(e) => setMatterNumber(e.target.value)}
          />
        </Grid>

        <Grid size={{ xs: 12, sm: 6 }}>
          <FormControl fullWidth size="small">
            <InputLabel>File Scope</InputLabel>
            <Select value={scope} onChange={(e) => setScope(e.target.value as 'complete' | 'date_range')} label="File Scope">
              <MenuItem value="complete">Complete File (All Records)</MenuItem>
              <MenuItem value="date_range">Selected Date Range</MenuItem>
            </Select>
          </FormControl>
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <FormControl fullWidth size="small">
            <InputLabel>Organisation</InputLabel>
            <Select value={organisation} onChange={(e) => setOrganisation(e.target.value as 'chronological' | 'modules')} label="Organisation">
              <MenuItem value="chronological">Chronological Order</MenuItem>
              <MenuItem value="modules">Grouped by Module</MenuItem>
            </Select>
          </FormControl>
        </Grid>

        {scope === 'date_range' && (
          <>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                label="From Date *"
                type="date"
                fullWidth
                size="small"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                slotProps={{ inputLabel: { shrink: true } }}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                label="To Date *"
                type="date"
                fullWidth
                size="small"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                slotProps={{ inputLabel: { shrink: true } }}
              />
            </Grid>
          </>
        )}

        <Grid size={{ xs: 12 }}>
          <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>Modules to Include</Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 1 }}>
            <Button size="small" onClick={() => setSelectedModules(EXPORT_MODULES.map((m) => m.id))} sx={{ fontSize: 10 }}>Select All</Button>
            <Button size="small" onClick={() => setSelectedModules([])} sx={{ fontSize: 10 }}>Deselect All</Button>
          </Box>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            {EXPORT_MODULES.map((m) => (
              <FormControlLabel
                key={m.id}
                control={
                  <Checkbox
                    size="small"
                    checked={selectedModules.includes(m.id)}
                    onChange={(_, v) => setSelectedModules((prev) => (v ? [...prev, m.id] : prev.filter((x) => x !== m.id)))}
                  />
                }
                label={<Typography variant="body2" sx={{ fontSize: 13 }}>{m.label}</Typography>}
              />
            ))}
          </Box>
        </Grid>

        <Grid size={{ xs: 12 }}>
          <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>PDF Options</Typography>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            <FormControlLabel control={<Checkbox size="small" checked={includeCoverPage} onChange={(_, v) => setIncludeCoverPage(v)} />}
              label={<Typography variant="body2" sx={{ fontSize: 13 }}>Cover Page</Typography>} />
            <FormControlLabel control={<Checkbox size="small" checked={includeHeader} onChange={(_, v) => setIncludeHeader(v)} />}
              label={<Typography variant="body2" sx={{ fontSize: 13 }}>Header on each page</Typography>} />
            <FormControlLabel control={<Checkbox size="small" checked={includePageNumbers} onChange={(_, v) => setIncludePageNumbers(v)} />}
              label={<Typography variant="body2" sx={{ fontSize: 13 }}>Page numbers</Typography>} />
            <FormControlLabel
              control={<Checkbox size="small" checked={includeSignature} onChange={(_, v) => setIncludeSignature(v)} disabled={!signature} />}
              label={<Typography variant="body2" sx={{ fontSize: 13 }}>{signature ? 'Include digital signature' : 'Include digital signature (set up in Settings)'}</Typography>}
            />
          </Box>
        </Grid>

        <Grid size={{ xs: 12 }}>
          <Alert severity="info" sx={{ fontSize: 12 }}>
            The court file will include all selected modules for the patient. FOI exempt content is <strong>excluded</strong> by default.
            Use the "FOI Exempt File" tab to generate a file that specifically excludes FOI exempt material.
          </Alert>
        </Grid>

        <Grid size={{ xs: 12 }}>
          <Divider sx={{ my: 1 }} />
          <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button
              variant="contained"
              startIcon={exporting ? <CircularProgress role="progressbar" aria-label="Loading" size={16} sx={{ color: '#fff' }} /> : <GavelIcon />}
              onClick={handleExport}
              disabled={exporting || !selectedPatient}
              sx={{ bgcolor: '#3D484B', '&:hover': { bgcolor: '#2a3335' }, textTransform: 'none' }}
            >
              {exporting ? 'Generating PDF...' : 'Generate Court File (PDF)'}
            </Button>
          </Box>
        </Grid>
      </Grid>
    </Paper>
  );
}
