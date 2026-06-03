import {
  Box, Card, CardContent, Chip, Typography, IconButton, Tooltip,
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import LockIcon from '@mui/icons-material/Lock';
import SmartToyOutlinedIcon from '@mui/icons-material/SmartToyOutlined';
import type { NoteResponse } from '../types/noteTypes';

interface Props {
  note:      NoteResponse;
  selected?: boolean;
  onSelect:  (note: NoteResponse) => void;
  onAmend?:  (note: NoteResponse) => void;
}

const STATUS_COLOR: Record<string, 'default' | 'success' | 'warning'> = {
  draft:   'warning',
  signed:  'success',
  amended: 'default',
};

export const NoteCard: React.FC<Props> = ({ note, selected = false, onSelect, onAmend }) => {
  const preview = (note.soapSubjective ?? note.content.replace(/<[^>]+>/g, ''))
    .trim()
    .slice(0, 120);

  // BUG-447-clinical-notes-scribe: keyboard-operable note-selector card.
  // Shape B (always-interactive trio). aria-label names the date + note
  // type + author for assistive-tech parity with sighted clinicians.
  // The inner amend IconButton stays focusable separately and uses
  // e.stopPropagation() to keep its click from bubbling.
  const select = () => onSelect(note);
  return (
    <Card
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`Open ${note.noteType} note from ${new Date(note.noteDateTime).toLocaleDateString('en-AU')} by ${note.authorName}`}
      onClick={select}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(); } }}
      elevation={selected ? 3 : 0}
      sx={{
        cursor: 'pointer',
        border: '1px solid',
        borderColor: selected ? '#327C8D' : 'divider',
        borderRadius: 2,
        backgroundColor: selected ? '#EAF4F6' : '#FFFFFF',
        transition: 'border-color 0.15s, background-color 0.15s',
        '&:hover': { borderColor: '#327C8D' },
        '&:focus-visible': { outline: '2px solid #327C8D', outlineOffset: 2 },
      }}
    >
      <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ fontFamily: 'Albert Sans, sans-serif' }}
            >
              {new Date(note.noteDateTime).toLocaleDateString('en-AU', {
                day: '2-digit', month: 'short', year: 'numeric',
              })}
            </Typography>
            <Typography
              variant="subtitle2"
              fontWeight={700}
              sx={{ color: '#3D484B', fontFamily: 'Albert Sans, sans-serif', display: 'flex', alignItems: 'center', gap: 0.5 }}
            >
              {note.noteType.toUpperCase()}
              {note.isAiDraft && (
                <SmartToyOutlinedIcon sx={{ fontSize: 14, color: '#F0852C' }} />
              )}
            </Typography>
            <Typography variant="caption" color="text.secondary" noWrap sx={{ fontFamily: 'Albert Sans, sans-serif' }}>
              {note.authorName}
            </Typography>
          </Box>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, ml: 0.5, flexShrink: 0 }}>
            <Chip
              label={note.status}
              size="small"
              color={STATUS_COLOR[note.status]}
              variant="outlined"
              sx={{ fontFamily: 'Albert Sans, sans-serif' }}
            />
            {note.status === 'signed' && onAmend && (
              <Tooltip title="Amend note">
                <IconButton
                  size="small"
                  onClick={(e) => { e.stopPropagation(); onAmend(note); }}
                >
                  <EditIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
            {note.status === 'signed' && (
              <LockIcon sx={{ fontSize: 14, color: '#4E9C82' }} />
            )}
          </Box>
        </Box>

        {preview && (
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{
              mt: 0.75,
              fontFamily: 'Albert Sans, sans-serif',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {preview}{preview.length >= 120 ? '…' : ''}
          </Typography>
        )}
      </CardContent>
    </Card>
  );
};
