import CloseIcon from '@mui/icons-material/Close';
import PersonIcon from '@mui/icons-material/Person';
import { Box, IconButton, Tooltip, Typography } from '@mui/material';
import { useLocation, useNavigate } from 'react-router-dom';
import { unstyledButtonSx } from '../../styles/unstyledButton';
import { useWorkspaceStore } from '../../store/workspaceStore';

export function PatientTabBar() {
  const { tabs, activeTabId, setActiveTab, closeTab } = useWorkspaceStore();
  const navigate = useNavigate();
  const location = useLocation();

  if (!tabs.length) return null;

  return (
    <Box sx={{
      display: 'flex', alignItems: 'center', gap: 0.5, px: 2, py: 0.5,
      bgcolor: 'background.paper', borderBottom: '1px solid', borderColor: 'divider',
      overflowX: 'auto', '&::-webkit-scrollbar': { height: 3 },
    }}>
      <PersonIcon sx={{ fontSize: 16, color: 'text.disabled', mr: 0.5 }} />
      {tabs.map(tab => {
        const isActive = tab.id === activeTabId && location.pathname.includes(tab.id);
        return (
          // Shape B′ sub-region trigger — the inner left Box (name + EMR)
          // is the keyboard-accessible navigator; the Close IconButton on
          // the right is sibling so its previous defensive
          // `e.stopPropagation()` is no longer structurally required and
          // has been removed.
          <Box key={tab.id}
            sx={{
              display: 'flex', alignItems: 'center', gap: 0.5, px: 1.5, py: 0.5,
              borderRadius: 1, minWidth: 0, maxWidth: 200,
              bgcolor: isActive ? 'primary.main' : 'action.hover',
              color: isActive ? '#fff' : 'text.primary',
              '&:hover': { bgcolor: isActive ? 'primary.dark' : 'action.selected' },
              transition: 'all 0.15s',
            }}>
            <Box
              component="button"
              type="button"
              aria-label={`Open patient ${tab.name} (${tab.emrNumber})`}
              aria-current={isActive ? 'page' : undefined}
              onClick={() => { setActiveTab(tab.id); navigate(`/patients/${tab.id}`); }}
              sx={{ ...unstyledButtonSx, display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0, color: 'inherit', '&:focus-visible': { outline: '2px solid #b8621a', outlineOffset: 2, borderRadius: 1 } }}
            >
              <Typography variant="caption" fontWeight={isActive ? 700 : 500} noWrap sx={{ fontSize: 12 }}>
                {tab.name}
              </Typography>
              <Typography variant="caption" sx={{ fontSize: 10, opacity: 0.7 }}>
                {tab.emrNumber}
              </Typography>
            </Box>
            <Tooltip title="Close tab">
              <IconButton size="small" aria-label={`Close ${tab.name} tab`} onClick={() => closeTab(tab.id)}
                sx={{ p: 0.25, ml: 0.25, color: isActive ? 'rgba(255,255,255,0.7)' : 'text.disabled', '&:hover': { color: isActive ? '#fff' : 'error.main' } }}>
                <CloseIcon sx={{ fontSize: 14 }} />
              </IconButton>
            </Tooltip>
          </Box>
        );
      })}
    </Box>
  );
}
