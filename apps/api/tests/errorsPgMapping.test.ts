/**
 * BUG-367 — toErrorResponse PG SQLSTATE → HTTP mapping.
 *
 * Pure unit test — no DB, no HTTP.
 */

import { describe, it, expect } from 'vitest';
import { toErrorResponse, HttpError } from '../src/shared/errors';

function pgError(code: string, message: string): Error & { code: string } {
  const err = new Error(message) as Error & { code: string };
  err.code = code;
  return err;
}

describe('BUG-367 — toErrorResponse PG SQLSTATE mapping', () => {
  it('55P03 lock_timeout → 503 LOCK_TIMEOUT_RETRY with retryable hint', () => {
    const r = toErrorResponse(pgError('55P03', 'canceling statement due to lock timeout'));
    expect(r.status).toBe(503);
    const body = r.body as { code: string; error: string; details: { sqlstate: string; retryable: boolean } };
    expect(body.code).toBe('LOCK_TIMEOUT_RETRY');
    expect(body.error).toMatch(/retry/i);
    expect(body.details.sqlstate).toBe('55P03');
    expect(body.details.retryable).toBe(true);
  });

  it('57014 statement_timeout → 504 STATEMENT_TIMEOUT', () => {
    const r = toErrorResponse(pgError('57014', 'canceling statement due to statement timeout'));
    expect(r.status).toBe(504);
    expect((r.body as { code: string }).code).toBe('STATEMENT_TIMEOUT');
  });

  it('25P03 idle_in_transaction → 503 IDLE_IN_TX_TIMEOUT', () => {
    const r = toErrorResponse(pgError('25P03', 'terminating session due to idle-in-transaction timeout'));
    expect(r.status).toBe(503);
    expect((r.body as { code: string }).code).toBe('IDLE_IN_TX_TIMEOUT');
  });

  it('40001 serialization_failure → 503 SERIALIZATION_FAILURE', () => {
    const r = toErrorResponse(pgError('40001', 'could not serialize access'));
    expect(r.status).toBe(503);
    expect((r.body as { code: string }).code).toBe('SERIALIZATION_FAILURE');
  });

  it('40P01 deadlock_detected → 503 DEADLOCK_DETECTED', () => {
    const r = toErrorResponse(pgError('40P01', 'deadlock detected'));
    expect(r.status).toBe(503);
    expect((r.body as { code: string }).code).toBe('DEADLOCK_DETECTED');
  });

  it('57P03 cannot_connect_now → 503 CANNOT_CONNECT_NOW', () => {
    const r = toErrorResponse(pgError('57P03', 'the database system is starting up'));
    expect(r.status).toBe(503);
    expect((r.body as { code: string }).code).toBe('CANNOT_CONNECT_NOW');
  });

  it('non-retryable PG code (42601 syntax error) falls through to 500', () => {
    const r = toErrorResponse(pgError('42601', 'syntax error at or near "FROM"'));
    expect(r.status).toBe(500);
    expect((r.body as { code: string }).code).toBe('INTERNAL_ERROR');
  });

  it('HttpError still takes precedence over PG mapping', () => {
    const r = toErrorResponse(new HttpError(404, 'NOT_FOUND', 'Patient not found'));
    expect(r.status).toBe(404);
    expect((r.body as { code: string }).code).toBe('NOT_FOUND');
  });

  it('plain Error without PG code still maps to 500', () => {
    const r = toErrorResponse(new Error('something exploded'));
    expect(r.status).toBe(500);
  });

  it('missing identifier key config maps to 503 CONFIGURATION_ERROR', () => {
    const r = toErrorResponse(
      new Error('BLIND_INDEX_KEY not set or too short (need 32+ hex chars)'),
    );
    expect(r.status).toBe(503);
    expect((r.body as { code: string }).code).toBe('CONFIGURATION_ERROR');
  });

  it('lowercase SQLSTATE is normalized (node-postgres docs say uppercase but defensive)', () => {
    const r = toErrorResponse(pgError('55p03', 'canceling statement due to lock timeout'));
    expect(r.status).toBe(503);
    expect((r.body as { code: string }).code).toBe('LOCK_TIMEOUT_RETRY');
  });

  it('BUG-040 trigger message maps to 403 PRESCRIBING_DISCIPLINE_REQUIRED (not raw 500)', () => {
    const r = toErrorResponse(
      pgError('P0001', 'prescriber discipline "clinical-psychology" not authorised to prescribe (BUG-040)'),
    );
    expect(r.status).toBe(403);
    expect((r.body as { code: string }).code).toBe('PRESCRIBING_DISCIPLINE_REQUIRED');
  });

  it('BUG-040 NULL-discipline trigger message also maps to 403 PRESCRIBING_DISCIPLINE_REQUIRED', () => {
    const r = toErrorResponse(
      pgError('P0001', 'prescriber staff.discipline is NULL or unset — not authorised to prescribe (BUG-040)'),
    );
    expect(r.status).toBe(403);
    expect((r.body as { code: string }).code).toBe('PRESCRIBING_DISCIPLINE_REQUIRED');
  });

  it('23505 unique_violation maps to 409 CONFLICT with non-PHI field hint', () => {
    const err = pgError(
      '23505',
      'duplicate key value violates unique constraint "staff_email_unique"',
    ) as Error & { detail: string; constraint: string; table: string };
    err.detail = 'Key (email)=(someone@example.com) already exists.';
    err.constraint = 'staff_email_unique';
    err.table = 'staff';

    const r = toErrorResponse(err);
    expect(r.status).toBe(409);
    const body = r.body as {
      code: string;
      error: string;
      details: { sqlstate: string; constraint: string; table: string; field: string };
    };
    expect(body.code).toBe('CONFLICT');
    expect(body.error).toMatch(/email/i);
    expect(body.details.sqlstate).toBe('23505');
    expect(body.details.constraint).toBe('staff_email_unique');
    expect(body.details.table).toBe('staff');
    expect(body.details.field).toBe('email');
  });

  it('23505 without parseable field still maps to 409 CONFLICT', () => {
    const err = pgError(
      '23505',
      'duplicate key value violates unique constraint "some_constraint"',
    ) as Error & { detail: string };
    err.detail = 'already exists';
    const r = toErrorResponse(err);
    expect(r.status).toBe(409);
    expect((r.body as { code: string }).code).toBe('CONFLICT');
  });

  it('23502 not_null_violation maps to 422 VALIDATION_ERROR with field hint', () => {
    const err = pgError(
      '23502',
      'null value in column "family_name" of relation "patients" violates not-null constraint',
    ) as Error & { detail: string };
    err.detail =
      'Failing row contains (...). null value in column "family_name" violates not-null constraint';

    const r = toErrorResponse(err);
    expect(r.status).toBe(422);
    const body = r.body as { code: string; details: { field: string; sqlstate: string } };
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.details.field).toBe('family_name');
    expect(body.details.sqlstate).toBe('23502');
  });

  it('22001 string_data_right_truncation maps to 422 VALIDATION_ERROR', () => {
    const err = pgError(
      '22001',
      'value too long for type character varying(10)',
    ) as Error & { detail: string };
    err.detail = 'value too long for type character varying(10)';

    const r = toErrorResponse(err);
    expect(r.status).toBe(422);
    const body = r.body as {
      code: string;
      details: { sqlstate: string; maxLength?: number };
      error: string;
    };
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.details.sqlstate).toBe('22001');
    expect(body.details.maxLength).toBe(10);
    expect(body.error).toMatch(/maximum length/i);
  });

  it('42703 undefined_column maps to 503 SCHEMA_MISMATCH', () => {
    const r = toErrorResponse(pgError('42703', 'column "gp_address_state" does not exist'));
    expect(r.status).toBe(503);
    expect((r.body as { code: string }).code).toBe('SCHEMA_MISMATCH');
  });
});
