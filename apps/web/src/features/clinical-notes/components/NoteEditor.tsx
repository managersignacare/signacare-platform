import React, { useEffect, useRef, useState } from 'react';
import { Box, TextField, Typography, Divider, Snackbar, Alert } from '@mui/material';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { AIDraftBanner } from './AIDraftBanner';
import type { SoapContent } from '../types/noteTypes';
import { useSnippetMacros } from '../hooks/useSnippetMacros';

// ─── Rich-text editor (used for freeform / correspondence notes) ─────────────
interface RichEditorProps {
  content: string;
  onChange: (html: string) => void;
  readOnly?: boolean;
  placeholder?: string;
}

export const RichNoteEditor: React.FC<RichEditorProps> = ({
  content, onChange, readOnly = false, placeholder = 'Begin typing…',
}) => {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder }),
    ],
    content,
    editable: !readOnly,
    onUpdate: ({ editor: ed }) => onChange(ed.getHTML()),
  });

  useEffect(() => {
    if (editor && editor.getHTML() !== content) {
      editor.commands.setContent(content);
    }
  }, [content, editor]);

  return (
    <Box
      sx={{
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 1,
        p: 1.5,
        minHeight: 120,
        fontFamily: 'Albert Sans, sans-serif',
        fontSize: '0.9rem',
        backgroundColor: readOnly ? '#F7F7F7' : '#FFFFFF',
        '& .ProseMirror': { outline: 'none', minHeight: 80 },
        '& .ProseMirror p.is-editor-empty:first-of-type::before': {
          content: 'attr(data-placeholder)',
          color: '#bbb',
          pointerEvents: 'none',
          float: 'left',
          height: 0,
        },
      }}
    >
      <EditorContent editor={editor} />
    </Box>
  );
};

// ─── SOAP field (multiline TextField) ────────────────────────────────────────
interface SoapFieldProps {
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
  readOnly?: boolean;
  minRows?: number;
  onKeyDown?: React.KeyboardEventHandler;
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>;
}

const SoapField: React.FC<SoapFieldProps> = ({
  label, hint, value, onChange, readOnly = false, minRows = 3, onKeyDown, textareaRef,
}) => (
  <Box>
    <Typography
      variant="overline"
      sx={{ color: '#327C8D', fontWeight: 700, letterSpacing: 1.2, fontFamily: 'Albert Sans, sans-serif' }}
    >
      {label}
    </Typography>
    <TextField
      multiline
      minRows={minRows}
      fullWidth
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
      disabled={readOnly}
      variant="outlined"
      size="small"
      placeholder={hint}
      inputRef={textareaRef}
      // Announce the keyboard macro availability to assistive-tech users
      // via aria-describedby. The describing text lives in a single
      // sr-only element per editor (rendered in NoteEditor below).
      aria-describedby="note-snippet-help"
      sx={{
        mt: 0.5,
        '& .MuiOutlinedInput-root': {
          fontFamily: 'Albert Sans, sans-serif',
          fontSize: '0.9rem',
          backgroundColor: readOnly ? '#F7F7F7' : '#FFFFFF',
        },
      }}
    />
  </Box>
);

// ─── Main NoteEditor ──────────────────────────────────────────────────────────
interface Props {
  value: SoapContent;
  onChange: (v: SoapContent) => void;
  isAiDraft?: boolean;
  onAiDraftDismiss?: () => void;
  readOnly?: boolean;
  /**
   * Patient id for the quick-insert keyboard macros (Alt+Shift+<key>).
   * When omitted the shortcuts are disabled — they are a pure no-op
   * rather than throwing, so historical / template note renders that
   * don't have a patient in context continue to work.
   */
  patientId?: string | null;
  /**
   * USER-A.3: episode id for per-episode snippets (outcomes). When the
   * note is attached to an episode, snippets are scoped to that episode
   * only so cross-episode PHI doesn't bleed into the draft.
   */
  episodeId?: string | null;
}

type SoapField = keyof SoapContent;

