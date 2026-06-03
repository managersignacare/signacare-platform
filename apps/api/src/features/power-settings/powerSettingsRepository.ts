import { randomUUID } from 'crypto'
import { adminPoolRaw, db } from '../../db/db'

// Mirrors `subscriber_branding` exactly. Phase 0.7.5 c24 C9 (SD16) —
// interface previously declared no-underscore ghost columns
// (sidebartitle, sidebarsubtitle, logourl). DB has the snake_case
// versions. Every upsert crashed at runtime. Also surfaces the
// previously-absent `primary_color`, `sidebar_color`, `org_name`
// columns so future UI can display them.
export interface SubscriberBrandingRow {
  id: string
  clinic_id: string
  logo_url: string | null
  primary_color: string | null
  sidebar_color: string | null
  sidebar_title: string | null
  sidebar_subtitle: string | null
  org_name: string | null
  created_at: string
  updated_at: string
}

function brandingTable(useAdminPool: boolean) {
  // Cross-clinic superadmin read surfaces must bypass request-scoped trx
  // routing (which pins to req.clinicId under FORCE RLS).
  return (useAdminPool ? adminPoolRaw : db)<SubscriberBrandingRow>('subscriber_branding')
}

function normalizeTextField(value: string | undefined): string | null {
  if (value === undefined) return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false
  const maybe = err as { code?: unknown }
  return maybe.code === '23505'
}

export async function findBrandingByClinic(
  clinicId: string,
  options?: { useAdminPool?: boolean },
): Promise<SubscriberBrandingRow | undefined> {
  return brandingTable(options?.useAdminPool === true)
    .where({ clinic_id: clinicId })
    .orderBy('updated_at', 'desc')
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .first()
}

export async function findAllBranding(): Promise<SubscriberBrandingRow[]> {
  // Superadmin panel is a cross-clinic surface by design; use the
  // admin pool so RLS clinic-scoping does not hide other clinics.
  return brandingTable(true)
    .orderBy('updated_at', 'desc')
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
}

export async function upsertBranding(
  clinicId: string,
  data: {
    sidebarTitle?: string
    sidebarSubtitle?: string
    logoUrl?: string
  },
  options?: { useAdminPool?: boolean },
): Promise<void> {
  const nowIso = new Date().toISOString();
  const table = brandingTable(options?.useAdminPool === true)
  const sidebarTitle = normalizeTextField(data.sidebarTitle)
  const sidebarSubtitle = normalizeTextField(data.sidebarSubtitle)
  const logoUrl = normalizeTextField(data.logoUrl)

  // L5 hardening: do not assume a unique index exists on clinic_id.
  // We update first (works on legacy schemas), then insert if absent.
  const updated = await table
    .where({ clinic_id: clinicId })
    .update({
      sidebar_title: sidebarTitle,
      sidebar_subtitle: sidebarSubtitle,
      logo_url: logoUrl,
      updated_at: nowIso,
    })
  if (updated > 0) return

  try {
    await table.insert({
      id: randomUUID(),
      clinic_id: clinicId,
      sidebar_title: sidebarTitle,
      sidebar_subtitle: sidebarSubtitle,
      logo_url: logoUrl,
      created_at: nowIso,
      updated_at: nowIso,
    })
  } catch (err) {
    // Concurrent create race: if another writer inserted first and a
    // unique index exists, retry as update.
    if (!isUniqueViolation(err)) throw err
    await table
      .where({ clinic_id: clinicId })
      .update({
        sidebar_title: sidebarTitle,
        sidebar_subtitle: sidebarSubtitle,
        logo_url: logoUrl,
        updated_at: nowIso,
      })
  }
}
