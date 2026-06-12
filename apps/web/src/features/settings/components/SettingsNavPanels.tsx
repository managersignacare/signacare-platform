import React from 'react';
import { Box, Button, Chip, Typography } from '@mui/material';
import DashboardPreferencesPanel from '../../dashboard/components/DashboardPreferencesPanel';

const SIDEBAR_HIDDEN_KEY = 'sidebar_hidden';
const ALL_SIDEBAR_ITEMS = [
  { group: 'Core', items: ['Dashboard', 'Patients', 'Referral Management', 'Tasks', 'Drafts', 'AI Assistant', 'Agentic Scribe'] },
  { group: 'Clinical Lists', items: ['LAI', 'MH Act', 'Clozapine', '91-Day Review', 'Hot Spots', 'Handover'] },
  { group: 'Workspace', items: ['Appointments', 'Bed Board', 'Reception'] },
  { group: 'Admin', items: ['Reports', 'Audit', 'Templates', 'Billing', 'Exports', 'Resources'] },
  { group: 'Settings', items: ['Settings', 'Org Settings', 'Staff Assignments'] },
] as const;

export function SidebarCustomisationPanel() {
  const [hidden, setHidden] = React.useState<Set<string>>(() => {
    try { const saved = localStorage.getItem(SIDEBAR_HIDDEN_KEY); return saved ? new Set(JSON.parse(saved)) : new Set(); }
    catch { return new Set(); }
  });

  const toggle = (label: string) => {
    const next = new Set(hidden);
    next.has(label) ? next.delete(label) : next.add(label);
    setHidden(next);
    localStorage.setItem(SIDEBAR_HIDDEN_KEY, JSON.stringify([...next]));
  };

  const resetAll = () => { setHidden(new Set()); localStorage.removeItem(SIDEBAR_HIDDEN_KEY); };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Box>
          <Typography variant="h6" fontWeight={600}>Sidebar Customisation</Typography>
          <Typography variant="body2" color="text.secondary">Toggle sidebar items on/off. Changes apply immediately.</Typography>
        </Box>
        <Button size="small" onClick={resetAll} sx={{ textTransform: 'none', color: '#327C8D' }}>Reset All</Button>
      </Box>
      {ALL_SIDEBAR_ITEMS.map(g => (
        <Box key={g.group} sx={{ mb: 2 }}>
          <Typography variant="caption" sx={{ fontWeight: 700, color: '#999', fontSize: 10, textTransform: 'uppercase', display: 'block', mb: 0.5 }}>{g.group}</Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
            {g.items.map(item => (
              <Chip key={item} label={item} size="small"
                variant={hidden.has(item) ? 'outlined' : 'filled'}
                onClick={() => toggle(item)}
                sx={{ cursor: 'pointer', fontSize: 11,
                  ...(hidden.has(item) ? { color: '#999', borderColor: '#ddd' } : { bgcolor: '#EFF6FF', color: '#2563EB', border: '1px solid #93C5FD' }),
                }} />
            ))}
          </Box>
        </Box>
      ))}
      {hidden.size > 0 && <Typography variant="caption" color="text.secondary">{hidden.size} item{hidden.size > 1 ? 's' : ''} hidden</Typography>}

      <Box sx={{ mt: 4, pt: 3, borderTop: '1px solid #E5E7EB' }}>
        <Box sx={{ mb: 2 }}>
          <Typography variant="h6" fontWeight={600}>Dashboard Options</Typography>
          <Typography variant="body2" color="text.secondary">
            Choose which optional dashboards are enabled, set your default cockpit, and open the new variants without replacing the existing Dashboard page.
          </Typography>
        </Box>
        <DashboardPreferencesPanel />
      </Box>
    </Box>
  );
}
