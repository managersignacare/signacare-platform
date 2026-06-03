// packages/shared/src/moduleRegistry.ts
//
// Multi-specialty Phase 2 — Module Registry.
//
// Declarative source of truth for which UI modules belong to which clinical
// specialty. Read by the frontend ModuleContext to decide which patient
// detail tabs and sidebar nav items to render for a given user looking at
// a given patient.
//
// Design principles:
//
//   1. Core (always-on) modules — patient banner, allergies, active
//      problems, medications, documents, referrals — are NEVER hidden.
//      Safety-critical surfaces stay visible regardless of specialty
//      context, even to clinicians outside the patient's specialties.
//      An oncologist must see the cardiac meds a cardiologist wrote.
//
//   2. Specialty-gated modules are HIDDEN only when the visibility
//      intersection (clinic enabled_specialties ∩ staff specialties ∩
//      patient active specialties) does not include the module's
//      owning specialty. Hiding a module never removes data from the
//      database — another clinician in the right specialty still sees
//      it normally.
//
//   3. Unlisted modules (not mentioned in MODULE_REGISTRY at all) are
//      treated as always-on. This makes the framework additive — a new
//      phase adds entries, and existing code that hasn't been wired in
//      keeps working unchanged.
//
//   4. The visibility function (`computeVisibleSpecialties`) is pure
//      and lives in the shared package so both frontend and backend
//      can apply the same intersection. It has no React dependency and
//      is unit-tested in isolation.
//
// Phase 2 seeds the registry with entries for the existing mental-health
// modules plus explicit `core` entries for the surfaces that must never
// be hidden. Phases 3–8 add entries for the new specialty modules.

import { SpecialtyTypeEnum, type SpecialtyType } from './specialty.schemas';
import type { Role, Permission } from './rbac.schemas';
import { hasClinicalAccess } from './permissions';

/** Distinguishes always-on core modules from specialty-gated ones. */
export type ModuleSpecialty = SpecialtyType | 'core';

/** Identifier of a patient-detail tab — stable across releases so deeplinks keep resolving. */
export type PatientTabId = string;

export interface ModuleNavItem {
  /** URL path (no leading slash — matches the house apiClient convention). */
  path: string;
  label: string;
  /** MUI icon name, resolved on the frontend. */
  icon?: string;
  order?: number;
}

export interface ModulePatientTab {
  id: PatientTabId;
  label: string;
  order?: number;
}

export interface ModuleDescriptor {
  /** Stable module id, e.g. 'mental_health.lai'. */
  id: string;
  /** Owning specialty, or 'core' for always-on. */
  specialty: ModuleSpecialty;
  displayName: string;
  /** If true, the module is visible even if its specialty is not in the
   *  intersection. Use for safety-critical surfaces only. `specialty: 'core'`
   *  implies `alwaysOn: true`; listing both is legal and explicit. */
  alwaysOn?: boolean;
  /** All-of role gate. Empty = any authenticated user. */
  requiredRoles?: Role[];
  /** All-of permission gate. Empty = any authenticated user. */
  requiredPermissions?: Permission[];
  navItems?: ModuleNavItem[];
  patientTabs?: ModulePatientTab[];
}

// ── Registry ───────────────────────────────────────────────────────────────

