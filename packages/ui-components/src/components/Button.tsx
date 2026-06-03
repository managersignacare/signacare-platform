import React from 'react';
import {
  Button as MuiButton,
  type ButtonProps as MuiButtonProps,
  CircularProgress,
  styled,
} from '@mui/material';

export interface SignacareButtonProps
  extends Omit<MuiButtonProps, 'variant' | 'color' | 'size'> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  fullWidth?: boolean;
}

type RequiredVariant = NonNullable<SignacareButtonProps['variant']>;
type RequiredSize = NonNullable<SignacareButtonProps['size']>;

const SIZE_MAP: Record<RequiredSize, MuiButtonProps['size']> = {
  sm: 'small',
  md: 'medium',
  lg: 'large',
};

const StyledButton = styled(MuiButton, {
  shouldForwardProp: (prop) => prop !== 'signacareVariant',
})<{
  signacareVariant: RequiredVariant;
}>(({ signacareVariant }) => {
  const base = {
    textTransform: 'none' as const,
    fontFamily: 'Albert Sans, sans-serif',
    fontWeight: 600,
    borderRadius: '8px',
    letterSpacing: '0.01em',
    boxShadow: 'none',
    '&:hover': {
      boxShadow: 'none',
    },
  };

  const variants: Record<RequiredVariant, object> = {
    primary: {
      ...base,
      backgroundColor: '#327C8D',
      color: '#FFFFFF',
      '&:hover': {
        ...base['&:hover'],
        backgroundColor: '#286877',
      },
      '&:active': {
        backgroundColor: '#1F5361',
      },
      '&.Mui-disabled': {
        backgroundColor: '#BDDDE3',
        color: '#FFFFFF',
      },
    },
    secondary: {
      ...base,
      backgroundColor: '#4E9C82',
      color: '#FFFFFF',
      '&:hover': {
        ...base['&:hover'],
        backgroundColor: '#3D7D68',
      },
      '&:active': {
        backgroundColor: '#2E5F4F',
      },
      '&.Mui-disabled': {
        backgroundColor: '#B5D9CE',
        color: '#FFFFFF',
      },
    },
    danger: {
      ...base,
      backgroundColor: '#F0852C',
      color: '#FFFFFF',
      '&:hover': {
        ...base['&:hover'],
        backgroundColor: '#D4701C',
      },
      '&:active': {
        backgroundColor: '#B85E10',
      },
      '&.Mui-disabled': {
        backgroundColor: '#F9C89A',
        color: '#FFFFFF',
      },
    },
    ghost: {
      ...base,
      backgroundColor: 'transparent',
      color: '#327C8D',
      border: '1.5px solid #327C8D',
      '&:hover': {
        ...base['&:hover'],
        backgroundColor: 'rgba(50,124,141,0.06)',
      },
      '&:active': {
        backgroundColor: 'rgba(50,124,141,0.12)',
      },
      '&.Mui-disabled': {
        backgroundColor: 'transparent',
        color: '#BDDDE3',
        borderColor: '#BDDDE3',
      },
    },
  };

  // Explicitly casting the key to satisfy TypeScript's indexing requirements
  return variants[signacareVariant as RequiredVariant];
});

export const SignacareButton = React.forwardRef<HTMLButtonElement, SignacareButtonProps>(
  function SignacareButton(
    {
      variant = 'primary',
      size = 'md',
      loading = false,
      disabled,
      children,
      fullWidth,
      startIcon,
      ...rest
    },
    ref,
  ) {
    return (
      <StyledButton
        ref={ref}
        signacareVariant={variant}
        size={SIZE_MAP[size]}
        disabled={disabled ?? loading}
        fullWidth={fullWidth}
        startIcon={
          loading ? (
            <CircularProgress
              size={size === 'sm' ? 14 : size === 'lg' ? 20 : 16}
              sx={{ color: 'inherit' }}
            />
          ) : (
            startIcon
          )
        }
        {...rest}
      >
        {children}
      </StyledButton>
    );
  },
);