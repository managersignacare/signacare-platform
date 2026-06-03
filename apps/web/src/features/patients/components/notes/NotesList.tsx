import EditIcon from '@mui/icons-material/Edit';
import LockIcon from '@mui/icons-material/Lock';
import MailOutlineIcon from '@mui/icons-material/MailOutline';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import SendIcon from '@mui/icons-material/Send';
import {
  Alert, Box, Button, Card, CardContent, Chip, CircularProgress, Dialog, DialogActions,
  Checkbox, DialogContent, DialogTitle, Divider, FormControl, FormControlLabel, Grid, IconButton, InputLabel,
  MenuItem, Paper, Select, TextField, Tooltip, Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ListExportBar } from '../../../../shared/components/ui/ListExportBar';
import { PrintExportButtons } from '../../../../shared/components/ui/PrintExportButtons';
import { apiClient } from '../../../../shared/services/apiClient';
import { canSignAiDraftNote, requiresAiDraftSignAttestation } from '../../../../shared/utils/aiDraftSignAttestation';
import { openInNewWindow, openEditableInNewWindow, NOTE_SAVED_CHANNEL } from '../../../../shared/utils/openInNewWindow';
import { patientsKeys, correspondenceKeys } from '../../queryKeys';

interface Note {
  id: string; title: string; noteType: string; content: string; foiExempt: boolean;
  status: string; didNotAttend: boolean; authorName: string; signedByName: string;
  signedAt: string | null; episodeId?: string; episodeTitle: string; createdAt: string;
  isAiDraft?: boolean;
}

interface NotesApiError {
  message?: unknown;
  response?: {
    data?: {
      error?: unknown;
      message?: unknown;
    };
  };
}

function getNotesErrorMessage(err: unknown, fallback: string): string {
  if (typeof err !== 'object' || err === null) return fallback;
  const parsed = err as NotesApiError;
  if (typeof parsed.response?.data?.error === 'string' && parsed.response.data.error.trim()) {
    return parsed.response.data.error;
  }
  if (typeof parsed.response?.data?.message === 'string' && parsed.response.data.message.trim()) {
    return parsed.response.data.message;
  }
  if (typeof parsed.message === 'string' && parsed.message.trim()) {
    return parsed.message;
  }
  return fallback;
}

function openNoteInWindow(note: Note) {
  openInNewWindow({
    title: note.title,
    subtitle: `${note.noteType} — ${note.authorName}`,
    content: note.content || '(No content)',
    meta: {
      Type: note.noteType, Author: note.authorName,
      Date: new Date(note.createdAt).toLocaleDateString('en-AU'),
      Status: note.status, Episode: note.episodeTitle || '',
      ...(note.signedAt ? { 'Signed by': `${note.signedByName} on ${new Date(note.signedAt).toLocaleDateString('en-AU')}` } : {}),
    },
  });
}

