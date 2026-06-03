import { useState, useEffect, useMemo } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogTitle, Divider, FormControl, FormControlLabel, Grid, InputLabel, MenuItem,
  Paper, Select, Switch, TextField, Tooltip, Typography,
} from '@mui/material';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import AssignmentTurnedInIcon from '@mui/icons-material/AssignmentTurnedIn';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../../shared/services/apiClient';
import { useOrgTree, usePrograms } from '../../../org-settings/hooks/useOrgSettings';
import type { OrgUnit } from '../../../org-settings/services/orgSettingsApi';
import {
  patientsKeys,
  episodesKeys,
  patientReferralsKeys,
  patientTemplatesKeys,
} from '../../queryKeys';

// ── Contact types ────────────────────────────────────────────────────────────

export const CONTACT_TYPES = [
  'Face-to-Face', 'Face-to-Face (Group)', 'Home Visit', 'Phone Call',
  'Video Call', 'Collateral Contact', 'Case Conference', 'Email', 'SMS', 'Letter', 'Other',
];

// ── Note type → contact defaults ─────────────────────────────────────────────

export interface ActivityContactConfig {
  templateName: string;
  contactType: string;
  isReportable: boolean;
  location: string;
  contactMedium: string;
  durationMin: number;
  serviceRecipients: string;
}

