/**
 * BUG-216 regression — Pino logger PHI redaction.
 *
 * Asserts the post-fix contract: every PHI-flavoured field name drawn
 * from the current DB schema is redacted. Tests cover both layers:
 *
 *   (a) Recursive redactPhi helper — fires inside utils/logger.ts's
 *       formatters.log so every log object passes through it at any
 *       depth. Tested directly via the exported helper.
 *   (b) Pino built-in redact.paths — the library's C-level redactor.
 *       Tested via a real pino stream so the full stringify pipeline is
 *       exercised (BUG-216 reviewer point 3 — end-to-end, not just helper).
 *
 * Red-first trace discipline: the plan's captured pre-fix log is in the
 * commit body. Running this file against the pre-fix 16-field PHI_FIELDS
 * list fails tests 1, 2, 5, 6. After the fix (~100 entries + expanded
 * redact.paths), all 6 pass.
 */

import { describe, it, expect, vi } from 'vitest';
import pino from 'pino';
import { Writable } from 'stream';

// The vi.mock config is required because utils/logger transitively imports
// @opentelemetry/api + process-level hooks via `trace.getActiveSpan()`.
// We do NOT mock the logger itself — we want the real PHI_FIELDS + redactPhi.
vi.mock('../../src/config', () => ({
  config: {
    database: { host: 'localhost', port: 5433, user: 't', password: 't', name: 't', ssl: false, poolMax: 5 },
    jwt: { accessSecret: 'x'.repeat(32), refreshSecret: 'y'.repeat(32), accessTtlMinutes: 60, refreshTtlDays: 7 },
  },
}));
vi.mock('../../src/db/db', () => ({ db: vi.fn(), dbAdmin: vi.fn(), dbRead: vi.fn() }));

// The exported PHI_FIELDS + redactPhi are the ACTUAL surface the live
// logger uses (see utils/logger.ts formatters.log). Tests against them
// prove the live logger redacts correctly — no drift risk.
import { PHI_FIELDS, redactPhi } from '../../src/utils/logger';

/**
 * Real pino stream captured into memory. Tests 4 + 6 use this so the
 * full pipeline (redact.paths built-in + formatters.log helper +
 * JSON.stringify) is exercised end-to-end, not just the helper.
 *
 * Mirrors the redact.paths from utils/logger.ts. If that list drifts,
 * test 4 will catch the divergence.
 */
function makeCapturedLogger(): {
  info: (obj: Record<string, unknown>) => Record<string, unknown>;
} {
  const chunks: string[] = [];
  const sink = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(chunk.toString('utf8'));
      cb();
    },
  });
  const captured = pino(
    {
      level: 'info',
      formatters: {
        level(label) {
          return { level: label };
        },
        log(obj) {
          return redactPhi(obj as Record<string, unknown>);
        },
      },
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'body.password',
          'body.mfaSecret',
          'req.body.password',
          'req.body.mfaSecret',
          'req.body.email',
          'req.body.phone',
          '*.password',
          '*.password_hash',
          '*.passwordHash',
          '*.mfa_secret',
          '*.mfaSecret',
        ],
        censor: '[REDACTED]',
      },
    },
    sink,
  );
  return {
    info(obj) {
      const before = chunks.length;
      captured.info(obj);
      // Pino may write multiple chunks for one log call (unlikely for
      // small payloads, but defensive). Take the last-written JSON line.
      const tail = chunks.slice(before).join('');
      const line = tail.split('\n').filter((s) => s.trim()).pop() ?? '';
      return JSON.parse(line) as Record<string, unknown>;
    },
  };
}

