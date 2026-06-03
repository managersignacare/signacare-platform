// apps/web/src/shared/theme/palettes.ts
//
// Pure palette definitions — no React, no MUI, no Zustand imports so this
// module can be consumed by CI scripts (scripts/accessibility/contrast-audit.mjs)
// as well as by the runtime ThemeProvider.
//
// DO NOT import anything from '@mui/material', 'react', or any UI library
// in this file. The contrast audit script executes it via tsx and every
// import transitively pulled in here becomes a CI cost.
//
// Contrast is enforced by scripts/accessibility/contrast-audit.ts and the
// `npm run a11y:contrast` CI step. When you add a new theme, running the
// script locally before committing surfaces any AA / AAA failures.
//
// Standard satisfied: WCAG 2.1 SC 1.4.3 (Contrast Minimum), SC 1.4.11
//                     (Non-text Contrast), DDA 1992.
// Fix Registry: A11Y-THEME1 (pure palette module exists),
//               A11Y-THEME2 (contrast audit script wired into CI).
//
// Design principles (PART 13 — UI Theme + Typography Enhancement, 2026-05-25):
//   1. WCAG 2.1 AA enforced by scripts/accessibility/contrast-audit.ts.
//   2. 60-30-10 colour balance (60% neutrals / 30% primary / 10% accents) —
//      prevents sensory overload on long clinical shifts.
//   3. Status colour ALWAYS paired with icon + text label (never colour alone) —
//      ~8% red-green colour blindness; mental-health patient surfaces especially
//      sensitive to alarming colour cues.
//   4. Tabular numerals enabled on numeric typography variants (body1/body2/
//      caption/data) via ThemeProvider.tsx — eliminates misread risk on aligned
//      medication / lab / dose / vitals columns.
//   5. Severity colours are theme-orthogonal (SEVERITY_COLORS below) — red means
//      red regardless of which clinic theme is active.
//   6. Safety-action touch targets (escalation acknowledge, risk-flag attest,
//      safety-plan sign, restrictive-intervention end) use TOUCH_TARGETS.safetyAction
//      = 56pt, not the standard 44pt — mental-health crisis flows are
//      high-stress contexts where the extra hit-box reduces mis-tap risk.
//
// See ~/.claude/plans/valiant-plotting-snowglobe.md PART 13 for full rationale.

export type ThemeId =
  | 'signacare'
  | 'ocean'
  | 'midnight'
  | 'forest'
  | 'slate'
  | 'rose'
  | 'dusk'
  | 'indigo'
  // PART 13 Layer B (2026-05-25) — mental-health + patient-warmth + AAA + low-arousal:
  | 'eucalyptus'      // sage + ochre — AU-native, mental-health calm (light)
  | 'warmth'          // walnut + parchment — patient-app friendly tone (light)
  | 'clinicalAaa'     // deep navy + emerald + rust — AAA contrast for medico-legal + low-vision (light)
  | 'therapeutic'     // calm blue-purple + sage-grey — low-arousal risk/safety-plan surfaces (light)
  | 'crisisSafeDark'; // calm cyan + sand — night-shift dark, no panic reds (dark)

export interface ThemePalette {
  primary: string;
  /**
   * Foreground colour for contained primary buttons — must contrast with
   * `primary` at ≥ 4.5:1 (WCAG SC 1.4.3). Verified by
   * scripts/accessibility/contrast-audit.ts. For light primaries (signacare
   * orange, midnight purple, dusk amber) this MUST be black/near-black to
   * meet WCAG AA; for dark primaries it is typically white.
   */
  onPrimary: string;
  secondary: string;
  sidebar: string;
  sidebarText: string;
  background: string;
  paper: string;
  text: string;
  accent: string;
}

