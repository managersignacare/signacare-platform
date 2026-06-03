// apps/web/src/features/risk-allergies/components/AllergyConflictBanner.tsx
import {
  Alert,
  AlertTitle,
  Box,
  Chip,
  CircularProgress,
  Stack,
  Typography,
} from '@mui/material';
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded';
import { useAllergyInteractionCheck } from '../hooks/useAllergies';
import { SEVERITY_CONFIG } from '../types/allergyTypes';

interface Props {
  patientId: string;
  /**
   * The drug name currently entered during prescribing.
   * Pass an empty string or undefined to suppress the check.
   */
  drugName:  string;
}

/**
 * AllergyConflictBanner
 *
 * Renders automatically during prescribing workflows whenever `drugName`
 * has ≥2 characters. Shows a warning for every matching active allergy.
 * Returns null when there are no conflicts or the check has not yet run.
 */
export const AllergyConflictBanner: React.FC<Props> = ({ patientId, drugName }) => {
  const { data: conflicts, isLoading, isFetching } = useAllergyInteractionCheck(
    patientId,
    drugName,
  );

  if (!drugName || drugName.length < 2) return null;

  if (isLoading || isFetching) {
    return (
      <Box display="flex" alignItems="center" gap={1} py={1}>
        <CircularProgress role="progressbar" aria-label="Loading" size={14} />
        <Typography variant="caption" color="text.secondary">
          Checking allergy interactions…
        </Typography>
      </Box>
    );
  }

  if (!conflicts || conflicts.length === 0) return null;

  const hasLifeThreatening = conflicts.some((c) => c.severity === 'life_threatening');

  return (
    <Alert
      severity={hasLifeThreatening ? 'error' : 'warning'}
      icon={<WarningAmberRoundedIcon />}
      variant="filled"
      sx={{ mb: 1 }}
    >
      <AlertTitle>
        {hasLifeThreatening
          ? '⚠ LIFE-THREATENING ALLERGY CONFLICT'
          : 'Allergy Conflict Detected'}
      </AlertTitle>
      <Typography variant="body2" mb={1}>
        This patient has {conflicts.length} active allergy record
        {conflicts.length > 1 ? 's' : ''} that may conflict with{' '}
        <strong>{drugName}</strong>:
      </Typography>
      <Stack direction="row" flexWrap="wrap" gap={0.75}>
        {conflicts.map((c) => {
          const sev = SEVERITY_CONFIG[c.severity];
          return (
            <Chip
              key={c.id}
              label={`${c.allergen} — ${sev.label}`}
              size="small"
              sx={{
                bgcolor:    sev.colour,
                color:      '#fff',
                fontWeight: 700,
              }}
            />
          );
        })}
      </Stack>
      <Typography variant="caption" display="block" mt={1} sx={{ opacity: 0.85 }}>
        Proceed only with documented clinical justification and patient consent.
      </Typography>
    </Alert>
  );
};
