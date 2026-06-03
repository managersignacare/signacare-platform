// NOTE: Source in the spec was truncated; this file is incomplete.
import React, { useState } from 'react';
import {
  Box,
  Typography,
  Paper,
  Chip,
  Divider,
  Button,
  TextField,
  CircularProgress,
  Stack,
  Alert,
} from '@mui/material';
import {
  Timeline,
  TimelineItem,
  TimelineSeparator,
  TimelineConnector,
  TimelineContent,
  TimelineDot,
  TimelineOppositeContent,
} from '@mui/lab';
import AddCommentOutlinedIcon from '@mui/icons-material/AddCommentOutlined';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import LockIcon from '@mui/icons-material/Lock';
import { useResolveEscalation, useAddEscalationNote } from '../hooks/useEscalations';
import type { Escalation, EscalationEventType, EscalationEventResponse } from '../types/escalationTypes';

const EVENT_META: Record<EscalationEventType, { label: string; color: 'grey' | 'primary' | 'success' | 'warning' | 'error' }> = {
  created:      { label: 'Escalation raised',   color: 'error'   },
  acknowledged: { label: 'Acknowledged',         color: 'warning' },
  updated:      { label: 'Updated',              color: 'grey'    },
  note_added:   { label: 'Note added',           color: 'primary' },
  team_changed: { label: 'Team changed',         color: 'grey'    },
  resolved:     { label: 'Resolved',             color: 'success' },
  closed:       { label: 'Closed',               color: 'grey'    },
  reopened:     { label: 'Reopened',             color: 'warning' },
  in_progress:  { label: 'In Progress',          color: 'primary' },
};

interface EscalationTimelineProps {
  escalation: Escalation;
  patientId: string;
}

