import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import DescriptionIcon from '@mui/icons-material/Description';
import LocalHospitalIcon from '@mui/icons-material/LocalHospital';
import MailOutlineIcon from '@mui/icons-material/MailOutline';
import MicIcon from '@mui/icons-material/Mic';
import {
    Alert, Box, Button, Checkbox, Chip, CircularProgress, Collapse, Dialog, DialogActions, DialogContent,
    DialogTitle, Divider, FormControl, FormControlLabel, Grid, InputLabel, Menu, MenuItem,
    Select, Switch, TextField, Typography
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import React, { useCallback, useRef, useState } from 'react';
import { apiClient } from '../../../../shared/services/apiClient';
import { useAuthStore } from '../../../../shared/store/authStore';
import type { AmbientNoteResult } from '../../../../shared/types/llmTypes';
import { AiDraftSignAttestationCheckbox } from './AiDraftSignAttestationCheckbox';
import { AmbientAiRecorder } from './AmbientAiRecorder';
import { buildAddNoteScribeMeta } from './addNoteDialogScribeMeta';
import { LetterGeneratorDialog } from './LetterGeneratorDialog';
import {
  MACRO_IDS,
  MACRO_LABEL,
  MACRO_TRIGGER,
  detectTrigger,
  expandMacro,
  type MacroId,
} from './noteMacros';
import { ContactFormDialog } from './ContactFormDialog';
import { MfaChallengeDialog } from '../../../../shared/components/ui/MfaChallengeDialog';
import { DigitalSignatureDialog, useStaffSignature } from '../../../../shared/components/ui/DigitalSignature';
import {
  patientsKeys,
  episodesKeys,
  outcomeMeasuresKeys,
  patientReferralsKeys,
  patientTemplatesKeys,
} from '../../queryKeys';
import { getErrorMessage } from './AddNoteDialogSupport';
import {
  RECENT_RISK_ASSESSMENT_WINDOW_HOURS,
} from '@signacare/shared';
import { useAiDraftSignAttestation } from './useAiDraftSignAttestation';
import { useFirstVisitChartReviewGate } from './useFirstVisitChartReviewGate';
import { useRecentRiskAssessmentSignGate } from './useRecentRiskAssessmentSignGate';
import type {
  EpisodeOption,
  Template,
  TemplateField,
} from './AddNoteDialogSupport';

export interface AddNoteDialogProps {
  open: boolean;
  onClose: () => void;
  patientId: string;
  defaultEpisodeId?: string;
  noteType?: string;
  defaultContent?: string;
  onSaved?: () => void;
}

export function AddNoteDialog({ open, onClose, patientId, defaultEpisodeId, noteType = 'progress', defaultContent = '', onSaved }: AddNoteDialogProps) {
  const qc = useQueryClient();

  // Fetch active episodes
  const { data: episodes } = useQuery({
    queryKey: episodesKeys.active(patientId),
    queryFn: () =>
      apiClient
        .get<{ data: EpisodeOption[] }>(`episodes/patient/${patientId}`)
        .then((r) => (r.data ?? []).filter((e: EpisodeOption) => e.status === 'open')),
    enabled: !!patientId,
  });

  // Fetch templates
  const categoryMap: Record<string, string> = {
    progress: 'Clinical Notes', ward_round: 'Clinical Notes', intake: 'Clinical Notes',
    lai: 'Clinical Notes', clozapine: 'Clinical Notes', review: 'Clinical Notes',
    incident: 'Clinical Notes', physical_health: 'Clinical Notes',
    consumer_peer_support: 'Clinical Notes', carer_peer_support: 'Clinical Notes',
    letter: 'Letters', report: 'Reports', message: 'Messages', certificate: 'Certificates',
  };
  const targetCategory = categoryMap[noteType] ?? 'Clinical Notes';

  const { data: allTemplatesRaw } = useQuery({
    queryKey: patientTemplatesKeys.byType('all'),
    queryFn: () => apiClient.get<{ templates: Template[] }>('staff-settings/templates').then(r => r.templates),
  });

  // Show ALL templates from the Clinical Notes category (not filtered by sub-type)
  const allTemplates = (allTemplatesRaw ?? []).filter(t => {
    if (!t.categoryName) return false;
    // Always show Clinical Notes templates for any clinical note type
    if (targetCategory === 'Clinical Notes') {
      if (t.categoryName !== 'Clinical Notes') return false;
      // Exclude SOAP templates from the dropdown
      const nameLower = (t.name ?? '').toLowerCase();
      if (nameLower.includes('soap')) return false;
      return true;
    }
    return t.categoryName === targetCategory;
  });

  // Find the default "Progress Notes" template
  const defaultTemplate = allTemplates.find(t =>
    t.name.toLowerCase().includes('progress') && t.name.toLowerCase().includes('note')
  ) ?? allTemplates[0];

  const [episodeId, setEpisodeId] = useState(defaultEpisodeId || '');
  const [templateId, setTemplateId] = useState('');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState(defaultContent);
  // Note-content textarea ref + macro state. The textarea ref lets the
  // /labs, /vitals, /meds, /problems trigger detector splice live data
  // into the content at the cursor position without losing focus or
  // forcing the user to rebuild their cursor location.
  const contentRef = useRef<HTMLTextAreaElement | null>(null);
  const [macroBusy, setMacroBusy] = useState<MacroId | null>(null);
  const [foiContent, setFoiContent] = useState('');
  const [foiExempt, setFoiExempt] = useState(false);
  const [didNotAttend, setDidNotAttend] = useState(false);

  // ── Scribe State ──
  const [mode, setMode] = useState<'write' | 'scribe'>('scribe');
  const [scribeResult, setScribeResult] = useState<AmbientNoteResult | null>(null);

  // ── Contact Form State ──
  const [contactFormOpen, setContactFormOpen] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saveSuccess, setSaveSuccess] = useState(false);

  // ── MFA + Signature State ──
  const [mfaOpen, setMfaOpen] = useState(false);
  const [signDialogOpen, setSignDialogOpen] = useState(false);
  const { signature: savedSignature } = useStaffSignature();
  const user = useAuthStore(s => s.user);
  const signerName = `${user?.givenName ?? ''} ${user?.familyName ?? ''}`.trim();

  // MFA only for prescriptions, ECT, TMS, discharge summaries
  const MFA_REQUIRED_TYPES = ['prescription', 'ect', 'tms', 'discharge', 'discharge_summary'];
  const requiresMfa = MFA_REQUIRED_TYPES.includes(noteType);
  const isAiDraftNote = scribeResult !== null;
  const {
    reviewedAndAdopted,
    requiresAiDraftAttestation,
    canSign,
    onReviewedAndAdoptedChange,
    ensureCanSignAiDraft,
    resetReviewedAndAdopted,
  } = useAiDraftSignAttestation({
    isAiDraftNote,
    saveError,
    setSaveError,
  });
  const {
    requiresFirstVisitChartReview,
    canSignFirstVisitChartReview,
    reviewedRecentLabs,
    reviewedRecentImaging,
    reviewedRecentMedications,
    setReviewedRecentLabs,
    setReviewedRecentImaging,
    setReviewedRecentMedications,
    buildFirstVisitChartReviewPayload,
    ensureCanSignFirstVisitChartReview,
    resetFirstVisitChartReview,
  } = useFirstVisitChartReviewGate({
    open,
    patientId,
    noteType,
  });
  const {
    requiresRecentRiskAssessment,
    hasRecentRiskAssessment,
    canSignRecentRiskAssessment,
    isCheckingRecentRiskAssessment,
    latestRiskAssessmentAtIso,
    ensureCanSignRecentRiskAssessment,
  } = useRecentRiskAssessmentSignGate({
    open,
    patientId,
    noteType,
  });

  const handleSignWithMfa = () => {
    if (!ensureCanSignAiDraft()) {
      return;
    }
    if (!ensureCanSignFirstVisitChartReview(setSaveError)) {
      return;
    }
    if (!ensureCanSignRecentRiskAssessment(setSaveError)) {
      return;
    }
    if (requiresMfa) {
      setMfaOpen(true);
    } else {
      saveMut.mutate('signed');
    }
  };
  const handleMfaVerified = () => {
    setMfaOpen(false);
    setSignDialogOpen(true);
  };
  const handleSignatureConfirmed = (_sig: string) => {
    if (!ensureCanSignAiDraft()) {
      setSignDialogOpen(false);
      return;
    }
    if (!ensureCanSignFirstVisitChartReview(setSaveError)) {
      setSignDialogOpen(false);
      return;
    }
    if (!ensureCanSignRecentRiskAssessment(setSaveError)) {
      setSignDialogOpen(false);
      return;
    }
    setSignDialogOpen(false);
    saveMut.mutate('signed');
  };

  // ── Letter Generation State ──
  const [letterMenuAnchor, setLetterMenuAnchor] = useState<null | HTMLElement>(null);
  const [letterDialogOpen, setLetterDialogOpen] = useState(false);
  const [letterRecipientType, setLetterRecipientType] = useState<'provider' | 'patient' | 'support_person'>('provider');
  const [letterSelectedTypes, setLetterSelectedTypes] = useState<Set<string>>(new Set());
  const [_letterContent, setLetterContent] = useState('');
  const [_letterGenerating, _setLetterGenerating] = useState(false);
  const [_letterSaved, setLetterSaved] = useState(false);
  const [_letterContactOpen, _setLetterContactOpen] = useState(false);

  // Auto-select first active episode — runs whenever episodes load
  React.useEffect(() => {
    if (episodes?.length && !episodeId) {
      setEpisodeId(episodes[0].id);
    }
  }, [episodes]);
  // Also set when dialog opens
  React.useEffect(() => {
    if (open && episodes?.length && !episodeId) {
      setEpisodeId(episodes[0].id);
    }
  }, [open, episodes]);

  const handleTemplateChange = (id: string) => {
    setTemplateId(id);
    const tmpl = allTemplates.find(t => t.id === id);
    if (tmpl) {
      setTitle(tmpl.name);
      const text = tmpl.content?.map((f: TemplateField) => {
        if (f.type === 'heading') return `\n=== ${f.text || f.label} ===\n`;
        if (f.type === 'instruction') return `[${f.text}]\n`;
        if (f.type === 'text_block') return f.text + '\n';
        if (f.type === 'short_answer') return `${f.label}:\n\n`;
        if (f.type === 'yes_no') return `${f.label}: [ ] Yes  [ ] No\n`;
        if (f.type === 'multiple_choice') return `${f.label}: ${(f.options ?? []).map((o: string) => `[ ] ${o}`).join('  ')}\n`;
        if (f.type === 'likert') return `${f.label}: [${f.min ?? 0}-${f.max ?? 10}]\n`;
        return '';
      }).join('') ?? '';
      setContent(text);
    }
  };

  // Auto-select default template (Progress Notes) when dialog opens
  React.useEffect(() => {
    if (open && defaultTemplate && !templateId && !defaultContent) {
      setTemplateId(defaultTemplate.id);
      setTitle(defaultTemplate.name);
      const text = defaultTemplate.content?.map((f: TemplateField) => {
        if (f.type === 'heading') return `\n=== ${f.text || f.label} ===\n`;
        if (f.type === 'instruction') return `[${f.text}]\n`;
        if (f.type === 'text_block') return f.text + '\n';
        if (f.type === 'short_answer') return `${f.label}:\n\n`;
        if (f.type === 'yes_no') return `${f.label}: [ ] Yes  [ ] No\n`;
        if (f.type === 'multiple_choice') return `${f.label}: ${(f.options ?? []).map((o: string) => `[ ] ${o}`).join('  ')}\n`;
        if (f.type === 'likert') return `${f.label}: [${f.min ?? 0}-${f.max ?? 10}]\n`;
        return '';
      }).join('') ?? '';
      if (text) setContent(text);
    }
  }, [open, defaultTemplate, templateId, defaultContent]);

  // When scribe completes, populate the note content AND store the result
  const handleScribeReady = useCallback((noteText: string) => {
    setContent(prev => prev ? prev + '\n\n' + noteText : noteText);
    // Auto-set title if empty
    if (!title) setTitle('Clinical Note (AI Scribe)');
  }, [title]);

  const saveMut = useMutation({
    mutationFn: (status: string) => {
      const scribeMeta = buildAddNoteScribeMeta(scribeResult);
      return apiClient.post(`patients/${patientId}/notes`, {
        episodeId: episodeId || undefined, templateId: templateId || undefined,
        title: title.trim(), noteType, content: content.trim(),
        foiContent: foiExempt ? foiContent.trim() : undefined, foiExempt,
        status, didNotAttend,
        isAiDraft: isAiDraftNote,
        reviewedAndAdopted: status === 'signed' ? reviewedAndAdopted : undefined,
        firstVisitChartReview: buildFirstVisitChartReviewPayload(status),
        ...(scribeMeta ? { scribeMeta } : {}),
      });
    },
    onSuccess: async () => {
      // Force refetch (not just invalidate) so data is visible immediately
      await qc.refetchQueries({ queryKey: patientsKeys.notes(patientId) });
      qc.invalidateQueries({ queryKey: patientsKeys.notesPhysical(patientId) });
      qc.invalidateQueries({ queryKey: episodesKeys.byPatient(patientId) });
      await qc.refetchQueries({ queryKey: episodesKeys.notesAll() });
      qc.invalidateQueries({ queryKey: patientReferralsKeys.unifiedContacts(patientId) });
      qc.invalidateQueries({ queryKey: outcomeMeasuresKeys.byPatient(patientId) });
      setSaveError('');
      setSaveSuccess(true);
      // Reset form fields for next note
      setTitle(''); setContent(''); setTemplateId(''); setFoiContent(''); setFoiExempt(false); setDidNotAttend(false);
      resetFirstVisitChartReview();
      resetReviewedAndAdopted();
      setScribeResult(null); setLetterContent(''); setLetterSaved(false); setLetterSelectedTypes(new Set());
      // Show contact form after saving (for clinical encounters)
      setContactFormOpen(true);
    },
    onError: (err: unknown) => {
      setSaveError(getErrorMessage(err, 'Failed to save note. Please try again.'));
    },
  });

  return (
    <>
    <Dialog aria-labelledby="dialog-title" open={open && !contactFormOpen} onClose={onClose} maxWidth="md" fullWidth
      slotProps={{ paper: { sx: { maxHeight: '92vh' } } }}>
      <DialogTitle id="dialog-title" sx={{ fontFamily: 'Albert Sans, sans-serif', fontWeight: 700, pb: 1 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography variant="h6" fontWeight={700} fontFamily="Albert Sans, sans-serif">
            {noteType === 'message' ? 'Send Message' : noteType === 'report' ? 'Write Report' : noteType === 'letter' ? 'Write Letter' : 'Add Clinical Note'}
          </Typography>
          {/* Mode toggle: Write vs AI Scribe */}
          <Box sx={{ display: 'flex', bgcolor: '#f5f0eb', borderRadius: 2, p: 0.25 }}>
            <Button
              size="small"
              startIcon={<DescriptionIcon sx={{ fontSize: 16 }} />}
              onClick={() => setMode('write')}
              sx={{
                fontSize: 12, textTransform: 'none', borderRadius: 1.5, px: 2, minHeight: 32,
                bgcolor: mode === 'write' ? '#fff' : 'transparent',
                color: mode === 'write' ? '#3D484B' : '#999',
                fontWeight: mode === 'write' ? 600 : 400,
                boxShadow: mode === 'write' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                '&:hover': { bgcolor: mode === 'write' ? '#fff' : '#f0ebe4' },
              }}>
              Write
            </Button>
            <Button
              size="small"
              startIcon={<LocalHospitalIcon sx={{ fontSize: 16 }} />}
              onClick={() => setMode('scribe')}
              sx={{
                fontSize: 12, textTransform: 'none', borderRadius: 1.5, px: 2, minHeight: 32,
                bgcolor: mode === 'scribe' ? '#327C8D' : 'transparent',
                color: mode === 'scribe' ? '#fff' : '#999',
                fontWeight: mode === 'scribe' ? 600 : 400,
                boxShadow: mode === 'scribe' ? '0 1px 3px rgba(0,0,0,0.15)' : 'none',
                '&:hover': { bgcolor: mode === 'scribe' ? '#2a6a79' : '#f0ebe4' },
              }}>
              AI Scribe
            </Button>
          </Box>
        </Box>
      </DialogTitle>
      <Divider />
      <DialogContent sx={{ p: 0 }}>
        {/* ═══ TOP: Episode + Template Row ═══ */}
        <Box sx={{ px: 3, pt: 2, pb: 1.5 }}>
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, sm: 4 }}>
              <FormControl fullWidth size="small">
                <InputLabel>Episode *</InputLabel>
                <Select value={episodeId} onChange={e => setEpisodeId(e.target.value)} label="Episode *">
                  {(episodes ?? []).map((ep: EpisodeOption) => <MenuItem key={ep.id} value={ep.id}>{ep.title} ({ep.episodeType})</MenuItem>)}
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <FormControl fullWidth size="small">
                <InputLabel>Template</InputLabel>
                <Select value={templateId} onChange={e => handleTemplateChange(e.target.value)} label="Template">
                  <MenuItem value="">— Blank Note —</MenuItem>
                  {allTemplates.map(t => <MenuItem key={t.id} value={t.id}>{t.name}</MenuItem>)}
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                <TextField label="Note Title *" fullWidth size="small" value={title} onChange={e => setTitle(e.target.value)} autoFocus />
                <FormControlLabel
                  control={<Checkbox checked={didNotAttend} onChange={(_, v) => setDidNotAttend(v)} size="small"
                    sx={{ color: '#D32F2F', '&.Mui-checked': { color: '#D32F2F' }, p: 0.5 }} />}
                  label={<Typography variant="caption" color={didNotAttend ? 'error' : 'text.secondary'} fontWeight={didNotAttend ? 700 : 400} sx={{ fontSize: 11 }}>DNA</Typography>}
                  sx={{ ml: 0, mr: 0 }}
                />
              </Box>
            </Grid>
          </Grid>
        </Box>

        <Divider />

        {/* ═══ AI SCRIBE SECTION (when scribe mode selected) ═══ */}
        {mode === 'scribe' && (
          <Box sx={{ px: 3, py: 2, bgcolor: '#f8f6f3', borderBottom: '1px solid', borderColor: 'divider' }}>
            <AmbientAiRecorder
              onTranscriptReady={handleScribeReady}
              patientId={patientId}
              onResultReady={setScribeResult}
            />

            {/* Scribe result summary chips */}
            {scribeResult && (
              <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', mt: 1.5, pt: 1.5, borderTop: '1px solid #e8e3dc' }}>
                {scribeResult.questScore && (
                  <Chip size="small" label={`QUEST: ${scribeResult.questScore.grade}`}
                    sx={{ fontSize: 10, height: 22, fontWeight: 700,
                      bgcolor: scribeResult.questScore.grade === 'A' ? '#E8F5E9' : scribeResult.questScore.grade === 'B' ? '#E3F2FD' : '#FFF3E0',
                      color: scribeResult.questScore.grade === 'A' ? '#2E7D32' : scribeResult.questScore.grade === 'B' ? '#1565C0' : '#E65100' }} />
                )}
                {scribeResult.riskAssessment && (
                  <Chip size="small" label={`Risk: ${scribeResult.riskAssessment.overallLevel}`}
                    sx={{ fontSize: 10, height: 22, fontWeight: 600,
                      bgcolor: scribeResult.riskAssessment.overallLevel === 'critical' ? '#FFEBEE' : scribeResult.riskAssessment.overallLevel === 'high' ? '#FFF3E0' : '#E8F5E9',
                      color: scribeResult.riskAssessment.overallLevel === 'critical' ? '#D32F2F' : scribeResult.riskAssessment.overallLevel === 'high' ? '#E65100' : '#2E7D32' }} />
                )}
                {(scribeResult.icd10Suggestions?.length ?? 0) > 0 && (
                  <Chip size="small" variant="outlined" label={`ICD-10: ${scribeResult.icd10Suggestions!.map(c => c.code).join(', ')}`}
                    sx={{ fontSize: 10, height: 22, fontFamily: 'monospace' }} />
                )}
                {(scribeResult.outcomeMeasures?.length ?? 0) > 0 && (
                  scribeResult.outcomeMeasures!.map(m => (
                    <Chip key={m.instrument} size="small" variant="outlined"
                      label={`${m.instrument}: ${m.score} (${m.severity})`}
                      sx={{ fontSize: 10, height: 22 }} />
                  ))
                )}
                {(scribeResult.verifiedMedications?.length ?? 0) > 0 && (
                  <Chip size="small" variant="outlined" label={`${scribeResult.verifiedMedications!.length} meds verified`}
                    sx={{ fontSize: 10, height: 22 }} />
                )}
                {(scribeResult.scribeActions?.length ?? 0) > 0 && (
                  <Chip size="small" variant="outlined" label={`${scribeResult.scribeActions!.length} actions`}
                    sx={{ fontSize: 10, height: 22, color: '#1565C0' }} />
                )}
                {scribeResult.interpreterUsed && (
                  <Chip size="small" label="Interpreter" icon={<MicIcon sx={{ fontSize: 12 }} />}
                    sx={{ fontSize: 10, height: 22, bgcolor: '#E3F2FD', color: '#1565C0' }} />
                )}
                <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10, alignSelf: 'center', ml: 'auto' }}>
                  Scribe data saved with note
                </Typography>
              </Box>
            )}
          </Box>
        )}

        {/* ═══ NOTE CONTENT ═══ */}
        <Box sx={{ px: 3, py: 2 }}>
          {/* Macro toolbar — clinicians can either click the chip or
              type the trigger ("/labs ", "/vitals ", "/meds ", "/problems ")
              followed by a space inside the textarea. Both paths fetch
              live data and splice it in at the cursor. */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 1, flexWrap: 'wrap' }}>
            <Typography variant="caption" color="text.secondary" sx={{ mr: 1 }}>
              Insert live data:
            </Typography>
            {MACRO_IDS.map((id) => (
              <Chip
                key={id}
                size="small"
                label={macroBusy === id ? `${MACRO_LABEL[id]}…` : MACRO_LABEL[id]}
                variant="outlined"
                disabled={!!macroBusy}
                onClick={async () => {
                  if (macroBusy) return;
                  setMacroBusy(id);
                  try {
                    const block = await expandMacro(id, patientId);
                    setContent((prev) => {
                      const ta = contentRef.current;
                      const caret = ta?.selectionStart ?? prev.length;
                      const before = prev.slice(0, caret);
                      const after = prev.slice(caret);
                      const sep = before.length === 0 || before.endsWith('\n') ? '' : '\n';
                      const next = `${before}${sep}${block}${after}`;
                      // Restore focus + place cursor after the inserted block.
                      requestAnimationFrame(() => {
                        if (ta) {
                          const newCaret = before.length + sep.length + block.length;
                          ta.focus();
                          ta.setSelectionRange(newCaret, newCaret);
                        }
                      });
                      return next;
                    });
                  } finally {
                    setMacroBusy(null);
                  }
                }}
                sx={{ fontSize: 11, height: 22 }}
              />
            ))}
            <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
              or type {MACRO_IDS.map((id) => MACRO_TRIGGER[id]).join(' ')} + space
            </Typography>
          </Box>
          <TextField
            label="Note Content"
            fullWidth
            multiline
            rows={mode === 'scribe' ? 10 : 14}
            value={content}
            inputRef={contentRef}
            onChange={async (e) => {
              const next = e.target.value;
              const caret = e.target.selectionStart ?? next.length;
              const hit = detectTrigger(next, caret);
              if (hit && !macroBusy) {
                // Splice the trigger out of the value immediately so the
                // textarea reads the correct intermediate state, then
                // expand asynchronously.
                const stripped = next.slice(0, hit.start) + next.slice(hit.end);
                setContent(stripped);
                setMacroBusy(hit.id);
                try {
                  const block = await expandMacro(hit.id, patientId);
                  setContent((prev) => {
                    const before = prev.slice(0, hit.start);
                    const after = prev.slice(hit.start);
                    const sep = before.length === 0 || before.endsWith('\n') ? '' : '\n';
                    const merged = `${before}${sep}${block}${after}`;
                    requestAnimationFrame(() => {
                      const ta = contentRef.current;
                      if (ta) {
                        const newCaret = before.length + sep.length + block.length;
                        ta.focus();
                        ta.setSelectionRange(newCaret, newCaret);
                      }
                    });
                    return merged;
                  });
                } finally {
                  setMacroBusy(null);
                }
                return;
              }
              setContent(next);
            }}
            sx={{ '& .MuiInputBase-input': { fontFamily: 'monospace', fontSize: 12 } }}
          />
        </Box>

        {/* FOI Exempt */}
        <Box sx={{ px: 3, pb: 2 }}>
          <FormControlLabel
            control={<Switch checked={foiExempt} onChange={(_, v) => setFoiExempt(v)} size="small" />}
            label={<Typography variant="body2">FOI Exempt information (stored separately)</Typography>}
          />
          <Collapse in={foiExempt}>
            <TextField label="FOI Exempt Content" fullWidth multiline rows={4} value={foiContent} onChange={e => setFoiContent(e.target.value)}
              helperText="This content is stored separately and excluded from Freedom of Information requests"
              sx={{ mt: 1, '& .MuiInputBase-input': { fontFamily: 'monospace', fontSize: 12 } }} />
          </Collapse>
        </Box>

        {requiresFirstVisitChartReview && (
          <Box sx={{ px: 3, pb: 2 }}>
            <Alert severity="warning" sx={{ mb: 1.5 }}>
              First-visit chart review is required before signing this note.
            </Alert>
            <Typography variant="body2" sx={{ mb: 1 }}>
              Confirm review completed for all three before using Save &amp; Sign:
            </Typography>
            <FormControlLabel
              control={
                <Checkbox
                  checked={reviewedRecentLabs}
                  onChange={(_, v) => setReviewedRecentLabs(v)}
                  size="small"
                />
              }
              label={<Typography variant="body2">Recent labs reviewed</Typography>}
              sx={{ display: 'block', ml: 0 }}
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={reviewedRecentImaging}
                  onChange={(_, v) => setReviewedRecentImaging(v)}
                  size="small"
                />
              }
              label={<Typography variant="body2">Recent imaging reviewed</Typography>}
              sx={{ display: 'block', ml: 0 }}
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={reviewedRecentMedications}
                  onChange={(_, v) => setReviewedRecentMedications(v)}
                  size="small"
                />
              }
              label={<Typography variant="body2">Recent medications reviewed</Typography>}
              sx={{ display: 'block', ml: 0 }}
            />
          </Box>
        )}

        {requiresRecentRiskAssessment && (
          <Box sx={{ px: 3, pb: 2 }}>
            <Alert severity={hasRecentRiskAssessment ? 'success' : 'warning'} sx={{ mb: 1.5 }}>
              {hasRecentRiskAssessment
                ? `Recent risk assessment check passed (within ${RECENT_RISK_ASSESSMENT_WINDOW_HOURS} hours).`
                : `A risk assessment completed within the last ${RECENT_RISK_ASSESSMENT_WINDOW_HOURS} hours is required before signing this first psychiatric note.`}
            </Alert>
            <Typography variant="body2" color="text.secondary">
              {latestRiskAssessmentAtIso
                ? `Latest assessment: ${new Date(latestRiskAssessmentAtIso).toLocaleString('en-AU')}`
                : 'No risk assessment found for this patient yet.'}
            </Typography>
            {!hasRecentRiskAssessment && (
              <Typography variant="body2" sx={{ mt: 0.5 }}>
                Complete Risk &amp; Safety assessment first, then return to sign this note.
              </Typography>
            )}
          </Box>
        )}
      </DialogContent>
      {saveError && (
        <Box sx={{ px: 3, pb: 1 }}>
          <Alert role="alert" severity="error" sx={{ fontSize: 12 }} onClose={() => setSaveError('')}>{saveError}</Alert>
        </Box>
      )}
      {saveSuccess && !contactFormOpen && (
        <Box sx={{ px: 3, pb: 1 }}>
          <Alert severity="success" sx={{ fontSize: 12 }}>Note saved successfully</Alert>
        </Box>
      )}
      <Divider />
      <DialogActions sx={{ px: 3, py: 2, justifyContent: 'space-between' }}>
        <Button onClick={onClose} sx={{ color: 'text.secondary' }}>Cancel</Button>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
          <AiDraftSignAttestationCheckbox
            visible={requiresAiDraftAttestation}
            checked={reviewedAndAdopted}
            onChange={onReviewedAndAdoptedChange}
          />
          {/* Generate Letter dropdown — multi-select with checkboxes */}
          <Button size="small" variant="outlined" endIcon={<ArrowDropDownIcon />}
            onClick={(e) => setLetterMenuAnchor(e.currentTarget)}
            disabled={!content.trim()}
            sx={{ borderColor: '#1565C0', color: '#1565C0', textTransform: 'none', fontSize: 12 }}>
            <MailOutlineIcon sx={{ fontSize: 16, mr: 0.5 }} /> Generate Letter{letterSelectedTypes.size > 0 ? ` (${letterSelectedTypes.size})` : ''}
          </Button>
          <Menu anchorEl={letterMenuAnchor} open={Boolean(letterMenuAnchor)}
            onClose={() => setLetterMenuAnchor(null)}>
            {([
              { key: 'provider', icon: <LocalHospitalIcon sx={{ fontSize: 16, color: '#327C8D' }} />, label: 'Provider (GP/Specialist)' },
              { key: 'patient', icon: <DescriptionIcon sx={{ fontSize: 16, color: '#b8621a' }} />, label: 'Patient' },
              { key: 'support_person', icon: <MailOutlineIcon sx={{ fontSize: 16, color: '#7B1FA2' }} />, label: 'Support Person / Carer' },
            ] as const).map(opt => (
              <MenuItem key={opt.key} onClick={() => {
                const next = new Set(letterSelectedTypes);
                next.has(opt.key) ? next.delete(opt.key) : next.add(opt.key);
                setLetterSelectedTypes(next);
              }}>
                <Checkbox size="small" checked={letterSelectedTypes.has(opt.key)} sx={{ p: 0.5, mr: 1 }} />
                {opt.icon}
                <Typography variant="body2" sx={{ ml: 1, fontSize: 12 }}>{opt.label}</Typography>
              </MenuItem>
            ))}
            <Divider />
            <MenuItem onClick={() => {
              if (letterSelectedTypes.size === 0) return;
              const first = [...letterSelectedTypes][0] as 'provider' | 'patient' | 'support_person';
              setLetterRecipientType(first);
              setLetterDialogOpen(true);
              setLetterMenuAnchor(null);
            }} disabled={letterSelectedTypes.size === 0}>
              <AutoAwesomeIcon sx={{ fontSize: 16, mr: 1, color: '#1565C0' }} />
              <Typography variant="body2" fontWeight={600} sx={{ fontSize: 12, color: '#1565C0' }}>
                Generate {letterSelectedTypes.size > 0 ? `${letterSelectedTypes.size} Letter${letterSelectedTypes.size > 1 ? 's' : ''}` : 'Letters'}
              </Typography>
            </MenuItem>
          </Menu>

          <Button variant="outlined" onClick={() => saveMut.mutate('draft')} disabled={!title.trim() || saveMut.isPending}
            sx={{ borderColor: '#327C8D', color: '#327C8D' }}>
            {saveMut.isPending ? <CircularProgress role="progressbar" aria-label="Loading" size={16} /> : 'Save as Draft'}
          </Button>
          <Button variant="contained" onClick={handleSignWithMfa}
            disabled={!title.trim() || saveMut.isPending || !canSign || !canSignFirstVisitChartReview || !canSignRecentRiskAssessment || isCheckingRecentRiskAssessment}
            sx={{ bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' } }}>
            {saveMut.isPending ? <CircularProgress role="progressbar" aria-label="Loading" size={16} sx={{ color: '#fff' }} /> : 'Save & Sign'}
          </Button>
        </Box>
      </DialogActions>
    </Dialog>

    {/* MFA Challenge — before signing */}
    <MfaChallengeDialog open={mfaOpen} onClose={() => setMfaOpen(false)} onVerified={handleMfaVerified}
      title="Verify Identity to Sign" description="Signing a clinical document requires verification." />

    {/* Digital Signature — after MFA */}
    <DigitalSignatureDialog open={signDialogOpen} onClose={() => setSignDialogOpen(false)}
      onSign={handleSignatureConfirmed} signerName={signerName} documentTitle={title}
      savedSignature={savedSignature} />

    {/* Contact Form — opens after note is saved */}
    <ContactFormDialog
      open={contactFormOpen}
      patientId={patientId}
      onClose={async () => {
        setContactFormOpen(false);
        await qc.refetchQueries({ queryKey: patientsKeys.notes(patientId) });
        qc.invalidateQueries({ queryKey: patientsKeys.notesPhysical(patientId) });
        onSaved?.();
        onClose();
      }}
      onSaved={async () => {
        setContactFormOpen(false);
        await qc.refetchQueries({ queryKey: patientsKeys.notes(patientId) });
        qc.invalidateQueries({ queryKey: patientReferralsKeys.unifiedContacts(patientId) });
        onSaved?.();
        onClose();
      }}
      initialNoteType={noteType}
      initialNoteTitle={title.trim() || noteType}
      initialEpisodeId={episodeId}
    />
    {/* Letter Generator Dialog — only mount when open to prevent crashes */}
    {letterDialogOpen && <LetterGeneratorDialog
      open={letterDialogOpen}
      onClose={() => { setLetterDialogOpen(false); setLetterContent(''); setLetterSaved(false); }}
      patientId={patientId}
      noteContent={content}
      noteTitle={title}
      recipientType={letterRecipientType}
      episodeId={episodeId}
      onSaved={() => {
        setLetterDialogOpen(false);
        qc.invalidateQueries({ queryKey: patientsKeys.notes(patientId) });
        qc.invalidateQueries({ queryKey: patientReferralsKeys.unifiedContacts(patientId) });
      }}
    />}
    </>
  );
}
