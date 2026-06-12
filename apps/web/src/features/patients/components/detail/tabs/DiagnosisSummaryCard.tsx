import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Paper,
  Tooltip,
  Typography,
} from '@mui/material';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import PsychologyIcon from '@mui/icons-material/Psychology';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../../../shared/services/apiClient';
import { llmAiJobsApi } from '../../../../../shared/services/llmAiJobsApi';
import { patientsKeys } from '../../../queryKeys';
import {
  extractErrorMessage,
  fmtDate,
  type SummaryEpisodeRow,
  type SummaryNoteRow,
  type SummaryPatientProfile,
} from './summaryTabDomain';
import { SectionSignoffControls, type SummarySignoffSection } from './SummarySignoffControls';
import {
  DIAGNOSIS_SUMMARY_NOTE_TITLE,
  DIAGNOSIS_SUMMARY_NOTE_TYPE,
  findLatestArtifactNote,
  listArtifactNotes,
  type SummaryArtifactVersion,
  upsertSummaryArtifactNote,
} from './summaryArtifacts';

interface DiagnosisSummaryCardProps {
  patientId: string;
  patient: SummaryPatientProfile;
  episodes: SummaryEpisodeRow[];
  notes: SummaryNoteRow[];
}

interface SummarySignoffRecord {
  section: SummarySignoffSection;
  signedOffAt: string;
}

interface DsmMultiaxialSummary {
  axisI: string[];
  axisII: string[];
  axisIII: string[];
  axisIV: string[];
  axisV: string;
  differentialDiagnoses: string[];
  evidenceAnchors: string[];
  diagnosticSynthesis: string[];
  codingAlignment: string[];
  rulesetVersion: string;
}

const DIAGNOSIS_RULESET_VERSION = 'diagnosis-synthesis-v2.0-2026-05-18';
const SIGNAL_TERMS_REGEX = /(grandios|delusion|hallucinat|pressured speech|flight of ideas|decreased need for sleep|reduced sleep|low mood|depress|anhedoni|suicid|hopeless|agitation|paranoid|disorgani|obsessi|compulsi|anxiety|panic|substance|alcohol|cannabis|meth|cocaine)/i;

type SignalKey =
  | 'mania'
  | 'hypomania'
  | 'depression'
  | 'psychosis'
  | 'anxiety'
  | 'obsessionCompulsion'
  | 'substance'
  | 'stressor'
  | 'personality'
  | 'medical';

interface SignalDefinition {
  key: SignalKey;
  label: string;
  pattern: RegExp;
}

const SIGNAL_DEFINITIONS: SignalDefinition[] = [
  { key: 'mania', label: 'elevated/expansive mood', pattern: /\bmania|manic|elevated mood|expansive mood\b/i },
  { key: 'mania', label: 'grandiosity', pattern: /\bgrandios/i },
  { key: 'mania', label: 'pressured speech / flight of ideas', pattern: /\bpressured speech|flight of ideas\b/i },
  { key: 'mania', label: 'decreased need for sleep', pattern: /\bdecreased need for sleep|reduced sleep|sleep deprivation\b/i },
  { key: 'hypomania', label: 'hypomanic features', pattern: /\bhypomania|hypomanic\b/i },
  { key: 'depression', label: 'depressed mood', pattern: /\bdepress|low mood\b/i },
  { key: 'depression', label: 'anhedonia', pattern: /\banhedoni/i },
  { key: 'depression', label: 'suicidal ideation', pattern: /\bsuicid|self-harm\b/i },
  { key: 'psychosis', label: 'delusions', pattern: /\bdelusion|delusional\b/i },
  { key: 'psychosis', label: 'hallucinations', pattern: /\bhallucinat/i },
  { key: 'psychosis', label: 'thought disorganization', pattern: /\bdisorgani[sz]ed thought|thought disorder\b/i },
  { key: 'anxiety', label: 'anxiety burden', pattern: /\banxiety|panic\b/i },
  { key: 'obsessionCompulsion', label: 'obsessions / compulsions', pattern: /\bobsessi|compulsi\b/i },
  { key: 'substance', label: 'substance use', pattern: /\balcohol|cannabis|meth|amphetamine|cocaine|substance use\b/i },
  { key: 'stressor', label: 'psychosocial stressors', pattern: /\bhousing|homeless|eviction|financial|debt|job|employment|relationship|separation|bereave|grief\b/i },
  { key: 'personality', label: 'personality-trait burden', pattern: /\bpersonality|borderline traits?|emotion dysregulation\b/i },
  { key: 'medical', label: 'general medical comorbidity', pattern: /\bdiabetes|hba1c|hypertension|blood pressure|thyroid|renal|metabolic\b/i },
];

