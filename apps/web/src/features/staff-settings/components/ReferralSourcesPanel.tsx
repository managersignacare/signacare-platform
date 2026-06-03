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
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
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
  useReferralSources,
  useCreateReferralSource,
  useUpdateReferralSource,
  useDeleteReferralSource,
} from '../hooks/useStaffSettings'
import type { ReferralSource } from '../services/staffSettingsApi'

export const ReferralSourcesPanel: React.FC = () => {
  const { data: sources, isLoading } = useReferralSources()
  const { mutateAsync: create } = useCreateReferralSource()
  const { mutateAsync: update } = useUpdateReferralSource()
  const { mutateAsync: remove } = useDeleteReferralSource()

  const [addOpen, setAddOpen] = React.useState(false)
  const [editItem, setEditItem] = React.useState<ReferralSource | null>(null)
  const [deleteItem, setDeleteItem] = React.useState<ReferralSource | null>(null)
  const [name, setName] = React.useState('')
  const [category, setCategory] = React.useState<string>('external')

  const handleCreate = async () => {
    if (!name.trim()) return
    await create({ name: name.trim(), category })
    setAddOpen(false); setName(''); setCategory('external')
  }
  const handleUpdate = async () => {
    if (!editItem || !name.trim()) return
    await update({ id: editItem.id, data: { name: name.trim(), category } })
    setEditItem(null); setName(''); setCategory('external')
  }
  const handleDelete = async () => {
    if (!deleteItem) return
    await remove(deleteItem.id); setDeleteItem(null)
  }

  const internal = sources?.filter(s => s.category === 'internal') ?? []
  const external = sources?.filter(s => s.category === 'external') ?? []

  if (isLoading) return <CircularProgress role="progressbar" aria-label="Loading" />

  return (
    <Card variant="outlined">
      <CardContent>
        <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
          <Box>
            <Typography variant="h6">Referral Sources</Typography>
            <Typography variant="body2" color="text.secondary">
              Manage internal (within organisation) and external referral sources for intake.
            </Typography>
          </Box>
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => { setAddOpen(true); setName(''); setCategory('external') }}>Add Source</Button>
        </Box>

        {(!sources || sources.length === 0) ? (
          <Alert severity="info">No referral sources configured. Click &quot;Add Source&quot; to create one.</Alert>
        ) : (
          <>
            {internal.length > 0 && (
              <>
                <Typography variant="subtitle2" sx={{ mt: 1, mb: 1, color: 'text.secondary' }}>Internal (Within Organisation)</Typography>
                <SourceTable items={internal} onEdit={(s) => { setEditItem(s); setName(s.name); setCategory(s.category) }} onDelete={setDeleteItem} onToggle={(s) => update({ id: s.id, data: { isActive: !s.isActive } })} />
              </>
            )}
            {external.length > 0 && (
              <>
                <Typography variant="subtitle2" sx={{ mt: 2, mb: 1, color: 'text.secondary' }}>External</Typography>
                <SourceTable items={external} onEdit={(s) => { setEditItem(s); setName(s.name); setCategory(s.category) }} onDelete={setDeleteItem} onToggle={(s) => update({ id: s.id, data: { isActive: !s.isActive } })} />
              </>
            )}
          </>
        )}
      </CardContent>

      {/* Add */}
      <Dialog aria-labelledby="dialog-title" open={addOpen} onClose={() => setAddOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle id="dialog-title">Add Referral Source</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '8px !important' }}>
          <FormControl fullWidth size="small">
            <InputLabel>Category</InputLabel>
            <Select value={category} onChange={e => setCategory(e.target.value)} label="Category">
              <MenuItem value="internal">Internal (Within Organisation)</MenuItem>
              <MenuItem value="external">External</MenuItem>
            </Select>
          </FormControl>
          <TextField autoFocus label="Source Name" fullWidth size="small" value={name} onChange={e => setName(e.target.value)} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleCreate} disabled={!name.trim()}>Create</Button>
        </DialogActions>
      </Dialog>

      {/* Edit */}
      <Dialog aria-labelledby="dialog-title" open={!!editItem} onClose={() => setEditItem(null)} maxWidth="xs" fullWidth>
        <DialogTitle id="dialog-title">Edit Referral Source</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '8px !important' }}>
          <FormControl fullWidth size="small">
            <InputLabel>Category</InputLabel>
            <Select value={category} onChange={e => setCategory(e.target.value)} label="Category">
              <MenuItem value="internal">Internal (Within Organisation)</MenuItem>
              <MenuItem value="external">External</MenuItem>
            </Select>
          </FormControl>
          <TextField autoFocus label="Source Name" fullWidth size="small" value={name} onChange={e => setName(e.target.value)} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditItem(null)}>Cancel</Button>
          <Button variant="contained" onClick={handleUpdate} disabled={!name.trim()}>Save</Button>
        </DialogActions>
      </Dialog>

      {/* Delete */}
      <Dialog aria-labelledby="dialog-title" open={!!deleteItem} onClose={() => setDeleteItem(null)} maxWidth="xs" fullWidth>
        <DialogTitle id="dialog-title">Delete Referral Source</DialogTitle>
        <DialogContent><Typography>Delete &quot;{deleteItem?.name}&quot;?</Typography></DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteItem(null)}>Cancel</Button>
          <Button variant="contained" color="error" onClick={handleDelete}>Delete</Button>
        </DialogActions>
      </Dialog>
    </Card>
  )
}

interface SourceTableProps { items: ReferralSource[]
  onEdit: (s: ReferralSource) => void
  onDelete: (s: ReferralSource) => void
  onToggle: (s: ReferralSource) => void }
function SourceTable({ items, onEdit, onDelete, onToggle }: SourceTableProps) {
  return (
    <TableContainer role="region" aria-label="Data table">
      <Table size="small">
        <TableHead><TableRow>
          <TableCell sx={{ fontWeight: 600, fontSize: 13 }}>Name</TableCell>
          <TableCell sx={{ fontWeight: 600, fontSize: 13 }}>Status</TableCell>
          <TableCell align="right" sx={{ fontWeight: 600, fontSize: 13 }}>Actions</TableCell>
        </TableRow></TableHead>
        <TableBody>
          {items.map(s => (
            <TableRow key={s.id} hover>
              <TableCell>{s.name}</TableCell>
              <TableCell>
                <Chip label={s.isActive ? 'Active' : 'Inactive'} size="small" color={s.isActive ? 'success' : 'default'} onClick={() => onToggle(s)} sx={{ cursor: 'pointer' }} />
              </TableCell>
              <TableCell align="right">
                <Tooltip title="Edit"><IconButton size="small" onClick={() => onEdit(s)}><EditIcon fontSize="small" /></IconButton></Tooltip>
                <Tooltip title="Delete"><IconButton size="small" color="error" onClick={() => onDelete(s)}><DeleteIcon fontSize="small" /></IconButton></Tooltip>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  )
}
