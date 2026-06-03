// apps/web/src/features/voice/components/VoiceCallLog.tsx
import { useState } from 'react';
import {
  Box, Paper, Typography, Table, TableHead, TableRow, TableCell,
  TableBody, TableContainer, Chip, IconButton, Tooltip, Alert, CircularProgress,
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField,
  Switch, FormControlLabel, Divider,
} from '@mui/material';
import TranscriptIcon from '@mui/icons-material/Article';
import NoteAddIcon from '@mui/icons-material/NoteAdd';
import PhoneInTalkIcon from '@mui/icons-material/PhoneInTalk';
import CallMadeIcon from '@mui/icons-material/CallMade';
import CallReceivedIcon from '@mui/icons-material/CallReceived';
import {
  useVoiceCalls,
  useVoiceTranscript,
  useRequestTranscript,
  useSetOptOut,
  useAddCallNote,
} from '../hooks/useVoiceCalls';
import type { VoiceCall, VoiceCallFilters } from '../types/voiceTypes';
import { format, parseISO } from 'date-fns';

interface Props {
  patientId: string;
  patientOptedOut?: boolean;
}

const STATUS_COLOUR: Record<
  string,
  'success' | 'error' | 'warning' | 'info' | 'default'
> = {
  completed: 'success',
  failed: 'error',
  no_answer: 'warning',
  in_progress: 'info',
  busy: 'warning',
  cancelled: 'default',
  ringing: 'info',
  queued: 'default',
};

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

interface TranscriptDialogProps { transcriptId: string | null;
  open: boolean;
  onClose: () => void; }
