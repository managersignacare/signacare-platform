/**
 * Send Message Dialog — with recipient selection from patient record
 *
 * Used in Episodes tab and Correspondence tab for sending SMS/messages.
 * Pulls real contacts (patient, GP, NOK, carers, support persons) from the patient data.
 */

import { useState, useEffect } from 'react';
import {
  Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogTitle, Divider, FormControl, Grid, InputLabel, MenuItem, Select,
  TextField, Typography,
} from '@mui/material';
import SendIcon from '@mui/icons-material/Send';
import SmsIcon from '@mui/icons-material/Sms';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../../shared/services/apiClient';
import { usePatient } from '../../hooks/usePatient';
import { patientsKeys, episodesKeys } from '../../queryKeys';
import { patientApi, type PatientContact } from '../../services/patientApi';

interface Recipient {
  id: string;
  label: string;
  name: string;
  phone?: string;
  email?: string;
  type: string;
}

interface MessageApiError {
  message?: string;
  response?: {
    data?: {
      error?: string;
      message?: string;
    };
  };
}

function getMessageApiError(err: unknown): MessageApiError {
  return typeof err === 'object' && err !== null ? (err as MessageApiError) : {};
}

function getMessageApiErrorText(err: unknown): string {
  const parsed = getMessageApiError(err);
  return parsed.response?.data?.error ?? parsed.response?.data?.message ?? parsed.message ?? 'Unknown error';
}

function usePatientRecipients(patientId: string): Recipient[] {
  const { data: patient } = usePatient(patientId);
  const { data: contactsRaw } = useQuery({
    queryKey: patientsKeys.contactsAlt(patientId),
    queryFn: async () => {
      try {
        const r = await patientApi.getPatientContacts(patientId);
        if (Array.isArray(r?.contacts)) return r.contacts;
        return [];
      } catch { return []; }
    },
    enabled: !!patientId,
  });
  const contactsData = Array.isArray(contactsRaw) ? contactsRaw : [];

  if (!patient) return [];
  const p = patient;
  const list: Recipient[] = [];

  list.push({
    id: 'patient', type: 'patient',
    label: `Patient — ${p.givenName} ${p.familyName}`,
    name: `${p.givenName} ${p.familyName}`,
    phone: p.phoneMobile ?? undefined, email: p.emailPrimary ?? undefined,
  });

  if (p.gpName) {
    list.push({
      id: 'gp', type: 'gp',
      label: `GP — ${p.gpName}${p.gpPractice ? ` (${p.gpPractice})` : ''}`,
      name: p.gpName, phone: p.gpPhone ?? undefined, email: p.gpEmail ?? undefined,
    });
  }

  if (p.nokName) {
    list.push({
      id: 'nok', type: 'nok',
      label: `Next of Kin — ${p.nokName} (${p.nokRelationship ?? 'unknown'})`,
      name: p.nokName, phone: p.nokPhone ?? undefined,
    });
  }

  (contactsData ?? []).forEach((c: PatientContact, i: number) => {
    const name = [c.givenName, c.familyName].filter(Boolean).join(' ') || 'Unknown';
    const roles = [c.isEmergencyContact && 'Emergency', c.isCarer && 'Carer'].filter(Boolean).join(', ');
    list.push({
      id: `contact-${i}`, type: c.isCarer ? 'carer' : 'support',
      label: `${roles || 'Support'} — ${name} (${c.relationship ?? 'unknown'})`,
      name, phone: c.phoneMobile ?? undefined, email: c.email ?? undefined,
    });
  });

  return list;
}

export interface SendMessageDialogProps {
  open: boolean;
  onClose: () => void;
  patientId: string;
  episodeId?: string;
  onSent?: () => void;
}

