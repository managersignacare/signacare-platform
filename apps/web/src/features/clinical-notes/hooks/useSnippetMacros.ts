// apps/web/src/features/clinical-notes/hooks/useSnippetMacros.ts
//
// S7.2 — Keyboard macros for quick-inserting clinical data into notes.
//
// Wires Alt+Shift+<key> keyboard shortcuts on any textarea to fetch a
// formatted snippet from GET /clinical-notes/patient/:id/snippets?types=...
// and insert the returned markdown at the current cursor position.
//
// Keybindings (all modifier = Alt+Shift, mnemonic = first letter):
//   Alt+Shift+P   pathology (latest 5 results)
//   Alt+Shift+R   risk assessment (latest severity + domains)
//   Alt+Shift+O   outcome measures (latest 5 scores)
//   Alt+Shift+V   vitals (latest BP/HR/Temp/SpO2/RR/Wt/BMI)
//   Alt+Shift+M   medications (active list)
//   Alt+Shift+A   allergies (active list)
//   Alt+Shift+?   show this shortcut list in a transient toast
//
// The hook is deliberately decoupled from the editor's state management.
// Callers pass `onInsert(text)` which is responsible for splicing the
// snippet into the value at the cursor position — the MUI SOAP
// TextField wrapper in NoteEditor does that via setSelectionRange.
//
// Accessibility: Alt+Shift is used instead of Cmd/Ctrl because the
// latter two conflict with browser/OS shortcuts (Cmd+P = print,
// Ctrl+R = reload) and would be hostile to keyboard-only users.
//
// Fix Registry: SNIP-HOOK1 (hook exports useSnippetMacros),
// SNIP-HOOK2 (Alt+Shift modifier enforced).

import { useCallback, useEffect, useRef } from 'react';
import { apiClient } from '../../../shared/services/apiClient';

export type SnippetKey = 'pathology' | 'risk' | 'outcomes' | 'vitals' | 'meds' | 'allergies';

interface Snippet {
  type: SnippetKey;
  text: string;
  recordCount: number;
  fetchedAt: string;
}

interface SnippetResponse {
  snippets: Snippet[];
}

/** Map of shortcut letter -> snippet type. Letters are case-insensitive. */
export const SNIPPET_SHORTCUTS: Record<string, SnippetKey> = {
  p: 'pathology',
  r: 'risk',
  o: 'outcomes',
  v: 'vitals',
  m: 'meds',
  a: 'allergies',
};

export const SNIPPET_HELP_LINES: string[] = [
  'Alt+Shift+P — pathology (latest 5 results)',
  'Alt+Shift+R — risk assessment (latest severity + domains)',
  'Alt+Shift+O — outcome measures (latest 5 scores)',
  'Alt+Shift+V — vitals (latest BP/HR/Temp/SpO₂/RR/Wt/BMI)',
  'Alt+Shift+M — active medications',
  'Alt+Shift+A — active allergies',
  'Alt+Shift+? — show this shortcut list',
];

interface UseSnippetMacrosOptions {
  patientId: string | null | undefined;
  /**
   * USER-A.3: scope per-episode snippets (outcomes) to the episode the
   * note is attached to. Omit for pre-episode intake flows.
   */
  episodeId?: string | null;
  /**
   * Called with the formatted snippet text when the user triggers a
   * shortcut. The caller is responsible for splicing the text into the
   * underlying value at the cursor — see NoteEditor SoapField.
   */
  onInsert: (text: string) => void;
  /**
   * Called when the user presses Alt+Shift+? to show the shortcut list.
   * The caller typically opens a toast or snackbar.
   */
  onHelp?: (lines: string[]) => void;
  /**
   * Called when a snippet fetch fails. Defaults to console.error.
   */
  onError?: (err: Error) => void;
  /**
   * Disable all shortcuts for read-only note views.
   */
  disabled?: boolean;
}

/**
 * Returns an `onKeyDown` handler to attach to a textarea and a
 * `fetchAndInsert(type)` helper for explicit toolbar buttons.
 */
export function useSnippetMacros(opts: UseSnippetMacrosOptions) {
  const { patientId, episodeId, onInsert, onHelp, onError, disabled } = opts;
  // Keep the latest callbacks in refs so the handler closure stays
  // stable across renders and we don't rebind listeners.
  const insertRef = useRef(onInsert);
  const helpRef = useRef(onHelp);
  const errorRef = useRef(onError);
  useEffect(() => { insertRef.current = onInsert; }, [onInsert]);
  useEffect(() => { helpRef.current = onHelp; }, [onHelp]);
  useEffect(() => { errorRef.current = onError; }, [onError]);

  const fetchAndInsert = useCallback(
    async (type: SnippetKey): Promise<void> => {
      if (!patientId) return;
      try {
        const params: { types: SnippetKey; episodeId?: string } = { types: type };
        if (episodeId) params.episodeId = episodeId;
        const res = await apiClient.instance.get<SnippetResponse>(
          `clinical-notes/patient/${patientId}/snippets`,
          { params },
        );
        const snippet = res.data.snippets.find((s) => s.type === type);
        if (snippet) {
          insertRef.current(`\n${snippet.text}\n`);
        }
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        if (errorRef.current) errorRef.current(e);
        else console.error('Failed to fetch snippet', type, e);
      }
    },
    [patientId, episodeId],
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>): void => {
      if (disabled) return;
      // Require BOTH Alt and Shift to avoid stepping on browser shortcuts.
      if (!event.altKey || !event.shiftKey) return;
      // Help shortcut: Alt+Shift+? (key = '?' on most layouts, 'Slash' code)
      if (event.key === '?' || (event.key === '/' && event.shiftKey)) {
        event.preventDefault();
        if (helpRef.current) helpRef.current(SNIPPET_HELP_LINES);
        return;
      }
      const letter = event.key.toLowerCase();
      const type = SNIPPET_SHORTCUTS[letter];
      if (!type) return;
      event.preventDefault();
      void fetchAndInsert(type);
    },
    [disabled, fetchAndInsert],
  );

  return { onKeyDown, fetchAndInsert };
}
