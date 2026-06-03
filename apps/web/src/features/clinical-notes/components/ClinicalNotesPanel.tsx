import React, { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Button, Divider, Typography, CircularProgress,
  Alert, Tooltip, Paper, Snackbar,
} from '@mui/material';
import AddIcon    from '@mui/icons-material/Add';
import SaveIcon   from '@mui/icons-material/Save';
import CloseIcon  from '@mui/icons-material/Close';
import MailOutlineIcon from '@mui/icons-material/MailOutline';
import { NoteCard }           from './NoteCard';
import { NoteEditor }         from './NoteEditor';
import { NoteSignModal }      from './NoteSignModal';
import { NoteAmendModal }     from './NoteAmendModal';
import { TemplateInsertMenu } from './TemplateInsertMenu';
import { AmbientRecorder }    from './AmbientRecorder';
import { printContent }       from '../../../shared/utils/printContent';
import {
  useClinicalNotes,
  useCreateNote,
  useUpdateNote,
} from '../hooks/useClinicalNotes';
import type { NoteResponse, SoapContent } from '../types/noteTypes';
import type { LLMSoapResponse }           from '../../../shared/types/llmTypes';

type PanelMode = 'list' | 'new' | 'view' | 'edit';

interface Props {
  patientId:  string;
  episodeId?: string;
}

const EMPTY_SOAP: SoapContent = { subjective: '', objective: '', assessment: '', plan: '' };

