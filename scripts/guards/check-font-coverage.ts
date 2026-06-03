#!/usr/bin/env tsx
/**
 * check-font-coverage — PART 13 follow-up BUG-GUARD-FONT-COVERAGE (S3)
 *
 * Asserts two structural invariants on the web-side font stack:
 *
 *   1. **Coverage**: the union of fonts in `FONT_STACKS.body` and
 *      `FONT_STACKS.narrativeSerif` (palettes.ts SSoT) covers every script
 *      in `REQUIRED_SCRIPTS` per the FONT_SCRIPT_COVERAGE map. No script
 *      Signacare's AU clinical context requires can be silently dropped
 *      by a future font swap.
 *
 *   2. **Sync**: the union of (a) bundled families in
 *      `apps/web/public/fonts.css` `@font-face` blocks and (b) CDN families
 *      pulled by `<link>` tags in `apps/web/index.html` loads every
 *      non-system font that appears in `FONT_STACKS`. Drift between the
 *      served set and the family chain means either (a) the chain
 *      references a font that isn't loaded (silent fallback to system) or
 *      (b) the loader pulls a font that no chain references (wasted bytes).
 *
 * The guard does NOT verify actual rendering — it verifies static
 * configuration. Runtime rendering verification is a separate concern
 * tracked as a future BUG (visual diff at print time + per-script
 * sample-string rendering).
 *
 * Out of scope:
 *   - Flutter font coverage (Sara + Viva use OS-bundled Noto variants on
 *     modern iOS/Android; static guard cannot verify OS bundling).
 *   - Font binary integrity (covered by the browser at download time;
 *     SIL OFL licensing is documented inline).
 *
 * Exit codes:
 *   0 — all invariants hold
 *   1 — invariant violation (coverage gap or sync drift)
 *   2 — guard malfunction (file read error etc.)
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Import the SSoT directly — palettes.ts is pure (no React / MUI imports)
// so tsx can execute this guard against it without bundling cost.
import {
  FONT_STACKS,
  FONT_SCRIPT_COVERAGE,
  REQUIRED_SCRIPTS,
  type RequiredScript,
} from '../../apps/web/src/shared/theme/palettes';

const REPO_ROOT = resolve(__dirname, '..', '..');
const INDEX_HTML_PATH = resolve(REPO_ROOT, 'apps/web/index.html');
const LOCAL_FONTS_CSS_PATH = resolve(REPO_ROOT, 'apps/web/public/fonts.css');

/**
 * Extract individual font names from a font-family CSS string.
 * Handles quoted names with spaces (`"Albert Sans"`), unquoted names
 * (`Arial`), and generic families (`sans-serif`). Strips quotes.
 */
function parseFontFamilyStack(stack: string): string[] {
  return stack
    .split(',')
    .map(s => s.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean);
}

/** Generic CSS families that don't contribute named-font coverage. */
const GENERIC_FAMILIES = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy']);

/**
 * Extract font families requested from a Google Fonts CSS2 loader URL.
 * The URL pattern is `?family=Albert+Sans:wght@...&family=Noto+Sans+SC:wght@...`.
 * `+` represents a space in the family name; we URL-decode then return
 * the bare family name (without the weight specifier).
 */
function parseGoogleFontsLoaderUrl(href: string): string[] {
  const queryIdx = href.indexOf('?');
  if (queryIdx < 0) return [];
  const query = href.slice(queryIdx + 1);
  const params = query.split('&');
  const families: string[] = [];
  for (const p of params) {
    if (!p.startsWith('family=')) continue;
    const raw = decodeURIComponent(p.slice('family='.length));
    // Strip everything after the first `:` (weight / style specifier)
    const family = raw.split(':')[0].replace(/\+/g, ' ');
    families.push(family);
  }
  return families;
}

/**
 * Extract font-family declarations from the local /fonts.css bundle.
 * The bundle has many `@font-face { font-family: 'Inter'; ... }` blocks
 * (one per script subset × weight); we collect the unique family names.
 *
 * Returns `[]` if the file doesn't exist — this lets installations that
 * don't ship the offline bundle fall back to pure-CDN sourcing without
 * the guard erroring (the CDN URL is still validated).
 */
function readLocalFontsCss(): string[] {
  let css: string;
  try {
    css = readFileSync(LOCAL_FONTS_CSS_PATH, 'utf8');
  } catch {
    return [];
  }
  const families = new Set<string>();
  // Match `font-family: 'X';` and `font-family: "X";` inside @font-face blocks.
  // The bundle has no `font-family: X, Y, Z;` stacks (those live in palettes.ts),
  // so a single-quoted-value extraction is sufficient.
  const re = /font-family:\s*['"]([^'"]+)['"]\s*;/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) {
    families.add(m[1]);
  }
  return Array.from(families);
}

/**
 * Read the union of font families served to the browser:
 *   (a) every family declared in apps/web/public/fonts.css (bundled, offline-safe)
 *   (b) every family pulled from fonts.googleapis.com via a `<link>` tag in
 *       apps/web/index.html (CDN, currently CJK-only after the partial-bundle
 *       split for BUG-FONT-BUNDLING-OFFLINE).
 *
 * Both sources are union'd because palettes.ts FONT_STACKS doesn't know
 * which source served any individual family — it only requires the family
 * to be loaded by SOME mechanism.
 */
function readIndexHtmlFontFamilies(): string[] {
  const html = readFileSync(INDEX_HTML_PATH, 'utf8');
  const families = new Set<string>();

  // Source (a): local bundle
  for (const f of readLocalFontsCss()) families.add(f);

  // Source (b): Google Fonts CDN <link> tags
  const linkRe = /<link[^>]+href=["']([^"']*fonts\.googleapis\.com[^"']+)["'][^>]*>/g;
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(html)) !== null) {
    for (const f of parseGoogleFontsLoaderUrl(m[1])) families.add(f);
  }

  return Array.from(families);
}

