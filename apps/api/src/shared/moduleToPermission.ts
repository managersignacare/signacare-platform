/**
 * Module key → required RBAC permission mapping.
 *
 * This map is the fallback path for the module-access middleware.
 * When a request hits a route gated by `requireModuleRead` or
 * `requireModuleWrite` and the caller has NO explicit row in
 * `staff_module_access` for that module, the middleware falls
 * back to checking whether the caller has the corresponding
 * permission on their role via the existing RBAC matrix.
 *
 * Why this exists:
 *
 *   Adding `requireModuleRead('patients')` to patientRoutes would
 *   otherwise lock every receptionist out of the patient surface
 *   because the backfill migrations only seeded grants for
 *   clinicians and admins. Receptionists, managers and
 *   referral_coordinators have `patient:read` from their role
 *   and that is what actually lets them check patients in today.
 *
 *   With this fallback:
 *     1. BYPASS_ROLES (admin / superadmin) always pass.
 *     2. An explicit `staff_module_access` row wins — including an
 *        `access_level='none'` row that DENIES access even when
 *        the role would normally allow it. That's the override
 *        feature the clinic admin matrix ships.
 *     3. No row → we look up the required permission from this
 *        map and check `req.user.permissions.includes(perm)`.
 *        The route is allowed if ANY of the listed permissions
 *        match (read path needs one "read" permission; write
 *        path needs one "write" permission).
 *     4. No entry in this map → fall-through allow, so unmapped
 *        modules keep the pre-retrofit behaviour.
 *
 * Naming convention:
 *
 *   Every module key is the exact string the `staff_module_access`
 *   table stores (legacy snake_case or new kebab-case). Keep this
 *   map in sync with MODULE_KEYS in `moduleKeys.ts` — the test
 *   suite asserts every key in ALL_MODULE_KEYS either has an
 *   entry here or is explicitly listed as "no fallback" in the
 *   UNMAPPED_MODULES set below.
 */

export interface ModulePermissionPair {
  /** Permissions any of which grant read access. */
  read: string[];
  /** Permissions any of which grant write access. */
  write: string[];
}