// PR6M codes: location = Service Location, contactMedium = Service Medium, serviceRecipients = Service Recipient
export const NOTE_TYPE_CONTACT_CONFIG: Record<string, ActivityContactConfig> = {
  progress:              { templateName: 'Community Mental Health Contact (ABF)', contactType: 'Face-to-Face',         isReportable: true,  location: '1 — Centre based',                           contactMedium: '1 — Direct',                          durationMin: 45, serviceRecipients: '1 — Client only' },
  ward_round:            { templateName: 'Inpatient Contact (ABF)',               contactType: 'Face-to-Face',         isReportable: true,  location: '3 — Mental health inpatient service',         contactMedium: '1 — Direct',                          durationMin: 15, serviceRecipients: '1 — Client only' },
  intake:                { templateName: 'Community Mental Health Contact (ABF)', contactType: 'Face-to-Face',         isReportable: true,  location: '1 — Centre based',                           contactMedium: '1 — Direct',                          durationMin: 60, serviceRecipients: '1 — Client only' },
  review:                { templateName: 'Community Mental Health Contact (ABF)', contactType: 'Face-to-Face',         isReportable: true,  location: '1 — Centre based',                           contactMedium: '1 — Direct',                          durationMin: 30, serviceRecipients: '1 — Client only' },
  assessment:            { templateName: 'Community Mental Health Contact (ABF)', contactType: 'Face-to-Face',         isReportable: true,  location: '1 — Centre based',                           contactMedium: '1 — Direct',                          durationMin: 60, serviceRecipients: '1 — Client only' },
  lai:                   { templateName: 'LAI Administration Contact (ABF)',       contactType: 'Face-to-Face',         isReportable: true,  location: '1 — Centre based',                           contactMedium: '1 — Direct',                          durationMin: 20, serviceRecipients: '1 — Client only' },
  clozapine:             { templateName: 'Clozapine Monitoring Contact (ABF)',     contactType: 'Face-to-Face',         isReportable: true,  location: '1 — Centre based',                           contactMedium: '1 — Direct',                          durationMin: 20, serviceRecipients: '1 — Client only' },
  home_visit:            { templateName: 'Home Visit Contact (ABF)',               contactType: 'Home Visit',           isReportable: true,  location: '4 — Client\'s own environment',               contactMedium: '1 — Direct',                          durationMin: 45, serviceRecipients: '1 — Client only' },
  group_therapy:         { templateName: 'Group Session Contact (ABF)',            contactType: 'Face-to-Face (Group)', isReportable: true,  location: '1 — Centre based',                           contactMedium: '1 — Direct',                          durationMin: 60, serviceRecipients: '2 — Client group' },
  crisis:                { templateName: 'ACIS/Crisis Contact (ABF)',              contactType: 'Face-to-Face',         isReportable: true,  location: '7 — Emergency department',                   contactMedium: '1 — Direct',                          durationMin: 60, serviceRecipients: '1 — Client only' },
  mdt:                   { templateName: 'Case Conference/MDT Contact (ABF)',      contactType: 'Case Conference',      isReportable: true,  location: '1 — Centre based',                           contactMedium: '3 — Teleconferencing/videoconference', durationMin: 60, serviceRecipients: '3 — Client & Family' },
  case_conference:       { templateName: 'Case Conference/MDT Contact (ABF)',      contactType: 'Case Conference',      isReportable: true,  location: '1 — Centre based',                           contactMedium: '3 — Teleconferencing/videoconference', durationMin: 60, serviceRecipients: '3 — Client & Family' },
  telehealth:            { templateName: 'Phone/Telehealth Contact (ABF)',         contactType: 'Video Call',           isReportable: true,  location: '1 — Centre based',                           contactMedium: '3 — Teleconferencing/videoconference', durationMin: 30, serviceRecipients: '1 — Client only' },
  phone:                 { templateName: 'Phone/Telehealth Contact (ABF)',         contactType: 'Phone Call',           isReportable: true,  location: '1 — Centre based',                           contactMedium: '2 — Telephone',                       durationMin: 15, serviceRecipients: '1 — Client only' },
  collateral:            { templateName: 'Collateral Contact (ABF)',               contactType: 'Collateral Contact',   isReportable: false, location: '1 — Centre based',                           contactMedium: '2 — Telephone',                       durationMin: 15, serviceRecipients: '6 — Family Only' },
  letter:                { templateName: 'Collateral Contact (ABF)',               contactType: 'Letter',               isReportable: false, location: '1 — Centre based',                           contactMedium: '6 — Other asynchronous',               durationMin: 15, serviceRecipients: '1 — Client only' },
  report:                { templateName: 'Community Mental Health Contact (ABF)',  contactType: 'Face-to-Face',         isReportable: false, location: '1 — Centre based',                           contactMedium: '1 — Direct',                          durationMin: 30, serviceRecipients: '1 — Client only' },
  message:               { templateName: 'Collateral Contact (ABF)',               contactType: 'SMS',                  isReportable: false, location: '1 — Centre based',                           contactMedium: '6 — Other asynchronous',               durationMin: 5,  serviceRecipients: '1 — Client only' },
  certificate:           { templateName: 'Community Mental Health Contact (ABF)',  contactType: 'Face-to-Face',         isReportable: false, location: '1 — Centre based',                           contactMedium: '1 — Direct',                          durationMin: 15, serviceRecipients: '1 — Client only' },
  physical_health:       { templateName: 'Community Mental Health Contact (ABF)',  contactType: 'Face-to-Face',         isReportable: true,  location: '1 — Centre based',                           contactMedium: '1 — Direct',                          durationMin: 30, serviceRecipients: '1 — Client only' },
  consumer_peer_support: { templateName: 'Community Mental Health Contact (ABF)',  contactType: 'Face-to-Face',         isReportable: true,  location: '1 — Centre based',                           contactMedium: '1 — Direct',                          durationMin: 30, serviceRecipients: '1 — Client only' },
  carer_peer_support:    { templateName: 'Community Mental Health Contact (ABF)',  contactType: 'Face-to-Face',         isReportable: false, location: '1 — Centre based',                           contactMedium: '1 — Direct',                          durationMin: 30, serviceRecipients: '115 — Carer' },
};

// ── Duration quick options ────────────────────────────────────────────────────

const DURATION_PRESETS = [5, 10, 15, 20, 30, 45, 60, 75];

// ── Template content renderer ─────────────────────────────────────────────────

interface TemplateField {
  type?: string;
  text?: string;
  label?: string;
  options?: string[];
  min?: number;
  max?: number;
}

