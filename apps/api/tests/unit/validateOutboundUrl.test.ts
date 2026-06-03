/**
 * Unit tests for the SSRF outbound URL validator.
 *
 * Standard satisfied: OWASP A10 (SSRF), CWE-918.
 */

import { describe, it, expect } from 'vitest';
import { validateOutboundUrl } from '../../src/shared/validateOutboundUrl';

describe('validateOutboundUrl', () => {
  describe('Happy path — public HTTPS URLs', () => {
    it.each([
      'https://api.example.com/webhook',
      'https://hooks.slack.com/services/T00/B00/XXX',
      'https://example.test/path?query=1#frag',
      'https://deep.subdomain.example.com:8443/resource',
    ])('accepts %s', (url) => {
      const result = validateOutboundUrl(url);
      expect(result).toBeInstanceOf(URL);
      expect(result.protocol).toBe('https:');
    });
  });

  describe('Scheme blocking', () => {
    it('rejects http:// by default', () => {
      expect(() => validateOutboundUrl('http://example.com/')).toThrow(/scheme/i);
    });

    it('rejects file:// / gopher:// / dict:// / ftp://', () => {
      for (const bad of [
        'file:///etc/passwd',
        'gopher://example.com:70/',
        'dict://example.com/info',
        'ftp://example.com/file.txt',
        'ldap://example.com/',
        'javascript:alert(1)',
      ]) {
        expect(() => validateOutboundUrl(bad)).toThrow(/scheme/i);
      }
    });

    it('accepts http when explicitly permitted', () => {
      const result = validateOutboundUrl('http://example.com/', {
        allowedSchemes: ['http:', 'https:'],
      });
      expect(result.protocol).toBe('http:');
    });
  });

  describe('Cloud metadata endpoints', () => {
    it.each([
      'https://169.254.169.254/latest/meta-data/',
      'http://169.254.169.254/latest/meta-data/',
      'https://metadata.google.internal/computeMetadata/v1/',
      'https://metadata.google.com/',
    ])('rejects %s', (url) => {
      expect(() =>
        validateOutboundUrl(url, { allowedSchemes: ['http:', 'https:'] }),
      ).toThrow();
    });
  });

  describe('Private IPv4 ranges (RFC 1918 + reserved)', () => {
    it.each([
      'https://10.0.0.1/',
      'https://10.255.255.254/',
      'https://172.16.0.1/',
      'https://172.31.255.254/',
      'https://192.168.1.1/',
      'https://192.168.100.100/',
      'https://127.0.0.1/',
      'https://127.255.255.255/',
      'https://0.0.0.0/',
      'https://100.64.0.1/',   // CGNAT
      'https://224.0.0.1/',    // multicast
      'https://255.255.255.255/',  // reserved / broadcast
    ])('rejects %s', (url) => {
      expect(() => validateOutboundUrl(url)).toThrow(/private|reserved|blocked/i);
    });
  });

  describe('Public IPv4 ranges (not blocked)', () => {
    it.each([
      'https://8.8.8.8/',      // Google DNS
      'https://1.1.1.1/',      // Cloudflare DNS
      'https://93.184.216.34/',  // example.com
      'https://203.0.113.5/',  // RFC 5737 TEST-NET-3 (documented, but we don't block)
    ])('accepts %s', (url) => {
      expect(() => validateOutboundUrl(url)).not.toThrow();
    });
  });

  describe('IPv6 private / reserved', () => {
    it.each([
      'https://[::1]/',
      'https://[fc00::1]/',
      'https://[fd00::1]/',
      'https://[fe80::1]/',
      'https://[fe8a::1]/',
      'https://[::ffff:10.0.0.1]/',  // IPv4-mapped private
    ])('rejects %s', (url) => {
      expect(() => validateOutboundUrl(url)).toThrow();
    });

    it.each([
      'https://[2606:4700:4700::1111]/',  // Cloudflare DNS
      'https://[2001:4860:4860::8888]/',  // Google DNS
    ])('accepts public IPv6 %s', (url) => {
      expect(() => validateOutboundUrl(url)).not.toThrow();
    });
  });

  describe('Hostname alias blocking', () => {
    it('rejects localhost by name', () => {
      expect(() => validateOutboundUrl('https://localhost/api')).toThrow(/blocked|loopback|private/i);
    });

    it('case-insensitive hostname match', () => {
      expect(() => validateOutboundUrl('https://LocalHost/api')).toThrow();
      expect(() => validateOutboundUrl('https://LOCALHOST/api')).toThrow();
    });
  });

  describe('Userinfo (credentials in URL)', () => {
    it('rejects URLs with embedded credentials', () => {
      expect(() => validateOutboundUrl('https://user:pass@example.com/')).toThrow(/userinfo|credential/i);
      expect(() => validateOutboundUrl('https://user@example.com/')).toThrow();
    });
  });

  describe('Input hygiene', () => {
    it('rejects empty / non-string / undefined', () => {
      expect(() => validateOutboundUrl('')).toThrow();
      expect(() => validateOutboundUrl(undefined)).toThrow();
      expect(() => validateOutboundUrl(null)).toThrow();
      expect(() => validateOutboundUrl(123)).toThrow();
      expect(() => validateOutboundUrl({})).toThrow();
    });

    it('rejects malformed URLs', () => {
      expect(() => validateOutboundUrl('not a url')).toThrow(/well-formed|parse/i);
      expect(() => validateOutboundUrl('http://')).toThrow();
    });

    it('rejects URLs longer than 2048 characters', () => {
      const long = 'https://example.com/' + 'x'.repeat(2048);
      expect(() => validateOutboundUrl(long)).toThrow(/too_long|2048/);
    });
  });

  describe('Per-caller hostname allowlist', () => {
    it('accepts hostnames in the allowlist', () => {
      const result = validateOutboundUrl('https://api.partner.com/webhook', {
        allowedHosts: ['api.partner.com', 'hooks.partner.com'],
      });
      expect(result).toBeInstanceOf(URL);
    });

    it('rejects hostnames not in the allowlist', () => {
      expect(() =>
        validateOutboundUrl('https://evil.com/webhook', {
          allowedHosts: ['api.partner.com'],
        }),
      ).toThrow(/allowlist/i);
    });

    it('allowlist check is case-insensitive', () => {
      const result = validateOutboundUrl('https://API.Partner.Com/webhook', {
        allowedHosts: ['api.partner.com'],
      });
      expect(result.hostname).toBe('api.partner.com');
    });
  });
});