export const MODULE_REGISTRY: ModuleDescriptor[] = [
  // ── Core (always-on) ──────────────────────────────────────────────────
  {
    id: 'core.patient-banner',
    specialty: 'core',
    displayName: 'Patient Banner',
    alwaysOn: true,
    patientTabs: [
      { id: 'summary',        label: 'Summary',        order: 10 },
      { id: 'overview',       label: 'Overview',       order: 20 },
      { id: 'episodes',       label: 'Episodes',       order: 30 },
      { id: 'alerts-plans',   label: 'Alerts & Plans', order: 40 },
      { id: 'problems',       label: 'Problem List',   order: 45 },
      { id: 'medications',    label: 'Active Medications', order: 50 },
      { id: 'medication-history', label: 'Medication History', order: 55 },
      { id: 'pathology',      label: 'Pathology',      order: 60 },
      { id: 'physical-health', label: 'Physical Health', order: 70 },
      // Referrals / Correspondence / Documents remain in the registry
      // so ?tab= deeplinks keep resolving, but they no longer render as
      // top-level tabs. They're nested under the Mental Health group's
      // 'mh-exchange' wrapper tab instead.
      { id: 'referrals',      label: 'Referrals',      order: 80 },
      { id: 'documents',      label: 'Documents',      order: 90 },
      { id: 'correspondence', label: 'Correspondence', order: 100 },
      { id: 'mh-exchange',    label: 'Information Exchange', order: 105 },
      { id: 'assessments',    label: 'Assessments',    order: 110 },
      { id: 'appointments',   label: 'Appointments',   order: 120 },
      { id: 'tracking',       label: 'Tracking',       order: 130 },
      { id: 'billing',        label: 'Billing',        order: 140 },
    ],
    navItems: [
      { path: 'dashboard',    label: 'Dashboard',    order: 10 },
      { path: 'patients',     label: 'Patients',     order: 20 },
      { path: 'tasks',        label: 'Tasks',        order: 30 },
      { path: 'referrals',    label: 'Referrals',    order: 40 },
      { path: 'referrals/queue', label: 'Referral Out', order: 45 },
      { path: 'appointments', label: 'Appointments', order: 50 },
      { path: 'bed-board',    label: 'Bed Board',    order: 60 },
      { path: 'reports',      label: 'Reports',      order: 70 },
    ],
  },

  // ── Internal Medicine ─────────────────────────────────────────────────
  // Problem list is registered under core (always-on) above — it is a
  // safety surface every clinician must see. Internal medicine adds
  // chronic-disease workflows and medication reconciliation as
  // specialty-gated tabs that can be hidden from clinicians outside
  // general_medicine on patients with no GIM episode.
  {
    id: 'general_medicine.problem-list',
    specialty: 'general_medicine',
    displayName: 'Problem List Owner',
    // The actual `problems` tab is also declared core so it is always
    // visible. This entry exists so chronic-disease registers and other
    // GIM-specific views can plug in alongside it.
    patientTabs: [],
  },
  {
    id: 'general_medicine.chronic-disease-register',
    specialty: 'general_medicine',
    displayName: 'Chronic Disease Register',
    patientTabs: [
      { id: 'chronic-diseases', label: 'Chronic Diseases', order: 150 },
    ],
  },
  {
    id: 'general_medicine.information-exchange',
    specialty: 'general_medicine',
    displayName: 'IM Information Exchange',
    patientTabs: [
      { id: 'gim-exchange', label: 'Information Exchange', order: 155 },
    ],
  },
  // Medication reconciliation is no longer a top-level patient tab — the
  // Medications tab now hosts a "Reconciliation" sub-tab so all medication
  // workflows live in one place. The /api/v1/internal-medicine/.../med-reconciliations
  // endpoint stays unchanged; only the patient detail tab was removed.

  // ── Mental Health ─────────────────────────────────────────────────────
  {
    id: 'mental_health.lai',
    specialty: 'mental_health',
    displayName: 'LAI Management',
    patientTabs: [],
    navItems: [{ path: 'list/lai', label: 'LAI', order: 100 }],
  },
  {
    id: 'mental_health.clozapine',
    specialty: 'mental_health',
    displayName: 'Clozapine Monitoring',
    patientTabs: [],
    navItems: [{ path: 'list/clozapine', label: 'Clozapine', order: 110 }],
  },
  {
    id: 'mental_health.mh-act',
    specialty: 'mental_health',
    displayName: 'Mental Health Act',
    patientTabs: [
      { id: 'legal',         label: 'Legal',         order: 200 },
      { id: '91day-review',  label: '91-Day Review', order: 210 },
    ],
    navItems: [
      { path: 'list/mha',    label: 'MH Act',       order: 120 },
      { path: 'list/91day',  label: '91-Day Review', order: 130 },
    ],
  },
  {
    id: 'mental_health.psychology',
    specialty: 'mental_health',
    displayName: 'Psychology Pathways',
    patientTabs: [
      { id: 'pathways',         label: 'Psychology',       order: 220 },
      { id: 'lived-experience', label: 'Lived Experience', order: 230 },
    ],
    navItems: [
      { path: 'pathways', label: 'Pathways', order: 140 },
    ],
  },
  {
    id: 'mental_health.acute-interventions',
    specialty: 'mental_health',
    displayName: 'Acute Mental Health Interventions',
    patientTabs: [
      { id: 'inpatient-care', label: 'Inpatient Care', order: 300 },
      { id: 'ect',            label: 'ECT',            order: 310 },
      { id: 'tms',            label: 'TMS',            order: 320 },
    ],
  },
  // ── Paediatrics ───────────────────────────────────────────────────────
  // Specialty-gated. Visible only when the visibility intersection
  // (clinic ∩ staff ∩ patient episodes) contains 'paediatrics'.
  // ONE top-level tab hosts growth, immunizations, milestones and
  // unified clinical notes as sub-tabs — the user's "one tab per
  // specialty" rule. The shared SpecialtyMdtBanner sits at the top.
  {
    id: 'paediatrics.module',
    specialty: 'paediatrics',
    displayName: 'Paediatrics',
    patientTabs: [{ id: 'paediatrics', label: 'Paediatrics', order: 250 }],
  },
  {
    id: 'paediatrics.information-exchange',
    specialty: 'paediatrics',
    displayName: 'Paed Information Exchange',
    patientTabs: [{ id: 'paed-exchange', label: 'Information Exchange', order: 255 }],
  },
  // ── Obstetrics & Gynaecology ──────────────────────────────────────────
  // Specialty-gated. One top-level tab (obs-gyne) hosts the pregnancy
  // dashboard, antenatal visit flowsheet and clinical notes; the
  // Information Exchange surface sits as its own sibling tab.
  {
    id: 'obstetrics_gynaecology.module',
    specialty: 'obstetrics_gynaecology',
    displayName: 'Obstetrics & Gynaecology',
    patientTabs: [{ id: 'obs-gyne', label: 'Obstetrics & Gynaecology', order: 280 }],
  },
  {
    id: 'obstetrics_gynaecology.information-exchange',
    specialty: 'obstetrics_gynaecology',
    displayName: 'O&G Information Exchange',
    patientTabs: [{ id: 'obs-exchange', label: 'Information Exchange', order: 285 }],
  },
  // ── Surgery ────────────────────────────────────────────────────────────
  // Specialty-gated. One top-level tab hosts the case list, WHO
  // three-phase safety checklist wizard, op-note editor and PACU
  // recovery flowsheet. Op-note creation is blocked by the backend
  // until all three checklist phases exist for the case.
  {
    id: 'surgery.module',
    specialty: 'surgery',
    displayName: 'Surgery',
    patientTabs: [{ id: 'surgery', label: 'Surgery', order: 310 }],
  },
  {
    id: 'surgery.information-exchange',
    specialty: 'surgery',
    displayName: 'Surgery Information Exchange',
    patientTabs: [{ id: 'surg-exchange', label: 'Information Exchange', order: 315 }],
  },
  // ── Oncology (Phase 8, mCODE-aligned) ─────────────────────────────────
  // Specialty-gated. One top-level tab hosts the cancer journey
  // timeline, staging form, ECOG capture, treatment plans, chemo
  // cycle tracker and tumour board decisions. Sibling Information
  // Exchange tab surfaces oncology-scoped Referrals + Correspondence +
  // Documents via the shared SpecialtyInformationExchangeTab —
  // matching the pattern already used by the other five specialties.
  // Clinical notes are NOT a separate per-specialty surface; they
  // live at apps/api/src/features/clinical-notes and are scoped by
  // episode_id (where episodes.specialty = 'oncology').
  {
    id: 'oncology.module',
    specialty: 'oncology',
    displayName: 'Oncology',
    patientTabs: [{ id: 'oncology', label: 'Oncology', order: 330 }],
  },
  {
    id: 'oncology.information-exchange',
    specialty: 'oncology',
    displayName: 'Oncology Information Exchange',
    patientTabs: [{ id: 'onco-exchange', label: 'Information Exchange', order: 335 }],
  },
  // ── Endocrinology ──────────────────────────────────────────────────────
  // Specialty-gated. The glucose flowsheet is the primary surface
  // (insulin regimens live as a sub-tab inside Medications now).
  {
    id: 'endocrinology.module',
    specialty: 'endocrinology',
    displayName: 'Endocrinology',
    patientTabs: [{ id: 'glucose', label: 'Endocrinology', order: 180 }],
  },
  {
    id: 'endocrinology.information-exchange',
    specialty: 'endocrinology',
    displayName: 'Endo Information Exchange',
    patientTabs: [{ id: 'endo-exchange', label: 'Information Exchange', order: 185 }],
  },

  // Viva (the patient-facing app) is `core` so every specialty can
  // use it. Previously gated on mental_health, but the Patient App
  // is not psychiatry-specific.
  {
    id: 'core.patient-app',
    specialty: 'core',
    displayName: 'Patient App (Viva)',
    alwaysOn: true,
    patientTabs: [{ id: 'viva', label: 'Viva', order: 400 }],
  },
];

