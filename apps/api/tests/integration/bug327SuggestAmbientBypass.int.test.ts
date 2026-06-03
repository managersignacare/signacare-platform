/**
 * BUG-327 regression — /llm/suggest + /llm/ambient-note bypass-role
 * audit + relationship gate.
 *
 * Mirrors BUG-279's pattern (LLM_ACCESS_BYPASS_ROLE audit on
 * admin/superadmin success) applied to two endpoints missed from the
 * original 5-endpoint sweep. /llm/suggest additionally gains a
 * requirePatientRelationship gate (optional — fires only when dto
 * supplies patientId; schema extended).
 *
 * Tests do NOT exercise the full LLM stack (Ollama offline in CI); they
 * exercise the gate + audit logic via the helper at the controller
 * layer and via a lighter-weight contract assertion for the bypass
 * audit write.
 *
 * Coverage (5 tests):
 *   T1 — LlmSuggestionRequestSchema now accepts optional patientId.
 *   T2 — writeLlmAccessBypassAudit helper records
 *         endpoint='/llm/suggest' when caller is admin.
 *   T3 — writeLlmAccessBypassAudit helper records
 *         endpoint='/llm/ambient-note' when caller is admin.
 *   T4 — helper is no-op for clinician role on /suggest (same as
 *         BUG-279 pattern).
 *   T5 — helper is no-op for clinician role on /ambient-note.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'crypto';
import { isIntegrationReady, loginAsAdmin } from './_helpers';
import { LlmSuggestionRequestSchema } from '@signacare/shared';
import { writeLlmAccessBypassAudit } from '../../src/shared/writeLlmAccessBypassAudit';

const READY = await isIntegrationReady();

describe.skipIf(!READY)('BUG-327 /llm/suggest + /llm/ambient-note bypass audit', () => {
  let clinicId: string;
  let adminStaffId: string;

  beforeAll(async () => {
    const session = await loginAsAdmin();
    clinicId = session.clinicId;
    adminStaffId = session.userId;
  });

  async function countBypassAudit(endpoint: string, staffId?: string): Promise<number> {
    const { dbAdmin } = await import('../../src/db/db');
    const q = dbAdmin('audit_log')
      .where({ operation: 'LLM_ACCESS_BYPASS_ROLE', clinic_id: clinicId });
    if (staffId) q.andWhere({ staff_id: staffId });
    const rows = await q.select('new_data');
    return rows.filter((r) => {
      try {
        const d = typeof r.new_data === 'string' ? JSON.parse(r.new_data) : r.new_data;
        return d?.endpoint === endpoint;
      } catch { return false; }
    }).length;
  }

  it('T1 — LlmSuggestionRequestSchema accepts optional patientId', () => {
    // Valid without patientId (patient-agnostic summarisation).
    const without = LlmSuggestionRequestSchema.safeParse({
      feature: 'summarisation',
      contextRef: 'ref-xyz',
    });
    expect(without.success).toBe(true);
    // Valid with patientId.
    const withP = LlmSuggestionRequestSchema.safeParse({
      feature: 'suggestion',
      contextRef: 'ref-xyz',
      patientId: randomUUID(),
    });
    expect(withP.success).toBe(true);
    // Invalid patientId format is rejected.
    const bad = LlmSuggestionRequestSchema.safeParse({
      feature: 'suggestion',
      contextRef: 'ref-xyz',
      patientId: 'not-a-uuid',
    });
    expect(bad.success).toBe(false);
  });

  it('T2 — /llm/suggest bypass audit written for admin caller', async () => {
    const testPatientId = randomUUID();
    const before = await countBypassAudit('/llm/suggest', adminStaffId);
    const fakeReq = {
      user: { id: adminStaffId, role: 'superadmin', permissions: [] },
      clinicId,
    } as unknown as Parameters<typeof writeLlmAccessBypassAudit>[0]['req'];
    await writeLlmAccessBypassAudit({
      req: fakeReq,
      patientId: testPatientId,
      endpoint: '/llm/suggest',
      feature: 'suggest:suggestion',
    });
    const after = await countBypassAudit('/llm/suggest', adminStaffId);
    expect(after).toBe(before + 1);
  });

  it('T3 — /llm/ambient-note bypass audit written for admin caller', async () => {
    const testPatientId = randomUUID();
    const before = await countBypassAudit('/llm/ambient-note', adminStaffId);
    const fakeReq = {
      user: { id: adminStaffId, role: 'admin', permissions: [] },
      clinicId,
    } as unknown as Parameters<typeof writeLlmAccessBypassAudit>[0]['req'];
    await writeLlmAccessBypassAudit({
      req: fakeReq,
      patientId: testPatientId,
      endpoint: '/llm/ambient-note',
      feature: 'ambient',
    });
    const after = await countBypassAudit('/llm/ambient-note', adminStaffId);
    expect(after).toBe(before + 1);
  });

  it('T4 — /llm/suggest bypass audit is no-op for clinician role', async () => {
    const before = await countBypassAudit('/llm/suggest', adminStaffId);
    const fakeReq = {
      user: { id: adminStaffId, role: 'clinician', permissions: [] },
      clinicId,
    } as unknown as Parameters<typeof writeLlmAccessBypassAudit>[0]['req'];
    await writeLlmAccessBypassAudit({
      req: fakeReq,
      patientId: randomUUID(),
      endpoint: '/llm/suggest',
      feature: 'suggest:suggestion',
    });
    const after = await countBypassAudit('/llm/suggest', adminStaffId);
    expect(after).toBe(before);
  });

  it('T5 — /llm/ambient-note bypass audit is no-op for clinician role', async () => {
    const before = await countBypassAudit('/llm/ambient-note', adminStaffId);
    const fakeReq = {
      user: { id: adminStaffId, role: 'clinician', permissions: [] },
      clinicId,
    } as unknown as Parameters<typeof writeLlmAccessBypassAudit>[0]['req'];
    await writeLlmAccessBypassAudit({
      req: fakeReq,
      patientId: randomUUID(),
      endpoint: '/llm/ambient-note',
      feature: 'ambient',
    });
    const after = await countBypassAudit('/llm/ambient-note', adminStaffId);
    expect(after).toBe(before);
  });
});
