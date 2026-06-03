import React from 'react';
import {
  createTheme,
  ThemeProvider as MuiThemeProvider,
  CssBaseline,
  type Theme,
} from '@mui/material';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { THEME_PALETTES, THEME_OPTIONS, SEVERITY_COLORS, FONT_SIZES, FONT_STACKS, DARK_THEME_IDS, type ThemeId, type ThemePalette } from './palettes';

// PART 13 Layer C (2026-05-25) — MUI typography variant augmentation.
//
// Adds a custom `data` variant for numeric-heavy table cells (lab values,
// dosages, vitals, MBS items, AIMS / PHQ-9 / GAD-7 scores). Always-on
// tabular numerals + slight weight bump (500) provides visual lock against
// row-to-row misread when columns of numbers align across many rows.
//
// Module augmentation extends the MUI types so `<Typography variant="data">`
// type-checks correctly. The runtime value is set in `typography.data` in
// buildMuiTheme() below.
declare module '@mui/material/styles' {
  interface TypographyVariants {
    data: React.CSSProperties;
  }
  interface TypographyVariantsOptions {
    data?: React.CSSProperties;
  }
}
declare module '@mui/material/Typography' {
  interface TypographyPropsVariantOverrides {
    data: true;
  }
}

// Palette definitions live in ./palettes.ts so the CI contrast audit script
// (scripts/accessibility/contrast-audit.ts) can import them without pulling
// React / MUI. Re-export the types and tables here for backwards compatibility
// with every existing consumer.
export type { ThemeId, ThemePalette };
export { THEME_PALETTES, THEME_OPTIONS };

