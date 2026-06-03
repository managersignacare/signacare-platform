// apps/web/src/features/auth/components/PasswordResetForm.tsx
import { useState } from 'react';
import {
  Box, Card, CardContent, TextField, Button, Alert,
  Typography, CircularProgress, IconButton, InputAdornment,
} from '@mui/material';
import { Visibility, VisibilityOff, CheckCircleOutline } from '@mui/icons-material';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { apiClient } from '../../../shared/services/apiClient';
import {
  PasswordResetRequestSchema,
  PasswordResetConfirmSchema,
  type PasswordResetRequestDTO,
  type PasswordResetConfirmDTO,
} from '../types/authTypes';

function RequestResetForm() {
  const [sent, setSent] = useState(false);

  // @no-invalidate-needed: request-reset is a write-only email trigger with no cached query surface in this route.
  const { mutate, isPending, error } = useMutation({
    mutationFn: (dto: PasswordResetRequestDTO) =>
      apiClient.post('auth/password-reset/request', dto),
    onSuccess: () => setSent(true),
  });

  const { register, handleSubmit, formState: { errors } } =
    useForm<PasswordResetRequestDTO>({ resolver: zodResolver(PasswordResetRequestSchema) });

  if (sent) {
    return (
      <Box sx={{ textAlign: 'center', py: 2 }}>
        <CheckCircleOutline sx={{ fontSize: 48, color: '#4E9C82', mb: 1 }} />
        <Typography variant="h6" sx={{ fontFamily: '"Albert Sans", sans-serif', fontWeight: 700, color: '#3D484B' }}>
          Check your email
        </Typography>
        <Typography variant="body2" sx={{ color: '#666', mt: 1 }}>
          If that address is registered, a reset link has been sent.
        </Typography>
        <Typography
          component="a" href="/login" variant="body2"
          sx={{ display: 'inline-block', mt: 2, color: '#327C8D', textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}
        >
          ← Return to sign in
        </Typography>
      </Box>
    );
  }

  const errorMessage = error != null
    ? ((error as { message?: string }).message ?? 'Request failed. Please try again.')
    : null;

  return (
    <Box component="form" onSubmit={handleSubmit((dto) => mutate(dto))} noValidate>
      <Typography variant="h6" sx={{ fontFamily: '"Albert Sans", sans-serif', fontWeight: 700, color: '#3D484B', mb: 0.5 }}>
        Reset your password
      </Typography>
      <Typography variant="body2" sx={{ color: '#666', mb: 3 }}>
        Enter your work email and we'll send a reset link.
      </Typography>

      {errorMessage != null && (
        <Alert role="alert" severity="error" sx={{ mb: 2, backgroundColor: '#FFF0E6', color: '#3D484B', border: '1px solid #F0852C', '& .MuiAlert-icon': { color: '#F0852C' } }}>
          {errorMessage}
        </Alert>
      )}

      <TextField
        {...register('email')} label="Email address" type="email" fullWidth autoFocus
        autoComplete="email" error={!!errors.email} helperText={errors.email?.message} sx={{ mb: 3 }}
      />

      <Button type="submit" fullWidth variant="contained" disabled={isPending}
        sx={{ backgroundColor: '#327C8D', color: '#FFFFFF', fontFamily: '"Albert Sans", sans-serif', fontWeight: 600, py: 1.5, borderRadius: 2, textTransform: 'none', fontSize: '1rem', '&:hover': { backgroundColor: '#2a6878' }, '&.Mui-disabled': { backgroundColor: '#b0bec5' } }}
      >
        {isPending ? <CircularProgress role="progressbar" aria-label="Loading" size={22} color="inherit" /> : 'Send reset link'}
      </Button>

      <Typography variant="body2" sx={{ textAlign: 'center', mt: 2 }}>
        <Typography component="a" href="/login" variant="body2"
          sx={{ color: '#327C8D', textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}>
          ← Back to sign in
        </Typography>
      </Typography>
    </Box>
  );
}

interface ConfirmResetFormProps { token: string; }

function ConfirmResetForm({ token }: ConfirmResetFormProps) {
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [done, setDone] = useState(false);

  // @no-invalidate-needed: token-confirm reset runs on a standalone flow; this route does not consume a related query cache.
  const { mutate, isPending, error } = useMutation({
    mutationFn: (dto: PasswordResetConfirmDTO) =>
      apiClient.post('auth/password-reset/confirm', dto),
    onSuccess: () => setDone(true),
  });

  const { register, handleSubmit, formState: { errors } } = useForm<PasswordResetConfirmDTO>({
    resolver: zodResolver(PasswordResetConfirmSchema),
    defaultValues: { token },
  });

  if (done) {
    return (
      <Box sx={{ textAlign: 'center', py: 2 }}>
        <CheckCircleOutline sx={{ fontSize: 48, color: '#4E9C82', mb: 1 }} />
        <Typography variant="h6" sx={{ fontFamily: '"Albert Sans", sans-serif', fontWeight: 700, color: '#3D484B' }}>
          Password updated
        </Typography>
        <Typography component="a" href="/login" variant="body2"
          sx={{ display: 'inline-block', mt: 2, color: '#327C8D', textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}>
          Sign in with your new password →
        </Typography>
      </Box>
    );
  }

  const errorMessage = error != null
    ? ((error as { message?: string }).message ?? 'Reset failed. The link may have expired.')
    : null;

  return (
    <Box component="form" onSubmit={handleSubmit((dto) => mutate(dto))} noValidate>
      <Typography variant="h6" sx={{ fontFamily: '"Albert Sans", sans-serif', fontWeight: 700, color: '#3D484B', mb: 3 }}>
        Choose a new password
      </Typography>

      {errorMessage != null && (
        <Alert role="alert" severity="error" sx={{ mb: 2, backgroundColor: '#FFF0E6', color: '#3D484B', border: '1px solid #F0852C', '& .MuiAlert-icon': { color: '#F0852C' } }}>
          {errorMessage}
        </Alert>
      )}

      <input type="hidden" {...register('token')} />

      <TextField
        {...register('newPassword')} label="New password" type={showNew ? 'text' : 'password'}
        fullWidth autoFocus error={!!errors.newPassword}
        helperText={errors.newPassword?.message ?? 'Min 12 chars, upper, lower, number, special'}
        InputProps={{ endAdornment: (<InputAdornment position="end"><IconButton onClick={() => setShowNew((p) => !p)} edge="end">{showNew ? <VisibilityOff /> : <Visibility />}</IconButton></InputAdornment>) }}
        sx={{ mb: 2 }}
      />
      <TextField
        {...register('confirmPassword')} label="Confirm new password" type={showConfirm ? 'text' : 'password'}
        fullWidth error={!!errors.confirmPassword} helperText={errors.confirmPassword?.message}
        InputProps={{ endAdornment: (<InputAdornment position="end"><IconButton onClick={() => setShowConfirm((p) => !p)} edge="end">{showConfirm ? <VisibilityOff /> : <Visibility />}</IconButton></InputAdornment>) }}
        sx={{ mb: 3 }}
      />

      <Button type="submit" fullWidth variant="contained" disabled={isPending}
        sx={{ backgroundColor: '#327C8D', color: '#FFFFFF', fontFamily: '"Albert Sans", sans-serif', fontWeight: 600, py: 1.5, borderRadius: 2, textTransform: 'none', fontSize: '1rem', '&:hover': { backgroundColor: '#2a6878' }, '&.Mui-disabled': { backgroundColor: '#b0bec5' } }}
      >
        {isPending ? <CircularProgress role="progressbar" aria-label="Loading" size={22} color="inherit" /> : 'Update password'}
      </Button>
    </Box>
  );
}

interface PasswordResetFormProps { token?: string; }

export function PasswordResetForm({ token }: PasswordResetFormProps) {
  return (
    <Box component="main" sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#FBF8F5', px: 2 }}>
      <Card elevation={0} sx={{ width: '100%', maxWidth: 420, borderRadius: 3, boxShadow: '0 4px 24px rgba(61,72,75,0.12)', backgroundColor: '#FFFFFF' }}>
        <CardContent sx={{ p: 4 }}>
          <Typography component="div" sx={{ fontFamily: '"Albert Sans", sans-serif', fontWeight: 700, fontSize: '1.5rem', color: '#327C8D', textAlign: 'center', mb: 3 }}>
            SIGNACARE
          </Typography>
          {token != null && token !== '' ? <ConfirmResetForm token={token} /> : <RequestResetForm />}
        </CardContent>
      </Card>
    </Box>
  );
}
