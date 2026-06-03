import DownloadIcon from '@mui/icons-material/Download';
import GavelIcon from '@mui/icons-material/Gavel';
import StorageIcon from '@mui/icons-material/Storage';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import {
    Alert, Autocomplete, Box, Button, Checkbox, Chip, CircularProgress, Divider, FormControl, FormControlLabel,
    Grid, InputLabel, MenuItem, Paper, Select, Tab, Tabs, TextField, Typography
} from '@mui/material';
import { useState } from 'react';
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
  applyClinicalSafeMode,
  flattenRecordForCsv,
  readArrayPayload,
  toFlatCsv,
} from './exportsPageSupport';
import { CourtExportPanel } from './CourtExportPanel.internal';
import { FoiExportPanel } from './FoiExportPanel.internal';
import { EXPORT_MODULES, usePatientSearch } from './exportsPageInternalSupport';

type ExportTab = 'data' | 'court' | 'foi';

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function ExportsPage() {
  const [tab, setTab] = useState<ExportTab>('data');

  return (
    <Box sx={{ px: { xs: 2, sm: 3, md: 4 }, py: 3, bgcolor: '#FBF8F5', minHeight: '100vh' }}>
      <Typography variant="h5" fontWeight={700} fontFamily="Albert Sans, sans-serif" sx={{ color: '#3D484B', mb: 0.5 }}>
        Data Exports
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Export patient data, court files, and FOI-compliant records as PDF
      </Typography>

      <Tabs aria-label="Navigation tabs" value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 3, '& .MuiTab-root': { textTransform: 'none', fontFamily: 'Albert Sans, sans-serif' } }}>
        <Tab icon={<StorageIcon sx={{ fontSize: 18 }} />} iconPosition="start" label="Data Export" value="data" />
        <Tab icon={<GavelIcon sx={{ fontSize: 18 }} />} iconPosition="start" label="Court File Export" value="court" />
        <Tab icon={<VisibilityOffIcon sx={{ fontSize: 18 }} />} iconPosition="start" label="FOI Exempt File" value="foi" />
      </Tabs>

      {tab === 'data' && <DataExportPanel />}
      {tab === 'court' && <CourtExportPanel />}
      {tab === 'foi' && <FoiExportPanel />}
    </Box>
  );
}

// ============ Data Export ============

