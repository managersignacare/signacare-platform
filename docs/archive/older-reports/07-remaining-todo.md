# 07 — Remaining TODO (Risk-Stratified Backlog)

Every item below is deferred, with an explicit reason and a risk rating. Nothing on this page is a silent gap.

## Risk rating scale

| Rating | Meaning |
|---|---|
| 🔴 **P0** | Must ship before public production go-live |
| 🟠 **P1** | Ship before first paying tenant |
| 🟡 **P2** | Ship before scale (>10 tenants / >10k patients) |
| 🟢 **P3** | Nice-to-have, measurably improves the gold-standard score |

---

## Completed since 2026-04-11

Items shipped between the baseline audit (2026-04-11) and the current refresh
(2026-04-14). Every line references a commit hash on `main` that can be read
in isolation — use `git show <hash>` if you need the details.

| Area | Capability shipped | Commit(s) |
|---|---|---|
| Communications | **Phase 10** — WebSocket-discipline notification centre, durable `notifications` table, SMS removal from staff surfaces, CI guards (`no-telecom`) enforcing the policy | `cdb48fe` |
| Communications | **Phase 11A** — `/api/v1/mobile/sync` delta endpoint + FCM fan-out backend for Sara + Viva | `c4b6a82` |
| Mobile | **Phase 11B/E** — Flutter FCM service on Sara + Viva, downstream sync preferences (per-module opt-in), local document cache, on-device reminder scheduler, iOS `UIBackgroundModes` | `602b192`, `1f2b823`, `ec969cd` |
| Communications | **Phase 12** — Patient outreach dispatcher (`patientOutreachService`), ACS SMS fallback with clinician override + consent gating + per-clinic monthly budget cap, `no-acs-in-staff-features` CI guard pinning ACS to one service | `431a9b4` |
| Data ingest | **Bulk CSV import pipeline** — generic `importService` + 5 adapters (patients, MHA, LAI, clozapine, clinical notes); dry-run → commit two-phase; RLS-scoped `import_jobs` audit table | `b4f3deb`, `bccaaaa` |
| Clinical workflow | **Patient re-allocation approval** — team-leader / manager two-step gating (via `staff_role_assignments.role_type`), four-eyes principle (no self-approval), Viva notification on approve via `team_reassignment` outreach kind | `2c024a8`, `bd8106a` |
| Access control | **Per-staff module-access ABAC** — canonical `MODULE_KEYS` (36 keys), `requireModuleRead` / `requireModuleWrite` middleware with **RBAC fallback** (so retrofits are additive-safe), per-route retrofit on 28 legacy feature routes, backfill migrations seeding clinicians + admins, admin matrix UI under Org Settings → Access Control | `e0571be`, `922b18e`, `361db96`, `d30fda1`, `7b64067` |
| Security | **Shared `binaryResolver`** — absolute-path resolution for `pg_dump`, `gzip`, `gunzip`, `ollama`, `ocrmypdf`, `pdftotext`, `tesseract`, `python3` (Whisper); every child_process call migrated from shell strings to array args; command-injection fix in `llmTrainingRoutes.ts` (Ollama adapter name regex-validated before `execFile`); `DB_PASSWORD` now passed via child env rather than command line; backup pipeline fully rewritten to use `spawn` + programmatic stdio pipe | `3e010f3` |
| Security | **LAI `recordGiven` transaction fix** — previous code called `forUpdate()` outside any `db.transaction`, so the row lock was released immediately and two concurrent calls could double-advance the schedule. Critical section now wrapped in a single transaction with `trx` threaded through four repository methods. | `7f4af26` |
| Security | **Clozapine upsert `clinic_id` defence-in-depth** — `upsertTitrationDay` and `upsertMonitoringCheck` existing-row lookups now scoped by `clinic_id` | `7f4af26` |
| Specialty visibility | **Endocrinology `glucose` tab registry gate** — the module registry was missing the `glucose` tab so toggling endocrinology OFF in Power Settings did not hide the flowsheet. Fixed by adding `endocrinology.module` with `patientTabs: [{ id: 'glucose', … }]` | `7f9f961` |
| Infra hygiene | **`.claude/worktrees/` untracked + `.gitignore`** — accidental `git add -A` had swept a subagent scratch worktree into `main`. Removed from tracking; `.gitignore` prevents recurrence | `d224deb` |

**Outcome:** 11 deferred items from the 2026-04-11 backlog are now shipped.
Reports 01–06 have not yet been rewritten to reflect the new state — use the
`00-INDEX.md` drift section and the table above as the authoritative record
until those are refreshed.

