import React, { useMemo } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  Grid,
  Paper,
  Typography,
} from '@mui/material';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import PeopleAltIcon from '@mui/icons-material/PeopleAlt';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../../../../shared/services/apiClient';
import {
  patientAppointmentsKeys,
  patientPathwaysKeys,
  patientsKeys,
} from '../../../queryKeys';
import {
  extractErrorMessage,
  readStringArrayField,
  type LinkageTaskRow,
  type SummaryAppointmentRow,
  type SummaryNoteRow,
  type SummaryPathwayRow,
} from './summaryTabDomain';

const LINKAGE_CATEGORIES = [
  { key: 'housing', label: 'Housing & Accommodation', icon: '🏠', color: '#1565C0' },
  { key: 'ndis', label: 'NDIS / Disability Services', icon: '♿', color: '#7B1FA2' },
  { key: 'employment', label: 'Employment / Education / Vocational', icon: '💼', color: '#2E7D32' },
  { key: 'social', label: 'Social & Community Supports', icon: '🤝', color: '#E65100' },
  { key: 'aod', label: 'AOD / Substance Use Services', icon: '⚕️', color: '#C62828' },
  { key: 'financial', label: 'Financial / Centrelink / Legal', icon: '💲', color: '#00695C' },
  { key: 'family', label: 'Family / Carer Support', icon: '👪', color: '#b8621a' },
  { key: 'physical', label: 'Physical Health / GP / Allied Health', icon: '🩺', color: '#327C8D' },
  { key: 'peer', label: 'Peer Support / Recovery Groups', icon: '🌱', color: '#558B2F' },
  { key: 'other', label: 'Other Linkages', icon: '🔗', color: '#616161' },
];

const LINKAGE_KEYWORDS: Record<string, RegExp> = {
  housing: /housing|accommodat|homelesss?|rooming|transitional|residential|shelter|tenancy|rental/i,
  ndis: /ndis|disability|support coordinator|support worker|plan manager|sil|supported independent/i,
  employment: /employ|vocational|job|education|tafe|university|study|training|work.*program|return.*work|ies|disability.*employment/i,
  social: /social|community|recreation|group.*program|day.*program|club|volunteer|befriend|isolation/i,
  aod: /aod|alcohol|drug|substance|rehab|detox|harm.*reduc|naloxone|methadone|suboxone/i,
  financial: /financial|centrelink|pension|income|debt|legal|guardianship|power.*attorney|tribunal/i,
  family: /family|carer|parent|child|partner|relative|kinship|family.*therapy|carer.*support/i,
  physical: /gp |general.*practit|physio|dietit|podiat|dental|optom|physical.*health|allied.*health|specialist.*referral/i,
  peer: /peer.*support|peer.*worker|recovery.*college|recovery.*group|mutual.*aid|hearing.*voices/i,
};

function classifyLinkage(text: string): string {
  const lower = text.toLowerCase();
  for (const [key, regex] of Object.entries(LINKAGE_KEYWORDS)) {
    if (regex.test(lower)) return key;
  }
  return 'other';
}

interface LinkageItem {
  id: string;
  category: string;
  title: string;
  source: string;
  status: 'planned' | 'in_progress' | 'completed' | 'overdue';
  date: string;
  detail?: string;
  assignee?: string;
}

