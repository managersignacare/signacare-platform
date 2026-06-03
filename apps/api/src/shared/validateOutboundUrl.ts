/**
 * SSRF outbound URL validator.
 *
 * Any API surface that accepts a URL from user input (webhook
 * subscribers, OAuth redirect URIs, referral attachment callbacks,
 * patient-app deep links, external FHIR consumer registrations)
 * MUST filter the URL through this helper before making a request
 * or storing it. Without this, an attacker can point the URL at:
 *
 *   - The cloud metadata service (169.254.169.254) → credential theft
 *   - Internal IPs (10/8, 172.16/12, 192.168/16) → lateral movement
 *   - localhost (127.0.0.1 / ::1) → probe the API's own internals
 *   - link-local (169.254.0.0/16) → metadata or local-only services
 *   - private IPv6 (fc00::/7, fe80::/10) → same
 *   - non-http(s) schemes (file://, gopher://, dict://) → smuggle
 *     payloads or read local files
 *
 * Standard satisfied: OWASP A10 (SSRF), ACHS Standard 1 (defence in
 *                     depth), IEC 62304 §5.1.1 (software safety).
 *
 * The helper is intentionally defensive-first: if the input doesn't
 * parse as a URL, or doesn't resolve to a hostname, or falls into
 * any blocked range, it throws AppError(422, 'INVALID_URL').
 *
 * Usage:
 *   import { validateOutboundUrl } from '../../shared/validateOutboundUrl';
 *   await validateOutboundUrl(req.body.webhookUrl);
 *
 * Caveat: this helper validates the HOSTNAME string against private
 * ranges. For full protection against DNS rebinding, the resolved
 * IP must also be checked at the moment of the outbound fetch
 * (happy-eyeballs can shift the resolved IP between validation and
 * request). The outbound HTTP client should therefore ALSO reject
 * connections to private IPs at the socket layer. That's a
 * per-client configuration, not a shared utility.
 */

import { AppError } from './errors';

// RFC 1918 private + link-local + reserved IPv4 CIDRs.
const PRIVATE_V4_RANGES: Array<[number, number]> = [
  // 10.0.0.0/8
  [ipv4ToInt('10.0.0.0'), ipv4ToInt('10.255.255.255')],
  // 172.16.0.0/12
  [ipv4ToInt('172.16.0.0'), ipv4ToInt('172.31.255.255')],
  // 192.168.0.0/16
  [ipv4ToInt('192.168.0.0'), ipv4ToInt('192.168.255.255')],
  // 127.0.0.0/8 (loopback)
  [ipv4ToInt('127.0.0.0'), ipv4ToInt('127.255.255.255')],
  // 169.254.0.0/16 (link-local incl. AWS/Azure/GCP metadata)
  [ipv4ToInt('169.254.0.0'), ipv4ToInt('169.254.255.255')],
  // 0.0.0.0/8 (unspecified / "this network")
  [ipv4ToInt('0.0.0.0'), ipv4ToInt('0.255.255.255')],
  // 100.64.0.0/10 (CGNAT)
  [ipv4ToInt('100.64.0.0'), ipv4ToInt('100.127.255.255')],
  // 224.0.0.0/4 (multicast)
  [ipv4ToInt('224.0.0.0'), ipv4ToInt('239.255.255.255')],
  // 240.0.0.0/4 (reserved)
  [ipv4ToInt('240.0.0.0'), ipv4ToInt('255.255.255.255')],
];

function ipv4ToInt(ip: string): number {
  const parts = ip.split('.').map((p) => parseInt(p, 10));
  // Use multiplication for the first octet so we avoid the bit-shift
  // sign-extension quirk on 32-bit values in JS.
  return parts[0] * 0x1000000 + ((parts[1] << 16) | (parts[2] << 8) | parts[3]);
}

function isPrivateIPv4(ip: string): boolean {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!match) return false;
  const octets = [1, 2, 3, 4].map((i) => Number(match[i]));
  if (octets.some((o) => o < 0 || o > 255)) return false;
  const asInt = ipv4ToInt(octets.join('.'));
  return PRIVATE_V4_RANGES.some(([lo, hi]) => asInt >= lo && asInt <= hi);
}

