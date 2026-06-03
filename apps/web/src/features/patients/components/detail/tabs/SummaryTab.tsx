import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Accordion, AccordionDetails, AccordionSummary, Alert, Box, Button, Chip, CircularProgress, Divider, Grid, IconButton,
  Paper, Tab, Tabs, TextField, Tooltip, Typography,
} from '@mui/material';
import { DEFAULT_CLINIC_TIME_ZONE } from '@signacare/shared';
import RefreshIcon from '@mui/icons-material/Refresh';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import EditIcon from '@mui/icons-material/Edit';
import TimelineIcon from '@mui/icons-material/Timeline';
import PsychologyIcon from '@mui/icons-material/Psychology';
import LocalHospitalIcon from '@mui/icons-material/LocalHospital';
import EventNoteIcon from '@mui/icons-material/EventNote';
import PeopleAltIcon from '@mui/icons-material/PeopleAlt';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { usePatient } from '../../../hooks/usePatient';
import { calculateAge } from '../../../types/patientTypes';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../../../shared/services/apiClient';
import {
  patientsKeys,
  episodesKeys,
  patientMedicationsKeys,
  physicalHealthKeys,
  riskAllergiesKeys,
} from '../../../queryKeys';
import {
  extractErrorMessage,
  fmtDate,
  fmtDateShort,
  parseDate,
  type PhysicalHealthSource,
  type SummaryAlertRow,
  type SummaryEpisodeRow,
  type SummaryMedicationRow,
  type SummaryNoteRow,
  type SummaryRiskAssessmentRow,
} from './summaryTabDomain';
import {
  NOTE_LIFE_EVENT_RULES,
  RESIDUAL_COLORS,
  RESIDUAL_KEYWORDS,
  buildContinuousLine,
  buildWavePath,
  classifyIllnessPattern,
  deriveMoodSignalFromNote,
  formatEpisodeDuration,
  getPrimaryDomainDisplayLabel,
  getNoteNarrativeText,
} from './lifeChartDomain';
import { LifeChartSchemaTable } from './LifeChartSchemaTable';
import {
  LIFECHART_SCHEMA_NOTE_TYPE,
  LIFECHART_SCHEMA_NOTE_TITLE,
  buildHeuristicSchemaDoc,
  buildLifeChartSchemaPrompt,
  normalizeSchemaDoc,
  parseSchemaDocFromLlm,
  stringifySchemaDoc,
  type LifeChartSchemaDoc,
  type LifeChartSchemaRow,
} from './lifeChartSchemaDomain';
import { DiagnosisSummaryCard } from './DiagnosisSummaryCard';
import { LinkagesPanel } from './LinkagesPanel';
import { CareProvisionPanel } from './CareProvisionPanel';
import { SectionSignoffControls, type SummarySignoffSection } from './SummarySignoffControls';
import { BmiCard, PhysicalHealthCard, QuickCard } from './SummaryUiCards';
import { VivaAlertBanner } from './VivaAlertBanner';
import { CLINICAL_TYPES, noteTypeLabel } from './summaryNarrative';
import {
  CLINICAL_FORMULATION_NOTE_TITLE,
  CLINICAL_FORMULATION_NOTE_TYPE,
  LONGITUDINAL_SUMMARY_NOTE_TITLE,
  LONGITUDINAL_SUMMARY_NOTE_TYPE,
  findLatestArtifactNote,
  listArtifactNotes,
  upsertSummaryArtifactNote,
} from './summaryArtifacts';
import { renderArtifactHistoryCard } from './summaryHistoryCard';

interface SummarySignoffRecord {
  section: SummarySignoffSection;
  signedOffAt: string;
  signedOffById: string;
  signedOffByName: string;
  reviewDueDate: string;
  reminderTaskId: string | null;
}

interface SummaryDiagnosisLookupRow {
  name?: string | null;
  diagnosis?: string | null;
  episodeType?: string | null;
  episodeStatus?: string | null;
}

function firstNonEmptyValue(candidates: Array<string | null | undefined>): string | null {
  for (const candidate of candidates) {
    if (!candidate) continue;
    const normalized = candidate.trim();
    if (normalized.length > 0) return normalized;
  }
  return null;
}

function isOngoingEpisodeStatus(status: string | null | undefined): boolean {
  const normalized = (status ?? '').trim().toLowerCase();
  return normalized === 'open' || normalized === 'onhold' || normalized === 'active';
}

function episodeRecencyRank(row: SummaryEpisodeRow): number {
  const preferred = parseDate(row.startDate) ?? parseDate(row.endDate);
  return preferred ? preferred.getTime() : 0;
}

function resolvePrimaryDiagnosisSnapshot(
  episodes: SummaryEpisodeRow[],
  diagnosisRows: SummaryDiagnosisLookupRow[],
): { value: string; sub?: string } {
  const ongoingEpisodeWithDiagnosis = episodes.find((episode) => (
    isOngoingEpisodeStatus(episode.status)
      && firstNonEmptyValue([episode.primaryDiagnosis, episode.diagnoses])
  ));
  if (ongoingEpisodeWithDiagnosis) {
    return {
      value: firstNonEmptyValue([ongoingEpisodeWithDiagnosis.primaryDiagnosis, ongoingEpisodeWithDiagnosis.diagnoses]) ?? 'Not recorded',
      sub: ongoingEpisodeWithDiagnosis.title ?? ongoingEpisodeWithDiagnosis.episodeType ?? undefined,
    };
  }

  const mostRecentEpisodeWithDiagnosis = [...episodes]
    .sort((a, b) => episodeRecencyRank(b) - episodeRecencyRank(a))
    .find((episode) => firstNonEmptyValue([episode.primaryDiagnosis, episode.diagnoses]));
  if (mostRecentEpisodeWithDiagnosis) {
    return {
      value: firstNonEmptyValue([mostRecentEpisodeWithDiagnosis.primaryDiagnosis, mostRecentEpisodeWithDiagnosis.diagnoses]) ?? 'Not recorded',
      sub: mostRecentEpisodeWithDiagnosis.title ?? mostRecentEpisodeWithDiagnosis.episodeType ?? undefined,
    };
  }

  const diagnosisRow = diagnosisRows.find((row) => firstNonEmptyValue([row.name, row.diagnosis]));
  if (diagnosisRow) {
    return {
      value: firstNonEmptyValue([diagnosisRow.name, diagnosisRow.diagnosis]) ?? 'Not recorded',
      sub: diagnosisRow.episodeType ?? undefined,
    };
  }

  return { value: 'Not recorded' };
}

interface SummaryTabProps { patientId: string }
export function SummaryTab({ patientId }: SummaryTabProps) {
  const [subTab, setSubTab] = useState<'clinical' | 'care' | 'lifechart' | 'linkages'>('clinical');

  return (
    <Box>
      <Tabs aria-label="Navigation tabs"
        value={subTab}
        onChange={(_, v) => setSubTab(v)}
        sx={{
          mb: 3, borderBottom: '1px solid', borderColor: 'divider',
          '& .MuiTab-root': { textTransform: 'none', fontFamily: 'Albert Sans, sans-serif', fontSize: 13, fontWeight: 500 },
          '& .Mui-selected': { color: '#b8621a', fontWeight: 700 },
          '& .MuiTabs-indicator': { bgcolor: '#b8621a' },
        }}
      >
        <Tab label="Clinical Summary" value="clinical" />
        <Tab label="Life Chart" value="lifechart" />
        <Tab label="Care Provision" value="care" />
        <Tab label="Linkages" value="linkages" />
      </Tabs>

      {subTab === 'clinical'  && <ClinicalSummaryPanel patientId={patientId} />}
      {subTab === 'lifechart' && <LifeChartPanel patientId={patientId} />}
      {subTab === 'care'      && <CareProvisionPanel   patientId={patientId} />}
      {subTab === 'linkages'  && <LinkagesPanel patientId={patientId} />}
    </Box>
  );
}

