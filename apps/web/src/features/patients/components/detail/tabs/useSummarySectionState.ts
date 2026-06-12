/**
 * Phase 8 UI refactor — accordion expansion + edit-text state extracted
 * from SummaryTab.
 *
 * Defaults match the original ClinicalSummaryPanel: all four accordion
 * sections start expanded so the clinician sees the snapshot, diagnosis,
 * longitudinal summary, and formulation immediately. The edit textareas
 * are seeded empty until the user clicks "Edit" against an existing
 * artifact.
 */
import { useCallback, useState } from 'react';

export type SummarySectionKey = 'snapshot' | 'diagnosis' | 'longitudinal' | 'formulation';

export type SectionExpansionState = Record<SummarySectionKey, boolean>;

const DEFAULT_EXPANDED: SectionExpansionState = {
  snapshot: true,
  diagnosis: true,
  longitudinal: true,
  formulation: true,
};

export interface UseSummarySectionStateReturn {
  expandedSections: SectionExpansionState;
  setSectionExpanded: (section: SummarySectionKey, expanded: boolean) => void;
  editSummary: boolean;
  setEditSummary: (next: boolean) => void;
  summaryText: string;
  setSummaryText: (next: string) => void;
  editFormulation: boolean;
  setEditFormulation: (next: boolean) => void;
  formulationText: string;
  setFormulationText: (next: string) => void;
}

export function useSummarySectionState(): UseSummarySectionStateReturn {
  const [expandedSections, setExpandedSections] = useState<SectionExpansionState>(DEFAULT_EXPANDED);
  const [editSummary, setEditSummary] = useState(false);
  const [summaryText, setSummaryText] = useState('');
  const [editFormulation, setEditFormulation] = useState(false);
  const [formulationText, setFormulationText] = useState('');

  const setSectionExpanded = useCallback((section: SummarySectionKey, expanded: boolean) => {
    setExpandedSections((prev) => ({ ...prev, [section]: expanded }));
  }, []);

  return {
    expandedSections,
    setSectionExpanded,
    editSummary,
    setEditSummary,
    summaryText,
    setSummaryText,
    editFormulation,
    setEditFormulation,
    formulationText,
    setFormulationText,
  };
}