function DataExportPanel() {
  const [scope, setScope] = useState<'all' | 'selected'>('selected');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selectedPatients, setSelectedPatients] = useState<{ id: string; label: string }[]>([]);
  const [selectedModules, setSelectedModules] = useState<string[]>(EXPORT_MODULES.map(m => m.id));
  const [format, setFormat] = useState<'csv' | 'json'>('csv');
  const [layoutMode, setLayoutMode] = useState<'event_log' | 'flat_normalized'>('flat_normalized');
  const [clinicalMode, setClinicalMode] = useState<'standard' | 'clinical_safe'>('clinical_safe');
  const [includeDraftAiNotes, setIncludeDraftAiNotes] = useState(false);
  const [includeLongFreeText, setIncludeLongFreeText] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const { data: searchResults } = usePatientSearch(searchInput);
  const LONG_TEXT_THRESHOLD = 220;

  const fromBoundary = dateFrom ? new Date(`${dateFrom}T00:00:00.000`) : null;
  const toBoundary = dateTo ? new Date(`${dateTo}T23:59:59.999`) : null;

  const toCsvCell = (value: string): string => `"${value.replace(/"/g, '""')}"`;
  const toCsvLine = (values: string[]): string => values.map(toCsvCell).join(',');

  const recordDateForModule = (moduleId: string, row: Record<string, unknown>): string | null => {
    switch (moduleId) {
      case 'episodes':
        return (typeof row.startDate === 'string' ? row.startDate : null)
          ?? (typeof row.endDate === 'string' ? row.endDate : null);
      case 'notes':
        return typeof row.createdAt === 'string' ? row.createdAt : null;
      case 'medications':
        return (typeof row.updatedAt === 'string' ? row.updatedAt : null)
          ?? (typeof row.createdAt === 'string' ? row.createdAt : null);
      case 'alerts':
        return (typeof row.updatedAt === 'string' ? row.updatedAt : null)
          ?? (typeof row.createdAt === 'string' ? row.createdAt : null);
      case 'legal':
        return (typeof row.startDate === 'string' ? row.startDate : null)
          ?? (typeof row.endDate === 'string' ? row.endDate : null);
      case 'pathology':
        return typeof row.createdAt === 'string' ? row.createdAt : null;
      case 'appointments':
        return (typeof row.startTime === 'string' ? row.startTime : null)
          ?? (typeof row.createdAt === 'string' ? row.createdAt : null);
      case 'correspondence':
        return typeof row.createdAt === 'string' ? row.createdAt : null;
      case 'assessments':
        return typeof row.createdAt === 'string' ? row.createdAt : null;
      case 'risk':
        return typeof row.createdAt === 'string' ? row.createdAt : null;
      case 'referrals':
        return typeof row.createdAt === 'string' ? row.createdAt : null;
      case 'demographics':
        return (typeof row.updatedAt === 'string' ? row.updatedAt : null)
          ?? (typeof row.createdAt === 'string' ? row.createdAt : null);
      default:
        return null;
    }
  };

  const isWithinDateRange = (dateValue: string | null): boolean => {
    if (!fromBoundary && !toBoundary) return true;
    if (!dateValue) return false;
    const parsed = new Date(dateValue);
    if (Number.isNaN(parsed.getTime())) return false;
    if (fromBoundary && parsed < fromBoundary) return false;
    if (toBoundary && parsed > toBoundary) return false;
    return true;
  };

  const fetchPatientsForExport = async (): Promise<{ id: string; label: string }[]> => {
    if (scope === 'selected') return selectedPatients;

    type PatientListRow = { id: string; givenName?: string; familyName?: string; emrNumber?: string };
    type PatientListResponse = {
      data?: PatientListRow[];
      pagination?: { totalPages?: number };
    };

    const out: { id: string; label: string }[] = [];
    const limit = 200;
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const response = await apiClient.get<PatientListResponse>('patients', { page, limit });
      const rows = readArrayPayload<PatientListRow>(response, ['data']);
      if (rows.length === 0) {
        hasMore = false;
        continue;
      }

      out.push(
        ...rows.map((p) => ({
          id: p.id,
          label: `${p.familyName ?? ''}, ${p.givenName ?? ''} (${p.emrNumber ?? 'N/A'})`,
        })),
      );

      const totalPages = response.pagination?.totalPages;
      if (typeof totalPages === 'number') {
        hasMore = page < totalPages;
      } else {
        hasMore = rows.length === limit;
      }
      if (hasMore) page += 1;
    }

    return out;
  };

  const handleExport = async () => {
    setExportError(null);
    setExporting(true);
    try {
      const patientsForExport = await fetchPatientsForExport();
      if (patientsForExport.length === 0) {
        throw new Error('No patients found to export for the selected scope.');
      }

      const eventLogCsvRows: string[] = [
        toCsvLine(['Patient', 'Patient ID', 'Module', 'Record Date', 'Content']),
      ];
      const flatCsvRows: Array<Record<string, string>> = [];
      const jsonPatients: Array<{
        id: string;
        label: string;
        modules: Record<string, unknown[]>;
      }> = [];
      const exportTimestamp = new Date().toISOString();
      const clinicalSafeEnabled = clinicalMode === 'clinical_safe';
      const asRows = (rows: unknown[]): Record<string, unknown>[] =>
        rows.filter((row): row is Record<string, unknown> => typeof row === 'object' && row !== null);

      for (const patient of patientsForExport) {
        const pid = patient.id;
        const [
          demographics,
          episodes,
          notes,
          medications,
          alerts,
          legalOrders,
          pathology,
          appointments,
          correspondence,
          assessments,
          risks,
          referrals,
        ] = await Promise.all([
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

        const modulesPayload: Record<string, unknown[]> = {};
        const addModuleRows = (moduleId: string, rows: unknown[]) => {
          const safeRows = clinicalSafeEnabled
            ? applyClinicalSafeMode(moduleId, rows, {
              includeDraftAiNotes,
              includeLongFreeText,
              longTextThreshold: LONG_TEXT_THRESHOLD,
            })
            : asRows(rows);

          const filtered = safeRows.filter((raw) => {
            if (typeof raw !== 'object' || raw === null) return false;
            const rec = raw as Record<string, unknown>;
            return isWithinDateRange(recordDateForModule(moduleId, rec));
          });

          modulesPayload[moduleId] = filtered as unknown[];
          for (const raw of filtered) {
            const rec = raw as Record<string, unknown>;
            const recordDate = recordDateForModule(moduleId, rec) ?? '';
            const moduleLabel = EXPORT_MODULES.find((m) => m.id === moduleId)?.label ?? moduleId;
            if (layoutMode === 'event_log') {
              eventLogCsvRows.push(toCsvLine([
                patient.label,
                pid,
                moduleLabel,
                recordDate,
                JSON.stringify(rec),
              ]));
            } else {
              flatCsvRows.push({
                patient: patient.label,
                patientId: pid,
                module: moduleLabel,
                recordDate,
                ...flattenRecordForCsv(rec, moduleId),
              });
            }
          }
        };

        if (selectedModules.includes('demographics')) {
          const demoRows = demographics ? [demographics as unknown] : [];
          const safeDemoRows = clinicalSafeEnabled
            ? applyClinicalSafeMode('demographics', demoRows, {
              includeDraftAiNotes,
              includeLongFreeText,
              longTextThreshold: LONG_TEXT_THRESHOLD,
            })
            : asRows(demoRows);
          const filteredDemoRows = safeDemoRows.filter((raw) => {
            const rec = raw as Record<string, unknown>;
            return isWithinDateRange(recordDateForModule('demographics', rec));
          });
          modulesPayload.demographics = filteredDemoRows as unknown[];
          for (const raw of filteredDemoRows) {
            const rec = raw as Record<string, unknown>;
            const recordDate = recordDateForModule('demographics', rec) ?? '';
            if (layoutMode === 'event_log') {
              eventLogCsvRows.push(toCsvLine([
                patient.label,
                pid,
                'Demographics',
                recordDate,
                JSON.stringify(rec),
              ]));
            } else {
              flatCsvRows.push({
                patient: patient.label,
                patientId: pid,
                module: 'Demographics',
                recordDate,
                ...flattenRecordForCsv(rec, 'demographics'),
              });
            }
          }
        }

        if (selectedModules.includes('episodes')) addModuleRows('episodes', episodes);
        if (selectedModules.includes('notes')) addModuleRows('notes', notes);
        if (selectedModules.includes('medications')) addModuleRows('medications', medications);
        if (selectedModules.includes('alerts')) addModuleRows('alerts', alerts);
        if (selectedModules.includes('legal')) addModuleRows('legal', legalOrders);
        if (selectedModules.includes('pathology')) addModuleRows('pathology', pathology);
        if (selectedModules.includes('appointments')) addModuleRows('appointments', appointments);
        if (selectedModules.includes('correspondence')) addModuleRows('correspondence', correspondence);
        if (selectedModules.includes('assessments')) addModuleRows('assessments', assessments);
        if (selectedModules.includes('risk')) addModuleRows('risk', risks);
        if (selectedModules.includes('referrals')) addModuleRows('referrals', referrals);

        jsonPatients.push({ id: pid, label: patient.label, modules: modulesPayload });
      }

      if (format === 'csv') {
        if (layoutMode === 'event_log') {
          if (eventLogCsvRows.length === 1) {
            eventLogCsvRows.push(toCsvLine([
              'no_records',
              '',
              'export_info',
              exportTimestamp,
              `No records found for selected modules (${selectedModules.join(', ')}) in range ${dateFrom || 'all'} to ${dateTo || 'all'}.`,
            ]));
          }
          const blob = new Blob([eventLogCsvRows.join('\n')], { type: 'text/csv' });
          downloadBlob(blob, `signacare_export_${exportTimestamp.slice(0, 10)}.csv`);
        } else {
          if (flatCsvRows.length === 0) {
            flatCsvRows.push({
              patient: 'no_records',
              patientId: '',
              module: 'export_info',
              recordDate: exportTimestamp,
              info: `No records found for selected modules (${selectedModules.join(', ')}) in range ${dateFrom || 'all'} to ${dateTo || 'all'}.`,
            });
          }
          const blob = new Blob([toFlatCsv(flatCsvRows)], { type: 'text/csv' });
          downloadBlob(blob, `signacare_export_flat_${exportTimestamp.slice(0, 10)}.csv`);
        }
      } else {
        const jsonData = {
          exportDate: exportTimestamp,
          scope,
          modules: selectedModules,
          exportLayout: layoutMode,
          clinicalMode,
          clinicalSafeControls: {
            includeDraftAiNotes,
            includeLongFreeText,
            longTextThreshold: LONG_TEXT_THRESHOLD,
          },
          dateRange: { from: dateFrom || null, to: dateTo || null },
          patientCount: patientsForExport.length,
          patients: jsonPatients,
        };
        const blob = new Blob([JSON.stringify(jsonData, null, 2)], { type: 'application/json' });
        downloadBlob(blob, `signacare_export_${exportTimestamp.slice(0, 10)}.json`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Data export failed. Please retry.';
      setExportError(message);
    } finally {
      setExporting(false);
    }
  };

  return (
    <Paper variant="outlined" sx={{ p: 3 }}>
      <Typography variant="h6" fontWeight={600} sx={{ mb: 2 }}>Data Export</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Export patient data with date range filtering. Select specific patients or export all.
      </Typography>
      {exportError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {exportError}
        </Alert>
      )}

      <Grid container spacing={3}>
        {/* Scope */}
        <Grid size={{ xs: 12, sm: 6 }}>
          <FormControl fullWidth size="small"><InputLabel>Patient Scope</InputLabel>
            <Select value={scope} onChange={e => setScope(e.target.value as 'all' | 'selected')} label="Patient Scope">
              <MenuItem value="all">All Patients</MenuItem>
              <MenuItem value="selected">Selected Patients</MenuItem>
            </Select>
          </FormControl>
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <FormControl fullWidth size="small"><InputLabel>Format</InputLabel>
            <Select value={format} onChange={e => setFormat(e.target.value as 'csv' | 'json')} label="Format">
              <MenuItem value="csv">CSV</MenuItem>
              <MenuItem value="json">JSON</MenuItem>
            </Select>
          </FormControl>
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <FormControl fullWidth size="small"><InputLabel>CSV Layout</InputLabel>
            <Select value={layoutMode} onChange={e => setLayoutMode(e.target.value as 'event_log' | 'flat_normalized')} label="CSV Layout">
              <MenuItem value="flat_normalized">Flat (normalized columns per module)</MenuItem>
              <MenuItem value="event_log">Event Log (legacy JSON blob)</MenuItem>
            </Select>
          </FormControl>
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <FormControl fullWidth size="small"><InputLabel>Clinical Safety</InputLabel>
            <Select value={clinicalMode} onChange={e => setClinicalMode(e.target.value as 'standard' | 'clinical_safe')} label="Clinical Safety">
              <MenuItem value="clinical_safe">Clinical-safe (default)</MenuItem>
              <MenuItem value="standard">Standard (full content)</MenuItem>
            </Select>
          </FormControl>
        </Grid>

        {/* Patient Search */}
        {scope === 'selected' && (
          <Grid size={{ xs: 12 }}>
            <Autocomplete
              multiple
              options={(searchResults?.data ?? []).map(p => ({ id: p.id, label: `${p.familyName}, ${p.givenName} (${p.emrNumber})` }))}
              value={selectedPatients}
              onChange={(_, v) => setSelectedPatients(v)}
              inputValue={searchInput}
              onInputChange={(_, v) => setSearchInput(v)}
              isOptionEqualToValue={(opt, val) => opt.id === val.id}
              renderInput={(params) => <TextField {...params} label="Search and select patients" size="small" placeholder="Type name or UR number..." />}
              renderTags={(value, getTagProps) => value.map((opt, i) => <Chip {...getTagProps({ index: i })} key={opt.id} label={opt.label} size="small" />)}
            />
          </Grid>
        )}

        {/* Date Range */}
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField label="From Date" type="date" fullWidth size="small" value={dateFrom}
            onChange={e => setDateFrom(e.target.value)} slotProps={{ inputLabel: { shrink: true } }}
            helperText="Leave blank for all historical data" />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField label="To Date" type="date" fullWidth size="small" value={dateTo}
            onChange={e => setDateTo(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
        </Grid>

        {/* Modules */}
        <Grid size={{ xs: 12 }}>
          <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>Modules to Export</Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
            <Button size="small" onClick={() => setSelectedModules(EXPORT_MODULES.map(m => m.id))} sx={{ fontSize: 10, mr: 1 }}>Select All</Button>
            <Button size="small" onClick={() => setSelectedModules([])} sx={{ fontSize: 10, mr: 1 }}>Deselect All</Button>
          </Box>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 1 }}>
            {EXPORT_MODULES.map(m => (
              <FormControlLabel key={m.id} control={
                <Checkbox size="small" checked={selectedModules.includes(m.id)}
                  onChange={(_, v) => setSelectedModules(prev => v ? [...prev, m.id] : prev.filter(x => x !== m.id))} />
              } label={<Typography variant="body2" sx={{ fontSize: 13 }}>{m.label}</Typography>} />
            ))}
          </Box>
        </Grid>

        {clinicalMode === 'clinical_safe' && (
          <Grid size={{ xs: 12 }}>
            <Alert severity="info" sx={{ mb: 1.5 }}>
              Clinical-safe mode excludes draft AI notes and redacts long free-text fields by default.
              You can explicitly include these below when clinically required.
            </Alert>
            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
              <FormControlLabel
                control={
                  <Checkbox
                    size="small"
                    checked={includeDraftAiNotes}
                    onChange={(_, checked) => setIncludeDraftAiNotes(checked)}
                  />
                }
                label={<Typography variant="body2" sx={{ fontSize: 13 }}>Include draft AI notes</Typography>}
              />
              <FormControlLabel
                control={
                  <Checkbox
                    size="small"
                    checked={includeLongFreeText}
                    onChange={(_, checked) => setIncludeLongFreeText(checked)}
                  />
                }
                label={<Typography variant="body2" sx={{ fontSize: 13 }}>Include long free-text content</Typography>}
              />
            </Box>
          </Grid>
        )}

        <Grid size={{ xs: 12 }}>
          <Divider sx={{ my: 1 }} />
          <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button variant="contained" startIcon={exporting ? <CircularProgress role="progressbar" aria-label="Loading" size={16} sx={{ color: '#fff' }} /> : <DownloadIcon />}
              onClick={handleExport} disabled={exporting || (scope === 'selected' && !selectedPatients.length) || !selectedModules.length}
              sx={{ bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' }, textTransform: 'none' }}>
              {exporting ? 'Generating...' : 'Export Data'}
            </Button>
          </Box>
        </Grid>
      </Grid>
    </Paper>
  );
}
