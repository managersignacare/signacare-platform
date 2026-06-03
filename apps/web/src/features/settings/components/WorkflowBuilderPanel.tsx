import { useState } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogTitle, Divider, FormControl, Grid, IconButton, InputLabel, MenuItem, Paper,
  Select, Step, StepLabel, Stepper, TextField, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../shared/services/apiClient';
import { workflowsKeys } from '../queryKeys';

const TRIGGER_LABELS: Record<string, { label: string; description: string; color: string }> = {
  referral_accepted: { label: 'Referral Accepted', description: 'When a referral is accepted by the target team', color: '#2E7D32' },
  referral_rejected: { label: 'Referral Rejected', description: 'When a referral is rejected', color: '#D32F2F' },
  episode_opened: { label: 'Episode Opened', description: 'When a new treatment episode is created', color: '#1565C0' },
  episode_closed: { label: 'Episode Closed', description: 'When an episode is closed/discharged', color: '#7B1FA2' },
  note_signed: { label: 'Note Signed', description: 'When a clinical note is signed off', color: '#b8621a' },
  task_completed: { label: 'Task Completed', description: 'When a task is marked as completed', color: '#327C8D' },
  appointment_completed: { label: 'Appointment Completed', description: 'When an appointment status is set to completed', color: '#2E7D32' },
  patient_admitted: { label: 'Patient Admitted', description: 'When a patient is admitted to a bed', color: '#C62828' },
  patient_discharged: { label: 'Patient Discharged', description: 'When a patient is discharged from inpatient', color: '#7B1FA2' },
  pathology_uploaded: { label: 'Pathology Uploaded', description: 'When pathology results are uploaded', color: '#E65100' },
  medication_prescribed: { label: 'Medication Prescribed', description: 'When a new medication is prescribed', color: '#1565C0' },
  escalation_created: { label: 'Escalation Created', description: 'When a new escalation is raised', color: '#D32F2F' },
};

const STEP_TYPES = [
  { value: 'create_task', label: 'Create Task', description: 'Create and assign a follow-up task' },
  { value: 'create_episode', label: 'Create Episode', description: 'Open a new treatment episode' },
  { value: 'assign_team', label: 'Assign Team', description: 'Assign patient to a team/unit' },
  { value: 'create_alert', label: 'Create Alert', description: 'Raise a patient alert/flag' },
  { value: 'send_notification', label: 'Send Notification', description: 'Send in-app notification' },
  { value: 'update_status', label: 'Update Status', description: 'Update a record status field' },
];

interface WorkflowStep { order: number; type: string; params: Record<string, string> }
interface WorkflowRow {
  id: string;
  name: string;
  description: string | null;
  triggerEvent?: string;
  trigger_event?: string;
  steps?: string | WorkflowStep[] | null;
  isActive?: boolean;
  is_active?: boolean;
}
interface WorkflowsListResponse {
  workflows: WorkflowRow[];
  triggerEvents: string[];
}
interface WorkflowMutationDto {
  name: string;
  description?: string;
  triggerEvent: string;
  steps: WorkflowStep[];
  isActive?: boolean;
}

function errorMessage(err: unknown, fallback: string): string {
  if (typeof err !== 'object' || err === null) return fallback;
  const maybeErr = err as {
    message?: unknown;
    response?: { data?: { error?: unknown; message?: unknown } };
  };
  if (typeof maybeErr.response?.data?.error === 'string' && maybeErr.response.data.error.trim()) return maybeErr.response.data.error;
  if (typeof maybeErr.response?.data?.message === 'string' && maybeErr.response.data.message.trim()) return maybeErr.response.data.message;
  if (typeof maybeErr.message === 'string' && maybeErr.message.trim()) return maybeErr.message;
  return fallback;
}

