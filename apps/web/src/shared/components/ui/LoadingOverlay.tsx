import {
  Box,
  CircularProgress,
  Typography,
  Backdrop,
} from '@mui/material';

interface Props {
  // Renders as a full-screen backdrop over the entire viewport
  fullScreen?: boolean;
  message?: string;
}

export function LoadingOverlay({
  fullScreen = false,
  message,
}: Props): React.ReactElement {
  if (fullScreen) {
    return (
      <Backdrop
        open
        sx={{
          zIndex: (theme) => theme.zIndex.modal + 10,
          bgcolor: 'rgba(255,255,255,0.75)',
        }}
      >
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 2,
          }}
        >
          <CircularProgress role="progressbar" aria-label="Loading"
            size={48}
            sx={{ color: '#327C8D' }}
          />
          {message && (
            <Typography
              variant="body2"
              color="text.secondary"
            >
              {message}
            </Typography>
          )}
        </Box>
      </Backdrop>
    );
  }

  return (
    <Box
      role="status"
      aria-label={message ?? 'Loading'}
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        py: 8,
        gap: 2,
      }}
    >
      <CircularProgress role="progressbar" aria-label="Loading"
        size={36}
        sx={{ color: '#327C8D' }}
      />
      {message && (
        <Typography
          variant="body2"
          color="text.secondary"
        >
          {message}
        </Typography>
      )}
    </Box>
  );
}
