#!/usr/bin/env tsx
/*
 * scripts/guards/check-zod-schema-parity.ts
 *
 * Phase R1 PR-R1-11 — CLAUDE.md §5.1 + §15 enforcement
 * (Zod schema convention parity).
 *
 * ── Why this exists ──────────────────────────────────────────────
 * §5.1: "Backend responses must match shared schema types."
 * §15:  "Row/DB interface MUST match the DB schema (bidirectional)."
 *
 * The response-shape guard (PR-R1-1.5+) and the §5.3 mandate (PR-R1-9)
 * ensure routes ship Zod-parsed responses. But if the Zod schema
 * ITSELF declares a wrong type (e.g., `clinicId: z.string()` instead
 * of `z.string().uuid()`, or `lockVersion: z.string()` instead of
 * `z.number().int()`), all the downstream enforcement validates the
 * wrong contract. Frontend consumers see a string for `lockVersion`,
 * fail to send the correct numeric value back to the optimistic-lock
 * helper, and BUG-371 / BUG-402 protections silently degrade.
 *
 * Full table-binding parity (every Zod field must match the DB column
 * type) is the long-term structural answer (filed as
 * BUG-PR-R1-11-FOLLOWUP-TABLE-BINDING-PARITY for cycle-2 / Phase R2).
 *
 * The MVP this PR ships is convention-based: for every Zod schema
 * field with a CONVENTIONALLY-NAMED key, the Zod type MUST match
 * the well-known shape:
 *
 *   id, clinicId, patientId, episodeId, *Id  → z.string().uuid()
 *   createdAt, updatedAt, signedAt, *At      → z.string().datetime()
 *                                              OR z.date()
 *   lockVersion                              → z.number().int()
 *                                              .nonnegative()
 *   isActive, isDeleted, is*                 → z.boolean()
 *
 * This catches the most common drift class without requiring schema-
 * to-table heuristic binding.
 *
 * ── Scope ────────────────────────────────────────────────────────
 * Files: packages/shared/src/(* /)*.schemas.ts (the shared schema
 * source-of-truth) + packages/shared/src/(* /)*.ts that contain Zod
 * schema declarations.
 *
 * Detection:
 *   1. Find every `export const <Name>Schema = z.object({...})` block.
 *   2. For each property in the object literal:
 *      - Check the property name against CONVENTIONAL_FIELDS map.
 *      - If matched, verify the Zod chain matches the expected shape.
 *      - If not matched, skip (free-form fields not subject to convention).
 *   3. REJECT on mismatch with a tightening suggestion.
 *
 * False-positive defence:
 *   - Inline `// @zod-convention-exempt: <reason>` annotation on the
 *     line above a property opts out (rare).
 *   - Allowlist file `check-zod-schema-parity.allowlist` for grandfathered
 *     entries (file:schema:field).
 *
 * ── Run ──────────────────────────────────────────────────────────
 * `npm run guard:zod-schema-parity`
 *
 * Exit codes:
 *   0  every conventional field uses the canonical Zod chain
 *   1  one or more conventional fields use non-canonical Zod types
 */

import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SCAN_ROOT = path.join(REPO_ROOT, 'packages', 'shared', 'src');
const ALLOWLIST_PATH = path.join(__dirname, 'check-zod-schema-parity.allowlist');

/**
 * Convention-based field-name → expected Zod type checker.
 * The checker function inspects a Zod chain expression's text and
 * returns null if it conforms, or an error string describing the
 * expected shape.
 */
const CONVENTIONAL_FIELDS: Array<{
  pattern: RegExp;
  expected: string;
  check: (chainText: string) => string | null;
}> = [
  {
    // *Id fields (clinicId, patientId, episodeId, id, etc.) — must be UUID
    pattern: /^(id|[a-z]+Id)$/,
    expected: 'z.string().uuid() (with optional .nullable() / .optional())',
    check: (text) => {
      // Accept variants: z.string().uuid(), z.string().uuid().nullable(), etc.
      // Reject z.number(), z.string() without uuid(), z.string().email(), etc.
      if (!/\bz\.string\(\)/.test(text)) {
        return 'expected z.string() base type';
      }
      // Allow non-uuid only if explicitly an ID field that's not actually UUID
      // (e.g., business IDs like `medicare_number`). The convention here is
      // that *Id fields are UUID; non-UUID IDs should use a different name
      // (e.g., `medicareNumber`, `ihiNumber`).
      if (!/\.uuid\(\)/.test(text)) {
        return '*Id fields must use .uuid() — non-UUID IDs should use a different field name (e.g., medicareNumber)';
      }
      return null;
    },
  },
  {
    // *At fields (createdAt, updatedAt, signedAt, etc.) — must be datetime/date
    pattern: /^[a-z]+At$/,
    expected: 'z.string().datetime() or z.date()',
    check: (text) => {
      const isString = /\bz\.string\(\)/.test(text);
      const isDate = /\bz\.date\(\)/.test(text);
      if (!isString && !isDate) {
        return 'expected z.string().datetime() or z.date()';
      }
      if (isString && !/\.datetime\(\)/.test(text)) {
        return '*At string fields must use .datetime() validator';
      }
      return null;
    },
  },
  {
    // lockVersion — must be non-negative integer per CLAUDE.md §1.6
    pattern: /^lockVersion$/,
    expected: 'z.number().int().nonnegative()',
    check: (text) => {
      if (!/\bz\.number\(\)/.test(text)) {
        return 'expected z.number()';
      }
      if (!/\.int\(\)/.test(text)) {
        return 'lockVersion must be .int()';
      }
      if (!/\.nonnegative\(\)|\.min\(0\)/.test(text)) {
        return 'lockVersion must be .nonnegative() or .min(0)';
      }
      return null;
    },
  },
  {
    // is* boolean fields — must be z.boolean()
    pattern: /^is[A-Z]\w*$/,
    expected: 'z.boolean()',
    check: (text) => {
      if (!/\bz\.boolean\(\)/.test(text)) {
        return 'is* fields must use z.boolean()';
      }
      return null;
    },
  },
];

