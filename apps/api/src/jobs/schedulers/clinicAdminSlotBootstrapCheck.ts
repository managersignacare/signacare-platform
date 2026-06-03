import { dbAdmin } from '../../db/db';
import { sendAdminAlert } from '../../features/patient-outreach/adminAlert';
import { logger as defaultLogger } from '../../utils/logger';

/** @schema-drift-exempt partial-shape */
export interface MissingAdminClinicRow {
  id: string;
  name: string | null;
}

export interface ClinicAdminSlotBootstrapOutcome {
  scanned: number;
  alerted: number;
  skippedRecent: number;
  errors: number;
}

export interface ClinicAdminSlotBootstrapContext {
  listClinicsMissingAdminSlots(): Promise<MissingAdminClinicRow[]>;
  listRecentlyAlertedClinicIds(clinicIds: string[], cutoff: Date): Promise<string[]>;
  sendMissingAdminAlert(clinic: MissingAdminClinicRow): Promise<void>;
  logger: {
    info(...args: unknown[]): void;
    warn(...args: unknown[]): void;
    error(...args: unknown[]): void;
  };
}

export const ADMIN_SLOT_ALERT_DEDUPE_HOURS = 24;

export async function processClinicAdminSlotBootstrapCheck(
  now: Date,
  ctx: ClinicAdminSlotBootstrapContext,
): Promise<ClinicAdminSlotBootstrapOutcome> {
  const out: ClinicAdminSlotBootstrapOutcome = {
    scanned: 0,
    alerted: 0,
    skippedRecent: 0,
    errors: 0,
  };

  let clinics: MissingAdminClinicRow[] = [];
  try {
    clinics = await ctx.listClinicsMissingAdminSlots();
  } catch (err) {
    ctx.logger.error(
      { err },
      'clinicAdminSlotBootstrapCheck failed to list clinics with missing admin slots',
    );
    return out;
  }

  out.scanned = clinics.length;
  if (clinics.length === 0) {
    ctx.logger.info(
      { kind: 'CLINIC_ADMIN_SLOT_BOOTSTRAP_EMPTY' },
      'clinicAdminSlotBootstrapCheck found no clinics with missing admin slots',
    );
    return out;
  }

  const cutoff = new Date(now.getTime() - ADMIN_SLOT_ALERT_DEDUPE_HOURS * 60 * 60 * 1000);
  let recentlyAlerted = new Set<string>();
  try {
    const recentIds = await ctx.listRecentlyAlertedClinicIds(
      clinics.map((clinic) => clinic.id),
      cutoff,
    );
    recentlyAlerted = new Set(recentIds);
  } catch (err) {
    ctx.logger.error(
      { err },
      'clinicAdminSlotBootstrapCheck failed to resolve recent alert dedupe set',
    );
    return out;
  }

  for (const clinic of clinics) {
    if (recentlyAlerted.has(clinic.id)) {
      out.skippedRecent++;
      continue;
    }
    try {
      await ctx.sendMissingAdminAlert(clinic);
      out.alerted++;
    } catch (err) {
      out.errors++;
      ctx.logger.error(
        { err, clinicId: clinic.id },
        'clinicAdminSlotBootstrapCheck failed to send missing-admin alert for clinic',
      );
    }
  }

  return out;
}

export async function buildLiveContext(): Promise<ClinicAdminSlotBootstrapContext> {
  return {
    async listClinicsMissingAdminSlots(): Promise<MissingAdminClinicRow[]> {
      const rows = await dbAdmin('clinics')
        .whereNull('deleted_at')
        .whereNull('nominated_admin_staff_id')
        .whereNull('delegated_admin_staff_id')
        .select('id', 'name');
      return rows as MissingAdminClinicRow[];
    },
    async listRecentlyAlertedClinicIds(clinicIds: string[], cutoff: Date): Promise<string[]> {
      if (clinicIds.length === 0) return [];
      const rows = await dbAdmin('audit_events_canonical')
        .whereIn('clinic_id', clinicIds)
        .where({ table_name: 'admin_alerts' })
        .whereRaw("UPPER(COALESCE(operation, action)) = 'ADMIN_ALERT'")
        .whereRaw("new_data->>'kind' = ?", ['clinic_admin_slots_unconfigured'])
        .where('created_at', '>=', cutoff)
        .select('clinic_id')
        .groupBy('clinic_id');
      return rows.map((row) => String(row.clinic_id));
    },
    async sendMissingAdminAlert(clinic: MissingAdminClinicRow): Promise<void> {
      await sendAdminAlert({
        clinicId: clinic.id,
        kind: 'clinic_admin_slots_unconfigured',
        payload: {
          source: 'jobs.bootstrap.startSchedulers',
          reason: 'bootstrap_admin_slots_missing_existing_clinic',
          clinic_name: clinic.name,
          nominated_admin_staff_id: null,
          delegated_admin_staff_id: null,
          dedupe_key: `clinic_admin_slots_unconfigured:${clinic.id}`,
          dedupe_window_hours: ADMIN_SLOT_ALERT_DEDUPE_HOURS,
        },
      });
    },
    logger: defaultLogger,
  };
}

export async function runClinicAdminSlotBootstrapCheck(
  now: Date = new Date(),
): Promise<ClinicAdminSlotBootstrapOutcome> {
  const ctx = await buildLiveContext();
  return processClinicAdminSlotBootstrapCheck(now, ctx);
}
