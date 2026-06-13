import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import ScienceIcon from '@mui/icons-material/Science';
import EventIcon from '@mui/icons-material/Event';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  CircularProgress,
  Divider,
  Grid,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { type ReactNode, useState } from 'react';
import type {
  AgenticScribeCreateTasksResponse,
  AgenticScribeGenerateDraftsResponse,
} from '@signacare/shared';
import { AiGeneratedNoteSaveDialog } from '../../../shared/components/ui/AiGeneratedNoteSaveDialog';
import { apiClient } from '../../../shared/services/apiClient';
import { PatientSearchAutocomplete, type PatientOption } from '../../patients/components/PatientSearchAutocomplete';
import { AmbientAiRecorder } from '../../patients/components/notes/AmbientAiRecorder';

type DraftSelectionState = {
  labs: Record<string, boolean>;
  referrals: Record<string, boolean>;
  followUps: Record<string, boolean>;
};

function emptySelections(): DraftSelectionState {
  return { labs: {}, referrals: {}, followUps: {} };
}

function buildAgenticDraftSummaryNoteContent(args: {
  transcript: string;
  contextNote: string;
  result: AgenticScribeGenerateDraftsResponse;
}): string {
  const { transcript, contextNote, result } = args;
  const sections: string[] = ['# Agentic AI Draft Summary', ''];

  if (contextNote.trim().length > 0) {
    sections.push('## Additional Context', contextNote.trim(), '');
  }

  sections.push('## Consultation Transcript', transcript.trim(), '');
  sections.push('## Draft Overview');
  sections.push(`- Lab order drafts: ${result.drafts.labOrders.length}`);
  sections.push(`- Referral drafts: ${result.drafts.referrals.length}`);
  sections.push(`- Follow-up drafts: ${result.drafts.followUps.length}`);
  sections.push('');

  if (result.drafts.labOrders.length > 0) {
    sections.push('## Lab Order Drafts');
    for (const draft of result.drafts.labOrders) {
      sections.push(`- ${draft.testName} [${draft.urgency}]`);
      sections.push(`  Rationale: ${draft.rationale}`);
      sections.push(`  Source: ${draft.sourceSnippet}`);
    }
    sections.push('');
  }

  if (result.drafts.referrals.length > 0) {
    sections.push('## Referral Drafts');
    for (const draft of result.drafts.referrals) {
      sections.push(`- ${draft.specialtyOrService} [${draft.urgency}]`);
      sections.push(`  Reason: ${draft.reason}`);
      sections.push(`  Source: ${draft.sourceSnippet}`);
    }
    sections.push('');
  }

  if (result.drafts.followUps.length > 0) {
    sections.push('## Follow-up Drafts');
    for (const draft of result.drafts.followUps) {
      sections.push(`- ${draft.appointmentType} (${draft.timeframeText})`);
      sections.push(`  Mode: ${draft.mode}`);
      sections.push(`  Rationale: ${draft.rationale}`);
      sections.push(`  Suggested date: ${draft.suggestedDate ?? 'Not resolved'}`);
      sections.push(`  Source: ${draft.sourceSnippet}`);
    }
    sections.push('');
  }

  sections.push('## AI Disclaimer');
  sections.push(result.disclaimer);

  return sections.join('\n');
}

