import { DEFAULT_CLINIC_TIME_ZONE } from '@signacare/shared';
import { deriveMoodSignalFromNote, getNoteNarrativeText } from './lifeChartDomain';
import {
  DAY_MS,
  asMs,
  asText,
  createEmptySchemaDoc,
  createEmptySchemaRow,
  episodeSymptomPolarity,
  inferDisorderLabel,
  inferPrimaryDomain,
  mapPolarityToChannel,
  normalizeDate,
  polarityFromEpisode,
  severityToScore,
  sortByDate,
  toIsoDate,
  type EpisodeSymptomPolarity,
  type LifeChartDateCertainty,
  type LifeChartMedicationEntry,
  type LifeChartRemissionStatus,
  type LifeChartSchemaDoc,
  type LifeChartSymptomChannel,
  type SummaryEpisodeRow,
  type SummaryMedicationRow,
  type SummaryNoteRow,
  type SummaryPatientProfile,
} from './lifeChartSchemaCore';

function extractHospitalSignal(notes: SummaryNoteRow[], start: string, end: string): string {
  if (!start || !end) return '';
  const st = new Date(start).getTime();
  const et = new Date(end).getTime();
  const matches = notes.filter((n) => {
    const t = new Date(n.createdAt ?? n.noteDateTime ?? '').getTime();
    if (Number.isNaN(t) || t < st || t > et) return false;
    const txt = `${n.title ?? ''} ${n.content ?? ''} ${n.assessmentHtml ?? ''}`.toLowerCase();
    return /hospital|admit|involuntar|cto|acute|crisis/.test(txt);
  });
  if (matches.length === 0) return '';
  return matches.length > 1 ? 'Hospital or crisis contact documented' : 'Hospital / crisis event documented';
}

function classifyRegimenClass(entry: SummaryMedicationRow): LifeChartMedicationEntry['regimenClass'] {
  const label = `${entry.medicationName ?? ''} ${entry.drugLabel ?? ''} ${entry.dose ?? ''}`.toLowerCase();
  if (/(prn|rescue|stat|as needed)/.test(label)) return 'acute';
  if (/(lithium|lamotrigine|valproate|quetiapine|olanzapine|aripiprazole|risperidone|clozapine|paliperidone)/.test(label)) {
    return 'maintenance';
  }
  if (/(adjunct|booster|augmentation)/.test(label)) return 'adjunct';
  return 'other';
}

function buildMedicationSlice(meds: SummaryMedicationRow[], start: string, end: string): {
  label: string;
  structured: LifeChartMedicationEntry[];
} {
  const st = new Date(start).getTime();
  const et = new Date(end).getTime();
  const active = meds.filter((m) => {
    const ms = new Date(m.prescribedAt ?? m.startDate ?? m.createdAt ?? '').getTime();
    const me = new Date(m.ceasedAt ?? m.endDate ?? m.updatedAt ?? '').getTime();
    const startOk = !Number.isNaN(ms) && ms <= et;
    const endOk = Number.isNaN(me) || me >= st;
    return startOk && endOk;
  });
  const structured = active
    .map((m): LifeChartMedicationEntry => ({
      name: m.medicationName ?? m.drugLabel ?? 'Medication',
      dose: m.dose ?? '',
      route: m.route ?? '',
      startDate: normalizeDate(m.prescribedAt ?? m.startDate ?? m.createdAt ?? ''),
      endDate: normalizeDate(m.ceasedAt ?? m.endDate ?? ''),
      regimenClass: classifyRegimenClass(m),
      sourceMedicationId: m.id,
    }))
    .slice(0, 8);
  const labels = structured.map((m) => `${m.name}${m.dose ? ` ${m.dose}` : ''}`);
  return { label: [...new Set(labels)].slice(0, 4).join('; '), structured };
}

function summarizeEvidenceAnchor(note: SummaryNoteRow): string {
  const date = normalizeDate(note.createdAt ?? note.noteDateTime ?? '');
  const title = asText(note.title).trim();
  const text = getNoteNarrativeText(note).replace(/\s+/g, ' ').trim();
  const excerpt = text.length > 120 ? `${text.slice(0, 120)}...` : text;
  return [date, title || note.noteType || 'note', excerpt].filter(Boolean).join(' | ');
}

