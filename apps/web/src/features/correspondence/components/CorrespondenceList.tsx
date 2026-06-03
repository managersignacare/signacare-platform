import React, { useState } from 'react';
import {
  Box,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Chip,
  Button,
  TextField,
  MenuItem,
  IconButton,
  Tooltip,
  CircularProgress,
  Alert,
  Link,
} from '@mui/material';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import { useLetters, useDeleteLetter } from '../hooks/useCorrespondence';
import type { LetterResponse, LetterStatus } from '../types/correspondenceTypes';

type ChipColor = 'default' | 'info' | 'success' | 'error' | 'warning';
const STATUS_COLOR: Record<LetterStatus, ChipColor> = {
  draft: 'default',
  sent: 'success',
  cancelled: 'warning',
};

interface Props {
  patientId?: string;
  episodeId?: string;
  onViewLetter: (id: string) => void;
  onNewLetter: () => void;
}

export const CorrespondenceList: React.FC<Props> = ({
  patientId,
  episodeId,
  onViewLetter,
  onNewLetter,
}) => {
  const [statusFilter, setStatusFilter] = useState('');
  const { data: letters, isLoading, isError } = useLetters({
    patientId,
    episodeId,
    status: statusFilter || undefined,
  });
  const deleteMutation = useDeleteLetter();

  if (isLoading) return <CircularProgress role="progressbar" aria-label="Loading" size={24} />;
  if (isError)
    return <Alert role="alert" severity="error">Failed to load correspondence.</Alert>;

  return (
    <Box>
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          mb: 2,
          gap: 2,
          flexWrap: 'wrap',
        }}
      >
        <Typography variant="h6">Correspondence</Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <TextField
            select
            size="small"
            label="Status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            sx={{ minWidth: 120 }}
          >
            <MenuItem value="">All</MenuItem>
            {(['draft', 'ready', 'sent', 'failed'] as const).map((s) => (
              <MenuItem key={s} value={s}>{s}</MenuItem>
            ))}
          </TextField>
          <Button variant="contained" size="small" onClick={onNewLetter}>
            New Letter
          </Button>
        </Box>
      </Box>

      {!letters || letters.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          No correspondence found.
        </Typography>
      ) : (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Subject</TableCell>
              <TableCell>Recipient</TableCell>
              <TableCell>Type</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Date</TableCell>
              <TableCell align="center">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {letters.map((letter: LetterResponse) => (
              <TableRow key={letter.id} hover>
                <TableCell>
                  <Link
                    component="button"
                    type="button"
                    variant="body2"
                    underline="hover"
                    sx={{ textAlign: 'left', color: 'primary.main' }}
                    onClick={() => onViewLetter(letter.id)}
                    aria-label={`View letter: ${letter.subject}`}
                  >
                    {letter.subject}
                  </Link>
                </TableCell>
                <TableCell>{letter.recipientName}</TableCell>
                <TableCell>
                  <Chip
                    label={letter.letterType.replace(/_/g, ' ')}
                    size="small"
                    variant="outlined"
                  />
                </TableCell>
                <TableCell>
                  <Chip
                    label={letter.status}
                    size="small"
                    color={STATUS_COLOR[letter.status]}
                  />
                </TableCell>
                <TableCell>{letter.createdAt.split('T')[0]}</TableCell>
                <TableCell align="center">
                  <Tooltip title="Edit">
                    <IconButton
                      size="small"
                      onClick={() => onViewLetter(letter.id)}
                      disabled={letter.status === 'sent'}
                    >
                      <EditOutlinedIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  {letter.status === 'draft' && (
                    <Tooltip title="Delete">
                      <IconButton
                        size="small"
                        onClick={() => deleteMutation.mutate(letter.id)}
                        disabled={deleteMutation.isPending}
                      >
                        <DeleteOutlineIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Box>
  );
};
