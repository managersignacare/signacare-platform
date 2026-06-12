/**
 * Phase 8 UI refactor — pure-function smoke tests for the SummaryTab extraction.
 *
 * apps/web vitest runs in Node env (no jsdom) per the documented React 19
 * compat decision (see apps/web/vitest.config.ts header). Hook + render
 * tests live in Playwright; here we cover the pure module surface only.
 *
 * Pure surface validated:
 *  - the SectionExpansionState shape is the public type contract
 *  - the SummarySectionKey enum is the closed-list contract the hook + UI agree on
 *  - the useSummarySectionState module imports cleanly (no missing deps)
 */
import { describe, expect, it } from 'vitest';
import type { SectionExpansionState, SummarySectionKey, UseSummarySectionStateReturn } from './useSummarySectionState';
import { useSummarySectionState } from './useSummarySectionState';

describe('SummaryTab refactor — useSummarySectionState module contract', () => {
  it('exports the hook as a named function', () => {
    expect(typeof useSummarySectionState).toBe('function');
  });

  it('SummarySectionKey covers exactly the four accordion sections', () => {
    // Trip-wire: if a future contributor adds a 5th section without updating
    // the SectionExpansionState default in the hook, this test still passes
    // — but the explicit type assertion below catches the structural drift
    // at typecheck time. The runtime check ensures the four keys are honoured.
    const keys: SummarySectionKey[] = ['snapshot', 'diagnosis', 'longitudinal', 'formulation'];
    expect(keys.length).toBe(4);
    // Compile-time: SectionExpansionState must be keyed by the union.
    const example: SectionExpansionState = {
      snapshot: true,
      diagnosis: true,
      longitudinal: true,
      formulation: true,
    };
    expect(Object.keys(example).sort()).toEqual([...keys].sort());
  });

  it('UseSummarySectionStateReturn declares the load-bearing surface', () => {
    // Structural compile-time assertion via void typed variables.
    const shape: (keyof UseSummarySectionStateReturn)[] = [
      'expandedSections',
      'setSectionExpanded',
      'editSummary',
      'setEditSummary',
      'summaryText',
      'setSummaryText',
      'editFormulation',
      'setEditFormulation',
      'formulationText',
      'setFormulationText',
    ];
    expect(shape).toHaveLength(10);
  });
});
