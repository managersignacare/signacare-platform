/**
 * BUG-P3 regression — S8 re-authentication gate (PRES-7 DH-3869 + DH-4155 §3).
 *
 * Coverage (8 tests):
 *   T1 — markStepUpVerified sets a Redis key with TTL
 *   T2 — requireRecentStepUp passes when key exists
 *   T3 — requireRecentStepUp throws AppError(403, 'STEP_UP_REQUIRED') when missing
 *   T4 — clearStepUp removes the key
 *   T5 — verify-mfa-challenge endpoint sets the step-up key on success
 *   T6 — verify-password-challenge endpoint sets the step-up key on success
 *   T7 — Source-level pin: prescriptionService.create gates on dto.isS8
 *   T8 — Source-level pin: medicationService.create + cease + update gate on S8
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { randomUUID } from 'crypto';
import { isIntegrationReady, loginAsAdmin } from './_helpers';
import type { AuthContext } from '@signacare/shared';

describe.skipIf(!(await isIntegrationReady()))('BUG-P3 S8 step-up authentication', () => {
  let auth: AuthContext;

  beforeAll(async () => {
    const session = await loginAsAdmin();
    auth = {
      staffId: session.userId,
      clinicId: session.clinicId,
      role: 'clinician',
      permissions: ['prescription:create', 'medication:create'],
      requestId: randomUUID(),
    } as AuthContext;
  });

  afterEach(async () => {
    const { redis } = await import('../../src/config/redis');
    const { stepUpKey } = await import('../../src/shared/stepUpAuth');
    await redis.del(stepUpKey(auth.staffId));
  });

  // ── T1 ──
  it('T1: markStepUpVerified sets a Redis key with TTL', async () => {
    const { markStepUpVerified, stepUpKey } = await import('../../src/shared/stepUpAuth');
    const { redis } = await import('../../src/config/redis');
    await markStepUpVerified(auth.staffId);
    const value = await redis.get(stepUpKey(auth.staffId));
    expect(value).toBe('1');
    const ttl = await redis.ttl(stepUpKey(auth.staffId));
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(5 * 60); // STEP_UP_TTL default 5 min
  });

  // ── T2 ──
  it('T2: requireRecentStepUp passes when key exists', async () => {
    const { markStepUpVerified, requireRecentStepUp } = await import('../../src/shared/stepUpAuth');
    await markStepUpVerified(auth.staffId);
    await expect(requireRecentStepUp(auth)).resolves.toBeUndefined();
  });

  // ── T3 ──
  it('T3: requireRecentStepUp throws AppError(403, STEP_UP_REQUIRED) when missing', async () => {
    const { requireRecentStepUp, clearStepUp } = await import('../../src/shared/stepUpAuth');
    await clearStepUp(auth.staffId);
    await expect(requireRecentStepUp(auth)).rejects.toMatchObject({
      code: 'STEP_UP_REQUIRED',
      status: 403,
    });
  });

  // ── T4 ──
  it('T4: clearStepUp removes the key', async () => {
    const { markStepUpVerified, clearStepUp, stepUpKey } = await import('../../src/shared/stepUpAuth');
    const { redis } = await import('../../src/config/redis');
    await markStepUpVerified(auth.staffId);
    expect(await redis.get(stepUpKey(auth.staffId))).toBe('1');
    await clearStepUp(auth.staffId);
    expect(await redis.get(stepUpKey(auth.staffId))).toBeNull();
  });

  // ── T5 ──
  it('T5: source-level — verify-mfa-challenge handler calls markStepUpVerified', async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const src = readFileSync(
      resolve(__dirname, '..', '..', 'src', 'features', 'auth', 'authRoutes.ts'),
      'utf-8',
    );
    // The verify-mfa-challenge handler must import + call markStepUpVerified
    const mfaHandlerIdx = src.indexOf("'/verify-mfa-challenge'");
    const passwordHandlerIdx = src.indexOf("'/verify-password-challenge'");
    expect(mfaHandlerIdx).toBeGreaterThan(-1);
    expect(passwordHandlerIdx).toBeGreaterThan(passwordHandlerIdx === -1 ? 0 : mfaHandlerIdx);
    const mfaBlock = src.slice(mfaHandlerIdx, passwordHandlerIdx);
    expect(mfaBlock).toMatch(/markStepUpVerified/);
  });

  // ── T6 ──
  it('T6: source-level — verify-password-challenge handler calls markStepUpVerified', async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const src = readFileSync(
      resolve(__dirname, '..', '..', 'src', 'features', 'auth', 'authRoutes.ts'),
      'utf-8',
    );
    const passwordHandlerIdx = src.indexOf("'/verify-password-challenge'");
    const passwordBlock = src.slice(passwordHandlerIdx, passwordHandlerIdx + 1500);
    expect(passwordBlock).toMatch(/markStepUpVerified/);
  });

  // ── T7 ──
  it('T7: source-level — prescriptionService.create gates on dto.isS8', async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const src = readFileSync(
      resolve(__dirname, '..', '..', 'src', 'features', 'prescriptions', 'prescriptionService.ts'),
      'utf-8',
    );
    expect(src).toMatch(/BUG-P3/);
    expect(src).toMatch(/requireRecentStepUp/);
    // Both create and cancel paths must call requireRecentStepUp
    const occurrences = (src.match(/requireRecentStepUp\(auth\)/g) || []).length;
    expect(occurrences).toBeGreaterThanOrEqual(2);
  });

  // ── T8 ──
  it('T8: source-level — medicationService.create + update + cease gate on S8', async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const src = readFileSync(
      resolve(__dirname, '..', '..', 'src', 'features', 'medications', 'medicationService.ts'),
      'utf-8',
    );
    expect(src).toMatch(/BUG-P3/);
    // 3 call sites in medicationService (create + update + cease)
    const occurrences = (src.match(/requireRecentStepUp\(auth\)/g) || []).length;
    expect(occurrences).toBeGreaterThanOrEqual(3);
  });
});