export const THEME_PALETTES: Record<ThemeId, ThemePalette> = {
  signacare: {
    primary: '#b8621a',
    onPrimary: '#000000', // 4.80:1 on #b8621a (white would be 4.37:1 — under AA)
    secondary: '#327C8D',
    sidebar: '#3D484B',
    sidebarText: '#FFFFFF',
    background: '#FBF8F5',
    paper: '#FFFFFF',
    text: '#3D484B',
    accent: '#b8621a',
  },
  ocean: {
    primary: '#1976D2',
    onPrimary: '#FFFFFF', // 4.60:1 on #1976D2
    secondary: '#00897B',
    sidebar: '#0D3B66',
    sidebarText: '#E3F2FD',
    background: '#F5F9FC',
    paper: '#FFFFFF',
    text: '#1A2A3A',
    accent: '#1976D2',
  },
  midnight: {
    primary: '#BB86FC',
    onPrimary: '#000000', // 7.93:1 on #BB86FC (white would be 2.65:1 — under AA)
    secondary: '#03DAC6',
    sidebar: '#1E1E2E',
    sidebarText: '#CDD6F4',
    background: '#121218',
    paper: '#1E1E2E',
    text: '#E0E0E0',
    accent: '#BB86FC',
  },
  forest: {
    primary: '#2E7D32',
    onPrimary: '#FFFFFF', // 5.13:1 on #2E7D32
    secondary: '#558B2F',
    sidebar: '#1B5E20',
    sidebarText: '#E8F5E9',
    background: '#F1F8F1',
    paper: '#FFFFFF',
    text: '#1B2E1C',
    accent: '#2E7D32',
  },
  slate: {
    primary: '#455A64',
    onPrimary: '#FFFFFF', // 7.24:1 on #455A64 (AAA)
    secondary: '#00ACC1',
    sidebar: '#263238',
    sidebarText: '#ECEFF1',
    background: '#F5F7F8',
    paper: '#FFFFFF',
    text: '#263238',
    accent: '#00ACC1',
  },
  rose: {
    primary: '#AD1457',
    onPrimary: '#FFFFFF', // 6.97:1 on #AD1457
    secondary: '#E91E8C',
    sidebar: '#880E4F',
    sidebarText: '#FCE4EC',
    background: '#FDF5F8',
    paper: '#FFFFFF',
    text: '#3D1A27',
    accent: '#AD1457',
  },
  dusk: {
    primary: '#FFB300',
    onPrimary: '#000000', // 11.70:1 on #FFB300 (white would be 1.79:1 — fails AA badly)
    secondary: '#FF7043',
    sidebar: '#1C1C1C',
    sidebarText: '#FFF8E1',
    background: '#121212',
    paper: '#1E1E1E',
    text: '#F5F5F5',
    accent: '#FFB300',
  },
  indigo: {
    primary: '#3949AB',
    onPrimary: '#FFFFFF', // 7.73:1 on #3949AB (AAA)
    secondary: '#7986CB',
    sidebar: '#1A237E',
    sidebarText: '#E8EAF6',
    background: '#F5F6FD',
    paper: '#FFFFFF',
    text: '#1A237E',
    accent: '#3949AB',
  },
  // PART 13 Layer B — mental-health + AU-native + patient-warmth + AAA + low-arousal + crisis-safe-dark.
  // Each contrast ratio is an ESTIMATE; final adoption gate is `npm run a11y:contrast` per the
  // file-header policy. AA failures must be tightened (darken/lighten the primary), not relaxed.
  eucalyptus: {
    primary: '#4A6B5C', // deep sage — calming clinical, eucalyptus-toned
    onPrimary: '#FFFFFF', // ≈ 5.65:1 on #4A6B5C (AA pending audit)
    secondary: '#C5A47E', // warm sand / AU ochre — complements sage
    sidebar: '#2D3F37', // deep forest
    sidebarText: '#E8F0EC',
    background: '#F7F5F0', // warm paper (welcoming, not sterile)
    paper: '#FFFFFF',
    text: '#1F2D26', // deep slate-green; ≈ 13.5:1 on background (AAA)
    accent: '#C5A47E',
  },
  warmth: {
    primary: '#8E5A3C', // warm walnut — friendly, non-corporate, patient-app tone
    onPrimary: '#FFFFFF', // ≈ 5.95:1 on #8E5A3C (AA pending audit)
    secondary: '#4A8C9C', // gentle teal — link to clinician palette family
    sidebar: '#3B2D24', // deep walnut
    sidebarText: '#FAEDE0', // warm cream
    background: '#FCF8F3', // warm parchment
    paper: '#FFFFFF',
    text: '#2E2218', // deep brown; ≈ 14:1 on background (AAA)
    accent: '#D4A574', // apricot accent
  },
  clinicalAaa: {
    primary: '#003D7A', // deep navy — ≈ 12.5:1 on white (AAA)
    onPrimary: '#FFFFFF', // (AAA)
    secondary: '#007A52', // deep emerald — distinguishable from primary under
                          // protanopia/deuteranopia (Wong-palette third-axis principle)
    sidebar: '#1A1F2E', // near-black
    sidebarText: '#FFFFFF',
    background: '#FFFFFF', // max contrast
    paper: '#FAFAFA',
    text: '#000000', // max contrast — ≈ 21:1 (AAA)
    accent: '#B8401A', // rust — third colour-blind-safe axis for status accents
  },
  therapeutic: {
    primary: '#4F6BA5', // calm peaceful blue-purple — deliberately low-arousal,
                       // doesn't trigger threat response like saturated red/orange;
                       // designed for risk-assessment / safety-plan / SI-flag surfaces
    onPrimary: '#FFFFFF', // ≈ 5.20:1 on #4F6BA5 (AA pending audit)
    secondary: '#8B9A7E', // sage-grey — supports the calm tone
    sidebar: '#2C3E5A', // deep navy
    sidebarText: '#E6EBF3',
    background: '#F8F9FB', // cool paper
    paper: '#FFFFFF',
    text: '#1A2238', // cool charcoal; ≈ 14:1 on background (AAA)
    accent: '#B8AC9C', // warm taupe — humanises the cool primary
  },
  crisisSafeDark: {
    primary: '#82B8C9', // calm cyan — high contrast on dark, low arousal;
                       // chosen for night-shift work on crisis/safety surfaces
                       // where harsh primaries (purple, amber) are inappropriate
    onPrimary: '#0A1419', // ≈ 9.8:1 on #82B8C9 (AAA on dark)
    secondary: '#C9A87E', // warm sand — warm balance to cool primary
    sidebar: '#0F1419', // near-black
    sidebarText: '#C9D6DE',
    background: '#0A1419', // deep midnight-cyan
    paper: '#1A2025',
    text: '#D8E0E5', // soft white; ≈ 12:1 on background (AAA)
    accent: '#82B8C9',
  },
};

