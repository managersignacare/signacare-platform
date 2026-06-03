import SendIcon from '@mui/icons-material/Send';
import SmsIcon from '@mui/icons-material/Sms';
import {
    Box, Button, Card, CardContent, Chip, Dialog, DialogActions, DialogContent,
    DialogTitle, FormControl, Grid, InputLabel, MenuItem, Paper, Select, TextField, Typography
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import React, { useState } from 'react';
import type { PatientResponse } from '@signacare/shared';
import { apiClient } from '../../../../../shared/services/apiClient';
import { openInNewWindow } from '../../../../../shared/utils/openInNewWindow';
import { printContent } from '../../../../../shared/utils/printContent';
import { usePatient } from '../../../hooks/usePatient';
import { ContactFormDialog } from '../../notes/ContactFormDialog';
import {
  patientsKeys,
  correspondenceKeys,
  patientReferralsKeys,
  messagingCrossKeys,
} from '../../../queryKeys';

// ── Build recipient list from actual patient data ──
interface Recipient { id: string; label: string; name: string; phone?: string; email?: string; type: string }

interface PatientContactItem {
  givenName?: string | null;
  given_name?: string | null;
  familyName?: string | null;
  family_name?: string | null;
  relationship?: string | null;
  phoneMobile?: string | null;
  phone_mobile?: string | null;
  email?: string | null;
  isEmergencyContact?: boolean | null;
  is_emergency_contact?: boolean | null;
  isCarer?: boolean | null;
  is_carer?: boolean | null;
}

interface ContactsResponse {
  contacts?: PatientContactItem[];
}

interface PatientProviderItem {
  provider_type?: string | null;
  provider_name?: string | null;
  provider_practice?: string | null;
  provider_phone?: string | null;
  provider_email?: string | null;
}

type PatientRecipientRecord = PatientResponse & {
  providers?: PatientProviderItem[] | null;
  emailPrimary?: string | null;
  phoneMobile?: string | null;
  gpName?: string | null;
  gpPractice?: string | null;
  gpPhone?: string | null;
  gpEmail?: string | null;
  nokName?: string | null;
  nokRelationship?: string | null;
  nokPhone?: string | null;
  emergencyContactName?: string | null;
  emergencyContactRelationship?: string | null;
  emergencyContactPhone?: string | null;
  emrNumber?: string | null;
  dateOfBirth?: string | null;
  gender?: string | null;
};

interface CorrespondenceMessageItem {
  id?: string;
  createdAt?: string | null;
  created_at?: string | null;
  senderName?: string | null;
  sender_name?: string | null;
  subject?: string | null;
  title?: string | null;
  body?: string | null;
  content?: string | null;
  status?: string | null;
  recipientName?: string | null;
  recipient_name?: string | null;
  didNotAttend?: boolean | null;
}

interface MessageThreadItem {
  id?: string;
  subject?: string | null;
  participantNames?: string[];
  participant_names?: string[];
  lastMessageAt?: string | null;
  last_message_at?: string | null;
  createdAt?: string | null;
  created_at?: string | null;
  lastMessagePreview?: string | null;
  last_message_preview?: string | null;
  isArchived?: boolean | null;
  is_archived?: boolean | null;
  unreadCount?: number | null;
  unread_count?: number | null;
}

interface MessageThreadDetail {
  messages?: CorrespondenceMessageItem[];
}

interface CorrespondenceLetterItem {
  id?: string;
  subject?: string | null;
  body?: string | null;
  content?: string | null;
  status?: string | null;
  recipientName?: string | null;
  recipient_name?: string | null;
  recipientEmail?: string | null;
  recipient_email?: string | null;
  letterType?: string | null;
  letter_type?: string | null;
  createdAt?: string | null;
  created_at?: string | null;
  signatureData?: string | null;
  signature_data?: string | null;
  notes?: string | null;
}

interface CorrespondenceLettersResponse {
  data?: CorrespondenceLetterItem[];
}

interface ThreadListResponse {
  data?: MessageThreadItem[];
}

function buildThreadTranscript(messages: CorrespondenceMessageItem[] | undefined): string {
  if (!Array.isArray(messages) || messages.length === 0) return '';
  return messages
    .map((msg) => {
      const sender = msg.senderName ?? msg.sender_name ?? 'Staff';
      const at = msg.createdAt ?? msg.created_at;
      const when = at
        ? new Date(at).toLocaleString('en-AU', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
        : 'Unknown time';
      const body = (msg.body ?? msg.content ?? '').trim();
      return `[${when}] ${sender}\n${body}`;
    })
    .join('\n\n');
}

function usePatientRecipients(patientId: string): Recipient[] {
  const { data: patient } = usePatient(patientId);
  const { data: contactsRaw } = useQuery({
    queryKey: patientsKeys.contactsAlt(patientId),
    queryFn: async () => {
      try {
        const r = await apiClient.get<ContactsResponse | PatientContactItem[]>(`patients/${patientId}/contacts`);
        if (Array.isArray(r)) return r;
        if (Array.isArray(r?.contacts)) return r.contacts;
        return [];
      } catch { return []; }
    },
    enabled: !!patientId,
  });
  const contactsData = Array.isArray(contactsRaw) ? contactsRaw : [];

  if (!patient) return [];
  const p = patient as PatientRecipientRecord;
  const list: Recipient[] = [];

  // Patient themselves
  list.push({
    id: 'patient', type: 'patient',
    label: `Patient — ${p.givenName} ${p.familyName}`,
    name: `${p.givenName} ${p.familyName}`,
    phone: p.phoneMobile ?? undefined, email: p.emailPrimary ?? undefined,
  });

  // GP
  if (p.gpName) {
    list.push({
      id: 'gp', type: 'gp',
      label: `GP — ${p.gpName}${p.gpPractice ? ` (${p.gpPractice})` : ''}`,
      name: p.gpName,
      phone: p.gpPhone ?? undefined, email: p.gpEmail ?? undefined,
    });
  }

  // NOK
  if (p.nokName) {
    list.push({
      id: 'nok', type: 'nok',
      label: `Next of Kin — ${p.nokName} (${p.nokRelationship ?? 'relationship not set'})`,
      name: p.nokName,
      phone: p.nokPhone ?? undefined,
    });
  }

  // Support persons / contacts
  (contactsData ?? []).forEach((c: PatientContactItem, i: number) => {
    const name = [c.givenName || c.given_name, c.familyName || c.family_name].filter(Boolean).join(' ') || 'Unknown';
    const roles = [(c.isEmergencyContact || c.is_emergency_contact) && 'Emergency', (c.isCarer || c.is_carer) && 'Carer'].filter(Boolean).join(', ');
    list.push({
      id: `contact-${i}`, type: c.isCarer || c.is_carer ? 'carer' : c.isEmergencyContact || c.is_emergency_contact ? 'emergency' : 'support',
      label: `${roles || 'Support'} — ${name} (${c.relationship ?? 'unknown'})`,
      name,
      phone: c.phoneMobile || c.phone_mobile || undefined, email: c.email ?? undefined,
    });
  });

  // Emergency contact from patient record
  if (p.emergencyContactName) {
    const exists = list.some(r => r.name === p.emergencyContactName);
    if (!exists) {
      list.push({
        id: 'emergency', type: 'emergency',
        label: `Emergency Contact — ${p.emergencyContactName} (${p.emergencyContactRelationship ?? 'relationship not set'})`,
        name: p.emergencyContactName,
        phone: p.emergencyContactPhone ?? undefined,
      });
    }
  }

  // Other providers (psychiatrist, psychologist, etc.) from patient_providers table
  // These are fetched via the contacts endpoint above — also check for providers
  if (p.providers && Array.isArray(p.providers)) {
    p.providers.forEach((prov: PatientProviderItem, i: number) => {
      list.push({
        id: `provider-${i}`, type: 'provider',
        label: `${prov.provider_type || 'Provider'} — ${prov.provider_name}${prov.provider_practice ? ` (${prov.provider_practice})` : ''}`,
        name: prov.provider_name ?? 'Unknown Provider',
        phone: prov.provider_phone ?? undefined, email: prov.provider_email ?? undefined,
      });
    });
  }

  return list;
}

// ── All Correspondence Panel (merged chronological view) ─────────────────────

interface AllCorrespondencePanelProps { patientId: string }
export function AllCorrespondencePanel({ patientId }: AllCorrespondencePanelProps) {
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  // Fetch SMS/message notes
  const { data: messages } = useQuery({
    queryKey: patientsKeys.messages(patientId),
    queryFn: () => apiClient
      .get<CorrespondenceMessageItem[] | { notes?: CorrespondenceMessageItem[] }>(`patients/${patientId}/notes`, { type: 'message' })
      .then((r) => Array.isArray(r) ? r : (r.notes ?? []))
      .catch((err: unknown) => { console.warn('CorrespondenceTab: query failed', err); return []; }),
    enabled: !!patientId,
  });

  // Fetch message threads (internal secure messages)
  const { data: threads } = useQuery({
    queryKey: messagingCrossKeys.threadsForPatient(patientId),
    queryFn: () => apiClient
      .get<MessageThreadItem[] | ThreadListResponse>('messages/threads', { patientId })
      .then((r) => Array.isArray(r) ? r : (r?.data ?? []))
      .catch((err: unknown) => { console.warn('CorrespondenceTab: query failed', err); return []; }),
    enabled: !!patientId,
  });

  // Fetch letters / correspondence
  const { data: correspondence } = useQuery({
    queryKey: correspondenceKeys.byPatient(patientId),
    queryFn: () => apiClient
      .get<CorrespondenceLetterItem[] | CorrespondenceLettersResponse>(`correspondence/letters/patient/${patientId}`)
      .then((r) => Array.isArray(r) ? r : (r.data ?? []))
      .catch((err: unknown) => { console.warn('CorrespondenceTab: query failed', err); return []; }),
    enabled: !!patientId,
  });

  // Merge into a single chronological list
  const mergedItems = React.useMemo(() => {
    const items: { id: string; date: string; type: 'sms' | 'thread' | 'letter'; title: string; preview: string; status: string; recipient: string; fullContent?: string }[] = [];

    // SMS messages
    for (const m of (Array.isArray(messages) ? messages : [] as CorrespondenceMessageItem[])) {
      items.push({
        id: m.id ?? `sms-${items.length}`,
        date: m.createdAt ?? m.created_at ?? '',
        type: 'sms',
        title: m.subject || m.title || 'SMS Message',
        preview: (m.body || m.content || '').substring(0, 120),
        status: m.status || 'sent',
        recipient: m.recipientName ?? m.recipient_name ?? '',
        fullContent: m.body ?? m.content ?? '',
      });
    }

    // Internal message threads
    for (const t of (Array.isArray(threads) ? threads : [] as MessageThreadItem[])) {
      const participantNames = Array.isArray(t.participantNames)
        ? t.participantNames
        : Array.isArray(t.participant_names)
          ? t.participant_names
          : [];
      const unreadCount = t.unreadCount ?? t.unread_count ?? 0;
      items.push({
        id: t.id ?? `thread-${items.length}`,
        date: t.lastMessageAt ?? t.last_message_at ?? t.createdAt ?? t.created_at ?? '',
        type: 'thread',
        title: t.subject || 'Message Thread',
        preview: t.lastMessagePreview ?? t.last_message_preview ?? '',
        status: (t.isArchived ?? t.is_archived) ? 'archived' : unreadCount > 0 ? 'unread' : 'read',
        recipient: participantNames.join(', '),
      });
    }

    // Letters
    for (const l of (Array.isArray(correspondence) ? correspondence : [] as CorrespondenceLetterItem[])) {
      items.push({
        id: l.id ?? `letter-${items.length}`,
        date: l.createdAt ?? l.created_at ?? '',
        type: 'letter',
        title: l.subject || 'Letter',
        preview: (l.body || l.content || '').substring(0, 120),
        status: l.status || 'draft',
        recipient: l.recipientName ?? l.recipient_name ?? '',
        fullContent: l.body ?? l.content ?? '',
      });
    }

    // Sort descending by date
    items.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    return items;
  }, [messages, threads, correspondence]);

  const typeConfig: Record<string, { color: string; label: string; chipColor: 'info' | 'warning' | 'success' }> = {
    sms: { color: '#b8621a', label: 'SMS', chipColor: 'warning' },
    thread: { color: '#327C8D', label: 'Message', chipColor: 'info' },
    letter: { color: '#3D484B', label: 'Letter', chipColor: 'success' },
  };

  if (mergedItems.length === 0) {
    return (
      <Paper variant="outlined" sx={{ p: 3, textAlign: 'center', color: 'text.secondary' }}>
        <Typography variant="body2">No correspondence yet. Use the other tabs to send messages or compose letters.</Typography>
      </Paper>
    );
  }

  return (
    <Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Showing all messages, threads, and letters in chronological order.
      </Typography>
      {mergedItems.map((item) => {
        const cfg = typeConfig[item.type] ?? typeConfig.sms;
        const isExpanded = expandedItemId === item.id;
        const resolvedBody = item.fullContent?.trim().length ? item.fullContent : item.preview;
        return (
          <Card key={item.id} variant="outlined" sx={{ mb: 1, '&:hover': { borderColor: cfg.color }, borderLeft: `3px solid ${cfg.color}` }}>
            <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 }, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.25 }}>
                  <Chip label={cfg.label} size="small" color={cfg.chipColor} sx={{ fontSize: 9, height: 18, fontWeight: 600 }} />
                  <Typography variant="body2" fontWeight={600}>{item.title}</Typography>
                </Box>
                {item.recipient && (
                  <Typography variant="caption" color="text.secondary">
                    To: {item.recipient}
                  </Typography>
                )}
                {item.preview && (
                  <Typography
                    variant="caption"
                    display="block"
                    sx={{
                      mt: 0.25,
                      color: 'text.secondary',
                      maxWidth: 500,
                      whiteSpace: isExpanded ? 'pre-wrap' : 'nowrap',
                      overflow: 'hidden',
                      textOverflow: isExpanded ? 'clip' : 'ellipsis',
                    }}
                  >
                    {isExpanded ? resolvedBody : `${item.preview}${item.preview.length >= 120 ? '...' : ''}`}
                  </Typography>
                )}
                {item.type === 'thread' && (
                  <Typography variant="caption" display="block" sx={{ mt: 0.5, color: 'text.disabled' }}>
                    Open the Threads tab to read the full secure conversation transcript.
                  </Typography>
                )}
              </Box>
              <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 0.5, ml: 2, flexShrink: 0 }}>
                <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10, whiteSpace: 'nowrap' }}>
                  {item.date ? new Date(item.date).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}
                </Typography>
                <Chip label={item.status} size="small" color={item.status === 'sent' ? 'success' : item.status === 'unread' ? 'warning' : 'default'} sx={{ fontSize: 10, height: 20 }} />
                <Button size="small" onClick={() => setExpandedItemId(isExpanded ? null : item.id)} sx={{ textTransform: 'none', minWidth: 0, fontSize: 11 }}>
                  {isExpanded ? 'Collapse' : 'Read'}
                </Button>
              </Box>
            </CardContent>
          </Card>
        );
      })}
    </Box>
  );
}

