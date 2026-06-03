/**
 * Command Palette — Ctrl+K global search and quick actions
 * Inspired by Linear, Notion, VS Code command palettes.
 * Provides fuzzy search across patients, actions, and navigation.
 */
import { Box, Dialog, InputAdornment, List, ListItemButton, ListItemIcon, ListItemText, TextField, Typography } from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import PersonIcon from '@mui/icons-material/Person';
import NoteAddIcon from '@mui/icons-material/NoteAdd';
import MedicationIcon from '@mui/icons-material/Medication';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import DashboardIcon from '@mui/icons-material/Dashboard';
import AssignmentIcon from '@mui/icons-material/Assignment';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../services/apiClient';
import { sharedCommandPaletteKeys } from '../../queryKeys';

interface CommandItem {
  id: string;
  label: string;
  description?: string;
  icon: React.ReactNode;
  action: () => void;
  category: 'navigation' | 'patient' | 'action';
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const navigate = useNavigate();

  // Global Ctrl+K listener
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(true);
        setQuery('');
      }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Patient search
  const { data: patients } = useQuery({
    queryKey: sharedCommandPaletteKeys.patientSearch(query),
    queryFn: () => apiClient.get<{ data: { id: string; givenName: string; familyName: string; emrNumber: string }[] }>('patients', { search: query, limit: 5 }).then(r => r.data ?? []),
    enabled: open && query.length >= 2,
    staleTime: 5_000,
  });

  // Static navigation commands
  const navCommands: CommandItem[] = useMemo(() => [
    { id: 'nav-dashboard', label: 'Dashboard', icon: <DashboardIcon sx={{ fontSize: 18 }} />, action: () => navigate('/dashboard'), category: 'navigation' },
    { id: 'nav-patients', label: 'Patient Directory', icon: <PersonIcon sx={{ fontSize: 18 }} />, action: () => navigate('/patients'), category: 'navigation' },
    { id: 'nav-tasks', label: 'Tasks', icon: <AssignmentIcon sx={{ fontSize: 18 }} />, action: () => navigate('/tasks'), category: 'navigation' },
    { id: 'nav-referrals', label: 'Referral Management', icon: <SwapHorizIcon sx={{ fontSize: 18 }} />, action: () => navigate('/referrals'), category: 'navigation' },
    { id: 'nav-appointments', label: 'Appointments', icon: <CalendarMonthIcon sx={{ fontSize: 18 }} />, action: () => navigate('/appointments'), category: 'navigation' },
    { id: 'nav-ai', label: 'AI Assistant', icon: <AutoAwesomeIcon sx={{ fontSize: 18 }} />, action: () => navigate('/ai-agent'), category: 'navigation' },
    { id: 'nav-agentic-scribe', label: 'Agentic Scribe', icon: <AutoAwesomeIcon sx={{ fontSize: 18 }} />, action: () => navigate('/agentic-scribe'), category: 'navigation' },
    { id: 'nav-drafts', label: 'Drafts', icon: <NoteAddIcon sx={{ fontSize: 18 }} />, action: () => navigate('/drafts'), category: 'navigation' },
  ], [navigate]);

  // Action commands
  const actionCommands: CommandItem[] = useMemo(() => [
    { id: 'act-register', label: 'Register New Patient', icon: <PersonIcon sx={{ fontSize: 18 }} />, action: () => navigate('/patients?register=true'), category: 'action' },
    { id: 'act-prescribe', label: 'New Prescription', description: 'Open medication prescribing', icon: <MedicationIcon sx={{ fontSize: 18 }} />, action: () => navigate('/patients'), category: 'action' },
    { id: 'act-referral', label: 'New Referral', icon: <SwapHorizIcon sx={{ fontSize: 18 }} />, action: () => navigate('/referrals'), category: 'action' },
  ], [navigate]);

  // Patient results
  const patientCommands: CommandItem[] = useMemo(() =>
    (patients ?? []).map(p => ({
      id: `patient-${p.id}`,
      label: `${p.familyName}, ${p.givenName}`,
      description: `MRN: ${p.emrNumber}`,
      icon: <PersonIcon sx={{ fontSize: 18, color: '#b8621a' }} />,
      action: () => navigate(`/patients/${p.id}`),
      category: 'patient' as const,
    })),
    [patients, navigate],
  );

  // AI semantic suggestions — natural language shortcuts
  const semanticCommands: CommandItem[] = useMemo(() => {
    const q = query.toLowerCase();
    const suggestions: CommandItem[] = [];
    if (q.includes('clozapine') || q.includes('cloz')) {
      suggestions.push({ id: 'ai-cloz-list', label: 'Clozapine Monitoring List', description: 'View patients on clozapine', icon: <AutoAwesomeIcon sx={{ fontSize: 18, color: '#7B1FA2' }} />, action: () => navigate('/list/clozapine'), category: 'action' });
    }
    if (q.includes('overdue') || q.includes('review')) {
      suggestions.push({ id: 'ai-91day', label: '91-Day Reviews Due', description: 'Patients needing review', icon: <AutoAwesomeIcon sx={{ fontSize: 18, color: '#7B1FA2' }} />, action: () => navigate('/list/91day'), category: 'action' });
    }
    if (q.includes('hot') || q.includes('alert') || q.includes('risk')) {
      suggestions.push({ id: 'ai-hotspots', label: 'Hot Spots / High Risk', description: 'Patients flagged for monitoring', icon: <AutoAwesomeIcon sx={{ fontSize: 18, color: '#7B1FA2' }} />, action: () => navigate('/list/hotspots'), category: 'action' });
    }
    if (q.includes('lai') || q.includes('inject')) {
      suggestions.push({ id: 'ai-lai', label: 'LAI Schedule', description: 'Long-acting injectable monitoring', icon: <AutoAwesomeIcon sx={{ fontSize: 18, color: '#7B1FA2' }} />, action: () => navigate('/list/lai'), category: 'action' });
    }
    if (q.includes('handover') || q.includes('shift')) {
      suggestions.push({ id: 'ai-handover', label: 'Shift Handover', description: 'View/create handover notes', icon: <AutoAwesomeIcon sx={{ fontSize: 18, color: '#7B1FA2' }} />, action: () => navigate('/handover'), category: 'action' });
    }
    return suggestions;
  }, [query, navigate]);

  // Merge and filter
  const allCommands = [...semanticCommands, ...patientCommands, ...navCommands, ...actionCommands];
  const filtered = query.length === 0 ? navCommands.slice(0, 5) : allCommands.filter(c =>
    c.label.toLowerCase().includes(query.toLowerCase()) ||
    (c.description ?? '').toLowerCase().includes(query.toLowerCase())
  ).slice(0, 10);

  const handleSelect = useCallback((item: CommandItem) => {
    setOpen(false);
    item.action();
  }, []);

  if (!open) return null;

  return (
    <Dialog open onClose={() => setOpen(false)} maxWidth="sm" fullWidth
      slotProps={{ paper: { sx: { position: 'fixed', top: '15%', borderRadius: 2, maxHeight: '60vh' } } }}
      BackdropProps={{ sx: { bgcolor: 'rgba(0,0,0,0.3)', backdropFilter: 'blur(2px)' } }}>
      <Box sx={{ p: 0 }}>
        <TextField
          autoFocus fullWidth variant="standard" placeholder="Search patients, navigate, or type a command..."
          value={query} onChange={e => setQuery(e.target.value)}
          slotProps={{
            input: {
              startAdornment: <InputAdornment position="start"><SearchIcon sx={{ color: '#999', ml: 1 }} /></InputAdornment>,
              disableUnderline: true,
              sx: { fontSize: 15, py: 1.5, px: 1 },
            },
          }}
          onKeyDown={e => {
            if (e.key === 'Enter' && filtered.length > 0) handleSelect(filtered[0]);
            if (e.key === 'Escape') setOpen(false);
          }}
        />
        <Box sx={{ borderTop: '1px solid #E0E0E0' }}>
          {filtered.length === 0 ? (
            <Box sx={{ p: 3, textAlign: 'center' }}>
              <Typography variant="body2" color="text.secondary">No results for "{query}"</Typography>
            </Box>
          ) : (
            <List dense sx={{ py: 0.5 }}>
              {filtered.map((item, i) => (
                <ListItemButton key={item.id} onClick={() => handleSelect(item)}
                  selected={i === 0}
                  sx={{ py: 0.75, px: 2, '&.Mui-selected': { bgcolor: '#EFF6FF' } }}>
                  <ListItemIcon sx={{ minWidth: 32, color: '#666' }}>{item.icon}</ListItemIcon>
                  <ListItemText
                    primary={item.label}
                    secondary={item.description}
                    primaryTypographyProps={{ fontSize: 13, fontWeight: 500 }}
                    secondaryTypographyProps={{ fontSize: 11 }}
                  />
                  <Typography variant="caption" sx={{ color: '#bbb', fontSize: 9, textTransform: 'uppercase' }}>{item.category}</Typography>
                </ListItemButton>
              ))}
            </List>
          )}
        </Box>
        <Box sx={{ borderTop: '1px solid #E0E0E0', px: 2, py: 0.75, display: 'flex', gap: 2 }}>
          <Typography variant="caption" sx={{ color: '#999', fontSize: 10 }}>↵ Select</Typography>
          <Typography variant="caption" sx={{ color: '#999', fontSize: 10 }}>Esc Close</Typography>
          <Typography variant="caption" sx={{ color: '#999', fontSize: 10, ml: 'auto' }}>⌘K to open</Typography>
        </Box>
      </Box>
    </Dialog>
  );
}
