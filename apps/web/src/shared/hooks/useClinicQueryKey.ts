// apps/web/src/shared/hooks/useClinicQueryKey.ts
//
// Helper to build clinic-scoped React Query keys.
// Prevents cross-tenant cache collisions in multi-clinic deployments.
//
// Usage:
//   const key = useClinicQueryKey('beds', 'all');
//   // Returns ['beds', 'all', 'clinic:1642ee1d-...']

import { useAuthStore } from '../../store/authStore';

/**
 * Build a React Query key that includes the clinicId.
 * Safe to call in any component — returns stable array reference.
 */
export function useClinicQueryKey(...parts: (string | undefined)[]): (string | undefined)[] {
  const clinicId = useAuthStore((s) => s.user?.clinicId ?? '');
  return [...parts.filter(Boolean), `clinic:${clinicId}`];
}
