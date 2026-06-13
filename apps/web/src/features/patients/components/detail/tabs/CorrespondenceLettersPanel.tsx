import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import DrawIcon from '@mui/icons-material/Draw';
import DownloadIcon from '@mui/icons-material/Download';
import EmailIcon from '@mui/icons-material/Email';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import PrintIcon from '@mui/icons-material/Print';
import SendIcon from '@mui/icons-material/Send';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  Grid,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PatientResponse } from '@signacare/shared';
import DOMPurify from 'dompurify';
import React, { useEffect, useState } from 'react';
import { useTemplates } from '../../../../templates/hooks/useTemplates';
import { Letterhead } from '../../../../../shared/components/ui/Letterhead';
import { apiClient } from '../../../../../shared/services/apiClient';
import { llmAiJobsApi } from '../../../../../shared/services/llmAiJobsApi';
import { unstyledButtonSx } from '../../../../../shared/styles/unstyledButton';
import { openInNewWindow } from '../../../../../shared/utils/openInNewWindow';
import { usePatient } from '../../../hooks/usePatient';
import {
  correspondenceKeys,
  episodesKeys,
  patientReferralsKeys,
  patientsKeys,
} from '../../../queryKeys';
import { ContactFormDialog } from '../../notes/ContactFormDialog';
import { templateSectionsToDraftText } from '../../notes/AddNoteDialogSupport';

interface Recipient {
  id: string;
  label: string;
  name: string;
  phone?: string;
  email?: string;
  type: string;
}

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

interface EpisodeSummary {
  id: string;
  status?: string | null;
}

interface EpisodeListResponse {
  data?: EpisodeSummary[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function extractErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim().length > 0) return error.message;
  if (isRecord(error)) {
    const message = error.message;
    if (typeof message === 'string' && message.trim().length > 0) return message;

    const response = error.response;
    if (isRecord(response)) {
      const data = response.data;
      if (isRecord(data)) {
        const apiError = data.error;
        if (typeof apiError === 'string' && apiError.trim().length > 0) return apiError;
      }
    }
  }
  return fallback;
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
      } catch {
        return [];
      }
    },
    enabled: !!patientId,
  });
  const contactsData = Array.isArray(contactsRaw) ? contactsRaw : [];

  if (!patient) return [];
  const p = patient as PatientRecipientRecord;
  const list: Recipient[] = [];

  list.push({
    id: 'patient',
    type: 'patient',
    label: `Patient — ${p.givenName} ${p.familyName}`,
    name: `${p.givenName} ${p.familyName}`,
    phone: p.phoneMobile ?? undefined,
    email: p.emailPrimary ?? undefined,
  });

  if (p.gpName) {
    list.push({
      id: 'gp',
      type: 'gp',
      label: `GP — ${p.gpName}${p.gpPractice ? ` (${p.gpPractice})` : ''}`,
      name: p.gpName,
      phone: p.gpPhone ?? undefined,
      email: p.gpEmail ?? undefined,
    });
  }

  if (p.nokName) {
    list.push({
      id: 'nok',
      type: 'nok',
      label: `Next of Kin — ${p.nokName} (${p.nokRelationship ?? 'relationship not set'})`,
      name: p.nokName,
      phone: p.nokPhone ?? undefined,
    });
  }

  (contactsData ?? []).forEach((c: PatientContactItem, i: number) => {
    const name = [c.givenName || c.given_name, c.familyName || c.family_name].filter(Boolean).join(' ') || 'Unknown';
    const roles = [(c.isEmergencyContact || c.is_emergency_contact) && 'Emergency', (c.isCarer || c.is_carer) && 'Carer'].filter(Boolean).join(', ');
    list.push({
      id: `contact-${i}`,
      type: c.isCarer || c.is_carer ? 'carer' : c.isEmergencyContact || c.is_emergency_contact ? 'emergency' : 'support',
      label: `${roles || 'Support'} — ${name} (${c.relationship ?? 'unknown'})`,
      name,
      phone: c.phoneMobile || c.phone_mobile || undefined,
      email: c.email ?? undefined,
    });
  });

  if (p.emergencyContactName) {
    const exists = list.some((r) => r.name === p.emergencyContactName);
    if (!exists) {
      list.push({
        id: 'emergency',
        type: 'emergency',
        label: `Emergency Contact — ${p.emergencyContactName} (${p.emergencyContactRelationship ?? 'relationship not set'})`,
        name: p.emergencyContactName,
        phone: p.emergencyContactPhone ?? undefined,
      });
    }
  }

  if (p.providers && Array.isArray(p.providers)) {
    p.providers.forEach((prov: PatientProviderItem, i: number) => {
      list.push({
        id: `provider-${i}`,
        type: 'provider',
        label: `${prov.provider_type || 'Provider'} — ${prov.provider_name}${prov.provider_practice ? ` (${prov.provider_practice})` : ''}`,
        name: prov.provider_name ?? 'Unknown Provider',
        phone: prov.provider_phone ?? undefined,
        email: prov.provider_email ?? undefined,
      });
    });
  }

  return list;
}

