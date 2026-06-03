/**
 * BUG-267 regression — custom pino err serializer redacts PHI from
 * PostgreSQL constraint-violation messages before they reach journald.
 *
 * Red-first: U1, U2, U4, U6, U8, U9 fail pre-fix (default
 * pino.stdSerializers.err passes values through). U3, U5, U7 pass
 * pre-fix (no PHI to leak).
 *
 * The unit tests exercise sanitizeString() directly (pure function) +
 * sanitizeErrForLogging() (serializer wrapper). Integration tests
 * capturing real pino output against a live Postgres live in
 * tests/integration/loggerErrSerializer.int.test.ts.
 */

import { describe, it, expect, vi } from 'vitest';

// Same mock shape as loggerRedaction.test.ts — logger transitively imports
// @opentelemetry/api + config + db, which we don't want to boot here.
vi.mock('../../src/config', () => ({
  config: {
    database: { host: 'localhost', port: 5433, user: 't', password: 't', name: 't', ssl: false, poolMax: 5 },
    jwt: { accessSecret: 'x'.repeat(32), refreshSecret: 'y'.repeat(32), accessTtlMinutes: 60, refreshTtlDays: 7 },
  },
}));
vi.mock('../../src/db/db', () => ({ db: vi.fn(), dbAdmin: vi.fn(), dbRead: vi.fn() }));

import { sanitizeString, sanitizeErrForLogging } from '../../src/utils/sanitizeErrForLogging';

/** Build a synthetic PG-style error with code + extra props that `pg` attaches. */
function makePgError(message: string, extras: Partial<{
  code: string; detail: string; hint: string; table: string; constraint: string;
}> = {}): Error {
  const err = new Error(message) as Error & Record<string, unknown>;
  if (extras.code) err.code = extras.code;
  if (extras.detail) err.detail = extras.detail;
  if (extras.hint) err.hint = extras.hint;
  if (extras.table) err.table = extras.table;
  if (extras.constraint) err.constraint = extras.constraint;
  return err;
}

describe('BUG-267 sanitizeString() — pure redactor', () => {
  it('U1 — Key (medicare_number)=(2123456789) redacts the value', () => {
    const input = 'duplicate key value violates unique constraint "patients_medicare_lookup_uniq": Key (medicare_number)=(2123456789) already exists';
    const out = sanitizeString(input);
    expect(out).not.toContain('2123456789');
    expect(out).toContain('[REDACTED — PHI column]');
    // Column name preserved (ops-useful).
    expect(out).toContain('medicare_number');
  });

  it('U2 — Key (given_name)=(Smith) redacts the value', () => {
    const out = sanitizeString('Key (given_name)=(Smith) already exists');
    expect(out).not.toContain('Smith');
    expect(out).toContain('[REDACTED — PHI column]');
  });

  it('U3 — Key (clinic_id)=(uuid) PRESERVES value (clinic_id ∉ PHI_FIELDS)', () => {
    const input = 'Key (clinic_id)=(550e8400-e29b-41d4-a716-446655440000) already exists';
    const out = sanitizeString(input);
    // The whole match is untouched for non-PHI columns (false-positive guard).
    expect(out).toContain('550e8400-e29b-41d4-a716-446655440000');
    expect(out).not.toContain('[REDACTED');
  });

  it('U4 — Failing row contains (a, b, c, d) is replaced', () => {
    const input = 'new row for relation "patient_medications" violates check constraint "dose_range_check": Failing row contains (uuid, uuid, 9999, drug-name)';
    const out = sanitizeString(input);
    expect(out).toContain('[REDACTED — failing-row PHI]');
    expect(out).not.toContain('9999');
    expect(out).not.toContain('drug-name');
  });

  it('U5 — column "family_name" not-null message preserves the column name', () => {
    const input = 'null value in column "family_name" violates not-null constraint';
    const out = sanitizeString(input);
    expect(out).toContain('family_name');
    // No value to redact — message passes through unchanged.
    expect(out).toBe(input);
  });

  it('U7 — non-PG error message unchanged (no false-positive rewrite)', () => {
    const out = sanitizeString('boom — something went wrong');
    expect(out).toBe('boom — something went wrong');
  });

  it('U9 — composite Key (clinic_id, medicare_number)=(...) redacts because any-member-PHI', () => {
    const input = 'Key (clinic_id, medicare_number)=(550e8400-..., 2123456789) already exists';
    const out = sanitizeString(input);
    // Columns preserved; values redacted as a block.
    expect(out).toContain('clinic_id, medicare_number');
    expect(out).toContain('[REDACTED — PHI column]');
    expect(out).not.toContain('2123456789');
    expect(out).not.toContain('550e8400');
  });

  it('U10 — REAL composite blind-index shape: Key (clinic_id, medicare_number_lookup)=(uuid, <hash>) — absorbed L4 finding', () => {
    // The actual production unique index is patients_medicare_lookup_uniq
    // on (clinic_id, medicare_number_lookup). Duplicate-enrol emits
    // this exact shape. Pre-absorption PHI_FIELDS lacked the _lookup
    // forms, so the sanitizer left the SHA-256 HMAC hash visible in
    // journald — still an OAIC deanonymisation vector. Post-absorption
    // PHI_CATEGORY_BLIND_INDEX covers medicare_number_lookup +
    // ihi_number_lookup + dva_number_lookup.
    const hash = 'a3f4b2c9e8d7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a7b6c5d4e3f2a1';
    const input = `Key (clinic_id, medicare_number_lookup)=(550e8400-e29b-41d4-a716-446655440000, ${hash}) already exists`;
    const out = sanitizeString(input);
    expect(out).toContain('clinic_id, medicare_number_lookup');
    expect(out).toContain('[REDACTED — PHI column]');
    expect(out).not.toContain(hash);
    expect(out).not.toContain('550e8400');
  });

  it('U11 — IHI blind-index composite also redacts', () => {
    const hash = 'deadbeefcafebabe'.repeat(4);
    const input = `Key (clinic_id, ihi_number_lookup)=(550e8400-..., ${hash}) already exists`;
    const out = sanitizeString(input);
    expect(out).not.toContain(hash);
    expect(out).toContain('[REDACTED — PHI column]');
  });

  it('U12 — DVA blind-index composite also redacts', () => {
    const hash = '0123456789abcdef'.repeat(4);
    const input = `Key (clinic_id, dva_number_lookup)=(550e8400-..., ${hash}) already exists`;
    const out = sanitizeString(input);
    expect(out).not.toContain(hash);
    expect(out).toContain('[REDACTED — PHI column]');
  });
});

