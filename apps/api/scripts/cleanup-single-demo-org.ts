import 'dotenv/config';
import { adminPoolRaw, appPoolRaw, clearPoolMonitor, dbAdmin } from '../src/db/db';

interface ClinicRow {
  id: string;
  name: string;
  is_active: boolean;
}

interface CountRow {
  c: number;
}

const DEFAULT_KEEP_CLINICS = ['Canonical Primary Clinic'];

function parseKeepClinicNames(): string[] {
  const raw = process.env.DEMO_KEEP_CLINIC_NAMES?.trim();
  if (!raw) return DEFAULT_KEEP_CLINICS;
  const names = raw.split(',').map((n) => n.trim()).filter(Boolean);
  return names.length > 0 ? names : DEFAULT_KEEP_CLINICS;
}

async function closePools(): Promise<void> {
  clearPoolMonitor();
  await Promise.allSettled([
    dbAdmin.destroy(),
    appPoolRaw.destroy(),
    adminPoolRaw.destroy(),
  ]);
}

async function main(): Promise<void> {
  const keepClinicNames = parseKeepClinicNames();
  const apply = process.env.DEMO_CLEANUP_APPLY === '1';

  console.log(`[cleanup-single-demo-org] mode=${apply ? 'APPLY' : 'DRY_RUN'}`);
  console.log(`[cleanup-single-demo-org] keep=${keepClinicNames.join(', ')}`);

  const keepRows = await dbAdmin<ClinicRow>('clinics')
    .whereIn('name', keepClinicNames)
    .whereNull('deleted_at')
    .select('id', 'name', 'is_active');

  if (keepRows.length === 0) {
    throw new Error(
      `[cleanup-single-demo-org] No keep clinics found for names: ${keepClinicNames.join(', ')}`,
    );
  }

  const keepIds = keepRows.map((r) => r.id);
  const targetRows = await dbAdmin<ClinicRow>('clinics')
    .whereNull('deleted_at')
    .whereNotIn('id', keepIds)
    .select('id', 'name', 'is_active')
    .orderBy('name', 'asc');

  const targetClinicIds = targetRows.map((r) => r.id);

  if (targetClinicIds.length === 0) {
    console.log('[cleanup-single-demo-org] Already clean: no extra non-deleted clinics.');
    return;
  }

  const staffCountRow = await dbAdmin('staff')
    .whereIn('clinic_id', targetClinicIds)
    .count<CountRow[]>({ c: '*' })
    .first();
  const sessionCountRow = await dbAdmin('staff_sessions')
    .whereIn('clinic_id', targetClinicIds)
    .whereNull('revoked_at')
    .count<CountRow[]>({ c: '*' })
    .first();

  const staffCount = Number(staffCountRow?.c ?? 0);
  const sessionCount = Number(sessionCountRow?.c ?? 0);

  console.log(`[cleanup-single-demo-org] retire_clinics=${targetClinicIds.length}`);
  console.log(`[cleanup-single-demo-org] deactivate_staff=${staffCount}`);
  console.log(`[cleanup-single-demo-org] revoke_sessions=${sessionCount}`);
  console.log('[cleanup-single-demo-org] first_10_targets=');
  for (const row of targetRows.slice(0, 10)) {
    console.log(`  - ${row.name} (${row.id})`);
  }

  if (!apply) {
    console.log(
      '[cleanup-single-demo-org] DRY_RUN complete. Set DEMO_CLEANUP_APPLY=1 to apply changes.',
    );
    return;
  }

  const now = new Date();

  await dbAdmin.transaction(async (trx) => {
    await trx('clinics')
      .whereIn('id', targetClinicIds)
      .whereNull('deleted_at')
      .update({
        deleted_at: now,
        is_active: false,
        updated_at: now,
      });

    await trx('staff')
      .whereIn('clinic_id', targetClinicIds)
      .where({ is_active: true })
      .update({
        is_active: false,
        updated_at: now,
      });

    await trx('staff_sessions')
      .whereIn('clinic_id', targetClinicIds)
      .whereNull('revoked_at')
      .update({
        revoked_at: now,
        updated_at: now,
        lock_version: trx.raw('lock_version + 1'),
      });

    await trx('subscriptions')
      .whereIn('clinic_id', targetClinicIds)
      .whereNot({ status: 'inactive' })
      .update({
        status: 'inactive',
        end_date: trx.raw('COALESCE(end_date, CURRENT_DATE)'),
        updated_at: now,
      });
  });

  const remainingNonDeleted = await dbAdmin('clinics')
    .whereNull('deleted_at')
    .select('id', 'name')
    .orderBy('name', 'asc');

  console.log('[cleanup-single-demo-org] APPLY complete.');
  console.log(`[cleanup-single-demo-org] remaining_non_deleted=${remainingNonDeleted.length}`);
  for (const clinic of remainingNonDeleted) {
    console.log(`  - ${clinic.name} (${clinic.id})`);
  }
}

main()
  .catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[cleanup-single-demo-org] FAILED: ${msg}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePools();
  });
