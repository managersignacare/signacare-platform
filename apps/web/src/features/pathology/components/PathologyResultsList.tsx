// apps/web/src/features/pathology/components/PathologyResultsList.tsx
import {
  Box,
  Typography,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Chip,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Alert,
  Button,
  CircularProgress,
  Paper,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import { useLabResults, useAcknowledgeCriticalResult } from '../hooks/usePathology';
import type { LabResultResponse, LabResultValue } from '../types/pathologyTypes';

const CRITICAL_RED = '#D32F2F';

const VALUE_COLOR: Record<string, string> = {
  normal: 'inherit',
  abnormal_low: '#E65100',
  abnormal_high: '#E65100',
  critical_low: CRITICAL_RED,
  critical_high: CRITICAL_RED,
  unknown: 'inherit',
};

interface Props {
  patientId: string;
}

export const PathologyResultsList: React.FC<Props> = ({ patientId }) => {
  const { data: results, isLoading, isError } = useLabResults(patientId);
  const acknowledgeMutation = useAcknowledgeCriticalResult();

  if (isLoading) return <CircularProgress role="progressbar" aria-label="Loading" size={24} />;
  if (isError)
    return <Alert role="alert" severity="error">Failed to load pathology results.</Alert>;

  if (!results || results.length === 0)
    return (
      <Typography variant="body2" color="text.secondary">
        No results available.
      </Typography>
    );

  const criticalUnacknowledged = results.filter(
    (r) => r.isCritical && !r.criticalAcknowledgedAt,
  );

  return (
    <Box>
      <Typography variant="h6" sx={{ mb: 2 }}>
        Pathology Results
      </Typography>

      {criticalUnacknowledged.length > 0 && (
        <Paper
          elevation={0}
          sx={{
            bgcolor: CRITICAL_RED,
            color: '#fff',
            p: 2,
            mb: 3,
            borderRadius: 1,
            display: 'flex',
            alignItems: 'center',
            gap: 2,
          }}
        >
          <WarningAmberIcon sx={{ fontSize: 32 }} />
          <Box sx={{ flex: 1 }}>
            <Typography variant="subtitle1" fontWeight={700}>
              {criticalUnacknowledged.length} Critical Result
              {criticalUnacknowledged.length > 1 ? 's' : ''} Require
              Acknowledgement
            </Typography>
            <Typography variant="body2">
              Review and acknowledge all critical results immediately.
            </Typography>
          </Box>
        </Paper>
      )}

      {results.map((result: LabResultResponse) => (
        <Accordion
          key={result.id}
          defaultExpanded={result.isCritical && !result.criticalAcknowledgedAt}
          sx={{
            mb: 1,
            border: result.isCritical && !result.criticalAcknowledgedAt
              ? `2px solid ${CRITICAL_RED}`
              : undefined,
          }}
        >
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1.5,
                width: '100%',
              }}
            >
              {result.isCritical && (
                <WarningAmberIcon sx={{ color: CRITICAL_RED }} />
              )}
              <Typography variant="subtitle2">
                {result.orderNumber}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {result.reportedDate ?? result.createdAt.split('T')[0]}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {result.labProvider}
              </Typography>
              {result.isCritical && (
                <Chip
                  label={
                    result.criticalAcknowledgedAt
                      ? `Acknowledged by ${result.criticalAcknowledgedByStaffName}`
                      : 'CRITICAL – Unacknowledged'
                  }
                  size="small"
                  sx={{
                    bgcolor: result.criticalAcknowledgedAt
                      ? 'success.light'
                      : CRITICAL_RED,
                    color: '#fff',
                    fontWeight: 700,
                    ml: 'auto',
                  }}
                />
              )}
            </Box>
          </AccordionSummary>

          <AccordionDetails>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Test</TableCell>
                  <TableCell>Result</TableCell>
                  <TableCell>Unit</TableCell>
                  <TableCell>Reference Range</TableCell>
                  <TableCell>Flag</TableCell>
                  <TableCell>Notes</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {result.results.map((rv: LabResultValue, idx: number) => (
                  <TableRow key={idx}>
                    <TableCell>{rv.testName}</TableCell>
                    <TableCell
                      sx={{
                        color: VALUE_COLOR[rv.status] ?? 'inherit',
                        fontWeight:
                          rv.status.startsWith('critical') ? 700 : 400,
                      }}
                    >
                      {rv.value ?? '—'}
                    </TableCell>
                    <TableCell>{rv.unit ?? '—'}</TableCell>
                    <TableCell>{rv.referenceRange ?? '—'}</TableCell>
                    <TableCell>
                      {rv.status !== 'normal' && rv.status !== 'unknown' && (
                        <Chip
                          label={rv.status.replace('_', ' ').toUpperCase()}
                          size="small"
                          sx={{
                            bgcolor: VALUE_COLOR[rv.status],
                            color: '#fff',
                            fontSize: 10,
                          }}
                        />
                      )}
                    </TableCell>
                    <TableCell>{rv.notes ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {result.isCritical && !result.criticalAcknowledgedAt && (
              <Box sx={{ mt: 2, display: 'flex', justifyContent: 'flex-end' }}>
                <Button
                  variant="contained"
                  sx={{ bgcolor: CRITICAL_RED, '&:hover': { bgcolor: '#b71c1c' } }}
                  onClick={() => acknowledgeMutation.mutate(result.id)}
                  disabled={acknowledgeMutation.isPending}
                >
                  Acknowledge Critical Result
                </Button>
              </Box>
            )}
          </AccordionDetails>
        </Accordion>
      ))}
    </Box>
  );
};