export const NoteEditor: React.FC<Props> = ({
  value, onChange, isAiDraft = false, onAiDraftDismiss, readOnly = false, patientId, episodeId,
}) => {
  const set = (field: SoapField) => (v: string) =>
    onChange({ ...value, [field]: v });

  // Which SOAP section currently has keyboard focus. The quick-insert
  // macro inserts the snippet into whichever field the clinician is
  // editing — that way the same shortcut can target Subjective during
  // intake, Objective during exam, or Plan during follow-up without
  // any mode switching.
  const focusedRef = useRef<SoapField | null>(null);

  const subjectiveRef = useRef<HTMLTextAreaElement>(null);
  const objectiveRef = useRef<HTMLTextAreaElement>(null);
  const assessmentRef = useRef<HTMLTextAreaElement>(null);
  const planRef = useRef<HTMLTextAreaElement>(null);
  const refs: Record<SoapField, React.RefObject<HTMLTextAreaElement | null>> = {
    subjective: subjectiveRef,
    objective: objectiveRef,
    assessment: assessmentRef,
    plan: planRef,
  };

  const [snack, setSnack] = useState<{ open: boolean; message: string; severity: 'info' | 'error' }>(
    { open: false, message: '', severity: 'info' },
  );

  /**
   * Splice the snippet text into whichever SOAP field currently has
   * focus, at the cursor position. Falls back to 'subjective' if the
   * user triggered the shortcut before clicking into any field.
   */
  const insertAtCursor = (text: string): void => {
    const field = focusedRef.current ?? 'subjective';
    const textarea = refs[field].current;
    if (!textarea) {
      // Append to the end of the field value as a safe fallback.
      onChange({ ...value, [field]: `${value[field]}${text}` });
      return;
    }
    const start = textarea.selectionStart ?? textarea.value.length;
    const end = textarea.selectionEnd ?? textarea.value.length;
    const next = `${textarea.value.slice(0, start)}${text}${textarea.value.slice(end)}`;
    onChange({ ...value, [field]: next });
    // Restore the cursor position after the inserted text on next tick —
    // React has to rerender the controlled input first.
    requestAnimationFrame(() => {
      const newPos = start + text.length;
      textarea.focus();
      textarea.setSelectionRange(newPos, newPos);
    });
  };

  const { onKeyDown: macroKeyDown } = useSnippetMacros({
    patientId: patientId ?? null,
    episodeId: episodeId ?? null,
    disabled: readOnly || !patientId,
    onInsert: insertAtCursor,
    onHelp: (lines) =>
      setSnack({ open: true, message: lines.join('  •  '), severity: 'info' }),
    onError: () =>
      setSnack({
        open: true,
        message: 'Failed to load snippet — check network and retry',
        severity: 'error',
      }),
  });

  const keyDownForField = (field: SoapField): React.KeyboardEventHandler =>
    (event) => {
      focusedRef.current = field;
      // MUI TextField dispatches onKeyDown at the root <div>; the hook
      // accepts the more specific textarea/input target type because
      // that is the actual event target at runtime.
      macroKeyDown(event as unknown as React.KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>);
    };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
      {isAiDraft && <AIDraftBanner onDismiss={onAiDraftDismiss} />}

      {/* Screen-reader description of the keyboard macros. Hidden visually
          but linked via aria-describedby from every SOAP textarea so
          NVDA / VoiceOver announce the shortcuts on focus. */}
      <Box
        id="note-snippet-help"
        sx={{
          position: 'absolute',
          width: '1px',
          height: '1px',
          padding: 0,
          margin: '-1px',
          overflow: 'hidden',
          clip: 'rect(0, 0, 0, 0)',
          border: 0,
        }}
      >
        Keyboard shortcuts: Alt+Shift+P pathology, Alt+Shift+R risk, Alt+Shift+O outcomes,
        Alt+Shift+V vitals, Alt+Shift+M medications, Alt+Shift+A allergies, Alt+Shift+? help.
      </Box>

      <SoapField
        label="S — Subjective"
        hint="Patient's reported symptoms, concerns, and history in their own words…"
        value={value.subjective}
        onChange={set('subjective')}
        readOnly={readOnly}
        minRows={3}
        onKeyDown={keyDownForField('subjective')}
        textareaRef={subjectiveRef}
      />
      <Divider />
      <SoapField
        label="O — Objective"
        hint="Clinician observations, vitals, MSE findings, medication review…"
        value={value.objective}
        onChange={set('objective')}
        readOnly={readOnly}
        minRows={3}
        onKeyDown={keyDownForField('objective')}
        textareaRef={objectiveRef}
      />
      <Divider />
      <SoapField
        label="A — Assessment"
        hint="Clinical formulation, diagnosis, risk rating, progress towards goals…"
        value={value.assessment}
        onChange={set('assessment')}
        readOnly={readOnly}
        minRows={4}
        onKeyDown={keyDownForField('assessment')}
        textareaRef={assessmentRef}
      />
      <Divider />
      <SoapField
        label="P — Plan"
        hint="Treatment decisions, referrals, medication changes, review date, follow-up…"
        value={value.plan}
        onChange={set('plan')}
        readOnly={readOnly}
        minRows={4}
        onKeyDown={keyDownForField('plan')}
        textareaRef={planRef}
      />

      <Snackbar
        open={snack.open}
        autoHideDuration={6000}
        onClose={() => setSnack((s) => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert
          onClose={() => setSnack((s) => ({ ...s, open: false }))}
          severity={snack.severity}
          variant="filled"
          role={snack.severity === 'error' ? 'alert' : 'status'}
        >
          {snack.message}
        </Alert>
      </Snackbar>
    </Box>
  );
};
