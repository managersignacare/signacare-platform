// apps/web/src/features/auth/components/MfaForm.tsx
import {
  Box,
  Card,
  CardContent,
  TextField,
  Button,
  Alert,
  Typography,
  CircularProgress,
} from '@mui/material';
import { LockOutlined } from '@mui/icons-material';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useVerifyMfa } from '../hooks/useLogin';

const MfaCodeSchema = z.object({
  code: z
    .string()
    .length(6, 'Enter your 6-digit code')
    .regex(/^\d{6}$/, 'Code must be 6 digits only'),
});
type MfaCodeForm = z.infer<typeof MfaCodeSchema>;

export function MfaForm() {
  const { mutate: verify, isPending, error } = useVerifyMfa();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<MfaCodeForm>({ resolver: zodResolver(MfaCodeSchema) });

  const errorMessage =
    error != null
      ? ((error as { message?: string }).message ?? 'Invalid code. Please try again.')
      : null;

  return (
    <Box
      component="main"
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#FBF8F5',
        px: 2,
      }}
    >
      <Card
        elevation={0}
        sx={{
          width: '100%',
          maxWidth: 400,
          borderRadius: 3,
          boxShadow: '0 4px 24px rgba(61,72,75,0.12)',
          backgroundColor: '#FFFFFF',
        }}
      >
        <CardContent sx={{ p: 4 }}>
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', mb: 3 }}>
            <Box
              sx={{
                width: 56,
                height: 56,
                borderRadius: '50%',
                backgroundColor: '#E8F4F7',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                mb: 2,
              }}
            >
              <LockOutlined sx={{ color: '#327C8D', fontSize: 28 }} />
            </Box>
            <Typography
              variant="h6"
              sx={{ fontFamily: '"Albert Sans", sans-serif', fontWeight: 700, color: '#3D484B' }}
            >
              Two-Factor Authentication
            </Typography>
            <Typography variant="body2" sx={{ color: '#666', textAlign: 'center', mt: 0.5 }}>
              Enter the 6-digit code from your authenticator app
            </Typography>
          </Box>

          {errorMessage != null && (
            <Alert role="alert"
              severity="error"
              sx={{
                mb: 2,
                backgroundColor: '#FFF0E6',
                color: '#3D484B',
                border: '1px solid #F0852C',
                '& .MuiAlert-icon': { color: '#F0852C' },
              }}
            >
              {errorMessage}
            </Alert>
          )}

          <Box component="form" onSubmit={handleSubmit(({ code }) => verify(code))} noValidate>
            <TextField
              {...register('code')}
              label="Authentication code"
              fullWidth
              autoComplete="one-time-code"
              autoFocus
              inputProps={{ maxLength: 6, inputMode: 'numeric', pattern: '[0-9]*' }}
              error={!!errors.code}
              helperText={errors.code?.message}
              sx={{
                mb: 3,
                '& input': {
                  fontFamily: '"Albert Sans", sans-serif',
                  fontSize: '1.5rem',
                  letterSpacing: '0.5rem',
                  textAlign: 'center',
                },
              }}
            />
            <Button
              type="submit"
              fullWidth
              variant="contained"
              disabled={isPending}
              sx={{
                backgroundColor: '#327C8D',
                color: '#FFFFFF',
                fontFamily: '"Albert Sans", sans-serif',
                fontWeight: 600,
                py: 1.5,
                borderRadius: 2,
                textTransform: 'none',
                fontSize: '1rem',
                '&:hover': { backgroundColor: '#2a6878' },
                '&.Mui-disabled': { backgroundColor: '#b0bec5' },
              }}
            >
              {isPending ? <CircularProgress role="progressbar" aria-label="Loading" size={22} color="inherit" /> : 'Verify Code'}
            </Button>
          </Box>

          <Typography variant="body2" sx={{ textAlign: 'center', mt: 2, color: '#666' }}>
            <Typography
              component="a"
              href="/login"
              variant="body2"
              sx={{
                color: '#327C8D',
                textDecoration: 'none',
                '&:hover': { textDecoration: 'underline' },
              }}
            >
              ← Back to sign in
            </Typography>
          </Typography>
        </CardContent>
      </Card>
    </Box>
  );
}
