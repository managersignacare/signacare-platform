import AddIcon from '@mui/icons-material/Add';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import PublishIcon from '@mui/icons-material/Publish';
import UnpublishedIcon from '@mui/icons-material/Unpublished';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { useState } from 'react';
import TemplateEditorDialog from '../../templates/components/TemplateEditorDialog';
import {
  usePublishTemplate,
  useRetireTemplate,
  useTemplates,
} from '../../templates/hooks/useTemplates';
import type { TemplateResponse } from '../../templates/types/templateTypes';

const CLINICAL_NOTES_CATEGORY = 'Clinical Notes';

function statusChipColor(status: TemplateResponse['status']): 'default' | 'success' | 'warning' {
  if (status === 'published') return 'success';
  if (status === 'retired') return 'default';
  return 'warning';
}

export function ClinicalNoteTemplatesPanel(): React.ReactElement {
  const [editorOpen, setEditorOpen] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateResponse | null>(null);
  const [actionError, setActionError] = useState('');

  const {
    data: templates = [],
    isLoading,
    error,
  } = useTemplates({ category: CLINICAL_NOTES_CATEGORY });
  const publishTemplate = usePublishTemplate();
  const retireTemplate = useRetireTemplate();

  const handleCreate = () => {
    setSelectedTemplate(null);
    setEditorOpen(true);
  };

  const handleEdit = (template: TemplateResponse) => {
    setSelectedTemplate(template);
    setEditorOpen(true);
  };

  const handlePublish = async (id: string) => {
    setActionError('');
    try {
      await publishTemplate.mutateAsync(id);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Unable to publish template');
    }
  };

  const handleRetire = async (id: string) => {
    setActionError('');
    try {
      await retireTemplate.mutateAsync(id);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Unable to retire template');
    }
  };

  return (
    <Box>
      <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" spacing={2} sx={{ mb: 2 }}>
        <Box>
          <Typography variant="h6" fontWeight={700}>
            Clinical Note Templates
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Manage the default Australian mental-health note templates shown in Add Clinical Note and used by Medical Scribe workflows.
          </Typography>
        </Box>
        <Button
          startIcon={<AddIcon />}
          variant="contained"
          onClick={handleCreate}
          sx={{ bgcolor: '#b8621a', '&:hover': { bgcolor: '#a05418' } }}
        >
          New Clinical Note Template
        </Button>
      </Stack>

      {error ? (
        <Alert severity="error" sx={{ mb: 2 }}>
          Unable to load clinical note templates right now.
        </Alert>
      ) : null}
      {actionError ? (
        <Alert severity="error" sx={{ mb: 2 }}>
          {actionError}
        </Alert>
      ) : null}

      {isLoading ? (
        <Box display="flex" justifyContent="center" py={6}>
          <CircularProgress />
        </Box>
      ) : (
        <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 700, bgcolor: '#FBF8F5' }}>Template</TableCell>
                  <TableCell sx={{ fontWeight: 700, bgcolor: '#FBF8F5' }}>Status</TableCell>
                  <TableCell sx={{ fontWeight: 700, bgcolor: '#FBF8F5' }}>Sections</TableCell>
                  <TableCell sx={{ fontWeight: 700, bgcolor: '#FBF8F5' }} align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {templates.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} align="center" sx={{ py: 6 }}>
                      <Typography color="text.secondary">
                        No clinical note templates are available yet.
                      </Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  templates.map((template) => (
                    <TableRow key={template.id}>
                      <TableCell>
                        <Typography fontWeight={600}>{template.name}</Typography>
                        {template.description ? (
                          <Typography variant="caption" color="text.secondary">
                            {template.description}
                          </Typography>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <Chip
                          size="small"
                          label={template.status}
                          color={statusChipColor(template.status)}
                          sx={{ textTransform: 'capitalize' }}
                        />
                      </TableCell>
                      <TableCell>{template.sections.length}</TableCell>
                      <TableCell align="right">
                        <Stack direction="row" spacing={1} justifyContent="flex-end">
                          <Button
                            size="small"
                            startIcon={<EditOutlinedIcon />}
                            onClick={() => handleEdit(template)}
                          >
                            Edit
                          </Button>
                          {template.status === 'draft' ? (
                            <Button
                              size="small"
                              startIcon={<PublishIcon />}
                              onClick={() => void handlePublish(template.id)}
                              disabled={publishTemplate.isPending}
                            >
                              Publish
                            </Button>
                          ) : template.status === 'published' ? (
                            <Button
                              size="small"
                              startIcon={<UnpublishedIcon />}
                              onClick={() => void handleRetire(template.id)}
                              disabled={retireTemplate.isPending}
                            >
                              Retire
                            </Button>
                          ) : null}
                        </Stack>
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
        template={selectedTemplate}
        initialCategory={CLINICAL_NOTES_CATEGORY}
        onClose={() => setEditorOpen(false)}
      />
    </Box>
  );
}
