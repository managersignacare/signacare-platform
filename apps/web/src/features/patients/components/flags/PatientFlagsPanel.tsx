// apps/web/src/features/patients/components/flags/PatientFlagsPanel.tsx
import {
  Alert,
  Box,
  CircularProgress,
  Divider,
  List,
  ListItem,
  ListItemText,
  Typography,
} from '@mui/material';
import { usePatientFlags } from '../../hooks/usePatientFlags';
import { FlagBadge } from './FlagBadge';

interface PatientFlagsPanelProps {
  patientId: string;
}

export const PatientFlagsPanel: React.FC<PatientFlagsPanelProps> = ({ patientId }) => {
  const { data: flags, isLoading, isError } = usePatientFlags(patientId);

  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 2 }}>
        <CircularProgress role="progressbar" aria-label="Loading" size={20} sx={{ color: '#327C8D' }} />
      </Box>
    );
  }

  if (isError) {
    return <Alert role="alert" severity="error" sx={{ m: 1 }}>Failed to load flags.</Alert>;
  }

  const activeFlags = flags?.filter((f) => f.status === 'active') ?? [];

  if (!activeFlags.length) {
    return (
      <Box sx={{ p: 2 }}>
        <Typography variant="body2" color="text.secondary" fontFamily="Albert Sans, sans-serif">
          No active flags
        </Typography>
      </Box>
    );
  }

  return (
    <Box>
      <Typography
        variant="subtitle2"
        fontWeight={600}
        fontFamily="Albert Sans, sans-serif"
        sx={{ px: 2, pt: 2, pb: 1, color: '#3D484B' }}
      >
        Active Flags ({activeFlags.length})
      </Typography>
      <Divider />
      <List dense disablePadding>
        {activeFlags.map((flag) => (
          <ListItem key={flag.id} divider sx={{ gap: 1 }}>
            <FlagBadge flag={flag} />
            <ListItemText
              primary={
                <Typography variant="body2" fontFamily="Albert Sans, sans-serif" fontWeight={500}>
                  {flag.title}
                </Typography>
              }
              secondary={
                flag.description ? (
                  <Typography variant="caption" color="text.secondary" fontFamily="Albert Sans, sans-serif">
                    {flag.description}
                  </Typography>
                ) : null
              }
            />
          </ListItem>
        ))}
      </List>
    </Box>
  );
};
