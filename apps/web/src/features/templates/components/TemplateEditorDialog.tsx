import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  Grid,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import { useEffect, useMemo, useState } from 'react';
import type { SignacareApiError } from '../../../shared/services/apiClient';
import {
  useCreateTemplate,
  useTemplateCategories,
  useUpdateTemplate,
} from '../hooks/useTemplates';
import {
  createDefaultOptions,
  createEmptySection,
  cloneSectionsForEdit,
  normalizeTemplateForSave,
  buildTemplateCategoryList,
  TEMPLATE_FIELD_TYPE_OPTIONS,
} from '../templateEditorSupport';
import type {
  CreateTemplateDTO,
  SectionType,
  TemplateResponse,
  TemplateSection,
} from '../types/templateTypes';

interface TemplateEditorDialogProps {
  open: boolean;
  template?: TemplateResponse | null;
  onClose: () => void;
  onSaved?: (template: TemplateResponse) => void;
}

const SOAP_FIELD_OPTIONS = [
  { value: '', label: 'Not mapped' },
  { value: 'subjective', label: 'Subjective' },
  { value: 'objective', label: 'Objective' },
  { value: 'assessment', label: 'Assessment' },
  { value: 'plan', label: 'Plan' },
] as const;

function getErrorMessage(error: unknown, fallback: string): string {
  const maybeApiError = error as SignacareApiError | undefined;
  return maybeApiError?.message || fallback;
}

function sectionsNeedOptions(fieldType: SectionType): boolean {
  return fieldType === 'single_select' || fieldType === 'multi_select';
}

function sectionsNeedRange(fieldType: SectionType): boolean {
  return fieldType === 'likert' || fieldType === 'numeric';
}