export const EscalationTimeline: React.FC<EscalationTimelineProps> = ({
  escalation,
  patientId,
}) => {
  const [noteText, setNoteText] = useState('');
  const [resolveNote, setResolveNote] = useState('');
  const [showResolve, setShowResolve] = useState(false);

  const addNote   = useAddEscalationNote(patientId);
  const resolve   = useResolveEscalation(patientId);

  const handleAddNote = async () => {
    if (!noteText.trim()) return;
    // BUG-PR-R1-12-FIX-S1-escalations — echo lockVersion from cached
    // escalation. On 409 the hook's onError invalidates + surfaces toast.
    await addNote.mutateAsync({
      id: escalation.id,
      notes: noteText.trim(),
      expectedLockVersion: escalation.lockVersion,
    });
    setNoteText('');
  };

  const handleResolve = async () => {
    await resolve.mutateAsync({
      id: escalation.id,
      notes: resolveNote.trim(),
      expectedLockVersion: escalation.lockVersion,
    });
    setShowResolve(false);
    setResolveNote('');
  };

  const isTerminal = escalation.status === 'resolved' || escalation.status === 'closed';

  return (
    <Paper
      elevation={0}
      sx={{
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 2,
        p: 2.5,
        backgroundColor: '#FFFFFF',
      }}
    >
      {/* Header */}
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" mb={2}>
        <Box>
          <Typography
            variant="subtitle1"
            fontWeight={700}
            sx={{ color: '#3D484B', fontFamily: 'Albert Sans, sans-serif' }}
          >
            Escalation — {escalation.assignedTeam}
          </Typography>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ fontFamily: 'Albert Sans, sans-serif' }}
          >
            Raised by {escalation.raisedByName} on{' '}
            {escalation.createdAt ? new Date(escalation.createdAt).toLocaleDateString('en-AU', {
              day: 'numeric', month: 'long', year: 'numeric',
            }) : '—'}
          </Typography>
        </Box>
        <Chip
          label={escalation.status.replace('_', ' ')}
          size="small"
          color={
            escalation.status === 'resolved' || escalation.status === 'closed'
              ? 'success'
              : escalation.status === 'open'
              ? 'error'
              : 'warning'
          }
          variant="outlined"
          sx={{ fontFamily: 'Albert Sans, sans-serif', textTransform: 'capitalize' }}
        />
      </Stack>

      {/* ISBAR summary */}
      <Box
        sx={{
          backgroundColor: '#FBF8F5',
          borderRadius: 1.5,
          p: 2,
          mb: 2,
          display: 'flex',
          flexDirection: 'column',
          gap: 1.5,
        }}
      >
        {([
          ['S — Situation',      escalation.isbar.situation],
          ['B — Background',     escalation.isbar.background],
          ['A — Assessment',     escalation.isbar.assessment],
          ['R — Recommendation', escalation.isbar.recommendation],
        ] as [string, string][]).map(([label, value]) => (
          <Box key={label}>
            <Typography
              variant="overline"
              sx={{ color: '#327C8D', fontWeight: 700, fontFamily: 'Albert Sans, sans-serif' }}
            >
              {label}
            </Typography>
            <Typography
              variant="body2"
              sx={{ whiteSpace: 'pre-wrap', fontFamily: 'Albert Sans, sans-serif' }}
            >
              {value}
            </Typography>
          </Box>
        ))}
      </Box>

      <Divider sx={{ mb: 1 }} />

      {/* Timeline events */}
      <Timeline sx={{ p: 0, m: 0 }}>
        {escalation.events.map((event: EscalationEventResponse, idx: number) => {
          const meta = EVENT_META[event.eventType as EscalationEventType];
          return (
            <TimelineItem key={event.id}>
              <TimelineOppositeContent
                sx={{
                  flex: 0.25,
                  fontFamily: 'Albert Sans, sans-serif',
                  fontSize: 11,
                  color: 'text.secondary',
                  pt: 1.5,
                }}
              >
                {event.createdAt ? new Date(event.createdAt).toLocaleTimeString('en-AU', {
                  hour: '2-digit', minute: '2-digit',
                }) : '—'}
                <br />
                {event.createdAt ? new Date(event.createdAt).toLocaleDateString('en-AU', {
                  day: '2-digit', month: 'short',
                }) : '—'}
              </TimelineOppositeContent>
              <TimelineSeparator>
                <TimelineDot color={meta.color} variant="outlined" sx={{ my: 1 }} />
                {idx < escalation.events.length - 1 && <TimelineConnector />}
              </TimelineSeparator>
              <TimelineContent sx={{ pb: 2 }}>
                <Typography
                  variant="body2"
                  fontWeight={600}
                  sx={{ fontFamily: 'Albert Sans, sans-serif', color: '#3D484B' }}
                >
                  {meta.label}
                </Typography>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ fontFamily: 'Albert Sans, sans-serif' }}
                >
                  {event.actorName}
                </Typography>
                {event.notes && (
                  <Typography
                    variant="body2"
                    sx={{
                      mt: 0.5,
                      p: 1,
                      backgroundColor: '#F5F5F5',
                      borderRadius: 1,
                      fontFamily: 'Albert Sans, sans-serif',
                      whiteSpace: 'pre-wrap',
                    }}
                  >
                    {event.notes}
                  </Typography>
                )}
              </TimelineContent>
            </TimelineItem>
          );
        })}
      </Timeline>

      {/* Actions */}
      {!isTerminal && (
        <Box sx={{ mt: 2 }}>
          <Divider sx={{ mb: 2 }} />

          {/* Add note */}
          <Stack direction="row" spacing={1} alignItems="flex-start" mb={2}>
            <TextField
              size="small"
              fullWidth
              multiline
              minRows={2}
              placeholder="Add a progress note to this escalation…"
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              inputProps={{ style: { fontFamily: 'Albert Sans, sans-serif' } }}
              sx={{
                '& .MuiOutlinedInput-root.Mui-focused .MuiOutlinedInput-notchedOutline': {
                  borderColor: '#327C8D',
                },
              }}
            />
            <Button
              variant="outlined"
              size="small"
              onClick={handleAddNote}
              disabled={!noteText.trim() || addNote.isPending}
              startIcon={
                addNote.isPending
                  ? <CircularProgress role="progressbar" aria-label="Loading" size={14} />
                  : <AddCommentOutlinedIcon />
              }
              sx={{
                borderColor: '#327C8D',
                color: '#327C8D',
                fontFamily: 'Albert Sans, sans-serif',
                whiteSpace: 'nowrap',
              }}
            >
              Add Note
            </Button>
          </Stack>

          {/* Resolve */}
          {!showResolve ? (
            <Button
              variant="contained"
              size="small"
              startIcon={<CheckCircleOutlineIcon />}
              onClick={() => setShowResolve(true)}
              sx={{
                backgroundColor: '#4E9C82',
                fontFamily: 'Albert Sans, sans-serif',
                textTransform: 'none',
                '&:hover': { backgroundColor: '#3d7d68' },
              }}
            >
              Mark Resolved
            </Button>
          ) : (
            <Box
              sx={{
                p: 2,
                border: '1px solid #4E9C82',
                borderRadius: 2,
                backgroundColor: '#F0FAF7',
              }}
            >
              <Typography
                variant="subtitle2"
                fontWeight={700}
                sx={{ fontFamily: 'Albert Sans, sans-serif', color: '#3D484B', mb: 1 }}
              >
                Resolution Note
              </Typography>
              <TextField
                size="small"
                fullWidth
                multiline
                minRows={3}
                placeholder="Describe the outcome and any actions taken…"
                value={resolveNote}
                onChange={(e) => setResolveNote(e.target.value)}
                inputProps={{ style: { fontFamily: 'Albert Sans, sans-serif' } }}
                sx={{ mb: 1.5 }}
              />
              <Stack direction="row" spacing={1}>
                <Button
                  size="small"
                  onClick={() => { setShowResolve(false); setResolveNote(''); }}
                  color="inherit"
                  sx={{ fontFamily: 'Albert Sans, sans-serif' }}
                >
                  Cancel
                </Button>
                <Button
                  size="small"
                  variant="contained"
                  onClick={handleResolve}
                  disabled={resolve.isPending}
                  startIcon={
                    resolve.isPending
                      ? <CircularProgress role="progressbar" aria-label="Loading" size={14} color="inherit" />
                      : <CheckCircleOutlineIcon />
                  }
                  sx={{
                    backgroundColor: '#4E9C82',
                    fontFamily: 'Albert Sans, sans-serif',
                    '&:hover': { backgroundColor: '#3d7d68' },
                  }}
                >
                  {resolve.isPending ? 'Resolving…' : 'Confirm Resolved'}
                </Button>
              </Stack>
              {Boolean(resolve.error) && (
                <Alert role="alert" severity="error" sx={{ mt: 1 }}>
                  Failed to resolve. Please try again.
                </Alert>
              )}
            </Box>
          )}
        </Box>
      )}

      {isTerminal && (
        <Box sx={{ mt: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
          <LockIcon sx={{ fontSize: 16, color: '#4E9C82' }} />
          <Typography
            variant="caption"
            sx={{ color: '#4E9C82', fontFamily: 'Albert Sans, sans-serif' }}
          >
            This escalation is {escalation.status} and locked for editing.
          </Typography>
        </Box>
      )}
    </Paper>
  );
};
