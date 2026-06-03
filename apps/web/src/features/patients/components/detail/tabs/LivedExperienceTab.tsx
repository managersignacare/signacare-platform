import AddIcon from '@mui/icons-material/Add';
import FavoriteIcon from '@mui/icons-material/Favorite';
import MailOutlineIcon from '@mui/icons-material/MailOutline';
import PeopleIcon from '@mui/icons-material/People';
import SendIcon from '@mui/icons-material/Send';
import {
    Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent,
    DialogTitle, Divider, FormControl, InputLabel, MenuItem, Paper, Select, Snackbar,
    Tab, Tabs, TextField, Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { apiClient } from '../../../../../shared/services/apiClient';
import { AddNoteDialog } from '../../notes/AddNoteDialog';
import { patientsKeys, episodesKeys, correspondenceKeys } from '../../../queryKeys';

type PeerSubTab = 'consumer' | 'carer';
interface PatientNoteRow {
  id?: string;
  noteType?: string;
  episodeId?: string | null;
  title?: string;
  status?: string;
  createdAt?: string;
  authorName?: string;
  content?: string;
}
interface EpisodeRow {
  id?: string;
  title?: string;
}
interface PatientDetailRow {
  givenName?: string;
  firstName?: string;
  familyName?: string;
  lastName?: string;
  emailPrimary?: string;
  email?: string;
  gpName?: string;
  gp_name?: string;
  gpEmail?: string;
  gp_email?: string;
}
interface ContactRow {
  isCarer?: boolean;
  isEmergencyContact?: boolean;
  givenName?: string;
  firstName?: string;
  familyName?: string;
  lastName?: string;
  name?: string;
  email?: string;
}
interface PeerLetterRow {
  id?: string;
  letterType?: string;
  subject?: string;
  title?: string;
  status?: string;
  recipientName?: string;
  createdAt?: string;
  body?: string;
  content?: string;
}

function getErrorMessage(err: unknown): string {
  if (err && typeof err === 'object') {
    const withResponse = err as { response?: { data?: { error?: unknown } } };
    const apiError = withResponse.response?.data?.error;
    if (typeof apiError === 'string' && apiError.trim()) return apiError;
    const withMessage = err as { message?: unknown };
    if (typeof withMessage.message === 'string' && withMessage.message.trim()) return withMessage.message;
  }
  return 'Unknown';
}

const SUBTYPE_CONFIG = {
  consumer: {
    noteType: 'consumer_peer_support',
    label: 'Consumer Peer Support',
    color: '#6A1B9A',
    bgColor: '#F3E5F5',
    icon: <PeopleIcon sx={{ fontSize: 18 }} />,
    description: 'Notes from consumer peer support workers — lived experience of mental health recovery shared with the consumer.',
    addLabel: 'Add Consumer Peer Support Note',
  },
  carer: {
    noteType: 'carer_peer_support',
    label: 'Carer Peer Support',
    color: '#AD1457',
    bgColor: '#FCE4EC',
    icon: <FavoriteIcon sx={{ fontSize: 18 }} />,
    description: 'Notes from carer peer support workers — lived experience of supporting a person with mental illness shared with the carer.',
    addLabel: 'Add Carer Peer Support Note',
  },
} as const;

function usePatientNotes(patientId: string) {
  return useQuery({
    queryKey: patientsKeys.notes(patientId),
    queryFn: () => apiClient.get<{ notes: PatientNoteRow[] }>(`patients/${patientId}/notes`).then(r => r.notes ?? []),
    enabled: !!patientId,
  });
}

function useEpisodes(patientId: string) {
  return useQuery({
    queryKey: episodesKeys.byPatient(patientId),
    queryFn: () => apiClient.get<{ data: EpisodeRow[] }>(`episodes/patient/${patientId}`).then(r => r.data ?? []),
    enabled: !!patientId,
  });
}

function usePatientDetail(patientId: string) {
  return useQuery({
    queryKey: patientsKeys.detail(patientId),
    queryFn: () => apiClient.get<PatientDetailRow>(`patients/${patientId}`),
    enabled: !!patientId,
  });
}

function usePatientContacts(patientId: string) {
  return useQuery({
    queryKey: patientsKeys.contacts(patientId),
    queryFn: () => apiClient.get<{ contacts: ContactRow[] }>(`patients/${patientId}/contacts`).then(r => r.contacts ?? []),
    enabled: !!patientId,
  });
}

interface Recipient { label: string; name: string; email: string }

interface GenerateLetterDialogProps {
  open: boolean;
  onClose: () => void;
  patientId: string;
  subTypeLabel: string;
}

function GenerateLetterDialog({ open, onClose, patientId, subTypeLabel }: GenerateLetterDialogProps) {
  const qc = useQueryClient();
  const { data: patient } = usePatientDetail(patientId);
  const { data: contacts } = usePatientContacts(patientId);

  const [selectedRecipient, setSelectedRecipient] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [snack, setSnack] = useState('');

  const isCarer = subTypeLabel.toLowerCase().includes('carer');
  const recipients = useMemo<Recipient[]>(() => {
    const list: Recipient[] = [];
    if (!isCarer && patient) {
      const pName = [patient.givenName ?? patient.firstName, patient.familyName ?? patient.lastName].filter(Boolean).join(' ');
      if (pName) list.push({ label: `Patient (self) — ${pName}`, name: pName, email: patient.emailPrimary ?? patient.email ?? '' });
      const gpN = (patient.gpName ?? patient.gp_name ?? '').trim();
      if (gpN) {
        list.push({ label: `GP — ${gpN}`, name: gpN, email: patient.gpEmail ?? patient.gp_email ?? '' });
      }
    }
    for (const c of contacts ?? []) {
      // Carer letter: show only carers. Otherwise: show all support persons
      if (isCarer ? c.isCarer : (c.isCarer || c.isEmergencyContact)) {
        const cName = [c.givenName ?? c.firstName, c.familyName ?? c.lastName].filter(Boolean).join(' ') || c.name || 'Support Person';
        const tag = c.isCarer ? 'Carer' : 'Emergency Contact';
        list.push({ label: `${tag} — ${cName}`, name: cName, email: c.email ?? '' });
      }
    }
    return list;
  }, [patient, contacts, isCarer]);

  const createLetterMut = useMutation({
    mutationFn: (data: Record<string, unknown>) => apiClient.post('correspondence/letters', data),
    onSuccess: () => {
      setSnack('Letter created successfully.');
      qc.invalidateQueries({ queryKey: correspondenceKeys.all });
      setSubject('');
      setBody('');
      setSelectedRecipient('');
      onClose();
    },
    onError: () => {
      setSnack('Failed to create letter. Please try again.');
    },
  });

  const handleSend = () => {
    const r = recipients.find(rc => rc.label === selectedRecipient);
    if (!r?.name) return;
    createLetterMut.mutate({
      patientId,
      // Tag with subtype so consumer vs carer letters are filterable on retrieval.
      letterType: isCarer ? 'lived_experience_carer' : 'lived_experience_consumer',
      subject: subject || `Lived Experience Summary — ${subTypeLabel}`,
      body,
      recipientName: r.name,
      recipientEmail: r.email || undefined,
      status: 'draft',
    });
  };

  return (
    <>
      <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>Generate Lived Experience Summary Letter</DialogTitle>
        <Divider />
        <DialogContent sx={{ pt: 2 }}>
          <FormControl fullWidth size="small" sx={{ mb: 2 }}>
            <InputLabel>Recipient</InputLabel>
            <Select
              value={selectedRecipient}
              onChange={e => setSelectedRecipient(e.target.value)}
              label="Recipient"
            >
              {recipients.map(r => (
                <MenuItem key={r.label} value={r.label}>{r.label}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <TextField
            label="Subject"
            fullWidth
            size="small"
            value={subject}
            onChange={e => setSubject(e.target.value)}
            placeholder={`Lived Experience Summary — ${subTypeLabel}`}
            sx={{ mb: 2 }}
          />
          <TextField
            label="Letter Body"
            fullWidth
            multiline
            rows={8}
            size="small"
            value={body}
            onChange={e => setBody(e.target.value)}
            placeholder="Enter the letter content..."
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="contained"
            startIcon={<SendIcon />}
            onClick={handleSend}
            disabled={createLetterMut.isPending || !selectedRecipient || !body}
            sx={{ bgcolor: '#6A1B9A', '&:hover': { bgcolor: '#4A148C' }, textTransform: 'none' }}
          >
            {createLetterMut.isPending ? 'Sending...' : 'Send'}
          </Button>
        </DialogActions>
      </Dialog>
      <Snackbar open={!!snack} autoHideDuration={4000} onClose={() => setSnack('')} message={snack} />
    </>
  );
}

interface LivedExperienceTabProps { patientId: string }
export function LivedExperienceTab({ patientId }: LivedExperienceTabProps) {
  const [subTab, setSubTab] = useState<PeerSubTab>('consumer');

  return (
    <Box>
      <Box sx={{ mb: 2 }}>
        <Typography variant="h6" fontWeight={700} fontFamily="Albert Sans, sans-serif" sx={{ color: '#3D484B' }}>
          Lived Experience
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          Consumer and carer peer support engagement — notes recorded by peer support workers with lived experience.
        </Typography>
      </Box>

      <Tabs aria-label="Navigation tabs"
        value={subTab}
        onChange={(_, v) => setSubTab(v)}
        sx={{
          mb: 3, borderBottom: '1px solid', borderColor: 'divider',
          '& .MuiTab-root': { textTransform: 'none', fontFamily: 'Albert Sans, sans-serif', fontSize: 13, fontWeight: 500 },
          '& .Mui-selected': { color: '#6A1B9A', fontWeight: 700 },
          '& .MuiTabs-indicator': { bgcolor: '#6A1B9A' },
        }}
      >
        <Tab
          label={
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
              <PeopleIcon sx={{ fontSize: 16 }} />
              Consumer Peer Support
            </Box>
          }
          value="consumer"
        />
        <Tab
          label={
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
              <FavoriteIcon sx={{ fontSize: 16 }} />
              Carer Peer Support
            </Box>
          }
          value="carer"
        />
      </Tabs>

      <PeerSupportPanel patientId={patientId} subType={subTab} />
    </Box>
  );
}

interface PeerSupportPanelProps { patientId: string; subType: PeerSubTab }
function PeerSupportPanel({ patientId, subType }: PeerSupportPanelProps) {
  const cfg = SUBTYPE_CONFIG[subType];
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [letterOpen, setLetterOpen] = useState(false);
  const [editingLetterId, setEditingLetterId] = useState<string | null>(null);
  const [editLetterBody, setEditLetterBody] = useState('');
  const editLetterMut = useMutation({
    mutationFn: ({ id, body }: { id: string; body: string }) =>
      apiClient.patch(`correspondence/letters/${id}`, { body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: correspondenceKeys.byPatientPeer(patientId, subType) });
      setEditingLetterId(null);
    },
    onError: (err: unknown) => alert(`Failed to update letter: ${getErrorMessage(err)}`),
  });
  const { data: notes, isLoading } = usePatientNotes(patientId);
  const { data: episodes } = useEpisodes(patientId);
  // Letters related to this peer support type
  const { data: peerLetters } = useQuery({
    queryKey: correspondenceKeys.byPatientPeer(patientId, subType),
    queryFn: () => apiClient.get<unknown>(`correspondence/letters/patient/${patientId}`).then((r) => {
      const raw = (typeof r === 'object' && r !== null && 'data' in r)
        ? (r as { data?: unknown }).data
        : (Array.isArray(r) ? r : []);
      const all: PeerLetterRow[] = Array.isArray(raw) ? (raw as PeerLetterRow[]) : [];
      // Strict filter: consumer tab shows ONLY consumer letters; carer tab shows ONLY carer letters.
      // letter_type is snake_case from raw DB rows, letterType is camelCase from mapped responses.
      // camelCaseResponse middleware guarantees camelCase keys
      if (subType === 'carer') {
        return all.filter((l) => l.letterType === 'lived_experience_carer');
      }
      return all.filter((l) => l.letterType === 'lived_experience_consumer' || l.letterType === 'lived_experience_summary');
    }).catch((err) => { console.warn('LivedExperienceTab: query failed', err); return []; }),
    enabled: !!patientId,
  });

  const filtered = useMemo(() =>
    (notes ?? [])
      .filter(n => n.noteType === cfg.noteType)
      .sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? '')),
    [notes, cfg.noteType]
  );

  // Group notes by episode
  const episodeMap = useMemo(() => {
    const m: Record<string, { title: string; notes: PatientNoteRow[] }> = {};
    for (const n of filtered) {
      const epId = n.episodeId ?? '__none__';
      if (!m[epId]) {
        const ep = (episodes ?? []).find((e) => e.id === epId);
        m[epId] = { title: ep?.title ?? (epId === '__none__' ? 'No Episode' : epId), notes: [] };
      }
      m[epId].notes.push(n);
    }
    return m;
  }, [filtered, episodes]);

  const episodeEntries = useMemo(() => Object.entries(episodeMap), [episodeMap]);

  return (
    <Box>
      {/* Description banner */}
      <Paper elevation={0} sx={{ p: 2, mb: 3, bgcolor: cfg.bgColor, border: `1px solid ${cfg.color}30`, borderLeft: `4px solid ${cfg.color}`, borderRadius: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
          <Box sx={{ color: cfg.color, mt: 0.25 }}>{cfg.icon}</Box>
          <Box sx={{ flex: 1 }}>
            <Typography variant="subtitle2" fontWeight={700} sx={{ color: cfg.color, mb: 0.25 }}>
              {cfg.label}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {cfg.description}
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', gap: 1, flexShrink: 0 }}>
            <Button
              startIcon={<MailOutlineIcon />}
              variant="outlined"
              size="small"
              onClick={() => setLetterOpen(true)}
              sx={{ borderColor: cfg.color, color: cfg.color, '&:hover': { borderColor: cfg.color, bgcolor: cfg.bgColor }, textTransform: 'none' }}
            >
              Generate Letter
            </Button>
            <Button
              startIcon={<AddIcon />}
              variant="contained"
              size="small"
              onClick={() => setAddOpen(true)}
              sx={{ bgcolor: cfg.color, '&:hover': { bgcolor: cfg.color + 'DD' }, textTransform: 'none' }}
            >
              Add Note
            </Button>
          </Box>
        </Box>
      </Paper>

      {isLoading && <CircularProgress role="progressbar" aria-label="Loading" size={24} />}

      {!isLoading && filtered.length === 0 && (
        <Alert severity="info" sx={{ fontFamily: 'Albert Sans, sans-serif' }}>
          No {cfg.label.toLowerCase()} notes recorded yet.
        </Alert>
      )}

      {/* Notes grouped by episode, in chronological order */}
      {episodeEntries.map(([epId, { title, notes: epNotes }]) => (
        <Box key={epId} sx={{ mb: 3 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
            <Chip
              label={title}
              size="small"
              sx={{ bgcolor: cfg.color + '18', color: cfg.color, fontWeight: 700, fontSize: 11 }}
            />
            <Typography variant="caption" color="text.secondary">
              {epNotes.length} note{epNotes.length !== 1 ? 's' : ''}
            </Typography>
          </Box>

          {/* Chronological timeline within episode */}
          <Box sx={{ position: 'relative', pl: 3 }}>
            <Box sx={{ position: 'absolute', left: 10, top: 8, bottom: 8, width: 2, bgcolor: cfg.color + '30' }} />

            {epNotes.map((n, i: number) => (
              <NoteCard key={n.id} note={n} color={cfg.color} isLast={i === epNotes.length - 1} />
            ))}
          </Box>
        </Box>
      ))}

      {/* Peer Support Letters */}
      {(peerLetters ?? []).length > 0 && (
        <Box sx={{ mt: 3 }}>
          <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1, color: cfg.color }}>
            Letters ({(peerLetters ?? []).length})
          </Typography>
          {(peerLetters ?? []).map((l, i: number) => (
            <Paper key={l.id ?? `letter-${i}`} variant="outlined" sx={{ p: 1.5, mb: 1, borderLeft: `3px solid ${cfg.color}` }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                <Typography variant="body2" fontWeight={600}>{l.subject ?? l.title ?? 'Letter'}</Typography>
                <Chip label={l.status ?? 'draft'} size="small" sx={{ fontSize: 9, height: 18 }} />
              </Box>
              <Typography variant="caption" color="text.secondary">
                To: {l.recipientName ?? '—'} — {l.createdAt ? new Date(l.createdAt).toLocaleDateString('en-AU') : '—'}
              </Typography>
              {editingLetterId === l.id ? (
                <Box sx={{ mt: 1 }}>
                  <TextField fullWidth multiline rows={6} value={editLetterBody}
                    onChange={e => setEditLetterBody(e.target.value)}
                    sx={{ '& .MuiInputBase-input': { fontFamily: 'monospace', fontSize: 12 } }} />
                  <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end', mt: 1 }}>
                    <Button size="small" onClick={() => setEditingLetterId(null)} sx={{ color: 'text.secondary' }}>Cancel</Button>
                    <Button size="small" variant="contained" disabled={editLetterMut.isPending}
                      onClick={() => l.id && editLetterMut.mutate({ id: l.id, body: editLetterBody })}
                      sx={{ bgcolor: cfg.color, textTransform: 'none' }}>
                      {editLetterMut.isPending ? 'Saving…' : 'Save Draft'}
                    </Button>
                    <Button size="small" variant="contained" disabled={editLetterMut.isPending}
                      onClick={() => {
                        if (!l.id) return;
                        apiClient.patch(`correspondence/letters/${l.id}`, { body: editLetterBody, status: 'sent' })
                          .then(() => { qc.invalidateQueries({ queryKey: correspondenceKeys.byPatientPeer(patientId, subType) }); setEditingLetterId(null); })
                          .catch((err: unknown) => alert(`Failed: ${getErrorMessage(err)}`));
                      }}
                      sx={{ bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' }, textTransform: 'none' }}>
                      Save &amp; Send
                    </Button>
                  </Box>
                </Box>
              ) : (l.status === 'draft' || !l.status) ? (
                <Box sx={{ mt: 0.5 }}>
                  <Button size="small" variant="outlined"
                    onClick={() => { setEditingLetterId(l.id ?? null); setEditLetterBody(l.body ?? l.content ?? ''); }}
                    sx={{ borderColor: cfg.color, color: cfg.color, textTransform: 'none', fontSize: 11 }}>
                    Edit Draft
                  </Button>
                </Box>
              ) : null}
            </Paper>
          ))}
        </Box>
      )}

      <AddNoteDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        patientId={patientId}
        noteType={cfg.noteType}
        onSaved={() => {
          qc.invalidateQueries({ queryKey: patientsKeys.notes(patientId) });
          setAddOpen(false);
        }}
      />

      <GenerateLetterDialog
        open={letterOpen}
        onClose={() => setLetterOpen(false)}
        patientId={patientId}
        subTypeLabel={cfg.label}
      />
    </Box>
  );
}

interface NoteCardProps { note: PatientNoteRow; color: string; isLast: boolean }

function NoteCard({ note, color }: NoteCardProps) {
  const [expanded, setExpanded] = useState(false);
  const createdAt = note.createdAt ?? '';
  const createdAtDate = createdAt ? new Date(createdAt) : null;
  const dateStr = createdAtDate ? createdAtDate.toLocaleDateString('en-AU', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  }) : 'Unknown date';
  const timeStr = createdAtDate ? createdAtDate.toLocaleTimeString('en-AU', {
    hour: '2-digit', minute: '2-digit', hour12: false,
  }) : '--:--';

  return (
    <Box sx={{ position: 'relative', mb: 1.5, zIndex: 1 }}>
      {/* Timeline dot */}
      <Box sx={{
        position: 'absolute', left: -20, top: 14,
        width: 12, height: 12, borderRadius: '50%',
        bgcolor: color, border: '2px solid #fff',
        boxShadow: `0 0 0 2px ${color}40`,
        zIndex: 2,
      }} />

      <Paper
        variant="outlined"
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        aria-label={`${note.title || 'Peer Support Note'} — ${expanded ? 'collapse' : 'expand'}`}
        onClick={() => setExpanded(e => !e)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded(prev => !prev); } }}
        sx={{
          ml: 0.5, cursor: 'pointer',
          borderColor: expanded ? color : 'divider',
          borderLeft: `3px solid ${color}`,
          '&:hover': { borderColor: color, boxShadow: '0 1px 6px rgba(0,0,0,0.07)' },
          '&:focus-visible': { outline: `2px solid ${color}`, outlineOffset: 2 },
          transition: 'border-color 0.15s',
        }}
      >
        <Box sx={{ px: 2, py: 1.25, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap', mb: 0.25 }}>
              <Typography variant="body2" fontWeight={600} sx={{ fontSize: 13 }}>
                {note.title || 'Peer Support Note'}
              </Typography>
              {note.status === 'signed' && (
                <Chip label="Signed" size="small" color="success" sx={{ fontSize: 9, height: 16 }} />
              )}
              {note.status === 'draft' && (
                <Chip label="Draft" size="small" sx={{ fontSize: 9, height: 16, bgcolor: '#FFF8E1', color: '#F57F17' }} />
              )}
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ fontSize: 11 }}>
              {dateStr} · {timeStr}
              {note.authorName && ` · ${note.authorName}`}
            </Typography>
          </Box>
          <Typography variant="caption" color="text.secondary" sx={{ fontSize: 16, lineHeight: 1, flexShrink: 0, userSelect: 'none' }}>
            {expanded ? '▲' : '▼'}
          </Typography>
        </Box>

        {expanded && (
          <>
            <Divider />
            <Box sx={{ px: 2, py: 1.5 }}>
              {note.content ? (
                <Box sx={{
                  whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: 11,
                  color: '#3D484B', maxHeight: 300, overflowY: 'auto',
                  bgcolor: '#FAFAFA', p: 1.5, borderRadius: 1, border: '1px solid #EBEBEB',
                }}>
                  {note.content}
                </Box>
              ) : (
                <Typography variant="caption" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                  No content recorded.
                </Typography>
              )}
            </Box>
          </>
        )}
      </Paper>
    </Box>
  );
}