interface ClinicalSummaryPanelProps { patientId: string }
function ClinicalSummaryPanel({ patientId }: ClinicalSummaryPanelProps) {
  const queryClient = useQueryClient();
  const { data: patient } = usePatient(patientId);
  const { data: alerts }  = useQuery({
    queryKey: patientsKeys.alerts(patientId),
    queryFn:  () => apiClient.get<{ alerts: SummaryAlertRow[] }>(`patients/${patientId}/alerts`).then(r => r.alerts),
    enabled:  !!patientId,
  });
  const { data: episodes } = useQuery({
    queryKey: episodesKeys.byPatient(patientId),
    queryFn:  () => apiClient.get<{ data: SummaryEpisodeRow[] }>(`episodes/patient/${patientId}`).then(r => r.data),
    enabled:  !!patientId,
  });
  const { data: diagnosisRows = [] } = useQuery({
    queryKey: patientsKeys.diagnoses(patientId),
    queryFn: () =>
      apiClient
        .get<{ data?: SummaryDiagnosisLookupRow[] } | SummaryDiagnosisLookupRow[]>(`patients/${patientId}/diagnoses`)
        .then((payload) => (Array.isArray(payload) ? payload : (payload.data ?? []))),
    enabled: !!patientId,
  });
  const { data: notes } = useQuery({
    queryKey: patientsKeys.notes(patientId),
    queryFn:  () => apiClient.get<{ notes: SummaryNoteRow[] }>(`patients/${patientId}/notes`).then(r => r.notes ?? []),
    enabled:  !!patientId,
  });
  const { data: meds } = useQuery({
    queryKey: patientMedicationsKeys.byPatient(patientId),
    queryFn:  () => apiClient.get<{ data: SummaryMedicationRow[] }>(`medications/patients/${patientId}/medications`).then(r => r.data ?? []),
    enabled:  !!patientId,
  });
  const { data: physicalHealth } = useQuery({
    queryKey: physicalHealthKeys.latest(patientId),
    queryFn:  () => apiClient.get<{ data: PhysicalHealthSource[] }>(`nursing-assessments`, {
      patientId,
      assessmentType: 'physical_tracking',
      limit: 1,
    }).then(r => {
      const row = (r.data ?? [])[0];
      if (!row) return null;
      const ad = row.assessmentData && Object.keys(row.assessmentData).length > 0 ? row.assessmentData : null;
      const scores = (ad ?? row.scores ?? {}) as PhysicalHealthSource;
      return {
        weight: scores.weight ?? row.weight,
        bmi: scores.bmi ?? row.bmi,
        systolicBp: scores.systolicBp ?? scores.bpSystolic ?? row.systolicBp ?? row.bpSystolic,
        diastolicBp: scores.diastolicBp ?? scores.bpDiastolic ?? row.diastolicBp ?? row.bpDiastolic,
        bloodPressure: row.bloodPressure,
        heartRate: scores.heartRate ?? scores.heart_rate ?? row.heartRate,
        pulse: row.pulse,
        assessmentDate: row.assessmentDatetime ?? row.createdAt,
        createdAt: row.createdAt,
      };
    }),
    enabled: !!patientId,
  });
  const { data: signoffRows = [] } = useQuery({
    queryKey: patientsKeys.summarySignoffs(patientId),
    queryFn: () => apiClient.get<{ signoffs?: SummarySignoffRecord[] }>(`patients/${patientId}/summary-signoffs`).then((r) => r.signoffs ?? []),
    enabled: !!patientId,
    staleTime: 60_000,
  });

  const [editFormulation, setEditFormulation] = useState(false);
  const [formulationText, setFormulationText] = useState('');
  const [editSummary, setEditSummary] = useState(false);
  const [summaryText, setSummaryText] = useState('');
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [aiFormulation, setAiFormulation] = useState<string | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [formulationLoading, setFormulationLoading] = useState(false);
  const [summaryPersisting, setSummaryPersisting] = useState(false);
  const [formulationPersisting, setFormulationPersisting] = useState(false);
  const [summaryError, setSummaryError] = useState('');
  const [formulationError, setFormulationError] = useState('');
  const [lastGenerated, setLastGenerated] = useState<string | null>(null);
  const [summaryNoteId, setSummaryNoteId] = useState<string | null>(null);
  const [formulationNoteId, setFormulationNoteId] = useState<string | null>(null);
  const loadedSummaryNoteRef = useRef<string>('');
  const loadedFormulationNoteRef = useRef<string>('');
  const [expandedSections, setExpandedSections] = useState({
    snapshot: true,
    diagnosis: true,
    longitudinal: true,
    formulation: true,
  });

  if (!patient) return null;

  const age = calculateAge(patient.dateOfBirth);
  const activeAlerts  = alerts?.filter(a => a.isActive) ?? [];
  const allNotes = notes ?? [];
  const allMeds = meds ?? [];
  const primaryDiagnosisSnapshot = useMemo(
    () => resolvePrimaryDiagnosisSnapshot(episodes ?? [], diagnosisRows),
    [episodes, diagnosisRows],
  );
  const summarySignoff = signoffRows.find((row) => row.section === 'longitudinal_summary');
  const formulationSignoff = signoffRows.find((row) => row.section === 'clinical_formulation');
  const summaryResetLocked = Boolean(summarySignoff);
  const formulationResetLocked = Boolean(formulationSignoff);

  const summaryArtifacts = useMemo(
    () => listArtifactNotes(allNotes, LONGITUDINAL_SUMMARY_NOTE_TYPE),
    [allNotes],
  );
  const formulationArtifacts = useMemo(
    () => listArtifactNotes(allNotes, CLINICAL_FORMULATION_NOTE_TYPE),
    [allNotes],
  );
  const persistedSummary = useMemo(() => findLatestArtifactNote(allNotes, LONGITUDINAL_SUMMARY_NOTE_TYPE), [allNotes]);
  const persistedFormulation = useMemo(() => findLatestArtifactNote(allNotes, CLINICAL_FORMULATION_NOTE_TYPE), [allNotes]);
  const summaryHistory = useMemo(() => summaryArtifacts.slice(1), [summaryArtifacts]);
  const formulationHistory = useMemo(() => formulationArtifacts.slice(1), [formulationArtifacts]);

  useEffect(() => {
    const snapshot = `${persistedSummary.id ?? ''}::${persistedSummary.content}`;
    if (loadedSummaryNoteRef.current === snapshot) return;
    loadedSummaryNoteRef.current = snapshot;
    setSummaryNoteId(persistedSummary.id);
    setAiSummary(persistedSummary.content ? persistedSummary.content : null);
  }, [persistedSummary.id, persistedSummary.content]);

  useEffect(() => {
    const snapshot = `${persistedFormulation.id ?? ''}::${persistedFormulation.content}`;
    if (loadedFormulationNoteRef.current === snapshot) return;
    loadedFormulationNoteRef.current = snapshot;
    setFormulationNoteId(persistedFormulation.id);
    setAiFormulation(persistedFormulation.content ? persistedFormulation.content : null);
  }, [persistedFormulation.id, persistedFormulation.content]);

  function buildPatientContext(): string {
    const lines: string[] = [];
    lines.push(`Patient: ${patient!.givenName} ${patient!.familyName}, Age ${age}, Gender: ${patient!.gender ?? 'not recorded'}, DOB: ${patient!.dateOfBirth}`);
    lines.push('');

    lines.push('EPISODES:');
    if (episodes?.length) {
      episodes.forEach(e => {
        lines.push(`- ${e.title ?? 'Untitled'} (${e.episodeType ?? 'unknown'}) — Status: ${e.status}, Start: ${e.startDate ?? 'unknown'}${e.endDate ? `, End: ${e.endDate}` : ''}`);
        if (e.primaryDiagnosis) lines.push(`  Diagnosis: ${e.primaryDiagnosis}`);
      });
    } else lines.push('- None recorded');

    lines.push('\nCURRENT MEDICATIONS:');
    const active = allMeds.filter(m => m.status === 'active');
    if (active.length) {
      active.forEach(m => lines.push(`- ${m.medicationName} ${m.dose ?? ''} ${m.route ?? ''} ${m.frequency ?? ''} (since ${m.prescribedAt ?? 'unknown'})`));
    } else lines.push('- None recorded');

    const ceased = allMeds.filter(m => m.status === 'ceased');
    if (ceased.length) {
      lines.push('\nCEASED MEDICATIONS:');
      ceased.slice(0, 10).forEach(m => lines.push(`- ${m.medicationName} ${m.dose ?? ''} (ceased ${m.ceasedAt ?? 'unknown'}${m.ceasedReason ? ` — ${m.ceasedReason}` : ''})`));
    }

    lines.push('\nACTIVE ALERTS / RISK FLAGS:');
    if (activeAlerts.length) {
      activeAlerts.forEach(a => lines.push(`- ${a.title} (${a.alertSeverity ?? 'unknown severity'})${a.description ? `: ${a.description}` : ''}`));
    } else lines.push('- None');

    const recentNotes = [...allNotes].sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '')).slice(0, 10);
    lines.push(`\nRECENT CLINICAL NOTES (${recentNotes.length} of ${allNotes.length} total):`);
    recentNotes.forEach(n => {
      const date = n.createdAt ? fmtDate(n.createdAt) : 'unknown';
      const type = noteTypeLabel(n.noteType);
      lines.push(`\n--- ${type} (${date}) by ${n.authorName ?? 'unknown'} ---`);
      if (n.title) lines.push(`Title: ${n.title}`);
      const text = (n.assessmentHtml ?? n.planHtml ?? n.bodyHtml ?? '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
      if (text) lines.push(text.substring(0, 500));
    });

    return lines.join('\n');
  }

  const persistSummaryArtifact = async (
    content: string,
    options?: { createNewVersion?: boolean },
  ) => {
    setSummaryPersisting(true);
    try {
      const nextId = await upsertSummaryArtifactNote({
        patientId,
        noteId: summaryNoteId,
        noteType: LONGITUDINAL_SUMMARY_NOTE_TYPE,
        title: LONGITUDINAL_SUMMARY_NOTE_TITLE,
        content,
        createNewVersion: options?.createNewVersion === true,
      });
      setSummaryNoteId(nextId);
      await queryClient.invalidateQueries({ queryKey: patientsKeys.notes(patientId) });
    } finally {
      setSummaryPersisting(false);
    }
  };

  const persistFormulationArtifact = async (
    content: string,
    options?: { createNewVersion?: boolean },
  ) => {
    setFormulationPersisting(true);
    try {
      const nextId = await upsertSummaryArtifactNote({
        patientId,
        noteId: formulationNoteId,
        noteType: CLINICAL_FORMULATION_NOTE_TYPE,
        title: CLINICAL_FORMULATION_NOTE_TITLE,
        content,
        createNewVersion: options?.createNewVersion === true,
      });
      setFormulationNoteId(nextId);
      await queryClient.invalidateQueries({ queryKey: patientsKeys.notes(patientId) });
    } finally {
      setFormulationPersisting(false);
    }
  };

  const generateSummary = async () => {
    setSummaryLoading(true); setSummaryError('');
    try {
      const data = buildPatientContext();
      const resp = await apiClient.instance.post<{ result: string }>('llm/clinical-ai', {
        action: 'maudsley', data, patientId, enhance: true,
      }, { timeout: 180_000 }); // 3 min — local LLM can be slow
      const nextSummary = resp.data.result.trim();
      setAiSummary(nextSummary);
      await persistSummaryArtifact(nextSummary, {
        createNewVersion: Boolean(summarySignoff),
      });
      setLastGenerated(new Date().toLocaleString('en-AU'));
    } catch (err: unknown) {
      const msg = extractErrorMessage(err, 'Failed to generate summary.');
      setSummaryError(msg.includes('timeout') ? 'Generation timed out. Try again or check that Ollama is running.' : msg);
    } finally {
      setSummaryLoading(false);
    }
  };

  const generateFormulation = async () => {
    setFormulationLoading(true); setFormulationError('');
    try {
      const data = buildPatientContext();
      const resp = await apiClient.instance.post<{ result: string }>('llm/clinical-ai', {
        action: 'formulation', data, patientId, enhance: true,
      }, { timeout: 180_000 }); // 3 min
      const nextFormulation = resp.data.result.trim();
      setAiFormulation(nextFormulation);
      await persistFormulationArtifact(nextFormulation, {
        createNewVersion: Boolean(formulationSignoff),
      });
    } catch (err: unknown) {
      const msg = extractErrorMessage(err, 'Failed to generate formulation.');
      setFormulationError(msg.includes('timeout') ? 'Generation timed out. Try again or check that Ollama is running.' : msg);
    } finally {
      setFormulationLoading(false);
    }
  };

  const hardResetSummary = async () => {
    if (summaryResetLocked) return;
    setSummaryError('');
    try {
      await persistSummaryArtifact('');
      setAiSummary(null);
      setEditSummary(false);
      setSummaryText('');
    } catch (err) {
      setSummaryError(extractErrorMessage(err, 'Failed to reset summary.'));
    }
  };

  const hardResetFormulation = async () => {
    if (formulationResetLocked) return;
    setFormulationError('');
    try {
      await persistFormulationArtifact('');
      setAiFormulation(null);
      setEditFormulation(false);
      setFormulationText('');
    } catch (err) {
      setFormulationError(extractErrorMessage(err, 'Failed to reset formulation.'));
    }
  };

  const activeMedicationList = allMeds.filter(m => m.status === 'active');
  const sortedNotesByDateDesc = [...allNotes].sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
  const lastClinicalNote = sortedNotesByDateDesc[0];
  const clinicalEncounterCount = allNotes.filter(n => CLINICAL_TYPES.has(n.noteType ?? '')).length;

  const displaySummary = aiSummary ?? `No AI summary generated yet.\n\nClick "Generate with AI" to create a longitudinal summary from ${allNotes.length} clinical note(s), ${allMeds.length} medication(s), and ${episodes?.length ?? 0} episode(s).`;
  const displayFormulation = aiFormulation ?? `No AI formulation generated yet.\n\nClick "Generate with AI" to create a biopsychosocial formulation from the patient's clinical data.`;

  return (
    <Box>
      <VivaAlertBanner patientId={patientId} />

      <Accordion
        expanded={expandedSections.snapshot}
        onChange={(_evt, isExpanded) => setExpandedSections((prev) => ({ ...prev, snapshot: isExpanded }))}
        sx={{ mb: 2, '&:before': { display: 'none' } }}
      >
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography variant="subtitle2" fontWeight={700} fontFamily="Albert Sans, sans-serif">
            Patient Snapshot
          </Typography>
        </AccordionSummary>
        <AccordionDetails sx={{ pt: 0.5 }}>
          <Grid container spacing={2}>
            <Grid size={{ xs: 6, sm: 4, md: 2 }}>
              <BmiCard physicalHealth={physicalHealth} />
            </Grid>
            <Grid size={{ xs: 6, sm: 4, md: 2 }}>
              <PhysicalHealthCard physicalHealth={physicalHealth} />
            </Grid>
            <Grid size={{ xs: 6, sm: 4, md: 2 }}>
              <QuickCard icon={<PsychologyIcon sx={{ color: '#327C8D', fontSize: 22 }} />} label="Primary Diagnosis"
                value={primaryDiagnosisSnapshot.value}
                sub={primaryDiagnosisSnapshot.sub} />
            </Grid>
            <Grid size={{ xs: 6, sm: 4, md: 2 }}>
              <QuickCard icon={<LocalHospitalIcon sx={{ color: '#D32F2F', fontSize: 22 }} />} label="Active Medications"
                value={`${activeMedicationList.length}`}
                sub={activeMedicationList.length > 0
                  ? activeMedicationList.slice(0, 2).map(m => m.medicationName ?? m.drugLabel).join(', ')
                  : 'No active medications'} />
            </Grid>
            <Grid size={{ xs: 6, sm: 4, md: 2 }}>
              <QuickCard icon={<EventNoteIcon sx={{ color: '#b8621a', fontSize: 22 }} />} label="Last Clinical Contact"
                value={lastClinicalNote?.createdAt ? fmtDateShort(lastClinicalNote.createdAt) : '—'}
                sub={lastClinicalNote ? noteTypeLabel(lastClinicalNote.noteType) : 'No contacts recorded'} />
            </Grid>
            <Grid size={{ xs: 6, sm: 4, md: 2 }}>
              <QuickCard icon={<PeopleAltIcon sx={{ color: '#327C8D', fontSize: 22 }} />} label="Total Encounters"
                value={`${clinicalEncounterCount}`}
                sub={`${activeAlerts.length} active alert${activeAlerts.length !== 1 ? 's' : ''}`} />
            </Grid>
          </Grid>
        </AccordionDetails>
      </Accordion>

      <Accordion
        expanded={expandedSections.diagnosis}
        onChange={(_evt, isExpanded) => setExpandedSections((prev) => ({ ...prev, diagnosis: isExpanded }))}
        sx={{ mb: 2, '&:before': { display: 'none' } }}
      >
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography variant="subtitle2" fontWeight={700} fontFamily="Albert Sans, sans-serif">
            Diagnosis Summary
          </Typography>
        </AccordionSummary>
        <AccordionDetails sx={{ pt: 0 }}>
          <DiagnosisSummaryCard
            patientId={patientId}
            patient={patient}
            episodes={episodes ?? []}
            notes={allNotes}
          />
        </AccordionDetails>
      </Accordion>

      <Accordion
        expanded={expandedSections.longitudinal}
        onChange={(_evt, isExpanded) => setExpandedSections((prev) => ({ ...prev, longitudinal: isExpanded }))}
        sx={{ mb: 2, '&:before': { display: 'none' } }}
      >
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography variant="subtitle2" fontWeight={700} fontFamily="Albert Sans, sans-serif">
            Longitudinal Summary
          </Typography>
        </AccordionSummary>
        <AccordionDetails sx={{ pt: 0 }}>
      <Paper variant="outlined" sx={{ p: 2.5, mb: 0, borderLeft: '4px solid #b8621a' }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <AutoAwesomeIcon sx={{ color: '#b8621a', fontSize: 20 }} />
            <Typography variant="subtitle1" fontWeight={700} fontFamily="Albert Sans, sans-serif">Longitudinal Summary</Typography>
            <Chip label="AI Generated — Maudsley Format" size="small" sx={{ fontSize: 9, height: 18, bgcolor: '#FFF3E0', color: '#E65100' }} />
            {lastGenerated && (
              <Tooltip title={`Last generated: ${lastGenerated}`}>
                <Chip icon={<AccessTimeIcon sx={{ fontSize: 12 }} />} label={lastGenerated} size="small"
                  sx={{ fontSize: 9, height: 18, ml: 0.5 }} variant="outlined" />
              </Tooltip>
            )}
            <SectionSignoffControls patientId={patientId} section="longitudinal_summary" />
          </Box>
          <Box sx={{ display: 'flex', gap: 0.5 }}>
            <Button size="small" startIcon={summaryLoading ? <CircularProgress role="progressbar" aria-label="Loading" size={12} /> : <AutoAwesomeIcon />}
              onClick={generateSummary} disabled={summaryLoading || summaryPersisting}
              sx={{ color: '#b8621a', fontSize: 11, fontWeight: 600 }}>
              {summaryLoading ? 'Generating...' : aiSummary ? 'Regenerate' : 'Generate with AI'}
            </Button>
            {aiSummary && (
              <Button size="small" startIcon={<EditIcon />}
                onClick={() => { setEditSummary(!editSummary); setSummaryText(aiSummary); }}
                disabled={summaryResetLocked}
                sx={{ color: '#b8621a', fontSize: 11 }}>
                {editSummary ? 'Cancel' : 'Edit'}
              </Button>
            )}
            {aiSummary && (
              <Tooltip title={summaryResetLocked ? 'Reset disabled after consultant sign-off' : 'Explicitly reset this stored summary'}>
                <span>
                  <Button
                    size="small"
                    onClick={hardResetSummary}
                    disabled={summaryPersisting || summaryResetLocked}
                    sx={{ color: summaryResetLocked ? 'text.disabled' : '#8D6E63', fontSize: 11 }}
                  >
                    Hard reset
                  </Button>
                </span>
              </Tooltip>
            )}
          </Box>
        </Box>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
          Longitudinal clinical history from {allNotes.length} note(s), {allMeds.length} medication(s), {episodes?.length ?? 0} episode(s).
          {aiSummary ? ' Persisted summary is retained until explicitly reset.' : ' Click "Generate with AI" to build and persist the summary.'}
        </Typography>
        {summaryResetLocked && (
          <Alert severity="info" sx={{ mb: 1, fontSize: 12 }}>
            This summary is consultant signed-off. It cannot be hard reset, but you can generate a new version and prior signed versions stay in history.
          </Alert>
        )}
        {summaryError && <Alert role="alert" severity="error" sx={{ mb: 1, fontSize: 12 }}>{summaryError}</Alert>}
        {editSummary ? (
          <Box>
            <TextField fullWidth multiline rows={20} value={summaryText} onChange={e => setSummaryText(e.target.value)}
              sx={{ '& .MuiInputBase-input': { fontFamily: 'monospace', fontSize: 12 } }} />
            <Box sx={{ mt: 1, display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
              <Button size="small" onClick={() => setEditSummary(false)} sx={{ color: 'text.secondary' }}>Cancel</Button>
              <Button size="small" variant="contained" onClick={async () => {
                  if (summaryResetLocked) return;
                  const nextSummary = summaryText.trim();
                  setAiSummary(nextSummary || null);
                  try {
                    await persistSummaryArtifact(nextSummary);
                    setEditSummary(false);
                  } catch (e) {
                    setSummaryError(extractErrorMessage(e, 'Failed to persist summary.'));
                  }
                }}
                disabled={summaryPersisting || summaryResetLocked}
                sx={{ bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' } }}>Save</Button>
            </Box>
          </Box>
        ) : (
          <Box sx={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: 12, color: '#3D484B', maxHeight: 400, overflowY: 'auto', bgcolor: '#FAFAFA', p: 2, borderRadius: 1 }}>
            {displaySummary}
          </Box>
        )}
        {renderArtifactHistoryCard('Previous Longitudinal Summaries', summaryHistory)}
      </Paper>
        </AccordionDetails>
      </Accordion>

      <Accordion
        expanded={expandedSections.formulation}
        onChange={(_evt, isExpanded) => setExpandedSections((prev) => ({ ...prev, formulation: isExpanded }))}
        sx={{ mb: 2, '&:before': { display: 'none' } }}
      >
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography variant="subtitle2" fontWeight={700} fontFamily="Albert Sans, sans-serif">
            Clinical Formulation
          </Typography>
        </AccordionSummary>
        <AccordionDetails sx={{ pt: 0 }}>
      <Paper variant="outlined" sx={{ p: 2.5, mb: 0, borderLeft: '4px solid #327C8D' }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <PsychologyIcon sx={{ color: '#327C8D', fontSize: 20 }} />
            <Typography variant="subtitle1" fontWeight={700} fontFamily="Albert Sans, sans-serif">Clinical Formulation</Typography>
            <Chip label="Biopsychosocial" size="small" sx={{ fontSize: 9, height: 18, bgcolor: '#E0F2F1', color: '#327C8D' }} />
            <SectionSignoffControls patientId={patientId} section="clinical_formulation" />
          </Box>
          <Box sx={{ display: 'flex', gap: 0.5 }}>
            <Button size="small" startIcon={formulationLoading ? <CircularProgress role="progressbar" aria-label="Loading" size={12} /> : <AutoAwesomeIcon />}
              onClick={generateFormulation} disabled={formulationLoading || formulationPersisting}
              sx={{ color: '#327C8D', fontSize: 11, fontWeight: 600 }}>
              {formulationLoading ? 'Generating...' : aiFormulation ? 'Regenerate' : 'Generate with AI'}
            </Button>
            {aiFormulation && (
              <Button size="small" startIcon={<EditIcon />}
                onClick={() => { setEditFormulation(!editFormulation); setFormulationText(aiFormulation); }}
                disabled={formulationResetLocked}
                sx={{ color: '#327C8D', fontSize: 11 }}>
                {editFormulation ? 'Cancel' : 'Edit'}
              </Button>
            )}
            {aiFormulation && (
              <Tooltip title={formulationResetLocked ? 'Reset disabled after consultant sign-off' : 'Explicitly reset this stored formulation'}>
                <span>
                  <Button
                    size="small"
                    onClick={hardResetFormulation}
                    disabled={formulationPersisting || formulationResetLocked}
                    sx={{ color: formulationResetLocked ? 'text.disabled' : '#8D6E63', fontSize: 11 }}
                  >
                    Hard reset
                  </Button>
                </span>
              </Tooltip>
            )}
          </Box>
        </Box>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
          Predisposing, precipitating, perpetuating, and protective factors.
          {aiFormulation ? ' Persisted formulation is retained until explicitly reset.' : ' Click "Generate with AI" to build and persist the formulation.'}
        </Typography>
        {formulationResetLocked && (
          <Alert severity="info" sx={{ mb: 1, fontSize: 12 }}>
            This formulation is consultant signed-off. It cannot be hard reset, but you can generate a new version and prior signed versions stay in history.
          </Alert>
        )}
        {formulationError && <Alert role="alert" severity="error" sx={{ mb: 1, fontSize: 12 }}>{formulationError}</Alert>}
        {editFormulation ? (
          <Box>
            <TextField fullWidth multiline rows={16} value={formulationText} onChange={e => setFormulationText(e.target.value)}
              sx={{ '& .MuiInputBase-input': { fontFamily: 'monospace', fontSize: 12 } }} />
            <Box sx={{ mt: 1, display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
              <Button size="small" onClick={() => setEditFormulation(false)} sx={{ color: 'text.secondary' }}>Cancel</Button>
              <Button size="small" variant="contained" onClick={async () => {
                  if (formulationResetLocked) return;
                  const nextFormulation = formulationText.trim();
                  setAiFormulation(nextFormulation || null);
                  try {
                    await persistFormulationArtifact(nextFormulation);
                    setEditFormulation(false);
                  } catch (e) {
                    setFormulationError(extractErrorMessage(e, 'Failed to persist formulation.'));
                  }
                }}
                disabled={formulationPersisting || formulationResetLocked}
                sx={{ bgcolor: '#327C8D', '&:hover': { bgcolor: '#265f6d' } }}>Save</Button>
            </Box>
          </Box>
        ) : (
          <Box sx={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: 12, color: '#3D484B', maxHeight: 350, overflowY: 'auto', bgcolor: '#FAFAFA', p: 2, borderRadius: 1 }}>
            {displayFormulation}
          </Box>
        )}
        {renderArtifactHistoryCard('Previous Clinical Formulations', formulationHistory)}
      </Paper>
        </AccordionDetails>
      </Accordion>

    </Box>
  );
}

interface LifeChartPanelProps { patientId: string }
function LifeChartPanel({ patientId }: LifeChartPanelProps) {
  const qc = useQueryClient();
  const [refreshing, setRefreshing] = React.useState(false);
  const { data: patient } = usePatient(patientId);
  const { data: episodes } = useQuery({
    queryKey: episodesKeys.lifeChart(patientId),
    queryFn: () => apiClient.get<{ data: SummaryEpisodeRow[] }>(`episodes/patient/${patientId}`).then(r => r.data ?? []),
    enabled: !!patientId,
  });
  const { data: notes } = useQuery({
    queryKey: patientsKeys.notesLifechart(patientId),
    queryFn: () => apiClient.get<{ notes: SummaryNoteRow[] }>(`patients/${patientId}/notes`).then(r => r.notes ?? []),
    enabled: !!patientId,
  });
  const { data: meds } = useQuery({
    queryKey: patientMedicationsKeys.lifechart(patientId),
    queryFn: () => apiClient.get<{ data: SummaryMedicationRow[] }>(`medications/patients/${patientId}/medications`).then(r => r.data ?? []),
    enabled: !!patientId,
  });
  const { data: risks } = useQuery({
    queryKey: riskAllergiesKeys.risksLifechart(patientId),
    queryFn: () => apiClient.get<unknown>(`patients/${patientId}/risk-assessments`).then(r => (Array.isArray(r) ? (r as SummaryRiskAssessmentRow[]) : [])).catch((err) => { console.warn('SummaryTab: query failed', err); return []; }),
    enabled: !!patientId,
  });
  const { data: alerts } = useQuery({
    queryKey: patientsKeys.alertsLifechart(patientId),
    queryFn: () => apiClient.get<{ alerts: SummaryAlertRow[] }>(`patients/${patientId}/alerts`).then(r => r.alerts ?? []),
    enabled: !!patientId,
  });
  const { data: signoffRows = [] } = useQuery({
    queryKey: patientsKeys.summarySignoffs(patientId),
    queryFn: () =>
      apiClient
        .get<{ signoffs?: SummarySignoffRecord[] }>(`patients/${patientId}/summary-signoffs`)
        .then((r) => r.signoffs ?? []),
    enabled: !!patientId,
    staleTime: 60_000,
  });

  const [schemaDoc, setSchemaDoc] = React.useState<LifeChartSchemaDoc | null>(null);
  const [schemaLoading, setSchemaLoading] = React.useState(false);
  const [schemaSaving, setSchemaSaving] = React.useState(false);
  const [schemaError, setSchemaError] = React.useState('');
  const [schemaInfo, setSchemaInfo] = React.useState('');
  const schemaInitializedRef = React.useRef(false);

  if (!patient) return <CircularProgress role="progressbar" aria-label="Loading" size={24} />;

  const dob = patient.dateOfBirth;
  const allEpisodes = episodes ?? [];
  const allNotes = notes ?? [];
  const allMeds = meds ?? [];
  const allRisks = risks ?? [];
  const allAlerts = alerts ?? [];

  const lifeChartSignoff = signoffRows.find((row) => row.section === 'life_chart');
  const schemaArtifactVersions = React.useMemo(
    () => listArtifactNotes(allNotes, LIFECHART_SCHEMA_NOTE_TYPE),
    [allNotes],
  );
  const persistedSchemaNote = React.useMemo(
    () => schemaArtifactVersions[0] ?? null,
    [schemaArtifactVersions],
  );
  const schemaHistory = React.useMemo(
    () => schemaArtifactVersions.slice(1),
    [schemaArtifactVersions],
  );

  React.useEffect(() => {
    if (schemaInitializedRef.current) return;
    if (!patient || episodes === undefined || notes === undefined || meds === undefined) return;
    const fallbackDoc = buildHeuristicSchemaDoc(patient, episodes ?? [], notes ?? [], meds ?? []);
    if (persistedSchemaNote?.content) {
      try {
        const parsed = normalizeSchemaDoc(JSON.parse(persistedSchemaNote.content), fallbackDoc);
        if (parsed) {
          setSchemaDoc(parsed.generatedBy === 'heuristic' ? fallbackDoc : parsed);
          schemaInitializedRef.current = true;
          return;
        }
      } catch (err) {
        console.warn('LifeChart schema parse failed; falling back to heuristic model', err);
      }
    }
    setSchemaDoc(fallbackDoc);
    schemaInitializedRef.current = true;
  }, [patient, episodes, notes, meds, persistedSchemaNote]);

  const resetSchemaHeuristic = React.useCallback(() => {
    setSchemaDoc(buildHeuristicSchemaDoc(patient, allEpisodes, allNotes, allMeds));
    setSchemaInfo('Schema reset from clinical data.');
    setSchemaError('');
  }, [patient, allEpisodes, allNotes, allMeds]);

  const generateSchemaWithAi = React.useCallback(async () => {
    setSchemaLoading(true);
    setSchemaError('');
    setSchemaInfo('');
    try {
      const prompt = buildLifeChartSchemaPrompt({
        patient,
        episodes: allEpisodes,
        notes: allNotes,
        medications: allMeds,
        clinicTimeZone: schemaDoc?.clinicTimeZone ?? DEFAULT_CLINIC_TIME_ZONE,
      });
      const resp = await apiClient.instance.post<{ result: string }>('llm/clinical-ai', {
        action: 'lifechart-schema',
        data: prompt,
        patientId,
        enhance: true,
      }, { timeout: 180_000 });
      const fallback = buildHeuristicSchemaDoc(patient, allEpisodes, allNotes, allMeds);
      const parsed = parseSchemaDocFromLlm(resp.data.result, fallback);
      if (!parsed) {
        setSchemaError('AI returned an invalid schema format. You can keep editing the existing schema manually.');
        return;
      }
      setSchemaDoc(parsed);
      setSchemaInfo('AI schema generated. Review and edit before saving.');
    } catch (err) {
      setSchemaError(extractErrorMessage(err, 'Failed to generate lifechart schema.'));
    } finally {
      setSchemaLoading(false);
    }
  }, [patient, allEpisodes, allNotes, allMeds, patientId]);

  const saveSchema = React.useCallback(async () => {
    if (!schemaDoc) return;
    setSchemaSaving(true);
    setSchemaError('');
    setSchemaInfo('');
    try {
      const content = stringifySchemaDoc(schemaDoc);
      if (persistedSchemaNote?.id && !lifeChartSignoff) {
        await apiClient.patch(`patients/${patientId}/notes/${persistedSchemaNote.id}`, {
          title: LIFECHART_SCHEMA_NOTE_TITLE,
          noteType: LIFECHART_SCHEMA_NOTE_TYPE,
          content,
          status: 'draft',
        });
      } else {
        await apiClient.post(`patients/${patientId}/notes`, {
          title: LIFECHART_SCHEMA_NOTE_TITLE,
          noteType: LIFECHART_SCHEMA_NOTE_TYPE,
          content,
          status: 'draft',
          isAiDraft: true,
        });
      }
      await qc.invalidateQueries({ queryKey: patientsKeys.notesLifechart(patientId) });
      setSchemaInfo('Schema saved.');
    } catch (err) {
      setSchemaError(extractErrorMessage(err, 'Failed to save lifechart schema.'));
    } finally {
      setSchemaSaving(false);
    }
  }, [schemaDoc, persistedSchemaNote?.id, patientId, qc, lifeChartSignoff]);

  const dates: string[] = [];
  allEpisodes.forEach(e => { if (e.startDate) dates.push(e.startDate); if (e.endDate) dates.push(e.endDate); });
  allNotes.forEach(n => { if (n.createdAt) dates.push(n.createdAt); });
  allMeds.forEach(m => {
    const medDate = m.prescribedAt ?? m.createdAt;
    if (medDate) {
      dates.push(medDate);
    }
  });
  (schemaDoc?.rows ?? []).forEach((row) => {
    if (row.startDate) dates.push(row.startDate);
    if (row.endDate) dates.push(row.endDate);
  });
  if (dob) dates.push(dob);

  const timestamps = dates.map(d => new Date(d).getTime()).filter(t => !isNaN(t));
  if (timestamps.length === 0) {
    return (
      <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }}>
        <Typography color="text.secondary">No clinical data available to generate a life chart.</Typography>
      </Paper>
    );
  }

  const minTime = Math.min(...timestamps);
  const maxTime = Math.max(...timestamps, Date.now());
  const startYear = new Date(minTime).getFullYear();
  const endYear = new Date(maxTime).getFullYear();
  const years = Array.from({ length: endYear - startYear + 1 }, (_, i) => endYear - i);
  const pattern = classifyIllnessPattern(allEpisodes);
  const hasSchemaRows = Boolean(schemaDoc && schemaDoc.rows.length > 0);
  const symptomMode = hasSchemaRows
    ? (schemaDoc?.symptomMode ?? 'bidirectional')
    : (pattern === 'episodic_bipolar' ? 'bidirectional' : 'severity');
  const isBipolar = symptomMode === 'bidirectional';
  const isContinuous = pattern === 'continuous';
  const primaryDomainLabel = getPrimaryDomainDisplayLabel(schemaDoc?.primaryDomain);

  const LEFT_LABEL = 130;
  const RIGHT_PAD = 20;
  const CHART_WIDTH = Math.max(900, years.length * 90);
  const TOTAL_WIDTH = LEFT_LABEL + CHART_WIDTH + RIGHT_PAD;
  const YEAR_W = CHART_WIDTH / years.length;

  const MED_H = 70;
  const SYMPTOM_H = 220;
  const RESIDUAL_H = 80;
  const SUBSTANCE_H = 52;
  const CARE_H = 56;
  const EVENT_H = 90;
  const TOTAL_H = MED_H + SYMPTOM_H + RESIDUAL_H + SUBSTANCE_H + CARE_H + EVENT_H + 30;
  const SYMPTOM_BASELINE_Y = isBipolar ? MED_H + SYMPTOM_H / 2 : MED_H + SYMPTOM_H - 15;
  const SYMPTOM_SCALE = isBipolar ? (SYMPTOM_H / 2 - 15) : (SYMPTOM_H - 30);
  const RESIDUAL_TOP_Y = MED_H + SYMPTOM_H + 5;
  const SUBSTANCE_TOP_Y = RESIDUAL_TOP_Y + RESIDUAL_H;
  const CARE_TOP_Y = SUBSTANCE_TOP_Y + SUBSTANCE_H;
  const EVENT_TOP_Y = CARE_TOP_Y + CARE_H;

  const rangeStart = new Date(startYear, 0, 1).getTime();
  const rangeEnd = new Date(endYear + 1, 0, 1).getTime();
  const toX = (date: string | Date | null | undefined) => {
    const parsed = parseDate(date);
    if (!parsed) {
      return LEFT_LABEL;
    }
    const t = parsed.getTime();
    const clamped = Math.min(Math.max(t, rangeStart), rangeEnd);
    return LEFT_LABEL + ((rangeEnd - clamped) / (rangeEnd - rangeStart)) * CHART_WIDTH;
  };

  const scoreToY = (score: number): number => {
    if (isBipolar) {
      const normalized = Math.max(-4, Math.min(4, score)) / 4;
      return SYMPTOM_BASELINE_Y - normalized * SYMPTOM_SCALE;
    }
    const normalized = Math.max(0, Math.min(4, score)) / 4;
    return SYMPTOM_BASELINE_Y - normalized * SYMPTOM_SCALE;
  };

  const severityMap: Record<string, number> = { severe: 1, high: 0.85, moderate: 0.6, mild: 0.33, low: 0.15 };

  const episodeData = allEpisodes.map(ep => {
    const startXRaw = toX(ep.startDate);
    const endXRaw = ep.endDate ? toX(ep.endDate) : toX(new Date());
    const x1 = Math.min(startXRaw, endXRaw);
    const x2 = Math.max(startXRaw, endXRaw);
    const typeStr = ((ep.episodeType ?? '') + ' ' + (ep.primaryDiagnosis ?? '')).toLowerCase();
    const sev = severityMap[(ep.severity ?? 'moderate').toLowerCase()] ?? 0.5;

    let direction: 'up' | 'down' | 'both' = 'up';
    let color = '#7B1FA2';
    let typeLabel = ep.episodeType ?? 'Episode';
    if (typeStr.includes('mani') || typeStr.includes('hypo')) { direction = 'up'; color = '#D32F2F'; typeLabel = 'Mania'; }
    else if (typeStr.includes('depress') || typeStr.includes('mdd')) { direction = 'down'; color = '#1565C0'; typeLabel = 'Depression'; }
    else if (typeStr.includes('psycho') || typeStr.includes('schizo')) { direction = 'up'; color = '#9C27B0'; typeLabel = 'Psychosis'; }
    else if (typeStr.includes('anxiety') || typeStr.includes('gad') || typeStr.includes('ptsd')) { direction = 'up'; color = '#b8621a'; typeLabel = 'Anxiety/PTSD'; }
    else if (typeStr.includes('eating') || typeStr.includes('anorexi') || typeStr.includes('bulimi')) { direction = 'down'; color = '#00838F'; typeLabel = 'Eating Disorder'; }
    else if (typeStr.includes('personality') || typeStr.includes('bpd')) { direction = 'both'; color = '#E65100'; typeLabel = 'Personality'; }

    return {
      id: ep.id,
      x1,
      x2,
      w: Math.max(x2 - x1, 4),
      sev,
      direction,
      color,
      typeLabel,
      onsetX: startXRaw,
      remissionX: endXRaw,
      ongoing: !ep.endDate || ep.status === 'open',
      startDate: ep.startDate,
      endDate: ep.endDate,
      diagnosis: ep.primaryDiagnosis,
      title: ep.title,
      status: ep.status,
      episodeType: ep.episodeType,
    };
  });

  const schemaRows = (schemaDoc?.rows ?? [])
    .filter((r) => r.startDate || r.endDate || r.intervalLabel || r.primaryState)
    .map((r) => ({
      ...r,
      primaryScore: Math.max(-4, Math.min(4, Number(r.primaryScore) || 0)),
    }));

  const schemaTimePoint = (row: LifeChartSchemaRow, index: number): number => {
    const start = parseDate(row.startDate);
    const end = parseDate(row.endDate);
    if (start && end) {
      return (start.getTime() + end.getTime()) / 2;
    }
    const single = start ?? end;
    if (single) return single.getTime();
    if (schemaRows.length <= 1) return rangeStart;
    return rangeStart + ((rangeEnd - rangeStart) * index) / (schemaRows.length - 1);
  };
  const orderedSchemaRows = schemaRows
    .map((row, index) => ({ row, index, ts: schemaTimePoint(row, index) }))
    .sort((a, b) => a.ts - b.ts);

  const symptomPoints: { x: number; y: number }[] = [];
  if (schemaRows.length > 0) {
    orderedSchemaRows
      .forEach(({ row, ts }) => {
        const midpoint = ts;
        const x = LEFT_LABEL + ((rangeEnd - midpoint) / (rangeEnd - rangeStart)) * CHART_WIDTH;
        symptomPoints.push({ x, y: scoreToY(row.primaryScore) });
      });
  } else {
    const sortedNotes = [...allNotes].sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
    sortedNotes.forEach(n => {
      const signal = deriveMoodSignalFromNote(n);
      if (signal.polarity === 'neutral' || signal.magnitude <= 0) return;
      const x = toX(n.createdAt);
      if (isBipolar) {
        const dir =
          signal.polarity === 'depressive'
            ? 1
            : signal.polarity === 'mixed'
              ? -0.15
              : -1;
        symptomPoints.push({ x, y: SYMPTOM_BASELINE_Y + dir * signal.magnitude * SYMPTOM_SCALE });
      } else {
        symptomPoints.push({ x, y: SYMPTOM_BASELINE_Y - signal.magnitude * SYMPTOM_SCALE });
      }
    });
  }
  if (symptomPoints.length > 0) {
    symptomPoints.unshift({ x: symptomPoints[0].x - 5, y: SYMPTOM_BASELINE_Y });
    symptomPoints.push({ x: symptomPoints[symptomPoints.length - 1].x + 5, y: SYMPTOM_BASELINE_Y });
  }

  const episodeCurves = schemaRows.length > 0
    ? schemaRows.map((row, index) => {
        const start = parseDate(row.startDate);
        const end = parseDate(row.endDate);
        const fallbackX = LEFT_LABEL + ((index + 0.1) / Math.max(schemaRows.length, 1)) * CHART_WIDTH;
        const startXRaw = start ? toX(start) : fallbackX;
        const endXRaw = end ? toX(end) : toX(new Date());
        const x1 = Math.min(startXRaw, endXRaw);
        const x2 = Math.max(startXRaw, endXRaw);
        const width = Math.max(x2 - x1, CHART_WIDTH / Math.max(schemaRows.length * 2, 12));
        const midX = x1 + width / 2;
        const rawScore = isBipolar ? row.primaryScore : Math.max(0, row.primaryScore);
        const channel = row.symptomChannel ?? 'general';
        const channelColorMap: Record<string, string> = {
          mania_hypomania: '#D32F2F',
          depression: '#1565C0',
          psychosis: '#8E24AA',
          anxiety_trauma: '#b8621a',
          substance: '#E65100',
          functioning: '#00796B',
          general: '#455A64',
        };
        const polarity: 'up' | 'down' =
          channel === 'depression'
            ? 'down'
            : (isBipolar && rawScore < 0 ? 'down' : 'up');
        const color = channelColorMap[channel] ?? (polarity === 'down' ? '#1565C0' : '#D32F2F');
        const sev = Math.max(0.15, Math.min(1, Math.abs(rawScore) / 4));
        const peakH = sev * SYMPTOM_SCALE;
        const dir = polarity === 'down' ? 1 : -1;
        const pts: { x: number; y: number }[] = [
          { x: x1, y: SYMPTOM_BASELINE_Y },
          { x: x1 + width * 0.15, y: SYMPTOM_BASELINE_Y + dir * peakH * 0.3 },
          { x: x1 + width * 0.35, y: SYMPTOM_BASELINE_Y + dir * peakH * 0.8 },
          { x: midX, y: SYMPTOM_BASELINE_Y + dir * peakH },
          { x: x1 + width * 0.65, y: SYMPTOM_BASELINE_Y + dir * peakH * 0.85 },
          { x: x1 + width * 0.85, y: SYMPTOM_BASELINE_Y + dir * peakH * 0.3 },
          { x: x1 + width, y: SYMPTOM_BASELINE_Y },
        ];
        return {
          id: row.id,
          x1,
          x2,
          w: width,
          sev,
          direction: polarity,
          color,
          typeLabel: row.primaryState || 'Symptom state',
          onsetX: startXRaw,
          remissionX: endXRaw,
          ongoing: !end,
          startDate: row.startDate,
          endDate: row.endDate,
          diagnosis: schemaDoc?.disorderLabel,
          title: row.intervalLabel,
          durationLabel: formatEpisodeDuration(row.startDate, row.endDate),
          symptomChannel: channel,
          evidenceAnchors: row.provenance?.evidenceAnchors ?? [],
          pts,
          path: buildWavePath(pts, SYMPTOM_BASELINE_Y),
          peakY: SYMPTOM_BASELINE_Y + dir * peakH,
        };
      })
    : episodeData.map(ep => {
        const midX = ep.x1 + ep.w / 2;
        const peakH = ep.sev * SYMPTOM_SCALE;
        const dir = ep.direction === 'down' ? 1 : -1;
        const pts: { x: number; y: number }[] = [
          { x: ep.x1, y: SYMPTOM_BASELINE_Y },
          { x: ep.x1 + ep.w * 0.15, y: SYMPTOM_BASELINE_Y + dir * peakH * 0.3 },
          { x: ep.x1 + ep.w * 0.35, y: SYMPTOM_BASELINE_Y + dir * peakH * 0.8 },
          { x: midX, y: SYMPTOM_BASELINE_Y + dir * peakH },
          { x: ep.x1 + ep.w * 0.65, y: SYMPTOM_BASELINE_Y + dir * peakH * 0.85 },
          { x: ep.x1 + ep.w * 0.85, y: SYMPTOM_BASELINE_Y + dir * peakH * 0.3 },
          { x: ep.x2, y: SYMPTOM_BASELINE_Y },
        ];
        return {
          ...ep,
          durationLabel: formatEpisodeDuration(ep.startDate, ep.endDate),
          pts,
          path: buildWavePath(pts, SYMPTOM_BASELINE_Y),
          peakY: SYMPTOM_BASELINE_Y + dir * peakH,
        };
      });

  const careEpisodeBlocks = allEpisodes
    .map((ep, index) => {
      const start = parseDate(ep.startDate);
      if (!start) return null;
      const end = parseDate(ep.endDate);
      const startX = toX(start);
      const endX = toX(end ?? new Date());
      const left = Math.min(startX, endX);
      const right = Math.max(startX, endX);
      const width = Math.max(right - left, 6);
      const row = index % 3;
      const y = CARE_TOP_Y + 8 + row * 14;
      const status = (ep.status ?? '').toLowerCase();
      const isOpen = status === 'open' || !end;
      const color = isOpen ? '#2E7D32' : status === 'closed' ? '#607D8B' : '#8D6E63';
      return {
        id: ep.id,
        x: left,
        width,
        y,
        color,
        isOpen,
        label: ep.title || ep.episodeType || 'Care episode',
        startDate: ep.startDate ?? null,
        endDate: ep.endDate ?? null,
        status: ep.status ?? null,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .slice(0, 36);

  const medColors = ['#E65100', '#2E7D32', '#1565C0', '#7B1FA2', '#D32F2F', '#00838F', '#AD1457', '#455A64'];
  const medBars = schemaRows.length > 0
    ? schemaRows
        .flatMap((row, idx) => {
          const medsInRow = row.medicationsStructured.length > 0
            ? row.medicationsStructured.map((entry) => ({
                label: `${entry.name}${entry.dose ? ` ${entry.dose}` : ''}`.trim(),
                startDate: entry.startDate || row.startDate,
                endDate: entry.endDate || row.endDate,
              }))
            : row.medications
              .split(/[\n;]+/)
              .map((m) => m.trim())
              .filter(Boolean)
              .map((label) => ({ label, startDate: row.startDate, endDate: row.endDate }));
          return medsInRow.map((med, medIdx) => {
            const start = med.startDate ? toX(med.startDate) : LEFT_LABEL + (idx / Math.max(schemaRows.length, 1)) * CHART_WIDTH;
            const end = med.endDate ? toX(med.endDate) : start + CHART_WIDTH / Math.max(schemaRows.length, 4);
            return {
            id: `${row.id}-${medIdx}`,
            name: med.label,
            dose: '',
            x1: start,
            x2: Math.max(start + 5, end),
            y: 5 + ((idx + medIdx) % 8) * 8,
            color: medColors[(idx + medIdx) % medColors.length],
            active: true,
            };
          });
        })
        .slice(0, 24)
    : (() => {
        const activeMeds = allMeds.filter(m => m.status === 'active' || m.status === 'ceased');
        return activeMeds.slice(0, 8).map((m, i: number) => {
          const start = m.prescribedAt ?? m.startDate ?? m.createdAt;
          const end = m.ceasedAt ?? m.endDate ?? (m.status === 'active' ? new Date().toISOString() : m.updatedAt);
          return {
            id: m.id, name: m.medicationName ?? m.drugLabel ?? 'Unknown', dose: m.dose ?? '',
            x1: start ? toX(start) : LEFT_LABEL, x2: end ? toX(end) : LEFT_LABEL + CHART_WIDTH,
            y: 5 + i * 8, color: medColors[i % medColors.length], active: m.status === 'active',
          };
        });
      })();

  const residualHits: { x: number; label: string; category: string; date: string }[] = [];
  const substanceHits: { x: number; label: string; date: string }[] = [];
  if (schemaRows.length > 0) {
    schemaRows.forEach((row, idx) => {
      const rowDate = row.startDate || row.endDate || '';
      const rowX = rowDate
        ? toX(rowDate)
        : LEFT_LABEL + ((idx + 1) / Math.max(schemaRows.length + 1, 2)) * CHART_WIDTH;
      if (row.interEpisodeFunctioning.trim()) {
        residualHits.push({
          x: rowX,
          label: row.interEpisodeFunctioning.trim(),
          category: 'functional',
          date: rowDate || new Date().toISOString(),
        });
      }
      if (row.substanceUse.trim()) {
        substanceHits.push({
          x: rowX,
          label: row.substanceUse.trim(),
          date: rowDate || new Date().toISOString(),
        });
      }
    });
  } else {
    allNotes.forEach(n => {
      const text = getNoteNarrativeText(n).toLowerCase();
      const noteDate = n.createdAt ?? n.noteDateTime ?? '';
      for (const rk of RESIDUAL_KEYWORDS) {
        if (text.match(new RegExp(rk.keyword, 'i'))) {
          if (rk.category === 'substance') {
            substanceHits.push({ x: toX(noteDate), label: rk.label, date: noteDate });
          } else {
            residualHits.push({ x: toX(noteDate), label: rk.label, category: rk.category, date: noteDate });
          }
        }
      }
    });
  }
  const seenRes = new Set<string>();
  const uniqueResiduals = residualHits.filter(r => {
    const key = `${r.label}-${new Date(r.date).getFullYear()}-${new Date(r.date).getMonth()}`;
    if (seenRes.has(key)) return false;
    seenRes.add(key);
    return true;
  });
  const seenSub = new Set<string>();
  const uniqueSubstances = substanceHits.filter((s) => {
    const key = `${s.label}-${new Date(s.date).getFullYear()}-${new Date(s.date).getMonth()}`;
    if (seenSub.has(key)) return false;
    seenSub.add(key);
    return true;
  });
  const residualCategories = [...new Set(uniqueResiduals.map(r => r.category))];
  const annotations: { x: number; label: string; color: string; direction: 'up' | 'down'; date: string; priority: number }[] = [];
  if (schemaRows.length > 0) {
    schemaRows.forEach((row, idx) => {
      const rowDate = row.startDate || row.endDate || '';
      const rowX = rowDate
        ? toX(rowDate)
        : LEFT_LABEL + ((idx + 1) / Math.max(schemaRows.length + 1, 2)) * CHART_WIDTH;
      const eventLabel = [row.lifeEvents, row.triggers]
        .map((s) => s.trim())
        .filter(Boolean)
        .join(' | ');
      if (eventLabel) {
        annotations.push({
          x: rowX,
          label: eventLabel,
          color: '#1E88E5',
          direction: 'up',
          date: rowDate || new Date().toISOString(),
          priority: 78,
        });
      }
      const interventionLabel = [row.interventions, row.hospitalization]
        .map((s) => s.trim())
        .filter(Boolean)
        .join(' | ');
      if (interventionLabel) {
        annotations.push({
          x: rowX,
          label: interventionLabel,
          color: '#D32F2F',
          direction: 'down',
          date: rowDate || new Date().toISOString(),
          priority: 88,
        });
      }
    });
  } else {
    allNotes.forEach((n) => {
      const noteDate = n.createdAt ?? n.noteDateTime ?? '';
      const text = getNoteNarrativeText(n).toLowerCase();
      if (!text || !noteDate) return;

      const matchedRule = NOTE_LIFE_EVENT_RULES
        .filter((rule) => rule.pattern.test(text))
        .sort((a, b) => b.priority - a.priority)[0];

      if (matchedRule) {
        annotations.push({
          x: toX(noteDate),
          label: matchedRule.label,
          color: matchedRule.color,
          direction: matchedRule.direction,
          date: noteDate,
          priority: matchedRule.priority,
        });
      }

      if (!matchedRule && n.noteType === 'incident') {
        annotations.push({
          x: toX(noteDate),
          label: n.title ?? 'Incident',
          color: '#B71C1C',
          direction: 'down',
          date: noteDate,
          priority: 80,
        });
      }
    });
  }

  allRisks
    .filter((r) => ['high', 'critical'].includes((r.riskLevel ?? '').toLowerCase()))
    .forEach((r) => {
      const riskDate = r.assessedAt ?? r.assessed_at ?? r.createdAt ?? '';
      if (!riskDate) return;
      annotations.push({
        x: toX(riskDate),
        label: `Risk ${String(r.riskLevel ?? '').toUpperCase() || 'HIGH'}`,
        color: '#D32F2F',
        direction: 'down',
        date: riskDate,
        priority: 90,
      });
    });

  allEpisodes
    .filter((e) => (e.episodeType ?? '').toLowerCase().includes('inpatient'))
    .forEach((e) => {
      const start = e.startDate ?? '';
      if (!start) return;
      annotations.push({
        x: toX(start),
        label: 'Hospitalised',
        color: '#D32F2F',
        direction: 'down',
        date: start,
        priority: 100,
      });
    });

  allAlerts
    .filter((a) => ['critical', 'high'].includes((a.alertSeverity ?? a.severity ?? '').toLowerCase()))
    .forEach((a) => {
      const alertDate = a.createdAt ?? '';
      if (!alertDate) return;
      annotations.push({
        x: toX(alertDate),
        label: a.title ?? 'High-priority alert',
        color: '#E65100',
        direction: 'down',
        date: alertDate,
        priority: 84,
      });
    });

  allMeds.forEach((m) => {
    const start = m.prescribedAt ?? m.startDate ?? m.createdAt ?? '';
    const cease = m.ceasedAt ?? m.endDate ?? '';
    const name = m.medicationName ?? m.drugLabel ?? 'Medication';
    const isPsychotropic = /(lithium|lamotrigine|valproate|quetiapine|olanzapine|aripiprazole|risperidone|clozapine|ssri|snri|antidepressant|antipsychotic|mood stabil)/i.test(name);
    if (!isPsychotropic) return;
    if (start) {
      annotations.push({
        x: toX(start),
        label: `${name} started`,
        color: '#2E7D32',
        direction: 'up',
        date: start,
        priority: 62,
      });
    }
    if (cease) {
      annotations.push({
        x: toX(cease),
        label: `${name} ceased`,
        color: '#F57C00',
        direction: 'down',
        date: cease,
        priority: 64,
      });
    }
  });

  const dedupedByMonth = new Map<string, { x: number; label: string; color: string; direction: 'up' | 'down'; date: string; priority: number }>();
  for (const item of annotations) {
    const d = parseDate(item.date);
    if (!d) continue;
    const key = `${item.direction}-${item.label}-${d.getFullYear()}-${d.getMonth()}`;
    const existing = dedupedByMonth.get(key);
    if (!existing || item.priority > existing.priority) {
      dedupedByMonth.set(key, item);
    }
  }
  const uniqueAnnotations = [...dedupedByMonth.values()]
    .sort((a, b) => {
      const at = parseDate(a.date)?.getTime() ?? 0;
      const bt = parseDate(b.date)?.getTime() ?? 0;
      return at === bt ? b.priority - a.priority : at - bt;
    })
    .slice(0, 42);

  return (
    <Box>
      <Paper variant="outlined" sx={{ p: 2.5, mb: 3, borderLeft: '4px solid #327C8D' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          <TimelineIcon sx={{ color: '#327C8D', fontSize: 22 }} />
          <Typography variant="subtitle1" fontWeight={700} fontFamily="Albert Sans, sans-serif">Life Chart</Typography>
          <Chip label={isBipolar ? 'Bipolar / Episodic' : isContinuous ? 'Continuous' : 'Mixed'} size="small" sx={{ fontSize: 9, height: 18, bgcolor: '#E0F2F1', color: '#327C8D' }} />
          <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
            {endYear} → {startYear} ({years.length} year{years.length !== 1 ? 's' : ''}, most recent first)
          </Typography>
          <SectionSignoffControls patientId={patientId} section="life_chart" />
          <Tooltip title="Refresh life chart with latest data">
            <IconButton size="small" onClick={async () => {
              setRefreshing(true);
              await Promise.all([
                qc.invalidateQueries({ queryKey: episodesKeys.lifeChart(patientId) }),
                qc.invalidateQueries({ queryKey: patientsKeys.notesLifechart(patientId) }),
                qc.invalidateQueries({ queryKey: patientMedicationsKeys.lifechart(patientId) }),
                qc.invalidateQueries({ queryKey: riskAllergiesKeys.risksLifechart(patientId) }),
                qc.invalidateQueries({ queryKey: patientsKeys.alertsLifechart(patientId) }),
              ]);
              setTimeout(() => setRefreshing(false), 1000);
            }} sx={{ ml: 'auto', color: '#327C8D' }}>
              {refreshing ? <CircularProgress size={16} sx={{ color: '#327C8D' }} /> : <RefreshIcon sx={{ fontSize: 18 }} />}
            </IconButton>
          </Tooltip>
        </Box>

        <Box sx={{ overflowX: 'auto', pb: 1 }}>
          <svg width={TOTAL_WIDTH} height={TOTAL_H} style={{ fontFamily: 'Albert Sans, sans-serif' }}>
            {years.map((yr, i) => {
              const x = LEFT_LABEL + i * YEAR_W;
              return (
                <g key={yr}>
                  <line x1={x} y1={0} x2={x} y2={TOTAL_H} stroke="#E0E0E0" strokeWidth={0.5} strokeDasharray="4,4" />
                  <text x={x + YEAR_W / 2} y={SYMPTOM_BASELINE_Y + 4} textAnchor="middle" fontSize={10} fill="#CCC" fontWeight={300}>{yr}</text>
                </g>
              );
            })}

            <text x={5} y={12} fontSize={9} fill="#666" fontWeight={700}>Medications</text>
            <line x1={LEFT_LABEL} y1={MED_H} x2={LEFT_LABEL + CHART_WIDTH} y2={MED_H} stroke="#BDBDBD" strokeWidth={1} />
            {medBars.map(m => (
              <g key={m.id}>
                <rect x={m.x1} y={m.y} width={Math.max(m.x2 - m.x1, 3)} height={6} rx={2} fill={m.color} opacity={m.active ? 0.9 : 0.4} />
                {(m.x2 - m.x1) > 50 && <text x={m.x1 + 3} y={m.y + 5} fontSize={5.5} fill="#fff" fontWeight={700}>{m.name} {m.dose}</text>}
                <title>{`${m.name} ${m.dose} (${m.active ? 'active' : 'ceased'})`}</title>
              </g>
            ))}

            <text x={5} y={SYMPTOM_BASELINE_Y - SYMPTOM_SCALE * 0.95} fontSize={7} fill="#999">Severe</text>
            <text x={5} y={SYMPTOM_BASELINE_Y - SYMPTOM_SCALE * 0.6} fontSize={7} fill="#999">Moderate</text>
            <text x={5} y={SYMPTOM_BASELINE_Y - SYMPTOM_SCALE * 0.3} fontSize={7} fill="#999">Mild</text>
            {isBipolar && (
              <>
                <text x={55} y={SYMPTOM_BASELINE_Y - 10} fontSize={9} fill="#D32F2F" fontWeight={700}>Mania / Psychosis ↑</text>
                <text x={55} y={SYMPTOM_BASELINE_Y + 16} fontSize={9} fill="#1565C0" fontWeight={700}>Depression ↓</text>
                <text x={5} y={SYMPTOM_BASELINE_Y + SYMPTOM_SCALE * 0.3} fontSize={7} fill="#999">Mild</text>
                <text x={5} y={SYMPTOM_BASELINE_Y + SYMPTOM_SCALE * 0.6} fontSize={7} fill="#999">Moderate</text>
                <text x={5} y={SYMPTOM_BASELINE_Y + SYMPTOM_SCALE * 0.95} fontSize={7} fill="#999">Severe</text>
              </>
            )}
            {!isBipolar && (
              <>
                <text x={55} y={SYMPTOM_BASELINE_Y - 10} fontSize={9} fill="#7B1FA2" fontWeight={700}>
                  {primaryDomainLabel} ↑
                </text>
                <text x={5} y={SYMPTOM_BASELINE_Y + 10} fontSize={7} fill="#999">Baseline</text>
              </>
            )}

            {[0.33, 0.66, 1].map(s => (
              <React.Fragment key={s}>
                <line x1={LEFT_LABEL} y1={SYMPTOM_BASELINE_Y - s * SYMPTOM_SCALE} x2={LEFT_LABEL + CHART_WIDTH} y2={SYMPTOM_BASELINE_Y - s * SYMPTOM_SCALE} stroke="#F5F5F5" strokeWidth={0.5} />
                {isBipolar && <line x1={LEFT_LABEL} y1={SYMPTOM_BASELINE_Y + s * SYMPTOM_SCALE} x2={LEFT_LABEL + CHART_WIDTH} y2={SYMPTOM_BASELINE_Y + s * SYMPTOM_SCALE} stroke="#F5F5F5" strokeWidth={0.5} />}
              </React.Fragment>
            ))}

            <line x1={LEFT_LABEL} y1={SYMPTOM_BASELINE_Y} x2={LEFT_LABEL + CHART_WIDTH} y2={SYMPTOM_BASELINE_Y} stroke="#333" strokeWidth={1.5} />

            {isContinuous && symptomPoints.length > 2 ? (
              <>
                <path d={buildContinuousLine(symptomPoints)} fill="none" stroke="#7B1FA2" strokeWidth={2} opacity={0.8} />
                <path d={buildWavePath(symptomPoints, SYMPTOM_BASELINE_Y)} fill="#7B1FA2" opacity={0.08} />
                {episodeCurves.slice(0, 24).map((ec) => (
                  <g key={`continuous-marker-${ec.id}`}>
                    <circle cx={ec.onsetX} cy={SYMPTOM_BASELINE_Y} r={2} fill="#fff" stroke="#7B1FA2" strokeWidth={1} />
                    <circle cx={ec.remissionX} cy={SYMPTOM_BASELINE_Y} r={2} fill={ec.ongoing ? '#7B1FA2' : '#fff'} stroke="#7B1FA2" strokeWidth={1} />
                    {ec.w > 20 && (
                      <>
                        <text x={ec.onsetX} y={SYMPTOM_BASELINE_Y - 5} textAnchor="middle" fontSize={5.5} fill="#7B1FA2" fontWeight={700}>
                          {ec.w > 80 ? 'Onset' : 'O'}
                        </text>
                        <text x={ec.remissionX} y={SYMPTOM_BASELINE_Y + 10} textAnchor="middle" fontSize={5.5} fill="#7B1FA2" fontWeight={700}>
                          {ec.w > 80 ? (ec.ongoing ? 'Ongoing' : 'Remission') : (ec.ongoing ? 'Now' : 'R')}
                        </text>
                      </>
                    )}
                  </g>
                ))}
              </>
            ) : (
              episodeCurves.map(ec => (
                <g key={ec.id}>
                  <path d={ec.path} fill={ec.color} opacity={0.25} />
                  <path d={buildContinuousLine(ec.pts)} fill="none" stroke={ec.color} strokeWidth={2} />
                  {ec.w > 30 && (
                    <text x={ec.x1 + ec.w / 2} y={ec.peakY + (ec.direction === 'down' ? 12 : -5)} textAnchor="middle" fontSize={7} fill={ec.color} fontWeight={700}>
                      {ec.typeLabel}
                    </text>
                  )}
                  {ec.w > 24 && ec.durationLabel && (
                    <text x={ec.x1 + ec.w / 2} y={ec.peakY + (ec.direction === 'down' ? 22 : 9)} textAnchor="middle" fontSize={6.5} fill="#333" fontWeight={600}>
                      {ec.durationLabel}
                    </text>
                  )}
                  <line x1={ec.onsetX} y1={SYMPTOM_BASELINE_Y} x2={ec.onsetX} y2={ec.peakY} stroke={ec.color} strokeWidth={0.8} strokeDasharray="2,2" opacity={0.45} />
                  <line x1={ec.remissionX} y1={SYMPTOM_BASELINE_Y} x2={ec.remissionX} y2={ec.peakY} stroke={ec.color} strokeWidth={0.8} strokeDasharray="2,2" opacity={0.45} />
                  <circle cx={ec.onsetX} cy={SYMPTOM_BASELINE_Y} r={2.2} fill="#fff" stroke={ec.color} strokeWidth={1.2} />
                  <circle cx={ec.remissionX} cy={SYMPTOM_BASELINE_Y} r={2.2} fill={ec.ongoing ? ec.color : '#fff'} stroke={ec.color} strokeWidth={1.2} />
                  {ec.w > 18 && (
                    <>
                      <text x={ec.onsetX} y={ec.direction === 'down' ? SYMPTOM_BASELINE_Y + 11 : SYMPTOM_BASELINE_Y - 6} textAnchor="middle" fontSize={6} fill={ec.color} fontWeight={700}>
                        {ec.w > 80 ? 'Onset' : 'O'}
                      </text>
                      <text x={ec.remissionX} y={ec.direction === 'down' ? SYMPTOM_BASELINE_Y + 21 : SYMPTOM_BASELINE_Y + 4} textAnchor="middle" fontSize={6} fill={ec.color} fontWeight={700}>
                        {ec.w > 80 ? (ec.ongoing ? 'Ongoing' : 'Remission') : (ec.ongoing ? 'Now' : 'R')}
                      </text>
                    </>
                  )}
                  <title>{`${ec.typeLabel}: ${ec.title ?? ''}\nChannel: ${(ec as { symptomChannel?: string }).symptomChannel ?? 'general'}\nSymptom onset: ${ec.startDate ?? 'unknown'}\nSymptom remission: ${ec.endDate ?? 'ongoing'}\n${ec.diagnosis ?? ''}${((ec as { evidenceAnchors?: string[] }).evidenceAnchors?.length ?? 0) > 0 ? `\nEvidence: ${(ec as { evidenceAnchors?: string[] }).evidenceAnchors?.slice(0, 2).join(' || ')}` : ''}`}</title>
                </g>
              ))
            )}

            {uniqueAnnotations.map((a, i) => (
              <g key={`annot-${i}`}>
                <line x1={a.x} y1={SYMPTOM_BASELINE_Y - (a.direction === 'up' ? 30 : -10)} x2={a.x} y2={SYMPTOM_BASELINE_Y + (a.direction === 'up' ? -10 : 30)} stroke={a.color} strokeWidth={1.2} markerEnd="url(#arrowDown)" />
                <text x={a.x + 4} y={a.direction === 'up' ? SYMPTOM_BASELINE_Y - SYMPTOM_SCALE - 8 - (i % 2) * 12 : (isBipolar ? SYMPTOM_BASELINE_Y + SYMPTOM_SCALE + 12 + (i % 2) * 12 : SYMPTOM_BASELINE_Y + 26 + (i % 2) * 12)} fontSize={7} fill={a.color} fontWeight={600}>
                  {a.label}
                </text>
                <title>{`${a.label}\n${a.date ? new Date(a.date).toLocaleDateString('en-AU') : ''}`}</title>
              </g>
            ))}

            <defs>
              <marker id="arrowDown" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
                <polygon points="0,0 6,3 0,6" fill="#333" />
              </marker>
            </defs>

            <line x1={LEFT_LABEL} y1={RESIDUAL_TOP_Y} x2={LEFT_LABEL + CHART_WIDTH} y2={RESIDUAL_TOP_Y} stroke="#BDBDBD" strokeWidth={1} />
            <text x={5} y={RESIDUAL_TOP_Y + 12} fontSize={8} fill="#666" fontWeight={700}>Residual / Inter-episode</text>
            <text x={5} y={RESIDUAL_TOP_Y + 22} fontSize={7} fill="#999">Symptoms</text>

            {residualCategories.map((cat, ci) => {
              const catItems = uniqueResiduals.filter(r => r.category === cat);
              const rowY = RESIDUAL_TOP_Y + 8 + ci * 12;
              const color = RESIDUAL_COLORS[cat] ?? '#666';
              return (
                <g key={`res-${cat}`}>
                  {catItems.map((r, ri) => (
                    <g key={`res-${cat}-${ri}`}>
                      <circle cx={r.x} cy={rowY} r={3} fill={color} opacity={0.6} />
                      {ri === 0 && <text x={r.x + 6} y={rowY + 3} fontSize={6} fill={color} fontWeight={600}>{r.label}</text>}
                      <title>{`${r.label}\n${new Date(r.date).toLocaleDateString('en-AU')}`}</title>
                    </g>
                  ))}
                  {catItems.length > 1 && (
                    <line x1={Math.min(...catItems.map(c => c.x))} y1={rowY} x2={Math.max(...catItems.map(c => c.x))} y2={rowY} stroke={color} strokeWidth={1} strokeDasharray="3,3" opacity={0.3} />
                  )}
                </g>
              );
            })}

            <line x1={LEFT_LABEL} y1={SUBSTANCE_TOP_Y} x2={LEFT_LABEL + CHART_WIDTH} y2={SUBSTANCE_TOP_Y} stroke="#BDBDBD" strokeWidth={1} />
            <text x={5} y={SUBSTANCE_TOP_Y + 12} fontSize={8} fill="#666" fontWeight={700}>Substance Use Pattern</text>
            {uniqueSubstances.map((item, idx) => {
              const y = SUBSTANCE_TOP_Y + 14 + (idx % 2) * 12;
              return (
                <g key={`substance-${idx}`}>
                  <line x1={item.x} y1={SUBSTANCE_TOP_Y + 1} x2={item.x} y2={y - 3} stroke={RESIDUAL_COLORS.substance} strokeWidth={1} opacity={0.4} />
                  <rect x={item.x - 2} y={y - 2} width={4} height={4} fill={RESIDUAL_COLORS.substance} opacity={0.75} />
                  <text x={item.x + 5} y={y + 1} fontSize={6.5} fill={RESIDUAL_COLORS.substance} fontWeight={600}>
                    {item.label}
                  </text>
                  <title>{`${item.label}\n${new Date(item.date).toLocaleDateString('en-AU')}`}</title>
                </g>
              );
            })}

            <line x1={LEFT_LABEL} y1={CARE_TOP_Y} x2={LEFT_LABEL + CHART_WIDTH} y2={CARE_TOP_Y} stroke="#BDBDBD" strokeWidth={1} />
            <text x={5} y={CARE_TOP_Y + 12} fontSize={8} fill="#666" fontWeight={700}>Care Episodes</text>
            <text x={5} y={CARE_TOP_Y + 22} fontSize={7} fill="#999">Active care windows</text>
            {careEpisodeBlocks.map((bar) => (
              <g key={`care-episode-${bar.id}`}>
                <rect x={bar.x} y={bar.y} width={bar.width} height={6} rx={3} fill={bar.color} opacity={0.75} />
                {bar.isOpen && (
                  <polygon
                    points={`${bar.x - 5},${bar.y + 3} ${bar.x},${bar.y} ${bar.x},${bar.y + 6}`}
                    fill={bar.color}
                    opacity={0.9}
                  />
                )}
                {bar.width > 76 && (
                  <text x={bar.x + 3} y={bar.y + 5} fontSize={5.8} fill="#fff" fontWeight={700}>
                    {bar.label}
                  </text>
                )}
                <title>{`${bar.label}\nStart: ${bar.startDate ?? 'unknown'}\nEnd: ${bar.endDate ?? 'ongoing'}\nStatus: ${bar.status ?? 'unknown'}`}</title>
              </g>
            ))}

            <line x1={LEFT_LABEL} y1={EVENT_TOP_Y} x2={LEFT_LABEL + CHART_WIDTH} y2={EVENT_TOP_Y} stroke="#BDBDBD" strokeWidth={1} />
            <text x={5} y={EVENT_TOP_Y + 12} fontSize={8} fill="#666" fontWeight={700}>Life Events</text>
            {uniqueAnnotations.filter(a => a.direction === 'up').map((ev, i) => (
              <g key={`le-${i}`}>
                <line x1={ev.x} y1={EVENT_TOP_Y} x2={ev.x} y2={EVENT_TOP_Y + 25 + (i % 3) * 15} stroke={ev.color} strokeWidth={0.8} strokeDasharray="2,2" opacity={0.4} />
                <circle cx={ev.x} cy={EVENT_TOP_Y + 28 + (i % 3) * 15} r={3} fill={ev.color} />
                <text x={ev.x + 6} y={EVENT_TOP_Y + 31 + (i % 3) * 15} fontSize={6.5} fill={ev.color} fontWeight={600}>{ev.label}</text>
              </g>
            ))}
          </svg>
        </Box>

        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, mt: 2, px: 1 }}>
          {[
            { color: '#D32F2F', label: 'Mania / Psychosis' },
            { color: '#1565C0', label: 'Depression' },
            { color: '#9C27B0', label: 'Psychotic Episode' },
            { color: '#b8621a', label: 'Anxiety / PTSD' },
            { color: '#E65100', label: 'Personality / Other' },
            { color: '#7B1FA2', label: 'Continuous Symptoms' },
          ].map(l => (
            <Box key={l.label} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Box sx={{ width: 12, height: 8, bgcolor: l.color, borderRadius: 0.5, opacity: 0.5 }} />
              <Typography variant="caption" fontSize={9}>{l.label}</Typography>
            </Box>
          ))}
          <Divider orientation="vertical" flexItem />
          {Object.entries(RESIDUAL_COLORS)
            .filter(([cat]) => cat !== 'substance')
            .map(([cat, color]) => (
            <Box key={cat} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: color, opacity: 0.6 }} />
              <Typography variant="caption" fontSize={9} sx={{ textTransform: 'capitalize' }}>{cat}</Typography>
            </Box>
          ))}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Box sx={{ width: 10, height: 4, bgcolor: RESIDUAL_COLORS.substance, borderRadius: 0.5, opacity: 0.75 }} />
            <Typography variant="caption" fontSize={9}>Substance use lane</Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Box sx={{ width: 12, height: 4, bgcolor: '#2E7D32', borderRadius: 0.5, opacity: 0.8 }} />
            <Typography variant="caption" fontSize={9}>Care episode block (open = left arrow)</Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Box sx={{ width: 6, height: 6, border: '1px solid #D32F2F', borderRadius: '50%', bgcolor: '#fff' }} />
            <Typography variant="caption" fontSize={9}>Symptom onset/remission markers</Typography>
          </Box>
          <Divider orientation="vertical" flexItem />
          {medBars.slice(0, 5).map(m => (
            <Box key={m.id} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Box sx={{ width: 12, height: 5, bgcolor: m.color, borderRadius: 0.5 }} />
              <Typography variant="caption" fontSize={9}>{m.name}</Typography>
            </Box>
          ))}
        </Box>

        <Accordion sx={{ mt: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography variant="subtitle2" fontWeight={700} fontFamily="Albert Sans, sans-serif">
              Lifechart Textual Schema (Editable)
            </Typography>
          </AccordionSummary>
          <AccordionDetails sx={{ pt: 0.5 }}>
            {schemaDoc ? (
              <LifeChartSchemaTable
                schemaDoc={schemaDoc}
                onChange={(next) => { setSchemaDoc(next); setSchemaError(''); setSchemaInfo(''); }}
                onGenerateAi={generateSchemaWithAi}
                onSave={saveSchema}
                onResetHeuristic={resetSchemaHeuristic}
                generatingAi={schemaLoading}
                saving={schemaSaving}
                error={schemaError}
                info={schemaInfo}
              />
            ) : (
              <Paper variant="outlined" sx={{ p: 2 }}>
                <Typography variant="body2" color="text.secondary">Initializing lifechart schema…</Typography>
              </Paper>
            )}
          </AccordionDetails>
        </Accordion>
        {renderArtifactHistoryCard('Previous Lifechart Schema Versions', schemaHistory)}
      </Paper>

      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Typography variant="subtitle2" fontWeight={700} fontFamily="Albert Sans, sans-serif" sx={{ mb: 1 }}>Chart Data Sources</Typography>
        <Grid container spacing={2}>
          <Grid size={{ xs: 2 }}><Typography variant="caption" color="text.secondary">Pattern</Typography><Typography variant="body2" fontWeight={700} sx={{ textTransform: 'capitalize' }}>{pattern.replace(/_/g, ' ')}</Typography></Grid>
          <Grid size={{ xs: 2 }}><Typography variant="caption" color="text.secondary">Schema Rows</Typography><Typography variant="body2" fontWeight={700}>{schemaRows.length}</Typography></Grid>
          <Grid size={{ xs: 2 }}><Typography variant="caption" color="text.secondary">Primary Domain</Typography><Typography variant="body2" fontWeight={700}>{primaryDomainLabel}</Typography></Grid>
          <Grid size={{ xs: 2 }}><Typography variant="caption" color="text.secondary">Schema Revision</Typography><Typography variant="body2" fontWeight={700}>{schemaDoc?.audit.revision ?? 1}</Typography></Grid>
          <Grid size={{ xs: 2 }}><Typography variant="caption" color="text.secondary">Clinic Timezone</Typography><Typography variant="body2" fontWeight={700}>{schemaDoc?.clinicTimeZone ?? DEFAULT_CLINIC_TIME_ZONE}</Typography></Grid>
          <Grid size={{ xs: 2 }}><Typography variant="caption" color="text.secondary">Overlap Policy</Typography><Typography variant="body2" fontWeight={700}>Merge same-channel</Typography></Grid>
          <Grid size={{ xs: 2 }}><Typography variant="caption" color="text.secondary">Medications</Typography><Typography variant="body2" fontWeight={700}>{allMeds.length} ({allMeds.filter(m => m.status === 'active').length} active)</Typography></Grid>
          <Grid size={{ xs: 2 }}><Typography variant="caption" color="text.secondary">Notes</Typography><Typography variant="body2" fontWeight={700}>{allNotes.length}</Typography></Grid>
          <Grid size={{ xs: 2 }}><Typography variant="caption" color="text.secondary">Residual Symptoms</Typography><Typography variant="body2" fontWeight={700}>{uniqueResiduals.length}</Typography></Grid>
          <Grid size={{ xs: 2 }}><Typography variant="caption" color="text.secondary">Substance Points</Typography><Typography variant="body2" fontWeight={700}>{uniqueSubstances.length}</Typography></Grid>
          <Grid size={{ xs: 2 }}><Typography variant="caption" color="text.secondary">Annotations</Typography><Typography variant="body2" fontWeight={700}>{uniqueAnnotations.length}</Typography></Grid>
        </Grid>
      </Paper>
    </Box>
  );
}
