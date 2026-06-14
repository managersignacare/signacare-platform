import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import AssessmentIcon from '@mui/icons-material/Assessment';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import ChatIcon from '@mui/icons-material/Chat';
// ContactPhoneIcon removed — contact records moved to Appointments > Contacts subtab
import DescriptionIcon from '@mui/icons-material/Description';
import EditIcon from '@mui/icons-material/Edit';
import GroupsIcon from '@mui/icons-material/Groups';
import MailOutlineIcon from '@mui/icons-material/MailOutline';
import NoteAddIcon from '@mui/icons-material/NoteAdd';
import TimelineIcon from '@mui/icons-material/Timeline';
import {
    Alert, Box, Button, Card, CardContent, Chip, CircularProgress, FormControl, Grid, IconButton,
    InputLabel, MenuItem, Paper, Select, Snackbar, TextField, Tooltip, Typography
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import React, { useState } from 'react';
import { apiClient } from '../../../../../shared/services/apiClient';
import { unstyledButtonSx } from '../../../../../shared/styles/unstyledButton';
import { AddNoteDialog } from '../../notes/AddNoteDialog';
import {
  patientsKeys,
  episodesKeys,
  outcomeMeasuresKeys,
  patientReferralsKeys,
} from '../../../queryKeys';
import { printContent } from '../../../../../shared/utils/printContent';
import { openInNewWindow } from '../../../../../shared/utils/openInNewWindow';
import { ListExportBar } from '../../../../../shared/components/ui/ListExportBar';
import { NotesList } from '../../notes/NotesList';
import { SendMessageDialog } from '../../notes/SendMessageDialog';
import {
  CloseEpisodeDialog,
  DischargeSummaryDialog,
  HotSpotButton,
  IntakeTaskList,
} from './EpisodesAuxPanels';

interface Episode {
  id: string; episodeNumber?: string; title: string; episodeType?: string; status: string;
  startDate: string; endDate?: string; team?: string;
}

type ApiListEnvelope<T> = T[] | { data?: T[] };

interface StaffLookupItem {
  id: string;
  givenName: string;
  familyName: string;
  discipline?: string;
}

interface EpisodeNote {
  id?: string;
  noteType?: string;
  note_type?: string;
  createdAt?: string;
  created_at?: string;
  noteDate?: string;
  note_date?: string;
  title?: string;
  content?: string;
  authorName?: string;
  author_name?: string;
  status?: string;
}

interface EpisodeLetter {
  id?: string;
  episode_id?: string;
  episodeId?: string;
  createdAt?: string;
  created_at?: string;
  letterDate?: string;
  letter_date?: string;
  subject?: string;
  title?: string;
  body?: string;
  content?: string;
  authorName?: string;
  author_name?: string;
  status?: string;
}

interface EpisodeContactRecord {
  id?: string;
}

interface EpisodeAssessment {
  id?: string;
  assessmentType?: string;
  assessment_type?: string;
  assessmentDatetime?: string;
  assessment_datetime?: string;
  createdAt?: string;
  created_at?: string;
  totalScore?: number;
  riskLevel?: string;
  risk_level?: string;
  staffName?: string;
  staff_name?: string;
}

interface EpisodeOutcomeMeasure {
  id: string;
  measureType?: string;
  measure_type?: string;
  collectionOccasion?: string;
  collection_occasion?: string;
  measureDate?: string;
  measure_date?: string;
  createdAt?: string;
  created_at?: string;
  totalScore?: number;
  total_score?: number;
}

interface MessageThreadItem {
  id?: string;
  lastMessageAt?: string;
  last_message_at?: string;
  createdAt?: string;
  created_at?: string;
  subject?: string;
  lastMessagePreview?: string;
  last_message_preview?: string;
  createdByName?: string;
}

interface MessageThreadMessage {
  id?: string;
  senderName?: string | null;
  sender_name?: string | null;
  createdAt?: string | null;
  created_at?: string | null;
  body?: string | null;
  content?: string | null;
}

interface MessageThreadDetail {
  messages?: MessageThreadMessage[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readList<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) {
    return payload as T[];
  }
  if (isRecord(payload) && Array.isArray(payload.data)) {
    return payload.data as T[];
  }
  return [];
}

function extractErrorMessage(error: unknown, fallback = 'Unknown'): string {
  if (!isRecord(error)) {
    return fallback;
  }
  const response = isRecord(error.response) ? error.response : undefined;
  const data = response && isRecord(response.data) ? response.data : undefined;
  const apiError = data && typeof data.error === 'string' ? data.error : undefined;
  const message = typeof error.message === 'string' ? error.message : undefined;
  return apiError ?? message ?? fallback;
}

function formatMessageThreadContent(messages: MessageThreadMessage[] | undefined): string {
  if (!Array.isArray(messages) || messages.length === 0) return '';
  return messages
    .map((msg) => {
      const sender = msg.senderName ?? msg.sender_name ?? 'Staff';
      const at = msg.createdAt ?? msg.created_at;
      const when = at ? new Date(at).toLocaleString('en-AU', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Unknown time';
      const body = (msg.body ?? msg.content ?? '').trim();
      return `[${when}] ${sender}\n${body}`;
    })
    .join('\n\n');
}

function useStaffLookup() {
  return useQuery({
    queryKey: patientsKeys.staffLookup(),
    queryFn: () => apiClient.get<StaffLookupItem[]>('staff/lookup'),
    staleTime: 5 * 60 * 1000,
  });
}

interface EpisodeCardProps { ep: Episode; unitNameMap: Map<string, string>; onClick: () => void; onEdit: () => void; onAllocate: () => void; }
export function EpisodeCard({ ep, unitNameMap, onClick, onEdit, onAllocate, tone = 'default' }: EpisodeCardProps & { tone?: 'default' | 'inactive' }) {
  const isInactiveTone = tone === 'inactive';
  return (
    <Card
      variant="outlined"
      sx={{
        borderColor: isInactiveTone ? '#e4c7aa' : undefined,
        bgcolor: isInactiveTone ? '#fffdf9' : undefined,
        '&:hover': { borderColor: '#b8621a' },
      }}
    >
      <CardContent sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', py: 1.5, '&:last-child': { pb: 1.5 } }}>
        {/* Shape B′ sub-region trigger — left summary is the canonical
            click/keyboard target; right-side IconButtons are siblings
            (NOT children of the trigger), so the previous defensive
            `e.stopPropagation()` on Allocate + Edit IconButtons was
            structurally unnecessary and has been REMOVED. */}
        <Box
          component="button"
          type="button"
          onClick={onClick}
          aria-label={`Open episode ${ep.title || ep.episodeNumber || ''}`.trim()}
          sx={{ flex: 1, ...unstyledButtonSx, borderRadius: 1, '&:focus-visible': { outline: '2px solid #b8621a', outlineOffset: 2 } }}
        >
          <Typography variant="body1" fontWeight={600} fontFamily="Albert Sans, sans-serif" sx={{ color: '#b8621a', '&:hover': { textDecoration: 'underline' } }}>
            {ep.title || ep.episodeNumber || 'Episode'}
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5, flexWrap: 'wrap' }}>
            {ep.episodeType && <Chip label={ep.episodeType} size="small" sx={{ fontSize: 10, height: 18, textTransform: 'capitalize', bgcolor: isInactiveTone ? '#f4e5d6' : undefined }} />}
            {ep.team && unitNameMap.get(ep.team) && <Chip label={unitNameMap.get(ep.team)} size="small" variant="outlined" sx={{ fontSize: 10, height: 18 }} />}
            <Typography variant="caption" color="text.secondary">
              {new Date(ep.startDate).toLocaleDateString('en-AU')}{ep.endDate ? ` — ${new Date(ep.endDate).toLocaleDateString('en-AU')}` : ' — ongoing'}
            </Typography>
          </Box>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Chip
            label={ep.status}
            size="small"
            color={ep.status === 'open' ? 'success' : ep.status === 'closed' ? 'default' : 'warning'}
            sx={{ textTransform: 'capitalize', fontSize: 11, bgcolor: isInactiveTone ? '#efe1d2' : undefined }}
          />
          <Tooltip title="Allocate team & MDT"><IconButton size="small" aria-label="Allocate team and MDT" color="primary" onClick={onAllocate}><GroupsIcon fontSize="small" /></IconButton></Tooltip>
          <Tooltip title="Edit episode"><IconButton size="small" aria-label="Edit episode" onClick={onEdit}><EditIcon fontSize="small" /></IconButton></Tooltip>
        </Box>
      </CardContent>
    </Card>
  );
}