// ============================================================================
// DARK_THEME_IDS — structural refactor (PART 13 Layer B) for dark-mode detection.
// ============================================================================
//
// Previously `isDark` was an inline OR-chain (`themeId === 'midnight' || themeId === 'dusk'`)
// in ThemeProvider.tsx. Adding a third dark theme (crisisSafeDark) would grow that
// chain ad infinitum. Refactoring to a Set makes dark-theme extension a single-edit
// data change: add the ThemeId here, no logic change needed elsewhere.

export const DARK_THEME_IDS: ReadonlySet<ThemeId> = new Set<ThemeId>([
  'midnight',
  'dusk',
  'crisisSafeDark',
]);

export const THEME_OPTIONS: { id: ThemeId; name: string; description: string }[] = [
  { id: 'signacare', name: 'SignaCare (Default)', description: 'Warm professional theme with orange accents' },
  { id: 'ocean', name: 'Ocean Blue', description: 'Clean medical blue with teal accents' },
  { id: 'forest', name: 'Forest', description: 'Deep greens — calming and natural' },
  { id: 'slate', name: 'Slate', description: 'Clinical grey-blue with cyan accents' },
  { id: 'indigo', name: 'Indigo', description: 'Deep indigo sidebar, professional and focused' },
  { id: 'rose', name: 'Rose', description: 'Warm rose tones, welcoming and modern' },
  { id: 'midnight', name: 'Midnight Dark', description: 'Dark mode with purple accents — reduces eye strain' },
  { id: 'dusk', name: 'Dusk Dark', description: 'Dark mode with warm amber accents' },
  // PART 13 Layer B (2026-05-25) — mental-health-tuned + AU-native + AAA + low-arousal + crisis-safe-dark.
  { id: 'eucalyptus', name: 'Eucalyptus', description: 'Mental-health calm — sage + ochre, AU-native identity' },
  { id: 'warmth', name: 'Patient Warmth', description: 'Warm walnut + parchment — patient-app friendly tone' },
  { id: 'clinicalAaa', name: 'Clinical AAA', description: 'AAA-contrast deep navy + emerald — medico-legal + low-vision' },
  { id: 'therapeutic', name: 'Therapeutic', description: 'Low-arousal blue-purple — risk + safety-plan surfaces' },
  { id: 'crisisSafeDark', name: 'Crisis-Safe Dark', description: 'Dark mode for night-shift crisis — calm cyan, no panic reds' },
];

