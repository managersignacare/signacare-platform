/*
 * eslint-plugins/signacare-rules/rules/__tests__/no-empty-catch-on-safety-surface.test.js
 *
 * BUG-531 — 12 cases (EC-1 .. EC-10 + EC-4b + EC-5b) pinning the
 * `no-empty-catch-on-safety-surface` rule contract.
 *
 * Pre-fix RED: rule does not exist; require() fails to resolve.
 * Post-fix GREEN: 12/12 pass; EC-6 pins suggestion-text contains
 * `tryAsync`, `isErr`, `@signacare/shared` (the structural link to
 * BUG-530 SSoT).
 */
import { describe, it } from 'vitest';
import { RuleTester, Linter } from 'eslint';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const rule = require('../no-empty-catch-on-safety-surface');

// Build a synthetic safety-surfaces.txt fixture so tests don't depend on
// the live repo file. Same prefix-match semantics as the production file.
function makeSurfacesFixture(lines) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bug-531-'));
  const file = path.join(dir, 'safety-surfaces.txt');
  fs.writeFileSync(file, lines.join('\n'));
  return file;
}

const SURFACES_FIXTURE = makeSurfacesFixture([
  'apps/api/src/features/medications/',
  'apps/web/src/features/patients/components/detail/tabs/MedicationsTab.tsx',
  'apps/web/src/features/beds/',
]);

const tsParser = require.resolve('@typescript-eslint/parser');

const ruleTester = new RuleTester({
  parser: tsParser,
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  },
});

// Convenience: build a `RuleTester.run` config with options pointing at
// the fixture safety-surfaces and a virtual filename.
function withSurface(filename) {
  return {
    options: [{ safetySurfacesPath: SURFACES_FIXTURE }],
    filename,
  };
}

