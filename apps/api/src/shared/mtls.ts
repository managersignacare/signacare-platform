// apps/api/src/shared/mtls.ts
//
// BUG-332 — shared NASH / mTLS https.Agent factory.
//
// Prior state: two structurally-identical mTLS agent constructors lived
// in npdsClient.ts (ADHA NPDS cert) and hiServiceClient.ts (NASH cert).
// Both did the same four steps: read optionalEnv(certPath), stat the
// file, requireEnv(passphrase) + log at ERROR in production when the
// cert is absent, construct https.Agent({pfx, passphrase,
// rejectUnauthorized:true, keepAlive:true}), cache module-scope.
//
// BUG-297 L5 review correctly deferred extraction until N=3 so the
// helper's shape wouldn't be over-fitted to two near-identical callers.
// BUG-298 (MHR FHIR document push) is the third mTLS caller; this
// commit extracts the helper BEFORE BUG-298 lands so BUG-298 consumes
// a shipped + reviewed helper rather than a half-drafted co-commit.
//
// Each caller passes its own env keys (`certPathEnv`, `passphraseEnv`)
// and `integrationName` (used in structured log messages AND as the
// cache key — so a test that swaps one integration's cert doesn't
// invalidate another). Keeping integrationName as the cache key avoids
// collision with future mTLS integrations that happen to point at the
// same passphrase.
//
// Production-safety invariant: if a caller passes `isConfigured=true`
// (caller has checked its configured-opt-in flag is set) and the cert
// file is missing, this helper logs at ERROR. BUG-043's boot-time
// assertion should already have blocked boot in production; the ERROR
// log is a last-mile surface for the "somehow started anyway" scenario.

import https from 'https';
import fs from 'fs';
import { logger } from '../utils/logger';
import { requireEnv, optionalEnv } from './requireEnv';

export interface CreateMtlsAgentOptions {
  /** Env-var name that holds the path to the PFX / .p12 file. */
  certPathEnv: string;
  /** Env-var name that holds the passphrase. Must be set when the cert is. */
  passphraseEnv: string;
  /** Human-readable integration name for log breadcrumbs + cache key. */
  integrationName: string;
  /** Description threaded into the requireEnv remediation message. */
  passphraseDescription: string;
}

const agentCache = new Map<string, https.Agent>();

/**
 * Build (or return the cached) mTLS https.Agent for an integration.
 *
 * Returns `undefined` in stub mode: cert path env absent, OR cert path
 * set but the file doesn't exist on disk. Callers branch on that return
 * value (`if (!agent) return stubResponse`).
 *
 * Returns an https.Agent in configured mode, constructed with
 * `rejectUnauthorized:true + keepAlive:true`. Throws (via requireEnv)
 * only when the cert EXISTS but the passphrase env is missing — that's
 * a guaranteed-to-fail handshake if allowed through, so fail-fast.
 */
export function createMtlsAgent(opts: CreateMtlsAgentOptions): https.Agent | undefined {
  const cached = agentCache.get(opts.integrationName);
  if (cached) return cached;

  const certPath = optionalEnv(opts.certPathEnv);
  if (!certPath || !fs.existsSync(certPath)) {
    if (process.env.NODE_ENV === 'production') {
      logger.error(
        `[${opts.integrationName}] PRODUCTION WITHOUT MTLS CERT — stub mode active; ${opts.certPathEnv} is required`,
      );
    } else {
      logger.warn(
        `[${opts.integrationName}] No mTLS certificate configured — using stub mode`,
      );
    }
    return undefined;
  }

  const passphrase = requireEnv(opts.passphraseEnv, opts.passphraseDescription);

  const agent = new https.Agent({
    pfx: fs.readFileSync(certPath),
    passphrase,
    rejectUnauthorized: true,
    keepAlive: true,
  });

  agentCache.set(opts.integrationName, agent);
  return agent;
}

function destroyAgentCacheEntries(integrationName?: string): number {
  if (integrationName) {
    const existing = agentCache.get(integrationName);
    if (!existing) return 0;
    existing.destroy();
    agentCache.delete(integrationName);
    return 1;
  }

  let destroyed = 0;
  for (const agent of agentCache.values()) {
    agent.destroy();
    destroyed += 1;
  }
  agentCache.clear();
  return destroyed;
}

/**
 * Runtime shutdown hook entrypoint (BUG-333). Destroys all cached
 * keep-alive mTLS agents so open sockets do not linger past graceful
 * shutdown boundaries.
 */
export function drainMtlsAgentCacheForShutdown(): number {
  return destroyAgentCacheEntries();
}

/**
 * Test-only cache reset. Clears every cached agent; tests that swap a
 * cert between runs call this in `beforeEach` so the next
 * createMtlsAgent call re-reads from disk.
 */
export function resetMtlsAgentCacheForTests(integrationName?: string): void {
  destroyAgentCacheEntries(integrationName);
}

/** Test-only cache seed for deterministic shutdown-drain assertions. */
export function __seedMtlsAgentCacheForTests(integrationName: string, agent: https.Agent): void {
  agentCache.set(integrationName, agent);
}

/** Test-only cache size probe. */
export function __mtlsAgentCacheSizeForTests(): number {
  return agentCache.size;
}
