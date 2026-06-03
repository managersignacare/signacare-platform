/**
 * Static enumeration of all React-router routes for automated probing.
 *
 * Keep this in sync with apps/web/src/router.tsx. The probes iterate
 * this list to exercise every visible surface as each seeded role.
 *
 * Static routes (no :params) are probed with the path as-is. Dynamic
 * routes use a `sampleParams` object — the route-crawler substitutes
 * them in before navigation. Routes without sampleParams are probed
 * in their raw form against the SPA router (which renders a generic
 * detail page that may show a loading state indefinitely if the id
 * doesn't resolve — that's acceptable for the route-exists assertion).
 *
 * Tags:
 *   - 'public' — reachable without login (login, mfa, change-password)
 *   - 'clinical' — routes that require a patient/episode/etc. context
 *     seeded (may 404 or show empty-state with thin seed)
 *   - 'admin' — admin+superadmin only
 *   - 'superadmin' — superadmin only
 */

export interface Route {
  path: string;
  sampleParams?: Record<string, string>;
  tags: ('public' | 'clinical' | 'admin' | 'superadmin' | 'core')[];
}

export const ROUTES: Route[] = [
  // Public (no auth)
  { path: '/login', tags: ['public'] },
  { path: '/mfa', tags: ['public'] },
  { path: '/change-password', tags: ['public'] },

  // Core — always reachable
  { path: '/dashboard', tags: ['core'] },
  { path: '/patients', tags: ['core'] },
  { path: '/appointments', tags: ['core'] },
  { path: '/calendar', tags: ['core'] },
  { path: '/tasks', tags: ['core'] },
  { path: '/messages', tags: ['core'] },
  { path: '/correspondence', tags: ['core'] },
  { path: '/drafts', tags: ['core'] },
  { path: '/exports', tags: ['core'] },
  { path: '/subscription', tags: ['core'] },

  // Clinical — require seeded clinical data
  { path: '/clinical-notes', tags: ['clinical'] },
  { path: '/clinical-review', tags: ['clinical'] },
  { path: '/escalations', tags: ['clinical'] },
  { path: '/risk', tags: ['clinical'] },
  { path: '/medications', tags: ['clinical'] },
  { path: '/lai', tags: ['clinical'] },
  { path: '/clozapine', tags: ['clinical'] },
  { path: '/pathology', tags: ['clinical'] },
  { path: '/billing', tags: ['clinical'] },
  { path: '/referrals', tags: ['clinical'] },
  { path: '/referrals/queue', tags: ['clinical'] },
  { path: '/referrals/my-offers', tags: ['clinical'] },
  { path: '/pathways', tags: ['clinical'] },
  { path: '/handover', tags: ['clinical'] },
  { path: '/group-therapy', tags: ['clinical'] },
  { path: '/bed-board', tags: ['clinical'] },
  { path: '/list/lai', tags: ['clinical'] },
  { path: '/list/mha', tags: ['clinical'] },
  { path: '/list/clozapine', tags: ['clinical'] },
  { path: '/list/referrals', tags: ['clinical'] },
  { path: '/list/acis', tags: ['clinical'] },
  { path: '/list/parc', tags: ['clinical'] },
  { path: '/list/ccu', tags: ['clinical'] },
  { path: '/list/ipu', tags: ['clinical'] },
  { path: '/list/op', tags: ['clinical'] },
  { path: '/list/group', tags: ['clinical'] },
  { path: '/list/cloz-support', tags: ['clinical'] },
  { path: '/list/91day', tags: ['clinical'] },
  { path: '/list/hotspots', tags: ['clinical'] },
  { path: '/list/admission-waitlist', tags: ['clinical'] },
  { path: '/receptionist', tags: ['clinical'] },
  { path: '/nursing', tags: ['clinical'] },
  { path: '/case-management', tags: ['clinical'] },
  { path: '/community-resources', tags: ['clinical'] },
  { path: '/psychiatrist', tags: ['clinical'] },

  // Admin
  { path: '/settings', tags: ['admin'] },
  { path: '/power-settings', tags: ['admin'] },
  { path: '/org-settings', tags: ['admin'] },
  { path: '/staff-assignments', tags: ['admin'] },
  { path: '/audit', tags: ['admin'] },
  { path: '/reports', tags: ['admin'] },
  { path: '/reports/compliance', tags: ['admin'] },
  { path: '/templates', tags: ['admin'] },
  { path: '/manager-dashboard', tags: ['admin'] },
  { path: '/voice', tags: ['admin'] },
  { path: '/ai-agent', tags: ['admin'] },

  // Mobile scribe
  { path: '/m/scribe', tags: ['clinical'] },
];

/** Routes that should render SOMETHING (200 + content) as any logged-in user. */
export const SMOKE_ROUTES = ROUTES.filter((r) => r.tags.includes('core'));

/** Routes that require admin/superadmin. Use admin + superadmin roles for these. */
export const ADMIN_ROUTES = ROUTES.filter((r) => r.tags.includes('admin'));

/** Clinical routes that may show empty-state with thin seed — acceptable. */
export const CLINICAL_ROUTES = ROUTES.filter((r) => r.tags.includes('clinical'));
