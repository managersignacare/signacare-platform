# Wave 6a — Missing `clinic_id` filter audit

**Audit date:** 2026-04-24
**Scope:** `apps/api/src/**/*.ts` (excluding `**/*.test.ts`, `**/tests/**`, and `apps/api/migrations/**`).
**Authority:** CLAUDE.md §1.3 — every query on a `clinic_id`-bearing table must include `clinic_id` in its WHERE / UPDATE / INSERT clause as the first line of tenant isolation.
**Mode:** READ-ONLY enumeration. **No code changes were made.**

## 1. Methodology

1. Parsed `apps/api/src/db/schema-snapshot.json` (generated 2026-04-24).
2. **Multi-tenant allowlist derivation:** every table whose column array contains `clinic_id` was added to the multi-tenant set.
   - Total tables in snapshot: **243**
   - Multi-tenant (has `clinic_id`): **216**
   - Non-MT (excluded): 27 tables (lookup / system tables: `specialties`, `permissions`, `professional_disciplines`, `knex_migrations`, `knex_migrations_lock`, `alert_types` (system-wide), etc.)
3. Walked **477** `.ts` files under `apps/api/src/` (migrations dir, test files, test helpers excluded).
4. For every call site matching `db(…)` / `trx(…)` / `knex(…)` / `conn(…)` / `client(…)` with a literal string table name bound to a multi-tenant table:
   - Collected the Knex "sentence" until the next depth-0 `;`.
   - Flagged the sentence if it lacked any occurrence of the token `clinic_id` across the full chain (`.where`, `.andWhere`, `.whereIn`, `.whereRaw`, `.update`, `.insert`, `.delete`).
5. Independently scanned every `.raw(...)` call; flagged if its SQL payload references a multi-tenant table and contains no `clinic_id` token.
6. Classification:
   - **[MISS]** — caller function name does NOT end in `Admin` and is not under an obviously admin-only path.
   - **[ADMIN]** — caller function name ends in `Admin` or the file is an admin-suffix module.
   - **[RAW]** — raw SQL call; inspected separately for payload content.
7. Each finding is additionally tagged with `possibleFP=true` when the enclosing function body mentions `clinic_id` elsewhere (suggests a spread or intermediate variable may be carrying it — verify by reading the source).

## 2. Summary

| Tag | Count |
|---|---|
| **[MISS]** (definite gap; not admin-suffix) | **263** |
| &nbsp;&nbsp;&nbsp;of which `possibleFP` (body mentions clinic_id elsewhere) | 77 |
| &nbsp;&nbsp;&nbsp;**high-confidence MISS** (body also lacks clinic_id) | 186 |
| **[ADMIN]** (admin-path, intentional — needs audit_log evidence) | 0 |
| **[RAW]** (raw SQL touching MT table; manual inspection) | 6 |

## 3. Per-feature heatmap (MISS only)

| Feature / directory | [MISS] count |
|---|---|
| `mcp` | 42 |
| `integrations` | 41 |
| `<root>` | 25 |
| `seed-good-health` | 24 |
| `features/llm` | 16 |
| `features/patients` | 12 |
| `features/staff` | 12 |
| `features/referrals` | 10 |
| `features/staff-settings` | 9 |
| `features/episode` | 7 |
| `shared` | 7 |
| `features/auth` | 6 |
| `utils` | 5 |
| `features/feature-flags` | 4 |
| `features/appointments` | 3 |
| `features/contacts` | 3 |
| `features/escalations` | 3 |
| `features/reports` | 3 |
| `features/clinical-decision` | 2 |
| `features/correspondence` | 2 |
| `features/group-therapy` | 2 |
| `features/internal-medicine` | 2 |
| `features/mobile-sync` | 2 |
| `features/paediatrics` | 2 |
| `features/voice` | 2 |
| `features/webhooks` | 2 |
| `features/audit` | 1 |
| `features/billing` | 1 |
| `features/clinical-review` | 1 |
| `features/ect` | 1 |
| `features/endocrinology` | 1 |
| `features/flags` | 1 |
| `features/imports` | 1 |
| `features/license` | 1 |
| `features/pathology` | 1 |
| `features/patient-outreach` | 1 |
| `features/reallocations` | 1 |
| `features/surgery` | 1 |
| `features/tms` | 1 |
| `jobs` | 1 |
| `middleware` | 1 |

## 4. `[MISS]` findings (actionable)

Ordered by file, then line. `FP?` = possible false positive (body mentions `clinic_id` elsewhere — verify manually).

