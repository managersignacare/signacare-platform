import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Alert, Box, Button, Card, CardContent, CircularProgress,
  IconButton, InputAdornment, TextField, Typography,
} from '@mui/material';
import { Visibility, VisibilityOff } from '@mui/icons-material';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { authApi } from '../services/authApi';
import { useAuthStore } from '../../../store/authStore';
import { authKeys } from '../queryKeys';
import { useBrandingStore } from '../../../shared/store/brandingStore';

interface ErrorWithMessage {
  response?: {
    data?: {
      error?: string;
    };
  };
  message?: string;
}

function getErrorMessage(error: unknown): string | null {
  if (!error) return null;
  const maybe = error as ErrorWithMessage;
  return maybe.response?.data?.error ?? maybe.message ?? null;
}

export default function ChangePasswordPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isForced = searchParams.get('forced') === '1';
  const login = useAuthStore(s => s.login);
  const resetBranding = useBrandingStore((s) => s.resetBranding);
  const queryClient = useQueryClient();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [success, setSuccess] = useState(false);

  // @no-invalidate-needed: success path force-logs out and clears cache before navigation.
  const mutation = useMutation({
    mutationFn: (data: { currentPassword: string; newPassword: string }) =>
      authApi.changePassword(data),
    onSuccess: (result) => {
      setSuccess(true);
      queryClient.clear();
      resetBranding();
      login(result.user);
      void queryClient.invalidateQueries({ queryKey: authKeys.all });
      setTimeout(() => {
        navigate('/dashboard', { replace: true });
      }, 1200);
    },
  });

  const errorMsg = getErrorMessage(mutation.error);

  const passwordValid = newPassword.length >= 8 &&
    /[a-z]/.test(newPassword) && /[A-Z]/.test(newPassword) &&
    /\d/.test(newPassword) && /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~]/.test(newPassword);
  const passwordsMatch = newPassword === confirmPassword;
  const canSubmit = currentPassword && newPassword && confirmPassword && passwordValid && passwordsMatch && !mutation.isPending;

  return (
    <Box component="main" sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#FBF8F5', px: 2 }}>
      <Card elevation={0} sx={{ width: '100%', maxWidth: 440, borderRadius: 3, boxShadow: '0 4px 24px rgba(61,72,75,0.12)' }}>
        <CardContent sx={{ p: 4 }}>
          {isForced && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              You are using a temporary password. Please set a new password before continuing.
            </Alert>
          )}

          <Typography variant="h5" sx={{ fontFamily: '"Albert Sans", sans-serif', fontWeight: 700, color: '#1D2D44', mb: 0.5, textAlign: 'center' }}>
            Change Password
          </Typography>
          <Typography variant="body2" sx={{ textAlign: 'center', color: '#3D484B', mb: 3, fontFamily: '"Albert Sans", sans-serif' }}>
            {isForced ? 'Set your new password to continue' : 'Update your password'}
          </Typography>

          {success && (
            <Alert severity="success" sx={{ mb: 2 }}>Password changed successfully. Redirecting you to the dashboard...</Alert>
          )}
          {errorMsg && <Alert severity="error" sx={{ mb: 2 }}>{errorMsg}</Alert>}

          <Box component="form" onSubmit={e => { e.preventDefault(); if (canSubmit) mutation.mutate({ currentPassword, newPassword }); }} noValidate>
            <TextField
              label={isForced ? 'Temporary Password' : 'Current Password'}
              type={showCurrent ? 'text' : 'password'}
              fullWidth autoFocus value={currentPassword}
              onChange={e => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
              InputProps={{
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton onClick={() => setShowCurrent(p => !p)} edge="end" size="small">
                      {showCurrent ? <VisibilityOff /> : <Visibility />}
                    </IconButton>
                  </InputAdornment>
                ),
              }}
              sx={{ mb: 2 }}
            />
            <TextField
              label="New Password" type={showNew ? 'text' : 'password'}
              fullWidth value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              autoComplete="new-password"
              error={!!newPassword && !passwordValid}
              helperText={newPassword && !passwordValid ? 'Min 8 chars, 1 uppercase, 1 lowercase, 1 number, 1 special character' : ''}
              InputProps={{
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton onClick={() => setShowNew(p => !p)} edge="end" size="small">
                      {showNew ? <VisibilityOff /> : <Visibility />}
                    </IconButton>
                  </InputAdornment>
                ),
              }}
              sx={{ mb: 2 }}
            />
            <TextField
              label="Confirm New Password" type="password"
              fullWidth value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
              error={!!confirmPassword && !passwordsMatch}
              helperText={confirmPassword && !passwordsMatch ? 'Passwords do not match' : ''}
              sx={{ mb: 3 }}
            />
            <Button
              type="submit" fullWidth variant="contained" disabled={!canSubmit}
              sx={{
                backgroundColor: '#327C8D', fontFamily: '"Albert Sans", sans-serif', fontWeight: 600,
                py: 1.5, borderRadius: 2, textTransform: 'none', fontSize: '1rem',
                '&:hover': { backgroundColor: '#2a6878' },
              }}
            >
              {mutation.isPending ? <CircularProgress size={22} color="inherit" /> : 'Change Password'}
            </Button>
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
}
