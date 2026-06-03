// apps/web/src/features/clinical-review/components/KeyIssuesPanel.tsx
import { useState } from 'react';
import {
  Box,
  Button,
  IconButton,
  TextField,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Chip,
  Paper,
  Typography,
  Alert,
  CircularProgress,
  Grid,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import { useSaveKeyIssues } from '../hooks/useClinicalReview';
import type { KeyIssue } from '../types/reviewTypes';

interface Props {
  encounterId: string;
  patientId: string;
  initialIssues: KeyIssue[];
  readOnly?: boolean;
}

const CATEGORY_OPTIONS = [
  'clinical', 'social', 'functional', 'safety', 'housing',
  'medication', 'legal', 'family', 'other',
] as const;

const PRIORITY_COLOUR: Record<string, 'error' | 'warning' | 'default'> = {
  critical: 'error',
  urgent: 'warning',
  routine: 'default',
};

const BLANK_ISSUE = (
  encounterId: string,
  patientId: string,
): Omit<KeyIssue, 'id'> => ({
  encounterId,
  patientId,
  issueText: '',
  category: 'clinical',
  priority: 'routine',
  resolution: '',
  resolvedAt: null,
});

export function KeyIssuesPanel({
  encounterId,
  patientId,
  initialIssues,
  readOnly = false,
}: Props) {
  const [issues, setIssues] = useState<KeyIssue[]>(initialIssues);
  const save = useSaveKeyIssues();

  const addIssue = () =>
    setIssues((prev) => [...prev, { ...BLANK_ISSUE(encounterId, patientId) } as KeyIssue]);
  const removeIssue = (idx: number) =>
    setIssues((prev) => prev.filter((_, i) => i !== idx));
  const updateIssue = (idx: number, patch: Partial<KeyIssue>) =>
    setIssues((prev) => prev.map((issue, i) => (i === idx ? { ...issue, ...patch } : issue)));

  const onSave = () => {
    const valid = issues.filter((i) => i.issueText.trim().length > 0);
    save.mutate({ encounterId, issues: valid });
  };

  return (
    <Box>
      {save.isError && (
        <Alert role="alert" severity="error" sx={{ mb: 2 }}>
          Failed to save key issues.
        </Alert>
      )}
      {save.isSuccess && (
        <Alert severity="success" sx={{ mb: 2 }}>
          Key issues saved.
        </Alert>
      )}

      {issues.map((issue, idx) => (
        <Paper key={issue.id ?? `new-${idx}`} variant="outlined" sx={{ p: 2, mb: 1 }}>
          <Grid container spacing={1} alignItems="flex-start">
            <Grid>
              <TextField
                label="Issue"
                value={issue.issueText}
                onChange={(e) => updateIssue(idx, { issueText: e.target.value })}
                fullWidth
                multiline
                rows={2}
                disabled={readOnly}
                size="small"
              />
            </Grid>
            <Grid>
              <FormControl fullWidth size="small">
                <InputLabel>Category</InputLabel>
                <Select
                  label="Category"
                  value={issue.category}
                  onChange={(e) =>
                    updateIssue(idx, { category: e.target.value as KeyIssue['category'] })
                  }
                  disabled={readOnly}
                >
                  {CATEGORY_OPTIONS.map((c) => (
                    <MenuItem key={c} value={c} sx={{ textTransform: 'capitalize' }}>
                      {c}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid>
              <FormControl fullWidth size="small">
                <InputLabel>Priority</InputLabel>
                <Select
                  label="Priority"
                  value={issue.priority}
                  onChange={(e) =>
                    updateIssue(idx, { priority: e.target.value as KeyIssue['priority'] })
                  }
                  disabled={readOnly}
                >
                  <MenuItem value="routine">Routine</MenuItem>
                  <MenuItem value="urgent">Urgent</MenuItem>
                  <MenuItem value="critical">Critical</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 12, sm: 1 }} display="flex" alignItems="center">
              <Chip
                label={issue.priority}
                size="small"
                color={PRIORITY_COLOUR[issue.priority]}
              />
            </Grid>
            {!readOnly && (
              <Grid size={1} display="flex" alignItems="center">
                <IconButton size="small" color="error" onClick={() => removeIssue(idx)}>
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Grid>
            )}
            <Grid>
              <TextField
                label="Resolution / plan for this issue"
                value={issue.resolution ?? ''}
                onChange={(e) => updateIssue(idx, { resolution: e.target.value })}
                fullWidth
                size="small"
                disabled={readOnly}
                placeholder="Optional resolution or plan for this issue"
              />
            </Grid>
          </Grid>
        </Paper>
      ))}

      {issues.length === 0 && (
        <Typography color="text.secondary" py={1}>
          No key issues recorded yet.
        </Typography>
      )}

      {!readOnly && (
        <Box display="flex" justifyContent="space-between" mt={1}>
          <Button startIcon={<AddIcon />} onClick={addIssue} size="small">
            Add Issue
          </Button>
          <Button
            variant="contained"
            onClick={onSave}
            disabled={save.isPending}
            size="small"
            startIcon={save.isPending ? <CircularProgress role="progressbar" aria-label="Loading" size={14} /> : undefined}
          >
            Save Issues
          </Button>
        </Box>
      )}
    </Box>
  );
}