export const ClinicalNotesPanel: React.FC<Props> = ({ patientId, episodeId }) => {
  const navigate = useNavigate();
  const [mode, setMode]               = useState<PanelMode>('list');
  const [selected, setSelected]       = useState<NoteResponse | null>(null);
  const [soap, setSoap]               = useState<SoapContent>(EMPTY_SOAP);
  const [isAiDraft, setIsAiDraft]     = useState(false);
  const [signOpen, setSignOpen]       = useState(false);
  const [amendTarget, setAmendTarget] = useState<NoteResponse | null>(null);
  // USER-B.4: success toast on save so clinicians get confirmation
  // without needing to interpret the absence of an error as success.
  const [saveToast, setSaveToast] = useState<string | null>(null);

  const { data: notes, isLoading, isError } = useClinicalNotes(patientId, episodeId);
  const { mutate: createNote, isPending: isSaving } = useCreateNote();
  const { mutate: updateNote, isPending: isUpdating } = useUpdateNote();

  const handleDraftReady = useCallback((draft: LLMSoapResponse) => {
    setSoap({
      subjective: draft.subjective,
      objective:  draft.objective,
      assessment: draft.assessment,
      plan:       draft.plan,
    });
    setIsAiDraft(true);
    setMode('new');
  }, []);

  const handleTemplateInsert = useCallback((partial: Partial<SoapContent>) => {
    setSoap((prev) => ({
      subjective: partial.subjective ? prev.subjective + '\n' + partial.subjective : prev.subjective,
      objective:  partial.objective  ? prev.objective  + '\n' + partial.objective  : prev.objective,
      assessment: partial.assessment ? prev.assessment + '\n' + partial.assessment : prev.assessment,
      plan:       partial.plan       ? prev.plan       + '\n' + partial.plan       : prev.plan,
    }));
  }, []);

  const handleSelectNote = (note: NoteResponse) => {
    setSelected(note);
    setSoap({
      subjective: note.soapSubjective ?? '',
      objective:  note.soapObjective  ?? '',
      assessment: note.soapAssessment ?? '',
      plan:       note.soapPlan       ?? '',
    });
    setIsAiDraft(note.isAiDraft && note.status === 'draft');
    // Open drafts directly in edit mode so clinicians can continue writing
    // without having to click through a read-only "view" step.
    setMode(note.status === 'draft' ? 'edit' : 'view');
  };

  const handleNewNote = () => {
    setSelected(null);
    setSoap(EMPTY_SOAP);
    setIsAiDraft(false);
    setMode('new');
  };

  const handleSaveDraft = () => {
    if (mode === 'new') {
      createNote(
        {
          patientId,
          episodeId,
          noteType:       'soap',
          noteDateTime:   new Date().toISOString(),
          content:        soap.subjective || soap.assessment || '(draft)',
          soapSubjective: soap.subjective,
          soapObjective:  soap.objective,
          soapAssessment: soap.assessment,
          soapPlan:       soap.plan,
          isAiDraft,
        },
        { onSuccess: (note) => { setSelected(note); setMode('view'); setSaveToast('Note saved as draft'); } },
      );
    } else if (mode === 'edit' && selected) {
      updateNote(
        {
          id: selected.id,
          dto: {
            content:        soap.subjective || soap.assessment || '(draft)',
            soapSubjective: soap.subjective,
            soapObjective:  soap.objective,
            soapAssessment: soap.assessment,
            soapPlan:       soap.plan,
            isAiDraft,
          },
        },
        { onSuccess: (note) => { setSelected(note); setMode('view'); setSaveToast('Note updated'); } },
      );
    }
  };

  const canEdit = selected?.status === 'draft';

  return (
    <Box sx={{ display: 'flex', height: '100%', gap: 0, backgroundColor: '#FBF8F5' }}>
      {/* ── Sidebar ── */}
      <Box
        sx={{
          width: 280,
          flexShrink: 0,
          borderRight: '1px solid',
          borderColor: 'divider',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: '#FFFFFF',
        }}
      >
        <Box sx={{ p: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
          <Typography
            variant="subtitle1"
            fontWeight={700}
            sx={{ color: '#3D484B', fontFamily: 'Albert Sans, sans-serif', mb: 1 }}
          >
            Clinical Notes
          </Typography>

          <AmbientRecorder patientId={patientId} onDraftReady={handleDraftReady} />

          <Divider sx={{ my: 1 }} />

          <Button
            variant="contained"
            size="small"
            fullWidth
            startIcon={<AddIcon />}
            onClick={handleNewNote}
            sx={{
              backgroundColor: '#327C8D',
              fontFamily: 'Albert Sans, sans-serif',
              textTransform: 'none',
            }}
          >
            New Note
          </Button>
        </Box>

        <Box sx={{ flex: 1, overflowY: 'auto', p: 1, display: 'flex', flexDirection: 'column', gap: 0.75 }}>
          {isLoading && (
            <Box sx={{ display: 'flex', justifyContent: 'center', mt: 3 }}>
              <CircularProgress role="progressbar" aria-label="Loading" size={24} sx={{ color: '#327C8D' }} />
            </Box>
          )}
          {isError && (
            <Alert role="alert" severity="error" sx={{ m: 1 }}>Failed to load notes</Alert>
          )}
          {!isLoading && !isError && notes?.length === 0 && (
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ textAlign: 'center', mt: 4, fontFamily: 'Albert Sans, sans-serif' }}
            >
              No notes yet. Create the first one.
            </Typography>
          )}
          {notes?.map((note) => (
            <NoteCard
              key={note.id}
              note={note}
              selected={selected?.id === note.id}
              onSelect={handleSelectNote}
              onAmend={(n) => setAmendTarget(n)}
            />
          ))}
        </Box>
      </Box>

      {/* ── Main panel ── */}
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {mode === 'list' && (
          <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Typography variant="body2" color="text.secondary" sx={{ fontFamily: 'Albert Sans, sans-serif' }}>
              Select a note from the list or create a new one.
            </Typography>
          </Box>
        )}

        {(mode === 'new' || mode === 'view' || mode === 'edit') && (
          <>
            {/* Toolbar */}
            <Box
              sx={{
                px: 2, py: 1, borderBottom: '1px solid', borderColor: 'divider',
                backgroundColor: '#FFFFFF',
                display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap',
              }}
            >
              {mode === 'new' && (
                <Typography variant="subtitle2" fontWeight={700} sx={{ color: '#3D484B', fontFamily: 'Albert Sans, sans-serif', mr: 'auto' }}>
                  New SOAP Note
                </Typography>
              )}
              {(mode === 'view' || mode === 'edit') && selected && (
                <Typography variant="subtitle2" fontWeight={700} sx={{ color: '#3D484B', fontFamily: 'Albert Sans, sans-serif', mr: 'auto' }}>
                  {selected.noteType.toUpperCase()} —{' '}
                  {new Date(selected.noteDateTime).toLocaleDateString('en-AU', {
                    day: 'numeric', month: 'short', year: 'numeric',
                  })}
                </Typography>
              )}

              {(mode === 'new' || mode === 'edit') && (
                <>
                  <TemplateInsertMenu onInsert={handleTemplateInsert} />
                  <Tooltip title="Save draft">
                    <span>
                      <Button
                        size="small"
                        variant="outlined"
                        startIcon={
                          isSaving || isUpdating
                            ? <CircularProgress role="progressbar" aria-label="Loading" size={14} color="inherit" />
                            : <SaveIcon />
                        }
                        onClick={handleSaveDraft}
                        disabled={isSaving || isUpdating}
                        sx={{ borderColor: '#327C8D', color: '#327C8D', fontFamily: 'Albert Sans, sans-serif' }}
                      >
                        Save Draft
                      </Button>
                    </span>
                  </Tooltip>
                </>
              )}

              {mode === 'view' && selected && (
                <>
                  {canEdit && (
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={() => setMode('edit')}
                      sx={{ borderColor: '#327C8D', color: '#327C8D', fontFamily: 'Albert Sans, sans-serif' }}
                    >
                      Edit
                    </Button>
                  )}
                  <Tooltip title={selected.isAiDraft && selected.status !== 'signed' ? 'Copy / print disabled for unsigned AI drafts (Tier 5.4)' : ''}>
                    <span>
                      <Button
                        size="small"
                        variant="outlined"
                        disabled={selected.isAiDraft && selected.status !== 'signed'}
                        onClick={() => {
                          const content = [soap.subjective, soap.objective, soap.assessment, soap.plan].filter(Boolean).join('\n\n');
                          printContent({
                            title: selected?.noteType?.toUpperCase() ?? 'Clinical Note',
                            subtitle: `${selected?.authorName ?? ''} �� ${selected?.noteDateTime ? new Date(selected.noteDateTime).toLocaleDateString('en-AU') : ''}`,
                            body: content || selected?.content || '',
                          });
                        }}
                        sx={{ borderColor: '#327C8D', color: '#327C8D', fontFamily: 'Albert Sans, sans-serif' }}
                      >
                        Print
                      </Button>
                    </span>
                  </Tooltip>
                  {selected.status === 'draft' && (
                    <Button
                      size="small"
                      variant="contained"
                      onClick={() => setSignOpen(true)}
                      sx={{ backgroundColor: '#4E9C82', fontFamily: 'Albert Sans, sans-serif' }}
                    >
                      Sign Note
                    </Button>
                  )}
                  {selected.status === 'signed' && (
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={() => setAmendTarget(selected)}
                      sx={{ borderColor: '#F0852C', color: '#F0852C', fontFamily: 'Albert Sans, sans-serif' }}
                    >
                      Amend
                    </Button>
                  )}
                  {/* USER-E.1: Generate a letter from this note.
                      Routes to the patient's Correspondence tab with
                      fromNoteId so the composer (once wired in a
                      follow-up) prefills from this note's content.
                      Addresses user complaint "No ability to generate
                      letters from saved notes" by adding an entry path
                      from the note surface itself. The CorrespondenceTab
                      + LetterComposer wiring to consume fromNoteId is
                      tracked in USER-E.2 follow-up (docs/specs/user-e-
                      letters-from-notes.md). */}
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<MailOutlineIcon />}
                    onClick={() => {
                      const qs = new URLSearchParams({
                        tab: 'correspondence',
                        fromNoteId: selected.id,
                        ...(episodeId ? { episodeId } : {}),
                      });
                      navigate(`/patients/${patientId}?${qs.toString()}`);
                    }}
                    sx={{ borderColor: '#327C8D', color: '#327C8D', fontFamily: 'Albert Sans, sans-serif' }}
                  >
                    Generate Letter
                  </Button>
                </>
              )}

              {mode === 'edit' && (
                <Button
                  size="small"
                  startIcon={<CloseIcon />}
                  onClick={() => setMode('view')}
                  color="inherit"
                >
                  Cancel Edit
                </Button>
              )}
            </Box>

            {/* Audit Tier 5.4 — AI-DRAFT banner. When the note is
                 flagged as an AI draft AND has not yet been signed,
                 surface a prominent warning. `isAiDraft` is preserved
                 in the DB even after signing so signed notes still
                 carry the audit trail, but once signed the banner
                 hides because clinician attestation has happened. */}
            {selected && selected.isAiDraft && selected.status !== 'signed' && (
              <Box sx={{ px: 2.5, pt: 2 }}>
                <Alert
                  severity="warning"
                  role="alert"
                  sx={{ mb: 1, fontWeight: 600, fontFamily: 'Albert Sans, sans-serif' }}
                >
                  AI-DRAFT — Pending clinician review. Verify every fact
                  against the source record before signing. Copy / export
                  are disabled until a clinician attests the content.
                </Alert>
              </Box>
            )}

            {/* Editor area */}
            <Box sx={{ flex: 1, overflowY: 'auto', p: 2.5 }}>
              <Paper elevation={0} sx={{ p: 3, borderRadius: 2, border: '1px solid', borderColor: 'divider', backgroundColor: '#FFFFFF' }}>
                <NoteEditor
                  value={soap}
                  onChange={setSoap}
                  isAiDraft={isAiDraft}
                  onAiDraftDismiss={() => setIsAiDraft(false)}
                  readOnly={mode === 'view'}
                  patientId={patientId}
                  episodeId={episodeId ?? null}
                />
              </Paper>
            </Box>
          </>
        )}
      </Box>

      {/* ── Modals ── */}
      <NoteSignModal
        open={signOpen}
        note={selected}
        onClose={() => setSignOpen(false)}
        onSigned={() => { setSignOpen(false); setMode('list'); setSelected(null); }}
      />
      <NoteAmendModal
        open={Boolean(amendTarget)}
        originalNote={amendTarget}
        onClose={() => setAmendTarget(null)}
        onAmended={() => { setAmendTarget(null); setMode('list'); }}
      />
      <Snackbar
        open={Boolean(saveToast)}
        autoHideDuration={3000}
        onClose={() => setSaveToast(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="success" onClose={() => setSaveToast(null)}>
          {saveToast}
        </Alert>
      </Snackbar>
    </Box>
  );
};
