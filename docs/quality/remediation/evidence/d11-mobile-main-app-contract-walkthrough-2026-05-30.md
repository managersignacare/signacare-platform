# D11 Mobile ↔ Main App Contract Walkthrough (Sara + Viva)

**Date:** 2026-05-30  
**Scope:** `apps/mobile` (Sara), `apps/patient-app` (Viva), backend route coverage, two-way exchange integration proof.

## 1) Contract Coverage Guards

- `npm run -s guard:dart-route-contract` -> ✅
  - backend catalog: `956 routes`, `113 router prefixes`
  - dart calls: `97 api call sites`
  - allowlist: `0`
- `bash scripts/guards/check-dart-api-calls.sh` -> ✅
  - paths scanned: `97`
  - violations: `0`

## 2) Enumerated API Calls (Viva)

Source command:
`rg -n --pcre2 "\\bpApi\\.(get|post|put|patch|delete)\\('([^']+)'" apps/patient-app/lib -or '$1 $2' | sort -u`

```text
apps/patient-app/lib/core/services/auth_service.dart:41:get /auth/me
apps/patient-app/lib/core/services/auth_service.dart:70:post /auth/logout
apps/patient-app/lib/core/services/fcm_service.dart:170:delete /patient-app/fcm/register-device/${Uri.encodeComponent(_currentToken!)}
apps/patient-app/lib/core/services/fcm_service.dart:179:post /patient-app/fcm/register-device
apps/patient-app/lib/features/appointments/appointments_screen.dart:191:get /patient-app/checklists/$pid
apps/patient-app/lib/features/appointments/appointments_screen.dart:203:patch /patient-app/checklists/$pid/$itemId
apps/patient-app/lib/features/appointments/appointments_screen.dart:262:get /patients/$pid/legal-orders
apps/patient-app/lib/features/appointments/appointments_screen.dart:37:get /patient-app/appointments
apps/patient-app/lib/features/appointments/appointments_screen.dart:50:patch /patient-app/appointment-response/$apptId
apps/patient-app/lib/features/auth/activate_screen.dart:41:post /patient-app/activate
apps/patient-app/lib/features/digital_care/digital_care_screen.dart:119:post /patient-app/wearables/$patientId/sources
apps/patient-app/lib/features/digital_care/digital_care_screen.dart:133:post /patient-app/wearables/$patientId/ingest
apps/patient-app/lib/features/digital_care/digital_care_screen.dart:34:get /patient-app/interventions/$patientId
apps/patient-app/lib/features/digital_care/digital_care_screen.dart:35:get /patient-app/wearables/$patientId/sources
apps/patient-app/lib/features/digital_care/digital_care_screen.dart:36:get /patient-app/wearables/$patientId/phenotypes
apps/patient-app/lib/features/digital_care/digital_care_screen.dart:54:post /patient-app/interventions/$patientId/packs/$packId/items/$itemId
apps/patient-app/lib/features/digital_care/digital_care_screen.dart:77:post /patient-app/interventions/$patientId/thought-diary
apps/patient-app/lib/features/digital_care/digital_care_screen.dart:99:post /patient-app/interventions/$patientId/sleep-hygiene/check-in
apps/patient-app/lib/features/documents/documents_screen.dart:131:get /patients/$pid/pathology
apps/patient-app/lib/features/documents/documents_screen.dart:44:get /patients/$pid/attachments
apps/patient-app/lib/features/documents/documents_screen.dart:49:get /patient-app/shared-docs/$pid
apps/patient-app/lib/features/emergency/emergency_screen.dart:10:get /patient-app/triage/$pid
apps/patient-app/lib/features/home/home_screen.dart:470:get /patient-app/episodes/$pid
apps/patient-app/lib/features/home/home_screen.dart:476:get /patient-app/episodes/$episodeId/allocation
apps/patient-app/lib/features/messaging/messaging_screen.dart:15:get /messages/inbox
apps/patient-app/lib/features/messaging/messaging_screen.dart:172:post /messages/threads/$threadId/messages
apps/patient-app/lib/features/messaging/messaging_screen.dart:174:post /messages
apps/patient-app/lib/features/messaging/messaging_screen.dart:177:patch /messages/${widget.messageId}/read
apps/patient-app/lib/features/messaging/messaging_screen.dart:245:post /messages
apps/patient-app/lib/features/patient_tasks/patient_tasks_screen.dart:102:patch /patient-app/tasks/$pid/$taskId
apps/patient-app/lib/features/patient_tasks/patient_tasks_screen.dart:23:get /patient-app/tasks/$pid
apps/patient-app/lib/features/patient_tasks/patient_tasks_screen.dart:79:post /patient-app/tasks/$pid
apps/patient-app/lib/features/rating_scales/rating_scales_screen.dart:201:patch /patient-app/assessments/$pid/$scaleId/complete
apps/patient-app/lib/features/rating_scales/rating_scales_screen.dart:32:get /patient-app/assessments/$pid
apps/patient-app/lib/features/rating_scales/rating_scales_screen.dart:66:get /outcomes/patient/$pid
apps/patient-app/lib/features/reminders/reminders_screen.dart:173:post /patient-app/tracking
apps/patient-app/lib/features/reminders/reminders_screen.dart:51:get /patients/$pid/medications
apps/patient-app/lib/features/sync/downstream_sync_settings.dart:53:get /patient-app/sync-preferences
apps/patient-app/lib/features/sync/downstream_sync_settings.dart:87:patch /patient-app/sync-preferences
apps/patient-app/lib/features/sync/sync_settings_screen.dart:106:post /patient-app/tracking
apps/patient-app/lib/features/sync/sync_settings_screen.dart:117:post /patient-app/tracking
apps/patient-app/lib/features/sync/sync_settings_screen.dart:126:post /patient-app/tracking
apps/patient-app/lib/features/sync/sync_settings_screen.dart:61:post /patient-app/tracking
apps/patient-app/lib/features/sync/sync_settings_screen.dart:73:post /patient-app/tracking
apps/patient-app/lib/features/sync/sync_settings_screen.dart:84:post /patient-app/tracking
apps/patient-app/lib/features/sync/sync_settings_screen.dart:95:post /patient-app/tracking
apps/patient-app/lib/features/tracking/tracking_screen.dart:92:post /patient-app/tracking
apps/patient-app/lib/features/vitals/vitals_screen.dart:18:post /patient-app/tracking
```