function noteMatchesEpisodeSymptom(note: SummaryNoteRow, polarity: EpisodeSymptomPolarity): boolean {
  const text = getNoteNarrativeText(note).toLowerCase();
  if (!text) return false;
  const signal = deriveMoodSignalFromNote(note);
  switch (polarity) {
    case 'manic':
      return signal.polarity === 'manic' || /\b(mania|manic|hypoman|grandios|pressured speech|flight of ideas)\b/i.test(text);
    case 'depressive':
      return signal.polarity === 'depressive' || /\b(depress|anhedonia|hopeless|suicid|psychomotor retard)\b/i.test(text);
    case 'psychotic':
      return /\b(psychosis|psychotic|hallucin|delusion|paranoi|disorganis)\b/i.test(text);
    case 'anxious':
      return /\b(anxiety|panic|rumination|hypervigilance|obsess|compuls)\b/i.test(text);
    default:
      return signal.magnitude > 0 || /\b(relapse|decompens|worsen|crisis)\b/i.test(text);
  }
}

function isRemissionNarrative(note: SummaryNoteRow): boolean {
  const text = getNoteNarrativeText(note).toLowerCase();
  if (!text) return false;
  return /\b(remission|euthymi|stable|settled|resolved|recover|improv(?:ed|ing)|asymptomatic|denies halluc|denies delusion|denies suicid)\b/i.test(text);
}

function deriveSymptomWindowFromEpisode(
  episode: SummaryEpisodeRow,
  notes: SummaryNoteRow[],
): {
  symptomOnset: string;
  symptomRemission: string;
  careWindowLabel: string;
  matchedNoteIds: string[];
  evidenceAnchors: string[];
  dateCertainty: LifeChartDateCertainty;
  remissionStatus: LifeChartRemissionStatus;
} {
  const careStartMs = asMs(episode.startDate);
  const careEndMs = asMs(episode.endDate) ?? Date.now();
  const anchorStart = careStartMs ?? careEndMs;
  const polarity = episodeSymptomPolarity(episode);
  const lookbackStart = anchorStart - 270 * DAY_MS;
  const lookaheadEnd = careEndMs + 120 * DAY_MS;

  const matchedNotes = notes
    .map((note) => ({ note, ts: asMs(note.createdAt ?? note.noteDateTime) }))
    .filter((x): x is { note: SummaryNoteRow; ts: number } => x.ts !== null)
    .filter((x) => x.ts >= lookbackStart && x.ts <= lookaheadEnd)
    .filter((x) => noteMatchesEpisodeSymptom(x.note, polarity))
    .sort((a, b) => a.ts - b.ts);

  const firstSymptomMs = matchedNotes[0]?.ts ?? careStartMs ?? careEndMs;
  const onsetMs = careStartMs !== null ? Math.min(firstSymptomMs, careStartMs) : firstSymptomMs;

  const remissionNoteMs = matchedNotes
    .filter((x) => x.ts >= onsetMs)
    .find((x) => isRemissionNarrative(x.note))?.ts;
  const lastSymptomMs = matchedNotes.length > 0 ? matchedNotes[matchedNotes.length - 1].ts : null;
  let remissionMs = careEndMs;
  if (remissionNoteMs && remissionNoteMs <= careEndMs) {
    remissionMs = remissionNoteMs;
  } else if (lastSymptomMs && careStartMs !== null && lastSymptomMs >= careStartMs && lastSymptomMs < careEndMs) {
    remissionMs = lastSymptomMs;
  }
  if (remissionMs < onsetMs) remissionMs = onsetMs;

  const careWindowLabel = `${normalizeDate(episode.startDate)} → ${normalizeDate(episode.endDate) || 'ongoing'}`;
  const matchedNoteIds = matchedNotes
    .map((x) => asText(x.note.id))
    .filter(Boolean)
    .slice(0, 20);
  const evidenceAnchors = matchedNotes
    .slice(0, 6)
    .map((x) => summarizeEvidenceAnchor(x.note))
    .filter(Boolean);
  const dateCertainty: LifeChartDateCertainty =
    matchedNotes.length >= 2 ? 'exact' : matchedNotes.length === 1 ? 'estimated' : 'unknown';
  const remissionStatus: LifeChartRemissionStatus = episode.endDate ? 'remitted' : 'ongoing';

  return {
    symptomOnset: toIsoDate(onsetMs),
    symptomRemission: toIsoDate(remissionMs),
    careWindowLabel,
    matchedNoteIds,
    evidenceAnchors,
    dateCertainty,
    remissionStatus,
  };
}

