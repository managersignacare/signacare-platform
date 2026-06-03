import { Chip }            from '@mui/material';
import type { EpisodeStatus } from '../types/episodeTypes';
import {
  EPISODE_STATUS_LABELS,
  EPISODE_STATUS_COLOURS,
} from '../types/episodeTypes';

interface Props {
  status: EpisodeStatus;
  size?:  'small' | 'medium';
}

export const EpisodeStatusBadge = ({ status, size = 'small' }: Props) => (
  <Chip
    size={size}
    label={EPISODE_STATUS_LABELS[status]}
    sx={{
      backgroundColor: EPISODE_STATUS_COLOURS[status],
      color:           '#FFFFFF',
      fontFamily:      'Albert Sans, sans-serif',
      fontWeight:      600,
      fontSize:        size === 'small' ? 11 : 13,
      minWidth:        90,
    }}
  />
);
