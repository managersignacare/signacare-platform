import AddIcon from '@mui/icons-material/Add';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import PhoneIcon from '@mui/icons-material/Phone';
import ShieldIcon from '@mui/icons-material/Shield';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import {
    Alert, Box, Button, Card, CardContent, Chip, CircularProgress, Dialog, DialogActions,
    DialogContent, DialogTitle, Divider, FormControl, FormControlLabel, Grid, IconButton,
    InputLabel, MenuItem, Paper, Select, Switch, Tab, Tabs, TextField, Tooltip, Typography
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useTemplates } from '../../../../templates/hooks/useTemplates';
import { useRef, useState } from 'react';
import { apiClient } from '../../../../../shared/services/apiClient';
import { patientNotesKeys, patientsKeys, riskAllergiesKeys } from '../../../queryKeys';
import { AllergyPanel } from '../../../../risk-allergies/components/AllergyPanel';
import { IncidentsTab } from './IncidentsTab';
import { RecoveryStarPanel } from './RecoveryStarPanel.internal';
import { templateSectionsToDraftText } from '../../notes/AddNoteDialogSupport';
import {
  type CreatedAlertResponse,
  type PatientNote,
  type PatientNotesResponse,
  type SafetyPlanApiRow,
  asPatientNotes,
  parseMaybeRecord,
} from './alertsPlansTabSupport';

interface AlertType { id: string; name: string; severity: string; color: string; planTemplate: string | null; isActive: boolean }
interface PatientAlert {
  id: string; patientId: string; alertTypeId: string; alertTypeName: string; alertColor: string; alertSeverity: string;
  title: string; notes: string | null; managementPlan: string | null; severity: string; isActive: boolean; showFlag: boolean;
  enteredByName: string; attachmentCount: number; createdAt: string; resolvedAt: string | null;
}
function useAlertTypes() {
  return useQuery({ queryKey: patientsKeys.alertTypes(), queryFn: () => apiClient.get<{ types: AlertType[] }>('patients/alert-types').then(r => r.types) });
}

function usePatientAlerts(patientId: string) {
  return useQuery({ queryKey: patientsKeys.alerts(patientId), queryFn: () => apiClient.get<{ alerts: PatientAlert[] }>(`patients/${patientId}/alerts`).then(r => r.alerts), enabled: !!patientId });
}

interface AlertsPlansTabProps { patientId: string }
export function AlertsPlansTab({ patientId }: AlertsPlansTabProps) {
  const [tab, setTab] = useState<'alerts' | 'plans' | 'recovery-star' | 'incidents'>('alerts');

  return (
    <Box>
      <Tabs aria-label="Navigation tabs" value={tab} onChange={(_, v) => setTab(v)} variant="scrollable" scrollButtons="auto"
        sx={{ mb: 2, '& .MuiTab-root': { textTransform: 'none', fontFamily: 'Albert Sans, sans-serif' } }}>
        <Tab label="Alerts" value="alerts" />
        <Tab label="Plans" value="plans" />
        <Tab label="Recovery Star" value="recovery-star" />
        <Tab label="Incidents" value="incidents" />
      </Tabs>
      {tab === 'alerts' && <AlertsPanel patientId={patientId} />}
      {tab === 'plans' && <PlansPanel patientId={patientId} />}
      {tab === 'recovery-star' && <RecoveryStarPanel patientId={patientId} />}
      {tab === 'incidents' && <IncidentsTab patientId={patientId} />}
    </Box>
  );
}