interface NotesListProps { patientId: string; episodeId?: string; onGenerateLetter?: (note: Note) => void }
export function NotesList({ patientId, episodeId }: NotesListProps) {
  const qc = useQueryClient();
  const [letterNote, setLetterNote] = useState<Note | null>(null);
  const [signConfirmNote, setSignConfirmNote] = useState<Note | null>(null);
  const [reviewedAndAdopted, setReviewedAndAdopted] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: patientsKeys.notesByEpisode(patientId, episodeId),
    queryFn: () => { const p = episodeId ? `?episodeId=${episodeId}` : ''; return apiClient.get<{ notes: Note[] }>(`patients/${patientId}/notes${p}`).then(r => r.notes); },
    enabled: !!patientId,
  });

  // Listen for saves from child windows (BroadcastChannel)
  useEffect(() => {
    let ch: BroadcastChannel | null = null;
    try {
      ch = new BroadcastChannel(NOTE_SAVED_CHANNEL);
      ch.onmessage = () => { qc.invalidateQueries({ queryKey: patientsKeys.notes(patientId) }); };
    } catch { /* BroadcastChannel not supported */ }
    return () => { ch?.close(); };
  }, [patientId, qc]);

  const signMut = useMutation({
    mutationFn: ({ id, reviewed }: { id: string; reviewed: boolean }) =>
      apiClient.patch(`patients/${patientId}/notes/${id}`, {
        status: 'signed',
        reviewedAndAdopted: reviewed || undefined,
      }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: patientsKeys.notes(patientId) }); },
    onError: (err: unknown) => alert(`Failed to sign note: ${getNotesErrorMessage(err, 'Unknown')}`),
  });

  const requestSign = (note: Note) => {
    const requiresAttestation = requiresAiDraftSignAttestation(note.isAiDraft === true);
    if (!requiresAttestation) {
      signMut.mutate({ id: note.id, reviewed: false });
      return;
    }
    setReviewedAndAdopted(false);
    setSignConfirmNote(note);
  };

  if (isLoading) return <CircularProgress role="progressbar" aria-label="Loading" size={24} />;
  if (!data?.length) return <Alert severity="info">No clinical notes recorded.</Alert>;

  const handleEditDraft = (note: Note) => {
    const apiBase = (import.meta.env.VITE_API_URL as string) || '/api/v1';
    openEditableInNewWindow({
      title: note.title,
      subtitle: `${note.noteType} — ${note.authorName}`,
      content: note.content || '',
      meta: {
        Type: note.noteType, Author: note.authorName,
        Date: new Date(note.createdAt).toLocaleDateString('en-AU'),
        Episode: note.episodeTitle || '',
      },
      patchUrl: `${apiBase}/patients/${patientId}/notes/${note.id}`,
    });
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
        <ListExportBar
          title="Clinical Notes"
          subtitle={`${data.length} notes`}
          columns={['Date', 'Type', 'Title', 'Author', 'Status', 'Episode', 'Content']}
          rows={data.map(n => [
            new Date(n.createdAt).toLocaleDateString('en-AU'),
            n.noteType, n.title, n.authorName, n.status, n.episodeTitle ?? '',
            (n.content ?? '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(),
          ])}
          compact
        />
      </Box>
      {/* BUG-447-clinical-notes-scribe: removed redundant Card-level
          onClick + redundant inner-Box stopPropagation. Each interactive
          surface (OpenInNew IconButton at line ~117, Edit IconButton,
          Letter Button, PrintExportButtons) is independently keyboard-
          accessible via native MUI primitives. The Card is now a pure
          visual container — no click target needed. Closes 2 BUG-447
          violations structurally (no Shape-B trio retrofit, no inner
          stopPropagation hack). Pattern: when redundant click handlers
          exist on a container AND on inner native-button targets,
          remove the container handler. */}
      {data.map(note => (
        <Card key={note.id} variant="outlined"
          sx={{ borderLeft: `4px solid ${note.status === 'signed' ? '#327C8D' : '#b8621a'}`, '&:hover': { borderColor: '#b8621a' } }}>
          <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography variant="body2" fontWeight={600}>{note.title}</Typography>
                  {note.didNotAttend && <Chip label="DNA" size="small" color="error" sx={{ fontSize: 9, height: 18 }} />}
                  {note.foiExempt && <LockIcon sx={{ fontSize: 14, color: '#D32F2F' }} />}
                </Box>
                <Typography variant="caption" color="text.secondary">
                  {new Date(note.createdAt).toLocaleDateString('en-AU')} {new Date(note.createdAt).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })}
                  {' — '}{note.authorName}{note.episodeTitle && ` — ${note.episodeTitle}`}
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Chip label={note.noteType} size="small" variant="outlined" sx={{ fontSize: 9, height: 18, textTransform: 'capitalize' }} />
                <Chip label={note.status} size="small" color={note.status === 'signed' ? 'success' : 'warning'} sx={{ fontSize: 9, height: 18 }} />
                <Tooltip title="View in new window">
                  <IconButton size="small" onClick={() => openNoteInWindow(note)}
                    sx={{ color: '#327C8D', p: 0.25 }}><OpenInNewIcon sx={{ fontSize: 14 }} /></IconButton>
                </Tooltip>
                {note.status === 'draft' && (
                  <Tooltip title="Edit in new window">
                    <IconButton size="small" onClick={() => handleEditDraft(note)}
                      sx={{ color: '#b8621a', p: 0.25 }}><EditIcon sx={{ fontSize: 14 }} /></IconButton>
                  </Tooltip>
                )}
                <Button size="small" startIcon={<MailOutlineIcon sx={{ fontSize: 14 }} />}
                  onClick={() => setLetterNote(note)}
                  sx={{ fontSize: 10, textTransform: 'none', color: '#327C8D', minWidth: 0 }}>
                  Letter
                </Button>
                <PrintExportButtons
                  content={note.content || ''}
                  title={note.title}
                  subtitle={`${note.noteType} — ${note.authorName} — ${new Date(note.createdAt).toLocaleDateString('en-AU')}`}
                  compact
                  meta={{ Type: note.noteType, Author: note.authorName, Date: new Date(note.createdAt).toLocaleDateString('en-AU'), Status: note.status, Episode: note.episodeTitle || '' }}
                />
                {note.status === 'draft' && (
                  <Button size="small" variant="contained" onClick={() => requestSign(note)}
                    disabled={signMut.isPending}
                    sx={{ bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' }, fontSize: 10, minWidth: 0, px: 1 }}>Sign</Button>
                )}
              </Box>
            </Box>
          </CardContent>
        </Card>
      ))}

      {/* Letter Generator Dialog */}
      {letterNote && (
        <LetterFromNoteDialog
          note={letterNote}
          patientId={patientId}
          onClose={() => setLetterNote(null)}
          onSaved={() => { setLetterNote(null); qc.invalidateQueries({ queryKey: correspondenceKeys.byPatient(patientId) }); }}
        />
      )}
      <Dialog open={Boolean(signConfirmNote)} onClose={() => setSignConfirmNote(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Review and Adopt AI Draft</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 1.5 }}>
            This note is AI-drafted. Please confirm you reviewed and adopted it before signing.
          </Typography>
          <FormControlLabel
            control={(
              <Checkbox
                checked={reviewedAndAdopted}
                onChange={(_, checked) => setReviewedAndAdopted(checked)}
              />
            )}
            label="I have reviewed and adopted this AI draft."
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSignConfirmNote(null)} color="inherit">Cancel</Button>
          <Button
            variant="contained"
            disabled={!canSignAiDraftNote(true, reviewedAndAdopted) || signMut.isPending}
            onClick={() => {
              if (!signConfirmNote) return;
              signMut.mutate({
                id: signConfirmNote.id,
                reviewed: reviewedAndAdopted,
              });
              setSignConfirmNote(null);
              setReviewedAndAdopted(false);
            }}
          >
            Sign
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

// ── Letter Generator Dialog ──────────────────────────────────────────────────

const LETTER_TYPES = [
  { value: 'gp_letter', label: 'GP Letter', desc: 'Summary letter to General Practitioner' },
  { value: 'pharmacy_letter', label: 'Pharmacy Letter', desc: 'Medication letter for dispensing pharmacy' },
  { value: 'ndis_support', label: 'NDIS Support Letter', desc: 'Functional assessment for NDIS application/review' },
  { value: 'referral_letter', label: 'Referral Letter', desc: 'Referral to specialist or external service' },
  { value: 'discharge_letter', label: 'Discharge Letter', desc: 'Discharge summary letter to GP/services' },
  { value: 'mhrt_report', label: 'MHRT Report', desc: 'Report for Mental Health Review Tribunal' },
  { value: 'insurance_report', label: 'Insurance / Medico-legal', desc: 'Report for insurance or legal purposes' },
  { value: 'carer_letter', label: 'Carer / Family Letter', desc: 'Information letter for carer or family member' },
  { value: 'custom', label: 'Custom Letter', desc: 'Free-form letter with custom instructions' },
];

interface LetterFromNoteDialogProps {
  note: Note;
  patientId: string;
  onClose: () => void;
  onSaved: () => void;
}

function LetterFromNoteDialog({ note, patientId, onClose, onSaved }: LetterFromNoteDialogProps) {
  const [letterType, setLetterType] = useState('gp_letter');
  const [recipientName, setRecipientName] = useState('');
  const [recipientAddress, setRecipientAddress] = useState('');
  const [customInstructions, setCustomInstructions] = useState('');
  const [generatedLetter, setGeneratedLetter] = useState('');
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleGenerate = async () => {
    setGenerating(true); setError(''); setGeneratedLetter('');
    try {
      // Strip HTML from note content
      const noteText = (note.content ?? '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
      const typeLabel = LETTER_TYPES.find(t => t.value === letterType)?.label ?? letterType;

      const prompt = `Generate a ${typeLabel} from the following signed clinical note.

NOTE DETAILS:
Title: ${note.title}
Type: ${note.noteType}
Author: ${note.authorName}
Date: ${note.createdAt ? new Date(note.createdAt).toLocaleDateString('en-AU') : 'Unknown'}
${note.episodeTitle ? `Episode: ${note.episodeTitle}` : ''}

NOTE CONTENT:
${noteText}

LETTER REQUIREMENTS:
- Letter type: ${typeLabel}
${recipientName ? `- Recipient: ${recipientName}` : ''}
${recipientAddress ? `- Address: ${recipientAddress}` : ''}
${customInstructions ? `- Additional instructions: ${customInstructions}` : ''}
- Use Australian clinical letter format
- Include medication list if mentioned in the note
- Include follow-up recommendations`;

      const resp = await apiClient.post<{ result: string }>('llm/clinical-ai', {
        action: 'letter',
        data: prompt,
        patientId,
        enhance: true,
      });
      setGeneratedLetter(resp.result);
    } catch (err: unknown) {
      setError(getNotesErrorMessage(err, 'Failed to generate letter. Ensure the AI service is running.'));
    } finally {
      setGenerating(false);
    }
  };

  const handleSave = async () => {
    if (!generatedLetter.trim()) return;
    setSaving(true);
    try {
      const typeLabel = LETTER_TYPES.find(t => t.value === letterType)?.label ?? letterType;
      // Save as correspondence letter
      await apiClient.post('correspondence/letters', {
        patientId,
        clinicalNoteId: note.id,
        episodeId: note.episodeId ?? undefined,
        letterType,
        subject: `${typeLabel} — ${note.title}`,
        body: generatedLetter,
        recipientName: recipientName || undefined,
        recipientAddress: recipientAddress || undefined,
        status: 'draft',
      });
      onSaved();
    } catch (err: unknown) {
      setError(getNotesErrorMessage(err, 'Failed to save letter'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ fontWeight: 700, fontFamily: 'Albert Sans, sans-serif', display: 'flex', alignItems: 'center', gap: 1 }}>
        <MailOutlineIcon sx={{ color: '#327C8D' }} />
        Generate Letter from Note
      </DialogTitle>
      <Divider />
      <DialogContent>
        {/* Source note info */}
        <Paper variant="outlined" sx={{ p: 1.5, mb: 2, bgcolor: '#F5F9FA', borderLeft: '4px solid #327C8D' }}>
          <Typography variant="caption" fontWeight={700} color="#327C8D">Source Note</Typography>
          <Typography variant="body2" fontWeight={600}>{note.title}</Typography>
          <Typography variant="caption" color="text.secondary">
            {note.noteType} — {note.authorName} — {new Date(note.createdAt).toLocaleDateString('en-AU')}
            {' — '}<Chip label={note.status} size="small" color={note.status === 'signed' ? 'success' : 'warning'} sx={{ fontSize: 9, height: 18 }} />
          </Typography>
        </Paper>

        <Grid container spacing={2}>
          <Grid size={{ xs: 12, sm: 6 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Letter Type</InputLabel>
              <Select value={letterType} onChange={e => setLetterType(e.target.value)} label="Letter Type">
                {LETTER_TYPES.map(lt => (
                  <MenuItem key={lt.value} value={lt.value}>
                    <Box>
                      <Typography variant="body2" sx={{ fontSize: 12 }}>{lt.label}</Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>{lt.desc}</Typography>
                    </Box>
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField label="Recipient Name" size="small" fullWidth value={recipientName} onChange={e => setRecipientName(e.target.value)}
              placeholder="e.g. Dr Sarah Chen, Centrelink, NDIS" />
          </Grid>
          <Grid size={{ xs: 12 }}>
            <TextField label="Recipient Address (optional)" size="small" fullWidth value={recipientAddress} onChange={e => setRecipientAddress(e.target.value)}
              placeholder="e.g. 123 Main St, Melbourne VIC 3000" />
          </Grid>
          {letterType === 'custom' && (
            <Grid size={{ xs: 12 }}>
              <TextField label="Custom Instructions" size="small" fullWidth multiline rows={2} value={customInstructions} onChange={e => setCustomInstructions(e.target.value)}
                placeholder="e.g. Focus on medication changes, include functional assessment..." />
            </Grid>
          )}
        </Grid>

        {!generatedLetter && (
          <Box sx={{ mt: 2, textAlign: 'center' }}>
            <Button variant="contained" onClick={handleGenerate} disabled={generating}
              startIcon={generating ? <CircularProgress size={16} sx={{ color: '#fff' }} /> : <SendIcon />}
              sx={{ bgcolor: '#327C8D', '&:hover': { bgcolor: '#265F6B' }, textTransform: 'none' }}>
              {generating ? 'Generating with AI...' : 'Generate Letter'}
            </Button>
            {generating && <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>This may take 15-30 seconds...</Typography>}
          </Box>
        )}

        {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}

        {generatedLetter && (
          <Box sx={{ mt: 2 }}>
            <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>Generated Letter — Review and Edit</Typography>
            <TextField fullWidth multiline rows={16} value={generatedLetter} onChange={e => setGeneratedLetter(e.target.value)}
              sx={{ '& .MuiInputBase-input': { fontFamily: 'monospace', fontSize: 12, lineHeight: 1.6 } }} />
          </Box>
        )}
      </DialogContent>
      <Divider />
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} sx={{ textTransform: 'none' }}>Cancel</Button>
        {generatedLetter && (
          <>
            <Button variant="outlined" onClick={() => setGeneratedLetter('')} sx={{ textTransform: 'none' }}>Regenerate</Button>
            <Button variant="contained" onClick={handleSave} disabled={saving}
              sx={{ bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' }, textTransform: 'none' }}>
              {saving ? 'Saving...' : 'Save as Draft Letter'}
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}
