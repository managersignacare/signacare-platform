import { Box, Dialog, DialogContent, DialogTitle, Divider, Typography } from '@mui/material';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

const SHORTCUTS: { key: string; label: string; action: string }[] = [
  { key: 'g d', label: 'Go to Dashboard', action: '/dashboard' },
  { key: 'g p', label: 'Go to Patients', action: '/patients' },
  { key: 'g a', label: 'Go to Appointments', action: '/appointments' },
  { key: 'g i', label: 'Go to Intake', action: '/referrals' },
  { key: 'g s', label: 'Go to Settings', action: '/settings' },
  { key: 'g t', label: 'Go to Tasks', action: '/tasks' },
  { key: 'g x', label: 'Go to AI Assistant', action: '/ai-agent' },
  { key: 'g y', label: 'Go to Agentic Scribe', action: '/agentic-scribe' },
  { key: 'g e', label: 'Go to Exports', action: '/exports' },
  { key: '/', label: 'Focus search', action: 'focus-search' },
  { key: '?', label: 'Show shortcuts', action: 'show-help' },
  { key: 'Esc', label: 'Close dialog / panel', action: 'escape' },
];

export function KeyboardShortcutHandler() {
  const navigate = useNavigate();
  const [helpOpen, setHelpOpen] = useState(false);
  const [pendingKey, setPendingKey] = useState('');

  useEffect(() => {
    let timer: NodeJS.Timeout;

    const handler = (e: KeyboardEvent) => {
      // Don't intercept when typing in input/textarea
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const key = e.key;

      if (key === '?') { e.preventDefault(); setHelpOpen(true); return; }
      if (key === 'Escape') { setHelpOpen(false); setPendingKey(''); return; }

      if (pendingKey === 'g') {
        const combo = `g ${key}`;
        const shortcut = SHORTCUTS.find(s => s.key === combo);
        if (shortcut && shortcut.action.startsWith('/')) {
          e.preventDefault();
          navigate(shortcut.action);
        }
        setPendingKey('');
        return;
      }

      if (key === 'g') {
        setPendingKey('g');
        timer = setTimeout(() => setPendingKey(''), 1000);
        return;
      }
    };

    window.addEventListener('keydown', handler);
    return () => { window.removeEventListener('keydown', handler); clearTimeout(timer); };
  }, [navigate, pendingKey]);

  return (
    <>
      {/* Pending key indicator */}
      {pendingKey && (
        <Box sx={{
          position: 'fixed', bottom: 16, right: 16, zIndex: 9999,
          bgcolor: '#3D484B', color: '#fff', px: 2, py: 1, borderRadius: 2,
          fontSize: 13, fontFamily: 'monospace', boxShadow: 4,
        }}>
          g + ...
        </Box>
      )}

      {/* Shortcuts Help Dialog */}
      <Dialog aria-labelledby="dialog-title" open={helpOpen} onClose={() => setHelpOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle id="dialog-title" sx={{ fontWeight: 700 }}>Keyboard Shortcuts</DialogTitle>
        <Divider />
        <DialogContent>
          <Typography variant="overline" color="text.secondary">Navigation</Typography>
          {SHORTCUTS.filter(s => s.key.startsWith('g')).map(s => (
            <Box key={s.key} sx={{ display: 'flex', justifyContent: 'space-between', py: 0.5 }}>
              <Typography variant="body2">{s.label}</Typography>
              <Box sx={{ display: 'flex', gap: 0.5 }}>
                {s.key.split(' ').map((k, i) => (
                  <Box key={i} sx={{ px: 1, py: 0.25, bgcolor: '#F5F5F5', border: '1px solid #ddd', borderRadius: 0.5, fontFamily: 'monospace', fontSize: 12 }}>{k}</Box>
                ))}
              </Box>
            </Box>
          ))}
          <Divider sx={{ my: 1 }} />
          <Typography variant="overline" color="text.secondary">General</Typography>
          {SHORTCUTS.filter(s => !s.key.startsWith('g')).map(s => (
            <Box key={s.key} sx={{ display: 'flex', justifyContent: 'space-between', py: 0.5 }}>
              <Typography variant="body2">{s.label}</Typography>
              <Box sx={{ px: 1, py: 0.25, bgcolor: '#F5F5F5', border: '1px solid #ddd', borderRadius: 0.5, fontFamily: 'monospace', fontSize: 12 }}>{s.key}</Box>
            </Box>
          ))}
        </DialogContent>
      </Dialog>
    </>
  );
}
