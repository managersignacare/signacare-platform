import React, { useId } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  IconButton,
  styled,
  type DialogProps,
} from '@mui/material';

import CloseIcon from '@mui/icons-material/Close';

export interface SignacareModalProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  hideCloseButton?: boolean;
  disableBackdropClose?: boolean;
  fullScreen?: boolean;
  'aria-describedby'?: string;
}

type RequiredSize = NonNullable<SignacareModalProps['size']>;

const SIZE_MAP: Record<RequiredSize, DialogProps['maxWidth']> = {
  sm: 'sm',
  md: 'md',
  lg: 'lg',
  xl: 'xl',
};

const StyledDialog = styled(Dialog)({
  '& .MuiDialog-paper': {
    borderRadius: 12,
    fontFamily: 'Albert Sans, sans-serif',
    backgroundColor: '#FFFFFF',
    boxShadow: '0px 8px 32px rgba(61,72,75,0.18)',
  },
});

const StyledDialogTitle = styled(DialogTitle)({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '16px 24px',
  borderBottom: '1px solid rgba(61,72,75,0.12)',
  fontFamily: 'Albert Sans, sans-serif',
  fontWeight: 700,
  fontSize: '1.1rem',
  color: '#3D484B',
});

export function SignacareModal({
  open,
  onClose,
  title,
  children,
  footer,
  size = 'md',
  hideCloseButton = false,
  disableBackdropClose = false,
  fullScreen = false,
  'aria-describedby': ariaDescribedby,
}: SignacareModalProps): React.ReactElement {
  const titleId = useId();

  const handleClose: DialogProps['onClose'] = (
    _event,
    reason,
  ) => {
    if (disableBackdropClose && reason === 'backdropClick') {
      return;
    }
    onClose();
  };

  return (
    <StyledDialog
      open={open}
      onClose={handleClose}
      maxWidth={SIZE_MAP[size]}
      fullWidth
      fullScreen={fullScreen}
      aria-labelledby={title ? titleId : undefined}
      aria-describedby={ariaDescribedby}
    >
      {title !== undefined && (
        <StyledDialogTitle id={titleId}>
          <span>{title}</span>
          {!hideCloseButton && (
            <IconButton
              aria-label="Close dialog"
              size="small"
              onClick={onClose}
              sx={{
                color: '#3D484B',
                '&:hover': {
                  bgcolor: 'rgba(61,72,75,0.08)',
                },
              }}
            >
              <CloseIcon fontSize="small" />
            </IconButton>
          )}
        </StyledDialogTitle>
      )}
      <DialogContent
        sx={{
          p: 3,
          fontFamily: 'Albert Sans, sans-serif',
          color: '#3D484B',
        }}
      >
        {children}
      </DialogContent>
      {footer !== undefined && (
        <DialogActions
          sx={{
            px: 3,
            py: 2,
            borderTop: '1px solid rgba(61,72,75,0.12)',
            gap: 1,
          }}
        >
          {footer}
        </DialogActions>
      )}
    </StyledDialog>
  );
}
