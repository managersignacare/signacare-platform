import {
  Box,
  Card,
  CardActionArea,
  CardContent,
  Divider,
  Grid,
  Stack,
  Typography,
} from '@mui/material';
import CalendarTodayIcon from '@mui/icons-material/CalendarToday';
import LocalHospitalIcon from '@mui/icons-material/LocalHospital';
import type { Episode } from '../types/episodeTypes';
import { EPISODE_TYPE_LABELS } from '../types/episodeTypes';
import { EpisodeStatusBadge }  from './EpisodeStatusBadge';

interface Props {
  episode:  Episode;
  onClick?: () => void;
}

export const EpisodeCard = ({ episode, onClick }: Props) => {
  const fmtDate = (d: string | null) =>
    d ? new Date(d).toLocaleDateString('en-AU') : '—';

  return (
    <Card
      variant="outlined"
      sx={{ borderRadius: 3, backgroundColor: '#FFFFFF', mb: 1.5 }}
    >
      <CardActionArea onClick={onClick} disabled={!onClick}>
        <CardContent>
          <Stack
            direction="row"
            justifyContent="space-between"
            alignItems="flex-start"
            mb={1.5}
          >
            <Stack spacing={0.25}>
              <Typography
                fontFamily="Albert Sans, sans-serif"
                fontWeight={700}
                fontSize={15}
                color="#3D484B"
              >
                {episode.title}
              </Typography>
              {episode.episodeNumber && (
                <Typography variant="caption" color="text.secondary" fontFamily="Albert Sans, sans-serif">
                  #{episode.episodeNumber}
                </Typography>
              )}
            </Stack>
            <EpisodeStatusBadge status={episode.status} />
          </Stack>

          <Divider sx={{ mb: 1.5 }} />

          <Grid container spacing={1.5}>
            <Grid>
              <Stack direction="row" spacing={0.5} alignItems="center">
                <CalendarTodayIcon sx={{ fontSize: 14, color: '#327C8D' }} />
                <Box>
                  <Typography variant="caption" color="text.secondary" fontFamily="Albert Sans, sans-serif">
                    Start
                  </Typography>
                  <Typography variant="body2" fontFamily="Albert Sans, sans-serif">
                    {fmtDate(episode.startDate)}
                  </Typography>
                </Box>
              </Stack>
            </Grid>

            <Grid>
              <Stack direction="row" spacing={0.5} alignItems="center">
                <CalendarTodayIcon sx={{ fontSize: 14, color: '#9E9E9E' }} />
                <Box>
                  <Typography variant="caption" color="text.secondary" fontFamily="Albert Sans, sans-serif">
                    End
                  </Typography>
                  <Typography variant="body2" fontFamily="Albert Sans, sans-serif">
                    {fmtDate(episode.endDate)}
                  </Typography>
                </Box>
              </Stack>
            </Grid>

            <Grid>
              <Stack direction="row" spacing={0.5} alignItems="center">
                <LocalHospitalIcon sx={{ fontSize: 14, color: '#327C8D' }} />
                <Box>
                  <Typography variant="caption" color="text.secondary" fontFamily="Albert Sans, sans-serif">
                    Type
                  </Typography>
                  <Typography variant="body2" fontFamily="Albert Sans, sans-serif">
                    {episode.episodeType
                      ? EPISODE_TYPE_LABELS[episode.episodeType]
                      : '—'}
                  </Typography>
                </Box>
              </Stack>
            </Grid>

            {episode.primaryDiagnosis && (
              <Grid>
                <Typography variant="caption" color="text.secondary" fontFamily="Albert Sans, sans-serif">
                  Primary Diagnosis
                </Typography>
                <Typography variant="body2" fontFamily="Albert Sans, sans-serif">
                  {episode.primaryDiagnosis}
                </Typography>
              </Grid>
            )}
          </Grid>
        </CardContent>
      </CardActionArea>
    </Card>
  );
};