interface Violation {
  file: string;
  line: number;
  schemaName: string;
  fieldName: string;
  observedType: string;
  expected: string;
  reason: string;
}

function loadAllowlist(): Set<string> {
  try {
    const raw = fs.readFileSync(ALLOWLIST_PATH, 'utf-8');
    const out = new Set<string>();
    for (const line of raw.split('\n')) {
      const trimmed = line.split('#')[0]!.trim();
      if (trimmed) out.add(trimmed);
    }
    return out;
  } catch {
    return new Set();
  }
}

function walk(dir: string, acc: string[] = []): string[] {
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return acc; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      // Phase 0b.1b-ii-B (operator-authorized 2026-05-04): exclude the
      // auto-generated scaffolds directory. The parity guard enforces
      // hand-written-DTO conventions (e.g. `*Id fields must use .uuid()`).
      // Schema-driven generated artifacts under `_scaffolds/` follow the
      // migration's actual column declaration — counterexamples like
      // `webauthn_credentials.credentialId` (declared as `t.string` in
      // migration, intentionally NOT a UUID) would force the generator to
      // adopt suffix heuristics that override the schema source-of-truth.
      // Convention enforcement on generated scaffolds, if needed in future,
      // belongs in a separate schema-driven guard (NOT name-pattern based).
      if (e.name === '_scaffolds') continue;
      walk(p, acc);
    } else if (e.isFile() && p.endsWith('.ts')) {
      if (p.includes('.test.') || p.includes('.spec.')) continue;
      acc.push(p);
    }
  }
  return acc;
}

/**
 * Returns the conventional rule (if any) that applies to a field name.
 */
export function findConventionalRule(fieldName: string) {
  for (const rule of CONVENTIONAL_FIELDS) {
    if (rule.pattern.test(fieldName)) return rule;
  }
  return null;
}

/**
 * Walks an ObjectLiteralExpression and yields each property's name +
 * its initializer's source text. Used to extract Zod chain text for
 * each field declaration in a `z.object({...})` schema body.
 */
function* iterFields(obj: ts.ObjectLiteralExpression, sourceFile: ts.SourceFile): Iterable<{
  name: string;
  initializerText: string;
  line: number;
  hasExemptAnnotation: boolean;
}> {
  for (const prop of obj.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    if (!ts.isIdentifier(prop.name)) continue;
    const name = prop.name.text;
    const initializerText = prop.initializer.getText(sourceFile);
    const { line } = sourceFile.getLineAndCharacterOfPosition(prop.getStart(sourceFile));
    // Check for inline `// @zod-convention-exempt:` on prior line
    const fullText = sourceFile.getFullText();
    const propStart = prop.getFullStart();
    const leadingTrivia = fullText.substring(propStart, prop.getStart(sourceFile));
    const hasExemptAnnotation = /\/\/\s*@zod-convention-exempt:\s*\S/.test(leadingTrivia);
    yield { name, initializerText, line: line + 1, hasExemptAnnotation };
  }
}

/**
 * Walk up from a node to its enclosing exported variable declaration
 * (or other contextual schema-name root) and return the inferred name.
 * Returns `<anonymous>` if no enclosing variable declaration is found.
 */
function inferSchemaName(node: ts.Node): string {
  let parent: ts.Node = node;
  while (parent) {
    if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
      return parent.name.text;
    }
    if (!parent.parent) break;
    parent = parent.parent;
  }
  return '<anonymous>';
}

