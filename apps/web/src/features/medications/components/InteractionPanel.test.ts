// apps/web/src/features/medications/components/InteractionPanel.test.ts
//
// BUG-521 — Drug-interaction-check fabrication (relocated from
// MedicationsTab.test.ts in BUG-524-A per the hybrid 2-tab split plan).
//
// Pre-fix `InteractionPanel` had THREE silent failure paths converging
// on a single UI gate that displayed "No interactions detected" for:
// (a) successful empty result, (b) partial RxCUI resolution failure,
// (c) total RxCUI resolution failure, (d) outer fetch throw. The
// fatality scenario: RxNav timeout → catch fires → UI shows "No
// interactions detected" → clinician prescribes contraindicated
// combination → patient harm.
//
// Post-fix: status enum distinguishes 'success' / 'partial' / 'failed'.
// The component renders amber/red banners with "verify manually
// before prescribing" on partial/failed so the clinician cannot
// mistake a failed check for a clean check.
//
// Pre-fix RED gate: DI-3, DI-4, DI-5 (the three failure paths).
// Post-fix: 7/7 GREEN.

import { describe, it, expect } from 'vitest';
import { classifyInteractionResult } from './InteractionPanel';

describe('BUG-521 — drug-interaction-check status classifier', () => {
  it('DI-1 — happy path, no interactions: status=success, no failure reason', () => {
    const r = classifyInteractionResult({
      activeMedCount: 3,
      rxcuiResolutionFailures: [],
      resolvedRxcuiCount: 3,
      outerFetchThrew: false,
      outerErrorMessage: null,
    });
    expect(r.status).toBe('success');
    expect(r.failureReason).toBeNull();
  });

  it('DI-2 — happy path with interactions found: status=success', () => {
    // Note: classifier doesn't take interactions array — that's a UI-only concern.
    const r = classifyInteractionResult({
      activeMedCount: 3,
      rxcuiResolutionFailures: [],
      resolvedRxcuiCount: 3,
      outerFetchThrew: false,
      outerErrorMessage: null,
    });
    expect(r.status).toBe('success');
    expect(r.failureReason).toBeNull();
  });

  it('DI-3 — partial RxCUI resolution failure: status=partial (PRE-FIX RED)', () => {
    const r = classifyInteractionResult({
      activeMedCount: 3,
      rxcuiResolutionFailures: ['Sertraline'],
      resolvedRxcuiCount: 2,
      outerFetchThrew: false,
      outerErrorMessage: null,
    });
    expect(r.status).toBe('partial');
    expect(r.failureReason).toContain('Could not check 1 of 3 medications');
    expect(r.failureReason).toContain('Sertraline');
    expect(r.failureReason).toContain('Verify manually');
  });

  it('DI-4 — total RxCUI failure (all meds): status=failed (PRE-FIX RED, fatality class)', () => {
    const r = classifyInteractionResult({
      activeMedCount: 3,
      rxcuiResolutionFailures: ['Sertraline', 'Tramadol', 'Linezolid'],
      resolvedRxcuiCount: 0,
      outerFetchThrew: false,
      outerErrorMessage: null,
    });
    expect(r.status).toBe('failed');
    expect(r.failureReason).toContain('Could not look up medication identifiers');
    expect(r.failureReason).toContain('Sertraline, Tramadol, Linezolid');
    expect(r.failureReason).toContain('verify manually before prescribing');
  });

  it('DI-5 — interaction-list fetch threw: status=failed (PRE-FIX RED, fatality class)', () => {
    const r = classifyInteractionResult({
      activeMedCount: 3,
      rxcuiResolutionFailures: [],
      resolvedRxcuiCount: 3,
      outerFetchThrew: true,
      outerErrorMessage: 'TypeError: Failed to fetch',
    });
    expect(r.status).toBe('failed');
    expect(r.failureReason).toContain('Drug interaction check failed');
    expect(r.failureReason).toContain('TypeError: Failed to fetch');
    expect(r.failureReason).toContain('Verify manually before prescribing');
  });

  it('DI-6 — legitimate single-med case: status=success (NOT a failure)', () => {
    const r = classifyInteractionResult({
      activeMedCount: 1,
      rxcuiResolutionFailures: [],
      resolvedRxcuiCount: 1,
      outerFetchThrew: false,
      outerErrorMessage: null,
    });
    expect(r.status).toBe('success');
    expect(r.failureReason).toBeNull();
  });

  it('DI-7 — outerFetchThrew takes precedence over rxcui failures', () => {
    // If the outer try threw mid-flight, that's the dominant failure
    // signal even if some RxCUIs had also failed earlier.
    const r = classifyInteractionResult({
      activeMedCount: 3,
      rxcuiResolutionFailures: ['Sertraline'],
      resolvedRxcuiCount: 2,
      outerFetchThrew: true,
      outerErrorMessage: 'Network error',
    });
    expect(r.status).toBe('failed');
    expect(r.failureReason).toContain('Network error');
  });

  it('DI-8 — discontinued/retired interaction service: status=partial with manual-verify guidance', () => {
    const r = classifyInteractionResult({
      activeMedCount: 3,
      rxcuiResolutionFailures: [],
      resolvedRxcuiCount: 3,
      outerFetchThrew: false,
      outerErrorMessage: null,
      interactionServiceUnavailable: true,
      interactionServiceReason: 'Automated NLM drug-interaction feed is unavailable. Verify interactions manually before prescribing.',
    });
    expect(r.status).toBe('partial');
    expect(r.failureReason).toContain('Automated NLM drug-interaction feed is unavailable');
    expect(r.failureReason).toContain('Verify interactions manually before prescribing');
  });
});
