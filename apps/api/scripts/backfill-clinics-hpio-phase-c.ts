#!/usr/bin/env tsx
/**
 * A2-2 Phase C / BUG-334 backfill executor for clinics.hpio.
 *
 * Modes:
 * - mapping (default): operator-provided JSON map { "<clinic_id>": "<hpio>" }.
 * - synthetic_nonprod: deterministic, Luhn-valid HPI-O generation for local/test
 *   environments only (blocked in production).
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { dbAdmin } from '../src/db/db';
import { HI_PREFIX, luhnCheck, validateHiNumber } from '../src/shared/hiNumbers';

type BackfillMode = 'mapping' | 'synthetic_nonprod';

const MODE = (process.env.A2_HPIO_BACKFILL_MODE ?? 'mapping') as BackfillMode;
const MAP_PATH = process.env.A2_HPIO_MAP_PATH ? resolve(process.cwd(), process.env.A2_HPIO_MAP_PATH) : null;
const DRY_RUN = process.env.A2_HPIO_DRY_RUN === 'true';
const ALLOW_SYNTHETIC = process.env.A2_HPIO_ALLOW_SYNTHETIC_NONPROD === 'true';
const CHUNK_SIZE = parseInt(process.env.A2_HPIO_CHUNK_SIZE ?? '200', 10);

interface ClinicRow {
  id: string;
  name: string;
}

function toInt(value: unknown): number {
  return Number.parseInt(String(value ?? '0'), 10);
}

function computeCheckDigit(first15Digits: string): string {
  for (let d = 0; d <= 9; d += 1) {
    const candidate = `${first15Digits}${d}`;
    if (luhnCheck(candidate)) return String(d);
  }
  throw new Error(`Unable to compute check digit for ${first15Digits}`);
}

function syntheticHpioForClinicId(clinicId: string, salt: number): string {
  const seed = `${clinicId}:${salt}`;
  const hash = createHash('sha256').update(seed).digest('hex');
  const nineDigits = (BigInt(`0x${hash.slice(0, 16)}`) % 1000000000n).toString().padStart(9, '0');
  const first15 = `${HI_PREFIX.HPI_O}${nineDigits}`;
  const checkDigit = computeCheckDigit(first15);
  const value = `${first15}${checkDigit}`;
  if (!validateHiNumber(value, HI_PREFIX.HPI_O)) {
    throw new Error(`Generated invalid synthetic HPI-O: ${value}`);
  }
  return value;
}

async function listNullClinics(): Promise<ClinicRow[]> {
  return dbAdmin<ClinicRow>('clinics')
    .whereNull('hpio')
    .select('id', 'name')
    .orderBy('created_at', 'asc');
}

async function existingHpioSet(): Promise<Set<string>> {
  const rows = await dbAdmin('clinics')
    .whereNotNull('hpio')
    .select<{ hpio: string }[]>('hpio');
  return new Set(rows.map((r) => String(r.hpio)));
}

function loadMapping(): Record<string, string> {
  if (!MAP_PATH) {
    throw new Error('A2_HPIO_MAP_PATH is required when A2_HPIO_BACKFILL_MODE=mapping');
  }
  const parsed = JSON.parse(readFileSync(MAP_PATH, 'utf8')) as Record<string, string>;
  return parsed;
}

function ensureModeSafety(mode: BackfillMode): void {
  if (mode === 'synthetic_nonprod') {
    if (!ALLOW_SYNTHETIC) {
      throw new Error('A2_HPIO_ALLOW_SYNTHETIC_NONPROD=true is required for synthetic_nonprod mode');
    }
    if (String(process.env.NODE_ENV).toLowerCase() === 'production') {
      throw new Error('synthetic_nonprod mode is blocked when NODE_ENV=production');
    }
  }
}

async function applyMappingBackfill(clinics: ClinicRow[]): Promise<number> {
  const mapping = loadMapping();
  let updated = 0;

  await dbAdmin.transaction(async (trx) => {
    for (const clinic of clinics) {
      const mapped = mapping[clinic.id];
      if (!mapped) {
        throw new Error(`Missing HPI-O mapping for clinic ${clinic.id} (${clinic.name})`);
      }
      if (!validateHiNumber(mapped, HI_PREFIX.HPI_O)) {
        throw new Error(`Invalid mapped HPI-O for clinic ${clinic.id}: ${mapped}`);
      }
      if (!DRY_RUN) {
        const changed = await trx('clinics')
          .where({ id: clinic.id })
          .whereNull('hpio')
          .update({ hpio: mapped });
        updated += changed;
      }
    }
  });

  return DRY_RUN ? clinics.length : updated;
}

async function applySyntheticBackfill(clinics: ClinicRow[]): Promise<number> {
  const used = await existingHpioSet();
  const assignments = new Map<string, string>();

  for (const clinic of clinics) {
    let salt = 0;
    let candidate = syntheticHpioForClinicId(clinic.id, salt);
    while (used.has(candidate)) {
      salt += 1;
      candidate = syntheticHpioForClinicId(clinic.id, salt);
    }
    used.add(candidate);
    assignments.set(clinic.id, candidate);
  }

  let updated = 0;
  await dbAdmin.transaction(async (trx) => {
    for (const clinic of clinics) {
      const hpio = assignments.get(clinic.id)!;
      if (!DRY_RUN) {
        const changed = await trx('clinics')
          .where({ id: clinic.id })
          .whereNull('hpio')
          .update({ hpio });
        updated += changed;
      }
    }
  });

  return DRY_RUN ? clinics.length : updated;
}

async function countNullHpio(): Promise<number> {
  const row = await dbAdmin('clinics')
    .whereNull('hpio')
    .count<{ count: string }>('* as count')
    .first();
  return toInt(row?.count);
}

async function main(): Promise<number> {
  if (!Number.isFinite(CHUNK_SIZE) || CHUNK_SIZE <= 0) {
    throw new Error(`A2_HPIO_CHUNK_SIZE must be a positive integer (got ${CHUNK_SIZE})`);
  }

  ensureModeSafety(MODE);
  const before = await countNullHpio();
  const clinics = await listNullClinics();

  // eslint-disable-next-line no-console
  console.log('A2 Phase C backfill — clinics.hpio');
  // eslint-disable-next-line no-console
  console.log(`  mode=${MODE}`);
  // eslint-disable-next-line no-console
  console.log(`  dry_run=${DRY_RUN}`);
  // eslint-disable-next-line no-console
  console.log(`  null_before=${before}`);

  if (clinics.length === 0) {
    // eslint-disable-next-line no-console
    console.log('✓ no null clinics.hpio rows found');
    return 0;
  }

  let processed = 0;
  while (processed < clinics.length) {
    const chunk = clinics.slice(processed, processed + CHUNK_SIZE);
    let changed = 0;
    if (MODE === 'mapping') {
      changed = await applyMappingBackfill(chunk);
    } else {
      changed = await applySyntheticBackfill(chunk);
    }
    processed += chunk.length;
    // eslint-disable-next-line no-console
    console.log(`  chunk_processed=${chunk.length} chunk_updated=${changed} processed=${processed}/${clinics.length}`);
  }

  if (DRY_RUN) {
    // eslint-disable-next-line no-console
    console.log('✓ dry-run complete (no database updates applied)');
    return 0;
  }

  const after = await countNullHpio();
  // eslint-disable-next-line no-console
  console.log(`  null_after=${after}`);
  if (after !== 0) {
    // eslint-disable-next-line no-console
    console.error(`✗ A2 Phase C hpio backfill incomplete: remaining=${after}`);
    return 1;
  }

  // eslint-disable-next-line no-console
  console.log('✓ A2 Phase C hpio backfill complete');
  return 0;
}

main()
  .then((exitCode) => dbAdmin.destroy().then(() => process.exit(exitCode)))
  .catch((error) => {
    // eslint-disable-next-line no-console
    console.error(error);
    dbAdmin.destroy().finally(() => process.exit(1));
  });
