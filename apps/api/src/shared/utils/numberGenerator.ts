import { db } from '../../db/db';
import type { Knex } from 'knex';

type NumberQueryExecutor = Knex | Knex.Transaction;

interface SequenceOptions {
  clinicId: string;
  prefix: string;
  padLength: number;
  scopeKey: string;
}

function toSequenceValue(rawValue: unknown): number {
  const parsed = Number(rawValue ?? 0);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.trunc(parsed) : 1;
}

async function reserveNextSequenceValue(
  executor: NumberQueryExecutor,
  clinicId: string,
  scopeKey: string,
): Promise<number> {
  const result = await executor.raw<{ rows?: Array<{ next_value?: number | string }> }>(
    `
      WITH __tenant_context AS (
        SELECT set_config('app.clinic_id', ?, true)
      )
      INSERT INTO clinic_sequences (id, clinic_id, scope_key, next_value, created_at, updated_at)
      SELECT gen_random_uuid(), ?, ?, 1, now(), now()
      FROM __tenant_context
      ON CONFLICT (clinic_id, scope_key)
      DO UPDATE
      SET next_value = clinic_sequences.next_value + 1,
          updated_at = now()
      RETURNING next_value
    `,
    [clinicId, clinicId, scopeKey],
  );
  return toSequenceValue(result.rows?.[0]?.next_value);
}

async function nextNumberFromPrefix(
  query: NumberQueryExecutor,
  options: SequenceOptions,
): Promise<string> {
  const nextSeq = await reserveNextSequenceValue(
    query,
    options.clinicId,
    options.scopeKey,
  );
  return `${options.prefix}${String(nextSeq).padStart(options.padLength, '0')}`;
}

export async function generatePatientNumber(
  clinicId: string,
  query: NumberQueryExecutor = db,
): Promise<string> {
  return nextNumberFromPrefix(query, {
    clinicId,
    prefix: 'P',
    padLength: 6,
    scopeKey: 'patient_number',
  });
}

export async function generateEpisodeNumber(
  clinicId: string,
  query: NumberQueryExecutor = db,
): Promise<string> {
  return nextNumberFromPrefix(query, {
    clinicId,
    prefix: 'E',
    padLength: 6,
    scopeKey: 'episode_number',
  });
}

export async function generateReferralNumber(
  clinicId: string,
  query: NumberQueryExecutor = db,
): Promise<string> {
  const year = new Date().getUTCFullYear();
  return nextNumberFromPrefix(query, {
    clinicId,
    prefix: `REF-${year}-`,
    padLength: 6,
    scopeKey: `referral_number:${year}`,
  });
}

export async function generateInvoiceNumber(
  clinicId: string,
  query: NumberQueryExecutor = db,
): Promise<string> {
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return nextNumberFromPrefix(query, {
    clinicId,
    prefix: `INV-${day}-`,
    padLength: 6,
    scopeKey: `invoice_number:${day}`,
  });
}
