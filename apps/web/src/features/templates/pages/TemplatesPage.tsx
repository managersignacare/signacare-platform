import AddIcon from '@mui/icons-material/Add';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import TemplateEditorDialog from '../components/TemplateEditorDialog';
import { useTemplateCategories, useTemplates } from '../hooks/useTemplates';
import { buildTemplateCategoryList } from '../templateEditorSupport';
import type { TemplateStatus } from '../types/templateTypes';

const STATUS_FILTERS: Array<{ value: '' | TemplateStatus; label: string }> = [
  { value: '', label: 'All statuses' },
  { value: 'draft', label: 'Draft' },
  { value: 'published', label: 'Published' },
  { value: 'retired', label: 'Retired' },
] as const;

function formatDateTime(value: string): string {
  try {
    return new Date(value).toLocaleString('en-AU', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return value;
  }
}

function statusChipColor(status: TemplateStatus): 'default' | 'success' | 'warning' {
  if (status === 'published') return 'success';
  if (status === 'retired') return 'default';
  return 'warning';
}

export default function TemplatesPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<'' | TemplateStatus>('');
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);

  const {
    data: templates = [],
    isLoading,
    error,
  } = useTemplates({
    status: status || undefined,
    category: category || undefined,
    q: search.trim() || undefined,
  });
  const { data: templateCategories = [] } = useTemplateCategories();

  const categories = useMemo(
    () => buildTemplateCategoryList({
      managedCategories: templateCategories
        .filter((item) => item.isActive)
        .map((item) => item.name),
      currentCategory: category,
    }),
    [category, templateCategories],
  );

  return (
    <Box sx={{ px: { xs: 2, sm: 3, md: 4 }, py: 3, bgcolor: '#FBF8F5', minHeight: '100vh' }}>
      <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" spacing={2} sx={{ mb: 3 }}>
        <Box>
          <Typography variant="h5" fontWeight={700} fontFamily="Albert Sans, sans-serif" sx={{ color: '#3D484B' }}>
            Templates
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Manage canonical note, letter, report, assessment, and workflow templates.
          </Typography>
        </Box>
        <Button
          startIcon={<AddIcon />}
          variant="contained"
          onClick={() => setEditorOpen(true)}
          sx={{ alignSelf: { xs: 'stretch', md: 'center' }, bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' } }}
        >
          New Template
        </Button>
      </Stack>

      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
          <TextField
            label="Search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            size="small"
            fullWidth
            placeholder="Search by template name or description"
          />
          <FormControl size="small" sx={{ minWidth: { xs: '100%', md: 180 } }}>
            <InputLabel>Status</InputLabel>
            <Select
              label="Status"
              value={status}
              onChange={(event) => setStatus(event.target.value as '' | TemplateStatus)}
            >
              {STATUS_FILTERS.map((option) => (
                <MenuItem key={option.value || 'all'} value={option.value}>{option.label}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: { xs: '100%', md: 220 } }}>
            <InputLabel>Category</InputLabel>
            <Select
              label="Category"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
            >
              <MenuItem value="">All categories</MenuItem>
              {categories.map((option) => (
                <MenuItem key={option} value={option}>{option}</MenuItem>
              ))}
            </Select>
          </FormControl>
        </Stack>
      </Paper>

      {error ? (
        <Alert severity="error" sx={{ mb: 2 }}>
          Unable to load templates right now.
        </Alert>
      ) : null}

      {isLoading ? (
        <CircularProgress role="progressbar" aria-label="Loading" />
      ) : (
        <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}>
          <TableContainer>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 700, bgcolor: '#FBF8F5' }}>Name</TableCell>
                  <TableCell sx={{ fontWeight: 700, bgcolor: '#FBF8F5' }}>Category</TableCell>
                  <TableCell sx={{ fontWeight: 700, bgcolor: '#FBF8F5' }}>Status</TableCell>
                  <TableCell sx={{ fontWeight: 700, bgcolor: '#FBF8F5' }}>Sections</TableCell>
                  <TableCell sx={{ fontWeight: 700, bgcolor: '#FBF8F5' }}>Updated</TableCell>
                  <TableCell sx={{ fontWeight: 700, bgcolor: '#FBF8F5' }} align="right">Open</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {templates.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} align="center" sx={{ py: 6 }}>
                      <Typography color="text.secondary">
                        No templates match the current filters.
                      </Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  templates.map((template) => (
                    <TableRow
                      key={template.id}
                      hover
                      onClick={() => navigate(`/templates/${template.id}`)}
                      sx={{ cursor: 'pointer' }}
                    >
                      <TableCell>
                        <Typography fontWeight={600}>{template.name}</Typography>
                        {template.description ? (
                          <Typography variant="caption" color="text.secondary">
                            {template.description}
                          </Typography>
                        ) : null}
                      </TableCell>
                      <TableCell>{template.category}</TableCell>
                      <TableCell>
                        <Chip
                          label={template.status}
                          size="small"
                          color={statusChipColor(template.status)}
                          sx={{ textTransform: 'capitalize' }}
                        />
                      </TableCell>
                      <TableCell>{template.sections.length}</TableCell>
                      <TableCell>{formatDateTime(template.updatedAt)}</TableCell>
                      <TableCell align="right">
                        <Button
                          size="small"
                          endIcon={<OpenInNewIcon />}
                          onClick={(event) => {
                            event.stopPropagation();
                            navigate(`/templates/${template.id}`);
                          }}
                        >
                          Open
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}

      <TemplateEditorDialog
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        onSaved={(template) => navigate(`/templates/${template.id}`)}
      />
    </Box>
  );
}