export function buildHeuristicSchemaDoc(
  patient: SummaryPatientProfile,
  episodes: SummaryEpisodeRow[],
  notes: SummaryNoteRow[],
  meds: SummaryMedicationRow[],
): LifeChartSchemaDoc {
  const sortedEpisodes = sortByDate(episodes, (e) => e.startDate);
  const disorderLabel = inferDisorderLabel(sortedEpisodes);
  const primaryDomain = inferPrimaryDomain(disorderLabel);
  const rows = sortedEpisodes.map((ep, index) => {
    const symptomWindow = deriveSymptomWindowFromEpisode(ep, notes);
    const startDate = symptomWindow.symptomOnset;
    const endDate = symptomWindow.symptomRemission;
    const score = severityToScore(ep.severity) * polarityFromEpisode(ep);
    const state = ep.episodeType ?? ep.primaryDiagnosis ?? ep.title ?? 'Episode';
    const channel = mapPolarityToChannel(episodeSymptomPolarity(ep));
    const medicationSlice = buildMedicationSlice(meds, startDate, endDate);
    return createEmptySchemaRow({
      intervalLabel: `Symptom Interval ${index + 1}`,
      symptomChannel: channel,
      startDate,
      startDatePrecision: 'day',
      endDate,
      endDatePrecision: 'day',
      dateCertainty: symptomWindow.dateCertainty,
      remissionStatus: symptomWindow.remissionStatus,
      primaryState: state,
      primaryScore: score,
      medications: medicationSlice.label,
      medicationsStructured: medicationSlice.structured,
      lifeEvents: '',
      triggers: '',
      interventions: '',
      interEpisodeFunctioning: ep.status === 'closed' ? 'Symptoms remitted; recovery/inter-episode functioning phase' : 'Active symptom phase under care',
      substanceUse: '',
      hospitalization: extractHospitalSignal(notes, startDate, endDate),
      notes: `${ep.primaryDiagnosis ?? ''}${ep.primaryDiagnosis ? ' | ' : ''}Care window: ${symptomWindow.careWindowLabel}`,
      provenance: {
        sourceTypes: ['episode', 'note', 'medication'],
        sourceIds: [ep.id, ...symptomWindow.matchedNoteIds, ...medicationSlice.structured.map((m) => m.sourceMedicationId)].filter(Boolean),
        evidenceAnchors: symptomWindow.evidenceAnchors,
        confidence: symptomWindow.evidenceAnchors.length >= 2 ? 'high' : (symptomWindow.evidenceAnchors.length === 1 ? 'medium' : 'low'),
      },
    });
  });

  if (rows.length === 0) {
    rows.push(
      createEmptySchemaRow({
        intervalLabel: 'Current period',
        symptomChannel: 'general',
        startDate: normalizeDate(new Date().toISOString()),
        startDatePrecision: 'day',
        endDate: normalizeDate(new Date().toISOString()),
        endDatePrecision: 'day',
        dateCertainty: 'unknown',
        remissionStatus: 'unclear',
        primaryState: 'Baseline / monitored symptoms',
        primaryScore: 0,
        medications: '',
        medicationsStructured: [],
        lifeEvents: '',
        triggers: '',
        interventions: '',
        interEpisodeFunctioning: '',
        substanceUse: '',
        hospitalization: '',
        notes: `Auto-initialized for ${patient.givenName} ${patient.familyName}`,
        provenance: {
          sourceTypes: ['manual'],
          sourceIds: [],
          evidenceAnchors: ['Auto initialized from available demographics; no episode evidence found'],
          confidence: 'low',
        },
      }),
    );
  }

  return createEmptySchemaDoc({
    disorderLabel,
    primaryDomain,
    symptomMode: primaryDomain === 'mood' ? 'bidirectional' : 'severity',
    baselineLabel: primaryDomain === 'mood' ? 'Euthymia / baseline mood' : 'Baseline symptom burden',
    generatedBy: 'heuristic',
    rows,
  });
}

