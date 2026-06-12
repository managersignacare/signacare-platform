/**
 * SummaryTab — composition shell.
 *
 * Phase 8 UI refactor (2026-06-06): the original 727-LOC ClinicalSummaryPanel
 * is now a thin composition over three focused units:
 *  - useClinicalSummaryJobs       — async clinical-AI orchestration (both arms)
 *  - useSummarySectionState       — accordion expansion + edit-text state
 *  - ClinicalSummaryArtifactPanel — generic artifact panel rendered twice
 *
 * Behaviour, disclaimers, API contracts, permissions, and async recovery
 * semantics are preserved 1:1 with the prior implementation.
 */
import { useMemo } from 'react';
import {
  Accordion, AccordionDetails, AccordionSummary,
  Alert, Box, Button, Chip, Grid, Tab, Tabs, Typography,
} from '@mui/material';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import PsychologyIcon from '@mui/icons-material/Psychology';
import LocalHospitalIcon from '@mui/icons-material/LocalHospital';
import EventNoteIcon from '@mui/icons-material/EventNote';
import PeopleAltIcon from '@mui/icons-material/PeopleAlt';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePatient } from '../../../hooks/usePatient';
import { calculateAge } from '../../../types/patientTypes';
import { apiClient } from '../../../../../shared/services/apiClient';
import { buildSettingsAsyncAiJobsPath } from '../../../../../shared/navigation/settingsNavigation';
import {
  patientsKeys,
  episodesKeys,
  patientMedicationsKeys,
  physicalHealthKeys,
} from '../../../queryKeys';
import {
  fmtDateShort,
  type PhysicalHealthSource,
  type SummaryAlertRow,
  type SummaryEpisodeRow,
  type SummaryMedicationRow,
  type SummaryNoteRow,
} from './summaryTabDomain';
import { DiagnosisSummaryCard } from './DiagnosisSummaryCard';
import { LinkagesPanel } from './LinkagesPanel';
import { CareProvisionPanel } from './CareProvisionPanel';
import { BmiCard, PhysicalHealthCard, QuickCard } from './SummaryUiCards';
import { VivaAlertBanner } from './VivaAlertBanner';
import { CLINICAL_TYPES, noteTypeLabel } from './summaryNarrative';
import { isActiveClinicalAiJobStatus } from './clinicalAiJobsDashboardSupport';
import { LifeChartPanel } from './LifeChartPanel';
import { buildPatientClinicalAiContext } from './summaryClinicalAiContext';
import { resolvePrimaryDiagnosisSnapshot, type SummaryDiagnosisLookupRow } from './summaryDiagnosisSnapshot';
import type { SummarySignoffRecord } from './summarySignoffTypes';
import { useClinicalSummaryJobs } from './useClinicalSummaryJobs';
import { useSummarySectionState } from './useSummarySectionState';
import { ClinicalSummaryArtifactPanel } from './ClinicalSummaryArtifactPanel';

