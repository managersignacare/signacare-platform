// apps/web/src/features/patients/components/PatientCard.tsx
import { useNavigate } from 'react-router-dom';
import {
  Avatar,
  Box,
  Card,
  CardActionArea,
  CardContent,
  Chip,
  Typography,
} from '@mui/material';
import type { PatientResponse } from '@signacare/shared';

interface PatientCardProps {
  patient: PatientResponse;
}

function getInitials(given: string, family: string): string {
  return `${given.charAt(0)}${family.charAt(0)}`.toUpperCase();
}

export const PatientCard: React.FC<PatientCardProps> = ({ patient }) => {
  const navigate = useNavigate();
  const age = patient.dateOfBirth
    ? String(new Date().getFullYear() - new Date(patient.dateOfBirth).getFullYear())
    : '—';
  const dob = patient.dateOfBirth
    ? new Date(patient.dateOfBirth).toLocaleDateString('en-AU')
    : '—';

  return (
    <Card
      elevation={0}
      sx={{
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 2,
        transition: 'box-shadow 0.2s',
        '&:hover': { boxShadow: 3 },
      }}
    >
      <CardActionArea onClick={() => navigate(`/patients/${patient.id}`)}>
        <CardContent sx={{ display: 'flex', gap: 2, alignItems: 'flex-start' }}>
          <Avatar
            sx={{
              width: 48,
              height: 48,
              bgcolor: '#327C8D',
              fontFamily: 'Albert Sans, sans-serif',
              fontWeight: 600,
              fontSize: 16,
            }}
          >
            {getInitials(patient.givenName, patient.familyName)}
          </Avatar>

          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography
              variant="subtitle1"
              fontWeight={600}
              fontFamily="Albert Sans, sans-serif"
              noWrap
            >
              {patient.familyName}, {patient.givenName}
              {patient.preferredName && (
                <Typography
                  component="span"
                  variant="body2"
                  color="text.secondary"
                  fontFamily="Albert Sans, sans-serif"
                >
                  {' '}
                  ({patient.preferredName})
                </Typography>
              )}
            </Typography>

            <Box sx={{ display: 'flex', gap: 2, mt: 0.5, flexWrap: 'wrap' }}>
              <Typography variant="caption" color="text.secondary" fontFamily="Albert Sans, sans-serif">
                DOB: {dob} · Age {age}
              </Typography>
              {patient.emrNumber && (
                <Typography variant="caption" color="text.secondary" fontFamily="Albert Sans, sans-serif">
                  MRN: {patient.emrNumber}
                </Typography>
              )}
            </Box>

            <Box sx={{ display: 'flex', gap: 1, mt: 1, flexWrap: 'wrap' }}>
              <Chip
                label={patient.status ?? 'active'}
                size="small"
                color={patient.status === 'active' ? 'success' : 'default'}
                sx={{ textTransform: 'capitalize', fontFamily: 'Albert Sans, sans-serif', fontSize: 11 }}
              />
            </Box>
          </Box>
        </CardContent>
      </CardActionArea>
    </Card>
  );
};
