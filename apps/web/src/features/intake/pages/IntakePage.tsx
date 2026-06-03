import {
  Box,
  Button,
  Collapse,
  Dialog,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import React, { useMemo, useState } from 'react';
import { ReferralForm } from '../components/ReferralForm';
import { ReferralList } from '../components/ReferralList';
import { useReferralModule } from '../hooks/useReferralModule';
import type { ReferralFilters } from '../types/intakeTypes';

const MyOffersPage = React.lazy(() => import('./MyOffersPage'));

const ACTIVE_STATUSES = ['received', 'under-review', 'info_requested', 'new', 'in_review', 'pending_clinician_review', 'pending_broadcast'];
const ARCHIVE_STATUSES = ['accepted', 'declined', 'rejected', 'redirected', 'completed', 'closed_no_response'];

export const IntakePage = () => {
  const [createOpen, setCreateOpen] = useState(false);
  const [status, setStatus] = useState('');
  const [urgency, setUrgency] = useState('');
  const [teamFilter, setTeamFilter] = useState('');
  const [periodFilter, setPeriodFilter] = useState('');
  const [showArchive, setShowArchive] = useState(false);
  const [activeTab, setActiveTab] = useState(0);
  const { module: referralModule } = useReferralModule();

  const filters = useMemo<ReferralFilters>(
    () => ({
      status: status || undefined,
      urgency: urgency || undefined,
      team: teamFilter || undefined,
      period: periodFilter || undefined,
    }),
    [status, urgency, teamFilter, periodFilter],
  );

  // When a specific status filter is chosen, show that. Otherwise split active/archive.
  const isFiltered = !!status;
  const activeFilters = useMemo<ReferralFilters>(
    () => ({ ...filters, statusIn: isFiltered ? undefined : ACTIVE_STATUSES }),
    [filters, isFiltered],
  );
  const archiveFilters = useMemo<ReferralFilters>(
    () => ({ ...filters, statusIn: ARCHIVE_STATUSES }),
    [filters],
  );

  return (
    <Stack spacing={3}>
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        justifyContent="space-between"
        alignItems={{ xs: 'stretch', md: 'center' }}
        spacing={2}
      >
        <Box>
          <Typography variant="h4" sx={{ color: '#3D484B', fontWeight: 700 }}>
            Referral Management
          </Typography>
          <Typography color="text.secondary">
            Track referrals, SLA risk, and decision outcomes across all teams.
          </Typography>
        </Box>

        <Button
          variant="contained"
          onClick={() => setCreateOpen(true)}
          sx={{
            backgroundColor: '#327C8D',
            '&:hover': { backgroundColor: '#2a6977' },
          }}
        >
          New referral
        </Button>
      </Stack>

      {referralModule === 'team' && (
        <Tabs value={activeTab} onChange={(_, v) => setActiveTab(v)} sx={{ borderBottom: 1, borderColor: 'divider' }}>
          <Tab label="All Referrals" />
          <Tab label="My Offers" />
        </Tabs>
      )}

      {activeTab === 1 && referralModule === 'team' ? (
        <React.Suspense fallback={<Typography>Loading...</Typography>}>
          <MyOffersPage />
        </React.Suspense>
      ) : (
      <>
      <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
        <TextField
          select size="small"
          label="Status"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          sx={{ minWidth: 150 }}
        >
          <MenuItem value="">All</MenuItem>
          <MenuItem value="received">Received</MenuItem>
          <MenuItem value="under-review">Under review</MenuItem>
          <MenuItem value="accepted">Accepted</MenuItem>
          <MenuItem value="declined">Declined</MenuItem>
          <MenuItem value="redirected">Redirected</MenuItem>
          {referralModule === 'team' && <MenuItem value="pending_clinician_review">Pending Clinician Review</MenuItem>}
          {referralModule === 'team' && <MenuItem value="pending_broadcast">Pending Broadcast</MenuItem>}
          {referralModule === 'team' && <MenuItem value="closed_no_response">Closed (No Response)</MenuItem>}
        </TextField>

        <TextField
          select size="small"
          label="Urgency"
          value={urgency}
          onChange={(event) => setUrgency(event.target.value)}
          sx={{ minWidth: 140 }}
        >
          <MenuItem value="">All</MenuItem>
          <MenuItem value="routine">Routine</MenuItem>
          <MenuItem value="urgent">Urgent</MenuItem>
          <MenuItem value="emergency">Emergency</MenuItem>
        </TextField>

        <TextField
          select size="small"
          label="Team"
          value={teamFilter}
          onChange={(event) => setTeamFilter(event.target.value)}
          sx={{ minWidth: 150 }}
        >
          <MenuItem value="">All Teams</MenuItem>
          <MenuItem value="CCT">CCT</MenuItem>
          <MenuItem value="ACIS">ACIS</MenuItem>
          <MenuItem value="PARC">PARC</MenuItem>
          <MenuItem value="CCU">CCU</MenuItem>
          <MenuItem value="IPU">IPU</MenuItem>
          <MenuItem value="Outpatients">Outpatients</MenuItem>
        </TextField>

        <TextField
          select size="small"
          label="Period"
          value={periodFilter}
          onChange={(event) => setPeriodFilter(event.target.value)}
          sx={{ minWidth: 140 }}
        >
          <MenuItem value="">All Time</MenuItem>
          <MenuItem value="7d">Last 7 Days</MenuItem>
          <MenuItem value="30d">Last 30 Days</MenuItem>
          <MenuItem value="90d">Last 90 Days</MenuItem>
        </TextField>
      </Stack>

      {/* Active referrals (or all if status filter is set) */}
      <ReferralList filters={isFiltered ? filters : activeFilters} />

      {/* Archives section (always visible, collapsed by default) */}
      <Box>
          <Button
            onClick={() => setShowArchive(!showArchive)}
            endIcon={showArchive ? <ExpandLessIcon /> : <ExpandMoreIcon />}
            sx={{ color: '#757575', textTransform: 'none', fontWeight: 600, mb: 1 }}
          >
            Archives (Accepted / Declined / Redirected)
          </Button>
          <Collapse in={showArchive}>
            <ReferralList filters={archiveFilters} />
          </Collapse>
      </Box>

      </>
      )}

      <Dialog aria-labelledby="dialog-title" open={createOpen} onClose={() => setCreateOpen(false)} fullWidth maxWidth="md">
        <DialogTitle id="dialog-title">Create referral</DialogTitle>
        <DialogContent dividers>
          <ReferralForm onSuccess={() => setCreateOpen(false)} />
        </DialogContent>
      </Dialog>
    </Stack>
  );
};
