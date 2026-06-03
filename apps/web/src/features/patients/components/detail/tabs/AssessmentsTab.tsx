import { useEffect, useState } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions,
  DialogContent, DialogTitle, Divider, FormControl, Grid, InputLabel, MenuItem,
  Paper, Select, Slider, Snackbar, TextField, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import AssessmentIcon from '@mui/icons-material/Assessment';
import ScaleIcon from '@mui/icons-material/Scale';
import HistoryIcon from '@mui/icons-material/History';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../../../shared/services/apiClient';
import { episodesKeys, outcomeMeasuresKeys, patientsKeys, patientTemplatesKeys } from '../../../queryKeys';
import { ContactFormDialog } from '../../notes/ContactFormDialog';
import {
  TemplateFormRenderer, formValuesToText, extractScoreData,
  type FormValues, type TemplateField,
} from '../../../../../shared/components/TemplateFormRenderer';
import {
  MEASURE_TYPES, OCCASIONS, ITEM_LABELS, MAX_TOTAL, getK10Severity,
  buildDefaultOutcomeItems,
  type OutcomeMeasure,
} from './assessmentsConfig';
import {
  parseContactMeta, parseTemplateFields, parseTemplateDescriptor,
  type CompletedAssessment, type ContactMeta, type RatingScaleTemplate, type TemplatesResponse,
} from './assessmentsTemplateUtils';
function ScoreTrendChart({ data, maxScore }: { data: { date: string; score: number }[]; maxScore: number }) {
  if (data.length < 2) return null;
  const W = 400, H = 140, PAD = 30;
  const plotW = W - PAD * 2, plotH = H - PAD * 2;
  const points = data.map((d, i) => ({
    x: PAD + (i / (data.length - 1)) * plotW,
    y: PAD + plotH - (d.score / (maxScore || 1)) * plotH,
    ...d,
  }));
  const polyline = points.map(p => `${p.x},${p.y}`).join(' ');
  return (
    <Box sx={{ mb: 1 }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxWidth: 480, height: 'auto' }} role="img" aria-label="Score trend">
        {[0, 0.25, 0.5, 0.75, 1].map(pct => {
          const y = PAD + plotH - pct * plotH;
          return <g key={pct}>
            <line x1={PAD} y1={y} x2={W - PAD} y2={y} stroke="#E0E0E0" strokeDasharray="3,3" />
            <text x={PAD - 4} y={y + 3} textAnchor="end" fontSize="8" fill="#999">{Math.round(pct * maxScore)}</text>
          </g>;
        })}
        <polyline points={polyline} fill="none" stroke="#327C8D" strokeWidth="2" />
        {points.map((p, i) => (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r="4" fill="#327C8D" stroke="#fff" strokeWidth="1.5" />
            <text x={p.x} y={p.y - 8} textAnchor="middle" fontSize="9" fontWeight="700" fill="#3D484B">{p.score}</text>
            <text x={p.x} y={H - 4} textAnchor="middle" fontSize="7" fill="#999">
              {new Date(p.date).toLocaleDateString('en-AU', { day: '2-digit', month: 'short' })}
            </text>
          </g>
        ))}
      </svg>
    </Box>
  );
}
interface SaveOutcomePayload {
  patientId: string;
  episodeId?: string;
  measureType: string;
  collectionOccasion: string;
  items: Record<string, number>;
  notes: string;
}
interface SaveOutcomeResponse {
  id?: string;
}
interface SaveRatingScalePayload {
  episodeId?: string;
  title: string;
  noteType: 'assessment';
  content: string;
  templateId?: string;
  status: 'signed';
  isReportableContact: boolean;
  contactMeta: {
    contactDate: string;
    ratingScale: {
      templateName: string;
      respondentType?: 'self' | 'clinician';
      totalScore: number;
      severity?: string;
      itemCount: number;
      itemScores: Record<string, number>;
      scoreBreakdowns?: Array<{
        label: string;
        score: number;
        formula?: 'sum' | 'mean';
        severity?: string;
        itemCount?: number;
        itemIndexes?: number[];
      }>;
    };
  };
}
interface SaveRatingScaleResponse {
  note?: {
    id?: string;
  };
}
interface EpisodeOption {
  id: string;
  title: string;
  episodeType?: string | null;
  status?: string | null;
}
interface AssessmentsTabProps { patientId: string }
export function AssessmentsTab({ patientId }: AssessmentsTabProps) {
  const qc = useQueryClient();
  const [outcomeDialogOpen, setOutcomeDialogOpen] = useState(false);
  const [ratingDialogOpen, setRatingDialogOpen] = useState(false);
  const [expandedAssessId, setExpandedAssessId] = useState<string | null>(null);
  const [measureType, setMeasureType] = useState('honos');
  const [occasion, setOccasion] = useState('review');
  const [items, setItems] = useState<Record<string, number>>(
    buildDefaultOutcomeItems(MEASURE_TYPES.find((t) => t.id === 'honos')?.items ?? 12),
  );
  const [notes, setNotes] = useState('');
  const [selectedRatingTemplate, setSelectedRatingTemplate] = useState('');
  const [ratingFields, setRatingFields] = useState<TemplateField[]>([]);
  const [ratingFormValues, setRatingFormValues] = useState<FormValues>({});
  const [ratingTitle, setRatingTitle] = useState('');
  const [ratingTypeFilter, setRatingTypeFilter] = useState<'all' | 'self' | 'clinician'>('all');
  const [contactFormOpen, setContactFormOpen] = useState(false);
  const [savedContext, setSavedContext] = useState<{ noteId: string; title: string } | null>(null);
  const [selectedEpisodeId, setSelectedEpisodeId] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);
  const { data: episodes = [] } = useQuery({
    queryKey: episodesKeys.active(patientId),
    queryFn: () =>
      apiClient
        .get<{ data: EpisodeOption[] }>(`episodes/patient/${patientId}`)
        .then((r) => (r.data ?? []).filter((e) => e.status === 'open')),
    enabled: !!patientId,
  });
  useEffect(() => {
    if (!selectedEpisodeId && episodes.length > 0) {
      setSelectedEpisodeId(episodes[0].id);
    }
  }, [selectedEpisodeId, episodes]);
  const { data: measures, isLoading: measuresLoading } = useQuery({
    queryKey: outcomeMeasuresKeys.byPatient(patientId),
    queryFn: () => apiClient.get<OutcomeMeasure[]>(`outcomes/patient/${patientId}`),
    enabled: !!patientId,
  });
  const { data: completedNotes, isLoading: notesLoading } = useQuery({
    queryKey: patientsKeys.notesAssessments(patientId),
    queryFn: () => apiClient.get<{ notes: CompletedAssessment[] }>(`patients/${patientId}/notes`).then(r =>
      (r.notes ?? [])
        .filter(n => {
          if (n.status !== 'signed') return false;
          if (!(n.noteType === 'review' || n.noteType === 'assessment' || n.noteType === 'intake')) return false;
          const meta = parseContactMeta(n.contactMeta);
          if (meta?.planType) return false;
          return true;
        })
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    ),
    enabled: !!patientId,
  });
  const { data: ratingTemplates } = useQuery({
    queryKey: patientTemplatesKeys.ratingScales(),
    queryFn: async () => {
      const resp = await apiClient.get<RatingScaleTemplate[] | TemplatesResponse>('templates');
      const all = Array.isArray(resp) ? resp : (resp.templates ?? resp.data ?? []);
      return all
        .filter((t) => t.category === 'Rating Scales')
        .map((template) => ({ ...template, descriptor: parseTemplateDescriptor(template.description) }))
        .sort((a, b) => a.name.localeCompare(b.name));
    },
  });
  const visibleRatingTemplates = (ratingTemplates ?? []).filter((template) => {
    if (ratingTypeFilter === 'all') return true;
    return template.descriptor.respondentType === ratingTypeFilter;
  });
  const saveOutcomeMut = useMutation({
    mutationFn: (data: SaveOutcomePayload) => apiClient.post<SaveOutcomeResponse>('outcomes', data),
    onSuccess: (resp) => {
      qc.invalidateQueries({ queryKey: outcomeMeasuresKeys.byPatient(patientId) });
      if (selectedEpisodeId) {
        qc.invalidateQueries({ queryKey: outcomeMeasuresKeys.byPatientEpisode(patientId, selectedEpisodeId) });
      }
      setOutcomeDialogOpen(false);
      setItems({});
      setNotes('');
      const typeDef = MEASURE_TYPES.find(t => t.id === measureType);
      setSavedContext({ noteId: resp.id ?? '', title: typeDef?.label ?? measureType });
      setContactFormOpen(true);
      setFeedback('Outcome measure saved');
    },
  });
  const saveRatingMut = useMutation({
    mutationFn: (data: SaveRatingScalePayload) => apiClient.post<SaveRatingScaleResponse>(`patients/${patientId}/notes`, data),
    onSuccess: (resp) => {
      qc.invalidateQueries({ queryKey: patientsKeys.notesAssessments(patientId) });
      qc.invalidateQueries({ queryKey: patientsKeys.notes(patientId) });
      if (selectedEpisodeId) {
        qc.invalidateQueries({ queryKey: episodesKeys.notes(patientId, selectedEpisodeId) });
      }
      setRatingDialogOpen(false);
      setRatingFields([]);
      setRatingFormValues({});
      setRatingTitle('');
      setSelectedRatingTemplate('');
      setSavedContext({ noteId: resp.note?.id ?? '', title: ratingTitle });
      setContactFormOpen(true);
      setFeedback('Assessment note saved');
    },
  });
  const handleRatingTemplateSelect = (templateId: string) => {
    setSelectedRatingTemplate(templateId);
    const tmpl = (ratingTemplates ?? []).find(t => t.id === templateId);
    if (tmpl) {
      setRatingTitle(tmpl.name);
      const fields = parseTemplateFields(tmpl.content);
      setRatingFields(fields);
      const defaults: FormValues = {};
      fields.forEach((f, i: number) => {
        if (f.type === 'likert') defaults[String(i)] = f.min ?? 0;
      });
      setRatingFormValues(defaults);
    }
  };
  const typeDef = MEASURE_TYPES.find(t => t.id === measureType);
  const total = Object.values(items).reduce((a, b) => a + b, 0);
  const hasHistory = (measures?.length ?? 0) > 0 || (completedNotes?.length ?? 0) > 0;

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <AssessmentIcon sx={{ color: '#327C8D' }} />
          <Typography variant="h6" fontWeight={700} fontFamily="Albert Sans, sans-serif">
            Outcome Measures & Rating Scales
          </Typography>
        </Box>
        <FormControl size="small" sx={{ minWidth: 320 }}>
          <InputLabel>Episode</InputLabel>
          <Select
            value={selectedEpisodeId}
            onChange={(event) => setSelectedEpisodeId(event.target.value)}
            label="Episode"
          >
            {episodes.length === 0 && <MenuItem disabled value="">No open episodes</MenuItem>}
            {episodes.map((ep) => (
              <MenuItem key={ep.id} value={ep.id}>
                {ep.title}{ep.episodeType ? ` (${ep.episodeType})` : ''}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button size="small" variant="contained" startIcon={<AddIcon />}
            onClick={() => setOutcomeDialogOpen(true)}
            disabled={!selectedEpisodeId}
            sx={{ bgcolor: '#327C8D', '&:hover': { bgcolor: '#265f6d' }, textTransform: 'none', fontSize: 12 }}>
            Add Outcome Measure
          </Button>
          <Button size="small" variant="outlined" startIcon={<ScaleIcon />}
            onClick={() => setRatingDialogOpen(true)}
            disabled={!selectedEpisodeId}
            sx={{ borderColor: '#b8621a', color: '#b8621a', '&:hover': { bgcolor: '#FFF3E0', borderColor: '#d6741f' }, textTransform: 'none', fontSize: 12 }}>
            Add Rating Scale
          </Button>
        </Box>
      </Box>
      {episodes.length === 0 && (
        <Alert severity="warning" sx={{ mb: 2, fontSize: 13 }}>
          Open an episode before saving assessments so they appear in the episode timeline.
        </Alert>
      )}

      {(measuresLoading || notesLoading) && <CircularProgress role="progressbar" aria-label="Loading" size={24} sx={{ mb: 2 }} />}

      {!measuresLoading && !notesLoading && !hasHistory && (
        <Alert severity="info" sx={{ mb: 2, fontSize: 13 }}>
          No assessments recorded yet. Use the buttons above to add HoNOS, K10, LSP-16 or a rating scale.
        </Alert>
      )}

      {(() => {
        const byType: Record<string, OutcomeMeasure[]> = {};
        for (const m of (measures ?? [])) (byType[m.measureType] ??= []).push(m);
        const trends = Object.entries(byType).filter(([, arr]) => arr.length >= 2);
        if (!trends.length) return null;
        return (
          <Box sx={{ mb: 2.5 }}>
            <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1, color: '#3D484B' }}>
              Outcome Measure Trends
            </Typography>
            <Grid container spacing={2}>
              {trends.map(([type, arr]) => {
                const sorted = [...arr].sort((a, b) => new Date(a.measureDate ?? a.createdAt).getTime() - new Date(b.measureDate ?? b.createdAt).getTime());
                const label = MEASURE_TYPES.find(t => t.id === type)?.label ?? type;
                const typeDefLocal = MEASURE_TYPES.find(t => t.id === type);
                const maxScore = MAX_TOTAL[type] ?? ((typeDefLocal?.items ?? 12) * (typeDefLocal?.maxPerItem ?? 4));
                const latest = sorted[sorted.length - 1];
                const first = sorted[0];
                const delta = latest.totalScore - first.totalScore;
                return (
                  <Grid key={type} size={{ xs: 12, md: 6 }}>
                    <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
                      <Typography variant="caption" fontWeight={700} sx={{ mb: 0.5, display: 'block' }}>{label}</Typography>
                      <ScoreTrendChart
                        data={sorted.map(m => ({ date: m.measureDate ?? m.createdAt, score: m.totalScore }))}
                        maxScore={maxScore}
                      />
                      <Typography variant="caption" color="text.secondary">
                        Latest: {latest.totalScore}/{maxScore} — {delta > 0 ? `+${delta}` : delta} since first ({sorted.length} assessments)
                      </Typography>
                    </Paper>
                  </Grid>
                );
              })}
            </Grid>
          </Box>
        );
      })()}

      {(() => {
        const byScale: Record<string, { date: string; score: number }[]> = {};
        for (const n of (completedNotes ?? [])) {
          const cmRaw = n.contactMeta ?? null;
          const cm: ContactMeta | null = typeof cmRaw === 'string'
            ? (() => { try { return JSON.parse(cmRaw) as ContactMeta; } catch { return null; } })()
            : cmRaw;
          const rs = cm?.ratingScale;
          const totalScore = typeof rs?.totalScore === 'number' ? rs.totalScore : null;
          if (totalScore == null) continue;
          const name = (rs?.templateName ?? n.title ?? 'Rating Scale').toString();
          (byScale[name] ??= []).push({ date: n.createdAt, score: totalScore });
        }
        const trends = Object.entries(byScale).filter(([, arr]) => arr.length >= 2);
        if (!trends.length) return null;
        return (
          <Box sx={{ mb: 2.5 }}>
            <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1, color: '#3D484B' }}>
              Rating Scale Trends
            </Typography>
            <Grid container spacing={2}>
              {trends.map(([name, arr]) => {
                const sorted = [...arr].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
                const observedMax = Math.max(...sorted.map(p => p.score), 1);
                return (
                  <Grid key={name} size={{ xs: 12, md: 6 }}>
                    <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, borderColor: '#b8621a' }}>
                      <Typography variant="caption" fontWeight={700} sx={{ mb: 0.5, display: 'block' }}>{name}</Typography>
                      <ScoreTrendChart data={sorted} maxScore={observedMax} />
                      <Typography variant="caption" color="text.secondary">
                        {sorted.length} entries — latest {sorted[sorted.length - 1].score}
                      </Typography>
                    </Paper>
                  </Grid>
                );
              })}
            </Grid>
          </Box>
        );
      })()}

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
        <HistoryIcon sx={{ color: '#999', fontSize: 20 }} />
        <Typography variant="subtitle1" fontWeight={600} fontFamily="Albert Sans, sans-serif" color="text.secondary">
          Completed Assessments ({(measures?.length ?? 0) + (completedNotes?.length ?? 0)})
        </Typography>
      </Box>

      {(measures ?? []).map(m => {
        const severity = (m.measureType === 'k10' || m.measureType === 'k10plus') ? getK10Severity(m.totalScore) : null;
        const mLabel = MEASURE_TYPES.find(t => t.id === m.measureType)?.label ?? m.measureType;
        const isExp = expandedAssessId === m.id;
        const mLabels = ITEM_LABELS[m.measureType] ?? [];
        const mTypeDef = MEASURE_TYPES.find(t => t.id === m.measureType);
        return (
          <Paper key={m.id} variant="outlined"
            role="button"
            tabIndex={0}
            aria-expanded={isExp}
            aria-label={`${mLabel} assessment — ${isExp ? 'collapse' : 'expand'}`}
            onClick={() => setExpandedAssessId(isExp ? null : m.id)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpandedAssessId(isExp ? null : m.id); } }}
            sx={{ p: 1.5, mb: 0.75, borderLeft: '3px solid #327C8D', cursor: 'pointer', '&:hover': { bgcolor: '#FAFAFA' }, '&:focus-visible': { outline: '2px solid #327C8D', outlineOffset: 2 } }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Box>
                <Typography variant="body2" fontWeight={600}>{mLabel}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {(m.measureDate ?? m.createdAt) ? new Date(m.measureDate ?? m.createdAt).toLocaleDateString('en-AU') : '—'}
                  {' · '}{m.collectionOccasion}
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography variant="h6" fontWeight={800} sx={{ color: severity?.color ?? '#327C8D' }}>{m.totalScore}</Typography>
                {severity && <Chip label={severity.label} size="small" sx={{ bgcolor: severity.color, color: '#fff', fontSize: 10 }} />}
              </Box>
            </Box>
            {isExp && m.items && Object.keys(m.items).length > 0 && (
              <Box sx={{ mt: 1.5, pt: 1, borderTop: '1px solid #E0E0E0' }}>
                {Object.entries(m.items).sort(([a], [b]) => Number(a) - Number(b)).map(([itemNum, score]) => {
                  const idx = Number(itemNum) - 1;
                  const label = mLabels[idx] ?? `Item ${itemNum}`;
                  const maxScore = mTypeDef?.maxPerItem ?? 4;
                  return (
                    <Box key={itemNum} sx={{ display: 'flex', justifyContent: 'space-between', py: 0.3, borderBottom: '1px solid #f0f0f0' }}>
                      <Typography variant="caption" sx={{ flex: 1 }}>{label}</Typography>
                      <Typography variant="caption" fontWeight={700} sx={{ minWidth: 40, textAlign: 'right' }}>{score}/{maxScore}</Typography>
                    </Box>
                  );
                })}
                {m.notes && <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>Notes: {m.notes}</Typography>}
              </Box>
            )}
          </Paper>
        );
      })}

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
        {(completedNotes ?? []).map(n => {
          const isExp = expandedAssessId === n.id;
          const cm = parseContactMeta(n.contactMeta);
          const rs = cm?.ratingScale;
          const itemScores: Record<string, number> = rs?.itemScores ?? cm?.itemScores ?? {};
          const scoreBreakdowns = rs?.scoreBreakdowns ?? [];
          const hasItems = Object.keys(itemScores).length > 0;
          return (
          <Paper key={n.id} variant="outlined"
            {...((hasItems || n.content) ? {
              role: 'button' as const,
              tabIndex: 0,
              'aria-expanded': isExp,
              'aria-label': `${n.title} assessment note — ${isExp ? 'collapse' : 'expand'}`,
              onClick: () => setExpandedAssessId(isExp ? null : n.id),
              onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpandedAssessId(isExp ? null : n.id); } },
            } : {})}
            sx={{ p: 1.5, borderLeft: '3px solid #b8621a', cursor: hasItems || n.content ? 'pointer' : 'default', '&:hover': hasItems || n.content ? { bgcolor: '#FAFAFA' } : {}, '&:focus-visible': hasItems || n.content ? { outline: '2px solid #b8621a', outlineOffset: 2 } : {} }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.25 }}>
                  <Typography variant="body2" fontWeight={600} sx={{ fontSize: 13 }}>{n.title}</Typography>
                  <Chip label={n.noteType} size="small" sx={{ fontSize: 9, height: 18, textTransform: 'capitalize' }} />
                  {rs?.totalScore != null && <Chip label={`Score: ${rs.totalScore}`} size="small" variant="outlined" sx={{ fontSize: 9, height: 18 }} />}
                  {rs?.respondentType && (
                    <Chip
                      label={rs.respondentType === 'self' ? 'Self-rated' : 'Clinician-rated'}
                      size="small"
                      sx={{ fontSize: 9, height: 18 }}
                    />
                  )}
                </Box>
                <Typography variant="caption" color="text.secondary" sx={{ fontSize: 11 }}>
                  {new Date(n.createdAt).toLocaleDateString('en-AU')}
                  {n.authorName && ` — ${n.authorName}`}
                  {n.episodeTitle && ` (${n.episodeTitle})`}
                </Typography>
              </Box>
              <Chip label="Signed" size="small" color="success" sx={{ fontSize: 9, height: 20 }} />
            </Box>
            {isExp && (
              <Box sx={{ mt: 1.5, pt: 1, borderTop: '1px solid #E0E0E0' }}>
                {hasItems && (
                  <Box sx={{ mb: 1 }}>
                    <Typography variant="caption" fontWeight={600} sx={{ display: 'block', mb: 0.5 }}>Item Scores</Typography>
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                      {Object.entries(itemScores).sort(([a], [b]) => parseInt(a, 10) - parseInt(b, 10)).map(([k, v]) => (
                        <Chip key={k} label={`${k}: ${v}`} size="small" variant="outlined" sx={{ fontSize: 9, height: 20 }} />
                      ))}
                    </Box>
                    {rs?.severity && <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>Severity: {rs.severity}</Typography>}
                  </Box>
                )}
                {scoreBreakdowns.length > 0 && (
                  <Box sx={{ mb: 1 }}>
                    <Typography variant="caption" fontWeight={600} sx={{ display: 'block', mb: 0.5 }}>
                      Score Breakdown
                    </Typography>
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                      {scoreBreakdowns.map((breakdown) => (
                        <Chip
                          key={breakdown.label}
                          size="small"
                          variant="outlined"
                          label={`${breakdown.label}: ${breakdown.formula === 'mean' ? breakdown.score.toFixed(2) : breakdown.score}${breakdown.severity ? ` (${breakdown.severity})` : ''}`}
                          sx={{ fontSize: 9, height: 20 }}
                        />
                      ))}
                    </Box>
                  </Box>
                )}
                {n.content && <Typography variant="body2" sx={{ fontSize: 11, whiteSpace: 'pre-wrap', color: 'text.secondary' }}>{n.content}</Typography>}
              </Box>
            )}
          </Paper>
          );
        })}
      </Box>

      <Dialog aria-labelledby="dialog-title" open={outcomeDialogOpen} onClose={() => setOutcomeDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle id="dialog-title" sx={{ fontWeight: 700, fontFamily: 'Albert Sans, sans-serif' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <AssessmentIcon sx={{ color: '#327C8D' }} />
            Add Outcome Measure
          </Box>
        </DialogTitle>
        <Divider />
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 0.5 }}>
            <Grid size={{ xs: 5 }}>
              <FormControl fullWidth size="small">
                <InputLabel>Measure Type</InputLabel>
                <Select value={measureType} onChange={e => {
                  const nextType = e.target.value;
                  setMeasureType(nextType);
                  const nextItems = MEASURE_TYPES.find((t) => t.id === nextType)?.items ?? 0;
                  setItems(buildDefaultOutcomeItems(nextItems));
                }} label="Measure Type">
                  {MEASURE_TYPES.map(t => <MenuItem key={t.id} value={t.id}>{t.label}</MenuItem>)}
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 4 }}>
              <FormControl fullWidth size="small">
                <InputLabel>Collection Occasion</InputLabel>
                <Select value={occasion} onChange={e => setOccasion(e.target.value)} label="Collection Occasion">
                  {OCCASIONS.map(o => <MenuItem key={o} value={o} sx={{ textTransform: 'capitalize' }}>{o}</MenuItem>)}
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 3 }}>
              <Typography variant="h5" fontWeight={800} color="#327C8D" textAlign="center" sx={{ mt: 0.5 }}>
                Total: {total}
              </Typography>
            </Grid>
          </Grid>

          <Paper variant="outlined" sx={{ mt: 2, p: 2, maxHeight: 380, overflowY: 'auto' }}>
            {Array.from({ length: typeDef?.items ?? 0 }, (_, i) => {
              const label = (ITEM_LABELS[measureType] ?? [])[i] ?? `Item ${i + 1}`;
              return (
                <Box key={i} sx={{ mb: 2 }}>
                  <Typography variant="body2" fontWeight={500} sx={{ mb: 0.5, fontSize: 13 }}>
                    {i + 1}. {label}
                  </Typography>
                  <Slider
                    value={items[String(i + 1)] ?? 0}
                    onChange={(_, v) => setItems(prev => ({ ...prev, [String(i + 1)]: v as number }))}
                    min={0} max={typeDef?.maxPerItem ?? 4} step={1}
                    marks={Array.from({ length: (typeDef?.maxPerItem ?? 4) + 1 }, (_, j) => ({ value: j, label: String(j) }))}
                    sx={{ color: '#327C8D' }}
                  />
                </Box>
              );
            })}
          </Paper>

          <TextField label="Notes" fullWidth multiline rows={2} size="small" value={notes} onChange={e => setNotes(e.target.value)} sx={{ mt: 2 }} />
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setOutcomeDialogOpen(false)} sx={{ color: 'text.secondary' }}>Cancel</Button>
          <Button variant="contained"
            onClick={() => saveOutcomeMut.mutate({
              patientId,
              episodeId: selectedEpisodeId || undefined,
              measureType,
              collectionOccasion: occasion,
              items,
              notes,
            })}
            disabled={!selectedEpisodeId || saveOutcomeMut.isPending}
            sx={{ bgcolor: '#327C8D', '&:hover': { bgcolor: '#265f6d' } }}>
            {saveOutcomeMut.isPending ? 'Saving...' : 'Save & Complete Contact'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog aria-labelledby="dialog-title" open={ratingDialogOpen} onClose={() => setRatingDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle id="dialog-title" sx={{ fontWeight: 700, fontFamily: 'Albert Sans, sans-serif' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <ScaleIcon sx={{ color: '#b8621a' }} />
            Add Rating Scale
          </Box>
        </DialogTitle>
        <Divider />
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 0.5 }}>
            <Grid size={{ xs: 12, sm: 4 }}>
              <FormControl fullWidth size="small">
                <InputLabel>Rating Type</InputLabel>
                <Select
                  value={ratingTypeFilter}
                  onChange={(event) => setRatingTypeFilter(event.target.value as 'all' | 'self' | 'clinician')}
                  label="Rating Type"
                >
                  <MenuItem value="all">All Scales</MenuItem>
                  <MenuItem value="self">Self-rated</MenuItem>
                  <MenuItem value="clinician">Clinician-rated</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 12, sm: 8 }}>
              <FormControl fullWidth size="small">
                <InputLabel>Select Rating Scale</InputLabel>
                <Select value={selectedRatingTemplate} onChange={e => handleRatingTemplateSelect(e.target.value)} label="Select Rating Scale">
                  {visibleRatingTemplates.length === 0 && <MenuItem disabled>No rating scale templates available</MenuItem>}
                  {visibleRatingTemplates.map((template) => {
                    const typeLabel =
                      template.descriptor.respondentType === 'self'
                        ? 'Self-rated'
                        : template.descriptor.respondentType === 'clinician'
                          ? 'Clinician-rated'
                          : 'Unclassified';
                    return (
                      <MenuItem key={template.id} value={template.id}>
                        {`${template.name} — ${typeLabel}`}
                      </MenuItem>
                    );
                  })}
                </Select>
              </FormControl>
            </Grid>

            {selectedRatingTemplate && (
              <Grid size={{ xs: 12 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                  <Typography variant="subtitle2" fontWeight={600}>{ratingTitle}</Typography>
                  <Button size="small" onClick={() => { setSelectedRatingTemplate(''); setRatingFields([]); setRatingFormValues({}); setRatingTitle(''); }}
                    sx={{ color: 'text.secondary', fontSize: 11 }}>Change Scale</Button>
                </Box>
                {(() => {
                  const selectedTemplate = (ratingTemplates ?? []).find((template) => template.id === selectedRatingTemplate);
                  if (!selectedTemplate) return null;
                  const typeLabel =
                    selectedTemplate.descriptor.respondentType === 'self'
                      ? 'Self-rated'
                      : selectedTemplate.descriptor.respondentType === 'clinician'
                        ? 'Clinician-rated'
                        : 'Unclassified';
                  return (
                    <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', mb: 1 }}>
                      <Chip size="small" label={typeLabel} sx={{ fontSize: 10, height: 20 }} />
                      <Chip size="small" label={`Age: ${selectedTemplate.descriptor.ageGroup}`} variant="outlined" sx={{ fontSize: 10, height: 20 }} />
                      <Chip size="small" label={`Focus: ${selectedTemplate.descriptor.focus}`} variant="outlined" sx={{ fontSize: 10, height: 20 }} />
                    </Box>
                  );
                })()}
                {ratingFields.length === 0 && (
                  <Alert severity="warning" sx={{ fontSize: 12 }}>This template has no scoring items. It may need to be configured in Settings &gt; Templates.</Alert>
                )}
              </Grid>
            )}
            {selectedRatingTemplate && ratingFields.length > 0 && (
              <Grid size={{ xs: 12 }}>
                <Paper variant="outlined" sx={{ p: 2, maxHeight: 500, overflowY: 'auto' }}>
                  <TemplateFormRenderer
                    fields={ratingFields}
                    values={ratingFormValues}
                    onChange={setRatingFormValues}
                  />
                </Paper>
              </Grid>
            )}
          </Grid>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setRatingDialogOpen(false)} sx={{ color: 'text.secondary' }}>Cancel</Button>
          <Button variant="contained"
            onClick={() => {
              const textContent = formValuesToText(ratingFields, ratingFormValues);
              const scoreData = extractScoreData(ratingFields, ratingFormValues);
              const selectedTemplate = (ratingTemplates ?? []).find((template) => template.id === selectedRatingTemplate);
              const respondentType =
                selectedTemplate?.descriptor.respondentType === 'self'
                  ? 'self'
                  : selectedTemplate?.descriptor.respondentType === 'clinician'
                    ? 'clinician'
                    : undefined;
              saveRatingMut.mutate({
                episodeId: selectedEpisodeId || undefined,
                title: ratingTitle.trim(),
                noteType: 'assessment',
                content: textContent,
                templateId: selectedRatingTemplate || undefined,
                status: 'signed',
                isReportableContact: true,
                contactMeta: {
                  contactDate: new Date().toISOString().split('T')[0],
                  ratingScale: {
                    templateName: ratingTitle,
                    respondentType,
                    totalScore: scoreData.totalScore,
                    severity: scoreData.severity,
                    itemCount: scoreData.itemCount,
                    itemScores: scoreData.itemScores,
                    scoreBreakdowns: scoreData.scoreBreakdowns,
                  },
                },
              });
            }}
            disabled={!selectedEpisodeId || !selectedRatingTemplate || !ratingTitle.trim() || saveRatingMut.isPending}
            sx={{ bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' } }}>
            {saveRatingMut.isPending ? 'Saving...' : 'Save & Complete Contact'}
          </Button>
        </DialogActions>
      </Dialog>

      <ContactFormDialog
        open={contactFormOpen}
        onClose={() => { setContactFormOpen(false); setSavedContext(null); }}
        onSaved={() => {
          setContactFormOpen(false);
          setSavedContext(null);
          setFeedback('Contact saved');
        }}
        patientId={patientId}
        initialNoteType="assessment"
        initialNoteTitle={savedContext?.title ?? ''}
        initialEpisodeId={selectedEpisodeId || undefined}
        initialIsReportable={true}
      />
      <Snackbar
        open={Boolean(feedback)}
        autoHideDuration={2500}
        onClose={() => setFeedback(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="success" onClose={() => setFeedback(null)} sx={{ width: '100%' }}>
          {feedback}
        </Alert>
      </Snackbar>
    </Box>
  );
}

export default AssessmentsTab;