export function SendMessageDialog({ open, onClose, patientId, episodeId, onSent }: SendMessageDialogProps) {
  const qc = useQueryClient();
  const recipients = usePatientRecipients(patientId);
  const { data: patient } = usePatient(patientId);

  const [selectedRecipients, setSelectedRecipients] = useState<string[]>([]);
  const [messageText, setMessageText] = useState('');
  const [sending, setSending] = useState(false);

  // Reset on open
  useEffect(() => {
    if (open) { setSelectedRecipients([]); setMessageText(''); }
  }, [open]);

  const handleRecipientsChange = (ids: string[]) => {
    setSelectedRecipients(ids);
    if (ids.length === 1 && !messageText) {
      const r = recipients.find(x => x.id === ids[0]);
      if (r) {
        const p = patient;
        const serviceName = 'Good Health Mental Health';
        setMessageText(
          `Dear ${r.name},\n\n` +
          `Re: ${p?.givenName ?? ''} ${p?.familyName ?? ''}\n\n` +
          `\n\n` +
          `Kind regards,\n${serviceName}`
        );
      }
    }
  };

  const handleSend = async () => {
    setSending(true);
    try {
      const recipientNames = selectedRecipients.map(id => recipients.find(r => r.id === id)?.name ?? id);
      await apiClient.post(`patients/${patientId}/notes`, {
        episodeId: episodeId || undefined,
        title: `Message to ${recipientNames.join(', ')}`,
        noteType: 'message',
        content: messageText.trim(),
        status: 'signed',
        // Include contact metadata so contacts panel can display it
        contactMeta: {
          contactDate: new Date().toISOString().split('T')[0],
          contactTime: new Date().toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: false }),
          contactMedium: 'SMS',
          serviceRecipients: recipientNames,
        },
        isReportableContact: true,
      });
      await qc.refetchQueries({ queryKey: patientsKeys.notes(patientId) });
      await qc.refetchQueries({ queryKey: patientsKeys.messages(patientId) });
      if (episodeId) {
        await qc.refetchQueries({ queryKey: episodesKeys.notes(patientId, episodeId) });
        await qc.refetchQueries({ queryKey: episodesKeys.messages(patientId, episodeId) });
      }
      qc.invalidateQueries({ queryKey: episodesKeys.byPatient(patientId) });
      onSent?.();
      onClose();
    } catch (err: unknown) {
      alert(`Failed to send message: ${getMessageApiErrorText(err)}`);
    } finally {
      setSending(false);
    }
  };

  const selectedDetails = selectedRecipients.map(id => recipients.find(r => r.id === id)).filter(Boolean) as Recipient[];

  return (
    <Dialog aria-labelledby="dialog-title" open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle id="dialog-title" sx={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 1 }}>
        <SmsIcon sx={{ color: '#327C8D' }} />
        Send Message
      </DialogTitle>
      <Divider />
      <DialogContent>
        <Grid container spacing={2} sx={{ mt: 0.5 }}>
          <Grid size={{ xs: 12 }}>
            <FormControl fullWidth size="small">
              <InputLabel id="send-message-recipients-label">Recipients</InputLabel>
              <Select
                labelId="send-message-recipients-label"
                id="send-message-recipients-select"
                multiple
                value={selectedRecipients}
                onChange={e => handleRecipientsChange(typeof e.target.value === 'string' ? e.target.value.split(',') : e.target.value as string[])}
                label="Recipients"
                inputProps={{ 'aria-label': 'Recipients' }}
                renderValue={(sel) => (sel as string[]).map(id => recipients.find(r => r.id === id)?.name ?? id).join(', ')}>
                {recipients.length === 0 && <MenuItem disabled>No contacts registered for this patient</MenuItem>}
                {recipients.map(r => (
                  <MenuItem key={r.id} value={r.id}>
                    <Box>
                      <Typography variant="body2" fontWeight={500}>{r.label}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {r.phone ? `Ph: ${r.phone}` : r.email ? `Email: ${r.email}` : 'No contact details'}
                      </Typography>
                    </Box>
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>

          {selectedDetails.length > 0 && (
            <Grid size={{ xs: 12 }}>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                {selectedDetails.map(r => (
                  <Chip key={r.id} size="small" variant="outlined" sx={{ fontSize: 11 }}
                    label={`${r.name}${r.phone ? ` — ${r.phone}` : r.email ? ` — ${r.email}` : ' (no contact)'}`}
                    color={r.phone || r.email ? 'default' : 'error'} />
                ))}
              </Box>
            </Grid>
          )}

          <Grid size={{ xs: 12 }}>
            <TextField label="Message" fullWidth multiline rows={6} value={messageText} onChange={e => setMessageText(e.target.value)}
              sx={{ '& .MuiInputBase-input': { fontFamily: 'monospace', fontSize: 12 } }} />
          </Grid>
        </Grid>
      </DialogContent>
      <Divider />
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} sx={{ color: 'text.secondary' }}>Cancel</Button>
        <Button variant="contained" startIcon={sending ? <CircularProgress role="progressbar" aria-label="Loading" size={14} sx={{ color: '#fff' }} /> : <SendIcon />}
          onClick={handleSend} disabled={!selectedRecipients.length || !messageText.trim() || sending}
          sx={{ bgcolor: '#327C8D', '&:hover': { bgcolor: '#265f6d' } }}>
          Send
        </Button>
      </DialogActions>
    </Dialog>
  );
}