export default function AgenticScribePage() {
  const [selectedPatient, setSelectedPatient] = useState<PatientOption | null>(null);
  const [transcript, setTranscript] = useState('');
  const [contextNote, setContextNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [tasking, setTasking] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [result, setResult] = useState<AgenticScribeGenerateDraftsResponse | null>(null);
  const [selections, setSelections] = useState<DraftSelectionState>(emptySelections());
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);

  const totalDraftCount =
    (result?.drafts.labOrders.length ?? 0) +
    (result?.drafts.referrals.length ?? 0) +
    (result?.drafts.followUps.length ?? 0);

  const selectedCount =
    Object.values(selections.labs).filter(Boolean).length +
    Object.values(selections.referrals).filter(Boolean).length +
    Object.values(selections.followUps).filter(Boolean).length;

  const canGenerate = transcript.trim().length >= 20 && !loading;
  const canCreateTasks = !!result && selectedCount > 0 && !tasking;

  async function handleGenerateDrafts() {
    if (!canGenerate) return;
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      const response = await apiClient.post<AgenticScribeGenerateDraftsResponse>('agentic-scribe/drafts', {
        patientId: selectedPatient?.id,
        transcript: transcript.trim(),
        contextNote: contextNote.trim() || undefined,
      });
      setResult(response);
      setSelections(emptySelections());
    } catch (err: unknown) {
      const maybe = err as { response?: { data?: { error?: string } }; message?: string };
      setError(maybe.response?.data?.error ?? maybe.message ?? 'Failed to generate drafts');
    } finally {
      setLoading(false);
    }
  }

  function toggleSelection(kind: keyof DraftSelectionState, draftId: string) {
    setSelections((prev) => ({
      ...prev,
      [kind]: {
        ...prev[kind],
        [draftId]: !prev[kind][draftId],
      },
    }));
  }

  async function handleCreateTasks() {
    if (!result || !canCreateTasks) return;
    setTasking(true);
    setError('');
    setSuccess('');
    try {
      const items = [
        ...result.drafts.labOrders
          .filter((d) => selections.labs[d.draftId])
          .map((d) => ({
            draftType: 'lab_order' as const,
            draftId: d.draftId,
            title: `Lab order draft: ${d.testName}`,
            description: `${d.rationale}\n\nSource: ${d.sourceSnippet}`,
            priority: d.urgency === 'urgent' ? 'high' as const : 'medium' as const,
          })),
        ...result.drafts.referrals
          .filter((d) => selections.referrals[d.draftId])
          .map((d) => ({
            draftType: 'referral' as const,
            draftId: d.draftId,
            title: `Referral draft: ${d.specialtyOrService}`,
            description: `${d.reason}\n\nSource: ${d.sourceSnippet}`,
            priority: d.urgency === 'urgent' ? 'high' as const : 'medium' as const,
          })),
        ...result.drafts.followUps
          .filter((d) => selections.followUps[d.draftId])
          .map((d) => ({
            draftType: 'follow_up' as const,
            draftId: d.draftId,
            title: `Follow-up draft: ${d.appointmentType}`,
            description: `${d.rationale}\n\nTimeframe: ${d.timeframeText}\nMode: ${d.mode}`,
            dueDate: d.suggestedDate ?? undefined,
            priority: 'medium' as const,
          })),
      ];

      const created = await apiClient.post<AgenticScribeCreateTasksResponse>('agentic-scribe/tasks/from-drafts', {
        patientId: selectedPatient?.id,
        items,
      });

      setSuccess(`Created ${created.createdTasks.length} task(s) from selected drafts.`);
    } catch (err: unknown) {
      const maybe = err as { response?: { data?: { error?: string } }; message?: string };
      setError(maybe.response?.data?.error ?? maybe.message ?? 'Failed to create tasks from drafts');
    } finally {
      setTasking(false);
    }
  }

  return (
    <Box sx={{ p: { xs: 2, md: 3 } }}>
      <Paper
        variant="outlined"
        sx={{
          p: 2,
          mb: 2,
          borderRadius: 2,
          background: 'linear-gradient(135deg, #f8fafc 0%, #eef6ff 100%)',
        }}
      >
        <Stack direction="row" spacing={1.5} alignItems="center">
          <AutoAwesomeIcon sx={{ color: '#005b96' }} />
          <Box>
            <Typography variant="h6" fontWeight={700}>
              Agentic AI Scribe (Next-Gen)
            </Typography>
            <Typography variant="body2" color="text.secondary">
              In-visit draft generation for lab orders, referrals, and follow-up appointments.
            </Typography>
          </Box>
        </Stack>
      </Paper>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }}>{success}</Alert>}

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, lg: 5 }}>
          <Card variant="outlined" sx={{ borderRadius: 2 }}>
            <CardContent>
              <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
                Consultation Context
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Record with Medical Scribe or paste transcript content, then generate structured drafts in one step.
              </Typography>

              <Typography variant="caption" color="text.secondary">Patient (optional)</Typography>
              <Box sx={{ mb: 2, mt: 0.5 }}>
                <PatientSearchAutocomplete
                  value={selectedPatient}
                  onChange={(patient) => setSelectedPatient(patient)}
                />
              </Box>

              {selectedPatient ? (
                <Box sx={{ mb: 2 }}>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.75 }}>
                    Medical Scribe
                  </Typography>
                  <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2, bgcolor: '#FCFBF9' }}>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                      Start an ambient recording here to populate the transcript automatically, then generate agentic drafts without copy-paste.
                    </Typography>
                    <AmbientAiRecorder
                      patientId={selectedPatient.id}
                      onTranscriptReady={(nextTranscript) => setTranscript(nextTranscript)}
                    />
                  </Paper>
                </Box>
              ) : (
                <Alert severity="info" sx={{ mb: 2 }}>
                  Select a patient to start Medical Scribe from this page, or paste a transcript manually below.
                </Alert>
              )}

              <TextField
                label="Consultation Transcript"
                placeholder="Paste consultation transcript or detailed encounter notes..."
                multiline
                minRows={8}
                fullWidth
                value={transcript}
                onChange={(e) => setTranscript(e.target.value)}
              />
              <TextField
                label="Additional Context (optional)"
                placeholder="Optional context such as clinical goals, differential, constraints..."
                multiline
                minRows={4}
                fullWidth
                sx={{ mt: 2 }}
                value={contextNote}
                onChange={(e) => setContextNote(e.target.value)}
              />

              <Stack direction="row" spacing={1} sx={{ mt: 2 }} alignItems="center">
                <Button
                  variant="contained"
                  onClick={handleGenerateDrafts}
                  disabled={!canGenerate}
                  startIcon={loading ? <CircularProgress size={16} color="inherit" /> : <AutoAwesomeIcon />}
                >
                  {loading ? 'Generating drafts...' : 'Generate Drafts'}
                </Button>
                <Typography variant="caption" color="text.secondary">
                  Minimum 20 characters required.
                </Typography>
              </Stack>
            </CardContent>
          </Card>
        </Grid>

        <Grid size={{ xs: 12, lg: 7 }}>
          <Card variant="outlined" sx={{ borderRadius: 2, minHeight: 520 }}>
            <CardContent>
              <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
                <Typography variant="subtitle1" fontWeight={700}>
                  Draft Queue
                </Typography>
                <Stack direction="row" spacing={1}>
                  <Chip size="small" label={`Drafts: ${totalDraftCount}`} />
                  <Chip size="small" color="primary" label={`Selected: ${selectedCount}`} />
                </Stack>
              </Stack>
              <Typography variant="caption" color="text.secondary">
                Review drafts and create actionable tasks for clinician follow-through.
              </Typography>

              {!result && (
                <Box sx={{ mt: 4, textAlign: 'center', color: 'text.secondary' }}>
                  <AutoAwesomeIcon sx={{ fontSize: 36, opacity: 0.5 }} />
                  <Typography variant="body2" sx={{ mt: 1 }}>
                    Drafts will appear here after generation.
                  </Typography>
                </Box>
              )}

              {result && (
                <Box sx={{ mt: 2 }}>
                  <DraftSection
                    title="Lab Order Drafts"
                    icon={<ScienceIcon fontSize="small" />}
                    items={result.drafts.labOrders.map((d) => ({
                      id: d.draftId,
                      title: d.testName,
                      subtitle: d.rationale,
                      meta: `${d.urgency.toUpperCase()}`,
                      checked: !!selections.labs[d.draftId],
                      onToggle: () => toggleSelection('labs', d.draftId),
                    }))}
                  />
                  <DraftSection
                    title="Referral Drafts"
                    icon={<SwapHorizIcon fontSize="small" />}
                    items={result.drafts.referrals.map((d) => ({
                      id: d.draftId,
                      title: d.specialtyOrService,
                      subtitle: d.reason,
                      meta: `${d.urgency.toUpperCase()}`,
                      checked: !!selections.referrals[d.draftId],
                      onToggle: () => toggleSelection('referrals', d.draftId),
                    }))}
                  />
                  <DraftSection
                    title="Follow-up Drafts"
                    icon={<EventIcon fontSize="small" />}
                    items={result.drafts.followUps.map((d) => ({
                      id: d.draftId,
                      title: `${d.appointmentType} (${d.timeframeText})`,
                      subtitle: d.rationale,
                      meta: d.suggestedDate ? `Suggested: ${d.suggestedDate}` : 'Suggested date not resolved',
                      checked: !!selections.followUps[d.draftId],
                      onToggle: () => toggleSelection('followUps', d.draftId),
                    }))}
                  />

                  <Divider sx={{ my: 2 }} />
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ xs: 'stretch', sm: 'center' }}>
                    <Button
                      variant="contained"
                      color="success"
                      disabled={!canCreateTasks}
                      startIcon={tasking ? <CircularProgress size={16} color="inherit" /> : <CheckCircleOutlineIcon />}
                      onClick={handleCreateTasks}
                    >
                      {tasking ? 'Creating tasks...' : 'Create Tasks From Selected Drafts'}
                    </Button>
                    {selectedPatient && (
                      <Button
                        variant="outlined"
                        onClick={() => setSaveDialogOpen(true)}
                        sx={{ textTransform: 'none' }}
                      >
                        Save Draft Summary to Episode
                      </Button>
                    )}
                    <Typography variant="caption" color="text.secondary">
                      {result.disclaimer}
                    </Typography>
                  </Stack>
                </Box>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>
      <AiGeneratedNoteSaveDialog
        open={saveDialogOpen && !!result}
        patientId={selectedPatient?.id ?? null}
        content={result ? buildAgenticDraftSummaryNoteContent({ transcript, contextNote, result }) : ''}
        defaultTitle="AI: Agentic Draft Summary"
        sourceKey="agentic_ai_draft_summary"
        sourceLabel="Agentic AI draft summary"
        onClose={() => setSaveDialogOpen(false)}
        onSaved={() => setSaveDialogOpen(false)}
      />
    </Box>
  );
}

