/**
 * Phase 8 — dedicated outcome-measures tab.
 *
 * Operator brief:
 *   - Outcome measures must have their own page/tab/surface.
 *   - Outcome measures must NOT appear inside rating scales.
 *
 * This file owns the entire outcome-measure flow that previously lived
 * inside AssessmentsTab.tsx:
 *   - HoNOS / K10+ / LSP-16 entry dialog (measure list and
 *     display names come from the shared assessment taxonomy SSoT;
 *     item counts / slider mechanics remain local UI form metadata)
 *   - Save via the existing `/outcomes` API (preserved)
 *   - Trends chart + completed-measure history list
 *
 * It deliberately does NOT render any rating-scale UI — the Rating
 * Scales tab is the sole surface for that. Cross-tab navigation is via
 * the patient detail tab header.
 */
import { useEffect, useState } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions,
  DialogContent, DialogTitle, Divider, FormControl, Grid, InputLabel, MenuItem,
  Paper, Select, Slider, Snackbar, TextField, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import AssessmentIcon from '@mui/icons-material/Assessment';
import HistoryIcon from '@mui/icons-material/History';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  listOutcomeMeasures,
  type MeasurementDashboardSummary,
} from '@signacare/shared';
import { apiClient } from '../../../../../shared/services/apiClient';
import { episodesKeys, outcomeMeasuresKeys } from '../../../queryKeys';
import { ContactFormDialog } from '../../notes/ContactFormDialog';
import {
  OUTCOME_MEASURE_FORM_CONFIG, OCCASIONS, ITEM_LABELS, getK10Severity,
  buildDefaultOutcomeItems,
  type OutcomeMeasure,
} from './assessmentsConfig';
import { MultiInstrumentMeasurementPanel } from './measurements';

const OUTCOME_MEASURE_OPTIONS = listOutcomeMeasures().flatMap((entry) => {
  const config = OUTCOME_MEASURE_FORM_CONFIG[entry.slug];
  if (!config) return [];
  return [{
    ...config,
    id: entry.slug,
    label: entry.displayName,
  }];
});

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
interface EpisodeOption {
  id: string;
  title: string;
  episodeType?: string | null;
  status?: string | null;
}

interface OutcomeMeasuresTabProps { patientId: string }