function normalizeList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item.length > 0);
}

function stripHtmlToText(value: string): string {
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function canonicalUnique(values: string[], cap = 12): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  values.forEach((value) => {
    const key = value.toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(value);
  });
  return out.slice(0, cap);
}

function notePlainText(note: SummaryNoteRow): string {
  return stripHtmlToText(
    [
      note.title ?? '',
      note.content ?? '',
      note.assessmentHtml ?? '',
      note.planHtml ?? '',
      note.bodyHtml ?? '',
    ].join(' '),
  );
}

function collectSignalLabels(text: string): string[] {
  return canonicalUnique(
    SIGNAL_DEFINITIONS
      .filter((definition) => definition.pattern.test(text))
      .map((definition) => definition.label),
    6,
  );
}

function collectSignalKeys(text: string): Set<SignalKey> {
  const keys = new Set<SignalKey>();
  SIGNAL_DEFINITIONS.forEach((definition) => {
    if (definition.pattern.test(text)) keys.add(definition.key);
  });
  return keys;
}

function evidenceSnippet(text: string): string {
  const sentences = text
    .split(/[.!?]\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
  const anchored = sentences.filter((sentence) => SIGNAL_TERMS_REGEX.test(sentence)).slice(0, 2);
  const picked = anchored.length > 0 ? anchored : sentences.slice(0, 1);
  const snippet = picked.join('; ').trim();
  return snippet.length > 220 ? `${snippet.slice(0, 217)}...` : snippet;
}

function buildEpisodeAnchor(episode: SummaryEpisodeRow): string {
  const interval = `${episode.startDate ?? 'unknown start'}${episode.endDate ? ` → ${episode.endDate}` : ' → ongoing'}`;
  const dx = [episode.primaryDiagnosis, episode.diagnoses].filter((value): value is string => Boolean(value && value.trim())).join(' | ');
  return `[${interval}] Episode "${episode.title ?? 'Untitled'}" (${episode.episodeType ?? 'episode'})${dx ? ` — Dx: ${dx}` : ''}`;
}

function inferLongitudinalSynthesis(episodes: SummaryEpisodeRow[], notes: SummaryNoteRow[]): {
  synthesis: string[];
  differentials: string[];
  coding: string[];
} {
  const diagnosisCorpus = episodes
    .flatMap((episode) => [episode.title, episode.primaryDiagnosis, episode.diagnoses, episode.episodeType])
    .filter((value): value is string => Boolean(value && value.trim()))
    .join(' ')
    .toLowerCase();
  const notesCorpus = notes
    .slice(0, 40)
    .map((note) => notePlainText(note).toLowerCase())
    .join(' ');
  const combined = `${diagnosisCorpus} ${notesCorpus}`;
  const keys = collectSignalKeys(combined);

  const hasMania = keys.has('mania') || /\bmania|manic\b/i.test(combined);
  const hasHypomania = keys.has('hypomania') || /\bhypomania|hypomanic\b/i.test(combined);
  const hasDepression = keys.has('depression') || /\bdepress|low mood|anhedoni/i.test(combined);
  const hasPsychosis = keys.has('psychosis') || /\bpsychosis|psychotic|delusion|hallucinat/i.test(combined);
  const hasObsessive = keys.has('obsessionCompulsion');
  const hasPersonalityTraits = keys.has('personality');
  const hasAnxiety = keys.has('anxiety');

  const synthesis: string[] = [];
  const differentials: string[] = [];
  const coding: string[] = [];

  if ((hasMania || hasHypomania) && hasDepression) {
    if (hasMania || hasPsychosis) {
      synthesis.push('Longitudinal pattern supports bipolar spectrum illness with manic activation plus depressive episodes; prioritize Bipolar I formulation if mania/psychosis threshold is met.');
      coding.push('Coding alignment candidate: ICD-10-AM F31.x bipolar affective disorder family (or ICD-11 6A60 bipolar type I) based on confirmed manic + depressive polarity across episodes.');
    } else {
      synthesis.push('Longitudinal pattern shows depressive episodes plus hypomanic periods; Bipolar II pattern should be considered where full mania is not evidenced.');
      coding.push('Coding alignment candidate: ICD-10-AM F31.x bipolar family / ICD-11 6A61 bipolar type II when hypomania + depression are clearly documented.');
    }
  } else if (hasDepression) {
    synthesis.push('Predominantly depressive polarity is documented; confirm whether bipolar conversion markers are present before finalizing unipolar vs bipolar diagnosis.');
    coding.push('Coding alignment candidate: depressive episode code families (ICD-10-AM F32/F33) unless bipolar evidence (F31.x) is established longitudinally.');
  }

  if (hasPsychosis) {
    differentials.push('Schizoaffective disorder vs mood disorder with psychotic features (confirm whether psychosis persists outside mood episodes).');
  }
  if (hasObsessive) {
    differentials.push('Obsessive-compulsive and related disorder comorbidity should be considered where intrusive thoughts/compulsions persist inter-episode.');
    coding.push('Potential comorbid coding family: ICD-10-AM F42 / ICD-11 6B20 obsessive-compulsive disorder where criteria are satisfied.');
  }
  if (hasAnxiety) {
    differentials.push('Anxiety-spectrum comorbidity (GAD/panic/trauma-related) may influence symptom burden and should be coded if independently syndromal.');
  }
  if (hasPersonalityTraits) {
    differentials.push('Personality pathology may be contributory; differentiate enduring trait-pattern from episodic mood-state effects.');
  }
  if (!synthesis.length) {
    synthesis.push('Insufficient longitudinal polarity evidence to auto-synthesize a single syndrome; retain documented diagnoses and continue structured review.');
  }
  if (!coding.length) {
    coding.push('Coding alignment pending clearer longitudinal syndrome evidence; maintain clinician-coded diagnosis as source of truth.');
  }

  return {
    synthesis: canonicalUnique(synthesis, 4),
    differentials: canonicalUnique(differentials, 6),
    coding: canonicalUnique(coding, 4),
  };
}

function buildDetailedEvidenceAnchors(episodes: SummaryEpisodeRow[], notes: SummaryNoteRow[]): string[] {
  const episodeAnchors = episodes
    .slice()
    .sort((a, b) => new Date(b.startDate ?? 0).getTime() - new Date(a.startDate ?? 0).getTime())
    .slice(0, 6)
    .map(buildEpisodeAnchor);

  const noteAnchors = notes
    .filter((note) => !String(note.noteType ?? '').toLowerCase().startsWith('ai_'))
    .slice()
    .sort((a, b) => new Date(b.createdAt ?? b.noteDateTime ?? 0).getTime() - new Date(a.createdAt ?? a.noteDateTime ?? 0).getTime())
    .slice(0, 28)
    .map((note) => {
      const content = notePlainText(note);
      if (!content) return '';
      const labels = collectSignalLabels(content.toLowerCase());
      const snippet = evidenceSnippet(content);
      if (!snippet) return '';
      const date = note.createdAt ?? note.noteDateTime;
      const header = `[${date ? fmtDate(date) : 'Unknown date'}] ${note.title ?? 'Clinical note'}`;
      const labelText = labels.length > 0 ? ` — findings: ${labels.join(', ')}` : '';
      return `${header}: ${snippet}${labelText}`;
    })
    .filter((value) => value.length > 0)
    .slice(0, 10);

  return canonicalUnique([...noteAnchors, ...episodeAnchors], 14);
}

function normalizeSummary(value: unknown): DsmMultiaxialSummary | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const axisV = typeof row.axisV === 'string' ? row.axisV.trim() : '';
  return {
    axisI: normalizeList(row.axisI),
    axisII: normalizeList(row.axisII),
    axisIII: normalizeList(row.axisIII),
    axisIV: normalizeList(row.axisIV),
    axisV: axisV || 'No formal score documented; infer from evidence anchors.',
    differentialDiagnoses: normalizeList(row.differentialDiagnoses),
    evidenceAnchors: normalizeList(row.evidenceAnchors),
    diagnosticSynthesis: normalizeList(row.diagnosticSynthesis),
    codingAlignment: normalizeList(row.codingAlignment),
    rulesetVersion:
      typeof row.rulesetVersion === 'string' && row.rulesetVersion.trim().length > 0
        ? row.rulesetVersion.trim()
        : DIAGNOSIS_RULESET_VERSION,
  };
}

