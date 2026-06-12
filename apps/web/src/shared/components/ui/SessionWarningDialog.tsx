import { useRef, useEffect, useState } from 'react';
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, Typography, LinearProgress, Box, Alert } from '@mui/material';
import TimerOffIcon from '@mui/icons-material/TimerOff';
import { useSessionStore } from '../../store/sessionStore';
import { authApi } from '../../../features/auth/services/authApi';

const visuallyHidden: React.CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: 0,
};

export function SessionWarningDialog() {
  const show = useSessionStore((s) => s.showSessionWarning);
  const setShow = useSessionStore((s) => s.setShowSessionWarning);
  const secondsLeft = useSessionStore((s) => s.secondsLeft);
  const scribeActive = useSessionStore((s) => s.scribeActive);
  const sessionExpired = useSessionStore((s) => s.sessionExpired);

  // Announce countdown to screen readers every 30 seconds (not every tick)
  const [liveAnnouncement, setLiveAnnouncement] = useState('');
  const lastAnnouncedRef = useRef<number | null>(null);

  useEffect(() => {
    if (!show) {
      lastAnnouncedRef.current = null;
      setLiveAnnouncement('');
      return;
    }
    // Announce when the dialog first appears, then every 30 seconds, and when <= 10 seconds remain
    const shouldAnnounce =
      lastAnnouncedRef.current === null ||
      (lastAnnouncedRef.current - secondsLeft >= 30) ||
      (secondsLeft <= 10 && secondsLeft !== lastAnnouncedRef.current);

    if (shouldAnnounce && secondsLeft > 0) {
      setLiveAnnouncement(`Session expires in ${secondsLeft} seconds`);
      lastAnnouncedRef.current = secondsLeft;
    }
  }, [show, secondsLeft]);

  // "Session expired" banner — shown briefly after auto-logout before redirect to login
  if (sessionExpired) {
    return (
      <Dialog open role="alertdialog" aria-labelledby="expired-dialog-title" maxWidth="xs" fullWidth
        slotProps={{ backdrop: { sx: { bgcolor: 'rgba(0,0,0,0.8)' } } }}>
        <DialogContent sx={{ py: 4, textAlign: 'center' }}>
          <Alert id="expired-dialog-title" severity="warning" sx={{ justifyContent: 'center', mb: 1 }}>
            Session expired
          </Alert>
          <Typography variant="body2" color="text.secondary">
            Your session has ended due to inactivity. Redirecting to login...
          </Typography>
        </DialogContent>
      </Dialog>
    );
  }

  if (!show) return null;
  const progress = Math.max(0, (secondsLeft / 120) * 100);

  const handleExtend = async () => {
    // Refresh the server session to actually extend it
    try {
      await authApi.refreshSession();
    } catch {
      // If refresh fails, the 401 interceptor in apiClient will redirect to login
    }
    setShow(false);
  };

  return (
    <Dialog
      role="alertdialog"
      aria-labelledby="session-warning-title"
      aria-describedby="session-warning-description"
      open={show}
      onClose={handleExtend}
      maxWidth="xs"
      fullWidth
      slotProps={{ backdrop: { sx: { bgcolor: 'rgba(0,0,0,0.7)' } } }}
    >
      <DialogTitle id="session-warning-title" sx={{ display: 'flex', alignItems: 'center', gap: 1, pb: 1 }}>
        <TimerOffIcon sx={{ color: '#b8621a' }} />
        <Typography fontWeight={700}>Session Expiring</Typography>
      </DialogTitle>
      <DialogContent>
        <Typography id="session-warning-description" variant="body2" sx={{ mb: 2 }}>
          Your session will expire in <strong>{secondsLeft} seconds</strong> due to inactivity.
          {scribeActive && ' (AI Scribe activity keeps the session alive while recording or processing)'}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2, fontSize: 12 }}>
          Any unsaved work will be saved as a draft. Click "Extend Session" to continue.
        </Typography>
        <LinearProgress variant="determinate" value={progress}
          sx={{ height: 6, borderRadius: 3, bgcolor: '#f0ebe4',
            '& .MuiLinearProgress-bar': { bgcolor: secondsLeft <= 30 ? '#D32F2F' : '#b8621a' } }} />
        {/* Screen-reader countdown announcement — fires every 30s and in final 10s */}
        <Box aria-live="assertive" aria-atomic="true" style={visuallyHidden}>
          {liveAnnouncement}
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button variant="contained" onClick={handleExtend} size="large" fullWidth
          sx={{ bgcolor: '#327C8D', '&:hover': { bgcolor: '#265f6d' }, textTransform: 'none', fontWeight: 700 }}>
          Extend Session
        </Button>
      </DialogActions>
    </Dialog>
  );
}