| File : line | Table | Method | Function | FP? | Snippet |
|---|---|---|---|---|---|
| `apps/api/src/features/appointments/appointmentService.ts:240` | `appointments` | `update` | `createRecurring` |  | `.where({ id: parent.id })` |
| `apps/api/src/features/appointments/appointmentService.ts:272` | `appointments` | `update` | `createRecurring` |  | `.where({ id: instance.id })` |
| `apps/api/src/features/appointments/appointmentService.ts:295` | `appointments` | `update` | `createRecurring` |  | `.where({ id: instance.id })` |
| `apps/api/src/features/audit/auditReplayRoutes.ts:83` | `audit_log` | `where` | `<anon>` |  | `.where('user_id', staffId)` |
| `apps/api/src/features/auth/authRepository.ts:70` | `staff_sessions` | `insert` | `createSession` |  | `.insert(row)` |
| `apps/api/src/features/auth/authRepository.ts:77` | `staff_sessions` | `where` | `findSessionByToken` |  | `.where({ refresh_token: token, revoked_at: null })` |
| `apps/api/src/features/auth/authRepository.ts:90` | `staff_sessions` | `where` | `findAnySessionByToken` |  | `.where({ refresh_token: token })` |
| `apps/api/src/features/auth/authRepository.ts:97` | `staff_sessions` | `update` | `revokeSession` |  | `.where({ id })` |
| `apps/api/src/features/auth/authRepository.ts:109` | `staff_sessions` | `update` | `revokeSessionFamily` |  | `.where({ family_id: familyId })` |
| `apps/api/src/features/auth/authRepository.ts:117` | `staff_sessions` | `update` | `revokeSessionsForStaff` |  | `.where({ staff_id: staffId, revoked_at: null })` |
| `apps/api/src/features/billing/billingRepository.ts:147` | `billing_accounts` | `update` | `upsertBillingAccount` |  | `.where({ id: existing.id })` |
| `apps/api/src/features/clinical-decision/clinicalDecisionRoutes.ts:57` | `patient_medications` | `where` | `<anon>` |  | `.where({ patient_id: req.params.patientId, status: 'active' })` |
| `apps/api/src/features/clinical-decision/clinicalDecisionRoutes.ts:78` | `pathology_results` | `where` | `medName` |  | `.where({ patient_id: req.params.patientId })` |
| `apps/api/src/features/clinical-review/clinicalReviewRepository.ts:312` | `key_issues` | `insert` | `replaceKeyIssues` | yes | `.insert(rows)` |
| `apps/api/src/features/contacts/autoContactRecord.ts:63` | `episodes` | `where` | `createAutoContactRecord` |  | `.where({ id: episodeId })` |
| `apps/api/src/features/contacts/autoContactRecord.ts:68` | `staff` | `where` | `createAutoContactRecord` | yes | `.where({ id: params.staffId })` |
| `apps/api/src/features/contacts/contactRecordRoutes.ts:325` | `clinical_notes` | `where` | `<anon>` | yes | `.where('clinical_notes.patient_id', patientId)` |
| `apps/api/src/features/correspondence/correspondenceRoutes.ts:54` | `patients` | `where` | `<anon>` | yes | `.where({ id: letter.patient_id })` |
| `apps/api/src/features/correspondence/correspondenceRoutes.ts:55` | `staff` | `where` | `<anon>` | yes | `.where({ id: letter.generated_by_id })` |
| `apps/api/src/features/ect/ectService.ts:142` | `ect_sessions` | `where` | `recordSession` | yes | `.where({ course_id: courseId })` |
| `apps/api/src/features/endocrinology/insulinRepository.ts:106` | `insulin_regimens` | `insert` | `createNewVersion` | yes | `.insert({ ...row, bolus_doses: row.bolus_doses ? JSON.stringify)` |
| `apps/api/src/features/episode/episodeRepository.ts:67` | `episodes` | `insert` | `create` |  | `.insert({ ...row, created_at: new Date)` |
| `apps/api/src/features/episode/episodeRoutes.ts:322` | `org_units` | `where` | `haveLower` |  | `.where({ id: orgUnitId })` |
| `apps/api/src/features/episode/episodeRoutes.ts:345` | `clinical_notes` | `where` | `<anon>` | yes | `.where({ patient_id: ep.patient_id, episode_id: ep.id })` |
| `apps/api/src/features/episode/episodeRoutes.ts:346` | `patients` | `where` | `<anon>` | yes | `.where({ id: ep.patient_id })` |
| `apps/api/src/features/episode/episodeRoutes.ts:347` | `patient_medications` | `where` | `<anon>` | yes | `.where({ patient_id: ep.patient_id, status: 'active' })` |
| `apps/api/src/features/episode/episodeRoutes.ts:360` | `episodes` | `update` | `<anon>` | yes | `.where({ id: req.params.id })` |
| `apps/api/src/features/episode/episodeRoutes.ts:381` | `episodes` | `where` | `<anon>` | yes | `.where({ id: req.params.id })` |
| `apps/api/src/features/escalations/escalation.routes.ts:97` | `episodes` | `update` | `<anon>` |  | `.where({ id: intakeEp.id })` |
| `apps/api/src/features/escalations/escalation.routes.ts:113` | `escalations` | `update` | `<anon>` |  | `.where({ id: req.params.id })` |
| `apps/api/src/features/escalations/escalation.routes.ts:142` | `escalations` | `update` | `<anon>` | yes | `.where({ id: req.params.id })` |
| `apps/api/src/features/feature-flags/featureFlagRoutes.ts:64` | `feature_flag_disable_requests` | `where` | `hasApprovedDisableRequest` | yes | `.where({ flag_name: flagName, action: 'disable', status: 'approved' })` |
| `apps/api/src/features/feature-flags/featureFlagRoutes.ts:214` | `feature_flag_disable_requests` | `where` | `<anon>` | yes | `.where({ status: 'pending' })` |
| `apps/api/src/features/feature-flags/featureFlagRoutes.ts:233` | `feature_flag_disable_requests` | `where` | `<anon>` |  | `.where({ id: req.params.id })` |
| `apps/api/src/features/feature-flags/featureFlagRoutes.ts:252` | `feature_flag_disable_requests` | `update` | `<anon>` |  | `.where({ id: req.params.id })` |
| `apps/api/src/features/flags/flagRepository.ts:54` | `patient_flags` | `insert` | `insert` |  | `.insert({ ...row, created_at: new Date)` |
| `apps/api/src/features/group-therapy/groupTherapyRoutes.ts:168` | `group_sessions` | `update` | `<anon>` |  | `.where({ id: req.params.id })` |
| `apps/api/src/features/group-therapy/groupTherapyRoutes.ts:238` | `group_sessions` | `where` | `<anon>` | yes | `.where({ id: req.params.id })` |
| `apps/api/src/features/imports/importService.ts:250` | `import_jobs` | `update` | `commit` |  | `.where({ id: params.jobId })` |
| `apps/api/src/features/internal-medicine/medRecRepository.ts:76` | `medication_reconciliations` | `insert` | `create` |  | `.insert({ ...row, snapshot: JSON.stringify)` |
| `apps/api/src/features/internal-medicine/problemListRepository.ts:98` | `problem_list` | `insert` | `create` |  | `.insert({ ...row, created_at: new Date)` |
| `apps/api/src/features/license/licenseRoutes.ts:21` | `staff` | `where` | `<anon>` |  | `.where({ role: 'superadmin' })` |
| `apps/api/src/features/llm/letterDeliveryService.ts:367` | `letters` | `update` | `nextRev` | yes | `.where({ id: letterId })` |
| `apps/api/src/features/llm/letterService.ts:160` | `letter_sections` | `update` | `regenerateSection` | yes | `.where({ id: existing.id })` |
| `apps/api/src/features/llm/letterService.ts:169` | `letters` | `update` | `regenerateSection` | yes | `.where({ id: letterId })` |
| `apps/api/src/features/llm/letterService.ts:223` | `letter_sections` | `update` | `editSection` | yes | `.where({ id: existing.id })` |
| `apps/api/src/features/llm/letterService.ts:226` | `letters` | `update` | `editSection` | yes | `.where({ id: letterId })` |
| `apps/api/src/features/llm/letterService.ts:276` | `letters` | `update` | `submitForReview` | yes | `.where({ id: letterId })` |
| `apps/api/src/features/llm/letterService.ts:319` | `letters` | `update` | `approveLetter` | yes | `.where({ id: letterId })` |
| `apps/api/src/features/llm/letterService.ts:363` | `letters` | `update` | `rejectLetter` |  | `.where({ id: letterId })` |
| `apps/api/src/features/llm/llmRepository.ts:59` | `llm_interactions` | `insert` | `insertInteraction` |  | `.insert({ id: randomUUID)` |
| `apps/api/src/features/llm/llmRoutes.ts:454` | `training_export_requests` | `update` | `<anon>` | yes | `.where({ id: req.params.id })` |
| `apps/api/src/features/llm/llmRoutes.ts:464` | `training_export_requests` | `where` | `<anon>` | yes | `.where({ id: req.params.id })` |
| `apps/api/src/features/llm/llmRoutes.ts:503` | `training_export_requests` | `update` | `<anon>` |  | `.where({ id: row.id })` |
| `apps/api/src/features/llm/llmRoutes.ts:512` | `training_export_requests` | `update` | `<anon>` | yes | `.where({ id: row.id })` |
| `apps/api/src/features/llm/scribeRoutes.ts:197` | `patients` | `where` | `<anon>` |  | `.where({ id: patientId })` |
| `apps/api/src/features/llm/scribeRoutes.ts:250` | `patients` | `where` | `<anon>` |  | `.where({ id: patientId })` |
| `apps/api/src/features/llm/scribeRoutes.ts:258` | `staff` | `where` | `<anon>` |  | `.where({ id: req.user!.id })` |
| `apps/api/src/features/mobile-sync/mobileSyncRoutes.ts:197` | `staff_fcm_tokens` | `where` | `<anon>` | yes | `.where({ staff_id: staffId, device_token: dto.deviceToken })` |
| `apps/api/src/features/mobile-sync/mobileSyncRoutes.ts:202` | `staff_fcm_tokens` | `update` | `<anon>` |  | `.where({ id: existing.id })` |
| `apps/api/src/features/paediatrics/paediatricsRepositories.ts:175` | `immunizations` | `insert` | `create` |  | `.insert({ ...row, dose_quantity_ml: row.dose_quantity_ml != null ? String)` |
| `apps/api/src/features/paediatrics/paediatricsRepositories.ts:237` | `developmental_milestones` | `insert` | `create` |  | `.insert({ ...row, created_at: new Date)` |
| `apps/api/src/features/pathology/pathologyRoutes.ts:18` | `pathology_results` | `where` | `<anon>` | yes | `.whereIn('pathology_order_id', orders.map)` |
| `apps/api/src/features/patient-outreach/patientOutreachRoutes.ts:152` | `staff` | `where` | `auditLogService` | yes | `.whereIn('id', staffIds)` |
| `apps/api/src/features/patients/patientRepository.ts:126` | `patients` | `insert` | `create` |  | `.insert({ ...encrypted, id: data.id \|\| uuidv4)` |
| `apps/api/src/features/patients/patientRepository.ts:164` | `episodes` | `where` | `baseQuery` |  | `.whereRaw('episodes.patient_id = patients.id')` |
| `apps/api/src/features/patients/patientRoutes.ts:457` | `patient_attachments` | `where` | `<anon>` |  | `.where({ patient_id: req.params.id, is_active: true })` |
| `apps/api/src/features/patients/patientRoutes.ts:514` | `patients` | `where` | `<anon>` | yes | `.where({ id: patientId })` |
| `apps/api/src/features/patients/patientRoutes.ts:632` | `patient_attachments` | `where` | `<anon>` |  | `.where({ patient_id: req.params.id, is_active: true })` |
| `apps/api/src/features/patients/patientRoutes.ts:670` | `clinical_notes` | `where` | `requireClinicalRole` |  | `.where('clinical_notes.patient_id', req.params.id)` |
| `apps/api/src/features/patients/patientRoutes.ts:805` | `patient_legal_orders` | `where` | `<anon>` |  | `.where('patient_legal_orders.patient_id', req.params.id)` |
| `apps/api/src/features/patients/patientRoutes.ts:817` | `patient_legal_orders` | `update` | `<anon>` |  | `.where({ id: r.id })` |
| `apps/api/src/features/patients/patientRoutes.ts:908` | `patient_legal_attachments` | `where` | `<anon>` |  | `.where({ patient_id: req.params.id })` |
| `apps/api/src/features/patients/patientRoutes.ts:926` | `patient_alerts` | `where` | `<anon>` |  | `.where('patient_alerts.patient_id', req.params.id)` |
| `apps/api/src/features/patients/patientRoutes.ts:941` | `patient_alert_attachments` | `where` | `<anon>` |  | `.whereIn('patient_alert_id', alertIds)` |
| `apps/api/src/features/patients/patientRoutes.ts:1035` | `patient_alerts` | `where` | `<anon>` |  | `.where({ patient_id: req.params.id, is_active: true })` |
| `apps/api/src/features/reallocations/reallocationService.ts:323` | `org_units` | `where` | `approve` |  | `.where({ id: pending.to_org_unit_id })` |
| `apps/api/src/features/referrals/referralRepository.ts:179` | `referrals` | `insert` | `createReferral` |  | `.insert(row)` |
| `apps/api/src/features/referrals/referralRepository.ts:269` | `referral_attachments` | `insert` | `createAttachment` |  | `.insert(row)` |
| `apps/api/src/features/referrals/referralRepository.ts:347` | `referral_clinician_offers` | `insert` | `createOffersBatch` |  | `.insert(rows)` |
| `apps/api/src/features/referrals/referralRepository.ts:357` | `referral_clinician_offers` | `where` | `findOfferForUpdate` |  | `.where({ id: offerId, staff_id: staffId })` |
| `apps/api/src/features/referrals/referralRepository.ts:370` | `referral_clinician_offers` | `update` | `updateOffer` |  | `.where({ id: offerId })` |
| `apps/api/src/features/referrals/referralRepository.ts:382` | `referral_clinician_offers` | `update` | `expirePendingOffers` |  | `.where({ referral_id: referralId, response: 'pending' })` |
| `apps/api/src/features/referrals/referralRepository.ts:472` | `referral_clinician_offers` | `where` | `listPendingOfferStaffIds` |  | `.where({ referral_id: referralId, response: 'pending' })` |
| `apps/api/src/features/referrals/referralRepository.ts:481` | `referral_feedback_log` | `insert` | `insertFeedbackLog` |  | `.insert(row)` |
| `apps/api/src/features/referrals/referralRepository.ts:661` | `referrals` | `where` | `listReferralsForReminder` |  | `.where({ referral_mode: 'team', status: 'pending_broadcast' })` |
| `apps/api/src/features/referrals/referralRoutes.ts:270` | `episodes` | `where` | `<anon>` | yes | `.where({ id: dto.episodeId })` |
| `apps/api/src/features/reports/reportsRoutes.ts:564` | `audit_runs` | `update` | `<anon>` |  | `.where({ id: run.id })` |
| `apps/api/src/features/reports/reportsRoutes.ts:568` | `audit_runs` | `update` | `<anon>` |  | `.where({ id: run.id })` |
| `apps/api/src/features/reports/reportsRoutes.ts:586` | `audit_templates` | `where` | `<anon>` | yes | `.where({ id: run.template_id })` |
| `apps/api/src/features/staff-settings/staffSettingsRepository.ts:55` | `professional_disciplines` | `update` | `updateDiscipline` |  | `.where({ id })` |
| `apps/api/src/features/staff-settings/staffSettingsRepository.ts:60` | `professional_disciplines` | `delete` | `deleteDiscipline` |  | `.where({ id })` |
| `apps/api/src/features/staff-settings/staffSettingsRepository.ts:81` | `clinical_roles` | `update` | `updateClinicalRole` |  | `.where({ id })` |
| `apps/api/src/features/staff-settings/staffSettingsRepository.ts:86` | `clinical_roles` | `delete` | `deleteClinicalRole` |  | `.where({ id })` |
| `apps/api/src/features/staff-settings/staffSettingsRepository.ts:202` | `referral_sources` | `update` | `updateReferralSource` |  | `.where({ id })` |
| `apps/api/src/features/staff-settings/staffSettingsRepository.ts:207` | `referral_sources` | `delete` | `deleteReferralSource` |  | `.where({ id })` |
| `apps/api/src/features/staff-settings/staffSettingsRepository.ts:228` | `investigation_types` | `update` | `updateInvestigationType` |  | `.where({ id })` |
| `apps/api/src/features/staff-settings/staffSettingsRepository.ts:233` | `investigation_types` | `delete` | `deleteInvestigationType` |  | `.where({ id })` |
| `apps/api/src/features/staff-settings/staffSettingsRoutes.ts:938` | `planned_transitions` | `update` | `<anon>` |  | `.where({ id: plan.id })` |
| `apps/api/src/features/staff/staffRepository.ts:53` | `staff` | `where` | `findByEmail` |  | `.where({ email: email.toLowerCase)` |
| `apps/api/src/features/staff/staffRepository.ts:60` | `staff` | `where` | `findById` |  | `.where({ id, deleted_at: null })` |
| `apps/api/src/features/staff/staffRepository.ts:69` | `staff` | `where` | `findByIdWithHash` |  | `.where({ id, deleted_at: null })` |
| `apps/api/src/features/staff/staffRepository.ts:76` | `staff` | `update` | `updatePasswordHash` |  | `.where({ id })` |
| `apps/api/src/features/staff/staffRepository.ts:103` | `staff` | `insert` | `insert` |  | `.insert({ ...data, failed_login_attempts: 0, locked_until: null, mfa_enabled: data.mfa_enabled ?? false, is_active: data.is_active ?? true, ` |
| `apps/api/src/features/staff/staffRepository.ts:129` | `staff` | `where` | `incrementFailedLogins` |  | `.where({ id })` |
| `apps/api/src/features/staff/staffRepository.ts:133` | `staff` | `update` | `resetFailedLogins` |  | `.where({ id })` |
| `apps/api/src/features/staff/staffRepository.ts:139` | `staff` | `update` | `lockAccount` |  | `.where({ id })` |
| `apps/api/src/features/staff/staffRepository.ts:143` | `staff` | `update` | `enableMfa` |  | `.where({ id })` |
| `apps/api/src/features/staff/staffRepository.ts:147` | `staff` | `update` | `disableMfa` |  | `.where({ id })` |
| `apps/api/src/features/staff/staffRepository.ts:151` | `staff` | `update` | `setMfaSecret` |  | `.where({ id })` |
| `apps/api/src/features/staff/staffRepository.ts:155` | `staff` | `update` | `setRecoveryCodes` |  | `.where({ id })` |
| `apps/api/src/features/surgery/surgeryRepositories.ts:84` | `surgical_cases` | `insert` | `create` |  | `.insert({ ...row, created_at: new Date)` |
| `apps/api/src/features/tms/tmsService.ts:141` | `tms_sessions` | `where` | `recordSession` | yes | `.where({ course_id: courseId })` |
| `apps/api/src/features/voice/voiceRepository.ts:127` | `voice_calls` | `insert` | `insertCall` |  | `.insert({ ...data, created_at: new Date)` |
| `apps/api/src/features/voice/voiceRepository.ts:182` | `voice_scripts` | `insert` | `insertScript` |  | `.insert({ id: randomUUID)` |
| `apps/api/src/features/webhooks/webhookRoutes.ts:130` | `webhook_secrets` | `where` | `audit` |  | `.where({ source, is_active: true })` |
| `apps/api/src/features/webhooks/webhookRoutes.ts:182` | `webhook_audit_log` | `where` | `nonce` |  | `.where({ source, payload_hash: payloadHash })` |
| `apps/api/src/integrations/cmi/cmiDataExtractor.ts:77` | `patient_legal_orders` | `where` | `extractEpisodes` |  | `.where({ patient_id: ep.patient_id })` |
| `apps/api/src/integrations/fhir/bulkExportWorker.ts:192` | `fhir_bulk_export_jobs` | `where` | `processBulkExportJob` | yes | `.where({ id: jobId })` |
| `apps/api/src/integrations/fhir/bulkExportWorker.ts:202` | `fhir_bulk_export_jobs` | `update` | `processBulkExportJob` | yes | `.where({ id: jobId })` |
| `apps/api/src/integrations/fhir/bulkExportWorker.ts:240` | `fhir_bulk_export_jobs` | `update` | `processBulkExportJob` | yes | `.where({ id: jobId })` |
| `apps/api/src/integrations/fhir/bulkExportWorker.ts:248` | `fhir_bulk_export_jobs` | `update` | `processBulkExportJob` | yes | `.where({ id: jobId })` |
| `apps/api/src/integrations/fhir/bulkExportWorker.ts:259` | `fhir_bulk_export_jobs` | `update` | `processBulkExportJob` |  | `.where({ id: jobId })` |
| `apps/api/src/integrations/fhir/fhirRoutes.ts:146` | `patient_allergies` | `where` | `<anon>` |  | `.where({ patient_id: patientId })` |
| `apps/api/src/integrations/fhir/fhirRoutes.ts:214` | `episodes` | `where` | `patientToFhir` |  | `.where({ patient_id: patientId })` |
| `apps/api/src/integrations/fhir/fhirRoutes.ts:233` | `nursing_assessments` | `where` | `patientToFhir` |  | `.where({ patient_id: patientId })` |
| `apps/api/src/integrations/fhir/fhirRoutes.ts:234` | `structured_observations` | `where` | `patientToFhir` |  | `.where({ patient_id: patientId })` |
| `apps/api/src/integrations/fhir/fhirRoutes.ts:269` | `pathology_results` | `where` | `<anon>` |  | `.where({ patient_id: patientId })` |
| `apps/api/src/integrations/fhir/fhirRoutes.ts:286` | `staff` | `where` | `<anon>` |  | `.where('is_active', true)` |
| `apps/api/src/integrations/fhir/fhirRoutes.ts:309` | `staff` | `where` | `<anon>` |  | `.where({ id: req.params.id })` |
| `apps/api/src/integrations/fhir/fhirRoutes.ts:546` | `fhir_bulk_export_jobs` | `update` | `requesterId` |  | `.where({ id: job.id })` |
| `apps/api/src/integrations/fhir/smartAuth.ts:96` | `smart_apps` | `where` | `findApprovedApp` |  | `.where({ client_id: clientId, is_active: true, is_approved: true })` |
| `apps/api/src/integrations/fhir/smartAuth.ts:203` | `smart_launch_contexts` | `where` | `findApprovedApp` | yes | `.where({ launch_token: launch, client_id: app.client_id })` |
| `apps/api/src/integrations/fhir/smartAuth.ts:213` | `smart_launch_contexts` | `update` | `<anon>` | yes | `.where({ id: ctx.id })` |
| `apps/api/src/integrations/fhir/smartAuth.ts:327` | `oauth_authorization_codes` | `where` | `handleAuthCodeGrant` | yes | `.where({ code_hash: codeHash })` |
| `apps/api/src/integrations/fhir/smartAuth.ts:339` | `oauth_access_tokens` | `update` | `handleAuthCodeGrant` |  | `.where({ client_id: app.client_id, user_id: row.user_id })` |
| `apps/api/src/integrations/fhir/smartAuth.ts:359` | `oauth_authorization_codes` | `update` | `handleAuthCodeGrant` | yes | `.where({ id: row.id })` |
| `apps/api/src/integrations/fhir/smartAuth.ts:379` | `oauth_refresh_tokens` | `where` | `handleRefreshTokenGrant` | yes | `.where({ token_hash: tokenHash })` |
| `apps/api/src/integrations/fhir/smartAuth.ts:391` | `oauth_refresh_tokens` | `update` | `handleRefreshTokenGrant` |  | `.where({ id: row.rotated_to_id })` |
| `apps/api/src/integrations/fhir/smartAuth.ts:414` | `oauth_refresh_tokens` | `where` | `handleRefreshTokenGrant` | yes | `.where({ token_hash: sha256Hex)` |
| `apps/api/src/integrations/fhir/smartAuth.ts:421` | `oauth_refresh_tokens` | `update` | `handleRefreshTokenGrant` | yes | `.where({ id: row.id })` |
| `apps/api/src/integrations/fhir/smartAuth.ts:531` | `oauth_access_tokens` | `where` | `issueAccessAndRefreshTokens` |  | `.where({ jti: decoded.jti })` |
| `apps/api/src/integrations/fhir/smartAuth.ts:593` | `oauth_refresh_tokens` | `update` | `scope` |  | `.where({ token_hash: sha256Hex)` |
| `apps/api/src/integrations/fhir/smartAuth.ts:600` | `oauth_access_tokens` | `update` | `scope` |  | `.where({ jti: decoded.jti, client_id: app.client_id })` |
| `apps/api/src/integrations/fhir/smartAuth.ts:606` | `oauth_refresh_tokens` | `update` | `scope` |  | `.where({ token_hash: sha256Hex)` |
| `apps/api/src/integrations/outlook/office365Service.ts:21` | `staff` | `where` | `getStaffAccessToken` |  | `.where({ id: staffId })` |
| `apps/api/src/integrations/outlook/office365Service.ts:35` | `staff` | `update` | `getStaffAccessToken` |  | `.where({ id: staffId })` |
| `apps/api/src/integrations/outlook/outlookCalendarService.ts:14` | `staff` | `where` | `getStaffTokens` |  | `.where({ id: staffId })` |
| `apps/api/src/integrations/outlook/outlookCalendarService.ts:53` | `staff` | `update` | `refreshAccessToken` |  | `.where({ outlook_email: tokens.email })` |
| `apps/api/src/integrations/outlook/outlookEmailService.ts:22` | `staff` | `where` | `getStaffTokens` |  | `.where({ id: staffId })` |
| `apps/api/src/integrations/outlook/outlookEmailService.ts:56` | `staff` | `update` | `refreshAccessToken` |  | `.where({ outlook_email: tokens.email })` |
| `apps/api/src/integrations/outlook/outlookRoutes.ts:63` | `staff` | `update` | `<anon>` |  | `.where({ id: staffId })` |
| `apps/api/src/integrations/outlook/outlookRoutes.ts:82` | `staff` | `update` | `<anon>` |  | `.where({ id: staffId })` |
| `apps/api/src/integrations/outlook/outlookRoutes.ts:100` | `staff` | `where` | `<anon>` |  | `.where({ id: staffId })` |
| `apps/api/src/integrations/outlook/outlookRoutes.ts:120` | `staff` | `where` | `<anon>` |  | `.where({ id: staffId })` |
| `apps/api/src/integrations/outlook/outlookRoutes.ts:208` | `staff` | `where` | `<anon>` |  | `.where({ id: req.user!.id })` |
| `apps/api/src/integrations/pathology/resultNotifier.ts:40` | `patients` | `where` | `checkAndNotify` | yes | `.where({ id: result.patientId })` |
| `apps/api/src/integrations/pathology/resultNotifier.ts:41` | `episodes` | `where` | `checkAndNotify` | yes | `.where({ patient_id: result.patientId, status: 'open' })` |
| `apps/api/src/jobs/schedulers/referralSlaScheduler.ts:128` | `referral_clinician_offers` | `update` | `processAutoClose` | yes | `.where({ referral_id: referral.id, response: 'pending' })` |
| `apps/api/src/mcp/scribeEnhancements.ts:681` | `clinical_notes` | `where` | `getPriorNoteContext` |  | `.where('patient_id', patientId)` |
| `apps/api/src/mcp/scribeEnhancements.ts:1179` | `clinical_notes` | `where` | `buildKShotExamples` |  | `.where('author_id', staffId)` |
| `apps/api/src/mcp/server/mcpServer.ts:140` | `org_units` | `select` | `getOrgUnitMap` |  | `.select('id', 'name')` |
| `apps/api/src/mcp/server/mcpServer.ts:158` | `staff` | `where` | `resolveStaffName` |  | `.where({ id: staffId })` |
| `apps/api/src/mcp/server/mcpServer.ts:165` | `patients` | `where` | `resolvePatientName` |  | `.where({ id: patientId })` |
| `apps/api/src/mcp/server/mcpServer.ts:188` | `patients` | `where` | `handleToolCall` |  | `.where(function)` |
| `apps/api/src/mcp/server/mcpServer.ts:195` | `patients` | `where` | `handleToolCall` |  | `.where({ id: a.patientId })` |
| `apps/api/src/mcp/server/mcpServer.ts:205` | `patient_medications` | `where` | `handleToolCall` |  | `.where({ patient_id: a.patientId })` |
| `apps/api/src/mcp/server/mcpServer.ts:211` | `clinical_notes` | `where` | `handleToolCall` |  | `.where({ patient_id: a.patientId })` |
| `apps/api/src/mcp/server/mcpServer.ts:227` | `patient_alerts` | `where` | `handleToolCall` |  | `.where({ patient_id: a.patientId, is_active: true })` |
| `apps/api/src/mcp/server/mcpServer.ts:265` | `episodes` | `where` | `data` |  | `.where({ patient_id: a.patientId })` |
| `apps/api/src/mcp/server/mcpServer.ts:281` | `episodes` | `where` | `data` |  | `.where({ 'episodes.status': 'open' })` |
| `apps/api/src/mcp/server/mcpServer.ts:289` | `patient_medications` | `where` | `data` |  | `.whereIn('patient_id', teamPatients.map)` |
| `apps/api/src/mcp/server/mcpServer.ts:299` | `patients` | `select` | `data` |  | `db('patients').whereNull('deleted_at').count('* as cnt');` |
| `apps/api/src/mcp/server/mcpServer.ts:300` | `episodes` | `where` | `data` |  | `.where('status', 'open')` |
| `apps/api/src/mcp/server/mcpServer.ts:301` | `staff` | `where` | `data` |  | `.where('is_active', true)` |
| `apps/api/src/mcp/server/mcpServer.ts:302` | `patient_medications` | `where` | `data` |  | `.where('status', 'active')` |
| `apps/api/src/mcp/server/mcpServer.ts:303` | `patient_alerts` | `where` | `data` |  | `.where('is_active', true)` |
| `apps/api/src/mcp/server/mcpServer.ts:304` | `clinical_notes` | `select` | `data` |  | `db('clinical_notes').whereNull('deleted_at').count('* as cnt');` |
| `apps/api/src/mcp/server/mcpServer.ts:305` | `patient_legal_orders` | `where` | `data` |  | `.where('status', 'active')` |
| `apps/api/src/mcp/server/mcpServer.ts:306` | `episodes` | `where` | `data` |  | `.where('status', 'open')` |
| `apps/api/src/mcp/server/mcpServer.ts:322` | `staff` | `where` | `<anon>` |  | `.where({ id: a.staffId })` |
| `apps/api/src/mcp/server/mcpServer.ts:343` | `episodes` | `where` | `<anon>` |  | `.where({ primary_clinician_id: staffRow.id, status: 'open' })` |
| `apps/api/src/mcp/server/mcpServer.ts:344` | `appointments` | `where` | `<anon>` |  | `.where({ clinician_id: staffRow.id, status: 'scheduled' })` |
| `apps/api/src/mcp/server/mcpServer.ts:345` | `clinical_notes` | `where` | `<anon>` |  | `.where({ author_id: staffRow.id, status: 'draft' })` |
| `apps/api/src/mcp/server/mcpServer.ts:347` | `episodes` | `where` | `<anon>` |  | `.where({ 'episodes.primary_clinician_id': staffRow.id, 'episodes.status': 'open' })` |
| `apps/api/src/mcp/server/mcpServer.ts:357` | `staff` | `where` | `<anon>` |  | `.where('is_active', true)` |
| `apps/api/src/mcp/server/mcpServer.ts:361` | `episodes` | `where` | `<anon>` |  | `.where({ 'episodes.status': 'open' })` |
| `apps/api/src/mcp/server/mcpServer.ts:380` | `patient_legal_orders` | `where` | `<anon>` |  | `.whereIn('status', ['active', 'pending'])` |
| `apps/api/src/mcp/server/mcpServer.ts:393` | `episodes` | `where` | `<anon>` |  | `.where({ team_id: a.team, status: 'open' })` |
| `apps/api/src/mcp/server/mcpServer.ts:413` | `episodes` | `where` | `<anon>` |  | `.where({ team_id: a.team, status: 'open' })` |
| `apps/api/src/mcp/server/mcpServer.ts:431` | `episodes` | `where` | `<anon>` |  | `.where({ team_id: a.team, status: 'open' })` |
| `apps/api/src/mcp/server/mcpServer.ts:446` | `beds` | `select` | `<anon>` |  | `db('beds').count('* as cnt');` |
| `apps/api/src/mcp/server/mcpServer.ts:447` | `beds` | `where` | `<anon>` |  | `.where('status', 'occupied')` |
| `apps/api/src/mcp/server/mcpServer.ts:451` | `episodes` | `where` | `<anon>` |  | `.where({ status: 'open', episode_type: 'inpatient' })` |
| `apps/api/src/mcp/server/mcpServer.ts:471` | `waitlist_entries` | `where` | `avgLenDays` |  | `.where('status', 'waiting')` |
| `apps/api/src/mcp/server/mcpServer.ts:482` | `patient_medications` | `where` | `avgLenDays` |  | `.where('status', 'active')` |
| `apps/api/src/mcp/server/mcpServer.ts:483` | `episodes` | `where` | `avgLenDays` |  | `.where({ team_id: a.team, status: 'open' })` |
| `apps/api/src/mcp/server/mcpServer.ts:495` | `episodes` | `where` | `avgLenDays` |  | `.where({ team_id: a.team, status: 'open' })` |
| `apps/api/src/mcp/server/mcpServer.ts:500` | `episodes` | `where` | `avgLenDays` |  | `.where({ status: 'open' })` |
| `apps/api/src/mcp/server/mcpServer.ts:501` | `risk_assessments` | `where` | `avgLenDays` |  | `.whereIn('patient_id', openPatients)` |
| `apps/api/src/mcp/server/mcpServer.ts:518` | `episodes` | `where` | `<anon>` |  | `.where({ team_id: a.team, status: 'open' })` |
| `apps/api/src/middleware/superadminGuard.ts:38` | `audit_log` | `where` | `requireDualApproval` | yes | `.where({ record_id: approvalId, action: 'APPROVAL_REQUEST' })` |
| `apps/api/src/seed-all-verticals.ts:29` | `patient_medications` | `select` | `seed` | yes | `.select('id', 'patient_id')` |
| `apps/api/src/seed-all-verticals.ts:33` | `episodes` | `where` | `medFor` | yes | `.where('status', 'open')` |
| `apps/api/src/seed-all-verticals.ts:111` | `beds` | `delete` | `<anon>` | yes | `.whereIn('bed_label', ['IPU-01','IPU-02','IPU-03','IPU-04','HDU-01','HDU-02'])` |
| `apps/api/src/seed-demo-comprehensive.ts:114` | `org_units` | `select` | `main` | yes | `.select('id', 'name')` |
| `apps/api/src/seed-demo.ts:179` | `org_unit_programs` | `insert` | `<anon>` | yes | `.insert({ id: db.raw)` |
| `apps/api/src/seed-demo.ts:181` | `org_unit_programs` | `insert` | `<anon>` | yes | `.insert({ id: db.raw)` |
| `apps/api/src/seed-demo.ts:183` | `org_unit_programs` | `insert` | `<anon>` | yes | `.insert({ id: db.raw)` |
| `apps/api/src/seed-demo.ts:185` | `org_unit_programs` | `insert` | `<anon>` | yes | `.insert({ id: db.raw)` |
| `apps/api/src/seed-demo.ts:187` | `org_unit_programs` | `insert` | `<anon>` | yes | `.insert({ id: db.raw)` |
| `apps/api/src/seed-demo.ts:189` | `org_unit_programs` | `insert` | `<anon>` | yes | `.insert({ id: db.raw)` |
| `apps/api/src/seed-demo.ts:191` | `org_unit_programs` | `insert` | `<anon>` | yes | `.insert({ id: db.raw)` |
| `apps/api/src/seed-good-health/generators/00_reference_data.ts:77` | `professional_disciplines` | `where` | `runReferenceDataStep` | yes | `.where({ id: row.id })` |
| `apps/api/src/seed-good-health/generators/00_reference_data.ts:79` | `professional_disciplines` | `update` | `runReferenceDataStep` |  | `.where({ id: row.id })` |
| `apps/api/src/seed-good-health/generators/00_reference_data.ts:82` | `professional_disciplines` | `insert` | `runReferenceDataStep` |  | `.insert(row)` |
| `apps/api/src/seed-good-health/generators/00_reference_data.ts:98` | `clinical_roles` | `where` | `runReferenceDataStep` | yes | `.where({ id: row.id })` |
| `apps/api/src/seed-good-health/generators/00_reference_data.ts:100` | `clinical_roles` | `update` | `runReferenceDataStep` |  | `.where({ id: row.id })` |
| `apps/api/src/seed-good-health/generators/00_reference_data.ts:103` | `clinical_roles` | `insert` | `runReferenceDataStep` |  | `.insert(row)` |
| `apps/api/src/seed-good-health/generators/00_reference_data.ts:120` | `referral_sources` | `where` | `category` | yes | `.where({ id: row.id })` |
| `apps/api/src/seed-good-health/generators/00_reference_data.ts:122` | `referral_sources` | `update` | `category` |  | `.where({ id: row.id })` |
| `apps/api/src/seed-good-health/generators/00_reference_data.ts:125` | `referral_sources` | `insert` | `category` |  | `.insert(row)` |
| `apps/api/src/seed-good-health/generators/00_reference_data.ts:141` | `investigation_types` | `where` | `category` | yes | `.where({ id: row.id })` |
| `apps/api/src/seed-good-health/generators/00_reference_data.ts:143` | `investigation_types` | `update` | `category` |  | `.where({ id: row.id })` |
| `apps/api/src/seed-good-health/generators/00_reference_data.ts:146` | `investigation_types` | `insert` | `category` |  | `.insert(row)` |
| `apps/api/src/seed-good-health/generators/00_reference_data.ts:165` | `alert_types` | `where` | `plan_template` | yes | `.where({ id: row.id })` |
| `apps/api/src/seed-good-health/generators/00_reference_data.ts:167` | `alert_types` | `update` | `plan_template` |  | `.where({ id: row.id })` |
| `apps/api/src/seed-good-health/generators/00_reference_data.ts:170` | `alert_types` | `insert` | `plan_template` |  | `.insert(row)` |
| `apps/api/src/seed-good-health/generators/00_reference_data.ts:186` | `appointment_modes` | `where` | `plan_template` | yes | `.where({ id: row.id })` |
| `apps/api/src/seed-good-health/generators/00_reference_data.ts:188` | `appointment_modes` | `update` | `plan_template` |  | `.where({ id: row.id })` |
| `apps/api/src/seed-good-health/generators/00_reference_data.ts:191` | `appointment_modes` | `insert` | `plan_template` |  | `.insert(row)` |
| `apps/api/src/seed-good-health/generators/00_reference_data.ts:207` | `template_categories` | `where` | `plan_template` | yes | `.where({ id: row.id })` |
| `apps/api/src/seed-good-health/generators/00_reference_data.ts:209` | `template_categories` | `update` | `plan_template` |  | `.where({ id: row.id })` |
| `apps/api/src/seed-good-health/generators/00_reference_data.ts:212` | `template_categories` | `insert` | `plan_template` |  | `.insert(row)` |
| `apps/api/src/seed-good-health/generators/02_executive_staff.ts:97` | `staff` | `where` | `upsertStaffRow` |  | `.where({ id: row.id })` |
| `apps/api/src/seed-good-health/generators/02_executive_staff.ts:104` | `staff` | `update` | `upsertStaffRow` |  | `.where({ id: row.id })` |
| `apps/api/src/seed-good-health/generators/02_executive_staff.ts:107` | `staff` | `insert` | `upsertStaffRow` |  | `.insert(row)` |
| `apps/api/src/seed-history-data.ts:43` | `episodes` | `where` | `seed` | yes | `.where({ patient_id: P.marcus, status: 'open' })` |
| `apps/api/src/seed-history-data.ts:134` | `episodes` | `where` | `<anon>` | yes | `.where({ patient_id: P.jessica, status: 'open' })` |
| `apps/api/src/seed-history-data.ts:236` | `clinical_notes` | `insert` | `<anon>` |  | `.insert(n)` |
| `apps/api/src/seed-rating-scales.ts:362` | `clinical_templates` | `update` | `<anon>` |  | `.where({ id: existing.id })` |
| `apps/api/src/seed-test-data.ts:59` | `episodes` | `insert` | `ep` | yes | `.insert(episodes)` |
| `apps/api/src/seed-test-data.ts:115` | `patient_medications` | `insert` | `med` | yes | `.insert(meds)` |
| `apps/api/src/seed-test-data.ts:246` | `clinical_notes` | `insert` | `<anon>` | yes | `.insert(notes)` |
| `apps/api/src/seed-test-data.ts:250` | `alert_types` | `select` | `<anon>` | yes | `.select('id', 'name')` |
| `apps/api/src/seed-test-data.ts:263` | `patient_alerts` | `insert` | `<anon>` | yes | `.insert(alerts)` |
| `apps/api/src/seed-test-data.ts:284` | `treatment_plans` | `insert` | `<anon>` | yes | `.insert(plans)` |
| `apps/api/src/seed-test-data.ts:288` | `legal_order_type_configs` | `select` | `<anon>` | yes | `.select('id', 'name')` |
| `apps/api/src/seed-test-data.ts:297` | `patient_legal_orders` | `insert` | `<anon>` | yes | `.insert(legalOrders)` |
| `apps/api/src/seed-test-data.ts:326` | `appointments` | `insert` | `appt` |  | `.insert(appts)` |
| `apps/api/src/server.ts:467` | `subscriber_branding` | `select` | `uploads` |  | `.first()` |
| `apps/api/src/shared/authGuards.ts:63` | `staff_specialties` | `where` | `requireSpecialty` |  | `.where({ staff_id: auth.staffId })` |
| `apps/api/src/shared/authGuards.ts:95` | `staff` | `where` | `requirePrescribingDiscipline` |  | `.where({ id: auth.staffId })` |
| `apps/api/src/shared/authGuards.ts:155` | `staff` | `where` | `requireValidHpii` |  | `.where({ id: auth.staffId })` |
| `apps/api/src/shared/featureFlags.ts:239` | `feature_flags` | `update` | `setFeatureFlag` |  | `.where({ id: existing.id })` |
| `apps/api/src/shared/featureFlags.ts:275` | `feature_flags` | `where` | `deleteFeatureFlag` | yes | `.where({ name })` |
| `apps/api/src/shared/recordLlmInteraction.ts:299` | `llm_interactions` | `insert` | `tryEncrypt` |  | `.insert(row)` |
| `apps/api/src/shared/tenantContext.ts:8` | `patients` | `where` | `<anon>` |  | `.where({ ... })` |
| `apps/api/src/utils/nameResolver.ts:20` | `org_units` | `select` | `getOrgUnitMap` |  | `.select('id', 'name')` |
| `apps/api/src/utils/nameResolver.ts:66` | `staff` | `where` | `resolveStaffName` |  | `.where({ id: staffId })` |
| `apps/api/src/utils/nameResolver.ts:88` | `staff` | `where` | `resolveStaffName` |  | `.whereIn('id', Array.from)` |
| `apps/api/src/utils/nameResolver.ts:109` | `patients` | `where` | `resolvePatientName` |  | `.where({ id: patientId })` |
| `apps/api/src/utils/queryCache.ts:5` | `patients` | `select` | `<anon>` |  | `db('patients').count('*'));` |