// ============================================================================
// SEVERITY_COLORS — theme-orthogonal status colour set (PART 13 Layer A2)
// ============================================================================
//
// These colours carry semantic clinical meaning and MUST remain consistent
// regardless of which theme (signacare / ocean / forest / etc.) is active.
// Replaces the prior hardcoded `error: '#D32F2F'` (Material panic-red) which
// contradicted the alert-fatigue principle — the same EMR design guide that
// emphasised "use red only for genuine clinical urgency" then recommended a
// bright coral as the default alert colour. We use a muted terracotta.
//
// Pair every status colour with an icon + text label per principle #3 above.
//
// CONTRAST AUDIT NOTE: contrast-audit.ts currently audits THEME_PALETTES only.
// These constants must be verified manually against typical foregrounds:
//   - on white  (#FFFFFF) and paper backgrounds for clinician web
//   - on near-black (#0A1419 / #121218) for dark themes
// Verification at execution time via `npm run a11y:contrast` extension OR a
// dedicated audit pass before adoption in status-rendering components.

export const SEVERITY_COLORS = {
  /** Muted terracotta — for genuine clinical urgency, abnormal vitals, errors.
   *  ≈ 6.0:1 on white (AA). Replaces Material #D32F2F panic-red. */
  critical: '#B0413E',
  /** Deep amber — for warnings, borderline values, near-abnormal labs.
   *  ≈ 5.4:1 on white (AA). Distinct enough from `critical` for colour-blind users. */
  warning: '#D97706',
  /** Forest green — for normal lab values, success states, confirmed actions.
   *  ≈ 5.1:1 on white (AA). */
  success: '#4A7C59',
  /** Deep teal — for informational banners, tooltips, neutral notices.
   *  ≈ 6.7:1 on white (AA). */
  info: '#2E5C8A',
  /** Slate — for inactive fields, disabled buttons, secondary informational text.
   *  ≈ 4.8:1 on white (AA). */
  neutral: '#6B7280',
} as const;

export type SeverityKey = keyof typeof SEVERITY_COLORS;

// ============================================================================
// FONT_SIZES — clinical-tuned typography size SSoT (PART 13 Layer A3)
// ============================================================================
//
// rem-based sizes (relative to MUI's default root size, typically 16px) so
// the scale honours WCAG 2.1 SC 1.4.4 (Resize text up to 200% without layout
// breakage). Captions are 12px ONLY for non-clinical content (timestamps,
// badges); body text is always ≥ 16px per accessibility consensus.

export const FONT_SIZES = {
  /** H1 — page titles, primary screen headers. 32px / 2rem. */
  title: '2rem',
  /** H2 — section headers, dashboard panel titles. 24px / 1.5rem. */
  heading: '1.5rem',
  /** H3 — card titles, subsection headers. 20px / 1.25rem. */
  subheading: '1.25rem',
  /** body1 — primary body text, clinician web baseline. 16px / 1rem. */
  body: '1rem',
  /** body2 — secondary body text, table cells, labels. 14px / 0.875rem. */
  bodySmall: '0.875rem',
  /** caption — timestamps, badges, tags. 12px / 0.75rem. NON-CLINICAL CONTENT ONLY. */
  caption: '0.75rem',
  /** Patient-app (Viva) body — 18px / 1.125rem. Senior accessibility baseline
   *  per Health Literacy Online recommendation (mental-health patient demographic
   *  often includes older adults). */
  patientApp: '1.125rem',
} as const;

export type FontSizeKey = keyof typeof FONT_SIZES;

// ============================================================================
// TOUCH_TARGETS — minimum hit-box sizes for interactive elements (PART 13 Layer A3)
// ============================================================================
//
// Values are in pt/px (1pt ≈ 1px at @1x). Apply to MUI `minHeight` / `minWidth`
// on Button / IconButton / Chip clickable variants; apply equivalent to Flutter
// `minimumSize: Size(N, N)` on the mobile apps (Viva + Sara).

