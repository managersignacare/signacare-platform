// apps/api/src/shared/requireEnv.ts
//
// Audit Tier 7.1 (CRIT-A1) ⚠ BREAKING — fail-fast env validation for
// the 5 integration modules that previously used
// `process.env.X ?? ''` and silently handed an empty string to the
// downstream request. Empty-string creds / URLs produced runtime 401s
// at the integration partner with no clear remediation.
//
// Design:
//   requireEnv('SMS_GATEWAY_URL', 'patient-outreach SMS dispatch')
//
// When the env var is unset (undefined / empty string), throws an
// AppError at FIRST USE — not at module load, so integrations whose
// clinics have explicitly disabled them via clinic_feature_flags don't
// block boot. The error message names the offending env var + the
// integration purpose + the remediation (set the env OR disable the
// integration's feature flag).
//
// Release-note BREAKING: clinics running v1.2.x with empty-string
// fallbacks silently silencing the integrations MUST either (a) set
// the env vars per deployment guide, OR (b) disable the relevant
// integration via clinic_feature_flags (Tier 5.1).

import { AppError } from './errors';

export function requireEnv(name: string, purpose: string): string {
  const v = process.env[name];
  if (v === undefined || v === '') {
    throw new AppError(
      `Missing required env var: ${name} (needed for ${purpose}). ` +
      `Either set the env var per the deployment guide, OR disable the ` +
      `${purpose} integration via clinic_feature_flags (CLAUDE.md §5.1).`,
      500,
      'ENV_MISSING',
    );
  }
  return v;
}

/**
 * Optional-env variant — returns undefined if unset, rather than
 * throwing. Use for env vars that genuinely have a sensible default
 * or are only needed for a sub-feature of the integration.
 */
export function optionalEnv(name: string): string | undefined {
  const v = process.env[name];
  return v === undefined || v === '' ? undefined : v;
}
