import React from 'react';
import {
  Box,
  Button,
  Typography,
  Paper,
} from '@mui/material';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import { useFeatureFlag } from '../../hooks/useFeatureFlag';

interface Props {
  children: React.ReactNode;
  // Custom fallback rendered instead of the default error UI
  fallback?: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

interface ErrorBoundaryCoreProps extends Props {
  allowRawDetails: boolean;
}

const RAW_ERROR_DETAILS_FLAG = 'b5-error-boundary-raw-details';
const SAFE_ERROR_MESSAGE = 'An unexpected error occurred in this section. Please try again.';

interface ErrorMessagePolicy {
  allowRawDetails: boolean;
}

export function resolveErrorBoundaryMessage(
  error: Error | null,
  policy: ErrorMessagePolicy,
): string {
  const rawMessage = typeof error?.message === 'string'
    ? error.message.trim()
    : '';
  if (policy.allowRawDetails && rawMessage.length > 0) {
    return rawMessage;
  }
  return SAFE_ERROR_MESSAGE;
}

class ErrorBoundaryCore extends React.Component<
  ErrorBoundaryCoreProps,
  State
> {
  constructor(props: ErrorBoundaryCoreProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  override componentDidCatch(
    error: Error,
    info: React.ErrorInfo,
  ): void {
    // In production connect to Sentry
    // Sentry.captureException(error, { extra: info });
    // eslint-disable-next-line no-console
    console.error('Signacare ErrorBoundary', error, info.componentStack);
  }

  private handleReset = (): void => {
    this.setState({ hasError: false, error: null });
  };

  override render(): React.ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    if (this.props.fallback) {
      return this.props.fallback;
    }

    const message = resolveErrorBoundaryMessage(this.state.error, {
      allowRawDetails: this.props.allowRawDetails,
    });

    return (
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          p: 4,
          minHeight: 300,
        }}
      >
        <Paper
          variant="outlined"
          sx={{
            p: 4,
            maxWidth: 480,
            width: '100%',
            textAlign: 'center',
            borderRadius: 2,
          }}
        >
          <ErrorOutlineIcon
            sx={{
              fontSize: 48,
              color: '#F0852C',
              mb: 2,
            }}
          />
          <Typography
            variant="h6"
            fontWeight={600}
            gutterBottom
          >
            Something went wrong
          </Typography>
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ mb: 3 }}
          >
            {message}
          </Typography>
          <Button
            variant="contained"
            color="primary"
            onClick={this.handleReset}
          >
            Try again
          </Button>
        </Paper>
      </Box>
    );
  }
}

export function ErrorBoundary(props: Props): React.ReactElement {
  const rawDetailsEnabled = useFeatureFlag(RAW_ERROR_DETAILS_FLAG);
  const allowRawDetails = import.meta.env.DEV || rawDetailsEnabled;
  return (
    <ErrorBoundaryCore
      {...props}
      allowRawDetails={allowRawDetails}
    />
  );
}
