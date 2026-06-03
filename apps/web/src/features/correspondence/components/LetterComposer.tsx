import React, { useCallback } from 'react';
import {
  Box,
  Button,
  TextField,
  Grid,
  Typography,
  Divider,
  MenuItem,
  CircularProgress,
  Alert,
} from '@mui/material';
import { useForm, Controller, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  LetterCreateSchema,
  LETTER_TYPES,
  type LetterCreateDTO,
} from '../types/correspondenceTypes';
import { useCreateLetter, useLetterTemplates } from '../hooks/useCorrespondence';
import { GenerateLetterFromNoteButton } from './GenerateLetterFromNoteButton';

interface Props {
  patientId: string;
  episodeId?: string;
  onSuccess: () => void;
  onCancel: () => void;
}

export const LetterComposer: React.FC<Props> = ({
  patientId,
  episodeId,
  onSuccess,
  onCancel,
}) => {
  const {
    control,
    handleSubmit,
    setValue,
    getValues,
    formState: { errors },
  } = useForm<LetterCreateDTO>({
    resolver: zodResolver(LetterCreateSchema) as Resolver<LetterCreateDTO>,
    defaultValues: {
      patientId,
      episodeId: episodeId ?? undefined,
      letterType: 'general',
      subject: '',
      body: '',
    },
  });

  const createMutation = useCreateLetter();
  const { data: templates } = useLetterTemplates();

  const handleTemplateChange = (templateId: string) => {
    const tpl = templates?.find((t) => t.id === templateId);
    if (tpl) {
      setValue('subject', tpl.subjectTemplate);
      setValue('body', tpl.bodyTemplate);
      setValue('templateId', tpl.id);
    }
  };

  const handleNoteContentLoaded = useCallback(
    (content: string) => {
      const existing = getValues('body');
      setValue('body', existing ? `${existing}\n\n---\n\n${content}` : content);
    },
    [getValues, setValue],
  );

  const onSubmit = (data: LetterCreateDTO) => {
    createMutation.mutate(data, { onSuccess });
  };

  return (
    <Box component="form" onSubmit={handleSubmit(onSubmit)} sx={{ p: 2 }}>
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          mb: 2,
        }}
      >
        <Typography variant="h6">New Letter</Typography>
        <GenerateLetterFromNoteButton
          patientId={patientId}
          episodeId={episodeId}
          onNoteContentLoaded={handleNoteContentLoaded}
        />
      </Box>
      <Divider sx={{ mb: 3 }} />

      {createMutation.isError && (
        <Alert role="alert" severity="error" sx={{ mb: 2 }}>
          Failed to create letter.
        </Alert>
      )}

      <Grid container spacing={2}>
        {/* Template selector */}
        {templates && templates.length > 0 && (
          <Grid>
            <TextField
              select
              label="Use Template"
              fullWidth
              defaultValue=""
              onChange={(e) => handleTemplateChange(e.target.value)}
            >
              <MenuItem value="">None</MenuItem>
              {templates.map((t) => (
                <MenuItem key={t.id} value={t.id}>
                  {t.name}
                </MenuItem>
              ))}
            </TextField>
          </Grid>
        )}

        {/* Letter type */}
        <Grid>
          <Controller
            name="letterType"
            control={control}
            render={({ field }) => (
              <TextField {...field} select label="Letter Type" fullWidth>
                {LETTER_TYPES.map((lt) => (
                  <MenuItem key={lt} value={lt}>
                    {lt.replace(/_/g, ' ')}
                  </MenuItem>
                ))}
              </TextField>
            )}
          />
        </Grid>

        {/* Recipient name */}
        <Grid>
          <Controller
            name="recipientName"
            control={control}
            render={({ field }) => (
              <TextField
                {...field}
                label="Recipient Name"
                fullWidth
                error={!!errors.recipientName}
                helperText={errors.recipientName?.message}
              />
            )}
          />
        </Grid>

        {/* Recipient email */}
        <Grid>
          <Controller
            name="recipientEmail"
            control={control}
            render={({ field }) => (
              <TextField
                {...field}
                label="Recipient Email"
                fullWidth
                error={!!errors.recipientEmail}
                helperText={errors.recipientEmail?.message}
              />
            )}
          />
        </Grid>

        {/* Recipient fax */}
        <Grid>
          <Controller
            name="recipientFax"
            control={control}
            render={({ field }) => (
              <TextField {...field} label="Recipient Fax" fullWidth />
            )}
          />
        </Grid>

        {/* Subject */}
        <Grid>
          <Controller
            name="subject"
            control={control}
            render={({ field }) => (
              <TextField
                {...field}
                label="Subject"
                fullWidth
                error={!!errors.subject}
                helperText={errors.subject?.message}
              />
            )}
          />
        </Grid>

        {/* Body — swap <TextField multiline> for <RichTextEditor> when available */}
        <Grid>
          <Controller
            name="body"
            control={control}
            render={({ field }) => (
              <TextField
                {...field}
                label="Letter Body"
                fullWidth
                multiline
                rows={16}
                error={!!errors.body}
                helperText={errors.body?.message}
              />
            )}
          />
        </Grid>

        {/* Internal notes */}
        <Grid>
          <Controller
            name="notes"
            control={control}
            render={({ field }) => (
              <TextField
                {...field}
                label="Internal Notes"
                fullWidth
                multiline
                rows={2}
              />
            )}
          />
        </Grid>
      </Grid>

      <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end', mt: 3 }}>
        <Button variant="outlined" onClick={onCancel} disabled={createMutation.isPending}>
          Cancel
        </Button>
        <Button
          variant="contained"
          type="submit"
          disabled={createMutation.isPending}
        >
          {createMutation.isPending ? <CircularProgress role="progressbar" aria-label="Loading" size={20} /> : 'Save Draft'}
        </Button>
      </Box>
    </Box>
  );
};
