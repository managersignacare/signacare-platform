import { useState } from 'react';
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogContent,
  DialogTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';
import { Add, Vaccines } from '@mui/icons-material';
import { useLaiSchedules } from '../hooks/useLaiSchedules';
import LaiScheduleForm from './LaiScheduleForm';
import LaiGivenForm from './LaiGivenForm';
import type { LaiScheduleResponse } from '@signacare/shared';
import { ListExportBar } from '../../../shared/components/ui/ListExportBar';

interface Props {
  patientId: string;
}

export default function LaiScheduleList({ patientId }: Props) {
  const { data: schedules = [], isLoading } = useLaiSchedules(patientId);
  const [addOpen, setAddOpen] = useState(false);
  const [recordOpen, setRecordOpen] = useState<LaiScheduleResponse | null>(null);

  const today = new Date().toISOString().slice(0, 10);

  const getDueBg = (s: LaiScheduleResponse): string => {
    if (!s.nextDueDate) return 'transparent';
    if (s.daysOverdue !== null && s.daysOverdue >= 7) return '#FFEBEE'; // missed
    if (s.isOverdue) return '#FFF8F0'; // overdue
    const daysUntil = Math.ceil(
      (new Date(s.nextDueDate).getTime() - new Date(today).getTime()) / 86_400_000,
    );
    if (daysUntil <= 7) return '#FFF8F0'; // due soon
    return 'transparent';
  };

  const getDueChip = (s: LaiScheduleResponse) => {
    if (!s.nextDueDate) return null;
    if (s.daysOverdue !== null && s.daysOverdue >= 7) {
      return <Chip size="small" label={`${s.daysOverdue}d MISSED`} sx={{ bgcolor: '#D32F2F', color: '#fff', fontSize: 11 }} />;
    }
    if (s.isOverdue) {
      return <Chip size="small" label={`${s.daysOverdue}d OVERDUE`} sx={{ bgcolor: '#F0852C', color: '#fff', fontSize: 11 }} />;
    }
    const daysUntil = Math.ceil(
      (new Date(s.nextDueDate).getTime() - new Date(today).getTime()) / 86_400_000,
    );
    if (daysUntil <= 0) {
      return <Chip size="small" label="DUE TODAY" sx={{ bgcolor: '#F0852C', color: '#fff', fontSize: 11 }} />;
    }
    if (daysUntil <= 7) {
      return <Chip size="small" label={`Due in ${daysUntil}d`} sx={{ bgcolor: '#F0852C', color: '#fff', fontSize: 11 }} />;
    }
    return <Chip size="small" label={s.nextDueDate} sx={{ bgcolor: '#4E9C82', color: '#fff', fontSize: 11 }} />;
  };

  if (isLoading) return <Typography sx={{ p: 2 }}>Loading LAI schedules…</Typography>;

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
        <Typography variant="h6" fontWeight={600}>LAI Schedules</Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <ListExportBar compact title="LAI Schedules" subtitle={`${schedules.length} schedules`}
            columns={['Drug', 'Dose / Freq', 'Site', 'Last Given', 'Next Due', 'Status']}
            rows={schedules.map(s => [
              s.drugName, `${s.doseMg}mg every ${s.frequencyDays}d`, s.injectionSite ?? '',
              s.lastGivenDate ?? '—', s.nextDueDate ?? '—', s.status,
            ])} />
          <Button size="small" variant="contained" startIcon={<Add />}
            sx={{ bgcolor: '#327C8D' }} onClick={() => setAddOpen(true)}>
            New Schedule
          </Button>
        </Box>
      </Box>

      {schedules.length === 0 ? (
        <Typography color="text.secondary" sx={{ py: 2 }}>No LAI schedules recorded.</Typography>
      ) : (
        <Table size="small">
          <TableHead>
            <TableRow sx={{ bgcolor: '#F5F5F5' }}>
              {['Drug', 'Dose / Freq', 'Site', 'Last Given', 'Next Due', 'Status', 'Actions'].map((h) => (
                <TableCell key={h} sx={{ fontWeight: 600 }}>{h}</TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {schedules.map((s) => (
              <TableRow key={s.id} sx={{ bgcolor: getDueBg(s) }} hover>
                <TableCell>
                  <Typography variant="body2" fontWeight={600}>{s.drugName}</Typography>
                </TableCell>
                <TableCell>
                  <Typography variant="body2">{s.doseMg}</Typography>
                  <Typography variant="caption" color="text.secondary">every {s.frequencyDays}d</Typography>
                </TableCell>
                <TableCell>
                  <Typography variant="body2">{s.injectionSite}</Typography>
                </TableCell>
                <TableCell>
                  <Typography variant="body2">{s.lastGivenDate ?? '—'}</Typography>
                </TableCell>
                <TableCell>{getDueChip(s)}</TableCell>
                <TableCell>
                  <Chip
                    size="small"
                    label={s.status.charAt(0).toUpperCase() + s.status.slice(1)}
                    sx={{
                      bgcolor: s.status === 'active' ? '#4E9C82' : '#9E9E9E',
                      color: '#fff',
                      fontSize: 11,
                    }}
                  />
                </TableCell>
                <TableCell>
                  <Tooltip title="Record administration">
                    <Button
                      size="small"
                      variant="outlined"
                      startIcon={<Vaccines />}
                      onClick={() => setRecordOpen(s)}
                      sx={{ borderColor: '#327C8D', color: '#327C8D', fontSize: 11 }}
                    >
                      Record
                    </Button>
                  </Tooltip>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog aria-labelledby="dialog-title" open={addOpen} onClose={() => setAddOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle id="dialog-title">New LAI Schedule</DialogTitle>
        <DialogContent>
          <LaiScheduleForm patientId={patientId} onSuccess={() => setAddOpen(false)} />
        </DialogContent>
      </Dialog>

      {recordOpen && (
        <Dialog open onClose={() => setRecordOpen(null)} maxWidth="sm" fullWidth>
          <DialogTitle id="dialog-title">Record Administration — {recordOpen.drugName}</DialogTitle>
          <DialogContent>
            <LaiGivenForm
              schedule={recordOpen}
              patientId={patientId}
              onSuccess={() => setRecordOpen(null)}
            />
          </DialogContent>
        </Dialog>
      )}
    </Box>
  );
}
