import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import EditIcon from '@mui/icons-material/Edit';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import HistoryIcon from '@mui/icons-material/History';
import SaveIcon from '@mui/icons-material/Save';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import TaskAltIcon from '@mui/icons-material/TaskAlt';
import {
  Accordion, AccordionDetails, AccordionSummary, Alert, Box, Button, Card,
  CardContent, Chip, CircularProgress, Divider, FormControl, Grid, IconButton,
  InputLabel, MenuItem, Paper, Select, Snackbar, TextField, Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiClient } from '../../../../../shared/services/apiClient';
import { ContactFormDialog } from '../../notes/ContactFormDialog';
import {
  patientsKeys,
  episodesKeys,
  patientMedicationsKeys,
  physicalHealthKeys,
  patientReferralsKeys,
} from '../../../queryKeys';

interface ReviewTask {
  title: string;
  assignedToId: string;
  dueDate: string;
  priority: string;
}

interface EpisodeSummary {
  id?: string;
  status?: string | null;
  episodeType?: string | null;
  title?: string | null;
  primaryDiagnosis?: string | null;
  diagnoses?: string | null;
}

interface EpisodeListResponse {
  data: EpisodeSummary[];
}

interface NoteContactMeta {
  planType?: string | null;
  [key: string]: unknown;
}

interface PatientNote {
  id?: string;
  createdAt?: string | null;
  noteDate?: string | null;
  noteType?: string | null;
  noteCategory?: string | null;
  title?: string | null;
  content?: string | null;
  status?: string | null;
  authorName?: string | null;
  didNotAttend?: boolean | null;
  contactMeta?: NoteContactMeta | null;
}

interface NotesResponse {
  notes: PatientNote[];
}

interface MedicationRow {
  status?: string | null;
  ceasedAt?: string | null;
  createdAt?: string | null;
  medicationName?: string | null;
  drugLabel?: string | null;
  dose?: string | null;
  ceasedReason?: string | null;
}

interface MedicationListResponse {
  medications?: MedicationRow[];
  data?: MedicationRow[];
}

interface AssessmentMetrics {
  scale?: string | null;
  weight?: number | string | null;
  bmi?: number | string | null;
  bpSystolic?: number | string | null;
  bpDiastolic?: number | string | null;
  heartRate?: number | string | null;
}

interface AssessmentRow {
  assessmentType?: string | null;
  totalScore?: number | string | null;
  scores?: AssessmentMetrics | null;
  assessmentData?: AssessmentMetrics | null;
}

interface AssessmentListResponse {
  data?: AssessmentRow[];
}

interface EpisodeAllocationResponse {
  orgUnitId: string | null;
  primaryClinicianId: string | null;
  keyWorkerId: string | null;
  mdt: Array<{ staffId: string; roleName: string; staffName: string }>;
}

interface ReviewRecencyCard {
  label: string;
  date: Date | null;
  daysSince: number | null;
  subtitle: string;
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? '').trim().toLocaleLowerCase();
}