// ============ Episode Detail View ============

interface EpisodeDetailViewProps { episode: Episode; patientId: string; unitNameMap: Map<string, string>;
  onBack: () => void; onEdit: () => void; onAllocate: () => void; }
export function EpisodeDetailView({ episode, patientId, unitNameMap, onBack, onEdit, onAllocate }: EpisodeDetailViewProps) {
  const qc = useQueryClient();
  const [noteDialogOpen, setNoteDialogOpen] = useState(false);
  const [messageDialogOpen, setMessageDialogOpen] = useState(false);
  const [reportDialogOpen, setReportDialogOpen] = useState(false);
  const [dischargeOpen, setDischargeOpen] = useState(false);
  const [closeVetOpen, setCloseVetOpen] = useState(false);
  const { data: alloc } = useQuery({
    queryKey: episodesKeys.allocation(episode.id),
    queryFn: () => apiClient.get<{ orgUnitId: string | null; primaryClinicianId: string | null; keyWorkerId: string | null; mdt: { staffId: string; roleName: string; staffName: string }[] }>(`episodes/${episode.id}/allocation`),
    enabled: !!episode.id,
  });
  const { data: staffList } = useStaffLookup();
  const staffNameMap = React.useMemo(() => { const m = new Map<string, string>(); for (const s of (staffList ?? [])) m.set(s.id, `${s.givenName} ${s.familyName}`); return m; }, [staffList]);
  const dedupedMdt = React.useMemo(() => {
    const rows = alloc?.mdt ?? [];
    const seen = new Set<string>();
    const unique: typeof rows = [];
    for (const row of rows) {
      const key = `${row.staffId}:${(row.roleName ?? '').trim().toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(row);
    }
    return unique;
  }, [alloc?.mdt]);
  const mdtDisplayRows = React.useMemo(() => {
    const keyClinicianId = alloc?.primaryClinicianId ?? null
    if (!keyClinicianId) return dedupedMdt
    return dedupedMdt.filter((row) => {
      const normalizedRole = (row.roleName ?? '').trim().toLowerCase()
      const isKeyClinicianRole =
        normalizedRole === 'key clinician'
        || normalizedRole === 'key worker'
        || normalizedRole === 'primary clinician'
      if (!isKeyClinicianRole) return true
      return row.staffId !== keyClinicianId
    })
  }, [alloc?.primaryClinicianId, dedupedMdt])

  const MEASURE_LABEL: Record<string, string> = {
    honos: 'HoNOS', honos65: 'HoNOS 65+', honosca: 'HoNOSCA',
    k10: 'K10', k10plus: 'K10+', lsp16: 'LSP-16',
  };

  const isIntake = episode.episodeType === 'intake';
  const isReferralEpisode = episode.episodeType === 'referral' || (episode.title ?? '').startsWith('referral-');
  const isIntakeOrReferral = isIntake || isReferralEpisode;
  const [intakeStatus, setIntakeStatus] = useState('received');
  const [_showAllocOnAccept, _setShowAllocOnAccept] = useState(false);

  // For intake/referral: accept → close referral episode + open create episode dialog
  const [showNewEpisodeDialog, setShowNewEpisodeDialog] = useState(false);
  const acceptMut = useMutation({
    mutationFn: async () => {
      await apiClient.post(`referrals/by-episode/${episode.id}/decision`, {
        decision: 'accepted',
        confirmDecision: true,
        createEpisode: true,
        episodeType: 'community',
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: episodesKeys.byPatient(patientId) });
      qc.invalidateQueries({ queryKey: patientReferralsKeys.referrals(patientId) });
      setShowNewEpisodeDialog(true);
    },
    onError: (err: unknown) => {
      alert(`Could not accept referral: ${extractErrorMessage(err)}`);
    },
  });
  const rejectMut = useMutation({
    mutationFn: async (declineReason: string) => apiClient.post(`referrals/by-episode/${episode.id}/decision`, {
      decision: 'declined',
      confirmDecision: true,
      declineReason,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: episodesKeys.byPatient(patientId) });
      qc.invalidateQueries({ queryKey: patientReferralsKeys.referrals(patientId) });
    },
    onError: (err: unknown) => {
      alert(`Could not reject referral: ${extractErrorMessage(err)}`);
    },
  });

  // ── Timeline filter state ──
  type TimelineFilterType = 'all' | 'note' | 'message' | 'letter' | 'report' | 'assessment';
  const [timelineFilter, setTimelineFilter] = useState<TimelineFilterType>('all');
  const [expandedTimelineId, setExpandedTimelineId] = useState<string | null>(null);
  const [editingTimelineId, setEditingTimelineId] = useState<string | null>(null);
  const [editTimelineContent, setEditTimelineContent] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);
  const editTimelineNoteMut = useMutation({
    mutationFn: ({ id, content }: { id: string; content: string }) =>
      apiClient.patch(`patients/${patientId}/notes/${id}`, { content }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: episodesKeys.notes(patientId, episode.id) });
      qc.invalidateQueries({ queryKey: patientsKeys.notes(patientId) });
      setEditingTimelineId(null);
    },
    onError: (err: unknown) => alert(`Failed to save note: ${extractErrorMessage(err)}`),
  });
  const editTimelineLetterMut = useMutation({
    mutationFn: ({ id, body }: { id: string; body: string }) =>
      apiClient.patch(`correspondence/letters/${id}`, { body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: episodesKeys.letters(patientId, episode.id) });
      setEditingTimelineId(null);
    },
    onError: (err: unknown) => alert(`Failed to save letter: ${extractErrorMessage(err)}`),
  });

  // ── Unified timeline: fetch all clinical items for this episode ──
  const { data: episodeNotes } = useQuery({
    queryKey: episodesKeys.notes(patientId, episode.id),
    queryFn: () =>
      apiClient
        .get<ApiListEnvelope<EpisodeNote> | { notes?: EpisodeNote[] }>(
          `patients/${patientId}/notes`,
          { episodeId: episode.id, limit: 50 },
        )
        .catch(() => ({ notes: [] })),
    enabled: !!episode.id,
  });
  const { data: episodeLetters } = useQuery({
    queryKey: episodesKeys.letters(patientId, episode.id),
    queryFn: async () => {
      const resp = await apiClient
        .get<ApiListEnvelope<EpisodeLetter>>(`correspondence/letters/patient/${patientId}`)
        .catch(() => ({ data: [] }));
      const all = readList<EpisodeLetter>(resp);
      return all.filter((l) => (l.episode_id ?? l.episodeId) === episode.id);
    },
    enabled: !!episode.id && !!patientId,
  });
  const { data: episodeContacts } = useQuery({
    queryKey: episodesKeys.contacts(patientId, episode.id),
    queryFn: () =>
      apiClient
        .get<ApiListEnvelope<EpisodeContactRecord>>(
          `contact-records/patient/${patientId}`,
          { episodeId: episode.id, limit: 50 },
        )
        .catch(() => ({ data: [] })),
    enabled: !!episode.id,
  });
  const { data: episodeAssessments } = useQuery({
    queryKey: episodesKeys.assessments(episode.id),
    queryFn: () =>
      apiClient
        .get<ApiListEnvelope<EpisodeAssessment>>(
          'nursing-assessments',
          { episodeId: episode.id, limit: 50 },
        )
        .catch(() => ({ data: [] })),
    enabled: !!episode.id,
  });
  const { data: episodeOutcomeMeasures } = useQuery({
    queryKey: outcomeMeasuresKeys.byPatientEpisode(patientId, episode.id),
    queryFn: () =>
      apiClient
        .get<EpisodeOutcomeMeasure[]>(`outcomes/patient/${patientId}`, { episodeId: episode.id }),
    enabled: !!episode.id,
  });
  // Messages linked to episode (internal message threads only — SMS/message notes already come from episodeNotes and are classified by note_type)
  const { data: episodeMessages } = useQuery({
    queryKey: episodesKeys.messages(patientId, episode.id),
    queryFn: async () => {
      const threads = await apiClient
        .get<ApiListEnvelope<MessageThreadItem>>(
          'messages/threads',
          { patientId, episodeId: episode.id },
        )
        .catch(() => ({ data: [] }));
      return { threads: readList<MessageThreadItem>(threads) };
    },
    enabled: !!episode.id,
  });

  // Normalise all clinical items into a unified timeline
  const unifiedTimeline = React.useMemo(() => {
    const items: { id: string; date: string; type: 'note' | 'message' | 'letter' | 'report' | 'contact' | 'assessment'; title: string; summary: string; author: string; status?: string; fullContent?: string; threadId?: string }[] = [];

    // Notes — classify by note_type to avoid duplication
    const episodeNotesRecord: Record<string, unknown> = isRecord(episodeNotes) ? episodeNotes : {};
    const notesByKey = episodeNotesRecord.notes;
    const notesList = Array.isArray(episodeNotes)
      ? episodeNotes
      : Array.isArray(notesByKey)
        ? (notesByKey as EpisodeNote[])
        : readList<EpisodeNote>(episodeNotes);
    const seenIds = new Set<string>();
    for (const n of notesList) {
      const nId = n.id ?? `note-${items.length}`;
      if (seenIds.has(nId)) continue;
      seenIds.add(nId);
      const nt = (n.noteType ?? n.note_type ?? '').toLowerCase();
      const itemType: 'note' | 'message' | 'letter' | 'report' | 'assessment' = nt === 'message' ? 'message' : nt === 'letter' ? 'letter' : nt === 'report' ? 'report' : (nt === 'assessment' || nt === 'intake') ? 'assessment' : 'note';
      items.push({
        id: nId,
        date: n.createdAt ?? n.created_at ?? n.noteDate ?? n.note_date ?? '',
        type: itemType,
        title: n.title ?? n.noteType ?? n.note_type ?? 'Clinical Note',
        summary: (n.content ?? '').substring(0, 200),
        author: n.authorName ?? n.author_name ?? '',
        status: n.status,
        fullContent: n.content ?? '',
      });
    }

    // Messages (internal threads) — skip if already added from notes
    for (const t of (episodeMessages?.threads ?? [])) {
      const tId = t.id ?? `msg-thread-${items.length}`;
      if (seenIds.has(tId)) continue;
      seenIds.add(tId);
      items.push({
        id: tId,
        date: t.lastMessageAt ?? t.last_message_at ?? t.createdAt ?? t.created_at ?? '',
        type: 'message',
        title: t.subject ?? 'Message Thread',
        summary: t.lastMessagePreview ?? t.last_message_preview ?? '',
        author: t.createdByName ?? '',
        threadId: t.id,
      });
    }

    // Note: SMS/message notes are already classified from episodeNotes above (note_type → 'message')

    // Letters — skip if already added from notes
    const lettersList = readList<EpisodeLetter>(episodeLetters);
    for (const l of lettersList) {
      const lId = l.id ?? `letter-${items.length}`;
      if (seenIds.has(lId)) continue;
      seenIds.add(lId);
      items.push({
        id: lId,
        date: l.createdAt ?? l.created_at ?? l.letterDate ?? l.letter_date ?? '',
        type: 'letter',
        title: l.subject ?? l.title ?? 'Correspondence',
        summary: (l.body ?? l.content ?? '').substring(0, 200),
        author: l.authorName ?? l.author_name ?? '',
        status: l.status,
        fullContent: l.body ?? l.content ?? '',
      });
    }

    // Contact records — excluded from episode timeline (shown in Appointments > Contacts subtab)

    // Nursing assessments
    const assessmentsList = readList<EpisodeAssessment>(episodeAssessments);
    for (const a of assessmentsList) {
      const aType = a.assessmentType ?? a.assessment_type ?? '';
      items.push({
        id: a.id ?? `assessment-${items.length}`,
        date: a.assessmentDatetime ?? a.assessment_datetime ?? a.createdAt ?? a.created_at ?? '',
        type: 'assessment',
        title: `${aType.replace(/_/g, ' ').replace(/\b\w/g, (ch: string) => ch.toUpperCase())} Assessment`,
        summary: a.totalScore != null ? `Score: ${a.totalScore}${(a.riskLevel ?? a.risk_level) ? ` (${a.riskLevel ?? a.risk_level})` : ''}` : '',
        author: a.staffName ?? a.staff_name ?? '',
      });
    }

    // Outcome measures (saved in Assessments tab)
    for (const outcome of (episodeOutcomeMeasures ?? [])) {
      const measureType = outcome.measureType ?? outcome.measure_type ?? 'outcome_measure';
      const totalScore = outcome.totalScore ?? outcome.total_score;
      const label = MEASURE_LABEL[measureType] ?? measureType;
      items.push({
        id: `outcome-${outcome.id}`,
        date: outcome.measureDate ?? outcome.measure_date ?? outcome.createdAt ?? outcome.created_at ?? '',
        type: 'assessment',
        title: `${label} Outcome Measure`,
        summary: totalScore != null
          ? `Score: ${totalScore}${(outcome.collectionOccasion ?? outcome.collection_occasion) ? ` · ${outcome.collectionOccasion ?? outcome.collection_occasion}` : ''}`
          : (outcome.collectionOccasion ?? outcome.collection_occasion ?? ''),
        author: '',
      });
    }

    // Sort by date descending
    items.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    return items;
  }, [episodeNotes, episodeMessages, episodeLetters, episodeContacts, episodeAssessments, episodeOutcomeMeasures]);

  // Apply timeline filter
  const filteredTimeline = React.useMemo(() => {
    if (timelineFilter === 'all') return unifiedTimeline;
    return unifiedTimeline.filter(item => item.type === timelineFilter);
  }, [unifiedTimeline, timelineFilter]);

  const expandedTimelineItem = React.useMemo(
    () => unifiedTimeline.find((item) => item.id === expandedTimelineId) ?? null,
    [unifiedTimeline, expandedTimelineId],
  );
  const expandedTimelineThreadId = expandedTimelineItem?.threadId ?? null;
  const { data: expandedThreadDetail } = useQuery({
    queryKey: episodesKeys.timelineThreadDetail(expandedTimelineThreadId),
    queryFn: () => apiClient.get<MessageThreadDetail>(`messages/threads/${expandedTimelineThreadId}`).catch(() => ({ messages: [] })),
    enabled: !!expandedTimelineThreadId,
  });
  const expandedTimelineThreadContent = React.useMemo(
    () => formatMessageThreadContent(expandedThreadDetail?.messages),
    [expandedThreadDetail],
  );

  // Filter chip configuration
  const TIMELINE_FILTERS: { value: TimelineFilterType; label: string; count: number }[] = [
    { value: 'all', label: 'All', count: unifiedTimeline.length },
    { value: 'note', label: 'Notes', count: unifiedTimeline.filter(i => i.type === 'note').length },
    { value: 'message', label: 'Messages', count: unifiedTimeline.filter(i => i.type === 'message').length },
    { value: 'letter', label: 'Letters', count: unifiedTimeline.filter(i => i.type === 'letter').length },
    { value: 'report', label: 'Reports', count: unifiedTimeline.filter(i => i.type === 'report').length },
    { value: 'assessment', label: 'Assessments', count: unifiedTimeline.filter(i => i.type === 'assessment').length },
  ];

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <IconButton onClick={onBack} size="small" aria-label="Go back"><ArrowBackIcon /></IconButton>
        <Typography variant="h6" fontWeight={600} fontFamily="Albert Sans, sans-serif" sx={{ flex: 1 }}>{episode.title}</Typography>
        <Chip label={episode.status} size="small" color={episode.status === 'open' ? 'success' : 'default'} sx={{ textTransform: 'capitalize' }} />
        <Button size="small" variant="outlined" startIcon={<EditIcon />} onClick={onEdit}>Edit Episode</Button>
        {episode.status === 'open' && (
          <>
            <Button size="small" variant="outlined" onClick={() => setDischargeOpen(true)}
              sx={{ borderColor: '#327C8D', color: '#327C8D', textTransform: 'none', fontSize: 11 }}>Discharge Summary</Button>
            <Button size="small" variant="outlined" color="error" onClick={() => setCloseVetOpen(true)}
              sx={{ textTransform: 'none', fontSize: 11 }}>Close Episode</Button>
          </>
        )}
        <HotSpotButton patientId={patientId} />
      </Box>

      <Box sx={{ display: 'flex', gap: 2, mb: 3, flexWrap: 'wrap' }}>
        {episode.episodeType && <Chip label={episode.episodeType} size="small" sx={{ textTransform: 'capitalize' }} />}
        {episode.team && unitNameMap.get(episode.team) && <Chip label={unitNameMap.get(episode.team)} size="small" variant="outlined" />}
        <Typography variant="body2" color="text.secondary">
          {new Date(episode.startDate).toLocaleDateString('en-AU')}{episode.endDate ? ` — ${new Date(episode.endDate).toLocaleDateString('en-AU')}` : ' — ongoing'}
        </Typography>
      </Box>

      {/* Referral / Intake Status Controls */}
      {(isIntake || isReferralEpisode) && episode.status === 'open' && (
        <Paper variant="outlined" sx={{ p: 2, mb: 3, borderLeft: `4px solid ${isReferralEpisode ? '#2563EB' : '#b8621a'}` }}>
          <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>{isReferralEpisode ? 'Referral Decision' : 'Intake Status'}</Typography>
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
            <FormControl size="small" sx={{ minWidth: 160 }}>
              <InputLabel>Status</InputLabel>
              <Select value={intakeStatus} onChange={e => setIntakeStatus(e.target.value)} label="Status">
                <MenuItem value="received">Received</MenuItem>
                <MenuItem value="review">Under Review</MenuItem>
              </Select>
            </FormControl>
            <Button variant="contained" color="success" size="small" onClick={() => {
              const confirmed = window.confirm('Accept this referral?');
              if (!confirmed) return;
              acceptMut.mutate();
            }} disabled={acceptMut.isPending}
              sx={{ textTransform: 'none' }}>
              {acceptMut.isPending ? <CircularProgress role="progressbar" aria-label="Loading" size={16} sx={{ color: '#fff' }} /> : 'Accept Referral'}
            </Button>
            <Button variant="outlined" color="error" size="small" onClick={() => {
              const declineReason = window.prompt('Decline referral reason (required):');
              if (!declineReason || !declineReason.trim()) return;
              const confirmed = window.confirm('Decline this referral?');
              if (!confirmed) return;
              rejectMut.mutate(declineReason.trim());
            }} disabled={rejectMut.isPending}
              sx={{ textTransform: 'none' }}>
              {rejectMut.isPending ? <CircularProgress role="progressbar" aria-label="Loading" size={16} /> : 'Reject Referral'}
            </Button>
          </Box>
          {showNewEpisodeDialog && (
            <Alert severity="success" sx={{ mt: 1 }} action={
              <Button size="small" variant="contained" color="success" onClick={() => { setShowNewEpisodeDialog(false); onBack(); /* trigger create episode from episode list */ }}>
                Create New Episode
              </Button>
            }>
              Referral accepted. Click to create a new episode for ongoing care and MDT allocation.
            </Alert>
          )}
        </Paper>
      )}

      {/* MDT Panel */}
      <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
          <Typography variant="subtitle2" fontWeight={600}>Multidisciplinary Team (MDT)</Typography>
          <Button size="small" onClick={onAllocate} sx={{ color: '#b8621a', fontSize: 12 }}>Edit MDT</Button>
        </Box>
        {alloc ? (
          <Grid container spacing={1}>
            {alloc.primaryClinicianId && (
              <Grid size={{ xs: 12, sm: 6, md: 4 }}><Typography variant="caption" color="text.secondary">Key Clinician</Typography><Typography variant="body2" fontWeight={500}>{staffNameMap.get(alloc.primaryClinicianId) || '—'}</Typography></Grid>
            )}
            {mdtDisplayRows.map((m, i) => (
              <Grid key={i} size={{ xs: 12, sm: 6, md: 4 }}><Typography variant="caption" color="text.secondary">{m.roleName}</Typography><Typography variant="body2" fontWeight={500}>{m.staffName}</Typography></Grid>
            ))}
            {!alloc.primaryClinicianId && mdtDisplayRows.length === 0 && (
              <Grid size={{ xs: 12 }}><Typography variant="body2" color="text.secondary">No MDT allocated yet. Click &quot;Edit MDT&quot; to assign clinicians.</Typography></Grid>
            )}
          </Grid>
        ) : <Typography variant="body2" color="text.secondary">Loading...</Typography>}
      </Paper>

      {/* All episodes: two-section layout — Timeline + Notes/Messages */}
      <Grid container spacing={2}>
        {/* Left: Timeline view */}
        <Grid size={{ xs: 12, md: isIntakeOrReferral ? 6 : 12 }}>
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <TimelineIcon sx={{ color: '#b8621a', fontSize: 20 }} />
                <Typography variant="subtitle2" fontWeight={600}>Timeline</Typography>
              </Box>
              <Box sx={{ display: 'flex', gap: 0.5 }}>
                <Button size="small" variant="contained" startIcon={<NoteAddIcon />} onClick={() => setNoteDialogOpen(true)} sx={{ bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' }, fontSize: 11, textTransform: 'none', py: 0.3 }}>Note</Button>
                <Button size="small" variant="outlined" startIcon={<MailOutlineIcon />} onClick={() => setMessageDialogOpen(true)} sx={{ fontSize: 11, textTransform: 'none', py: 0.3, borderColor: '#327C8D', color: '#327C8D' }}>Message</Button>
                <Button size="small" variant="outlined" startIcon={<DescriptionIcon />} onClick={() => setReportDialogOpen(true)} sx={{ fontSize: 11, textTransform: 'none', py: 0.3, borderColor: '#3D484B', color: '#3D484B' }}>Report</Button>
              </Box>
            </Box>

            {/* Timeline filter chips */}
            <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', mb: 2 }}>
              {TIMELINE_FILTERS.map((f) => (
                <Chip
                  key={f.value}
                  label={`${f.label}${f.count > 0 ? ` (${f.count})` : ''}`}
                  size="small"
                  variant={timelineFilter === f.value ? 'filled' : 'outlined'}
                  onClick={() => setTimelineFilter(f.value)}
                  sx={{
                    fontSize: 11,
                    fontWeight: timelineFilter === f.value ? 600 : 400,
                    fontFamily: 'Albert Sans, sans-serif',
                    cursor: 'pointer',
                    ...(timelineFilter === f.value
                      ? { bgcolor: '#b8621a', color: '#fff', '&:hover': { bgcolor: '#d6741f' } }
                      : { borderColor: '#ccc', color: '#3D484B', '&:hover': { borderColor: '#b8621a', color: '#b8621a' } }),
                  }}
                />
              ))}
              <ListExportBar compact title={`Episode Timeline — ${episode.title ?? episode.episodeType}`}
                subtitle={`${filteredTimeline.length} items`}
                columns={['Date', 'Type', 'Title', 'Author', 'Status', 'Content']}
                rows={filteredTimeline.map(item => [
                  item.date ? new Date(item.date).toLocaleDateString('en-AU') : '',
                  item.type, item.title, item.author, item.status ?? '',
                  (item.fullContent ?? item.summary ?? '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(),
                ])} />
            </Box>

            {/* Unified episode timeline — headings only, click to expand */}
            {filteredTimeline.length > 0 ? (
              <Box sx={{ position: 'relative', pl: 2.5, borderLeft: '2px solid #E0E0E0', ml: 1 }}>
                {filteredTimeline.map((item) => {
                  const typeConfig: Record<string, { icon: React.ReactNode; color: string; label: string }> = {
                    note: { icon: <NoteAddIcon sx={{ fontSize: 16 }} />, color: '#b8621a', label: 'Note' },
                    message: { icon: <ChatIcon sx={{ fontSize: 16 }} />, color: '#1976D2', label: 'Message' },
                    letter: { icon: <MailOutlineIcon sx={{ fontSize: 16 }} />, color: '#327C8D', label: 'Letter' },
                    assessment: { icon: <AssessmentIcon sx={{ fontSize: 16 }} />, color: '#7B1FA2', label: 'Assessment' },
                  };
                  const cfg = typeConfig[item.type] ?? typeConfig.note;
                  const isExpanded = expandedTimelineId === item.id;
                  const resolvedItemContent = item.threadId && isExpanded
                    ? (expandedTimelineThreadId === item.threadId ? (expandedTimelineThreadContent || item.summary) : item.summary)
                    : (item.fullContent || item.summary);
                  return (
                    <Box key={item.id} sx={{ position: 'relative', mb: 0.5 }}>
                      {/* Timeline dot */}
                      <Box sx={{ position: 'absolute', left: -22, top: 6, width: 18, height: 18, borderRadius: '50%',
                        bgcolor: cfg.color, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
                        {cfg.icon}
                      </Box>
                      {/* Heading row — always visible, clickable. Shape B trio (no nested keyboard primitives — Chip + Typography only). */}
                      <Box
                        role="button"
                        tabIndex={0}
                        aria-expanded={isExpanded}
                        aria-label={`${cfg.label}: ${item.title}${item.author ? ` by ${item.author}` : ''} — ${isExpanded ? 'collapse' : 'expand'}`}
                        onClick={() => setExpandedTimelineId(isExpanded ? null : item.id)}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpandedTimelineId(isExpanded ? null : item.id); } }}
                        sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', py: 0.5, px: 0.5,
                          borderRadius: 1, '&:hover': { bgcolor: '#FAFAFA' }, '&:focus-visible': { outline: '2px solid #b8621a', outlineOffset: -2 }, transition: 'background 0.15s' }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flex: 1, minWidth: 0 }}>
                          <Chip label={cfg.label} size="small" sx={{ fontSize: 8, height: 16, bgcolor: cfg.color, color: '#fff', fontWeight: 600, flexShrink: 0 }} />
                          <Typography variant="body2" fontWeight={600} noWrap sx={{ fontSize: 12, color: '#3D484B' }}>{item.title}</Typography>
                          {item.author && <Typography variant="caption" color="text.disabled" noWrap sx={{ fontSize: 9 }}>— {item.author}</Typography>}
                        </Box>
                        <Typography variant="caption" color="text.secondary" sx={{ fontSize: 9, whiteSpace: 'nowrap', ml: 1, flexShrink: 0 }}>
                          {item.date ? new Date(item.date).toLocaleString('en-AU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}
                        </Typography>
                      </Box>
                      {/* Detail panel — shown on click */}
                      {isExpanded && (
                        <Box sx={{ ml: 0.5, mt: 0.5, mb: 1.5, p: 1.5, bgcolor: '#FAFAFA', borderRadius: 1, borderLeft: `3px solid ${cfg.color}` }}>
                          {/* Inline editor for draft notes and letters */}
                          {editingTimelineId === item.id ? (
                            <Box>
                              <TextField fullWidth multiline rows={8} value={editTimelineContent}
                                onChange={e => setEditTimelineContent(e.target.value)}
                                sx={{ mb: 1, '& .MuiInputBase-input': { fontFamily: 'monospace', fontSize: 12 } }} />
                              <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
                                <Button size="small" onClick={() => setEditingTimelineId(null)} sx={{ color: 'text.secondary' }}>Cancel</Button>
                                <Button size="small" variant="contained"
                                  disabled={editTimelineNoteMut.isPending || editTimelineLetterMut.isPending}
                                  onClick={() => {
                                    if (item.type === 'letter') {
                                      editTimelineLetterMut.mutate({ id: item.id, body: editTimelineContent });
                                    } else {
                                      editTimelineNoteMut.mutate({ id: item.id, content: editTimelineContent });
                                    }
                                  }}
                                  sx={{ bgcolor: '#327C8D', '&:hover': { bgcolor: '#265f6d' }, textTransform: 'none' }}>
                                  {(editTimelineNoteMut.isPending || editTimelineLetterMut.isPending) ? 'Saving…' : 'Save Draft'}
                                </Button>
                                <Button size="small" variant="contained"
                                  disabled={editTimelineNoteMut.isPending || editTimelineLetterMut.isPending}
                                  onClick={() => {
                                    if (item.type === 'letter') {
                                      apiClient.patch(`correspondence/letters/${item.id}`, { body: editTimelineContent, status: 'sent' })
                                        .then(() => { qc.invalidateQueries({ queryKey: episodesKeys.lettersAll() }); setEditingTimelineId(null); })
                                        .catch((err: unknown) => alert(`Failed: ${extractErrorMessage(err)}`));
                                    } else {
                                      apiClient.patch(`patients/${patientId}/notes/${item.id}`, { content: editTimelineContent, status: 'signed' })
                                        .then(() => { qc.invalidateQueries({ queryKey: episodesKeys.notesAll() }); qc.invalidateQueries({ queryKey: patientsKeys.notesAll() }); setEditingTimelineId(null); })
                                        .catch((err: unknown) => alert(`Failed: ${extractErrorMessage(err)}`));
                                    }
                                  }}
                                  sx={{ bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' }, textTransform: 'none' }}>
                                  Save &amp; Sign
                                </Button>
                              </Box>
                            </Box>
                          ) : (
                            <>
                              {resolvedItemContent && (
                                <Typography variant="body2" color="text.secondary" sx={{ fontSize: 11, whiteSpace: 'pre-wrap', mb: 0.5 }}>
                                  {resolvedItemContent}
                                </Typography>
                              )}
                              {item.author && (
                                <Typography variant="caption" color="text.disabled" sx={{ fontSize: 10 }}>
                                  By: {item.author} &bull; {item.date ? new Date(item.date).toLocaleString('en-AU', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}
                                </Typography>
                              )}
                              {/* Edit action for drafts; Print for all */}
                              <Box sx={{ mt: 1, display: 'flex', gap: 1 }}>
                                {(item.type === 'note' || item.type === 'letter') && item.status === 'draft' && (
                                  <Button size="small" variant="outlined"
                                    onClick={() => { setEditingTimelineId(item.id); setEditTimelineContent(item.fullContent ?? item.summary); }}
                                    sx={{ borderColor: '#b8621a', color: '#b8621a', textTransform: 'none', fontSize: 11 }}>
                                    Edit Draft
                                  </Button>
                                )}
                                <Button size="small" variant="outlined"
                                  onClick={() => openInNewWindow({
                                    title: item.title,
                                    subtitle: `${item.author} — ${item.date ? new Date(item.date).toLocaleDateString('en-AU') : ''}`,
                                    content: resolvedItemContent,
                                    meta: { Type: item.type, Author: item.author, Date: item.date ? new Date(item.date).toLocaleDateString('en-AU') : '', Status: item.status ?? '' },
                                  })}
                                  sx={{ borderColor: '#1565C0', color: '#1565C0', textTransform: 'none', fontSize: 11 }}>
                                  Open in Window
                                </Button>
                                <Button size="small" variant="outlined"
                                  onClick={() => printContent({ title: item.title, subtitle: `${item.author} — ${item.date ? new Date(item.date).toLocaleDateString('en-AU') : ''}`, body: resolvedItemContent })}
                                  sx={{ borderColor: '#327C8D', color: '#327C8D', textTransform: 'none', fontSize: 11 }}>
                                  Print
                                </Button>
                              </Box>
                            </>
                          )}
                        </Box>
                      )}
                    </Box>
                  );
                })}
              </Box>
            ) : timelineFilter !== 'all' && unifiedTimeline.length > 0 ? (
              <Paper variant="outlined" sx={{ p: 2, textAlign: 'center', color: 'text.secondary' }}>
                <Typography variant="body2">No {TIMELINE_FILTERS.find(f => f.value === timelineFilter)?.label?.toLowerCase() ?? 'items'} in this episode. Try selecting a different filter.</Typography>
              </Paper>
            ) : (
              <Box>
                {/* Fallback to NotesList when unified timeline is empty (data still loading or no aggregated items) */}
                <NotesList patientId={patientId} episodeId={episode.id} />
              </Box>
            )}

            {(episodeOutcomeMeasures ?? []).length > 0 && (
              <Box sx={{ mt: 2 }}>
                <Typography variant="caption" fontWeight={600} color="text.secondary" sx={{ display: 'block', mb: 1, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  Outcome Measures
                </Typography>
                {[...(episodeOutcomeMeasures ?? [])]
                  .sort((a, b) => new Date(b.measureDate || b.createdAt || 0).getTime() - new Date(a.measureDate || a.createdAt || 0).getTime())
                  .map(m => (
                    <Box key={m.id} sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.75, borderBottom: '1px solid', borderColor: 'divider' }}>
                      <Chip label={MEASURE_LABEL[m.measureType ?? m.measure_type ?? ''] ?? (m.measureType ?? m.measure_type ?? 'Outcome')} size="small"
                        sx={{ fontSize: 10, height: 20, bgcolor: '#E3F2FD', color: '#1565C0', fontWeight: 600 }} />
                      <Chip label={m.collectionOccasion ?? m.collection_occasion ?? 'review'} size="small" variant="outlined" sx={{ fontSize: 9, height: 18, textTransform: 'capitalize' }} />
                      <Typography variant="body2" fontWeight={700} sx={{ color: '#327C8D' }}>{m.totalScore ?? m.total_score ?? '—'}</Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
                        {(m.measureDate || m.measure_date || m.createdAt || m.created_at) ? new Date(m.measureDate || m.measure_date || m.createdAt || m.created_at || '').toLocaleDateString('en-AU') : '—'}
                      </Typography>
                    </Box>
                  ))}
              </Box>
            )}
          </Paper>
        </Grid>

        {/* Right: ISBAR (only for Intake/ACIS) with Task List */}
        {isIntakeOrReferral && (
          <Grid size={{ xs: 12, md: 6 }}>
            <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                <AutoAwesomeIcon sx={{ color: '#b8621a', fontSize: 18 }} />
                <Typography variant="subtitle2" fontWeight={600}>ISBAR Summary</Typography>
              </Box>
              {['I — Identify', 'S — Situation', 'B — Background', 'A — Assessment', 'R — Recommendation'].map(label => (
                <Box key={label} sx={{ mb: 1 }}>
                  <Typography variant="caption" fontWeight={700} color="text.secondary">{label}</Typography>
                  <TextField fullWidth size="small" multiline rows={2} placeholder={`Enter ${label.split(' — ')[1]?.toLowerCase() ?? ''} details...`}
                    sx={{ '& .MuiInputBase-input': { fontSize: 12 } }} />
                </Box>
              ))}
            </Paper>

            {/* Task List — from tasks API */}
            <IntakeTaskList patientId={patientId} episodeId={episode.id} />
          </Grid>
        )}
      </Grid>

      {/* Add Note Dialog */}
      <AddNoteDialog
        open={noteDialogOpen}
        onClose={() => setNoteDialogOpen(false)}
        patientId={patientId}
        defaultEpisodeId={episode.id}
        noteType={isIntake ? 'intake' : 'progress'}
        onSaved={() => setFeedback('Note saved')}
      />

      {/* Message Dialog — with real recipient selection */}
      <SendMessageDialog
        open={messageDialogOpen}
        onClose={() => setMessageDialogOpen(false)}
        patientId={patientId}
        episodeId={episode.id}
        onSent={() => setFeedback('Message sent')}
      />

      {/* Report Dialog */}
      <AddNoteDialog
        open={reportDialogOpen}
        onClose={() => setReportDialogOpen(false)}
        patientId={patientId}
        defaultEpisodeId={episode.id}
        noteType="report"
        onSaved={() => setFeedback('Report saved')}
      />

      {/* Discharge Summary Dialog */}
      {dischargeOpen && <DischargeSummaryDialog open={dischargeOpen} onClose={() => setDischargeOpen(false)} episodeId={episode.id} patientId={patientId} />}

      {/* Close Episode with Vetting Dialog */}
      {closeVetOpen && <CloseEpisodeDialog open={closeVetOpen} onClose={() => setCloseVetOpen(false)} episodeId={episode.id} patientId={patientId} />}

      <Snackbar
        open={Boolean(feedback)}
        autoHideDuration={2500}
        onClose={() => setFeedback(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="success" onClose={() => setFeedback(null)} sx={{ width: '100%' }}>
          {feedback}
        </Alert>
      </Snackbar>
    </Box>
  );
}

export {
  AllocationDialog,
  HotSpotButton,
  DischargeSummaryDialog,
  CloseEpisodeDialog,
  IntakeTaskList,
} from './EpisodesAuxPanels';
