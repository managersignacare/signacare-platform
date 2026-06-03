/**
 * apps/api/src/features/webhooks/webhookVerifier.ts
 *
 * S3.4 — Pure functions used by the inbound webhook receiver.
 *
 * Pulled out of the route handler so they can be unit-tested without
 * mocking Knex, Redis, or Express. The receiver in webhookRoutes.ts
 * orchestrates the DB lookups and the audit log writes; this module
 * is the cryptographic and validation core.
 *
 * Naming compliance: function exports camelCase, no DB types in this
 * module, no I/O.
 */

import { createHash, createHmac, timingSafeEqual } from 'crypto';

export function sha256Hex(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}

/** Constant-time string equality. */
export function safeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

/**
 * Compute the expected HMAC-SHA256 signature for a payload + secret.
 * Returns the lowercase hex string. Most partners (Stripe-style)
 * present this prefixed with `sha256=`; the comparison helper below
 * accepts either form.
 */
export function computeSignature(rawBody: Buffer, secret: string): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}

/**
 * Verify a presented signature against the expected one. Accepts:
 *   "sha256=<hex>"
 *   "<hex>"
 * with case-insensitive matching of the hex digits. Constant-time.
 */
export function verifySignature(presented: string | undefined, expected: string): boolean {
  if (!presented || !expected) return false;
  const stripped = presented.toLowerCase().startsWith('sha256=')
    ? presented.slice('sha256='.length)
    : presented;
  return safeEquals(stripped.toLowerCase(), expected.toLowerCase());
}

export interface ParsedTimestamp {
  ok: boolean;
  /** Parsed unix-second timestamp, if `ok`. */
  ts?: number;
  /** Why parsing failed. */
  reason?: 'missing' | 'malformed' | 'out_of_window';
}

/**
 * Parse a timestamp header and check it falls within the replay
 * window relative to `now`. Accepts:
 *   - Unix seconds (10 digits)
 *   - Unix milliseconds (13 digits)
 *   - ISO 8601 strings (with Z or offset)
 *
 * If `headerValue` is null/undefined, returns ok:true with ts=now —
 * the caller can decide whether the absence of a timestamp header is
 * tolerable for that source.
 */
export function parseAndCheckTimestamp(
  headerValue: string | undefined,
  windowSeconds: number,
  now: number = Date.now(),
): ParsedTimestamp {
  if (!headerValue) {
    return { ok: true, ts: Math.floor(now / 1000) };
  }

  let ts: number | null = null;

  // 13-digit ms? 10-digit s? ISO?
  if (/^\d{13}$/.test(headerValue)) {
    ts = Math.floor(parseInt(headerValue, 10) / 1000);
  } else if (/^\d{10}$/.test(headerValue)) {
    ts = parseInt(headerValue, 10);
  } else {
    const parsed = Date.parse(headerValue);
    if (!Number.isNaN(parsed)) {
      ts = Math.floor(parsed / 1000);
    }
  }

  if (ts === null) {
    return { ok: false, reason: 'malformed' };
  }

  const nowSeconds = Math.floor(now / 1000);
  if (Math.abs(nowSeconds - ts) > windowSeconds) {
    return { ok: false, reason: 'out_of_window' };
  }
  return { ok: true, ts };
}

/**
 * Parse a comma-separated CIDR allow-list (IPv4 only for now) and
 * test whether the given IP is in any of the ranges. An empty or
 * undefined allow-list returns true (no restriction).
 *
 * Reused from the IP allowlist middleware logic but inlined here so
 * the webhook module is self-contained.
 */
function ipv4ToLong(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const num = parseInt(p, 10);
    if (Number.isNaN(num) || num < 0 || num > 255) return null;
    n = (n << 8) + num;
  }
  return n >>> 0;
}

export function ipInAllowlist(ip: string | undefined, allowlist: string | null | undefined): boolean {
  if (!allowlist || allowlist.trim() === '') return true; // no restriction
  if (!ip) return false;
  const normalised = ip.replace(/^::ffff:/, '');
  const ipLong = ipv4ToLong(normalised);
  if (ipLong === null) return false;
  for (const raw of allowlist.split(',').map((s) => s.trim()).filter(Boolean)) {
    const [network, bitsStr] = raw.split('/');
    const netLong = ipv4ToLong(network);
    if (netLong === null) continue;
    if (!bitsStr) {
      if (ipLong === netLong) return true;
      continue;
    }
    const bits = parseInt(bitsStr, 10);
    if (Number.isNaN(bits) || bits < 0 || bits > 32) continue;
    const mask = bits === 0 ? 0 : (~((1 << (32 - bits)) - 1)) >>> 0;
    if ((ipLong & mask) === (netLong & mask)) return true;
  }
  return false;
}
