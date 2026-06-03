import {
  Box,
  Typography,
  CircularProgress,
  Alert,
  Container,
} from '@mui/material';
import type { ReferralOffer } from '@signacare/shared';
import { useMyOffers } from '../hooks/useMyOffers';
import { useRespondToOffer } from '../hooks/useRespondToOffer';
import { ClinicianOfferCard } from '../components/ClinicianOfferCard';

interface MutationErrorLike {
  message?: string;
}

interface MyOfferRow extends ReferralOffer {
  urgency?: string;
  referral_id?: string;
  referral_number?: string;
  referralNumber?: string;
  presenting_problem?: string;
  presentingProblem?: string;
  referrer_name?: string;
  referrerName?: string;
  referrer_organisation?: string;
  referrerOrganisation?: string;
  patient_given_name?: string;
  patientGivenName?: string;
  patient_family_name?: string;
  patientFamilyName?: string;
  offered_at?: string;
  broadcast_at?: string | null;
  broadcastAt?: string | null;
  auto_close_at?: string | null;
  autoCloseAt?: string | null;
}

function getMutationErrorMessage(error: unknown): string {
  const maybe = error as MutationErrorLike;
  return maybe.message ?? 'Failed to respond to offer. Another clinician may have already accepted.';
}

export default function MyOffersPage() {
  const { data, isLoading, error } = useMyOffers();
  const respondMutation = useRespondToOffer();
  const items: MyOfferRow[] = data?.items ?? [];

  const handleAccept = (offerId: string, referralId: string, episodeType?: string) => {
    respondMutation.mutate({
      referralId,
      offerId,
      dto: { response: 'accepted', episodeType },
    });
  };

  const handleDecline = (offerId: string, referralId: string, reason?: string) => {
    respondMutation.mutate({
      referralId,
      offerId,
      dto: { response: 'declined', declineReason: reason },
    });
  };

  return (
    <Container maxWidth="md" sx={{ py: 3 }}>
      <Typography variant="h5" sx={{ mb: 3 }}>
        My Referral Offers
      </Typography>

      {respondMutation.isSuccess && (
        <Alert severity="success" sx={{ mb: 2 }}>
          Response recorded successfully.
        </Alert>
      )}

      {respondMutation.isError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {getMutationErrorMessage(respondMutation.error)}
        </Alert>
      )}

      {isLoading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress />
        </Box>
      )}

      {error && (
        <Alert severity="error">Failed to load offers.</Alert>
      )}

      {data && data.items.length === 0 && (
        <Alert severity="info">No pending referral offers at this time.</Alert>
      )}

      {items.map((offer) => (
        <ClinicianOfferCard
          key={offer.id}
          offer={{
            id: offer.id,
            referralId: offer.referral_id ?? offer.referralId,
            referralNumber: offer.referral_number ?? offer.referralNumber,
            urgency: offer.urgency,
            presentingProblem: offer.presenting_problem ?? offer.presentingProblem,
            referrerName: offer.referrer_name ?? offer.referrerName,
            referrerOrganisation: offer.referrer_organisation ?? offer.referrerOrganisation,
            patientGivenName: offer.patient_given_name ?? offer.patientGivenName,
            patientFamilyName: offer.patient_family_name ?? offer.patientFamilyName,
            offeredAt: offer.offered_at ?? offer.offeredAt,
            broadcastAt: offer.broadcast_at ?? offer.broadcastAt,
            autoCloseAt: offer.auto_close_at ?? offer.autoCloseAt,
          }}
          onAccept={handleAccept}
          onDecline={handleDecline}
          isLoading={respondMutation.isPending}
        />
      ))}

      {data && data.total > data.items.length && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
          Showing {data.items.length} of {data.total} offers
        </Typography>
      )}
    </Container>
  );
}
