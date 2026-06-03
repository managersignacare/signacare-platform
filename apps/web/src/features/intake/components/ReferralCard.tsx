import { Card, CardContent, Chip, Divider, Grid, Stack, Typography } from '@mui/material';
import type { Referral } from '../types/intakeTypes';
import { SlaStatusBadge } from './SlaStatusBadge';

interface Props {
  referral: Referral;
}

export const ReferralCard = ({ referral }: Props) => {
  return (
    <Card
      variant="outlined"
      sx={{
        borderRadius: 3,
        backgroundColor: '#FFFFFF',
      }}
    >
      <CardContent>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={2} mb={2}>
          <Stack spacing={0.5}>
            <Typography variant="h6">{referral.fromProviderName ?? 'Unknown referrer'}</Typography>
            <Typography variant="body2" color="text.secondary">
              {referral.source || 'External referral'}
            </Typography>
          </Stack>
          <Stack direction="row" spacing={1}>
            <Chip label={referral.status} size="small" />
            <SlaStatusBadge referral={referral} />
          </Stack>
        </Stack>

        <Divider sx={{ mb: 2 }} />

        <Grid container spacing={2}>
          <Grid>
            <Typography variant="caption" color="text.secondary">
              Received
            </Typography>
            <Typography>{referral.receivedAt ? new Date(referral.receivedAt).toLocaleString() : '—'}</Typography>
          </Grid>
          <Grid>
            <Typography variant="caption" color="text.secondary">
              Urgency
            </Typography>
            <Typography sx={{ textTransform: 'capitalize' }}>{referral.urgency}</Typography>
          </Grid>
          <Grid>
            <Typography variant="caption" color="text.secondary">
              Assigned
            </Typography>
            <Typography>{referral.assignedToStaffId || 'Unassigned'}</Typography>
          </Grid>
          <Grid>
            <Typography variant="caption" color="text.secondary">
              Linked patient
            </Typography>
            <Typography>{referral.patientId || 'Not linked yet'}</Typography>
          </Grid>
          <Grid>
            <Typography variant="caption" color="text.secondary">
              Reason
            </Typography>
            <Typography>{referral.reason || 'No reason supplied.'}</Typography>
          </Grid>
          {referral.internalNotes ? (
            <Grid>
              <Typography variant="caption" color="text.secondary">
                Notes
              </Typography>
              <Typography>{referral.internalNotes}</Typography>
            </Grid>
          ) : null}
        </Grid>
      </CardContent>
    </Card>
  );
};