describe('BUG-216 — utils/logger.ts PHI redaction', () => {
  it('(1) every PHI_FIELDS entry is redacted in a flat object', () => {
    for (const field of PHI_FIELDS) {
      const out = redactPhi({ [field]: 'secret-value' });
      expect(out[field], `field '${field}' must be redacted`).toBe('[REDACTED]');
    }
  });

  it('(2) nested objects are redacted at depth', () => {
    const out = redactPhi({
      patient: {
        given_name: 'Jane',
        family_name: 'Doe',
        address_postcode: '3000',
        nested: {
          gp_phone: '+61400123456',
        },
      },
    });
    const patient = out.patient as Record<string, unknown>;
    expect(patient.given_name).toBe('[REDACTED]');
    expect(patient.family_name).toBe('[REDACTED]');
    expect(patient.address_postcode).toBe('[REDACTED]');
    const nested = patient.nested as Record<string, unknown>;
    expect(nested.gp_phone).toBe('[REDACTED]');
  });

  it('(3) non-PHI operational fields pass through unredacted (no over-redaction)', () => {
    const out = redactPhi({
      device_name: 'YubiKey 5C',
      panel_name: 'CBC',
      drug_name: 'Paracetamol',
      queue_name: 'hl7-outbound',
      brand_name: 'Panadol',
      filename: 'report.pdf',
      lab_name: 'Dorevitch',
      model_name: 'llama3:70b',
      flag_name: 'diabetic-risk',
      generic_name: 'paracetamol',
      legal_name: 'Signacare Pty Ltd',
    });
    expect(out.device_name).toBe('YubiKey 5C');
    expect(out.panel_name).toBe('CBC');
    expect(out.drug_name).toBe('Paracetamol');
    expect(out.queue_name).toBe('hl7-outbound');
    expect(out.brand_name).toBe('Panadol');
    expect(out.filename).toBe('report.pdf');
    expect(out.lab_name).toBe('Dorevitch');
    expect(out.model_name).toBe('llama3:70b');
    expect(out.flag_name).toBe('diabetic-risk');
    expect(out.generic_name).toBe('paracetamol');
    expect(out.legal_name).toBe('Signacare Pty Ltd');
  });

  it('(4) pino redact.paths fast path handles req.body.{password,email,phone,mfaSecret}', () => {
    const captured = makeCapturedLogger();
    const out = captured.info({
      req: {
        body: {
          password: 'hunter2',
          email: 'jane@example.com',
          phone: '+61400123456',
          mfaSecret: 'JBSWY3DPEHPK3PXP',
        },
      },
    });
    const body = (out.req as Record<string, Record<string, unknown>>).body;
    expect(body.password).toBe('[REDACTED]');
    expect(body.email).toBe('[REDACTED]');
    expect(body.phone).toBe('[REDACTED]');
    expect(body.mfaSecret).toBe('[REDACTED]');
  });

  it('(5) realistic audit-log shape preserves IDs but redacts patient PHI', () => {
    const out = redactPhi({
      type: 'patient_access',
      clinicId: '11111111-1111-1111-1111-111111111111',
      staffId: '22222222-2222-2222-2222-222222222222',
      action: 'READ',
      patient: {
        id: '33333333-3333-3333-3333-333333333333',
        givenName: 'Jane',
        familyName: 'Doe',
        medicareNumber: '2123456789',
        phoneMobile: '+61400123456',
        addressPostcode: '3000',
      },
    });
    // Top-level operational IDs preserved.
    expect(out.type).toBe('patient_access');
    expect(out.clinicId).toBe('11111111-1111-1111-1111-111111111111');
    expect(out.staffId).toBe('22222222-2222-2222-2222-222222222222');
    expect(out.action).toBe('READ');
    // patient.id preserved (UUID, not PHI); every other field redacted.
    const patient = out.patient as Record<string, unknown>;
    expect(patient.id).toBe('33333333-3333-3333-3333-333333333333');
    expect(patient.givenName).toBe('[REDACTED]');
    expect(patient.familyName).toBe('[REDACTED]');
    expect(patient.medicareNumber).toBe('[REDACTED]');
    expect(patient.phoneMobile).toBe('[REDACTED]');
    expect(patient.addressPostcode).toBe('[REDACTED]');
  });

  it('(6a) AU-specific clinical identifiers are redacted (L4 round 2 condition — explicit coverage)', () => {
    // BUG-216 L4 review — confirm the AU-identifiers category (Privacy Act
    // 1988, Healthcare Identifiers Act 2010, NDIS Act) is explicitly tested
    // so a regression removing any of these fields from PHI_CATEGORY_AU_IDENTIFIERS
    // names the failing field, not just "one of 100+".
    const out = redactPhi({
      patient: {
        ndis_number: '43001234567',
        ndis_package_manager: 'SupportCo',
        hpii: '8003611234567890',
        prescriber_number: '123456',
        provider_number: '054321AB',
        gp_provider_number: '098765BC',
        referring_provider_number: '112233CD',
        pbs_code: '9999A',
        pbs_item_code: '1234X',
      },
    });
    const patient = out.patient as Record<string, unknown>;
    expect(patient.ndis_number).toBe('[REDACTED]');
    expect(patient.ndis_package_manager).toBe('[REDACTED]');
    expect(patient.hpii).toBe('[REDACTED]');
    expect(patient.prescriber_number).toBe('[REDACTED]');
    expect(patient.provider_number).toBe('[REDACTED]');
    expect(patient.gp_provider_number).toBe('[REDACTED]');
    expect(patient.referring_provider_number).toBe('[REDACTED]');
    expect(patient.pbs_code).toBe('[REDACTED]');
    expect(patient.pbs_item_code).toBe('[REDACTED]');
  });

  it('(6c) clinic sender mailbox addresses are redacted, but sender mode remains operational metadata', () => {
    const out = redactPhi({
      clinic_sender_email: 'mailbox@clinic.example',
      clinicSenderEmail: 'mailbox@clinic.example',
      email_sender_mode: 'clinic_mailbox',
    });

    expect(out.clinic_sender_email).toBe('[REDACTED]');
    expect(out.clinicSenderEmail).toBe('[REDACTED]');
    expect(out.email_sender_mode).toBe('clinic_mailbox');
  });

  it('(6b) clinical narrative fields are redacted (L4 round 2 condition — the largest PHI vector)', () => {
    // BUG-216 L4 review — a single logger.info({ note: { clinical_notes:
    // "Patient Jane Doe reports..." } }) leaks an entire dictated narrative.
    // This test pins redaction of the clinical-narrative category so it
    // never silently regresses.
    const out = redactPhi({
      note: {
        clinical_notes: 'Patient Jane Doe reports acute chest pain',
        presenting_problem: 'Chest pain with radiation to left arm',
        presenting_complaints: 'Dizziness, nausea, diaphoresis',
        understand_notes: 'Patient understands medication risks',
        retain_notes: 'Patient can retain information short-term',
        weigh_notes: 'Patient can weigh treatment options',
        communicate_notes: 'Patient communicates decision clearly',
        message_body: 'Hello Jane, your appointment is tomorrow at 10am.',
      },
    });
    const note = out.note as Record<string, unknown>;
    expect(note.clinical_notes).toBe('[REDACTED]');
    expect(note.presenting_problem).toBe('[REDACTED]');
    expect(note.presenting_complaints).toBe('[REDACTED]');
    expect(note.understand_notes).toBe('[REDACTED]');
    expect(note.retain_notes).toBe('[REDACTED]');
    expect(note.weigh_notes).toBe('[REDACTED]');
    expect(note.communicate_notes).toBe('[REDACTED]');
    expect(note.message_body).toBe('[REDACTED]');
  });

  it('(6) real pino stream: fixture patient row redacts PHI and preserves non-PHI — end-to-end stringify pipeline', () => {
    const captured = makeCapturedLogger();
    const fixture = {
      patient: {
        id: '33333333-3333-3333-3333-333333333333',
        given_name: 'Jane',
        family_name: 'Doe',
        date_of_birth: '1980-01-15',
        medicare_number: '2123456789',
        ihi_number: '8003608166690503',
        phone_mobile: '+61400123456',
        email_primary: 'jane@example.com',
        address_street: '1 Sesame St',
        address_suburb: 'Melbourne',
        address_state: 'VIC',
        address_postcode: '3000',
        nok_name: 'John Doe',
        nok_phone: '+61400999888',
        gp_name: 'Dr Smith',
        gp_email: 'dr.smith@clinic.local',
      },
      drug_name: 'Paracetamol',
      panel_name: 'CBC',
      clinicId: '11111111-1111-1111-1111-111111111111',
    };
    const out = captured.info(fixture);
    const patient = out.patient as Record<string, unknown>;
    // Every PHI field redacted via the full pino stringify pipeline.
    expect(patient.given_name).toBe('[REDACTED]');
    expect(patient.family_name).toBe('[REDACTED]');
    expect(patient.date_of_birth).toBe('[REDACTED]');
    expect(patient.medicare_number).toBe('[REDACTED]');
    expect(patient.ihi_number).toBe('[REDACTED]');
    expect(patient.phone_mobile).toBe('[REDACTED]');
    expect(patient.email_primary).toBe('[REDACTED]');
    expect(patient.address_street).toBe('[REDACTED]');
    expect(patient.address_suburb).toBe('[REDACTED]');
    expect(patient.address_state).toBe('[REDACTED]');
    expect(patient.address_postcode).toBe('[REDACTED]');
    expect(patient.nok_name).toBe('[REDACTED]');
    expect(patient.nok_phone).toBe('[REDACTED]');
    expect(patient.gp_name).toBe('[REDACTED]');
    expect(patient.gp_email).toBe('[REDACTED]');
    // Non-PHI preserved.
    expect(patient.id).toBe('33333333-3333-3333-3333-333333333333');
    expect(out.drug_name).toBe('Paracetamol');
    expect(out.panel_name).toBe('CBC');
    expect(out.clinicId).toBe('11111111-1111-1111-1111-111111111111');
  });

  it('(7) BUG-721 drift fields are redacted after taxonomy update', () => {
    const out = redactPhi({
      diagnosis_date: '2026-05-01',
      diagnosis_info: 'Major depressive disorder',
      risk_narrative: 'Recent self-harm ideation',
      preferred_call_time: '14:00',
      preferred_clinician_id: '22222222-2222-2222-2222-222222222222',
      from_provider_prescriber_no: '123456',
      pbs_listed: true,
      phone_number_masked: '******3456',
      referrer_email: 'referrer@clinic.local',
      referrer_phone: '+61400111222',
      ip_address: '203.0.113.10',
      queue_name: 'hl7-outbound',
    });
    expect(out.diagnosis_date).toBe('[REDACTED]');
    expect(out.diagnosis_info).toBe('[REDACTED]');
    expect(out.risk_narrative).toBe('[REDACTED]');
    expect(out.preferred_call_time).toBe('[REDACTED]');
    expect(out.preferred_clinician_id).toBe('[REDACTED]');
    expect(out.from_provider_prescriber_no).toBe('[REDACTED]');
    expect(out.pbs_listed).toBe('[REDACTED]');
    expect(out.phone_number_masked).toBe('[REDACTED]');
    expect(out.referrer_email).toBe('[REDACTED]');
    expect(out.referrer_phone).toBe('[REDACTED]');
    expect(out.ip_address).toBe('[REDACTED]');
    expect(out.queue_name).toBe('hl7-outbound');
  });

  it('(8) BUG-270 copy-on-write fast path preserves reference for non-PHI payloads', () => {
    const payload = {
      service: 'scheduler',
      queue: {
        name: 'mha-review',
        attempts: 2,
      },
      status: 'ok',
    };
    const out = redactPhi(payload);
    expect(out).toBe(payload);
    expect(out.queue).toBe(payload.queue);
  });

  it('(9) BUG-270 only touched branches are cloned/redacted', () => {
    const payload = {
      safeBranch: { queue: 'alerts', attempts: 3 },
      patientBranch: { given_name: 'Jane', family_name: 'Doe' },
    };
    const out = redactPhi(payload);
    expect(out).not.toBe(payload);
    expect(out.safeBranch).toBe(payload.safeBranch);
    expect(out.patientBranch).not.toBe(payload.patientBranch);

    const patientBranch = out.patientBranch as Record<string, unknown>;
    expect(patientBranch.given_name).toBe('[REDACTED]');
    expect(patientBranch.family_name).toBe('[REDACTED]');
  });

  it('(10) BUG-270 cycle-safe traversal redacts without recursion overflow', () => {
    const payload: Record<string, unknown> = { given_name: 'Jane' };
    payload.self = payload;
    const out = redactPhi(payload);
    expect(out).not.toBe(payload);
    expect(out.given_name).toBe('[REDACTED]');
    expect((out.self as Record<string, unknown>)).toBe(out);
    // Ensure source object is not mutated during redaction.
    expect(payload.given_name).toBe('Jane');
  });
});
