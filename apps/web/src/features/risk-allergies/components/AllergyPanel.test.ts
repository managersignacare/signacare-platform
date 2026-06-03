// apps/web/src/features/risk-allergies/components/AllergyPanel.test.ts
//
// BUG-545 — Allergy CRUD silent-error swallow (relocated from
// MedicationsTab.test.ts in BUG-524-A per the hybrid 2-tab split plan).
//
// Pre-fix `AllergyPanel` had THREE silent failure paths converging on
// success-shaped UI: handleAdd (POST /allergies), archive (PATCH
// status='inactive'), restore (PATCH status='active'). Each `} catch {}`
// allowed the dialog to close + form to clear (handleAdd) or the row
// to visually update (archive/restore via React-Query refetch that
// never fires because the mutation 4xx'd). UI fabricated success.
//
// Per BUG-530 SSoT (CLAUDE.md §16): convert each silent-catch into
// `await tryAsync(() => apiClient.X(...))` and narrow with `isErr(r)`.
// `classifyAllergyMutation` is the pure-function extraction that the
// failure-path test can pin without a render harness (BUG-525 jsdom
// gap; render-time pin deferred there).
//
// Pre-fix RED gate: AL-2 + AL-3 + AL-4 (the three failure paths and
// the cross-class duck-type preservation).

import { describe, it, expect } from 'vitest';
import { Result, AppError } from '@signacare/shared';
import { buildAllergyCreatePayload, classifyAllergyMutation } from './AllergyPanel';

describe('BUG-545 — allergy mutation result classifier', () => {
  it('AL-1 — ok arm: kind=success, message=null', () => {
    const r = classifyAllergyMutation(Result.ok({ id: 'allergy-123' }));
    expect(r.kind).toBe('success');
    expect(r.message).toBeNull();
  });

  it('AL-2 — err arm with 422 AppError: kind=failed, surfaces message (PRE-FIX RED)', () => {
    // Pre-fix the empty catch swallowed this; the dialog closed + form
    // cleared as if save succeeded. Post-fix the err arm flows through
    // to a non-empty message that the UI surfaces in <Alert>.
    const r = classifyAllergyMutation(
      Result.err(new AppError('allergen field is required', 422, 'VALIDATION_ERROR')),
    );
    expect(r.kind).toBe('failed');
    expect(r.message).toContain('allergen field is required');
  });

  it('AL-3 — err arm with UNKNOWN_THROWN (network throw): still routes to failed (PRE-FIX RED)', () => {
    // Network failure → fromUnknown wraps into AppError(500,
    // UNKNOWN_THROWN). Pre-fix this was indistinguishable from success.
    const networkErr = new AppError('TypeError: Failed to fetch', 500, 'UNKNOWN_THROWN');
    const r = classifyAllergyMutation(Result.err(networkErr));
    expect(r.kind).toBe('failed');
    expect(r.message).toContain('Failed to fetch');
  });

  it('AL-4 — message preservation across api-side AppError(404, NOT_FOUND) (cross-class duck-type)', () => {
    // BUG-530 RES-7c precedent: api-side AppError → fromUnknown
    // duck-type preserves the .status / .code / .message even if the
    // shared-side AppError instanceof check fails. Pin the message
    // signal does not silently downgrade to 500/UNKNOWN_THROWN.
    const r = classifyAllergyMutation(
      Result.err(new AppError('allergy not found', 404, 'NOT_FOUND')),
    );
    expect(r.kind).toBe('failed');
    expect(r.message).toBe('allergy not found');
  });
});

describe('allergy create payload contract', () => {
  it('maps UI values to canonical API enums (allergenType + life_threatening severity)', () => {
    const payload = buildAllergyCreatePayload({
      patientId: '11111111-1111-1111-1111-111111111111',
      allergen: ' Penicillin ',
      reaction: ' anaphylaxis ',
      severityLabel: 'Life-threatening',
      allergenType: 'drug',
    });
    expect(payload).toEqual({
      patientId: '11111111-1111-1111-1111-111111111111',
      allergen: 'Penicillin',
      reaction: 'anaphylaxis',
      allergenType: 'drug',
      severity: 'life_threatening',
      status: 'active',
    });
  });
});
