import AddIcon from '@mui/icons-material/Add';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';
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
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import type {
  TaskMonitoringSummary,
  TaskOwnershipFilter,
  TaskPriority,
  TaskStatus,
} from '@signacare/shared';
import { apiClient } from '../../../shared/services/apiClient';
import {
  DigitalSignatureDialog,
  useStaffSignature,
} from '../../../shared/components/ui/DigitalSignature';
import { useAuthStore } from '../../../shared/store/authStore';
import { orgSettingsApi, type OrgUnit } from '../../org-settings/services/orgSettingsApi';
import { useTasks, useTaskSummary } from '../hooks/useTasks';
import { staffLookupKeys, tasksKeys } from '../queryKeys';
import { getTaskType, type TaskResponseView as Task } from '../types/taskTypes';
import {
  buildMonitoringCards,
  humanizeTaskStatus,
  priorityTone,
  statusTone,
  workbenchBucketToQuery,
  type TaskWorkbenchBucket,
} from '../taskMonitoringSupport';

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

type ScopeMode = 'my' | 'team';
type LayoutMode = 'list' | 'board';
type BucketMode = 'all' | TaskWorkbenchBucket;

const STATUS_OPTIONS: Array<{ value: '' | TaskStatus; label: string }> = [
  { value: '', label: 'All statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'waiting_external', label: 'Waiting external' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'review_pending', label: 'Review pending' },
  { value: 'completed', label: 'Completed' },
];

const PRIORITY_OPTIONS: Array<{ value: '' | TaskPriority; label: string }> = [
  { value: '', label: 'All priorities' },
  { value: 'urgent', label: 'Urgent' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
];

const OWNERSHIP_OPTIONS: Array<{ value: '' | TaskOwnershipFilter; label: string }> = [
  { value: '', label: 'All ownership' },
  { value: 'assigned', label: 'Assigned' },
  { value: 'unassigned', label: 'Unassigned' },
];

const BUCKET_OPTIONS: Array<{ value: BucketMode; label: string }> = [
  { value: 'all', label: 'All open' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'today', label: 'Today' },
  { value: 'next_7_days', label: 'Next 7 Days' },
  { value: 'undated', label: 'Undated' },
  { value: 'waiting_external', label: 'Waiting external' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'review_pending', label: 'Review pending' },
];

const BOARD_STATUSES: TaskStatus[] = [
  'pending',
  'in_progress',
  'waiting_external',
  'blocked',
  'review_pending',
];

function useStaffLookup() {
  return useQuery({
    queryKey: staffLookupKeys.all,
    queryFn: () =>
      apiClient.get<{ id: string; givenName: string; familyName: string }[]>(
        'staff/lookup',
      ),
    staleTime: 5 * 60 * 1000,
  });
}

function formatTaskMutationError(error: unknown): string {
  const parsed = (error && typeof error === 'object' ? error : {}) as TaskMutationErrorLike;
  return parsed.response?.data?.error ?? parsed.message ?? 'Unknown error';
}

function isOverdue(task: Task): boolean {
  return !!task.dueDate && task.status !== 'completed' && task.dueDate < new Date().toISOString().slice(0, 10);
}

function buildScopeQuery(args: {
  scope: ScopeMode;
  userId?: string;
  teamId: string;
  bucket: BucketMode;
  status: '' | TaskStatus;
  priority: '' | TaskPriority;
  ownership: '' | TaskOwnershipFilter;
  clinicianId: string;
}) {
  const scopeQuery = args.scope === 'my'
    ? { assignedToId: args.userId }
    : args.teamId
      ? { teamId: args.teamId }
      : { teamScope: 'mine' as const };
  const bucketQuery = args.bucket === 'all' ? {} : workbenchBucketToQuery(args.bucket);
  return {
    ...scopeQuery,
    ...(args.clinicianId ? { assignedToId: args.clinicianId } : {}),
    ...(args.status ? { status: args.status } : {}),
    ...(args.priority ? { priority: args.priority } : {}),
    ...(args.ownership ? { ownership: args.ownership } : {}),
    ...bucketQuery,
  };
}

function TaskRow(props: {
  task: Task;
  onView: (task: Task) => void;
  onEdit: (task: Task) => void;
  onComplete: (task: Task) => void;
}) {
  const { task } = props;
  const overdue = isOverdue(task);
  return (
    <Card
      variant="outlined"
      sx={{
        borderRadius: 3,
        borderLeft: `4px solid ${overdue ? '#D32F2F' : '#327C8D'}`,
        bgcolor: overdue ? '#FFF6F4' : '#fff',
      }}
    >
      <CardContent
        sx={{
          py: 1.5,
          '&:last-child': { pb: 1.5 },
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 2,
        }}
      >
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 0.75 }}>
            <Typography variant="body2" fontWeight={700}>{task.title}</Typography>
            <Chip label={humanizeTaskStatus(task.status)} size="small" color={statusTone(task.status)} sx={{ textTransform: 'capitalize' }} />
            <Chip label={task.priority} size="small" color={priorityTone(task.priority)} sx={{ textTransform: 'capitalize' }} />
            {getTaskType(task) && (
              <Chip
                label={getTaskType(task).replace(/_/g, ' ')}
                size="small"
                variant="outlined"
                sx={{ textTransform: 'capitalize' }}
              />
            )}
          </Box>
          {task.description && (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
              {task.description}
            </Typography>
          )}
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.25, mt: 0.75 }}>
            {task.patientName && (
              <Typography variant="caption" color="text.secondary">Patient: {task.patientName}</Typography>
            )}
            {task.assignedToName && (
              <Typography variant="caption" color="text.secondary">Owner: {task.assignedToName}</Typography>
            )}
            {!task.assignedToName && (
              <Typography variant="caption" color="warning.main">Owner: Unassigned</Typography>
            )}
            {task.dueDate && (
              <Typography variant="caption" color={overdue ? 'error.main' : 'text.secondary'}>
                Due: {new Date(task.dueDate).toLocaleDateString('en-AU')}
              </Typography>
            )}
            {!task.dueDate && (
              <Typography variant="caption" color="text.secondary">No due date</Typography>
            )}
          </Box>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
          <Tooltip title="View task">
            <IconButton size="small" onClick={() => props.onView(task)}>
              <VisibilityOutlinedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Edit task">
            <IconButton size="small" onClick={() => props.onEdit(task)}>
              <EditOutlinedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          {task.status !== 'completed' && (
            <Tooltip title="Complete task">
              <IconButton color="success" onClick={() => props.onComplete(task)}>
                <CheckCircleIcon />
              </IconButton>
            </Tooltip>
          )}
        </Box>
      </CardContent>
    </Card>
  );
}

