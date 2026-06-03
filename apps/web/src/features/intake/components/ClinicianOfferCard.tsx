import { useState } from 'react';
import {
  Card,
  CardContent,
  CardActions,
  Typography,
  Button,
  Chip,
  Box,
  TextField,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Stack,
} from '@mui/material';

interface ClinicianOfferCardProps {
  offer: {
    id: string;
    referralId: string;
    referralNumber?: string;
    urgency?: string;
    presentingProblem?: string;
    referrerName?: string;
    referrerOrganisation?: string;
    patientGivenName?: string;
    patientFamilyName?: string;
    offeredAt: string;
    broadcastAt?: string | null;
    autoCloseAt?: string | null;
  };
  onAccept: (offerId: string, referralId: string, episodeType?: string) => void;
  onDecline: (offerId: string, referralId: string, reason?: string) => void;
  isLoading?: boolean;
}

const urgencyColors: Record<string, 'error' | 'warning' | 'info' | 'default'> = {
  emergency: 'error',
  urgent: 'warning',
  soon: 'info',
  routine: 'default',
};

export function ClinicianOfferCard({ offer, onAccept, onDecline, isLoading }: ClinicianOfferCardProps) {
  const [declineOpen, setDeclineOpen] = useState(false);
  const [declineReason, setDeclineReason] = useState('');

  const patientName = [offer.patientGivenName, offer.patientFamilyName].filter(Boolean).join(' ') || 'Unknown patient';
  const timeSince = getTimeSince(offer.offeredAt);

  return (
    <>
      <Card variant="outlined" sx={{ mb: 2 }}>
        <CardContent>
          <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
            <Box>
              <Typography variant="subtitle1" fontWeight="bold">
                {offer.referralNumber ?? 'Referral'}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Patient: {patientName}
              </Typography>
            </Box>
            {offer.urgency && (
              <Chip
                label={offer.urgency.toUpperCase()}
                color={urgencyColors[offer.urgency] ?? 'default'}
                size="small"
              />
            )}
          </Stack>

          {offer.presentingProblem && (
            <Typography variant="body2" sx={{ mt: 1 }}>
              {offer.presentingProblem}
            </Typography>
          )}

          <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
            From: {offer.referrerName}{offer.referrerOrganisation ? ` (${offer.referrerOrganisation})` : ''}
          </Typography>

          <Typography variant="caption" color="text.secondary">
            Offered {timeSince}
          </Typography>

          {offer.autoCloseAt && (
            <Typography variant="caption" color="warning.main" sx={{ display: 'block' }}>
              Auto-closes: {new Date(offer.autoCloseAt).toLocaleDateString()}
            </Typography>
          )}
        </CardContent>

        <CardActions>
          <Button
            variant="contained"
            color="primary"
            size="small"
            disabled={isLoading}
            onClick={() => onAccept(offer.id, offer.referralId)}
          >
            Accept
          </Button>
          <Button
            variant="outlined"
            color="inherit"
            size="small"
            disabled={isLoading}
            onClick={() => setDeclineOpen(true)}
          >
            Decline
          </Button>
        </CardActions>
      </Card>

      <Dialog open={declineOpen} onClose={() => setDeclineOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Decline Referral</DialogTitle>
        <DialogContent>
          <TextField
            label="Reason for declining (optional)"
            multiline
            rows={3}
            fullWidth
            value={declineReason}
            onChange={(e) => setDeclineReason(e.target.value)}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeclineOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            color="error"
            onClick={() => {
              onDecline(offer.id, offer.referralId, declineReason || undefined);
              setDeclineOpen(false);
              setDeclineReason('');
            }}
          >
            Confirm Decline
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

function getTimeSince(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const hours = Math.floor(diff / (1000 * 60 * 60));
  if (hours < 1) return 'just now';
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
