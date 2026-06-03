/**
 * BUG-381 — Unit tests for safety-load-bearing shared utilities.
 *
 * Closes catalogue gap "Unit tests — escapeLike, validateOutboundUrl,
 * coerceRow, buildAttachmentStorageKey". Each utility is small + pure,
 * but each one mitigates a recurring class of vulnerability:
 *
 *   - escapeLike            — LIKE-injection (CLAUDE.md §1.8)
 *   - validateOutboundUrl   — SSRF / metadata-service / DNS rebinding
 *   - parseRow (coerceRow)  — Date → string coercion before Zod parse
 *   - buildAttachmentStorageKey — collision-free, sharded, ext-only-trusted
 *
 * fix-registry anchors pinned by this file:
 *   - R-FIX-BUG-381-ESCAPE-LIKE-TESTS
 *   - R-FIX-BUG-381-VALIDATE-OUTBOUND-URL-TESTS
 *   - R-FIX-BUG-381-PARSE-ROW-TESTS
 *   - R-FIX-BUG-381-BUILD-ATTACHMENT-STORAGE-KEY-TESTS
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { escapeLike } from '../../src/shared/escapeLike';
import { validateOutboundUrl } from '../../src/shared/validateOutboundUrl';
import { parseRow } from '../../src/shared/coerceRow';
import { buildAttachmentStorageKey } from '../../src/shared/blobStorage';

// ─────────────────────────────────────────────────────────────────────────────
// escapeLike — CLAUDE.md §1.8 LIKE wildcard escape
// ─────────────────────────────────────────────────────────────────────────────
describe('escapeLike (BUG-381)', () => {
  it('TP-EL-1: passes through plain text unchanged', () => {
    expect(escapeLike('alice')).toBe('alice');
    expect(escapeLike('Smith')).toBe('Smith');
  });

  it('TP-EL-2: escapes `%` to `\\%`', () => {
    expect(escapeLike('100%')).toBe('100\\%');
    expect(escapeLike('%admin%')).toBe('\\%admin\\%');
  });

  it('TP-EL-3: escapes `_` to `\\_`', () => {
    expect(escapeLike('user_id')).toBe('user\\_id');
    expect(escapeLike('_root')).toBe('\\_root');
  });

  it('TP-EL-4: handles empty string', () => {
    expect(escapeLike('')).toBe('');
  });

  it('TP-EL-5: escapes both wildcards together', () => {
    expect(escapeLike('a%_b')).toBe('a\\%\\_b');
  });

  it('TP-EL-6: leaves backslashes alone (PostgreSQL ESCAPE clause is responsible)', () => {
    // Per CLAUDE.md §1.8: caller pairs `escapeLike` with parameterized `?`
    // — we don't double-escape backslashes themselves.
    expect(escapeLike('back\\slash')).toBe('back\\slash');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// validateOutboundUrl — SSRF / metadata-service / DNS-rebinding defence
// ─────────────────────────────────────────────────────────────────────────────
describe('validateOutboundUrl (BUG-381)', () => {
  describe('happy path', () => {
    it('TP-VOU-1: accepts a public HTTPS URL', () => {
      const url = validateOutboundUrl('https://example.com/webhook');
      expect(url.hostname).toBe('example.com');
      expect(url.pathname).toBe('/webhook');
    });

    it('TP-VOU-2: returns the parsed URL object so callers can re-use it', () => {
      const result = validateOutboundUrl('https://api.example.com/v1?key=x');
      expect(result).toBeInstanceOf(URL);
      expect(result.searchParams.get('key')).toBe('x');
    });
  });

  describe('input validation', () => {
    it('TP-VOU-3: rejects non-string input', () => {
      expect(() => validateOutboundUrl(undefined)).toThrow(/required/);
      expect(() => validateOutboundUrl(null)).toThrow(/required/);
      expect(() => validateOutboundUrl(42)).toThrow(/required/);
      expect(() => validateOutboundUrl({})).toThrow(/required/);
    });

    it('TP-VOU-4: rejects empty string', () => {
      expect(() => validateOutboundUrl('')).toThrow(/required/);
    });

    it('TP-VOU-5: rejects URLs longer than 2048 chars', () => {
      const long = 'https://example.com/' + 'x'.repeat(2050);
      expect(() => validateOutboundUrl(long)).toThrow(/2048/);
    });

    it('TP-VOU-6: rejects malformed URLs', () => {
      expect(() => validateOutboundUrl('not a url')).toThrow(/well-formed/);
      expect(() => validateOutboundUrl('://no-scheme')).toThrow(/well-formed/);
    });
  });

  describe('scheme allowlist', () => {
    it('TP-VOU-7: rejects http:// by default (https only)', () => {
      expect(() => validateOutboundUrl('http://example.com')).toThrow(/scheme/);
    });

    it('TP-VOU-8: rejects file://, gopher://, dict://', () => {
      expect(() => validateOutboundUrl('file:///etc/passwd')).toThrow(/scheme/);
      expect(() => validateOutboundUrl('gopher://x.com')).toThrow(/scheme/);
      expect(() => validateOutboundUrl('dict://x.com:11211')).toThrow(/scheme/);
    });

    it('TP-VOU-9: accepts http:// when explicitly permitted', () => {
      const url = validateOutboundUrl('http://example.com', { allowedSchemes: ['https:', 'http:'] });
      expect(url.protocol).toBe('http:');
    });
  });

  describe('userinfo blocking', () => {
    it('TP-VOU-10: rejects URLs with embedded credentials', () => {
      expect(() => validateOutboundUrl('https://user:pass@example.com')).toThrow(/userinfo/);
      expect(() => validateOutboundUrl('https://user@example.com')).toThrow(/userinfo/);
    });
  });

  describe('SSRF — private IPv4 blocking', () => {
    it('TP-VOU-11: rejects 127.0.0.1 (loopback)', () => {
      expect(() => validateOutboundUrl('https://127.0.0.1')).toThrow(/private.*IPv4/);
    });

    it('TP-VOU-12: rejects 10.x.x.x (RFC 1918)', () => {
      expect(() => validateOutboundUrl('https://10.0.0.1')).toThrow(/private.*IPv4/);
      expect(() => validateOutboundUrl('https://10.255.255.255')).toThrow(/private.*IPv4/);
    });

    it('TP-VOU-13: rejects 172.16-31.x.x (RFC 1918)', () => {
      expect(() => validateOutboundUrl('https://172.16.0.1')).toThrow(/private.*IPv4/);
      expect(() => validateOutboundUrl('https://172.31.255.254')).toThrow(/private.*IPv4/);
    });

    it('TP-VOU-14: rejects 192.168.x.x (RFC 1918)', () => {
      expect(() => validateOutboundUrl('https://192.168.1.1')).toThrow(/private.*IPv4/);
    });

    it('TP-VOU-15: rejects 169.254.169.254 (cloud metadata service)', () => {
      expect(() => validateOutboundUrl('https://169.254.169.254/latest/meta-data')).toThrow(/private.*IPv4/);
    });

    it('TP-VOU-16: rejects 100.64.x.x (CGNAT)', () => {
      expect(() => validateOutboundUrl('https://100.64.0.1')).toThrow(/private.*IPv4/);
    });

    it('TP-VOU-17: accepts public IPv4', () => {
      const url = validateOutboundUrl('https://8.8.8.8');
      expect(url.hostname).toBe('8.8.8.8');
    });
  });

  describe('SSRF — private IPv6 blocking', () => {
    it('TP-VOU-18: rejects ::1 (IPv6 loopback)', () => {
      expect(() => validateOutboundUrl('https://[::1]')).toThrow(/private.*IPv6/);
    });

    it('TP-VOU-19: rejects fc00::/7 (unique local)', () => {
      expect(() => validateOutboundUrl('https://[fc00::1]')).toThrow(/private.*IPv6/);
      expect(() => validateOutboundUrl('https://[fd00::1]')).toThrow(/private.*IPv6/);
    });

    it('TP-VOU-20: rejects fe80::/10 (link-local)', () => {
      expect(() => validateOutboundUrl('https://[fe80::1]')).toThrow(/private.*IPv6/);
    });

    it('TP-VOU-21: rejects IPv4-mapped IPv6 to private ranges', () => {
      expect(() => validateOutboundUrl('https://[::ffff:127.0.0.1]')).toThrow(/private.*IPv6/);
      expect(() => validateOutboundUrl('https://[::ffff:10.0.0.1]')).toThrow(/private.*IPv6/);
    });
  });

  describe('hostname blocklist', () => {
    it('TP-VOU-22: rejects localhost (alias for 127.0.0.1)', () => {
      expect(() => validateOutboundUrl('https://localhost')).toThrow(/blocked/);
    });

    it('TP-VOU-23: rejects metadata.google.internal', () => {
      expect(() => validateOutboundUrl('https://metadata.google.internal')).toThrow(/blocked/);
    });
  });

  describe('hostname allowlist option', () => {
    it('TP-VOU-24: accepts hosts in the allowlist', () => {
      const url = validateOutboundUrl('https://api.example.com/x', {
        allowedHosts: ['api.example.com'],
      });
      expect(url.hostname).toBe('api.example.com');
    });

    it('TP-VOU-25: rejects hosts NOT in the allowlist (even if otherwise valid)', () => {
      expect(() =>
        validateOutboundUrl('https://other.example.com', {
          allowedHosts: ['api.example.com'],
        }),
      ).toThrow(/allowlist/);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// parseRow — Knex Date → ISO/YYYY-MM-DD coercion before Zod parse
// ─────────────────────────────────────────────────────────────────────────────
describe('parseRow / coerceRow (BUG-381)', () => {
  const Schema = z.object({
    id:         z.string(),
    createdAt:  z.string().datetime(),
    birthDate:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    nullable:   z.string().nullable().optional(),
  });

  it('TP-PR-1: coerces a Date midnight-UTC to YYYY-MM-DD', () => {
    const input = {
      id: 'abc',
      createdAt: new Date('2026-01-15T10:30:00Z'),
      birthDate: new Date('1990-05-20T00:00:00Z'),  // pure date — UTC midnight
    };
    const out = parseRow(input, Schema);
    expect(out.birthDate).toBe('1990-05-20');
    expect(out.createdAt).toBe('2026-01-15T10:30:00.000Z');
  });

  it('TP-PR-2: detects local-midnight as date-only (DB tz != UTC)', () => {
    // Construct a date that's midnight in local timezone but NOT UTC.
    // Easiest way: explicitly construct via local-midnight constructor.
    const localMidnight = new Date(2026, 0, 15, 0, 0, 0, 0);
    const out = parseRow({ id: 'x', createdAt: '2026-01-15T10:30:00.000Z', birthDate: localMidnight }, Schema);
    expect(out.birthDate).toBe('2026-01-15');
  });

  it('TP-PR-3: ISO-formats non-midnight Date as full timestamp', () => {
    const out = parseRow(
      {
        id: 'x',
        createdAt: new Date('2026-04-01T13:45:30.123Z'),
        birthDate: '2000-01-01',
      },
      Schema,
    );
    expect(out.createdAt).toBe('2026-04-01T13:45:30.123Z');
  });

  it('TP-PR-4: passes non-Date values through unchanged', () => {
    const out = parseRow(
      {
        id: 'preserve-string',
        createdAt: '2026-01-15T10:30:00.000Z',
        birthDate: '1990-05-20',
        nullable: null,
      },
      Schema,
    );
    expect(out.id).toBe('preserve-string');
    expect(out.nullable).toBe(null);
  });

  it('TP-PR-5: throws Zod error if coerced shape fails validation', () => {
    expect(() =>
      parseRow(
        { id: 'x', createdAt: 'NOT-AN-ISO', birthDate: '1990-05-20' },
        Schema,
      ),
    ).toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildAttachmentStorageKey — collision-free, sharded, ext-only-trusted
// ─────────────────────────────────────────────────────────────────────────────
describe('buildAttachmentStorageKey (BUG-381)', () => {
  it('TP-AS-1: returns a key with the attachments/ prefix + yyyy/mm shard', () => {
    const key = buildAttachmentStorageKey('test.pdf');
    expect(key).toMatch(/^attachments\/\d{4}\/\d{2}\//);
  });

  it('TP-AS-2: preserves the file extension (lowercased)', () => {
    expect(buildAttachmentStorageKey('test.PDF')).toMatch(/\.pdf$/);
    expect(buildAttachmentStorageKey('IMAGE.JPG')).toMatch(/\.jpg$/);
  });

  it('TP-AS-3: handles missing extension', () => {
    const key = buildAttachmentStorageKey('no-extension');
    // No .ext suffix means the key just ends with the random id
    expect(key).toMatch(/^attachments\/\d{4}\/\d{2}\/[a-f0-9]{32}$/);
  });

  it('TP-AS-4: generates collision-resistant keys (1000 calls, all unique)', () => {
    const keys = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      keys.add(buildAttachmentStorageKey(`file-${i}.dat`));
    }
    expect(keys.size).toBe(1000);
  });

  it('TP-AS-5: uses a 32-character hex id (sha256 truncated)', () => {
    const key = buildAttachmentStorageKey('x.pdf');
    const idMatch = /\/([a-f0-9]+)\.pdf$/.exec(key);
    expect(idMatch).toBeTruthy();
    expect(idMatch![1].length).toBe(32);
  });

  it('TP-AS-6: never trusts the original filename as the key (path traversal defence)', () => {
    // Original filename with path-traversal attempt MUST NOT influence the key
    const key = buildAttachmentStorageKey('../../../etc/passwd.pdf');
    expect(key).not.toContain('..');
    expect(key).not.toContain('etc/passwd');
    expect(key).toMatch(/\.pdf$/);  // only the extension is preserved
  });

  it('TP-AS-7: yyyy/mm shard reflects current UTC time', () => {
    const key = buildAttachmentStorageKey('x.pdf');
    const now = new Date();
    const expectedYyyy = String(now.getUTCFullYear());
    const expectedMm = String(now.getUTCMonth() + 1).padStart(2, '0');
    expect(key).toMatch(new RegExp(`^attachments/${expectedYyyy}/${expectedMm}/`));
  });
});