function noteDate(note: PatientNote | null | undefined): Date | null {
  const raw = note?.createdAt ?? note?.noteDate ?? null;
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function daysSince(date: Date | null): number | null {
  if (!date) return null;
  return Math.floor((Date.now() - date.getTime()) / 86400000);
}

function matchesAnyNeedle(text: string, needles: readonly string[]): boolean {
  return needles.some((needle) => text.includes(needle));
}

function findLatestNote(
  notes: readonly PatientNote[],
  predicate: (note: PatientNote, normalizedText: string) => boolean,
): PatientNote | null {
  const sorted = [...notes].sort((left, right) => {
    const leftDate = noteDate(left)?.getTime() ?? 0;
    const rightDate = noteDate(right)?.getTime() ?? 0;
    return rightDate - leftDate;
  });

  for (const note of sorted) {
    const normalizedText = [
      note.noteType,
      note.noteCategory,
      note.title,
      note.content,
      note.authorName,
    ].map(normalizeText).join(' ');
    if (predicate(note, normalizedText)) {
      return note;
    }
  }

  return null;
}

function formatRecencyValue(date: Date | null): string {
  return date ? date.toLocaleDateString('en-AU') : 'No record';
}

function formatDaysSinceValue(days: number | null): string {
  if (days === null) return 'Not documented';
  if (days === 0) return 'Today';
  if (days === 1) return '1 day ago';
  return `${days} days ago`;
}

interface NinetyOneDayReviewTabProps { patientId: string }
export function NinetyOneDayReviewTab({ patientId }: NinetyOneDayReviewTabProps) {
  const qc = useQueryClient();
  const [challengesText, setChallengesText] = useState('');
  const [planText, setPlanText] = useState('');
  const [editSummary, setEditSummary] = useState(false);
  const [editedSummary, setEditedSummary] = useState('');
  const [snackOpen, setSnackOpen] = useState(false);
  const [snackMsg, setSnackMsg] = useState('');
  const [contactFormOpen, setContactFormOpen] = useState(false);
  const [reviewTasks, setReviewTasks] = useState<ReviewTask[]>([]);
  const [tasksSaving, setTasksSaving] = useState(false);

  const { data: staffList } = useQuery({
    queryKey: patientsKeys.staffLookup(),
    queryFn: () => apiClient.get<{ id: string; givenName: string; familyName: string }[]>('staff/lookup'),
    staleTime: 5 * 60_000,
  });

  const { data: episodes } = useQuery({
    queryKey: episodesKeys.byPatient(patientId),
    queryFn: () => apiClient.get<EpisodeListResponse>(`episodes/patient/${patientId}`).then(r => r.data),
    enabled: !!patientId,
  });

  const { data: notes } = useQuery({
    queryKey: patientsKeys.notes(patientId),
    queryFn: () => apiClient.get<NotesResponse>(`patients/${patientId}/notes`).then(r => r.notes),
    enabled: !!patientId,
  });

  const { data: meds } = useQuery({
    queryKey: patientMedicationsKeys.byPatient(patientId),
    queryFn: () => apiClient.get<MedicationListResponse | MedicationRow[]>(`medications/patients/${patientId}/medications`).then(r => Array.isArray(r) ? r : (r?.medications ?? r?.data ?? [])),
    enabled: !!patientId,
  });

  const { data: assessments } = useQuery({
    queryKey: physicalHealthKeys.nursingAssessments91d(patientId),
    queryFn: () => apiClient.get<AssessmentListResponse>(`nursing-assessments`, {
      patientId,
      since: new Date(Date.now() - 91 * 86400000).toISOString(),
    }).then(r => r.data ?? []),
    enabled: !!patientId,
  });

  const activeEpisode = episodes?.find((e) => e.status === 'open' && e.episodeType !== 'triage');
  const { data: allocation } = useQuery({
    queryKey: activeEpisode?.id ? episodesKeys.allocation(activeEpisode.id) : ['episode-allocation', 'none'],
    queryFn: () => apiClient.get<EpisodeAllocationResponse>(`episodes/${activeEpisode!.id}/allocation`),
    enabled: Boolean(activeEpisode?.id),
  });
  const last91Days = notes?.filter((n) => n.createdAt && new Date(n.createdAt) > new Date(Date.now() - 91 * 86400000)) ?? [];
  const activeMedCount = (meds ?? []).filter((m) => m.status === 'active').length;
  const assessmentCount = (assessments ?? []).length;

  // Find previous completed 91-day review notes
  const reviewNotes = (notes ?? []).filter((n) =>
    n.noteType === 'assessment' &&
    (n.contactMeta?.planType === '91_day_review' || n.noteCategory === '91-day-review' ||
     (n.title?.toLowerCase().includes('91') && n.title?.toLowerCase().includes('review')))
  ).sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime());

  const lastReviewNote = reviewNotes[0];
  const lastReviewDate = lastReviewNote && (lastReviewNote.createdAt || lastReviewNote.noteDate)
    ? new Date(lastReviewNote.createdAt ?? lastReviewNote.noteDate ?? Date.now())
    : null;
  const daysSinceReview = lastReviewDate ? Math.ceil((Date.now() - lastReviewDate.getTime()) / 86400000) : null;
  const nextReviewDue = lastReviewDate ? new Date(lastReviewDate.getTime() + 91 * 86400000) : null;
  const isOverdue = nextReviewDue ? nextReviewDue < new Date() : false;

  // Build comprehensive 91-day review from real data
  const allMeds = meds ?? [];
  const activeMeds = allMeds.filter((m) => m.status === 'active');
  const ceasedInPeriod = allMeds.filter((m) => m.status === 'ceased' && m.ceasedAt && new Date(m.ceasedAt) > new Date(Date.now() - 91 * 86400000));
  const newInPeriod = allMeds.filter((m) => m.createdAt && new Date(m.createdAt) > new Date(Date.now() - 91 * 86400000));
  const progressNotes = last91Days.filter((n) => n.noteType === 'progress' || n.noteType === 'review' || n.noteType === 'ward_round');
  const dna = last91Days.filter((n) => n.didNotAttend);
  const incidents = last91Days.filter((n) => n.noteType === 'incident');
  const laiNotes = last91Days.filter((n) => n.noteType === 'lai');
  const assessmentsList = assessments ?? [];
  const physicals = assessmentsList.filter((a) => a.assessmentType === 'physical_tracking');
  const outcomeAssessments = assessmentsList.filter((a) => a.assessmentType === 'outcome_measure');
  const staffNameById = new Map((staffList ?? []).map((staff) => [staff.id, `${staff.givenName} ${staff.familyName}`]));
  const keyClinicianName =
    staffNameById.get(allocation?.keyWorkerId ?? '') ??
    staffNameById.get(allocation?.primaryClinicianId ?? '') ??
    null;
  const consultantNames = (allocation?.mdt ?? [])
    .filter((row) => normalizeText(row.roleName).includes('consultant psychiatrist'))
    .map((row) => row.staffName);

  const medicalReviewNote = findLatestNote(notes ?? [], (_note, text) =>
    matchesAnyNeedle(text, ['ward_round', 'medical review', 'consultant review', 'psychiatrist review', 'medication review']),
  );
  const keyClinicianReviewNote = findLatestNote(notes ?? [], (note, text) => {
    const author = normalizeText(note.authorName);
    return Boolean(
      (keyClinicianName && author === normalizeText(keyClinicianName))
      || matchesAnyNeedle(text, ['key clinician review', 'key worker review', 'primary clinician review']),
    );
  });
  const consultantPsychiatristReviewNote = findLatestNote(notes ?? [], (note, text) => {
    const author = normalizeText(note.authorName);
    return Boolean(
      consultantNames.some((name) => author === normalizeText(name))
      || matchesAnyNeedle(text, ['consultant psychiatrist review', 'consultant review', 'psychiatrist review']),
    );
  });
  const gpContactNote = findLatestNote(notes ?? [], (_note, text) =>
    matchesAnyNeedle(text, [' gp ', 'general practitioner', 'family doctor', 'primary care', 'dr ']),
  );
  const familyContactNote = findLatestNote(notes ?? [], (_note, text) =>
    matchesAnyNeedle(text, ['family contact', 'carer contact', 'next of kin', 'family', 'carer', 'parent', 'spouse', 'partner']),
  );

  const reviewRecencyCards: ReviewRecencyCard[] = [
    {
      label: 'Last Key Clinician Review',
      date: noteDate(keyClinicianReviewNote),
      daysSince: daysSince(noteDate(keyClinicianReviewNote)),
      subtitle: keyClinicianName ?? 'No key clinician allocated',
    },
    {
      label: 'Medical Review',
      date: noteDate(medicalReviewNote),
      daysSince: daysSince(noteDate(medicalReviewNote)),
      subtitle: medicalReviewNote?.title ?? 'No medical review note found',
    },
    {
      label: 'Consultant Psychiatrist Review',
      date: noteDate(consultantPsychiatristReviewNote),
      daysSince: daysSince(noteDate(consultantPsychiatristReviewNote)),
      subtitle: consultantNames[0] ?? 'No consultant psychiatrist allocated',
    },
    {
      label: 'Last GP Contact',
      date: noteDate(gpContactNote),
      daysSince: daysSince(noteDate(gpContactNote)),
      subtitle: gpContactNote?.title ?? 'No GP contact recorded',
    },
    {
      label: 'Last Family Contact',
      date: noteDate(familyContactNote),
      daysSince: daysSince(noteDate(familyContactNote)),
      subtitle: familyContactNote?.title ?? 'No family contact recorded',
    },
  ];

  const aiSummary = `91-DAY REVIEW SUMMARY
Period: ${new Date(Date.now() - 91 * 86400000).toLocaleDateString('en-AU')} — ${new Date().toLocaleDateString('en-AU')}

CLINICAL SUMMARY:
- Active episode: ${activeEpisode?.title ?? 'None'} (${activeEpisode?.episodeType ?? 'N/A'})
- Primary diagnosis: ${activeEpisode?.primaryDiagnosis ?? activeEpisode?.diagnoses ?? 'Not recorded'}
- ${last91Days.length} clinical encounters documented in this period
- ${progressNotes.length} progress/review notes, ${dna.length} DNA events${incidents.length > 0 ? `, ${incidents.length} incident(s)` : ''}

REVIEW & CONTACT CADENCE:
- Key clinician review: ${formatRecencyValue(noteDate(keyClinicianReviewNote))} (${formatDaysSinceValue(daysSince(noteDate(keyClinicianReviewNote)))})
- Medical review: ${formatRecencyValue(noteDate(medicalReviewNote))} (${formatDaysSinceValue(daysSince(noteDate(medicalReviewNote)))})
- Consultant psychiatrist review: ${formatRecencyValue(noteDate(consultantPsychiatristReviewNote))} (${formatDaysSinceValue(daysSince(noteDate(consultantPsychiatristReviewNote)))})
- GP contact: ${formatRecencyValue(noteDate(gpContactNote))} (${formatDaysSinceValue(daysSince(noteDate(gpContactNote)))})
- Family contact: ${formatRecencyValue(noteDate(familyContactNote))} (${formatDaysSinceValue(daysSince(noteDate(familyContactNote)))})

MEDICATION SUMMARY:
- ${activeMeds.length} active medication(s): ${activeMeds.map((m) => `${m.medicationName ?? m.drugLabel ?? '?'} ${m.dose ?? ''}`).join(', ') || 'None'}
${newInPeriod.length > 0 ? `- New in period: ${newInPeriod.map((m) => m.medicationName ?? m.drugLabel).join(', ')}` : '- No new medications started'}
${ceasedInPeriod.length > 0 ? `- Ceased in period: ${ceasedInPeriod.map((m) => `${m.medicationName ?? m.drugLabel}${m.ceasedReason ? ` (${m.ceasedReason})` : ''}`).join(', ')}` : '- No medications ceased'}
${laiNotes.length > 0 ? `- LAI administrations: ${laiNotes.length} in this period` : ''}

ASSESSMENTS COMPLETED:
- ${assessmentsList.length} assessments in this period
${outcomeAssessments.length > 0 ? `- Outcome measures: ${outcomeAssessments.map((a) => { const s: AssessmentMetrics = a.scores ?? a.assessmentData ?? {}; return `${s.scale ?? a.assessmentType ?? '?'} (score: ${a.totalScore ?? '?'})`; }).join(', ')}` : '- No outcome measures recorded'}

PHYSICAL HEALTH SUMMARY:
${physicals.length > 0 ? (() => { const latest = physicals[0]; const s: AssessmentMetrics = latest.scores ?? latest.assessmentData ?? {}; return `- Latest: Weight ${s.weight ?? '?'}kg, BMI ${s.bmi ?? '?'}, BP ${s.bpSystolic ?? '?'}/${s.bpDiastolic ?? '?'}, HR ${s.heartRate ?? '?'}`; })() : '- No physical health data recorded in this period'}

ENGAGEMENT & IDENTIFIED CHALLENGES:
- Attendance rate: ${last91Days.length > 0 ? Math.round(((last91Days.length - dna.length) / last91Days.length) * 100) : 0}% (${last91Days.length - dna.length} attended / ${last91Days.length} total)
${dna.length > 0 ? `- DNA concerns: ${dna.length} missed appointments` : '- Good engagement — no DNAs'}
${incidents.length > 0 ? `- Incidents: ${incidents.map((n) => n.title).join('; ')}` : ''}

PLAN:
- [Enter plan for next 91-day period]`;

  const displaySummary = editedSummary || aiSummary;

  // Complete 91-day review mutation
  const completeReviewMut = useMutation({
    mutationFn: async () => {
      const attendedCount = last91Days.filter((n) => !n.didNotAttend).length;
      const dnaCount = last91Days.filter((n) => n.didNotAttend).length;

      const reportContent = `${displaySummary}

========================================
CHALLENGES IDENTIFIED
========================================
${challengesText || '(No challenges documented)'}

========================================
91-DAY PLAN
========================================
${planText || '(No plan documented)'}

========================================
SUMMARY STATISTICS
========================================
- Encounters (91d): ${last91Days.length}
- Attended: ${attendedCount}
- DNA: ${dnaCount}
- Active Medications: ${activeMedCount}
- Assessments: ${assessmentCount}
- Review Date: ${new Date().toLocaleDateString('en-AU')}
- Next Review Due: ${new Date(Date.now() + 91 * 86400000).toLocaleDateString('en-AU')}`;

      return apiClient.post(`patients/${patientId}/notes`, {
        patientId,
        noteType: 'assessment',
        title: `91-Day Review — ${new Date(Date.now() - 91 * 86400000).toLocaleDateString('en-AU')} to ${new Date().toLocaleDateString('en-AU')}`,
        content: reportContent,
        noteCategory: '91-day-review',
        contactMeta: {
          planType: '91_day_review',
          periodStart: new Date(Date.now() - 91 * 86400000).toISOString(),
          periodEnd: new Date().toISOString(),
        },
        status: 'signed',
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: patientsKeys.notes(patientId) });
      setChallengesText('');
      setPlanText('');
      setEditedSummary('');
      setEditSummary(false);
      setSnackMsg('91-Day Review completed and saved as a clinical note.');
      setSnackOpen(true);
      setContactFormOpen(true);
    },
    onError: () => {
      setSnackMsg('Failed to save the 91-Day Review. Please try again.');
      setSnackOpen(true);
    },
  });

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h6" fontWeight={600} fontFamily="Albert Sans, sans-serif">91-Day Review</Typography>
      </Box>

      {/* Quick Stats Cards */}
      <Box sx={{ display: 'flex', gap: 1.5, mb: 3, flexWrap: 'wrap' }}>
        {[
          { value: last91Days.length, label: 'Encounters', sub: '91 days', color: '#b8621a', bg: '#FFF3E0' },
          { value: last91Days.filter((n) => !n.didNotAttend).length, label: 'Attended', sub: last91Days.length > 0 ? `${Math.round(((last91Days.length - dna.length) / last91Days.length) * 100)}%` : '—', color: '#327C8D', bg: '#E0F2F1' },
          { value: dna.length, label: 'DNA', sub: dna.length > 0 ? 'action needed' : 'none', color: '#D32F2F', bg: dna.length > 0 ? '#FFEBEE' : '#E8F5E9' },
          { value: assessmentCount, label: 'Assessments', sub: `${outcomeAssessments.length} outcome`, color: '#2E7D32', bg: '#E8F5E9' },
        ].map(stat => (
          <Card key={stat.label} variant="outlined" sx={{ flex: '1 1 140px', minWidth: 130, maxWidth: 200, bgcolor: stat.bg, borderColor: stat.color + '40' }}>
            <CardContent sx={{ py: 1.5, px: 2, '&:last-child': { pb: 1.5 }, textAlign: 'center' }}>
              <Typography variant="h4" fontWeight={800} sx={{ color: stat.color, lineHeight: 1.1 }}>{stat.value}</Typography>
              <Typography variant="body2" fontWeight={600} sx={{ color: stat.color, fontSize: 12, mt: 0.25 }}>{stat.label}</Typography>
              <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>{stat.sub}</Typography>
            </CardContent>
          </Card>
        ))}
      </Box>

      <Box sx={{ display: 'flex', gap: 1.5, mb: 3, flexWrap: 'wrap' }}>
        {reviewRecencyCards.map((card) => (
          <Card
            key={card.label}
            variant="outlined"
            sx={{ flex: '1 1 200px', minWidth: 180, maxWidth: 240, borderColor: '#327C8D33', bgcolor: '#F8FCFD' }}
          >
            <CardContent sx={{ py: 1.5, px: 2, '&:last-child': { pb: 1.5 } }}>
              <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>
                {card.label}
              </Typography>
              <Typography variant="body1" fontWeight={700} sx={{ color: '#1E4F59', mt: 0.4 }}>
                {formatRecencyValue(card.date)}
              </Typography>
              <Typography variant="caption" sx={{ display: 'block', color: '#327C8D', fontWeight: 600, mt: 0.25 }}>
                {formatDaysSinceValue(card.daysSince)}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>
                {card.subtitle}
              </Typography>
            </CardContent>
          </Card>
        ))}
      </Box>

      {/* Review Status Banner */}
      <Paper variant="outlined" sx={{ p: 1.5, mb: 3, bgcolor: isOverdue ? '#FFF5F5' : '#F5FFF5', borderColor: isOverdue ? '#D32F2F' : '#4CAF50' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <HistoryIcon sx={{ color: isOverdue ? '#D32F2F' : '#4CAF50', fontSize: 20 }} />
          {lastReviewDate ? (
            <Typography variant="body2" color={isOverdue ? '#D32F2F' : 'text.secondary'}>
              Last review: {lastReviewDate.toLocaleDateString('en-AU')} ({daysSinceReview} days ago)
              {isOverdue ? ' — OVERDUE' : ` — Next due: ${nextReviewDue!.toLocaleDateString('en-AU')}`}
            </Typography>
          ) : (
            <Typography variant="body2" color="text.secondary">No previous 91-day review on record</Typography>
          )}
        </Box>
      </Paper>

      {/* AI Summary */}
      <Paper variant="outlined" sx={{ p: 2.5, mb: 3, borderLeft: '4px solid #b8621a' }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <AutoAwesomeIcon sx={{ color: '#b8621a', fontSize: 20 }} />
            <Typography variant="subtitle1" fontWeight={700} fontFamily="Albert Sans, sans-serif">AI Review Summary</Typography>
            <Chip label="AI Generated" size="small" sx={{ fontSize: 9, height: 18, bgcolor: '#FFF3E0', color: '#E65100' }} />
          </Box>
          <Button size="small" startIcon={<EditIcon />} onClick={() => {
            setEditSummary(!editSummary);
            if (!editSummary) setEditedSummary(displaySummary);
          }} sx={{ color: '#b8621a', fontSize: 12 }}>
            {editSummary ? 'Preview' : 'Edit'}
          </Button>
        </Box>
        {editSummary ? (
          <TextField fullWidth multiline rows={16} value={editedSummary} onChange={e => setEditedSummary(e.target.value)}
            sx={{ '& .MuiInputBase-input': { fontFamily: 'monospace', fontSize: 12 } }} />
        ) : (
          <Box sx={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: 12, color: '#3D484B', maxHeight: 400, overflowY: 'auto', bgcolor: '#FAFAFA', p: 2, borderRadius: 1 }}>
            {displaySummary}
          </Box>
        )}
      </Paper>

      {/* Challenges Identified — Editable */}
      <Paper variant="outlined" sx={{ p: 2.5, mb: 3, borderLeft: '4px solid #D32F2F' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
          <WarningAmberIcon sx={{ color: '#D32F2F', fontSize: 20 }} />
          <Typography variant="subtitle1" fontWeight={700} fontFamily="Albert Sans, sans-serif">Challenges Identified</Typography>
        </Box>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
          Document key challenges observed during this review period — engagement, medication, diagnostic, family/support, risk.
        </Typography>
        <TextField
          fullWidth
          multiline
          rows={6}
          placeholder={`- Engagement: e.g. missed appointments, difficulty maintaining contact\n- Medication: e.g. adherence issues, side effects, required changes\n- Diagnostic: e.g. evolving presentation, diagnostic uncertainty\n- Family/Support: e.g. carer burden, support network changes\n- Risk: e.g. risk trajectory, new risk factors identified`}
          value={challengesText}
          onChange={e => setChallengesText(e.target.value)}
          sx={{ '& .MuiInputBase-input': { fontFamily: 'monospace', fontSize: 12 } }}
        />
      </Paper>

      {/* Plan — Editable */}
      <Paper variant="outlined" sx={{ p: 2.5, mb: 3, borderLeft: '4px solid #327C8D' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
          <CheckCircleIcon sx={{ color: '#327C8D', fontSize: 20 }} />
          <Typography variant="subtitle1" fontWeight={700} fontFamily="Albert Sans, sans-serif">Plan</Typography>
        </Box>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
          Treatment goals, medication plan, psychological interventions, social supports, and delegated tasks for the next 91-day period.
        </Typography>
        <TextField
          fullWidth
          multiline
          rows={8}
          placeholder={`TREATMENT GOALS:\n1.\n2.\n3.\n\nMEDICATION PLAN:\n- Continue/Change:\n- Monitoring:\n\nPSYCHOLOGICAL INTERVENTIONS:\n-\n\nSOCIAL SUPPORTS:\n-\n\nTASKS & DELEGATIONS:\n- [ ] Task 1 — Assigned to: ___  Due: ___\n- [ ] Task 2 — Assigned to: ___  Due: ___\n\nNEXT REVIEW DATE: ${new Date(Date.now() + 91 * 86400000).toLocaleDateString('en-AU')}`}
          value={planText}
          onChange={e => setPlanText(e.target.value)}
          sx={{ '& .MuiInputBase-input': { fontFamily: 'monospace', fontSize: 12 } }}
        />
      </Paper>

      {/* Complete Review Button */}
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 4 }}>
        <Button
          variant="contained"
          size="large"
          startIcon={completeReviewMut.isPending ? <CircularProgress size={18} color="inherit" /> : <SaveIcon />}
          disabled={completeReviewMut.isPending}
          onClick={() => completeReviewMut.mutate()}
          sx={{ bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' }, textTransform: 'none', fontWeight: 700, px: 4 }}
        >
          {completeReviewMut.isPending ? 'Saving...' : 'Complete 91-Day Review'}
        </Button>
      </Box>

      {/* Task Creation Section */}
      <Paper variant="outlined" sx={{ p: 2.5, mb: 3, borderColor: '#327C8D', borderWidth: 2, borderRadius: 2 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <TaskAltIcon sx={{ color: '#327C8D', fontSize: 20 }} />
            <Typography variant="subtitle1" fontWeight={700} fontFamily="Albert Sans, sans-serif" sx={{ color: '#327C8D' }}>
              Review Tasks
            </Typography>
          </Box>
          <Button
            size="small" startIcon={<AddIcon />} variant="outlined"
            onClick={() => setReviewTasks(prev => [...prev, {
              title: '', assignedToId: '', dueDate: new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0], priority: 'medium',
            }])}
            sx={{ borderColor: '#327C8D', color: '#327C8D', textTransform: 'none' }}>
            Add Task
          </Button>
        </Box>

        {reviewTasks.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 2 }}>
            No tasks added. Click &quot;Add Task&quot; to assign follow-up actions to clinicians.
          </Typography>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            {reviewTasks.map((task, idx) => (
              <Paper key={idx} variant="outlined" sx={{ p: 1.5, borderLeft: '3px solid #327C8D' }}>
                <Grid container spacing={1.5} alignItems="center">
                  <Grid size={{ xs: 12, sm: 4 }}>
                    <TextField label="Task *" fullWidth size="small" value={task.title}
                      onChange={e => setReviewTasks(prev => prev.map((t, i) => i === idx ? { ...t, title: e.target.value } : t))}
                      placeholder="e.g. Review blood results, Schedule therapy" />
                  </Grid>
                  <Grid size={{ xs: 12, sm: 3 }}>
                    <FormControl fullWidth size="small">
                      <InputLabel>Assign To *</InputLabel>
                      <Select value={task.assignedToId} label="Assign To *"
                        onChange={e => setReviewTasks(prev => prev.map((t, i) => i === idx ? { ...t, assignedToId: e.target.value } : t))}>
                        <MenuItem value="">Select clinician</MenuItem>
                        {(staffList ?? []).map(s => <MenuItem key={s.id} value={s.id}>{s.givenName} {s.familyName}</MenuItem>)}
                      </Select>
                    </FormControl>
                  </Grid>
                  <Grid size={{ xs: 6, sm: 2 }}>
                    <TextField label="Due Date" type="date" fullWidth size="small" value={task.dueDate}
                      onChange={e => setReviewTasks(prev => prev.map((t, i) => i === idx ? { ...t, dueDate: e.target.value } : t))}
                      slotProps={{ inputLabel: { shrink: true } }} />
                  </Grid>
                  <Grid size={{ xs: 6, sm: 2 }}>
                    <FormControl fullWidth size="small">
                      <InputLabel>Priority</InputLabel>
                      <Select value={task.priority} label="Priority"
                        onChange={e => setReviewTasks(prev => prev.map((t, i) => i === idx ? { ...t, priority: e.target.value } : t))}>
                        <MenuItem value="low">Low</MenuItem>
                        <MenuItem value="medium">Medium</MenuItem>
                        <MenuItem value="high">High</MenuItem>
                        <MenuItem value="urgent">Urgent</MenuItem>
                      </Select>
                    </FormControl>
                  </Grid>
                  <Grid size={{ xs: 12, sm: 1 }} sx={{ display: 'flex', justifyContent: 'center' }}>
                    <IconButton size="small" color="error" onClick={() => setReviewTasks(prev => prev.filter((_, i) => i !== idx))}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Grid>
                </Grid>
              </Paper>
            ))}

            <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 1 }}>
              <Button
                variant="contained" size="small"
                disabled={tasksSaving || reviewTasks.every(t => !t.title.trim() || !t.assignedToId)}
                onClick={async () => {
                  const validTasks = reviewTasks.filter(t => t.title.trim() && t.assignedToId);
                  if (!validTasks.length) return;
                  setTasksSaving(true);
                  let created = 0;
                  for (const t of validTasks) {
                    try {
                      await apiClient.post('tasks', {
                        patientId,
                        title: `91-Day Review: ${t.title.trim()}`,
                        description: `Task from 91-day review completed on ${new Date().toLocaleDateString('en-AU')}`,
                        assignedToId: t.assignedToId,
                        dueDate: t.dueDate || undefined,
                        priority: t.priority,
                      });
                      created++;
                    } catch { /* continue creating remaining */ }
                  }
                  qc.invalidateQueries({ queryKey: patientsKeys.tasksAll() });
                  setReviewTasks([]);
                  setTasksSaving(false);
                  setSnackMsg(`${created} task${created !== 1 ? 's' : ''} created and assigned.`);
                  setSnackOpen(true);
                }}
                sx={{ bgcolor: '#327C8D', '&:hover': { bgcolor: '#265f6d' }, textTransform: 'none' }}>
                {tasksSaving ? 'Creating...' : `Create ${reviewTasks.filter(t => t.title.trim() && t.assignedToId).length} Task${reviewTasks.filter(t => t.title.trim() && t.assignedToId).length !== 1 ? 's' : ''}`}
              </Button>
            </Box>
          </Box>
        )}
      </Paper>

      <Divider sx={{ mb: 3 }} />

      {/* Previous Reviews Section */}
      <Paper variant="outlined" sx={{ p: 2.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
          <HistoryIcon sx={{ color: '#3D484B', fontSize: 20 }} />
          <Typography variant="subtitle1" fontWeight={700} fontFamily="Albert Sans, sans-serif">Previous Reviews</Typography>
          <Chip label={`${reviewNotes.length} review${reviewNotes.length !== 1 ? 's' : ''}`} size="small" sx={{ fontSize: 10, height: 20 }} />
        </Box>

        {reviewNotes.length === 0 && (
          <Alert severity="info" sx={{ fontFamily: 'Albert Sans, sans-serif' }}>
            No previous 91-day reviews on record. Complete your first review above.
          </Alert>
        )}

        {reviewNotes.map((review) => {
          const reviewDate = new Date(review.createdAt ?? review.noteDate ?? Date.now());
          return (
            <Accordion key={review.id} variant="outlined" sx={{ mb: 1, '&:before': { display: 'none' } }}>
              <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ '& .MuiAccordionSummary-content': { alignItems: 'center', gap: 1.5 } }}>
                <Chip
                  label={reviewDate.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}
                  size="small"
                  sx={{ bgcolor: '#FFF3E0', color: '#E65100', fontWeight: 700, fontSize: 11 }}
                />
                <Typography variant="body2" fontWeight={600} sx={{ fontSize: 13 }}>
                  {review.title || '91-Day Review'}
                </Typography>
                {review.authorName && (
                  <Typography variant="caption" color="text.secondary">by {review.authorName}</Typography>
                )}
                {review.status === 'signed' && (
                  <Chip label="Signed" size="small" color="success" sx={{ fontSize: 9, height: 16 }} />
                )}
              </AccordionSummary>
              <AccordionDetails>
                <Box sx={{
                  whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: 11,
                  color: '#3D484B', bgcolor: '#FAFAFA', p: 2, borderRadius: 1,
                  border: '1px solid #EBEBEB', maxHeight: 500, overflowY: 'auto',
                }}>
                  {review.content || '(No content recorded)'}
                </Box>
              </AccordionDetails>
            </Accordion>
          );
        })}
      </Paper>

      <Snackbar
        open={snackOpen}
        autoHideDuration={5000}
        onClose={() => setSnackOpen(false)}
        message={snackMsg}
      />

      <ContactFormDialog
        open={contactFormOpen}
        patientId={patientId}
        onClose={() => setContactFormOpen(false)}
        onSaved={() => {
          setContactFormOpen(false);
          qc.invalidateQueries({ queryKey: patientReferralsKeys.unifiedContacts(patientId) });
        }}
        initialNoteType="assessment"
        initialNoteTitle="91-Day Review"
        initialIsReportable={true}
      />
    </Box>
  );
}

export default NinetyOneDayReviewTab;
