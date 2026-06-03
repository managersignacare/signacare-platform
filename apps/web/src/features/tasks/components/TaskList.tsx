import React, { useState } from 'react';
import {
  Box,
  Typography,
  Chip,
  Button,
  IconButton,
  Tooltip,
  CircularProgress,
  Alert,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  TextField,
  MenuItem,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import { useTasks, useCompleteTask, useDeleteTask } from '../hooks/useTasks';
import type { TaskResponseView as TaskResponse, TaskPriority } from '../types/taskTypes';
import { unstyledButtonSx } from '../../../shared/styles/unstyledButton';

const OVERDUE_COLOR = '#F0852C';


type PriorityChipColor = 'error' | 'warning' | 'info' | 'default';
const PRIORITY_COLOR: Record<TaskPriority, PriorityChipColor> = {
  urgent: 'error',
  high: 'warning',
  medium: 'info',
  low: 'default',
};

const isOverdue = (task: TaskResponse): boolean => {
  if (!task.dueDate || task.status === 'completed' || task.status === 'cancelled') return false;
  return new Date(task.dueDate) < new Date(new Date().toDateString());
};

interface Props {
  patientId?: string;
  assignedToId?: string;
  onNewTask: () => void;
  onEditTask: (task: TaskResponse) => void;
}

export const TaskList: React.FC<Props> = ({
  patientId,
  assignedToId,
  onNewTask,
  onEditTask,
}) => {
  const [statusFilter, setStatusFilter] = useState('open');
  const { data: tasks, isLoading, isError } = useTasks({
    patientId,
    assignedToId,
    status: statusFilter || undefined,
  });
  const completeMutation = useCompleteTask();
  const deleteMutation = useDeleteTask();

  if (isLoading) return <CircularProgress role="progressbar" aria-label="Loading" size={24} />;
  if (isError) return <Alert role="alert" severity="error">Failed to load tasks.</Alert>;

  const grouped = (tasks ?? []).reduce<Record<TaskPriority, TaskResponse[]>>(
    (acc, task) => {
      acc[task.priority].push(task);
      return acc;
    },
    { urgent: [], high: [], medium: [], low: [] },
  );

  const priorityOrder: TaskPriority[] = ['urgent', 'high', 'medium', 'low'];

  return (
    <Box>
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          mb: 2,
          gap: 2,
          flexWrap: 'wrap',
        }}
      >
        <Typography variant="h6">Tasks</Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <TextField
            select
            size="small"
            label="Status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            sx={{ minWidth: 130 }}
          >
            <MenuItem value="">All</MenuItem>
            <MenuItem value="open">Open</MenuItem>
            <MenuItem value="in_progress">In Progress</MenuItem>
            <MenuItem value="completed">Completed</MenuItem>
          </TextField>
          <Button variant="contained" size="small" onClick={onNewTask}>
            New Task
          </Button>
        </Box>
      </Box>

      {tasks?.length === 0 && (
        <Typography variant="body2" color="text.secondary">
          No tasks found.
        </Typography>
      )}

      {priorityOrder.map((priority) => {
        const group = grouped[priority];
        if (group.length === 0) return null;

        return (
          <Accordion key={priority} defaultExpanded={priority === 'urgent' || priority === 'high'}>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Chip
                  label={priority.toUpperCase()}
                  size="small"
                  color={PRIORITY_COLOR[priority]}
                />
                <Typography variant="subtitle2">{group.length} task{group.length !== 1 ? 's' : ''}</Typography>
              </Box>
            </AccordionSummary>
            <AccordionDetails sx={{ p: 0 }}>
              {group
                .sort((a, b) => {
                  if (isOverdue(a) && !isOverdue(b)) return -1;
                  if (!isOverdue(a) && isOverdue(b)) return 1;
                  return 0;
                })
                .map((task: TaskResponse) => {
                  const overdue = isOverdue(task);
                  return (
                    <Box
                      key={task.id}
                      sx={{
                        px: 2,
                        py: 1.5,
                        borderBottom: '1px solid',
                        borderColor: 'divider',
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 1,
                        bgcolor: overdue ? `${OVERDUE_COLOR}12` : 'transparent',
                        '&:hover': { bgcolor: overdue ? `${OVERDUE_COLOR}20` : 'action.hover' },
                      }}
                    >
                      <Box
                        component="button"
                        type="button"
                        aria-label={`Edit task: ${task.title}${overdue ? ' (overdue)' : ''}`}
                        onClick={() => onEditTask(task)}
                        sx={{ flex: 1, ...unstyledButtonSx, '&:focus-visible': { outline: '2px solid #b8621a', outlineOffset: 2, borderRadius: 1 } }}>
                        <Typography
                          variant="body2"
                          fontWeight={500}
                          sx={{ color: overdue ? OVERDUE_COLOR : 'text.primary' }}
                        >
                          {task.title}
                          {overdue && (
                            <Chip
                              label="OVERDUE"
                              size="small"
                              sx={{
                                ml: 1,
                                bgcolor: OVERDUE_COLOR,
                                color: '#fff',
                                height: 18,
                                fontSize: 10,
                              }}
                            />
                          )}
                        </Typography>
                        <Box sx={{ display: 'flex', gap: 1, mt: 0.5, flexWrap: 'wrap' }}>
                          {task.assignedToName && (
                            <Typography variant="caption" color="text.secondary">
                              → {task.assignedToName}
                            </Typography>
                          )}
                          {task.dueDate && (
                            <Typography
                              variant="caption"
                              sx={{ color: overdue ? OVERDUE_COLOR : 'text.secondary' }}
                            >
                              Due: {task.dueDate}
                            </Typography>
                          )}
                          {task.patientName && (
                            <Typography variant="caption" color="text.secondary">
                              Patient: {task.patientName}
                            </Typography>
                          )}
                          {/* Audit Tier 9.5 — typed access via TaskResponseView.task_type */}
                          {task.task_type && <Chip label={task.task_type.replace('_', ' ')} size="small" variant="outlined" sx={{ height: 18, fontSize: 10, textTransform: 'capitalize' }} />}
                        </Box>
                      </Box>
                      <Box sx={{ display: 'flex', gap: 0.5 }}>
                        {task.status !== 'completed' && (
                          <Tooltip title="Mark complete">
                            <span>
                              <IconButton
                                size="small"
                                onClick={() => completeMutation.mutate(task.id)}
                                disabled={completeMutation.isPending}
                              >
                                <CheckCircleOutlineIcon fontSize="small" color="success" />
                              </IconButton>
                            </span>
                          </Tooltip>
                        )}
                        <Tooltip title="Delete task">
                          <span>
                            <IconButton
                              size="small"
                              onClick={() => deleteMutation.mutate(task.id)}
                              disabled={deleteMutation.isPending}
                            >
                              <DeleteOutlineIcon fontSize="small" color="error" />
                            </IconButton>
                          </span>
                        </Tooltip>
                      </Box>
                    </Box>
                  );
                })}
            </AccordionDetails>
          </Accordion>
        );
      })}
    </Box>
  );
};
