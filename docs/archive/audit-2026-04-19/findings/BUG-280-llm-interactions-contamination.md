# BUG-280 — Retrospective LLM-interactions contamination audit

This file is APPENDED to (not overwritten) by
`apps/api/scripts/audit-llm-interactions-contamination.ts` on every
run with `AUDIT_WRITE_REPORT=true`.

## Purpose

Identify `llm_interactions` rows where `user_id` had NO sanctioned
care-relationship to `patient_id` at `created_at`. Produced for OAIC
Notifiable Data Breach (NDB) **assessment** — this report does NOT
establish reportability; a separate human + legal review is required
to assess whether any candidate event constitutes an "eligible data
breach likely to result in serious harm".

## Relationship model

A row passes (is NOT candidate contamination) if ANY of:

1. Staff role ∈ {`superadmin`, `admin`} (BYPASS_ROLES).
2. Active approved break-glass session covering the LLM call time.
3. Open/active/admitted episode where staff is primary or key worker, created before the call.
4. Active team assignment (patient + staff on the same org_unit), created before the call.
5. Appointment attendance (not 'removed', non-deleted), appointment created before the call.

A row fails ALL five checks → candidate contamination.

## Runbook

```bash
cd apps/api
# Dry run — prints summary to stdout, does not modify the report file.
npx tsx scripts/audit-llm-interactions-contamination.ts

# Write pass — appends a timestamped section to this file.
AUDIT_WRITE_REPORT=true npx tsx scripts/audit-llm-interactions-contamination.ts
```

## Interpretation

- `legitimate / total_analysed` near 1.0 → low contamination rate.
- `candidate_contamination > 0` → human triage required BEFORE any NDB-assessment determination.
- Per-staff concentration (`byStaff` top-20): if one staff ID dominates, suggests repeat misuse rather than incidental exposure — prioritise triage.
- Per-patient concentration: if one patient ID dominates, suggests targeted access — highest priority.

## NDB assessment workflow

1. Run the audit → produce candidate list.
2. For each candidate, retrieve the associated `llm_interactions.input_ref` / `output_ref` and inspect what data was exposed.
3. Classify: (a) incidental exposure of low-sensitivity data → log + close; (b) exposure of sensitive clinical info → escalate to legal.
4. Legal determines whether the event is an "eligible data breach likely to result in serious harm" per OAIC.
5. If yes → notification + OAIC filing; if no → internal log.

## Residual limitations

- `staff.role` is current state (no `staff_role_history`). Role changes post-call are invisible to this audit. If a staff member is `superadmin` today but was `clinician` at call time, they falsely PASS. Residual; file as enhancement if role-history lands.
- Break-glass `clinic_id` match assumes the session was created in the same clinic as the LLM call. Cross-clinic break-glass (if ever introduced) would need model extension.
- `is_active` snapshot — team assignments marked `is_active=false` today may have been active at call time. Model approximates; a full point-in-time query would need history tables.

---

<!-- appended by audit script — do not edit entries below manually -->
