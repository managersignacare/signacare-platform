/**
 * Phase 8 UI refactor — generic artifact-panel component extracted from
 * SummaryTab.
 *
 * Renders one clinical-AI artifact (Longitudinal Summary OR Clinical
 * Formulation) with its Generate / Edit / Hard-reset header, sign-off
 * lock banner, job-status alert, error alert, body (read or edit mode),
 * and history card. The original SummaryTab duplicated this ~150-LOC
 * block twice with copy-pasted colour and label changes; this component
 * collapses both arms onto one render path.
 *
 * Behaviour preserved 1:1 with the original ClinicalSummaryPanel:
 *  - identical accent colour per arm (`#b8621a` / `#327C8D`)
 *  - identical disclaimer text per arm
 *  - identical sign-off lock messaging
 *  - identical edit / cancel / save flow that calls persistArtifact
 *    and resets the local edit-mode toggle on success
 *  - identical body monospace rendering with max-height + scroll
 */
import type { ReactNode } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Paper,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import EditIcon from '@mui/icons-material/Edit';
import { SectionSignoffControls } from './SummarySignoffControls';
import { renderArtifactHistoryCard } from './summaryHistoryCard';
import { extractErrorMessage } from './summaryTabDomain';
import type { listArtifactNotes } from './summaryArtifacts';
import type {
  SummarySignoffRecord as _SummarySignoffRecord,
} from './summarySignoffTypes';

interface ClinicalSummaryArtifactPanelProps {
  patientId: string;
  /** Header label shown in the title bar, e.g. "Longitudinal Summary". */
  title: string;
  /** MUI icon shown before the title. */
  titleIcon: ReactNode;
  /** Pill chip rendered next to the title — branding / format note. */
  chipNode: ReactNode;
  /** Hex colour used for the left border accent + button text. */
  accentColor: string;
  /** Hex colour used for the Save-button bg + hover bg. */
  saveButtonColor: string;
  /** Hover background for Save. */
  saveButtonHoverColor: string;
  /** Sign-off section identifier handed to SectionSignoffControls. */
  signoffSection: _SummarySignoffRecord['section'];
  /** Optional helper string shown in the small grey description line. */
  descriptionPrefix: string;
  /** Live AI-resolved content. null = nothing generated yet. */
  value: string | null;
  loading: boolean;
  persisting: boolean;
  error: string;
  setError: (next: string) => void;
  jobStatus: string;
  resetLocked: boolean;
  lastGenerated: string | null;
  history: ReturnType<typeof listArtifactNotes>;
  historyTitle: string;
  /** Edit-mode state pair (owned by useSummarySectionState). */
  editing: boolean;
  setEditing: (next: boolean) => void;
  editText: string;
  setEditText: (next: string) => void;
  /** Action callbacks (owned by useClinicalSummaryJobs). */
  onGenerate: () => Promise<void> | void;
  onHardReset: () => Promise<void> | void;
  onPersistEdit: (content: string) => Promise<void>;
  setValue: (next: string | null) => void;
  /** Edit-textarea row count — original used 20 for summary, 16 for formulation. */
  editRowCount: number;
  /** Body-readonly max-height in px — original used 400 for summary, 350 for formulation. */
  readMaxHeightPx: number;
  /** Free-text body shown when not editing (caller formats the empty placeholder text in here). */
  displayBody: string;
}

