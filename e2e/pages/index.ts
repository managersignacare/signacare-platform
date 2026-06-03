/**
 * Category 3 — Page Object Model exports.
 *
 * Single import surface for workflow specs:
 *
 *   import { LoginPage, PatientListPage } from './pages';
 *
 * The four POMs in this directory cover the highest-leverage screens
 * (login + patient search + patient detail shell + episodes tab).
 * Other pages — Medications, Referrals, AuditLog — are still tested
 * via the inline-selector pattern in the original 01..10 specs and
 * can be promoted to POMs incrementally as those specs are touched.
 */

export { LoginPage } from './LoginPage';
export { PatientListPage } from './PatientListPage';
export { PatientDetailPage } from './PatientDetailPage';
export { EpisodePage } from './EpisodePage';
export type { CreateEpisodeOptions } from './EpisodePage';
