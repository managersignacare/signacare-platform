/*
 * eslint-plugins/signacare-rules/rules/no-onclick-on-mui-container.js
 *
 * BUG-447-CASCADE-1 — bans `onClick` on MUI primitive components
 * (`<Box>` / `<Paper>` / `<Card>` / `<Typography>`) UNLESS one of:
 *   (a) `role="button"` AND `tabIndex={0}` AND `onKeyDown={...}`
 *       — full WCAG 2.1.1 keyboard-operability compliance
 *   (b) `component="button"` — MUI renders the primitive as a
 *       native `<button>` which is keyboard-accessible by default
 *
 * Why this rule exists.
 * Off-the-shelf `eslint-plugin-jsx-a11y/click-events-have-key-events`
 * cannot detect this pattern because MUI's `<Box>` / `<Paper>` /
 * `<Card>` / `<Typography>` are React components whose runtime DOM
 * element is `<div>` (or whatever `component=` overrides). At parse
 * time, the rule sees a JSX element with a capitalized name and skips
 * it (jsx-a11y only fires on lowercase HTML primitives). The custom
 * rule plugs that gap.
 *
 * Why the four MUI components.
 * Plan-agent inventory (BUG-447 split, 2026-04-27): 100% of the 67
 * keyboard-inaccessible elements in the codebase are one of `<Box
 * onClick>` (42), `<Paper onClick>` (14), `<Card onClick>` (12), or
 * `<Typography onClick>` (3). No other MUI primitive used as a click
 * target in this codebase. Adding more components later (e.g. `<Stack
 * onClick>`) is a one-line change to the OFFENDING_COMPONENTS set.
 *
 * Scope: rule fires EVERYWHERE in `apps/web/src/**` UNLESS the file is
 * on the path-scoped allowlist (BUG-531 precedent). Initial allowlist
 * contains the 36 known-violation files at cascade-time; each child
 * commit (1/15..15/15) removes its file(s) from the allowlist as the
 * violations are fixed. When the allowlist is empty, BUG-447 is
 * structurally complete.
 *
 * Allowlist file: `.github/no-onclick-on-mui-container.allowlist`
 *   — one path per line, lines starting with `#` are comments,
 *     blank lines ignored.
 *
 * fix-registry anchors:
 *   R-FIX-BUG-447-CASCADE-1-RULE-EXPORTS — rule module exists +
 *     exports `meta` + `create`.
 *   R-FIX-BUG-447-CASCADE-1-OFFENDING-COMPONENTS — pin the four MUI
 *     primitives in the OFFENDING_COMPONENTS set.
 *   R-FIX-BUG-447-CASCADE-1-ESCAPE-HATCH-COMPONENT-BUTTON — pin the
 *     `component="button"` escape-hatch branch.
 *   R-FIX-BUG-447-CASCADE-1-ESLINT-RULE-WIRED — the rule is wired in
 *     `.eslintrc.cjs` at level `error`.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const OFFENDING_COMPONENTS = new Set(['Box', 'Paper', 'Card', 'Typography']);

const allowlistCache = new Map();
let degradedWarningEmitted = false;

function loadAllowlist(filePath) {
  if (allowlistCache.has(filePath)) return allowlistCache.get(filePath);
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch (_e) {
    if (!degradedWarningEmitted) {
      // eslint-disable-next-line no-console
      console.warn(
        `[signacare-rules/no-onclick-on-mui-container] allowlist not found at ${filePath}; rule fires everywhere (no exemptions).`,
      );
      degradedWarningEmitted = true;
    }
    allowlistCache.set(filePath, []);
    return [];
  }
  const patterns = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    patterns.push(trimmed);
  }
  allowlistCache.set(filePath, patterns);
  return patterns;
}

function resolveAllowlistPath(context) {
  const explicit = context.options?.[0]?.allowlistPath;
  if (explicit) return path.resolve(explicit);
  let dir = context.cwd || process.cwd();
  for (;;) {
    const candidate = path.join(dir, '.github', 'no-onclick-on-mui-container.allowlist');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) {
      return path.join(context.cwd || process.cwd(), '.github', 'no-onclick-on-mui-container.allowlist');
    }
    dir = parent;
  }
}

function relPath(filename, cwd) {
  if (!filename) return '';
  const abs = path.isAbsolute(filename) ? filename : path.resolve(cwd || process.cwd(), filename);
  const root = cwd || process.cwd();
  if (abs.startsWith(root + path.sep)) return abs.slice(root.length + 1);
  return filename.startsWith('/') ? filename : filename;
}

function matchesAllowlist(rel, patterns) {
  if (!patterns || patterns.length === 0) return false;
  for (const p of patterns) {
    if (p.endsWith('/')) {
      if (rel.startsWith(p)) return true;
    } else if (rel === p) {
      return true;
    }
  }
  return false;
}

/**
 * Extract the JSX element name. Handles plain identifiers (`<Box>`)
 * and member expressions (`<MyLib.Box>` — first segment matches
 * `MyLib`, NOT the offending Box; we skip these because we can't
 * statically know what `MyLib.Box` renders).
 */
