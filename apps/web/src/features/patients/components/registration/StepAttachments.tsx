// apps/web/src/features/patients/components/registration/StepAttachments.tsx
import React from 'react';
import { useFormContext } from 'react-hook-form';
import {
  Box,
  IconButton,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  TextField,
  Typography,
} from '@mui/material';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import DeleteIcon from '@mui/icons-material/Delete';
import { FileUploader } from '../../../../shared/components/ui/FileUploader';
import type { RegistrationWizardData } from '../../types/patientTypes';

const nextId = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `id-${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`;

const FORMAT_SIZE = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
};

export const StepAttachments: React.FC = () => {
  const { watch, setValue } = useFormContext<RegistrationWizardData>();
  const attachments = watch('attachments');

  const handleFilesSelected = (files: File[]) => {
    const newAttachments = files.map((file) => ({
      id: nextId(),
      file,
      label: '',
    }));
    setValue('attachments', [...attachments, ...newAttachments]);
  };

  const handleRemove = (id: string) => {
    setValue(
      'attachments',
      attachments.filter((a) => a.id !== id),
    );
  };

  const handleLabelChange = (id: string, label: string) => {
    setValue(
      'attachments',
      attachments.map((a) => (a.id === id ? { ...a, label } : a)),
    );
  };

  return (
    <Box>
      <Typography variant="h6" fontWeight={600} fontFamily="Albert Sans, sans-serif" sx={{ mb: 1 }}>
        Attachments
      </Typography>
      <Typography variant="body2" color="text.secondary" fontFamily="Albert Sans, sans-serif" sx={{ mb: 3 }}>
        Upload referral letters, reports, or other documents relevant to this patient&apos;s
        registration. Accepted formats: PDF and images.
      </Typography>

      <FileUploader
        accept=".pdf,.jpg,.jpeg,.png,.tiff"
        multiple
        maxSizeMb={20}
        onFilesSelected={handleFilesSelected}
        label="Drag and drop files here, or click to browse"
      />

      {attachments.length > 0 && (
        <List dense sx={{ mt: 2 }}>
          {attachments.map((attachment) => (
            <ListItem
              key={attachment.id}
              sx={{
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 1.5,
                mb: 1,
                px: 2,
              }}
              secondaryAction={
                <IconButton
                  edge="end"
                  size="small"
                  onClick={() => handleRemove(attachment.id)}
                  color="error"
                  aria-label={`Remove ${attachment.file.name}`}
                >
                  <DeleteIcon fontSize="small" />
                </IconButton>
              }
            >
              <ListItemIcon sx={{ minWidth: 36 }}>
                <AttachFileIcon fontSize="small" sx={{ color: '#b8621a' }} />
              </ListItemIcon>
              <ListItemText
                primary={
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                    <Typography variant="body2" fontWeight={500} sx={{ minWidth: 160 }}>
                      {attachment.file.name}
                    </Typography>
                    <TextField
                      size="small"
                      placeholder="Label (e.g. Referral Letter)"
                      value={attachment.label}
                      onChange={(e) => handleLabelChange(attachment.id, e.target.value)}
                      sx={{ flexGrow: 1 }}
                      variant="standard"
                    />
                  </Box>
                }
                secondary={FORMAT_SIZE(attachment.file.size)}
                secondaryTypographyProps={{ variant: 'caption' }}
              />
            </ListItem>
          ))}
        </List>
      )}
    </Box>
  );
};