interface SummaryTabProps { patientId: string }
export function SummaryTab({ patientId }: SummaryTabProps) {
  const [subTab, setSubTab] = useState<'clinical' | 'care' | 'lifechart' | 'linkages'>('clinical');

  return (
    <Box>
      <Tabs
        aria-label="Navigation tabs"
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
  const navigate = useNavigate();
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

  const allNotes = notes ?? [];
  const allMeds = meds ?? [];
  const activeAlerts  = alerts?.filter(a => a.isActive) ?? [];
  const age = patient ? calculateAge(patient.dateOfBirth) : 0;
  const primaryDiagnosisSnapshot = useMemo(
    () => resolvePrimaryDiagnosisSnapshot(episodes ?? [], diagnosisRows),
    [episodes, diagnosisRows],
  );

  const sectionState = useSummarySectionState();
  const jobs = useClinicalSummaryJobs({
    patientId,
    notes: allNotes,
    signoffRows,
    buildContext: (): string =>
      buildPatientClinicalAiContext({
        patient: patient!,
        age,
        episodes: episodes ?? [],
        medications: allMeds,
        activeAlerts,
        notes: allNotes,
      }),
  });

  if (!patient) return null;

  const activeMedicationList = allMeds.filter(m => m.status === 'active');
  const sortedNotesByDateDesc = [...allNotes].sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
  const lastClinicalNote = sortedNotesByDateDesc[0];
  const clinicalEncounterCount = allNotes.filter(n => CLINICAL_TYPES.has(n.noteType ?? '')).length;

  const summaryHasInFlightJob = jobs.summary.jobs.some((job) => isActiveClinicalAiJobStatus(job.status));
  const formulationHasInFlightJob = jobs.formulation.jobs.some((job) => isActiveClinicalAiJobStatus(job.status));

  const displaySummary = summaryHasInFlightJob
    ? 'Generating updated longitudinal summary...\n\nThe previous summary is hidden while the current async AI job is in progress. Use Settings → Async AI Jobs to inspect the live job state.'
    : (jobs.summary.value
      ?? `No AI summary generated yet.\n\nClick "Generate with AI" to create a longitudinal summary from ${allNotes.length} clinical note(s), ${allMeds.length} medication(s), and ${episodes?.length ?? 0} episode(s).`);
  const displayFormulation = formulationHasInFlightJob
    ? "Generating updated clinical formulation...\n\nThe previous formulation is hidden while the current async AI job is in progress. Use Settings → Async AI Jobs to inspect the live job state."
    : (jobs.formulation.value
      ?? `No AI formulation generated yet.\n\nClick "Generate with AI" to create a biopsychosocial formulation from the patient's clinical data.`);

  return (
    <Box>
      <VivaAlertBanner patientId={patientId} />

      <Accordion
        expanded={sectionState.expandedSections.snapshot}
        onChange={(_evt, isExpanded) => sectionState.setSectionExpanded('snapshot', isExpanded)}
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
              <QuickCard
                icon={<PsychologyIcon sx={{ color: '#327C8D', fontSize: 22 }} />}
                label="Primary Diagnosis"
                value={primaryDiagnosisSnapshot.value}
                sub={primaryDiagnosisSnapshot.sub}
              />
            </Grid>
            <Grid size={{ xs: 6, sm: 4, md: 2 }}>
              <QuickCard
                icon={<LocalHospitalIcon sx={{ color: '#D32F2F', fontSize: 22 }} />}
                label="Active Medications"
                value={`${activeMedicationList.length}`}
                sub={activeMedicationList.length > 0
                  ? activeMedicationList.slice(0, 2).map(m => m.medicationName ?? m.drugLabel).join(', ')
                  : 'No active medications'}
              />
            </Grid>
            <Grid size={{ xs: 6, sm: 4, md: 2 }}>
              <QuickCard
                icon={<EventNoteIcon sx={{ color: '#b8621a', fontSize: 22 }} />}
                label="Last Clinical Contact"
                value={lastClinicalNote?.createdAt ? fmtDateShort(lastClinicalNote.createdAt) : '—'}
                sub={lastClinicalNote ? noteTypeLabel(lastClinicalNote.noteType) : 'No contacts recorded'}
              />
            </Grid>
            <Grid size={{ xs: 6, sm: 4, md: 2 }}>
              <QuickCard
                icon={<PeopleAltIcon sx={{ color: '#327C8D', fontSize: 22 }} />}
                label="Total Encounters"
                value={`${clinicalEncounterCount}`}
                sub={`${activeAlerts.length} active alert${activeAlerts.length !== 1 ? 's' : ''}`}
              />
            </Grid>
          </Grid>
        </AccordionDetails>
      </Accordion>

      <Accordion
        expanded={sectionState.expandedSections.diagnosis}
        onChange={(_evt, isExpanded) => sectionState.setSectionExpanded('diagnosis', isExpanded)}
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

      <Alert
        severity="info"
        sx={{ mb: 2 }}
        action={(
          <Button
            color="inherit"
            size="small"
            onClick={() => navigate(buildSettingsAsyncAiJobsPath(patientId))}
            sx={{ textTransform: 'none', fontWeight: 700 }}
          >
            Open in Settings
          </Button>
        )}
      >
        Async AI job recovery and apply actions now live under Settings → Async AI Jobs for this patient.
      </Alert>

      <Accordion
        expanded={sectionState.expandedSections.longitudinal}
        onChange={(_evt, isExpanded) => sectionState.setSectionExpanded('longitudinal', isExpanded)}
        sx={{ mb: 2, '&:before': { display: 'none' } }}
      >
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography variant="subtitle2" fontWeight={700} fontFamily="Albert Sans, sans-serif">
            Longitudinal Summary
          </Typography>
        </AccordionSummary>
        <AccordionDetails sx={{ pt: 0 }}>
          <ClinicalSummaryArtifactPanel
            patientId={patientId}
            title="Longitudinal Summary"
            titleIcon={<AutoAwesomeIcon sx={{ color: '#b8621a', fontSize: 20 }} />}
            chipNode={
              <Chip
                label="AI Generated — Maudsley Format"
                size="small"
                sx={{ fontSize: 9, height: 18, bgcolor: '#FFF3E0', color: '#E65100' }}
              />
            }
            accentColor="#b8621a"
            saveButtonColor="#b8621a"
            saveButtonHoverColor="#d6741f"
            signoffSection="longitudinal_summary"
            descriptionPrefix={`Longitudinal clinical history from ${allNotes.length} note(s), ${allMeds.length} medication(s), ${episodes?.length ?? 0} episode(s).`}
            value={jobs.summary.value}
            loading={jobs.summary.loading}
            persisting={jobs.summary.persisting}
            error={jobs.summary.error}
            setError={jobs.summary.setError}
            jobStatus={jobs.summary.jobStatus}
            resetLocked={jobs.summary.resetLocked}
            lastGenerated={jobs.summary.lastGenerated}
            history={jobs.summary.history}
            historyTitle="Previous Longitudinal Summaries"
            editing={sectionState.editSummary}
            setEditing={sectionState.setEditSummary}
            editText={sectionState.summaryText}
            setEditText={sectionState.setSummaryText}
            onGenerate={jobs.summary.generate}
            onHardReset={jobs.summary.hardReset}
            onPersistEdit={(content) => jobs.summary.persistArtifact(content)}
            setValue={jobs.summary.setValue}
            editRowCount={20}
            readMaxHeightPx={400}
            displayBody={displaySummary}
          />
        </AccordionDetails>
      </Accordion>

      <Accordion
        expanded={sectionState.expandedSections.formulation}
        onChange={(_evt, isExpanded) => sectionState.setSectionExpanded('formulation', isExpanded)}
        sx={{ mb: 2, '&:before': { display: 'none' } }}
      >
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography variant="subtitle2" fontWeight={700} fontFamily="Albert Sans, sans-serif">
            Clinical Formulation
          </Typography>
        </AccordionSummary>
        <AccordionDetails sx={{ pt: 0 }}>
          <ClinicalSummaryArtifactPanel
            patientId={patientId}
            title="Clinical Formulation"
            titleIcon={<PsychologyIcon sx={{ color: '#327C8D', fontSize: 20 }} />}
            chipNode={
              <Chip
                label="Biopsychosocial"
                size="small"
                sx={{ fontSize: 9, height: 18, bgcolor: '#E0F2F1', color: '#327C8D' }}
              />
            }
            accentColor="#327C8D"
            saveButtonColor="#327C8D"
            saveButtonHoverColor="#265f6d"
            signoffSection="clinical_formulation"
            descriptionPrefix="Predisposing, precipitating, perpetuating, and protective factors."
            value={jobs.formulation.value}
            loading={jobs.formulation.loading}
            persisting={jobs.formulation.persisting}
            error={jobs.formulation.error}
            setError={jobs.formulation.setError}
            jobStatus={jobs.formulation.jobStatus}
            resetLocked={jobs.formulation.resetLocked}
            lastGenerated={jobs.formulation.lastGenerated}
            history={jobs.formulation.history}
            historyTitle="Previous Clinical Formulations"
            editing={sectionState.editFormulation}
            setEditing={sectionState.setEditFormulation}
            editText={sectionState.formulationText}
            setEditText={sectionState.setFormulationText}
            onGenerate={jobs.formulation.generate}
            onHardReset={jobs.formulation.hardReset}
            onPersistEdit={(content) => jobs.formulation.persistArtifact(content)}
            setValue={jobs.formulation.setValue}
            editRowCount={16}
            readMaxHeightPx={350}
            displayBody={displayFormulation}
          />
        </AccordionDetails>
      </Accordion>
    </Box>
  );
}
