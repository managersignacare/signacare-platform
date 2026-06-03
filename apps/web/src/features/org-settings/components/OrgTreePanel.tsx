import React from 'react'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import { apiClient } from '../../../shared/services/apiClient'
import { orgSettingsKeys } from '../queryKeys'
import AddIcon from '@mui/icons-material/Add'
import EditIcon from '@mui/icons-material/Edit'
import DeleteIcon from '@mui/icons-material/Delete'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import {
  useOrgTree,
  useLevelLabels,
  useCreateOrgUnit,
  useUpdateOrgUnit,
  useDeleteOrgUnit,
  usePrograms,
  useAssignProgram,
  useUnassignProgram,
} from '../hooks/useOrgSettings'
import type { OrgUnit } from '../services/orgSettingsApi'

interface OrgUnitWithLeadership extends OrgUnit {
  teamLeaderId?: string | null
  managerId?: string | null
  managementStaff1Id?: string | null
  managementStaff2Id?: string | null
  managementStaff3Id?: string | null
}

interface StaffLookupItem {
  id: string
  givenName: string
  familyName: string
}

interface ErrorWithMessage {
  message?: string
  response?: { data?: { error?: string } }
}

function getErrorMessage(error: unknown, fallback: string): string {
  const e = error as ErrorWithMessage
  return e.response?.data?.error ?? e.message ?? fallback
}

// --- Tree Node ---

interface TreeNodeProps {
  node: OrgUnitWithLeadership
  levelLabels: Map<number, string>
  onAdd: (parentId: string, parentLevel: number) => void
  onEdit: (unit: OrgUnitWithLeadership) => void
  onDelete: (id: string, name: string) => void
  programs: { id: string; name: string }[]
  onAssign: (orgUnitId: string) => void
  onUnassign: (orgUnitId: string, programId: string) => void
}

function TreeNode({ node, levelLabels, onAdd, onEdit, onDelete, programs, onAssign, onUnassign }: TreeNodeProps) {
  const [open, setOpen] = React.useState(true)
  const hasChildren = (node.children?.length ?? 0) > 0
  const levelLabel = levelLabels.get(node.level) ?? `Level ${node.level}`

  return (
    <Box sx={{ ml: node.level > 1 ? 3 : 0 }}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          py: 0.5,
          px: 1,
          borderRadius: 1,
          '&:hover': { bgcolor: 'action.hover' },
        }}
      >
        {hasChildren ? (
          <IconButton size="small" onClick={() => setOpen(!open)} sx={{ mr: 0.5 }}>
            {open ? <ExpandMoreIcon fontSize="small" /> : <ChevronRightIcon fontSize="small" />}
          </IconButton>
        ) : (
          <Box sx={{ width: 32 }} />
        )}

        <Box sx={{ flexGrow: 1 }}>
          <Typography variant="body2" fontWeight={600} component="span">
            {node.name}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
            {levelLabel}
          </Typography>
          {!node.isActive && (
            <Chip label="Inactive" size="small" color="default" sx={{ ml: 1, height: 20, fontSize: '0.65rem' }} />
          )}
          {node.programs?.map((p) => (
            <Chip
              key={p.id}
              label={p.name}
              size="small"
              color="primary"
              variant="outlined"
              onDelete={() => onUnassign(node.id, p.id)}
              sx={{ ml: 0.5, height: 20, fontSize: '0.65rem' }}
            />
          ))}
        </Box>

        <Tooltip title="Assign program">
          <IconButton size="small" onClick={() => onAssign(node.id)} color="primary">
            <Chip label="+" size="small" sx={{ cursor: 'pointer', height: 20, minWidth: 20 }} />
          </IconButton>
        </Tooltip>

        {node.level < 10 && (
          <Tooltip title={`Add child under ${node.name}`}>
            <IconButton size="small" onClick={() => onAdd(node.id, node.level)} color="primary">
              <AddIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
        <Tooltip title="Edit">
          <IconButton size="small" onClick={() => onEdit(node)}>
            <EditIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="Delete">
          <IconButton size="small" onClick={() => onDelete(node.id, node.name)} color="error">
            <DeleteIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>

      {hasChildren && (
        <Collapse in={open}>
          {node.children!.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              levelLabels={levelLabels}
              onAdd={onAdd}
              onEdit={onEdit}
              onDelete={onDelete}
              programs={programs}
              onAssign={onAssign}
              onUnassign={onUnassign}
            />
          ))}
        </Collapse>
      )}
    </Box>
  )
}

// --- Main Panel ---

