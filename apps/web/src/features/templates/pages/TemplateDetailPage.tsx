import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import PublishIcon from '@mui/icons-material/Publish';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  List,
  ListItem,
  ListItemText,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import TemplateEditorDialog from '../components/TemplateEditorDialog';
import {
  useDeleteTemplate,
  usePublishTemplate,
  useRetireTemplate,
  useTemplate,
} from '../hooks/useTemplates';

function formatDateTime(value: string | null): string {
  if (!value) return 'Not set';
  try {
    return new Date(value).toLocaleString('en-AU', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return value;
  }
}

function describeSection(section: {
  fieldType: string;
  required: boolean;
  placeholder?: string | null | undefined;
  options?: unknown;
  minValue?: number | null | undefined;
  maxValue?: number | null | undefined;
  soapField?: string | null | undefined;
}): string {
  const details: string[] = [section.required ? 'required' : 'optional'];
  if (section.soapField) details.push(`SOAP: ${section.soapField}`);
  if (Array.isArray(section.options) && section.options.length > 0) details.push(`${section.options.length} options`);
  if (section.minValue != null || section.maxValue != null) details.push(`range ${section.minValue ?? '—'} to ${section.maxValue ?? '—'}`);
  if (section.placeholder) details.push(section.placeholder);
  return details.join(' • ');
}

export default function TemplateDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [editorOpen, setEditorOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const { data: template, isLoading, error } = useTemplate(id);
  const publishMutation = usePublishTemplate();
  const retireMutation = useRetireTemplate();
  const deleteMutation = useDeleteTemplate();

  if (isLoading) {
    return (
      <Box sx={{ p: 4 }}>
        <CircularProgress role="progressbar" aria-label="Loading" />
      </Box>
    );
  }

  if (error || !template) {
    return (
      <Box sx={{ p: 4 }}>
        <Alert severity="error" sx={{ mb: 2 }}>
          Unable to load this template.
        </Alert>
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/templates')}>
          Back to templates
        </Button>
      </Box>
    );
  }

  const isDraft = template.status === 'draft';
  const isPublished = template.status === 'published';
  const isRetired = template.status === 'retired';

  const handlePublish = async () => {
    try {
      setActionError(null);
      await publishMutation.mutateAsync(template.id);
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : 'Unable to publish template.');
    }
  };

  const handleRetire = async () => {
    try {
      setActionError(null);
      await retireMutation.mutateAsync(template.id);
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : 'Unable to retire template.');
    }
  };

  const handleDelete = async () => {
    const confirmed = window.confirm(`Delete template "${template.name}"?`);
    if (!confirmed) return;

    try {
      setActionError(null);
      await deleteMutation.mutateAsync(template.id);
      navigate('/templates');
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : 'Unable to delete template.');
    }
  };

  return (
    <Box sx={{ px: { xs: 2, sm: 3, md: 4 }, py: 3, bgcolor: '#FBF8F5', minHeight: '100vh' }}>
      <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" spacing={2} sx={{ mb: 3 }}>
        <Box>
          <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/templates')} sx={{ mb: 1 }}>
            Back to templates
          </Button>
          <Typography variant="h5" fontWeight={700} fontFamily="Albert Sans, sans-serif" sx={{ color: '#3D484B' }}>
            {template.name}
          </Typography>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1, flexWrap: 'wrap', rowGap: 1 }}>
            <Chip label={template.status} size="small" sx={{ textTransform: 'capitalize' }} />
            <Chip label={template.category} size="small" variant="outlined" />
          </Stack>
          {template.description ? (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              {template.description}
            </Typography>
          ) : null}
        </Box>

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
          {!isRetired ? (
            <Button startIcon={<EditIcon />} variant="outlined" onClick={() => setEditorOpen(true)}>
              Edit
            </Button>
          ) : null}
          {isDraft ? (
            <Button
              startIcon={<PublishIcon />}
              variant="contained"
              onClick={handlePublish}
              disabled={publishMutation.isPending}
              sx={{ bgcolor: '#327C8D', '&:hover': { bgcolor: '#256575' } }}
            >
              Publish
            </Button>
          ) : null}
          {isPublished ? (
            <Button
              startIcon={<VisibilityOffIcon />}
              variant="outlined"
              color="warning"
              onClick={handleRetire}
              disabled={retireMutation.isPending}
            >
              Retire
            </Button>
          ) : null}
          {!isPublished ? (
            <Button
              startIcon={<DeleteIcon />}
              variant="outlined"
              color="error"
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
            >
              Delete
            </Button>
          ) : null}
        </Stack>
      </Stack>

      {actionError ? (
        <Alert severity="error" sx={{ mb: 2 }}>
          {actionError}
        </Alert>
      ) : null}

      <Stack spacing={2}>
        <Paper variant="outlined" sx={{ p: 2.5 }}>
          <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1.5 }}>
            Lifecycle
          </Typography>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
            <Box>
              <Typography variant="caption" color="text.secondary">Created</Typography>
              <Typography variant="body2">{formatDateTime(template.createdAt)}</Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">Last updated</Typography>
              <Typography variant="body2">{formatDateTime(template.updatedAt)}</Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">Published</Typography>
              <Typography variant="body2">{formatDateTime(template.publishedAt)}</Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">Retired</Typography>
              <Typography variant="body2">{formatDateTime(template.retiredAt)}</Typography>
            </Box>
          </Stack>
        </Paper>

        <Paper variant="outlined" sx={{ p: 2.5 }}>
          <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1.5 }}>
            Sections
          </Typography>
          {template.sections.length === 0 ? (
            <Typography color="text.secondary">
              This draft has no sections yet. Add at least one before publishing.
            </Typography>
          ) : (
            <List disablePadding>
              {template.sections.map((section, index) => (
                <Box key={section.id}>
                  <ListItem disableGutters sx={{ py: 1.25, alignItems: 'flex-start' }}>
                    <ListItemText
                      primary={(
                        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                          <Typography fontWeight={600}>{index + 1}. {section.label}</Typography>
                          <Chip label={section.fieldType} size="small" variant="outlined" />
                        </Stack>
                      )}
                      secondary={describeSection(section)}
                    />
                  </ListItem>
                  {index < template.sections.length - 1 ? <Divider /> : null}
                </Box>
              ))}
            </List>
          )}
        </Paper>
      </Stack>

      <TemplateEditorDialog
        open={editorOpen}
        template={template}
        onClose={() => setEditorOpen(false)}
      />
    </Box>
  );
}