function DraftSection(props: {
  title: string;
  icon: ReactNode;
  items: Array<{
    id: string;
    title: string;
    subtitle: string;
    meta: string;
    checked: boolean;
    onToggle: () => void;
  }>;
}) {
  return (
    <Box sx={{ mb: 2 }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
        {props.icon}
        <Typography variant="subtitle2" fontWeight={700}>{props.title}</Typography>
        <Chip size="small" label={props.items.length} />
      </Stack>
      {props.items.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ ml: 0.5 }}>
          No drafts detected.
        </Typography>
      ) : (
        <Stack spacing={1}>
          {props.items.map((item) => (
            <Paper key={item.id} variant="outlined" sx={{ p: 1.25, borderRadius: 1.5 }}>
              <Stack direction="row" spacing={1.5} alignItems="flex-start">
                <Checkbox checked={item.checked} onChange={item.onToggle} size="small" sx={{ mt: -0.5 }} />
                <Box sx={{ flex: 1 }}>
                  <Typography variant="body2" fontWeight={600}>{item.title}</Typography>
                  <Typography variant="caption" color="text.secondary">{item.subtitle}</Typography>
                  <Typography variant="caption" sx={{ display: 'block', mt: 0.5, color: 'text.secondary' }}>
                    {item.meta}
                  </Typography>
                </Box>
              </Stack>
            </Paper>
          ))}
        </Stack>
      )}
    </Box>
  );
}
