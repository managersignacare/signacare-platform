// apps/web/src/shared/hooks/useModuleVisibility.ts
//
// Multi-specialty Phase 2 — frontend module visibility hook.
//
// Reads the caller's specialty enrolment and the clinic's enabled
// specialties from GET /staff/me, optionally joins the patient's
// active specialties from GET /patients/:id/active-specialties, and
// runs `computeVisibleSpecialties` from the shared package to produce
// the canonical visible-specialty set for the current context.
//
// The hook exposes two thin predicates — `isTabVisible(tabId)` and
// `isNavVisible(path)` — that delegate to the pure shared helpers so
// there is exactly one rule per module identity across frontend and
// backend.
//
// Design notes:
//
//   - React Query handles caching + deduplication. staff/me uses the
//     shared 'staff-profile' key already baked into the rest of the
//     app; patient active-specialties uses its own key so a patient
//     switch invalidates correctly.
//   - Empty/undefined patientId = non-patient context (e.g. sidebar,
//     dashboard). In that case the hook never requests
//     /patients/:id/active-specialties.
//   - If either fetch fails, the hook fails CLOSED on the security
//     surface (specialty-gated clinical modules hide) while keeping
//     the non-gated UI visible (core modules + alwaysOn + unlisted
//     paths). Mirrors BUG-444 fail-CLOSED license-middleware shape.
//     See `failClosed()` below for the canonical state shape.
//     Pre-fix BUG-416 returned `() => true` predicates here, exposing
//     specialty-gated surfaces (ECT/TMS/MHA/legal/oncology/etc) to
//     non-entitled clinicians on transient network blips.
//
// Usage:
//
//   const { isTabVisible, isNavVisible, visibleSpecialties, isLoading }
//     = useModuleVisibility({ patientId });

import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import {
  computeVisibleSpecialties,
  isPatientTabVisible,
  isNavItemVisible,
  type SpecialtyType,
} from '@signacare/shared';
import { apiClient } from '../services/apiClient';
import { sharedModuleVisibilityKeys } from '../queryKeys';
import { useAuthStore } from '../store/authStore';

interface StaffMeResponse {
  id: string;
  specialties?: Array<{ code: SpecialtyType; display: string; isPrimary?: boolean }>;
  enabledSpecialties?: Array<{ code: SpecialtyType; display: string }>;
}

interface ActiveSpecialtiesResponse {
  specialties: Array<{ code: SpecialtyType; display: string }>;
}

export interface UseModuleVisibilityResult {
  /** The final intersection set the caller should use for predicates. */
  visibleSpecialties: Set<SpecialtyType>;
  /** True while either upstream fetch is in flight. */
  isLoading: boolean;
  /**
   * True if any upstream fetch errored — predicates fail CLOSED for
   * specialty-gated modules; core + alwaysOn + unlisted UI remain
   * visible. Call sites SHOULD render an error banner so the user
   * knows specialty surfaces may be temporarily hidden (BUG-416).
   */
  isError: boolean;
  /** Show-this-tab predicate. Unlisted tabs are always visible. */
  isTabVisible: (tabId: string) => boolean;
  /** Show-this-nav-path predicate. Unlisted paths are always visible. */
  isNavVisible: (path: string) => boolean;
}

/**
 * Fail-CLOSED visibility (BUG-416 — mirrors backend BUG-444 license-
 * middleware shape). On upstream-fetch error the hook returns this
 * canonical state: empty `visibleSpecialties` set + predicates that
 * delegate to the shared `isPatientTabVisible` / `isNavItemVisible`
 * helpers. Per `packages/shared/src/moduleRegistry.ts:419-448`, those
 * helpers honour an empty visibleSpecialties set as "core + alwaysOn
 * + unlisted modules visible, specialty-gated modules hidden" — which
 * IS the desired fail state: fail-CLOSED for the security surface
 * (no exposing specialty-gated clinical modules to non-entitled
 * clinicians) + fail-OPEN for the non-gated UI (safety-critical core
 * tabs like medications/pathology/allergies stay visible through
 * transient network blips).
 *
 * EXPORTED so the hook test suite can pin the contract directly
 * (apps/web vitest runs without jsdom — the success path is covered
 * by integration tests under BUG-451's scope; the fail-CLOSED branch
 * is covered by direct invocation here).
 *
 * No dev-mode hatch: the frontend equivalent of BUG-444's
 * DEV_FALLBACK_STATUS would require `import.meta.env.DEV` checks
 * which a misconfigured build pipeline could leak to prod, re-
 * licensing the BUG-416 regression. Frontend has no analogue of the
 * "license module not checked into installer/" ergonomic gap that
 * justified the backend hatch.
 */
