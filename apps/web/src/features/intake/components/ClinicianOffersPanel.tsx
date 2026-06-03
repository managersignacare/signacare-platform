// ClinicianOffersPanel — admin view of offers for a referral
import {
  Box,
  Typography,
  Chip,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  CircularProgress,
} from '@mui/material';
import { useReferralOffers } from '../hooks/useReferralOffers';

interface ClinicianOffersPanelProps {
  referralId: string;
}

const responseColors: Record<string, 'success' | 'error' | 'warning' | 'default'> = {
  accepted: 'success',
  declined: 'error',
  expired: 'warning',
  pending: 'default',
};

export function ClinicianOffersPanel({ referralId }: ClinicianOffersPanelProps) {
  const { data, isLoading } = useReferralOffers(referralId);

  if (isLoading) return <CircularProgress size={24} />;
  if (!data?.items?.length) return <Typography variant="body2" color="text.secondary">No offers sent yet.</Typography>;

  return (
    <Box>
      <Typography variant="subtitle2" sx={{ mb: 1 }}>Clinician Offers</Typography>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Clinician</TableCell>
            <TableCell>Specialisation</TableCell>
            <TableCell>Offered</TableCell>
            <TableCell>Status</TableCell>
            <TableCell>Responded</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {data.items.map((offer) => (
            <TableRow key={offer.id}>
              <TableCell>{offer.staffName}</TableCell>
              <TableCell>{offer.staffSpecialisation ?? '-'}</TableCell>
              <TableCell>{new Date(offer.offeredAt).toLocaleDateString()}</TableCell>
              <TableCell>
                <Chip
                  label={offer.response}
                  color={responseColors[offer.response] ?? 'default'}
                  size="small"
                />
              </TableCell>
              <TableCell>
                {offer.respondedAt ? new Date(offer.respondedAt).toLocaleDateString() : '-'}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Box>
  );
}