function TranscriptDialog({ transcriptId,
  open,
  onClose, }: TranscriptDialogProps) {
  const { data, isLoading, isError } = useVoiceTranscript(open ? transcriptId : null);

  return (
    <Dialog aria-labelledby="dialog-title" open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle id="dialog-title">Call Transcript</DialogTitle>
      <DialogContent>
        {isLoading && <CircularProgress role="progressbar" aria-label="Loading" />}
        {isError && <Alert role="alert" severity="error">Failed to load transcript.</Alert>}
        {data && (
          <Box>
            {data.aiSummary && (
              <Box mb={2} p={2} bgcolor="primary.50" borderRadius={1}>
                <Typography variant="subtitle2" gutterBottom>AI Summary</Typography>
                <Typography variant="body2">{data.aiSummary}</Typography>
              </Box>
            )}
            <Divider sx={{ mb: 2 }} />
            <Typography variant="caption" color="text.secondary" display="block" mb={1}>
              {data.segments.length} segments · {Math.round(data.durationMs / 1000)}s ·{' '}
              {data.language}
            </Typography>
            {data.segments.map((seg, idx) => (
              <Box
                key={idx}
                display="flex"
                gap={2}
                py={0.75}
                sx={{
                  borderLeft: 3,
                  borderColor:
                    seg.speaker === 'clinician' ? 'primary.main' : 'secondary.main',
                  pl: 1.5,
                  mb: 0.5,
                  bgcolor: 'background.paper',
                }}
              >
                <Box sx={{ minWidth: 80 }}>
                  <Typography
                    variant="caption"
                    fontWeight={600}
                    color={
                      seg.speaker === 'clinician' ? 'primary.main' : 'secondary.main'
                    }
                    textTransform="capitalize"
                  >
                    {seg.speaker}
                  </Typography>
                  <Typography variant="caption" display="block" color="text.secondary">
                    {Math.floor(seg.startMs / 1000)}s
                  </Typography>
                </Box>
                <Typography variant="body2">{seg.text}</Typography>
              </Box>
            ))}
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

interface NoteDialogProps { call: VoiceCall | null;
  open: boolean;
  onClose: () => void; }
function NoteDialog({ call,
  open,
  onClose, }: NoteDialogProps) {
  const [noteText, setNoteText] = useState(call?.notes ?? '');
  const addNote = useAddCallNote();

  const onSave = () => {
    if (!call) return;
    addNote.mutate({ callId: call.id, notes: noteText }, { onSuccess: onClose });
  };

  return (
    <Dialog aria-labelledby="dialog-title" open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle id="dialog-title">Add Note to Call</DialogTitle>
      <DialogContent>
        <TextField
          label="Notes"
          multiline
          rows={4}
          fullWidth
          value={noteText}
          onChange={e => setNoteText(e.target.value)}
          sx={{ mt: 1 }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={onSave} disabled={addNote.isPending}>
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export function VoiceCallLog({ patientId, patientOptedOut = false }: Props) {
  const [filters] = useState<VoiceCallFilters>({ patientId, limit: 50, offset: 0 });
  const [transcriptDialogId, setTranscriptDialogId] = useState<string | null>(null);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [noteCall, setNoteCall] = useState<VoiceCall | null>(null);
  const [optedOut, setOptedOut] = useState(patientOptedOut);

  const { data: calls = [], isLoading, isError } = useVoiceCalls(filters);
  const requestTranscript = useRequestTranscript();
  const setOptOut = useSetOptOut();

  const handleOptOutToggle = (checked: boolean) => {
    setOptedOut(checked);
    setOptOut.mutate({ patientId, optedOut: checked });
  };

  const handleOpenTranscript = (transcriptId: string) => {
    setTranscriptDialogId(transcriptId);
    setTranscriptOpen(true);
  };

  if (isLoading) return <CircularProgress role="progressbar" aria-label="Loading" />;
  if (isError) return <Alert role="alert" severity="error">Failed to load call history.</Alert>;

  return (
    <Box>
      {/* ── Header Controls ── */}
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
        <Typography variant="h6">
          <PhoneInTalkIcon fontSize="small" sx={{ mr: 1, verticalAlign: 'middle' }} />
          Voice Call Log
        </Typography>
        <FormControlLabel
          control={
            <Switch
              checked={optedOut}
              onChange={e => handleOptOutToggle(e.target.checked)}
              color="warning"
              size="small"
            />
          }
          label={
            <Typography
              variant="body2"
              color={optedOut ? 'warning.main' : 'text.secondary'}
            >
              {optedOut ? 'Patient opted out of recording' : 'Recording opt-out: Off'}
            </Typography>
          }
          labelPlacement="start"
        />
      </Box>

      {optedOut && (
        <Alert role="alert" severity="warning" sx={{ mb: 2 }}>
          This patient has opted out of call recording. Future calls will not be recorded
          or transcribed.
        </Alert>
      )}

      {calls.length === 0 ? (
        <Alert severity="info">No calls recorded for this patient.</Alert>
      ) : (
        <TableContainer role="region" aria-label="Data table" component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Date / Time</TableCell>
                <TableCell>Direction</TableCell>
                <TableCell>Staff</TableCell>
                <TableCell>Duration</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Transcript</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {calls.map(call => (
                <TableRow key={call.id} hover>
                  <TableCell>
                    {format(parseISO(call.startedAt), 'dd/MM/yyyy HH:mm')}
                  </TableCell>
                  <TableCell>
                    <Box display="flex" alignItems="center" gap={0.5}>
                      {call.direction === 'outbound' ? (
                        <CallMadeIcon fontSize="small" color="primary" />
                      ) : (
                        <CallReceivedIcon fontSize="small" color="secondary" />
                      )}
                      <Typography variant="body2" textTransform="capitalize">
                        {call.direction}
                      </Typography>
                    </Box>
                  </TableCell>
                  <TableCell>{call.staffName ?? '—'}</TableCell>
                  <TableCell>
                    {call.durationSeconds ? formatDuration(call.durationSeconds) : '—'}
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={call.status.replace('_', ' ')}
                      size="small"
                      color={STATUS_COLOUR[call.status]}
                    />
                  </TableCell>
                  <TableCell>
                    {call.transcriptStatus === 'completed' && call.transcriptId ? (
                      <Chip
                        label="Available"
                        size="small"
                        color="success"
                        onClick={() => handleOpenTranscript(call.transcriptId!)}
                        clickable
                      />
                    ) : call.transcriptStatus === 'processing' ? (
                      <Chip label="Processing" size="small" color="info" />
                    ) : call.transcriptStatus === 'pending' ? (
                      <Chip label="Pending" size="small" color="default" />
                    ) : (
                      <Chip
                        label={call.transcriptStatus}
                        size="small"
                        variant="outlined"
                      />
                    )}
                  </TableCell>
                  <TableCell align="right">
                    {call.status === 'completed' &&
                      call.transcriptStatus === 'unavailable' && (
                        <Tooltip title="Request Transcript">
                          <IconButton
                            size="small"
                            onClick={() => requestTranscript.mutate(call.id)}
                            disabled={requestTranscript.isPending}
                          >
                            <TranscriptIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                    <Tooltip title="Add Note">
                      <IconButton size="small" onClick={() => setNoteCall(call)}>
                        <NoteAddIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {/* ── Dialogs ── */}
      <TranscriptDialog
        transcriptId={transcriptDialogId}
        open={transcriptOpen}
        onClose={() => {
          setTranscriptOpen(false);
          setTranscriptDialogId(null);
        }}
      />
      <NoteDialog
        call={noteCall}
        open={Boolean(noteCall)}
        onClose={() => setNoteCall(null)}
      />
    </Box>
  );
}