## 5. `[ADMIN]` findings (intentional; audit_log evidence required)

_None — no function names ended in `Admin` or flagged as admin-path. All findings are in the MISS section._

## 6. `[RAW]` findings (raw SQL; manual inspection)

### `apps/api/src/features/clinical-notes/clinicalNote.service.ts:31` — table: `clinical_note_versions` (feature: `features/clinical-notes`, function: `snapshotNoteVersion`)

```sql
.raw( `(SELECT COALESCE(MAX(version_number), 0) + 1 FROM clinical_note_versions WHERE note_id = ?)`, [existing.id], )
```

### `apps/api/src/reset-patient-data.ts:62` — table: `patients` (feature: `<root>`, function: `resetPatientData`)

```sql
.raw(`CREATE RULE prevent_hard_delete AS ON DELETE TO patients DO INSTEAD UPDATE patients SET deleted_at = now() WHERE patients.id = old.id AND patients.deleted_at IS NULL`)
```

### `apps/api/src/reset-patient-data.ts:63` — table: `episodes` (feature: `<root>`, function: `resetPatientData`)

```sql
.raw(`CREATE RULE prevent_hard_delete AS ON DELETE TO episodes DO INSTEAD UPDATE episodes SET deleted_at = now() WHERE episodes.id = old.id AND episodes.deleted_at IS NULL`)
```

