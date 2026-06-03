import {
  Box,
  Chip,
  CircularProgress,
  Divider,
  Stack,
  Typography,
} from '@mui/material';
import FiberManualRecordIcon from '@mui/icons-material/FiberManualRecord';
import { useEpisodes }               from '../hooks/useEpisodes';
import { EpisodeStatusBadge }        from './EpisodeStatusBadge';
import { EPISODE_TYPE_LABELS }       from '../types/episodeTypes';

interface Props {
  patientId: string;
}

export const EpisodeTimeline = ({ patientId }: Props) => {
  const { data, isLoading } = useEpisodes(patientId);

  if (isLoading) {
    return (
      <Box display="flex" justifyContent="center" py={4}>
        <CircularProgress role="progressbar" aria-label="Loading" size={24} sx={{ color: '#327C8D' }} />
      </Box>
    );
  }

  const episodes = data?.data ?? [];

  if (episodes.length === 0) {
    return (
      <Typography
        fontFamily="Albert Sans, sans-serif"
        color="text.secondary"
        fontSize={14}
        py={2}
      >
        No episodes recorded yet.
      </Typography>
    );
  }

  const fmtDate = (d: string | null) =>
    d ? new Date(d).toLocaleDateString('en-AU') : 'ongoing';

  return (
    <Box>
      {episodes.map((ep, idx) => (
        <Box key={ep.id}>
          <Stack direction="row" spacing={2} alignItems="flex-start" py={1.5}>
            {/* Timeline dot */}
            <Box
              sx={{
                display:        'flex',
                flexDirection:  'column',
                alignItems:     'center',
                mt:             0.4,
                minWidth:       20,
              }}
            >
              <FiberManualRecordIcon
                sx={{
                  fontSize: 14,
                  color:
                    ep.status === 'open'
                      ? '#4E9C82'
                      : ep.status === 'onhold'
                      ? '#F0852C'
                      : '#9E9E9E',
                }}
              />
              {idx < episodes.length - 1 && (
                <Box
                  sx={{
                    width:      2,
                    flexGrow:   1,
                    bgcolor:    '#E0E0E0',
                    minHeight:  32,
                    mt:         0.5,
                  }}
                />
              )}
            </Box>

            {/* Content */}
            <Box flexGrow={1}>
              <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                <Box>
                  <Typography
                    fontFamily="Albert Sans, sans-serif"
                    fontWeight={600}
                    fontSize={14}
                    color="#3D484B"
                  >
                    {ep.title}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" fontFamily="Albert Sans, sans-serif">
                    {fmtDate(ep.startDate)}
                    {' → '}
                    {fmtDate(ep.endDate)}
                    {ep.episodeType && (
                      <>
                        {' · '}
                        {EPISODE_TYPE_LABELS[ep.episodeType]}
                      </>
                    )}
                  </Typography>
                </Box>
                <EpisodeStatusBadge status={ep.status} />
              </Stack>

              {ep.primaryDiagnosis && (
                <Chip
                  label={ep.primaryDiagnosis}
                  size="small"
                  variant="outlined"
                  sx={{
                    mt:         0.5,
                    fontFamily: 'Albert Sans, sans-serif',
                    fontSize:   11,
                    color:      '#327C8D',
                    borderColor: '#327C8D',
                  }}
                />
              )}

              {ep.summary && (
                <Typography
                  variant="body2"
                  color="text.secondary"
                  fontFamily="Albert Sans, sans-serif"
                  mt={0.5}
                  sx={{ whiteSpace: 'pre-line' }}
                >
                  {ep.summary}
                </Typography>
              )}
            </Box>
          </Stack>

          {idx < episodes.length - 1 && <Divider />}
        </Box>
      ))}
    </Box>
  );
};
