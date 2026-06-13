import { useMemo } from 'react';
import { Box, Chip, CircularProgress, Divider, Grid, Paper, Tooltip, Typography } from '@mui/material';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import EventNoteIcon from '@mui/icons-material/EventNote';
import PeopleAltIcon from '@mui/icons-material/PeopleAlt';
import { useQuery } from '@tanstack/react-query';
import { usePatient } from '../../../hooks/usePatient';
import { apiClient } from '../../../../../shared/services/apiClient';
import { episodesKeys, patientAppointmentsKeys, patientsKeys } from '../../../queryKeys';
import {
  daysBetween,
  fmtDate,
  fmtDateShort,
  parseDate,
  readStringArrayField,
  type SummaryAppointmentRow,
  type SummaryEpisodeRow,
  type SummaryNoteRow,
} from './summaryTabDomain';
import { SectionSignoffControls } from './SummarySignoffControls';
import { StatCard } from './SummaryUiCards';
import {
  buildNarrative,
  CLINICAL_TYPES,
  NOTE_TYPE_LABELS,
  noteTypeLabel,
  TYPE_COLORS,
} from './summaryNarrative';

interface CareProvisionPanelProps {
  patientId: string;
}

interface EpisodeAllocationResponse {
  orgUnitId: string | null;
  primaryClinicianId: string | null;
  keyWorkerId: string | null;
  mdt: Array<{ staffId: string; roleName: string; staffName: string }>;
}

interface StaffLookupRow {
  id: string;
  givenName: string;
  familyName: string;
}

interface CareProvisionReviewCard {
  label: string;
  date: Date | null;
  daysSince: number | null;
  subtitle: string;
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? '').trim().toLocaleLowerCase();
}

function noteDate(note: SummaryNoteRow | null | undefined): Date | null {
  return parseDate(note?.createdAt ?? note?.noteDateTime ?? null);
}

function daysSince(date: Date | null): number | null {
  if (!date) return null;
  return Math.floor((Date.now() - date.getTime()) / 86400000);
}

function matchesAnyNeedle(text: string, needles: readonly string[]): boolean {
  return needles.some((needle) => text.includes(needle));
}

