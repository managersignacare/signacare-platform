// apps/web/src/features/llm/components/LLMSuggestPanel.tsx
import { useState } from 'react';
import {
  Drawer, Box, Typography, IconButton, Divider, Button, TextField,
  Select, MenuItem, FormControl, InputLabel, Alert, CircularProgress,
  Chip, Paper, Tabs, Tab, Accordion, AccordionSummary, AccordionDetails,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import { useLLMSuggest, useLLMHealth } from '../hooks/useLLMSuggest';
import type { LLMSource, SOAPNote } from '../types/llmTypes';

interface Props {
  open: boolean;
  onClose: () => void;
  patientId: string;
  encounterId?: string;
  /** Pre-seeded transcript text from voice/ambient recording */
  transcript?: string;
  /** Pre-seeded note history text for summary generation */
  noteHistory?: string;
  /** Called when user accepts SOAP note output into the note editor */
  onAcceptSOAP?: (soap: SOAPNote) => void;
  /** Called when user accepts free-text output (summary, letter, etc.) */
  onAcceptText?: (text: string) => void;
}

const SOURCE_OPTIONS: Array<{ value: LLMSource; label: string }> = [
  { value: 'voice_transcript', label: 'Voice Transcript' },
  { value: 'ambient', label: 'Ambient Recording' },
  { value: 'manual', label: 'Manual Input' },
  { value: 'note_history', label: 'Note History' },
];

// ── Sub-components ────────────────────────────────────────────────────────────

interface SOAPResultProps { soap: SOAPNote;
  onAccept?: (soap: SOAPNote) => void; }
function SOAPResult({ soap,
  onAccept, }: SOAPResultProps) {
  const sections: Array<{
    key: keyof Omit<SOAPNote, 'aiGenerated' | 'requiresReview'>;
    label: string;
  }> = [
    { key: 'subjective', label: 'Subjective' },
    { key: 'objective', label: 'Objective' },
    { key: 'assessment', label: 'Assessment' },
    { key: 'plan', label: 'Plan' },
  ];

  const copySection = (text: string) => {
    void navigator.clipboard.writeText(text);
  };

  return (
    <Box>
      <Alert role="alert" severity="warning" sx={{ mb: 2 }}>
        <Typography variant="body2" fontWeight={600}>
          AI-generated — review before use
        </Typography>
      </Alert>

      {sections.map(({ key, label }) => (
        <Accordion key={key} defaultExpanded>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography variant="subtitle2">{label}</Typography>
          </AccordionSummary>
          <AccordionDetails>
            <Paper variant="outlined" sx={{ p: 1.5, mb: 1 }}>
              <Typography variant="body2" whiteSpace="pre-wrap">
                {soap[key]}
              </Typography>
            </Paper>
            <Button
              variant="outlined"
              startIcon={<ContentCopyIcon />}
              onClick={() => copySection(soap[key])}
              size="small"
            >
              Copy {label}
            </Button>
          </AccordionDetails>
        </Accordion>
      ))}

      {onAccept && (
        <Box display="flex" justifyContent="flex-end" mt={2}>
          <Button
            variant="contained"
            startIcon={<CheckCircleOutlineIcon />}
            onClick={() => onAccept(soap)}
          >
            Accept into Note
          </Button>
        </Box>
      )}
    </Box>
  );
}

interface TextResultProps { text: string;
  onAccept?: (text: string) => void; }
function TextResult({ text,
  onAccept, }: TextResultProps) {
  return (
    <Box>
      <Alert role="alert" severity="warning" sx={{ mb: 2 }}>
        <Typography variant="body2" fontWeight={600}>
          AI-generated — review before use
        </Typography>
      </Alert>
      <Paper
        variant="outlined"
        sx={{ p: 2, mb: 2, maxHeight: 400, overflowY: 'auto', whiteSpace: 'pre-wrap' }}
      >
        <Typography variant="body2">{text}</Typography>
      </Paper>
      <Box display="flex" gap={1}>
        <Button
          variant="outlined"
          startIcon={<ContentCopyIcon />}
          onClick={() => void navigator.clipboard.writeText(text)}
          size="small"
        >
          Copy
        </Button>
        {onAccept && (
          <Button
            variant="contained"
            startIcon={<CheckCircleOutlineIcon />}
            onClick={() => onAccept(text)}
            size="small"
          >
            Accept
          </Button>
        )}
      </Box>
    </Box>
  );
}

// ── Main Panel ────────────────────────────────────────────────────────────────

export function LLMSuggestPanel({
  open,
  onClose,
  patientId,
  encounterId,
  transcript: preloadedTranscript = '',
  noteHistory: preloadedNoteHistory = '',
  onAcceptSOAP,
  onAcceptText,
}: Props) {
  const [tab, setTab] = useState(0);
  const [transcriptInput, setTranscriptInput] = useState(preloadedTranscript);
  const [summaryInput, setSummaryInput] = useState(preloadedNoteHistory);
  const [letterContext, setLetterContext] = useState('');
  const [riskFactors, setRiskFactors] = useState('');
  const [source, setSource] = useState<LLMSource>('voice_transcript');

  const {
    state,
    requestSOAP,
    requestSummary,
    requestLetter,
    requestRiskAnalysis,
    reset,
  } = useLLMSuggest();
  const { data: health } = useLLMHealth();
  const isLoading = state.status === 'loading';

  return (
    <Drawer
      open={open}
      onClose={onClose}
      anchor="right"
      PaperProps={{ sx: { width: { xs: '100%', sm: 520 } } }}
    >
      {/* ── Header ── */}
      <Box
        display="flex"
        alignItems="center"
        justifyContent="space-between"
        px={2}
        py={1.5}
        borderBottom={1}
        borderColor="divider"
      >
        <Box display="flex" alignItems="center" gap={1}>
          <AutoFixHighIcon color="primary" />
          <Typography variant="h6">AI Suggestions</Typography>
          <Chip
            label={health?.available ? 'Online' : 'Offline'}
            size="small"
            color={health?.available ? 'success' : 'default'}
          />
        </Box>
        <Box display="flex" alignItems="center" gap={1}>
          {state.status !== 'idle' && (
            <Button size="small" onClick={reset}>
              Reset
            </Button>
          )}
          <IconButton onClick={onClose} size="small">
            <CloseIcon />
          </IconButton>
        </Box>
      </Box>

      {!health?.available && (
        <Alert role="alert" severity="warning" sx={{ m: 2 }}>
          <Box display="flex" alignItems="center" gap={1}>
            <WarningAmberIcon fontSize="small" />
            LLM service is currently unavailable. Contact your system administrator.
          </Box>
        </Alert>
      )}

      {/* ── Tabs ── */}
      <Tabs aria-label="Navigation tabs"
        value={tab}
        onChange={(_, v: number) => { setTab(v); reset(); }}
        sx={{ borderBottom: 1, borderColor: 'divider', px: 2 }}
        variant="scrollable"
        scrollButtons="auto"
      >
        <Tab label="SOAP Note" />
        <Tab label="Clinical Summary" />
        <Tab label="Referral Letter" />
        <Tab label="Risk Analysis" />
      </Tabs>

      <Box flex={1} overflow="auto" px={2} py={2}>
        {/* ── Tab 0: SOAP from transcript ── */}
        {tab === 0 && (
          <Box>
            <FormControl size="small" fullWidth sx={{ mb: 2 }}>
              <InputLabel>Source</InputLabel>
              <Select
                value={source}
                onChange={e => setSource(e.target.value as LLMSource)}
                label="Source"
              >
                {SOURCE_OPTIONS.map(o => (
                  <MenuItem key={o.value} value={o.value}>
                    {o.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <TextField
              label="Consultation Transcript"
              multiline
              rows={8}
              fullWidth
              value={transcriptInput}
              onChange={e => setTranscriptInput(e.target.value)}
              disabled={isLoading}
              placeholder="Paste or type the consultation transcript here (min 50 characters)…"
              helperText={`${transcriptInput.length} / 50,000 characters`}
              sx={{ mb: 2 }}
            />

            {state.status === 'error' && (
              <Alert role="alert" severity="error" sx={{ mb: 2 }}>
                {state.error}
              </Alert>
            )}

            <Button
              variant="contained"
              fullWidth
              onClick={() =>
                requestSOAP({
                  patientId,
                  encounterId,
                  transcript: transcriptInput,
                  source,
                })
              }
              disabled={
                transcriptInput.trim().length < 50 ||
                !health?.available ||
                isLoading
              }
              startIcon={
                isLoading ? <CircularProgress role="progressbar" aria-label="Loading" size={16} /> : <AutoFixHighIcon />
              }
            >
              Generate SOAP Note
            </Button>

            {state.status === 'success' &&
              state.result &&
              typeof state.result === 'object' && (
                <Box mt={3}>
                  <Divider sx={{ mb: 2 }} />
                  <SOAPResult
                    soap={state.result as SOAPNote}
                    onAccept={onAcceptSOAP}
                  />
                </Box>
              )}
          </Box>
        )}

        {/* ── Tab 1: Clinical Summary ── */}
        {tab === 1 && (
          <Box>
            <TextField
              label="Note History / Context"
              multiline
              rows={10}
              fullWidth
              value={summaryInput}
              onChange={e => setSummaryInput(e.target.value)}
              disabled={isLoading}
              placeholder="Paste the patient's historical notes for summarisation…"
              helperText={`${summaryInput.length} / 100,000 characters`}
              sx={{ mb: 2 }}
            />

            {state.status === 'error' && (
              <Alert role="alert" severity="error" sx={{ mb: 2 }}>
                {state.error}
              </Alert>
            )}

            <Button
              variant="contained"
              fullWidth
              onClick={() =>
                requestSummary({ patientId, noteHistory: summaryInput })
              }
              disabled={
                summaryInput.trim().length < 50 || !health?.available || isLoading
              }
              startIcon={
                isLoading ? <CircularProgress role="progressbar" aria-label="Loading" size={16} /> : <AutoFixHighIcon />
              }
            >
              Generate Summary
            </Button>

            {state.status === 'success' &&
              typeof state.result === 'string' && (
                <Box mt={3}>
                  <Divider sx={{ mb: 2 }} />
                  <TextResult
                    text={state.result}
                    onAccept={onAcceptText}
                  />
                </Box>
              )}
          </Box>
        )}

        {/* ── Tab 2: Referral Letter ── */}
        {tab === 2 && (
          <Box>
            <TextField
              label="Clinical Context"
              multiline
              rows={8}
              fullWidth
              value={letterContext}
              onChange={e => setLetterContext(e.target.value)}
              disabled={isLoading}
              placeholder="Provide context for the referral letter…"
              helperText={`${letterContext.length} / 20,000 characters`}
              sx={{ mb: 2 }}
            />

            {state.status === 'error' && (
              <Alert role="alert" severity="error" sx={{ mb: 2 }}>
                {state.error}
              </Alert>
            )}

            <Button
              variant="contained"
              fullWidth
              onClick={() =>
                requestLetter({ patientId, context: letterContext })
              }
              disabled={
                letterContext.trim().length < 50 || !health?.available || isLoading
              }
              startIcon={
                isLoading ? <CircularProgress role="progressbar" aria-label="Loading" size={16} /> : <AutoFixHighIcon />
              }
            >
              Draft Referral Letter
            </Button>

            {state.status === 'success' && typeof state.result === 'string' && (
              <Box mt={3}>
                <Divider sx={{ mb: 2 }} />
                <TextResult text={state.result} onAccept={onAcceptText} />
              </Box>
            )}
          </Box>
        )}

        {/* ── Tab 3: Risk Analysis ── */}
        {tab === 3 && (
          <Box>
            <TextField
              label="Risk Factors / Clinical Context"
              multiline
              rows={8}
              fullWidth
              value={riskFactors}
              onChange={e => setRiskFactors(e.target.value)}
              disabled={isLoading}
              placeholder="Describe known risk factors, recent events, protective factors…"
              helperText={`${riskFactors.length} / 10,000 characters`}
              sx={{ mb: 2 }}
            />

            {state.status === 'error' && (
              <Alert role="alert" severity="error" sx={{ mb: 2 }}>
                {state.error}
              </Alert>
            )}

            <Button
              variant="contained"
              fullWidth
              onClick={() =>
                requestRiskAnalysis({ patientId, riskFactors })
              }
              disabled={
                riskFactors.trim().length < 20 || !health?.available || isLoading
              }
              startIcon={
                isLoading ? <CircularProgress role="progressbar" aria-label="Loading" size={16} /> : <AutoFixHighIcon />
              }
            >
              Analyse Risk
            </Button>

            {state.status === 'success' && typeof state.result === 'string' && (
              <Box mt={3}>
                <Divider sx={{ mb: 2 }} />
                <TextResult text={state.result} onAccept={onAcceptText} />
              </Box>
            )}
          </Box>
        )}
      </Box>
    </Drawer>
  );
}
