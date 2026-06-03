import {
  Box,
  Chip,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { useLaiGiven } from '../hooks/useLaiSchedules';
import { LAI_OUTCOME_COLOR, LAI_OUTCOME_LABEL } from '../types/laiTypes';
import type { LaiOutcome } from '../types/laiTypes';

interface Props {
  scheduleId: string;
  drugName: string;
}

export default function LaiAdministrationHistory({ scheduleId, drugName }: Props) {
  const { data: records = [], isLoading } = useLaiGiven(scheduleId);

  if (isLoading) return <Typography sx={{ p: 1 }}>Loading history…</Typography>;
  if (records.length === 0)
    return <Typography color="text.secondary" sx={{ py: 1 }}>No administration records yet.</Typography>;

  return (
    <Box>
      <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1 }}>
        Administration History — {drugName}
      </Typography>
      <Table size="small">
        <TableHead>
          <TableRow sx={{ bgcolor: '#F5F5F5' }}>
            {['Date', 'Outcome', 'Dose Given', 'Site', 'Batch #', 'Administered By', 'Next Due', 'Notes'].map((h) => (
              <TableCell key={h} sx={{ fontWeight: 600 }}>{h}</TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {records.map((r) => (
            <TableRow key={r.id} hover>
              <TableCell>{r.givenDate}</TableCell>
              <TableCell>
                <Chip
                  size="small"
                  label={LAI_OUTCOME_LABEL[r.outcome as LaiOutcome] ?? r.outcome}
                  sx={{
                    bgcolor: LAI_OUTCOME_COLOR[r.outcome as LaiOutcome] ?? '#9E9E9E',
                    color: '#fff',
                    fontSize: 11,
                  }}
                />
                {r.refusalReason && (
                  <Typography variant="caption" display="block" color="error.main">
                    {r.refusalReason}
                  </Typography>
                )}
              </TableCell>
              <TableCell>{r.dosGivenMg ?? '—'}</TableCell>
              <TableCell>{r.injectionSite ?? '—'}</TableCell>
              <TableCell>{r.batchNumber ?? '—'}</TableCell>
              <TableCell>{r.administeredByStaffId.slice(0, 8)}…</TableCell>
              <TableCell>{r.nextDueDate ?? '—'}</TableCell>
              <TableCell>{r.notes ?? '—'}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Box>
  );
}
