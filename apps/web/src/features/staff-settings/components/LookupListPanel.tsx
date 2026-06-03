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

interface LookupItem {
  id: string
  name: string
  isActive: boolean
  sortOrder: number
}

interface Props {
  title: string
  description: string
  items: LookupItem[] | undefined
  isLoading: boolean
  onCreate: (name: string) => Promise<void>
  onUpdate: (id: string, data: { name?: string; isActive?: boolean }) => Promise<void>
  onDelete: (id: string) => Promise<void>
}

export const LookupListPanel: React.FC<Props> = ({
  title, description, items, isLoading, onCreate, onUpdate, onDelete,
}) => {
  const [addOpen, setAddOpen] = React.useState(false)
  const [editItem, setEditItem] = React.useState<LookupItem | null>(null)
  const [deleteItem, setDeleteItem] = React.useState<LookupItem | null>(null)
  const [name, setName] = React.useState('')

  const handleCreate = async () => {
    if (!name.trim()) return
    await onCreate(name.trim())
    setAddOpen(false)
    setName('')
  }

  const handleUpdate = async () => {
    if (!editItem || !name.trim()) return
    await onUpdate(editItem.id, { name: name.trim() })
    setEditItem(null)
    setName('')
  }

  const handleDelete = async () => {
    if (!deleteItem) return
    await onDelete(deleteItem.id)
    setDeleteItem(null)
  }

  if (isLoading) return <CircularProgress role="progressbar" aria-label="Loading" />

  return (
    <Card variant="outlined">
      <CardContent>
        <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
          <Box>
            <Typography variant="h6">{title}</Typography>
            <Typography variant="body2" color="text.secondary">{description}</Typography>
          </Box>
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => { setAddOpen(true); setName('') }}>
            Add
          </Button>
        </Box>

        {(!items || items.length === 0) ? (
          <Alert severity="info">No items yet. Click &quot;Add&quot; to create one.</Alert>
        ) : (
          <TableContainer role="region" aria-label="Data table">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Name</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item.id} hover>
                    <TableCell><Typography variant="body2" fontWeight={500}>{item.name}</Typography></TableCell>
                    <TableCell>
                      <Chip
                        label={item.isActive ? 'Active' : 'Inactive'}
                        size="small"
                        color={item.isActive ? 'success' : 'default'}
                        onClick={() => onUpdate(item.id, { isActive: !item.isActive })}
                        sx={{ cursor: 'pointer' }}
                      />
                    </TableCell>
                    <TableCell align="right">
                      <Tooltip title="Edit">
                        <IconButton size="small" onClick={() => { setEditItem(item); setName(item.name) }}>
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Delete">
                        <IconButton size="small" color="error" onClick={() => setDeleteItem(item)}>
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

      {/* Add */}
      <Dialog aria-labelledby="dialog-title" open={addOpen} onClose={() => setAddOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle id="dialog-title">Add {title.replace(/s$/, '')}</DialogTitle>
        <DialogContent>
          <TextField autoFocus label="Name" fullWidth size="small" value={name} onChange={e => setName(e.target.value)} sx={{ mt: 1 }} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleCreate} disabled={!name.trim()}>Create</Button>
        </DialogActions>
      </Dialog>

      {/* Edit */}
      <Dialog aria-labelledby="dialog-title" open={!!editItem} onClose={() => setEditItem(null)} maxWidth="xs" fullWidth>
        <DialogTitle id="dialog-title">Edit {title.replace(/s$/, '')}</DialogTitle>
        <DialogContent>
          <TextField autoFocus label="Name" fullWidth size="small" value={name} onChange={e => setName(e.target.value)} sx={{ mt: 1 }} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditItem(null)}>Cancel</Button>
          <Button variant="contained" onClick={handleUpdate} disabled={!name.trim()}>Save</Button>
        </DialogActions>
      </Dialog>

      {/* Delete */}
      <Dialog aria-labelledby="dialog-title" open={!!deleteItem} onClose={() => setDeleteItem(null)} maxWidth="xs" fullWidth>
        <DialogTitle id="dialog-title">Delete {title.replace(/s$/, '')}</DialogTitle>
        <DialogContent>
          <Typography>Delete &quot;{deleteItem?.name}&quot;? This cannot be undone.</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteItem(null)}>Cancel</Button>
          <Button variant="contained" color="error" onClick={handleDelete}>Delete</Button>
        </DialogActions>
      </Dialog>
    </Card>
  )
}