// ── Pure visibility helpers ────────────────────────────────────────────────

/**
 * Compute the set of specialty codes the current user should see modules for.
 *
 * Semantics:
 *   - Non-patient pages (patientActiveSpecialties === undefined):
 *       clinic.enabled_specialties ∩ staff.specialties
 *       with a legacy fallback to `mental_health` when the specialty
 *       tables are empty/missing for a clinical user.
 *   - Patient pages with active episodes:
 *       above ∩ patient.active_specialties
 *   - Patient pages where the patient has no active episodes:
 *       falls back to the non-patient intersection, so a freshly
 *       registered patient doesn't collapse to zero visible modules.
 *
 * Admin bypass:
 *   - If `userRole` is 'admin' or 'superadmin', the staff intersection
 *     is SKIPPED — the user sees every enabled specialty at the clinic
 *     regardless of whether they are personally enrolled in it. This
 *     matches the rest of the system (module-access middleware,
 *     Access Control matrix) where admin/superadmin bypass per-staff
 *     ABAC gates. Without this bypass, toggling a specialty in Power
 *     Settings has no visible effect for an admin user because
 *     `staff ∩ enabled` can never contain a specialty the admin
 *     personally isn't enrolled in.
 *
 * Invalid specialty codes (e.g. data drift from an older release) are
 * silently dropped rather than throwing, so a renamed specialty can't
 * break the UI for every clinician.
 */
