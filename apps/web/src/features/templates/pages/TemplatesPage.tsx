import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import {
    Box, Button, Chip, CircularProgress, Dialog, DialogActions,
    DialogContent, DialogTitle, Divider, FormControl, Grid, IconButton, InputLabel,
    MenuItem, Paper, Select, Table, TableBody, TableCell, TableContainer, TableHead,
    TableRow, TextField, Tooltip, Typography
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiClient } from '../../../shared/services/apiClient';
import { templateKeys, templateCategoryKeys } from '../queryKeys';

type TemplateFieldType =
  | 'heading'
  | 'instruction'
  | 'text_block'
  | 'short_answer'
  | 'yes_no'
  | 'multiple_choice'
  | 'multi_select'
  | 'likert'
  | 'score';

interface TemplateField {
  type: TemplateFieldType;
  label: string;
  text?: string;
  options?: string[];
  min?: number;
  max?: number;
}

interface Template { id: string; name: string; type: string; categoryId: string | null; categoryName: string | null; description: string | null; content: TemplateField[]; isActive: boolean; isSystem: boolean }
interface Category { id: string; name: string; isActive: boolean }
interface CreateTemplatePayload {
  name: string;
  type: string;
  categoryId?: string;
  description?: string;
  content: TemplateField[];
}

const FIELD_TYPES: Array<{ value: TemplateFieldType; label: string }> = [
  { value: 'heading', label: 'Section Heading' },
  { value: 'instruction', label: 'Instruction Text' },
  { value: 'text_block', label: 'Free Text Block' },
  { value: 'short_answer', label: 'Short Answer' },
  { value: 'yes_no', label: 'Yes / No' },
  { value: 'multiple_choice', label: 'Multiple Choice (single)' },
  { value: 'multi_select', label: 'Multiple Choice (multi)' },
  { value: 'likert', label: 'Likert Scale (0-10)' },
  { value: 'score', label: 'Calculated Score' },
];