function templateToText(content: TemplateField[]): string {
  return (content ?? []).map((f) => {
    if (f.type === 'heading')        return `\n=== ${f.text || f.label} ===\n`;
    if (f.type === 'instruction')    return `[${f.text}]\n`;
    if (f.type === 'text_block')     return (f.text ?? '') + '\n';
    if (f.type === 'short_answer')   return `${f.label}:\n\n`;
    if (f.type === 'yes_no')         return `${f.label}: [ ] Yes  [ ] No\n`;
    if (f.type === 'multiple_choice') return `${f.label}:\n${(f.options ?? []).map((o: string) => `  [ ] ${o}`).join('\n')}\n`;
    if (f.type === 'likert')         return `${f.label}: [${f.min ?? 0}–${f.max ?? 10}]\n`;
    return '';
  }).join('');
}

function flattenUnits(nodes: OrgUnit[]): { id: string; name: string }[] {
  const r: { id: string; name: string }[] = [];
  function w(l: OrgUnit[], d: number) { for (const n of l) { r.push({ id: n.id, name: '\u00A0'.repeat(d * 2) + n.name }); if (n.children?.length) w(n.children, d + 1); } }
  w(nodes, 0); return r;
}

function nowRounded(): { date: string; time: string } {
  const d = new Date();
  d.setMinutes(Math.round(d.getMinutes() / 15) * 15, 0, 0);
  return {
    date: d.toISOString().split('T')[0],
    time: d.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: false }),
  };
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

interface ContactTemplate { id: string; name: string; categoryName?: string; content: TemplateField[] }

interface EpisodeOption {
  id: string;
  status: string;
  title: string;
  episodeType: string;
}

function toContactErrorMessage(error: unknown): string {
  if (typeof error !== 'object' || error === null) return 'Failed to save contact';
  const maybeError = error as {
    response?: { data?: { error?: unknown } };
    message?: unknown;
  };
  if (typeof maybeError.response?.data?.error === 'string' && maybeError.response.data.error.trim()) {
    return maybeError.response.data.error;
  }
  if (typeof maybeError.message === 'string' && maybeError.message.trim()) {
    return maybeError.message;
  }
  return 'Failed to save contact';
}

function useContactFormTemplates() {
  return useQuery<ContactTemplate[]>({
    queryKey: patientTemplatesKeys.byType('contact-forms'),
    queryFn: () => apiClient.get<{ templates: ContactTemplate[] }>('staff-settings/templates')
      .then(r => r.templates.filter(t => t.categoryName === 'Contact Forms')),
    staleTime: 5 * 60 * 1000,
  });
}

interface ContactOptions {
  locations: string[];
  programs: string[];
  serviceRecipientTypes: string[];
  contactMediaTypes: string[];
}

function useContactOptions() {
  return useQuery<ContactOptions>({
    queryKey: patientsKeys.staffSettingsContactOptions(),
    queryFn: () => apiClient.get<ContactOptions>('staff-settings/contact-options'),
    staleTime: 10 * 60 * 1000,
  });
}

// ── Props ─────────────────────────────────────────────────────────────────────

