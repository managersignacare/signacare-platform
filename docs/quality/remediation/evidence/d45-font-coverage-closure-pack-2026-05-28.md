# D45 — Font Coverage Closure Pack (2026-05-28)

## Scope
- `BUG-FONT-CJK-COVERAGE`
- `BUG-FONT-ARABIC-RTL-COVERAGE` (font coverage portion)
- `BUG-FONT-INDIC-COVERAGE`
- `BUG-FONT-PRINT-NON-LATIN`

## Changes
- Expanded `FONT_STACKS.narrativeSerif` in `apps/web/src/shared/theme/palettes.ts` to include:
  - `Noto Sans Gurmukhi`
  - `Noto Sans Sinhala`
  - `Noto Sans Thai`
- This removes prior print-fallback gaps and aligns serif print chain with body script coverage policy.

## Regression proof
- `npm run guard:font-coverage` ✅
  - Required scripts covered: `15/15`
  - No warning gaps remaining on serif script coverage.
  - Loader/SSoT sync remains green.

## Notes
- `BUG-FONT-BUNDLING-OFFLINE` remains separately tracked for full offline CJK bundling rollout.
- `BUG-FONT-ARABIC-RTL-COVERAGE` now only concerns layout-direction behavior if product policy requires dedicated RTL layout audits; font coverage itself is closed.
