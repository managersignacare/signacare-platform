# D14 Document Cleanup + S0-First Backlog Reorganization Evidence

**Date:** 2026-05-24
**Mode:** Doc + backlog reorganization (no runtime feature work)
**Authority:** [`../../governance-control-plane.md`](../../governance-control-plane.md) §2
**Source plan:** `~/.claude/plans/valiant-plotting-snowglobe.md` PART 12

## 1) Mission recap

Operator directive (2026-05-24): execute document cleanup + S0-first backlog reorganization across the canonical governance/quality/product docs.

- A) Freeze and governance enforcement — confirm non-critical feature freeze + conflict-resolution order consistency.
- B) Backlog reorganization (S0-first) — restructure `bugs-remaining.md` into S0-pre / S1-pre / post-deployment buckets with 8 mandatory columns (Bug ID, Area/Workflow, Severity, State, Pre/Post deployment, Owner, Evidence link, Next action); de-duplicate; ensure CSV parity.
- C) Document declutter — apply `d10` declutter plan; create keep / merge / archive decision table; preserve compliance evidence.
- D) Product SSoT integrity — populate trace links between roadmap items, workflow IDs, and bug IDs.

Non-negotiables observed: gold-standard discipline (L1–L5 mindset, evidence-first, fail-loud), no hidden decisions, no blind deletes, no runtime feature work, no commit/push without explicit authorization, apply-patch-style atomic edits only, **only 2 new files created** (per operator 2026-05-24 directive — see §6 R7).

## 2) What changed (8 patches, 2 new files, 6 in-place edits)

