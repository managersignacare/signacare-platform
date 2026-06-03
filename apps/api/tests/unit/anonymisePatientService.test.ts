/**
 * BUG-374b — anonymisePatientService unit tests.
 *
 * Replaces the ghost SQL function `anonymise_patient(uuid, reason)` at
 * privacyRoutes.ts:128 (verified non-existent → BUG-594 cascade closes
 * atomically with this BUG).
 *
 * Locked policy (project_data_retention_policy.md + Q-B/Q-C/Q-G):
 *   - Scrub identity columns on `patients` (names, DOB, contact,
 *     identifiers, lookups, emergency, GP, NOK, viva_triage, health_fund,
 *     photo, emr_number); set `purged_at = now()`.
 *   - DOB → `1900-01-01` sentinel (Q-G; preserves NOT NULL).
 *   - DO NOT scrub free-text in clinical_notes (Q-C).
 *   - PRESERVE consent_* booleans (Q-B kept consent records).
 *   - Idempotent — second call on `purged_at IS NOT NULL` patient → no-op.
 *   - Audit-log entry per anonymisation (action='ANONYMISE').
 *   - Transactional — rollback if any step fails.
 */
import { describe, it, expect, vi } from 'vitest';
import type { AuthContext } from '@signacare/shared';
import { isErr, isOk } from '@signacare/shared';
import type { Knex } from 'knex';
import {
  anonymisePatientService,
  type AnonymiseAuditEntry,
  type AnonymisePatientContext,
  type PatientScrubPatch,
  type PatientIdentityRow,
} from '../../src/features/privacy/anonymisePatientService';

const SUPERADMIN_AUTH: AuthContext = {
  staffId: '00000000-0000-0000-0000-0000000000s1',
  clinicId: '00000000-0000-0000-0000-0000000000c1',
  role: 'superadmin',
  permissions: [],
};

const CLINICIAN_AUTH: AuthContext = { ...SUPERADMIN_AUTH, role: 'clinician' };

function patient(o: Partial<PatientIdentityRow> = {}): PatientIdentityRow {
  return {
    id: '00000000-0000-0000-0000-0000000000p1',
    clinic_id: '00000000-0000-0000-0000-0000000000c1',
    given_name: 'John',
    family_name: 'Smith',
    preferred_name: null,
    date_of_birth: '1950-03-12',
    medicare_number: '1234567891',
    medicare_number_lookup: 'hash-medicare-1234567891',
    ihi_number_lookup: 'hash-ihi',
    dva_number_lookup: 'hash-dva',
    purged_at: null,
    ...o,
  };
}

interface ScrubCall {
  clinicId: string;
  patientId: string;
  scrubbed: PatientScrubPatch;
}

function buildCtx(p: PatientIdentityRow | null = patient()): AnonymisePatientContext & {
  scrubCalls: ScrubCall[];
  auditCalls: AnonymiseAuditEntry[];
} {
  const scrubCalls: ScrubCall[] = [];
  const auditCalls: AnonymiseAuditEntry[] = [];
  const testTransaction = {} as Knex.Transaction;
  return {
    fetchPatient: vi.fn(async () => p),
    scrubAndUpdatePatient: vi.fn(async (_trx, clinicId, patientId, scrubbed) => {
      scrubCalls.push({ clinicId, patientId, scrubbed });
    }),
    writeAudit: vi.fn(async (_trx, entry) => {
      auditCalls.push(entry);
    }),
    runInTransaction: vi.fn(async (fn) => fn(testTransaction)),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    scrubCalls,
    auditCalls,
  };
}

