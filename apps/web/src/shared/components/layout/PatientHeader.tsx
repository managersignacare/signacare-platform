import {
  Box,
  Typography,
  Paper,
  Chip,
  Skeleton,
  Divider,
} from '@mui/material';
import type {
  PatientResponse,
  PatientFlagResponse,
} from '@signacare/shared';
import { PatientBanner } from './PatientBanner';
import {
  format,
  parseISO,
  differenceInYears,
} from 'date-fns';

interface Props {
  patient: PatientResponse | null;
  flags: PatientFlagResponse[];
  loading?: boolean;
}

const GENDER_LABELS: Record<string, string> = {
  male: 'Male',
  female: 'Female',
  nonbinary: 'Non-binary',
  prefernottosay: 'Prefer not to say',
  other: 'Other',
};

export function PatientHeader({
  patient,
  flags,
  loading = false,
}: Props): React.ReactElement {
  const dob = patient?.dateOfBirth
    ? parseISO(patient.dateOfBirth)
    : null;
  const age = dob
    ? differenceInYears(new Date(), dob)
    : null;

  return (
    <Box
      component="header"
      sx={{
        position: 'sticky',
        top: 0,
        zIndex: (theme) => theme.zIndex.appBar - 1,
        bgcolor: '#FFFFFF',
        boxShadow: '0 1px 4px rgba(61,72,75,0.12)',
      }}
    >
      {!loading && flags.length > 0 && (
        <PatientBanner flags={flags} />
      )}

      <Paper
        elevation={0}
        sx={{
          px: { xs: 2, md: 3 },
          py: 1.5,
          borderRadius: 0,
        }}
      >
        {loading ? (
          <Box
            sx={{
              display: 'flex',
              gap: 3,
              alignItems: 'center',
            }}
          >
            <Skeleton
              variant="text"
              width={200}
              height={28}
            />
            <Skeleton
              variant="text"
              width={120}
            />
            <Skeleton
              variant="text"
              width={80}
            />
          </Box>
        ) : patient ? (
          <Box
            sx={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: { xs: 1, md: 2 },
            }}
          >
            {/* Patient name */}
            <Typography
              variant="h6"
              fontWeight={700}
              color="text.primary"
              noWrap
            >
              {patient.familyName.toUpperCase()}
              <span style={{ fontWeight: 500 }}>
                {`, ${patient.givenName}`}
              </span>
              {patient.preferredName && (
                <Typography
                  component="span"
                  variant="body2"
                  color="text.secondary"
                  sx={{ ml: 0.75 }}
                >
                  ({patient.preferredName})
                </Typography>
              )}
            </Typography>

            {/* DOB + age */}
            <Divider orientation="vertical" flexItem />
            <Box>
              <Typography
                variant="caption"
                color="text.secondary"
                display="block"
              >
                DOB
              </Typography>
              <Typography
                variant="body2"
                fontWeight={500}
              >
                {dob ? format(dob, 'dd MMM yyyy') : ''}
                {age !== null && (
                  <Typography
                    component="span"
                    variant="caption"
                    color="text.secondary"
                    sx={{ ml: 0.5 }}
                  >
                    {age} yrs
                  </Typography>
                )}
              </Typography>
            </Box>

            {/* Gender */}
            <Divider orientation="vertical" flexItem />
            <Box>
              <Typography
                variant="caption"
                color="text.secondary"
                display="block"
              >
                Gender
              </Typography>
              <Typography
                variant="body2"
                fontWeight={500}
              >
                {patient.gender
                  ? GENDER_LABELS[patient.gender] ??
                    patient.gender
                  : ''}
              </Typography>
            </Box>

            {/* MRN */}
            <Divider orientation="vertical" flexItem />
            <Box>
              <Typography
                variant="caption"
                color="text.secondary"
                display="block"
              >
                MRN
              </Typography>
              <Typography
                variant="body2"
                fontWeight={600}
                sx={{ fontFamily: 'monospace' }}
              >
                {patient.emrNumber ?? ''}
              </Typography>
            </Box>

            {/* Medicare */}
            <Divider orientation="vertical" flexItem />
            <Box>
              <Typography
                variant="caption"
                color="text.secondary"
                display="block"
              >
                Medicare
              </Typography>
              <Typography
                variant="body2"
                fontWeight={500}
                sx={{ fontFamily: 'monospace' }}
              >
                {patient.medicareNumber ?? ''}
                {patient.medicareIrn && (
                  <Typography
                    component="span"
                    variant="caption"
                    color="text.secondary"
                    sx={{ ml: 0.5 }}
                  >
                    {patient.medicareIrn}
                  </Typography>
                )}
              </Typography>
            </Box>

            {/* Status chip */}
            <Box sx={{ ml: 'auto' }}>
              <Chip
                label={patient.status}
                size="small"
                sx={{
                  bgcolor:
                    patient.status === 'active'
                      ? 'rgba(78,156,130,0.15)'
                      : 'rgba(211,47,47,0.1)',
                  color:
                    patient.status === 'active'
                      ? '#4E9C82'
                      : '#D32F2F',
                  fontWeight: 600,
                  textTransform: 'capitalize',
                }}
              />
            </Box>
          </Box>
        ) : (
          <Typography
            variant="body2"
            color="text.secondary"
          >
            No patient selected.
          </Typography>
        )}
      </Paper>
    </Box>
  );
}
