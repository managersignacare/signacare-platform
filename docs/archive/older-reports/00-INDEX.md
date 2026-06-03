# Signacare EMR / Signacare — Gold Standard Audit Reports

**Generated:** 2026-04-11
**Last refreshed:** 2026-04-14 (headline table only — individual reports 01–08 still reflect 2026-04-11 state, see the **Drift since 2026-04-11** section below and `07-remaining-todo.md` for what has shipped since)
**Branch:** main
**Scope:** Full-stack multi-specialty EMR — API (Express/TypeScript), web (React), mobile (Flutter — Sara clinician + Viva patient), integration gateway

---

## Report index

| # | File | Purpose |
|---|------|---------|
| 01 | [Software Features](01-software-features.md) | Clinical + operational feature inventory |
| 02 | [Enterprise Features](02-enterprise-features.md) | Multi-tenant, admin, licensing, org-wide controls |
| 03 | [System Architecture](03-system-architecture.md) | Topology, data flow, infrastructure |
| 04 | [Security Features](04-security-features.md) | AuthN/AuthZ, tenancy, crypto, audit, tamper-evidence |
| 05 | [Compliance Reports](05-compliance-reports.md) | APP, HIPAA, ACHS, ISO 14971, RANZCP, FHIR, HL7 |
| 06 | [Test Completion Report](06-test-completion-report.md) | All tests, counts, categories, verdicts |
| 07 | [Remaining TODO](07-remaining-todo.md) | Deferred items with risk-stratified backlog |
| 08 | [Deployment Guide (Gold Standard)](08-deployment-guide.md) | Production deploy, DR, runbook, approvals |

Every report includes a **comparison table** against **Epic**, **Oracle Cerner**, and **Best Practice** (Australian primary-care software) at a high level. Those columns are editorial and reflect publicly-known capability tiers — they are intended to orient reviewers, not to replace a formal RFP evaluation.

---

## At-a-glance status

| Dimension | 2026-04-11 (baseline) | 2026-04-14 (current) | Δ |
|---|---|---|---|
| API feature domains (`apps/api/src/features/*`) | 55+ | **65** | +10 |
| API route mount points under `/api/v1/*` | 68 | **80** | +12 |
| Database migrations (append-only) | 81 | **106** | +25 |
| Tables with RLS policies | 9 explicit + baseline | **every specialty table**, plus `notifications`, `patient_outreach_log`, `import_jobs`, `patient_sync_preferences`, `staff_fcm_tokens`, `patient_fcm_tokens` | material expansion |
| Unit test files | 33 | **62** | +29 |
| Integration test files | 19 | **19** | 0 |
| E2E Playwright specs | 14 | **16** | +2 |
| Fix Registry entries verified | 206 / 206 | **431 / 431** | +225 |
| Dependency-cruiser violations | 0 | 0 | 0 |
| TypeScript build | clean | clean | — |

### What shipped between 2026-04-11 and 2026-04-14

| Phase | Feature | Commit(s) |
|---|---|---|
| 10 | WebSocket-discipline notification centre + SMS removal | `cdb48fe` |
| 11A | Mobile delta sync + FCM fan-out backend | `c4b6a82` |
| 11B+11E | Flutter FCM service (Sara + Viva), downstream sync preferences, document cache, on-device reminder scheduler | `602b192`, `1f2b823`, `ec969cd` |
| 12 | Patient-outreach dispatcher (ACS SMS with clinician override, consent gating, monthly budget cap) | `431a9b4` |
| — | Bulk CSV import pipeline (patients, MHA, LAI, clozapine, clinical notes) | `b4f3deb`, `bccaaaa` |
| — | Patient re-allocation approval workflow + Viva outreach | `2c024a8`, `bd8106a` |
| — | Staff module-access ABAC: canonical `MODULE_KEYS`, per-route retrofit on 28 legacy feature routes, RBAC fallback, admin matrix UI in Org Settings → Access Control | `922b18e`, `361db96`, `d30fda1`, `e0571be`, `7b64067` |
| — | Shared binary resolver + child-process hardening (backup `pg_dump`/`gzip`/`gunzip`, `ollama` training, OCR, Whisper) | `3e010f3` |
| — | Security fixes: LAI `recordGiven` transaction wrapper, clozapine upsert `clinic_id` defence-in-depth, glucose `softDelete` dead code | `7f4af26` |
| — | Endocrinology `glucose` tab registry gate so specialty toggle actually hides the flowsheet | `7f9f961` |

### Drift since 2026-04-11

Reports 01–08 below were frozen on 2026-04-11 and have NOT been rewritten to reflect the ~25 commits above. The headline numbers in this INDEX are current; the narrative sections inside the individual reports are historical. Treat the per-phase table + commit hashes above as the authoritative source when checking which capabilities exist today.

**Summary of drift (from a 2026-04-14 re-audit):**

- **01-software-features.md** — missing the entire Phase 10/11/12 communications stack (notifications, patient outreach, FCM, mobile sync), the import pipeline, the re-allocation workflow.
- **02-enterprise-features.md** — missing the `staff_module_access` ABAC layer, the admin matrix UI, the `MODULE_KEYS` canonical registry, and the RBAC fallback semantics.
- **03-system-architecture.md** — missing FCM fan-out, WebSocket notification channel, mobile-sync delta endpoint, three new BullMQ queues (`notifications`, `patient-outreach`, `imports`), document cache topology.
- **04-security-features.md** — missing NO-SMS guardrails, ACS caller containment, `binaryResolver`, command-injection fix in `llmTrainingRoutes.ts`, LAI transaction race fix, clozapine upsert hardening, per-staff module-access override.
- **05-compliance-reports.md** — missing Phase 12 ACS consent audit trail mapping, module-access ABAC under ACHS Standard 1, LAI transaction fix under RANZCP protocols.
- **06-test-completion-report.md** — unit test count, E2E spec count, and fix-registry count all ≥50% stale.
- **07-remaining-todo.md** — multiple deferred items shipped and should be moved to a "Completed since 2026-04-11" ledger (see that file for the full list with commit hashes).
- **08-deployment-guide.md** — no drift flagged; deployment topology unchanged.

## How to read these reports

- Every "claim" in these reports is **grounded in code or migrations** that exist on the `fix/audit-backlog-batch` branch. If a claim references a file, the file is real. If a claim references an RFC or standard, the control mapping is asserted (and in most cases tested).
- **Comparison tables** use a simple scale: ✅ full, ⚠️ partial, ❌ absent, 🟰 on-par. Comparisons with Epic/Cerner/Best Practice are editorial interpretations based on publicly-known product capability, not vendor documentation.
- **Gaps are called out explicitly** — every known deferred item appears in [07-remaining-todo.md](07-remaining-todo.md).
