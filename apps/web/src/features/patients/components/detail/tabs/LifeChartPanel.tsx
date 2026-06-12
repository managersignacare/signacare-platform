import React from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Chip,
  CircularProgress,
  Grid,
  IconButton,
  Paper,
  Tooltip,
  Typography,
} from '@mui/material';
import { DEFAULT_CLINIC_TIME_ZONE } from '@signacare/shared';
import RefreshIcon from '@mui/icons-material/Refresh';
import TimelineIcon from '@mui/icons-material/Timeline';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { usePatient } from '../../../hooks/usePatient';
import { apiClient } from '../../../../../shared/services/apiClient';
import { episodesKeys, patientMedicationsKeys, patientsKeys, riskAllergiesKeys } from '../../../queryKeys';
import {
  parseDate,
  type SummaryAlertRow,
  type SummaryEpisodeRow,
  type SummaryMedicationRow,
  type SummaryNoteRow,
  type SummaryRiskAssessmentRow,
} from './summaryTabDomain';
import {
  NOTE_LIFE_EVENT_RULES,
  RESIDUAL_KEYWORDS,
  buildWavePath,
  classifyIllnessPattern,
  deriveMoodSignalFromNote,
  formatEpisodeDuration,
  getNoteNarrativeText,
  getPrimaryDomainDisplayLabel,
} from './lifeChartDomain';
import { LifeChartSchemaTable } from './LifeChartSchemaTable';
import {
  type LifeChartSchemaRow,
} from './lifeChartSchemaDomain';
import { SectionSignoffControls } from './SummarySignoffControls';
import { useLifeChartSchema } from './useLifeChartSchema';
import { renderArtifactHistoryCard } from './summaryHistoryCard';
import type { SummarySignoffRecord } from './summarySignoffTypes';
import { LifeChartTimelineChart } from './LifeChartTimelineChart';

interface LifeChartPanelProps { patientId: string }
export function LifeChartPanel({ patientId }: LifeChartPanelProps) {
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

  if (!patient) return <CircularProgress role="progressbar" aria-label="Loading" size={24} />;

  const dob = patient.dateOfBirth;
  const allEpisodes = episodes ?? [];
  const allNotes = notes ?? [];
  const allMeds = meds ?? [];
  const allRisks = risks ?? [];
  const allAlerts = alerts ?? [];

  const lifeChartSignoff = signoffRows.find((row) => row.section === 'life_chart');
  const {
    schemaDoc,
    setSchemaDoc,
    schemaLoading,
    schemaSaving,
    schemaError,
    setSchemaError,
    schemaInfo,
    setSchemaInfo,
    schemaHistory,
    generateSchemaWithAi,
    resetSchemaHeuristic,
    saveSchema,
  } = useLifeChartSchema({
    patientId,
    patient,
    episodes,
    notes,
    medications: meds,
    lifeChartSignoff,
  });

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

        <LifeChartTimelineChart
          totalWidth={TOTAL_WIDTH}
          totalHeight={TOTAL_H}
          years={years}
          leftLabel={LEFT_LABEL}
          yearWidth={YEAR_W}
          symptomBaselineY={SYMPTOM_BASELINE_Y}
          medicationHeight={MED_H}
          chartWidth={CHART_WIDTH}
          medicationBars={medBars}
          symptomScale={SYMPTOM_SCALE}
          isBipolar={isBipolar}
          primaryDomainLabel={primaryDomainLabel}
          symptomPoints={symptomPoints}
          isContinuous={isContinuous}
          episodeCurves={episodeCurves}
          annotations={uniqueAnnotations}
          residualTopY={RESIDUAL_TOP_Y}
          residualCategories={residualCategories}
          residuals={uniqueResiduals}
          substanceTopY={SUBSTANCE_TOP_Y}
          substances={uniqueSubstances}
          careTopY={CARE_TOP_Y}
          careEpisodeBlocks={careEpisodeBlocks}
          eventTopY={EVENT_TOP_Y}
        />

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
