# Master Plan 2026-04-18 — Phase R / S / T

**Status:** R1 landed 2026-04-18 (commit `fcfa1e4`). R-DOCS in progress.
R2 pending.

This is the consolidated team-facing plan for all outstanding work. It
supersedes scattered session notes and is the canonical reference until
R4 ships and the plan is succeeded by the next dated master-plan.

---

## §1. Why a rebuild

One paragraph: the 62 Phase 0.7.5 c24 schema-drift bugs (SD39-SD62) + 53
more surfaced by the Phase R R1 `check-code-writes-real-columns` guard
are all the same class — code writing columns that don't exist on the
target table. Patching them 115 times one-by-one is possible; a clean
consolidated baseline that encodes every schema decision correctly from
day one is faster AND durable. The rebuild is safe because the project
is not yet deployed (no production data to migrate). What prevents the
same drift class from recurring in 3 months of further development is
the three new CI guards (R1) — the rebuild resets state; the guards
keep state.

See [../audits/audit-20260418.md](../audits/audit-20260418.md) for the
full finding inventory.

---

## §2. Phase R — Rebuild + drift prevention

### R1 — Guards-first *(LANDED commit `fcfa1e4`)*

- `scripts/guards/check-migration-convention.ts` — builder-first DDL
  enforcement
- `scripts/guards/check-snapshot-freshness.ts` — ensures snapshot is
  regenerated after every migration
- `scripts/guards/check-code-writes-real-columns.ts` — THE preventer for
  SD39-62 class bugs
- `CLAUDE.md §12.1–12.3` — operator-facing rules
- `.github/workflows/ci.yml` — 3 new jobs + added to `ci-gate`
- `docs/fix-registry.md` — 7 new rows
- `.claude/settings.json` — 90 Bash allows + deny list

### R-DOCS — Documentation reorganisation *(IN PROGRESS)*

- Moved 8 archived audit reports to `docs/archives/` (git mv preserves
  history)
- Created this file + `docs/audits/audit-20260418.md` +
  `docs/fixes/fixes-20260418.md`
- READMEs added under `archives/`, `audits/`, `fixes/` explaining the
  date-stamped convention
- Naming convention: `audit-YYYYMMDD.md`, `fixes-YYYYMMDD.md`,
  `master-plan-YYYYMMDD.md`

### R2 — Consolidated baseline migration *(NEXT)*

1. `git tag pre-baseline-rebuild HEAD` — rollback anchor
2. `git mv apps/api/migrations/*.ts apps/api/migrations.archive/` — 82
   files archived; Knex stops scanning them
3. Hand-write `apps/api/migrations/20260701000000_baseline.ts` — one
   migration representing the whole intended schema. Each section drafted
   with `psql \d <table>` output pasted in, Knex schema builder used for
   simple DDL, `knex.raw` only for RLS + triggers + partial/functional
   indexes + views + partitioning + DML backfills + access control.
4. Resolve every SD39-62 + the 53 R1 drifts in the baseline:
   - Rename column (if code was writing a sensible name but DB was wrong)
   - Add column (if DB was wrong)
   - Drop column from code in R3 (if column was a typo)
   - Create missing tables (10 ghost tables + episode_types + 3 previously-added)
5. Drop + recreate `signacaredb` as `signacare_owner`, port 5433
6. `npm run migrate:dev` (baseline applies cleanly on empty DB)
7. `npm run db:snapshot --workspace=apps/api` (regenerates snapshot)
8. `npm run seed:good-health` + apply admin credentials
9. Commit: `chore(phase-r-r2): consolidated baseline + drop+recreate DB`

### R3 — Code reconciliation *(AFTER R2)*

1. Convert ~142 remaining `.returning('*')` sites to explicit column
   lists (same pattern as c24-d1 through c24-d12a). Per-site reasoning;
   no bulk conversions.
2. Add Zod validation to 59 unvalidated POST/PATCH endpoints
   (primarily auth + bed + beds + staff-settings families).
3. Activate the 21 ghost-table handlers flagged `TODO(Phase F)` in
   c24-d11 — remove the TODO markers and verify the handlers work now
   that the tables exist (R2 materialized them).
4. Update repository translation layers for dropped legacy columns so
   DTOs at API boundary stay stable while the new canonical column names
   flow through internally.

### R4 — Verification gate + tag

1. Full guard stack green (12 guards total)
2. `tsc --noEmit` clean in apps/api, apps/web, packages/shared
3. Unit + integration + E2E suite green
4. Browser smoke-test: login → create patient → appointment → medication →
   clinical note (exercises all major tabs)
5. `git tag v1.1.0` (baseline-rebuild complete)

---

## §3. Phase S — Features

After R4 lands. Each sub-phase runs the R1-era Execution Protocol:
per-handler 7-step protocol + 11 commit gates + 13-point audit + hard-stop
on pattern repetition + anti-shortcut self-check. Every feature sub-phase
begins with a spec-gate `AskUserQuestion` before code is written — no
guessing clinical/product specs.

### S1 — Clinical workflow modules (3-4 weeks)

