# D47 — Offline Font Bundling Closure (2026-05-28)

## Scope
- Bug: `BUG-FONT-BUNDLING-OFFLINE`
- Goal: remove runtime dependency on Google Fonts and keep all configured scripts renderable from local assets.

## Implementation
- Added local CJK font assets:
  - `apps/web/public/fonts/NotoSansSC-full.woff2`
  - `apps/web/public/fonts/NotoSansJP-full.woff2`
  - `apps/web/public/fonts/NotoSansKR-full.woff2`
- Added local `@font-face` declarations for:
  - `Noto Sans SC`
  - `Noto Sans JP`
  - `Noto Sans KR`
  in `apps/web/public/fonts.css`.
- Removed Google Fonts runtime links from `apps/web/index.html`.
- Updated operator runbook:
  - `installer/regen-font-bundle.md`
  to reflect local-only runtime policy and CJK subset regeneration path.

## Regression proof
- `npm run guard:font-coverage` ✅
  - Required scripts covered: `15/15`
  - Loader/SSoT sync passes with local bundle.
- `bash .github/scripts/check-fix-registry.sh` ✅
- `npm run guard:bugs-remaining-uniqueness` ✅

## Outcome
- Web runtime is now local-font complete across configured script families, including CJK.
