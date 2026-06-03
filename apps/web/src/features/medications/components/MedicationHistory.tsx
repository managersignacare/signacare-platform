import { Box, Chip, Typography } from '@mui/material';
import {
  Timeline,
  TimelineItem,
  TimelineSeparator,
  TimelineDot,
  TimelineConnector,
  TimelineContent,
} from '@mui/lab';
import { useMedications } from '../hooks/useMedications';
import { MEDICATION_STATUS_COLOR, MEDICATION_STATUS_LABEL } from '../types/medicationTypes';

interface Props {
  patientId: string;
}

export default function MedicationHistory({ patientId }: Props) {
  const { data: medications = [], isLoading } = useMedications(patientId);

  const sorted = [...medications].sort(
    (a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime(),
  );

  if (isLoading) return <Typography sx={{ p: 2 }}>Loading history…</Typography>;
  if (sorted.length === 0)
    return <Typography color="text.secondary" sx={{ p: 2 }}>No medication history recorded.</Typography>;

  return (
    <Box>
      <Typography variant="h6" fontWeight={600} sx={{ mb: 2 }}>
        Medication History
      </Typography>
      <Timeline position="left">
        {sorted.map((m, idx) => {
          const color = MEDICATION_STATUS_COLOR[m.status as keyof typeof MEDICATION_STATUS_COLOR] ?? '#9E9E9E';
          return (
            <TimelineItem key={m.id}>
              <TimelineSeparator>
                <TimelineDot sx={{ bgcolor: color }} />
                {idx < sorted.length - 1 && <TimelineConnector />}
              </TimelineSeparator>
              <TimelineContent>
                <Box sx={{ mb: 1 }}>
                  <Typography variant="body2" fontWeight={600}>
                    {m.genericName ?? m.drugLabel}
                    {m.brandName ? ` (${m.brandName})` : ''}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {m.dose} {m.doseUnit ?? ''} · {m.route} · {m.frequency}
                  </Typography>
                  <Box sx={{ mt: 0.5, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                    <Chip
                      size="small"
                      label={MEDICATION_STATUS_LABEL[m.status as keyof typeof MEDICATION_STATUS_LABEL] ?? m.status}
                      sx={{ bgcolor: color, color: '#fff', fontSize: 11 }}
                    />
                    {m.startDate && (
                      <Typography variant="caption" color="text.secondary">
                        Started: {m.startDate}
                      </Typography>
                    )}
                    {m.endDate && (
                      <Typography variant="caption" color="text.secondary">
                        Ended: {m.endDate}
                      </Typography>
                    )}
                  </Box>
                  {m.reasonForCessation && (
                    <Typography variant="caption" color="error.main">
                      Ceased: {m.reasonForCessation}
                    </Typography>
                  )}
                  {m.indication && (
                    <Typography variant="caption" color="text.secondary" display="block">
                      Indication: {m.indication}
                    </Typography>
                  )}
                </Box>
              </TimelineContent>
            </TimelineItem>
          );
        })}
      </Timeline>
    </Box>
  );
}