export function ClinicalSummaryArtifactPanel({
  patientId,
  title,
  titleIcon,
  chipNode,
  accentColor,
  saveButtonColor,
  saveButtonHoverColor,
  signoffSection,
  descriptionPrefix,
  value,
  loading,
  persisting,
  error,
  setError,
  jobStatus,
  resetLocked,
  lastGenerated,
  history,
  historyTitle,
  editing,
  setEditing,
  editText,
  setEditText,
  onGenerate,
  onHardReset,
  onPersistEdit,
  setValue,
  editRowCount,
  readMaxHeightPx,
  displayBody,
}: ClinicalSummaryArtifactPanelProps) {
  return (
    <Paper variant="outlined" sx={{ p: 2.5, mb: 0, borderLeft: `4px solid ${accentColor}` }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {titleIcon}
          <Typography variant="subtitle1" fontWeight={700} fontFamily="Albert Sans, sans-serif">
            {title}
          </Typography>
          {chipNode}
          {lastGenerated && (
            <Tooltip title={`Last generated: ${lastGenerated}`}>
              <Chip
                icon={<AccessTimeIcon sx={{ fontSize: 12 }} />}
                label={lastGenerated}
                size="small"
                sx={{ fontSize: 9, height: 18, ml: 0.5 }}
                variant="outlined"
              />
            </Tooltip>
          )}
          <SectionSignoffControls patientId={patientId} section={signoffSection} />
        </Box>
        <Box sx={{ display: 'flex', gap: 0.5 }}>
          <Button
            size="small"
            startIcon={loading ? <CircularProgress role="progressbar" aria-label="Loading" size={12} /> : <AutoAwesomeIcon />}
            onClick={() => {
              void onGenerate();
            }}
            disabled={loading || persisting}
            sx={{ color: accentColor, fontSize: 11, fontWeight: 600 }}
          >
            {loading ? 'Generating...' : value ? 'Regenerate' : 'Generate with AI'}
          </Button>
          {value && (
            <Button
              size="small"
              startIcon={<EditIcon />}
              onClick={() => {
                setEditing(!editing);
                setEditText(value);
              }}
              disabled={resetLocked}
              sx={{ color: accentColor, fontSize: 11 }}
            >
              {editing ? 'Cancel' : 'Edit'}
            </Button>
          )}
          {value && (
            <Tooltip title={resetLocked ? 'Reset disabled after consultant sign-off' : `Explicitly reset this stored ${title.toLowerCase()}`}>
              <span>
                <Button
                  size="small"
                  onClick={() => {
                    void onHardReset();
                    setEditing(false);
                    setEditText('');
                  }}
                  disabled={persisting || resetLocked}
                  sx={{ color: resetLocked ? 'text.disabled' : '#8D6E63', fontSize: 11 }}
                >
                  Hard reset
                </Button>
              </span>
            </Tooltip>
          )}
        </Box>
      </Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
        {descriptionPrefix}
        {value ? ` Persisted ${title.toLowerCase()} is retained until explicitly reset.` : ` Click "Generate with AI" to build and persist the ${title.toLowerCase()}.`}
      </Typography>
      {resetLocked && (
        <Alert severity="info" sx={{ mb: 1, fontSize: 12 }}>
          This {title.toLowerCase()} is consultant signed-off. It cannot be hard reset, but you can generate a new version and prior signed versions stay in history.
        </Alert>
      )}
      {jobStatus && (
        <Alert severity="info" sx={{ mb: 1, fontSize: 12 }}>
          {jobStatus}
        </Alert>
      )}
      {error && (
        <Alert role="alert" severity="error" sx={{ mb: 1, fontSize: 12 }}>
          {error}
        </Alert>
      )}
      {editing ? (
        <Box>
          <TextField
            fullWidth
            multiline
            rows={editRowCount}
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            sx={{ '& .MuiInputBase-input': { fontFamily: 'monospace', fontSize: 12 } }}
          />
          <Box sx={{ mt: 1, display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
            <Button size="small" onClick={() => setEditing(false)} sx={{ color: 'text.secondary' }}>
              Cancel
            </Button>
            <Button
              size="small"
              variant="contained"
              onClick={async () => {
                if (resetLocked) return;
                const next = editText.trim();
                setValue(next || null);
                try {
                  await onPersistEdit(next);
                  setEditing(false);
                } catch (e) {
                  setError(extractErrorMessage(e, `Failed to persist ${title.toLowerCase()}.`));
                }
              }}
              disabled={persisting || resetLocked}
              sx={{ bgcolor: saveButtonColor, '&:hover': { bgcolor: saveButtonHoverColor } }}
            >
              Save
            </Button>
          </Box>
        </Box>
      ) : (
        <Box
          sx={{
            whiteSpace: 'pre-wrap',
            fontFamily: 'monospace',
            fontSize: 12,
            color: '#3D484B',
            maxHeight: readMaxHeightPx,
            overflowY: 'auto',
            bgcolor: '#FAFAFA',
            p: 2,
            borderRadius: 1,
          }}
        >
          {displayBody}
        </Box>
      )}
      {renderArtifactHistoryCard(historyTitle, history)}
    </Paper>
  );
}
