/**
 * AssessmentsTab — clinician-rated rating scales only.
 *
 * Phase 8 separation refactor (operator brief):
 *   4. The rating scales page must contain ONLY clinician-rated scales.
 *   5. Clinician-rated rating scales must be categorised by diagnosis.
 *
 * What this tab is NOT:
 *   - It NEVER renders outcome measures (HoNOS / K10 / K10+ / LSP-16).
 *     Those live on a dedicated OutcomeMeasuresTab. The
 *     separation is enforced by the server filter — the
 *     `/api/v1/assessments/rating-scales` route excludes outcome
 *     measures structurally, not by name.
 *   - It NEVER renders self-rated scales (PHQ-9 / GAD-7 / DASS-21 …).
 *     Those live on the Viva tab and are populated from
 *     `/api/v1/patient-app/self-rating-templates`.
 *
 * Display contract:
 *   - Scales are grouped by diagnosis category (operator brief #5).
 *   - Each group is an MUI Accordion whose header is the diagnosis label.
 *   - Empty state is explicit and clinically safe: "No clinician-rated
 *     rating scales configured for this clinic" (no fall-through to a
 *     mixed list).
 */
import { useEffect, useState } from 'react';
import {
  Accordion, AccordionDetails, AccordionSummary,
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions,
  DialogContent, DialogTitle, Divider, FormControl, Grid, InputLabel, MenuItem,
  Paper, Select, Snackbar, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import HistoryIcon from '@mui/icons-material/History';
import ScaleIcon from '@mui/icons-material/Scale';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { DiagnosisCategory, MeasurementDashboardSummary } from '@signacare/shared';
import { apiClient } from '../../../../../shared/services/apiClient';
import { episodesKeys, outcomeMeasuresKeys, patientsKeys, patientTemplatesKeys } from '../../../queryKeys';
import { ContactFormDialog } from '../../notes/ContactFormDialog';
import {
  TemplateFormRenderer, formValuesToText, extractScoreData,
  type FormValues, type TemplateField,
} from '../../../../../shared/components/TemplateFormRenderer';
import {
  parseContactMeta, parseTemplateFields,
  type CompletedAssessment,
} from './assessmentsTemplateUtils';
import { MultiInstrumentMeasurementPanel } from './measurements';

// ── Types ────────────────────────────────────────────────────────────────

interface RatingScaleApiItem {
  id: string;
  templateId: string | null;
  slug: string;
  name: string;
  raterType: 'self_rated' | 'clinician_rated';
  diagnosisCategory: DiagnosisCategory;
  content: unknown;
}

interface RatingScaleApiGroup {
  diagnosis: DiagnosisCategory;
  label: string;
  scales: RatingScaleApiItem[];
}

interface RatingScalesGroupedResponse {
  raterType: 'clinician_rated';
  groupedByDiagnosis: true;
  groups: RatingScaleApiGroup[];
  unknownCount: number;
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
      respondentType: 'clinician';
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
  note?: { id?: string };
}

interface EpisodeOption {
  id: string;
  title: string;
  episodeType?: string | null;
  status?: string | null;
}

interface AssessmentsTabProps { patientId: string }

// ── Component ────────────────────────────────────────────────────────────

export function AssessmentsTab({ patientId }: AssessmentsTabProps) {
  const qc = useQueryClient();
  const [ratingDialogOpen, setRatingDialogOpen] = useState(false);
  const [selectedRatingDefinitionId, setSelectedRatingDefinitionId] = useState('');
  const [ratingFields, setRatingFields] = useState<TemplateField[]>([]);
  const [ratingFormValues, setRatingFormValues] = useState<FormValues>({});
  const [ratingTitle, setRatingTitle] = useState('');
  const [contactFormOpen, setContactFormOpen] = useState(false);
  const [savedContext, setSavedContext] = useState<{ noteId: string; title: string } | null>(null);
  const [selectedEpisodeId, setSelectedEpisodeId] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);
  const [expandedAssessId, setExpandedAssessId] = useState<string | null>(null);

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

  // Phase 8 — the new /assessments/rating-scales endpoint returns
  // clinician-rated scales grouped by diagnosis. The server enforces
  // the exclusion of outcome measures; this tab does NOT carry a
  // local filter that could re-introduce them.
  const { data: ratingScalesResponse, isLoading: ratingScalesLoading } = useQuery({
    queryKey: patientTemplatesKeys.ratingScales(),
    queryFn: () => apiClient.get<RatingScalesGroupedResponse>('assessments/rating-scales'),
  });
  const ratingScaleGroups = ratingScalesResponse?.groups ?? [];

  // Phase 8 visualisation: latest score cards + trend charts for the
  // CLINICIAN-RATED rating-scale family only. The server filter excludes
  // outcome measures (Outcome Measures tab) and self-rated submissions
  // (Viva tab) structurally.
  const { data: summary } = useQuery({
    queryKey: outcomeMeasuresKeys.summary(patientId, 'clinician_rating_scale'),
    queryFn: () => apiClient.get<MeasurementDashboardSummary>(
      `assessments/patient/${patientId}/measurement-summary`,
      { family: 'clinician_rating_scale' },
    ),
    enabled: !!patientId,
  });

  // Flatten the grouped response for in-dialog lookups (the dialog
  // shows a flat picker grouped by diagnosis via the MenuItem labels).
  const allRatingScales: RatingScaleApiItem[] = ratingScaleGroups.flatMap((g) => g.scales);

  const { data: completedNotes, isLoading: notesLoading } = useQuery({
    queryKey: patientsKeys.notesAssessments(patientId),
    queryFn: () => apiClient.get<{ notes: CompletedAssessment[] }>(`patients/${patientId}/notes`).then((r) =>
      (r.notes ?? [])
        .filter((n) => {
          if (n.status !== 'signed') return false;
          if (!(n.noteType === 'review' || n.noteType === 'assessment' || n.noteType === 'intake')) return false;
          const meta = parseContactMeta(n.contactMeta);
          if (meta?.planType) return false;
          // Phase 8 — surface only CLINICIAN-rated rating-scale notes.
          // Self-rated entries belong on the Viva tab.
          if (meta?.ratingScale?.respondentType !== 'clinician') return false;
          return true;
        })
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    ),
    enabled: !!patientId,
  });

  const saveRatingMut = useMutation({
    mutationFn: (data: SaveRatingScalePayload) =>
      apiClient.post<SaveRatingScaleResponse>(`patients/${patientId}/notes`, data),
    onSuccess: (resp) => {
      qc.invalidateQueries({ queryKey: patientsKeys.notesAssessments(patientId) });
      qc.invalidateQueries({ queryKey: patientsKeys.notes(patientId) });
      qc.invalidateQueries({ queryKey: outcomeMeasuresKeys.summary(patientId, 'clinician_rating_scale') });
      if (selectedEpisodeId) {
        qc.invalidateQueries({ queryKey: episodesKeys.notes(patientId, selectedEpisodeId) });
      }
      setRatingDialogOpen(false);
      setRatingFields([]);
      setRatingFormValues({});
      setRatingTitle('');
      setSelectedRatingDefinitionId('');
      setSavedContext({ noteId: resp.note?.id ?? '', title: ratingTitle });
      setContactFormOpen(true);
      setFeedback('Rating scale saved');
    },
  });

  const handleRatingTemplateSelect = (definitionId: string) => {
    setSelectedRatingDefinitionId(definitionId);
    const tmpl = allRatingScales.find((t) => t.id === definitionId);
    if (tmpl) {
      setRatingTitle(tmpl.name);
      const fields = parseTemplateFields(tmpl.content as TemplateField[] | string | null);
      setRatingFields(fields);
      const defaults: FormValues = {};
      fields.forEach((f, i: number) => {
        if (f.type === 'likert') defaults[String(i)] = f.min ?? 0;
      });
      setRatingFormValues(defaults);
    }
  };

  const hasHistory = (completedNotes?.length ?? 0) > 0;
  // Detect completed notes that lack structured score metadata. The
  // operator brief mandates these are visible in history but marked
  // "not graphable: missing structured score" (do not infer).
  const notGraphableCount = (completedNotes ?? []).filter((n) => {
    const cm = parseContactMeta(n.contactMeta);
    return typeof cm?.ratingScale?.totalScore !== 'number';
  }).length;

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <ScaleIcon sx={{ color: '#b8621a' }} />
          <Typography variant="h6" fontWeight={700} fontFamily="Albert Sans, sans-serif">
            Rating Scales
          </Typography>
          <Chip label="Clinician-rated" size="small" sx={{ fontSize: 10, height: 20 }} />
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
          onClick={() => setRatingDialogOpen(true)}
          disabled={!selectedEpisodeId || allRatingScales.length === 0}
          sx={{ bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' }, textTransform: 'none', fontSize: 12 }}>
          Add Rating Scale
        </Button>
      </Box>

      <Alert severity="info" sx={{ mb: 2, fontSize: 12 }}>
        Outcome measures (HoNOS, K10/K10+, LSP-16) live on the dedicated Outcome Measures tab.
        Self-rated scales are surfaced in the Viva patient app and recorded under the Viva tab.
      </Alert>

      {episodes.length === 0 && (
        <Alert severity="warning" sx={{ mb: 2, fontSize: 13 }}>
          Open an episode before saving a rating scale so it appears in the episode timeline.
        </Alert>
      )}

      {ratingScalesLoading && (
        <CircularProgress role="progressbar" aria-label="Loading" size={24} sx={{ mb: 2 }} />
      )}

      {!ratingScalesLoading && allRatingScales.length === 0 && (
        <Alert severity="warning" sx={{ mb: 2, fontSize: 13 }}>
          No clinician-rated rating scales are configured for this clinic. Add scales via Settings &gt; Templates.
        </Alert>
      )}

      {/*
       * Phase 8 visualisation — latest score cards + small-multiples trend
       * charts for clinician-rated rating scales. Server-filtered to
       * `family=clinician_rating_scale` so outcome measures and Viva self-
       * rated scales cannot leak into this panel.
       */}
      {summary && (summary.series.length > 0 || summary.crossInstrumentTimeline.length > 0) && (
        <Box sx={{ mb: 2.5 }}>
          <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1, color: '#3D484B' }}>
            Rating Scale Trends
          </Typography>
          <MultiInstrumentMeasurementPanel
            series={summary.series}
            timeline={summary.crossInstrumentTimeline}
            warnings={summary.warnings}
            restrictToFamily="clinician_rating_scale"
            hideLegend
            hideTimeline
          />
        </Box>
      )}
      {notGraphableCount > 0 && (
        <Alert severity="info" sx={{ mb: 2, fontSize: 12 }}>
          {notGraphableCount} completed rating-scale {notGraphableCount === 1 ? 'entry is' : 'entries are'} below
          {' '}without a structured score and cannot be graphed (visible in history below). Re-record using
          a scorable template to enable trend visualisation.
        </Alert>
      )}

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
        <HistoryIcon sx={{ color: '#999', fontSize: 20 }} />
        <Typography variant="subtitle1" fontWeight={600} fontFamily="Albert Sans, sans-serif" color="text.secondary">
          Completed Rating Scales ({completedNotes?.length ?? 0})
        </Typography>
      </Box>

      {!notesLoading && !hasHistory && (
        <Alert severity="info" sx={{ mb: 2, fontSize: 13 }}>
          No clinician-rated rating-scale entries yet for this patient.
        </Alert>
      )}

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75, mb: 3 }}>
        {(completedNotes ?? []).map((n) => {
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
                'aria-label': `${n.title} rating scale — ${isExp ? 'collapse' : 'expand'}`,
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
                    <Chip label="Clinician-rated" size="small" sx={{ fontSize: 9, height: 18 }} />
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
                      <Typography variant="caption" fontWeight={600} sx={{ display: 'block', mb: 0.5 }}>Score Breakdown</Typography>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                        {scoreBreakdowns.map((br, i) => (
                          <Chip key={i} label={`${br.label}: ${br.score}${br.severity ? ` (${br.severity})` : ''}`} size="small" variant="outlined" sx={{ fontSize: 9, height: 20 }} />
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

      {/* Catalogue — clinician-rated scales grouped by diagnosis. */}
      {ratingScaleGroups.length > 0 && (
        <Box sx={{ mb: 3 }}>
          <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1.5, color: '#3D484B' }}>
            Available Clinician-Rated Rating Scales
          </Typography>
          {ratingScaleGroups.map((group) => (
            <Accordion key={group.diagnosis} disableGutters sx={{ '&:before': { display: 'none' }, borderTop: '1px solid #E0E0E0' }}>
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography variant="subtitle2" fontWeight={700}>{group.label}</Typography>
                <Chip label={String(group.scales.length)} size="small" sx={{ ml: 1, fontSize: 10, height: 18 }} />
              </AccordionSummary>
              <AccordionDetails sx={{ pt: 0 }}>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                  {group.scales.map((scale) => (
                    <Chip
                      key={scale.id}
                      label={scale.name}
                      size="small"
                      onClick={() => {
                        handleRatingTemplateSelect(scale.id);
                        setRatingDialogOpen(true);
                      }}
                      sx={{ cursor: 'pointer', fontSize: 11 }}
                    />
                  ))}
                </Box>
              </AccordionDetails>
            </Accordion>
          ))}
        </Box>
      )}

      <Dialog aria-labelledby="dialog-title" open={ratingDialogOpen} onClose={() => setRatingDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle id="dialog-title" sx={{ fontWeight: 700, fontFamily: 'Albert Sans, sans-serif' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <ScaleIcon sx={{ color: '#b8621a' }} />
            Add Rating Scale (Clinician-Rated)
          </Box>
        </DialogTitle>
        <Divider />
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 0.5 }}>
            <Grid size={{ xs: 12 }}>
              <FormControl fullWidth size="small">
                <InputLabel>Select Rating Scale</InputLabel>
                <Select value={selectedRatingDefinitionId} onChange={(e) => handleRatingTemplateSelect(e.target.value)} label="Select Rating Scale">
                  {allRatingScales.length === 0 && <MenuItem disabled>No clinician-rated rating scales configured</MenuItem>}
                  {ratingScaleGroups.flatMap((group) => [
                    <MenuItem key={`group-${group.diagnosis}`} disabled sx={{ opacity: 1, fontWeight: 700 }}>
                      {group.label}
                    </MenuItem>,
                    ...group.scales.map((scale) => (
                      <MenuItem key={scale.id} value={scale.id} sx={{ pl: 4 }}>
                        {scale.name}
                      </MenuItem>
                    )),
                  ])}
                </Select>
              </FormControl>
            </Grid>
            {selectedRatingDefinitionId && (
              <Grid size={{ xs: 12 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                  <Typography variant="subtitle2" fontWeight={600}>{ratingTitle}</Typography>
                  <Button size="small" onClick={() => { setSelectedRatingDefinitionId(''); setRatingFields([]); setRatingFormValues({}); setRatingTitle(''); }}
                    sx={{ color: 'text.secondary', fontSize: 11 }}>Change Scale</Button>
                </Box>
                {(() => {
                  const selected = allRatingScales.find((s) => s.id === selectedRatingDefinitionId);
                  if (!selected) return null;
                  const diagnosisLabel = ratingScaleGroups.find((g) => g.diagnosis === selected.diagnosisCategory)?.label
                    ?? selected.diagnosisCategory;
                  return (
                    <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', mb: 1 }}>
                      <Chip size="small" label="Clinician-rated" sx={{ fontSize: 10, height: 20 }} />
                      <Chip size="small" label={`Diagnosis: ${diagnosisLabel}`} variant="outlined" sx={{ fontSize: 10, height: 20 }} />
                    </Box>
                  );
                })()}
                {ratingFields.length === 0 && (
                  <Alert severity="warning" sx={{ fontSize: 12 }}>This template has no scoring items. It may need to be configured in Settings &gt; Templates.</Alert>
                )}
              </Grid>
            )}
            {selectedRatingDefinitionId && ratingFields.length > 0 && (
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
              saveRatingMut.mutate({
                episodeId: selectedEpisodeId || undefined,
                title: ratingTitle.trim(),
                noteType: 'assessment',
                content: textContent,
                templateId:
                  allRatingScales.find((scale) => scale.id === selectedRatingDefinitionId)?.templateId
                  ?? undefined,
                status: 'signed',
                isReportableContact: true,
                contactMeta: {
                  contactDate: new Date().toISOString().split('T')[0],
                  ratingScale: {
                    templateName: ratingTitle,
                    respondentType: 'clinician',
                    totalScore: scoreData.totalScore,
                    severity: scoreData.severity,
                    itemCount: scoreData.itemCount,
                    itemScores: scoreData.itemScores,
                    scoreBreakdowns: scoreData.scoreBreakdowns,
                  },
                },
              });
            }}
            disabled={!selectedEpisodeId || !selectedRatingDefinitionId || !ratingTitle.trim() || saveRatingMut.isPending}
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
