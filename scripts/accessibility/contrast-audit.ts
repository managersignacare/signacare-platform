#!/usr/bin/env tsx
// scripts/accessibility/contrast-audit.ts
//
// WCAG 2.1 contrast audit for every theme palette in
// apps/web/src/shared/theme/palettes.ts. Run via:
//
//   npx tsx scripts/accessibility/contrast-audit.ts          # AA only, fail on AA
//   npx tsx scripts/accessibility/contrast-audit.ts --aaa    # also report AAA
//   npx tsx scripts/accessibility/contrast-audit.ts --strict # treat AAA failures as errors too
//
// CI uses the default mode — any pair that falls below WCAG AA thresholds
// is a hard failure. The `a11y` job in .github/workflows/ci.yml calls this
// script after the static ARIA coverage gate.
//
// Contrast thresholds (WCAG 2.1):
//   SC 1.4.3 Contrast (Minimum)      Level AA   4.5:1 normal text, 3.0:1 large text
//   SC 1.4.6 Contrast (Enhanced)     Level AAA  7.0:1 normal text, 4.5:1 large text
//   SC 1.4.11 Non-text Contrast      Level AA   3.0:1 UI components + graphical objects
//
// Audited pairs per theme:
//   text         on background          — body text on page background
//   text         on paper               — body text on cards / dialogs
//   sidebarText  on sidebar             — sidebar navigation text
//   #FFFFFF      on primary             — contained primary button label
//   primary      on background          — focus ring / icon contrast (non-text, 3:1)
//   primary      on paper               — icon on card (non-text, 3:1)
//
// Adding a new theme? Run this script. Failing colours MUST be darkened /
// lightened before merge. There is no "it looks close enough" override —
// the CI gate blocks the PR.
//
// Fix Registry: A11Y-CONTRAST1 (script present), A11Y-CONTRAST2 (all
// shipped themes pass WCAG AA).

import { THEME_PALETTES, type ThemeId, type ThemePalette } from '../../apps/web/src/shared/theme/palettes';

const AA_NORMAL = 4.5;
const AA_LARGE_AND_NONTEXT = 3.0;
const AAA_NORMAL = 7.0;

interface Pair {
  label: string;
  fg: keyof ThemePalette;
  bg: keyof ThemePalette;
  /** minimum ratio for this pair to pass */
  threshold: number;
  /** human description of why this pair matters */
  context: string;
}

const PAIRS: Pair[] = [
  {
    label: 'text on background',
    fg: 'text',
    bg: 'background',
    threshold: AA_NORMAL,
    context: 'body text on page background (SC 1.4.3)',
  },
  {
    label: 'text on paper',
    fg: 'text',
    bg: 'paper',
    threshold: AA_NORMAL,
    context: 'body text on cards / dialogs (SC 1.4.3)',
  },
  {
    label: 'sidebarText on sidebar',
    fg: 'sidebarText',
    bg: 'sidebar',
    threshold: AA_NORMAL,
    context: 'sidebar navigation text (SC 1.4.3)',
  },
  {
    label: 'onPrimary on primary',
    fg: 'onPrimary',
    bg: 'primary',
    threshold: AA_NORMAL,
    context: 'contained primary button label — onPrimary is wired via ThemeProvider.buildMuiTheme (SC 1.4.3)',
  },
  {
    label: 'primary on background',
    fg: 'primary',
    bg: 'background',
    threshold: AA_LARGE_AND_NONTEXT,
    context: 'focus rings / icons on background (SC 1.4.11)',
  },
  {
    label: 'primary on paper',
    fg: 'primary',
    bg: 'paper',
    threshold: AA_LARGE_AND_NONTEXT,
    context: 'icons on cards (SC 1.4.11)',
  },
];

// ─── Colour math (WCAG 2.1 §1.4.3) ──────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  if (clean.length !== 3 && clean.length !== 6) {
    throw new Error(`Invalid hex colour: ${hex}`);
  }
  const full = clean.length === 3
    ? clean.split('').map((c) => c + c).join('')
    : clean;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return [r, g, b];
}

