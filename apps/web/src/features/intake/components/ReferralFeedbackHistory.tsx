import {
  Box,
  Typography,
  Chip,
} from '@mui/material';
import { useReferralFeedbackLog } from '../hooks/useReferralFeedbackLog';

interface ReferralFeedbackHistoryProps {
  referralId: string;
}

const typeColors: Record<string, 'success' | 'error' | 'warning' | 'info' | 'default'> = {
  accepted: 'success',
  rejected: 'error',
  closed_no_response: 'warning',
  clarification_request: 'info',
  appointment_booked: 'success',
};

export function ReferralFeedbackHistory({ referralId }: ReferralFeedbackHistoryProps) {
  const { data, isLoading } = useReferralFeedbackLog(referralId);

  if (isLoading) return null;
  if (!data?.items?.length) return <Typography variant="body2" color="text.secondary">No feedback sent yet.</Typography>;

  return (
    <Box>
      <Typography variant="subtitle2" sx={{ mb: 1 }}>Referrer Feedback History</Typography>
      {data.items.map((log) => (
        <Box key={log.id} sx={{ mb: 1.5, p: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
            <Chip
              label={log.feedbackType.replace(/_/g, ' ')}
              color={typeColors[log.feedbackType] ?? 'default'}
              size="small"
            />
            <Chip
              label={log.deliveryStatus}
              variant="outlined"
              size="small"
              color={log.deliveryStatus === 'sent' ? 'success' : log.deliveryStatus === 'failed' ? 'error' : 'default'}
            />
          </Box>
          <Typography variant="caption" color="text.secondary">
            To: {log.recipientEmail} | {new Date(log.sentAt).toLocaleString()}
          </Typography>
          {log.sentByStaffName && (
            <Typography variant="caption" color="text.secondary" display="block">
              Sent by: {log.sentByStaffName}
            </Typography>
          )}
          {log.deliveryStatus === 'letter_generated' && (
            <Typography variant="caption" color="warning.main" display="block" sx={{ mt: 0.5 }}>
              Feedback letter generated — please send manually
            </Typography>
          )}
        </Box>
      ))}
    </Box>
  );
}
