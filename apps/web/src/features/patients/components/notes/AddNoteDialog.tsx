import MailOutlineIcon from '@mui/icons-material/MailOutline';
import {
    Alert, Box, Button, Checkbox, Chip, CircularProgress, Collapse, Dialog, DialogActions, DialogContent,
    DialogTitle, Divider, FormControl, FormControlLabel, Grid, InputLabel, Menu, MenuItem,
    Select, Switch, TextField, Typography
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import React, { useRef, useState } from 'react';
import { apiClient } from '../../../../shared/services/apiClient';
import { SignacareApiError } from '../../../../shared/services/apiClient';
import { useAuthStore } from '../../../../shared/store/authStore';
import {
  MACRO_IDS,
  MACRO_LABEL,
  MACRO_TRIGGER,
  detectTrigger,
  expandMacro,
  type MacroId,
} from './noteMacros';
import { ContactFormDialog } from './ContactFormDialog';
import { DutyRelationshipDialog } from '../detail/DutyRelationshipDialog';
import { MfaChallengeDialog } from '../../../../shared/components/ui/MfaChallengeDialog';
import { DigitalSignatureDialog, useStaffSignature } from '../../../../shared/components/ui/DigitalSignature';
import {
  patientsKeys,
  episodesKeys,
  outcomeMeasuresKeys,
  patientReferralsKeys,
} from '../../queryKeys';
import { useTemplates } from '../../../templates/hooks/useTemplates';
import { getErrorMessage } from './AddNoteDialogSupport';
import {
  RECENT_RISK_ASSESSMENT_WINDOW_HOURS,
} from '@signacare/shared';
import { useFirstVisitChartReviewGate } from './useFirstVisitChartReviewGate';
import { useRecentRiskAssessmentSignGate } from './useRecentRiskAssessmentSignGate';
import type {
  EpisodeOption,
  Template,
} from './AddNoteDialogSupport';
import { templateSectionsToDraftText } from './AddNoteDialogSupport';
import { LetterGeneratorDialog } from './LetterGeneratorDialog';

type LetterRecipientType = 'provider' | 'patient' | 'support_person';

interface SaveNoteRequest {
  letterRecipientType?: LetterRecipientType;
  status: string;
}

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

  const { data: allTemplatesRaw = [] } = useTemplates({
    status: 'published',
    category: targetCategory,
  });

  // Show ALL templates from the Clinical Notes category (not filtered by sub-type)
  const allTemplates = allTemplatesRaw.filter((t: Template) => {
    // Always show Clinical Notes templates for any clinical note type
    if (targetCategory === 'Clinical Notes') {
      if (t.category !== 'Clinical Notes') return false;
      // Exclude SOAP templates from the dropdown
      const nameLower = (t.name ?? '').toLowerCase();
      if (nameLower.includes('soap')) return false;
      return true;
    }
    return t.category === targetCategory;
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
  // /labs, /vitals, /meds, /problems, /rating scale trigger detector splice live data
  // into the content at the cursor position without losing focus or
  // forcing the user to rebuild their cursor location.
  const contentRef = useRef<HTMLTextAreaElement | null>(null);
  const [macroBusy, setMacroBusy] = useState<MacroId | null>(null);
  const [foiContent, setFoiContent] = useState('');
  const [foiExempt, setFoiExempt] = useState(false);
  const [didNotAttend, setDidNotAttend] = useState(false);

  // ── Contact Form State ──
  const [contactFormOpen, setContactFormOpen] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [dutyDialogOpen, setDutyDialogOpen] = useState(false);
  const [retrySaveAfterDutyRelationship, setRetrySaveAfterDutyRelationship] = useState<SaveNoteRequest | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [letterMenuAnchor, setLetterMenuAnchor] = useState<HTMLElement | null>(null);
  const [postSaveLetterRecipientType, setPostSaveLetterRecipientType] = useState<LetterRecipientType | null>(null);
  const [postSaveLetterSnapshot, setPostSaveLetterSnapshot] = useState<{
    content: string;
    episodeId: string;
    title: string;
  } | null>(null);
  const [savedContactSeed, setSavedContactSeed] = useState<{
    episodeId: string;
    title: string;
  } | null>(null);

  // ── MFA + Signature State ──
  const [mfaOpen, setMfaOpen] = useState(false);
  const [signDialogOpen, setSignDialogOpen] = useState(false);
  const [queuedLetterRecipientType, setQueuedLetterRecipientType] = useState<LetterRecipientType | null>(null);
  const { signature: savedSignature } = useStaffSignature();
  const user = useAuthStore(s => s.user);
  const signerName = `${user?.givenName ?? ''} ${user?.familyName ?? ''}`.trim();

  // MFA only for prescriptions, ECT, TMS, discharge summaries
  const MFA_REQUIRED_TYPES = ['prescription', 'ect', 'tms', 'discharge', 'discharge_summary'];
  const requiresMfa = MFA_REQUIRED_TYPES.includes(noteType);
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
  const supportsLetterFollowOn = noteType !== 'letter' && noteType !== 'message';

  const handleSignWithMfa = () => {
    if (!ensureCanSignFirstVisitChartReview(setSaveError)) {
      return;
    }
    if (!ensureCanSignRecentRiskAssessment(setSaveError)) {
      return;
    }
    setQueuedLetterRecipientType(null);
    if (requiresMfa) {
      setMfaOpen(true);
    } else {
      saveMut.mutate({ status: 'signed' });
    }
  };
  const handleSaveAndGenerateLetter = (recipientType: LetterRecipientType) => {
    setLetterMenuAnchor(null);
    if (!ensureCanSignFirstVisitChartReview(setSaveError)) {
      return;
    }
    if (!ensureCanSignRecentRiskAssessment(setSaveError)) {
      return;
    }
    setQueuedLetterRecipientType(recipientType);
    if (requiresMfa) {
      setMfaOpen(true);
      return;
    }
    saveMut.mutate({ status: 'signed', letterRecipientType: recipientType });
  };
  const handleMfaVerified = () => {
    setMfaOpen(false);
    setSignDialogOpen(true);
  };
  const handleSignatureConfirmed = (_sig: string) => {
    if (!ensureCanSignFirstVisitChartReview(setSaveError)) {
      setSignDialogOpen(false);
      return;
    }
    if (!ensureCanSignRecentRiskAssessment(setSaveError)) {
      setSignDialogOpen(false);
      return;
    }
    setSignDialogOpen(false);
    saveMut.mutate({
      status: 'signed',
      ...(queuedLetterRecipientType ? { letterRecipientType: queuedLetterRecipientType } : {}),
    });
  };

  React.useEffect(() => {
    if (!open) {
      return;
    }
    setEpisodeId(defaultEpisodeId || '');
    setTemplateId('');
    setTitle('');
    setContent(defaultContent);
    setFoiContent('');
    setFoiExempt(false);
    setDidNotAttend(false);
    setContactFormOpen(false);
    setSaveError('');
    setSaveSuccess(false);
    setDutyDialogOpen(false);
    setRetrySaveAfterDutyRelationship(null);
    setLetterMenuAnchor(null);
    setPostSaveLetterRecipientType(null);
    setPostSaveLetterSnapshot(null);
    setQueuedLetterRecipientType(null);
    setSavedContactSeed(null);
    setReviewedRecentLabs(false);
    setReviewedRecentImaging(false);
    setReviewedRecentMedications(false);
  }, [defaultContent, defaultEpisodeId, open, setReviewedRecentImaging, setReviewedRecentLabs, setReviewedRecentMedications]);

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
      const text = templateSectionsToDraftText(tmpl.sections);
      setContent(text);
    }
  };

  // Auto-select default template (Progress Notes) when dialog opens
  React.useEffect(() => {
    if (open && defaultTemplate && !templateId && !defaultContent) {
      setTemplateId(defaultTemplate.id);
      setTitle(defaultTemplate.name);
      const text = templateSectionsToDraftText(defaultTemplate.sections);
      if (text) setContent(text);
    }
  }, [open, defaultTemplate, templateId, defaultContent]);

  const saveMut = useMutation({
    mutationFn: ({ status }: SaveNoteRequest) =>
      apiClient.post(`patients/${patientId}/notes`, {
        episodeId: episodeId || undefined, templateId: templateId || undefined,
        title: title.trim(), noteType, content: content.trim(),
        foiContent: foiExempt ? foiContent.trim() : undefined, foiExempt,
        status, didNotAttend,
        firstVisitChartReview: buildFirstVisitChartReviewPayload(status),
      }),
    onSuccess: async (_response, variables) => {
      // Force refetch (not just invalidate) so data is visible immediately
      await qc.refetchQueries({ queryKey: patientsKeys.notes(patientId) });
      qc.invalidateQueries({ queryKey: patientsKeys.notesPhysical(patientId) });
      qc.invalidateQueries({ queryKey: episodesKeys.byPatient(patientId) });
      await qc.refetchQueries({ queryKey: episodesKeys.notesAll() });
      qc.invalidateQueries({ queryKey: patientReferralsKeys.unifiedContacts(patientId) });
      qc.invalidateQueries({ queryKey: outcomeMeasuresKeys.byPatient(patientId) });
      setSaveError('');
      setDutyDialogOpen(false);
      setRetrySaveAfterDutyRelationship(null);
      setSaveSuccess(true);
      setSavedContactSeed({
        episodeId,
        title: title.trim(),
      });
      if (variables.letterRecipientType) {
        setPostSaveLetterSnapshot({
          content: content.trim(),
          episodeId,
          title: title.trim(),
        });
        setPostSaveLetterRecipientType(variables.letterRecipientType);
      } else {
        setContactFormOpen(true);
      }
      setQueuedLetterRecipientType(null);
      // Reset form fields for next note
      setTitle(''); setContent(''); setTemplateId(''); setFoiContent(''); setFoiExempt(false); setDidNotAttend(false);
      resetFirstVisitChartReview();
    },
    onError: (err: unknown, variables) => {
      if (err instanceof SignacareApiError && err.code === 'NO_PATIENT_RELATIONSHIP') {
        setDutyDialogOpen(true);
        setRetrySaveAfterDutyRelationship(variables);
      } else {
        setRetrySaveAfterDutyRelationship(null);
      }
      setSaveError(getErrorMessage(err, 'Failed to save note. Please try again.'));
    },
  });

  return (
    <>
    <Dialog aria-labelledby="dialog-title" open={open && !contactFormOpen} onClose={onClose} maxWidth="md" fullWidth
      slotProps={{ paper: { sx: { maxHeight: '92vh' } } }}>
      <DialogTitle id="dialog-title" sx={{ fontFamily: 'Albert Sans, sans-serif', fontWeight: 700, pb: 1 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2 }}>
          <Typography variant="h6" fontWeight={700} fontFamily="Albert Sans, sans-serif">
            {noteType === 'message' ? 'Send Message' : noteType === 'report' ? 'Write Report' : noteType === 'letter' ? 'Write Letter' : 'Add Clinical Note'}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ maxWidth: 320, textAlign: 'right' }}>
            AI Assistant and Medical Scribe are available from the main sidebar.
          </Typography>
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

        {/* ═══ NOTE CONTENT ═══ */}
        <Box sx={{ px: 3, py: 2 }}>
          {/* Macro toolbar — clinicians can either click the chip or
              type the trigger ("/labs ", "/vitals ", "/meds ", "/problems ", "/rating scale ")
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
            rows={14}
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
          <Alert
            role="alert"
            severity="error"
            sx={{ fontSize: 12 }}
            onClose={() => {
              setSaveError('');
              setDutyDialogOpen(false);
            }}
            action={retrySaveAfterDutyRelationship ? (
              <Button color="inherit" size="small" onClick={() => setDutyDialogOpen(true)}>
                Add duty relationship
              </Button>
            ) : undefined}
          >
            {saveError}
          </Alert>
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
          <Button variant="outlined" onClick={() => saveMut.mutate({ status: 'draft' })} disabled={!title.trim() || saveMut.isPending}
            sx={{ borderColor: '#327C8D', color: '#327C8D' }}>
            {saveMut.isPending ? <CircularProgress role="progressbar" aria-label="Loading" size={16} /> : 'Save as Draft'}
          </Button>
          {supportsLetterFollowOn && (
            <>
              <Button
                variant="outlined"
                startIcon={<MailOutlineIcon />}
                onClick={(event) => setLetterMenuAnchor(event.currentTarget)}
                disabled={!title.trim() || saveMut.isPending || !canSignFirstVisitChartReview || !canSignRecentRiskAssessment || isCheckingRecentRiskAssessment}
                sx={{ borderColor: '#7B1FA2', color: '#7B1FA2' }}
              >
                Save & Generate Letter
              </Button>
              <Menu
                anchorEl={letterMenuAnchor}
                open={Boolean(letterMenuAnchor)}
                onClose={() => setLetterMenuAnchor(null)}
              >
                <MenuItem onClick={() => handleSaveAndGenerateLetter('provider')}>
                  Provider letter
                </MenuItem>
                <MenuItem onClick={() => handleSaveAndGenerateLetter('patient')}>
                  Patient letter
                </MenuItem>
                <MenuItem onClick={() => handleSaveAndGenerateLetter('support_person')}>
                  Support person letter
                </MenuItem>
              </Menu>
            </>
          )}
          <Button variant="contained" onClick={handleSignWithMfa}
            disabled={!title.trim() || saveMut.isPending || !canSignFirstVisitChartReview || !canSignRecentRiskAssessment || isCheckingRecentRiskAssessment}
            sx={{ bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' } }}>
            {saveMut.isPending ? <CircularProgress role="progressbar" aria-label="Loading" size={16} sx={{ color: '#fff' }} /> : 'Save & Sign'}
          </Button>
        </Box>
      </DialogActions>
    </Dialog>

    {/* MFA Challenge — before signing */}
    <MfaChallengeDialog
      open={mfaOpen}
      onClose={() => {
        setMfaOpen(false);
        setQueuedLetterRecipientType(null);
      }}
      onVerified={handleMfaVerified}
      title="Verify Identity to Sign" description="Signing a clinical document requires verification." />

    {/* Digital Signature — after MFA */}
    <DigitalSignatureDialog
      open={signDialogOpen}
      onClose={() => {
        setSignDialogOpen(false);
        setQueuedLetterRecipientType(null);
      }}
      onSign={handleSignatureConfirmed} signerName={signerName} documentTitle={title}
      savedSignature={savedSignature} />

    {/* Contact Form — opens after note is saved */}
    <ContactFormDialog
      open={contactFormOpen}
      patientId={patientId}
      onClose={async () => {
        setContactFormOpen(false);
        setSavedContactSeed(null);
        await qc.refetchQueries({ queryKey: patientsKeys.notes(patientId) });
        qc.invalidateQueries({ queryKey: patientsKeys.notesPhysical(patientId) });
        onSaved?.();
        onClose();
      }}
      onSaved={async () => {
        setContactFormOpen(false);
        setSavedContactSeed(null);
        await qc.refetchQueries({ queryKey: patientsKeys.notes(patientId) });
        qc.invalidateQueries({ queryKey: patientReferralsKeys.unifiedContacts(patientId) });
        onSaved?.();
        onClose();
      }}
      initialNoteType={noteType}
      initialNoteTitle={savedContactSeed?.title || title.trim() || noteType}
      initialEpisodeId={savedContactSeed?.episodeId || episodeId}
    />
    {postSaveLetterRecipientType && postSaveLetterSnapshot && (
      <LetterGeneratorDialog
        open={true}
        onClose={() => {
          setPostSaveLetterRecipientType(null);
          setPostSaveLetterSnapshot(null);
          setContactFormOpen(true);
        }}
        patientId={patientId}
        noteContent={postSaveLetterSnapshot.content}
        noteTitle={postSaveLetterSnapshot.title}
        recipientType={postSaveLetterRecipientType}
        episodeId={postSaveLetterSnapshot.episodeId}
        onSaved={() => {
          setPostSaveLetterRecipientType(null);
          setPostSaveLetterSnapshot(null);
        setContactFormOpen(true);
      }}
    />
    )}
    <DutyRelationshipDialog
      open={dutyDialogOpen}
      patientId={patientId}
      onClose={() => setDutyDialogOpen(false)}
      onCreated={() => {
        setSaveError('');
        const retrySave = retrySaveAfterDutyRelationship;
        setRetrySaveAfterDutyRelationship(null);
        setDutyDialogOpen(false);
        if (retrySave) {
          saveMut.mutate(retrySave);
        }
      }}
    />
    </>
  );
}
