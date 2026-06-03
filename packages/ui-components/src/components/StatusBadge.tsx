import React from 'react';
import { Chip } from '@mui/material';

export type ClinicalStatus =
  | 'active'
  | 'inactive'
  | 'pending'
  | 'draft'
  | 'completed'
  | 'cancelled'
  | 'overdue';

export interface SignacareStatusBadgeProps {
  status: ClinicalStatus;
}

const STATUS_STYLES: Record<
  ClinicalStatus,
  { label: string; bg: string; color: string }
> = {
  active: {
    label: 'Active',
    bg: 'rgba(78,156,130,0.12)',
    color: '#2D7A61',
  },
  inactive: {
    label: 'Inactive',
    bg: 'rgba(61,72,75,0.08)',
    color: '#3D484B',
  },
  pending: {
    label: 'Pending',
    bg: 'rgba(240,133,44,0.12)',
    color: '#B85E10',
  },
  draft: {
    label: 'Draft',
    bg: 'rgba(61,72,75,0.06)',
    color: '#3D484B',
  },
  completed: {
    label: 'Completed',
    bg: 'rgba(78,156,130,0.12)',
    color: '#2D7A61',
  },
  cancelled: {
    label: 'Cancelled',
    bg: 'rgba(211,47,47,0.10)',
    color: '#C62828',
  },
  overdue: {
    label: 'Overdue',
    bg: 'rgba(211,47,47,0.10)',
    color: '#C62828',
  },
};

export function SignacareStatusBadge({
  status,
}: SignacareStatusBadgeProps): React.ReactElement {
  const style = STATUS_STYLES[status];

  return (
    <Chip
      label={style.label}
      size="small"
      sx={{
        bgcolor: style.bg,
        color: style.color,
        fontFamily: 'Albert Sans, sans-serif',
        fontWeight: 600,
        fontSize: '0.75rem',
        textTransform: 'uppercase',
        borderRadius: 8,
      }}
    />
  );
}
