import React, { useState } from 'react';
import {
  Box, Typography, Chip, Button, TextField, InputAdornment,
  CircularProgress, Alert, FormControl, InputLabel, Select,
  MenuItem, Paper, Divider, Tooltip, type SelectChangeEvent,
} from '@mui/material';
import AddIcon          from '@mui/icons-material/Add';
import SearchIcon       from '@mui/icons-material/Search';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import CheckCircleIcon  from '@mui/icons-material/CheckCircle';
import {
  useEscalations,
  useAcknowledgeEscalation,
} from '../hooks/useEscalations';
import { unstyledButtonSx } from '../../../shared/styles/unstyledButton';
import { EscalationTimeline } from './EscalationTimeline';
import type {
  EscalationResponse,
  EscalationStatus,
  EscalationPriority,
} from '../types/escalationTypes';

const PRIORITY_STYLE: Record<EscalationPriority, { bg: string; color: string }> = {
  routine:   { bg: '#E8F5E9', color: '#4E9C82' },
  urgent:    { bg: '#FFF3E0', color: '#F0852C' },
  emergency: { bg: '#FFEBEE', color: '#D32F2F' },
};

const STATUS_CHIP_COLOR: Record<
  EscalationStatus,
  'default' | 'warning' | 'info' | 'success' | 'error'
> = {
  open:        'error',
  in_progress: 'info',
  resolved:    'success',
  closed:      'default',
  reopened:    'warning',
};

interface Props {
  patientId?:   string;
  episodeId?:   string;
  onNew?:       () => void;
  onSelect?:    (esc: EscalationResponse) => void;
}