interface GuardResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

function checkCoverage(stackFonts: string[], stackName: string): GuardResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Build the script-coverage union across all fonts in this stack.
  const covered = new Set<RequiredScript>();
  for (const font of stackFonts) {
    if (GENERIC_FAMILIES.has(font)) continue;
    const scripts = FONT_SCRIPT_COVERAGE[font];
    if (scripts == null) {
      warnings.push(
        `[${stackName}] Font "${font}" is in the stack but missing from FONT_SCRIPT_COVERAGE map; ` +
        `its script support is undocumented. Add it to FONT_SCRIPT_COVERAGE in palettes.ts.`,
      );
      continue;
    }
    for (const s of scripts) covered.add(s);
  }

  // For the body stack, every REQUIRED_SCRIPTS entry must be covered.
  // For the narrativeSerif stack, we relax: serif chains acceptably fall
  // through to Sans variants for scripts without serif equivalents in our
  // bundle (Sinhala, Gurmukhi, Thai). The body stack carries primary coverage.
  if (stackName === 'FONT_STACKS.body') {
    for (const required of REQUIRED_SCRIPTS) {
      if (!covered.has(required)) {
        errors.push(
          `[${stackName}] Script "${required}" is required but not covered by any font in the stack. ` +
          `Add a font from FONT_SCRIPT_COVERAGE that covers "${required}" to the chain.`,
        );
      }
    }
  } else {
    // Informational warnings only for the print serif stack — coverage is
    // primarily the body stack's job; serif is best-effort.
    for (const required of REQUIRED_SCRIPTS) {
      if (!covered.has(required)) {
        warnings.push(
          `[${stackName}] Script "${required}" not covered by the print serif chain; ` +
          `falls through to OS-default serif (acceptable for low-volume scripts but a v2 print-quality gap).`,
        );
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

function checkLoaderSync(stackFonts: string[], loaderFonts: string[]): GuardResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const loaderSet = new Set(loaderFonts);

  for (const font of stackFonts) {
    if (GENERIC_FAMILIES.has(font)) continue;
    // System fonts ("Helvetica Neue", "Arial", "Georgia", "Times New Roman")
    // are OS-bundled and intentionally NOT loaded via Google Fonts CDN.
    // We detect them by their absence from FONT_SCRIPT_COVERAGE entries
    // that begin with "Noto" or are Google Fonts (Albert Sans, Source Serif Pro).
    const isGoogleFont = font.startsWith('Noto ') ||
                         font === 'Albert Sans' ||
                         font === 'Source Serif Pro' ||
                         font === 'Inter';
    if (!isGoogleFont) continue;
    if (!loaderSet.has(font)) {
      errors.push(
        `Font "${font}" appears in FONT_STACKS but is NOT in the Google Fonts loader URL in index.html. ` +
        `Either add it to the &family= chain in apps/web/index.html OR remove it from FONT_STACKS in palettes.ts.`,
      );
    }
  }

  // Reverse check: any loader font not referenced by any FONT_STACKS chain?
  const bodyFonts = parseFontFamilyStack(FONT_STACKS.body);
  const serifFonts = parseFontFamilyStack(FONT_STACKS.narrativeSerif);
  const referenced = new Set([...bodyFonts, ...serifFonts]);
  for (const lf of loaderFonts) {
    if (!referenced.has(lf)) {
      warnings.push(
        `Loader font "${lf}" is requested from Google Fonts but never referenced by FONT_STACKS — wasted bytes. ` +
        `Either reference it in palettes.ts OR remove it from the loader URL in index.html.`,
      );
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

function main(): void {
  console.log('→ check-font-coverage');
  console.log('  source: apps/web/src/shared/theme/palettes.ts (FONT_STACKS SSoT)');
  console.log('  target: apps/web/public/fonts.css (bundled) + apps/web/index.html (CDN <link>)\n');

  const bodyFonts = parseFontFamilyStack(FONT_STACKS.body);
  const serifFonts = parseFontFamilyStack(FONT_STACKS.narrativeSerif);
  let loaderFonts: string[];
  try {
    loaderFonts = readIndexHtmlFontFamilies();
  } catch (err) {
    console.error(`  GUARD MALFUNCTION: cannot read index.html — ${(err as Error).message}`);
    process.exit(2);
  }

  console.log(`  body stack fonts (${bodyFonts.length}):    ${bodyFonts.join(', ')}`);
  console.log(`  serif stack fonts (${serifFonts.length}):   ${serifFonts.join(', ')}`);
  console.log(`  loader URL fonts (${loaderFonts.length}):    ${loaderFonts.join(', ')}\n`);

  const results = [
    checkCoverage(bodyFonts, 'FONT_STACKS.body'),
    checkCoverage(serifFonts, 'FONT_STACKS.narrativeSerif'),
    checkLoaderSync(bodyFonts.concat(serifFonts), loaderFonts),
  ];

  let ok = true;
  for (const r of results) {
    if (!r.ok) ok = false;
    for (const e of r.errors) console.error(`  ✗ ERROR: ${e}`);
    for (const w of r.warnings) console.warn(`  ⚠ WARN:  ${w}`);
  }

  if (ok) {
    console.log('\n✓ Font coverage + loader sync invariants hold.');
    console.log(`  Required scripts covered: ${REQUIRED_SCRIPTS.length}/${REQUIRED_SCRIPTS.length}`);
    process.exit(0);
  } else {
    console.error('\n✗ Font coverage guard FAILED — see errors above.');
    console.error('  Fix the FONT_STACKS / index.html mismatch and re-run.');
    process.exit(1);
  }
}

main();
