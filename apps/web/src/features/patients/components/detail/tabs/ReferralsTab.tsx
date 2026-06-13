import SendIcon from '@mui/icons-material/Send';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import {
    Alert, Autocomplete, Box, Button, Card, CardContent, Chip, Collapse, Dialog, DialogActions,
    DialogContent, DialogTitle, Divider, FormControl, Grid, InputLabel,
    MenuItem, Select, TextField, Typography
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../../../shared/services/apiClient';
import { useTemplates } from '../../../../templates/hooks/useTemplates';
import { patientReferralsKeys, episodesKeys, patientsKeys } from '../../../queryKeys';
import React, { useMemo, useState } from 'react';
import { useOrgTree } from '../../../../org-settings/hooks/useOrgSettings';
import type { OrgUnit } from '../../../../org-settings/services/orgSettingsApi';
import { templateSectionsToDraftText } from '../../notes/AddNoteDialogSupport';

interface ReferralRow {
  id: string;
  status?: string;
  source?: string;
  fromService?: string;
  fromProviderName?: string;
  toTeamOrProvider?: string;
  referralDate?: string;
  date?: string;
  createdAt?: string;
  urgency?: string;
  reason?: string;
  clinicalSummary?: string;
  currentMedications?: string;
  internalNotes?: string;
  patientGivenName?: string;
  patientFamilyName?: string;
  outcome?: string;
}

function getErrorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const maybeError = error as { response?: { data?: { error?: string } }; message?: string };
    return maybeError.response?.data?.error ?? maybeError.message ?? 'Unknown';
  }
  return 'Unknown';
}

function useReferralTemplates() {
  return useTemplates({
    status: 'published',
    category: 'Referral Letters',
  });
}

function flattenUnits(nodes: OrgUnit[]): { id: string; name: string }[] {
  const result: { id: string; name: string }[] = [];
  function walk(list: OrgUnit[], depth: number) {
    for (const n of list) { result.push({ id: n.id, name: '\u00A0'.repeat(depth * 2) + n.name }); if (n.children?.length) walk(n.children, depth + 1); }
  }
  walk(nodes, 0);
  return result;
}

const URGENCY_OPTIONS = [
  { value: 'emergency', label: 'Emergency', color: '#D32F2F' },
  { value: 'urgent', label: 'Urgent (24h)', color: '#E65100' },
  { value: 'semi_urgent', label: 'Semi-Urgent (72h)', color: '#b8621a' },
  { value: 'routine', label: 'Routine', color: '#327C8D' },
];

interface ReferralsTabProps { patientId: string }
export function ReferralsTab({ patientId }: ReferralsTabProps) {
  return (
    <Box>
      <ReferralsList patientId={patientId} filterType="referral" direction="internal" />
    </Box>
  );
}

// ============ Referrals List ============