const ROLES_THAT_BYPASS_STAFF_SPECIALTY = new Set(['admin', 'superadmin']);
const LEGACY_DEFAULT_SPECIALTY: SpecialtyType = 'mental_health';

export function computeVisibleSpecialties(input: {
  enabledSpecialties: readonly string[];
  staffSpecialties: readonly string[];
  patientActiveSpecialties?: readonly string[];
  /** Current user role — admin / superadmin bypass the staff
   *  specialty intersection so they see every enabled specialty at
   *  the clinic. Default undefined → apply the full intersection. */
  userRole?: string;
}): Set<SpecialtyType> {
  const validSet = new Set<SpecialtyType>(SpecialtyTypeEnum.options);
  const enabledRaw = new Set<SpecialtyType>(
    input.enabledSpecialties.filter((s): s is SpecialtyType => validSet.has(s as SpecialtyType)),
  );
  const enabled = enabledRaw.size > 0
    ? enabledRaw
    : new Set<SpecialtyType>([LEGACY_DEFAULT_SPECIALTY]);
  const staffRaw = new Set<SpecialtyType>(
    input.staffSpecialties.filter((s): s is SpecialtyType => validSet.has(s as SpecialtyType)),
  );
  let staff = staffRaw;

  const isAdminBypass = !!input.userRole && ROLES_THAT_BYPASS_STAFF_SPECIALTY.has(input.userRole);
  const canApplyLegacyStaffFallback =
    !isAdminBypass
    && hasClinicalAccess(input.userRole)
    && staffRaw.size === 0
    && enabled.has(LEGACY_DEFAULT_SPECIALTY)
    // Keep fallback narrow to mental-health only: if staff-specialty
    // rows are absent for a clinical user, restore baseline mental
    // health visibility so LAI / MHA / clozapine lists do not disappear.
    // Non-mental-health specialties still remain hidden until explicitly
    // enrolled.
  if (canApplyLegacyStaffFallback) {
    staff = new Set<SpecialtyType>([LEGACY_DEFAULT_SPECIALTY]);
  }

  // For admin / superadmin: the visible set is the whole enabled
  // set. Staff intersection is intentionally skipped.
  const clinicAndStaff = new Set<SpecialtyType>();
  if (isAdminBypass) {
    for (const code of enabled) clinicAndStaff.add(code);
  } else {
    for (const code of staff) {
      if (enabled.has(code)) clinicAndStaff.add(code);
    }
  }

  // No patient context → non-patient page.
  if (input.patientActiveSpecialties === undefined) return clinicAndStaff;

  // Patient with no open episodes → fall back to non-patient intersection
  // so a freshly registered patient (or a chart between episodes) doesn't
  // hide every specialty module from an otherwise authorised clinician.
  if (input.patientActiveSpecialties.length === 0) return clinicAndStaff;

  // Admin bypass also applies to the patient-page intersection: an
  // admin reviewing a chart should see every tab the clinic has
  // enabled, regardless of whether this specific patient currently
  // has an open episode in that specialty. Otherwise an admin can't
  // see historical data for a specialty the patient once used.
  if (isAdminBypass) return clinicAndStaff;

  const active = new Set<SpecialtyType>(
    input.patientActiveSpecialties.filter((s): s is SpecialtyType => validSet.has(s as SpecialtyType)),
  );
  const result = new Set<SpecialtyType>();
  for (const code of clinicAndStaff) {
    if (active.has(code)) result.add(code);
  }
  return result;
}