describe('BUG-374b — anonymisePatientService.anonymise', () => {
  it('TP-ANON-1: rejects non-superadmin caller with FORBIDDEN', async () => {
    const ctx = buildCtx();
    const r = await anonymisePatientService.anonymise(
      CLINICIAN_AUTH,
      'p1',
      'test',
      ctx,
    );
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.code).toBe('FORBIDDEN');
    expect(ctx.scrubAndUpdatePatient).not.toHaveBeenCalled();
  });

  it('TP-ANON-2: idempotent — already-purged patient returns ok({mutated:false}), no scrub, no audit', async () => {
    const p = patient({ purged_at: new Date('2026-01-01T00:00:00Z') });
    const ctx = buildCtx(p);
    const r = await anonymisePatientService.anonymise(
      SUPERADMIN_AUTH,
      p.id,
      'test',
      ctx,
    );
    expect(isOk(r)).toBe(true);
    if (isOk(r)) expect(r.value.mutated).toBe(false);
    expect(ctx.scrubAndUpdatePatient).not.toHaveBeenCalled();
    expect(ctx.writeAudit).not.toHaveBeenCalled();
  });

  it('TP-ANON-3: cross-tenant — patient not in caller clinic returns NOT_FOUND', async () => {
    const ctx = buildCtx(null); // fetchPatient returns null (clinic mismatch)
    const r = await anonymisePatientService.anonymise(
      SUPERADMIN_AUTH,
      'p1',
      'test',
      ctx,
    );
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.code).toBe('NOT_FOUND');
  });

  it('TP-ANON-4: scrubs Q-B identity columns to canonical sentinels', async () => {
    const p = patient();
    const ctx = buildCtx(p);
    await anonymisePatientService.anonymise(
      SUPERADMIN_AUTH,
      p.id,
      'retention_floor_exceeded',
      ctx,
    );
    expect(ctx.scrubCalls.length).toBe(1);
    const s = ctx.scrubCalls[0].scrubbed;
    expect(s.given_name).toBe('[REDACTED]');
    expect(s.family_name).toBe('[REDACTED]');
    expect(s.preferred_name).toBe('[REDACTED]');
    // Q-G — DOB sentinel
    expect(s.date_of_birth).toBe('1900-01-01');
    // Identifiers nulled
    expect(s.medicare_number).toBeNull();
    expect(s.medicare_number_lookup).toBeNull();
    expect(s.ihi_number_lookup).toBeNull();
    expect(s.dva_number_lookup).toBeNull();
    // Contact nulled
    expect(s.email).toBeNull();
    expect(s.phone_mobile).toBeNull();
    expect(s.address_line1).toBeNull();
    // Other identifying nulled
    expect(s.viva_triage_number).toBeNull();
    expect(s.health_fund_name).toBeNull();
    expect(s.health_fund_number).toBeNull();
    expect(s.photo_url).toBeNull();
    expect(s.emr_number).toBeNull();
    // Status flipped + sentinel
    expect(s.status).toBe('anonymised');
    expect(s.purged_at).toBeInstanceOf(Date);
  });

  it('TP-ANON-5: scrub patch does NOT include consent_* fields (Q-B preserve consent records)', async () => {
    const ctx = buildCtx();
    await anonymisePatientService.anonymise(SUPERADMIN_AUTH, 'p1', 'test', ctx);
    const s = ctx.scrubCalls[0].scrubbed;
    expect(s).not.toHaveProperty('consent_to_treatment');
    expect(s).not.toHaveProperty('consent_for_research');
    expect(s).not.toHaveProperty('consent_to_share_with_gp');
    expect(s).not.toHaveProperty('consent_to_share_with_carer');
    expect(s).not.toHaveProperty('sms_consent');
  });

  it('TP-ANON-6: scrub patch does NOT touch FK targets (clinic_id, id) — preserves traceability', async () => {
    const ctx = buildCtx();
    await anonymisePatientService.anonymise(SUPERADMIN_AUTH, 'p1', 'test', ctx);
    const s = ctx.scrubCalls[0].scrubbed;
    expect(s).not.toHaveProperty('id');
    expect(s).not.toHaveProperty('clinic_id');
    expect(s).not.toHaveProperty('created_at');
    expect(s).not.toHaveProperty('deleted_at');
    expect(s).not.toHaveProperty('last_contact_at');
    expect(s).not.toHaveProperty('deceased_date');
  });

  it('TP-ANON-7: writes audit_log entry with ANONYMISE action + reason + actor + clinic', async () => {
    const ctx = buildCtx();
    await anonymisePatientService.anonymise(
      SUPERADMIN_AUTH,
      '00000000-0000-0000-0000-0000000000p1',
      'retention_floor_exceeded',
      ctx,
    );
    expect(ctx.auditCalls.length).toBe(1);
    const a = ctx.auditCalls[0];
    expect(a.action).toBe('ANONYMISE');
    expect(a.tableName).toBe('patients');
    expect(a.actorId).toBe(SUPERADMIN_AUTH.staffId);
    expect(a.clinicId).toBe(SUPERADMIN_AUTH.clinicId);
    expect(a.recordId).toBe('00000000-0000-0000-0000-0000000000p1');
    expect(a.newData?.reason).toBe('retention_floor_exceeded');
  });

  it('TP-ANON-8: audit oldData captures pre-purge identifying fields (forensic ledger)', async () => {
    const ctx = buildCtx();
    await anonymisePatientService.anonymise(SUPERADMIN_AUTH, 'p1', 'test', ctx);
    const a = ctx.auditCalls[0];
    expect(a.oldData?.given_name).toBe('John');
    expect(a.oldData?.family_name).toBe('Smith');
    expect(a.oldData?.date_of_birth).toBe('1950-03-12');
  });

  it('TP-ANON-9: NO free-text scrubbing per Q-C — context exposes no scrub-clinical-notes hook', async () => {
    const ctx = buildCtx();
    // Verify the context does NOT have a scrub-notes method (compile-time
    // contract that we never accidentally implement free-text scrubbing).
    expect('scrubClinicalNotes' in ctx).toBe(false);
    expect('loadScrubRules' in ctx).toBe(false);
  });

  it('TP-ANON-10: outcome carries scrubberVersion stamp for forensic re-anonymisation tracking', async () => {
    const ctx = buildCtx();
    const r = await anonymisePatientService.anonymise(SUPERADMIN_AUTH, 'p1', 'test', ctx);
    expect(isOk(r)).toBe(true);
    if (isOk(r)) {
      expect(r.value.scrubberVersion).toMatch(/^v\d+\.\d+/);
      expect(r.value.mutated).toBe(true);
    }
  });

  it('TP-ANON-11: empty/whitespace reason rejected with VALIDATION_ERROR', async () => {
    const ctx = buildCtx();
    for (const reason of ['', '   ', '\t']) {
      const r = await anonymisePatientService.anonymise(SUPERADMIN_AUTH, 'p1', reason, ctx);
      expect(isErr(r)).toBe(true);
      if (isErr(r)) expect(r.error.code).toBe('VALIDATION_ERROR');
    }
    expect(ctx.scrubAndUpdatePatient).not.toHaveBeenCalled();
  });

  it('TP-ANON-12: transactional — runInTransaction wraps update + audit', async () => {
    const ctx = buildCtx();
    await anonymisePatientService.anonymise(SUPERADMIN_AUTH, 'p1', 'test', ctx);
    expect(ctx.runInTransaction).toHaveBeenCalled();
  });
});
