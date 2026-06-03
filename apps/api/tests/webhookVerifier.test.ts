/**
 * S3.4 — webhookVerifier unit tests
 *
 * Pure-function tests for the cryptographic and validation core of the
 * inbound webhook receiver. The full HTTP flow (route mounting, DB
 * lookups, audit log writes, JobBus enqueue) needs a real Postgres +
 * Redis and is covered by an integration test in a follow-up.
 */

import { describe, it, expect } from 'vitest';
import { createHmac } from 'crypto';
import {
  computeSignature,
  verifySignature,
  sha256Hex,
  parseAndCheckTimestamp,
  ipInAllowlist,
  safeEquals,
} from '../src/features/webhooks/webhookVerifier';

describe('computeSignature + verifySignature', () => {
  const secret = 'super-secret-key-from-partner';
  const body = Buffer.from('{"event":"order.created","id":"abc-123"}', 'utf8');
  const expected = createHmac('sha256', secret).update(body).digest('hex');

  it('round-trips a valid signature', () => {
    const computed = computeSignature(body, secret);
    expect(computed).toBe(expected);
    expect(verifySignature(computed, expected)).toBe(true);
  });

  it('accepts the sha256= prefix form (Stripe/GitHub style)', () => {
    expect(verifySignature(`sha256=${expected}`, expected)).toBe(true);
    expect(verifySignature(`SHA256=${expected.toUpperCase()}`, expected)).toBe(true);
  });

  it('rejects a tampered signature', () => {
    const tampered = expected.slice(0, -1) + (expected.slice(-1) === '0' ? '1' : '0');
    expect(verifySignature(tampered, expected)).toBe(false);
  });

  it('rejects an empty / undefined presented signature', () => {
    expect(verifySignature(undefined, expected)).toBe(false);
    expect(verifySignature('', expected)).toBe(false);
  });

  it('detects body tampering by changing the secret', () => {
    const wrongSecret = computeSignature(body, 'wrong-secret');
    expect(verifySignature(wrongSecret, expected)).toBe(false);
  });
});

describe('sha256Hex', () => {
  it('produces 64-char hex', () => {
    expect(sha256Hex('hello')).toHaveLength(64);
  });
  it('matches a known vector', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
  it('accepts both string and buffer', () => {
    expect(sha256Hex('foo')).toBe(sha256Hex(Buffer.from('foo', 'utf8')));
  });
});

describe('safeEquals', () => {
  it('true on equal', () => { expect(safeEquals('a', 'a')).toBe(true); });
  it('false on different same-length', () => { expect(safeEquals('a', 'b')).toBe(false); });
  it('false on different lengths', () => { expect(safeEquals('a', 'aa')).toBe(false); });
});

describe('parseAndCheckTimestamp', () => {
  const now = 1_700_000_000_000;

  it('returns ok when no header is present', () => {
    const r = parseAndCheckTimestamp(undefined, 300, now);
    expect(r.ok).toBe(true);
    expect(r.ts).toBe(Math.floor(now / 1000));
  });

  it('parses 10-digit unix seconds', () => {
    const ts = '1699999900'; // 100 sec in the past
    expect(parseAndCheckTimestamp(ts, 300, now).ok).toBe(true);
  });

  it('parses 13-digit unix milliseconds', () => {
    const ts = '1699999900000';
    expect(parseAndCheckTimestamp(ts, 300, now).ok).toBe(true);
  });

  it('parses ISO 8601', () => {
    const ts = new Date(now - 60_000).toISOString();
    expect(parseAndCheckTimestamp(ts, 300, now).ok).toBe(true);
  });

  it('rejects timestamp outside the window', () => {
    const ts = '1699998000'; // 2000 sec in the past
    const r = parseAndCheckTimestamp(ts, 300, now);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('out_of_window');
  });

  it('rejects timestamp too far in the future', () => {
    const ts = '1700001000'; // 1000 sec in the future
    const r = parseAndCheckTimestamp(ts, 300, now);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('out_of_window');
  });

  it('rejects malformed timestamp', () => {
    const r = parseAndCheckTimestamp('banana', 300, now);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('malformed');
  });
});

describe('ipInAllowlist', () => {
  it('returns true when allowlist is empty/null', () => {
    expect(ipInAllowlist('192.168.1.1', null)).toBe(true);
    expect(ipInAllowlist('192.168.1.1', '')).toBe(true);
    expect(ipInAllowlist('192.168.1.1', undefined)).toBe(true);
  });

  it('matches an exact IP', () => {
    expect(ipInAllowlist('203.0.113.5', '203.0.113.5')).toBe(true);
    expect(ipInAllowlist('203.0.113.6', '203.0.113.5')).toBe(false);
  });

  it('matches a CIDR /24', () => {
    expect(ipInAllowlist('192.168.1.50', '192.168.1.0/24')).toBe(true);
    expect(ipInAllowlist('192.168.2.50', '192.168.1.0/24')).toBe(false);
  });

  it('matches a CIDR /8', () => {
    expect(ipInAllowlist('10.5.4.3', '10.0.0.0/8')).toBe(true);
    expect(ipInAllowlist('11.5.4.3', '10.0.0.0/8')).toBe(false);
  });

  it('handles multiple CIDRs (comma-separated)', () => {
    const list = '192.168.1.0/24, 10.0.0.0/8, 203.0.113.5';
    expect(ipInAllowlist('192.168.1.99', list)).toBe(true);
    expect(ipInAllowlist('10.99.99.99', list)).toBe(true);
    expect(ipInAllowlist('203.0.113.5', list)).toBe(true);
    expect(ipInAllowlist('8.8.8.8', list)).toBe(false);
  });

  it('strips ::ffff: IPv4-mapped IPv6 prefix', () => {
    expect(ipInAllowlist('::ffff:192.168.1.1', '192.168.1.0/24')).toBe(true);
  });

  it('returns false when IP is missing or unparseable', () => {
    expect(ipInAllowlist(undefined, '192.168.1.0/24')).toBe(false);
    expect(ipInAllowlist('not-an-ip', '192.168.1.0/24')).toBe(false);
  });
});
