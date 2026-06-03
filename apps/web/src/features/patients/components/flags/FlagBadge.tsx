// apps/web/src/features/patients/components/flags/FlagBadge.tsx
import { Chip, Tooltip } from '@mui/material';
import FlagIcon from '@mui/icons-material/Flag';
import type { PatientFlagResponse } from '../../types/patientTypes';

const SEVERITY_COLOURS: Record<PatientFlagResponse['severity'], string> = {
  low:      '#4E9C82',
  medium:   '#F0852C',
  high:     '#D32F2F',
  critical: '#7B1313',
};

interface FlagBadgeProps {
  flag: PatientFlagResponse;
  compact?: boolean;
}

export const FlagBadge: React.FC<FlagBadgeProps> = ({ flag, compact = false }) => {
  const color = SEVERITY_COLOURS[flag.severity];

  return (
    <Tooltip title={flag.description ?? flag.title} arrow>
      <Chip
        icon={
          compact ? undefined : (
            <FlagIcon sx={{ color: `${color} !important`, fontSize: 14 }} />
          )
        }
        label={compact ? flag.severity.toUpperCase() : flag.title}
        size="small"
        sx={{
          backgroundColor: `${color}18`,
          color,
          border: `1px solid ${color}40`,
          fontFamily: 'Albert Sans, sans-serif',
          fontWeight: 600,
          fontSize: compact ? 10 : 11,
          height: compact ? 18 : 24,
        }}
      />
    </Tooltip>
  );
};