function isPrivateIPv6(host: string): boolean {
  // Normalise: strip brackets if the URL bracketed the host.
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  // Explicit loopback.
  if (h === '::1' || h === '::') return true;
  // IPv4-mapped IPv6. Node's URL parser normalises the trailing
  // IPv4 octets to hex (e.g. '::ffff:10.0.0.1' → '::ffff:a00:1'),
  // so we handle both dotted and 2-hex-group forms.
  if (h.startsWith('::ffff:')) {
    const mapped = h.slice('::ffff:'.length);
    // Dotted form: '10.0.0.1'
    if (isPrivateIPv4(mapped)) return true;
    // Hex form: 'a00:1' → 0a.00.00.01
    const hexMatch = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(mapped);
    if (hexMatch) {
      const hi = parseInt(hexMatch[1], 16);
      const lo = parseInt(hexMatch[2], 16);
      const dotted = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
      if (isPrivateIPv4(dotted)) return true;
    }
  }
  // Unique local (fc00::/7 → first hex pair 'fc' or 'fd').
  if (/^f[cd][0-9a-f]{2}:/.test(h)) return true;
  // Link-local (fe80::/10).
  if (/^fe[89ab][0-9a-f]:/.test(h)) return true;
  return false;
}

/**
 * Hostnames that are NEVER allowed regardless of IP resolution.
 * Useful because IP resolution can shift (DNS rebinding), and
 * because "metadata.google.internal" / "169.254.169.254" also have
 * human-readable aliases.
 */
const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata.google.internal',
  'metadata.google.com',
  'instance-data.ec2.internal',
  'ip-ranges.amazonaws.com', // not dangerous per se but not a webhook target
]);

export interface ValidateOutboundUrlOptions {
  /** Schemes permitted. Defaults to https only. */
  allowedSchemes?: string[];
  /**
   * Hostname allowlist — when provided, URL hostname MUST be one of
   * these. Use this for high-security contexts (OAuth redirect URIs)
   * where only pre-registered callback targets are valid.
   */
  allowedHosts?: string[];
}

/**
 * Validate an outbound URL. Throws AppError(422) on any violation;
 * returns the parsed URL on success so the caller can reuse the
 * already-parsed URL object instead of calling `new URL()` twice.
 */
export function validateOutboundUrl(
  raw: unknown,
  opts: ValidateOutboundUrlOptions = {},
): URL {
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new AppError('URL is required', 422, 'VALIDATION_ERROR', { reason: 'empty' });
  }
  if (raw.length > 2048) {
    // RFC 7230 suggests 8000 as a practical max; 2048 is our budget.
    throw new AppError('URL exceeds 2048 characters', 422, 'VALIDATION_ERROR', { reason: 'too_long' });
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new AppError('URL is not well-formed', 422, 'VALIDATION_ERROR', { reason: 'parse_error' });
  }

  // Scheme allowlist (default: https only — http is optional and
  // must be explicitly permitted per-caller)
  const allowedSchemes = opts.allowedSchemes ?? ['https:'];
  if (!allowedSchemes.includes(url.protocol)) {
    throw new AppError(
      `URL scheme '${url.protocol}' not permitted (expected: ${allowedSchemes.join(', ')})`,
      422,
      'VALIDATION_ERROR',
      { reason: 'bad_scheme', scheme: url.protocol },
    );
  }

  // Reject userinfo in the URL (credentials embedded in the host)
  if (url.username || url.password) {
    throw new AppError(
      'URL must not embed credentials in the userinfo component',
      422,
      'VALIDATION_ERROR',
      { reason: 'userinfo_present' },
    );
  }

  const hostname = url.hostname.toLowerCase();

  // Explicit blocked hostnames
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    throw new AppError(
      `URL hostname '${hostname}' is blocked (metadata / loopback alias)`,
      422,
      'VALIDATION_ERROR',
      { reason: 'blocked_hostname', hostname },
    );
  }

  // IPv4 literal in the hostname
  if (isPrivateIPv4(hostname)) {
    throw new AppError(
      `URL host '${hostname}' falls in a private / reserved IPv4 range`,
      422,
      'VALIDATION_ERROR',
      { reason: 'private_ipv4', hostname },
    );
  }

  // IPv6 literal in the hostname (bracketed or bare)
  if (hostname.includes(':') && isPrivateIPv6(hostname)) {
    throw new AppError(
      `URL host '${hostname}' falls in a private / reserved IPv6 range`,
      422,
      'VALIDATION_ERROR',
      { reason: 'private_ipv6', hostname },
    );
  }

  // Optional hostname allowlist (strict per-callee gate)
  if (opts.allowedHosts && opts.allowedHosts.length > 0) {
    const ok = opts.allowedHosts.some((h) => hostname === h.toLowerCase());
    if (!ok) {
      throw new AppError(
        `URL host '${hostname}' not in allowlist`,
        422,
        'VALIDATION_ERROR',
        { reason: 'not_in_allowlist', hostname, allowed: opts.allowedHosts },
      );
    }
  }

  return url;
}
