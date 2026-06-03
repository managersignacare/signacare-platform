# Archives — point-in-time audit reports

This directory contains **historical** audit reports that were snapshots of
the codebase at specific moments. They are preserved for git traceability
(claims, findings, fix status at the time of the report) but are **not**
the current source of truth.

**Do NOT add new audit reports here.** New audits use the date-stamped
convention documented below.

## Convention for future audits + fixes

- New audit reports go in [../audits/](../audits/) as `audit-YYYYMMDD.md`.
- New fix-sprint summaries go in [../fixes/](../fixes/) as `fixes-YYYYMMDD.md`.
- Consolidated master plans go in [../plans/](../plans/) as `master-plan-YYYYMMDD.md`.

When an audit or fix report becomes stale enough that it's purely historical
(the codebase has moved on and the findings are no longer actionable against
current state), it can be moved to this directory.

## Contents

- `BUG_AUDIT_REPORT.md` — bug-focused audit, pre-Phase-0.5
- `COMPREHENSIVE_AUDIT_REPORT.md` — multi-area audit, pre-Phase-0.5
- `ENTERPRISE_COMPARISON_REPORT.md` — enterprise-features gap analysis
- `GOLD_STANDARD_AUDIT_REPORT.md` — gold-standard conformance audit
- `GOLD_STANDARD_GAP_ANALYSIS.md` — gap analysis against the gold-standard reports
- `LOAD_AND_QUALITY_REPORT.md` — load/perf + quality-metrics snapshot
- `PRODUCTION_READINESS_REPORT.md` — production-deployment checklist snapshot
- `phase-0.7-comprehensive-audit-report.md` — the Phase 0.7 13-point principal-engineer audit

## Live reference docs — NOT archived

The following stay at the top level of `docs/` and are the current source
of truth (updated continuously, not point-in-time snapshots):

- `ARCHITECTURE.md`, `DATABASE_SCHEMA.md`, `USER_MANUAL.md`
- `DEPLOYMENT_GUIDE.md`, `AZURE_DEPLOYMENT.md`, `DEVELOPER_GUIDE.md`
- `DISASTER_RECOVERY.md`, `FEATURES.md`, `ENTERPRISE_FEATURES.md`
- `IMPROVEMENT_ROADMAP.md`, `INCIDENT_RESPONSE_PLAN.md`
- `INFORMATION_SECURITY_POLICY.md`, `INTEGRATION_GUIDE.md`, `INTEGRATION_READINESS.md`
- `PENTEST_SCOPE.md`, `PRIVACY_IMPACT_ASSESSMENT.md`, `THREAT_MODEL.md`
- `IEC_62304_TRACEABILITY.md`, `VIDEO_SCRIPTS.md`
- `admin-routes.md`, `fix-registry.md` (CI-guarded)
- `phase-0.5-rename-runbook.md`
- `gold-standard-reports/**` — 8 system/feature architecture docs (living reference)
- `mobile/**`, `accessibility/**`, `demo/good-health-logins.md`
- `plans/multi-specialty-expansion.md` — living plan (will eventually be
  superseded by date-stamped master plans)