function buildMuiTheme(themeId: ThemeId): Theme {
  const p = THEME_PALETTES[themeId];
  const isDark = DARK_THEME_IDS.has(themeId);

  return createTheme({
    palette: {
      mode: isDark ? 'dark' : 'light',
      // contrastText carries the WCAG-AA-verified on-primary colour from
      // palettes.ts — see scripts/accessibility/contrast-audit.ts for the
      // enforcement. MUI reads this when it renders contained buttons,
      // chips, FAB labels, etc.
      primary: { main: p.primary, contrastText: p.onPrimary },
      secondary: { main: p.secondary },
      // Status / severity colours are theme-orthogonal (PART 13 Layer A2):
      // red means red regardless of which theme (signacare / ocean / forest /
      // eucalyptus / etc.) is active. Sourced from SEVERITY_COLORS SSoT in
      // palettes.ts. Replaces a prior hardcoded Material bright-red (the
      // alert-fatigue trap warned against in clinical UX guidance).
      success: { main: SEVERITY_COLORS.success },
      error: { main: SEVERITY_COLORS.critical },
      warning: { main: SEVERITY_COLORS.warning },
      info: { main: SEVERITY_COLORS.info },
      background: { default: p.background, paper: p.paper },
      text: { primary: p.text },
    },
    typography: {
      // PART 13 follow-up (BUG-FONT-*-COVERAGE) — multi-script font chain
      // sourced from FONT_STACKS.body SSoT in palettes.ts. Covers Latin
      // (Albert Sans / Inter / Helvetica Neue / Arial) + CJK / Arabic /
      // Devanagari / Tamil / Gurmukhi / Bengali / Sinhala / Hebrew / Thai
      // via Noto Sans variants. Browser per-character fallback selects the
      // right font for each glyph; brand voice (Albert Sans) is preserved
      // for the dominant Latin text content.
      fontFamily: FONT_STACKS.body,
      // PART 13 Layer C — clinical-tuned scale sourced from FONT_SIZES SSoT
      // (palettes.ts). rem-based to honour WCAG 2.1 SC 1.4.4 (resize text
      // 200% without layout breakage). Headings use 1.2x line-height
      // (tighter — headings are short and large); body uses 1.5x line-height
      // (loose — improves long-form readability and reduces eye strain on
      // long clinical shifts).
      h1: { fontSize: FONT_SIZES.title,      fontWeight: 700, lineHeight: 1.2 },
      h2: { fontSize: FONT_SIZES.heading,    fontWeight: 600, lineHeight: 1.2 },
      h3: { fontSize: FONT_SIZES.subheading, fontWeight: 600, lineHeight: 1.3 },
      h4: { fontWeight: 600 }, // size inherits MUI default; weight only (rare use)
      // PART 13 Layer A1 — tabular numerals on numeric-bearing variants;
      // PART 13 Layer C — explicit clinical sizes + line-heights overlaid.
      body1: {
        fontSize: FONT_SIZES.body,       // 16 px clinician body baseline
        fontWeight: 400,
        lineHeight: 1.5,
        fontVariantNumeric: 'tabular-nums',
      },
      body2: {
        fontSize: FONT_SIZES.bodySmall,  // 14 px secondary / table cell
        fontWeight: 400,
        lineHeight: 1.4,
        fontVariantNumeric: 'tabular-nums',
      },
      caption: {
        fontSize: FONT_SIZES.caption,    // 12 px — NON-CLINICAL ONLY (timestamps, badges)
        fontWeight: 400,
        lineHeight: 1.4,
        fontVariantNumeric: 'tabular-nums',
      },
      button: { fontWeight: 600, textTransform: 'none' as const },
      // PART 13 Layer C — custom `data` variant for numeric-heavy clinical
      // tables. Use as `<Typography variant="data">` for medication /
      // lab / dose / vitals / MBS rows. Always-on tabular-nums + lining
      // numerals (lnum) + tabular-nums OpenType feature for belt+suspenders;
      // weight 500 provides a visual lock against row-to-row misread on
      // aligned columns.
      data: {
        // Same multi-script chain as body; tabular-nums + lnum
        // belt-and-suspenders for numeric column alignment.
        fontFamily: FONT_STACKS.body,
        fontSize: FONT_SIZES.bodySmall,
        fontWeight: 500,
        lineHeight: 1.4,
        fontVariantNumeric: 'tabular-nums',
        fontFeatureSettings: '"tnum" 1, "lnum" 1',
      },
    },
    shape: { borderRadius: 8 },
    components: {
      MuiButton: {
        styleOverrides: {
          root: { borderRadius: 8 },
          // Use the WCAG-verified onPrimary instead of a hard-coded white —
          // white-on-orange (#b8621a) and white-on-amber (#FFB300) fail AA.
          containedPrimary: { color: p.onPrimary },
        },
      },
      MuiCard: {
        styleOverrides: {
          root: { boxShadow: isDark ? '0 1px 4px rgba(0,0,0,0.3)' : '0 1px 4px rgba(61,72,75,0.10)' },
        },
      },
      MuiTableHead: {
        styleOverrides: {
          root: { backgroundColor: isDark ? '#2A2A3A' : '#F0F7F9' },
        },
      },
      MuiPaper: {
        styleOverrides: {
          root: isDark ? { backgroundImage: 'none' } : {},
        },
      },
      // PART 13 Layer D2 — Print stylesheet (theme-orthogonal; same print
      // contract applies regardless of which of the 13 themes is active).
      //
      // Forces AAA-contrast (max black on max white) for print regardless of
      // the active screen theme — medico-legal documents, GP letters, MHA
      // orders, 291 court reports, discharge summaries all print with
      // unambiguous legibility. Hides app-chrome (nav / app bar / drawer) so
      // only the document content prints. Tabular numerals preserved in
      // print tables. `.print-narrative` opt-in class for long-form narrative
      // sections (clinical notes, GP letter bodies) — serif fallback chain
      // ends in system serif so this works whether or not Layer E1 (Source
      // Serif Pro bundle/CDN) has landed.
      MuiCssBaseline: {
        // PART 13 Layer D2 + BUG-FONT-PRINT-NON-LATIN (2026-05-26) —
        // print-narrative font chain now sourced from FONT_STACKS.narrativeSerif
        // SSoT (palettes.ts), which includes Noto Sans variants as fallback for
        // CJK / Arabic / Devanagari / Tamil / Bengali (Sinhala / Gurmukhi /
        // Thai fall through to OS-bundled fonts since Noto Serif variants for
        // those are not loaded today — tracked for v2 print-quality upgrade).
        styleOverrides: `
          @media print {
            body {
              background: #FFFFFF !important;
              color: #000000 !important;
            }
            .MuiAppBar-root,
            .MuiDrawer-root,
            nav,
            .no-print {
              display: none !important;
            }
            .print-narrative {
              font-family: ${FONT_STACKS.narrativeSerif};
              line-height: 1.6;
            }
            table,
            .MuiTable-root,
            .MuiTypography-data {
              font-variant-numeric: tabular-nums;
              font-feature-settings: "tnum" 1, "lnum" 1;
            }
            a {
              color: #000000 !important;
              text-decoration: underline;
            }
          }
        `,
      },
    },
  });
}

// ============ Theme Store ============

interface ThemeStore {
  themeId: ThemeId;
  setTheme: (id: ThemeId) => void;
  palette: ThemePalette;
}

export const useThemeStore = create<ThemeStore>()(
  persist(
    (set) => ({
      themeId: 'signacare',
      palette: THEME_PALETTES.signacare,
      setTheme: (id: ThemeId) => set({ themeId: id, palette: THEME_PALETTES[id] }),
    }),
    { name: 'signacare-theme' }
  )
);

// Helper for components that need sidebar colors
export function useSidebarColors() {
  const palette = useThemeStore(s => s.palette);
  return { bg: palette.sidebar, text: palette.sidebarText, accent: palette.accent };
}

// ============ Provider ============

interface Props {
  children: React.ReactNode;
}

export function SignacareThemeProvider({ children }: Props): React.ReactElement {
  const themeId = useThemeStore(s => s.themeId);
  const muiTheme = React.useMemo(() => buildMuiTheme(themeId), [themeId]);

  return (
    <MuiThemeProvider theme={muiTheme}>
      <CssBaseline />
      {children}
    </MuiThemeProvider>
  );
}