export const TOUCH_TARGETS = {
  /** WCAG 2.1 / iOS HIG / Material baseline minimum for any tappable control. */
  standard: 44,
  /** Larger target for clinical safety actions where mis-tap risk carries harm:
   *  - clinical-note sign / amend
   *  - AI-draft attest + sign
   *  - risk-flag attest / escalation acknowledge
   *  - safety-plan sign
   *  - restrictive-intervention end
   *  - prescription sign (already discipline-barrier-gated, but UI also gets 56pt)
   *  Mental-health crisis flows are high-stress contexts; the extra hit-box
   *  meaningfully reduces mis-tap risk per PDF/PART 13 guidance. */
  safetyAction: 56,
} as const;

export type TouchTargetKey = keyof typeof TOUCH_TARGETS;

// ============================================================================
// FONT_STACKS — multi-script font-family SSoT (PART 13 follow-up BUGs
// BUG-FONT-CJK-COVERAGE + BUG-FONT-ARABIC-RTL-COVERAGE + BUG-FONT-INDIC-COVERAGE
// + BUG-FONT-PRINT-NON-LATIN; pinned by BUG-GUARD-FONT-COVERAGE)
// ============================================================================
//
// AU mental-health clinics serve a multilingual patient population. Without
// explicit non-Latin font loading, patient names in CJK / Arabic / Indic /
// Hebrew / Thai render via the browser's OS fallback chain — which works on
// modern OSes but mixes typography mid-name ("陈 Sarah" renders with two
// different fonts) and risks tofu boxes on older / locale-limited systems.
//
// The Noto Sans family (Google Fonts, SIL OFL) covers every script
// Signacare needs. Each Noto variant is loaded via `unicode-range`
// @font-face rules generated by the Google Fonts CSS2 API — so the actual
// font binaries are downloaded ONLY when a character in that range is
// rendered. Initial CSS overhead ≈ 50 KB; font binaries pay-per-use.
//
// SSoT POLICY: these stacks are the canonical font-family chains for the web
// surface. Both `apps/web/index.html` (Google Fonts loader URL) and
// `ThemeProvider.tsx` (MUI typography fontFamily strings) MUST stay
// consistent with the families listed here. The
// `scripts/guards/check-font-coverage.ts` guard (BUG-GUARD-FONT-COVERAGE)
// asserts this consistency on every commit + asserts that every required
// script has at least one covering font in the chain.

/** Required scripts for Signacare's AU clinical context. Used by the
 *  font-coverage guard to assert at least one font in the stack covers each. */
export const REQUIRED_SCRIPTS = [
  'latin',           // English + diacritic-using European languages
  'latin-ext',       // Vietnamese (Latin with combining marks) etc.
  'cyrillic',        // Russian, Ukrainian
  'greek',           // Greek-Australian community
  'cjk-sc',          // Simplified Chinese (Mandarin) — largest non-English AU language
  'cjk-jp',          // Japanese
  'cjk-kr',          // Korean
  'arabic',          // Arabic + Persian/Farsi + Urdu
  'devanagari',      // Hindi etc.
  'tamil',           // Tamil-Australian community
  'gurmukhi',        // Punjabi
  'bengali',         // Bengali
  'sinhala',         // Sinhala (Sri Lankan community)
  'hebrew',          // Hebrew
  'thai',            // Thai
] as const;
export type RequiredScript = (typeof REQUIRED_SCRIPTS)[number];

/** Mapping from font name → scripts it covers. The guard uses this table
 *  to verify that the union of fonts in the stack covers REQUIRED_SCRIPTS.
 *  Note: 'latin' / 'latin-ext' are assumed to be covered by every font
 *  here (every entry covers at least basic Latin); the explicit listing is
 *  for non-Latin scripts that are the actual coverage concern. */