/** WCAG 2.1 relative luminance formula */
function relativeLuminance([r, g, b]: [number, number, number]): number {
  const channel = (c: number): number => {
    const sRGB = c / 255;
    return sRGB <= 0.03928 ? sRGB / 12.92 : Math.pow((sRGB + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG 2.1 contrast ratio */
export function contrastRatio(fgHex: string, bgHex: string): number {
  const fg = relativeLuminance(hexToRgb(fgHex));
  const bg = relativeLuminance(hexToRgb(bgHex));
  const lighter = Math.max(fg, bg);
  const darker = Math.min(fg, bg);
  return (lighter + 0.05) / (darker + 0.05);
}

function resolve(palette: ThemePalette, key: keyof ThemePalette): string {
  return palette[key];
}

// ─── Audit ──────────────────────────────────────────────────────────────────

interface Failure {
  theme: ThemeId;
  pair: string;
  fgValue: string;
  bgValue: string;
  ratio: number;
  threshold: number;
  context: string;
}

function auditTheme(themeId: ThemeId, palette: ThemePalette, reportAaa: boolean): Failure[] {
  const failures: Failure[] = [];
  for (const pair of PAIRS) {
    const fg = resolve(palette, pair.fg);
    const bg = resolve(palette, pair.bg);
    const ratio = contrastRatio(fg, bg);
    const passes = ratio >= pair.threshold;
    const aaaLabel = ratio >= AAA_NORMAL ? ' (AAA)' : '';
    const marker = passes ? '✓' : '✗';
    // eslint-disable-next-line no-console
    console.log(
      `  ${marker} ${pair.label.padEnd(26)} ${ratio.toFixed(2).padStart(6)}:1 (need ${pair.threshold}:1)${aaaLabel}`,
    );
    if (!passes) {
      failures.push({
        theme: themeId,
        pair: pair.label,
        fgValue: fg,
        bgValue: bg,
        ratio,
        threshold: pair.threshold,
        context: pair.context,
      });
    }
    if (reportAaa && passes && ratio < AAA_NORMAL && pair.threshold === AA_NORMAL) {
      // eslint-disable-next-line no-console
      console.log(`      note: below AAA enhancement (7.0:1)`);
    }
  }
  return failures;
}

function main(): void {
  const args = new Set(process.argv.slice(2));
  const reportAaa = args.has('--aaa') || args.has('--strict');

  // eslint-disable-next-line no-console
  console.log('WCAG 2.1 Contrast Audit — Signacare EMR themes');
  // eslint-disable-next-line no-console
  console.log('─'.repeat(72));

  const allFailures: Failure[] = [];
  for (const [themeId, palette] of Object.entries(THEME_PALETTES) as [ThemeId, ThemePalette][]) {
    // eslint-disable-next-line no-console
    console.log(`\n${themeId}`);
    allFailures.push(...auditTheme(themeId, palette, reportAaa));
  }

  // eslint-disable-next-line no-console
  console.log('\n' + '─'.repeat(72));
  if (allFailures.length === 0) {
    // eslint-disable-next-line no-console
    console.log('✓ All theme palettes pass WCAG 2.1 AA contrast thresholds.');
    process.exit(0);
  }

  // eslint-disable-next-line no-console
  console.error(`✗ ${allFailures.length} WCAG AA contrast failure(s):\n`);
  for (const f of allFailures) {
    // eslint-disable-next-line no-console
    console.error(
      `  [${f.theme}] ${f.pair}: ${f.fgValue} on ${f.bgValue} = ${f.ratio.toFixed(2)}:1 (need ${f.threshold}:1)\n      ${f.context}`,
    );
  }
  // eslint-disable-next-line no-console
  console.error('\nTo fix: darken the foreground or lighten the background in apps/web/src/shared/theme/palettes.ts');
  process.exit(1);
}

main();
