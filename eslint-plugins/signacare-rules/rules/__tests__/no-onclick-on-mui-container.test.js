/*
 * eslint-plugins/signacare-rules/rules/__tests__/no-onclick-on-mui-container.test.js
 *
 * BUG-447-CASCADE-1 — RuleTester contract for the
 * `no-onclick-on-mui-container` rule. 14 cases pinning the contract:
 *
 *   PASS-A   compliant Box: role="button" + tabIndex={0} + onKeyDown
 *   PASS-B   compliant Paper: role="button" + tabIndex={0} + onKeyDown
 *   PASS-C   compliant Card with all three props
 *   PASS-D   Box with component="button" escape hatch
 *   PASS-E   regular `<Button onClick>` — rule does NOT fire (Button is
 *            keyboard-accessible by default)
 *   PASS-F   Box without onClick — no violation
 *   PASS-G   file on allowlist — rule inert
 *   FAIL-1   Box onClick missing all escape hatches
 *   FAIL-2   Paper onClick missing onKeyDown (has role + tabIndex only —
 *            the Sidebar.tsx:422 partial-aria pattern)
 *   FAIL-3   Card onClick missing tabIndex
 *   FAIL-4   Typography onClick missing role
 *   FAIL-5   Box onClick + tabIndex={-1} (NOT 0; not in tab order)
 *   FAIL-6   Box onClick + role="button" only (tabIndex undefined)
 *   FAIL-7   non-allowlist file — rule fires
 *
 * Pre-fix RED: rule does not exist; require() fails to resolve.
 * Post-fix GREEN: 14/14 pass.
 */
import { describe, it } from 'vitest';
import { RuleTester } from 'eslint';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const rule = require('../no-onclick-on-mui-container');

// Synthetic allowlist fixture so tests don't depend on the live file.
function makeAllowlistFixture(lines) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bug-447-cascade-'));
  const file = path.join(dir, 'no-onclick-on-mui-container.allowlist');
  fs.writeFileSync(file, lines.join('\n'));
  return file;
}

const ALLOWLIST_FIXTURE = makeAllowlistFixture([
  '# Initial allowlist for BUG-447 campaign — files to be fixed by per-feature children.',
  'apps/web/src/features/patients/components/detail/tabs/AllowedFile.tsx',
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

function withFile(filename) {
  return {
    options: [{ allowlistPath: ALLOWLIST_FIXTURE }],
    filename,
  };
}

const NON_ALLOWLISTED = path.join(
  process.cwd(),
  'apps/web/src/features/patients/components/detail/tabs/SomeTab.tsx',
);
const ALLOWLISTED = path.join(
  process.cwd(),
  'apps/web/src/features/patients/components/detail/tabs/AllowedFile.tsx',
);

describe('BUG-447-CASCADE-1 no-onclick-on-mui-container', () => {
  it('runs all RuleTester cases (PASS-A..G + FAIL-1..7)', () => {
    ruleTester.run('no-onclick-on-mui-container', rule, {
      valid: [
        // PASS-A: Box with all three escape hatches
        {
          code: `<Box onClick={() => {}} role="button" tabIndex={0} onKeyDown={() => {}}>x</Box>`,
          ...withFile(NON_ALLOWLISTED),
        },
        // PASS-B: Paper with all three
        {
          code: `<Paper onClick={() => {}} role="button" tabIndex={0} onKeyDown={() => {}}>x</Paper>`,
          ...withFile(NON_ALLOWLISTED),
        },
        // PASS-C: Card with all three
        {
          code: `<Card onClick={() => {}} role="button" tabIndex={0} onKeyDown={() => {}}>x</Card>`,
          ...withFile(NON_ALLOWLISTED),
        },
        // PASS-D: component="button" escape hatch
        {
          code: `<Box onClick={() => {}} component="button">x</Box>`,
          ...withFile(NON_ALLOWLISTED),
        },
        // PASS-E: regular Button is keyboard-accessible by default
        {
          code: `<Button onClick={() => {}}>x</Button>`,
          ...withFile(NON_ALLOWLISTED),
        },
        // PASS-F: Box without onClick — no violation
        {
          code: `<Box>x</Box>`,
          ...withFile(NON_ALLOWLISTED),
        },
        // PASS-G: allowlisted file — rule inert
        {
          code: `<Box onClick={() => {}}>x</Box>`,
          ...withFile(ALLOWLISTED),
        },
      ],
      invalid: [
        // FAIL-1: Box onClick with no escape hatches
        {
          code: `<Box onClick={() => {}}>x</Box>`,
          ...withFile(NON_ALLOWLISTED),
          errors: [{ messageId: 'noOnClickOnMuiContainer' }],
        },
        // FAIL-2: Paper missing onKeyDown (Sidebar.tsx:422 partial-aria)
        {
          code: `<Paper onClick={() => {}} role="button" tabIndex={0}>x</Paper>`,
          ...withFile(NON_ALLOWLISTED),
          errors: [{ messageId: 'noOnClickOnMuiContainer' }],
        },
        // FAIL-3: Card missing tabIndex
        {
          code: `<Card onClick={() => {}} role="button" onKeyDown={() => {}}>x</Card>`,
          ...withFile(NON_ALLOWLISTED),
          errors: [{ messageId: 'noOnClickOnMuiContainer' }],
        },
        // FAIL-4: Typography missing role
        {
          code: `<Typography onClick={() => {}} tabIndex={0} onKeyDown={() => {}}>x</Typography>`,
          ...withFile(NON_ALLOWLISTED),
          errors: [{ messageId: 'noOnClickOnMuiContainer' }],
        },
        // FAIL-5: tabIndex={-1} — not in tab order
        {
          code: `<Box onClick={() => {}} role="button" tabIndex={-1} onKeyDown={() => {}}>x</Box>`,
          ...withFile(NON_ALLOWLISTED),
          errors: [{ messageId: 'noOnClickOnMuiContainer' }],
        },
        // FAIL-6: role="button" only (no tabIndex, no onKeyDown)
        {
          code: `<Box onClick={() => {}} role="button">x</Box>`,
          ...withFile(NON_ALLOWLISTED),
          errors: [{ messageId: 'noOnClickOnMuiContainer' }],
        },
        // FAIL-7: any of Box/Paper/Card/Typography on a non-allowlisted file
        {
          code: `<Typography onClick={() => {}}>x</Typography>`,
          ...withFile(NON_ALLOWLISTED),
          errors: [{ messageId: 'noOnClickOnMuiContainer' }],
        },
      ],
    });
  });
});
