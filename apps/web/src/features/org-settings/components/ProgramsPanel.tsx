import React from 'react'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import EditIcon from '@mui/icons-material/Edit'
import DeleteIcon from '@mui/icons-material/Delete'
import {
  usePrograms,
  useCreateProgram,
  useUpdateProgram,
  useDeleteProgram,
} from '../hooks/useOrgSettings'
import type { Program } from '../services/orgSettingsApi'

export const ProgramsPanel: React.FC = () => {
  const { data: programs, isLoading } = usePrograms()
  const { mutateAsync: create } = useCreateProgram()
  const { mutateAsync: update } = useUpdateProgram()
  const { mutateAsync: remove } = useDeleteProgram()

  const [addOpen, setAddOpen] = React.useState(false)
  const [editItem, setEditItem] = React.useState<Program | null>(null)
  const [deleteItem, setDeleteItem] = React.useState<Program | null>(null)

  const [name, setName] = React.useState('')
  const [description, setDescription] = React.useState('')

  const handleCreate = async () => {
    if (!name.trim()) return
    await create({ name: name.trim(), description: description.trim() || undefined })
    setAddOpen(false)
    setName('')
    setDescription('')
  }

  const openEdit = (p: Program) => {
    setEditItem(p)
    setName(p.name)
    setDescription(p.description ?? '')
  }

  const handleUpdate = async () => {
    if (!editItem || !name.trim()) return
    await update({ id: editItem.id, data: { name: name.trim(), description: description.trim() || undefined } })
    setEditItem(null)
    setName('')
    setDescription('')
  }

  const handleDelete = async () => {
    if (!deleteItem) return
    await remove(deleteItem.id)
    setDeleteItem(null)
  }

  const handleToggleActive = async (p: Program) => {
    await update({ id: p.id, data: { isActive: !p.isActive } })
  }

  if (isLoading) return <CircularProgress role="progressbar" aria-label="Loading" />

  return (
    <Card variant="outlined">
      <CardContent>
        <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
          <Box>
            <Typography variant="h6">Programs</Typography>
            <Typography variant="body2" color="text.secondary">
              Manage programs that can be assigned to organisation units.
            </Typography>
          </Box>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => { setAddOpen(true); setName(''); setDescription('') }}
          >
            Add Program
          </Button>
        </Box>

        {(!programs || programs.length === 0) ? (
          <Alert severity="info">
            No programs yet. Click &quot;Add Program&quot; to create one.
          </Alert>
        ) : (
          <TableContainer role="region" aria-label="Data table">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Name</TableCell>
                  <TableCell>Description</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {programs.map((p) => (
                  <TableRow key={p.id} hover>
                    <TableCell>
                      <Typography variant="body2" fontWeight={500}>{p.name}</Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" color="text.secondary">
                        {p.description || '—'}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={p.isActive ? 'Active' : 'Inactive'}
                        size="small"
                        color={p.isActive ? 'success' : 'default'}
                        onClick={() => handleToggleActive(p)}
                        sx={{ cursor: 'pointer' }}
                      />
                    </TableCell>
                    <TableCell align="right">
                      <Tooltip title="Edit">
                        <IconButton size="small" onClick={() => openEdit(p)}>
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Delete">
                        <IconButton size="small" color="error" onClick={() => setDeleteItem(p)}>
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </CardContent>

      {/* Add Dialog */}
      <Dialog aria-labelledby="dialog-title" open={addOpen} onClose={() => setAddOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle id="dialog-title">Add Program</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '8px !important' }}>
          <TextField
            autoFocus
            label="Program Name"
            fullWidth
            size="small"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <TextField
            label="Description (optional)"
            fullWidth
            size="small"
            multiline
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleCreate} disabled={!name.trim()}>
            Create
          </Button>
        </DialogActions>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog aria-labelledby="dialog-title" open={!!editItem} onClose={() => setEditItem(null)} maxWidth="sm" fullWidth>
        <DialogTitle id="dialog-title">Edit Program</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '8px !important' }}>
          <TextField
            autoFocus
            label="Program Name"
            fullWidth
            size="small"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <TextField
            label="Description (optional)"
            fullWidth
            size="small"
            multiline
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditItem(null)}>Cancel</Button>
          <Button variant="contained" onClick={handleUpdate} disabled={!name.trim()}>
            Save
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete Dialog */}
      <Dialog aria-labelledby="dialog-title" open={!!deleteItem} onClose={() => setDeleteItem(null)} maxWidth="xs" fullWidth>
        <DialogTitle id="dialog-title">Delete Program</DialogTitle>
        <DialogContent>
          <Typography>
            Delete &quot;{deleteItem?.name}&quot;? This will also remove it from all org units.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteItem(null)}>Cancel</Button>
          <Button variant="contained" color="error" onClick={handleDelete}>
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Card>
  )
}
