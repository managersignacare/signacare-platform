# DB Mutation Inventory — 2026-04-19

**Total rows: 784**

## Issues Found

- **Mutations without clinic_id filter:** 74 (CROSS-TENANT RISK)
- **Hard deletes on soft-delete tables:** 62 (DATA LOSS RISK)
- **Soft-delete filters on hard-delete tables:** 0 (SCHEMA MISMATCH)

## Scope

Every `.insert(`, `.update(`, `.delete(` call (Knex builder) in:
- `apps/api/src/features/**/*.ts`
- `apps/api/src/mcp/**/*.ts`
- `apps/api/src/integrations/**/*.ts`
- `apps/api/src/jobs/**/*.ts`

Excludes: seed scripts, migrations, non-DB `.delete()` calls (Map, cache, axios, etc.)

## Key Definitions

- **clinic_id:** Is `clinic_id` explicitly in the WHERE clause?
- **deleted_at:** Is `.whereNull('deleted_at')` present (for soft-delete tables)?
- **hard-delete risk:** DELETE on a soft-delete table without checking `deleted_at`
- **NO clinic_id:** Cross-tenant mutation candidate (RLS will catch at runtime, but app-level filter is missing)

## Table

| # | File:Line | Op | Table | clinic_id | deleted_at | Notes |
|---|---|---|---|---|---|---|
| 1 | advance-directives/advanceDirectiveRoutes.ts:90 | INSERT | (none) | YES | NO | — |
| 2 | advance-directives/advanceDirectiveRoutes.ts:132 | UPDATE | (none) | YES | NO | — |
| 3 | allergies/allergies.routes.ts:33 | DELETE | (none) | NO | NO | — |
| 4 | allergies/allergyController.ts:40 | UPDATE | (none) | NO | NO | — |
| 5 | allergies/allergyRepository.ts:49 | INSERT | patient_allergies | YES | NO | — |
| 6 | allergies/allergyRepository.ts:84 | UPDATE | patient_allergies | YES | YES | — |
| 7 | allergies/allergyRepository.ts:125 | UPDATE | patient_allergies | YES | YES | — |
| 8 | allergies/allergyService.ts:46 | UPDATE | (none) | NO | NO | — |
| 9 | appointments/appointmentAttendeeRepository.ts:95 | INSERT | (none) | NO | NO | — |
| 10 | appointments/appointmentAttendeeRepository.ts:111 | INSERT | (none) | YES | NO | — |
| 11 | appointments/appointmentAttendeeRepository.ts:143 | UPDATE | (none) | YES | NO | — |
| 12 | appointments/appointmentAttendeeRepository.ts:158 | UPDATE | (none) | YES | NO | — |
| 13 | appointments/appointmentAttendeeRepository.ts:183 | UPDATE | (none) | YES | NO | — |
| 14 | appointments/appointmentAttendeeRepository.ts:189 | INSERT | (none) | YES | NO | — |
| 15 | appointments/appointmentController.ts:76 | UPDATE | (none) | NO | NO | — |
| 16 | appointments/appointmentRepository.ts:86 | INSERT | (none) | NO | NO | — |
| 17 | appointments/appointmentRepository.ts:100 | UPDATE | (none) | YES | YES | — |
| 18 | appointments/appointmentRepository.ts:164 | UPDATE | (none) | YES | YES | — |
| 19 | appointments/appointmentRoutes.ts:81 | DELETE | (none) | NO | NO | — |
| 20 | appointments/appointmentService.ts:240 | UPDATE | (none) | NO | NO | — |
| 21 | appointments/appointmentService.ts:272 | UPDATE | (none) | NO | NO | — |
| 22 | appointments/appointmentService.ts:295 | UPDATE | appointments | NO | NO | NO clinic_id |
| 23 | appointments/appointmentService.ts:381 | UPDATE | (none) | NO | NO | — |
| 24 | appointments/appointmentService.ts:468 | UPDATE | (none) | NO | NO | — |
| 25 | appointments/appointmentService.ts:525 | UPDATE | (none) | NO | NO | — |
| 26 | appointments/waitlistController.ts:37 | UPDATE | (none) | NO | NO | — |
| 27 | appointments/waitlistRepository.ts:74 | INSERT | (none) | NO | NO | — |
| 28 | appointments/waitlistRepository.ts:88 | UPDATE | (none) | YES | YES | — |
| 29 | appointments/waitlistRepository.ts:121 | UPDATE | (none) | YES | YES | — |
| 30 | appointments/waitlistService.ts:88 | UPDATE | (none) | NO | NO | — |
| 31 | appointments/waitlistService.ts:164 | INSERT | appointments | YES | NO | — |
| 32 | appointments/waitlistService.ts:204 | UPDATE | (none) | NO | NO | — |
| 33 | auth/adminImpersonationRoutes.ts:75 | INSERT | admin_impersonation_sessions | YES | NO | — |
| 34 | auth/adminImpersonationRoutes.ts:146 | UPDATE | admin_impersonation_sessions | YES | NO | — |
| 35 | auth/authRepository.ts:43 | UPDATE | (none) | NO | NO | — |
| 36 | auth/authRepository.ts:49 | INSERT | (none) | NO | NO | — |
| 37 | auth/authRepository.ts:71 | INSERT | (none) | NO | NO | — |
| 38 | auth/authRepository.ts:99 | UPDATE | (none) | NO | NO | — |
| 39 | auth/authRepository.ts:112 | UPDATE | (none) | NO | NO | — |
| 40 | auth/authRepository.ts:119 | UPDATE | (none) | NO | NO | — |
| 41 | auth/authService.ts:170 | UPDATE | (none) | YES | NO | — |
| 42 | auth/breakGlassRoutes.ts:95 | UPDATE | (none) | NO | NO | — |
| 43 | auth/breakGlassRoutes.ts:179 | INSERT | (none) | YES | NO | — |
| 44 | auth/breakGlassRoutes.ts:199 | INSERT | (none) | YES | NO | — |
| 45 | auth/breakGlassRoutes.ts:221 | UPDATE | (none) | YES | NO | — |
| 46 | auth/breakGlassRoutes.ts:291 | UPDATE | break_glass_sessions | YES | NO | — |
| 47 | auth/breakGlassRoutes.ts:300 | INSERT | break_glass_sessions | YES | NO | — |
| 48 | auth/breakGlassRoutes.ts:364 | UPDATE | break_glass_sessions | YES | NO | — |
| 49 | auth/breakGlassRoutes.ts:370 | INSERT | break_glass_sessions | YES | NO | — |
| 50 | auth/breakGlassRoutes.ts:415 | UPDATE | break_glass_sessions | YES | NO | — |
| 51 | auth/breakGlassRoutes.ts:421 | INSERT | break_glass_sessions | YES | NO | — |
| 52 | auth/webauthnRoutes.ts:150 | INSERT | (none) | YES | NO | — |
| 53 | auth/webauthnRoutes.ts:161 | UPDATE | webauthn_credentials | YES | NO | — |
| 54 | auth/webauthnRoutes.ts:256 | UPDATE | (none) | YES | NO | — |
| 55 | auth/webauthnRoutes.ts:292 | DELETE | webauthn_credentials | YES | YES | — |
| 56 | auth/webauthnRoutes.ts:301 | UPDATE | webauthn_credentials | YES | YES | — |
| 57 | auth/webauthnRoutes.ts:317 | UPDATE | mfa_secrets | YES | YES | — |
| 58 | backup/backupRoutes.ts:76 | INSERT | (none) | NO | NO | — |
| 59 | backup/backupRoutes.ts:92 | UPDATE | (none) | NO | NO | — |
| 60 | backup/backupRoutes.ts:183 | INSERT | backup_history | NO | NO | — |
| 61 | backup/backupRoutes.ts:202 | UPDATE | backup_history | NO | NO | NO clinic_id |
| 62 | backup/backupRoutes.ts:275 | UPDATE | backup_history | NO | NO | NO clinic_id |
| 63 | backup/backupRoutes.ts:318 | UPDATE | backup_history | NO | NO | NO clinic_id |
| 64 | beds/bedRoutes.ts:110 | INSERT | (none) | YES | NO | — |
| 65 | beds/bedRoutes.ts:127 | INSERT | beds | YES | NO | — |
| 66 | beds/bedRoutes.ts:149 | UPDATE | beds | YES | NO | — |
| 67 | beds/bedRoutes.ts:156 | DELETE | beds | YES | NO | hard-delete risk |
| 68 | beds/bedRoutes.ts:161 | DELETE | beds | YES | NO | hard-delete risk |
| 69 | beds/bedRoutes.ts:172 | UPDATE | beds | YES | NO | — |
| 70 | beds/bedRoutes.ts:173 | INSERT | beds | YES | NO | — |
| 71 | beds/bedRoutes.ts:198 | INSERT | bed_movements as d | YES | NO | — |
| 72 | beds/bedRoutes.ts:204 | UPDATE | beds | YES | NO | — |
| 73 | beds/bedRoutes.ts:223 | INSERT | bed_movements as d | YES | NO | — |
| 74 | beds/bedRoutes.ts:244 | INSERT | restrictive_interventions | YES | NO | — |
| 75 | beds/bedRoutes.ts:262 | UPDATE | restrictive_interventions | YES | NO | — |
| 76 | billing/billingRepository.ts:149 | UPDATE | billing_accounts | YES | NO | — |
| 77 | billing/billingRepository.ts:165 | INSERT | billing_accounts | YES | NO | — |
| 78 | billing/billingRepository.ts:203 | INSERT | billing_accounts | YES | NO | — |
| 79 | billing/billingRepository.ts:238 | INSERT | (none) | NO | NO | — |
| 80 | billing/billingRepository.ts:308 | INSERT | (none) | YES | NO | — |
| 81 | billing/billingRepository.ts:369 | UPDATE | invoices | YES | NO | — |
| 82 | billing/billingRepository.ts:399 | UPDATE | payments | YES | NO | — |
| 83 | billing/billingRepository.ts:410 | UPDATE | invoices | YES | NO | — |
| 84 | billing/billingRepository.ts:423 | INSERT | invoices | YES | NO | — |
| 85 | billing/billingRepository.ts:428 | INSERT | invoices | YES | NO | — |
| 86 | billing/billingRepository.ts:446 | UPDATE | invoices | YES | NO | — |
| 87 | billing/billingRoutes.ts:48 | DELETE | invoices | NO | NO | NO clinic_id; hard-delete risk |
| 88 | billing/billingRoutes.ts:105 | UPDATE | (none) | NO | NO | — |
| 89 | billing/billingRoutes.ts:111 | DELETE | (none) | NO | NO | — |
| 90 | billing/billingRoutes.ts:142 | DELETE | (none) | NO | NO | — |
| 91 | billing/billingService.ts:415 | UPDATE | (none) | NO | NO | — |
| 92 | billing/billingService.ts:455 | INSERT | (none) | YES | NO | — |
| 93 | billing/clinicianFeeService.ts:89 | INSERT | fee_schedules | YES | NO | — |
| 94 | billing/clinicianFeeService.ts:112 | UPDATE | clinician_fee_overrides | YES | NO | — |
| 95 | billing/feeScheduleService.ts:83 | INSERT | (none) | YES | NO | — |
| 96 | billing/feeScheduleService.ts:121 | UPDATE | (none) | YES | NO | — |
| 97 | billing/feeScheduleService.ts:129 | UPDATE | fee_schedules | YES | NO | — |
| 98 | billing/referralValidityService.ts:71 | UPDATE | (none) | YES | NO | — |
| 99 | billing/referralValidityService.ts:74 | INSERT | (none) | YES | NO | — |
| 100 | calendar/calendarRepository.ts:180 | INSERT | (none) | NO | YES | — |
| 101 | calendar/calendarRepository.ts:205 | UPDATE | (none) | YES | YES | — |
| 102 | calendar/calendarRepository.ts:220 | UPDATE | (none) | YES | YES | — |
| 103 | calendar/calendarRepository.ts:259 | UPDATE | (none) | NO | NO | — |
| 104 | calendar/calendarRepository.ts:264 | INSERT | (none) | NO | NO | — |
| 105 | calendar/calendarRoutes.ts:68 | DELETE | (none) | NO | NO | — |
| 106 | calendar/icalTokenService.ts:100 | UPDATE | (none) | NO | NO | — |
| 107 | carers/carerRoutes.ts:46 | INSERT | carers | YES | NO | — |
| 108 | carers/carerRoutes.ts:62 | UPDATE | carers | YES | NO | — |
| 109 | carers/carerRoutes.ts:67 | DELETE | carers | YES | NO | hard-delete risk |
| 110 | carers/carerRoutes.ts:73 | DELETE | carers | YES | NO | hard-delete risk |
| 111 | checklists/checklistRoutes.ts:180 | INSERT | checklist_templates | YES | NO | — |
| 112 | checklists/checklistRoutes.ts:199 | UPDATE | checklist_templates | YES | NO | — |
| 113 | checklists/checklistRoutes.ts:204 | DELETE | checklist_templates | YES | NO | hard-delete risk |
| 114 | checklists/checklistRoutes.ts:206 | DELETE | checklist_templates | YES | NO | hard-delete risk |
| 115 | checklists/checklistRoutes.ts:218 | INSERT | checklist_templates | YES | NO | — |
| 116 | checklists/checklistRoutes.ts:241 | INSERT | checklist_templates | YES | NO | — |
| 117 | checklists/checklistRoutes.ts:277 | UPDATE | checklist_instances | YES | NO | — |
| 118 | checklists/checklistRoutes.ts:287 | UPDATE | checklist_instances | YES | NO | — |
| 119 | clinic-settings/clinicSettingsRoutes.ts:73 | UPDATE | clinic_settings | YES | NO | — |
| 120 | clinic-settings/clinicSettingsRoutes.ts:75 | INSERT | clinic_settings | YES | NO | — |
| 121 | clinic/clinicRepository.ts:49 | INSERT | (none) | NO | NO | — |
| 122 | clinic/clinicRepository.ts:61 | UPDATE | (none) | NO | NO | — |
| 123 | clinic/clinicService.ts:50 | INSERT | (none) | NO | NO | — |
| 124 | clinic/clinicService.ts:89 | UPDATE | (none) | NO | NO | — |
| 125 | clinical-notes/clinicalNote.controller.ts:111 | UPDATE | (none) | NO | NO | — |
| 126 | clinical-notes/clinicalNote.controller.ts:187 | UPDATE | clinical_note_codes | YES | NO | — |
| 127 | clinical-notes/clinicalNote.repository.ts:103 | INSERT | clinical_notes | YES | NO | — |
| 128 | clinical-notes/clinicalNote.repository.ts:182 | UPDATE | clinical_notes | YES | YES | — |
| 129 | clinical-notes/clinicalNote.repository.ts:220 | UPDATE | clinical_notes | YES | YES | — |
| 130 | clinical-notes/clinicalNote.repository.ts:230 | UPDATE | clinical_notes | YES | YES | — |
| 131 | clinical-notes/clinicalNote.routes.ts:78 | DELETE | (none) | NO | NO | — |
| 132 | clinical-notes/clinicalNote.service.ts:28 | INSERT | (none) | YES | NO | — |
| 133 | clinical-notes/clinicalNote.service.ts:127 | UPDATE | (none) | NO | NO | — |
| 134 | clinical-notes/clinicalNote.service.ts:180 | UPDATE | (none) | NO | NO | — |
| 135 | clinical-review/clinicalReviewRepository.ts:161 | INSERT | (none) | YES | NO | — |
| 136 | clinical-review/clinicalReviewRepository.ts:216 | UPDATE | (none) | YES | YES | — |
| 137 | clinical-review/clinicalReviewRepository.ts:244 | UPDATE | (none) | YES | NO | — |
| 138 | clinical-review/clinicalReviewRepository.ts:259 | INSERT | (none) | YES | NO | — |
| 139 | clinical-review/clinicalReviewRepository.ts:296 | UPDATE | (none) | YES | YES | — |
| 140 | clinical-review/clinicalReviewRepository.ts:313 | INSERT | (none) | NO | NO | — |
| 141 | clinical-review/clinicalReviewRepository.ts:337 | INSERT | (none) | YES | NO | — |
| 142 | clinical-review/clinicalReviewRepository.ts:359 | UPDATE | consultations | YES | YES | — |
| 143 | clinical-review/clinicalReviewRepository.ts:382 | INSERT | consultations | YES | NO | — |
| 144 | clozapine/clozapineRepository.ts:186 | INSERT | clozapine_registrations | YES | NO | — |
| 145 | clozapine/clozapineRepository.ts:236 | UPDATE | clozapine_registrations | YES | YES | — |
| 146 | clozapine/clozapineRepository.ts:254 | UPDATE | clozapine_registrations | YES | YES | — |
| 147 | clozapine/clozapineRepository.ts:275 | INSERT | clozapine_blood_results | YES | NO | — |
| 148 | clozapine/clozapineRepository.ts:317 | INSERT | clozapine_blood_results | YES | NO | — |
| 149 | clozapine/clozapineRepository.ts:361 | UPDATE | (none) | YES | NO | — |
| 150 | clozapine/clozapineRepository.ts:382 | INSERT | (none) | YES | NO | — |
| 151 | clozapine/clozapineRepository.ts:421 | INSERT | (none) | YES | NO | — |
| 152 | clozapine/clozapineRepository.ts:474 | UPDATE | (none) | YES | NO | — |
| 153 | clozapine/clozapineRepository.ts:485 | INSERT | (none) | YES | NO | — |
| 154 | clozapine/clozapineService.ts:72 | INSERT | patient_flags | YES | NO | — |
| 155 | clozapine/clozapineService.ts:97 | UPDATE | patient_flags | YES | NO | — |
| 156 | contacts/autoContactRecord.ts:90 | INSERT | staff | YES | NO | — |
| 157 | contacts/contactRecordRoutes.ts:240 | INSERT | (none) | YES | NO | — |
| 158 | contacts/contactRecordRoutes.ts:276 | UPDATE | (none) | YES | NO | — |
| 159 | correspondence/correspondenceRepository.ts:62 | INSERT | correspondence_letters | YES | YES | — |
| 160 | correspondence/correspondenceRepository.ts:129 | UPDATE | correspondence_letters | YES | YES | — |
| 161 | correspondence/correspondenceRepository.ts:138 | UPDATE | correspondence_letters | YES | YES | — |
| 162 | correspondence/correspondenceRoutes.ts:42 | DELETE | (none) | NO | NO | — |
| 163 | documents/documentService.ts:222 | INSERT | (none) | YES | NO | — |
| 164 | ect/ectService.ts:77 | INSERT | ect_courses | YES | NO | — |
| 165 | ect/ectService.ts:153 | UPDATE | ect_courses | YES | NO | — |
| 166 | ect/ectService.ts:157 | INSERT | ect_sessions | YES | NO | — |
| 167 | endocrinology/endocrinologyRoutes.ts:76 | DELETE | (none) | NO | NO | — |
| 168 | endocrinology/glucoseRepository.ts:84 | INSERT | (none) | YES | NO | — |
| 169 | endocrinology/glucoseRepository.ts:107 | UPDATE | (none) | YES | YES | — |
| 170 | endocrinology/insulinRepository.ts:104 | UPDATE | (none) | YES | YES | — |
| 171 | endocrinology/insulinRepository.ts:107 | INSERT | (none) | YES | YES | — |
| 172 | endocrinology/insulinService.ts:153 | UPDATE | patient_medications | YES | YES | — |
| 173 | endocrinology/insulinService.ts:156 | INSERT | patient_medications | YES | YES | — |
| 174 | episode/episodeController.ts:63 | UPDATE | (none) | NO | NO | — |
| 175 | episode/episodeRepository.ts:68 | INSERT | (none) | YES | YES | — |
| 176 | episode/episodeRepository.ts:85 | UPDATE | (none) | NO | NO | — |
| 177 | episode/episodeRepository.ts:119 | UPDATE | (none) | NO | NO | — |
| 178 | episode/episodeRoutes.ts:156 | UPDATE | episodes | YES | YES | — |
| 179 | episode/episodeRoutes.ts:170 | INSERT | patient_team_assignments | YES | YES | — |
| 180 | episode/episodeRoutes.ts:193 | UPDATE | staff_role_assignments | NO | NO | NO clinic_id |
| 181 | episode/episodeRoutes.ts:245 | INSERT | staff_role_assignments | YES | NO | — |
| 182 | episode/episodeRoutes.ts:260 | UPDATE | staff_role_assignments | YES | NO | — |
| 183 | episode/episodeRoutes.ts:262 | INSERT | staff_role_assignments | NO | NO | — |
| 184 | episode/episodeRoutes.ts:360 | UPDATE | patient_medications | NO | NO | NO clinic_id |
| 185 | episode/episodeRoutes.ts:370 | UPDATE | episodes | YES | NO | — |
| 186 | episode/episodeRoutes.ts:383 | INSERT | episodes | YES | NO | — |
| 187 | episode/episodeRoutes.ts:406 | UPDATE | episodes | YES | NO | — |
| 188 | episode/episodeRoutes.ts:434 | UPDATE | episodes | YES | NO | — |
| 189 | episode/episodeRoutes.ts:444 | INSERT | episodes | YES | NO | — |
| 190 | episode/episodeRoutes.ts:466 | UPDATE | episodes | YES | NO | — |
| 191 | episode/episodeService.ts:165 | UPDATE | (none) | NO | NO | — |
| 192 | episode/episodeService.ts:288 | UPDATE | (none) | NO | NO | — |
| 193 | ereferral/ereferralRoutes.ts:88 | INSERT | ereferrals | YES | NO | — |
| 194 | ereferral/ereferralRoutes.ts:126 | UPDATE | ereferrals | YES | NO | — |
| 195 | escalations/escalation.controller.ts:66 | INSERT | patient_team_assignments | YES | NO | — |
| 196 | escalations/escalation.controller.ts:75 | UPDATE | patient_team_assignments | YES | NO | — |
| 197 | escalations/escalation.controller.ts:80 | INSERT | patient_team_assignments | YES | NO | — |
| 198 | escalations/escalation.controller.ts:99 | INSERT | episodes | YES | NO | — |
| 199 | escalations/escalation.controller.ts:128 | UPDATE | clinical_notes | NO | NO | NO clinic_id |
| 200 | escalations/escalation.repository.ts:171 | INSERT | escalations | YES | NO | — |
| 201 | escalations/escalation.repository.ts:184 | INSERT | escalations | NO | NO | — |
| 202 | escalations/escalation.repository.ts:209 | UPDATE | escalations | YES | NO | — |
| 203 | escalations/escalation.repository.ts:211 | INSERT | escalations | YES | NO | — |
| 204 | escalations/escalation.repository.ts:228 | UPDATE | escalations | YES | YES | — |
| 205 | escalations/escalation.routes.ts:62 | DELETE | patient_team_assignments | NO | NO | NO clinic_id; hard-delete risk |
| 206 | escalations/escalation.routes.ts:89 | UPDATE | patient_team_assignments | YES | YES | — |
| 207 | escalations/escalation.routes.ts:97 | UPDATE | episodes | YES | YES | — |
| 208 | escalations/escalation.routes.ts:102 | INSERT | episodes | YES | YES | — |
| 209 | escalations/escalation.routes.ts:113 | UPDATE | episodes | YES | NO | — |
| 210 | escalations/escalation.routes.ts:139 | UPDATE | patient_team_assignments | YES | NO | — |
| 211 | escalations/escalation.routes.ts:142 | UPDATE | patient_team_assignments | YES | NO | — |
| 212 | events/sseRoutes.ts:88 | DELETE | (none) | NO | NO | — |
| 213 | events/sseRoutes.ts:159 | DELETE | (none) | NO | NO | — |
| 214 | events/sseRoutes.ts:176 | DELETE | (none) | NO | NO | — |
| 215 | feature-flags/featureFlagRoutes.ts:196 | INSERT | feature_flag_disable_requests | YES | NO | — |
| 216 | feature-flags/featureFlagRoutes.ts:252 | UPDATE | feature_flag_disable_requests | NO | NO | NO clinic_id |
| 217 | feature-flags/featureFlagRoutes.ts:257 | DELETE | feature_flag_disable_requests | NO | NO | NO clinic_id; hard-delete risk |
| 218 | flags/flagRepository.ts:55 | INSERT | patient_flags | NO | NO | — |
| 219 | flags/flagRepository.ts:104 | UPDATE | patient_flags | YES | YES | — |
| 220 | flags/flagService.ts:54 | INSERT | (none) | YES | NO | — |
| 221 | group-therapy/groupTherapyRoutes.ts:115 | INSERT | group_session_attendees as a | YES | NO | — |
| 222 | group-therapy/groupTherapyRoutes.ts:142 | UPDATE | group_sessions | YES | NO | — |
| 223 | group-therapy/groupTherapyRoutes.ts:158 | INSERT | group_session_attendees | NO | NO | — |
| 224 | group-therapy/groupTherapyRoutes.ts:168 | UPDATE | group_session_attendees | NO | NO | NO clinic_id |
| 225 | group-therapy/groupTherapyRoutes.ts:191 | INSERT | group_session_attendees as a | NO | NO | — |
| 226 | group-therapy/groupTherapyRoutes.ts:213 | UPDATE | group_session_attendees | NO | NO | NO clinic_id |
| 227 | group-therapy/groupTherapyRoutes.ts:219 | DELETE | group_session_attendees | NO | NO | NO clinic_id; hard-delete risk |
| 228 | group-therapy/groupTherapyRoutes.ts:221 | DELETE | group_session_attendees | NO | NO | NO clinic_id; hard-delete risk |
| 229 | group-therapy/groupTherapyRoutes.ts:234 | UPDATE | group_session_attendees | NO | NO | NO clinic_id |
| 230 | group-therapy/groupTherapyRoutes.ts:241 | INSERT | group_sessions | YES | NO | — |
| 231 | imports/importService.ts:152 | INSERT | import_jobs | YES | NO | — |
| 232 | imports/importService.ts:252 | UPDATE | import_jobs | NO | NO | NO clinic_id |
| 233 | internal-medicine/internalMedicineRoutes.ts:68 | UPDATE | (none) | NO | NO | — |
| 234 | internal-medicine/internalMedicineRoutes.ts:79 | DELETE | (none) | NO | NO | — |
| 235 | internal-medicine/medRecRepository.ts:77 | INSERT | medication_reconciliations as mr | YES | NO | — |
| 236 | internal-medicine/problemListRepository.ts:99 | INSERT | problem_list as pl | YES | NO | — |
| 237 | internal-medicine/problemListRepository.ts:116 | UPDATE | (none) | YES | YES | — |
| 238 | internal-medicine/problemListRepository.ts:125 | UPDATE | (none) | YES | YES | — |
| 239 | internal-medicine/problemListService.ts:119 | UPDATE | (none) | NO | NO | — |
| 240 | lai/aimsAssessmentRepository.ts:47 | INSERT | aims_assessments | YES | NO | — |
| 241 | lai/laiGivenRepository.ts:53 | INSERT | (none) | YES | NO | — |
| 242 | lai/laiScheduleController.ts:58 | UPDATE | (none) | NO | NO | — |
| 243 | lai/laiScheduleRepository.ts:64 | INSERT | lai_schedules | YES | NO | — |
| 244 | lai/laiScheduleRepository.ts:146 | UPDATE | lai_schedules | YES | YES | — |
| 245 | lai/laiScheduleRepository.ts:161 | UPDATE | lai_schedules | YES | YES | — |
| 246 | lai/laiScheduleRepository.ts:177 | UPDATE | (none) | YES | YES | — |
| 247 | lai/laiScheduleRepository.ts:193 | UPDATE | lai_schedules | YES | YES | — |
| 248 | lai/laiScheduleRepository.ts:201 | UPDATE | lai_schedules | YES | YES | — |
| 249 | lai/laiScheduleRoutes.ts:86 | INSERT | lai_validations | YES | NO | — |
| 250 | lai/laiScheduleRoutes.ts:111 | UPDATE | lai_schedules | YES | YES | — |
| 251 | lai/laiScheduleService.ts:80 | INSERT | patient_flags | YES | NO | — |
| 252 | lai/laiScheduleService.ts:105 | UPDATE | patient_flags | YES | NO | — |
| 253 | lai/laiScheduleService.ts:274 | UPDATE | (none) | NO | NO | — |
| 254 | llm/adminTrainingRoutes.ts:79 | INSERT | phi_scrubber_rules | YES | NO | — |
| 255 | llm/adminTrainingRoutes.ts:120 | UPDATE | phi_scrubber_rules | YES | NO | — |
| 256 | llm/adminTrainingRoutes.ts:216 | UPDATE | training_corpus_items | YES | NO | — |
| 257 | llm/adminTrainingRoutes.ts:241 | INSERT | model_registry | NO | NO | — |
| 258 | llm/adminTrainingRoutes.ts:299 | UPDATE | model_registry | NO | NO | NO clinic_id |
| 259 | llm/adminTrainingRoutes.ts:338 | INSERT | model_deployments | YES | NO | — |
| 260 | llm/adminTrainingRoutes.ts:400 | UPDATE | model_deployments | YES | NO | — |
| 261 | llm/adminTrainingRoutes.ts:464 | UPDATE | clinic_settings | YES | NO | — |
| 262 | llm/letterDeliveryService.ts:64 | INSERT | letter_deliveries | YES | NO | — |
| 263 | llm/letterDeliveryService.ts:147 | UPDATE | letter_deliveries | YES | NO | — |
| 264 | llm/letterDeliveryService.ts:157 | UPDATE | letter_deliveries | YES | NO | — |
| 265 | llm/letterDeliveryService.ts:163 | INSERT | letters | YES | NO | — |
| 266 | llm/letterDeliveryService.ts:250 | INSERT | letter_exports | YES | NO | — |
| 267 | llm/letterDeliveryService.ts:335 | INSERT | letters | YES | NO | — |
| 268 | llm/letterDeliveryService.ts:345 | UPDATE | letter_revisions | YES | NO | — |
| 269 | llm/letterDeliveryService.ts:351 | INSERT | letters | YES | NO | — |
| 270 | llm/letterRoutes.ts:376 | UPDATE | letter_translations | YES | NO | — |
| 271 | llm/letterRoutes.ts:385 | INSERT | letter_translations | YES | NO | — |
| 272 | llm/letterService.ts:69 | INSERT | letters | YES | NO | — |
| 273 | llm/letterService.ts:92 | INSERT | letter_sections | YES | NO | — |
| 274 | llm/letterService.ts:148 | UPDATE | letter_sections | YES | NO | — |
| 275 | llm/letterService.ts:155 | UPDATE | letter_sections | NO | NO | NO clinic_id |
| 276 | llm/letterService.ts:205 | UPDATE | letter_sections | YES | NO | — |
| 277 | llm/letterService.ts:206 | UPDATE | letter_sections | YES | NO | — |
| 278 | llm/letterService.ts:249 | UPDATE | letter_sections | YES | NO | — |
| 279 | llm/letterService.ts:284 | UPDATE | letters | YES | NO | — |
| 280 | llm/letterService.ts:322 | UPDATE | letters | YES | NO | — |
| 281 | llm/letterService.ts:354 | INSERT | (none) | YES | NO | — |
| 282 | llm/letterStructuredRoutes.ts:78 | INSERT | capacity_assessments | YES | NO | — |
| 283 | llm/letterStructuredRoutes.ts:174 | INSERT | forensic_risk_formulations | YES | NO | — |
| 284 | llm/letterStructuredRoutes.ts:262 | INSERT | letter_citations | YES | NO | — |
| 285 | llm/llmRepository.ts:60 | INSERT | llm_interactions | NO | NO | — |
| 286 | llm/llmRoutes.ts:273 | INSERT | training_export_requests | YES | NO | — |
| 287 | llm/llmRoutes.ts:357 | UPDATE | training_export_requests | NO | NO | NO clinic_id |
| 288 | llm/llmRoutes.ts:403 | UPDATE | training_export_requests | YES | NO | — |
| 289 | llm/llmRoutes.ts:412 | UPDATE | training_export_requests | NO | NO | NO clinic_id |
| 290 | llm/llmRoutes.ts:541 | INSERT | (none) | YES | NO | — |
| 291 | llm/llmRoutes.ts:563 | INSERT | audit_log | YES | NO | — |
| 292 | llm/llmRoutes.ts:595 | INSERT | clinical_note_codes | YES | NO | — |
| 293 | llm/llmRoutes.ts:687 | INSERT | (none) | YES | NO | — |
| 294 | llm/llmTrainingRoutes.ts:89 | UPDATE | ai_modelfiles | YES | NO | — |
| 295 | llm/llmTrainingRoutes.ts:105 | INSERT | ai_modelfiles | YES | NO | — |
| 296 | llm/llmTrainingRoutes.ts:128 | DELETE | ai_modelfiles | YES | NO | hard-delete risk |
| 297 | llm/llmTrainingRoutes.ts:132 | DELETE | ai_modelfiles | YES | NO | hard-delete risk |
| 298 | llm/phiScrubberService.ts:110 | INSERT | training_corpus_items | YES | NO | — |
| 299 | llm/scribeRoutes.ts:392 | INSERT | scribe_consents | YES | NO | — |
| 300 | llm/scribeRoutes.ts:463 | INSERT | clinic_scribe_vocabulary | YES | NO | — |
| 301 | llm/scribeRoutes.ts:501 | UPDATE | clinic_scribe_vocabulary | YES | NO | — |
| 302 | llm/scribeRoutes.ts:523 | DELETE | clinic_scribe_vocabulary | YES | NO | hard-delete risk |
| 303 | llm/scribeRoutes.ts:529 | DELETE | clinic_scribe_vocabulary | YES | NO | hard-delete risk |
| 304 | llm/scribeRoutes.ts:575 | INSERT | scribe_sessions | YES | NO | — |
| 305 | llm/scribeRoutes.ts:667 | UPDATE | scribe_sessions | YES | NO | — |
| 306 | llm/scribeRoutes.ts:778 | UPDATE | scribe_sensitive_flags | YES | NO | — |
| 307 | llm/scribeRoutes.ts:825 | INSERT | scribe_action_items | YES | NO | — |
| 308 | llm/scribeRoutes.ts:877 | UPDATE | scribe_action_items | YES | NO | — |
| 309 | llm/scribeRoutes.ts:904 | UPDATE | scribe_action_items | YES | NO | — |
| 310 | llm/scribeRoutes.ts:951 | UPDATE | scribe_talk_time_metrics | YES | NO | — |
| 311 | llm/scribeRoutes.ts:959 | INSERT | scribe_talk_time_metrics | YES | NO | — |
| 312 | llm/scribeRoutes.ts:1053 | INSERT | scribe_note_templates | YES | NO | — |
| 313 | llm/scribeSafetyService.ts:231 | INSERT | scribe_sensitive_flags | YES | NO | — |
| 314 | medications/medicationController.ts:132 | UPDATE | (none) | NO | NO | — |
| 315 | medications/medicationRepository.ts:126 | INSERT | (none) | YES | NO | — |
| 316 | medications/medicationRepository.ts:191 | UPDATE | (none) | YES | NO | — |
| 317 | medications/medicationRepository.ts:202 | UPDATE | (none) | YES | NO | — |
| 318 | medications/medicationRepository.ts:208 | UPDATE | (none) | YES | YES | — |
| 319 | medications/medicationRoutes.ts:60 | DELETE | (none) | NO | NO | — |
| 320 | medications/medicationService.ts:210 | UPDATE | (none) | NO | NO | — |
| 321 | messaging/messageRepository.ts:112 | INSERT | message_threads | YES | NO | — |
| 322 | messaging/messageRepository.ts:129 | INSERT | message_threads | YES | NO | — |
| 323 | messaging/messageRepository.ts:190 | INSERT | messages | YES | N/A | — |
| 324 | messaging/messageRepository.ts:289 | UPDATE | messages | YES | N/A | — |
| 325 | mobile-sync/mobileSyncRoutes.ts:204 | UPDATE | staff_fcm_tokens | NO | NO | NO clinic_id |
| 326 | mobile-sync/mobileSyncRoutes.ts:214 | INSERT | staff_fcm_tokens | YES | NO | — |
| 327 | mobile-sync/mobileSyncRoutes.ts:229 | DELETE | staff_fcm_tokens | NO | NO | NO clinic_id; hard-delete risk |
| 328 | mobile-sync/mobileSyncRoutes.ts:240 | UPDATE | staff_fcm_tokens | YES | YES | — |
| 329 | notifications/notificationRepository.ts:128 | INSERT | (none) | YES | NO | — |
| 330 | notifications/notificationRepository.ts:142 | INSERT | (none) | YES | NO | — |
| 331 | notifications/notificationRepository.ts:200 | UPDATE | notifications | YES | NO | — |
| 332 | notifications/notificationRepository.ts:211 | UPDATE | notifications | YES | NO | — |
| 333 | notifications/notificationRepository.ts:224 | UPDATE | notifications | YES | NO | — |
| 334 | notifications/notificationRoutes.ts:108 | DELETE | (none) | NO | NO | — |
| 335 | obs-gyne/obsGyneRepositories.ts:85 | INSERT | (none) | YES | NO | — |
| 336 | obs-gyne/obsGyneRepositories.ts:170 | INSERT | (none) | YES | NO | — |
| 337 | oncology/oncologyRepository.ts:186 | INSERT | (none) | YES | NO | — |
| 338 | oncology/oncologyRepository.ts:229 | INSERT | (none) | YES | NO | — |
| 339 | oncology/oncologyRepository.ts:267 | INSERT | (none) | YES | NO | — |
| 340 | oncology/oncologyRepository.ts:307 | INSERT | (none) | YES | NO | — |
| 341 | oncology/oncologyRepository.ts:351 | INSERT | (none) | YES | NO | — |
| 342 | oncology/oncologyRepository.ts:392 | INSERT | (none) | YES | NO | — |
| 343 | org-settings/orgSettingsRepository.ts:37 | INSERT | org_level_labels | YES | NO | — |
| 344 | org-settings/orgSettingsRepository.ts:82 | INSERT | org_units | YES | NO | — |
| 345 | org-settings/orgSettingsRepository.ts:103 | UPDATE | org_units | NO | NO | NO clinic_id |
| 346 | org-settings/orgSettingsRepository.ts:109 | DELETE | org_units | NO | NO | NO clinic_id; hard-delete risk |
| 347 | org-settings/orgSettingsRepository.ts:140 | INSERT | programs | YES | NO | — |
| 348 | org-settings/orgSettingsRepository.ts:159 | UPDATE | programs | NO | NO | NO clinic_id |
| 349 | org-settings/orgSettingsRepository.ts:165 | DELETE | programs | NO | NO | NO clinic_id; hard-delete risk |
| 350 | org-settings/orgSettingsRepository.ts:231 | INSERT | org_unit_programs | YES | NO | — |
| 351 | org-settings/orgSettingsRepository.ts:257 | DELETE | org_unit_programs | YES | NO | hard-delete risk |
| 352 | org-settings/orgSettingsRoutes.ts:34 | DELETE | (none) | NO | NO | — |
| 353 | org-settings/orgSettingsRoutes.ts:40 | DELETE | (none) | NO | NO | — |
| 354 | org-settings/orgSettingsRoutes.ts:44 | DELETE | (none) | NO | NO | — |
| 355 | outcomes/outcomeRoutes.ts:139 | INSERT | episodes | YES | YES | — |
| 356 | outcomes/outcomeRoutes.ts:180 | UPDATE | outcome_measures | YES | NO | — |
| 357 | paediatrics/paediatricsRepositories.ts:95 | INSERT | (none) | YES | NO | — |
| 358 | paediatrics/paediatricsRepositories.ts:176 | INSERT | immunizations as i | YES | NO | — |
| 359 | paediatrics/paediatricsRepositories.ts:238 | INSERT | developmental_milestones as m | YES | NO | — |
| 360 | pathology/pathologyRepository.ts:91 | INSERT | pathology_orders | YES | NO | — |
| 361 | pathology/pathologyRepository.ts:137 | UPDATE | pathology_orders | YES | NO | — |
| 362 | pathology/pathologyRepository.ts:151 | INSERT | pathology_results | YES | N/A | — |
| 363 | pathology/pathologyRepository.ts:201 | UPDATE | pathology_results | YES | N/A | — |
| 364 | pathology/pathologyRepository.ts:215 | UPDATE | pathology_results | YES | N/A | — |
| 365 | patient-app/patientAppRoutes.ts:196 | UPDATE | (none) | YES | NO | — |
| 366 | patient-app/patientAppRoutes.ts:202 | INSERT | (none) | YES | NO | — |
| 367 | patient-app/patientAppRoutes.ts:311 | UPDATE | (none) | YES | NO | — |
| 368 | patient-app/patientAppRoutes.ts:313 | INSERT | (none) | YES | NO | — |
| 369 | patient-app/patientAppRoutes.ts:322 | UPDATE | (none) | YES | NO | — |
| 370 | patient-app/patientAppRoutes.ts:371 | UPDATE | (none) | NO | NO | — |
| 371 | patient-app/patientAppRoutes.ts:379 | UPDATE | (none) | NO | NO | — |
| 372 | patient-app/patientAppRoutes.ts:493 | INSERT | (none) | YES | NO | — |
| 373 | patient-app/patientAppRoutes.ts:539 | UPDATE | (none) | NO | NO | — |
| 374 | patient-app/patientAppRoutes.ts:544 | DELETE | (none) | NO | NO | — |
| 375 | patient-app/patientAppRoutes.ts:546 | DELETE | (none) | NO | NO | — |
| 376 | patient-app/patientAppRoutes.ts:570 | INSERT | (none) | YES | NO | — |
| 377 | patient-app/patientAppRoutes.ts:580 | DELETE | (none) | YES | NO | — |
| 378 | patient-app/patientAppRoutes.ts:582 | UPDATE | (none) | NO | NO | — |
| 379 | patient-app/patientAppRoutes.ts:605 | INSERT | (none) | YES | NO | — |
| 380 | patient-app/patientAppRoutes.ts:627 | UPDATE | (none) | YES | NO | — |
| 381 | patient-app/patientAppRoutes.ts:640 | UPDATE | (none) | NO | NO | — |
| 382 | patient-app/patientAppRoutes.ts:664 | INSERT | (none) | YES | NO | — |
| 383 | patient-app/patientAppRoutes.ts:677 | DELETE | (none) | NO | NO | — |
| 384 | patient-app/patientAppRoutes.ts:681 | UPDATE | (none) | NO | NO | — |
| 385 | patient-app/patientAppRoutes.ts:753 | INSERT | (none) | YES | NO | — |
| 386 | patient-app/patientAppRoutes.ts:792 | UPDATE | (none) | NO | NO | — |
| 387 | patient-app/patientAppRoutes.ts:831 | INSERT | (none) | YES | NO | — |
| 388 | patient-app/patientAppRoutes.ts:847 | UPDATE | (none) | NO | NO | — |
| 389 | patient-app/patientAppRoutes.ts:868 | INSERT | (none) | YES | NO | — |
| 390 | patient-app/patientAppRoutes.ts:882 | UPDATE | (none) | NO | NO | — |
| 391 | patient-app/patientAppRoutes.ts:932 | UPDATE | (none) | YES | NO | — |
| 392 | patient-app/patientAppRoutes.ts:944 | INSERT | (none) | YES | NO | — |
| 393 | patient-app/patientAppRoutes.ts:958 | DELETE | (none) | NO | NO | — |
| 394 | patient-app/patientAppRoutes.ts:966 | UPDATE | (none) | NO | YES | — |
| 395 | patient-app/patientAppRoutes.ts:1045 | UPDATE | (none) | NO | NO | — |
| 396 | patient-app/patientAppRoutes.ts:1051 | INSERT | (none) | YES | NO | — |
| 397 | patient-outreach/patientOutreachRepository.ts:94 | INSERT | patient_fcm_tokens | YES | NO | — |
| 398 | patient-outreach/patientOutreachRoutes.ts:87 | UPDATE | patients | YES | NO | — |
| 399 | patients/duplicateRoutes.ts:104 | INSERT | patients | YES | YES | — |
| 400 | patients/duplicateRoutes.ts:120 | UPDATE | patients | YES | NO | — |
| 401 | patients/duplicateRoutes.ts:134 | INSERT | patients | YES | NO | — |
| 402 | patients/patientController.ts:72 | UPDATE | (none) | NO | NO | — |
| 403 | patients/patientRepository.ts:127 | INSERT | (none) | YES | YES | — |
| 404 | patients/patientRepository.ts:136 | UPDATE | (none) | YES | NO | — |
| 405 | patients/patientRepository.ts:144 | UPDATE | (none) | YES | NO | — |
| 406 | patients/patientRoutes.ts:278 | UPDATE | patient_team_assignments | NO | NO | NO clinic_id |
| 407 | patients/patientRoutes.ts:414 | INSERT | episodes | YES | NO | — |
| 408 | patients/patientRoutes.ts:439 | DELETE | patient_attachments | NO | N/A | NO clinic_id |
| 409 | patients/patientRoutes.ts:481 | INSERT | patient_attachments | YES | N/A | — |
| 410 | patients/patientRoutes.ts:500 | DELETE | patient_attachments | NO | N/A | NO clinic_id |
| 411 | patients/patientRoutes.ts:562 | INSERT | staff_role_assignments | YES | NO | — |
| 412 | patients/patientRoutes.ts:592 | INSERT | (none) | YES | NO | — |
| 413 | patients/patientRoutes.ts:714 | INSERT | episodes | YES | YES | — |
| 414 | patients/patientRoutes.ts:777 | UPDATE | clinical_notes | YES | YES | — |
| 415 | patients/patientRoutes.ts:814 | UPDATE | patient_legal_orders | NO | N/A | NO clinic_id |
| 416 | patients/patientRoutes.ts:840 | INSERT | patient_legal_orders | YES | N/A | — |
| 417 | patients/patientRoutes.ts:860 | UPDATE | patient_legal_orders | YES | N/A | — |
| 418 | patients/patientRoutes.ts:876 | INSERT | patient_legal_orders | YES | N/A | — |
| 419 | patients/patientRoutes.ts:894 | DELETE | patient_legal_attachments | NO | NO | NO clinic_id; hard-delete risk |
| 420 | patients/patientRoutes.ts:963 | INSERT | patient_alert_attachments | YES | NO | — |
| 421 | patients/patientRoutes.ts:988 | UPDATE | patient_alerts | YES | N/A | — |
| 422 | patients/patientRoutes.ts:1003 | INSERT | patient_alerts | YES | N/A | — |
| 423 | patients/patientRoutes.ts:1019 | DELETE | patient_alert_attachments | NO | NO | NO clinic_id; hard-delete risk |
| 424 | patients/patientRoutes.ts:1073 | INSERT | hotspots | YES | N/A | — |
| 425 | patients/patientRoutes.ts:1080 | INSERT | episodes | YES | YES | — |
| 426 | patients/patientRoutes.ts:1095 | UPDATE | clinical_notes | YES | YES | — |
| 427 | patients/patientRoutes.ts:1099 | INSERT | episodes | YES | YES | — |
| 428 | patients/patientRoutes.ts:1152 | INSERT | admission_waitlist | YES | NO | — |
| 429 | patients/patientRoutes.ts:1173 | INSERT | episodes | YES | NO | — |
| 430 | patients/patientRoutes.ts:1206 | UPDATE | admission_waitlist | YES | NO | — |
| 431 | patients/patientRoutes.ts:1228 | UPDATE | admission_waitlist | YES | NO | — |
| 432 | patients/patientRoutes.ts:1233 | INSERT | episodes | YES | NO | — |
| 433 | patients/patientRoutes.ts:1259 | UPDATE | admission_waitlist | YES | NO | — |
| 434 | patients/patientRoutes.ts:1294 | INSERT | patient_contacts | YES | NO | — |
| 435 | patients/patientRoutes.ts:1328 | UPDATE | (none) | YES | YES | — |
| 436 | patients/patientRoutes.ts:1333 | DELETE | patient_contacts | YES | YES | — |
| 437 | patients/patientRoutes.ts:1335 | UPDATE | patient_contacts | YES | YES | — |
| 438 | patients/patientRoutes.ts:1387 | INSERT | patient_providers | YES | N/A | — |
| 439 | patients/patientRoutes.ts:1407 | DELETE | patient_providers | YES | N/A | — |
| 440 | patients/patientRoutes.ts:1409 | DELETE | patient_providers | YES | N/A | — |
| 441 | patients/patientRoutes.ts:1448 | DELETE | specialties | NO | NO | NO clinic_id; hard-delete risk |
| 442 | patients/patientService.ts:297 | UPDATE | (none) | NO | NO | — |
| 443 | patients/patientStatusRoutes.ts:52 | UPDATE | patients | YES | YES | — |
| 444 | patients/patientStatusRoutes.ts:68 | UPDATE | patients | YES | YES | — |
| 445 | patients/zitaviSyncRoutes.ts:77 | INSERT | patients | YES | NO | — |
| 446 | power-settings/powerSettingsRepository.ts:43 | INSERT | subscriber_branding | YES | NO | — |
| 447 | power-settings/powerSettingsRoutes.ts:196 | INSERT | (none) | YES | NO | — |
| 448 | power-settings/powerSettingsRoutes.ts:207 | DELETE | (none) | YES | NO | — |
| 449 | power-settings/powerSettingsRoutes.ts:257 | UPDATE | (none) | YES | NO | — |
| 450 | power-settings/powerSettingsRoutes.ts:261 | INSERT | (none) | YES | NO | — |
| 451 | prescriptions/prescriptionRepository.ts:107 | INSERT | prescriptions | YES | NO | — |
| 452 | prescriptions/prescriptionRepository.ts:177 | UPDATE | prescriptions | YES | YES | — |
| 453 | prescriptions/prescriptionRepository.ts:193 | UPDATE | prescriptions | YES | YES | — |
| 454 | prescriptions/prescriptionRepository.ts:214 | INSERT | erx_tokens | YES | NO | — |
| 455 | privacy/ndbNotification.ts:87 | INSERT | (none) | YES | NO | — |
| 456 | privacy/privacyRoutes.ts:156 | INSERT | consent_records | YES | NO | — |
| 457 | privacy/privacyRoutes.ts:197 | INSERT | data_breach_log | YES | NO | — |
| 458 | privacy/privacyRoutes.ts:236 | INSERT | data_sharing_agreements | YES | NO | — |
| 459 | provisioning/provisioningService.ts:144 | INSERT | (none) | NO | NO | — |
| 460 | provisioning/provisioningService.ts:170 | INSERT | clinics | YES | NO | — |
| 461 | provisioning/provisioningService.ts:192 | INSERT | staff | YES | NO | — |
| 462 | provisioning/provisioningService.ts:226 | INSERT | (none) | YES | NO | — |
| 463 | provisioning/provisioningService.ts:241 | INSERT | clinic_modules | YES | NO | — |
| 464 | provisioning/provisioningService.ts:257 | INSERT | professional_disciplines | YES | NO | — |
| 465 | provisioning/provisioningService.ts:276 | INSERT | clinical_roles | YES | NO | — |
| 466 | provisioning/provisioningService.ts:283 | INSERT | referral_sources | YES | NO | — |
| 467 | provisioning/provisioningService.ts:298 | INSERT | referral_sources | YES | NO | — |
| 468 | provisioning/provisioningService.ts:319 | INSERT | template_categories | YES | NO | — |
| 469 | provisioning/provisioningService.ts:337 | INSERT | appointment_modes | YES | NO | — |
| 470 | provisioning/provisioningService.ts:362 | INSERT | templates | YES | NO | — |
| 471 | provisioning/provisioningService.ts:385 | INSERT | clinical_templates | YES | NO | — |
| 472 | provisioning/provisioningService.ts:408 | INSERT | org_level_labels | YES | NO | — |
| 473 | provisioning/provisioningService.ts:417 | INSERT | org_level_labels | YES | NO | — |
| 474 | provisioning/provisioningService.ts:439 | INSERT | org_units | YES | NO | — |
| 475 | reallocations/reallocationService.ts:191 | INSERT | patient_team_assignments | YES | NO | — |
| 476 | reallocations/reallocationService.ts:266 | UPDATE | patient_team_assignments | YES | NO | — |
| 477 | reallocations/reallocationService.ts:276 | INSERT | patient_team_assignments | YES | NO | — |
| 478 | reallocations/reallocationService.ts:293 | UPDATE | patient_team_assignments | YES | NO | — |
| 479 | reallocations/reallocationService.ts:391 | UPDATE | (none) | YES | NO | — |
| 480 | referrals/referralRepository.ts:180 | INSERT | (none) | NO | NO | — |
| 481 | referrals/referralRepository.ts:193 | UPDATE | (none) | YES | YES | — |
| 482 | referrals/referralRepository.ts:270 | INSERT | (none) | NO | NO | — |
| 483 | referrals/referralRepository.ts:304 | UPDATE | (none) | YES | YES | — |
| 484 | referrals/referralRepository.ts:319 | INSERT | (none) | YES | NO | — |
| 485 | referrals/referralRepository.ts:348 | INSERT | referral_workflow_events | NO | NO | — |
| 486 | referrals/referralRepository.ts:372 | UPDATE | (none) | NO | NO | — |
| 487 | referrals/referralRepository.ts:385 | UPDATE | referral_clinician_offers | NO | NO | NO clinic_id |
| 488 | referrals/referralRepository.ts:482 | INSERT | (none) | NO | NO | — |
| 489 | referrals/referralRepository.ts:638 | UPDATE | (none) | YES | NO | — |
| 490 | referrals/referralRepository.ts:646 | INSERT | (none) | YES | NO | — |
| 491 | referrals/referralRoutes.ts:154 | INSERT | referrals | YES | YES | — |
| 492 | referrals/referralRoutes.ts:205 | UPDATE | (none) | NO | NO | — |
| 493 | referrals/referralRoutes.ts:219 | UPDATE | referrals | YES | NO | — |
| 494 | referrals/referralRoutes.ts:261 | UPDATE | episodes | YES | NO | — |
| 495 | referrals/referralRoutes.ts:279 | INSERT | patient_team_assignments | YES | NO | — |
| 496 | referrals/referralRoutes.ts:303 | INSERT | clinical_roles | YES | NO | — |
| 497 | referrals/referralService.ts:212 | INSERT | (none) | YES | NO | — |
| 498 | referrals/referralService.ts:250 | UPDATE | (none) | YES | NO | — |
| 499 | reports/reportsRepository.ts:170 | INSERT | (none) | YES | NO | — |
| 500 | reports/reportsRoutes.ts:482 | INSERT | audit_templates | YES | NO | — |
| 501 | reports/reportsRoutes.ts:529 | INSERT | episodes | YES | NO | — |
| 502 | reports/reportsRoutes.ts:564 | UPDATE | (none) | NO | NO | — |
| 503 | reports/reportsRoutes.ts:568 | UPDATE | audit_runs | NO | NO | NO clinic_id |
| 504 | risk/risk.routes.ts:68 | DELETE | (none) | NO | NO | — |
| 505 | risk/riskRepository.ts:80 | INSERT | (none) | YES | NO | — |
| 506 | risk/riskRepository.ts:142 | UPDATE | risk_assessments | YES | YES | — |
| 507 | roles/caseManagerFeatureRoutes.ts:166 | INSERT | care_plan_goals | YES | NO | — |
| 508 | roles/caseManagerFeatureRoutes.ts:212 | UPDATE | care_plan_goals | YES | NO | — |
| 509 | roles/caseManagerFeatureRoutes.ts:222 | DELETE | care_plan_goals | NO | NO | NO clinic_id; hard-delete risk |
| 510 | roles/caseManagerFeatureRoutes.ts:264 | INSERT | care_plan_interventions | YES | NO | — |
| 511 | roles/caseManagerFeatureRoutes.ts:310 | UPDATE | care_plan_interventions | YES | NO | — |
| 512 | roles/caseManagerFeatureRoutes.ts:320 | DELETE | care_plan_interventions | NO | NO | NO clinic_id; hard-delete risk |
| 513 | roles/caseManagerFeatureRoutes.ts:380 | UPDATE | care_plans | YES | NO | — |
| 514 | roles/caseManagerFeatureRoutes.ts:429 | UPDATE | care_plans | YES | NO | — |
| 515 | roles/caseManagerFeatureRoutes.ts:484 | INSERT | community_resources | YES | NO | — |
| 516 | roles/caseManagerFeatureRoutes.ts:541 | UPDATE | community_resources | YES | NO | — |
| 517 | roles/caseManagerFeatureRoutes.ts:551 | DELETE | community_resources | NO | NO | NO clinic_id; hard-delete risk |
| 518 | roles/crossRoleFeatureRoutes.ts:292 | UPDATE | patients | YES | NO | — |
| 519 | roles/crossRoleFeatureRoutes.ts:297 | DELETE | patients | YES | NO | hard-delete risk |
| 520 | roles/managerFeatureRoutes.ts:326 | INSERT | staff_leave | YES | NO | — |
| 521 | roles/managerFeatureRoutes.ts:368 | UPDATE | staff_leave | YES | NO | — |
| 522 | roles/managerFeatureRoutes.ts:378 | DELETE | staff_leave | NO | NO | NO clinic_id; hard-delete risk |
| 523 | roles/managerFeatureRoutes.ts:419 | INSERT | report_schedules | YES | NO | — |
| 524 | roles/managerFeatureRoutes.ts:463 | UPDATE | report_schedules | YES | NO | — |
| 525 | roles/managerFeatureRoutes.ts:473 | DELETE | report_schedules | NO | NO | NO clinic_id; hard-delete risk |
| 526 | roles/nurseFeatureRoutes.ts:152 | INSERT | medication_administrations | YES | NO | — |
| 527 | roles/nurseFeatureRoutes.ts:264 | INSERT | structured_observations | YES | N/A | — |
| 528 | roles/nurseFeatureRoutes.ts:328 | UPDATE | structured_observations | YES | N/A | — |
| 529 | roles/nurseFeatureRoutes.ts:338 | DELETE | structured_observations | NO | N/A | NO clinic_id |
| 530 | roles/nurseFeatureRoutes.ts:477 | INSERT | shift_handovers | YES | NO | — |
| 531 | roles/nurseFeatureRoutes.ts:525 | UPDATE | shift_handovers | YES | NO | — |
| 532 | roles/nurseFeatureRoutes.ts:535 | DELETE | shift_handovers | NO | NO | NO clinic_id; hard-delete risk |
| 533 | roles/nurseFeatureRoutes.ts:596 | INSERT | nursing_assessments | YES | YES | — |
| 534 | roles/nurseFeatureRoutes.ts:646 | UPDATE | nursing_assessments | YES | NO | — |
| 535 | roles/nurseFeatureRoutes.ts:656 | DELETE | nursing_assessments | NO | NO | NO clinic_id; hard-delete risk |
| 536 | roles/nurseFeatureRoutes.ts:712 | UPDATE | phone_triage | YES | NO | — |
| 537 | roles/psychiatristFeatureRoutes.ts:275 | INSERT | clinical_formulations | YES | NO | — |
| 538 | roles/psychiatristFeatureRoutes.ts:349 | UPDATE | clinical_formulations | YES | NO | — |
| 539 | roles/psychiatristFeatureRoutes.ts:359 | DELETE | clinical_formulations | NO | NO | NO clinic_id; hard-delete risk |
| 540 | roles/psychiatristFeatureRoutes.ts:420 | INSERT | side_effect_schedules | YES | NO | — |
| 541 | roles/psychiatristFeatureRoutes.ts:463 | UPDATE | side_effect_schedules | YES | NO | — |
| 542 | roles/psychiatristFeatureRoutes.ts:473 | DELETE | side_effect_schedules | NO | NO | NO clinic_id; hard-delete risk |
| 543 | roles/psychiatristFeatureRoutes.ts:530 | INSERT | clinical_notes | YES | NO | — |
| 544 | roles/psychologistFeatureRoutes.ts:133 | INSERT | psychology_session_notes | YES | NO | — |
| 545 | roles/psychologistFeatureRoutes.ts:186 | UPDATE | psychology_session_notes | YES | NO | — |
| 546 | roles/psychologistFeatureRoutes.ts:196 | DELETE | psychology_session_notes | NO | NO | NO clinic_id; hard-delete risk |
| 547 | roles/psychologistFeatureRoutes.ts:216 | UPDATE | psychology_session_notes | YES | YES | — |
| 548 | roles/receptionistFeatureRoutes.ts:119 | UPDATE | appointments | YES | NO | — |
| 549 | roles/receptionistFeatureRoutes.ts:146 | INSERT | patients | YES | NO | — |
| 550 | roles/receptionistFeatureRoutes.ts:237 | INSERT | phone_triage | YES | NO | — |
| 551 | roles/receptionistFeatureRoutes.ts:280 | UPDATE | phone_triage | YES | NO | — |
| 552 | roles/receptionistFeatureRoutes.ts:290 | DELETE | phone_triage | NO | NO | NO clinic_id; hard-delete risk |
| 553 | safety-plan/safetyPlanRoutes.ts:73 | INSERT | (none) | YES | NO | — |
| 554 | safety-plan/safetyPlanRoutes.ts:110 | UPDATE | safety_plans | YES | NO | — |
| 555 | safety-plan/safetyPlanRoutes.ts:131 | UPDATE | safety_plans | YES | NO | — |
| 556 | settings/settingsRepository.ts:25 | INSERT | clinic_thresholds | YES | NO | — |
| 557 | settings/settingsService.ts:34 | INSERT | clinic_thresholds | YES | NO | — |
| 558 | settings/tabConfigRoutes.ts:51 | INSERT | clinic_tab_config | YES | NO | — |
| 559 | staff-settings/staffSettingsRepository.ts:49 | INSERT | professional_disciplines | YES | NO | — |
| 560 | staff-settings/staffSettingsRepository.ts:55 | UPDATE | professional_disciplines | YES | NO | — |
| 561 | staff-settings/staffSettingsRepository.ts:60 | DELETE | professional_disciplines | NO | NO | NO clinic_id; hard-delete risk |
| 562 | staff-settings/staffSettingsRepository.ts:75 | INSERT | clinical_roles | YES | NO | — |
| 563 | staff-settings/staffSettingsRepository.ts:81 | UPDATE | clinical_roles | YES | NO | — |
| 564 | staff-settings/staffSettingsRepository.ts:86 | DELETE | clinical_roles | NO | NO | NO clinic_id; hard-delete risk |
| 565 | staff-settings/staffSettingsRepository.ts:118 | INSERT | staff_team_assignments | NO | NO | — |
| 566 | staff-settings/staffSettingsRepository.ts:124 | UPDATE | staff_team_assignments | NO | NO | NO clinic_id |
| 567 | staff-settings/staffSettingsRepository.ts:129 | DELETE | staff_team_assignments | NO | NO | NO clinic_id; hard-delete risk |
| 568 | staff-settings/staffSettingsRepository.ts:166 | INSERT | staff_role_assignments | NO | NO | — |
| 569 | staff-settings/staffSettingsRepository.ts:176 | UPDATE | staff_role_assignments | NO | NO | NO clinic_id |
| 570 | staff-settings/staffSettingsRepository.ts:181 | DELETE | staff_role_assignments | NO | NO | NO clinic_id; hard-delete risk |
| 571 | staff-settings/staffSettingsRepository.ts:196 | INSERT | referral_sources | YES | NO | — |
| 572 | staff-settings/staffSettingsRepository.ts:202 | UPDATE | referral_sources | YES | NO | — |
| 573 | staff-settings/staffSettingsRepository.ts:207 | DELETE | referral_sources | NO | NO | NO clinic_id; hard-delete risk |
| 574 | staff-settings/staffSettingsRepository.ts:222 | INSERT | investigation_types | YES | NO | — |
| 575 | staff-settings/staffSettingsRepository.ts:228 | UPDATE | investigation_types | YES | NO | — |
| 576 | staff-settings/staffSettingsRepository.ts:233 | DELETE | investigation_types | NO | NO | NO clinic_id; hard-delete risk |
| 577 | staff-settings/staffSettingsRoutes.ts:93 | DELETE | (none) | NO | NO | — |
| 578 | staff-settings/staffSettingsRoutes.ts:99 | DELETE | (none) | NO | NO | — |
| 579 | staff-settings/staffSettingsRoutes.ts:105 | DELETE | (none) | NO | NO | — |
| 580 | staff-settings/staffSettingsRoutes.ts:111 | DELETE | (none) | NO | NO | — |
| 581 | staff-settings/staffSettingsRoutes.ts:117 | DELETE | (none) | NO | NO | — |
| 582 | staff-settings/staffSettingsRoutes.ts:123 | DELETE | (none) | NO | NO | — |
| 583 | staff-settings/staffSettingsRoutes.ts:137 | INSERT | alert_types | YES | NO | — |
| 584 | staff-settings/staffSettingsRoutes.ts:155 | UPDATE | alert_types | YES | NO | — |
| 585 | staff-settings/staffSettingsRoutes.ts:159 | DELETE | alert_types | YES | NO | hard-delete risk |
| 586 | staff-settings/staffSettingsRoutes.ts:162 | DELETE | alert_types | YES | NO | hard-delete risk |
| 587 | staff-settings/staffSettingsRoutes.ts:172 | INSERT | legal_order_type_configs | YES | NO | — |
| 588 | staff-settings/staffSettingsRoutes.ts:175 | UPDATE | legal_order_type_configs | YES | NO | — |
| 589 | staff-settings/staffSettingsRoutes.ts:177 | DELETE | legal_order_type_configs | YES | NO | hard-delete risk |
| 590 | staff-settings/staffSettingsRoutes.ts:178 | DELETE | legal_order_type_configs | YES | NO | hard-delete risk |
| 591 | staff-settings/staffSettingsRoutes.ts:186 | INSERT | appointment_modes | YES | NO | — |
| 592 | staff-settings/staffSettingsRoutes.ts:189 | UPDATE | appointment_modes | YES | NO | — |
| 593 | staff-settings/staffSettingsRoutes.ts:191 | DELETE | appointment_modes | YES | NO | hard-delete risk |
| 594 | staff-settings/staffSettingsRoutes.ts:192 | DELETE | appointment_modes | YES | NO | hard-delete risk |
| 595 | staff-settings/staffSettingsRoutes.ts:200 | INSERT | template_categories | YES | NO | — |
| 596 | staff-settings/staffSettingsRoutes.ts:212 | UPDATE | template_categories | YES | NO | — |
| 597 | staff-settings/staffSettingsRoutes.ts:218 | DELETE | template_categories | YES | NO | hard-delete risk |
| 598 | staff-settings/staffSettingsRoutes.ts:219 | DELETE | template_categories | YES | NO | hard-delete risk |
| 599 | staff-settings/staffSettingsRoutes.ts:238 | INSERT | clinical_templates | YES | NO | — |
| 600 | staff-settings/staffSettingsRoutes.ts:242 | DELETE | clinical_templates | YES | NO | hard-delete risk |
| 601 | staff-settings/staffSettingsRoutes.ts:243 | DELETE | clinical_templates | YES | NO | hard-delete risk |
| 602 | staff-settings/staffSettingsRoutes.ts:394 | INSERT | staff_module_access | YES | NO | — |
| 603 | staff-settings/staffSettingsRoutes.ts:423 | DELETE | (none) | NO | NO | — |
| 604 | staff-settings/staffSettingsRoutes.ts:454 | DELETE | staff_module_access | YES | NO | hard-delete risk |
| 605 | staff-settings/staffSettingsRoutes.ts:528 | INSERT | episode_types | YES | NO | — |
| 606 | staff-settings/staffSettingsRoutes.ts:531 | UPDATE | episode_types | YES | NO | — |
| 607 | staff-settings/staffSettingsRoutes.ts:533 | DELETE | episode_types | YES | NO | hard-delete risk |
| 608 | staff-settings/staffSettingsRoutes.ts:534 | DELETE | episode_types | YES | NO | hard-delete risk |
| 609 | staff-settings/staffSettingsRoutes.ts:663 | INSERT | clinic_contact_options | YES | NO | — |
| 610 | staff-settings/staffSettingsRoutes.ts:695 | UPDATE | episodes | YES | NO | — |
| 611 | staff-settings/staffSettingsRoutes.ts:699 | UPDATE | episodes | YES | NO | — |
| 612 | staff-settings/staffSettingsRoutes.ts:774 | INSERT | planned_transition_assignments as a | YES | NO | — |
| 613 | staff-settings/staffSettingsRoutes.ts:786 | INSERT | planned_transitions | NO | NO | — |
| 614 | staff-settings/staffSettingsRoutes.ts:812 | UPDATE | planned_transition_assignments | YES | NO | — |
| 615 | staff-settings/staffSettingsRoutes.ts:818 | INSERT | planned_transition_assignments | YES | NO | — |
| 616 | staff-settings/staffSettingsRoutes.ts:851 | UPDATE | episodes | YES | NO | — |
| 617 | staff-settings/staffSettingsRoutes.ts:854 | UPDATE | episodes | YES | NO | — |
| 618 | staff-settings/staffSettingsRoutes.ts:859 | UPDATE | planned_transition_assignments | YES | NO | — |
| 619 | staff-settings/staffSettingsRoutes.ts:866 | DELETE | planned_transitions | YES | NO | — |
| 620 | staff-settings/staffSettingsRoutes.ts:869 | UPDATE | planned_transitions | YES | NO | — |
| 621 | staff-settings/staffSettingsRoutes.ts:883 | INSERT | clinical_policies | YES | NO | — |
| 622 | staff-settings/staffSettingsRoutes.ts:907 | UPDATE | clinical_policies | YES | NO | — |
| 623 | staff-settings/staffSettingsRoutes.ts:911 | DELETE | clinical_policies | YES | NO | hard-delete risk |
| 624 | staff-settings/staffSettingsRoutes.ts:912 | DELETE | clinical_policies | YES | NO | hard-delete risk |
| 625 | staff-settings/staffSettingsRoutes.ts:950 | INSERT | ai_training_feedback | YES | NO | — |
| 626 | staff-settings/staffSettingsRoutes.ts:962 | INSERT | ai_context_files | YES | NO | — |
| 627 | staff-settings/staffSettingsRoutes.ts:984 | INSERT | clinical_policies | YES | NO | — |
| 628 | staff-settings/staffSettingsRoutes.ts:1019 | UPDATE | (none) | YES | NO | — |
| 629 | staff-settings/staffSettingsRoutes.ts:1024 | DELETE | ai_context_files | YES | NO | hard-delete risk |
| 630 | staff-settings/staffSettingsRoutes.ts:1027 | DELETE | ai_context_files | YES | NO | hard-delete risk |
| 631 | staff/staffRepository.ts:78 | UPDATE | (none) | YES | NO | — |
| 632 | staff/staffRepository.ts:104 | INSERT | (none) | YES | NO | — |
| 633 | staff/staffRepository.ts:123 | UPDATE | (none) | YES | NO | — |
| 634 | staff/staffRepository.ts:133 | UPDATE | (none) | NO | NO | — |
| 635 | staff/staffRepository.ts:139 | UPDATE | (none) | NO | NO | — |
| 636 | staff/staffRepository.ts:143 | UPDATE | (none) | NO | NO | — |
| 637 | staff/staffRepository.ts:147 | UPDATE | (none) | NO | NO | — |
| 638 | staff/staffRepository.ts:151 | UPDATE | (none) | NO | NO | — |
| 639 | staff/staffRepository.ts:155 | UPDATE | (none) | NO | NO | — |
| 640 | staff/staffRepository.ts:231 | DELETE | staff_specialties | YES | YES | — |
| 641 | staff/staffRepository.ts:235 | INSERT | staff_specialties | YES | YES | — |
| 642 | staff/staffRoutes.ts:134 | UPDATE | (none) | YES | YES | — |
| 643 | staff/staffRoutes.ts:178 | UPDATE | (none) | YES | NO | — |
| 644 | staff/staffService.ts:123 | INSERT | (none) | YES | NO | — |
| 645 | staff/staffService.ts:193 | UPDATE | (none) | NO | NO | — |
| 646 | surgery/surgeryRepositories.ts:85 | INSERT | surgical_cases as c | YES | YES | — |
| 647 | surgery/surgeryRepositories.ts:145 | INSERT | safety_checklists | YES | NO | — |
| 648 | surgery/surgeryRepositories.ts:209 | INSERT | op_notes as n | YES | NO | — |
| 649 | surgery/surgeryRepositories.ts:274 | INSERT | pacu_records as p | YES | NO | — |
| 650 | tasks/taskRepository.ts:18 | INSERT | tasks | YES | NO | — |
| 651 | tasks/taskRepository.ts:103 | UPDATE | tasks | YES | NO | — |
| 652 | tasks/taskRepository.ts:114 | DELETE | tasks | YES | NO | — |
| 653 | tasks/taskRoutes.ts:17 | DELETE | (none) | NO | NO | — |
| 654 | tasks/taskService.ts:104 | UPDATE | (none) | NO | NO | — |
| 655 | telehealth/telehealthRoutes.ts:52 | UPDATE | appointments | YES | NO | — |
| 656 | templates/template.controller.ts:53 | UPDATE | (none) | NO | NO | — |
| 657 | templates/template.repository.ts:122 | INSERT | templates | YES | NO | — |
| 658 | templates/template.repository.ts:134 | INSERT | templates | NO | NO | — |
| 659 | templates/template.repository.ts:171 | UPDATE | (none) | YES | NO | — |
| 660 | templates/template.repository.ts:174 | DELETE | templates | YES | NO | hard-delete risk |
| 661 | templates/template.repository.ts:177 | INSERT | template_sections | YES | NO | — |
| 662 | templates/template.repository.ts:204 | UPDATE | template_sections | YES | YES | — |
| 663 | templates/template.repository.ts:214 | UPDATE | templates | YES | YES | — |
| 664 | templates/template.routes.ts:20 | DELETE | (none) | NO | NO | — |
| 665 | templates/template.service.ts:46 | UPDATE | (none) | NO | NO | — |
| 666 | tms/tmsService.ts:76 | INSERT | tms_courses | YES | NO | — |
| 667 | tms/tmsService.ts:151 | UPDATE | tms_courses | YES | NO | — |
| 668 | tms/tmsService.ts:155 | INSERT | tms_sessions | YES | NO | — |
| 669 | treatment-pathways/pathwayRoutes.ts:84 | INSERT | (none) | YES | NO | — |
| 670 | treatment-pathways/pathwayRoutes.ts:126 | UPDATE | treatment_pathways | YES | N/A | — |
| 671 | treatment-pathways/pathwayRoutes.ts:141 | UPDATE | treatment_pathways | YES | N/A | — |
| 672 | voice/voiceRepository.ts:128 | INSERT | voice_calls | NO | NO | — |
| 673 | voice/voiceRepository.ts:165 | UPDATE | voice_calls | YES | YES | — |
| 674 | voice/voiceRepository.ts:174 | UPDATE | voice_calls | YES | YES | — |
| 675 | voice/voiceRepository.ts:183 | INSERT | voice_scripts | NO | YES | — |
| 676 | voice/voiceRepository.ts:217 | UPDATE | voice_scripts | YES | NO | — |
| 677 | voice/voiceRepository.ts:240 | UPDATE | voice_patient_preferences | YES | NO | — |
| 678 | voice/voiceRepository.ts:246 | INSERT | voice_patient_preferences | YES | NO | — |
| 679 | webhooks/webhookRoutes.ts:101 | INSERT | (none) | YES | NO | — |
| 680 | webhooks/webhookRoutes.ts:311 | INSERT | (none) | YES | NO | — |
| 681 | webhooks/webhookRoutes.ts:346 | UPDATE | (none) | YES | NO | — |
| 682 | webhooks/webhookRoutes.ts:356 | DELETE | (none) | YES | NO | — |
| 683 | webhooks/webhookRoutes.ts:360 | UPDATE | webhook_secrets | YES | NO | — |
| 684 | webhooks/webhookVerifier.ts:18 | UPDATE | (none) | NO | NO | — |
| 685 | webhooks/webhookVerifier.ts:38 | UPDATE | (none) | NO | NO | — |
| 686 | workflows/workflowEngine.ts:26 | INSERT | (none) | YES | NO | — |
| 687 | workflows/workflowEngine.ts:46 | INSERT | tasks | YES | NO | — |
| 688 | workflows/workflowEngine.ts:65 | INSERT | patient_team_assignments | YES | NO | — |
| 689 | workflows/workflowEngine.ts:83 | INSERT | patient_team_assignments | YES | NO | — |
| 690 | workflows/workflowEngine.ts:103 | INSERT | patient_flags | YES | NO | — |
| 691 | workflows/workflowEngine.ts:123 | UPDATE | notifications | YES | NO | — |
| 692 | workflows/workflowEngine.ts:139 | INSERT | checklist_templates | YES | NO | — |
| 693 | workflows/workflowEngine.ts:156 | INSERT | checklist_instances | YES | NO | — |
| 694 | workflows/workflowEngine.ts:190 | INSERT | (none) | YES | NO | — |
| 695 | workflows/workflowEngine.ts:211 | UPDATE | workflow_executions | YES | NO | — |
| 696 | workflows/workflowEngine.ts:223 | UPDATE | workflow_executions | YES | NO | — |
| 697 | workflows/workflowRoutes.ts:73 | INSERT | workflows | YES | NO | — |
| 698 | workflows/workflowRoutes.ts:104 | UPDATE | workflows | YES | YES | — |
| 699 | workflows/workflowRoutes.ts:112 | DELETE | workflows | YES | YES | — |
| 700 | workflows/workflowRoutes.ts:116 | UPDATE | workflows | YES | NO | — |
| 701 | evidence/evidenceClient.ts:73 | DELETE | (none) | NO | NO | — |
| 702 | fcm/fcmService.ts:26 | UPDATE | staff_fcm_tokens | YES | NO | — |
| 703 | fcm/fcmService.ts:34 | UPDATE | patient_fcm_tokens | YES | NO | — |
| 704 | fhir/bulkExportWorker.ts:204 | UPDATE | fhir_bulk_export_jobs | NO | NO | NO clinic_id |
| 705 | fhir/bulkExportWorker.ts:242 | UPDATE | fhir_bulk_export_jobs | NO | NO | NO clinic_id |
| 706 | fhir/bulkExportWorker.ts:248 | UPDATE | fhir_bulk_export_jobs | NO | NO | NO clinic_id |
| 707 | fhir/bulkExportWorker.ts:259 | UPDATE | fhir_bulk_export_jobs | NO | NO | NO clinic_id |
| 708 | fhir/fhirRoutes.ts:356 | INSERT | (none) | YES | NO | — |
| 709 | fhir/fhirRoutes.ts:397 | INSERT | (none) | YES | NO | — |
| 710 | fhir/fhirRoutes.ts:514 | INSERT | (none) | YES | NO | — |
| 711 | fhir/fhirRoutes.ts:548 | UPDATE | fhir_bulk_export_jobs | NO | NO | NO clinic_id |
| 712 | fhir/fhirRoutes.ts:632 | DELETE | (none) | NO | NO | — |
| 713 | fhir/fhirRoutes.ts:640 | UPDATE | (none) | YES | NO | — |
| 714 | fhir/fhirSubscription.ts:82 | INSERT | (none) | YES | NO | — |
| 715 | fhir/fhirSubscription.ts:106 | DELETE | fhir_subscriptions | YES | NO | hard-delete risk |
| 716 | fhir/fhirSubscription.ts:110 | UPDATE | fhir_subscriptions | YES | NO | — |
| 717 | fhir/smartAppRegistry.ts:40 | UPDATE | (none) | NO | NO | — |
| 718 | fhir/smartAppRegistry.ts:104 | INSERT | (none) | YES | NO | — |
| 719 | fhir/smartAppRegistry.ts:155 | UPDATE | smart_apps | YES | NO | — |
| 720 | fhir/smartAppRegistry.ts:165 | DELETE | smart_apps | YES | NO | hard-delete risk |
| 721 | fhir/smartAppRegistry.ts:170 | UPDATE | smart_apps | YES | NO | — |
| 722 | fhir/smartAppRegistry.ts:195 | INSERT | smart_apps | YES | NO | — |
| 723 | fhir/smartAuth.ts:53 | UPDATE | (none) | NO | NO | — |
| 724 | fhir/smartAuth.ts:78 | UPDATE | (none) | NO | NO | — |
| 725 | fhir/smartAuth.ts:212 | UPDATE | smart_launch_contexts | NO | NO | NO clinic_id |
| 726 | fhir/smartAuth.ts:225 | INSERT | smart_launch_contexts | YES | NO | — |
| 727 | fhir/smartAuth.ts:341 | UPDATE | oauth_access_tokens | NO | NO | NO clinic_id |
| 728 | fhir/smartAuth.ts:358 | UPDATE | oauth_access_tokens | YES | NO | — |
| 729 | fhir/smartAuth.ts:390 | UPDATE | oauth_refresh_tokens | NO | NO | NO clinic_id |
| 730 | fhir/smartAuth.ts:420 | UPDATE | oauth_refresh_tokens | NO | NO | NO clinic_id |
| 731 | fhir/smartAuth.ts:461 | INSERT | (none) | YES | NO | — |
| 732 | fhir/smartAuth.ts:482 | INSERT | oauth_access_tokens | YES | NO | — |
| 733 | fhir/smartAuth.ts:573 | UPDATE | oauth_refresh_tokens | NO | NO | NO clinic_id |
| 734 | fhir/smartAuth.ts:580 | UPDATE | oauth_access_tokens | NO | NO | NO clinic_id |
| 735 | fhir/smartAuth.ts:586 | UPDATE | oauth_refresh_tokens | NO | NO | NO clinic_id |
| 736 | outlook/office365Service.ts:35 | UPDATE | staff | NO | NO | NO clinic_id |
| 737 | outlook/outlookCalendarService.ts:55 | UPDATE | staff | NO | NO | NO clinic_id |
| 738 | outlook/outlookCalendarService.ts:137 | DELETE | (none) | NO | NO | — |
| 739 | outlook/outlookEmailService.ts:58 | UPDATE | staff | NO | NO | NO clinic_id |
| 740 | outlook/outlookRoutes.ts:65 | UPDATE | staff | NO | NO | NO clinic_id |
| 741 | outlook/outlookRoutes.ts:79 | DELETE | staff | NO | NO | NO clinic_id; hard-delete risk |
| 742 | outlook/outlookRoutes.ts:84 | UPDATE | staff | NO | NO | NO clinic_id |
| 743 | pathology/resultNotifier.ts:67 | INSERT | episodes | YES | NO | — |
| 744 | schedulers/appointmentReminderScheduler.ts:78 | UPDATE | appointments | YES | NO | — |
| 745 | schedulers/referralSlaScheduler.ts:130 | UPDATE | referral_clinician_offers | YES | NO | — |
| 746 | workers/aiWorker.ts:155 | INSERT | (none) | YES | NO | — |
| 747 | workers/aiWorker.ts:160 | UPDATE | (none) | YES | NO | — |
| 748 | workers/outlookWorker.ts:41 | UPDATE | appointments | YES | NO | — |
| 749 | workers/sessionCleanupWorker.ts:40 | DELETE | (none) | NO | NO | — |
| 750 | workers/sessionCleanupWorker.ts:46 | DELETE | (none) | NO | NO | — |
| 751 | server/mcpServer.ts:204 | INSERT | clinical_notes | YES | YES | — |
| 752 | strategies/teamStrategy.ts:290 | UPDATE | referrals | YES | NO | — |
| 753 | strategies/teamStrategy.ts:304 | INSERT | referrals | YES | NO | — |
| 754 | repositories/BaseRepository.ts:24 | UPDATE | (none) | YES | YES | — |
| 755 | mcp/ambientProcessor.ts:503 | INSERT | (none) | YES | NO | — |
| 756 | mcp/scribeEnhancements.ts:1101 | INSERT | staff_settings | NO | NO | — |
| 757 | mcp/scribeStreaming.ts:75 | DELETE | (none) | NO | NO | — |
| 758 | mcp/scribeStreaming.ts:136 | DELETE | (none) | NO | NO | — |
| 759 | mcp/scribeStreaming.ts:214 | DELETE | (none) | NO | NO | — |
| 760 | mcp/trainingPipeline.ts:65 | INSERT | (none) | YES | NO | — |
| 761 | mcp/trainingPipeline.ts:79 | INSERT | llm_interactions | YES | NO | — |
| 762 | middleware/breakGlassAuditMiddleware.ts:63 | UPDATE | (none) | NO | NO | — |
| 763 | middleware/breakGlassAuditMiddleware.ts:78 | UPDATE | (none) | NO | NO | — |
| 764 | middleware/forbiddenAccessAudit.ts:52 | INSERT | (none) | YES | NO | — |
| 765 | middleware/hmacSigning.ts:70 | UPDATE | (none) | NO | NO | — |
| 766 | middleware/patientAccessAudit.ts:119 | INSERT | (none) | YES | NO | — |
| 767 | middleware/patientAccessAudit.ts:175 | INSERT | (none) | YES | NO | — |
| 768 | middleware/superadminGuard.ts:53 | INSERT | audit_log | YES | NO | — |
| 769 | middleware/superadminGuard.ts:75 | INSERT | audit_log | YES | NO | — |
| 770 | shared/blindIndex.ts:101 | UPDATE | (none) | NO | NO | — |
| 771 | shared/blobStorage.ts:125 | UPDATE | (none) | NO | NO | — |
| 772 | shared/blobStorage.ts:346 | UPDATE | (none) | NO | NO | — |
| 773 | shared/featureFlags.ts:63 | DELETE | (none) | NO | NO | — |
| 774 | shared/featureFlags.ts:82 | DELETE | (none) | NO | NO | — |
| 775 | shared/featureFlags.ts:224 | UPDATE | (none) | YES | NO | — |
| 776 | shared/featureFlags.ts:231 | INSERT | feature_flags | YES | NO | — |
| 777 | shared/featureFlags.ts:241 | INSERT | feature_flags | YES | NO | — |
| 778 | shared/featureFlags.ts:263 | DELETE | feature_flags | YES | NO | hard-delete risk |
| 779 | shared/phiEncryption.ts:57 | UPDATE | (none) | NO | NO | — |
| 780 | shared/phiEncryption.ts:83 | UPDATE | (none) | NO | NO | — |
| 781 | utils/audit.ts:140 | INSERT | (none) | YES | NO | — |
| 782 | utils/audit.ts:144 | INSERT | (none) | YES | NO | — |
| 783 | utils/phiEncryption.ts:37 | UPDATE | (none) | NO | NO | — |
| 784 | utils/phiEncryption.ts:58 | UPDATE | (none) | NO | NO | — |
