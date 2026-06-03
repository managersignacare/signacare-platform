/**
 * Cached lookups for the import pipeline.
 *
 * The CSV row mentions patients and clinicians by one of
 * { emr_number, email, family_name } and the adapter needs a UUID.
 * Doing a DB round-trip per row on a 5k-row import would be
 * unusably slow, so we cache by the normalised key across the whole
 * dry-run or commit call and share it via `ImportCtx`.
 *
 * Keeping the resolvers in one file (rather than duplicating inside
 * each adapter) ensures identical match semantics across all
 * adapters — a "patient identified by EMR number PT-123" means the
 * same thing whether the import is MHA, LAI, clozapine or notes.
 */
import type { Knex } from 'knex';
import { db } from '../../db/db';
import type { ImportCtx } from './importTypes';

export async function resolvePatientByEmrNumber(
  ctx: ImportCtx,
  emrNumber: string,
): Promise<string | null> {
  const key = `emr:${emrNumber.trim().toUpperCase()}`;
  const cached = ctx.patientCache.get(key);
  if (cached !== undefined) return cached || null;
  const row = await db('patients')
    .where({ clinic_id: ctx.clinicId, emr_number: emrNumber.trim() })
    .whereNull('deleted_at')
    .select('id')
    .first() as { id: string } | undefined;
  const id = row?.id ?? '';
  ctx.patientCache.set(key, id);
  return id || null;
}

export async function resolveStaffByEmail(
  ctx: ImportCtx,
  email: string,
): Promise<string | null> {
  const key = `email:${email.trim().toLowerCase()}`;
  const cached = ctx.staffCache.get(key);
  if (cached !== undefined) return cached || null;
  const row = await db('staff')
    .where({ clinic_id: ctx.clinicId })
    .whereRaw('LOWER(email) = LOWER(?)', [email.trim()])
    .whereNull('deleted_at')
    .select('id')
    .first() as { id: string } | undefined;
  const id = row?.id ?? '';
  ctx.staffCache.set(key, id);
  return id || null;
}

export async function resolveLegalOrderTypeByCode(
  clinicId: string,
  code: string,
  trx?: Knex.Transaction,
): Promise<{ id: string; code: string } | null> {
  void clinicId; // legal_order_types is global reference data — no clinic_id column
  const q = (trx ?? db)('legal_order_types')
    .where({ code: code.trim().toUpperCase() })
    .select('id', 'code')
    .first();
  return ((await q) ?? null) as { id: string; code: string } | null;
}
