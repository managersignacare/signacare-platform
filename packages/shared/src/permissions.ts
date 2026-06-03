// packages/shared/src/permissions.ts
//
// Phase 0.5.B — FE/BE-parity role classification helpers for the
// three-layer access model (PART 12 of the master plan).
//
// Three functions. All synchronous. Pure role-string inputs.
//
//   hasClinicalAccess(role) — false only for operational-only roles
//     (receptionist / readonly). Used by the frontend Sidebar to hide
//     Clinical Lists. The backend authoritative gate is
//     requireClinicalAccessRole(auth) in authGuards.ts; this helper
//     mirrors the decision for the UI layer.
//
//   isOperationalOnly(role) — the inverse of hasClinicalAccess, kept
//     as a positive-check helper for readability at call sites.
//
//   isCrossClinicOperator(role) — true only for 'superadmin'. Used
//     by the Sidebar to hide CLINICAL surfaces for superadmin (they
//     manage settings cross-clinic but CANNOT view clinical data per
//     PART 12 clarification #1). Note: cross-clinic operators are
//     neither "clinical" nor "operational" — they're in a third
//     bucket that sees settings, not patient data.
//
// Why shared (not per-workspace): the backend enforces via DB-backed
// guards in authGuards.ts (nominated/delegated membership, team
// hierarchy cascade, episode, appointment). The frontend can't
// replicate those DB checks without a server round-trip. But it CAN
// apply the same role-level exclusions — receptionist never sees
// clinical surfaces, superadmin never sees patient data. Those two
// rules are role-level and cheap; mirroring them client-side avoids
// flashing surfaces that the backend will 403.

// L5-absorb-1: exported so backend authConstants.ts can import from
// here instead of duplicating. SSoT → packages/shared/permissions.ts
// is the single authoritative list; backend re-exports. Same pattern
// as BUG-280's authConstants.ts extraction.
export const OPERATIONAL_ONLY: ReadonlySet<string> = new Set(['receptionist', 'readonly']);
export const CROSS_CLINIC_OPERATORS: ReadonlySet<string> = new Set(['superadmin']);

export function isOperationalOnly(role: string | null | undefined): boolean {
  return role !== null && role !== undefined && OPERATIONAL_ONLY.has(role);
}

export function isCrossClinicOperator(role: string | null | undefined): boolean {
  return role !== null && role !== undefined && CROSS_CLINIC_OPERATORS.has(role);
}

/**
 * True when the caller may see ANY clinical data (patients, notes,
 * meds, appointments etc.). False for operational-only roles AND for
 * cross-clinic operators (superadmin manages settings, not clinical).
 *
 * Backend authority-of-record: requireClinicalAccessRole(auth) in
 * apps/api/src/shared/authGuards.ts. That guard additionally runs
 * requirePatientRelationship for the per-patient relationship check.
 */
export function hasClinicalAccess(role: string | null | undefined): boolean {
  if (role === null || role === undefined) return false;
  if (OPERATIONAL_ONLY.has(role)) return false;
  if (CROSS_CLINIC_OPERATORS.has(role)) return false;
  return true;
}
