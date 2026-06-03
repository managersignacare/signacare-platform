import { Chip } from '@mui/material';
import type { Referral } from '../types/intakeTypes';
import { getReferralSlaMeta } from '../types/intakeTypes';

interface Props {
  referral: Referral;
}

export const SlaStatusBadge = ({ referral }: Props) => {
  const meta = getReferralSlaMeta(referral);

  return (
    <Chip
      size="small"
      label={meta.label}
      color={meta.color}
      sx={{
        fontWeight: 600,
        minWidth: 110,
      }}
    />
  );
};
