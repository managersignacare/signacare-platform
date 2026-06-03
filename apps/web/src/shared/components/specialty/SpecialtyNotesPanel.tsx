// apps/web/src/shared/components/specialty/SpecialtyNotesPanel.tsx
//
// Reusable Clinical Notes panel embedded inside specialty tabs
// (Internal Medicine, Endocrinology, …). Lists the patient's most
// recent clinical notes and exposes a "Write Note" button that opens
// the existing AddNoteDialog with a specialty-aware default header.
//
// Each specialty tab renders this as one of its sub-tabs so the
// "Write Note" affordance lives in a predictable place across
// modules — per the user's request:
//   "in each specialty tab allow for notes writing and tabs specific
//    to that speciality"
import NoteAddIcon from '@mui/icons-material/NoteAdd'
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  Paper,
  Stack,
  Typography,
} from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { apiClient } from '../../services/apiClient'
import { sharedSpecialtyKeys } from '../../queryKeys'
import { AddNoteDialog } from '../../../features/patients/components/notes/AddNoteDialog'

interface NoteRow {
  id: string
  patientId: string
  episodeId: string | null
  episodeTitle: string | null
  episodeType: string | null
  authorId: string | null
  authorName: string | null
  title: string | null
  noteType: string
  noteDateTime: string
  content: string | null
  status: string
  signedByName: string | null
  signedAt: string | null
  createdAt: string
  updatedAt: string
}

interface Props {
  patientId: string
  /** Specialty display label used in the panel header and dialog prefill. */
  specialtyLabel: string
  /** Note-type filter for the list. Default 'progress'. */
  noteType?: string
  /** How many notes to display. Default 20. */
  limit?: number
  /** Optional content prefill for the Write Note dialog. */
  notePrefill?: string
}

function snippet(content: string | null): string {
  if (!content) return ''
  const oneLine = content.replace(/\s+/g, ' ').trim()
  return oneLine.length > 200 ? `${oneLine.slice(0, 200)}…` : oneLine
}

export function SpecialtyNotesPanel({
  patientId,
  specialtyLabel,
  noteType = 'progress',
  limit = 20,
  notePrefill,
}: Props) {
  const [dialogOpen, setDialogOpen] = useState(false)

  const { data, isLoading, isError } = useQuery<{ notes: NoteRow[] }>({
    queryKey: sharedSpecialtyKeys.patientNotes(patientId, { noteType }),
    queryFn: () =>
      apiClient.get<{ notes: NoteRow[] }>(`patients/${patientId}/notes`, { type: noteType }),
    staleTime: 30_000,
    enabled: !!patientId,
  })

  const notes = (data?.notes ?? []).slice(0, limit)
  const defaultPrefill = notePrefill ?? `${specialtyLabel} review\n\n`

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Box>
          <Typography variant="subtitle1" fontWeight={700} fontFamily="Albert Sans, sans-serif">
            Clinical Notes
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Recent {specialtyLabel.toLowerCase()} notes for this patient. Use Write Note to add an
            entry through the standard signing + audit flow.
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<NoteAddIcon />}
          onClick={() => setDialogOpen(true)}
          sx={{ bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' } }}
        >
          Write Note
        </Button>
      </Box>

      {isLoading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress size={24} />
        </Box>
      )}

      {isError && (
        <Typography variant="body2" color="error">Failed to load notes.</Typography>
      )}

      {!isLoading && !isError && notes.length === 0 && (
        <Paper variant="outlined" sx={{ p: 3, textAlign: 'center' }}>
          <Typography variant="body2" color="text.secondary">
            No notes recorded for this patient yet. Click Write Note to add one.
          </Typography>
        </Paper>
      )}

      {!isLoading && !isError && notes.length > 0 && (
        <Stack spacing={1.5}>
          {notes.map((n) => (
            <Paper key={n.id} variant="outlined" sx={{ p: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Chip size="small" label={n.noteType} />
                  <Typography variant="body2" fontWeight={600}>
                    {n.title || '(untitled)'}
                  </Typography>
                </Box>
                <Typography variant="caption" color="text.secondary">
                  {new Date(n.createdAt).toLocaleString('en-AU')}
                </Typography>
              </Box>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                {n.authorName || 'Unknown author'}
                {n.status === 'signed' && n.signedByName ? ` · signed by ${n.signedByName}` : ''}
              </Typography>
              {n.content && (
                <>
                  <Divider sx={{ my: 1 }} />
                  <Typography variant="body2" color="text.secondary">
                    {snippet(n.content)}
                  </Typography>
                </>
              )}
            </Paper>
          ))}
        </Stack>
      )}

      <AddNoteDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        patientId={patientId}
        noteType={noteType}
        defaultContent={defaultPrefill}
      />
    </Box>
  )
}

export default SpecialtyNotesPanel
