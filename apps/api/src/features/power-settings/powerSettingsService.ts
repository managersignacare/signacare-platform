import {
  findBrandingByClinic,
  upsertBranding as upsertBrandingRow,
  type SubscriberBrandingRow,
} from './powerSettingsRepository'
import { withTenantContext } from '../../shared/tenantContext'

function rowToResponse(row: SubscriberBrandingRow) {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    sidebarTitle: row.sidebar_title ?? '',
    sidebarSubtitle: row.sidebar_subtitle ?? '',
    logoUrl: row.logo_url ?? '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

async function loadClinicBrandingDefaults(clinicId: string): Promise<{ id: string; name: string } | null> {
  const { dbAdmin } = await import('../../db/db')
  const clinic = await dbAdmin('clinics')
    .where({ id: clinicId })
    .whereNull('deleted_at')
    .first('id', 'name')
  if (!clinic) return null
  return {
    id: String(clinic.id),
    name: String(clinic.name ?? 'Signacare'),
  }
}

export const powerSettingsService = {
  async getBranding(clinicId: string) {
    const row = await findBrandingByClinic(clinicId)
    const clinic = await loadClinicBrandingDefaults(clinicId)
    if (!clinic) return null

    if (!row) {
      const nowIso = new Date().toISOString()
      return {
        id: clinic.id,
        clinicId,
        sidebarTitle: clinic.name,
        sidebarSubtitle: 'Mental Health EMR',
        logoUrl: '',
        createdAt: nowIso,
        updatedAt: nowIso,
      }
    }

    const mapped = rowToResponse(row)
    return {
      ...mapped,
      sidebarTitle: mapped.sidebarTitle.trim().length > 0 ? mapped.sidebarTitle : clinic.name,
      sidebarSubtitle: mapped.sidebarSubtitle.trim().length > 0 ? mapped.sidebarSubtitle : 'Mental Health EMR',
    }
  },

  async getAllBranding() {
    const { dbAdmin } = await import('../../db/db')
    const clinics = await dbAdmin('clinics')
      .whereNull('deleted_at')
      .select('id')

    const rows: SubscriberBrandingRow[] = []
    for (const clinic of clinics) {
      const clinicId = String(clinic.id)
      const row = await withTenantContext(clinicId, () => findBrandingByClinic(clinicId))
      if (row) rows.push(row)
    }
    return rows.map(rowToResponse)
  },

  async upsertBranding(
    clinicId: string,
    data: { sidebarTitle?: string; sidebarSubtitle?: string; logoUrl?: string },
  ) {
    // Under FORCE RLS, superadmin cross-clinic writes must execute in the
    // selected clinic tenant context instead of inheriting request clinic scope.
    return withTenantContext(clinicId, async () => {
      await upsertBrandingRow(clinicId, data)
      const row = await findBrandingByClinic(clinicId)
      return row ? rowToResponse(row) : null
    })
  },
}