export const EscalationList: React.FC<Props> = ({
  patientId, episodeId, onNew, onSelect,
}) => {
  const [search,   setSearch]   = useState('');
  const [statusF,  setStatusF]  = useState<EscalationStatus | 'all'>('all');
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data, isLoading, isError } = useEscalations(
    patientId ?? '',
    episodeId,
  );

  const { mutate: acknowledge, isPending: isAcknowledging } = useAcknowledgeEscalation(patientId ?? '');

  const filtered = (data ?? []).filter((e: EscalationResponse) => {
    const q = search.toLowerCase();
    const matchesSearch = (
      e.raisedByName.toLowerCase().includes(q) ||
      e.isbar.situation.toLowerCase().includes(q)
    );
    const matchesStatus = statusF === 'all' || e.status === statusF;
    return matchesSearch && matchesStatus;
  });

  return (
    <Box>
      {/* Toolbar */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          mb: 2,
          flexWrap: 'wrap',
        }}
      >
        <Typography
          variant="h6"
          fontWeight={700}
          sx={{ color: '#3D484B', fontFamily: 'Albert Sans, sans-serif', mr: 'auto' }}
        >
          Escalations
        </Typography>

        <TextField
          size="small"
          placeholder="Search…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          sx={{ width: 220, '& input': { fontFamily: 'Albert Sans, sans-serif' } }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" sx={{ color: '#aaa' }} />
              </InputAdornment>
            ),
          }}
        />

        <FormControl size="small" sx={{ minWidth: 140 }}>
          <InputLabel sx={{ fontFamily: 'Albert Sans, sans-serif' }}>Status</InputLabel>
          <Select
            value={statusF}
            label="Status"
            onChange={(e: SelectChangeEvent) =>
              setStatusF(e.target.value as EscalationStatus | 'all')
            }
            sx={{ fontFamily: 'Albert Sans, sans-serif' }}
          >
            <MenuItem value="all">All</MenuItem>
            <MenuItem value="open">Open</MenuItem>
            <MenuItem value="in_progress">In Progress</MenuItem>
            <MenuItem value="resolved">Resolved</MenuItem>
            <MenuItem value="closed">Closed</MenuItem>
            <MenuItem value="reopened">Reopened</MenuItem>
          </Select>
        </FormControl>

        {onNew && (
          <Button
            size="small"
            variant="contained"
            startIcon={<AddIcon />}
            onClick={onNew}
            sx={{ backgroundColor: '#327C8D', fontFamily: 'Albert Sans, sans-serif' }}
          >
            New Escalation
          </Button>
        )}
      </Box>

      {isLoading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}>
          <CircularProgress role="progressbar" aria-label="Loading" size={24} sx={{ color: '#327C8D' }} />
        </Box>
      )}

      {isError && (
        <Alert role="alert" severity="error">Failed to load escalations.</Alert>
      )}

      {!isLoading && !isError && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          {filtered.map((esc: EscalationResponse) => {
            const style = PRIORITY_STYLE[esc.priority];
            const isExpanded = expanded === esc.id;

            return (
              <Paper
                key={esc.id}
                variant="outlined"
                sx={{
                  p: 1.5,
                  borderRadius: 2,
                  borderColor: isExpanded ? '#327C8D' : 'divider',
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                  {/* Shape B′ inner trigger — sub-region (icon + summary) is the
                      keyboard-accessible toggle; the Acknowledge Button on the
                      right is sibling, so its previous defensive
                      `e.stopPropagation()` is structurally unnecessary AND has
                      been REMOVED. Per §2.5 decision tree branch 4: nested
                      keyboard-accessible primitive (`<Button>Acknowledge`)
                      with semantically-distinct outer action (expand toggle)
                      → Shape B′ canonical inner trigger. */}
                  <Box
                    component="button"
                    type="button"
                    aria-expanded={isExpanded}
                    aria-label={`${esc.priority.toUpperCase()} priority escalation from ${esc.raisedByName} — ${isExpanded ? 'collapse' : 'expand'}`}
                    onClick={() => {
                      setExpanded(isExpanded ? null : esc.id);
                      onSelect?.(esc);
                    }}
                    sx={{
                      flex: 1,
                      ...unstyledButtonSx,
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 1,
                      borderRadius: 1,
                      '&:focus-visible': { outline: '2px solid #327C8D', outlineOffset: 2 },
                    }}
                  >
                    <Box
                      sx={{
                        width: 40,
                        height: 40,
                        borderRadius: '50%',
                        backgroundColor: style.bg,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      <WarningAmberIcon sx={{ color: style.color }} />
                    </Box>

                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.25 }}>
                        <Typography
                          variant="subtitle2"
                          fontWeight={700}
                          sx={{ fontFamily: 'Albert Sans, sans-serif', color: '#3D484B' }}
                        >
                          {esc.raisedByName}
                        </Typography>
                        <Chip
                          size="small"
                          label={esc.priority.toUpperCase()}
                          sx={{
                            backgroundColor: style.bg,
                            color: style.color,
                            fontFamily: 'Albert Sans, sans-serif',
                            height: 22,
                          }}
                        />
                        <Chip
                          size="small"
                          label={esc.status.replace('_', ' ')}
                          color={STATUS_CHIP_COLOR[esc.status]}
                          variant="outlined"
                          sx={{ fontFamily: 'Albert Sans, sans-serif', height: 22 }}
                        />
                      </Box>

                      <Typography
                        variant="body2"
                        sx={{
                          fontFamily: 'Albert Sans, sans-serif',
                          color: 'text.secondary',
                          display: '-webkit-box',
                          WebkitLineClamp: isExpanded ? 'none' : 2,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                        }}
                      >
                        {esc.isbar.situation}
                      </Typography>

                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
                        <Typography variant="caption" sx={{ fontFamily: 'Albert Sans, sans-serif', color: 'text.secondary' }}>
                          Raised by {esc.raisedByName}
                        </Typography>
                        <Typography variant="caption" sx={{ fontFamily: 'Albert Sans, sans-serif', color: 'text.secondary' }}>
                          · {esc.createdAt ? new Date(esc.createdAt).toLocaleString('en-AU') : '—'}
                        </Typography>
                        <Typography variant="caption" sx={{ fontFamily: 'Albert Sans, sans-serif', color: 'text.secondary' }}>
                          · Team: {esc.assignedTeam}
                        </Typography>
                      </Box>
                    </Box>
                  </Box>

                  {esc.status === 'open' && (
                    <Tooltip title="Acknowledge">
                      <span>
                        <Button
                          size="small"
                          variant="outlined"
                          startIcon={<CheckCircleIcon />}
                          disabled={isAcknowledging}
                          onClick={() => acknowledge(esc.id)}
                          sx={{
                            borderColor: '#4E9C82',
                            color: '#4E9C82',
                            fontFamily: 'Albert Sans, sans-serif',
                          }}
                        >
                          Acknowledge
                        </Button>
                      </span>
                    </Tooltip>
                  )}
                </Box>

                {isExpanded && (
                  <>
                    <Divider sx={{ my: 1 }} />
                    <EscalationTimeline escalation={esc} patientId={esc.patientId} />
                  </>
                )}
              </Paper>
            );
          })}

          {filtered.length === 0 && (
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ textAlign: 'center', mt: 4, fontFamily: 'Albert Sans, sans-serif' }}
            >
              No escalations found.
            </Typography>
          )}
        </Box>
      )}
    </Box>
  );
};
