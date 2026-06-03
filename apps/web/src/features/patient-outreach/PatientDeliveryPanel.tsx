// apps/web/src/features/patient-outreach/PatientDeliveryPanel.tsx
//
// Phase 12E — clinician-facing panel for the patient outreach
// dispatcher. Lives inside the Patient Detail layout (can be
// imported into any specialty tab that wants to show it).
//
// Surfaces four things:
//   1. Channel status banner — "Viva installed" vs "No app, SMS on"
//      vs "No delivery channel".
//   2. SMS consent toggle + mobile number edit, with a mandatory
//      reason on the audit trail.
//   3. "Send Patient Message" dialog with a three-option delivery
//      channel selector (Auto / Force FCM / Force SMS) and a
//      mandatory override-reason textarea that appears whenever
//      a non-Auto option is selected.
//   4. Delivery log — last 30 attempts with channel icon, kind,
//      attempted_at, delivered/failed/skipped status, and an
//      "Override: <channel> (by <name>)" badge where applicable.
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import SmsIcon from '@mui/icons-material/Sms';
import SendIcon from '@mui/icons-material/Send';
import PhoneIphoneIcon from '@mui/icons-material/PhoneIphone';
import BlockIcon from '@mui/icons-material/Block';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import type { ForceChannel, OutreachKind } from '@signacare/shared';
import {
  getDeliveryLogs,
  getDeliveryProfile,
  sendOutreach,
  setSmsConsent,
} from './api';

interface Props {
  patientId: string;
}

const OUTREACH_KIND_OPTIONS: OutreachKind[] = [
  'clinical_message',
  'appointment_reminder',
  'appointment_booked',
  'discharge_summary',
  'test_results_available',
];

import { profileKeys } from './queryKeys';