---

## A. Outstanding `it.fails` markers

**All 13 previously outstanding markers have been flipped** as of 2026-04-11:

| ID | File | Resolution |
|---|---|---|
| A-llm-01..10 | `tests/unit/llmPromptInjection.test.ts` | Shipped `sanitizeLlmInput` classifier in `apps/api/src/integrations/scribe/promptGuard.ts` — rejects 10 OWASP LLM01 canonical attacks, passes psychiatric vocab + legitimate free-text |
| A-llm-11 | `tests/unit/llmPromptInjection.test.ts` | "Allows legitimate clinical text through unchanged" now a real assertion |
| A-rx-01 | `tests/integration/prescribingSafety.test.ts` | `checkContraindications` with β-lactam / sulfonamide / NSAID cross-reactivity matrix |
| A-rx-02 | `tests/integration/prescribingSafety.test.ts` | Clozapine baseline-ANC guard in `checkContraindications` |

**Unit suite final count:** 417 passing, 0 `it.fails`.

---

## B. Software / feature gaps

| ID | Feature | Rating | Why deferred | Effort |
|---|---|---|---|---|
| FEAT-01 | **SSO: SAML 2.0 / OIDC federation** | 🟠 P1 | Enterprise tenants need SSO; current auth is JWT-only | M |
| FEAT-02 | **My Health Record integration** | 🟠 P1 | AU national record — required for public-health deployments | L |
| FEAT-03 | National Medicare / MBS billing | 🟠 P1 | Currently partial under `billing/` | L |
| FEAT-04 | E-prescribing national gateway (ePrescription) | 🟡 P2 | `escript/` integration is local only | M |
| FEAT-05 | Telehealth video (Jitsi / Whereby) | 🟡 P2 | Not implemented | M |
| FEAT-06 | Advanced reporting / BI dashboards | 🟡 P2 | `reports/` runs static report defs; need Grafana/Metabase | M |
| FEAT-07 | Patient-app self-scheduling | 🟡 P2 | Patient-app read-only today | M |
| FEAT-08 | Group therapy enrolment workflow | 🟡 P2 | `group-therapy/` exists; UX incomplete | S |
| FEAT-09 | Dental / radiology / oncology modules | 🟢 P3 | Out of scope for MH-focused product |
| FEAT-10 | MDT collaboration tooling | 🟡 P2 | Base tables exist; UI partial |

---

## C. Compliance / organisational

| ID | Requirement | Rating | Status |
|---|---|---|---|
| COMP-01 | **External penetration test** | 🟠 P1 | 🅿️ **PARKED** — engineering-ready, codebase is at the bar. Blocker: **CEO** signs a Statement of Work with a CREST/OSCP pentest firm. Scope pre-written at [docs/PENTEST_SCOPE.md](../PENTEST_SCOPE.md). No engineering work will move this forward. |
| COMP-02 | **ISO 27001 certification** | 🟠 P1 | 🅿️ **PARKED** — every technical control is in place (see [04-security-features.md](04-security-features.md)). Blocker: **CEO + Security Lead** draft the Statement of Applicability and engage a JAS-ANZ certifying body. |
| COMP-03 | **SOC 2 Type II report** | 🟡 P2 | 🅿️ **PARKED** — controls + tamper-evident audit log are in place. Blocker: **CEO** engages a SOC 2 auditor; Type II needs a 6-month observation window. |
| COMP-04 | **IRAP assessment (AU Gov)** | 🟡 P2 | Required for AU government hosting |
| COMP-05 | **TGA SaMD applicability review** | 🟠 P1 | Need legal opinion on whether the AI scribe / clinical-decision support elevates classification |
| COMP-06 | Clinical safety officer sign-off on hazard register | 🟠 P1 | Register complete; signature pending |
| COMP-07 | DPO / Privacy Officer appointment | 🟠 P1 | Required under APP 1 |
| COMP-08 | Data Residency statement (AU-only) | 🟡 P2 | Infra choice locks this down; statement not yet published |
| COMP-09 | **Cyber-liability insurance** | 🟠 P1 | 🅿️ **PARKED** — engineering posture supports a favourable premium. Blocker: **CEO** collects quotes and signs with a carrier. |
| COMP-10 | **Uptime SLA (Master Services Agreement)** | 🟠 P1 | 🅿️ **PARKED** — engineering already meets 24h RTO / 1h RPO on paper. Blocker: **Legal + CEO** finalise and sign the MSA template. |