function extractJsonFromText(raw: string): unknown | null {
  const text = raw.trim();
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? text;
  try {
    return JSON.parse(fenced);
  } catch {
    const start = fenced.indexOf('{');
    const end = fenced.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(fenced.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function deriveDsmSummary(episodes: SummaryEpisodeRow[], notes: SummaryNoteRow[]): DsmMultiaxialSummary {
  const diagnosisCandidates = Array.from(
    new Set(
      episodes
        .flatMap((episode) => [episode.primaryDiagnosis, episode.diagnoses])
        .map((value) => (value ?? '').trim())
        .filter((value) => value.length > 0),
    ),
  );
  const noteText = notes
    .slice(0, 40)
    .map((note) => notePlainText(note).toLowerCase())
    .join(' ');

  const axisIISignals: string[] = [];
  if (/personality|emotion dysregulation|trait/.test(noteText)) axisIISignals.push('Personality-trait burden documented in longitudinal reviews.');
  if (/autism|adhd|intellectual/.test(noteText)) axisIISignals.push('Neurodevelopmental differential documented in clinical notes.');

  const axisII = axisIISignals.length > 0
    ? axisIISignals
    : ['No definitive personality or neurodevelopmental diagnosis documented.'];

  const axisIIISignals: string[] = [];
  if (/diabetes|hba1c/.test(noteText)) axisIIISignals.push('Metabolic comorbidity (diabetes / glycaemic risk) referenced.');
  if (/hypertension|blood pressure/.test(noteText)) axisIIISignals.push('Cardiovascular risk indicators documented.');
  if (/thyroid|renal|lithium/.test(noteText)) axisIIISignals.push('Medical monitoring context (thyroid/renal/lithium) documented.');
  const axisIII = axisIIISignals.length > 0
    ? axisIIISignals
    : ['No major general-medical Axis III diagnosis explicitly captured in source notes.'];

  const axisIVSignals: string[] = [];
  if (/housing|homeless|eviction/.test(noteText)) axisIVSignals.push('Housing instability / accommodation stressor noted.');
  if (/financial|debt|employment|job/.test(noteText)) axisIVSignals.push('Financial or vocational stressor documented.');
  if (/relationship|separation|family conflict/.test(noteText)) axisIVSignals.push('Interpersonal/relationship stressors documented.');
  if (/sleep deprivation|insomnia/.test(noteText)) axisIVSignals.push('Sleep disruption documented as precipitant.');
  const axisIV = axisIVSignals.length > 0
    ? axisIVSignals
    : ['Psychosocial stressors not explicitly structured; refer evidence anchors.'];

  const longitudinal = inferLongitudinalSynthesis(episodes, notes);
  const evidenceAnchors = buildDetailedEvidenceAnchors(episodes, notes);
  const axisI = canonicalUnique([
    ...longitudinal.synthesis.map((value) => `Longitudinal synthesis: ${value}`),
    ...diagnosisCandidates,
  ], 8);

  return {
    axisI: axisI.length > 0 ? axisI : ['Diagnosis not yet documented in episodes/review notes.'],
    axisII,
    axisIII,
    axisIV,
    axisV: 'Global functioning score not formally codified; infer impairment level from evidence anchors, episode acuity, and inter-episode recovery notes.',
    differentialDiagnoses: canonicalUnique([...longitudinal.differentials, ...diagnosisCandidates.slice(1)], 8),
    evidenceAnchors,
    diagnosticSynthesis: longitudinal.synthesis,
    codingAlignment: longitudinal.coding,
    rulesetVersion: DIAGNOSIS_RULESET_VERSION,
  };
}

function mergeWithHeuristicSummary(
  aiSummary: DsmMultiaxialSummary | null,
  heuristicSummary: DsmMultiaxialSummary,
): DsmMultiaxialSummary {
  if (!aiSummary) return heuristicSummary;

  return {
    axisI: canonicalUnique([...aiSummary.axisI, ...heuristicSummary.axisI], 10),
    axisII: canonicalUnique([...aiSummary.axisII, ...heuristicSummary.axisII], 8),
    axisIII: canonicalUnique([...aiSummary.axisIII, ...heuristicSummary.axisIII], 8),
    axisIV: canonicalUnique([...aiSummary.axisIV, ...heuristicSummary.axisIV], 8),
    axisV: aiSummary.axisV.trim() || heuristicSummary.axisV,
    differentialDiagnoses: canonicalUnique([...aiSummary.differentialDiagnoses, ...heuristicSummary.differentialDiagnoses], 10),
    evidenceAnchors: canonicalUnique([...aiSummary.evidenceAnchors, ...heuristicSummary.evidenceAnchors], 16),
    diagnosticSynthesis: canonicalUnique([...aiSummary.diagnosticSynthesis, ...heuristicSummary.diagnosticSynthesis], 8),
    codingAlignment: canonicalUnique([...aiSummary.codingAlignment, ...heuristicSummary.codingAlignment], 6),
    rulesetVersion: DIAGNOSIS_RULESET_VERSION,
  };
}

function buildDiagnosisContext(
  patient: SummaryPatientProfile,
  episodes: SummaryEpisodeRow[],
  notes: SummaryNoteRow[],
  heuristicSummary: DsmMultiaxialSummary,
): string {
  const reviewNotes = notes
    .filter((note) => !String(note.noteType ?? '').toLowerCase().startsWith('ai_'))
    .slice(0, 12)
    .map((note) => {
      const content = notePlainText(note);
      const evidence = evidenceSnippet(content);
      const tags = collectSignalLabels(content.toLowerCase());
      const baseline = `[${note.createdAt ? fmtDate(note.createdAt) : 'Unknown date'}] ${note.title ?? 'Review'}: ${content.substring(0, 450)}`;
      if (!evidence) return baseline;
      return `${baseline}\n  Evidence focus: ${evidence}${tags.length > 0 ? ` | markers: ${tags.join(', ')}` : ''}`;
    });

  const episodeSummary = episodes
    .slice(0, 12)
    .map((episode) => `- ${episode.startDate ?? '?'} to ${episode.endDate ?? 'ongoing'} | ${episode.episodeType ?? 'episode'} | ${episode.primaryDiagnosis ?? episode.diagnoses ?? ''}`)
    .join('\n');

  return [
    `Patient: ${patient.givenName} ${patient.familyName} | DOB: ${patient.dateOfBirth}`,
    '',
    'EPISODES:',
    episodeSummary || '- None documented',
    '',
    'REVIEW NOTE EXCERPTS:',
    reviewNotes.length > 0 ? reviewNotes.join('\n') : '- None available',
    '',
    'TASK:',
    'Return STRICT JSON only with this exact schema:',
    '{',
    '  "rulesetVersion": string,',
    '  "axisI": string[],',
    '  "axisII": string[],',
    '  "axisIII": string[],',
    '  "axisIV": string[],',
    '  "axisV": string,',
    '  "differentialDiagnoses": string[],',
    '  "diagnosticSynthesis": string[],',
    '  "codingAlignment": string[],',
    '  "evidenceAnchors": string[]',
    '}',
    '',
    'Seed guidance from deterministic ruleset (must preserve and refine):',
    JSON.stringify(heuristicSummary, null, 2),
    '',
    'Rules:',
    '- Use DSM-5-TR clinical framing and provide ICD alignment (ICD-10-AM or ICD-11 family-level where evidence supports).',
    '- Synthesize longitudinally: if mania/hypomania and depressive episodes are documented at different times, explicitly reflect bipolar-spectrum formulation.',
    '- This is diagnosis-only output: no treatment plans, no management tasks, no subjective section.',
    '- Do NOT include treatment plans, subjective section, or management actions.',
    '- Evidence anchors must be specific: include date + source + observed finding from documentation (e.g., MSE grandiosity/delusions/pressured speech).',
    `- Always set "rulesetVersion" to "${DIAGNOSIS_RULESET_VERSION}".`,
  ].join('\n');
}

function renderList(title: string, values: string[]): React.ReactElement {
  return (
    <Box sx={{ mb: 1.2 }}>
      <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ display: 'block', mb: 0.4 }}>
        {title}
      </Typography>
      <Box sx={{ pl: 1 }}>
        {values.length > 0 ? values.map((value, index) => (
          <Typography key={`${title}-${index}`} variant="body2" sx={{ fontFamily: 'monospace', fontSize: 12, lineHeight: 1.5 }}>
            {`${index + 1}. ${value}`}
          </Typography>
        )) : (
          <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: 12 }}>
            None documented.
          </Typography>
        )}
      </Box>
    </Box>
  );
}

