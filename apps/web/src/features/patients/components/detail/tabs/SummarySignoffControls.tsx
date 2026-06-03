import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../../../shared/services/apiClient';
import { patientsKeys } from '../../../queryKeys';

export type SummarySignoffSection =
  | 'longitudinal_summary'
  | 'clinical_formulation'
  | 'life_chart'
  | 'care_provision_summary'
  | 'diagnosis_summary';

interface SummarySignoffRecord {
  section: SummarySignoffSection;
  signedOffAt: string;
  signedOffById: string;
  signedOffByName: string;
  reviewDueDate: string;
  reminderTaskId: string | null;
}

const SUMMARY_SECTION_LABELS: Record<SummarySignoffSection, string> = {
  longitudinal_summary: 'Longitudinal Summary',
  clinical_formulation: 'Clinical Formulation',
  life_chart: 'Life Chart',
  care_provision_summary: 'Care Provision Summary',
  diagnosis_summary: 'Diagnosis Summary',
};

function formatSignedAt(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Unknown date/time';
  return parsed.toLocaleString('en-AU', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

interface SectionSignoffControlsProps {
  patientId: string;
  section: SummarySignoffSection;
}

export function SectionSignoffControls({ patientId, section }: SectionSignoffControlsProps) {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [reviewIntervalMonths, setReviewIntervalMonths] = useState<3 | 6>(6);
  const [submitError, setSubmitError] = useState('');

  const { data: signoffRows = [] } = useQuery({
    queryKey: patientsKeys.summarySignoffs(patientId),
    queryFn: () =>
      apiClient
        .get<{ signoffs?: SummarySignoffRecord[] }>(`patients/${patientId}/summary-signoffs`)
        .then((r) => r.signoffs ?? []),
    enabled: Boolean(patientId),
    staleTime: 60_000,
  });

  const signoff = signoffRows.find((row) => row.section === section);

  const signoffMut = useMutation({
    mutationFn: () =>
      apiClient.post<{ signoffs?: SummarySignoffRecord[] }>(
        `patients/${patientId}/summary-signoffs`,
        {
          section,
          reviewIntervalMonths,
        },
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: patientsKeys.summarySignoffs(patientId),
      });
      await queryClient.invalidateQueries({
        queryKey: patientsKeys.tasksSummary(patientId),
      });
      setDialogOpen(false);
      setSubmitError('');
    },
    onError: (error: unknown) => {
      const message =
        (
          error as {
            response?: { data?: { error?: string } };
            message?: string;
          }
        ).response?.data?.error ??
        (error as { message?: string }).message ??
        'Unable to save consultant psychiatrist sign-off.';
      setSubmitError(message);
    },
  });

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6, flexWrap: 'wrap' }}>
      {signoff ? (
        <Chip
          size="small"
          variant="outlined"
          label={`Signed by ${signoff.signedOffByName || 'Consultant Psychiatrist'} on ${formatSignedAt(signoff.signedOffAt)} · Review due ${new Date(signoff.reviewDueDate).toLocaleDateString('en-AU')}`}
          sx={{
            fontSize: 9,
            height: 20,
            borderColor: '#2E7D32',
            color: '#2E7D32',
          }}
        />
      ) : (
        <Chip
          size="small"
          label="Not signed off"
          sx={{ fontSize: 9, height: 20, bgcolor: '#FFF3E0', color: '#E65100' }}
        />
      )}
      <Button
        size="small"
        variant="outlined"
        onClick={() => setDialogOpen(true)}
        sx={{ fontSize: 10, textTransform: 'none', minWidth: 0, px: 1.1, py: 0.3 }}
      >
        Review & Sign-off
      </Button>
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ pb: 1.2 }}>Consultant Psychiatrist Sign-off</DialogTitle>
        <DialogContent sx={{ pt: '8px !important' }}>
          <Typography variant="body2" sx={{ mb: 1.5 }}>
            Confirm consultant psychiatrist review for{' '}
            <strong>{SUMMARY_SECTION_LABELS[section]}</strong>.
          </Typography>
          <FormControl fullWidth size="small">
            <InputLabel>Next Review Due</InputLabel>
            <Select
              value={reviewIntervalMonths}
              label="Next Review Due"
              onChange={(event) => {
                const next = Number(event.target.value) as 3 | 6;
                setReviewIntervalMonths(next);
              }}
            >
              <MenuItem value={3}>3 months</MenuItem>
              <MenuItem value={6}>6 months</MenuItem>
            </Select>
          </FormControl>
          {submitError && (
            <Alert severity="error" sx={{ mt: 1.5 }}>
              {submitError}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={() => signoffMut.mutate()}
            disabled={signoffMut.isPending}
            sx={{ bgcolor: '#2E7D32', '&:hover': { bgcolor: '#1B5E20' } }}
          >
            {signoffMut.isPending ? 'Signing...' : 'Sign off'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