function MonitoringPanel(props: {
  summary?: TaskMonitoringSummary;
  title: string;
  subtitle: string;
}) {
  if (!props.summary) return null;
  const cards = buildMonitoringCards(props.summary);
  return (
    <Paper variant="outlined" sx={{ p: 2.25, borderRadius: 3 }}>
      <Typography variant="h6" fontWeight={800}>{props.title}</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {props.subtitle}
      </Typography>
      <Grid container spacing={1.5} sx={{ mb: 2 }}>
        {cards.map((card) => (
          <Grid key={card.id} size={{ xs: 6, md: 4 }}>
            <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2, bgcolor: '#FCFBF9' }}>
              <Typography variant="caption" color="text.secondary">{card.label}</Typography>
              <Typography variant="h6" fontWeight={800}>{card.value}</Typography>
            </Paper>
          </Grid>
        ))}
      </Grid>
      <Typography variant="subtitle2" fontWeight={800} sx={{ mb: 1 }}>
        Ownership radar
      </Typography>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {props.summary.assigneeBreakdown.slice(0, 6).map((row) => (
          <Box
            key={row.staffId ?? 'unassigned'}
            sx={{
              display: 'grid',
              gridTemplateColumns: '1.4fr repeat(5, minmax(0, 72px))',
              gap: 1,
              alignItems: 'center',
              py: 0.75,
              borderBottom: '1px solid',
              borderColor: 'divider',
            }}
          >
            <Typography variant="body2" fontWeight={700}>{row.displayName}</Typography>
            <Typography variant="caption" color="text.secondary">Open {row.openCount}</Typography>
            <Typography variant="caption" color={row.overdueCount > 0 ? 'error.main' : 'text.secondary'}>OD {row.overdueCount}</Typography>
            <Typography variant="caption" color={row.dueTodayCount > 0 ? 'warning.main' : 'text.secondary'}>Today {row.dueTodayCount}</Typography>
            <Typography variant="caption" color={row.blockedCount > 0 ? 'error.main' : 'text.secondary'}>Blocked {row.blockedCount}</Typography>
            <Typography variant="caption" color={row.waitingExternalCount > 0 ? 'warning.main' : 'text.secondary'}>Waiting {row.waitingExternalCount}</Typography>
          </Box>
        ))}
      </Box>
    </Paper>
  );
}