function renderDiagnosisHistory(versions: SummaryArtifactVersion[]): React.ReactElement | null {
  const rows = versions.filter((row) => row.content.trim().length > 0);
  if (rows.length === 0) return null;
  return (
    <Accordion sx={{ mt: 1.5 }}>
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Typography variant="subtitle2" fontWeight={700} fontFamily="Albert Sans, sans-serif">
          Previous Diagnosis Summaries
        </Typography>
      </AccordionSummary>
      <AccordionDetails sx={{ pt: 0 }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {rows.map((version, index) => (
            <Paper key={version.id} variant="outlined" sx={{ p: 1.5, bgcolor: '#FAFAFA' }}>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.6 }}>
                Version {rows.length - index} · {fmtDate(version.createdAt)}
              </Typography>
              <Box sx={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: 11, color: '#3D484B', maxHeight: 160, overflowY: 'auto' }}>
                {version.content}
              </Box>
            </Paper>
          ))}
        </Box>
      </AccordionDetails>
    </Accordion>
  );
}

export function DiagnosisSummaryCard({
  patientId,
  patient,
  episodes,
  notes,
}: DiagnosisSummaryCardProps) {
  const queryClient = useQueryClient();
  const [diagnosisLoading, setDiagnosisLoading] = useState(false);
  const [diagnosisPersisting, setDiagnosisPersisting] = useState(false);
  const [diagnosisError, setDiagnosisError] = useState('');
  const [aiDiagnosisSummary, setAiDiagnosisSummary] = useState<DsmMultiaxialSummary | null>(null);
  const [diagnosisNoteId, setDiagnosisNoteId] = useState<string | null>(null);
  const loadedDiagnosisRef = useRef<string>('');

  const { data: signoffRows = [] } = useQuery({
    queryKey: patientsKeys.summarySignoffs(patientId),
    queryFn: () => apiClient.get<{ signoffs?: SummarySignoffRecord[] }>(`patients/${patientId}/summary-signoffs`).then((r) => r.signoffs ?? []),
    enabled: Boolean(patientId),
    staleTime: 60_000,
  });

  const diagnosisSignoff = signoffRows.find((row) => row.section === 'diagnosis_summary');
  const resetLocked = Boolean(diagnosisSignoff);

  const diagnosisArtifacts = useMemo(
    () => listArtifactNotes(notes, DIAGNOSIS_SUMMARY_NOTE_TYPE),
    [notes],
  );
  const persistedDiagnosis = useMemo(
    () => findLatestArtifactNote(notes, DIAGNOSIS_SUMMARY_NOTE_TYPE),
    [notes],
  );
  const diagnosisHistory = useMemo(() => diagnosisArtifacts.slice(1), [diagnosisArtifacts]);

  useEffect(() => {
    const snapshot = `${persistedDiagnosis.id ?? ''}::${persistedDiagnosis.content}`;
    if (loadedDiagnosisRef.current === snapshot) return;
    loadedDiagnosisRef.current = snapshot;
    setDiagnosisNoteId(persistedDiagnosis.id);
    if (!persistedDiagnosis.content) {
      setAiDiagnosisSummary(null);
      return;
    }
    const parsed = normalizeSummary(extractJsonFromText(persistedDiagnosis.content));
    setAiDiagnosisSummary(parsed);
  }, [persistedDiagnosis.id, persistedDiagnosis.content]);

  const derivedDiagnosisSummary = useMemo(
    () => deriveDsmSummary(episodes, notes),
    [episodes, notes],
  );
  const displayDiagnosis = useMemo(
    () => mergeWithHeuristicSummary(aiDiagnosisSummary, derivedDiagnosisSummary),
    [aiDiagnosisSummary, derivedDiagnosisSummary],
  );

  const persistDiagnosis = async (
    summary: DsmMultiaxialSummary | null,
    options?: { createNewVersion?: boolean },
  ) => {
    setDiagnosisPersisting(true);
    try {
      const content = summary ? JSON.stringify(summary, null, 2) : '';
      const nextId = await upsertSummaryArtifactNote({
        patientId,
        noteId: diagnosisNoteId,
        noteType: DIAGNOSIS_SUMMARY_NOTE_TYPE,
        title: DIAGNOSIS_SUMMARY_NOTE_TITLE,
        content,
        createNewVersion: options?.createNewVersion === true,
      });
      setDiagnosisNoteId(nextId);
      await queryClient.invalidateQueries({ queryKey: patientsKeys.notes(patientId) });
    } finally {
      setDiagnosisPersisting(false);
    }
  };

  const generateDiagnosisSummary = async () => {
      setDiagnosisLoading(true);
      setDiagnosisError('');
      try {
        const payload = buildDiagnosisContext(patient, episodes, notes, derivedDiagnosisSummary);
        const result = await llmAiJobsApi.runClinicalAiJob({
          action: 'report-insight',
          data: payload,
          patientId,
          enhance: true,
        });
      const parsed = normalizeSummary(extractJsonFromText(result));
      if (!parsed) {
        throw new Error('AI response was not in the expected DSM schema JSON format.');
      }
      const merged = mergeWithHeuristicSummary(parsed, derivedDiagnosisSummary);
      setAiDiagnosisSummary(merged);
      await persistDiagnosis(merged, {
        createNewVersion: Boolean(diagnosisSignoff),
      });
    } catch (err: unknown) {
      setDiagnosisError(
        extractErrorMessage(err, 'Failed to generate diagnosis summary.'),
      );
    } finally {
      setDiagnosisLoading(false);
    }
  };

  const hardReset = async () => {
    if (resetLocked) return;
    setDiagnosisError('');
    try {
      await persistDiagnosis(null);
      setAiDiagnosisSummary(null);
    } catch (err) {
      setDiagnosisError(extractErrorMessage(err, 'Failed to reset diagnosis summary.'));
    }
  };

  return (
    <Paper variant="outlined" sx={{ p: 2.2, mb: 3, borderLeft: '4px solid #5C6BC0' }}>
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 1.5,
          mb: 1,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <PsychologyIcon sx={{ color: '#5C6BC0', fontSize: 20 }} />
          <Typography
            variant="subtitle1"
            fontWeight={700}
            fontFamily="Albert Sans, sans-serif"
          >
            Diagnosis (DSM/ICD Evidence Synthesis)
          </Typography>
          <Chip
            label="Evidence Anchored"
            size="small"
            sx={{
              fontSize: 9,
              height: 18,
              bgcolor: '#E8EAF6',
              color: '#3949AB',
            }}
          />
        </Box>
        <SectionSignoffControls
          patientId={patientId}
          section="diagnosis_summary"
        />
      </Box>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ display: 'block', mb: 1 }}
      >
        Axes I–V with longitudinal synthesis, differential diagnosis, coding alignment, and specific evidence anchors. Subjective/plan sections are intentionally excluded.
      </Typography>
      {resetLocked && (
        <Alert severity="info" sx={{ mb: 1 }}>
          Diagnosis summary is consultant signed-off. It cannot be hard reset, but you can generate a new version and prior signed versions stay in history.
        </Alert>
      )}
      {diagnosisError && <Alert severity="error" sx={{ mb: 1 }}>{diagnosisError}</Alert>}
      <Box
        sx={{
          whiteSpace: 'pre-wrap',
          fontFamily: 'monospace',
          fontSize: 12,
          color: '#3D484B',
          bgcolor: '#FAFAFA',
          p: 2,
          borderRadius: 1,
        }}
      >
        {renderList('Axis I (Clinical syndromes)', displayDiagnosis.axisI)}
        {renderList('Axis II (Personality / developmental)', displayDiagnosis.axisII)}
        {renderList('Axis III (General medical)', displayDiagnosis.axisIII)}
        {renderList('Axis IV (Psychosocial stressors)', displayDiagnosis.axisIV)}
        {renderList('Longitudinal diagnostic synthesis', displayDiagnosis.diagnosticSynthesis)}
        <Box sx={{ mb: 1.2 }}>
          <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ display: 'block', mb: 0.4 }}>
            Axis V (Global functioning)
          </Typography>
          <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: 12 }}>
            {displayDiagnosis.axisV}
          </Typography>
        </Box>
        {renderList('Differential diagnoses', displayDiagnosis.differentialDiagnoses)}
        {renderList('DSM/ICD coding alignment', displayDiagnosis.codingAlignment)}
        {renderList('Evidence anchors', displayDiagnosis.evidenceAnchors)}
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.8 }}>
          Ruleset: {displayDiagnosis.rulesetVersion}
        </Typography>
      </Box>
      <Box sx={{ mt: 1, display: 'flex', justifyContent: 'flex-end', gap: 0.75 }}>
        <Button
          size="small"
          startIcon={
            diagnosisLoading ? <CircularProgress size={12} /> : <AutoAwesomeIcon />
          }
          onClick={generateDiagnosisSummary}
          disabled={diagnosisLoading || diagnosisPersisting}
          sx={{ color: '#3949AB', fontSize: 11, fontWeight: 600 }}
        >
          {diagnosisLoading
            ? 'Generating...'
            : aiDiagnosisSummary
              ? 'Regenerate'
              : 'Generate with AI'}
        </Button>
        {aiDiagnosisSummary && (
          <Tooltip title={resetLocked ? 'Reset disabled after consultant sign-off' : 'Explicitly clear the persisted diagnosis summary'}>
            <span>
              <Button
                size="small"
                onClick={hardReset}
                disabled={resetLocked || diagnosisPersisting}
                sx={{ color: resetLocked ? 'text.disabled' : '#8D6E63', fontSize: 11 }}
              >
                Hard reset
              </Button>
            </span>
          </Tooltip>
        )}
      </Box>
      {renderDiagnosisHistory(diagnosisHistory)}
    </Paper>
  );
}
