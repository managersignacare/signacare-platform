import AddIcon from '@mui/icons-material/Add';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';
import {
    Alert, Box, Button, Card, CardContent, Chip, Dialog, DialogActions,
    DialogContent, DialogTitle, Divider, FormControl, Grid, IconButton, InputLabel,
    MenuItem, Select, Tab, Tabs, TextField, Tooltip, Typography
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { OPEN_TASK_STATUSES } from '@signacare/shared';
import { apiClient } from '../../../shared/services/apiClient';
import { DigitalSignatureDialog, useStaffSignature } from '../../../shared/components/ui/DigitalSignature';
import { useAuthStore } from '../../../shared/store/authStore';
import { tasksKeys, staffLookupKeys } from '../queryKeys';
import { getTaskType, type TaskResponseView as Task } from '../types/taskTypes';
import { orgSettingsApi, type OrgUnit } from '../../org-settings/services/orgSettingsApi';

interface TaskListResponse {
  data: Task[];
}

function readTaskRows(payload: Task[] | TaskListResponse | undefined): Task[] {
  if (!payload) return [];
  return Array.isArray(payload) ? payload : payload.data ?? [];
}

function flattenUnits(nodes: OrgUnit[]): { id: string; name: string }[] {
  const out: { id: string; name: string }[] = [];
  const walk = (list: OrgUnit[]) => {
    for (const node of list) {
      out.push({ id: node.id, name: node.name });
      if (node.children?.length) walk(node.children);
    }
  };
  walk(nodes);
  return out;
}

interface TaskMutationErrorLike {
  message?: string;
  response?: {
    data?: {
      error?: string;
    };
  };
}

const asTaskMutationError = (error: unknown): TaskMutationErrorLike =>
  (error && typeof error === 'object' ? error : {}) as TaskMutationErrorLike;

const getTaskMutationErrorMessage = (error: unknown): string => {
  const parsed = asTaskMutationError(error);
  return parsed.response?.data?.error ?? parsed.message ?? 'Unknown';
};

const OPEN_TASK_STATUS_SET: ReadonlySet<string> = new Set<string>(OPEN_TASK_STATUSES);

function isOpenTaskStatus(status: string | null | undefined): boolean {
  return OPEN_TASK_STATUS_SET.has(String(status ?? '').toLowerCase());
}

function useStaffLookup() { return useQuery({ queryKey: staffLookupKeys.all, queryFn: () => apiClient.get<{ id: string; givenName: string; familyName: string }[]>('staff/lookup'), staleTime: 5 * 60 * 1000 }); }

export default function TasksPage() {
  const user = useAuthStore(s => s.user);
  const qc = useQueryClient();
  const { data: staffList } = useStaffLookup();
  const { data: teamTree = [] } = useQuery({
    queryKey: ['org-settings', 'units', 'tree', 'tasks'],
    queryFn: () => orgSettingsApi.getOrgTree(),
    staleTime: 5 * 60 * 1000,
  });
  const flatUnits = useMemo(() => flattenUnits(teamTree), [teamTree]);
  const [view, setView] = useState<'my' | 'team'>('my');
  const [addOpen, setAddOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('medium');
  const [assignTo, setAssignTo] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [teamFilter, setTeamFilter] = useState('');
  const [clinicianFilter, setClinicianFilter] = useState('');
  const [patientFilter, setPatientFilter] = useState('');
  const [periodFilter, setPeriodFilter] = useState('all');
  const [editTask, setEditTask] = useState<Task | null>(null);
  const [viewTask, setViewTask] = useState<Task | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editPriority, setEditPriority] = useState('medium');
  const [editAssign, setEditAssign] = useState('');
  const [editDueDate, setEditDueDate] = useState('');
  const [editTags, setEditTags] = useState('');

  // My tasks are always explicitly scoped to the signed-in clinician.
  const { data: myTasksData = [] } = useQuery({
    queryKey: tasksKeys.list({ assignedToId: user?.id || undefined }),
    queryFn: () =>
      apiClient.get<Task[] | TaskListResponse>('tasks', user?.id ? { assignedToId: user.id } : undefined),
    enabled: !!user?.id,
  });

  // Team tasks default to "my team scope" and can be narrowed to a specific team.
  const { data: teamTasksData = [] } = useQuery({
    queryKey: tasksKeys.list(
      teamFilter
        ? { teamId: teamFilter }
        : { teamScope: 'mine' },
    ),
    queryFn: () =>
      apiClient.get<Task[] | TaskListResponse>(
        'tasks',
        teamFilter ? { teamId: teamFilter } : { teamScope: 'mine' },
      ),
  });

  const myTasks = readTaskRows(myTasksData).filter((t) => isOpenTaskStatus(t.status));
  const teamTasks = readTaskRows(teamTasksData).filter((t) => isOpenTaskStatus(t.status));
  const completedTasks = (view === 'my' ? readTaskRows(myTasksData) : readTaskRows(teamTasksData))
    .filter((t) => t.status === 'completed');
  const [showArchive, setShowArchive] = useState(false);
  const [dueDateFilter, setDueDateFilter] = useState('');

  const createMut = useMutation({
    mutationFn: (dto: { title: string; description?: string; priority: string; assignedToId?: string; dueDate?: string }) =>
      apiClient.post('tasks', dto),
    onSuccess: () => { qc.invalidateQueries({ queryKey: tasksKeys.all }); },
  });

  const updateMut = useMutation({
    mutationFn: ({ id, ...data }: { id: string; title?: string; priority?: string; assignedToId?: string; dueDate?: string }) =>
      apiClient.patch(`tasks/${id}`, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: tasksKeys.all }); setEditTask(null); },
  });

  const completeMut = useMutation({
    mutationFn: (id: string) => apiClient.patch(`tasks/${id}`, { status: 'completed' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: tasksKeys.all }); },
  });

  const handleAdd = () => {
    if (!title.trim()) return;
    createMut.mutate({
      title: title.trim(),
      description: description.trim() || undefined,
      priority,
      assignedToId: assignTo || undefined,
      dueDate: dueDate || undefined,
    });
    setAddOpen(false); setTitle(''); setDescription(''); setAssignTo(''); setDueDate('');
  };

  const [signTask, setSignTask] = useState<Task | null>(null);
  const { signature: savedSignature } = useStaffSignature();

  const signMut = useMutation({
    mutationFn: async (task: Task) => {
      // Determine which sign endpoint to call based on task_type
      const tt = getTaskType(task);
      // Find the episode ID from the task description
      const epMatch = task.description?.match(/episode\s+([0-9a-f-]{36})/i);
      const episodeId = epMatch?.[1] ?? task.related_entity_id ?? task.episodeId;
      if (tt === 'discharge_review' && episodeId) {
        await apiClient.post(`episodes/${episodeId}/discharge-summary/sign`, { signature: savedSignature });
      } else if (tt === 'closure_review' && episodeId) {
        await apiClient.post(`episodes/${episodeId}/close-sign`, { signature: savedSignature });
      }
      // Also mark task as completed
      await apiClient.patch(`tasks/${task.id}`, { status: 'completed' });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: tasksKeys.all }); setSignTask(null); },
    onError: (error: unknown) => alert(`Sign failed: ${getTaskMutationErrorMessage(error)}`),
  });

  const handleComplete = (task: Task) => {
    const tt = getTaskType(task);
    if (tt === 'discharge_review' || tt === 'closure_review') {
      if (savedSignature) {
        signMut.mutate(task);
      } else {
        setSignTask(task);
      }
    } else {
      completeMut.mutate(task.id);
    }
  };
  const baseTasks = view === 'my' ? myTasks : teamTasks;
  const displayTasks = baseTasks.filter(t => {
    if (patientFilter && !t.patientName?.toLowerCase().includes(patientFilter.toLowerCase())) return false;
    if (clinicianFilter && t.assignedToId !== clinicianFilter) return false;
    if (periodFilter !== 'all') {
      const days = periodFilter === '7d' ? 7 : periodFilter === '30d' ? 30 : 90;
      const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - days);
      if (t.createdAt && new Date(t.createdAt) < cutoff) return false;
    }
    if (dueDateFilter) {
      const due = t.dueDate;
      if (!due || new Date(due).toISOString().split('T')[0] > dueDateFilter) return false;
    }
    return true;
  });

  return (
    <Box sx={{ px: { xs: 2, sm: 3, md: 4 }, py: 3, bgcolor: '#FBF8F5', minHeight: '100vh' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', mb: 3, gap: 2 }}>
        <Box>
          <Typography variant="h5" fontWeight={700} fontFamily="Albert Sans, sans-serif" sx={{ color: '#3D484B' }}>Tasks</Typography>
          <Typography variant="body2" color="text.secondary">Manage and delegate clinical tasks</Typography>
        </Box>
        <Button startIcon={<AddIcon />} variant="contained" onClick={() => setAddOpen(true)} sx={{ bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' } }}>New Task</Button>
      </Box>

      <Tabs aria-label="Navigation tabs" value={view} onChange={(_, v) => setView(v)} sx={{ mb: 2, '& .MuiTab-root': { textTransform: 'none' } }}>
        <Tab label={`My Tasks (${myTasks.length})`} value="my" />
        <Tab label={`Team Tasks (${teamTasks.length})`} value="team" />
      </Tabs>

      {/* Filters */}
      <Box sx={{ display: 'flex', gap: 1.5, mb: 2, flexWrap: 'wrap' }}>
        <TextField size="small" placeholder="Filter by patient..." value={patientFilter} onChange={e => setPatientFilter(e.target.value)}
          sx={{ minWidth: 160, '& .MuiOutlinedInput-root': { bgcolor: '#fff' } }} />
        <FormControl size="small" sx={{ minWidth: 180 }}>
          <InputLabel>Clinician</InputLabel>
          <Select value={clinicianFilter} onChange={e => setClinicianFilter(e.target.value)} label="Clinician" sx={{ bgcolor: '#fff' }}>
            <MenuItem value="">All Clinicians</MenuItem>
            {(staffList ?? []).map(s => <MenuItem key={s.id} value={s.id}>{s.givenName} {s.familyName}</MenuItem>)}
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 140 }}>
          <InputLabel>Team</InputLabel>
          <Select value={teamFilter} onChange={e => setTeamFilter(e.target.value)} label="Team" sx={{ bgcolor: '#fff' }}>
            <MenuItem value="">All Teams</MenuItem>
            {flatUnits.map((u) => (
              <MenuItem key={u.id} value={u.id}>{u.name}</MenuItem>
            ))}
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 140 }}>
          <InputLabel>Period</InputLabel>
          <Select value={periodFilter} onChange={e => setPeriodFilter(e.target.value)} label="Period" sx={{ bgcolor: '#fff' }}>
            <MenuItem value="all">All Time</MenuItem>
            <MenuItem value="7d">Last 7 Days</MenuItem>
            <MenuItem value="30d">Last 30 Days</MenuItem>
            <MenuItem value="90d">Last 90 Days</MenuItem>
          </Select>
        </FormControl>
        <TextField size="small" type="date" label="Due Before" value={dueDateFilter} onChange={e => setDueDateFilter(e.target.value)}
          slotProps={{ inputLabel: { shrink: true } }} sx={{ width: 160, '& .MuiOutlinedInput-root': { bgcolor: '#fff' } }} />
      </Box>

      {displayTasks.length === 0 ? (
        <Alert severity="info">No {view === 'my' ? 'personal' : 'team'} tasks.</Alert>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {displayTasks.map(t => (
            <Card key={t.id} variant="outlined" sx={{ borderLeft: `4px solid ${t.priority === 'high' ? '#D32F2F' : t.priority === 'medium' ? '#b8621a' : '#327C8D'}` }}>
              <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 }, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2 }}>
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography variant="body2" fontWeight={600}>{t.title}</Typography>
                  <Typography variant="caption" color="text.secondary">{t.description}</Typography>
                  <Box sx={{ display: 'flex', gap: 0.5, mt: 0.5 }}>
                    <Chip label={t.priority} size="small" color={t.priority === 'high' ? 'error' : 'warning'} sx={{ fontSize: 9, height: 18 }} />
                    {getTaskType(t) && <Chip label={getTaskType(t).replace('_', ' ')} size="small" variant="outlined" sx={{ fontSize: 9, height: 18, textTransform: 'capitalize' }} />}
                    {t.dueDate && <Typography variant="caption" color={new Date(t.dueDate) < new Date() ? 'error' : 'text.secondary'}>Due: {new Date(t.dueDate).toLocaleDateString('en-AU')}</Typography>}
                  </Box>
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
                  <Tooltip title="View full task">
                    <IconButton size="small" onClick={() => setViewTask(t)}>
                      <VisibilityOutlinedIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Edit task">
                    <IconButton size="small" onClick={() => {
                      setEditTask(t); setEditTitle(t.title); setEditPriority(t.priority ?? 'medium');
                      setEditAssign(t.assignedToId ?? ''); setEditDueDate(t.dueDate ?? '');
                    }}>
                      <EditOutlinedIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title={(() => { const tt = getTaskType(t); return tt === 'discharge_review' || tt === 'closure_review' ? 'Sign & Complete' : 'Complete'; })()}>
                    <IconButton color="success" onClick={() => handleComplete(t)}><CheckCircleIcon /></IconButton>
                  </Tooltip>
                </Box>
              </CardContent>
            </Card>
          ))}
        </Box>
      )}

      {/* Archive section — completed tasks */}
      <Box sx={{ mt: 3 }}>
        <Button onClick={() => setShowArchive(!showArchive)} size="small" sx={{ color: '#757575', textTransform: 'none', fontWeight: 600 }}>
          Completed ({completedTasks.length}) {showArchive ? '▲' : '▼'}
        </Button>
        {showArchive && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75, mt: 1 }}>
            {completedTasks.slice(0, 20).map(t => (
              <Card key={t.id} variant="outlined" sx={{ opacity: 0.6, borderLeft: '4px solid #2E7D32' }}>
                <CardContent sx={{ py: 1, '&:last-child': { pb: 1 }, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Box>
                    <Typography variant="body2" sx={{ textDecoration: 'line-through' }}>{t.title}</Typography>
                    <Typography variant="caption" color="text.secondary">{t.createdAt ? new Date(t.createdAt).toLocaleDateString('en-AU') : ''}</Typography>
                  </Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Chip label="Completed" size="small" color="success" sx={{ fontSize: 9, height: 18 }} />
                    <Tooltip title="View full task">
                      <IconButton size="small" onClick={() => setViewTask(t)}>
                        <VisibilityOutlinedIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </Box>
                </CardContent>
              </Card>
            ))}
          </Box>
        )}
      </Box>

      <Dialog aria-labelledby="dialog-title" open={addOpen} onClose={() => setAddOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle id="dialog-title">New Task</DialogTitle><Divider />
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 0.5 }}>
            <Grid size={{ xs: 12 }}><TextField autoFocus label="Task Title *" fullWidth size="small" value={title} onChange={e => setTitle(e.target.value)} /></Grid>
            <Grid size={{ xs: 12 }}><TextField label="Description" fullWidth size="small" multiline rows={2} value={description} onChange={e => setDescription(e.target.value)} /></Grid>
            <Grid size={{ xs: 12, sm: 4 }}><FormControl fullWidth size="small"><InputLabel>Priority</InputLabel><Select value={priority} onChange={e => setPriority(e.target.value)} label="Priority"><MenuItem value="low">Low</MenuItem><MenuItem value="medium">Medium</MenuItem><MenuItem value="high">High</MenuItem></Select></FormControl></Grid>
            <Grid size={{ xs: 12, sm: 4 }}><FormControl fullWidth size="small"><InputLabel>Assign To</InputLabel><Select value={assignTo} onChange={e => setAssignTo(e.target.value)} label="Assign To"><MenuItem value="">Self</MenuItem>{(staffList ?? []).map(s => <MenuItem key={s.id} value={s.id}>{s.givenName} {s.familyName}</MenuItem>)}</Select></FormControl></Grid>
            <Grid size={{ xs: 12, sm: 4 }}><TextField label="Due Date" type="date" fullWidth size="small" value={dueDate} onChange={e => setDueDate(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} /></Grid>
          </Grid>
        </DialogContent><Divider />
        <DialogActions sx={{ px: 3, py: 2 }}><Button onClick={() => setAddOpen(false)} sx={{ color: 'text.secondary' }}>Cancel</Button><Button variant="contained" onClick={handleAdd} disabled={!title.trim()} sx={{ bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' } }}>Create Task</Button></DialogActions>
      </Dialog>

      <Dialog open={!!viewTask} onClose={() => setViewTask(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Task Details</DialogTitle>
        <DialogContent>
          {viewTask && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
              <Typography variant="subtitle1" fontWeight={700}>{viewTask.title}</Typography>
              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', bgcolor: '#F7F8FA', p: 1.25, borderRadius: 1, border: '1px solid #E0E0E0' }}>
                {viewTask.description?.trim() ? viewTask.description : 'No description'}
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                <Chip label={`Status: ${viewTask.status ?? 'open'}`} size="small" />
                <Chip label={`Priority: ${viewTask.priority ?? 'medium'}`} size="small" />
                {viewTask.patientName && <Chip label={`Patient: ${viewTask.patientName}`} size="small" variant="outlined" />}
                {viewTask.assignedToName && <Chip label={`Assigned: ${viewTask.assignedToName}`} size="small" variant="outlined" />}
                {viewTask.dueDate && <Chip label={`Due: ${new Date(viewTask.dueDate).toLocaleDateString('en-AU')}`} size="small" variant="outlined" />}
              </Box>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setViewTask(null)}>Close</Button>
        </DialogActions>
      </Dialog>

      {/* Digital Signature Dialog for vetting tasks */}
      {signTask && (
        <DigitalSignatureDialog
          open={!!signTask}
          onClose={() => setSignTask(null)}
          onSign={() => {
            // Save signature first, then sign the document
            signMut.mutate(signTask);
          }}
          signerName={`${user?.givenName ?? ''} ${user?.familyName ?? ''}`}
          documentTitle={signTask.title}
          savedSignature={savedSignature}
        />
      )}

      {/* Edit Task Dialog */}
      <Dialog open={!!editTask} onClose={() => setEditTask(null)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>Edit Task</DialogTitle>
        <Divider />
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 0.5 }}>
            <Grid size={{ xs: 12 }}><TextField label="Title" fullWidth size="small" value={editTitle} onChange={e => setEditTitle(e.target.value)} /></Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <FormControl fullWidth size="small"><InputLabel>Priority</InputLabel>
                <Select value={editPriority} onChange={e => setEditPriority(e.target.value)} label="Priority">
                  <MenuItem value="low">Low</MenuItem><MenuItem value="medium">Medium</MenuItem>
                  <MenuItem value="high">High</MenuItem><MenuItem value="urgent">Urgent</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <FormControl fullWidth size="small"><InputLabel>Assign To</InputLabel>
                <Select value={editAssign} onChange={e => setEditAssign(e.target.value)} label="Assign To">
                  <MenuItem value="">Unassigned</MenuItem>
                  {(staffList ?? []).map(s => <MenuItem key={s.id} value={s.id}>{s.givenName} {s.familyName}</MenuItem>)}
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}><TextField label="Due Date" type="date" fullWidth size="small" value={editDueDate} onChange={e => setEditDueDate(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} /></Grid>
            <Grid size={{ xs: 12 }}><TextField label="Tags (comma separated)" fullWidth size="small" value={editTags} onChange={e => setEditTags(e.target.value)} placeholder="e.g. urgent, follow-up, review" /></Grid>
          </Grid>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setEditTask(null)}>Cancel</Button>
          <Button variant="contained" onClick={() => editTask && updateMut.mutate({
            id: editTask.id, title: editTitle || undefined, priority: editPriority || undefined,
            assignedToId: editAssign || undefined, dueDate: editDueDate || undefined,
          })} sx={{ bgcolor: '#2563EB', '&:hover': { bgcolor: '#1D4ED8' } }}>Save Changes</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