### `apps/api/src/reset-patient-data.ts:64` — table: `clinical_notes` (feature: `<root>`, function: `resetPatientData`)

```sql
.raw(`CREATE RULE prevent_hard_delete AS ON DELETE TO clinical_notes DO INSTEAD UPDATE clinical_notes SET deleted_at = now() WHERE clinical_notes.id = old.id AND clinical_notes.deleted_at IS NULL`)
```

### `apps/api/src/reset-patient-data.ts:68` — table: `clinical_notes` (feature: `<root>`, function: `resetPatientData`)

```sql
.raw(` SELECT 'patients' as tbl, count(*)::int as cnt FROM patients UNION ALL SELECT 'episodes', count(*)::int FROM episodes UNION ALL SELECT 'clinical_notes', count(*)::int FROM clinical_notes UNION ALL SELECT 'staff (kept)', count(*)::int
```

### `apps/api/src/reset-patient-data.ts:87` — table: `patients` (feature: `<root>`, function: `resetPatientData`)

```sql
.raw(`CREATE RULE IF NOT EXISTS prevent_hard_delete AS ON DELETE TO patients DO INSTEAD UPDATE patients SET deleted_at = now() WHERE patients.id = old.id AND patients.deleted_at IS NULL`)
```

## 7. False-positive risk — honest note

This enumeration is **syntactic**. It cannot see:

1. **Spread into insert/update:** `.insert({ ...row })` where `row` is built a few lines above via a helper that includes `clinic_id`. The enclosing-body check (`possibleFP`) catches most of these — 77 of 263 MISS findings are tagged `FP?=yes` for exactly this reason.
2. **`clinic_id` derived from a JOIN or subquery:** e.g. `.join("patients", "patients.id", "table.patient_id").where("patients.clinic_id", req.clinicId)` — the token `clinic_id` does appear in the chain, so these are NOT flagged. However, chains that scope via a subquery `db("patients").where({ clinic_id }).select("id")` piped into `.whereIn("patient_id", ...)` without re-asserting clinic_id on the outer table ARE flagged (correctly, per §1.3).
3. **Session / token / JTI-keyed lookups** (e.g. `staff_sessions` by `refresh_token`, `oauth_*` by opaque token) — these are typically safe because the key is cryptographically unique across tenants, but §1.3 still calls for defence-in-depth clinic_id filtering. Verify intent per call site.
4. **Seed / bootstrap scripts** (`features/seed-good-health/*`) — some legitimately operate at the "admin" tier during initial fixture load. Those should still include `clinic_id` explicitly; flag as [ADMIN] only if the suffix was used.
5. **MCP + integration modules** — the two dominant buckets (`mcp` 42 and `integrations` 41) contain code paths invoked by background jobs, scheduled exports (`fhir_bulk_export_jobs`), and model-context-protocol tool handlers. A portion of these MAY be legitimately multi-tenant-agnostic (e.g. writing to the clinic_id-bearing audit tables on behalf of an already-scoped actor), but **each call site must be individually verified** — this audit does not assume intent.
6. **ADMIN category reads zero.** This is surprising and almost certainly means the `Admin$` suffix convention is not widely used in the codebase. Every finding is in the [MISS] bucket; the reviewer should reclassify any legitimate admin paths manually during remediation.

## 8. Recommended next step

Triage the **high-confidence MISS** subset (`possibleFP=false`, 186 findings) first. Group by feature: `mcp`, `integrations`, `<root>` dominate the heatmap and warrant focused scoping. For each, either:

- Add `clinic_id` to the `.where({...})` / `.insert({...})` / `.update({...})` per §1.3, OR
- Rename the method to an `-Admin` suffix AND add an `audit_log` row documenting the cross-tenant operation, OR
- If the call site is safe because of a preceding scoping JOIN, refactor to make the `clinic_id` filter explicit on the target table (defence-in-depth, per §1.3 "never rely solely on RLS").