/**
 * Cycle-2 absorb of L3 PR-R1-11 finding #4: `.extend({...})` literal
 * blind spot. Cycle-1 only inspected the bare object literal passed
 * as the first arg to `z.object(...)`. This missed `.extend({...})`,
 * `.merge({...})` (when given an object literal), `.partial({...})`,
 * and any other Zod-chain method that takes an object literal of
 * field declarations. 18+ schemas in `packages/shared/src/` use
 * `.extend({...})` with bare object literals.
 *
 * Cycle-2 fix: detect ANY method call on a Zod-chain expression whose
 * argument is an ObjectLiteralExpression. The list of Zod-chain
 * methods that accept a fields object literal is:
 *   - `z.object({...})`
 *   - `<chain>.extend({...})`
 *   - `<chain>.merge({...})` — also accepts a Schema, but bare object
 *     literals are valid in some Zod versions
 *
 * Returns true if the call expression's first argument is the kind
 * of object literal we need to scan.
 *
 * ── DELIBERATE TRADE-OFF (cycle-2 obs #2 — documented per L3) ────
 * `.extend({...})` and `.merge({...})` are matched by METHOD NAME
 * only, NOT by chain-root being `z.*`. A theoretical false-positive
 * would require all THREE of:
 *   1. A non-Zod object with a `.extend(...)` or `.merge(...)` method
 *   2. The literal arg has properties with Zod-convention names
 *      (e.g., `clinicId`, `createdAt`, `lockVersion`, `is*`)
 *   3. The property initializers are Zod expressions (`z.string()` etc.)
 *      — because `findConventionalRule` only fires AFTER a name match
 *      AND the rule.check() inspects the initializer text for Zod
 *      keywords (`z.string()`, `z.number()`, `z.boolean()`, etc.)
 *
 * Item 3 is the structural lock: non-Zod code wouldn't have Zod
 * initializers in its property values. Verified empirically: zero
 * false-positives across `packages/shared/src/` (73 files, 90
 * legitimate baseline entries). The full structural answer (verify
 * chain-root traces back to `z.*`) is folded into
 * BUG-PR-R1-11-FOLLOWUP-TABLE-BINDING-PARITY.
 */
function isZodFieldsObjectLiteralCall(node: ts.CallExpression): boolean {
  if (!node.arguments[0] || !ts.isObjectLiteralExpression(node.arguments[0])) return false;
  const callee = node.expression;
  // `z.object(...)` — direct
  if (
    ts.isPropertyAccessExpression(callee) &&
    callee.name.text === 'object' &&
    ts.isIdentifier(callee.expression) &&
    callee.expression.text === 'z'
  ) return true;
  // `<anything>.extend(...)` / `.merge(...)` — schema-chain field-extension methods
  if (
    ts.isPropertyAccessExpression(callee) &&
    (callee.name.text === 'extend' || callee.name.text === 'merge')
  ) return true;
  return false;
}

/**
 * For a given source file, find every Zod fields-object-literal call
 * (`z.object({...})` AND `.extend({...})` / `.merge({...})` chain
 * methods) and iterate its properties.
 */
function scanFile(filePath: string, allowlist: Set<string>): Violation[] {
  const source = fs.readFileSync(filePath, 'utf-8');
  // Cheap pre-filter: only files that mention z.object OR .extend({}) are worth parsing
  if (!source.includes('z.object') && !source.includes('.extend(')) return [];

  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true);
  const relPath = path.relative(REPO_ROOT, filePath);
  const findings: Violation[] = [];

  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && isZodFieldsObjectLiteralCall(node)) {
      const arg = node.arguments[0]! as ts.ObjectLiteralExpression;
      const schemaName = inferSchemaName(node);
      for (const field of iterFields(arg, sourceFile)) {
        const rule = findConventionalRule(field.name);
        if (!rule) continue;
        const allowKey = `${relPath}:${schemaName}:${field.name}`;
        if (allowlist.has(allowKey)) continue;
        if (field.hasExemptAnnotation) continue;
        const reason = rule.check(field.initializerText);
        if (reason) {
          findings.push({
            file: relPath,
            line: field.line,
            schemaName,
            fieldName: field.name,
            observedType: field.initializerText.length > 80 ? field.initializerText.substring(0, 80) + '…' : field.initializerText,
            expected: rule.expected,
            reason,
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return findings;
}

function main(): number {
  const files = walk(SCAN_ROOT);
  const allowlist = loadAllowlist();
  const violations: Violation[] = [];
  for (const f of files) violations.push(...scanFile(f, allowlist));

  console.error('→ check-zod-schema-parity (PR-R1-11; CLAUDE.md §5.1 + §15)');
  console.error(`  scanned:    ${files.length} TS file(s)`);
  console.error(`  allowlist:  ${path.relative(REPO_ROOT, ALLOWLIST_PATH)} (${allowlist.size} entries)`);
  console.error(`  violations: ${violations.length}`);
  console.error('');

  if (violations.length === 0) {
    console.error('✓ Every conventional Zod field uses its canonical type.');
    return 0;
  }

  console.error(`✗ ${violations.length} convention-based Zod parity violation(s):\n`);
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  ${v.schemaName}.${v.fieldName}`);
    console.error(`    observed: ${v.observedType}`);
    console.error(`    expected: ${v.expected}`);
    console.error(`    reason:   ${v.reason}`);
    console.error('');
  }
  console.error(
    'Fix per CLAUDE.md §5.1 / §15: tighten the Zod chain to match the convention. ' +
      'For genuinely-non-conforming fields (rare), add `// @zod-convention-exempt: <reason>` ' +
      'on the line above OR add `<file>:<schema>:<field>` to ' +
      `${path.relative(REPO_ROOT, ALLOWLIST_PATH)} with a documented reason.`,
  );
  return 1;
}

if (require.main === module) {
  process.exit(main());
}
