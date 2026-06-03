/*
 * eslint-plugins/signacare-rules/rules/no-empty-catch-on-safety-surface.js
 *
 * BUG-531 — bans empty `} catch { }` blocks on production safety
 * surfaces (paths in `.github/safety-surfaces.txt`).
 *
 * The rule's load-bearing structural link is the suggestion text:
 * it MUST contain `tryAsync`, `isErr`, and `@signacare/shared` so that
 * the autofix points at BUG-530's just-shipped Result<T, AppError>
 * SSoT. Pinned by the R-FIX-BUG-531-AUTOFIX-POINTS-AT-TRYASYNC anchor.
 *
 * Allowlist (TIGHTER than check-no-silent-catches.sh): only
 *   "intentional silent — <reason>" and "allowed silent — <reason>"
 * are honoured. Other comment forms ("TODO: handle", "ignore",
 * "best-effort") are rejected because those WERE the
 * BUG-441/442/443/444 anti-pattern shape. The shell-script keeps its
 * broader allowlist for files OFF safety surfaces; this rule ratchets
 * the bar where patient data flows.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ALLOWLIST_PHRASE_RE = /(intentional silent|allowed silent)/i;

// Module-level cache of parsed safety-surface patterns, keyed by the
// resolved absolute path of the safety-surfaces.txt file. Lifetime is
// the Node process — ESLint typically runs as one process per workspace
// so the cache covers the full lint run.
const surfacesCache = new Map();

let degradedWarningEmitted = false;

function loadSurfaces(filePath) {
  if (surfacesCache.has(filePath)) return surfacesCache.get(filePath);
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch (_e) {
    if (!degradedWarningEmitted) {
      // eslint-disable-next-line no-console
      console.warn(
        `[signacare-rules/no-empty-catch-on-safety-surface] safety-surfaces.txt not found at ${filePath}; rule is INERT for this run.`,
      );
      degradedWarningEmitted = true;
    }
    surfacesCache.set(filePath, null);
    return null;
  }
  const patterns = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    patterns.push(trimmed);
  }
  surfacesCache.set(filePath, patterns);
  return patterns;
}

function resolveSurfacesPath(context) {
  const explicit = context.options?.[0]?.safetySurfacesPath;
  if (explicit) return path.resolve(explicit);
  // Walk up from cwd looking for .github/safety-surfaces.txt.
  let dir = context.cwd || process.cwd();
  for (;;) {
    const candidate = path.join(dir, '.github', 'safety-surfaces.txt');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return path.join(context.cwd || process.cwd(), '.github', 'safety-surfaces.txt');
    dir = parent;
  }
}

function relPath(filename, cwd) {
  if (!filename) return '';
  const abs = path.isAbsolute(filename) ? filename : path.resolve(cwd || process.cwd(), filename);
  const root = cwd || process.cwd();
  if (abs.startsWith(root + path.sep)) return abs.slice(root.length + 1);
  // Filename was already a relative path that wasn't resolvable to inside cwd.
  // Fall back to the original.
  return filename.startsWith('/') ? filename : filename;
}

/**
 * Bash-prefix-match semantics, mirroring `.github/scripts/check-atomic-flip.sh`:
 *   - pattern with trailing '/' → directory; matches any descendant
 *   - no-trailing-slash pattern → exact file match
 */
function matchesSafetySurface(rel, patterns) {
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

function commentBodyText(node, sourceCode) {
  // Returns concatenated text of every comment inside the catch body,
  // including line and block comments. Used for allowlist-phrase match.
  const comments = sourceCode.getCommentsInside(node);
  if (!comments || comments.length === 0) return '';
  return comments.map((c) => c.value).join('\n');
}

/**
 * Build the suggestion replacement text. Wraps the original try body
 * in `tryAsync(async () => { ... })` and forces `isErr` narrowing on
 * the result. Includes a TODO comment listing the three canonical
 * handler shapes so the developer picks the right one for their
 * surface (route / UI / service).
 *
 * Multi-statement try bodies are wrapped intact — the arrow's lexical
 * scope preserves outer-variable assignments. `r.value` is left as a
 * comment hint because the rule cannot infer the caller's intent.
 */
function buildSuggestionText(tryNode, sourceCode) {
  const tryBlock = tryNode.block;
  const innerSource = sourceCode.getText(tryBlock);
  return [
    '// BUG-531 suggestion: replace silent catch with tryAsync from @signacare/shared.',
    'const r = await tryAsync(async () => ' + innerSource + ');',
    'if (isErr(r)) {',
    '  // TODO(BUG-531): replace with proper handler:',
    '  //   a) backend route: next(r.error)',
    '  //   b) frontend UI: setStatus(UIStatus.failed(r.error, () => refetch()))',
    '  //   c) service method: return Result.err(r.error)',
    '  throw r.error;',
    '}',
    '// r.value is available here if the original try body returned a value.',
  ].join('\n');
}

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Ban empty `} catch { }` blocks on production safety surfaces (BUG-531; subsumes BUG-516). Suggests tryAsync from @signacare/shared.',
      url: 'https://github.com/Signacare/Signacare/blob/main/CLAUDE.md#34-service-layer-expected-failures',
    },
    hasSuggestions: true,
    schema: [
      {
        type: 'object',
        properties: {
          safetySurfacesPath: { type: 'string' },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      emptyCatchOnSafetySurface:
        "Empty catch block on safety surface ({{filename}}). Silent error suppression on patient-data paths is the BUG-441/442/443/444/516/517/519/520/523 root cause — see CLAUDE.md §3.4 + §16.2. Replace with tryAsync from @signacare/shared, or annotate with '// intentional silent — <reason>' if truly intentional.",
      replaceWithTryAsync:
        'Replace silent catch with tryAsync from @signacare/shared and explicit error handling',
    },
  },

  create(context) {
    const surfacesPath = resolveSurfacesPath(context);
    const patterns = loadSurfaces(surfacesPath);
    if (patterns === null) {
      // Graceful-degrade: rule is inert for this run.
      return {};
    }

    const filename = context.filename || context.getFilename?.() || '';
    const cwd = context.cwd || process.cwd();
    const rel = relPath(filename, cwd);
    if (!matchesSafetySurface(rel, patterns)) {
      // Not a safety surface; skip.
      return {};
    }

    const sourceCode = context.sourceCode || context.getSourceCode();

    return {
      CatchClause(node) {
        if (
          !node.body ||
          node.body.type !== 'BlockStatement' ||
          node.body.body.length !== 0
        ) {
          return;
        }

        // Comment-only allowlist check.
        const commentText = commentBodyText(node.body, sourceCode);
        if (commentText && ALLOWLIST_PHRASE_RE.test(commentText)) {
          return;
        }

        // Find the parent TryStatement so the suggestion can replace it
        // wholesale with the tryAsync rewrite.
        let tryNode = node.parent;
        while (tryNode && tryNode.type !== 'TryStatement') {
          tryNode = tryNode.parent;
        }

        context.report({
          node,
          messageId: 'emptyCatchOnSafetySurface',
          data: { filename: rel },
          suggest: [
            {
              messageId: 'replaceWithTryAsync',
              fix(fixer) {
                if (!tryNode) return null;
                return fixer.replaceText(tryNode, buildSuggestionText(tryNode, sourceCode));
              },
            },
          ],
        });
      },
    };
  },
};
