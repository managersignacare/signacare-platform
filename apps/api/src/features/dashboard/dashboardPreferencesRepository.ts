// @jsonb-extraction-exempt: repository-only preference blob persistence; queries
// select scoped ids/settings and return normalized domain objects, not raw DB rows.
import { db, dbRead } from '../../db/db';
import { AppError } from '../../shared/errors';
import type { DashboardPreferences } from '@signacare/shared';

const SETTING_KEY = 'dashboard_preferences';

interface DashboardPreferenceRow {
  setting_value: DashboardPreferences | null;
}

export async function getDashboardPreferencesSetting(
  staffId: string,
  clinicId: string,
): Promise<DashboardPreferences | null> {
  const row = await dbRead<DashboardPreferenceRow>('staff_settings as ss')
    .join('staff as s', 's.id', 'ss.staff_id')
    .where({
      'ss.staff_id': staffId,
      'ss.setting_key': SETTING_KEY,
      's.clinic_id': clinicId,
    })
    .whereNull('s.deleted_at')
    .first('ss.setting_value');

  return row?.setting_value ?? null;
}

async function assertActiveStaffMembership(
  staffId: string,
  clinicId: string,
): Promise<void> {
  const staff = await dbRead('staff')
    .where({ id: staffId, clinic_id: clinicId })
    .whereNull('deleted_at')
    .first('id');

  if (!staff) {
    throw new AppError('Staff member not found for clinic', 404, 'STAFF_NOT_FOUND');
  }
}

export async function setDashboardPreferencesSetting(
  staffId: string,
  clinicId: string,
  preferences: DashboardPreferences,
): Promise<void> {
  await assertActiveStaffMembership(staffId, clinicId);

  await db('staff_settings')
    .insert({
      staff_id: staffId,
      setting_key: SETTING_KEY,
      setting_value: preferences,
      created_at: new Date(),
      updated_at: new Date(),
    })
    .onConflict(['staff_id', 'setting_key'])
    .merge({
      setting_value: preferences,
      updated_at: new Date(),
    });
}