export default function TemplateEditorDialog({
  open,
  template,
  onClose,
  onSaved,
}: TemplateEditorDialogProps) {
  const createMutation = useCreateTemplate();
  const { data: managedCategories = [] } = useTemplateCategories();
  const updateMutation = useUpdateTemplate();
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [sections, setSections] = useState<TemplateSection[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(template?.name ?? '');
    setCategory(template?.category ?? '');
    setDescription(template?.description ?? '');
    setSections(cloneSectionsForEdit(template));
    setErrorMessage(null);
  }, [open, template]);

  const isEditing = Boolean(template);
  const isPending = createMutation.isPending || updateMutation.isPending;
  const categoryOptions = useMemo(
    () => buildTemplateCategoryList({
      managedCategories: managedCategories
        .filter((item) => item.isActive)
        .map((item) => item.name),
      currentCategory: category,
    }),
    [category, managedCategories],
  );

  const updateSection = (index: number, patch: Partial<TemplateSection>) => {
    setSections((previous) => previous.map((section, currentIndex) => (
      currentIndex === index ? { ...section, ...patch } : section
    )));
  };

  const moveSection = (index: number, direction: -1 | 1) => {
    setSections((previous) => {
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= previous.length) return previous;
      const clone = [...previous];
      const [moved] = clone.splice(index, 1);
      clone.splice(nextIndex, 0, moved);
      return clone.map((section, currentIndex) => ({ ...section, position: currentIndex }));
    });
  };

  const addSection = (fieldType: SectionType) => {
    setSections((previous) => [...previous, createEmptySection(fieldType, previous.length)]);
  };

  const removeSection = (index: number) => {
    setSections((previous) => previous
      .filter((_, currentIndex) => currentIndex !== index)
      .map((section, currentIndex) => ({ ...section, position: currentIndex })));
  };

  const handleSave = async () => {
    const payload: CreateTemplateDTO = normalizeTemplateForSave({
      name,
      category,
      description,
      sections,
    });

    if (!payload.name || !payload.category) {
      setErrorMessage('Template name and category are required.');
      return;
    }

    if (payload.sections.some((section) => !section.label.trim())) {
      setErrorMessage('Every section needs a label before you can save.');
      return;
    }

    try {
      setErrorMessage(null);
      const saved = template
        ? await updateMutation.mutateAsync({ id: template.id, dto: payload })
        : await createMutation.mutateAsync(payload);
      onSaved?.(saved);
      onClose();
    } catch (error) {
      setErrorMessage(getErrorMessage(error, 'Unable to save template right now.'));
    }
  };

  return (
    <Dialog open={open} onClose={isPending ? undefined : onClose} maxWidth="lg" fullWidth>
      <DialogTitle sx={{ fontFamily: 'Albert Sans, sans-serif', fontWeight: 700 }}>
        {template ? 'Edit Template' : 'New Template'}
      </DialogTitle>
      <Divider />
      <DialogContent sx={{ pt: 2.5 }}>
        <Stack spacing={2.5}>
          {errorMessage ? <Alert severity="error">{errorMessage}</Alert> : null}

          <Grid container spacing={2}>
            <Grid size={{ xs: 12, md: 6 }}>
              <TextField
                autoFocus
                label="Template Name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                fullWidth
                size="small"
              />
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <TextField
                label="Category"
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                fullWidth
                size="small"
                helperText="Use a stable category name so published templates group consistently."
                slotProps={{
                  htmlInput: {
                    list: 'template-category-suggestions',
                  },
                }}
              />
              <datalist id="template-category-suggestions">
                {categoryOptions.map((option) => <option key={option} value={option} />)}
              </datalist>
            </Grid>
            <Grid size={{ xs: 12 }}>
              <TextField
                label="Description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                fullWidth
                size="small"
                multiline
                minRows={2}
              />
            </Grid>
          </Grid>

          <Box>
            <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
              Sections
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
              Define the structure clinicians see when they use this template. Published templates
              can still be used elsewhere, including SOAP insertion, through the same section list.
            </Typography>

            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              {TEMPLATE_FIELD_TYPE_OPTIONS.map((option) => (
                <Chip
                  key={option.value}
                  icon={<AddIcon />}
                  label={option.label}
                  variant="outlined"
                  onClick={() => addSection(option.value)}
                  sx={{ cursor: 'pointer' }}
                />
              ))}
            </Stack>
          </Box>

          {!sections.length ? (
            <Paper variant="outlined" sx={{ p: 3, textAlign: 'center' }}>
              <Typography color="text.secondary">
                Start by adding a section type. Draft templates can be saved empty, but publishing
                requires at least one section.
              </Typography>
            </Paper>
          ) : (
            <Stack spacing={1.5}>
              {sections.map((section, index) => (
                <Paper key={`${section.id ?? 'draft'}-${index}`} variant="outlined" sx={{ p: 2 }}>
                  <Stack spacing={1.5}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, alignItems: 'center' }}>
                      <Chip
                        label={`${index + 1}. ${TEMPLATE_FIELD_TYPE_OPTIONS.find((option) => option.value === section.fieldType)?.label ?? section.fieldType}`}
                        size="small"
                        color="primary"
                        variant="outlined"
                      />
                      <Box sx={{ display: 'flex', gap: 0.5 }}>
                        <IconButton
                          size="small"
                          aria-label="Move section up"
                          onClick={() => moveSection(index, -1)}
                          disabled={index === 0}
                        >
                          <KeyboardArrowUpIcon fontSize="small" />
                        </IconButton>
                        <IconButton
                          size="small"
                          aria-label="Move section down"
                          onClick={() => moveSection(index, 1)}
                          disabled={index === sections.length - 1}
                        >
                          <KeyboardArrowDownIcon fontSize="small" />
                        </IconButton>
                        <IconButton
                          size="small"
                          color="error"
                          aria-label="Remove section"
                          onClick={() => removeSection(index)}
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Box>
                    </Box>

                    <Grid container spacing={2}>
                      <Grid size={{ xs: 12, md: 4 }}>
                        <FormControl fullWidth size="small">
                          <InputLabel>Field Type</InputLabel>
                          <Select
                            value={section.fieldType}
                            label="Field Type"
                            onChange={(event) => {
                              const nextType = event.target.value as SectionType;
                              updateSection(index, createEmptySection(nextType, index));
                            }}
                          >
                            {TEMPLATE_FIELD_TYPE_OPTIONS.map((option) => (
                              <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
                            ))}
                          </Select>
                        </FormControl>
                      </Grid>
                      <Grid size={{ xs: 12, md: 8 }}>
                        <TextField
                          label="Section Label"
                          value={section.label}
                          onChange={(event) => updateSection(index, { label: event.target.value })}
                          fullWidth
                          size="small"
                        />
                      </Grid>

                      <Grid size={{ xs: 12, md: 6 }}>
                        <TextField
                          label="Placeholder / guidance"
                          value={section.placeholder ?? ''}
                          onChange={(event) => updateSection(index, { placeholder: event.target.value })}
                          fullWidth
                          size="small"
                        />
                      </Grid>
                      <Grid size={{ xs: 12, md: 3 }}>
                        <FormControl fullWidth size="small">
                          <InputLabel>SOAP Mapping</InputLabel>
                          <Select
                            value={section.soapField ?? ''}
                            label="SOAP Mapping"
                            onChange={(event) => updateSection(index, {
                              soapField: event.target.value ? event.target.value as TemplateSection['soapField'] : undefined,
                            })}
                          >
                            {SOAP_FIELD_OPTIONS.map((option) => (
                              <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
                            ))}
                          </Select>
                        </FormControl>
                      </Grid>
                      <Grid size={{ xs: 12, md: 3 }} sx={{ display: 'flex', alignItems: 'center' }}>
                        <FormControlLabel
                          control={(
                            <Switch
                              checked={section.required ?? false}
                              onChange={(event) => updateSection(index, { required: event.target.checked })}
                            />
                          )}
                          label="Required"
                        />
                      </Grid>

                      {sectionsNeedOptions(section.fieldType) ? (
                        <Grid size={{ xs: 12 }}>
                          <TextField
                            label="Options"
                            helperText="Comma-separated values. Labels become the clinician-facing choices."
                            value={(section.options ?? []).map((option) => option.label).join(', ')}
                            onChange={(event) => {
                              const labels = event.target.value
                                .split(',')
                                .map((value) => value.trim())
                                .filter(Boolean);
                              updateSection(index, { options: createDefaultOptions(labels) });
                            }}
                            fullWidth
                            size="small"
                          />
                        </Grid>
                      ) : null}

                      {sectionsNeedRange(section.fieldType) ? (
                        <>
                          <Grid size={{ xs: 12, md: 3 }}>
                            <TextField
                              label="Minimum"
                              type="number"
                              value={section.minValue ?? ''}
                              onChange={(event) => updateSection(index, {
                                minValue: event.target.value === '' ? undefined : Number(event.target.value),
                              })}
                              fullWidth
                              size="small"
                            />
                          </Grid>
                          <Grid size={{ xs: 12, md: 3 }}>
                            <TextField
                              label="Maximum"
                              type="number"
                              value={section.maxValue ?? ''}
                              onChange={(event) => updateSection(index, {
                                maxValue: event.target.value === '' ? undefined : Number(event.target.value),
                              })}
                              fullWidth
                              size="small"
                            />
                          </Grid>
                        </>
                      ) : null}
                    </Grid>
                  </Stack>
                </Paper>
              ))}
            </Stack>
          )}
        </Stack>
      </DialogContent>
      <Divider />
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} disabled={isPending}>Cancel</Button>
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={isPending}
          sx={{ bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' } }}
        >
          {isPending ? (
            <CircularProgress size={18} sx={{ color: '#fff' }} />
          ) : isEditing ? 'Save Template' : 'Create Template'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