function findLatestNote(
  notes: readonly SummaryNoteRow[],
  predicate: (note: SummaryNoteRow, normalizedText: string) => boolean,
): SummaryNoteRow | null {
  const sorted = [...notes].sort((left, right) => {
    const leftDate = noteDate(left)?.getTime() ?? 0;
    const rightDate = noteDate(right)?.getTime() ?? 0;
    return rightDate - leftDate;
  });

  for (const note of sorted) {
    const normalizedText = [
      note.noteType,
      note.title,
      note.content,
      note.bodyHtml,
      note.planHtml,
      note.assessmentHtml,
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

export function CareProvisionPanel({ patientId }: CareProvisionPanelProps) {
  const { data: patient } = usePatient(patientId);
  const { data: staffList } = useQuery({
    queryKey: patientsKeys.staffLookup(),
    queryFn: () => apiClient.get<StaffLookupRow[]>('staff/lookup'),
    staleTime: 5 * 60_000,
  });
  const { data: episodes, isLoading: epLoading } = useQuery({
    queryKey: episodesKeys.byPatient(patientId),
    queryFn: () => apiClient.get<{ data: SummaryEpisodeRow[] }>(`episodes/patient/${patientId}`).then((r) => r.data),
    enabled: !!patientId,
  });
  const { data: notes, isLoading: notesLoading } = useQuery({
    queryKey: patientsKeys.notes(patientId),
    queryFn: () => apiClient.get<{ notes: SummaryNoteRow[] }>(`patients/${patientId}/notes`).then((r) => r.notes ?? []),
    enabled: !!patientId,
  });
  const { data: rawAppts = [] } = useQuery({
    queryKey: patientAppointmentsKeys.byPatient(patientId),
    queryFn: () => apiClient.get<unknown>('appointments', { patientId }).then((response) => readStringArrayField<SummaryAppointmentRow>(response, 'data')),
    enabled: !!patientId,
    staleTime: 60_000,
  });
  const activeEpisode = useMemo(
    () => (episodes ?? []).find((episode) => episode.status === 'open' && episode.episodeType !== 'triage'),
    [episodes],
  );
  const { data: allocation } = useQuery({
    queryKey: activeEpisode?.id ? episodesKeys.allocation(activeEpisode.id) : ['episode-allocation', 'none'],
    queryFn: () => apiClient.get<EpisodeAllocationResponse>(`episodes/${activeEpisode!.id}/allocation`),
    enabled: Boolean(activeEpisode?.id),
  });

  const isLoading = epLoading || notesLoading;

  const stats = useMemo(() => {
    if (!notes) return null;
    const enc = notes.filter((n) => CLINICAL_TYPES.has(n.noteType ?? '') && n.status !== 'draft');
    const sorted = [...enc].sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const byType: Record<string, number> = {};
    let dnaCount = 0;
    let reportable = 0;
    const clinicians = new Set<string>();

    for (const n of enc) {
      const type = n.noteType ?? 'unknown';
      byType[type] = (byType[type] ?? 0) + 1;
      if (n.didNotAttend) dnaCount++;
      if (n.isReportableContact !== false) reportable++;
      if (n.authorName) clinicians.add(n.authorName);
    }

    const upcomingAppts = rawAppts
      .filter((a) => Boolean(a.startTime) && new Date(a.startTime ?? '') >= new Date() && !['cancelled', 'no_show'].includes(a.status ?? ''))
      .sort((a, b) => (a.startTime ?? '').localeCompare(b.startTime ?? ''));

    return { enc, sorted, first, last, byType, dnaCount, reportable, clinicians, upcomingAppts };
  }, [notes, rawAppts]);

  const narrative = useMemo(() => {
    if (!stats || !patient || !episodes) return '';
    return buildNarrative(notes ?? [], episodes, patient);
  }, [stats, patient, episodes, notes]);

  const reviewRecencyCards = useMemo((): CareProvisionReviewCard[] => {
    const noteList = notes ?? [];
    const staffNameById = new Map((staffList ?? []).map((staff) => [staff.id, `${staff.givenName} ${staff.familyName}`]));
    const keyClinicianName =
      staffNameById.get(allocation?.keyWorkerId ?? '')
      ?? staffNameById.get(allocation?.primaryClinicianId ?? '')
      ?? null;
    const consultantNames = (allocation?.mdt ?? [])
      .filter((row) => normalizeText(row.roleName).includes('consultant psychiatrist'))
      .map((row) => row.staffName);

    const medicalReviewNote = findLatestNote(noteList, (_note, text) =>
      matchesAnyNeedle(text, ['ward_round', 'medical review', 'consultant review', 'psychiatrist review', 'medication review']),
    );
    const keyClinicianReviewNote = findLatestNote(noteList, (note, text) => {
      const author = normalizeText(note.authorName);
      return Boolean(
        (keyClinicianName && author === normalizeText(keyClinicianName))
        || matchesAnyNeedle(text, ['key clinician review', 'key worker review', 'primary clinician review']),
      );
    });
    const consultantPsychiatristReviewNote = findLatestNote(noteList, (note, text) => {
      const author = normalizeText(note.authorName);
      return Boolean(
        consultantNames.some((name) => author === normalizeText(name))
        || matchesAnyNeedle(text, ['consultant psychiatrist review', 'consultant review', 'psychiatrist review']),
      );
    });
    const gpContactNote = findLatestNote(noteList, (_note, text) =>
      matchesAnyNeedle(text, [' gp ', 'general practitioner', 'family doctor', 'primary care', 'dr ']),
    );
    const familyContactNote = findLatestNote(noteList, (_note, text) =>
      matchesAnyNeedle(text, ['family contact', 'carer contact', 'next of kin', 'family', 'carer', 'parent', 'spouse', 'partner']),
    );

    return [
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
  }, [allocation, notes, staffList]);

  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <CircularProgress role="progressbar" aria-label="Loading" sx={{ color: '#b8621a' }} />
      </Box>
    );
  }

  if (!stats || !stats.enc.length) {
    return (
      <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }}>
        <EventNoteIcon sx={{ fontSize: 48, color: '#ccc', mb: 1 }} />
        <Typography color="text.secondary" fontFamily="Albert Sans, sans-serif">
          No clinical encounters recorded yet. Care provision summary will populate as encounters are documented.
        </Typography>
      </Paper>
    );
  }

  const { enc, sorted, first, last, byType, dnaCount, reportable, clinicians, upcomingAppts } = stats;
  const firstEpisode = (episodes ?? []).slice().sort((a, b) => (a.startDate ?? '').localeCompare(b.startDate ?? ''))[0];
  const referralDate = firstEpisode?.startDate ?? first?.createdAt;
  const totalDays = first && last ? daysBetween(first.createdAt, new Date().toISOString()) : 0;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Grid container spacing={2}>
        <Grid size={{ xs: 6, sm: 3 }}>
          <StatCard
            icon={<EventNoteIcon sx={{ color: '#b8621a', fontSize: 24 }} />}
            label="Total Encounters"
            value={String(enc.length)}
            sub={`${dnaCount} DNA`}
            color="#FFF3E0"
          />
        </Grid>
        <Grid size={{ xs: 6, sm: 3 }}>
          <StatCard
            icon={<CheckCircleOutlineIcon sx={{ color: '#327C8D', fontSize: 24 }} />}
            label="ABF Reportable"
            value={String(reportable)}
            sub={`${enc.length - reportable} non-reportable`}
            color="#E0F2F1"
          />
        </Grid>
        <Grid size={{ xs: 6, sm: 3 }}>
          <StatCard
            icon={<AccessTimeIcon sx={{ color: '#5C6BC0', fontSize: 24 }} />}
            label="Days in Care"
            value={String(totalDays)}
            sub={referralDate ? `Since ${fmtDateShort(referralDate)}` : '—'}
            color="#EDE7F6"
          />
        </Grid>
        <Grid size={{ xs: 6, sm: 3 }}>
          <StatCard
            icon={<PeopleAltIcon sx={{ color: '#D32F2F', fontSize: 24 }} />}
            label="Clinicians Involved"
            value={String(clinicians.size || '—')}
            sub={clinicians.size ? Array.from(clinicians).slice(0, 2).join(', ') : 'Not recorded'}
            color="#FFEBEE"
          />
        </Grid>
      </Grid>

      <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
        {reviewRecencyCards.map((card) => (
          <Paper
            key={card.label}
            variant="outlined"
            sx={{ flex: '1 1 200px', minWidth: 180, maxWidth: 240, borderColor: '#327C8D33', bgcolor: '#F8FCFD', p: 1.5 }}
          >
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
          </Paper>
        ))}
      </Box>

      <Paper variant="outlined" sx={{ p: 2.5, borderLeft: '4px solid #b8621a' }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1.2, mb: 1.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <AutoAwesomeIcon sx={{ color: '#b8621a', fontSize: 20 }} />
            <Typography variant="subtitle1" fontWeight={700} fontFamily="Albert Sans, sans-serif">
              Care Provision Narrative
            </Typography>
            <Chip label="Auto-generated from encounters" size="small" sx={{ fontSize: 9, height: 18, bgcolor: '#FFF3E0', color: '#E65100' }} />
          </Box>
          <SectionSignoffControls patientId={patientId} section="care_provision_summary" />
        </Box>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
          Intelligently summarised from all documented encounters, contacts, and activities since referral.
        </Typography>
        <Box sx={{ whiteSpace: 'pre-wrap', fontFamily: 'Albert Sans, sans-serif', fontSize: 13, color: '#3D484B', lineHeight: 1.7 }}>
          {narrative}
        </Box>
      </Paper>

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 5 }}>
          <Paper variant="outlined" sx={{ p: 2.5, height: '100%' }}>
            <Typography variant="subtitle2" fontWeight={700} fontFamily="Albert Sans, sans-serif" sx={{ mb: 2 }}>
              Encounters by Type
            </Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {Object.entries(byType)
                .sort((a, b) => b[1] - a[1])
                .map(([type, count]) => {
                  const pct = Math.round((count / enc.length) * 100);
                  const color = TYPE_COLORS[type] ?? '#999';
                  return (
                    <Box key={type}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.25 }}>
                        <Typography variant="caption" fontWeight={500} color="text.secondary">
                          {NOTE_TYPE_LABELS[type] ?? type}
                        </Typography>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          <Typography variant="caption" fontWeight={700} color="text.primary">{count}</Typography>
                          <Typography variant="caption" color="text.secondary">({pct}%)</Typography>
                        </Box>
                      </Box>
                      <Box sx={{ height: 6, bgcolor: '#F0F0F0', borderRadius: 3, overflow: 'hidden' }}>
                        <Box sx={{ height: '100%', width: `${pct}%`, bgcolor: color, borderRadius: 3, transition: 'width 0.4s ease' }} />
                      </Box>
                    </Box>
                  );
                })}
            </Box>
            <Divider sx={{ my: 2 }} />
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              {dnaCount > 0 && (
                <Chip label={`${dnaCount} DNA`} size="small" color="error" variant="outlined" sx={{ fontSize: 10 }} />
              )}
              <Chip label={`${reportable} ABF reportable`} size="small" sx={{ fontSize: 10, bgcolor: '#E0F2F1', color: '#327C8D' }} />
              <Chip label={`${enc.length - reportable} non-reportable`} size="small" variant="outlined" sx={{ fontSize: 10 }} />
            </Box>
          </Paper>
        </Grid>

        <Grid size={{ xs: 12, md: 7 }}>
          <Paper variant="outlined" sx={{ p: 2.5, height: '100%' }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
              <Typography variant="subtitle2" fontWeight={700} fontFamily="Albert Sans, sans-serif">
                Recent Activity
              </Typography>
              <Chip label={`${sorted.length} total`} size="small" variant="outlined" sx={{ fontSize: 10 }} />
            </Box>
            <Box sx={{ position: 'relative', pl: 2.5, borderLeft: '2px solid #E0E0E0', maxHeight: 340, overflowY: 'auto' }}>
              {[...sorted].reverse().slice(0, 12).map((n, i: number) => {
                const color = TYPE_COLORS[n.noteType ?? ''] ?? '#999';
                const isDNA = n.didNotAttend;
                const isReportable = n.isReportableContact !== false;
                return (
                  <Box key={n.id ?? i} sx={{ position: 'relative', mb: 2, ml: 0.5 }}>
                    <Box sx={{ position: 'absolute', left: -19, top: 5, width: 10, height: 10, borderRadius: '50%', bgcolor: isDNA ? '#D32F2F' : color, border: '2px solid #fff', flexShrink: 0 }} />
                    <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1 }}>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography variant="body2" fontWeight={600} sx={{ lineHeight: 1.3, fontSize: 12 }}>
                          {n.title || noteTypeLabel(n.noteType)}
                          {isDNA && <Chip label="DNA" size="small" color="error" sx={{ ml: 0.5, fontSize: 9, height: 16 }} />}
                        </Typography>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.25, flexWrap: 'wrap' }}>
                          <Chip
                            label={noteTypeLabel(n.noteType)}
                            size="small"
                            sx={{ fontSize: 9, height: 16, bgcolor: `${color}18`, color }}
                          />
                          {isReportable && (
                            <Chip label="ABF" size="small" sx={{ fontSize: 9, height: 16, bgcolor: '#E0F2F1', color: '#327C8D' }} />
                          )}
                          {n.authorName && (
                            <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>
                              {n.authorName}
                            </Typography>
                          )}
                        </Box>
                      </Box>
                      <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10, whiteSpace: 'nowrap', flexShrink: 0 }}>
                        {fmtDateShort(n.createdAt)}
                      </Typography>
                    </Box>
                  </Box>
                );
              })}
              {sorted.length > 12 && (
                <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                  + {sorted.length - 12} earlier encounters
                </Typography>
              )}
            </Box>
          </Paper>
        </Grid>
      </Grid>

      {(episodes ?? []).length > 0 && (
        <Paper variant="outlined" sx={{ p: 2.5 }}>
          <Typography variant="subtitle2" fontWeight={700} fontFamily="Albert Sans, sans-serif" sx={{ mb: 2 }}>
            Episode Summary
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {(episodes ?? []).map((ep) => {
              const epNotes = (notes ?? []).filter((n) => n.episodeId === ep.id && CLINICAL_TYPES.has(n.noteType ?? ''));
              return (
                <Box key={ep.id} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: 1.5, bgcolor: '#FAFAFA', borderRadius: 1, border: '1px solid', borderColor: 'divider' }}>
                  <Box sx={{ flex: 1 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Typography variant="body2" fontWeight={600} sx={{ fontSize: 13 }}>{ep.title}</Typography>
                      <Chip label={ep.status} size="small"
                        color={ep.status === 'open' ? 'success' : ep.status === 'closed' ? 'default' : 'warning'}
                        sx={{ fontSize: 9, height: 18, textTransform: 'capitalize' }} />
                      <Chip label={ep.episodeType ?? 'community'} size="small" variant="outlined" sx={{ fontSize: 9, height: 18, textTransform: 'capitalize' }} />
                    </Box>
                    <Typography variant="caption" color="text.secondary" sx={{ mt: 0.25, display: 'block' }}>
                      {ep.startDate ? `Started ${fmtDateShort(ep.startDate)}` : 'Start date not recorded'}
                      {ep.endDate ? ` · Ended ${fmtDateShort(ep.endDate)}` : ''}
                    </Typography>
                  </Box>
                  <Tooltip title="Encounters in this episode">
                    <Chip label={`${epNotes.length} encounter${epNotes.length !== 1 ? 's' : ''}`} size="small"
                      sx={{ fontSize: 10, height: 22, bgcolor: '#E0F2F1', color: '#327C8D' }} />
                  </Tooltip>
                </Box>
              );
            })}
          </Box>
        </Paper>
      )}

      {upcomingAppts.length > 0 && (
        <Paper variant="outlined" sx={{ p: 2.5 }}>
          <Typography variant="subtitle2" fontWeight={700} fontFamily="Albert Sans, sans-serif" sx={{ mb: 2 }}>
            Upcoming Appointments
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {upcomingAppts.slice(0, 5).map((a) => (
              <Box key={a.id} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', p: 1.5, bgcolor: '#FAFAFA', borderRadius: 1, border: '1px solid', borderColor: 'divider' }}>
                <Box>
                  <Typography variant="body2" fontWeight={600} sx={{ fontSize: 12 }}>
                    {noteTypeLabel(a.type)}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {fmtDate(a.startTime)} · {parseDate(a.startTime)?.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: false }) ?? '--:--'}–{parseDate(a.endTime)?.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: false }) ?? '--:--'}
                  </Typography>
                </Box>
                <Chip label={a.status} size="small"
                  color={a.status === 'confirmed' ? 'success' : 'info'}
                  sx={{ fontSize: 10, height: 20, textTransform: 'capitalize' }} />
              </Box>
            ))}
          </Box>
        </Paper>
      )}
    </Box>
  );
}