export function buildLifeChartSchemaPrompt(args: {
  patient: SummaryPatientProfile;
  episodes: SummaryEpisodeRow[];
  notes: SummaryNoteRow[];
  medications: SummaryMedicationRow[];
  clinicTimeZone?: string;
}): string {
  const { patient, episodes, notes, medications, clinicTimeZone } = args;
  const timezone = clinicTimeZone || DEFAULT_CLINIC_TIME_ZONE;
  const episodeSummary = episodes
    .slice(0, 24)
    .map((e) => `- ${e.startDate ?? '?'} to ${e.endDate ?? 'ongoing'} | ${e.episodeType ?? 'episode'} | ${e.primaryDiagnosis ?? ''} | severity=${e.severity ?? 'unknown'}`)
    .join('\n');
  const medSummary = medications
    .slice(0, 30)
    .map((m) => `- ${m.medicationName ?? m.drugLabel ?? 'medication'} ${m.dose ?? ''} ${m.frequency ?? ''} | start=${m.prescribedAt ?? m.startDate ?? ''} | cease=${m.ceasedAt ?? m.endDate ?? ''}`)
    .join('\n');
  const noteSummary = notes
    .slice(0, 40)
    .map((n) => `- ${n.createdAt ?? n.noteDateTime ?? ''} | ${n.noteType ?? 'note'} | ${n.title ?? ''} | ${(n.content ?? '').slice(0, 180)}`)
    .join('\n');

  return [
    'Build an editable, disorder-agnostic psychiatric lifechart schema in STRICT JSON.',
    'This schema is an enterprise EMR artifact: include provenance anchors, explicit symptom channels, and date precision.',
    'The schema must support bipolar, psychosis/schizophrenia, anxiety disorders, trauma disorders, personality disorders, and substance use trajectories.',
    'Interpret startDate/endDate as symptom onset/remission (clinical trajectory), not administrative care episode boundaries.',
    'Dates must be clinic-local civil dates (YYYY-MM-DD) in timezone below. If source date is partial (year/month), normalize to first day and set precision.',
    'Allow overlaps across different channels, but do NOT create overlapping intervals within the same symptomChannel.',
    'Do not encode medication severity using mg. Medication lane is categorical timeline only.',
    'For bipolar-type illness use bidirectional scoring (mania/hypomania positive, depression negative).',
    'For non-bidirectional disorders use positive severity scores (0..4) and set symptomMode to "severity".',
    'Return JSON only with this exact top-level structure:',
    '{ "version":"2.0","disorderLabel":"...","primaryDomain":"...","symptomMode":"bidirectional|severity","baselineLabel":"...","clinicTimeZone":"...","chronology":"most_recent_first","governance":{"dateContract":"clinic_local_civil_date","overlapPolicy":"merge_same_channel_allow_cross_channel_overlap","medicationScale":"categorical_not_mg","evidencePolicy":"anchor_required"},"privacy":{"scope":"clinic_only","containsSensitiveNarrative":true},"audit":{"lineageId":"...","revision":1,"parentRevision":null,"lastEditedAt":"ISO-8601","lastEditedByMode":"ai","manualEditCount":0},"generatedBy":"ai","updatedAt":"ISO-8601","rows":[ ... ] }',
    'Each row must contain: id, intervalLabel, symptomChannel, startDate, startDatePrecision, endDate, endDatePrecision, dateCertainty, remissionStatus, primaryState, primaryScore, medications, medicationsStructured[], lifeEvents, triggers, interventions, interEpisodeFunctioning, substanceUse, hospitalization, notes, provenance{sourceTypes[],sourceIds[],evidenceAnchors[],confidence}.',
    'Use symptomChannel values from: mania_hypomania, depression, psychosis, anxiety_trauma, substance, functioning, general.',
    'For provenance.evidenceAnchors include concise evidence snippets with date + clinical finding (e.g., MSE finding).',
    'Use concise plain text, no markdown.',
    '',
    `CLINIC_TIMEZONE: ${timezone}`,
    `PATIENT: ${patient.givenName} ${patient.familyName} | DOB=${patient.dateOfBirth} | gender=${patient.gender ?? 'unspecified'}`,
    '',
    'EPISODES:',
    episodeSummary || '- none',
    '',
    'MEDICATIONS:',
    medSummary || '- none',
    '',
    'NOTES:',
    noteSummary || '- none',
  ].join('\n');
}

export type { LifeChartSymptomChannel };