export const MODULE_TO_PERMISSION: Record<string, ModulePermissionPair> = {
  // ── Core clinical (RBAC-gated today) ──────────────────────────────
  patients: {
    read: ['patient:read'],
    write: ['patient:create', 'patient:update', 'patient:delete'],
  },
  episodes: {
    read: ['episode:read'],
    write: ['episode:create', 'episode:update'],
  },
  medications: {
    read: ['medication:read'],
    write: ['medication:create', 'medication:update'],
  },
  prescriptions: {
    read: ['prescription:read'],
    write: ['prescription:create'],
  },
  clinical_notes: {
    read: ['note:read'],
    write: ['note:create', 'note:update', 'note:delete'],
  },
  appointments: {
    read: ['appointment:read'],
    write: ['appointment:create', 'appointment:update', 'appointment:delete'],
  },
  pathology: {
    read: ['pathology:read'],
    write: ['pathology:create'],
  },
  tasks: {
    read: ['task:read'],
    write: ['task:create', 'task:update', 'task:delete'],
  },
  messages: {
    read: ['message:read'],
    write: ['message:create'],
  },
  legal_orders: {
    read: ['mhact:read'],
    write: ['mhact:create', 'mhact:update'],
  },
  referrals: {
    read: ['referral:read'],
    write: ['referral:create', 'referral:update', 'referral:triage', 'referral:assign'],
  },
  billing: {
    read: ['billing:read'],
    write: ['billing:create', 'billing:update'],
  },
  reports: {
    // Reports is read-only to end users; writes = "generate a
    // report" which needs no extra permission today.
    read: ['report:read'],
    write: ['report:read'],
  },
  settings: {
    read: ['settings:read'],
    write: ['settings:update'],
  },

  // ── Mental Health clinical surfaces (share note + medication RBAC) ──
  // No dedicated RBAC permission — inherit from the closest family
  // so receptionists / managers / etc. with role-based permissions
  // pass the fallback. Admins can still override per-staff via an
  // explicit staff_module_access row.
  lai: {
    read: ['medication:read', 'note:read'],
    write: ['medication:create', 'medication:update'],
  },
  clozapine: {
    read: ['medication:read', 'note:read'],
    write: ['medication:create', 'medication:update'],
  },
  risk_assessments: {
    read: ['note:read'],
    write: ['note:create', 'note:update'],
  },
  safety_plans: {
    read: ['note:read'],
    write: ['note:create', 'note:update'],
  },
  nursing_assessments: {
    read: ['note:read'],
    write: ['note:create', 'note:update'],
  },
  advance_directives: {
    read: ['note:read'],
    write: ['note:create', 'note:update'],
  },
  outcomes: {
    read: ['note:read'],
    write: ['note:create', 'note:update'],
  },
  ect: {
    read: ['note:read'],
    write: ['note:create', 'note:update'],
  },
  tms: {
    read: ['note:read'],
    write: ['note:create', 'note:update'],
  },
  group_therapy: {
    read: ['note:read'],
    write: ['note:create', 'note:update'],
  },
  pathways: {
    read: ['note:read'],
    write: ['note:create', 'note:update'],
  },

  // ── Workflow / ops ────────────────────────────────────────────────
  correspondence: {
    read: ['note:read'],
    write: ['note:create', 'note:update'],
  },
  escalations: {
    read: ['task:read', 'note:read'],
    write: ['task:create', 'task:update'],
  },
  carers: {
    read: ['patient:read'],
    write: ['patient:update'],
  },
  beds: {
    read: ['patient:read'],
    write: ['patient:update'],
  },
  templates: {
    read: ['settings:read', 'note:read'],
    write: ['settings:update'],
  },
  audit: {
    // Audit log is inherently admin-tier — no RBAC permission
    // covers it, so fall-back denies non-admins. Admins bypass.
    read: [],
    write: [],
  },
  voice: {
    read: ['note:read'],
    write: ['note:create', 'note:update'],
  },

  // ── New kebab-case modules ────────────────────────────────────────
  // Oncology (Phase 8): share the clinical-note + medication RBAC
  // families so existing clinicians pass the fallback. A clinic admin
  // can still explicitly revoke oncology per-staff via the matrix.
  oncology: {
    read: ['note:read', 'medication:read'],
    write: ['note:create', 'note:update', 'medication:create', 'medication:update'],
  },
  // Telehealth: tied to the appointment RBAC family — any staff with
  // appointment:read can join a video call, any staff with
  // appointment:create can generate a room.
  telehealth: {
    read: ['appointment:read'],
    write: ['appointment:create', 'appointment:update'],
  },
  // BI / compliance dashboard: read is governance-facing (manager +
  // admin by role mapping), no write semantics because the dashboard
  // is read-only.
  'reports-bi': {
    read: ['report:read'],
    write: ['report:read'],
  },
  // Phase 13 — per-clinician calendar. Read maps to appointment:read
  // so anyone who can see the appointment book can read availability;
  // write maps to appointment:update because editing one's own
  // availability is in the same power-class as editing appointments.
  calendar: {
    read: ['appointment:read'],
    write: ['appointment:update'],
  },
  // Agentic AI Scribe (next-gen in-visit drafting). Read access follows
  // note/task visibility; write access follows task + appointment + referral
  // creation power-classes.
  'agentic-ai-scribe': {
    read: ['note:read', 'task:read'],
    write: ['task:create', 'appointment:create', 'referral:create'],
  },
};

/**
 * Resolve the permission requirement for a (module, level) pair.
 * Returns `null` when the module is unmapped (→ fall-through allow)
 * and an empty array when the module is explicitly admin-tier
 * (→ non-admin always denied).
 */
export function requiredPermissionsFor(
  module: string,
  level: 'read' | 'write',
): string[] | null {
  const entry = MODULE_TO_PERMISSION[module];
  if (!entry) return null;
  return entry[level];
}