| Patch | File | Change shape | New / Edit |
|---|---|---|---|
| P1 | `docs/quality/governance-control-plane.md` | Line 76 — Layer 0a wording added to evidence-chain phrase | EDIT |
| P2 | `docs/quality/engineering-execution-standard.md` | §3 title (Layer 0a forward-ref); §5 line 81 split (principles vs mechanics); §5 hierarchy pointer to governance-control-plane.md §2; §8 line 111 Layer 0a wording | EDIT (4 surgical) |
| P3 | `docs/quality/fix-build-rules.md` | §2 header — Layer 0a forward-ref to CLAUDE.md §11 | EDIT |
| P4 | `docs/quality/bugs-remaining.md` | Full restructure: lines 1–131 replaced with new Sections 1–5 (preamble + schema; S0-pre; S1-pre; post-deployment; superseded); Section 6 disclaimer inserted before legacy content; legacy content (lines 135–790) preserved verbatim as NON-AUTHORITATIVE reference archive | EDIT (2 large) |
| P5 | `docs/quality/bugs-remaining-2026-05-24.csv` | New full-mirror CSV (84 rows: 24 S0 + 40 S1 + 20 post-deployment) with 8-column schema | **NEW (whitelisted #1)** |
| P6 | `docs/product/workflows-and-features-ssot.md` | §2 Workflow Catalog — Evidence Anchor populated with BUG-IDs for all 13 workflows; §3 Feature Register — Open Bug Ref populated for all 4 features | EDIT (17 surgical) |
| P7 | `docs/product/product-roadmap-ssot.md` | §3 Roadmap Register — Linked Bugs populated for all 6 RM items | EDIT (6 surgical) |
| P8 | `docs/quality/remediation/evidence/d14-doc-cleanup-backlog-reorg-s0-2026-05-24.md` | This file | **NEW (whitelisted #2)** |
| P9 | `docs/README.md` | NO EDIT (navigation unchanged) | — |
| P10 | `docs/product/README.md` | NO EDIT (already minimal + correct) | — |

## 3) Why (per-patch)

- **P1 / P2 / P3:** resolve the 3 governance conflicts surfaced by the Phase-1 conflict map (see §4 below).
- **P4 / P5:** operator mission B — S0-first restructure with 8 required columns + CSV parity. Legacy by-severity and audit-wave content preserved in Section 6 as NON-AUTHORITATIVE reference archive (no rows deleted; audit-trail continuity preserved per operator non-negotiable rule #3).
- **P6 / P7:** operator mission D — populate concrete trace links between roadmap, workflow SSoT, and bug ledger; replaces the prior `as applicable` / `bug IDs` placeholders.

## 4) Conflict resolutions (3 conflicts identified, all resolved from existing canonical text)

| ID | Conflict | Resolution | Patch |
|---|---|---|---|
| C1 | `governance-control-plane.md` §2 declares a 4-level conflict-resolution hierarchy; `engineering-execution-standard.md` §5 says "reconcile immediately" without acknowledging it. | governance-control-plane.md §2 wins (it is the canonical hierarchy declaration). ESS §5 now appends: "Conflict resolution follows the hierarchy declared in `docs/quality/governance-control-plane.md` §2." | P2 |
| C2 | ESS §5 line 81 claimed co-authority over "Build and gate rules" with `fix-build-rules.md` (split-SSoT); governance-control-plane.md §2 assigns gate rules to fix-build-rules.md alone. | Scope split: ESS = "Gate **principles** (policy)"; fix-build-rules.md = "Gate **mechanics** (single SSoT for L1–L5 operational checks, 10-check matrix, commit-msg shape)." | P2 |
| C3 | CLAUDE.md §11 establishes the full chain as "Layer 0a + L1–L5"; governance-control-plane.md / ESS §3 / fix-build-rules.md §2 only said "L1–L5", silently dropping Layer 0a from the published chain. | Forward-reference Layer 0a (cite CLAUDE.md §11) in all three; update governance-control-plane.md §4 evidence-chain wording. | P1 + P2 + P3 |

**Non-conflicts (no patch):** severity definitions are single-SSoT in `bugs-remaining.md` Legend (other docs correctly defer). Freeze policy is single-SSoT in `governance-control-plane.md` §1.1 (other docs defer via cross-reference). All cross-doc links resolved in the Phase-1 link check. No doc is self-marked DRAFT/WIP.

## 5) d10 boundary tagging (per d10 §3 — Phase 0 Safety Freeze classification)

Tagging only; no physical moves in this pass (per operator stop condition #2 + 2-file-creation cap).

| Path | Classification | Notes |
|---|---|---|
| `apps/api` | core-runtime | Node/Express/TS backend; main monorepo workspace |
| `apps/web` | core-runtime | React/Vite/TS frontend; main monorepo workspace |
| `packages/shared` | core-runtime | Zod contract SSoT; 256 import sites from api, 169 from web |
| `packages/ui-components` | core-runtime (status: dead per master plan PART 11 §11.4) | Declared by web but 0 import sites; flagged for removal in a future declutter slice |
| `apps/mobile` | mobile-runtime | Flutter "Sara" clinician app; planned for repo split per PART 11 §11.3 |
| `apps/patient-app` | mobile-runtime | Flutter "Viva" patient app; planned for repo split per PART 11 §11.3 |
| `apps/emr-gateway` | gateway-runtime | Stays in monorepo per PART 11 §11.3 (genuine Node/TS workspace; MongoDB-backed) |
| `deploy/`, `infra/` | deployment | Infra-as-code; small consolidation flagged in PART 11 |
| `docs/quality/remediation/evidence/` | evidence/audit | 154 files; 135 compliance-evidence (PRESERVE); 19 with PHI/regulatory mentions require explicit authorization for any archive move |
| `docs/archive/` | evidence/audit | Existing archive of historical audits (preserved as-is) |
| `backups/`, `artifacts/`, `test-results/` (working tree) | scratch/generated | Untracked runtime artifacts; cleanup in future declutter slice (PART 11) |

## 6) Remaining risks + open items

- **R1 — Fix-registry orphan anchors (S2):** 2 anchors spot-checked as orphan (BACKUP4 `apps/api/src/jobs/schedulers/backupScheduler.ts` pattern `cron\.schedule\('\* \* \* \* \*'`; BLOB9 `apps/api/src/features/power-settings/powerSettingsRoutes.ts` pattern `blobStorage\.put\(`). Logged as `BUG-FIX-REGISTRY-ORPHAN-DRAIN` in `bugs-remaining.md` Section 4. Repair is runtime/CI work — explicitly **out of scope** for this doc-only pass per operator's no-runtime-feature-work rule.
- **R2 — 19 PHI / regulatory-mention evidence files (operator decision required):** Agent 3 (Phase 1 inventory) identified 19 files under `docs/quality/remediation/evidence/` carrying explicit PHI / regulatory / compliance markers (e.g. `a4b-bug-313-third-party-logger-phi-audit-*`, `a4c-bug-270-redactphi-traversal-hardening-*`, `b3-ect-tms-*`, `b4-bug-585-followup-multi-tier-cascade-*`, `d9-scribe25-ruthless-triage-and-execution-*`). **Decision in this pass: ZERO physical archive moves.** All 19 files remain in place. Operator may direct otherwise in a separately authorized step.
- **R3 — Evidence-link gaps in restructured `bugs-remaining.md`:** of the 64 active S0+S1 rows in Sections 2+3, only 8 carry an Evidence link (BUG-344, BUG-P1, and the 6 BUG-SCRIBE25-001..006 pointing at `d9-scribe25-ruthless-triage-and-execution-2026-05-22.md`). The remaining 56 rows have empty Evidence link — these are open / in_progress work items where closure-evidence files have not yet been produced. This is the expected pattern (evidence is added at closure time). Tracked transparently in the ledger.
- **R4 — d10 §5 four new guards (S1-pre):** logged as `BUG-D10-GUARD-TRACKED-IGNORED`, `-ZERO-BYTE`, `-ENV-TEMPLATE`, `-XPROJECT-BOUNDARY` in `bugs-remaining.md` Section 3. Implementation is runtime/CI work — out of scope for this pass; visible in restructured ledger.
- **R5 — In-flight uncommitted work (~40 files):** the working tree has ~40 modified files from prior in-flight work unrelated to this doc cleanup. The 8 doc patches above touch ONLY governance/quality/product docs — zero overlap with the in-flight code changes. Operator confirms branch/timing for the commit.
- **R6 — `packages/ui-components` dead workspace:** out of scope for this doc cleanup (tracked in master plan PART 11 §11.4 + d10 classification §5).
- **R7 — File-creation cap enforced:** per operator directive 2026-05-24 ("after execution, don't create more files apart from what was indicated in the prompt"), exactly 2 new files were created: this `d14` evidence artifact and `bugs-remaining-2026-05-24.csv`. Verification: `git status --porcelain` shows exactly two `??` lines (these two) plus `M ` lines for the 6 in-place edits. Mechanical proof in the Required Outputs §1.

## 7) Cross-refs

- **Source plan:** `~/.claude/plans/valiant-plotting-snowglobe.md` PART 12 (sections 12.0–12.14)
- **Sibling declutter plan:** [`d10-repo-declutter-architecture-plan-2026-05-22.md`](d10-repo-declutter-architecture-plan-2026-05-22.md)
- **Authority document:** [`../../governance-control-plane.md`](../../governance-control-plane.md)
- **Engineering execution standard:** [`../../engineering-execution-standard.md`](../../engineering-execution-standard.md)
- **Gate mechanics SSoT:** [`../../fix-build-rules.md`](../../fix-build-rules.md)
- **Restructured backlog:** [`../../bugs-remaining.md`](../../bugs-remaining.md)
- **CSV mirror:** [`../../bugs-remaining-2026-05-24.csv`](../../bugs-remaining-2026-05-24.csv)
- **Product SSoTs:** [`../../../product/workflows-and-features-ssot.md`](../../../product/workflows-and-features-ssot.md), [`../../../product/product-roadmap-ssot.md`](../../../product/product-roadmap-ssot.md)

## 8) Sign-off

- **Implementer:** Claude (Opus 4.7, operating per CLAUDE.md + memory feedback rules)
- **Date:** 2026-05-24
- **Operator authorization:** pending — this artifact is produced before any commit; operator review of the 6 required outputs precedes commit-message + staged-file-list authorization per operator non-negotiable rule #5.

---

## Appendix A — Multi-language font coverage audit (PART 13 Layer E2)

**Date:** 2026-05-25
**Authority:** master plan PART 13 §13.11.5
**Scope:** verify the active web font stack (Albert Sans → Inter → Helvetica Neue → Arial → sans-serif) and the print serif stack (Source Serif Pro → Georgia → Times New Roman → serif) cover every script Signacare must render given its AU clinical context.

### A.1 — Languages Signacare must serve

Signacare is deployed in Australian mental-health clinics. Inventory sources:
- `apps/api/tests/fixtures/canonical-personas.ts` — current seed data uses Latin names only (`Chen`, `O'Brien`, `Wilson`).
- DB schema (`patients.given_name` / `patients.family_name`) — stored as plain `text` columns with no Unicode constraint; can hold any UTF-8 codepoint.
- No `preferredLanguage` / `spoken_language` / `patient_language` column found in current migrations — there is no formal patient-language tracking.
- No i18n framework (`react-intl` / `i18next` / similar) in `apps/web` — UI is English-only.

**Real-world AU patient demographics** (mental-health clinic context — not formally inventoried in the repo but operationally required):
- **Latin (extended)** — English, Italian (Italian-Australian community), Greek, German, French, Spanish, Polish, Croatian, Vietnamese (romanized).
- **CJK** — Mandarin Chinese (largest non-English language in metro AU per ABS Census), Cantonese, Korean, Japanese.
- **Arabic** — Arabic, Persian / Farsi, Urdu.
- **Indic scripts** — Hindi (Devanagari), Tamil, Punjabi (Gurmukhi), Bengali, Sinhala.
- **Other** — Hebrew, Thai, Khmer, Burmese.

Signacare may need to render any of these in patient names, contact records, clinical-note free text, or correspondence. The UI itself stays in English.

### A.2 — Font coverage matrix

| Script class | Albert Sans (web body) | Inter (fallback) | Helvetica Neue / Arial (last-resort) | Source Serif Pro (print) | Georgia / Times NR (print fallback) |
|---|---|---|---|---|---|
| **Latin (Basic)** A–Z, a–z | ✓ | ✓ | ✓ | ✓ | ✓ |
| **Latin (Extended)** diacritics — é è ñ ø … | ✓ | ✓ | ✓ (Arial Unicode subset) | ✓ | ✓ |
| **Vietnamese** (Latin + combining marks) | ✓ | ✓ | partial | partial | partial |
| **Cyrillic** (Russian, Ukrainian) | ✓ | ✓ | ✓ (system) | ✗ | partial (Georgia) |
| **Greek** | ✓ | ✓ | ✓ (system) | ✗ | partial (Georgia) |
| **CJK** (Chinese / Japanese / Korean) | ✗ | ✗ | OS system fallback | ✗ | OS system fallback |
| **Arabic** + RTL | ✗ | ✗ | OS system fallback | ✗ | OS system fallback |
| **Devanagari** (Hindi) | ✗ | ✗ | OS system fallback | ✗ | OS system fallback |
| **Tamil / Punjabi / Bengali / Sinhala** | ✗ | ✗ | OS system fallback (only when locale installed) | ✗ | OS system fallback (variable) |
| **Hebrew** | ✗ | ✗ | OS system fallback | ✗ | OS system fallback |
| **Thai / Khmer / Burmese** | ✗ | ✗ | OS system fallback (varies; not guaranteed on all OSes) | ✗ | OS system fallback |

**Method:** coverage assessed per Google Fonts metadata, Microsoft / Apple OS font catalogue, and W3C CSS Fonts module fallback algorithm (browser falls through the `font-family` list and ultimately into OS-default Unicode-coverage fonts when no listed face covers a glyph).

### A.3 — Identified gaps

1. **No web font in our stack covers CJK / Arabic / Devanagari / Tamil / Punjabi / Bengali / Sinhala / Hebrew / Thai / Khmer / Burmese.** Patients with names in those scripts render via the browser's OS-fallback chain. This works on macOS / Windows / iOS / Android (all bundle CJK + Arabic + Indic by default in recent OSes) but **mixes typography mid-name** — e.g. "陈 Sarah" renders with two different fonts (CJK from OS, Latin from Albert Sans). Visually inconsistent but legible.
2. **OS-fallback unreliability for less-common scripts.** Tamil, Punjabi, Bengali, Sinhala, Khmer, Burmese fonts are NOT bundled in every OS version (older Windows 10 builds lack some Indic; older Android lacks Burmese). Patient names in those scripts may render as **tofu boxes (□)** on those systems.
3. **Print stack is worse than web stack.** Source Serif Pro covers Latin only. Georgia / Times New Roman cover Latin extended + Cyrillic + Greek but no CJK / Arabic / Indic. **Printed clinical narrative containing non-Latin names falls through to OS-default serif, which may break the visual hierarchy of the printed document.**
4. **No automated test / guard catches script-coverage regressions.** A future font swap that removes Cyrillic coverage (e.g., swap Inter → a Latin-only font) silently breaks rendering for patient names with Cyrillic characters and the team has no signal.

### A.4 — Severity classification (per CLAUDE.md severity ladder)

- **S2 — should-ship-before-GA** for CJK / Arabic / Indic web rendering. AU clinics serving multilingual populations need consistent typography; OS-fallback works but is suboptimal. Mitigation: add a CJK-covering web font (e.g. `Noto Sans CJK` family) as a tertiary fallback; add `Noto Sans Arabic` for RTL.
- **S2 — should-ship-before-GA** for print stack non-Latin coverage. Clinical print is medico-legal evidence; visual inconsistency on a patient's printed file is a quality issue.
- **S3 — tech debt** for adding a `guard:font-coverage` CI check (regression-proof the stack against script removals).

**No S0 / S1 surfaced.** Patient names render legibly today via OS fallback; the gaps are visual-quality issues, not safety blockers.

### A.5 — Recommended follow-up BUGs (NOT in scope for this Layer E2 audit — the audit is the deliverable)

- `BUG-FONT-CJK-COVERAGE` (S2) — add `Noto Sans CJK SC` / `JP` / `KR` to the web font fallback chain in `apps/web/index.html` + `ThemeProvider.tsx` typography stack.
- `BUG-FONT-ARABIC-RTL-COVERAGE` (S2) — add `Noto Sans Arabic` + verify RTL text direction handling on patient-name / clinical-note display surfaces.
- `BUG-FONT-INDIC-COVERAGE` (S2) — add `Noto Sans Devanagari` / `Tamil` / `Gurmukhi` / `Bengali` / `Sinhala` for South Asian community coverage.
- `BUG-FONT-PRINT-NON-LATIN` (S2) — extend the print stylesheet `font-family` chain to include `Noto Serif CJK` etc. so printed clinical narrative renders non-Latin names consistently.
- `BUG-GUARD-FONT-COVERAGE` (S3) — add a CI script that asserts the font-family chain covers a curated test-string set across scripts. Fails on font removal.
- `BUG-FONT-BUNDLING-OFFLINE` (S3) — separately track migration from Google Fonts CDN (current Layer E1 Path B) to locally-bundled `@font-face` for offline-strict clinics. Not in scope for this audit.

### A.6 — Validation method note

The matrix above is built from font-vendor documentation + browser fallback specification, **not** from runtime measurement. A more rigorous follow-up renders representative test strings in each script in each font and visually verifies — that's appropriate for the recommended follow-up BUGs, not for this initial audit.

---

## Appendix B — Inter font swap evaluation (PART 13 Layer F1 — EVALUATION ONLY)

**Date:** 2026-05-25
**Status:** **EVALUATION ONLY — no font swap implemented.** Per master plan PART 13 §13.11.6 and `feedback_absolute_gold_standard.md`, this evaluation produces decision data; the actual swap decision is the operator's at evaluation end.

The operator-supplied EMR design guide PDF recommended Inter as the primary font for clinical apps. My critical evaluation in master plan PART 13 §13.0 rejected the swap because:
1. Signacare already runs the stack `Albert Sans → Inter → Helvetica Neue → Arial` — Inter is the second fallback already.
2. The real win was enabling tabular numerals (Layer A1), not changing the primary face.
3. Albert Sans is the current brand voice; swap to Inter changes brand identity from geometric/modern to humanist/neutral.

Per operator instruction (2026-05-25) the work is included in scope as an evaluation deliverable. Evaluation criteria + data below.

### B.1 — Evaluation criteria + observations

| # | Criterion | Albert Sans (current primary) | Inter (proposed primary) | Verdict |
|---|---|---|---|---|
| 1 | x-height at clinical body sizes (14, 16, 18 px) | Mid-height; reads slightly smaller at 14 px | Higher x-height; reads slightly larger at all sizes | Inter wins for data-density screens |
| 2 | Digit shape distinguishability (0 / O / 1 / l / I) | Distinct digits; 0 has no slash but narrower than O | Distinct digits; ss01 stylistic set adds slashed zero | Roughly even; Inter has more stylistic sets |
| 3 | Tabular figure quality | Supports `tnum` OpenType feature; widths consistent | Supports `tnum` + `lnum` + dedicated tabular-spaced metrics designed for clinical/financial tables | Inter wins — best-in-class for column alignment |
| 4 | OpenType feature breadth | `tnum`, `lnum`, `kern`, `liga` | `tnum`, `lnum`, `kern`, `liga`, `salt`, `ss01..ss20`, `case`, `cv01..cv11` | Inter wins on disambiguation features |
| 5 | Weight breadth available | 300 / 400 / 500 / 600 / 700 / 800 | 100–900 + italic at all weights | Inter wins on options |
| 6 | Brand identity impact | Geometric / modern / friendly — Signacare's current voice | Humanist / neutral / institutional — feels like Material Default | **Albert Sans wins on brand differentiation**; Inter makes Signacare look like every other Material-default EMR |
| 7 | Cross-platform rendering consistency | Good on Windows, macOS, iOS, Android via Google Fonts | Excellent — designed for cross-platform screen rendering; widely used (Vercel, Figma, Linear) | Inter wins by design intent |
| 8 | License + bundling cost | SIL OFL — permissive | SIL OFL — permissive | Even |
| 9 | Existing usage (`apps/web/src` `font-family` greps) | Centralized in `ThemeProvider.tsx`; no inline override sites — clean swap surface | n/a (would replace) | Either swap is a single-file change |
| 10 | Disambiguation under clinical lighting (dim / glare) | Geometric strokes uniform; OK in low-light | Humanist strokes (slight contrast) — slightly better legibility in low-light | Inter wins on glare/dim conditions |
| 11 | Patient-app perception (Viva is patient-facing) | n/a (Viva uses platform default, not Albert Sans) | n/a (would remain platform default in Viva) | N/A |
| 12 | Reverse-compatibility on swap | n/a | Albert Sans stays in fallback chain | Inter swap is reversible (single-file edit) |

### B.2 — Net evaluation

**Pro-swap (favours Inter):**
- Slightly better data-table legibility (criteria 1, 3, 4, 10).
- More disambiguation options (criterion 4 — ss01 distinguishes ambiguous digits).
- Industry-default for clinical / data-heavy UIs (criterion 7).

**Pro-status-quo (favours Albert Sans):**
- Brand identity (criterion 6) — Signacare's geometric voice is a market differentiator; swapping to Inter makes the app visually identical to Cerner / Epic / Heidi / every other EMR.
- Existing CI passes — no regression risk if no swap.
- The biggest data-table win (tabular numerals) is **already enabled in Layer A1** regardless of which face wins. Swapping fonts is incremental, not foundational.

### B.3 — My recommendation (unchanged from PART 13 §13.0)

**Do NOT swap primary.** Keep Albert Sans as primary, Inter as the first fallback (already in place — `font-family: "Albert Sans", "Inter", ...`). The structural win was Layer A1 (tabular numerals); a font swap on top would be a brand-identity change for a marginal data-legibility upgrade.

**Counter-recommendation worth considering: hybrid.** Albert Sans for chrome / headings, Inter exclusively for the `data` MUI variant (Layer C). That gives the data-table legibility win of Inter without changing brand identity. **Implementable as a single typography-block change in `ThemeProvider.tsx` (the `data` variant's `fontFamily` reorders to `'"Inter", "Albert Sans", ...'`).** If operator wants this, I can apply it on direction.

### B.4 — Decision matrix for operator

| Decision | What changes | Impact |
|---|---|---|
| **Stay on Albert Sans (my recommendation)** | 0 file changes | Preserves brand; tabular numerals already enabled |
| **Full swap to Inter primary** | `apps/web/src/shared/theme/ThemeProvider.tsx` typography.fontFamily change | Brand shift from geometric to humanist; better data-table legibility |
| **Hybrid — Inter only for `data` variant** | `data` variant `fontFamily` override in `ThemeProvider.tsx` | Brand preserved on chrome / body / headings; Inter on numeric data tables only |

**No font swap performed by this evaluation deliverable.** Operator decides; record decision here when made.

---

## Appendix C — Layer F2 (patient-app default theme change) — HARD-GATED HOLD

**Date:** 2026-05-25
**Status:** **HOLD per HARD gate.** Per master plan PART 13 §13.11.7 and operator Q2 (2026-05-25) decision, Layer F2 (changing the patient-app — Viva — default theme from purple `vivaTheme` to the `warmth` walnut palette) is HARD-GATED behind an explicit operator Q2 reversal.

**No code change made to Viva's default theme.** `vivaTheme` (purple #7B1FA2) remains the default in [apps/patient-app/lib/main.dart](apps/patient-app/lib/main.dart)'s MaterialApp `theme:` argument. Layer D1.1 added `vivaWarmthTheme` (walnut palette) as a **parallel** ThemeData — AVAILABLE in code, but the active `theme:` argument in MaterialApp continues to reference `vivaTheme`.

**To lift the hold:** operator must explicitly state "I am reversing my 2026-05-25 Q2 decision; patient-app default may change from purple `vivaTheme` to `warmth`." Until that explicit reversal, no F2 commit will be proposed.
