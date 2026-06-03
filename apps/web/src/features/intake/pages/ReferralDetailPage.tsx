import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Grid,
  Stack,
  Typography,
} from '@mui/material';
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { OcrPreviewPanel } from '../components/OcrPreviewPanel';
import { ReferralCard } from '../components/ReferralCard';
import { ReferralDecisionModal } from '../components/ReferralDecisionModal';
import { ReferralLetterUpload } from '../components/ReferralLetterUpload';
import { ReferralWorkflowTimeline } from '../components/ReferralWorkflowTimeline';
import { useReferral } from '../hooks/useReferral';

export const ReferralDetailPage = () => {
  const { referralId = '' } = useParams<{ referralId: string }>();
  const [decisionOpen, setDecisionOpen] = useState(false);
  const { data, isLoading, isError, error, refetch } = useReferral(referralId);

  if (isLoading) {
    return <CircularProgress role="progressbar" aria-label="Loading" />;
  }

  if (isError || !data) {
    return <Alert role="alert" severity="error">{error instanceof Error ? error.message : 'Referral not found.'}</Alert>;
  }

  return (
    <Stack spacing={3}>
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        justifyContent="space-between"
        alignItems={{ xs: 'stretch', md: 'center' }}
        spacing={2}
      >
        <Box>
          <Typography variant="h4" sx={{ color: '#3D484B', fontWeight: 700 }}>
            Referral detail
          </Typography>
          <Typography color="text.secondary">Review intake data, documents, OCR output, and workflow history.</Typography>
        </Box>

        <Button
          variant="contained"
          onClick={() => setDecisionOpen(true)}
          sx={{
            backgroundColor: '#4E9C82',
            '&:hover': { backgroundColor: '#43846e' },
          }}
        >
          Record decision
        </Button>
      </Stack>

      <ReferralCard referral={data} />

      <Grid container spacing={3}>
        <Grid>
          <Stack spacing={3}>
            <Box>
              <Typography variant="h6" mb={1.5}>
                Upload letter
              </Typography>
              <ReferralLetterUpload referralId={referralId} onUploaded={() => void refetch()} />
            </Box>

            <Box>
              <Typography variant="h6" mb={1.5}>
                Workflow timeline
              </Typography>
              <ReferralWorkflowTimeline referralId={referralId} />
            </Box>
          </Stack>
        </Grid>

        <Grid>
          <Typography variant="h6" mb={1.5}>
            OCR review
          </Typography>
          <OcrPreviewPanel documentUrl={data.attachments[0]?.storageKey ?? null} extractedFields={data.ocrExtracted as Record<string, string | number | boolean | null | undefined> | null} />
        </Grid>
      </Grid>

      <ReferralDecisionModal
        open={decisionOpen}
        referralId={referralId}
        onClose={() => setDecisionOpen(false)}
      />
    </Stack>
  );
};
