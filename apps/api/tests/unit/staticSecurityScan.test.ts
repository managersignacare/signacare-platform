/**
 * Category 5 — Static security scan.
 *
 * A pure-filesystem audit of the API source tree, run in the default
 * `pnpm test` execution. No DB, no Redis, no HTTP — just glob+regex
 * over apps/api/src, asserting OWASP A03 (Injection) and A08 (Software
 * & Data Integrity) negative properties:
 *
 *   - No `eval(...)` or `new Function(...)` (RCE vector)
 *   - No hardcoded password / secret fallbacks (env var must throw if
 *     missing, never silently default — Fix Registry §6.2)
 *   - No `password_hash` leaking out of API serializers (the
 *     SAFE_STAFF_COLUMNS allowlist in staffRepository.ts is the
 *     safety net; this scan asserts no other code path inserts the
 *     column into a JSON response)
 *
 * The test reads the source files synchronously (cheap — these run
 * in <50ms total) and fails loudly if any new violation lands. The
 * grep-based Fix Registry guard does the same for individual fixes;
 * this test catches the negative space the registry can't enumerate.
 *
 * Standard satisfied: OWASP A03 (Injection), OWASP A08 (Integrity),
 *                     CWE-95 (Eval Injection), CWE-798 (Hard-coded
 *                     Credentials).
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC_ROOT = join(__dirname, '..', '..', 'src');

interface Match { file: string; line: number; text: string }

function walkTs(dir: string): string[] {
  const out: string[] = [];
  const entries = readdirSync(dir);
  for (const name of entries) {
    if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...walkTs(full));
    } else if (
      (name.endsWith('.ts') || name.endsWith('.tsx')) &&
      !name.endsWith('.d.ts') &&
      !name.endsWith('.test.ts')
    ) {
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
          file: relative(SRC_ROOT, f),
          line: i + 1,
          text: lines[i].trim().slice(0, 120),
        });
      }
    }
  }
  return matches;
}

describe('Static security scan — apps/api/src', () => {
  const allFiles = walkTs(SRC_ROOT);

  it('finds at least one TypeScript source file (sanity check)', () => {
    expect(allFiles.length).toBeGreaterThan(50);
  });

  // ────────────────────────────────────────────────────────────────
  // OWASP A08 — eval() and Function() constructors
  // ────────────────────────────────────────────────────────────────
  describe('OWASP A08 — RCE primitives', () => {
    it('no `eval(` calls in apps/api/src', () => {
      // Negative-lookbehind avoids matching identifiers that contain
      // "eval" as a substring (e.g. `retrieval`, `evaluation`).
      const matches = grepLines(allFiles, /(?<![A-Za-z0-9_$])eval\s*\(/);
      if (matches.length > 0) {
        const formatted = matches
          .map((m) => `  ${m.file}:${m.line}  ${m.text}`)
          .join('\n');
        throw new Error(`Found eval() usage:\n${formatted}`);
      }
      expect(matches).toHaveLength(0);
    });

    it('no `new Function(` constructor calls', () => {
      const matches = grepLines(allFiles, /new\s+Function\s*\(/);
      if (matches.length > 0) {
        const formatted = matches
          .map((m) => `  ${m.file}:${m.line}  ${m.text}`)
          .join('\n');
        throw new Error(`Found new Function() usage:\n${formatted}`);
      }
      expect(matches).toHaveLength(0);
    });
  });

  // ────────────────────────────────────────────────────────────────
  // OWASP A02 — hardcoded secret fallbacks
  // ────────────────────────────────────────────────────────────────
  describe('OWASP A02 — hardcoded secret fallbacks', () => {
    // We focus on env-var NAMES that semantically carry a secret —
    // anything ending in PASSWORD / SECRET / KEY / TOKEN / HASH /
    // PRIVATE / API_KEY. Those MUST throw if missing, never silently
    // fall back to a literal default. URL / model / timezone defaults
    // are intentionally not in scope (they're configuration, not credentials).
    const SECRET_NAME = /process\.env\.([A-Z_][A-Z0-9_]*(?:PASSWORD|SECRET|TOKEN|KEY|HASH|PRIVATE)[A-Z0-9_]*)\s*(\?\?|\|\|)\s*["']([^"']*)["']/g;

    it('no env-var that LOOKS like a secret has a literal fallback', () => {
      const matches: Match[] = [];
      for (const f of allFiles) {
        // Skip files that legitimately ship with a default secret —
        // namely the dev seed scripts (admin/Password1! is intentional)
        // and migrations (no env access there).
        if (
          f.includes('seed') ||
          f.includes('migrations') ||
          f.includes('/scripts/') ||
          f.endsWith('staticSecurityScan.test.ts')
        ) continue;
        const src = readFileSync(f, 'utf8');
        const lines = src.split(/\r?\n/);
        let m: RegExpExecArray | null;
        SECRET_NAME.lastIndex = 0;
        while ((m = SECRET_NAME.exec(src)) !== null) {
          const literal = m[3];
          // Empty-string fallback is fine — usually means "feature
          // disabled", caught downstream by a not-empty check.
          if (literal === '') continue;
          // Locate the line
          const offset = m.index;
          let lineNo = 1;
          let cursor = 0;
          for (const line of lines) {
            cursor += line.length + 1;
            if (cursor > offset) break;
            lineNo++;
          }
          matches.push({
            file: relative(SRC_ROOT, f),
            line: lineNo,
            text: lines[lineNo - 1]?.trim().slice(0, 120) ?? '',
          });
        }
      }
      if (matches.length > 0) {
        const formatted = matches
          .map((m) => `  ${m.file}:${m.line}  ${m.text}`)
          .join('\n');
        throw new Error(
          `Found hardcoded fallback for a secret-bearing env var:\n${formatted}`,
        );
      }
      expect(matches).toHaveLength(0);
    });
  });

  // ────────────────────────────────────────────────────────────────
  // OWASP A02 — password_hash leakage in serializers
  // ────────────────────────────────────────────────────────────────
  describe('OWASP A02 — password_hash never reaches the response layer', () => {
    it('no controller / route / response-builder references password_hash', () => {
      // password_hash is legitimate in:
      //   - Repository layer (column read for auth)
      //   - authService / authRoutes / breakGlassRoutes (bcrypt compare)
      //   - staffService (hashes the password before INSERT)
      //   - provisioningService (hashes the first-admin password during
      //     clinic provisioning — same role as staffService for the
      //     bootstrap user)
      //   - patient-app routes (parallel auth flow for the patient-
      //     facing portal)
      //   - utils/logger.ts (redaction allowlist — defensive)
      //   - seed files (write the hash on demo data load)
      //
      // Anywhere else — non-auth controllers, routes, response
      // mappers — is a leak risk and the test fails. The real
      // production safety net is the SAFE_STAFF_COLUMNS allowlist
      // in staffRepository.ts (audited in the survey); this test
      // catches the negative space.
      const ALLOWED = (f: string): boolean =>
        f.endsWith('Repository.ts') ||
        f.includes('/repository') ||
        f.includes('/db/types/') ||
        f.includes('/features/auth/') ||
        f.includes('/features/patient-app/') ||
        f.includes('/features/provisioning/') ||
        f.endsWith('staffService.ts') ||
        f.endsWith('utils/phiFields.ts') ||
        f.endsWith('utils/logger.ts') ||
        f.includes('seed');

      const matches: Match[] = [];
      for (const f of allFiles) {
        if (ALLOWED(f)) continue;
        const lines = readFileSync(f, 'utf8').split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          if (/password_hash/.test(lines[i])) {
            matches.push({
              file: relative(SRC_ROOT, f),
              line: i + 1,
              text: lines[i].trim().slice(0, 120),
            });
          }
        }
      }
      if (matches.length > 0) {
        const formatted = matches
          .map((m) => `  ${m.file}:${m.line}  ${m.text}`)
          .join('\n');
        throw new Error(
          `password_hash referenced outside the safe-list:\n${formatted}`,
        );
      }
      expect(matches).toHaveLength(0);
    });
  });
});
