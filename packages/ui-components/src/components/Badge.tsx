import React from 'react';
import { Chip } from '@mui/material';

export type BadgeVariant =
  | 'default'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info';

export interface SignacareBadgeProps {
  label: string;
  variant?: BadgeVariant;
  size?: 'small' | 'medium';
  icon?: React.ReactElement;
  onDelete?: () => void;
}

const VARIANT_STYLES: Record<
  BadgeVariant,
  { bg: string; color: string; border: string }
> = {
  default: {
    bg: 'rgba(61,72,75,0.08)',
    color: '#3D484B',
    border: 'transparent',
  },
  success: {
    bg: 'rgba(78,156,130,0.12)',
    color: '#2D7A61',
    border: 'rgba(78,156,130,0.3)',
  },
  warning: {
    bg: 'rgba(240,133,44,0.12)',
    color: '#B85E10',
    border: 'rgba(240,133,44,0.3)',
  },
  danger: {
    bg: 'rgba(211,47,47,0.10)',
    color: '#C62828',
    border: 'rgba(211,47,47,0.25)',
  },
  info: {
    bg: 'rgba(50,124,141,0.10)',
    color: '#1F5F70',
    border: 'rgba(50,124,141,0.25)',
  },
};

export const SignacareBadge: React.FC<SignacareBadgeProps> = ({
  label,
  variant = 'default',
  size = 'small',
  icon,
  onDelete,
}) => {
  const styles = VARIANT_STYLES[variant];

  return (
    <Chip
      label={label}
      size={size}
      icon={icon}
      onDelete={onDelete}
      sx={{
        fontFamily: 'Albert Sans, sans-serif',
        fontWeight: 600,
        fontSize: size === 'small' ? '0.72rem' : '0.8rem',
        letterSpacing: '0.02em',
        backgroundColor: styles.bg,
        color: styles.color,
        border: `1px solid ${styles.border}`,
        borderRadius: 6,
        height: size === 'small' ? 22 : 28,
        '& .MuiChip-icon': {
          color: styles.color,
        },
        '& .MuiChip-deleteIcon': {
          color: styles.color,
          opacity: 0.6,
          '&:hover': {
            opacity: 1,
          },
        },
      }}
    />
  );
};