export function PatientDeliveryPanel({ patientId }: Props) {
  const qc = useQueryClient();

  const profileQuery = useQuery({
    queryKey: profileKeys.delivery(patientId),
    queryFn: () => getDeliveryProfile(patientId),
    staleTime: 30_000,
  });
  const logsQuery = useQuery({
    queryKey: profileKeys.logs(patientId),
    queryFn: () => getDeliveryLogs(patientId),
    staleTime: 10_000,
  });

  const [consentOpen, setConsentOpen] = useState(false);
  const [consentMobile, setConsentMobile] = useState('');
  const [consentReason, setConsentReason] = useState('');
  const [consentOn, setConsentOn] = useState(false);

  const consentMut = useMutation({
    mutationFn: () => setSmsConsent(patientId, {
      consent: consentOn,
      mobilePhone: consentMobile.trim() || undefined,
      reason: consentReason.trim() || undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: profileKeys.delivery(patientId) });
      setConsentOpen(false);
      setConsentReason('');
    },
  });

  const [sendOpen, setSendOpen] = useState(false);
  const [sendKind, setSendKind] = useState<OutreachKind>('clinical_message');
  const [sendTitle, setSendTitle] = useState('');
  const [sendBody, setSendBody] = useState('');
  const [sendForce, setSendForce] = useState<'auto' | ForceChannel>('auto');
  const [sendOverrideReason, setSendOverrideReason] = useState('');

  const sendMut = useMutation({
    mutationFn: () => sendOutreach({
      patientId,
      kind: sendKind,
      title: sendTitle.trim(),
      body: sendBody.trim(),
      forceChannel: sendForce === 'auto' ? undefined : sendForce,
      overrideReason: sendForce === 'auto' ? undefined : sendOverrideReason.trim(),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: profileKeys.logs(patientId) });
      setSendOpen(false);
      setSendTitle('');
      setSendBody('');
      setSendForce('auto');
      setSendOverrideReason('');
    },
  });

  const profile = profileQuery.data;
  const logs = logsQuery.data?.items ?? [];

  // Disable Force FCM when the patient has no Viva device; disable
  // Force SMS when consent or number is missing. Tooltip explains
  // why on hover (not shown here — MUI Select doesn't tooltip
  // disabled items cleanly).
  const canForceFcm = !!profile && profile.hasVivaApp;
  const canForceSms = !!profile && profile.smsConsent && !!profile.mobilePhone;

  const overrideReasonValid = sendForce === 'auto' || sendOverrideReason.trim().length >= 10;
  const canSend = sendTitle.trim().length > 0 && sendBody.trim().length > 0 && overrideReasonValid;

  const bannerNode = useMemo(() => {
    if (!profile) return null;
    if (profile.hasVivaApp) {
      return (
        <Alert severity="success" icon={<PhoneIphoneIcon />} sx={{ mb: 2 }}>
          Viva app installed — primary channel is FCM push. {profile.activeFcmDeviceCount} active device{profile.activeFcmDeviceCount === 1 ? '' : 's'}.
        </Alert>
      );
    }
    if (profile.smsConsent && profile.mobilePhone) {
      return (
        <Alert severity="info" icon={<SmsIcon />} sx={{ mb: 2 }}>
          No Viva app — primary channel is SMS ({profile.mobilePhone}).
        </Alert>
      );
    }
    return (
      <Alert severity="warning" icon={<BlockIcon />} sx={{ mb: 2 }}>
        No delivery channel — patient cannot be reached until SMS consent is captured or the Viva app is installed.
      </Alert>
    );
  }, [profile]);

  if (profileQuery.isLoading) {
    return <Box sx={{ p: 3, textAlign: 'center' }}><CircularProgress size={24} /></Box>;
  }
  if (profileQuery.isError || !profile) {
    return <Alert severity="error">Failed to load delivery profile.</Alert>;
  }

  return (
    <Box>
      {bannerNode}

      <Card variant="outlined" sx={{ mb: 2 }}>
        <CardContent>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
            <Box>
              <Typography variant="subtitle1" fontWeight={700} fontFamily="Albert Sans, sans-serif">
                SMS consent
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Patient's explicit opt-in for SMS outreach via Azure Communication Services.
                Required before the dispatcher can send SMS, even with manual override.
              </Typography>
            </Box>
            <Button size="small" variant="outlined" onClick={() => {
              setConsentOn(!profile.smsConsent);
              setConsentMobile(profile.mobilePhone ?? '');
              setConsentReason('');
              setConsentOpen(true);
            }}>
              {profile.smsConsent ? 'Revoke consent' : 'Capture consent'}
            </Button>
          </Box>
          <Stack direction="row" spacing={1} alignItems="center">
            <Chip
              size="small"
              label={profile.smsConsent ? 'Consent on' : 'Consent off'}
              color={profile.smsConsent ? 'success' : 'default'}
            />
            <Chip
              size="small"
              label={profile.mobilePhone ?? 'No mobile number'}
              color={profile.mobilePhone ? 'default' : 'error'}
              variant="outlined"
            />
          </Stack>
        </CardContent>
      </Card>

      <Card variant="outlined" sx={{ mb: 2 }}>
        <CardContent>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
            <Typography variant="subtitle1" fontWeight={700} fontFamily="Albert Sans, sans-serif">
              Send Patient Message
            </Typography>
            <Button size="small" variant="contained" startIcon={<SendIcon />}
              onClick={() => setSendOpen(true)}
              sx={{ bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' } }}>
              New message
            </Button>
          </Box>
          <Typography variant="caption" color="text.secondary">
            The dispatcher auto-picks FCM (if Viva is installed) or SMS (if consent is on file).
            Use the override selector on the dialog when you need to force a specific channel — e.g. the patient
            has Viva but their phone is broken.
          </Typography>
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardContent>
          <Typography variant="subtitle1" fontWeight={700} fontFamily="Albert Sans, sans-serif" sx={{ mb: 1 }}>
            Delivery log
          </Typography>
          {logsQuery.isLoading && <CircularProgress size={18} />}
          {!logsQuery.isLoading && logs.length === 0 && (
            <Typography variant="body2" color="text.secondary">No outreach attempts recorded yet.</Typography>
          )}
          <Stack spacing={1}>
            {logs.map((row) => {
              const status: 'delivered' | 'failed' | 'skipped' =
                row.channel === 'skipped' ? 'skipped'
                : row.failedAt ? 'failed'
                : 'delivered';
              const statusIcon =
                status === 'delivered' ? <CheckCircleIcon sx={{ color: '#2E7D32', fontSize: 18 }} />
                : status === 'failed' ? <ErrorOutlineIcon sx={{ color: '#D32F2F', fontSize: 18 }} />
                : <BlockIcon sx={{ color: '#757575', fontSize: 18 }} />;
              return (
                <Box key={row.id} sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', py: 0.5, borderBottom: '1px solid #F0F0F0' }}>
                  <Box sx={{ mt: 0.25 }}>{statusIcon}</Box>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="body2" fontWeight={600}>
                      {row.title ?? row.kind}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                      {row.kind}
                      {' · '}
                      {row.channel === 'skipped' ? `skipped (${row.skipReason})` : row.channel}
                      {' · '}
                      {new Date(row.attemptedAt).toLocaleString('en-AU')}
                    </Typography>
                    {row.overrideChannel && (
                      <Chip
                        size="small"
                        label={`Override: ${row.overrideChannel} by ${row.overrideByStaffName ?? 'clinician'}`}
                        sx={{ mt: 0.5, fontSize: 10, bgcolor: '#FFF4E6', color: '#b8621a', height: 18 }}
                      />
                    )}
                    {row.errorMessage && (
                      <Typography variant="caption" sx={{ display: 'block', mt: 0.25, color: '#D32F2F' }}>
                        {row.errorMessage}
                      </Typography>
                    )}
                  </Box>
                </Box>
              );
            })}
          </Stack>
        </CardContent>
      </Card>

      {/* ── Consent capture dialog ── */}
      <Dialog open={consentOpen} onClose={() => setConsentOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>SMS consent</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <FormControlLabel
              control={<Switch checked={consentOn} onChange={(e) => setConsentOn(e.target.checked)} />}
              label={consentOn ? 'Patient consents to SMS outreach' : 'Patient does not consent'}
            />
            <TextField
              label="Mobile phone (E.164)"
              placeholder="+61400000000"
              value={consentMobile}
              onChange={(e) => setConsentMobile(e.target.value)}
              size="small"
              fullWidth
            />
            <TextField
              label="How was consent obtained?"
              value={consentReason}
              onChange={(e) => setConsentReason(e.target.value)}
              size="small"
              fullWidth
              multiline
              rows={2}
              placeholder="e.g. Patient confirmed verbally over the phone during intake"
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConsentOpen(false)}>Cancel</Button>
          <Button variant="contained" disabled={consentMut.isPending}
            onClick={() => consentMut.mutate()}
            sx={{ bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' } }}>
            Save consent
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Send Patient Message dialog ── */}
      <Dialog open={sendOpen} onClose={() => setSendOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Send Patient Message</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <FormControl size="small" fullWidth>
              <InputLabel>Kind</InputLabel>
              <Select value={sendKind} label="Kind" onChange={(e) => setSendKind(e.target.value as OutreachKind)}>
                {OUTREACH_KIND_OPTIONS.map((k) => (
                  <MenuItem key={k} value={k}>{k.replace(/_/g, ' ')}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <TextField
              label="Title"
              value={sendTitle}
              onChange={(e) => setSendTitle(e.target.value)}
              size="small"
              fullWidth
            />
            <TextField
              label="Body"
              value={sendBody}
              onChange={(e) => setSendBody(e.target.value)}
              size="small"
              fullWidth
              multiline
              rows={4}
              helperText="Keep the body ≤ 160 characters if you expect the dispatcher to pick SMS."
            />

            <Divider>Delivery channel</Divider>
            <FormControl size="small" fullWidth>
              <InputLabel>Channel</InputLabel>
              <Select value={sendForce} label="Channel" onChange={(e) => setSendForce(e.target.value as 'auto' | ForceChannel)}>
                <MenuItem value="auto">Auto (recommended)</MenuItem>
                <MenuItem value="fcm" disabled={!canForceFcm}>
                  Force FCM push {canForceFcm ? '' : '— patient has no Viva device'}
                </MenuItem>
                <MenuItem value="acs_sms" disabled={!canForceSms}>
                  Force SMS {canForceSms ? '' : '— consent or mobile number missing'}
                </MenuItem>
              </Select>
            </FormControl>

            {sendForce !== 'auto' && (
              <TextField
                label="Override reason (required, ≥10 characters)"
                value={sendOverrideReason}
                onChange={(e) => setSendOverrideReason(e.target.value)}
                size="small"
                fullWidth
                multiline
                rows={2}
                error={sendOverrideReason.length > 0 && sendOverrideReason.trim().length < 10}
                helperText={
                  sendOverrideReason.trim().length < 10
                    ? `${sendOverrideReason.trim().length}/10 characters`
                    : 'Recorded on the audit trail for this delivery'
                }
                placeholder="e.g. Patient called saying the app has been broken since they swapped handsets"
              />
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSendOpen(false)}>Cancel</Button>
          <Button variant="contained" disabled={!canSend || sendMut.isPending}
            onClick={() => sendMut.mutate()}
            sx={{ bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' } }}>
            {sendMut.isPending ? 'Sending…' : 'Send'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

export default PatientDeliveryPanel;