interface LinkagesPanelProps { patientId: string }
export function LinkagesPanel({ patientId }: LinkagesPanelProps): React.ReactElement {
  const [aiSummary, setAiSummary] = React.useState<string | null>(null);
  const [aiLoading, setAiLoading] = React.useState(false);
  const [aiError, setAiError] = React.useState('');

  const { data: tasks = [] } = useQuery({
    queryKey: patientsKeys.tasksLinkages(patientId),
    queryFn: () => apiClient.get<unknown>('tasks', { patientId }).then(r => readStringArrayField<LinkageTaskRow>(r, 'data')).catch((err) => { console.warn('LinkagesPanel: query failed', err); return []; }),
    enabled: !!patientId,
  });
  const { data: notes = [] } = useQuery({
    queryKey: patientsKeys.notesLinkages(patientId),
    queryFn: () => apiClient.get<unknown>(`patients/${patientId}/notes`).then(r => readStringArrayField<SummaryNoteRow>(r, 'notes')).catch((err) => { console.warn('LinkagesPanel: query failed', err); return []; }),
    enabled: !!patientId,
  });
  const { data: appointments = [] } = useQuery({
    queryKey: patientAppointmentsKeys.linkages(patientId),
    queryFn: () => apiClient.get<unknown>('appointments', { patientId }).then(r => readStringArrayField<SummaryAppointmentRow>(r, 'data')).catch((err) => { console.warn('LinkagesPanel: query failed', err); return []; }),
    enabled: !!patientId,
  });
  const { data: pathways = [] } = useQuery({
    queryKey: patientPathwaysKeys.linkages(patientId),
    queryFn: () => apiClient.get<unknown>(`pathways/patient/${patientId}`).then(r => readStringArrayField<SummaryPathwayRow>(r, 'data')).catch((err) => { console.warn('LinkagesPanel: query failed', err); return []; }),
    enabled: !!patientId,
  });

  const linkageItems = useMemo(() => {
    const items: LinkageItem[] = [];
    const now = new Date();

    for (const t of tasks) {
      const text = `${t.title ?? ''} ${t.description ?? ''} ${t.notes ?? ''}`;
      let matched = false;
      for (const regex of Object.values(LINKAGE_KEYWORDS)) {
        if (regex.test(text)) { matched = true; break; }
      }
      if (!matched) continue;
      const dueDate = t.dueAt ?? t.dueDate ?? t.due_at ?? t.due_date;
      const isOverdue = dueDate && new Date(dueDate) < now && t.status !== 'completed' && t.status !== 'cancelled';
      items.push({
        id: t.id,
        category: classifyLinkage(text),
        title: t.title ?? 'Task',
        source: 'task',
        status: t.status === 'completed' ? 'completed' : isOverdue ? 'overdue' : t.status === 'in_progress' ? 'in_progress' : 'planned',
        date: dueDate ?? t.createdAt ?? '',
        detail: t.description ?? undefined,
        assignee: t.assigneeName ?? t.assignee_name ?? undefined,
      });
    }

    const reviewNotes = notes.filter(n =>
      n.noteType === 'review' || n.noteType === '91_day_review' ||
      (n.contactMeta?.planType === '91_day_review') ||
      (n.title ?? '').toLowerCase().includes('91') ||
      (n.title ?? '').toLowerCase().includes('review'),
    );
    for (const rn of reviewNotes) {
      const content = rn.content ?? '';
      const lines = content.split('\n').filter((l: string) => /^\s*[-•*\d]+[.)]\s/.test(l));
      for (const line of lines) {
        const cleanLine = line.replace(/^\s*[-•*\d]+[.)]\s*/, '').trim();
        if (!cleanLine || cleanLine.length < 5) continue;
        let matched = false;
        for (const regex of Object.values(LINKAGE_KEYWORDS)) {
          if (regex.test(cleanLine)) { matched = true; break; }
        }
        if (!matched) continue;
        items.push({
          id: `review-${rn.id}-${cleanLine.slice(0, 20)}`,
          category: classifyLinkage(cleanLine),
          title: cleanLine.length > 100 ? cleanLine.slice(0, 100) + '...' : cleanLine,
          source: '91-day review',
          status: 'planned',
          date: rn.createdAt ?? '',
          detail: `From: ${rn.title ?? 'Review Note'}`,
        });
      }
    }

    for (const a of appointments) {
      const text = `${a.title ?? ''} ${a.appointmentType ?? a.appointment_type ?? ''} ${a.notes ?? ''}`;
      let matched = false;
      for (const regex of Object.values(LINKAGE_KEYWORDS)) {
        if (regex.test(text)) { matched = true; break; }
      }
      if (!matched) continue;
      const startTime = a.appointmentStart ?? a.appointment_start ?? a.startTime ?? a.start_time;
      const isPast = startTime && new Date(startTime) < now;
      items.push({
        id: a.id,
        category: classifyLinkage(text),
        title: a.title ?? a.appointmentType ?? a.appointment_type ?? 'Appointment',
        source: 'appointment',
        status: a.status === 'completed' || isPast ? 'completed' : 'planned',
        date: startTime ?? '',
        detail: a.notes ?? undefined,
      });
    }

    for (const p of pathways) {
      const text = `${p.pathwayName ?? ''} ${p.notes ?? ''}`;
      let matched = false;
      for (const regex of Object.values(LINKAGE_KEYWORDS)) {
        if (regex.test(text)) { matched = true; break; }
      }
      if (!matched) continue;
      items.push({
        id: p.id,
        category: classifyLinkage(text),
        title: p.pathwayName ?? p.pathwayType ?? 'Pathway',
        source: 'pathway',
        status: p.status === 'completed' ? 'completed' : p.status === 'active' ? 'in_progress' : 'planned',
        date: p.startDate ?? p.createdAt ?? '',
        detail: p.notes ?? undefined,
      });
    }

    const seen = new Set<string>();
    return items.filter(i => {
      const key = `${i.category}-${i.title.toLowerCase().slice(0, 40)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).sort((a, b) => {
      const statusOrder = { overdue: 0, in_progress: 1, planned: 2, completed: 3 };
      return (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9);
    });
  }, [tasks, notes, appointments, pathways]);

  const grouped = useMemo(() => {
    const map = new Map<string, LinkageItem[]>();
    for (const item of linkageItems) {
      const arr = map.get(item.category) ?? [];
      arr.push(item);
      map.set(item.category, arr);
    }
    return map;
  }, [linkageItems]);

  const totalItems = linkageItems.length;
  const completedCount = linkageItems.filter(i => i.status === 'completed').length;
  const overdueCount = linkageItems.filter(i => i.status === 'overdue').length;
  const inProgressCount = linkageItems.filter(i => i.status === 'in_progress').length;
  const categoriesActive = grouped.size;

  const generateAiSummary = async () => {
    setAiLoading(true); setAiError('');
    try {
      const context = linkageItems.map(i =>
        `[${i.category}] ${i.title} — status: ${i.status}, source: ${i.source}, date: ${i.date}`,
      ).join('\n');

      const resp = await apiClient.instance.post<{ result: string }>('llm/clinical-ai', {
        action: 'linkages',
        patientId,
        data: {
          linkageItems: context,
          totalItems,
          completedCount,
          overdueCount,
          categoriesActive,
        },
        enhance: true,
      }, { timeout: 120_000 });
      setAiSummary(resp.data.result);
    } catch (err: unknown) {
      setAiError(extractErrorMessage(err, 'Failed to generate linkage summary'));
    } finally {
      setAiLoading(false);
    }
  };

  const statusColor = (s: string) =>
    s === 'completed' ? '#2E7D32' : s === 'overdue' ? '#C62828' : s === 'in_progress' ? '#1565C0' : '#b8621a';

  const statusLabel = (s: string) =>
    s === 'completed' ? 'Completed' : s === 'overdue' ? 'Overdue' : s === 'in_progress' ? 'In Progress' : 'Planned';

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Box>
          <Typography variant="h6" fontWeight={700} fontFamily="Albert Sans, sans-serif" sx={{ color: '#3D484B' }}>
            Community Linkages & Supports
          </Typography>
          <Typography variant="body2" color="text.secondary" fontFamily="Albert Sans, sans-serif">
            Planned linkages, referrals, and support coordination — extracted from 91-day reviews, tasks, appointments, and pathways
          </Typography>
        </Box>
        <Button size="small" variant="contained" startIcon={<AutoAwesomeIcon />}
          onClick={generateAiSummary} disabled={aiLoading}
          sx={{ bgcolor: '#7B1FA2', '&:hover': { bgcolor: '#6A1B9A' }, textTransform: 'none', fontSize: 12 }}>
          {aiLoading ? 'Generating...' : aiSummary ? 'Refresh AI Summary' : 'Generate AI Summary'}
        </Button>
      </Box>

      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid size={{ xs: 6, sm: 3 }}>
          <Paper variant="outlined" sx={{ p: 1.5, textAlign: 'center', borderLeft: '4px solid #b8621a' }}>
            <Typography variant="caption" color="text.secondary">Total Linkages</Typography>
            <Typography variant="h5" fontWeight={700} color="#b8621a">{totalItems}</Typography>
          </Paper>
        </Grid>
        <Grid size={{ xs: 6, sm: 3 }}>
          <Paper variant="outlined" sx={{ p: 1.5, textAlign: 'center', borderLeft: '4px solid #1565C0' }}>
            <Typography variant="caption" color="text.secondary">In Progress</Typography>
            <Typography variant="h5" fontWeight={700} color="#1565C0">{inProgressCount}</Typography>
          </Paper>
        </Grid>
        <Grid size={{ xs: 6, sm: 3 }}>
          <Paper variant="outlined" sx={{ p: 1.5, textAlign: 'center', borderLeft: '4px solid #2E7D32' }}>
            <Typography variant="caption" color="text.secondary">Completed</Typography>
            <Typography variant="h5" fontWeight={700} color="#2E7D32">{completedCount}</Typography>
          </Paper>
        </Grid>
        <Grid size={{ xs: 6, sm: 3 }}>
          <Paper variant="outlined" sx={{ p: 1.5, textAlign: 'center', borderLeft: '4px solid #C62828' }}>
            <Typography variant="caption" color="text.secondary">Overdue</Typography>
            <Typography variant="h5" fontWeight={700} color="#C62828">{overdueCount}</Typography>
          </Paper>
        </Grid>
      </Grid>

      {aiError && <Alert severity="error" sx={{ mb: 2 }}>{aiError}</Alert>}
      {aiSummary && (
        <Paper variant="outlined" sx={{ p: 2, mb: 3, bgcolor: '#F3E5F5', borderColor: '#CE93D8' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 1 }}>
            <AutoAwesomeIcon sx={{ fontSize: 16, color: '#7B1FA2' }} />
            <Typography variant="caption" fontWeight={700} color="#7B1FA2" sx={{ textTransform: 'uppercase', fontSize: 9, letterSpacing: '0.08em' }}>
              AI Linkage Progress Summary
            </Typography>
          </Box>
          <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', fontSize: 12, lineHeight: 1.6 }}>{aiSummary}</Typography>
        </Paper>
      )}

      {totalItems === 0 && (
        <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }}>
          <PeopleAltIcon sx={{ fontSize: 48, color: '#ccc', mb: 1 }} />
          <Typography color="text.secondary" fontFamily="Albert Sans, sans-serif">
            No community linkages identified yet. Linkages are automatically extracted from 91-day review plans, tasks, appointments, and treatment pathways that mention housing, NDIS, employment, social supports, and other services.
          </Typography>
        </Paper>
      )}

      {LINKAGE_CATEGORIES.filter(cat => grouped.has(cat.key)).map(cat => {
        const items = grouped.get(cat.key)!;
        const catCompleted = items.filter(i => i.status === 'completed').length;
        return (
          <Paper key={cat.key} variant="outlined" sx={{ mb: 2, borderLeft: `4px solid ${cat.color}` }}>
            <Box sx={{ p: 1.5, display: 'flex', justifyContent: 'space-between', alignItems: 'center', bgcolor: `${cat.color}08` }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography sx={{ fontSize: 18 }}>{cat.icon}</Typography>
                <Typography variant="subtitle2" fontWeight={700} fontFamily="Albert Sans, sans-serif">{cat.label}</Typography>
                <Chip label={`${items.length}`} size="small" sx={{ fontSize: 10, height: 20, bgcolor: `${cat.color}20`, color: cat.color, fontWeight: 700 }} />
              </Box>
              <Typography variant="caption" color="text.secondary">
                {catCompleted}/{items.length} completed
              </Typography>
            </Box>
            <Divider />
            <Box sx={{ p: 1 }}>
              {items.map(item => (
                <Box key={item.id} sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5, py: 0.8, borderBottom: '1px solid #F5F5F5', '&:last-child': { borderBottom: 'none' } }}>
                  <Chip label={statusLabel(item.status)} size="small"
                    sx={{ fontSize: 9, height: 20, minWidth: 70, bgcolor: `${statusColor(item.status)}15`, color: statusColor(item.status), fontWeight: 700 }} />
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="body2" fontWeight={600} sx={{ fontSize: 12 }}>{item.title}</Typography>
                    <Box sx={{ display: 'flex', gap: 1.5, mt: 0.3 }}>
                      <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>
                        Source: {item.source}
                      </Typography>
                      {item.date && (
                        <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>
                          {new Date(item.date).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </Typography>
                      )}
                      {item.assignee && (
                        <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>
                          Assigned: {item.assignee}
                        </Typography>
                      )}
                    </Box>
                    {item.detail && (
                      <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10, mt: 0.3, display: 'block' }}>
                        {item.detail.length > 120 ? item.detail.slice(0, 120) + '...' : item.detail}
                      </Typography>
                    )}
                  </Box>
                </Box>
              ))}
            </Box>
          </Paper>
        );
      })}
    </Box>
  );
}