export const OrgTreePanel: React.FC = () => {
  const { data: tree, isLoading } = useOrgTree()
  const { data: labels } = useLevelLabels()
  const { data: programs } = usePrograms()
  const { data: staffList } = useQuery({ queryKey: orgSettingsKeys.staffLookup(), queryFn: () => apiClient.get<StaffLookupItem[]>('staff/lookup'), staleTime: 5 * 60 * 1000 })
  const { mutateAsync: createUnit } = useCreateOrgUnit()
  const { mutateAsync: updateUnit } = useUpdateOrgUnit()
  const { mutateAsync: deleteUnit } = useDeleteOrgUnit()
  const { mutateAsync: assign } = useAssignProgram()
  const { mutateAsync: unassign } = useUnassignProgram()

  const [addDialog, setAddDialog] = React.useState<{ parentId: string | null; level: number } | null>(null)
  const [editDialog, setEditDialog] = React.useState<OrgUnitWithLeadership | null>(null)
  const [deleteDialog, setDeleteDialog] = React.useState<{ id: string; name: string } | null>(null)
  const [assignDialog, setAssignDialog] = React.useState<string | null>(null) // orgUnitId
  const [newName, setNewName] = React.useState('')
  const [editName, setEditName] = React.useState('')
  const [editLeader, setEditLeader] = React.useState('')
  const [editManager, setEditManager] = React.useState('')
  const [editMgmt1, setEditMgmt1] = React.useState('')
  const [editMgmt2, setEditMgmt2] = React.useState('')
  const [editMgmt3, setEditMgmt3] = React.useState('')
  const [selectedProgramId, setSelectedProgramId] = React.useState('')
  const [createPending, setCreatePending] = React.useState(false)
  const [createError, setCreateError] = React.useState<string | null>(null)

  const levelLabels = React.useMemo(() => {
    const m = new Map<number, string>()
    if (labels) {
      for (const l of labels) m.set(l.level, l.label)
    }
    return m
  }, [labels])

  const handleAddRoot = () => {
    setAddDialog({ parentId: null, level: 1 })
    setNewName('')
    setCreateError(null)
  }

  const handleAddChild = (parentId: string, parentLevel: number) => {
    const normalizedParentLevel = Number.isFinite(parentLevel) ? parentLevel : 1
    setAddDialog({ parentId, level: normalizedParentLevel + 1 })
    setNewName('')
    setCreateError(null)
  }

  const handleCreate = async () => {
    if (!addDialog || !newName.trim()) return
    setCreatePending(true)
    setCreateError(null)
    try {
      await createUnit({ parentId: addDialog.parentId, name: newName.trim(), level: addDialog.level })
      setAddDialog(null)
    } catch (error) {
      setCreateError(getErrorMessage(error, 'Failed to create subsite. Please try again.'))
    } finally {
      setCreatePending(false)
    }
  }

  const handleEdit = (unit: OrgUnitWithLeadership) => {
    setEditDialog(unit)
    setEditName(unit.name)
    setEditLeader(unit.teamLeaderId ?? '')
    setEditManager(unit.managerId ?? '')
    setEditMgmt1(unit.managementStaff1Id ?? '')
    setEditMgmt2(unit.managementStaff2Id ?? '')
    setEditMgmt3(unit.managementStaff3Id ?? '')
  }

  const handleUpdate = async () => {
    if (!editDialog || !editName.trim()) return
    await updateUnit({ id: editDialog.id, data: {
      name: editName.trim(),
      teamLeaderId: editLeader || null,
      managerId: editManager || null,
      managementStaff1Id: editMgmt1 || null,
      managementStaff2Id: editMgmt2 || null,
      managementStaff3Id: editMgmt3 || null,
    } })
    setEditDialog(null)
  }

  const handleDelete = async () => {
    if (!deleteDialog) return
    await deleteUnit(deleteDialog.id)
    setDeleteDialog(null)
  }

  const handleAssign = async () => {
    if (!assignDialog || !selectedProgramId) return
    await assign({ orgUnitId: assignDialog, programId: selectedProgramId })
    setAssignDialog(null)
    setSelectedProgramId('')
  }

  const handleUnassign = async (orgUnitId: string, programId: string) => {
    await unassign({ orgUnitId, programId })
  }

  if (isLoading) return <CircularProgress role="progressbar" aria-label="Loading" />

  return (
    <Card variant="outlined">
      <CardContent>
        <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
          <Box>
            <Typography variant="h6">Organisation Hierarchy</Typography>
            <Typography variant="body2" color="text.secondary">
              Build your org tree up to 10 levels. Assign programs to any unit.
            </Typography>
          </Box>
          <Button variant="contained" startIcon={<AddIcon />} onClick={handleAddRoot}>
            Add Root Unit
          </Button>
        </Box>

        {(!tree || tree.length === 0) ? (
          <Alert severity="info">
            No organisation units yet. Click &quot;Add Root Unit&quot; to create the first level.
          </Alert>
        ) : (
          tree.map((node) => (
            <TreeNode
              key={node.id}
              node={node}
              levelLabels={levelLabels}
              onAdd={handleAddChild}
              onEdit={handleEdit}
              onDelete={(id, name) => setDeleteDialog({ id, name })}
              programs={programs ?? []}
              onAssign={(id) => { setAssignDialog(id); setSelectedProgramId('') }}
              onUnassign={handleUnassign}
            />
          ))
        )}
      </CardContent>

      {/* Add Dialog */}
      <Dialog aria-labelledby="dialog-title" open={!!addDialog} onClose={() => setAddDialog(null)} maxWidth="xs" fullWidth>
        <DialogTitle id="dialog-title">
          Add {levelLabels.get(addDialog?.level ?? 1) ?? `Level ${addDialog?.level ?? 1}`} Unit
        </DialogTitle>
        <DialogContent>
          {createError && <Alert severity="error" sx={{ mt: 1 }}>{createError}</Alert>}
          <TextField
            autoFocus
            label="Name"
            fullWidth
            size="small"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddDialog(null)}>Cancel</Button>
          <Button variant="contained" onClick={handleCreate} disabled={!newName.trim() || createPending}>
            {createPending ? 'Creating...' : 'Create'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog aria-labelledby="dialog-title" open={!!editDialog} onClose={() => setEditDialog(null)} maxWidth="xs" fullWidth>
        <DialogTitle id="dialog-title">Edit Unit</DialogTitle>
        <DialogContent>
          <TextField autoFocus label="Name" fullWidth size="small" value={editName} onChange={(e) => setEditName(e.target.value)} sx={{ mt: 1, mb: 2 }} />
          <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1, color: '#327C8D' }}>Management Staff</Typography>
          {[
            { label: 'Team Leader', value: editLeader, setter: setEditLeader },
            { label: 'Manager', value: editManager, setter: setEditManager },
            { label: 'Management Staff 1', value: editMgmt1, setter: setEditMgmt1 },
            { label: 'Management Staff 2', value: editMgmt2, setter: setEditMgmt2 },
            { label: 'Management Staff 3', value: editMgmt3, setter: setEditMgmt3 },
          ].map(f => (
            <FormControl key={f.label} fullWidth size="small" sx={{ mb: 1 }}>
              <InputLabel>{f.label}</InputLabel>
              <Select value={f.value} onChange={e => f.setter(e.target.value)} label={f.label}>
                <MenuItem value="">— None —</MenuItem>
                {(staffList ?? []).map((s) => <MenuItem key={s.id} value={s.id}>{s.givenName} {s.familyName}</MenuItem>)}
              </Select>
            </FormControl>
          ))}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditDialog(null)}>Cancel</Button>
          <Button variant="contained" onClick={handleUpdate} disabled={!editName.trim()}>
            Save
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete Dialog */}
      <Dialog aria-labelledby="dialog-title" open={!!deleteDialog} onClose={() => setDeleteDialog(null)} maxWidth="xs" fullWidth>
        <DialogTitle id="dialog-title">Delete Unit</DialogTitle>
        <DialogContent>
          <Typography>
            Delete &quot;{deleteDialog?.name}&quot; and all its children? This cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialog(null)}>Cancel</Button>
          <Button variant="contained" color="error" onClick={handleDelete}>
            Delete
          </Button>
        </DialogActions>
      </Dialog>

      {/* Assign Program Dialog */}
      <Dialog aria-labelledby="dialog-title" open={!!assignDialog} onClose={() => setAssignDialog(null)} maxWidth="xs" fullWidth>
        <DialogTitle id="dialog-title">Assign Program</DialogTitle>
        <DialogContent>
          <TextField
            select
            label="Program"
            fullWidth
            size="small"
            value={selectedProgramId}
            onChange={(e) => setSelectedProgramId(e.target.value)}
            sx={{ mt: 1 }}
          >
            {(programs ?? []).map((p) => (
              <MenuItem key={p.id} value={p.id}>
                {p.name}
              </MenuItem>
            ))}
          </TextField>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAssignDialog(null)}>Cancel</Button>
          <Button variant="contained" onClick={handleAssign} disabled={!selectedProgramId}>
            Assign
          </Button>
        </DialogActions>
      </Dialog>
    </Card>
  )
}
