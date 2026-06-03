# Agent D — Auth context + RBAC gaps (COMPLETED)

## HIGH findings — service-layer RBAC bypass

**[HIGH-D1]** riskService.ts:47-77 — 5 methods accept raw (clinicId, staffId) without AuthContext. Writes **suicide/self-harm/harm-to-others risk assessments**. Any compromised internal caller can assess ANY patient in clinic. Must migrate to `requirePermission(auth, 'risk:create') + requirePatientRelationship(auth, dto.patientId)`.

**[HIGH-D2]** escalation.service.ts:10-81 — all 8 methods bypass AuthContext. `create(clinicId, raisedById, dto)` at :24 writes escalations → triggers team transfers + auto-creates intake episodes. No requirePatientRelationship check.

**[HIGH-D3]** taskService.ts:53-97 — 5 methods use raw params. Tasks reference patientId (line 38). Clinician without care relationship can CRUD tasks for any patient.

**[HIGH-D4]** pathologyController.ts:10-80 — extracts raw req.user!.clinicId + req.user!.id at :14,27,49,62,76 without buildAuthContext. Pathology = clinical procedure.

**[HIGH-D5]** appointmentService.ts:79-80+ — likely accepts raw params (controller pattern extrapolation). Verify on next touch.

**[HIGH-D6]** Route handlers missing AuthContext (enforce RBAC at route-middleware only — bypassable by internal callers):
- risk.routes.ts / riskController.ts
- escalation.routes.ts / escalation.controller.ts (accept-transfer/reject-transfer handlers at :65-134 update care episodes without requirePatientRelationship)
- pathologyRoutes.ts (GET /patient/:patientId at :14-21 no patient-relationship check)
- appointmentRoutes.ts:17-80 (requireRole only)
- episodeRoutes.ts:20-43 (listPatients-by-clinician / by-team: Team A clinician can GET Team B patient roster)

## MEDIUM findings

**[MED-D1]** Psychiatric/psychology note confidentiality gap: clinical_notes has no `sensitivity_level` column. clinicalNoteService.listByPatient() has `requirePermission('note:read') + requirePatientRelationship` but NO `requireSpecialty(['psychiatry','psychology'])` filter. GP with care episode shared with patient can read psych session notes. CLAUDE.md §5 compliance gap.

## GREEN (good)

- Most raw queries include `clinic_id = req.clinicId` filter — app-level tenancy + RLS backup OK
- Break-glass workflow COMPLETE:
  - BreakGlassRequestSchema enforces reason.min(10)
  - Two-person approval (requester ≠ approver)
  - JWT with breakGlass: true + breakGlassSessionId
  - SHA-256 hash stored
  - Slack alert dispatched
  - Session expires enforced, auto-expired
  - Actions immutably logged to break_glass_sessions.actions_performed JSONB
  - Early revocation supported
- Already migrated to AuthContext: clinicalNoteController, medicationController, tmsRoutes/tmsService, patientController

## Minor break-glass concerns

**[MED-D2]** Break-glass actions logged to `break_glass_sessions.actions_performed` but NOT to central `audit_log`. Dashboards query audit_log → break-glass invisible there. Fix: mirror each action to audit_log with action='break_glass_access' + FK.

**[MED-D3]** Slack webhook is only alert path. No email/SMS fallback if Slack fails. Fix: verify BREAK_GLASS_NOTIFY_EMAIL env + add fallback.

## Remediation priority

- Immediate (this sprint): risk / escalations / tasks services — 2-3 days
- Short-term (1-2 sprints): pathology / appointments / referrals + sensitive-note gating — 1 week
- Incremental (on next touch): episodes / staff-settings / org-settings — embedded