export function failClosed(): UseModuleVisibilityResult {
  const empty: Set<SpecialtyType> = new Set();
  return {
    visibleSpecialties: empty,
    isLoading: false,
    isError: true,
    isTabVisible: (tabId: string) => isPatientTabVisible(tabId, empty),
    isNavVisible: (path: string) => isNavItemVisible(path, empty),
  };
}

export function useModuleVisibility(opts?: { patientId?: string | null }): UseModuleVisibilityResult {
  const patientId = opts?.patientId ?? null;
  const userRole = useAuthStore((s) => s.user?.role);

  const staffMeQuery = useQuery<StaffMeResponse>({
    queryKey: sharedModuleVisibilityKeys.myProfile(),
    queryFn: () => apiClient.get<StaffMeResponse>('staff/me'),
    staleTime: 60_000,
  });

  const activeSpecialtiesQuery = useQuery<ActiveSpecialtiesResponse>({
    queryKey: sharedModuleVisibilityKeys.patientActiveSpecialties(patientId ?? ''),
    queryFn: () => apiClient.get<ActiveSpecialtiesResponse>(`patients/${patientId}/active-specialties`),
    enabled: !!patientId,
    staleTime: 30_000,
  });

  const visibleSpecialties = useMemo<Set<SpecialtyType>>(() => {
    const enabled = (staffMeQuery.data?.enabledSpecialties ?? []).map((s) => s.code);
    const staff = (staffMeQuery.data?.specialties ?? []).map((s) => s.code);
    const patientActive = patientId
      ? (activeSpecialtiesQuery.data?.specialties ?? []).map((s) => s.code)
      : undefined;
    // userRole threaded through so admin / superadmin bypass the
    // staff-specialty intersection and see every enabled specialty
    // at the clinic. Without the bypass, toggling a specialty in
    // Power Settings has no visible effect for an admin whose
    // staff_specialties row is only mental_health (the admin is
    // not a practicing specialist so the intersection always
    // collapses to {mental_health} regardless of the toggle).
    return computeVisibleSpecialties({
      enabledSpecialties: enabled,
      staffSpecialties: staff,
      patientActiveSpecialties: patientActive,
      userRole,
    });
  }, [
    staffMeQuery.data?.enabledSpecialties,
    staffMeQuery.data?.specialties,
    activeSpecialtiesQuery.data?.specialties,
    patientId,
    userRole,
  ]);

  const isLoading =
    staffMeQuery.isLoading || (!!patientId && activeSpecialtiesQuery.isLoading);
  const isError =
    staffMeQuery.isError || (!!patientId && activeSpecialtiesQuery.isError);

  // Fail-CLOSED on upstream error (BUG-416 — frontend mirror of
  // BUG-444 licenseMiddleware fail-CLOSED shape). A security gate
  // must NOT synthesise a permissive output on its error branch.
  // The shared helpers (isPatientTabVisible / isNavItemVisible) treat
  // an empty visible-specialties set as "core + alwaysOn + unlisted
  // modules visible, specialty-gated modules hidden" — which IS the
  // desired fail state: fail-CLOSED for clinical access control,
  // fail-OPEN for non-gated UI so safety-critical core tabs
  // (medications / pathology / allergies / problems) remain visible
  // through transient network blips. Pre-fix this hook returned
  // `() => true` for every tab and nav item on isError, exposing
  // specialty-gated clinical surfaces (ECT / TMS / MHA / legal /
  // advance-directives / oncology / surgery / paeds / O&G /
  // endocrinology / GIM-chronic-disease) to clinicians without the
  // entitlement.
  if (isError) return failClosed();

  return {
    visibleSpecialties,
    isLoading,
    isError: false,
    isTabVisible: (tabId: string) => isPatientTabVisible(tabId, visibleSpecialties),
    isNavVisible: (path: string) => isNavItemVisible(path, visibleSpecialties),
  };
}
