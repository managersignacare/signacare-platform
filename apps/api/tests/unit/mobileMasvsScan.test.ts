/**
 * Category 8 — Mobile app static MASVS L1 audit.
 *
 * IMPORTANT: this repo's mobile apps are FLUTTER (Dart), not React
 * Native. The Category 8 prompt assumes Detox + Jest, which doesn't
 * apply. The MASVS L1 controls listed in the prompt do still apply,
 * and they're verifiable via static-text rules over the Dart source
 * tree (apps/mobile/lib + apps/patient-app/lib).
 *
 * The Dart-side widget / integration tests live next to the Flutter
 * apps in apps/mobile/test/ and apps/patient-app/test/ — they ship
 * via the existing `flutter test` toolchain. THIS file complements
 * those by enforcing the polyglot security invariants that an
 * auditor reading OWASP MASVS would request:
 *
 *   M1.1 — JWT MUST be stored in FlutterSecureStorage (the Dart
 *          equivalent of Expo SecureStore / Keychain). Never in
 *          SharedPreferences and never in plain Hive boxes.
 *
 *   M2.1 — Production base URLs MUST be HTTPS. The dev default
 *          (http://localhost:4000) is allowed in source for
 *          development, but no other plain-http literal can land.
 *
 *   M3.1 — Sensitive data (token, password, patient name, DOB,
 *          medicare) MUST NOT appear in print() / debugPrint()
 *          calls. The Flutter convention is to log via a logger
 *          that strips these — direct prints are a leak risk.
 *
 *   M4.1 — No hardcoded API keys / passwords / tokens in source.
 *
 *   M5.1 — No use of insecure Dio HttpClientAdapter overrides
 *          (badCertificateCallback returning true) — would defeat
 *          certificate pinning / TLS verification.
 *
 * Standard satisfied: OWASP MASVS L1 (Authentication, Network,
 *                     Cryptography, Code Quality), Australian
 *                     Privacy Act 1988 APP 11 (mobile data security).
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const REPO_ROOT = join(__dirname, '..', '..', '..', '..');
const MOBILE_LIB = join(REPO_ROOT, 'apps', 'mobile', 'lib');
const PATIENT_APP_LIB = join(REPO_ROOT, 'apps', 'patient-app', 'lib');

interface Match { file: string; line: number; text: string }

function walkDart(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.')) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...walkDart(full));
    } else if (name.endsWith('.dart')) {
      out.push(full);
    }
  }
  return out;
}

function grepLines(files: string[], pattern: RegExp): Match[] {
  const matches: Match[] = [];
  for (const f of files) {
    const lines = readFileSync(f, 'utf8').split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (pattern.test(lines[i])) {
        matches.push({
          file: relative(REPO_ROOT, f),
          line: i + 1,
          text: lines[i].trim().slice(0, 120),
        });
      }
    }
  }
  return matches;
}

const ALL_DART = [...walkDart(MOBILE_LIB), ...walkDart(PATIENT_APP_LIB)];

describe('Mobile app — OWASP MASVS L1 static audit', () => {
  it('finds at least one Dart source file in apps/mobile/lib (sanity)', () => {
    expect(ALL_DART.length).toBeGreaterThan(5);
  });

  // ────────────────────────────────────────────────────────────────
  // M1.1 — JWT in FlutterSecureStorage, never SharedPreferences
  // ────────────────────────────────────────────────────────────────
  describe('MASVS-AUTH-1: token storage uses FlutterSecureStorage', () => {
    it('no use of SharedPreferences for token / credential storage', () => {
      // Find any file that imports SharedPreferences AND mentions
      // a token-shaped key in the same file. The pattern is the
      // dangerous combination, not SharedPreferences alone (which
      // is fine for non-sensitive UI prefs).
      const tokenPrefsFiles: Match[] = [];
      for (const f of ALL_DART) {
        const src = readFileSync(f, 'utf8');
        const usesSharedPrefs = /shared_preferences/.test(src);
        if (!usesSharedPrefs) continue;
        // Look for token-shaped keys in the same file
        const tokenRefs = src.match(/(access_token|refresh_token|jwt|bearer_token|auth_token)/gi);
        if (tokenRefs) {
          tokenPrefsFiles.push({
            file: relative(REPO_ROOT, f),
            line: 1,
            text: `imports SharedPreferences AND references token keys: ${tokenRefs.join(', ')}`,
          });
        }
      }
      if (tokenPrefsFiles.length > 0) {
        const formatted = tokenPrefsFiles.map((m) => `  ${m.file}: ${m.text}`).join('\n');
        throw new Error(
          `Tokens stored in SharedPreferences (MASVS-AUTH-1 violation):\n${formatted}\n\n` +
          `Move token storage to flutter_secure_storage / Keychain.`,
        );
      }
    });

    it('FlutterSecureStorage IS imported by at least one auth-flow file', () => {
      // Positive assertion: prove the safe pattern is in use.
      // If no Dart file uses FlutterSecureStorage, the previous
      // test passes vacuously and we miss a regression.
      const safe = grepLines(ALL_DART, /flutter_secure_storage/);
      expect(safe.length).toBeGreaterThan(0);
    });
  });

  // ────────────────────────────────────────────────────────────────
  // M2.1 — HTTPS in production base URLs
  // ────────────────────────────────────────────────────────────────
  describe('MASVS-NETWORK-1: no plain http base URLs (except dev defaults)', () => {
    it('only http://localhost is permitted as a plain-http literal', () => {
      const httpLiterals = grepLines(ALL_DART, /['"]http:\/\/[^'"]+['"]/);
      const violations = httpLiterals.filter((m) => {
        // Allowed: localhost / 127.0.0.1 / 10.0.2.2 (Android emulator host)
        if (/http:\/\/(localhost|127\.0\.0\.1|10\.0\.2\.2)/.test(m.text)) return false;
        // Allowed: UI hint text — these are placeholder strings shown
        // in the URL config TextField, not actual base URLs.
        if (/\bhintText:\s*['"]/.test(m.text)) return false;
        if (/\blabelText:\s*['"]/.test(m.text)) return false;
        if (/\bhelperText:\s*['"]/.test(m.text)) return false;
        // Allowed: comments
        if (/^\s*\/\//.test(m.text)) return false;
        return true;
      });
      if (violations.length > 0) {
        const formatted = violations.map((m) => `  ${m.file}:${m.line}  ${m.text}`).join('\n');
        throw new Error(
          `Plain-http literal found in production code paths:\n${formatted}\n\n` +
          `Replace with https:// or move to a config that's overridden via env at build time.`,
        );
      }
    });
  });

  // ────────────────────────────────────────────────────────────────
  // M3.1 — No PHI / credentials in print() / debugPrint()
  // ────────────────────────────────────────────────────────────────
  describe('MASVS-CODE-1: no PHI or credentials in direct print() output', () => {
    it('no print(...) call references token / password / patient.dob / medicare', () => {
      // Match: print(...) or debugPrint(...) calls where the
      // argument string mentions a credential or PHI field name.
      const matches: Match[] = [];
      const sensitivePattern =
        /(print|debugPrint)\([^)]*\b(token|password|jwt|bearer|medicare|date_of_birth|dob|family_name|given_name)\b/i;
      for (const f of ALL_DART) {
        const lines = readFileSync(f, 'utf8').split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          if (sensitivePattern.test(lines[i])) {
            matches.push({
              file: relative(REPO_ROOT, f),
              line: i + 1,
              text: lines[i].trim().slice(0, 120),
            });
          }
        }
      }
      if (matches.length > 0) {
        const formatted = matches.map((m) => `  ${m.file}:${m.line}  ${m.text}`).join('\n');
        throw new Error(
          `print()/debugPrint() leaks sensitive data:\n${formatted}\n\n` +
          `Use a structured logger (logging package) and redact these fields, or remove the print entirely.`,
        );
      }
    });
  });

  // ────────────────────────────────────────────────────────────────
  // M4.1 — No hardcoded API keys / passwords
  // ────────────────────────────────────────────────────────────────
  describe('MASVS-CRYPTO-1: no hardcoded credentials', () => {
    it('no Dart file embeds a literal API key, secret, or password', () => {
      // Look for assignment or literal of common secret-bearing
      // identifiers. We tolerate dev placeholders ('Password1!')
      // ONLY in files under test/ directories (none here for now).
      const matches: Match[] = [];
      const SUSPICIOUS = /(?:apiKey|secret|token|password)\s*[:=]\s*['"]([A-Za-z0-9+/=]{16,})['"]/g;
      for (const f of ALL_DART) {
        const src = readFileSync(f, 'utf8');
        let m: RegExpExecArray | null;
        SUSPICIOUS.lastIndex = 0;
        while ((m = SUSPICIOUS.exec(src)) !== null) {
          // Skip the constant key declarations (e.g.
          // `const _kAccessTokenKey = 'access_token';` — that's a
          // KEY name, not a credential).
          const literal = m[1];
          if (/^[a-z_]+$/.test(literal)) continue;
          // Locate line
          const offset = m.index;
          const line = src.slice(0, offset).split('\n').length;
          matches.push({
            file: relative(REPO_ROOT, f),
            line,
            text: src.split('\n')[line - 1].trim().slice(0, 120),
          });
        }
      }
      if (matches.length > 0) {
        const formatted = matches.map((m) => `  ${m.file}:${m.line}  ${m.text}`).join('\n');
        throw new Error(
          `Hardcoded secret literal in Dart source:\n${formatted}\n\n` +
          `Load from FlutterSecureStorage or build-time --dart-define.`,
        );
      }
    });
  });

  // ────────────────────────────────────────────────────────────────
  // M5.1 — No insecure HttpClientAdapter overrides (TLS pinning bypass)
  // ────────────────────────────────────────────────────────────────
  describe('MASVS-NETWORK-2: TLS verification not disabled', () => {
    it('no badCertificateCallback that returns true (cert pinning bypass)', () => {
      // The dangerous pattern in Dio:
      //   ..badCertificateCallback = (cert, host, port) => true;
      // accepts ANY cert, defeating TLS verification entirely.
      // Sometimes used in dev — must NEVER ship to production.
      const matches = grepLines(
        ALL_DART,
        /badCertificateCallback\s*=\s*\([^)]*\)\s*=>\s*true/,
      );
      if (matches.length > 0) {
        const formatted = matches.map((m) => `  ${m.file}:${m.line}  ${m.text}`).join('\n');
        throw new Error(
          `badCertificateCallback unconditionally returns true:\n${formatted}\n\n` +
          `This disables TLS certificate verification. Remove or gate behind kDebugMode.`,
        );
      }
    });

    it('no SecurityContext with empty trust roots (TLS bypass alt)', () => {
      const matches = grepLines(
        ALL_DART,
        /SecurityContext\s*\.\s*defaultContext\s*\.\s*setTrustedCertificatesBytes\s*\(\s*\[\s*\]/,
      );
      expect(matches).toHaveLength(0);
    });
  });
});