export default function TasksPage() {
  const user = useAuthStore((s) => s.user);
  const qc = useQueryClient();
  const { data: staffList } = useStaffLookup();
  const { data: teamTree = [] } = useQuery({
    queryKey: ['org-settings', 'units', 'tree', 'tasks'],
    queryFn: () => orgSettingsApi.getOrgTree(),
    staleTime: 5 * 60 * 1000,
  });
  const flatUnits = useMemo(() => flattenUnits(teamTree), [teamTree]);

  const [scope, setScope] = useState<ScopeMode>('my');
  const [layout, setLayout] = useState<LayoutMode>('list');
  const [bucket, setBucket] = useState<BucketMode>('all');
  const [statusFilter, setStatusFilter] = useState<'' | TaskStatus>('');
  const [priorityFilter, setPriorityFilter] = useState<'' | TaskPriority>('');
  const [ownershipFilter, setOwnershipFilter] = useState<'' | TaskOwnershipFilter>('');
  const [teamFilter, setTeamFilter] = useState('');
  const [clinicianFilter, setClinicianFilter] = useState('');
  const [patientFilter, setPatientFilter] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [assignTo, setAssignTo] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [viewTask, setViewTask] = useState<Task | null>(null);
  const [editTask, setEditTask] = useState<Task | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editPriority, setEditPriority] = useState<TaskPriority>('medium');
  const [editAssign, setEditAssign] = useState('');
  const [editDueDate, setEditDueDate] = useState('');
  const [editStatus, setEditStatus] = useState<TaskStatus>('pending');
  const [showArchive, setShowArchive] = useState(false);
  const [signTask, setSignTask] = useState<Task | null>(null);
  const { signature: savedSignature } = useStaffSignature();

  const taskQuery = useMemo(() => buildScopeQuery({
    scope,
    userId: user?.id,
    teamId: teamFilter,
    bucket,
    status: statusFilter,
    priority: priorityFilter,
    ownership: ownershipFilter,
    clinicianId: scope === 'team' ? clinicianFilter : '',
  }), [bucket, clinicianFilter, ownershipFilter, priorityFilter, scope, statusFilter, teamFilter, user?.id]);

  const { data: openTasks = [], isLoading, isError } = useTasks(taskQuery);
  const { data: completedTasks = [] } = useTasks({
    ...(scope === 'my' ? { assignedToId: user?.id } : teamFilter ? { teamId: teamFilter } : { teamScope: 'mine' as const }),
    ...(scope === 'team' && clinicianFilter ? { assignedToId: clinicianFilter } : {}),
    status: 'completed',
  });
  const { data: summary } = useTaskSummary({
    ...(scope === 'my' ? { assignedToId: user?.id } : teamFilter ? { teamId: teamFilter } : { teamScope: 'mine' as const }),
    ...(scope === 'team' && clinicianFilter ? { assignedToId: clinicianFilter } : {}),
  });

  const displayTasks = useMemo(
    () => openTasks.filter((task) => (
      !patientFilter || task.patientName?.toLowerCase().includes(patientFilter.toLowerCase())
    )),
    [openTasks, patientFilter],
  );

  const boardColumns = useMemo(
    () => BOARD_STATUSES.map((status) => ({
      status,
      label: humanizeTaskStatus(status),
      tasks: displayTasks.filter((task) => task.status === status),
    })),
    [displayTasks],
  );

  const createMut = useMutation({
    mutationFn: (dto: {
      title: string;
      description?: string;
      priority: TaskPriority;
      assignedToId?: string;
      dueDate?: string;
    }) => apiClient.post('tasks', dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: tasksKeys.all });
      setAddOpen(false);
      setTitle('');
      setDescription('');
      setAssignTo('');
      setDueDate('');
      setPriority('medium');
    },
  });

  const updateMut = useMutation({
    mutationFn: (payload: {
      id: string;
      title?: string;
      description?: string | null;
      priority?: TaskPriority;
      assignedToId?: string | null;
      dueDate?: string | null;
      status?: TaskStatus;
    }) => apiClient.patch(`tasks/${payload.id}`, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: tasksKeys.all });
      setEditTask(null);
    },
  });

  const completeMut = useMutation({
    mutationFn: (id: string) => apiClient.patch(`tasks/${id}`, { status: 'completed' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: tasksKeys.all });
    },
  });

  const signMut = useMutation({
    mutationFn: async (task: Task) => {
      const taskType = getTaskType(task);
      const episodeMatch = task.description?.match(/episode\s+([0-9a-f-]{36})/i);
      const episodeId = episodeMatch?.[1] ?? task.related_entity_id ?? task.episodeId;
      if (taskType === 'discharge_review' && episodeId) {
        await apiClient.post(`episodes/${episodeId}/discharge-summary/sign`, { signature: savedSignature });
      } else if (taskType === 'closure_review' && episodeId) {
        await apiClient.post(`episodes/${episodeId}/close-sign`, { signature: savedSignature });
      }
      await apiClient.patch(`tasks/${task.id}`, { status: 'completed' });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: tasksKeys.all });
      setSignTask(null);
    },
    onError: (error: unknown) => window.alert(`Sign failed: ${formatTaskMutationError(error)}`),
  });

  const handleComplete = (task: Task) => {
    const taskType = getTaskType(task);
    if (taskType === 'discharge_review' || taskType === 'closure_review') {
      if (savedSignature) {
        signMut.mutate(task);
      } else {
        setSignTask(task);
      }
      return;
    }
    completeMut.mutate(task.id);
  };

  return (
    <Box sx={{ px: { xs: 2, sm: 3, md: 4 }, py: 3, bgcolor: '#FBF8F5', minHeight: '100vh' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', mb: 3, gap: 2, flexWrap: 'wrap' }}>
        <Box>
          <Typography variant="h5" fontWeight={800} fontFamily="Albert Sans, sans-serif" sx={{ color: '#3D484B' }}>
            Clinical Task Workbench
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Own the next action, track what is blocked, and monitor follow-up drift across the team.
          </Typography>
        </Box>
        <Button
          startIcon={<AddIcon />}
          variant="contained"
          onClick={() => setAddOpen(true)}
          sx={{ bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' } }}
        >
          New Task
        </Button>
      </Box>

      <Tabs value={scope} onChange={(_, value) => setScope(value)} sx={{ mb: 2, '& .MuiTab-root': { textTransform: 'none' } }}>
        <Tab label="My Tasks" value="my" />
        <Tab label="Team Tasks" value="team" />
      </Tabs>

      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid size={{ xs: 12, lg: 8 }}>
          <Paper variant="outlined" sx={{ p: 2.25, borderRadius: 3 }}>
            <Typography variant="subtitle1" fontWeight={800} sx={{ mb: 1.5 }}>
              Workbench buckets
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 2 }}>
              {BUCKET_OPTIONS.map((option) => (
                <Chip
                  key={option.value}
                  label={option.label}
                  color={bucket === option.value ? 'primary' : 'default'}
                  variant={bucket === option.value ? 'filled' : 'outlined'}
                  onClick={() => setBucket(option.value)}
                />
              ))}
            </Box>

            <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
              <TextField
                size="small"
                placeholder="Filter by patient..."
                value={patientFilter}
                onChange={(event) => setPatientFilter(event.target.value)}
                sx={{ minWidth: 180, '& .MuiOutlinedInput-root': { bgcolor: '#fff' } }}
              />
              {scope === 'team' && (
                <FormControl size="small" sx={{ minWidth: 180 }}>
                  <InputLabel>Clinician</InputLabel>
                  <Select value={clinicianFilter} onChange={(event) => setClinicianFilter(event.target.value)} label="Clinician" sx={{ bgcolor: '#fff' }}>
                    <MenuItem value="">All clinicians</MenuItem>
                    {(staffList ?? []).map((staff) => (
                      <MenuItem key={staff.id} value={staff.id}>
                        {staff.givenName} {staff.familyName}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              )}
              {scope === 'team' && (
                <FormControl size="small" sx={{ minWidth: 180 }}>
                  <InputLabel>Team</InputLabel>
                  <Select value={teamFilter} onChange={(event) => setTeamFilter(event.target.value)} label="Team" sx={{ bgcolor: '#fff' }}>
                    <MenuItem value="">My teams</MenuItem>
                    {flatUnits.map((unit) => (
                      <MenuItem key={unit.id} value={unit.id}>{unit.name}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              )}
              <FormControl size="small" sx={{ minWidth: 170 }}>
                <InputLabel>Status</InputLabel>
                <Select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as '' | TaskStatus)} label="Status" sx={{ bgcolor: '#fff' }}>
                  {STATUS_OPTIONS.map((option) => (
                    <MenuItem key={option.label} value={option.value}>{option.label}</MenuItem>
                  ))}
                </Select>
              </FormControl>
              <FormControl size="small" sx={{ minWidth: 160 }}>
                <InputLabel>Priority</InputLabel>
                <Select value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value as '' | TaskPriority)} label="Priority" sx={{ bgcolor: '#fff' }}>
                  {PRIORITY_OPTIONS.map((option) => (
                    <MenuItem key={option.label} value={option.value}>{option.label}</MenuItem>
                  ))}
                </Select>
              </FormControl>
              <FormControl size="small" sx={{ minWidth: 160 }}>
                <InputLabel>Ownership</InputLabel>
                <Select value={ownershipFilter} onChange={(event) => setOwnershipFilter(event.target.value as '' | TaskOwnershipFilter)} label="Ownership" sx={{ bgcolor: '#fff' }}>
                  {OWNERSHIP_OPTIONS.map((option) => (
                    <MenuItem key={option.label} value={option.value}>{option.label}</MenuItem>
                  ))}
                </Select>
              </FormControl>
              <FormControl size="small" sx={{ minWidth: 150 }}>
                <InputLabel>Layout</InputLabel>
                <Select value={layout} onChange={(event) => setLayout(event.target.value as LayoutMode)} label="Layout" sx={{ bgcolor: '#fff' }}>
                  <MenuItem value="list">List</MenuItem>
                  <MenuItem value="board">Board</MenuItem>
                </Select>
              </FormControl>
            </Box>
          </Paper>
        </Grid>
        <Grid size={{ xs: 12, lg: 4 }}>
          <MonitoringPanel
            summary={summary}
            title={scope === 'my' ? 'My monitoring snapshot' : 'Team monitoring snapshot'}
            subtitle={scope === 'my'
              ? 'Track what needs attention before it silently becomes overdue.'
              : 'Use this to spot unowned work, blocked follow-up, and overload before governance drifts.'}
          />
        </Grid>
      </Grid>

      {isError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Failed to load tasks.
        </Alert>
      )}

      {isLoading ? (
        <Alert severity="info">Loading tasks…</Alert>
      ) : displayTasks.length === 0 ? (
        <Alert severity="info">No open tasks match the current workbench filters.</Alert>
      ) : layout === 'list' ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
          {displayTasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              onView={setViewTask}
              onEdit={(selectedTask) => {
                setEditTask(selectedTask);
                setEditTitle(selectedTask.title);
                setEditDescription(selectedTask.description ?? '');
                setEditPriority(selectedTask.priority);
                setEditAssign(selectedTask.assignedToId ?? '');
                setEditDueDate(selectedTask.dueDate ?? '');
                setEditStatus(selectedTask.status);
              }}
              onComplete={handleComplete}
            />
          ))}
        </Box>
      ) : (
        <Grid container spacing={2}>
          {boardColumns.map((column) => (
            <Grid key={column.status} size={{ xs: 12, md: 6, lg: 4, xl: 3 }}>
              <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 3, minHeight: 220, bgcolor: '#FCFBF9' }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                  <Typography variant="subtitle2" fontWeight={800}>
                    {column.label}
                  </Typography>
                  <Chip label={column.tasks.length} size="small" />
                </Box>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  {column.tasks.length === 0 ? (
                    <Typography variant="caption" color="text.secondary">No tasks in this lane.</Typography>
                  ) : (
                    column.tasks.map((task) => (
                      <Paper key={task.id} variant="outlined" sx={{ p: 1.25, borderRadius: 2 }}>
                        <Typography variant="body2" fontWeight={700}>{task.title}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          {task.assignedToName ?? 'Unassigned'}{task.dueDate ? ` · ${task.dueDate}` : ''}
                        </Typography>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 0.75 }}>
                          <Chip label={task.priority} size="small" color={priorityTone(task.priority)} sx={{ textTransform: 'capitalize' }} />
                          <Button size="small" onClick={() => setViewTask(task)} sx={{ textTransform: 'none' }}>
                            View
                          </Button>
                        </Box>
                      </Paper>
                    ))
                  )}
                </Box>
              </Paper>
            </Grid>
          ))}
        </Grid>
      )}

      <Box sx={{ mt: 3 }}>
        <Button
          onClick={() => setShowArchive((current) => !current)}
          size="small"
          sx={{ color: '#757575', textTransform: 'none', fontWeight: 700 }}
        >
          Completed ({completedTasks.length}) {showArchive ? '▲' : '▼'}
        </Button>
        {showArchive && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75, mt: 1 }}>
            {completedTasks.slice(0, 20).map((task) => (
              <Card key={task.id} variant="outlined" sx={{ opacity: 0.72, borderLeft: '4px solid #2E7D32' }}>
                <CardContent sx={{ py: 1, '&:last-child': { pb: 1 }, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Box>
                    <Typography variant="body2" sx={{ textDecoration: 'line-through' }}>{task.title}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {task.completedAt ? new Date(task.completedAt).toLocaleDateString('en-AU') : ''}
                    </Typography>
                  </Box>
                  <Tooltip title="View task">
                    <IconButton size="small" onClick={() => setViewTask(task)}>
                      <VisibilityOutlinedIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </CardContent>
              </Card>
            ))}
          </Box>
        )}
      </Box>

      <Dialog open={addOpen} onClose={() => setAddOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>New Task</DialogTitle>
        <Divider />
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 0.5 }}>
            <Grid size={{ xs: 12 }}>
              <TextField autoFocus label="Task title *" fullWidth size="small" value={title} onChange={(event) => setTitle(event.target.value)} />
            </Grid>
            <Grid size={{ xs: 12 }}>
              <TextField label="Description" fullWidth size="small" multiline rows={2} value={description} onChange={(event) => setDescription(event.target.value)} />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <FormControl fullWidth size="small">
                <InputLabel>Priority</InputLabel>
                <Select value={priority} onChange={(event) => setPriority(event.target.value as TaskPriority)} label="Priority">
                  {PRIORITY_OPTIONS.filter((option) => option.value).map((option) => (
                    <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <FormControl fullWidth size="small">
                <InputLabel>Assign to</InputLabel>
                <Select value={assignTo} onChange={(event) => setAssignTo(event.target.value)} label="Assign to">
                  <MenuItem value="">Unassigned</MenuItem>
                  {(staffList ?? []).map((staff) => (
                    <MenuItem key={staff.id} value={staff.id}>{staff.givenName} {staff.familyName}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <TextField label="Due date" type="date" fullWidth size="small" value={dueDate} onChange={(event) => setDueDate(event.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
            </Grid>
          </Grid>
        </DialogContent>
        <Divider />
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setAddOpen(false)} sx={{ color: 'text.secondary' }}>Cancel</Button>
          <Button
            variant="contained"
            onClick={() => createMut.mutate({
              title: title.trim(),
              description: description.trim() || undefined,
              priority,
              assignedToId: assignTo || undefined,
              dueDate: dueDate || undefined,
            })}
            disabled={!title.trim() || createMut.isPending}
            sx={{ bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' } }}
          >
            Create task
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!viewTask} onClose={() => setViewTask(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Task details</DialogTitle>
        <DialogContent>
          {viewTask && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
              <Typography variant="subtitle1" fontWeight={700}>{viewTask.title}</Typography>
              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', bgcolor: '#F7F8FA', p: 1.25, borderRadius: 1, border: '1px solid #E0E0E0' }}>
                {viewTask.description?.trim() ? viewTask.description : 'No description'}
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                <Chip label={`Status: ${humanizeTaskStatus(viewTask.status)}`} size="small" />
                <Chip label={`Priority: ${viewTask.priority}`} size="small" />
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

      {signTask && (
        <DigitalSignatureDialog
          open={!!signTask}
          onClose={() => setSignTask(null)}
          onSign={() => signMut.mutate(signTask)}
          signerName={`${user?.givenName ?? ''} ${user?.familyName ?? ''}`}
          documentTitle={signTask.title}
          savedSignature={savedSignature}
        />
      )}

      <Dialog open={!!editTask} onClose={() => setEditTask(null)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>Edit Task</DialogTitle>
        <Divider />
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 0.5 }}>
            <Grid size={{ xs: 12 }}>
              <TextField label="Title" fullWidth size="small" value={editTitle} onChange={(event) => setEditTitle(event.target.value)} />
            </Grid>
            <Grid size={{ xs: 12 }}>
              <TextField label="Description" fullWidth size="small" multiline rows={3} value={editDescription} onChange={(event) => setEditDescription(event.target.value)} />
            </Grid>
            <Grid size={{ xs: 12, sm: 3 }}>
              <FormControl fullWidth size="small">
                <InputLabel>Priority</InputLabel>
                <Select value={editPriority} onChange={(event) => setEditPriority(event.target.value as TaskPriority)} label="Priority">
                  {PRIORITY_OPTIONS.filter((option) => option.value).map((option) => (
                    <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 12, sm: 3 }}>
              <FormControl fullWidth size="small">
                <InputLabel>Assign to</InputLabel>
                <Select value={editAssign} onChange={(event) => setEditAssign(event.target.value)} label="Assign to">
                  <MenuItem value="">Unassigned</MenuItem>
                  {(staffList ?? []).map((staff) => (
                    <MenuItem key={staff.id} value={staff.id}>{staff.givenName} {staff.familyName}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 12, sm: 3 }}>
              <TextField label="Due date" type="date" fullWidth size="small" value={editDueDate} onChange={(event) => setEditDueDate(event.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
            </Grid>
            <Grid size={{ xs: 12, sm: 3 }}>
              <FormControl fullWidth size="small">
                <InputLabel>Status</InputLabel>
                <Select value={editStatus} onChange={(event) => setEditStatus(event.target.value as TaskStatus)} label="Status">
                  {STATUS_OPTIONS.filter((option) => option.value).map((option) => (
                    <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setEditTask(null)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={() => editTask && updateMut.mutate({
              id: editTask.id,
              title: editTitle || undefined,
              description: editDescription || null,
              priority: editPriority,
              assignedToId: editAssign || null,
              dueDate: editDueDate || null,
              status: editStatus,
            })}
            sx={{ bgcolor: '#2563EB', '&:hover': { bgcolor: '#1D4ED8' } }}
          >
            Save changes
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