/**
 * Find all registry entries that declare ownership of a given patient tab id.
 * A tab may appear in more than one module — it's visible if ANY of its
 * owning modules would be visible.
 */
function entriesForTab(tabId: PatientTabId): ModuleDescriptor[] {
  return MODULE_REGISTRY.filter((m) => m.patientTabs?.some((t) => t.id === tabId));
}

/**
 * Find all registry entries that declare ownership of a given nav path.
 */
function entriesForNavPath(path: string): ModuleDescriptor[] {
  return MODULE_REGISTRY.filter((m) => m.navItems?.some((n) => n.path === path));
}

/**
 * Is a patient tab visible given the current visibility set?
 *
 *   - Unlisted tabs (not in any registry entry) are always visible —
 *     makes the framework additive for code that hasn't been wired in.
 *   - Any matching `alwaysOn` or `specialty: 'core'` entry wins.
 *   - Otherwise the tab is visible when at least one matching entry's
 *     specialty is in `visibleSpecialties`.
 */
export function isPatientTabVisible(
  tabId: PatientTabId,
  visibleSpecialties: ReadonlySet<SpecialtyType>,
): boolean {
  const entries = entriesForTab(tabId);
  if (entries.length === 0) return true;
  for (const entry of entries) {
    if (entry.alwaysOn || entry.specialty === 'core') return true;
    if (visibleSpecialties.has(entry.specialty as SpecialtyType)) return true;
  }
  return false;
}

/**
 * Is a nav item visible given the current visibility set?
 *
 * Same semantics as isPatientTabVisible but keyed on the URL path.
 */
export function isNavItemVisible(
  path: string,
  visibleSpecialties: ReadonlySet<SpecialtyType>,
): boolean {
  const entries = entriesForNavPath(path);
  if (entries.length === 0) return true;
  for (const entry of entries) {
    if (entry.alwaysOn || entry.specialty === 'core') return true;
    if (visibleSpecialties.has(entry.specialty as SpecialtyType)) return true;
  }
  return false;
}