function parseWorkflowSteps(raw: unknown): WorkflowStep[] {
  const toSteps = (value: unknown): WorkflowStep[] => {
    if (!Array.isArray(value)) return [];
    return value
      .filter((item): item is { order?: unknown; type?: unknown; params?: unknown } => typeof item === 'object' && item !== null)
      .map((item, idx) => {
        const paramsObj =
          typeof item.params === 'object' && item.params !== null
            ? Object.fromEntries(
                Object.entries(item.params as Record<string, unknown>).map(([k, v]) => [k, typeof v === 'string' ? v : String(v)])
              )
            : {};
        return {
          order: typeof item.order === 'number' ? item.order : idx + 1,
          type: typeof item.type === 'string' ? item.type : 'create_task',
          params: paramsObj,
        };
      });
  };

  if (typeof raw === 'string') {
    try {
      return toSteps(JSON.parse(raw));
    } catch {
      return [];
    }
  }
  return toSteps(raw);
}

export default function WorkflowBuilderPanel() {
  const qc = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [triggerEvent, setTriggerEvent] = useState('referral_accepted');
  const [steps, setSteps] = useState<WorkflowStep[]>([]);

  const { data, isLoading } = useQuery({
    queryKey: workflowsKeys.all,
    queryFn: () => apiClient.get<WorkflowsListResponse>('workflows'),
  });
  const workflows = data?.workflows ?? [];

  const createMut = useMutation({
    mutationFn: (dto: WorkflowMutationDto) =>
      editId ? apiClient.put(`workflows/${editId}`, dto) : apiClient.post('workflows', dto),
    onSuccess: () => { qc.invalidateQueries({ queryKey: workflowsKeys.all }); closeDialog(); },
    onError: (err: unknown) => alert(errorMessage(err, 'Failed to save')),
  });

  const toggleMut = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => apiClient.put(`workflows/${id}`, { isActive }),
    onSuccess: () => qc.invalidateQueries({ queryKey: workflowsKeys.all }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => apiClient.delete(`workflows/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: workflowsKeys.all }),
  });

  const closeDialog = () => { setEditOpen(false); setEditId(null); setName(''); setDescription(''); setTriggerEvent('referral_accepted'); setSteps([]); };

  const openEdit = (wf: WorkflowRow) => {
    setEditId(wf.id);
    setName(wf.name);
    setDescription(wf.description ?? '');
    setTriggerEvent(wf.triggerEvent ?? wf.trigger_event ?? 'referral_accepted');
    setSteps(parseWorkflowSteps(wf.steps));
    setEditOpen(true);
  };

  const addStep = () => setSteps(prev => [...prev, { order: prev.length + 1, type: 'create_task', params: {} }]);
  const removeStep = (idx: number) => setSteps(prev => prev.filter((_, i) => i !== idx).map((s, i) => ({ ...s, order: i + 1 })));
  const updateStep = (idx: number, field: string, value: string) => {
    setSteps(prev => prev.map((s, i) => i === idx ? (field === 'type' ? { ...s, type: value, params: {} } : { ...s, params: { ...s.params, [field]: value } }) : s));
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Box>
          <Typography variant="h6" fontWeight={600}>Workflow Builder</Typography>
          <Typography variant="body2" color="text.secondary">
            Define automated business processes that trigger when clinical events occur.
          </Typography>
        </Box>
        <Button variant="contained" size="small" startIcon={<AddIcon />} onClick={() => { setEditId(null); setEditOpen(true); }}
          sx={{ bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' }, textTransform: 'none' }}>
          New Workflow
        </Button>
      </Box>

      {isLoading && <CircularProgress size={24} />}

      {workflows.length === 0 && !isLoading && (
        <Alert severity="info">No workflows configured. Create one to automate clinical processes.</Alert>
      )}

      {workflows.map((wf) => {
        const triggerKey = wf.triggerEvent ?? wf.trigger_event ?? '';
        const trigger = TRIGGER_LABELS[triggerKey];
        const wfSteps = parseWorkflowSteps(wf.steps);
        const isActive = wf.isActive ?? wf.is_active;
        return (
          <Paper key={wf.id} variant="outlined" sx={{ p: 2, mb: 1.5, borderLeft: `4px solid ${trigger?.color ?? '#999'}`, opacity: isActive ? 1 : 0.5 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <Box sx={{ flex: 1 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                  <Typography variant="subtitle2" fontWeight={700}>{wf.name}</Typography>
                  <Chip label={trigger?.label ?? triggerKey} size="small"
                    sx={{ fontSize: 9, height: 18, bgcolor: (trigger?.color ?? '#999') + '15', color: trigger?.color ?? '#999' }} />
                  <Chip label={`${wfSteps.length} step${wfSteps.length !== 1 ? 's' : ''}`} size="small" variant="outlined" sx={{ fontSize: 9, height: 18 }} />
                </Box>
                {wf.description && <Typography variant="caption" color="text.secondary" display="block">{wf.description}</Typography>}
                {/* Mini stepper */}
                <Box sx={{ display: 'flex', gap: 0.5, mt: 1, flexWrap: 'wrap' }}>
                  {wfSteps.map((s, i: number) => (
                    <Chip key={i} label={`${i + 1}. ${STEP_TYPES.find(st => st.value === s.type)?.label ?? s.type}`} size="small"
                      sx={{ fontSize: 9, height: 20 }} />
                  ))}
                </Box>
              </Box>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, ml: 1 }}>
                <Button size="small" onClick={() => openEdit(wf)} sx={{ color: '#327C8D', fontSize: 11, textTransform: 'none' }}>Edit</Button>
                <Button size="small" onClick={() => toggleMut.mutate({ id: wf.id, isActive: !isActive })}
                  sx={{ color: isActive ? '#D32F2F' : '#2E7D32', fontSize: 11, textTransform: 'none' }}>
                  {isActive ? 'Disable' : 'Enable'}
                </Button>
                <Button size="small" onClick={() => { if (confirm(`Delete "${wf.name}"?`)) deleteMut.mutate(wf.id); }}
                  sx={{ color: '#999', fontSize: 11, textTransform: 'none' }}>Delete</Button>
              </Box>
            </Box>
          </Paper>
        );
      })}

      {/* Workflow Edit Dialog */}
      <Dialog open={editOpen} onClose={closeDialog} maxWidth="md" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>{editId ? 'Edit Workflow' : 'New Workflow'}</DialogTitle>
        <Divider />
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 0.5 }}>
            <Grid size={{ xs: 12, sm: 8 }}>
              <TextField label="Workflow Name" fullWidth size="small" value={name} onChange={e => setName(e.target.value)} />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <FormControl fullWidth size="small"><InputLabel>Trigger Event</InputLabel>
                <Select value={triggerEvent} onChange={e => setTriggerEvent(e.target.value)} label="Trigger Event">
                  {Object.entries(TRIGGER_LABELS).map(([k, v]) => (
                    <MenuItem key={k} value={k}>{v.label}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 12 }}>
              <TextField label="Description" fullWidth size="small" value={description} onChange={e => setDescription(e.target.value)} />
            </Grid>
            {triggerEvent && TRIGGER_LABELS[triggerEvent] && (
              <Grid size={{ xs: 12 }}>
                <Alert severity="info" sx={{ fontSize: 11, py: 0.5 }}>
                  <strong>Trigger:</strong> {TRIGGER_LABELS[triggerEvent].description}
                </Alert>
              </Grid>
            )}
          </Grid>

          <Divider sx={{ my: 2 }} />
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
            <Typography variant="subtitle2" fontWeight={600}>Steps ({steps.length})</Typography>
            <Button size="small" startIcon={<AddIcon />} onClick={addStep} sx={{ textTransform: 'none' }}>Add Step</Button>
          </Box>

          {steps.length === 0 && (
            <Alert severity="info" sx={{ fontSize: 11 }}>No steps defined. Add steps to define what happens when the trigger fires.</Alert>
          )}

          <Stepper orientation="vertical" activeStep={-1} sx={{ mt: 1 }}>
            {steps.map((step, idx) => (
              <Step key={idx} completed={false}>
                <StepLabel>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography variant="body2" fontWeight={600}>Step {idx + 1}</Typography>
                    <IconButton size="small" onClick={() => removeStep(idx)} sx={{ color: '#D32F2F' }}><DeleteIcon sx={{ fontSize: 16 }} /></IconButton>
                  </Box>
                </StepLabel>
                <Box sx={{ pl: 4, pb: 2 }}>
                  <Grid container spacing={1.5}>
                    <Grid size={{ xs: 12, sm: 4 }}>
                      <FormControl fullWidth size="small"><InputLabel>Action</InputLabel>
                        <Select value={step.type} onChange={e => updateStep(idx, 'type', e.target.value)} label="Action">
                          {STEP_TYPES.map(st => <MenuItem key={st.value} value={st.value}>{st.label}</MenuItem>)}
                        </Select>
                      </FormControl>
                    </Grid>
                    {/* Dynamic params based on step type */}
                    {step.type === 'create_task' && (
                      <>
                        <Grid size={{ xs: 12, sm: 4 }}><TextField label="Task Title" size="small" fullWidth value={step.params.title ?? ''} onChange={e => updateStep(idx, 'title', e.target.value)} /></Grid>
                        <Grid size={{ xs: 6, sm: 2 }}>
                          <FormControl fullWidth size="small"><InputLabel>Priority</InputLabel>
                            <Select value={step.params.priority ?? 'medium'} onChange={e => updateStep(idx, 'priority', e.target.value)} label="Priority">
                              <MenuItem value="low">Low</MenuItem><MenuItem value="medium">Medium</MenuItem><MenuItem value="high">High</MenuItem><MenuItem value="urgent">Urgent</MenuItem>
                            </Select>
                          </FormControl>
                        </Grid>
                        <Grid size={{ xs: 6, sm: 2 }}><TextField label="Due (days)" size="small" fullWidth type="number" value={step.params.dueDays ?? ''} onChange={e => updateStep(idx, 'dueDays', e.target.value)} /></Grid>
                      </>
                    )}
                    {step.type === 'create_episode' && (
                      <Grid size={{ xs: 12, sm: 4 }}><TextField label="Episode Type" size="small" fullWidth value={step.params.episodeType ?? ''} onChange={e => updateStep(idx, 'episodeType', e.target.value)} placeholder="e.g. community, inpatient" /></Grid>
                    )}
                    {step.type === 'create_alert' && (
                      <>
                        <Grid size={{ xs: 12, sm: 4 }}><TextField label="Alert Category" size="small" fullWidth value={step.params.category ?? ''} onChange={e => updateStep(idx, 'category', e.target.value)} /></Grid>
                        <Grid size={{ xs: 12, sm: 4 }}><TextField label="Message" size="small" fullWidth value={step.params.message ?? ''} onChange={e => updateStep(idx, 'message', e.target.value)} /></Grid>
                      </>
                    )}
                    {step.type === 'send_notification' && (
                      <>
                        <Grid size={{ xs: 12, sm: 4 }}><TextField label="Notification Title" size="small" fullWidth value={step.params.title ?? ''} onChange={e => updateStep(idx, 'title', e.target.value)} /></Grid>
                        <Grid size={{ xs: 12, sm: 4 }}><TextField label="Message" size="small" fullWidth value={step.params.message ?? ''} onChange={e => updateStep(idx, 'message', e.target.value)} /></Grid>
                      </>
                    )}
                    {step.type === 'update_status' && (
                      <>
                        <Grid size={{ xs: 4 }}><TextField label="Table" size="small" fullWidth value={step.params.table ?? ''} onChange={e => updateStep(idx, 'table', e.target.value)} /></Grid>
                        <Grid size={{ xs: 4 }}><TextField label="Field" size="small" fullWidth value={step.params.field ?? ''} onChange={e => updateStep(idx, 'field', e.target.value)} /></Grid>
                        <Grid size={{ xs: 4 }}><TextField label="Value" size="small" fullWidth value={step.params.value ?? ''} onChange={e => updateStep(idx, 'value', e.target.value)} /></Grid>
                      </>
                    )}
                  </Grid>
                </Box>
              </Step>
            ))}
          </Stepper>
        </DialogContent>
        <Divider />
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={closeDialog} sx={{ textTransform: 'none' }}>Cancel</Button>
          <Button variant="contained" disabled={!name.trim() || createMut.isPending}
            onClick={() => createMut.mutate({ name: name.trim(), description: description.trim() || undefined, triggerEvent, steps })}
            sx={{ bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' }, textTransform: 'none' }}>
            {createMut.isPending ? 'Saving...' : editId ? 'Update Workflow' : 'Create Workflow'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