describe('BUG-531 no-empty-catch-on-safety-surface', () => {
  it('runs all RuleTester cases (EC-1 .. EC-10 + EC-4b + EC-5b)', () => {
    ruleTester.run('no-empty-catch-on-safety-surface', rule, {
      valid: [
        // EC-3: non-empty catch body — no error
        {
          ...withSurface('apps/api/src/features/medications/medicationService.ts'),
          code: `
            async function f() {
              try { await foo(); }
              catch (e) { console.warn('failed', e); }
            }
          `,
        },

        // EC-4: comment-only allowlist 'allowed silent — reason'
        {
          ...withSurface('apps/api/src/features/medications/medicationService.ts'),
          code: `
            async function f() {
              try { await foo(); }
              catch { /* allowed silent — repository idempotent on duplicate */ }
            }
          `,
        },

        // EC-4b: comment-only allowlist 'intentional silent — reason'
        {
          ...withSurface('apps/api/src/features/medications/medicationService.ts'),
          code: `
            async function f() {
              try { JSON.parse(s); }
              catch { /* intentional silent — JSON best-effort parse */ }
            }
          `,
        },

        // EC-5: empty catch in NON-safety-surface file (path-scope respected)
        {
          ...withSurface('apps/api/src/scripts/migration-helper.ts'),
          code: `
            async function f() {
              try { await foo(); }
              catch { }
            }
          `,
        },
      ],

      invalid: [
        // EC-1: empty `} catch { }` in safety-surface file
        {
          ...withSurface('apps/api/src/features/medications/medicationService.ts'),
          code: `
            async function f() {
              try { await foo(); }
              catch { }
            }
          `,
          errors: [
            {
              messageId: 'emptyCatchOnSafetySurface',
              suggestions: [{ messageId: 'replaceWithTryAsync' }],
            },
          ],
        },

        // EC-2: empty `} catch (e) { }` (named param, still empty)
        {
          ...withSurface('apps/api/src/features/medications/medicationService.ts'),
          code: `
            async function f() {
              try { await foo(); }
              catch (e) { }
            }
          `,
          errors: [
            {
              messageId: 'emptyCatchOnSafetySurface',
              suggestions: [{ messageId: 'replaceWithTryAsync' }],
            },
          ],
        },

        // EC-5b: empty catch in API safety-surface (different surface from EC-1)
        {
          ...withSurface('apps/web/src/features/beds/pages/BedBoardPage.tsx'),
          code: `
            async function f() {
              try { await refresh(); }
              catch { }
            }
          `,
          errors: [
            {
              messageId: 'emptyCatchOnSafetySurface',
              suggestions: [{ messageId: 'replaceWithTryAsync' }],
            },
          ],
        },

        // EC-6 base case: rule reports + a suggestion is offered.
        // Deeper EC-6 assertion below uses Linter directly to verify the
        // SSoT-link tokens (tryAsync / isErr / @signacare/shared) appear
        // in the suggestion's fix text.
        {
          ...withSurface('apps/api/src/features/medications/medicationService.ts'),
          code: `
            async function f() {
              try { await foo(); }
              catch { }
            }
          `,
          errors: [
            {
              messageId: 'emptyCatchOnSafetySurface',
              suggestions: [{ messageId: 'replaceWithTryAsync' }],
            },
          ],
        },

        // EC-9: tighter allowlist — `// TODO: handle` is NOT honoured
        {
          ...withSurface('apps/api/src/features/medications/medicationService.ts'),
          code: `
            async function f() {
              try { await foo(); }
              catch { /* TODO: handle */ }
            }
          `,
          errors: [
            {
              messageId: 'emptyCatchOnSafetySurface',
              suggestions: [{ messageId: 'replaceWithTryAsync' }],
            },
          ],
        },

        // EC-10: tighter allowlist — `// ignore` is NOT honoured (BUG-441 anti-pattern verbatim)
        {
          ...withSurface('apps/api/src/features/medications/medicationService.ts'),
          code: `
            async function f() {
              try { await foo(); }
              catch { /* ignore */ }
            }
          `,
          errors: [
            {
              messageId: 'emptyCatchOnSafetySurface',
              suggestions: [{ messageId: 'replaceWithTryAsync' }],
            },
          ],
        },
      ],
    });
  });

  it('EC-6 (deeper assertion): suggestion output contains the SSoT-link tokens', () => {
    const linter = new Linter();
    linter.defineRule('signacare-rules/no-empty-catch-on-safety-surface', rule);
    const code = "async function f() { try { await foo(); } catch { } }";
    const messages = linter.verify(code, {
      parser: 'ts-parser',
      parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
      rules: {
        'signacare-rules/no-empty-catch-on-safety-surface': [
          'error',
          { safetySurfacesPath: SURFACES_FIXTURE },
        ],
      },
    }, { filename: 'apps/api/src/features/medications/medicationService.ts' });
    // Register parser
    linter.defineParser('ts-parser', require(tsParser));
    const messages2 = linter.verify(code, {
      parser: 'ts-parser',
      parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
      rules: {
        'signacare-rules/no-empty-catch-on-safety-surface': [
          'error',
          { safetySurfacesPath: SURFACES_FIXTURE },
        ],
      },
    }, { filename: 'apps/api/src/features/medications/medicationService.ts' });
    if (messages2.length === 0) {
      throw new Error('EC-6 expected at least one report');
    }
    const suggestion = messages2[0].suggestions?.[0];
    if (!suggestion) throw new Error('EC-6 expected a suggestion');
    if (!suggestion.fix?.text?.includes('tryAsync')) {
      throw new Error(`EC-6 suggestion missing 'tryAsync': ${suggestion.fix?.text}`);
    }
    if (!suggestion.fix?.text?.includes('isErr')) {
      throw new Error(`EC-6 suggestion missing 'isErr': ${suggestion.fix?.text}`);
    }
    if (!suggestion.fix?.text?.includes('@signacare/shared')) {
      throw new Error(`EC-6 suggestion missing '@signacare/shared': ${suggestion.fix?.text}`);
    }
  });

  it('EC-7: graceful-degrade when safety-surfaces.txt is missing', () => {
    const linter = new Linter();
    linter.defineRule('signacare-rules/no-empty-catch-on-safety-surface', rule);
    linter.defineParser('ts-parser', require(tsParser));
    // Point at a non-existent path; rule must NOT throw and must NOT report.
    const messages = linter.verify(
      "async function f() { try { await foo(); } catch { } }",
      {
        parser: 'ts-parser',
        parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
        rules: {
          'signacare-rules/no-empty-catch-on-safety-surface': [
            'error',
            { safetySurfacesPath: '/nonexistent/path/safety-surfaces.txt' },
          ],
        },
      },
      { filename: 'apps/api/src/features/medications/medicationService.ts' },
    );
    if (messages.length !== 0) {
      throw new Error(`EC-7 expected NO reports on missing surfaces file; got: ${JSON.stringify(messages)}`);
    }
  });

  it('EC-8: filename normalisation handles relative AND absolute paths', () => {
    const linter = new Linter();
    linter.defineRule('signacare-rules/no-empty-catch-on-safety-surface', rule);
    linter.defineParser('ts-parser', require(tsParser));
    const cwd = process.cwd();
    const config = {
      parser: 'ts-parser',
      parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
      rules: {
        'signacare-rules/no-empty-catch-on-safety-surface': [
          'error',
          { safetySurfacesPath: SURFACES_FIXTURE },
        ],
      },
    };
    const code = "async function f() { try { await foo(); } catch { } }";

    // Relative path
    const rel = linter.verify(code, config, { filename: 'apps/api/src/features/medications/x.ts' });
    if (rel.length !== 1) throw new Error(`EC-8 relative expected 1 report; got ${rel.length}`);

    // Absolute path
    const abs = linter.verify(code, config, {
      filename: path.join(cwd, 'apps/api/src/features/medications/x.ts'),
    });
    if (abs.length !== 1) throw new Error(`EC-8 absolute expected 1 report; got ${abs.length}`);
  });
});