interface ReferralsListProps { patientId: string; filterType: string; direction: string }
function ReferralsList({ patientId }: ReferralsListProps) {
  const qc = useQueryClient();
  const { data: tree } = useOrgTree();
  const { data: apiTemplates } = useReferralTemplates();
  const flatUnits = React.useMemo(() => tree ? flattenUnits(tree) : [], [tree]);
  const { data: refSources } = useQuery({
    queryKey: patientsKeys.referralSourcesLookup(),
    queryFn: () => apiClient.get<{ sources: { id: string; name: string; category: string }[] }>('staff-settings/referral-sources').then(r => r.sources ?? []).catch((err) => { console.warn('ReferralsTab: query failed', err); return []; }),
    staleTime: 5 * 60 * 1000,
  });
  // Combined dropdown options: internal teams + external sources
  const allOptions = useMemo(() => {
    const opts: { label: string; value: string; type: 'internal' | 'external' }[] = [];
    for (const u of flatUnits) opts.push({ label: u.name.trim(), value: u.name.trim(), type: 'internal' });
    for (const s of (refSources ?? [])) {
      if (!opts.some(o => o.value === s.name)) opts.push({ label: `${s.name} (External)`, value: s.name, type: 'external' });
    }
    return opts;
  }, [flatUnits, refSources]);
  // providerOptions replaced by allOptions above
  void useMemo(() => {
    const opts: string[] = [];
    for (const u of flatUnits) opts.push(u.name.trim());
    for (const s of (refSources ?? [])) if (!opts.includes(s.name)) opts.push(s.name);
    return opts;
  }, [flatUnits, refSources]);

  // Fetch referrals from API
  const { data: apiReferrals } = useQuery({
    queryKey: patientReferralsKeys.referrals(patientId),
    queryFn: async () => {
      try {
        const r = await apiClient.get<ReferralRow[] | { items?: ReferralRow[]; data?: ReferralRow[] }>('referrals', { patientId });
        return Array.isArray(r) ? r : r.items ?? r.data ?? [];
      }
      catch { return []; }
    },
    enabled: !!patientId,
    staleTime: 5 * 60 * 1000,
  });
  const referrals: ReferralRow[] = apiReferrals ?? [];
  const [addOpen, setAddOpen] = useState(false);
  const [expandedRefId, setExpandedRefId] = useState<string | null>(null);

  // Form — source and target
  const [referralSource, setReferralSource] = useState('');
  const [referralTarget, setReferralTarget] = useState('');
  const [reason, setReason] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [letterBody, setLetterBody] = useState('');
  const [urgency, setUrgency] = useState('routine');

  const templates = apiTemplates ?? [];
  const [showCompleted, setShowCompleted] = useState(true);

  // Split referrals into active and completed
  const COMPLETED_STATUSES = ['accepted', 'completed', 'rejected', 'declined', 'redirected'];
  const activeReferrals = referrals.filter((r) => !COMPLETED_STATUSES.includes(r.status ?? ''));
  const completedReferrals = referrals.filter((r) => COMPLETED_STATUSES.includes(r.status ?? ''));

  const handleTemplateChange = (id: string) => {
    setSelectedTemplate(id);
    const tmpl = templates.find(t => t.id === id);
    if (tmpl) {
      setLetterBody(templateSectionsToDraftText(tmpl.sections));
    }
  };

  const createMut = useMutation({
    mutationFn: async () => {
      // Backend creates referral + referral episode "referral-TARGET-YYYYMMDD"
      await apiClient.post('referrals', {
        patientId,
        referralDate: new Date().toISOString().split('T')[0],
        source: referralSource ? 'internal' : 'external',
        fromService: referralTarget,
        fromProviderName: referralSource || referralTarget,
        referringOrg: referralSource,
        reason: reason.trim(),
        urgency: urgency || 'routine',
        referralSource: referralSource,
        referralTarget: referralTarget,
        letterBody: letterBody || undefined,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: patientReferralsKeys.referrals(patientId) });
      qc.invalidateQueries({ queryKey: episodesKeys.byPatient(patientId) });
      // @catalogued: BUG-241 (Wave B-1) — no team-assignments helper on patientsKeys
      qc.invalidateQueries({ queryKey: patientsKeys.patientTeamAssignments() });
      setAddOpen(false);
      setReferralSource(''); setReferralTarget(''); setReason(''); setSelectedTemplate(''); setLetterBody(''); setUrgency('routine');
    },
    onError: (err: unknown) => alert(`Failed to create referral: ${getErrorMessage(err)}`),
  });
  const handleCreate = () => {
    if (!reason.trim()) return;
    createMut.mutate();
  };

  // Active/Completed split replaces filteredReferrals

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h6" fontWeight={600} fontFamily="Albert Sans, sans-serif">
          Referrals & Transfers of Care
        </Typography>
        <Button startIcon={<SendIcon />} variant="contained" size="small" onClick={() => setAddOpen(true)}
          sx={{ bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' } }}>
          New Referral / Transfer
        </Button>
      </Box>

      {/* Active Referrals */}
      <Typography variant="subtitle2" fontWeight={600} color="text.secondary" sx={{ mb: 1 }}>
        Active ({activeReferrals.length})
      </Typography>

      {activeReferrals.length === 0 ? (
        <Alert severity="info" sx={{ mb: 2 }}>
          No active referrals or transfers. Click the button above to create one.
        </Alert>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, mb: 3 }}>
          {activeReferrals.map(r => {
            const isRefExpanded = expandedRefId === r.id;
            const toggleRef = () => setExpandedRefId(isRefExpanded ? null : r.id);
            return (
            <Card key={r.id} variant="outlined"
              role="button"
              tabIndex={0}
              aria-expanded={isRefExpanded}
              aria-label={`Referral ${r.reason} from ${r.fromService ?? r.fromProviderName ?? r.toTeamOrProvider ?? 'unknown'} — ${isRefExpanded ? 'collapse' : 'expand'}`}
              onClick={toggleRef}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleRef(); } }}
              sx={{ borderLeft: `4px solid ${(r.source === 'internal' || r.fromService?.includes('→')) ? '#D32F2F' : '#327C8D'}`, cursor: 'pointer', '&:hover': { bgcolor: '#FAFAFA' }, '&:focus-visible': { outline: '2px solid #b8621a', outlineOffset: 2 } }}>
              <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                      {(r.source === 'internal') ? <WarningAmberIcon sx={{ fontSize: 18, color: '#D32F2F' }} /> : <SwapHorizIcon sx={{ fontSize: 18, color: '#327C8D' }} />}
                      <Typography fontWeight={600} variant="body2">{r.reason}</Typography>
                    </Box>
                    <Box sx={{ ml: 3.5, display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                      <Typography variant="caption" color="text.secondary"><strong>From:</strong> {r.fromService ?? r.fromProviderName ?? r.toTeamOrProvider ?? '—'}</Typography>
                      <Typography variant="caption" color="text.secondary"><strong>Date:</strong> {(r.referralDate ?? r.referralDate ?? r.date ?? r.createdAt ?? r.createdAt) ? new Date(r.referralDate ?? r.referralDate ?? r.date ?? r.createdAt ?? r.createdAt ?? '').toLocaleDateString('en-AU') : '—'}</Typography>
                      <Chip label={r.status ?? 'received'} size="small" variant="outlined" sx={{ fontSize: 9, height: 18, textTransform: 'capitalize' }} />
                      {r.urgency && r.urgency !== 'routine' && (
                        <Chip label={URGENCY_OPTIONS.find(u => u.value === r.urgency)?.label ?? r.urgency} size="small"
                          sx={{ fontSize: 9, height: 18, bgcolor: URGENCY_OPTIONS.find(u => u.value === r.urgency)?.color ?? '#999', color: '#fff' }} />
                      )}
                    </Box>
                  </Box>
                  <Chip label={r.status ?? r.outcome ?? 'received'} size="small"
                    color={(r.status ?? r.outcome) === 'accepted' ? 'success' : (r.status ?? r.outcome) === 'received' ? 'warning' : (r.status ?? r.outcome) === 'rejected' ? 'error' : 'default'}
                    sx={{ textTransform: 'capitalize', fontSize: 11 }} />
                </Box>
                {/* Expandable detail */}
                {expandedRefId === r.id && (
                  <Box sx={{ mt: 1, pt: 1, borderTop: '1px solid #E0E0E0' }}>
                    {r.reason && <Typography variant="caption" display="block"><strong>Reason:</strong> {r.reason}</Typography>}
                    {r.clinicalSummary && <Typography variant="caption" display="block"><strong>Clinical Summary:</strong> {r.clinicalSummary}</Typography>}
                    {r.currentMedications && <Typography variant="caption" display="block"><strong>Medications:</strong> {r.currentMedications}</Typography>}
                    {r.internalNotes && <Typography variant="caption" display="block"><strong>Notes:</strong> {r.internalNotes}</Typography>}
                    {(r.patientGivenName || r.patientFamilyName) && <Typography variant="caption" display="block" color="text.secondary"><strong>Patient:</strong> {r.patientGivenName} {r.patientFamilyName}</Typography>}
                  </Box>
                )}
              </CardContent>
            </Card>
            );
          })}
        </Box>
      )}

      {/* Completed Section — first-class, expanded by default */}
      <Box sx={{ mt: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
          <Typography variant="subtitle2" fontWeight={600} color="text.secondary">
            Completed ({completedReferrals.length})
          </Typography>
          <Button onClick={() => setShowCompleted(!showCompleted)}
            endIcon={showCompleted ? <ExpandLessIcon /> : <ExpandMoreIcon />}
            size="small"
            sx={{ color: '#757575', textTransform: 'none' }}>
            {showCompleted ? 'Hide' : 'Show'}
          </Button>
        </Box>
        <Collapse in={showCompleted}>
          {completedReferrals.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ ml: 2, mt: 1 }}>No completed referrals.</Typography>
          ) : (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mt: 1 }}>
              {completedReferrals.map(r => {
                const referralDate = r.referralDate ?? r.date ?? r.createdAt;
                return (
                  <Card key={r.id} variant="outlined" sx={{ borderLeft: '4px solid #2E7D32', opacity: 0.8 }}>
                    <CardContent sx={{ py: 1, '&:last-child': { pb: 1 } }}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Box>
                          <Typography variant="body2" fontWeight={500}>{r.fromService ?? 'Referral'}</Typography>
                          <Typography variant="caption" color="text.secondary">
                            {referralDate ? new Date(referralDate).toLocaleDateString('en-AU') : '—'}
                            {' · '}{r.reason ?? ''}
                          </Typography>
                        </Box>
                        <Chip label={r.status} size="small" color={r.status === 'accepted' ? 'success' : 'default'} sx={{ textTransform: 'capitalize', fontSize: 10 }} />
                      </Box>
                    </CardContent>
                  </Card>
                );
              })}
            </Box>
          )}
        </Collapse>
      </Box>

      {/* Create Dialog */}
      <Dialog aria-labelledby="dialog-title" open={addOpen} onClose={() => setAddOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle id="dialog-title" sx={{ fontFamily: 'Albert Sans, sans-serif', fontWeight: 700 }}>
          New Referral / Transfer of Care
        </DialogTitle>
        <Divider />
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 0.5 }}>
            {/* Source */}
            <Grid size={{ xs: 12, sm: 6 }}>
              <Autocomplete freeSolo options={allOptions.map(o => o.label)} value={referralSource}
                onInputChange={(_, v) => setReferralSource(v)}
                renderInput={(params) => <TextField {...params} label="Source (From)" fullWidth size="small" placeholder="Team, provider, or external service" />}
                size="small" />
            </Grid>
            {/* Target */}
            <Grid size={{ xs: 12, sm: 6 }}>
              <Autocomplete freeSolo options={allOptions.map(o => o.label)} value={referralTarget}
                onInputChange={(_, v) => setReferralTarget(v)}
                renderInput={(params) => <TextField {...params} label="Target (To)" fullWidth size="small" placeholder="Team, provider, or external service" />}
                size="small" />
            </Grid>
            <Grid size={{ xs: 12, sm: 3 }}>
              <FormControl fullWidth size="small">
                <InputLabel>Urgency</InputLabel>
                <Select value={urgency} onChange={e => setUrgency(e.target.value)} label="Urgency">
                  {URGENCY_OPTIONS.map(u => (
                    <MenuItem key={u.value} value={u.value}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: u.color }} />
                        {u.label}
                      </Box>
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 12, sm: 3 }}>
              {/* Status managed by accept/reject flow in episode */}
              <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                Status will be managed via the referral episode
              </Typography>
            </Grid>

            <Grid size={{ xs: 12 }}>
              <TextField label="Reason *" fullWidth size="small" multiline rows={2} value={reason} onChange={e => setReason(e.target.value)} />
            </Grid>

            {/* Template selector */}
            <Grid size={{ xs: 12 }}>
              <Divider sx={{ my: 1 }} />
              <Typography variant="subtitle2" sx={{ mb: 1 }}>Referral Letter</Typography>
              <FormControl fullWidth size="small" sx={{ mb: 1 }}>
                <InputLabel>Select Template</InputLabel>
                <Select value={selectedTemplate} onChange={e => handleTemplateChange(e.target.value)} label="Select Template">
                  <MenuItem value="">— Blank —</MenuItem>
                  {templates.map(t => <MenuItem key={t.id} value={t.id}>{t.name}</MenuItem>)}
                </Select>
              </FormControl>
              <TextField fullWidth size="small" multiline rows={14} value={letterBody} onChange={e => setLetterBody(e.target.value)}
                placeholder="Compose your referral letter here or select a template above"
                sx={{ '& .MuiInputBase-input': { fontFamily: 'monospace', fontSize: 12 } }} />
            </Grid>
          </Grid>
        </DialogContent>
        <Divider />
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setAddOpen(false)} sx={{ color: 'text.secondary' }}>Cancel</Button>
          {/* Email option available for all referrals */}
          <Button variant="contained" onClick={handleCreate} disabled={!reason.trim()}
            sx={{ bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' } }}>
            {'Create Referral'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

export default ReferralsTab;