function getElementName(node) {
  if (!node || !node.name) return null;
  if (node.name.type === 'JSXIdentifier') return node.name.name;
  return null;
}

/**
 * Look up a JSX attribute on the opening element. Returns the
 * AST node, or undefined if absent.
 */
function getAttr(node, attrName) {
  return node.attributes.find(
    (a) => a.type === 'JSXAttribute' && a.name?.name === attrName,
  );
}

/**
 * Resolve a JSX attribute's STATIC value to a primitive (string |
 * number | boolean | null) when knowable; returns the special
 * sentinel `EXPRESSION` when the value is a runtime expression we
 * can't evaluate, or `undefined` if the attribute is absent.
 *
 * Examples:
 *   role="button"         → 'button'
 *   tabIndex={0}          → 0
 *   tabIndex={someVar}    → 'EXPRESSION'
 *   tabIndex              → true     (boolean shorthand)
 */
const EXPRESSION = Symbol('expression');
function getAttrStaticValue(attr) {
  if (!attr) return undefined;
  if (!attr.value) return true; // boolean shorthand
  if (attr.value.type === 'Literal') return attr.value.value;
  if (attr.value.type === 'JSXExpressionContainer') {
    const expr = attr.value.expression;
    if (expr.type === 'Literal') return expr.value;
    if (expr.type === 'UnaryExpression' && expr.operator === '-' && expr.argument?.type === 'Literal') {
      return -expr.argument.value;
    }
    return EXPRESSION;
  }
  return EXPRESSION;
}

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Ban `onClick` on MUI primitives (Box/Paper/Card/Typography) without keyboard-operability props (role + tabIndex={0} + onKeyDown). WCAG 2.1.1 (BUG-447).',
      url: 'https://www.w3.org/WAI/WCAG21/Understanding/keyboard.html',
    },
    schema: [
      {
        type: 'object',
        properties: {
          allowlistPath: { type: 'string' },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      noOnClickOnMuiContainer:
        'WCAG 2.1.1 violation ({{filename}}): `<{{elementName}} onClick>` is not keyboard-operable. ' +
        'Add `role="button"` + `tabIndex={0}` + `onKeyDown={...}` to handle Enter/Space, OR set ' +
        '`component="button"` to render as a native button. ' +
        'Keyboard-only clinicians depend on this. See BUG-447.',
    },
  },

  create(context) {
    const allowlistPath = resolveAllowlistPath(context);
    const patterns = loadAllowlist(allowlistPath);

    const filename = context.filename || context.getFilename?.() || '';
    const cwd = context.cwd || process.cwd();
    const rel = relPath(filename, cwd);

    if (matchesAllowlist(rel, patterns)) {
      // File is on the BUG-447 campaign initial allowlist; rule is
      // inert until its child commit removes the entry.
      return {};
    }

    return {
      JSXOpeningElement(node) {
        const elementName = getElementName(node);
        if (!elementName || !OFFENDING_COMPONENTS.has(elementName)) return;

        const onClickAttr = getAttr(node, 'onClick');
        if (!onClickAttr) return;

        // Escape hatch (b): `component="button"` renders as <button>
        const componentVal = getAttrStaticValue(getAttr(node, 'component'));
        if (componentVal === 'button') return;

        // Escape hatch (a): role="button" AND tabIndex===0 AND onKeyDown present
        const roleVal = getAttrStaticValue(getAttr(node, 'role'));
        const tabIndexVal = getAttrStaticValue(getAttr(node, 'tabIndex'));
        const onKeyDownAttr = getAttr(node, 'onKeyDown');
        if (
          roleVal === 'button'
          && tabIndexVal === 0
          && onKeyDownAttr
        ) {
          return;
        }

        context.report({
          node,
          messageId: 'noOnClickOnMuiContainer',
          data: { filename: rel, elementName },
        });
      },
    };
  },
};