interface AlertsPanelProps { patientId: string }
function AlertsPanel({ patientId }: AlertsPanelProps) {
  const qc = useQueryClient();
  const { data: alertTypes } = useAlertTypes();
  const { data: alerts, isLoading } = usePatientAlerts(patientId);
  const selectableAlertTypes = (alertTypes ?? []).filter(
    (type) => type.isActive && !/allerg/i.test(type.name),
  );

  const createMut = useMutation({
    mutationFn: (data: Record<string, unknown>) => apiClient.post<CreatedAlertResponse>(`patients/${patientId}/alerts`, data),
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: patientsKeys.alerts(patientId) }); },
  });
  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) => apiClient.patch(`patients/alerts/${id}`, data),
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: patientsKeys.alerts(patientId) }); },
  });

  const [addOpen, setAddOpen] = useState(false);
  const [editAlert, setEditAlert] = useState<PatientAlert | null>(null);
  const [alertTypeId, setAlertTypeId] = useState('');
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [managementPlan, setManagementPlan] = useState('');
  const [showFlag, setShowFlag] = useState(true);
  const [attachments, setAttachments] = useState<File[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const selectedType = alertTypes?.find(t => t.id === alertTypeId);

  const openAdd = () => {
    setEditAlert(null); setAlertTypeId(''); setTitle(''); setNotes(''); setManagementPlan('');
    setShowFlag(true); setAttachments([]);
    setAddOpen(true);
  };

  const openEdit = (a: PatientAlert) => {
    setEditAlert(a); setAlertTypeId(a.alertTypeId); setTitle(a.title);
    setNotes(a.notes ?? ''); setManagementPlan(a.managementPlan ?? '');
    setShowFlag(a.showFlag); setAttachments([]);
    setAddOpen(true);
  };

  const handleTypeChange = (typeId: string) => {
    setAlertTypeId(typeId);
    const type = alertTypes?.find(t => t.id === typeId);
    if (type && !editAlert) {
      setTitle(type.name);
      if (type.planTemplate) setManagementPlan(type.planTemplate);
    }
  };

  const handleSave = async () => {
    if (!alertTypeId || !title.trim()) return;
    const data = { alertTypeId, title: title.trim(), notes: notes.trim() || null, managementPlan: managementPlan.trim() || null, severity: selectedType?.severity ?? 'medium', showFlag };

    if (editAlert) {
      await updateMut.mutateAsync({ id: editAlert.id, data });
    } else {
      const result = await createMut.mutateAsync(data);
      const createdAlertId = result.alert?.id;
      if (attachments.length > 0 && createdAlertId) {
        const formData = new FormData();
        attachments.forEach(f => formData.append('files', f));
        await apiClient.instance.post(`patients/alerts/${createdAlertId}/attachments`, formData, { headers: { 'Content-Type': 'multipart/form-data' } }).catch((err) => { console.warn('AlertsPlansTab: alert attachment upload failed', err); });
      }
    }
    await qc.invalidateQueries({ queryKey: patientsKeys.alerts(patientId) });
    setAddOpen(false);
  };

  const activeAlerts = alerts?.filter(a => a.isActive) ?? [];
  const resolvedAlerts = alerts?.filter(a => !a.isActive) ?? [];

  if (isLoading) return <CircularProgress role="progressbar" aria-label="Loading" size={24} />;

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2 }}>
        <Typography variant="h6" fontWeight={600} fontFamily="Albert Sans, sans-serif">Alerts</Typography>
        <Button startIcon={<AddIcon />} variant="contained" size="small" onClick={openAdd} disabled={selectableAlertTypes.length === 0}
          sx={{ bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' } }}>Add Alert</Button>
      </Box>
      <AllergyPanel patientId={patientId} />
      <Alert severity="info" sx={{ mb: 2, fontSize: 12 }}>
        Use the allergy panel above to record drug/substance allergies. Alert cards below are for behavioral and operational alerts only.
      </Alert>
      {selectableAlertTypes.length === 0 && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          No non-allergy alert types are configured. Create alert types in staff settings to enable alert creation.
        </Alert>
      )}

      {activeAlerts.length === 0 && resolvedAlerts.length === 0 ? (
        <Alert severity="info">No alerts recorded for this patient.</Alert>
      ) : (
        <>
          {activeAlerts.map(a => <AlertCard key={a.id} alert={a} onEdit={() => openEdit(a)} onResolve={() => updateMut.mutate({ id: a.id, data: { isActive: false } })} />)}
          {resolvedAlerts.length > 0 && (
            <>
              <Typography variant="subtitle2" color="text.secondary" sx={{ mt: 3, mb: 1 }}>Resolved Alerts</Typography>
              <Box sx={{ opacity: 0.6 }}>
                {resolvedAlerts.map(a => <AlertCard key={a.id} alert={a} onEdit={() => openEdit(a)} onReinstate={() => updateMut.mutate({ id: a.id, data: { isActive: true } })} />)}
              </Box>
            </>
          )}
        </>
      )}

      {/* Add/Edit Dialog */}
      <Dialog aria-labelledby="dialog-title" open={addOpen} onClose={() => setAddOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle id="dialog-title" sx={{ fontFamily: 'Albert Sans, sans-serif', fontWeight: 700 }}>
          {editAlert ? 'Edit Alert' : 'Add Alert'}
        </DialogTitle>
        <Divider />
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 0.5 }}>
            <Grid size={{ xs: 12, sm: 6 }}>
              <FormControl fullWidth size="small" required>
                <InputLabel>Alert Type *</InputLabel>
                <Select value={alertTypeId} onChange={e => handleTypeChange(e.target.value)} label="Alert Type *">
                  {(editAlert ? (alertTypes?.filter(t => t.isActive) ?? []) : selectableAlertTypes).map(t => (
                    <MenuItem key={t.id} value={t.id}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: t.color }} />
                        {t.name}
                        <Chip label={t.severity} size="small" sx={{ fontSize: 9, height: 16, ml: 0.5 }} />
                      </Box>
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField label="Alert Title *" fullWidth size="small" value={title} onChange={e => setTitle(e.target.value)} />
            </Grid>
            <Grid size={{ xs: 12 }}>
              <TextField label="Notes" fullWidth size="small" multiline rows={3} value={notes} onChange={e => setNotes(e.target.value)} />
            </Grid>
            <Grid size={{ xs: 12 }}>
              <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Management Plan</Typography>
              <TextField fullWidth size="small" multiline rows={12} value={managementPlan} onChange={e => setManagementPlan(e.target.value)}
                placeholder="Enter management plan or use the template populated from the alert type"
                sx={{ '& .MuiInputBase-input': { fontFamily: 'monospace', fontSize: 12 } }} />
            </Grid>
            <Grid size={{ xs: 12 }}>
              <FormControlLabel
                control={<Switch checked={showFlag} onChange={(_, v) => setShowFlag(v)} sx={{ '& .Mui-checked': { color: '#b8621a' } }} />}
                label={<Typography variant="body2">Display as flag on patient banner</Typography>}
              />
            </Grid>
            {!editAlert && (
              <Grid size={{ xs: 12 }}>
                <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Attachments (PDF, images)</Typography>
                {/* BUG-447-clinical-tabs-mha-legal: keyboard-operable file-upload
                    dropzone (Shape B always-interactive trio). */}
                <Box
                  role="button"
                  tabIndex={0}
                  aria-label="Upload alert attachments (PDF or image)"
                  onClick={() => fileRef.current?.click()}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileRef.current?.click(); } }}
                  sx={{ p: 1.5, border: '2px dashed', borderColor: 'divider', borderRadius: 2, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 1, '&:hover': { borderColor: '#b8621a' }, '&:focus-visible': { outline: '2px solid #b8621a', outlineOffset: 2 } }}>
                  <CloudUploadIcon sx={{ color: '#b8621a', fontSize: 20 }} />
                  <Typography variant="body2" color="text.secondary">Click or press Enter/Space to upload documents</Typography>
                  <input ref={fileRef} type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.tiff" style={{ display: 'none' }}
                    onChange={e => { if (e.target.files) setAttachments(prev => [...prev, ...Array.from(e.target.files!)]); e.target.value = ''; }} />
                </Box>
                {attachments.map((f, i) => (
                  <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
                    <AttachFileIcon sx={{ fontSize: 14, color: '#b8621a' }} />
                    <Typography variant="caption">{f.name}</Typography>
                    <IconButton size="small" aria-label={`Remove attachment ${f.name}`} onClick={() => setAttachments(prev => prev.filter((_, j) => j !== i))}><DeleteIcon fontSize="small" /></IconButton>
                  </Box>
                ))}
              </Grid>
            )}
          </Grid>
        </DialogContent>
        <Divider />
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setAddOpen(false)} sx={{ color: 'text.secondary' }}>Cancel</Button>
          <Button variant="contained" onClick={handleSave} disabled={createMut.isPending || updateMut.isPending || !alertTypeId || !title.trim()}
            sx={{ bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' } }}>
            {(createMut.isPending || updateMut.isPending) ? <CircularProgress role="progressbar" aria-label="Loading" size={18} sx={{ color: '#fff' }} /> : editAlert ? 'Save Changes' : 'Create Alert'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
interface AlertCardProps { alert: PatientAlert; onEdit: () => void; onResolve?: () => void; onReinstate?: () => void }
function AlertCard({ alert, onEdit, onResolve, onReinstate }: AlertCardProps) {
  return (
    <Card variant="outlined" sx={{ mb: 1, borderLeft: `4px solid ${alert.alertColor || '#F0852C'}` }}>
      <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <Box sx={{ flex: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
              <WarningAmberIcon sx={{ fontSize: 18, color: alert.alertColor || '#F0852C' }} />
              <Typography fontWeight={600} variant="body2">{alert.title}</Typography>
              <Chip label={alert.alertSeverity} size="small" sx={{ fontSize: 9, height: 18, bgcolor: alert.alertColor + '22', color: alert.alertColor }} />
              {alert.showFlag && <Chip label="FLAG" size="small" sx={{ fontSize: 8, height: 16, bgcolor: '#D32F2F', color: '#fff' }} />}
              {alert.attachmentCount > 0 && (
                <Tooltip title={`${alert.attachmentCount} attachment(s)`}>
                  <AttachFileIcon sx={{ fontSize: 16, color: '#b8621a' }} />
                </Tooltip>
              )}
            </Box>
            {alert.notes && <Typography variant="body2" color="text.secondary" sx={{ ml: 3.5 }}>{alert.notes}</Typography>}
            {alert.managementPlan && (
              <Typography variant="caption" color="text.secondary" sx={{ ml: 3.5, display: 'block', mt: 0.5 }}>
                Plan attached ({alert.managementPlan.split('\n').length} lines)
              </Typography>
            )}
            <Typography variant="caption" color="text.secondary" sx={{ ml: 3.5, display: 'block' }}>
              {alert.alertTypeName} — entered by {alert.enteredByName || 'Unknown'} on {new Date(alert.createdAt).toLocaleDateString('en-AU')}
              {alert.resolvedAt && ` — resolved ${new Date(alert.resolvedAt).toLocaleDateString('en-AU')}`}
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', gap: 0.5 }}>
            <Tooltip title="Edit"><IconButton size="small" aria-label="Edit alert" onClick={onEdit}><EditIcon fontSize="small" /></IconButton></Tooltip>
            {alert.isActive && onResolve && (
              <Button size="small" color="success" onClick={onResolve} sx={{ fontSize: 11, minWidth: 0 }}>Resolve</Button>
            )}
            {!alert.isActive && onReinstate && (
              <Button size="small" color="warning" onClick={onReinstate} sx={{ fontSize: 11, minWidth: 0 }}>Reinstate</Button>
            )}
          </Box>
        </Box>
      </CardContent>
    </Card>
  );
}

const SAFETY_PLAN_SECTIONS = [
  { key: 'warningSign', dbKey: 'warning_signs', label: 'Step 1: Warning Signs', placeholder: 'Thoughts, images, mood, situation, behaviour that indicate a crisis is developing...' },
  { key: 'copingStrategies', dbKey: 'coping_strategies', label: 'Step 2: Internal Coping Strategies', placeholder: 'Things I can do to take my mind off my problems without contacting another person (e.g. exercise, relaxation, music)...' },
  { key: 'peopleForDistraction', dbKey: 'people_for_distraction', label: 'Step 3: People & Social Settings for Distraction', placeholder: 'People/places that provide distraction (name, phone)...' },
  { key: 'peopleToContact', dbKey: 'people_to_contact', label: 'Step 4: People I Can Ask for Help', placeholder: 'Family members or friends (name, phone)...' },
  { key: 'professionalsToContact', dbKey: 'professionals_to_contact', label: 'Step 5: Professionals & Agencies to Contact', placeholder: 'Clinician name and phone, after-hours crisis team...' },
  { key: 'makingEnvironmentSafe', dbKey: 'making_environment_safe', label: 'Step 6: Making the Environment Safe', placeholder: 'Steps to reduce access to means (e.g. remove medications, lock items away)...' },
  { key: 'reasonsForLiving', dbKey: 'reasons_for_living', label: 'My Reasons for Living', placeholder: 'What matters most to me — family, goals, pets, beliefs...' },
];

const SAFETY_CAMEL_TO_SNAKE: Record<string, string> = {
  warningSign: 'warning_signs',
  copingStrategies: 'coping_strategies',
  peopleForDistraction: 'people_for_distraction',
  peopleToContact: 'people_to_contact',
  professionalsToContact: 'professionals_to_contact',
  makingEnvironmentSafe: 'making_environment_safe',
  reasonsForLiving: 'reasons_for_living',
  emergencyServices: 'emergency_services',
  reviewDate: 'review_date',
};

type PlanTypeValue = 'management' | 'safety' | 'recovery' | 'crisis' | 'relapse_prevention';

const PLAN_TYPE_OPTIONS: { value: PlanTypeValue; label: string }[] = [
  { value: 'management', label: 'Management Plan' },
  { value: 'safety', label: 'Safety Plan' },
  { value: 'recovery', label: 'Recovery Plan' },
  { value: 'crisis', label: 'Crisis Plan' },
  { value: 'relapse_prevention', label: 'Relapse Prevention Plan' },
];

const PLAN_TYPE_COLORS: Record<PlanTypeValue, string> = {
  management: '#b8621a',
  safety: '#D32F2F',
  recovery: '#327C8D',
  crisis: '#7B1FA2',
  relapse_prevention: '#1565C0',
};

interface SafetyPlanRecord {
  id: string; status: string; warningSignS: string; copingStrategies: string;
  peopleForDistraction: string; peopleToContact: string; professionalsToContact: string;
  emergencyServices: string; makingEnvironmentSafe: string; reasonsForLiving: string;
  planDate: string; reviewDate: string; isSigned: boolean; createdAt: string;
}

interface PlansPanelProps { patientId: string }
function PlansPanel({ patientId }: PlansPanelProps) {
  const { data: alerts, isLoading } = usePatientAlerts(patientId);
  const qc = useQueryClient();
  const plansWithManagement = alerts?.filter(a => a.managementPlan && a.isActive) ?? [];
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [planType, setPlanType] = useState<PlanTypeValue>('management');
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [planContent, setPlanContent] = useState('');
  const [planTitle, setPlanTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const [collaborationConfirmed, setCollaborationConfirmed] = useState(false);
  const [collaborationNote, setCollaborationNote] = useState('');

  const [safetyForm, setSafetyForm] = useState<Record<string, string>>({
    emergencyServices: 'Emergency: 000\nLifeline: 13 11 14\nSuicide Call Back: 1300 659 467\nCrisis Assessment Team: [local number]',
  });

  const resetDialog = () => {
    setPlanType('management');
    setSelectedTemplate('');
    setPlanContent('');
    setPlanTitle('');
    setSafetyForm({
      emergencyServices: 'Emergency: 000\nLifeline: 13 11 14\nSuicide Call Back: 1300 659 467\nCrisis Assessment Team: [local number]',
    });
    setCollaborationConfirmed(false);
    setCollaborationNote('');
  };

  const { data: planTemplates = [] } = useTemplates({
    status: 'published',
  });
  const templates = useMemo(() => planTemplates.filter((template) => {
    const category = template.category.toLowerCase();
    const name = template.name.toLowerCase();
    return category === 'management plans'
      || category === 'safety plans'
      || category === 'recovery plans'
      || category === 'crisis plans'
      || category === 'relapse prevention plans'
      || name.includes('management')
      || name.includes('relapse')
      || name.includes('safety')
      || name.includes('recovery')
      || name.includes('crisis')
      || name.includes('wrap');
  }), [planTemplates]);

  const handleTemplateSelect = (id: string) => {
    setSelectedTemplate(id);
    const tmpl = (templates ?? []).find((t) => t.id === id);
    if (tmpl) {
      setPlanTitle(tmpl.name);
      setPlanContent(templateSectionsToDraftText(tmpl.sections));
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (planType === 'safety') {
        const content: Record<string, string> = {};
        for (const [key, value] of Object.entries(safetyForm)) {
          const snakeKey = SAFETY_CAMEL_TO_SNAKE[key] ?? key;
          if (value) content[snakeKey] = value;
        }
        await apiClient.post('safety-plans', {
          patientId,
          content,
          collaborationAttestation: {
            patientCollaborated: true,
            attestationNote: collaborationNote.trim(),
          },
        });
        await qc.invalidateQueries({ queryKey: riskAllergiesKeys.safetyPlans(patientId) });
      } else {
        const planLabel = PLAN_TYPE_OPTIONS.find(o => o.value === planType)?.label ?? 'Management Plan';
        await apiClient.post(`patients/${patientId}/notes`, {
          title: planTitle || planLabel,
          noteType: 'assessment',
          content: planContent,
          status: 'signed',
          isReportableContact: false,
          contactMeta: { planType, templateId: selectedTemplate },
        });
        await qc.invalidateQueries({ queryKey: patientNotesKeys.patientAll(patientId) });
        await qc.invalidateQueries({ queryKey: patientsKeys.notesAllPlans(patientId) });
      }
      setAddOpen(false);
      resetDialog();
    } catch { /* handle error */ }
    setSaving(false);
  };

  const { data: planNotes } = useQuery({
    queryKey: patientsKeys.notesAllPlans(patientId),
    queryFn: () =>
      apiClient.get<PatientNotesResponse | PatientNote[]>(`patients/${patientId}/notes`).then((r) =>
        asPatientNotes(r).filter((n) => {
          const meta = parseMaybeRecord(n.contactMeta);
          const planType = meta?.planType;
          return planType === 'management' || planType === 'recovery' || planType === 'crisis' || planType === 'relapse_prevention';
        })
      ),
  });

  const { data: safetyPlans } = useQuery({
    queryKey: riskAllergiesKeys.safetyPlans(patientId),
    queryFn: async () => {
      const rows = await apiClient.get<SafetyPlanApiRow[]>(`safety-plans/patient/${patientId}`);
      return (rows ?? []).map((r) => {
        const c = r.content ?? {};
        return {
          id: r.id, status: r.status ?? 'active',
          warningSignS: c.warning_signs ?? '', copingStrategies: c.coping_strategies ?? '',
          peopleForDistraction: c.people_for_distraction ?? '', peopleToContact: c.people_to_contact ?? '',
          professionalsToContact: c.professionals_to_contact ?? '', emergencyServices: c.emergency_services ?? '',
          makingEnvironmentSafe: c.making_environment_safe ?? '', reasonsForLiving: c.reasons_for_living ?? '',
          planDate: c.plan_date ?? r.createdAt, reviewDate: c.review_date ?? '',
          isSigned: c.isSigned ?? false, createdAt: r.createdAt,
        } as SafetyPlanRecord;
      });
    },
    enabled: !!patientId,
  });

  const { data: legacyRecoveryNotes } = useQuery({
    queryKey: patientsKeys.notesRecoveryLegacy(patientId),
    queryFn: async () => {
      try {
        const r = await apiClient.get<PatientNotesResponse | PatientNote[]>(`patients/${patientId}/notes`);
        return asPatientNotes(r).filter((n) => {
          const meta = parseMaybeRecord(n.contactMeta);
          const planType = meta?.planType;
          return planType === 'recovery' || (!planType && n.title?.toLowerCase().includes('recovery'));
        });
      } catch { return []; }
    },
  });

  if (isLoading) return <CircularProgress role="progressbar" aria-label="Loading" size={24} />;

  const getPlanTypeMeta = (n: PatientNote): PlanTypeValue => {
    const meta = parseMaybeRecord(n.contactMeta);
    const planType = meta?.planType;
    return planType === 'management' || planType === 'safety' || planType === 'recovery' || planType === 'crisis' || planType === 'relapse_prevention'
      ? planType
      : 'management';
  };

  const noteIds = new Set((planNotes ?? []).map((pn) => pn.id));
  const allPlans: { id: string; title: string; content: string | null; createdAt: string; source: 'alert' | 'note' | 'safety'; planType: PlanTypeValue; raw?: SafetyPlanRecord }[] = [
    ...plansWithManagement.map(a => ({ id: a.id, title: a.title, content: a.managementPlan, createdAt: a.createdAt, source: 'alert' as const, planType: 'management' as PlanTypeValue })),
    ...(planNotes ?? []).map((n) => ({ id: n.id, title: n.title ?? 'Plan', content: n.content ?? null, createdAt: n.createdAt ?? '', source: 'note' as const, planType: getPlanTypeMeta(n) })),
    ...(safetyPlans ?? []).map((sp: SafetyPlanRecord) => ({ id: sp.id, title: 'Safety Plan', content: null, createdAt: sp.createdAt, source: 'safety' as const, planType: 'safety' as PlanTypeValue, raw: sp })),
    ...(legacyRecoveryNotes ?? []).filter((n) => !noteIds.has(n.id)).map((n) => ({ id: n.id, title: n.title ?? 'Recovery Plan', content: n.content ?? null, createdAt: n.createdAt ?? '', source: 'note' as const, planType: 'recovery' as PlanTypeValue })),
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const activeSafetyPlan = safetyPlans?.find(p => p.status === 'active');

  const isSaveDisabled = () => {
    if (saving) return true;
    if (planType === 'safety') return !collaborationConfirmed || collaborationNote.trim().length < 10;
    return !planTitle.trim();
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h6" fontWeight={600} fontFamily="Albert Sans, sans-serif">Plans</Typography>
        <Button startIcon={<AddIcon />} variant="contained" size="small" onClick={() => { resetDialog(); setAddOpen(true); }}
          sx={{ bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' }, textTransform: 'none' }}>
          Add Plan
        </Button>
      </Box>

      {/* Active Safety Plan highlight */}
      {activeSafetyPlan && (
        <Paper variant="outlined" sx={{ p: 3, mb: 2, borderLeft: '4px solid #D32F2F' }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <ShieldIcon sx={{ color: '#D32F2F' }} />
              <Typography variant="subtitle1" fontWeight={700}>Active Safety Plan</Typography>
            </Box>
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Chip label={`Created: ${new Date(activeSafetyPlan.planDate).toLocaleDateString('en-AU')}`} size="small" />
              {activeSafetyPlan.reviewDate && <Chip label={`Review: ${new Date(activeSafetyPlan.reviewDate).toLocaleDateString('en-AU')}`} size="small" color="warning" />}
              {activeSafetyPlan.isSigned && <Chip label="Signed" size="small" color="success" />}
            </Box>
          </Box>
          <Grid container spacing={2}>
            {SAFETY_PLAN_SECTIONS.map(s => {
              const val = activeSafetyPlan[s.dbKey as keyof SafetyPlanRecord] as string;
              if (!val) return null;
              return (
                <Grid key={s.key} size={{ xs: 12, md: 6 }}>
                  <Card variant="outlined" sx={{ height: '100%' }}>
                    <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                      <Typography variant="caption" fontWeight={700} color="#327C8D" sx={{ textTransform: 'uppercase', fontSize: 10 }}>
                        {s.label}
                      </Typography>
                      <Typography variant="body2" sx={{ mt: 0.5, whiteSpace: 'pre-wrap', fontSize: 13 }}>
                        {val}
                      </Typography>
                    </CardContent>
                  </Card>
                </Grid>
              );
            })}
          </Grid>
          {activeSafetyPlan.emergencyServices && (
            <Paper sx={{ mt: 2, p: 2, bgcolor: '#FFEBEE', border: '1px solid #FFCDD2' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                <PhoneIcon sx={{ color: '#D32F2F', fontSize: 18 }} />
                <Typography variant="subtitle2" fontWeight={700} color="#D32F2F">Emergency Contacts</Typography>
              </Box>
              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', fontSize: 13 }}>
                {activeSafetyPlan.emergencyServices}
              </Typography>
            </Paper>
          )}
        </Paper>
      )}

      {allPlans.length === 0 ? (
        <Alert severity="info">No plans yet. Click "Add Plan" to create a management plan, safety plan, recovery plan, or other plan type.</Alert>
      ) : (
        allPlans.map(p => {
          const color = PLAN_TYPE_COLORS[p.planType] ?? '#b8621a';
          const label = PLAN_TYPE_OPTIONS.find(o => o.value === p.planType)?.label ?? 'Plan';

          if (p.source === 'safety' && p.raw) {
            const sp = p.raw;
            if (sp.status === 'active') return null;
            return (
              <Card key={p.id} variant="outlined" sx={{ mb: 1.5, borderLeft: `4px solid ${color}`, opacity: 0.7 }}>
                <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                  {/* BUG-447-clinical-tabs-mha-legal: safety-plan card expand toggle (Shape B). */}
                  <Box
                    role="button"
                    tabIndex={0}
                    aria-expanded={expandedId === p.id}
                    aria-label={`Toggle safety plan ${sp.status} details`}
                    onClick={() => setExpandedId(expandedId === p.id ? null : p.id)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpandedId(expandedId === p.id ? null : p.id); } }}
                    sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', '&:focus-visible': { outline: `2px solid ${color}`, outlineOffset: 2 } }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <ShieldIcon sx={{ fontSize: 18, color }} />
                      <Typography fontWeight={600} variant="body2">Safety Plan</Typography>
                      <Chip label={sp.status} size="small" sx={{ fontSize: 9, height: 18 }} />
                      <Chip label={new Date(sp.planDate).toLocaleDateString('en-AU')} size="small" sx={{ fontSize: 9, height: 18 }} />
                    </Box>
                    <Typography variant="caption" color="text.secondary">{expandedId === p.id ? 'Collapse' : 'Expand'}</Typography>
                  </Box>
                  {expandedId === p.id && (
                    <Grid container spacing={1} sx={{ mt: 1 }}>
                      {SAFETY_PLAN_SECTIONS.map(s => {
                        const val = sp[s.dbKey as keyof SafetyPlanRecord] as string;
                        if (!val) return null;
                        return (
                          <Grid key={s.key} size={{ xs: 12, md: 6 }}>
                            <Box sx={{ p: 1, bgcolor: '#F5F7F8', borderRadius: 1 }}>
                              <Typography variant="caption" fontWeight={700} sx={{ fontSize: 10, textTransform: 'uppercase' }}>{s.label}</Typography>
                              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>{val}</Typography>
                            </Box>
                          </Grid>
                        );
                      })}
                    </Grid>
                  )}
                </CardContent>
              </Card>
            );
          }

          return (
            <Card key={p.id} variant="outlined" sx={{ mb: 1.5, borderLeft: `4px solid ${p.source === 'alert' ? ((alerts?.find(a => a.id === p.id)?.alertColor) || color) : color}` }}>
              <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                {/* BUG-447-clinical-tabs-mha-legal: alert/note plan card expand toggle (Shape B). */}
                <Box
                  role="button"
                  tabIndex={0}
                  aria-expanded={expandedId === p.id}
                  aria-label={`Toggle ${p.title} details`}
                  onClick={() => setExpandedId(expandedId === p.id ? null : p.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpandedId(expandedId === p.id ? null : p.id); } }}
                  sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', '&:focus-visible': { outline: `2px solid ${color}`, outlineOffset: 2 } }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <WarningAmberIcon sx={{ fontSize: 18, color }} />
                    <Typography fontWeight={600} variant="body2">{p.title}</Typography>
                    <Chip label={label} size="small" sx={{ fontSize: 9, height: 18, bgcolor: color + '22', color }} />
                  </Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography variant="caption" color="text.secondary">
                      {new Date(p.createdAt).toLocaleDateString('en-AU')}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">{expandedId === p.id ? 'Collapse' : 'Expand'}</Typography>
                  </Box>
                </Box>
                {expandedId === p.id && p.content && (
                  <Box sx={{ mt: 1.5, p: 2, bgcolor: '#FBF8F5', borderRadius: 1, whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: 12 }}>
                    {p.content}
                  </Box>
                )}
              </CardContent>
            </Card>
          );
        })
      )}

      {/* Add Plan Dialog */}
      <Dialog aria-labelledby="add-plan-dialog-title" open={addOpen} onClose={() => setAddOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle id="add-plan-dialog-title" sx={{ fontWeight: 700, color: PLAN_TYPE_COLORS[planType] }}>
          {planType === 'safety' ? (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <ShieldIcon />
              Add Safety Plan (Stanley-Brown)
            </Box>
          ) : (
            `Add ${PLAN_TYPE_OPTIONS.find(o => o.value === planType)?.label ?? 'Plan'}`
          )}
        </DialogTitle>
        <Divider />
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 0.5 }}>
            {/* Plan Type selector */}
            <Grid size={{ xs: 12, sm: 6 }}>
              <FormControl fullWidth size="small">
                <InputLabel>Plan Type</InputLabel>
                <Select value={planType} onChange={e => setPlanType(e.target.value as PlanTypeValue)} label="Plan Type">
                  {PLAN_TYPE_OPTIONS.map(o => (
                    <MenuItem key={o.value} value={o.value}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: PLAN_TYPE_COLORS[o.value] }} />
                        {o.label}
                      </Box>
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>

            {/* Safety Plan form */}
            {planType === 'safety' ? (
              <>
                <Grid size={{ xs: 12 }}>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    Complete each step collaboratively with the patient. The safety plan should be reviewed regularly.
                  </Typography>
                </Grid>
                {SAFETY_PLAN_SECTIONS.map(s => (
                  <Grid key={s.key} size={{ xs: 12 }}>
                    <TextField label={s.label} fullWidth multiline rows={2} size="small"
                      placeholder={s.placeholder} value={safetyForm[s.key] ?? ''}
                      onChange={e => setSafetyForm(prev => ({ ...prev, [s.key]: e.target.value }))} />
                  </Grid>
                ))}
                <Grid size={{ xs: 12 }}>
                  <TextField label="Emergency Services" fullWidth multiline rows={3} size="small"
                    value={safetyForm.emergencyServices ?? ''}
                    onChange={e => setSafetyForm(prev => ({ ...prev, emergencyServices: e.target.value }))} />
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <TextField label="Review Date" type="date" size="small" fullWidth
                    value={safetyForm.reviewDate ?? ''}
                    onChange={e => setSafetyForm(prev => ({ ...prev, reviewDate: e.target.value }))}
                    slotProps={{ inputLabel: { shrink: true } }} />
                </Grid>
                <Grid size={{ xs: 12 }}>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={collaborationConfirmed}
                        onChange={(_, checked) => setCollaborationConfirmed(checked)}
                      />
                    }
                    label="I confirm this safety plan was completed collaboratively with the patient."
                  />
                  <TextField
                    label="Collaboration attestation note"
                    fullWidth
                    multiline
                    rows={2}
                    size="small"
                    value={collaborationNote}
                    onChange={(e) => setCollaborationNote(e.target.value)}
                    placeholder="Document how collaboration was completed with the patient."
                    sx={{ mt: 1 }}
                  />
                </Grid>
              </>
            ) : (
              /* Generic plan form (management, recovery, crisis, relapse prevention) */
              <>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <FormControl fullWidth size="small">
                    <InputLabel>Template</InputLabel>
                    <Select value={selectedTemplate} onChange={e => handleTemplateSelect(e.target.value)} label="Template">
                      <MenuItem value="">-- Blank --</MenuItem>
                      {(templates ?? []).map((t) => <MenuItem key={t.id} value={t.id}>{t.name}</MenuItem>)}
                    </Select>
                  </FormControl>
                </Grid>
                <Grid size={{ xs: 12 }}>
                  <TextField label="Plan Title" fullWidth size="small" value={planTitle} onChange={e => setPlanTitle(e.target.value)} />
                </Grid>
                <Grid size={{ xs: 12 }}>
                  <TextField label="Plan Content" fullWidth multiline rows={15} value={planContent} onChange={e => setPlanContent(e.target.value)}
                    placeholder={planType === 'recovery' ? 'Collaboratively develop this plan with the consumer...' : 'Enter plan content or use a template...'}
                    sx={{ '& .MuiInputBase-input': { fontFamily: 'monospace', fontSize: 12 } }} />
                </Grid>
              </>
            )}
          </Grid>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setAddOpen(false)} sx={{ color: 'text.secondary' }}>Cancel</Button>
          <Button variant="contained" onClick={handleSave} disabled={isSaveDisabled()}
            sx={{ bgcolor: PLAN_TYPE_COLORS[planType], '&:hover': { bgcolor: PLAN_TYPE_COLORS[planType] + 'CC' }, textTransform: 'none' }}>
            {saving ? <CircularProgress role="progressbar" aria-label="Loading" size={16} /> : planType === 'safety' ? 'Save Safety Plan' : 'Save Plan'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

export default AlertsPlansTab;
