# D41 Font CJK Subset Tooling Closure

**Date:** 2026-05-28  
**Scope:** `BUG-FONT-BUNDLING-CJK-SUBSET-TOOLING`

## Delivered

- Added deterministic CJK subset pipeline script:
  - `scripts/fonts/generate-cjk-subset.ts`
  - corpus scan sources: `apps/web/src`, `apps/mobile/lib`, `apps/patient-app/lib`, `docs/demo`
  - emits `apps/web/public/fonts/cjk-glyphs.txt`
  - supports `pyftsubset` build for SC/JP/KR subset outputs via `--sc-font`, `--jp-font`, `--kr-font`
- Added npm entrypoint:
  - `npm run fonts:subset-cjk`
- Wired runbook instructions:
  - `installer/regen-font-bundle.md` includes end-to-end `--include-cjk` path and operational steps.

## Validation

- `npm run fonts:subset-cjk` ✅ (corpus generation path)
- `npm run guard:font-coverage` ✅ (15/15 script coverage; known narrative-serif warnings unchanged)

## Outcome

The required CJK subsetting tooling is now present, runnable, and documented in the canonical font-bundle runbook.