describe('BUG-267 sanitizeErrForLogging() — pino serializer wrapper', () => {
  it('U6 — err.stack first line with Key (ihi_number)=(...) is redacted; frame structure preserved', () => {
    const err = makePgError('Key (ihi_number)=(8003608166690503) already exists', { code: '23505' });
    // Synthesise a realistic stack (Node V8 format: first line is "Error: <message>",
    // subsequent lines are frames).
    err.stack = [
      'Error: Key (ihi_number)=(8003608166690503) already exists',
      '    at Query.run (/usr/src/app/node_modules/pg/lib/query.js:171:15)',
      '    at Connection.emit (/usr/src/app/node_modules/pg/lib/connection.js:215:11)',
    ].join('\n');

    const out = sanitizeErrForLogging(err);
    const stack = out.stack as string;
    // Value redacted in the first line.
    expect(stack).not.toContain('8003608166690503');
    expect(stack).toContain('[REDACTED — PHI column]');
    // Frame structure preserved — file paths + line numbers untouched.
    expect(stack).toContain('/usr/src/app/node_modules/pg/lib/query.js:171:15');
    expect(stack).toContain('/usr/src/app/node_modules/pg/lib/connection.js:215:11');
  });

  it('U8 — err.detail AND err.hint both redacted (pg driver attaches both)', () => {
    const err = makePgError(
      'duplicate key value violates unique constraint "staff_email_unique"',
      {
        code: '23505',
        detail: 'Key (email)=(a@b.com) already exists.',
        hint: 'Consider using a different email. Key (email)=(a@b.com) is taken.',
      },
    );
    const out = sanitizeErrForLogging(err);
    expect(out.detail).not.toContain('a@b.com');
    expect(out.detail).toContain('[REDACTED — PHI column]');
    expect(out.hint).not.toContain('a@b.com');
    expect(out.hint).toContain('[REDACTED — PHI column]');
  });

  it('preserves non-PHI props (code, type) and returns a COPY — original err unchanged', () => {
    const err = makePgError('Key (medicare_number)=(2123456789) already exists', { code: '23505', table: 'patients', constraint: 'patients_medicare_lookup_uniq' });
    const out = sanitizeErrForLogging(err);
    expect(out.code).toBe('23505');
    expect(out.table).toBe('patients');
    expect(out.constraint).toBe('patients_medicare_lookup_uniq');
    expect(out.type).toBe('Error');
    // Original mutation guard.
    expect(err.message).toContain('2123456789');
  });
});