// ── Message Threads Panel (internal secure messages) ─────────────────────────

interface MessageThreadsPanelProps { patientId: string; composeOpen?: boolean; onComposeClose?: () => void }
export function MessageThreadsPanel({ patientId, composeOpen: _composeOpen, onComposeClose: _onComposeClose }: MessageThreadsPanelProps) {
  const [expandedThreadId, setExpandedThreadId] = useState<string | null>(null);
  const { data: threads, isLoading } = useQuery({
    queryKey: messagingCrossKeys.threadsForPatient(patientId),
    queryFn: () => apiClient.get<MessageThreadItem[]>('messages/threads', { params: { patientId } }).catch((err: unknown) => { console.warn('CorrespondenceTab: query failed', err); return []; }),
    enabled: !!patientId,
  });
  // Fetch messages for expanded thread
  const { data: threadMessages } = useQuery({
    queryKey: messagingCrossKeys.thread(expandedThreadId),
    queryFn: () => apiClient.get<MessageThreadDetail>(`messages/threads/${expandedThreadId}`).then((r) => r.messages ?? []).catch((err: unknown) => { console.warn('CorrespondenceTab: query failed', err); return []; }),
    enabled: !!expandedThreadId,
  });
  const expandedThreadTranscript = React.useMemo(
    () => buildThreadTranscript((threadMessages ?? []) as CorrespondenceMessageItem[]),
    [threadMessages],
  );

  const threadsList: MessageThreadItem[] = Array.isArray(threads) ? threads : [];

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2 }}>
        <Typography variant="h6" fontWeight={600} fontFamily="Albert Sans, sans-serif">Internal Message Threads</Typography>
      </Box>

      {isLoading ? (
        <Typography variant="body2" color="text.secondary">Loading threads...</Typography>
      ) : threadsList.length > 0 ? threadsList.map((t, idx) => {
        const threadId = t.id ?? `thread-${idx}`;
        const isThreadExpanded = expandedThreadId === threadId;
        const toggleThread = () => setExpandedThreadId(isThreadExpanded ? null : threadId);
        const participantNames = Array.isArray(t.participantNames)
          ? t.participantNames
          : Array.isArray(t.participant_names)
            ? t.participant_names
            : [];
        const lastMessagePreview = t.lastMessagePreview ?? t.last_message_preview ?? '';
        const lastMessageAt = t.lastMessageAt ?? t.last_message_at ?? null;
        const unreadCount = t.unreadCount ?? t.unread_count ?? 0;
        return (
        <Card key={threadId} variant="outlined"
          role="button"
          tabIndex={0}
          aria-expanded={isThreadExpanded}
          aria-label={`${t.subject || 'Message Thread'} — ${isThreadExpanded ? 'collapse' : 'expand'}`}
          onClick={toggleThread}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleThread(); } }}
          sx={{ mb: 1, cursor: 'pointer', '&:hover': { borderColor: '#327C8D', bgcolor: '#FAFAFA' }, borderLeft: '3px solid #327C8D' }}>
          <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 }, display: 'flex', justifyContent: 'space-between' }}>
            <Box>
              <Typography variant="body2" fontWeight={600}>{t.subject || 'Message Thread'}</Typography>
              <Typography variant="caption" color="text.secondary">
                Participants: {participantNames.join(', ') || 'Unknown'}
              </Typography>
              {lastMessagePreview && expandedThreadId !== threadId && (
                <Typography variant="caption" display="block" sx={{ mt: 0.25, color: 'text.secondary', maxWidth: 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {lastMessagePreview}
                </Typography>
              )}
            </Box>
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 0.5 }}>
              <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10, whiteSpace: 'nowrap' }}>
                {lastMessageAt ? new Date(lastMessageAt).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}
              </Typography>
              {unreadCount > 0 && (
                <Chip label={`${unreadCount} unread`} size="small" color="warning" sx={{ fontSize: 10, height: 20, fontWeight: 600 }} />
              )}
            </Box>
          </CardContent>
          {/* Expanded thread messages */}
          {expandedThreadId === threadId && (
            <Box sx={{ px: 2, pb: 2, borderTop: '1px solid #E0E0E0' }}>
              {(threadMessages ?? []).length > 0 ? (threadMessages ?? []).map((msg, mi) => (
                <Box key={msg.id ?? mi} sx={{ py: 1, borderBottom: mi < ((threadMessages ?? []).length - 1) ? '1px solid #F5F5F5' : 'none' }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.25 }}>
                    <Typography variant="caption" fontWeight={600} color="text.primary">{msg.senderName ?? msg.sender_name ?? 'Staff'}</Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ fontSize: 9 }}>
                      {msg.createdAt ? new Date(msg.createdAt).toLocaleString('en-AU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}
                    </Typography>
                  </Box>
                  <Typography variant="body2" sx={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>{msg.body ?? msg.content ?? ''}</Typography>
                </Box>
              )) : <Typography variant="caption" color="text.secondary" sx={{ py: 1, display: 'block' }}>Loading messages...</Typography>}
                {(threadMessages ?? []).length > 0 && (
                  <Box sx={{ mt: 1, display: 'flex', gap: 1 }}>
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={() =>
                        openInNewWindow({
                          title: t.subject || 'Message Thread',
                          subtitle: participantNames.join(', '),
                          content: expandedThreadTranscript,
                          meta: {
                            Type: 'Message Thread',
                            Participants: participantNames.join(', '),
                            Date: lastMessageAt ? new Date(lastMessageAt).toLocaleDateString('en-AU') : '',
                          },
                        })
                      }
                      sx={{ textTransform: 'none', fontSize: 11 }}
                    >
                      Open in Window
                    </Button>
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={() =>
                        printContent({
                          title: t.subject || 'Message Thread',
                          subtitle: participantNames.join(', '),
                          body: expandedThreadTranscript,
                        })
                      }
                      sx={{ textTransform: 'none', fontSize: 11 }}
                    >
                      Print
                    </Button>
                  </Box>
                )}
            </Box>
          )}
        </Card>
        );
      }) : (
        <Paper variant="outlined" sx={{ p: 3, textAlign: 'center', color: 'text.secondary' }}>
          <Typography variant="body2">No internal message threads for this patient.</Typography>
        </Paper>
      )}
    </Box>
  );
}

