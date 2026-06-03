/**
 * MFA Challenge Dialog — requires TOTP code (or password) before sensitive actions.
 * Used as a gate for: digital signature, medication prescriptions, ECT/TMS consent.
 *
 * Usage:
 *   <MfaChallengeDialog
 *     open={showMfa}
 *     title="Sign Discharge Summary"
 *     onVerified={() => { performSensitiveAction(); setShowMfa(false); }}
 *     onClose={() => setShowMfa(false)}
 *   />
 */
import { Alert, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Divider, TextField, Typography } from '@mui/material';
import LockIcon from '@mui/icons-material/Lock';
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { apiClient } from '../../services/apiClient';

interface MfaChallengeProps {
  open: boolean;
  onClose: () => void;
  onVerified: () => void;
  title?: string;
  description?: string;
}

interface ErrorWithMessage {
  message?: string;
}

function getErrorMessage(error: unknown, fallback: string): string {
  const maybe = error as ErrorWithMessage;
  return maybe.message ?? fallback;
}

export function MfaChallengeDialog({ open, onClose, onVerified, title = 'Verification Required', description }: MfaChallengeProps) {
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'mfa' | 'password'>('mfa');

  // @no-invalidate-needed: challenge verification gates an action but does not update a query-backed resource directly.
  const verifyMut = useMutation({
    mutationFn: async () => {
      if (mode === 'mfa') {
        const resp = await apiClient.post<{ verified: boolean }>('auth/verify-mfa-challenge', { code });
        if (!resp.verified) throw new Error('Invalid MFA code');
      } else {
        const resp = await apiClient.post<{ verified: boolean }>('auth/verify-password-challenge', { password });
        if (!resp.verified) throw new Error('Incorrect password');
      }
    },
    onSuccess: () => {
      setCode('');
      setPassword('');
      onVerified();
    },
  });

  const handleSubmit = () => {
    if (mode === 'mfa' && code.length >= 6) verifyMut.mutate();
    else if (mode === 'password' && password.length >= 1) verifyMut.mutate();
  };

  return (
    <Dialog aria-labelledby="mfa-dialog-title" open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle id="mfa-dialog-title" sx={{ display: 'flex', alignItems: 'center', gap: 1, fontWeight: 700 }}>
        <LockIcon sx={{ color: '#327C8D' }} /> {title}
      </DialogTitle>
      <Divider />
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {description ?? 'This action requires additional verification for security and audit compliance.'}
        </Typography>

        {verifyMut.isError && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {getErrorMessage(verifyMut.error, 'Verification failed. Please try again.')}
          </Alert>
        )}

        {mode === 'mfa' ? (
          <>
            <TextField
              autoFocus
              label="MFA Code"
              fullWidth
              size="small"
              value={code}
              onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="Enter 6-digit code from authenticator"
              inputProps={{ maxLength: 6, inputMode: 'numeric', style: { letterSpacing: '0.3em', fontWeight: 700, fontSize: 18, textAlign: 'center' } }}
              onKeyDown={e => e.key === 'Enter' && handleSubmit()}
            />
            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
              Enter the code from your authenticator app.{' '}
              <Button size="small" sx={{ p: 0, minWidth: 0, fontSize: 11 }} onClick={() => setMode('password')}>
                Use password instead
              </Button>
            </Typography>
          </>
        ) : (
          <>
            <TextField
              autoFocus
              label="Password"
              type="password"
              fullWidth
              size="small"
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSubmit()}
            />
            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
              Re-enter your login password to verify.{' '}
              <Button size="small" sx={{ p: 0, minWidth: 0, fontSize: 11 }} onClick={() => setMode('mfa')}>
                Use MFA code instead
              </Button>
            </Typography>
          </>
        )}
      </DialogContent>
      <Divider />
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} sx={{ color: 'text.secondary' }}>Cancel</Button>
        <Button
          variant="contained"
          onClick={handleSubmit}
          disabled={verifyMut.isPending || (mode === 'mfa' ? code.length < 6 : !password)}
          sx={{ bgcolor: '#327C8D', '&:hover': { bgcolor: '#265f6d' } }}
        >
          {verifyMut.isPending ? <CircularProgress size={18} /> : 'Verify & Proceed'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default MfaChallengeDialog;