9 modules from the 7-persona QA audit (Phase 0.7.3 findings):

| Sub-phase | Module | Estimate |
|---|---|---|
| S1a | Vitals / observations (range-check, flowsheet, alerts) | 3-5 days |
| S1b | Triage workflow | 3-5 days |
| S1c | Medication Administration Record (MAR) | 5-7 days |
| S1d | Care plan module | 3-5 days |
| S1e | MHA (Mental Health Act) forms per jurisdiction | 5-7 days |
| S1f | Incident logging + investigation | 5-7 days |
| S1g | Quality dashboard (Medical Director) | 5-7 days |
| S1h | Outcome measure auto-calc + graphing | 3-5 days |
| S1i | MHCP session count tracking | 2-3 days |

### S2 — AI safety integrations (~1 week)

6 wiring items from Phase 0.7.4 AI safety findings:

| Item | Scope |
|---|---|
| S2a | Wire `detectScribeHallucinations` into ambient save pipeline |
| S2b | Wire `promptGuard.sanitizeLlmInput` into all LLM paths |
| S2c | Add `llm_model` + `llm_metadata` columns to clinical_notes |
| S2d | Recording consent capture + enforcement |
| S2e | AI agent patient-context validation |
| S2f | Log AI agent interactions to llm_interactions |

### S3 — Operations features (1-2 weeks)

7 items from Phase 0.7.4 operations findings: staff leave, capacity/
utilisation reporting, SAR workflow, data retention, mandatory MFA per
role, integration health checks, clinic settings configurability.

### S4 — Seed expansion (2-3 days)

Good Health demo data for the new S1–S3 tables + E2E fixtures for new
features.

### S5 — Frontend DTO alignment (3-5 days)

- Patient list response shape reconciliation (flat vs nested)
- Audit remaining DTO mismatches + close them
- Add missing contract tests per response shape

---

## §4. Phase T — Deployment readiness (~3 weeks)

| Sub-phase | Scope | Estimate |
|---|---|---|
| T1 | Windows Server packaging (7 PRs) | ~2 weeks |
| T2 | Azure Key Vault secrets backend | 2-3 days |
| T3 | Integration test suite completion | 1-2 days |
| T4 | Playwright E2E completion | 2-3 days |
| T5 | Staging environment setup | 2-3 days |
| T6 | Load testing (k6 baseline + stress) | 1-2 days |
| T7 | Incident response tabletop exercise | 1 day |
| T8 | Version tags `v1.2.0`, `v1.3.0` | — |

Details per sub-phase live in the existing exhaustive plan at
[multi-specialty-expansion.md](multi-specialty-expansion.md) — not
duplicated here.

---

## §5. Execution protocol (applies to every phase)

Every commit in R / S / T follows Phase R's execution protocol:

1. **7-step per-handler edit protocol** — starts with `psql \d <table>`
   verification
2. **11 per-commit gates** — tsc + every CI guard + vitest + grep-verify
3. **13-point audit checklist** attached to every significant commit
   message
4. **Hard-stop on pattern repetition** — 2+ same-class drifts = STOP + investigate
5. **Anti-shortcut rules** — no bulk sed, no shared abstractions to
   reduce edit count, no silent deferral
6. **Commit message template** — Files edited, psql verification block,
   13-point audit, verified guards, self-check
7. **Spec gate via AskUserQuestion** before every S-phase feature
   sub-phase — no guessing

The 3 R1 guards police this mechanically for migration convention,
snapshot freshness, and code-writes-real-columns. The deny list in
`.claude/settings.json` hard-blocks the specific shortcut patterns at
the tool-invocation layer (sed -i, perl -pi, Python bulk-writes, git
--force, git reset --hard, git commit --no-verify, rm -rf on critical
paths).

---

## §6. What's explicitly out of scope for this plan

These items are scoped separately per the 2026-04-18 AskUserQuestion
decisions:

- **Phase 0.7.3** — 48 clinical workflow gaps from the 7-persona QA
  audit are addressed as S1 features, not as bug fixes.
- **Phase 0.7.4** — AI safety wiring + staff leave + capacity + SAR
  are addressed as S2 + S3, not as bug fixes.
- **Phase 0.8** — Good Health demo expansion is addressed as S4.
- **Phase 0.9** — Windows Server packaging is addressed as T1.
- **Patient list response shape** (flat vs nested) — documented tech
  debt; resolved in S5.
- **Tagging v1.1.0** — deferred until after R4's integration + E2E runs
  pass.

These are **scoped separately**, not downgraded.

---

## §7. Cross-links

- Findings: [../audits/audit-20260418.md](../audits/audit-20260418.md)
- Fix report: [../fixes/fixes-20260418.md](../fixes/fixes-20260418.md)
- Archived historical audits: [../archives/](../archives/)
- CI-guarded fix registry: [../fix-registry.md](../fix-registry.md)
- Existing exhaustive plan: [multi-specialty-expansion.md](multi-specialty-expansion.md)
- CLAUDE.md §12 (convention + code-column rules): [../../CLAUDE.md](../../CLAUDE.md)