export interface ContactFormDialogProps {
  open: boolean;
  patientId: string;
  onClose: () => void;
  onSaved: () => void;
  initialNoteType?: string;
  initialNoteTitle?: string;
  initialEpisodeId?: string;
  initialIsReportable?: boolean;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ContactFormDialog({
  open, patientId, onClose, onSaved,
  initialNoteType, initialNoteTitle, initialEpisodeId,
  initialIsReportable,
}: ContactFormDialogProps) {
  const qc = useQueryClient();
  const { data: templates } = useContactFormTemplates();
  const { data: opts } = useContactOptions();
  const { data: orgPrograms } = usePrograms();
  const { data: tree } = useOrgTree();
  const flatUnits = useMemo(() => tree ? flattenUnits(tree) : [], [tree]);

  const { data: episodes } = useQuery({
    queryKey: episodesKeys.active(patientId),
    queryFn: () => apiClient.get<{ data: EpisodeOption[] }>(`episodes/patient/${patientId}`)
      .then(r => (r.data ?? []).filter((e) => e.status === 'open')),
    enabled: !!patientId,
  });

  const config = initialNoteType ? NOTE_TYPE_CONTACT_CONFIG[initialNoteType] : undefined;

  // ── Form state ───────────────────────────────────────────────────────────────

  const [isReportable,      setIsReportable]      = useState<boolean>(initialIsReportable ?? config?.isReportable ?? true);
  const [contactDate,       setContactDate]        = useState(nowRounded().date);
  const [contactTime,       setContactTime]        = useState(nowRounded().time);
  const [durationMin,       setDurationMin]        = useState<number>(config?.durationMin ?? 30);
  const [customDuration,    setCustomDuration]     = useState('');
  const [team,              setTeam]               = useState('');
  const [numProviding,      setNumProviding]       = useState(1);
  const [numReceiving,      setNumReceiving]       = useState(1);
  const [location,          setLocation]           = useState(config?.location ?? 'Clinic / Outpatient');
  const [contactMedium,     setContactMedium]      = useState(config?.contactMedium ?? 'Face-to-Face');
  const [program,           setProgram]            = useState('');
  const [serviceRecipients, setServiceRecipients]  = useState(config?.serviceRecipients ?? 'Consumer Only');
  const [episodeId,         setEpisodeId]          = useState(initialEpisodeId ?? '');
  const [templateId,        setTemplateId]         = useState('');
  const [content,           setContent]            = useState('');
  const [saving,            setSaving]             = useState('');
  const [error,             setError]              = useState('');

  const effectiveDuration = customDuration ? parseInt(customDuration, 10) || durationMin : durationMin;

  // Reset + pre-populate when dialog opens
  useEffect(() => {
    if (!open) return;
    setError(''); setSaving('');
    const { date, time } = nowRounded();
    setContactDate(date); setContactTime(time);
    setIsReportable(initialIsReportable ?? config?.isReportable ?? true);
    setDurationMin(config?.durationMin ?? 30); setCustomDuration('');
    const locs = opts?.locations ?? [];
    const defLoc = config?.location ?? '1 — Centre based';
    setLocation(locs.includes(defLoc) ? defLoc : (locs[0] ?? defLoc));

    const media = opts?.contactMediaTypes ?? [];
    const defMed = config?.contactMedium ?? '1 — Direct';
    setContactMedium(media.includes(defMed) ? defMed : (media[0] ?? defMed));

    const recips = opts?.serviceRecipientTypes ?? [];
    const defRec = config?.serviceRecipients ?? '1 — Client only';
    setServiceRecipients(recips.includes(defRec) ? defRec : (recips[0] ?? defRec));
    if (initialEpisodeId) setEpisodeId(initialEpisodeId);
    else if (episodes?.length && !episodeId) setEpisodeId(episodes[0].id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, opts]);

  // Auto-select episode when loaded
  useEffect(() => {
    if (episodes?.length && !episodeId && !initialEpisodeId) setEpisodeId(episodes[0].id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [episodes]);

  // Auto-select template
  useEffect(() => {
    if (!templates || !open) return;
    const targetName = config?.templateName;
    if (!targetName) return;
    const match = templates.find(t => t.name === targetName);
    if (match && templateId !== match.id) {
      setTemplateId(match.id);
      setContent(templateToText(match.content));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templates, open, initialNoteType]);

  // Pre-populate program from episode type
  useEffect(() => {
    if (!episodeId || !episodes) return;
    if (!orgPrograms || orgPrograms.length === 0) return;
    const ep = episodes.find((e) => e.id === episodeId);
    if (!ep) return;
    const typeMap: Record<string, string> = {
      inpatient: 'Adult Inpatient', community: 'Adult Community Mental Health',
      crisis: 'ACIS / Crisis Response', rehabilitation: 'Adult Residential Rehabilitation',
      forensic: 'Forensic Mental Health',
    };
    const mapped = typeMap[ep.episodeType?.toLowerCase()] ?? '';
    if (!mapped) return;
    const matched = orgPrograms.find((programOption) => programOption.name.toLowerCase() === mapped.toLowerCase());
    if (matched) setProgram(matched.name);
  }, [episodeId, episodes, orgPrograms]);

  const handleTemplateChange = (id: string) => {
    setTemplateId(id);
    if (!id) { setContent(''); return; }
    const tmpl = (templates ?? []).find(t => t.id === id);
    if (tmpl) {
      setContent(templateToText(tmpl.content));
      if (tmpl.name.toLowerCase().includes('collateral')) {
        setIsReportable(false);
        setServiceRecipients('Carer / Family Only');
      }
    }
  };

  const handleSave = async (status: 'draft' | 'signed') => {
    setSaving(status); setError('');
    try {
      await apiClient.post('contact-records', {
        patientId,
        episodeId: episodeId || undefined,
        contactType: contactMedium || 'face_to_face',
        content: content.trim(),
        status,
        isReportable: isReportable,
        contactDate,
        contactTime,
        durationMinutes: effectiveDuration,
        team,
        numProvidingService: numProviding,
        numReceivingService: numReceiving,
        location,
        contactMedium,
        program,
        serviceRecipients,
      });
      qc.invalidateQueries({ queryKey: patientsKeys.notes(patientId) });
      qc.invalidateQueries({ queryKey: patientReferralsKeys.unifiedContacts(patientId) });
      qc.invalidateQueries({ queryKey: episodesKeys.contacts(patientId) });
      onSaved();
    } catch (e: unknown) {
      setError(toContactErrorMessage(e));
    } finally {
      setSaving('');
    }
  };

  return (
    <Dialog aria-labelledby="dialog-title" open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle id="dialog-title" sx={{ fontFamily: 'Albert Sans, sans-serif', fontWeight: 700, pb: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <AssignmentTurnedInIcon sx={{ color: '#327C8D' }} />
          Log Contact / Encounter
          {initialNoteType && (
            <Chip label={initialNoteType.replace(/_/g, ' ').toUpperCase()} size="small"
              sx={{ ml: 1, bgcolor: '#EEF7FA', color: '#327C8D', fontWeight: 600, fontSize: 11 }} />
          )}
        </Box>
      </DialogTitle>

      {/* ── Reportable toggle banner ── */}
      <Box sx={{
        px: 3, py: 1.25, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        bgcolor: isReportable ? '#E8F5E9' : '#FFF8E1',
        borderTop: '1px solid', borderBottom: '1px solid',
        borderColor: isReportable ? '#C8E6C9' : '#FFE082',
      }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography variant="body2" fontWeight={700} color={isReportable ? '#2E7D32' : '#E65100'}>
            {isReportable ? 'Reportable Contact (ABF)' : 'Non-Reportable Contact'}
          </Typography>
          <Tooltip title={isReportable
            ? 'Counted for Activity Based Funding (ABF) — patient present, clinically meaningful.'
            : 'NOT counted for ABF — collateral, admin letter, or non-clinical contact.'}>
            <InfoOutlinedIcon sx={{ fontSize: 16, color: 'text.secondary', cursor: 'help' }} />
          </Tooltip>
        </Box>
        <FormControlLabel
          control={
            <Switch checked={isReportable} onChange={(_, v) => setIsReportable(v)} size="small"
              sx={{ '& .MuiSwitch-switchBase.Mui-checked': { color: '#2E7D32' }, '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': { bgcolor: '#2E7D32' } }} />
          }
          label={<Typography variant="caption" color="text.secondary">Override</Typography>}
          labelPlacement="start"
        />
      </Box>

      <DialogContent sx={{ pt: 2 }}>
        <Grid container spacing={2}>

          {/* ── Row 1: Date / Time / Duration ── */}
          <Grid size={{ xs: 12, sm: 3 }}>
            <TextField label="Contact Date" type="date" fullWidth size="small"
              value={contactDate} onChange={e => setContactDate(e.target.value)}
              slotProps={{ inputLabel: { shrink: true } }} />
          </Grid>
          <Grid size={{ xs: 12, sm: 3 }}>
            <TextField label="Contact Time" type="time" fullWidth size="small"
              value={contactTime} onChange={e => setContactTime(e.target.value)}
              slotProps={{ inputLabel: { shrink: true } }} />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
              Duration — <strong>{effectiveDuration} min</strong>
            </Typography>
            <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', alignItems: 'center' }}>
              {DURATION_PRESETS.map(d => (
                <Chip key={d} label={`${d}m`} size="small"
                  variant={durationMin === d && !customDuration ? 'filled' : 'outlined'}
                  onClick={() => { setDurationMin(d); setCustomDuration(''); }}
                  sx={{ cursor: 'pointer', fontSize: 11,
                    ...(durationMin === d && !customDuration ? { bgcolor: '#327C8D', color: '#fff' } : {}) }} />
              ))}
              <TextField size="small" placeholder="Custom" value={customDuration}
                onChange={e => setCustomDuration(e.target.value)}
                sx={{ width: 72, '& .MuiInputBase-input': { py: 0.4, px: 1, fontSize: 12 } }}
                slotProps={{ input: { endAdornment: <Typography variant="caption" sx={{ mr: 0.5 }}>m</Typography> } }} />
            </Box>
          </Grid>

          {/* ── Row 2: Team / Providing / Receiving ── */}
          <Grid size={{ xs: 12, sm: 5 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Team / Unit</InputLabel>
              <Select value={team} onChange={e => setTeam(e.target.value)} label="Team / Unit">
                <MenuItem value="">— Not specified —</MenuItem>
                {flatUnits.map(u => <MenuItem key={u.id} value={u.name}>{u.name}</MenuItem>)}
              </Select>
            </FormControl>
          </Grid>
          <Grid size={{ xs: 6, sm: 3.5 }}>
            <TextField label="No. Providing Service" type="number" fullWidth size="small"
              value={numProviding} onChange={e => setNumProviding(Math.max(1, parseInt(e.target.value, 10) || 1))}
              slotProps={{ htmlInput: { min: 1, max: 99 } }} />
          </Grid>
          <Grid size={{ xs: 6, sm: 3.5 }}>
            <TextField label="No. Receiving Service" type="number" fullWidth size="small"
              value={numReceiving} onChange={e => setNumReceiving(Math.max(1, parseInt(e.target.value, 10) || 1))}
              slotProps={{ htmlInput: { min: 1, max: 999 } }} />
          </Grid>

          {/* ── Row 3: Configurable dropdowns ── */}
          <Grid size={{ xs: 12, sm: 6 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Location</InputLabel>
              <Select value={location} onChange={e => setLocation(e.target.value)} label="Location">
                {(opts?.locations ?? []).map(l => <MenuItem key={l} value={l}>{l}</MenuItem>)}
              </Select>
            </FormControl>
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Contact Medium</InputLabel>
              <Select value={contactMedium} onChange={e => setContactMedium(e.target.value)} label="Contact Medium">
                {(opts?.contactMediaTypes ?? []).map(m => <MenuItem key={m} value={m}>{m}</MenuItem>)}
              </Select>
            </FormControl>
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Program</InputLabel>
              <Select value={program} onChange={e => setProgram(e.target.value)} label="Program">
                <MenuItem value="">— Not specified —</MenuItem>
                {(orgPrograms ?? []).map(p => <MenuItem key={p.id} value={p.name}>{p.name}</MenuItem>)}
              </Select>
            </FormControl>
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Service Recipients</InputLabel>
              <Select value={serviceRecipients} onChange={e => setServiceRecipients(e.target.value)} label="Service Recipients">
                {(opts?.serviceRecipientTypes ?? []).map(s => <MenuItem key={s} value={s}>{s}</MenuItem>)}
              </Select>
            </FormControl>
          </Grid>

          <Grid size={{ xs: 12 }}><Divider /></Grid>

          {/* ── Episode + Template ── */}
          <Grid size={{ xs: 12, sm: 6 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Episode</InputLabel>
              <Select value={episodeId} onChange={e => setEpisodeId(e.target.value)} label="Episode">
                <MenuItem value="">— None —</MenuItem>
                {(episodes ?? []).map((ep) => (
                  <MenuItem key={ep.id} value={ep.id}>{ep.title} ({ep.episodeType})</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Contact Form Template</InputLabel>
              <Select value={templateId} onChange={e => handleTemplateChange(e.target.value)} label="Contact Form Template">
                <MenuItem value="">— Blank —</MenuItem>
                {(templates ?? []).map(t => (
                  <MenuItem key={t.id} value={t.id}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      {t.name}
                      {config?.templateName === t.name && (
                        <Chip label="recommended" size="small" sx={{ fontSize: 9, height: 16, bgcolor: '#EEF7FA', color: '#327C8D' }} />
                      )}
                    </Box>
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>

          {initialNoteTitle && (
            <Grid size={{ xs: 12 }}>
              <Paper variant="outlined" sx={{ p: 1, bgcolor: '#F5F5F5', display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography variant="caption" color="text.secondary">Linked encounter:</Typography>
                <Typography variant="caption" fontWeight={600}>{initialNoteTitle}</Typography>
              </Paper>
            </Grid>
          )}

          {(templates ?? []).length === 0 && (
            <Grid size={{ xs: 12 }}>
              <Alert severity="info" sx={{ py: 0.5 }}>
                No Contact Form templates found. Add them under Settings → Templates → "Contact Forms".
              </Alert>
            </Grid>
          )}

          {/* ── Notes content ── */}
          <Grid size={{ xs: 12 }}>
            <TextField label="Contact Notes" fullWidth multiline rows={10}
              value={content} onChange={e => setContent(e.target.value)}
              placeholder="Select a template above or type contact details here…"
              sx={{ '& .MuiInputBase-input': { fontFamily: 'monospace', fontSize: 12 } }} />
          </Grid>

          {error && (
            <Grid size={{ xs: 12 }}>
              <Alert role="alert" severity="error">{error}</Alert>
            </Grid>
          )}
        </Grid>
      </DialogContent>

      <Divider />
      <DialogActions sx={{ px: 3, py: 2, justifyContent: 'space-between' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Chip size="small"
            label={isReportable ? 'ABF Reportable' : 'Non-Reportable'}
            sx={{ bgcolor: isReportable ? '#E8F5E9' : '#FFF8E1', color: isReportable ? '#2E7D32' : '#E65100', fontWeight: 700, fontSize: 11 }} />
          <Typography variant="caption" color="text.secondary">{effectiveDuration} min</Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button onClick={onClose} sx={{ color: 'text.secondary' }}>
            {initialNoteType ? 'Skip (note saved)' : 'Cancel'}
          </Button>
          <Button variant="outlined" onClick={() => handleSave('draft')}
            disabled={!!saving} sx={{ borderColor: '#327C8D', color: '#327C8D', textTransform: 'none' }}>
            {saving === 'draft' ? <CircularProgress role="progressbar" aria-label="Loading" size={16} /> : 'Save Draft'}
          </Button>
          <Button variant="contained" onClick={() => handleSave('signed')}
            disabled={!!saving} sx={{ bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' }, textTransform: 'none' }}>
            {saving === 'signed' ? <CircularProgress role="progressbar" aria-label="Loading" size={16} sx={{ color: '#fff' }} /> : 'Save & Sign'}
          </Button>
        </Box>
      </DialogActions>
    </Dialog>
  );
}