export function OutcomeMeasuresTab({ patientId }: OutcomeMeasuresTabProps) {
  const qc = useQueryClient();
  const [outcomeDialogOpen, setOutcomeDialogOpen] = useState(false);
  const [expandedAssessId, setExpandedAssessId] = useState<string | null>(null);
  const [measureType, setMeasureType] = useState('honos');
  const [occasion, setOccasion] = useState('review');
  const initialOutcomeType = OUTCOME_MEASURE_OPTIONS.find((t) => t.id === 'honos');
  const [items, setItems] = useState<Record<string, number>>(
    buildDefaultOutcomeItems(initialOutcomeType?.items ?? 12, initialOutcomeType?.minPerItem ?? 0),
  );
  const [notes, setNotes] = useState('');
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

  // Phase 8 visualisation: per-family measurement summary. This tab
  // restricts the panel to `family=outcome_measure` only — clinician-rated
  // rating scales (Rating Scales tab) and patient self-rated submissions
  // (Viva tab) are excluded by the server filter.
  const { data: summary } = useQuery({
    queryKey: outcomeMeasuresKeys.summary(patientId, 'outcome_measure'),
    queryFn: () => apiClient.get<MeasurementDashboardSummary>(
      `assessments/patient/${patientId}/measurement-summary`,
      { family: 'outcome_measure' },
    ),
    enabled: !!patientId,
  });

  const saveOutcomeMut = useMutation({
    mutationFn: (data: SaveOutcomePayload) => apiClient.post<SaveOutcomeResponse>('outcomes', data),
    onSuccess: (resp) => {
      qc.invalidateQueries({ queryKey: outcomeMeasuresKeys.byPatient(patientId) });
      qc.invalidateQueries({ queryKey: outcomeMeasuresKeys.summary(patientId, 'outcome_measure') });
      if (selectedEpisodeId) {
        qc.invalidateQueries({ queryKey: outcomeMeasuresKeys.byPatientEpisode(patientId, selectedEpisodeId) });
      }
      setOutcomeDialogOpen(false);
      setItems({});
      setNotes('');
      const typeDef = OUTCOME_MEASURE_OPTIONS.find((t) => t.id === measureType);
      setSavedContext({ noteId: resp.id ?? '', title: typeDef?.label ?? measureType });
      setContactFormOpen(true);
      setFeedback('Outcome measure saved');
    },
  });

  const typeDef = OUTCOME_MEASURE_OPTIONS.find((t) => t.id === measureType);
  const total = Object.values(items).reduce((a, b) => a + b, 0);
  const hasHistory = (measures?.length ?? 0) > 0;

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <AssessmentIcon sx={{ color: '#327C8D' }} />
          <Typography variant="h6" fontWeight={700} fontFamily="Albert Sans, sans-serif">
            Outcome Measures
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
        <Button size="small" variant="contained" startIcon={<AddIcon />}
          onClick={() => setOutcomeDialogOpen(true)}
          disabled={!selectedEpisodeId}
          sx={{ bgcolor: '#327C8D', '&:hover': { bgcolor: '#265f6d' }, textTransform: 'none', fontSize: 12 }}>
          Add Outcome Measure
        </Button>
      </Box>

      {episodes.length === 0 && (
        <Alert severity="warning" sx={{ mb: 2, fontSize: 13 }}>
          Open an episode before saving outcome measures so they appear in the episode timeline.
        </Alert>
      )}

      {measuresLoading && <CircularProgress role="progressbar" aria-label="Loading" size={24} sx={{ mb: 2 }} />}

      {!measuresLoading && !hasHistory && (
        <Alert severity="info" sx={{ mb: 2, fontSize: 13 }}>
          No outcome measures recorded yet. Use the button above to add HoNOS, K10/K10+, or LSP-16.
          {' '}Clinician-rated rating scales live on the Rating Scales tab; patient-completed self-rated
          scales live on the Viva tab.
        </Alert>
      )}

      {/*
       * Phase 8 visualisation — latest cross-sectional scores + small-multiples
       * trend charts + (restricted) cross-instrument timeline for outcome
       * measures only. The panel is server-filtered to
       * `family=outcome_measure`, so it CANNOT display rating-scale or
       * Viva self-rated rows.
       */}
      {summary && (summary.series.length > 0 || summary.crossInstrumentTimeline.length > 0) && (
        <Box sx={{ mb: 2.5 }}>
          <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1, color: '#3D484B' }}>
            Outcome Measure Trends
          </Typography>
          <MultiInstrumentMeasurementPanel
            series={summary.series}
            timeline={summary.crossInstrumentTimeline}
            warnings={summary.warnings}
            restrictToFamily="outcome_measure"
            hideLegend
          />
        </Box>
      )}

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
        <HistoryIcon sx={{ color: '#999', fontSize: 20 }} />
        <Typography variant="subtitle1" fontWeight={600} fontFamily="Albert Sans, sans-serif" color="text.secondary">
          Completed Outcome Measures ({measures?.length ?? 0})
        </Typography>
      </Box>

      {(measures ?? []).map((m) => {
        const severity = (m.measureType === 'k10' || m.measureType === 'k10plus') ? getK10Severity(m.totalScore) : null;
        const mLabel = OUTCOME_MEASURE_OPTIONS.find((t) => t.id === m.measureType)?.label ?? m.measureType;
        const isExp = expandedAssessId === m.id;
        const mLabels = ITEM_LABELS[m.measureType] ?? [];
        const mTypeDef = OUTCOME_MEASURE_OPTIONS.find((t) => t.id === m.measureType);
        return (
          <Paper key={m.id} variant="outlined"
            role="button"
            tabIndex={0}
            aria-expanded={isExp}
            aria-label={`${mLabel} outcome measure — ${isExp ? 'collapse' : 'expand'}`}
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
                <Select value={measureType} onChange={(e) => {
                  const nextType = e.target.value;
                  setMeasureType(nextType);
                  const nextTypeDef = OUTCOME_MEASURE_OPTIONS.find((t) => t.id === nextType);
                  setItems(buildDefaultOutcomeItems(nextTypeDef?.items ?? 0, nextTypeDef?.minPerItem ?? 0));
                }} label="Measure Type">
                  {OUTCOME_MEASURE_OPTIONS.map((t) => <MenuItem key={t.id} value={t.id}>{t.label}</MenuItem>)}
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 4 }}>
              <FormControl fullWidth size="small">
                <InputLabel>Collection Occasion</InputLabel>
                <Select value={occasion} onChange={(e) => setOccasion(e.target.value)} label="Collection Occasion">
                  {OCCASIONS.map((o) => <MenuItem key={o} value={o} sx={{ textTransform: 'capitalize' }}>{o}</MenuItem>)}
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
                    onChange={(_, v) => setItems((prev) => ({ ...prev, [String(i + 1)]: v as number }))}
                    min={typeDef?.minPerItem ?? 0} max={typeDef?.maxPerItem ?? 4} step={1}
                    marks={Array.from(
                      { length: ((typeDef?.maxPerItem ?? 4) - (typeDef?.minPerItem ?? 0)) + 1 },
                      (_, j) => {
                        const value = (typeDef?.minPerItem ?? 0) + j;
                        return { value, label: String(value) };
                      },
                    )}
                    sx={{ color: '#327C8D' }}
                  />
                </Box>
              );
            })}
          </Paper>

          <TextField label="Notes" fullWidth multiline rows={2} size="small" value={notes} onChange={(e) => setNotes(e.target.value)} sx={{ mt: 2 }} />
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
