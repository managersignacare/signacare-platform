import React, {
  useRef,
  useState,
  useCallback,
} from 'react';
import {
  Box,
  Typography,
  LinearProgress,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  IconButton,
  Paper,
  Chip,
} from '@mui/material';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import DeleteIcon from '@mui/icons-material/Delete';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';

export interface UploadedFile {
  id: string;
  file: File;
  progress: number;
  error?: string;
}

interface Props {
  accept?: string;
  multiple?: boolean;
  maxSizeMb?: number;
  onFilesSelected: (files: File[]) => void;
  uploading?: boolean;
  uploadProgress?: number; // 0-100
  disabled?: boolean;
  label?: string;
}

const FORMAT_SIZE = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
};

export function FileUploader({
  accept,
  multiple = false,
  maxSizeMb = 20,
  onFilesSelected,
  uploading = false,
  uploadProgress,
  disabled = false,
  label = 'Drag and drop files here, or click to browse',
}: Props): React.ReactElement {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [sizeError, setSizeError] = useState<string | null>(null);

  const validateAndSelect = useCallback(
    (files: FileList | File[]) => {
      setSizeError(null);
      const fileArray = Array.from(files);
      const oversized = fileArray.filter(
        (f) => f.size > maxSizeMb * 1048576,
      );

      if (oversized.length > 0) {
        setSizeError(
          `File exceeds ${maxSizeMb}MB limit: ${oversized
            .map((f) => f.name)
            .join(', ')}`,
        );
        return;
      }

      setSelectedFiles(fileArray);
      onFilesSelected(fileArray);
    },
    [maxSizeMb, onFilesSelected],
  );

  const handleDrop = (e: React.DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    setDragOver(false);
    if (disabled) return;
    validateAndSelect(e.dataTransfer.files);
  };

  const handleRemove = (index: number): void => {
    const updated = selectedFiles.filter((_, i) => i !== index);
    setSelectedFiles(updated);
    onFilesSelected(updated);
  };

  return (
    <Box>
      {/* Drop zone */}
      <Paper
        variant="outlined"
        // Conditional Shape B trio: when `disabled`, omit role/tabIndex/
        // onClick/onKeyDown entirely so the cascade-1 ESLint rule does
        // not fire (no onClick → no violation; no spurious role="button"
        // claim on a disabled affordance). aria-disabled is preserved
        // via aria-disabled prop on the disabled-render branch below.
        // Mirrors the conditional-trio pattern landed at DashboardPage
        // stat-cards / KpiCard in BUG-447 child 11/15.
        aria-disabled={disabled}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        {...(disabled ? {} : {
          role: 'button' as const,
          tabIndex: 0,
          'aria-label': label,
          onClick: () => inputRef.current?.click(),
          onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inputRef.current?.click(); } },
        })}
        sx={{
          p: 4,
          borderRadius: 2,
          borderStyle: 'dashed',
          borderColor: dragOver ? '#327C8D' : 'divider',
          bgcolor: dragOver
            ? 'rgba(50,124,141,0.06)'
            : 'background.paper',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 1,
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.5 : 1,
          '&:focus-visible': { outline: '2px solid #327C8D', outlineOffset: 2 },
          transition:
            'border-color 0.2s, background-color 0.2s',
        }}
      >
        <CloudUploadIcon
          sx={{
            fontSize: 40,
            color: '#327C8D',
            opacity: 0.7,
          }}
        />
        <Typography
          variant="body2"
          color="text.secondary"
          textAlign="center"
        >
          {label}
        </Typography>
        <Chip
          label={`Max ${maxSizeMb}MB${
            multiple ? ', multiple files allowed' : ''
          }`}
          size="small"
          sx={{
            bgcolor: 'rgba(50,124,141,0.1)',
            color: '#327C8D',
          }}
        />
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          multiple={multiple}
          style={{ display: 'none' }}
          onChange={(e) => {
            if (e.target.files) {
              validateAndSelect(e.target.files);
            }
            // reset input so same file can be selected again
            e.target.value = '';
          }}
        />
      </Paper>

      {sizeError && (
        <Typography
          variant="caption"
          color="error"
          sx={{ mt: 0.5, display: 'block' }}
        >
          {sizeError}
        </Typography>
      )}

      {uploading && (
        <Box sx={{ mt: 1 }}>
          <LinearProgress
            variant="determinate"
            value={uploadProgress ?? 0}
          />
          <Typography
            variant="caption"
            color="text.secondary"
          >
            Uploading {uploadProgress ?? 0}%
          </Typography>
        </Box>
      )}

      {selectedFiles.length > 0 && (
        <List dense sx={{ mt: 1 }}>
          {selectedFiles.map((file, idx) => (
            <ListItem
              key={`${file.name}-${idx}`}
              secondaryAction={
                <IconButton
                  edge="end"
                  size="small"
                  onClick={() => handleRemove(idx)}
                  aria-label={`Remove ${file.name}`}
                >
                  <DeleteIcon fontSize="small" />
                </IconButton>
              }
            >
              <ListItemIcon sx={{ minWidth: 32 }}>
                <AttachFileIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText
                primary={file.name}
                secondary={FORMAT_SIZE(file.size)}
                primaryTypographyProps={{
                  variant: 'body2',
                  noWrap: true,
                }}
                secondaryTypographyProps={{
                  variant: 'caption',
                }}
              />
            </ListItem>
          ))}
        </List>
      )}
    </Box>
  );
}