## 3) Enumerated API Calls (Sara)

Source command:
`rg -n --pcre2 "\\b(?:api|apiService|ApiService|client|http)\\.(get|post|put|patch|delete)\\('([^']+)'" apps/mobile/lib -or '$1 $2' | sort -u`

```text
apps/mobile/lib/core/services/auth_service.dart:55:get /auth/me
apps/mobile/lib/core/services/auth_service.dart:89:post /auth/logout
apps/mobile/lib/core/services/sync_service.dart:100:get /patients/$patientId/notes
apps/mobile/lib/core/services/sync_service.dart:139:post /patients/$patientId/notes
apps/mobile/lib/core/services/sync_service.dart:44:get /patients
apps/mobile/lib/core/services/sync_service.dart:70:get /patients/$id
apps/mobile/lib/features/auth/mfa_screen.dart:62:post /auth/mfa/verify
apps/mobile/lib/features/contacts/add_contact_screen.dart:12:get /staff-settings/contact-options
apps/mobile/lib/features/contacts/add_contact_screen.dart:29:get /episodes/patient/$patientId
apps/mobile/lib/features/drafts/drafts_screen.dart:10:get /clinical-notes
apps/mobile/lib/features/drafts/drafts_screen.dart:122:get /patients
apps/mobile/lib/features/drafts/drafts_screen.dart:219:post /clinical-notes
apps/mobile/lib/features/drafts/drafts_screen.dart:408:patch /clinical-notes/$noteId
apps/mobile/lib/features/messaging/inbox_screen.dart:11:get /messages/threads
apps/mobile/lib/features/messaging/inbox_screen.dart:150:patch /messages/${message[
apps/mobile/lib/features/messaging/inbox_screen.dart:20:get /messages/inbox
apps/mobile/lib/features/patients/patient_detail_screen.dart:26:get /episodes/patient/$patientId
apps/mobile/lib/features/patients/patient_detail_screen.dart:399:post /clinical-notes
apps/mobile/lib/features/patients/prescription_detail_screen.dart:144:post /medications
apps/mobile/lib/features/patients/prescription_detail_screen.dart:91:get /staff/me
apps/mobile/lib/features/patients/tabs/alerts_plans_tab.dart:32:get /patients/$patientId/alerts
apps/mobile/lib/features/patients/tabs/contacts_tab.dart:12:get /contact-records/patient/$patientId/unified
apps/mobile/lib/features/patients/tabs/contacts_tab.dart:21:get /contact-records/patient/$patientId
apps/mobile/lib/features/patients/tabs/contacts_tab.dart:221:post /contact-records
apps/mobile/lib/features/patients/tabs/episodes_tab.dart:11:get /episodes/patient/$patientId
apps/mobile/lib/features/patients/tabs/messages_tab.dart:11:get /correspondence/patient/$patientId
apps/mobile/lib/features/patients/tabs/messages_tab.dart:271:get /patients/${widget.patientId}/contacts
apps/mobile/lib/features/patients/tabs/messages_tab.dart:27:get /patients/$patientId/contacts
apps/mobile/lib/features/patients/tabs/messages_tab.dart:303:post /correspondence/letters
apps/mobile/lib/features/patients/tabs/overview_tab.dart:11:get /patients/$patientId
apps/mobile/lib/features/patients/tabs/overview_tab.dart:19:get /patients/$patientId/contacts
apps/mobile/lib/features/patients/tabs/overview_tab.dart:30:get /patients/$patientId/providers
apps/mobile/lib/features/patients/tabs/pathology_tab.dart:9:get /patients/$patientId/pathology
apps/mobile/lib/features/patients/tabs/prescriptions_tab.dart:10:get /medications/patients/$patientId/medications
apps/mobile/lib/features/patients/tabs/prescriptions_tab.dart:189:post /medications
apps/mobile/lib/features/patients/tabs/review_91day_tab.dart:21:get /clinical-notes/patient/$patientId
apps/mobile/lib/features/patients/tabs/review_91day_tab.dart:34:get /medications/patients/$patientId/medications
apps/mobile/lib/features/patients/tabs/review_91day_tab.dart:44:get /patients/$patientId/alerts
apps/mobile/lib/features/patients/tabs/review_91day_tab.dart:9:get /patients/review-status
apps/mobile/lib/features/patients/tabs/summary_tab.dart:18:get /episodes/patient/$patientId
apps/mobile/lib/features/patients/tabs/summary_tab.dart:32:get /patients/$patientId
apps/mobile/lib/features/patients/tabs/summary_tab.dart:43:get /patients/$patientId/diagnoses
apps/mobile/lib/features/patients/tabs/tasks_tab.dart:9:get /tasks
apps/mobile/lib/features/scribe/consent_dialog.dart:153:post /scribe/consent
apps/mobile/lib/features/scribe/consent_dialog.dart:84:get /scribe/consent/mode
apps/mobile/lib/features/tasks/my_tasks_screen.dart:10:get /tasks
apps/mobile/lib/features/tasks/my_tasks_screen.dart:140:patch /tasks/${task[
```

