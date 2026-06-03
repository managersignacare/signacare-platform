import { createHash } from 'crypto';
import type { AuthContext } from '@signacare/shared';
import { HttpError } from '../../shared/errors';
import { isFeatureEnabled } from '../../shared/featureFlags';
import { logger } from '../../utils/logger';

export const PASSWORD_BREACH_FLAG = 'auth-password-breach-check-p4';

const HIBP_RANGE_BASE_URL_DEFAULT = 'https://api.pwnedpasswords.com';
const HIBP_TIMEOUT_MS_DEFAULT = 2500;
const HIBP_PREFIX_CACHE_TTL_MS_DEFAULT = 10 * 60_000;
const HIBP_BREACH_MIN_COUNT_DEFAULT = 1;

interface PrefixCacheEntry {
  suffixCounts: Map<string, number>;
  expiresAtMs: number;
}

const prefixCache = new Map<string, PrefixCacheEntry>();
const prefixInFlight = new Map<string, Promise<Map<string, number>>>();

type BreachSource = 'disabled' | 'hibp' | 'cache' | 'error';

export interface PasswordBreachAssessment {
  enabled: boolean;
  breached: boolean;
  breachCount: number;
  source: BreachSource;
}

interface PasswordBreachContext {
  surface: string;
}

function resolvePositiveInt(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function resolveHibpBaseUrl(): string {
  const raw = process.env.HIBP_PASSWORDS_API_BASE_URL?.trim();
  if (!raw) return HIBP_RANGE_BASE_URL_DEFAULT;
  return raw.replace(/\/+$/, '');
}

function resolveHibpTimeoutMs(): number {
  return resolvePositiveInt(
    process.env.HIBP_PASSWORDS_TIMEOUT_MS,
    HIBP_TIMEOUT_MS_DEFAULT,
    100,
    15_000,
  );
}

function resolveHibpCacheTtlMs(): number {
  const ttlSeconds = resolvePositiveInt(
    process.env.HIBP_PASSWORDS_CACHE_TTL_SECONDS,
    HIBP_PREFIX_CACHE_TTL_MS_DEFAULT / 1000,
    10,
    3600,
  );
  return ttlSeconds * 1000;
}

function resolveBreachThreshold(): number {
  return resolvePositiveInt(
    process.env.HIBP_BREACH_MIN_COUNT,
    HIBP_BREACH_MIN_COUNT_DEFAULT,
    1,
    1_000_000,
  );
}

function sha1Upper(input: string): string {
  return createHash('sha1').update(input, 'utf8').digest('hex').toUpperCase();
}

function parseRangeResponse(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [suffixRaw, countRaw] = trimmed.split(':');
    if (!suffixRaw || !countRaw) continue;
    const count = Number.parseInt(countRaw.trim(), 10);
    if (!Number.isFinite(count) || count < 0) continue;
    counts.set(suffixRaw.trim().toUpperCase(), count);
  }
  return counts;
}

async function fetchPrefixCounts(prefix: string): Promise<Map<string, number>> {
  const timeoutMs = resolveHibpTimeoutMs();
  const url = `${resolveHibpBaseUrl()}/range/${prefix}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Add-Padding': 'true',
      // HIBP recommends User-Agent for operator traceability.
      'User-Agent': 'Signacare-BUG-P4-password-breach-check',
    },
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    throw new Error(`HIBP_RANGE_NON_200:${response.status}`);
  }
  const text = await response.text();
  return parseRangeResponse(text);
}

async function resolvePrefixCounts(prefix: string): Promise<{ counts: Map<string, number>; source: 'hibp' | 'cache' }> {
  const now = Date.now();
  const cached = prefixCache.get(prefix);
  if (cached && cached.expiresAtMs > now) {
    return { counts: cached.suffixCounts, source: 'cache' };
  }

  const existingInFlight = prefixInFlight.get(prefix);
  if (existingInFlight) {
    const counts = await existingInFlight;
    return { counts, source: 'hibp' };
  }

  const load = fetchPrefixCounts(prefix)
    .then((counts) => {
      prefixCache.set(prefix, {
        suffixCounts: counts,
        expiresAtMs: Date.now() + resolveHibpCacheTtlMs(),
      });
      return counts;
    })
    .finally(() => {
      prefixInFlight.delete(prefix);
    });

  prefixInFlight.set(prefix, load);
  const counts = await load;
  return { counts, source: 'hibp' };
}

export async function assessPasswordBreach(
  auth: AuthContext,
  password: string,
  context: PasswordBreachContext,
): Promise<PasswordBreachAssessment> {
  if (!password) {
    return { enabled: false, breached: false, breachCount: 0, source: 'disabled' };
  }

  const enabled = await isFeatureEnabled(
    PASSWORD_BREACH_FLAG,
    auth.clinicId,
    { staffId: auth.staffId },
  );
  if (!enabled) {
    return { enabled: false, breached: false, breachCount: 0, source: 'disabled' };
  }

  const digest = sha1Upper(password);
  const prefix = digest.slice(0, 5);
  const suffix = digest.slice(5);

  try {
    const { counts, source } = await resolvePrefixCounts(prefix);
    const breachCount = counts.get(suffix) ?? 0;
    const breached = breachCount >= resolveBreachThreshold();
    return { enabled: true, breached, breachCount, source };
  } catch (err) {
    logger.warn(
      {
        err,
        clinicId: auth.clinicId,
        staffId: auth.staffId,
        surface: context.surface,
        kind: 'hibp_password_range_lookup_failed',
        failMode: 'fail_open',
      },
      'BUG-P4: password breach lookup degraded; continuing with fail-open policy',
    );
    return { enabled: true, breached: false, breachCount: 0, source: 'error' };
  }
}

export async function assertPasswordNotBreached(
  auth: AuthContext,
  password: string,
  context: PasswordBreachContext,
): Promise<void> {
  const assessment = await assessPasswordBreach(auth, password, context);
  if (!assessment.enabled) return;
  if (!assessment.breached) return;
  throw new HttpError(
    400,
    'PASSWORD_BREACHED',
    'Password has appeared in a known breach corpus. Choose a different password.',
    { breachCount: assessment.breachCount },
  );
}

export async function generateNonBreachedPassword(
  auth: AuthContext,
  generateCandidate: () => string,
  context: PasswordBreachContext,
  maxAttempts = 5,
): Promise<string> {
  for (let i = 0; i < maxAttempts; i++) {
    const candidate = generateCandidate();
    const assessment = await assessPasswordBreach(auth, candidate, context);
    // Fail-open: if service is disabled or degraded, keep the generated secret.
    if (!assessment.enabled || assessment.source === 'error') {
      return candidate;
    }
    if (!assessment.breached) {
      return candidate;
    }
  }

  throw new HttpError(
    500,
    'INTERNAL_ERROR',
    'Unable to generate a non-breached temporary password after bounded retries.',
  );
}

export function __testResetPasswordBreachCache(): void {
  prefixCache.clear();
  prefixInFlight.clear();
}