export default function TemplatesPage() {
  const qc = useQueryClient();
  const [typeFilter, _setTypeFilter] = useState('');
  const [catFilter, setCatFilter] = useState('');
  const [editTemplate, setEditTemplate] = useState<Template | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const { data: templates, isLoading } = useQuery({ queryKey: templateKeys.listByFilter(typeFilter, catFilter), queryFn: () => { const params: Record<string, string> = {}; if (typeFilter) params.type = typeFilter; if (catFilter) params.categoryId = catFilter; return apiClient.get<{ templates: Template[] }>('staff-settings/templates', params).then(r => r.templates); } });
  const { data: categories } = useQuery({ queryKey: templateCategoryKeys.list(), queryFn: () => apiClient.get<{ categories: Category[] }>('staff-settings/template-categories').then(r => r.categories) });

  const deleteMut = useMutation({ mutationFn: (id: string) => apiClient.delete(`staff-settings/templates/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: templateKeys.all }) });

  return (
    <Box sx={{ px: { xs: 2, sm: 3, md: 4 }, py: 3, bgcolor: '#FBF8F5', minHeight: '100vh' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', mb: 3, gap: 2, flexWrap: 'wrap' }}>
        <Box>
          <Typography variant="h5" fontWeight={700} fontFamily="Albert Sans, sans-serif" sx={{ color: '#3D484B' }}>Templates</Typography>
          <Typography variant="body2" color="text.secondary">Clinical notes, rating scales, assessments, letters, reports, messages, and certificates</Typography>
        </Box>
        <Button startIcon={<AddIcon />} variant="contained" onClick={() => setAddOpen(true)}
          sx={{ bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' } }}>New Template</Button>
      </Box>

      {/* Filter by Category */}
      <Box sx={{ display: 'flex', gap: 1.5, mb: 2 }}>
        <FormControl size="small" sx={{ minWidth: 200 }}><InputLabel>Category</InputLabel>
          <Select value={catFilter} onChange={e => setCatFilter(e.target.value)} label="Category" sx={{ bgcolor: '#fff' }}>
            <MenuItem value="">All Categories</MenuItem>{(categories ?? []).map(c => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
          </Select></FormControl>
      </Box>

      {/* Template list */}
      {isLoading ? <CircularProgress role="progressbar" aria-label="Loading" /> : (
        <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}>
          <TableContainer role="region" aria-label="Data table">
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>{['Name', 'Category', 'Fields', 'System', ''].map(c => <TableCell key={c} sx={{ fontWeight: 600, fontSize: 13, bgcolor: '#FBF8F5' }}>{c}</TableCell>)}</TableRow>
              </TableHead>
              <TableBody>
                {!templates?.length ? (
                  <TableRow><TableCell colSpan={6} align="center" sx={{ py: 4 }}><Typography color="text.secondary">No templates found</Typography></TableCell></TableRow>
                ) : templates.map(t => (
                  <TableRow key={t.id} hover>
                    <TableCell sx={{ fontWeight: 500 }}>{t.name}</TableCell>
                    <TableCell><Chip label={t.categoryName || t.type || '—'} size="small" sx={{ fontSize: 10, height: 20 }} /></TableCell>
                    <TableCell sx={{ fontSize: 13 }}>{t.content?.length ?? 0}</TableCell>
                    <TableCell>{t.isSystem && <Chip label="System" size="small" variant="outlined" sx={{ fontSize: 9, height: 18 }} />}</TableCell>
                    <TableCell align="right">
                      <Tooltip title="Edit"><IconButton size="small" onClick={() => setEditTemplate(t)}><EditIcon fontSize="small" /></IconButton></Tooltip>
                      {!t.isSystem && <Tooltip title="Delete"><IconButton size="small" color="error" onClick={() => deleteMut.mutate(t.id)}><DeleteIcon fontSize="small" /></IconButton></Tooltip>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}

      {/* Add/Edit Dialog */}
      {(addOpen || editTemplate) && (
        <TemplateEditorDialog
          template={editTemplate}
          categories={categories ?? []}
          onClose={() => { setAddOpen(false); setEditTemplate(null); }}
        />
      )}
    </Box>
  );
}

// ============ Template Editor Dialog ============

interface TemplateEditorDialogProps { template: Template | null; categories: Category[]; onClose: () => void }
function TemplateEditorDialog({ template, categories, onClose }: TemplateEditorDialogProps) {
  const qc = useQueryClient();
  const [name, setName] = useState(template?.name ?? '');
  const [type, _setType] = useState(template?.type ?? 'note');
  const [categoryId, setCategoryId] = useState(template?.categoryId ?? '');
  const [description, setDescription] = useState(template?.description ?? '');
  const [fields, setFields] = useState<TemplateField[]>(template?.content ?? []);

  const createMut = useMutation({ mutationFn: (d: CreateTemplatePayload) => apiClient.post('staff-settings/templates', d), onSuccess: () => { qc.invalidateQueries({ queryKey: templateKeys.all }); onClose(); } });

  const addField = (fieldType: TemplateFieldType) => {
    const base: TemplateField = { type: fieldType, label: '' };
    if (fieldType === 'heading' || fieldType === 'instruction' || fieldType === 'text_block') base.text = '';
    if (fieldType === 'multiple_choice' || fieldType === 'multi_select') base.options = ['Option 1', 'Option 2'];
    if (fieldType === 'likert') { base.min = 0; base.max = 10; base.options = []; }
    if (fieldType === 'yes_no') base.label = 'Question';
    setFields(prev => [...prev, base]);
  };

  const updateField = <K extends keyof TemplateField>(idx: number, key: K, value: TemplateField[K]) => {
    setFields(prev => prev.map((f, i) => i === idx ? { ...f, [key]: value } : f));
  };

  const removeField = (idx: number) => setFields(prev => prev.filter((_, i) => i !== idx));

  const handleSave = () => {
    if (!name.trim()) return;
    createMut.mutate({ name: name.trim(), type, categoryId: categoryId || undefined, description: description.trim() || undefined, content: fields });
  };

  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ fontFamily: 'Albert Sans, sans-serif', fontWeight: 700 }}>{template ? 'Edit Template' : 'New Template'}</DialogTitle>
      <Divider />
      <DialogContent>
        <Grid container spacing={2} sx={{ mt: 0.5 }}>
          <Grid size={{ xs: 12, sm: 8 }}><TextField autoFocus label="Template Name *" fullWidth size="small" value={name} onChange={e => setName(e.target.value)} /></Grid>
          <Grid size={{ xs: 12, sm: 4 }}><FormControl fullWidth size="small"><InputLabel>Category *</InputLabel><Select value={categoryId} onChange={e => setCategoryId(e.target.value)} label="Category *"><MenuItem value="">— Select Category —</MenuItem>{categories.map(c => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}</Select></FormControl></Grid>
          <Grid size={{ xs: 12 }}><TextField label="Description" fullWidth size="small" value={description} onChange={e => setDescription(e.target.value)} /></Grid>
        </Grid>

        <Divider sx={{ my: 2 }} />
        <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>Template Fields</Typography>

        {fields.map((field, idx) => (
          <Paper key={idx} variant="outlined" sx={{ p: 1.5, mb: 1, display: 'flex', gap: 1, alignItems: 'flex-start' }}>
            <Chip label={field.type} size="small" sx={{ fontSize: 9, height: 18, minWidth: 70, textTransform: 'capitalize' }} />
            <Box sx={{ flex: 1 }}>
              {(field.type === 'heading' || field.type === 'instruction' || field.type === 'text_block') ? (
                <TextField size="small" fullWidth value={field.text ?? field.label ?? ''} onChange={e => updateField(idx, field.type === 'text_block' ? 'text' : 'text', e.target.value)} multiline={field.type === 'text_block'} rows={field.type === 'text_block' ? 4 : 1} placeholder={field.type === 'heading' ? 'Section heading' : field.type === 'text_block' ? 'Template text content' : 'Instruction text'} sx={field.type === 'text_block' ? { '& .MuiInputBase-input': { fontFamily: 'monospace', fontSize: 12 } } : {}} />
              ) : (
                <TextField size="small" fullWidth value={field.label ?? ''} onChange={e => updateField(idx, 'label', e.target.value)} placeholder="Question / Label" />
              )}
              {(field.type === 'multiple_choice' || field.type === 'multi_select') && (
                <TextField size="small" fullWidth value={(field.options ?? []).join(', ')} onChange={e => updateField(idx, 'options', e.target.value.split(',').map((s: string) => s.trim()))} placeholder="Options (comma separated)" sx={{ mt: 0.5 }} />
              )}
              {field.type === 'likert' && (
                <Box sx={{ display: 'flex', gap: 1, mt: 0.5 }}>
                  <TextField size="small" label="Min" type="number" value={field.min ?? 0} onChange={e => updateField(idx, 'min', Number(e.target.value))} sx={{ width: 70 }} />
                  <TextField size="small" label="Max" type="number" value={field.max ?? 10} onChange={e => updateField(idx, 'max', Number(e.target.value))} sx={{ width: 70 }} />
                  <TextField size="small" label="Scale Labels (comma sep)" value={(field.options ?? []).join(', ')} onChange={e => updateField(idx, 'options', e.target.value.split(',').map((s: string) => s.trim()))} sx={{ flex: 1 }} />
                </Box>
              )}
            </Box>
            <IconButton size="small" color="error" onClick={() => removeField(idx)}><DeleteIcon fontSize="small" /></IconButton>
          </Paper>
        ))}

        {/* Add field buttons */}
        <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mt: 1 }}>
          {FIELD_TYPES.map(ft => (
            <Chip key={ft.value} label={ft.label} size="small" variant="outlined" onClick={() => addField(ft.value)} sx={{ cursor: 'pointer', fontSize: 11, '&:hover': { bgcolor: '#FFF3E0' } }} />
          ))}
        </Box>
      </DialogContent>
      <Divider />
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} sx={{ color: 'text.secondary' }}>Cancel</Button>
        <Button variant="contained" onClick={handleSave} disabled={!name.trim() || createMut.isPending}
          sx={{ bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' } }}>
          {createMut.isPending ? <CircularProgress role="progressbar" aria-label="Loading" size={18} sx={{ color: '#fff' }} /> : template ? 'Save Template' : 'Create Template'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