// ── Messages Panel ────────────────────────────────────────────────────────────

interface MessagesPanelProps { patientId: string }
export function MessagesPanel({ patientId }: MessagesPanelProps) {
  const [expandedMessageId, setExpandedMessageId] = useState<string | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [contactFormOpen, setContactFormOpen] = useState(false);
  const [lastMessageSubject, setLastMessageSubject] = useState('');
  const [selectedRecipients, setSelectedRecipients] = useState<string[]>([]);
  const [messageText, setMessageText] = useState('');
  const recipients = usePatientRecipients(patientId);
  const qc = useQueryClient();

  const { data: messages } = useQuery({
    queryKey: patientsKeys.messages(patientId),
    queryFn: () => apiClient.get<CorrespondenceMessageItem[]>(`patients/${patientId}/notes`, { type: 'message' }).catch((err: unknown) => { console.warn('CorrespondenceTab: query failed', err); return []; }),
    enabled: !!patientId,
  });

  const selectedDetails = selectedRecipients.map(id => recipients.find(r => r.id === id)).filter(Boolean) as Recipient[];

  // Phase 10E — renamed from sendSmsMut. The button used to say "New
  // SMS" but nothing actually dispatched SMS: it only persisted a
  // correspondence row with `letterType='sms'` for the audit trail.
  // Post-Phase-12 the patient-outreach dispatcher will pick up rows
  // with `letterType='patient_message'` + `delivery_channel='auto'|
  // 'sms'|'fcm'` and actually deliver them. Until then, the button
  // name honestly reflects what happens: a durable patient message
  // audit row is written; the clinician follows up out of band.
  const sendPatientMessageMut = useMutation({
    mutationFn: () => apiClient.post('correspondence/letters', {
      patientId,
      recipientName: selectedDetails.map(r => r.name).join(', ') || 'Patient',
      recipientEmail: selectedDetails[0]?.email ?? undefined,
      subject: `Patient message — ${selectedDetails.map(r => r.name).join(', ')}`,
      body: messageText,
      letterType: 'patient_message',
      status: 'sent',
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: patientsKeys.messages(patientId) });
      qc.invalidateQueries({ queryKey: correspondenceKeys.byPatient(patientId) });
      qc.invalidateQueries({ queryKey: patientReferralsKeys.unifiedContacts(patientId) });
      setLastMessageSubject(`Patient message — ${selectedDetails.map(r => r.name).join(', ')}`);
      setComposeOpen(false);
      setMessageText('');
      setSelectedRecipients([]);
      setContactFormOpen(true);
    },
  });

  // Pre-fill greeting when recipients change
  const handleRecipientsChange = (ids: string[]) => {
    setSelectedRecipients(ids);
    if (ids.length === 1) {
      const r = recipients.find(x => x.id === ids[0]);
      if (r && !messageText) {
        setMessageText(`Dear ${r.name},\n\n\n\nKind regards,\n[Your name]\n[Service name]`);
      }
    }
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2 }}>
        <Typography variant="h6" fontWeight={600} fontFamily="Albert Sans, sans-serif">Messages</Typography>
        <Button startIcon={<SmsIcon />} variant="contained" size="small" onClick={() => { setComposeOpen(true); setMessageText(''); setSelectedRecipients([]); }}
          sx={{ bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' } }}>Send Patient Message</Button>
      </Box>

      {Array.isArray(messages) && messages.length > 0 ? messages.map((m, index) => {
        const messagePreview = m.body ?? m.content ?? '';
          const messageId = m.id ?? `message-${index}`;
          const isExpanded = expandedMessageId === messageId;
        return (
        <Card key={messageId} variant="outlined" sx={{ mb: 1, '&:hover': { borderColor: '#b8621a' } }}>
          <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 }, display: 'flex', justifyContent: 'space-between', gap: 2 }}>
            <Box>
              <Typography variant="body2" fontWeight={600}>{m.subject || m.title || 'SMS Message'}</Typography>
              <Typography variant="caption" color="text.secondary">
                {m.recipientName || m.recipient_name || 'Recipient'} — {(m.createdAt || m.created_at) ? new Date(m.createdAt || m.created_at || '').toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}
              </Typography>
              {messagePreview.length > 0 && (
                <Typography
                    variant="caption"
                    display="block"
                    sx={{
                      mt: 0.5,
                      color: 'text.secondary',
                      maxWidth: 520,
                      whiteSpace: isExpanded ? 'pre-wrap' : 'nowrap',
                      overflow: 'hidden',
                      textOverflow: isExpanded ? 'clip' : 'ellipsis',
                    }}
                  >
                  {isExpanded ? messagePreview : `${messagePreview.substring(0, 120)}${messagePreview.length > 120 ? '...' : ''}`}
                </Typography>
              )}
            </Box>
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 0.5, flexShrink: 0 }}>
                <Chip label={m.status || 'sent'} size="small" color={m.status === 'sent' ? 'success' : m.status === 'draft' ? 'default' : 'info'} sx={{ fontSize: 10, height: 20 }} />
                <Button size="small" onClick={() => setExpandedMessageId(isExpanded ? null : messageId)} sx={{ textTransform: 'none', minWidth: 0, fontSize: 11 }}>
                  {isExpanded ? 'Collapse' : 'Read'}
                </Button>
                {isExpanded && (
                  <>
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={() =>
                        openInNewWindow({
                          title: m.subject || m.title || 'Patient Message',
                          subtitle: `${m.recipientName || m.recipient_name || 'Recipient'} — ${(m.createdAt || m.created_at) ? new Date(m.createdAt || m.created_at || '').toLocaleDateString('en-AU') : ''}`,
                          content: messagePreview,
                          meta: { Status: m.status ?? 'sent' },
                        })
                      }
                      sx={{ textTransform: 'none', fontSize: 11 }}
                    >
                      Open in Window
                    </Button>
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={() =>
                        printContent({
                          title: m.subject || m.title || 'Patient Message',
                          subtitle: `${m.recipientName || m.recipient_name || 'Recipient'}`,
                          body: messagePreview,
                        })
                      }
                      sx={{ textTransform: 'none', fontSize: 11 }}
                    >
                      Print
                    </Button>
                  </>
                )}
              </Box>
          </CardContent>
        </Card>
        );
      }) : (
        <Paper variant="outlined" sx={{ p: 3, textAlign: 'center', color: 'text.secondary' }}>
          <Typography variant="body2">No messages yet. Click "Send Patient Message" to record one.</Typography>
        </Paper>
      )}

      <Dialog aria-labelledby="dialog-title" open={composeOpen} onClose={() => setComposeOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle id="dialog-title">Send Patient Message</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 0.5 }}>
            <Grid size={{ xs: 12 }}>
              <FormControl fullWidth size="small">
                <InputLabel>Recipients</InputLabel>
                <Select multiple value={selectedRecipients}
                  onChange={e => handleRecipientsChange(typeof e.target.value === 'string' ? e.target.value.split(',') : e.target.value as string[])}
                  label="Recipients"
                  renderValue={(sel) => (sel as string[]).map(id => recipients.find(r => r.id === id)?.label ?? id).join(', ')}>
                  {recipients.map(r => (
                    <MenuItem key={r.id} value={r.id}>
                      <Box>
                        <Typography variant="body2" fontWeight={500}>{r.label}</Typography>
                        {r.phone && <Typography variant="caption" color="text.secondary">{r.phone}</Typography>}
                      </Box>
                    </MenuItem>
                  ))}
                  {recipients.length === 0 && <MenuItem disabled>No contacts registered for this patient</MenuItem>}
                </Select>
              </FormControl>
            </Grid>

            {/* Show selected recipient details */}
            {selectedDetails.length > 0 && (
              <Grid size={{ xs: 12 }}>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                  {selectedDetails.map(r => (
                    <Chip key={r.id} label={`${r.name}${r.phone ? ` — ${r.phone}` : ' (no phone)'}`} size="small"
                      color={r.phone ? 'default' : 'error'} variant="outlined" sx={{ fontSize: 11 }} />
                  ))}
                </Box>
              </Grid>
            )}

            <Grid size={{ xs: 12 }}>
              <TextField label="Message" fullWidth multiline rows={4} value={messageText} onChange={e => setMessageText(e.target.value)} />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setComposeOpen(false)}>Cancel</Button>
          <Button variant="contained" startIcon={<SendIcon />} disabled={!selectedRecipients.length || !messageText.trim() || sendPatientMessageMut.isPending}
            onClick={() => sendPatientMessageMut.mutate()}
            sx={{ bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' } }}>{sendPatientMessageMut.isPending ? 'Saving…' : 'Save Message'}</Button>
        </DialogActions>
      </Dialog>

      <ContactFormDialog
        open={contactFormOpen}
        patientId={patientId}
        onClose={() => setContactFormOpen(false)}
        onSaved={() => {
          setContactFormOpen(false);
          qc.invalidateQueries({ queryKey: patientReferralsKeys.unifiedContacts(patientId) });
        }}
        initialNoteType="message"
        initialNoteTitle={lastMessageSubject || 'SMS Message'}
      />
    </Box>
  );
}

export { LettersPanel } from './CorrespondenceLettersPanel';
