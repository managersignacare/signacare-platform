import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { useReferrals } from '../hooks/useReferrals';
import type { ReferralFilters } from '../types/intakeTypes';

interface Props {
  filters?: ReferralFilters;
}

export const ReferralList = ({ filters }: Props) => {
  const { data, isLoading, isError, error } = useReferrals(filters);

  const formatDate = (value?: string | null): string => {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleDateString('en-AU');
  };

  if (isLoading) {
    return (
      <Box display="flex" justifyContent="center" py={6}>
        <CircularProgress role="progressbar" aria-label="Loading" />
      </Box>
    );
  }

  if (isError) {
    return <Alert role="alert" severity="error">{error instanceof Error ? error.message : 'Failed to load referrals.'}</Alert>;
  }

  if (!data || data.length === 0) {
    return <Alert severity="info">No referrals matched the current filters.</Alert>;
  }

  return (
    <Paper variant="outlined" sx={{ overflow: 'hidden', borderRadius: 3 }}>
      <Table>
        <TableHead>
          <TableRow sx={{ backgroundColor: '#FBF8F5' }}>
            <TableCell>UR no</TableCell>
            <TableCell>Patient name</TableCell>
            <TableCell>DOB</TableCell>
            <TableCell>Ref source</TableCell>
            <TableCell>Ref date</TableCell>
            <TableCell>Urgency</TableCell>
            <TableCell>Status</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {data.map((referral) => (
            <TableRow
              key={referral.id}
              hover
              sx={{
                '&:last-child td': { borderBottom: 0 },
              }}
            >
              <TableCell>{referral.patientUrNo || '—'}</TableCell>
              <TableCell>
                <Typography
                  component={RouterLink}
                  to={`/intake/${referral.id}`}
                  sx={{
                    color: '#327C8D',
                    textDecoration: 'none',
                    fontWeight: 700,
                  }}
                >
                  {`${referral.patientGivenName ?? ''} ${referral.patientFamilyName ?? ''}`.trim() || 'Unknown patient'}
                </Typography>
              </TableCell>
              <TableCell>{formatDate(referral.patientDob)}</TableCell>
              <TableCell>{referral.fromProviderName || referral.referringOrg || referral.source || '—'}</TableCell>
              <TableCell>{formatDate(referral.referralDate || referral.receivedAt)}</TableCell>
              <TableCell>
                <Chip size="small" label={referral.urgency} />
              </TableCell>
              <TableCell>
                <Chip size="small" label={referral.status} variant="outlined" />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Paper>
  );
};