interface LettersPanelProps {
  patientId: string;
  composeOpen?: boolean;
  onComposeClose?: () => void;
  fromNoteId?: string | null;
}

export function LettersPanel({
  patientId,
  composeOpen: externalComposeOpen,
  onComposeClose: _externalOnComposeClose,
  fromNoteId,
}: LettersPanelProps) {
  const [composeOpen, setComposeOpen] = useState(false);
  const [contactFormOpen, setContactFormOpen] = useState(false);

  useEffect(() => {
    if (externalComposeOpen) setComposeOpen(true);
  }, [externalComposeOpen]);

  const { data: sourceNote } = useQuery({
    queryKey: correspondenceKeys.sourceNote(fromNoteId ?? null),
    queryFn: () =>
      apiClient
        .get<{ note: { id: string; content?: string; soapAssessment?: string; soapPlan?: string; noteType?: string; noteDateTime?: string } }>(
          `clinical-notes/${fromNoteId}`,
        )
        .then((r) => r.note)
        .catch((err: unknown) => {
          console.warn('[CorrespondenceTab] source-note fetch failed for pre-fill', err);
          return null;
        }),
    enabled: !!fromNoteId,
  });

  const { data: activeEpisode } = useQuery({
    queryKey: episodesKeys.activeShort(patientId),
    queryFn: () =>
      apiClient
        .get<EpisodeListResponse>(`episodes/patient/${patientId}`)
        .then((r) => (r.data ?? []).find((e) => e.status === 'open') ?? null)
        .catch((err: unknown) => {
          console.warn('CorrespondenceTab: query failed', err);
          return null;
        }),
    enabled: !!patientId,
    staleTime: 60_000,
  });

  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);
  const [editDraftSubject, setEditDraftSubject] = useState('');
  const [editDraftBody, setEditDraftBody] = useState('');
  const [selectedRecipient, setSelectedRecipient] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [expandedLetterId, setExpandedLetterId] = useState<string | null>(null);
  const [printLetter, setPrintLetter] = useState<CorrespondenceLetterItem | null>(null);
  const recipients = usePatientRecipients(patientId);
  const { data: patient } = usePatient(patientId);

  const [notePrefilled, setNotePrefilled] = React.useState(false);
  useEffect(() => {
    if (sourceNote && !notePrefilled && body === '' && subject === '') {
      const noteBody =
        [
          sourceNote.soapAssessment ? `Assessment: ${sourceNote.soapAssessment}` : '',
          sourceNote.soapPlan ? `Plan: ${sourceNote.soapPlan}` : '',
        ]
          .filter(Boolean)
          .join('\n\n') ||
        sourceNote.content ||
        '';
      if (noteBody) {
        const dateStr = sourceNote.noteDateTime ? new Date(sourceNote.noteDateTime).toLocaleDateString('en-AU') : '';
        const intro = dateStr ? `Re: Clinical note from ${dateStr}\n\n` : '';
        setBody(intro + noteBody);
        setSubject(`Letter drafted from clinical note${dateStr ? ` ${dateStr}` : ''}`);
        setNotePrefilled(true);
      }
    }
  }, [sourceNote, notePrefilled, body, subject]);

  const { data: templates = [] } = useTemplates({
    status: 'published',
    category: 'Letters',
  });

  const qc = useQueryClient();
  const { data: correspondence } = useQuery({
    queryKey: correspondenceKeys.byPatient(patientId),
    queryFn: () =>
      apiClient.get<CorrespondenceLetterItem[] | CorrespondenceLettersResponse>(`correspondence/letters/patient/${patientId}`).then((r) => (Array.isArray(r) ? r : (r.data ?? []))).catch((err: unknown) => {
        console.warn('CorrespondenceTab: query failed', err);
        return [];
      }),
    enabled: !!patientId,
  });

  const saveDraftMut = useMutation({
    mutationFn: () => {
      const r = recipients.find((x) => x.id === selectedRecipient);
      return apiClient.post('correspondence', {
        patientId,
        episodeId: activeEpisode?.id ?? undefined,
        recipientType: r?.type,
        recipientId: r?.id,
        recipientEmail: r?.email && r.email.length > 0 ? r.email : undefined,
        recipientName: r?.name,
        subject,
        body,
        letterType: r?.type === 'gp' ? 'gp_letter' : 'letter',
        status: 'draft',
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: correspondenceKeys.byPatient(patientId) });
      qc.invalidateQueries({ queryKey: patientReferralsKeys.unifiedContacts(patientId) });
      qc.invalidateQueries({ queryKey: episodesKeys.letters(patientId) });
      setComposeOpen(false);
      setContactFormOpen(true);
    },
    onError: (err: unknown) => alert(`Failed to save letter draft: ${extractErrorMessage(err, 'Unknown error')}`),
  });

  const sendLetterMut = useMutation({
    mutationFn: () => {
      const r = recipients.find((x) => x.id === selectedRecipient);
      return apiClient.post('correspondence', {
        patientId,
        episodeId: activeEpisode?.id ?? undefined,
        recipientType: r?.type,
        recipientId: r?.id,
        recipientEmail: r?.email && r.email.length > 0 ? r.email : undefined,
        recipientName: r?.name,
        subject,
        body,
        letterType: r?.type === 'gp' ? 'gp_letter' : 'letter',
        status: 'sent',
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: correspondenceKeys.byPatient(patientId) });
      qc.invalidateQueries({ queryKey: patientReferralsKeys.unifiedContacts(patientId) });
      qc.invalidateQueries({ queryKey: episodesKeys.letters(patientId) });
      setComposeOpen(false);
      setContactFormOpen(true);
    },
    onError: (err: unknown) => alert(`Failed to send letter: ${extractErrorMessage(err, 'Unknown error')}`),
  });

  const updateDraftMut = useMutation({
    mutationFn: ({ id, subject: s, body: b }: { id: string; subject: string; body: string }) =>
      apiClient.patch(`correspondence/letters/${id}`, { subject: s, body: b }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: correspondenceKeys.byPatient(patientId) });
      qc.invalidateQueries({ queryKey: episodesKeys.letters(patientId) });
      setEditingDraftId(null);
    },
    onError: (err: unknown) => alert(`Failed to update draft: ${extractErrorMessage(err, 'Unknown')}`),
  });

  const p = patient as PatientRecipientRecord | undefined;
  const patientFullName = p ? `${p.givenName} ${p.familyName}` : '[Patient Name]';
  const patientDob = p?.dateOfBirth ? new Date(p.dateOfBirth).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' }) : '[DOB]';
  const patientMrn = p?.emrNumber ?? '[MRN]';
  const patientGender = p?.gender === 'male' ? 'M' : p?.gender === 'female' ? 'F' : '[Gender]';
  const gpName = p?.gpName ?? '[GP Name]';
  const gpPractice = p?.gpPractice ?? '[Practice Name]';

  const handleRecipientChange = (recipientId: string) => {
    setSelectedRecipient(recipientId);
    const r = recipients.find((x) => x.id === recipientId);
    if (!r) return;

    if (r.type === 'gp') {
      setSubject(`Re: ${patientFullName} — Clinical Update`);
      setBody(
        `Dear Dr ${r.name.replace(/^Dr\.?\s*/i, '')},\n\n` +
          `Re: ${p?.gender === 'male' ? 'Mr' : p?.gender === 'female' ? 'Ms' : ''} ${patientFullName} (URNO: ${patientMrn}, Sex: ${patientGender}, DOB: ${patientDob})\n\n` +
          `Thank you for providing ongoing care for ${p?.gender === 'male' ? 'Mr' : 'Ms'} ${p?.familyName ?? '[Surname]'}.\n\n` +
          '[Clinical update]\n\n' +
          "Kindly don't hesitate to contact me for any clarifications.\n\n" +
          'Thank you\nSincerely\n\n[Clinician Name]\n[Title]',
      );
    } else if (r.type === 'nok' || r.type === 'carer' || r.type === 'support') {
      setSubject(`Re: ${patientFullName} — Update`);
      setBody(`Dear ${r.name},\n\n[Letter content]\n\nKind regards,\n\n[Clinician Name]\n[Title]`);
    } else if (r.type === 'patient') {
      setSubject('Your Care Update');
      setBody(`Dear ${p?.givenName ?? '[First Name]'},\n\n[Letter content]\n\nKind regards,\n\n[Clinician Name]\n[Title]`);
    } else {
      setBody(`To Whom It May Concern,\n\nRe: ${patientFullName} (URNO: ${patientMrn}, DOB: ${patientDob})\n\n[Letter content]\n\nYours sincerely,\n\n[Clinician Name]\n[Title]`);
    }
  };

  const handleTemplateChange = (id: string) => {
    setTemplateId(id);
    const t = templates?.find((x) => x.id === id);
    if (t) {
      setSubject(t.name);
      setBody(templateSectionsToDraftText(t.sections));
    }
  };

  const handleAiGenerate = async () => {
    const r = recipients.find((x) => x.id === selectedRecipient);
    if (!r || !p) return;
    setAiLoading(true);
    try {
      const result = await llmAiJobsApi.runClinicalAiJob({
        action: 'letter',
        data: `Generate a ${r.type === 'gp' ? 'GP letter' : 'clinical letter'} for patient ${patientFullName} (URNO: ${patientMrn}, DOB: ${patientDob}, Gender: ${patientGender}). Recipient: ${r.name} (${r.type}). GP: ${gpName} at ${gpPractice}.`,
        patientId,
        enhance: true,
      });
      setBody(result);
    } catch {
      setBody(`${body}\n\n[AI generation failed — write manually]`);
    } finally {
      setAiLoading(false);
    }
  };

  const selectedDetails = recipients.find((r) => r.id === selectedRecipient);

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2 }}>
        <Typography variant="h6" fontWeight={600} fontFamily="Albert Sans, sans-serif">
          Letters
        </Typography>
        <Button
          startIcon={<EmailIcon />}
          variant="contained"
          size="small"
          onClick={() => {
            setComposeOpen(true);
            setBody('');
            setSubject('');
            setSelectedRecipient('');
            setTemplateId('');
          }}
          sx={{ bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' } }}
        >
          Compose Letter
        </Button>
      </Box>

      {(Array.isArray(correspondence) ? correspondence : [])
        .filter((l) => {
          const t = (l.letterType ?? l.letter_type ?? '') as string;
          return t !== 'sms' && t !== 'message' && t !== 'internal_message' && !t.startsWith('sms_');
        })
        .map((l, index) => {
          const letterId = l.id ?? `letter-${index}`;
          const createdAt = l.createdAt ?? l.created_at ?? null;
          const recipientName = l.recipientName ?? l.recipient_name ?? '—';
          const letterType = l.letterType ?? l.letter_type ?? '';
          const isLetterExpanded = expandedLetterId === letterId;
          return (
            <Card key={letterId} variant="outlined" sx={{ mb: 1, '&:hover': { borderColor: '#b8621a' } }}>
              <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Box
                    component="button"
                    type="button"
                    aria-expanded={isLetterExpanded}
                    aria-label={`${l.subject ?? 'Letter'} — ${isLetterExpanded ? 'collapse' : 'expand'}`}
                    onClick={() => setExpandedLetterId(isLetterExpanded ? null : letterId)}
                    sx={{ flex: 1, minWidth: 0, ...unstyledButtonSx, borderRadius: 1, '&:hover': { bgcolor: '#FAFAFA' }, '&:focus-visible': { outline: '2px solid #b8621a', outlineOffset: 2 } }}
                  >
                    <Typography variant="body2" fontWeight={600}>
                      {l.subject}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      To: {recipientName} — {createdAt ? new Date(createdAt).toLocaleDateString('en-AU') : ''}
                    </Typography>
                  </Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Chip label={l.status} size="small" color={l.status === 'sent' ? 'success' : 'default'} sx={{ fontSize: 10, height: 20 }} />
                    <Tooltip title="Open in new window">
                      <IconButton
                        size="small"
                        onClick={() => {
                          openInNewWindow({
                            title: l.subject ?? 'Letter',
                            subtitle: `To: ${recipientName}`,
                            content: l.body ?? l.content ?? '(No content)',
                            meta: {
                              To: recipientName,
                              Type: letterType,
                              Status: l.status ?? '',
                              Date: createdAt ? new Date(createdAt).toLocaleDateString('en-AU') : '',
                            },
                          });
                        }}
                        sx={{ color: '#327C8D', p: 0.25 }}
                      >
                        <OpenInNewIcon sx={{ fontSize: 14 }} />
                      </IconButton>
                    </Tooltip>
                  </Box>
                </Box>
                {isLetterExpanded && (
                  <Box sx={{ mt: 1.5, pt: 1, borderTop: '1px solid #E0E0E0' }}>
                    {editingDraftId === letterId ? (
                      <Box>
                        <TextField fullWidth size="small" label="Subject" value={editDraftSubject} onChange={(e) => setEditDraftSubject(e.target.value)} sx={{ mb: 1 }} />
                        <TextField
                          fullWidth
                          multiline
                          rows={10}
                          value={editDraftBody}
                          onChange={(e) => setEditDraftBody(e.target.value)}
                          sx={{ '& .MuiInputBase-input': { fontFamily: 'monospace', fontSize: 12 } }}
                        />
                        <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end', mt: 1 }}>
                          <Button size="small" onClick={() => setEditingDraftId(null)} sx={{ color: 'text.secondary' }}>
                            Cancel
                          </Button>
                          <Button
                            size="small"
                            variant="contained"
                            disabled={updateDraftMut.isPending}
                            onClick={() => updateDraftMut.mutate({ id: letterId, subject: editDraftSubject, body: editDraftBody })}
                            sx={{ bgcolor: '#327C8D', '&:hover': { bgcolor: '#265f6d' }, textTransform: 'none' }}
                          >
                            {updateDraftMut.isPending ? 'Saving…' : 'Save Draft'}
                          </Button>
                          <Button
                            size="small"
                            variant="contained"
                            disabled={updateDraftMut.isPending}
                            onClick={() => {
                              apiClient
                                .patch(`correspondence/letters/${letterId}`, { subject: editDraftSubject, body: editDraftBody, status: 'sent' })
                                .then(() => {
                                  qc.invalidateQueries({ queryKey: correspondenceKeys.byPatient(patientId) });
                                  qc.invalidateQueries({ queryKey: episodesKeys.letters(patientId) });
                                  setEditingDraftId(null);
                                })
                                .catch((err: unknown) => alert(`Failed: ${extractErrorMessage(err, 'Unknown')}`));
                            }}
                            sx={{ bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' }, textTransform: 'none' }}
                          >
                            Save &amp; Send
                          </Button>
                        </Box>
                      </Box>
                    ) : (
                      <>
                        {l.recipient_email && (
                          <Typography variant="caption" display="block" color="text.secondary">
                            <strong>Email:</strong> {l.recipient_email ?? l.recipientEmail}
                          </Typography>
                        )}
                        {l.letterType && (
                          <Typography variant="caption" display="block" color="text.secondary">
                            <strong>Type:</strong> {l.letterType}
                          </Typography>
                        )}
                        <Typography variant="body2" sx={{ mt: 1, fontSize: 12, whiteSpace: 'pre-wrap', bgcolor: '#F5F5F5', p: 1.5, borderRadius: 1, maxHeight: 300, overflowY: 'auto' }}>
                          {l.body ?? l.content ?? 'No content'}
                        </Typography>
                        {l.notes && (
                          <Typography variant="caption" display="block" color="text.secondary" sx={{ mt: 0.5 }}>
                            <strong>Notes:</strong> {l.notes}
                          </Typography>
                        )}
                        <Box sx={{ mt: 1.5, display: 'flex', gap: 1 }}>
                          {l.status === 'draft' && (
                            <Button
                              size="small"
                              variant="outlined"
                              sx={{ borderColor: '#b8621a', color: '#b8621a', fontSize: 11, textTransform: 'none' }}
                              onClick={() => {
                                setEditingDraftId(letterId);
                                setEditDraftSubject(l.subject ?? '');
                                setEditDraftBody(l.body ?? l.content ?? '');
                              }}
                            >
                              Edit Draft
                            </Button>
                          )}
                          <Button size="small" startIcon={<PrintIcon />} variant="outlined" sx={{ borderColor: '#327C8D', color: '#327C8D', fontSize: 11 }} onClick={() => setPrintLetter(l)}>
                            Print with Letterhead
                          </Button>
                          <Button
                            size="small"
                            startIcon={<DownloadIcon />}
                            variant="outlined"
                            sx={{ borderColor: '#327C8D', color: '#327C8D', fontSize: 11 }}
                            onClick={() => {
                              window.open(`${import.meta.env.VITE_API_URL}/correspondence/letters/${letterId}/pdf`, '_blank');
                            }}
                          >
                            Download PDF
                          </Button>
                          <Button
                            size="small"
                            startIcon={<DrawIcon />}
                            variant="contained"
                            sx={{ bgcolor: '#327C8D', '&:hover': { bgcolor: '#265f6d' }, fontSize: 11 }}
                            onClick={() => {
                              window.open(`${import.meta.env.VITE_API_URL}/correspondence/letters/${letterId}/pdf?sign=true`, '_blank');
                            }}
                          >
                            Signed PDF
                          </Button>
                        </Box>
                      </>
                    )}
                  </Box>
                )}
              </CardContent>
            </Card>
          );
        })}
      {(!correspondence || (Array.isArray(correspondence) && correspondence.length === 0)) && (
        <Paper variant="outlined" sx={{ p: 3, textAlign: 'center', color: 'text.secondary' }}>
          <Typography variant="body2">No letters yet. Click "Compose Letter" to create one.</Typography>
        </Paper>
      )}

      <Dialog aria-labelledby="dialog-title" open={composeOpen} onClose={() => setComposeOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle id="dialog-title">Compose Letter</DialogTitle>
        <Divider />
        <DialogContent>
          {notePrefilled && (
            <Alert role="alert" severity="warning" sx={{ mb: 2, backgroundColor: '#FFF8E1', border: '1.5px solid #F0852C', color: '#3D484B', borderRadius: 2 }}>
              <Typography variant="subtitle2" fontWeight={700}>
                Drafted from Clinical Note
              </Typography>
              <Typography variant="body2">
                This letter body was auto-populated from an existing clinical note. Review for accuracy, redact any content that shouldn't leave the clinic, and verify recipient before sending.
              </Typography>
            </Alert>
          )}
          <Grid container spacing={2} sx={{ mt: 0.5 }}>
            <Grid size={{ xs: 12, sm: 6 }}>
              <FormControl fullWidth size="small">
                <InputLabel>Recipient(s)</InputLabel>
                <Select value={selectedRecipient} onChange={(e) => handleRecipientChange(e.target.value)} label="Recipient(s)">
                  {recipients.length === 0 && <MenuItem disabled>No contacts registered — add in Patient Registration</MenuItem>}
                  {recipients.filter((r) => r.type === 'gp').length > 0 && <MenuItem disabled sx={{ fontWeight: 700, fontSize: 11, color: '#327C8D' }}>— GP / Medical —</MenuItem>}
                  {recipients
                    .filter((r) => r.type === 'gp')
                    .map((r) => (
                      <MenuItem key={r.id} value={r.id}>
                        <Box>
                          <Typography variant="body2" fontWeight={500}>
                            {r.label}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {r.email ?? r.phone ?? ''}
                          </Typography>
                        </Box>
                      </MenuItem>
                    ))}
                  {recipients.filter((r) => r.type === 'provider').length > 0 && <MenuItem disabled sx={{ fontWeight: 700, fontSize: 11, color: '#327C8D' }}>— Other Providers —</MenuItem>}
                  {recipients
                    .filter((r) => r.type === 'provider')
                    .map((r) => (
                      <MenuItem key={r.id} value={r.id}>
                        <Box>
                          <Typography variant="body2" fontWeight={500}>
                            {r.label}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {r.email ?? r.phone ?? ''}
                          </Typography>
                        </Box>
                      </MenuItem>
                    ))}
                  {recipients.filter((r) => r.type === 'patient').length > 0 && <MenuItem disabled sx={{ fontWeight: 700, fontSize: 11, color: '#327C8D' }}>— Patient —</MenuItem>}
                  {recipients
                    .filter((r) => r.type === 'patient')
                    .map((r) => (
                      <MenuItem key={r.id} value={r.id}>
                        <Box>
                          <Typography variant="body2" fontWeight={500}>
                            {r.label}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {r.email ?? r.phone ?? ''}
                          </Typography>
                        </Box>
                      </MenuItem>
                    ))}
                  {recipients.filter((r) => ['nok', 'carer', 'emergency', 'support'].includes(r.type)).length > 0 && (
                    <MenuItem disabled sx={{ fontWeight: 700, fontSize: 11, color: '#327C8D' }}>
                      — Family / Support —
                    </MenuItem>
                  )}
                  {recipients
                    .filter((r) => ['nok', 'carer', 'emergency', 'support'].includes(r.type))
                    .map((r) => (
                      <MenuItem key={r.id} value={r.id}>
                        <Box>
                          <Typography variant="body2" fontWeight={500}>
                            {r.label}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {r.email ?? r.phone ?? ''}
                          </Typography>
                        </Box>
                      </MenuItem>
                    ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <FormControl fullWidth size="small">
                <InputLabel>Template</InputLabel>
                <Select value={templateId} onChange={(e) => handleTemplateChange(e.target.value)} label="Template">
                  <MenuItem value="">— Blank —</MenuItem>
                  {(templates ?? []).map((t) => (
                    <MenuItem key={t.id} value={t.id}>
                      {t.name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>

            {selectedDetails && (
              <Grid size={{ xs: 12 }}>
                <Paper variant="outlined" sx={{ p: 1.5, bgcolor: '#F5F5F5', display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                  <Typography variant="caption">
                    <strong>To:</strong> {selectedDetails.name}
                  </Typography>
                  {selectedDetails.phone && (
                    <Typography variant="caption">
                      <strong>Phone:</strong> {selectedDetails.phone}
                    </Typography>
                  )}
                  {selectedDetails.email && (
                    <Typography variant="caption">
                      <strong>Email:</strong> {selectedDetails.email}
                    </Typography>
                  )}
                  {selectedDetails.type === 'gp' && p?.gpPractice && (
                    <Typography variant="caption">
                      <strong>Practice:</strong> {p.gpPractice}
                    </Typography>
                  )}
                </Paper>
              </Grid>
            )}

            <Grid size={{ xs: 12 }}>
              <TextField label="Subject" fullWidth size="small" value={subject} onChange={(e) => setSubject(e.target.value)} />
            </Grid>
            <Grid size={{ xs: 12 }}>
              <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 0.5 }}>
                <Button size="small" startIcon={aiLoading ? null : <AutoAwesomeIcon />} onClick={handleAiGenerate} disabled={aiLoading || !selectedRecipient} sx={{ fontSize: 11, textTransform: 'none', color: '#b8621a' }}>
                  {aiLoading ? 'Generating...' : 'AI Generate Letter'}
                </Button>
              </Box>
              <TextField
                label="Letter Body"
                fullWidth
                multiline
                rows={14}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                sx={{ '& .MuiInputBase-input': { fontFamily: 'monospace', fontSize: 12 } }}
              />
            </Grid>
          </Grid>
        </DialogContent>
        <Divider />
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setComposeOpen(false)} sx={{ color: 'text.secondary' }}>
            Cancel
          </Button>
          <Button
            variant="outlined"
            onClick={() => saveDraftMut.mutate()}
            disabled={!selectedRecipient || !subject.trim() || !body.trim() || saveDraftMut.isPending}
            sx={{ borderColor: '#327C8D', color: '#327C8D' }}
          >
            {saveDraftMut.isPending ? 'Saving...' : 'Save Draft'}
          </Button>
          <Button
            variant="contained"
            startIcon={<SendIcon />}
            onClick={() => sendLetterMut.mutate()}
            disabled={!selectedRecipient || !subject.trim() || !body.trim() || sendLetterMut.isPending}
            sx={{ bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' } }}
          >
            {sendLetterMut.isPending ? 'Sending...' : 'Send'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog aria-labelledby="print-dialog-title" open={!!printLetter} onClose={() => setPrintLetter(null)} maxWidth="md" fullWidth>
        <DialogTitle id="print-dialog-title" sx={{ fontWeight: 700 }}>
          Letter Preview
        </DialogTitle>
        <Divider />
        <DialogContent>
          {printLetter && (
            <Box id="letterhead-print-area">
              <Letterhead showSignature signatureData={printLetter.signature_data ?? printLetter.signatureData}>
                <Typography variant="body2" sx={{ mb: 2 }}>
                  <strong>Date:</strong>{' '}
                  {(printLetter.createdAt || printLetter.createdAt)
                    ? new Date(printLetter.createdAt || printLetter.createdAt).toLocaleDateString('en-AU', { year: 'numeric', month: 'long', day: 'numeric' })
                    : new Date().toLocaleDateString('en-AU', { year: 'numeric', month: 'long', day: 'numeric' })}
                </Typography>
                <Typography variant="body2" sx={{ mb: 0.5 }}>
                  <strong>To:</strong> {printLetter.recipientName ?? printLetter.recipientName ?? ''}
                </Typography>
                {(printLetter.recipient_email ?? printLetter.recipientEmail) && (
                  <Typography variant="body2" sx={{ mb: 2 }}>
                    <strong>Email:</strong> {printLetter.recipient_email ?? printLetter.recipientEmail}
                  </Typography>
                )}
                <Typography variant="body2" sx={{ mb: 1 }}>
                  <strong>Re:</strong> {printLetter.subject}
                </Typography>
                <Divider sx={{ my: 2 }} />
                <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', lineHeight: 1.8 }}>
                  {printLetter.body ?? printLetter.content ?? ''}
                </Typography>
              </Letterhead>
            </Box>
          )}
        </DialogContent>
        <Divider />
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setPrintLetter(null)}>Close</Button>
          <Button
            variant="contained"
            startIcon={<PrintIcon />}
            sx={{ bgcolor: '#327C8D', '&:hover': { bgcolor: '#265f6d' } }}
            onClick={() => {
              const area = document.getElementById('letterhead-print-area');
              if (area) {
                const w = window.open('', '_blank');
                if (w) {
                  w.document.write(
                    `<html><head><title>Letter</title><style>body{font-family:'Albert Sans',Arial,sans-serif;margin:40px;font-size:13px;line-height:1.6}img{max-height:60px}</style></head><body>${DOMPurify.sanitize(area.innerHTML)}</body></html>`,
                  );
                  w.document.close();
                  w.print();
                }
              }
            }}
          >
            Print
          </Button>
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
        initialNoteType="letter"
        initialNoteTitle={subject || 'Correspondence'}
      />
    </Box>
  );
}