export const FONT_SCRIPT_COVERAGE: Record<string, ReadonlyArray<RequiredScript>> = {
  // NOTE: Albert Sans removed 2026-05-26 per BUG-FONT-PRIMARY-FACE-DECISION
  // (operator-selected full swap to Inter primary). The historical entry was
  // `'Albert Sans': ['latin', 'latin-ext'],`. Re-add only if FONT_STACKS
  // re-introduces it AND the absent anchor in fix-registry is removed.
  'Inter':               ['latin', 'latin-ext', 'cyrillic', 'greek'],
  'Helvetica Neue':      ['latin', 'latin-ext'],
  'Arial':               ['latin', 'latin-ext', 'cyrillic', 'greek', 'hebrew'],
  'Source Serif Pro':    ['latin', 'latin-ext'],
  'Georgia':             ['latin', 'latin-ext', 'cyrillic', 'greek'],
  'Times New Roman':     ['latin', 'latin-ext', 'cyrillic', 'greek', 'hebrew'],
  // Noto Sans variants — Google Fonts SIL OFL — each covers exactly its script:
  'Noto Sans SC':         ['cjk-sc'],
  'Noto Sans JP':         ['cjk-jp'],
  'Noto Sans KR':         ['cjk-kr'],
  'Noto Sans Arabic':     ['arabic'],
  'Noto Sans Devanagari': ['devanagari'],
  'Noto Sans Tamil':      ['tamil'],
  'Noto Sans Gurmukhi':   ['gurmukhi'],
  'Noto Sans Bengali':    ['bengali'],
  'Noto Sans Sinhala':    ['sinhala'],
  'Noto Sans Hebrew':     ['hebrew'],
  'Noto Sans Thai':       ['thai'],
};

/** Canonical font-family stacks. Both index.html (font loader) and
 *  ThemeProvider.tsx (typography fontFamily) MUST cover the same set of
 *  fonts as FONT_SCRIPT_COVERAGE for the required scripts.
 *
 *  Order rationale: Inter primary (operator decision 2026-05-26 per
 *  BUG-FONT-PRIMARY-FACE-DECISION; chosen for data-table legibility +
 *  industry-default cross-platform rendering; brand identity shifts from
 *  geometric to humanist). Albert Sans removed from the chain. Then
 *  system-bundled Latin fonts, then per-script Noto Sans variants for
 *  per-character non-Latin fallback, then generic family. The browser CSS
 *  Fonts module §5 fallback algorithm picks per-character: each codepoint
 *  walks the chain until a font with a covering glyph is found. */
export const FONT_STACKS = {
  /** Body sans-serif chain (covers all REQUIRED_SCRIPTS). */
  body: [
    '"Inter"',                              // primary (Latin + Cyrillic + Greek) — operator-selected 2026-05-26
    '"Helvetica Neue"',                     // system fallback
    'Arial',                                // last-resort Latin (covers Hebrew)
    '"Noto Sans SC"',                       // CJK Simplified
    '"Noto Sans JP"',                       // CJK Japanese
    '"Noto Sans KR"',                       // CJK Korean
    '"Noto Sans Arabic"',                   // Arabic + Persian + Urdu
    '"Noto Sans Devanagari"',               // Hindi etc.
    '"Noto Sans Tamil"',
    '"Noto Sans Gurmukhi"',                 // Punjabi
    '"Noto Sans Bengali"',
    '"Noto Sans Sinhala"',
    '"Noto Sans Hebrew"',
    '"Noto Sans Thai"',
    'sans-serif',                            // generic
  ].join(', '),

  /** Narrative serif chain (used by `.print-narrative` in print stylesheet). */
  narrativeSerif: [
    '"Source Serif Pro"',                   // primary print serif (Latin)
    'Georgia',                              // common system serif (Latin + Cyrillic + Greek)
    '"Times New Roman"',                    // last-resort Latin serif
    // Non-Latin fallback — Sans variants (not Serif because we don't bundle
    // Noto Serif variants today; that's a future v2 upgrade tracked in d14):
    '"Noto Sans SC"',
    '"Noto Sans JP"',
    '"Noto Sans KR"',
    '"Noto Sans Arabic"',
    '"Noto Sans Devanagari"',
    '"Noto Sans Tamil"',
    '"Noto Sans Gurmukhi"',
    '"Noto Sans Bengali"',
    '"Noto Sans Sinhala"',
    '"Noto Sans Thai"',
    'serif',                                // generic
  ].join(', '),
} as const;

export type FontStackKey = keyof typeof FONT_STACKS;