---

## D. Operational / CI-CD

| ID | Item | Rating | Detail |
|---|---|---|---|
| OPS-01 | **Deploy pipeline dry-run → real** | 🟠 P1 | `.github/workflows/deploy.yml` has 10 jobs currently gated on `DRY_RUN=true`. Production approval step + real blue-green deploy step pending. |
| OPS-02 | **k6 perf baseline executed** | 🟠 P1 | Scripts exist in `scripts/k6/`; never run against dev API. Need a scheduled nightly baseline so regressions are caught. |
| OPS-03 | Renovate / Dependabot | 🟡 P2 | Not yet configured; deps manual |
| OPS-04 | Uptime monitoring | 🟠 P1 | No external probe configured |
| OPS-05 | Runtime alerting (Sentry → Slack / PagerDuty) | 🟠 P1 | Sentry hook present but disabled |
| OPS-06 | DB backup → off-site replication | 🟠 P1 | `pg_dump` scheduled; S3 target not yet wired |
| OPS-07 | WAF (CloudFront / Cloudflare) | 🟡 P2 | nginx only today |
| OPS-08 | Observability: Grafana + Prometheus dashboards | 🟡 P2 | Structured logs exist; no dashboards |
| OPS-09 | Load test → SLA document | 🟡 P2 | Baseline needs to define the targets |

---

## E. Testing & QA

| ID | Item | Rating | Detail |
|---|---|---|---|
| QA-01 | RBAC role × endpoint matrix test | 🟡 P2 | Current RBAC test covers the happy path; full matrix deferred |
| QA-02 | Chaos testing (DB/Redis drop) | 🟡 P2 | HAZARD-012 covered at /ready; in-request graceful-degradation is deferred to chaos engineering |
| QA-03 | Full Playwright suite in CI headless | 🟡 P2 | Runs locally; CI job not yet wired |
| QA-04 | Migration rollback drill | 🟡 P2 | Append-only policy makes rollback a migrate-forward — dry drill pending |
| QA-05 | Mutation testing (StrykerJS) | 🟢 P3 | Would strengthen unit-test assertions |

---

## F. Known pre-existing issues

| ID | Issue | Rating | Detail |
|---|---|---|---|
| ISSUE-01 | Back-to-back `/api/v1/auth/login` in integration tests occasionally 500 | 🟡 P2 | Root cause was `jti` collision — fixed in this session (2026-04-11). Marked closed but monitoring. |
| ISSUE-02 | 60 `it.fails` markers in earlier version of suite | 🟢 P3 | 14 flipped to real tests in the last two sessions; 11 remain (see §A) |
| ISSUE-03 | Dev DB lacks some post-2026-04 migrations | 🟡 P2 | Migrations apply-forward safely; production DB ok |

---

## Rollout ordering (suggested)

```
P0 — none remaining
P1 — COMP-01, COMP-02, COMP-05, COMP-06, COMP-07,
     OPS-01, OPS-04, OPS-05, OPS-06, FEAT-01, FEAT-02, FEAT-03
P2 — remaining FEAT-*, OPS-02, OPS-03, OPS-07, OPS-08, OPS-09,
     QA-01, QA-02, QA-03, QA-04
P3 — FEAT-09, QA-05
```

**Before first paying tenant:** every 🔴 and 🟠 item must be closed OR carry a signed risk-acceptance from the clinical safety officer.

**Before >10 tenants:** every 🟡 must be closed OR have a documented mitigation.

---

## Comparison — Deployment readiness gap

| Dimension | Signacare today | Epic production | Oracle Cerner production | Best Practice production |
|---|---|---|---|---|
| Software feature parity for mental health | ✅ | ⚠️ (BH module add-on) | ⚠️ | ❌ |
| Compliance audits signed | ❌ | ✅ | ✅ | ✅ |
| National-scale deployment references | ❌ | ✅ | ✅ | ✅ |
| Production-ready deploy pipeline | ⚠️ (dry-run) | ✅ | ✅ | ✅ |
| Formal pentest | ❌ | ✅ | ✅ | ✅ |
| On-call runbook | ⚠️ docs drafted | ✅ | ✅ | ✅ |
| Uptime SLA signed | ❌ | ✅ | ✅ | ✅ |
| Indemnity & liability insurance | ❌ | ✅ | ✅ | ✅ |

The software-side gap against Epic / Cerner / Best Practice is small. The **organisational + operational gap** (audits, SLAs, insurance, references) is where the remaining work lives. None of those items are engineering problems.
