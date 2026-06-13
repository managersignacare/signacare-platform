import React from 'react';
import { Box, Button, Chip, Typography } from '@mui/material';
import DashboardPreferencesPanel from '../../dashboard/components/DashboardPreferencesPanel';

const SIDEBAR_HIDDEN_KEY = 'sidebar_hidden';
const ALL_SIDEBAR_ITEMS = [
  {
    group: 'Core',
    items: [
      { label: 'Dashboard', path: 'dashboard' },
      { label: 'Patients', path: 'patients' },
      { label: 'Tasks', path: 'tasks' },
      { label: 'Drafts', path: 'drafts' },
      { label: 'AI Assistant', path: 'ai-agent' },
      { label: 'Medical Scribe', path: 'agentic-scribe' },
    ],
  },
  {
    group: 'Clinical Lists',
    items: [
      { label: 'Mental Health Intake', path: 'referrals' },
      { label: 'Referral Out', path: 'referrals/queue' },
      { label: 'LAI', path: 'list/lai' },
      { label: 'MH Act', path: 'list/mha' },
      { label: 'Group Therapy', path: 'group-therapy' },
      { label: 'Clozapine', path: 'list/clozapine' },
      { label: '91-Day Review', path: 'list/91day' },
      { label: 'Hot Spots', path: 'list/hotspots' },
      { label: 'Admission Waitlist', path: 'list/admission-waitlist' },
      { label: 'Pathways', path: 'pathways' },
      { label: 'Handover', path: 'handover' },
    ],
  },
  {
    group: 'Workspace',
    items: [
      { label: 'My Calendar', path: 'calendar' },
      { label: 'Bed Board', path: 'bed-board' },
      { label: 'Reception', path: 'receptionist' },
    ],
  },
  {
    group: 'Admin',
    items: [
      { label: 'Reports', path: 'reports' },
      { label: 'Templates', path: 'templates' },
      { label: 'Billing', path: 'billing' },
      { label: 'Exports', path: 'exports' },
      { label: 'Resources', path: 'community-resources' },
    ],
  },
  {
    group: 'Settings',
    items: [
      { label: 'Settings', path: 'settings' },
      { label: 'Org Settings', path: 'org-settings' },
      { label: 'Staff Assignments', path: 'staff-assignments' },
    ],
  },
] as const;

export function SidebarCustomisationPanel() {
  const [hidden, setHidden] = React.useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem(SIDEBAR_HIDDEN_KEY);
      return saved ? new Set(JSON.parse(saved)) : new Set();
    }
    catch { return new Set(); }
  });

  const toggle = (path: string) => {
    const next = new Set(hidden);
    next.has(path) ? next.delete(path) : next.add(path);
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
              <Chip key={item.path} label={item.label} size="small"
                variant={hidden.has(item.path) ? 'outlined' : 'filled'}
                onClick={() => toggle(item.path)}
                sx={{ cursor: 'pointer', fontSize: 11,
                  ...(hidden.has(item.path) ? { color: '#999', borderColor: '#ddd' } : { bgcolor: '#EFF6FF', color: '#2563EB', border: '1px solid #93C5FD' }),
                }} />
            ))}
          </Box>
        </Box>
      ))}
      {hidden.size > 0 && <Typography variant="caption" color="text.secondary">{hidden.size} item{hidden.size > 1 ? 's' : ''} hidden</Typography>}
    </Box>
  );
}

export function DashboardOptionsPanel() {
  return (
    <Box>
      <Box sx={{ mb: 2 }}>
        <Typography variant="h6" fontWeight={600}>Alternative Dashboard</Typography>
        <Typography variant="body2" color="text.secondary">
          Choose which optional dashboards are enabled, set your default cockpit, and open the new variants without replacing the existing Dashboard page.
        </Typography>
      </Box>
      <DashboardPreferencesPanel />
    </Box>
  );
}