## 4) Two-Way Exchange Proof (Integration)

Executed:

- `npm run -s test:integration -- saraMainAppTwoWayExchange.int.test.ts vivaMainAppTwoWayExchange.int.test.ts` -> ✅

Passing suites:

- `saraMainAppTwoWayExchange.int.test.ts`
  - episodes visible
  - notes, tasks, medications, contact records, correspondence round-trip
- `vivaMainAppTwoWayExchange.int.test.ts`
  - patient episode feed + allocation readable
  - main-app appointment write visible in Viva feed
  - Viva appointment response visible in main appointments API (`patientResponse`)
  - tracking patient->clinician and clinician->patient round-trip
  - checklists/tasks clinician->patient and patient completion -> clinician round-trip

## 5) L1/L3 Build Checks for This Slice

- `npx tsc --noEmit -p packages/shared/tsconfig.json` -> ✅
- `cd apps/api && npx tsc --noEmit` -> ✅
- `cd apps/web && npx tsc --noEmit` -> ✅
- `cd apps/mobile && flutter test` -> ✅
- `cd apps/patient-app && flutter test` -> ✅

## 6) Viva Contract Drift Closure (Final)

Closed patient-app route drift by migrating Viva off clinician-only paths.

- `GET /patients/:id/medications` -> `GET /patient-app/medications/:patientId`
- `GET /patients/:id/attachments` -> `GET /patient-app/attachments/:patientId`
- `GET /patients/:id/pathology` -> `GET /patient-app/pathology/:patientId`
- `GET /patients/:id/legal-orders` -> `GET /patient-app/legal-orders/:patientId`
- `GET /outcomes/patient/:id` -> `GET /patient-app/assessments/:patientId`
- `/messages/*` -> `/patient-app/messages/*`

New patient-app endpoints added to backend:

- `GET /patient-app/medications/:patientId`
- `GET /patient-app/attachments/:patientId`
- `GET /patient-app/pathology/:patientId`
- `GET /patient-app/legal-orders/:patientId`
- `GET /patient-app/messages/inbox`
- `POST /patient-app/messages`
- `POST /patient-app/messages/threads/:threadId/messages`
- `PATCH /patient-app/messages/:messageId/read`

Extended two-way integration proof:

- Viva read-surface callability with patient auth:
  - legal orders, pathology, attachments, shared docs, medications, assessments, inbox
- Viva messaging two-way:
  - staff write -> visible in Viva inbox
  - patient reply -> visible back to staff via patient-app inbox (patient-authored flag)
- Pathway-dependent Viva reads (`/patient-app/interventions/*`, `/patient-app/wearables/*/phenotypes`) are contract-valid and return `404 PATHWAY_NOT_FOUND` when no pathway exists for the patient fixture (expected domain outcome, not auth/route failure).
