# Express Route Inventory — 2026-04-19

Total rows: 721

## advance-directives

| # | File:Line | Verb | Path | Middleware Chain | Handler | Notes |
|---|---|---|---|---|---|---|
| 1 | features/advance-directives/advanceDirectiveRoutes.ts:35 | GET | /patient/:patientId | requireRoles(ROLES) | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 2 | features/advance-directives/advanceDirectiveRoutes.ts:68 | POST | / | requireRoles(ROLES) | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 3 | features/advance-directives/advanceDirectiveRoutes.ts:103 | PATCH | /:id | requireRoles(ROLES) | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
## allergies

| # | File:Line | Verb | Path | Middleware Chain | Handler | Notes |
|---|---|---|---|---|---|---|
| 4 | features/allergies/allergies.routes.ts:9 | POST | /api/v1/allergies | authMiddleware, tenantMiddleware | allergyController.create | — |
| 5 | features/allergies/allergies.routes.ts:15 | GET | /api/v1/patients/:patientId/allergies | authMiddleware, tenantMiddleware | allergyController.listForPatient | — |
| 6 | features/allergies/allergies.routes.ts:21 | GET | /api/v1/patients/:patientId/allergies/interaction-check | authMiddleware, tenantMiddleware | allergyController.checkInteraction | — |
| 7 | features/allergies/allergies.routes.ts:27 | PATCH | /api/v1/patients/:patientId/allergies/:id | authMiddleware, tenantMiddleware | allergyController.update | — |
| 8 | features/allergies/allergies.routes.ts:33 | DELETE | /api/v1/patients/:patientId/allergies/:id | authMiddleware, tenantMiddleware | allergyController.softDelete | — |
## audit

| # | File:Line | Verb | Path | Middleware Chain | Handler | Notes |
|---|---|---|---|---|---|---|
| 9 | features/audit/auditReplayRoutes.ts:24 | GET | /patient/:patientId/timeline | requireRoles(ADMIN_ROLES) | async (req: Request, res: Response) => {     const { patientId } = ... | — |
| 10 | features/audit/auditReplayRoutes.ts:57 | GET | /record/:table/:recordId | requireRoles(ADMIN_ROLES) | async (req: Request, res: Response) => {     const { table, recordI... | — |
| 11 | features/audit/auditReplayRoutes.ts:76 | GET | /staff/:staffId/activity | requireRoles(ADMIN_ROLES) | async (req: Request, res: Response) => {     const { staffId } = re... | — |
| 12 | features/audit/auditReplayRoutes.ts:106 | GET | /ai-provenance/:patientId | requireRoles(ADMIN_ROLES) | async (req: Request, res: Response) => {     const { patientId } = ... | — |
## auth

| # | File:Line | Verb | Path | Middleware Chain | Handler | Notes |
|---|---|---|---|---|---|---|
| 13 | features/auth/adminImpersonationRoutes.ts:52 | POST | /:staffId | requireRoles(['admin', 'superadmin']) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 14 | features/auth/adminImpersonationRoutes.ts:130 | POST | /:id/end | requireRoles(['admin', 'superadmin']) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 15 | features/auth/adminImpersonationRoutes.ts:164 | GET | / | requireRoles(['admin', 'superadmin']) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 16 | features/auth/breakGlassRoutes.ts:145 | POST | /break-glass/request | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
| 17 | features/auth/breakGlassRoutes.ts:240 | POST | /break-glass/:id/approve | authMiddleware, requireRoles(['admin', 'superadmin']) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 18 | features/auth/breakGlassRoutes.ts:341 | POST | /break-glass/:id/deny | authMiddleware, requireRoles(['admin', 'superadmin']) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 19 | features/auth/breakGlassRoutes.ts:396 | POST | /break-glass/:id/revoke | authMiddleware, requireRoles(['admin', 'superadmin']) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 20 | features/auth/breakGlassRoutes.ts:446 | GET | /break-glass | authMiddleware, requireRoles(['admin', 'superadmin']) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 21 | features/auth/breakGlassRoutes.ts:468 | GET | /break-glass/active | authMiddleware, requireRoles(['admin', 'superadmin']) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 22 | features/auth/webauthnRoutes.ts:100 | POST | /webauthn/register/options | authMiddleware | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 23 | features/auth/webauthnRoutes.ts:132 | POST | /webauthn/register/verify | authMiddleware | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 24 | features/auth/webauthnRoutes.ts:172 | POST | /webauthn/login/options | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
| 25 | features/auth/webauthnRoutes.ts:217 | POST | /webauthn/login/verify | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
| 26 | features/auth/webauthnRoutes.ts:277 | GET | /webauthn/credentials | authMiddleware | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 27 | features/auth/webauthnRoutes.ts:292 | DELETE | /webauthn/credentials/:id | authMiddleware | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
## backup

| # | File:Line | Verb | Path | Middleware Chain | Handler | Notes |
|---|---|---|---|---|---|---|
| 28 | features/backup/backupRoutes.ts:100 | GET | /config | requireRoles(['admin', 'superadmin']) | async (_req: Request, res: Response, next: NextFunction) => {   try... | — |
| 29 | features/backup/backupRoutes.ts:112 | PUT | /config | requireRoles(['admin', 'superadmin']) | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 30 | features/backup/backupRoutes.ts:145 | POST | /run | requireRoles(['admin', 'superadmin']) | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 31 | features/backup/backupRoutes.ts:155 | GET | /history | requireRoles(['admin', 'superadmin']) | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
## beds

| # | File:Line | Verb | Path | Middleware Chain | Handler | Notes |
|---|---|---|---|---|---|---|
| 32 | features/beds/bedRoutes.ts:37 | GET | / | requireRoles(ROLES) | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 33 | features/beds/bedRoutes.ts:46 | GET | /board | requireRoles(ROLES) | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 34 | features/beds/bedRoutes.ts:103 | POST | / | requireRoles(['admin', 'superadmin']) | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 35 | features/beds/bedRoutes.ts:122 | POST | /bulk | requireRoles(['admin', 'superadmin']) | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 36 | features/beds/bedRoutes.ts:141 | PATCH | /:bedId | requireRoles(['admin', 'superadmin']) | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 37 | features/beds/bedRoutes.ts:156 | DELETE | /:bedId | requireRoles(['admin', 'superadmin']) | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 38 | features/beds/bedRoutes.ts:167 | POST | /:bedId/admit | requireRoles(ROLES) | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 39 | features/beds/bedRoutes.ts:184 | POST | /:bedId/discharge | requireRoles(ROLES) | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 40 | features/beds/bedRoutes.ts:210 | POST | /:bedId/leave | requireRoles(ROLES) | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 41 | features/beds/bedRoutes.ts:232 | GET | /restrictive-interventions/:patientId | requireRoles(ROLES) | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 42 | features/beds/bedRoutes.ts:241 | POST | /restrictive-interventions | requireRoles(ROLES) | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 43 | features/beds/bedRoutes.ts:254 | POST | /restrictive-interventions/:id/end | requireRoles(ROLES) | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
## billing

| # | File:Line | Verb | Path | Middleware Chain | Handler | Notes |
|---|---|---|---|---|---|---|
| 44 | features/billing/billingRoutes.ts:23 | GET | / | — | async (req, res, next) => {   try {     const { db } = await import... | no middleware |
| 45 | features/billing/billingRoutes.ts:33 | PUT | /accounts | requireRole('admin', 'superadmin') | ctrl.upsertBillingAccount | — |
| 46 | features/billing/billingRoutes.ts:38 | GET | /accounts/patient/:patientId | — | ctrl.getBillingAccount | no middleware |
| 47 | features/billing/billingRoutes.ts:41 | POST | /invoices | requireRole('admin', 'superadmin', 'clinician',... | ctrl.createInvoice | — |
| 48 | features/billing/billingRoutes.ts:46 | GET | /invoices/patient/:patientId | — | ctrl.listInvoices | no middleware |
| 49 | features/billing/billingRoutes.ts:47 | GET | /invoices/:invoiceId | — | ctrl.getInvoice | no middleware |
| 50 | features/billing/billingRoutes.ts:48 | DELETE | /invoices/:invoiceId | requireRole('admin', 'superadmin') | ctrl.voidInvoice | — |
| 51 | features/billing/billingRoutes.ts:55 | POST | /payments | requireRole('admin', 'superadmin') | ctrl.recordPayment | — |
| 52 | features/billing/billingRoutes.ts:60 | GET | /invoices/:invoiceId/payments | — | ctrl.listPayments | no middleware |
| 53 | features/billing/billingRoutes.ts:61 | PATCH | /payments/:paymentId/claim | requireRole('admin', 'superadmin') | ctrl.updateClaim | — |
| 54 | features/billing/billingRoutes.ts:83 | GET | /fee-schedules | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
| 55 | features/billing/billingRoutes.ts:94 | POST | /fee-schedules | requireRole('admin', 'superadmin') | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 56 | features/billing/billingRoutes.ts:102 | PUT | /fee-schedules/:id | requireRole('admin', 'superadmin') | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 57 | features/billing/billingRoutes.ts:111 | DELETE | /fee-schedules/:id | requireRole('admin', 'superadmin') | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 58 | features/billing/billingRoutes.ts:118 | POST | /fee-schedules/seed | requireRole('admin', 'superadmin') | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 59 | features/billing/billingRoutes.ts:127 | GET | /clinician-fees/:staffId | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
| 60 | features/billing/billingRoutes.ts:134 | PUT | /clinician-fees/:staffId/:itemNumber | requireRole('admin', 'superadmin') | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 61 | features/billing/billingRoutes.ts:142 | DELETE | /clinician-fees/:staffId/:itemNumber | requireRole('admin', 'superadmin') | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 62 | features/billing/billingRoutes.ts:149 | POST | /clinician-fees/:staffId/apply-uniform-gap | requireRole('admin', 'superadmin') | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 63 | features/billing/billingRoutes.ts:159 | POST | /invoices/:invoiceId/approve | requireRole('clinician', 'admin', 'superadmin') | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 64 | features/billing/billingRoutes.ts:167 | POST | /invoices/:invoiceId/send | requireRole('admin', 'superadmin', 'receptionist') | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 65 | features/billing/billingRoutes.ts:176 | GET | /referrals/:patientId | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
| 66 | features/billing/billingRoutes.ts:183 | GET | /referrals/:patientId/history | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
| 67 | features/billing/billingRoutes.ts:190 | POST | /referrals | requireRole('admin', 'receptionist', 'clinician') | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 68 | features/billing/billingRoutes.ts:198 | GET | /referrals-expiring | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
| 69 | features/billing/billingRoutes.ts:208 | POST | /suggest-mbs | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
## carers

| # | File:Line | Verb | Path | Middleware Chain | Handler | Notes |
|---|---|---|---|---|---|---|
| 70 | features/carers/carerRoutes.ts:35 | GET | /patient/:patientId | requireRoles(ROLES) | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 71 | features/carers/carerRoutes.ts:42 | POST | / | requireRoles(ROLES) | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 72 | features/carers/carerRoutes.ts:54 | PATCH | /:id | requireRoles(ROLES) | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 73 | features/carers/carerRoutes.ts:67 | DELETE | /:id | requireRoles(ROLES) | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
## checklists

| # | File:Line | Verb | Path | Middleware Chain | Handler | Notes |
|---|---|---|---|---|---|---|
| 74 | features/checklists/checklistRoutes.ts:147 | GET | /templates | requireRoles(CLINICAL) | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 75 | features/checklists/checklistRoutes.ts:154 | GET | /templates/:triggerPoint | requireRoles(CLINICAL) | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 76 | features/checklists/checklistRoutes.ts:176 | POST | /templates | requireRoles(ADMIN) | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 77 | features/checklists/checklistRoutes.ts:190 | PATCH | /templates/:id | requireRoles(ADMIN) | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 78 | features/checklists/checklistRoutes.ts:204 | DELETE | /templates/:id | requireRoles(ADMIN) | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 79 | features/checklists/checklistRoutes.ts:212 | POST | /templates/seed-defaults | requireRoles(ADMIN) | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 80 | features/checklists/checklistRoutes.ts:233 | POST | /instances | requireRoles(CLINICAL) | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 81 | features/checklists/checklistRoutes.ts:252 | GET | /instances | requireRoles(CLINICAL) | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 82 | features/checklists/checklistRoutes.ts:267 | PATCH | /instances/:id | requireRoles(CLINICAL) | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 83 | features/checklists/checklistRoutes.ts:283 | POST | /instances/:id/complete | requireRoles(CLINICAL) | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 84 | features/checklists/checklistRoutes.ts:294 | GET | /check/:triggerPoint/:patientId | requireRoles(CLINICAL) | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
## clinic-settings

| # | File:Line | Verb | Path | Middleware Chain | Handler | Notes |
|---|---|---|---|---|---|---|
| 85 | features/clinic-settings/clinicSettingsRoutes.ts:31 | GET | / | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
| 86 | features/clinic-settings/clinicSettingsRoutes.ts:59 | PATCH | / | requireRoles(['admin', 'superadmin']) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
## clinical-decision

| # | File:Line | Verb | Path | Middleware Chain | Handler | Notes |
|---|---|---|---|---|---|---|
| 87 | features/clinical-decision/clinicalDecisionRoutes.ts:54 | GET | /alerts/patient/:patientId | requireRoles(ROLES) | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 88 | features/clinical-decision/clinicalDecisionRoutes.ts:117 | GET | /rules | requireRoles(ROLES) | (_req: Request, res: Response) => {   res.json(METABOLIC_RULES); } | — |
## clinical-notes

| # | File:Line | Verb | Path | Middleware Chain | Handler | Notes |
|---|---|---|---|---|---|---|
| 89 | features/clinical-notes/clinicalNote.routes.ts:16 | GET | / | — | async (req, res, next) => {   try {     const { db } = await import... | no middleware |
| 90 | features/clinical-notes/clinicalNote.routes.ts:43 | GET | /patient/:patientId/snippets | — | async (req: Request, res: Response, next: NextFunction) => {     tr... | no middleware |
| 91 | features/clinical-notes/clinicalNote.routes.ts:64 | GET | /patient/:patientId | — | ctrl.listByPatient | no middleware |
| 92 | features/clinical-notes/clinicalNote.routes.ts:68 | GET | /:id/versions | — | ctrl.listVersions | no middleware |
| 93 | features/clinical-notes/clinicalNote.routes.ts:69 | GET | /:id/codes | — | ctrl.listCodes | no middleware |
| 94 | features/clinical-notes/clinicalNote.routes.ts:70 | PATCH | /:id/codes/:codeId | — | ctrl.updateCode | no middleware |
| 95 | features/clinical-notes/clinicalNote.routes.ts:71 | GET | /:id | — | ctrl.getById | no middleware |
| 96 | features/clinical-notes/clinicalNote.routes.ts:74 | POST | / | idempotencyMiddleware() | ctrl.create | — |
| 97 | features/clinical-notes/clinicalNote.routes.ts:75 | PATCH | /:id | — | ctrl.update | no middleware |
| 98 | features/clinical-notes/clinicalNote.routes.ts:76 | POST | /:id/sign | — | ctrl.sign | no middleware |
| 99 | features/clinical-notes/clinicalNote.routes.ts:77 | POST | /:id/amend | — | ctrl.amend | no middleware |
| 100 | features/clinical-notes/clinicalNote.routes.ts:78 | DELETE | /:id | — | ctrl.softDelete | no middleware |
## clinical-review

| # | File:Line | Verb | Path | Middleware Chain | Handler | Notes |
|---|---|---|---|---|---|---|
| 101 | features/clinical-review/clinicalReviewRoutes.ts:13 | GET | /patients/:patientId/summary | — | (req, res, next) => clinicalReviewController.getSummary(req, res, n... | no middleware |
| 102 | features/clinical-review/clinicalReviewRoutes.ts:19 | GET | /patients/:patientId/timeline | — | (req, res, next) => clinicalReviewController.getTimeline(req, res, ... | no middleware |
| 103 | features/clinical-review/clinicalReviewRoutes.ts:26 | GET | /encounters/:encounterId | — | (req, res, next) => clinicalReviewController.getConsultation(req, r... | no middleware |
| 104 | features/clinical-review/clinicalReviewRoutes.ts:32 | POST | /encounters/:encounterId/engagement | — | (req, res, next) => clinicalReviewController.saveEngagement(req, re... | no middleware |
| 105 | features/clinical-review/clinicalReviewRoutes.ts:38 | PUT | /encounters/:encounterId/key-issues | — | (req, res, next) => clinicalReviewController.saveKeyIssues(req, res... | no middleware |
| 106 | features/clinical-review/clinicalReviewRoutes.ts:44 | POST | /encounters/:encounterId/plan | — | (req, res, next) => clinicalReviewController.saveReviewPlan(req, re... | no middleware |
## clozapine

| # | File:Line | Verb | Path | Middleware Chain | Handler | Notes |
|---|---|---|---|---|---|---|
| 107 | features/clozapine/clozapineRoutes.ts:32 | GET | /patients/:patientId/clozapine | requireRoles(CLINICAL) | listClozapineRegistrations | — |
| 108 | features/clozapine/clozapineRoutes.ts:33 | GET | /:id | requireRoles(CLINICAL) | getClozapineRegistration | — |
| 109 | features/clozapine/clozapineRoutes.ts:35 | POST | / | requireRoles(PRESCRIBER), idempotencyMiddleware() | createClozapineRegistration | — |
| 110 | features/clozapine/clozapineRoutes.ts:36 | PATCH | /:id | requireRoles(PRESCRIBER) | updateClozapineRegistration | — |
| 111 | features/clozapine/clozapineRoutes.ts:39 | GET | /:registrationId/blood-results | requireRoles(CLINICAL) | listBloodResults | — |
| 112 | features/clozapine/clozapineRoutes.ts:42 | POST | /blood-results | requireRoles(PRESCRIBER), idempotencyMiddleware() | recordBloodResult | — |
| 113 | features/clozapine/clozapineRoutes.ts:45 | GET | /:registrationId/titration-days | requireRoles(CLINICAL) | listTitrationDays | — |
| 114 | features/clozapine/clozapineRoutes.ts:46 | POST | /titration-days | requireRoles(PRESCRIBER) | upsertTitrationDay | — |
| 115 | features/clozapine/clozapineRoutes.ts:49 | GET | /:registrationId/administrations | requireRoles(CLINICAL) | listAdministrations | — |
| 116 | features/clozapine/clozapineRoutes.ts:52 | POST | /administrations | requireRoles(CLINICAL), idempotencyMiddleware() | createAdministration | — |
| 117 | features/clozapine/clozapineRoutes.ts:55 | GET | /:registrationId/observations | requireRoles(CLINICAL) | listObservations | — |
| 118 | features/clozapine/clozapineRoutes.ts:56 | POST | /observations | requireRoles(CLINICAL) | createObservation | — |
| 119 | features/clozapine/clozapineRoutes.ts:59 | GET | /:registrationId/monitoring-checks | requireRoles(CLINICAL) | listMonitoringChecks | — |
| 120 | features/clozapine/clozapineRoutes.ts:60 | POST | /monitoring-checks | requireRoles(CLINICAL) | upsertMonitoringCheck | — |
## contacts

| # | File:Line | Verb | Path | Middleware Chain | Handler | Notes |
|---|---|---|---|---|---|---|
| 121 | features/contacts/contactRecordRoutes.ts:54 | GET | /patient/:patientId/unified | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
| 122 | features/contacts/contactRecordRoutes.ts:192 | GET | /patient/:patientId | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
| 123 | features/contacts/contactRecordRoutes.ts:203 | GET | /:id | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
| 124 | features/contacts/contactRecordRoutes.ts:212 | POST | / | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
| 125 | features/contacts/contactRecordRoutes.ts:258 | PATCH | /:id | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
| 126 | features/contacts/contactRecordRoutes.ts:285 | GET | /by-source/:sourceType/:sourceId | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
| 127 | features/contacts/contactRecordRoutes.ts:299 | GET | /incomplete/mine | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
| 128 | features/contacts/contactRecordRoutes.ts:315 | GET | /export/:patientId | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
## correspondence

| # | File:Line | Verb | Path | Middleware Chain | Handler | Notes |
|---|---|---|---|---|---|---|
| 129 | features/correspondence/correspondenceRoutes.ts:15 | POST | / | requireRole('clinician', 'admin', 'superadmin') | async (req, res, next) => {   try {     // Forward to letters endpo... | — |
| 130 | features/correspondence/correspondenceRoutes.ts:24 | GET | /patient/:patientId | — | async (req, res, next) => {   try {     req.url = '/letters/patient... | no middleware |
| 131 | features/correspondence/correspondenceRoutes.ts:32 | GET | /templates | — | ctrl.listTemplates | no middleware |
| 132 | features/correspondence/correspondenceRoutes.ts:36 | POST | /generate-from-note | requireRole('clinician', 'admin'), requireFeatureEnabled('ai-letter') | ctrl.generateFromNote | — |
| 133 | features/correspondence/correspondenceRoutes.ts:38 | POST | /letters | requireRole('clinician', 'admin') | ctrl.createLetter | — |
| 134 | features/correspondence/correspondenceRoutes.ts:39 | GET | /letters/patient/:patientId | — | ctrl.listLetters | no middleware |
| 135 | features/correspondence/correspondenceRoutes.ts:40 | GET | /letters/:letterId | — | ctrl.getLetter | no middleware |
| 136 | features/correspondence/correspondenceRoutes.ts:41 | PATCH | /letters/:letterId | requireRole('clinician', 'admin') | ctrl.updateLetter | — |
| 137 | features/correspondence/correspondenceRoutes.ts:42 | DELETE | /letters/:letterId | requireRole('clinician', 'admin') | ctrl.deleteLetter | — |
| 138 | features/correspondence/correspondenceRoutes.ts:45 | GET | /letters/:letterId/pdf | — | async (req, res, next) => {   try {     const { db } = await import... | no middleware |
## dashboard

| # | File:Line | Verb | Path | Middleware Chain | Handler | Notes |
|---|---|---|---|---|---|---|
| 139 | features/dashboard/dashboardRoutes.ts:14 | GET | /clinician | requireRoles(['clinician', 'admin', 'superadmin']) | getClinicianDashboard | — |
| 140 | features/dashboard/dashboardRoutes.ts:21 | GET | /manager | requireRoles(['manager', 'admin', 'superadmin']) | getManagerDashboard | — |
## documents

| # | File:Line | Verb | Path | Middleware Chain | Handler | Notes |
|---|---|---|---|---|---|---|
| 141 | features/documents/documentRoutes.ts:11 | GET | /types | — | controller.types | no middleware |
| 142 | features/documents/documentRoutes.ts:14 | POST | /generate | — | controller.generate | no middleware |
## ect

| # | File:Line | Verb | Path | Middleware Chain | Handler | Notes |
|---|---|---|---|---|---|---|
| 143 | features/ect/ectRoutes.ts:38 | POST | /courses | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
| 144 | features/ect/ectRoutes.ts:47 | POST | /courses/:courseId/sessions | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
| 145 | features/ect/ectRoutes.ts:56 | GET | /patients/:patientId | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
| 146 | features/ect/ectRoutes.ts:64 | GET | /courses/:courseId/sessions | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
## endocrinology

| # | File:Line | Verb | Path | Middleware Chain | Handler | Notes |
|---|---|---|---|---|---|---|
| 147 | features/endocrinology/endocrinologyRoutes.ts:32 | GET | /patients/:patientId/glucose | requirePermission('note:read') | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 148 | features/endocrinology/endocrinologyRoutes.ts:48 | GET | /patients/:patientId/glucose/time-in-range | requirePermission('note:read') | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 149 | features/endocrinology/endocrinologyRoutes.ts:64 | POST | /patients/:patientId/glucose | requirePermission('note:create') | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 150 | features/endocrinology/endocrinologyRoutes.ts:76 | DELETE | /glucose/:id | requirePermission('note:update') | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 151 | features/endocrinology/endocrinologyRoutes.ts:89 | GET | /patients/:patientId/insulin-regimens | requirePermission('medication:read') | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 152 | features/endocrinology/endocrinologyRoutes.ts:100 | GET | /patients/:patientId/insulin-regimens/current | requirePermission('medication:read') | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 153 | features/endocrinology/endocrinologyRoutes.ts:111 | POST | /patients/:patientId/insulin-regimens | requirePermission('medication:create') | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
## episode

| # | File:Line | Verb | Path | Middleware Chain | Handler | Notes |
|---|---|---|---|---|---|---|
| 154 | features/episode/episodeRoutes.ts:17 | GET | /patient/:patientId | — | episodeController.listForPatient | no middleware |
| 155 | features/episode/episodeRoutes.ts:29 | GET | /patients-by-clinician/:clinicianId | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
| 156 | features/episode/episodeRoutes.ts:63 | GET | /patients-by-team/:team | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
| 157 | features/episode/episodeRoutes.ts:108 | GET | /:id | — | episodeController.getById | no middleware |
| 158 | features/episode/episodeRoutes.ts:109 | POST | / | — | episodeController.create | no middleware |
| 159 | features/episode/episodeRoutes.ts:110 | PUT | /:id | — | episodeController.update | no middleware |
| 160 | features/episode/episodeRoutes.ts:111 | POST | /:id/close | — | episodeController.close | no middleware |
| 161 | features/episode/episodeRoutes.ts:141 | POST | /:id/allocate | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
| 162 | features/episode/episodeRoutes.ts:296 | GET | /:id/allocation | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
| 163 | features/episode/episodeRoutes.ts:339 | POST | /:id/discharge-summary/generate | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
| 164 | features/episode/episodeRoutes.ts:366 | POST | /:id/discharge-summary/submit | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
| 165 | features/episode/episodeRoutes.ts:399 | POST | /:id/discharge-summary/sign | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
| 166 | features/episode/episodeRoutes.ts:417 | GET | /:id/discharge-summary | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
| 167 | features/episode/episodeRoutes.ts:428 | POST | /:id/close-with-vetting | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
| 168 | features/episode/episodeRoutes.ts:459 | POST | /:id/close-sign | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
## ereferral

| # | File:Line | Verb | Path | Middleware Chain | Handler | Notes |
|---|---|---|---|---|---|---|
| 169 | features/ereferral/ereferralRoutes.ts:56 | GET | / | requireRoles(ROLES) | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 170 | features/ereferral/ereferralRoutes.ts:73 | POST | / | requireRoles(ROLES) | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 171 | features/ereferral/ereferralRoutes.ts:100 | PATCH | /:id/status | requireRoles(ROLES) | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
## escalations

| # | File:Line | Verb | Path | Middleware Chain | Handler | Notes |
|---|---|---|---|---|---|---|
| 172 | features/escalations/escalation.routes.ts:18 | GET | / | — | async (req, res, next) => {   try {     const { db } = await import... | no middleware |
| 173 | features/escalations/escalation.routes.ts:34 | GET | /patient/:patientId | — | ctrl.listByPatient | no middleware |
| 174 | features/escalations/escalation.routes.ts:37 | GET | /team-summary | — | async (req, res, next) => {   try {     const { db } = await import... | no middleware |
| 175 | features/escalations/escalation.routes.ts:54 | GET | /:id | — | ctrl.getById | no middleware |
| 176 | features/escalations/escalation.routes.ts:57 | POST | / | idempotencyMiddleware() | ctrl.create | — |
| 177 | features/escalations/escalation.routes.ts:58 | PATCH | /:id | — | ctrl.update | no middleware |
| 178 | features/escalations/escalation.routes.ts:59 | POST | /:id/acknowledge | — | ctrl.acknowledge | no middleware |
| 179 | features/escalations/escalation.routes.ts:60 | POST | /:id/resolve | — | ctrl.resolve | no middleware |
| 180 | features/escalations/escalation.routes.ts:61 | POST | /:id/notes | — | ctrl.addNote | no middleware |
| 181 | features/escalations/escalation.routes.ts:62 | DELETE | /:id | — | ctrl.softDelete | no middleware |
| 182 | features/escalations/escalation.routes.ts:65 | POST | /:id/accept-transfer | — | async (req, res, next) => {   try {     const { db } = await import... | no middleware |
| 183 | features/escalations/escalation.routes.ts:118 | POST | /:id/reject-transfer | — | async (req, res, next) => {   try {     const { db } = await import... | no middleware |
## events

| # | File:Line | Verb | Path | Middleware Chain | Handler | Notes |
|---|---|---|---|---|---|---|
| 184 | features/events/sseRoutes.ts:111 | GET | /stream | authMiddleware | (req: Request, res: Response) => {     // Enforce connection limit ... | — |
## feature-flags

| # | File:Line | Verb | Path | Middleware Chain | Handler | Notes |
|---|---|---|---|---|---|---|
| 185 | features/feature-flags/featureFlagRoutes.ts:78 | GET | / | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
| 186 | features/feature-flags/featureFlagRoutes.ts:91 | GET | /:name | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
## flags

| # | File:Line | Verb | Path | Middleware Chain | Handler | Notes |
|---|---|---|---|---|---|---|
| 187 | features/flags/flag.routes.ts:12 | GET | /api/v1/patients/:patientId/flags/high-severity | authMiddleware, tenantMiddleware | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 188 | features/flags/flag.routes.ts:32 | GET | /api/v1/patients/:patientId/flags | authMiddleware, tenantMiddleware | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
## group-therapy

| # | File:Line | Verb | Path | Middleware Chain | Handler | Notes |
|---|---|---|---|---|---|---|
| 189 | features/group-therapy/groupTherapyRoutes.ts:74 | GET | / | requireRoles(ROLES) | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 190 | features/group-therapy/groupTherapyRoutes.ts:95 | GET | /:id | requireRoles(ROLES) | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 191 | features/group-therapy/groupTherapyRoutes.ts:108 | POST | / | requireRoles(ROLES) | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 192 | features/group-therapy/groupTherapyRoutes.ts:134 | PATCH | /:id | requireRoles(ROLES) | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 193 | features/group-therapy/groupTherapyRoutes.ts:148 | POST | /:id/attendance | requireRoles(ROLES) | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 194 | features/group-therapy/groupTherapyRoutes.ts:176 | GET | /:id/attendees | requireRoles(ROLES) | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 195 | features/group-therapy/groupTherapyRoutes.ts:187 | POST | /:id/attendees | requireRoles(ROLES) | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 196 | features/group-therapy/groupTherapyRoutes.ts:201 | PATCH | /:id/attendees/:attendeeId | requireRoles(ROLES) | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 197 | features/group-therapy/groupTherapyRoutes.ts:219 | DELETE | /:id/attendees/:attendeeId | requireRoles(ROLES) | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 198 | features/group-therapy/groupTherapyRoutes.ts:227 | POST | /:id/attendees/:attendeeId/note | requireRoles(ROLES) | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 199 | features/group-therapy/groupTherapyRoutes.ts:261 | GET | /patient/:patientId | requireRoles(ROLES) | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
## imports

| # | File:Line | Verb | Path | Middleware Chain | Handler | Notes |
|---|---|---|---|---|---|---|
| 200 | features/imports/importRoutes.ts:49 | POST | /:kind/dry-run | requireModuleWrite(MODULE_KEYS.IMPORTS), multerUpload.single('file') | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 201 | features/imports/importRoutes.ts:79 | POST | /:kind/commit | requireModuleWrite(MODULE_KEYS.IMPORTS) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 202 | features/imports/importRoutes.ts:105 | GET | /jobs | requireModuleRead(MODULE_KEYS.IMPORTS) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 203 | features/imports/importRoutes.ts:117 | GET | /jobs/:id | requireModuleRead(MODULE_KEYS.IMPORTS) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
## integrations/cmi

| # | File:Line | Verb | Path | Middleware Chain | Handler | Notes |
|---|---|---|---|---|---|---|
| 204 | integrations/cmi/cmiRoutes.ts:9 | GET | /status | requireRoles(['admin', 'manager', 'superadmin']) | async (_req, res) => {   const { isCmiConfigured } = await import('... | — |
| 205 | integrations/cmi/cmiRoutes.ts:19 | POST | /prepare | requireRoles(['admin', 'manager', 'superadmin']) | async (req, res, next) => {   try {     const { prepareCmiSubmissio... | — |
| 206 | integrations/cmi/cmiRoutes.ts:30 | POST | /submit | requireRoles(['admin', 'superadmin']) | async (req, res, next) => {   try {     const { submitToCmi, prepar... | — |
| 207 | integrations/cmi/cmiRoutes.ts:42 | GET | /export | requireRoles(['admin', 'manager', 'superadmin']) | async (req, res, next) => {   try {     const { prepareCmiSubmissio... | — |
## integrations/fhir

| # | File:Line | Verb | Path | Middleware Chain | Handler | Notes |
|---|---|---|---|---|---|---|
| 208 | integrations/fhir/fhirAdditionalResources.ts:18 | GET | /MedicationRequest | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
| 209 | integrations/fhir/fhirAdditionalResources.ts:60 | GET | /Procedure | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
| 210 | integrations/fhir/fhirAdditionalResources.ts:102 | GET | /Location | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
| 211 | integrations/fhir/fhirRoutes.ts:47 | GET | /metadata | — | (_req: Request, res: Response) => {   res.json({     resourceType: ... | no middleware |
| 212 | integrations/fhir/fhirRoutes.ts:72 | GET | /Patient/:id | authMiddleware | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 213 | integrations/fhir/fhirRoutes.ts:81 | GET | /Patient | authMiddleware | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 214 | integrations/fhir/fhirRoutes.ts:96 | GET | /Condition | authMiddleware | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 215 | integrations/fhir/fhirRoutes.ts:119 | GET | /MedicationStatement | authMiddleware | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 216 | integrations/fhir/fhirRoutes.ts:142 | GET | /AllergyIntolerance | authMiddleware | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 217 | integrations/fhir/fhirRoutes.ts:211 | GET | /Encounter | authMiddleware | async (req: Request, res: Response, _next: NextFunction) => {   con... | — |
| 218 | integrations/fhir/fhirRoutes.ts:230 | GET | /Observation | authMiddleware | async (req: Request, res: Response, _next: NextFunction) => {   con... | — |
| 219 | integrations/fhir/fhirRoutes.ts:266 | GET | /DiagnosticReport | authMiddleware | async (req: Request, res: Response, _next: NextFunction) => {   con... | — |
| 220 | integrations/fhir/fhirRoutes.ts:285 | GET | /Practitioner | authMiddleware | async (_req: Request, res: Response, _next: NextFunction) => {   co... | — |
| 221 | integrations/fhir/fhirRoutes.ts:308 | GET | /Practitioner/:id | authMiddleware | async (req: Request, res: Response, _next: NextFunction) => {   con... | — |
| 222 | integrations/fhir/fhirRoutes.ts:320 | GET | /Organization | authMiddleware | async (_req: Request, res: Response, _next: NextFunction) => {   co... | — |
| 223 | integrations/fhir/fhirRoutes.ts:341 | POST | /Patient | authMiddleware | async (req: Request, res: Response, next: Function) => {   try {   ... | — |
| 224 | integrations/fhir/fhirRoutes.ts:384 | POST | /Observation | authMiddleware | async (req: Request, res: Response, next: Function) => {   try {   ... | — |
| 225 | integrations/fhir/fhirRoutes.ts:568 | GET | /Patient/\\$export | authMiddleware | (req: Request, res: Response, next: Function) =>   kickoffExport(re... | — |
| 226 | integrations/fhir/fhirRoutes.ts:571 | GET | /\\$export | authMiddleware | (req: Request, res: Response, next: Function) =>   kickoffExport(re... | — |
| 227 | integrations/fhir/fhirRoutes.ts:574 | GET | /Group/:groupId/\\$export | authMiddleware | (req: Request, res: Response, next: Function) =>   kickoffExport(re... | — |
| 228 | integrations/fhir/fhirRoutes.ts:579 | GET | /\\$export-status/:jobId | authMiddleware | async (req: Request, res: Response, next: Function) => {     try { ... | — |
| 229 | integrations/fhir/fhirRoutes.ts:632 | DELETE | /\\$export-status/:jobId | authMiddleware | async (req: Request, res: Response, next: Function) => {     try { ... | — |
| 230 | integrations/fhir/fhirSubscription.ts:32 | GET | /Subscription | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
| 231 | integrations/fhir/fhirSubscription.ts:52 | POST | /Subscription | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
| 232 | integrations/fhir/fhirSubscription.ts:106 | DELETE | /Subscription/:id | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
| 233 | integrations/fhir/smartAppRegistry.ts:53 | GET | /apps | authMiddleware | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 234 | integrations/fhir/smartAppRegistry.ts:61 | POST | /apps | authMiddleware, requireRoles(['admin', 'superadmin']) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 235 | integrations/fhir/smartAppRegistry.ts:137 | PATCH | /apps/:appId | authMiddleware, requireRoles(['admin', 'superadmin']) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 236 | integrations/fhir/smartAppRegistry.ts:165 | DELETE | /apps/:appId | authMiddleware, requireRoles(['admin', 'superadmin']) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 237 | integrations/fhir/smartAppRegistry.ts:182 | GET | /launch/:appId | authMiddleware | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 238 | integrations/fhir/smartAuth.ts:103 | GET | /.well-known/smart-configuration | — | (_req: Request, res: Response) => {   const baseUrl = config.apiBas... | no middleware |
| 239 | integrations/fhir/smartAuth.ts:151 | GET | /auth/authorize | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
| 240 | integrations/fhir/smartAuth.ts:277 | POST | /auth/token | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
| 241 | integrations/fhir/smartAuth.ts:502 | POST | /auth/introspect | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
| 242 | integrations/fhir/smartAuth.ts:549 | POST | /auth/revoke | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
## integrations/nhsd

| # | File:Line | Verb | Path | Middleware Chain | Handler | Notes |
|---|---|---|---|---|---|---|
| 243 | integrations/nhsd/nhsdRoutes.ts:17 | GET | /status | — | (_req: Request, res: Response) => {   res.json({ configured: isNhsd... | — |
| 244 | integrations/nhsd/nhsdRoutes.ts:22 | GET | /providers/search | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
| 245 | integrations/nhsd/nhsdRoutes.ts:51 | GET | /providers/:id | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
## internal-medicine

| # | File:Line | Verb | Path | Middleware Chain | Handler | Notes |
|---|---|---|---|---|---|---|
| 246 | features/internal-medicine/internalMedicineRoutes.ts:34 | GET | /patients/:patientId/problems | requirePermission('note:read') | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 247 | features/internal-medicine/internalMedicineRoutes.ts:50 | POST | /patients/:patientId/problems | requirePermission('note:create') | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 248 | features/internal-medicine/internalMedicineRoutes.ts:62 | PATCH | /problems/:id | requirePermission('note:update') | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 249 | features/internal-medicine/internalMedicineRoutes.ts:79 | DELETE | /problems/:id | requirePermission('note:update') | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 250 | features/internal-medicine/internalMedicineRoutes.ts:92 | GET | /patients/:patientId/med-reconciliations | requirePermission('medication:read') | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 251 | features/internal-medicine/internalMedicineRoutes.ts:103 | POST | /patients/:patientId/med-reconciliations | requirePermission('medication:create') | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
## lai

| # | File:Line | Verb | Path | Middleware Chain | Handler | Notes |
|---|---|---|---|---|---|---|
| 252 | features/lai/laiScheduleRoutes.ts:38 | GET | / | requireRoles([...ROLES]) | async (req, res, next) => {   try {     const { db } = await import... | — |
| 253 | features/lai/laiScheduleRoutes.ts:49 | POST | /given | requireRoles([...WRITE_ROLES]) | recordLaiGiven | — |
| 254 | features/lai/laiScheduleRoutes.ts:52 | POST | /aims-assessments | requireRoles([...WRITE_ROLES]) | createAimsAssessment | — |
| 255 | features/lai/laiScheduleRoutes.ts:55 | GET | /patients/:patientId/lai-schedules | requireRoles([...ROLES]) | listLaiSchedules | — |
| 256 | features/lai/laiScheduleRoutes.ts:58 | GET | /patients/:patientId/aims-assessments | requireRoles([...ROLES]) | listAimsAssessments | — |
| 257 | features/lai/laiScheduleRoutes.ts:61 | GET | /patients/:patientId/validations | requireRoles([...ROLES]) | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 258 | features/lai/laiScheduleRoutes.ts:71 | POST | /validations | requireRoles([...WRITE_ROLES]) | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 259 | features/lai/laiScheduleRoutes.ts:121 | GET | /:id | requireRoles([...ROLES]) | getLaiSchedule | — |
| 260 | features/lai/laiScheduleRoutes.ts:124 | POST | / | requireRoles([...WRITE_ROLES]) | createLaiSchedule | — |
| 261 | features/lai/laiScheduleRoutes.ts:127 | PATCH | /:id | requireRoles([...WRITE_ROLES]) | updateLaiSchedule | — |
| 262 | features/lai/laiScheduleRoutes.ts:130 | GET | /:scheduleId/given | requireRoles([...ROLES]) | listLaiGiven | — |
| 263 | features/lai/laiScheduleRoutes.ts:133 | GET | /:scheduleId/validations | requireRoles([...ROLES]) | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
## license

| # | File:Line | Verb | Path | Middleware Chain | Handler | Notes |
|---|---|---|---|---|---|---|
| 264 | features/license/licenseRoutes.ts:10 | GET | /status | — | async (_req: Request, res: Response) => {   try {     let license =... | — |
## llm

| # | File:Line | Verb | Path | Middleware Chain | Handler | Notes |
|---|---|---|---|---|---|---|
| 265 | features/llm/adminTrainingRoutes.ts:48 | GET | /scrub-rules | — | async (req: Request, res: Response, next: NextFunction) => {     tr... | no middleware |
| 266 | features/llm/adminTrainingRoutes.ts:67 | POST | /scrub-rules | — | async (req: Request, res: Response, next: NextFunction) => {     tr... | no middleware |
| 267 | features/llm/adminTrainingRoutes.ts:99 | PATCH | /scrub-rules/:id | — | async (req: Request, res: Response, next: NextFunction) => {     tr... | no middleware |
| 268 | features/llm/adminTrainingRoutes.ts:138 | POST | /corpus/ingest | — | async (req: Request, res: Response, next: NextFunction) => {     tr... | no middleware |
| 269 | features/llm/adminTrainingRoutes.ts:166 | GET | /corpus | — | async (req: Request, res: Response, next: NextFunction) => {     tr... | no middleware |
| 270 | features/llm/adminTrainingRoutes.ts:196 | PATCH | /corpus/:id/review | — | async (req: Request, res: Response, next: NextFunction) => {     tr... | no middleware |
| 271 | features/llm/adminTrainingRoutes.ts:235 | POST | /models | requireRoles(['superadmin']) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 272 | features/llm/adminTrainingRoutes.ts:261 | GET | /models | — | async (req: Request, res: Response, next: NextFunction) => {     tr... | no middleware |
| 273 | features/llm/adminTrainingRoutes.ts:292 | POST | /models/:id/red-team | requireRoles(['superadmin']) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 274 | features/llm/adminTrainingRoutes.ts:319 | POST | /deployments | — | async (req: Request, res: Response, next: NextFunction) => {     tr... | no middleware |
| 275 | features/llm/adminTrainingRoutes.ts:361 | PATCH | /deployments/:id | — | async (req: Request, res: Response, next: NextFunction) => {     tr... | no middleware |
| 276 | features/llm/adminTrainingRoutes.ts:412 | GET | /deployments | — | async (req: Request, res: Response, next: NextFunction) => {     tr... | no middleware |
| 277 | features/llm/adminTrainingRoutes.ts:433 | GET | /surveillance | — | async (req: Request, res: Response, next: NextFunction) => {     tr... | no middleware |
| 278 | features/llm/adminTrainingRoutes.ts:458 | POST | /opt-in | — | async (req: Request, res: Response, next: NextFunction) => {     tr... | no middleware |
| 279 | features/llm/aiJobRoutes.ts:52 | POST | /jobs | — | async (req: Request, res: Response, next: NextFunction) => {   let ... | no middleware |
| 280 | features/llm/aiJobRoutes.ts:98 | GET | /jobs/:id | — | async (req: Request, res: Response) => {   try {     const job = aw... | no middleware |
| 281 | features/llm/aiJobRoutes.ts:126 | GET | /jobs | — | async (req: Request, res: Response) => {   try {     const complete... | no middleware |
| 282 | features/llm/letterRoutes.ts:40 | GET | /templates | — | async (req: Request, res: Response, next: NextFunction) => {     tr... | no middleware |
| 283 | features/llm/letterRoutes.ts:78 | POST | / | requireRoles(['clinician', 'admin', 'superadmin']) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 284 | features/llm/letterRoutes.ts:91 | GET | / | — | async (req: Request, res: Response, next: NextFunction) => {     tr... | no middleware |
| 285 | features/llm/letterRoutes.ts:116 | GET | /:id | — | async (req: Request, res: Response, next: NextFunction) => {     tr... | no middleware |
| 286 | features/llm/letterRoutes.ts:165 | PATCH | /:id/sections/:sectionKey | requireRoles(['clinician', 'admin', 'superadmin']) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 287 | features/llm/letterRoutes.ts:180 | POST | /:id/submit | requireRoles(['clinician', 'admin', 'superadmin']) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 288 | features/llm/letterRoutes.ts:191 | POST | /:id/approve | requireRoles(['clinician', 'admin', 'superadmin']) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 289 | features/llm/letterRoutes.ts:204 | POST | /:id/reject | requireRoles(['clinician', 'admin', 'superadmin']) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 290 | features/llm/letterRoutes.ts:218 | GET | /review-queue/list | — | async (req: Request, res: Response, next: NextFunction) => {     tr... | no middleware |
| 291 | features/llm/letterRoutes.ts:235 | GET | /:id/audit-log | — | async (req: Request, res: Response, next: NextFunction) => {     tr... | no middleware |
| 292 | features/llm/letterRoutes.ts:262 | POST | /:id/deliver | requireRoles(['clinician', 'admin', 'superadmin']) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 293 | features/llm/letterRoutes.ts:279 | GET | /:id/deliveries | — | async (req: Request, res: Response, next: NextFunction) => {     tr... | no middleware |
| 294 | features/llm/letterRoutes.ts:308 | POST | /:id/export | requireRoles(['clinician', 'admin', 'superadmin']) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 295 | features/llm/letterRoutes.ts:328 | GET | /:id/exports | — | async (req: Request, res: Response, next: NextFunction) => {     tr... | no middleware |
| 296 | features/llm/letterRoutes.ts:359 | POST | /:id/translations | requireRoles(['clinician', 'admin', 'superadmin']) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 297 | features/llm/letterRoutes.ts:402 | GET | /:id/translations | — | async (req: Request, res: Response, next: NextFunction) => {     tr... | no middleware |
| 298 | features/llm/letterRoutes.ts:429 | POST | /:id/revise | requireRoles(['clinician', 'admin', 'superadmin']) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 299 | features/llm/letterRoutes.ts:441 | GET | /:id/revisions | — | async (req: Request, res: Response, next: NextFunction) => {     tr... | no middleware |
| 300 | features/llm/letterStructuredRoutes.ts:30 | GET | /state-mha-forms | — | async (req: Request, res: Response, next: NextFunction) => {     tr... | no middleware |
| 301 | features/llm/letterStructuredRoutes.ts:66 | POST | /capacity-assessments | requireRoles(['clinician', 'admin', 'superadmin']) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 302 | features/llm/letterStructuredRoutes.ts:102 | GET | /capacity-assessments | — | async (req: Request, res: Response, next: NextFunction) => {     tr... | no middleware |
| 303 | features/llm/letterStructuredRoutes.ts:124 | GET | /capacity-assessments/:id | — | async (req: Request, res: Response, next: NextFunction) => {     tr... | no middleware |
| 304 | features/llm/letterStructuredRoutes.ts:161 | POST | /forensic-risk | requireRoles(['clinician', 'admin', 'superadmin']) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 305 | features/llm/letterStructuredRoutes.ts:197 | GET | /forensic-risk | — | async (req: Request, res: Response, next: NextFunction) => {     tr... | no middleware |
| 306 | features/llm/letterStructuredRoutes.ts:217 | GET | /forensic-risk/:id | — | async (req: Request, res: Response, next: NextFunction) => {     tr... | no middleware |
| 307 | features/llm/letterStructuredRoutes.ts:256 | POST | /letter-citations | requireRoles(['clinician', 'admin', 'superadmin']) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 308 | features/llm/letterStructuredRoutes.ts:279 | GET | /letter-citations | — | async (req: Request, res: Response, next: NextFunction) => {     tr... | no middleware |
| 309 | features/llm/letterStructuredRoutes.ts:300 | GET | /tone-presets | — | async (req: Request, res: Response, next: NextFunction) => {     tr... | no middleware |
| 310 | features/llm/llmRoutes.ts:20 | POST | /interactions | requireRoles(['clinician', 'admin', 'superadmin']) | recordInteraction | — |
| 311 | features/llm/llmRoutes.ts:27 | GET | /usage | requireRoles(['manager', 'superadmin', 'superad... | getClinicUsage | — |
| 312 | features/llm/llmRoutes.ts:34 | GET | /usage/:userId | requireRoles(['manager', 'superadmin', 'superad... | getUserUsage | — |
| 313 | features/llm/llmRoutes.ts:47 | POST | /suggest | requireRoles(['clinician', 'admin', 'superadmin']), requireModuleRead(MODULE_KEYS.AI), requireFeatureEnabled('ai-chat') | suggest | — |
| 314 | features/llm/llmRoutes.ts:56 | GET | /models | requireRoles(['clinician', 'admin', 'superadmin']), requireModuleRead(MODULE_KEYS.AI) | async (_req: Request, res: Response, next: NextFunction) => {     t... | — |
| 315 | features/llm/llmRoutes.ts:81 | POST | /hf/inference | requireRoles(['clinician', 'admin', 'superadmin']) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 316 | features/llm/llmRoutes.ts:98 | POST | /hf/classify | requireRoles(['clinician', 'admin', 'superadmin']) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 317 | features/llm/llmRoutes.ts:115 | POST | /hf/entities | requireRoles(['clinician', 'admin', 'superadmin']) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 318 | features/llm/llmRoutes.ts:132 | POST | /hf/download | requireRoles(['admin', 'superadmin']) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 319 | features/llm/llmRoutes.ts:149 | POST | /clinical-ai | requireRoles(['clinician', 'admin', 'superadmin']) | async (req: Request, res: Response, next: NextFunction) => {     //... | — |
| 320 | features/llm/llmRoutes.ts:227 | POST | /feedback | requireRoles(['clinician', 'admin', 'superadmin']) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 321 | features/llm/llmRoutes.ts:242 | GET | /training/stats | requireRoles(['admin', 'superadmin']) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 322 | features/llm/llmRoutes.ts:261 | POST | /training/export-requests | requireRoles(['admin', 'superadmin']) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 323 | features/llm/llmRoutes.ts:297 | GET | /training/export-requests | requireRoles(['admin', 'superadmin']) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 324 | features/llm/llmRoutes.ts:319 | PATCH | /training/export-requests/:id | requireRoles(['admin', 'superadmin']) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 325 | features/llm/llmRoutes.ts:378 | GET | /training/export | requireRoles(['admin', 'superadmin']) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 326 | features/llm/llmRoutes.ts:431 | POST | /ambient-note | requireRoles(['clinician', 'admin', 'superadmin']) | async (req: Request, res: Response, next: NextFunction) => {     //... | — |
| 327 | features/llm/llmRoutes.ts:647 | POST | /mcp | requireRoles(['clinician', 'admin', 'superadmin']) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 328 | features/llm/llmRoutes.ts:668 | POST | /agent | requireRoles(['clinician', 'admin', 'superadmin']), requireModuleRead(MODULE_KEYS.AI_AGENT) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 329 | features/llm/llmRoutes.ts:713 | GET | /whisper/status | — | async (_req: Request, res: Response) => {   try {     const http = ... | no middleware |
| 330 | features/llm/llmRoutes.ts:728 | POST | /whisper/start | — | async (_req: Request, res: Response, next: NextFunction) => {   try... | no middleware |
| 331 | features/llm/llmTrainingRoutes.ts:59 | GET | /modelfiles | requireRoles(CLINICAL) | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 332 | features/llm/llmTrainingRoutes.ts:69 | GET | /modelfiles/:actionType | requireRoles(CLINICAL) | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 333 | features/llm/llmTrainingRoutes.ts:79 | PUT | /modelfiles/:actionType | requireRoles(ADMIN) | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 334 | features/llm/llmTrainingRoutes.ts:128 | DELETE | /modelfiles/:actionType | requireRoles(ADMIN) | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 335 | features/llm/llmTrainingRoutes.ts:140 | POST | /rag/test-query | requireRoles(ADMIN) | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 336 | features/llm/llmTrainingRoutes.ts:187 | POST | /training/start | requireRoles(ADMIN) | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 337 | features/llm/llmTrainingRoutes.ts:264 | GET | /training/adapters | requireRoles(ADMIN) | async (_req: Request, res: Response, _next: NextFunction) => {   tr... | — |
| 338 | features/llm/scribeRoutes.ts:103 | GET | /preferences | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
| 339 | features/llm/scribeRoutes.ts:111 | PUT | /preferences | requireRoles(['clinician', 'admin', 'superadmin']) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 340 | features/llm/scribeRoutes.ts:125 | GET | /macros | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
| 341 | features/llm/scribeRoutes.ts:159 | PUT | /macros | requireRoles(['clinician', 'admin', 'superadmin']) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 342 | features/llm/scribeRoutes.ts:174 | POST | /patient-summary | requireRoles(['clinician', 'admin', 'superadmin']) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 343 | features/llm/scribeRoutes.ts:209 | POST | /referral-letter | requireRoles(['clinician', 'admin', 'superadmin']) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 344 | features/llm/scribeRoutes.ts:271 | POST | /icd10-suggest | requireRoles(['clinician', 'admin', 'superadmin']) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 345 | features/llm/scribeRoutes.ts:285 | POST | /mbs-suggest | requireRoles(['clinician', 'admin', 'superadmin']) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 346 | features/llm/scribeRoutes.ts:305 | POST | /outcome-measures | requireRoles(['clinician', 'admin', 'superadmin']) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 347 | features/llm/scribeRoutes.ts:336 | GET | /consent/mode | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
| 348 | features/llm/scribeRoutes.ts:351 | POST | /consent | requireRoles(['clinician', 'admin', 'superadmin']) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 349 | features/llm/scribeRoutes.ts:437 | GET | /vocabulary | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
| 350 | features/llm/scribeRoutes.ts:457 | POST | /vocabulary | requireRoles(['admin', 'superadmin']) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 351 | features/llm/scribeRoutes.ts:488 | PATCH | /vocabulary/:id | requireRoles(['admin', 'superadmin']) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 352 | features/llm/scribeRoutes.ts:523 | DELETE | /vocabulary/:id | requireRoles(['admin', 'superadmin']) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 353 | features/llm/scribeRoutes.ts:566 | POST | /session | requireRoles(['clinician', 'admin', 'superadmin']) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 354 | features/llm/scribeRoutes.ts:611 | PATCH | /session/:id | requireRoles(['clinician', 'admin', 'superadmin']) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 355 | features/llm/scribeRoutes.ts:690 | GET | /session/:id | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
| 356 | features/llm/scribeRoutes.ts:719 | POST | /session/:id/scan | requireRoles(['clinician', 'admin', 'superadmin']) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 357 | features/llm/scribeRoutes.ts:744 | GET | /sensitive-flags | requireRoles(['admin', 'superadmin']) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 358 | features/llm/scribeRoutes.ts:771 | PATCH | /sensitive-flags/:id/review | requireRoles(['admin', 'superadmin']) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 359 | features/llm/scribeRoutes.ts:814 | POST | /session/:id/action-items | requireRoles(['clinician', 'admin', 'superadmin']) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 360 | features/llm/scribeRoutes.ts:847 | GET | /session/:id/action-items | — | async (req: Request, res: Response, next: NextFunction) => {     tr... | no middleware |
| 361 | features/llm/scribeRoutes.ts:870 | PATCH | /action-items/:id/review | requireRoles(['clinician', 'admin', 'superadmin']) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 362 | features/llm/scribeRoutes.ts:897 | PATCH | /action-items/:id/link | requireRoles(['clinician', 'admin', 'superadmin']) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 363 | features/llm/scribeRoutes.ts:934 | PUT | /session/:id/talk-time | requireRoles(['clinician', 'admin', 'superadmin']) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 364 | features/llm/scribeRoutes.ts:982 | GET | /session/:id/talk-time | — | async (req: Request, res: Response, next: NextFunction) => {     tr... | no middleware |
| 365 | features/llm/scribeRoutes.ts:1012 | GET | /note-templates | — | async (req: Request, res: Response, next: NextFunction) => {     tr... | no middleware |
| 366 | features/llm/scribeRoutes.ts:1047 | POST | /note-templates | requireRoles(['admin', 'superadmin']) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 367 | features/llm/scribeRoutes.ts:1086 | POST | /search | — | async (req: Request, res: Response, next: NextFunction) => {     tr... | no middleware |
| 368 | features/llm/streamingTranscribeRoutes.ts:36 | POST | /stream-chunk | upload.single('audio') | async (req: Request, res: Response, next: NextFunction) => {   if (... | — |
| 369 | features/llm/streamingTranscribeRoutes.ts:98 | POST | /stream-final | upload.single('audio') | async (req: Request, res: Response, _next: NextFunction) => {   con... | — |
## medications

| # | File:Line | Verb | Path | Middleware Chain | Handler | Notes |
|---|---|---|---|---|---|---|
| 370 | features/medications/medicationRoutes.ts:22 | GET | /patients/:patientId/medications | requireRoles(['clinician', 'admin', 'manager', ... | listMedications | — |
| 371 | features/medications/medicationRoutes.ts:29 | GET | /:id | requireRoles(['clinician', 'admin', 'manager', ... | getMedication | — |
| 372 | features/medications/medicationRoutes.ts:38 | POST | / | requireRoles(['clinician', 'superadmin']), idempotencyMiddleware() | createMedication | — |
| 373 | features/medications/medicationRoutes.ts:46 | PATCH | /:id | requireRoles(['clinician', 'superadmin']) | updateMedication | — |
| 374 | features/medications/medicationRoutes.ts:53 | POST | /:id/cease | requireRoles(['clinician', 'superadmin']) | ceaseMedication | — |
| 375 | features/medications/medicationRoutes.ts:60 | DELETE | /:id | requireRoles(['superadmin']) | deleteMedication | — |
## messaging

| # | File:Line | Verb | Path | Middleware Chain | Handler | Notes |
|---|---|---|---|---|---|---|
| 376 | features/messaging/messageRoutes.ts:26 | POST | /threads | — | ctrl.createThread | no middleware |
| 377 | features/messaging/messageRoutes.ts:27 | GET | /threads | — | ctrl.listThreads | no middleware |
| 378 | features/messaging/messageRoutes.ts:28 | GET | /threads/:threadId | — | ctrl.getThread | no middleware |
| 379 | features/messaging/messageRoutes.ts:31 | POST | / | — | ctrl.sendMessage | no middleware |
| 380 | features/messaging/messageRoutes.ts:32 | POST | /threads/:threadId/messages | — | ctrl.sendMessage | no middleware |
| 381 | features/messaging/messageRoutes.ts:35 | GET | /inbox | — | ctrl.getInbox | no middleware |
| 382 | features/messaging/messageRoutes.ts:36 | PATCH | /:messageId/read | — | ctrl.markAsRead | no middleware |
| 383 | features/messaging/messageRoutes.ts:39 | POST | /send-email | — | async (req: Request, res: Response, next: NextFunction) => {   let ... | no middleware |
## mobile-sync

| # | File:Line | Verb | Path | Middleware Chain | Handler | Notes |
|---|---|---|---|---|---|---|
| 384 | features/mobile-sync/mobileSyncRoutes.ts:48 | GET | /sync | — | async (req: Request, res: Response, next: NextFunction) => {     tr... | no middleware |
| 385 | features/mobile-sync/mobileSyncRoutes.ts:187 | POST | /fcm/register-device | — | async (req: Request, res: Response, next: NextFunction) => {     tr... | no middleware |
| 386 | features/mobile-sync/mobileSyncRoutes.ts:229 | DELETE | /fcm/register-device/:token | — | async (req: Request, res: Response, next: NextFunction) => {     tr... | no middleware |
## notifications

| # | File:Line | Verb | Path | Middleware Chain | Handler | Notes |
|---|---|---|---|---|---|---|
| 387 | features/notifications/notificationRoutes.ts:32 | GET | / | requirePermission('notification:read') | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 388 | features/notifications/notificationRoutes.ts:59 | POST | /:id/read | requirePermission('notification:update') | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 389 | features/notifications/notificationRoutes.ts:75 | POST | /read-all | requirePermission('notification:update') | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 390 | features/notifications/notificationRoutes.ts:90 | POST | /read | requirePermission('notification:update') | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 391 | features/notifications/notificationRoutes.ts:108 | DELETE | /:id | requirePermission('notification:delete') | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
## obs-gyne

| # | File:Line | Verb | Path | Middleware Chain | Handler | Notes |
|---|---|---|---|---|---|---|
| 392 | features/obs-gyne/obsGyneRoutes.ts:30 | GET | /patients/:patientId/pregnancies | requirePermission('note:read') | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 393 | features/obs-gyne/obsGyneRoutes.ts:41 | POST | /patients/:patientId/pregnancies | requirePermission('note:create') | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 394 | features/obs-gyne/obsGyneRoutes.ts:58 | GET | /pregnancies/:pregnancyId/visits | requirePermission('note:read') | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 395 | features/obs-gyne/obsGyneRoutes.ts:72 | POST | /pregnancies/:pregnancyId/visits | requirePermission('note:create') | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
## oncology

| # | File:Line | Verb | Path | Middleware Chain | Handler | Notes |
|---|---|---|---|---|---|---|
| 396 | features/oncology/oncologyRoutes.ts:173 | GET | /patients/:patientId/conditions | — | async (req: Request, res: Response, next: NextFunction) => {     tr... | no middleware |
| 397 | features/oncology/oncologyRoutes.ts:186 | POST | /conditions | requireModuleWrite(MODULE_KEYS.ONCOLOGY) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 398 | features/oncology/oncologyRoutes.ts:200 | GET | /conditions/:conditionId/stage-groups | — | async (req: Request, res: Response, next: NextFunction) => {     tr... | no middleware |
| 399 | features/oncology/oncologyRoutes.ts:210 | POST | /stage-groups | requireModuleWrite(MODULE_KEYS.ONCOLOGY) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 400 | features/oncology/oncologyRoutes.ts:224 | GET | /patients/:patientId/ecog | — | async (req: Request, res: Response, next: NextFunction) => {     tr... | no middleware |
| 401 | features/oncology/oncologyRoutes.ts:234 | POST | /ecog | requireModuleWrite(MODULE_KEYS.ONCOLOGY) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 402 | features/oncology/oncologyRoutes.ts:248 | GET | /conditions/:conditionId/treatment-plans | — | async (req: Request, res: Response, next: NextFunction) => {     tr... | no middleware |
| 403 | features/oncology/oncologyRoutes.ts:258 | POST | /treatment-plans | requireModuleWrite(MODULE_KEYS.ONCOLOGY) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 404 | features/oncology/oncologyRoutes.ts:272 | GET | /treatment-plans/:planId/cycles | — | async (req: Request, res: Response, next: NextFunction) => {     tr... | no middleware |
| 405 | features/oncology/oncologyRoutes.ts:282 | POST | /cycles | requireModuleWrite(MODULE_KEYS.ONCOLOGY) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 406 | features/oncology/oncologyRoutes.ts:296 | GET | /conditions/:conditionId/tumour-board | — | async (req: Request, res: Response, next: NextFunction) => {     tr... | no middleware |
| 407 | features/oncology/oncologyRoutes.ts:306 | POST | /tumour-board | requireModuleWrite(MODULE_KEYS.ONCOLOGY) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
## other

| # | File:Line | Verb | Path | Middleware Chain | Handler | Notes |
|---|---|---|---|---|---|---|
| 408 | middleware/idempotencyMiddleware.ts:88 | POST | /medications | idempotencyMiddleware() | createMedication | — |
| 409 | middleware/optimisticLockMiddleware.ts:10 | PATCH | /:id | optimisticLock('clinical_notes') | handler | — |
## outcomes

| # | File:Line | Verb | Path | Middleware Chain | Handler | Notes |
|---|---|---|---|---|---|---|
| 410 | features/outcomes/outcomeRoutes.ts:80 | GET | /definitions | requireRoles(CLINICIAN_ROLES) | (_req: Request, res: Response) => {   res.json({ honos: HONOS_ITEMS... | — |
| 411 | features/outcomes/outcomeRoutes.ts:85 | GET | /patient/:patientId | requireRoles(CLINICIAN_ROLES) | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 412 | features/outcomes/outcomeRoutes.ts:111 | GET | /patient/:patientId/graph | requireRoles(CLINICIAN_ROLES) | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 413 | features/outcomes/outcomeRoutes.ts:124 | POST | / | requireRoles(CLINICIAN_ROLES) | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 414 | features/outcomes/outcomeRoutes.ts:176 | POST | /:id/sign | requireRoles(CLINICIAN_ROLES) | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
## paediatrics

| # | File:Line | Verb | Path | Middleware Chain | Handler | Notes |
|---|---|---|---|---|---|---|
| 415 | features/paediatrics/paediatricsRoutes.ts:33 | GET | /patients/:patientId/growth | requirePermission('note:read') | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 416 | features/paediatrics/paediatricsRoutes.ts:47 | POST | /patients/:patientId/growth | requirePermission('note:create') | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 417 | features/paediatrics/paediatricsRoutes.ts:68 | GET | /patients/:patientId/immunizations | requirePermission('note:read') | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 418 | features/paediatrics/paediatricsRoutes.ts:82 | POST | /patients/:patientId/immunizations | requirePermission('note:create') | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 419 | features/paediatrics/paediatricsRoutes.ts:103 | GET | /patients/:patientId/milestones | requirePermission('note:read') | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 420 | features/paediatrics/paediatricsRoutes.ts:117 | POST | /patients/:patientId/milestones | requirePermission('note:create') | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
## pathology

| # | File:Line | Verb | Path | Middleware Chain | Handler | Notes |
|---|---|---|---|---|---|---|
| 421 | features/pathology/pathologyRoutes.ts:14 | GET | /patient/:patientId | — | async (req, res, next) => {   try {     const { db } = await import... | no middleware |
| 422 | features/pathology/pathologyRoutes.ts:24 | POST | /orders | requireRole('clinician', 'admin', 'superadmin') | ctrl.placeOrder | — |
| 423 | features/pathology/pathologyRoutes.ts:25 | GET | /patients/:patientId/orders | — | ctrl.listOrders | no middleware |
| 424 | features/pathology/pathologyRoutes.ts:26 | GET | /orders/:id | — | ctrl.getOrder | no middleware |
| 425 | features/pathology/pathologyRoutes.ts:29 | POST | /results | requireRole('clinician', 'superadmin') | ctrl.ingestResult | — |
| 426 | features/pathology/pathologyRoutes.ts:32 | GET | /results/critical | — | ctrl.listCriticalUnacknowledged | no middleware |
| 427 | features/pathology/pathologyRoutes.ts:33 | POST | /results/:resultId/acknowledge | — | ctrl.acknowledgeCritical | no middleware |
## patient-app

| # | File:Line | Verb | Path | Middleware Chain | Handler | Notes |
|---|---|---|---|---|---|---|
| 428 | features/patient-app/patientAppRoutes.ts:182 | POST | /invite/:patientId | authMiddleware, tenantMiddleware | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 429 | features/patient-app/patientAppRoutes.ts:222 | GET | /invite/:patientId | authMiddleware, tenantMiddleware | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 430 | features/patient-app/patientAppRoutes.ts:254 | POST | /activate | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
| 431 | features/patient-app/patientAppRoutes.ts:336 | POST | /login | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
| 432 | features/patient-app/patientAppRoutes.ts:443 | GET | /me | authMiddleware | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 433 | features/patient-app/patientAppRoutes.ts:466 | POST | /tracking | authMiddleware | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 434 | features/patient-app/patientAppRoutes.ts:500 | GET | /tracking/:patientId | authMiddleware | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 435 | features/patient-app/patientAppRoutes.ts:532 | PATCH | /tracking/:entryId | authMiddleware | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 436 | features/patient-app/patientAppRoutes.ts:544 | DELETE | /tracking/:entryId | authMiddleware | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 437 | features/patient-app/patientAppRoutes.ts:553 | GET | /med-reminders/:patientId | authMiddleware | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 438 | features/patient-app/patientAppRoutes.ts:566 | POST | /med-reminders/:patientId | authMiddleware, tenantMiddleware | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 439 | features/patient-app/patientAppRoutes.ts:580 | DELETE | /med-reminders/:patientId/:reminderId | authMiddleware, tenantMiddleware | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 440 | features/patient-app/patientAppRoutes.ts:589 | GET | /shared-docs/:patientId | authMiddleware | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 441 | features/patient-app/patientAppRoutes.ts:601 | POST | /shared-docs/:patientId | authMiddleware, tenantMiddleware | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 442 | features/patient-app/patientAppRoutes.ts:616 | GET | /triage/:patientId | authMiddleware | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 443 | features/patient-app/patientAppRoutes.ts:623 | PUT | /triage/:patientId | authMiddleware, tenantMiddleware | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 444 | features/patient-app/patientAppRoutes.ts:634 | PATCH | /appointment-response/:appointmentId | authMiddleware | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 445 | features/patient-app/patientAppRoutes.ts:647 | GET | /thresholds/:patientId | authMiddleware | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 446 | features/patient-app/patientAppRoutes.ts:657 | POST | /thresholds/:patientId | authMiddleware, tenantMiddleware | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 447 | features/patient-app/patientAppRoutes.ts:677 | DELETE | /thresholds/:patientId/:thresholdId | authMiddleware, tenantMiddleware | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 448 | features/patient-app/patientAppRoutes.ts:687 | GET | /threshold-check/:patientId | authMiddleware | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 449 | features/patient-app/patientAppRoutes.ts:734 | GET | /self-rating-templates | authMiddleware | async (_req: Request, res: Response, next: NextFunction) => {   try... | — |
| 450 | features/patient-app/patientAppRoutes.ts:745 | POST | /assessments/:patientId/assign | authMiddleware, tenantMiddleware | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 451 | features/patient-app/patientAppRoutes.ts:774 | GET | /assessments/:patientId | authMiddleware | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 452 | features/patient-app/patientAppRoutes.ts:785 | PATCH | /assessments/:patientId/:assessmentId/complete | authMiddleware | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 453 | features/patient-app/patientAppRoutes.ts:807 | GET | /tasks/:patientId | authMiddleware | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 454 | features/patient-app/patientAppRoutes.ts:817 | POST | /tasks/:patientId | authMiddleware | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 455 | features/patient-app/patientAppRoutes.ts:841 | PATCH | /tasks/:patientId/:taskId | authMiddleware | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 456 | features/patient-app/patientAppRoutes.ts:854 | GET | /checklists/:patientId | authMiddleware | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 457 | features/patient-app/patientAppRoutes.ts:864 | POST | /checklists/:patientId | authMiddleware, tenantMiddleware | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 458 | features/patient-app/patientAppRoutes.ts:877 | PATCH | /checklists/:patientId/:checklistId | authMiddleware | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 459 | features/patient-app/patientAppRoutes.ts:901 | POST | /fcm/register-device | authMiddleware | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 460 | features/patient-app/patientAppRoutes.ts:958 | DELETE | /fcm/register-device/:token | authMiddleware | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 461 | features/patient-app/patientAppRoutes.ts:987 | GET | /sync-preferences | authMiddleware | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 462 | features/patient-app/patientAppRoutes.ts:1017 | PATCH | /sync-preferences | authMiddleware | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 463 | features/patient-app/patientAppRoutes.ts:1095 | GET | /mobile-sync | authMiddleware | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
## patient-outreach

| # | File:Line | Verb | Path | Middleware Chain | Handler | Notes |
|---|---|---|---|---|---|---|
| 464 | features/patient-outreach/patientOutreachRoutes.ts:40 | GET | /delivery-profile/:patientId | requirePermission('patient:read') | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 465 | features/patient-outreach/patientOutreachRoutes.ts:69 | POST | /delivery-profile/:patientId/consent | requirePermission('patient:update') | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 466 | features/patient-outreach/patientOutreachRoutes.ts:112 | POST | /send | requirePermission('note:create') | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 467 | features/patient-outreach/patientOutreachRoutes.ts:137 | GET | /logs/:patientId | requirePermission('patient:read') | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
## patients

| # | File:Line | Verb | Path | Middleware Chain | Handler | Notes |
|---|---|---|---|---|---|---|
| 468 | features/patients/duplicateRoutes.ts:52 | POST | /patients/duplicates/check | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
| 469 | features/patients/duplicateRoutes.ts:73 | POST | /patients/:id/merge | requireRoles(['admin', 'superadmin']) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 470 | features/patients/duplicateRoutes.ts:164 | GET | /patients/:id/merges | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
| 471 | features/patients/patientRoutes.ts:187 | GET | / | — | patientController.list | no middleware |
| 472 | features/patients/patientRoutes.ts:190 | GET | /team-assignments | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
| 473 | features/patients/patientRoutes.ts:269 | PATCH | /team-assignments/:patientId | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
| 474 | features/patients/patientRoutes.ts:284 | GET | /attachment-counts | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
| 475 | features/patients/patientRoutes.ts:304 | GET | /review-status | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
| 476 | features/patients/patientRoutes.ts:372 | POST | /:id/attachments | upload.array('files', 10) | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 477 | features/patients/patientRoutes.ts:453 | GET | /:id/attachments | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
| 478 | features/patients/patientRoutes.ts:466 | POST | /:id/pathology | upload.single('file') | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 479 | features/patients/patientRoutes.ts:628 | GET | /:id/pathology | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
| 480 | features/patients/patientRoutes.ts:665 | GET | /:id/notes | requireClinicalRole | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 481 | features/patients/patientRoutes.ts:703 | POST | /:id/notes | idempotencyMiddleware() | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 482 | features/patients/patientRoutes.ts:746 | PATCH | /:id/notes/:noteId | optimisticLock('clinical_notes', 'noteId') | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 483 | features/patients/patientRoutes.ts:792 | GET | /legal-order-types | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
| 484 | features/patients/patientRoutes.ts:800 | GET | /:id/legal-orders | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
| 485 | features/patients/patientRoutes.ts:831 | POST | /:id/legal-orders | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
| 486 | features/patients/patientRoutes.ts:852 | PATCH | /legal-orders/:orderId | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
| 487 | features/patients/patientRoutes.ts:867 | POST | /:id/legal-attachments | upload.array('files', 5) | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 488 | features/patients/patientRoutes.ts:902 | GET | /:id/legal-attachments | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
| 489 | features/patients/patientRoutes.ts:913 | GET | /alert-types | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
| 490 | features/patients/patientRoutes.ts:921 | GET | /:id/alerts | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
| 491 | features/patients/patientRoutes.ts:959 | POST | /:id/alerts | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
| 492 | features/patients/patientRoutes.ts:977 | PATCH | /alerts/:alertId | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
| 493 | features/patients/patientRoutes.ts:995 | POST | /alerts/:alertId/attachments | upload.array('files', 5) | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 494 | features/patients/patientRoutes.ts:1030 | GET | /:id/flags | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
| 495 | features/patients/patientRoutes.ts:1044 | GET | /hotspots | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
| 496 | features/patients/patientRoutes.ts:1070 | POST | /:id/hotspot | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
| 497 | features/patients/patientRoutes.ts:1090 | PATCH | /hotspots/:hotspotId | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
| 498 | features/patients/patientRoutes.ts:1113 | GET | /admission-waitlist | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
| 499 | features/patients/patientRoutes.ts:1135 | POST | /:id/flag-for-admission | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
| 500 | features/patients/patientRoutes.ts:1195 | PATCH | /admission-waitlist/:entryId | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
| 501 | features/patients/patientRoutes.ts:1217 | PATCH | /admission-waitlist/:entryId/remove | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
| 502 | features/patients/patientRoutes.ts:1255 | POST | /admission-waitlist/:entryId/admit | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
| 503 | features/patients/patientRoutes.ts:1265 | GET | /:id/contacts | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
| 504 | features/patients/patientRoutes.ts:1290 | POST | /:id/contacts | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
| 505 | features/patients/patientRoutes.ts:1317 | PATCH | /contacts/:contactId | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
| 506 | features/patients/patientRoutes.ts:1333 | DELETE | /contacts/:contactId | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
| 507 | features/patients/patientRoutes.ts:1341 | GET | /:id/diagnoses | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
| 508 | features/patients/patientRoutes.ts:1366 | GET | /:id/providers | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
| 509 | features/patients/patientRoutes.ts:1383 | POST | /:id/providers | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
| 510 | features/patients/patientRoutes.ts:1407 | DELETE | /providers/:providerId | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
| 511 | features/patients/patientRoutes.ts:1419 | GET | /:id/active-specialties | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
| 512 | features/patients/patientRoutes.ts:1444 | GET | /:id | — | patientController.getById | no middleware |
| 513 | features/patients/patientRoutes.ts:1445 | PATCH | /:id | — | patientController.update | no middleware |
| 514 | features/patients/patientRoutes.ts:1446 | POST | / | — | patientController.create | no middleware |
| 515 | features/patients/patientRoutes.ts:1447 | PUT | /:id | — | patientController.update | no middleware |
| 516 | features/patients/patientRoutes.ts:1448 | DELETE | /:id | — | patientController.softDelete | no middleware |
| 517 | features/patients/zitaviSyncRoutes.ts:103 | POST | /zitavi-sync | requireRoles(['superadmin', 'admin']) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 518 | features/patients/zitaviSyncRoutes.ts:145 | POST | /zitavi-sync/:zitaviId | requireRoles(['superadmin', 'admin', 'clinician']) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 519 | features/patients/zitaviSyncRoutes.ts:164 | GET | /zitavi-proxy/* | — | async (req: Request, res: Response) => {   try {     const proxyPat... | no middleware |
## prescriptions

| # | File:Line | Verb | Path | Middleware Chain | Handler | Notes |
|---|---|---|---|---|---|---|
| 520 | features/prescriptions/prescriptionRoutes.ts:38 | GET | /patients/:patientId/prescriptions | clinician | listPrescriptions | — |
| 521 | features/prescriptions/prescriptionRoutes.ts:43 | POST | / | prescriber, idempotencyMiddleware() | createPrescription | — |
| 522 | features/prescriptions/prescriptionRoutes.ts:46 | GET | /erx/status | clinician | getErxStatus | — |
| 523 | features/prescriptions/prescriptionRoutes.ts:47 | POST | /erx/poll-dispense | adminOnly | pollDispenseNotifications | — |
| 524 | features/prescriptions/prescriptionRoutes.ts:50 | GET | /mysl/status | clinician | getMySLConfigStatus | — |
| 525 | features/prescriptions/prescriptionRoutes.ts:51 | GET | /mysl/patient/:ihi | clinician | getMySLStatus | — |
| 526 | features/prescriptions/prescriptionRoutes.ts:52 | POST | /mysl/consent | prescriber | postMySLConsentRequest | — |
| 527 | features/prescriptions/prescriptionRoutes.ts:53 | GET | /mysl/scripts/:patientFhirId | clinician | getMySLScripts | — |
| 528 | features/prescriptions/prescriptionRoutes.ts:56 | GET | /hi/status | clinician | getHiServiceStatus | — |
| 529 | features/prescriptions/prescriptionRoutes.ts:57 | POST | /hi/verify-ihi | prescriber | postVerifyIhi | — |
| 530 | features/prescriptions/prescriptionRoutes.ts:58 | POST | /hi/search-ihi | prescriber | postSearchIhi | — |
| 531 | features/prescriptions/prescriptionRoutes.ts:62 | GET | /:id | clinician | getPrescription | — |
| 532 | features/prescriptions/prescriptionRoutes.ts:63 | POST | /:id/safescript-check | prescriber | runSafeScriptCheck | — |
| 533 | features/prescriptions/prescriptionRoutes.ts:64 | POST | /:id/submit-erx | prescriber | submitErx | — |
| 534 | features/prescriptions/prescriptionRoutes.ts:65 | POST | /:id/cancel | prescriber | cancelPrescription | — |
| 535 | features/prescriptions/prescriptionRoutes.ts:66 | POST | /:id/deliver-token | prescriber | postDeliverToken | — |
## privacy

| # | File:Line | Verb | Path | Middleware Chain | Handler | Notes |
|---|---|---|---|---|---|---|
| 536 | features/privacy/privacyRoutes.ts:85 | GET | /patient/:patientId/export | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
| 537 | features/privacy/privacyRoutes.ts:110 | POST | /patient/:patientId/anonymise | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
| 538 | features/privacy/privacyRoutes.ts:143 | GET | /consent/:patientId | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
| 539 | features/privacy/privacyRoutes.ts:153 | POST | /consent | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
| 540 | features/privacy/privacyRoutes.ts:174 | GET | /retention | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
| 541 | features/privacy/privacyRoutes.ts:184 | GET | /breaches | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
| 542 | features/privacy/privacyRoutes.ts:194 | POST | /breaches | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
| 543 | features/privacy/privacyRoutes.ts:217 | GET | /data-sharing-agreements | — | async (req: Request, res: Response, _next: NextFunction) => {   try... | no middleware |
| 544 | features/privacy/privacyRoutes.ts:229 | POST | /data-sharing-agreements | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
## reallocations

| # | File:Line | Verb | Path | Middleware Chain | Handler | Notes |
|---|---|---|---|---|---|---|
| 545 | features/reallocations/reallocationRoutes.ts:49 | POST | / | requireModuleWrite(MODULE_KEYS.PATIENT_ALLOCATI... | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 546 | features/reallocations/reallocationRoutes.ts:69 | GET | /pending | requireModuleRead(MODULE_KEYS.PATIENT_ALLOCATIONS) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 547 | features/reallocations/reallocationRoutes.ts:81 | POST | /:id/approve | requireModuleWrite(MODULE_KEYS.PATIENT_ALLOCATI... | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 548 | features/reallocations/reallocationRoutes.ts:97 | POST | /:id/reject | requireModuleWrite(MODULE_KEYS.PATIENT_ALLOCATI... | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
## referrals

| # | File:Line | Verb | Path | Middleware Chain | Handler | Notes |
|---|---|---|---|---|---|---|
| 549 | features/referrals/referralRoutes.ts:22 | GET | / | — | (req, res, next) => referralController.list(req, res, next) | no middleware |
| 550 | features/referrals/referralRoutes.ts:31 | GET | /queue | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
| 551 | features/referrals/referralRoutes.ts:52 | POST | /:id/triage | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
| 552 | features/referrals/referralRoutes.ts:76 | POST | /:id/assign | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
| 553 | features/referrals/referralRoutes.ts:103 | POST | /:id/accept | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
| 554 | features/referrals/referralRoutes.ts:122 | POST | /:id/decline | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
| 555 | features/referrals/referralRoutes.ts:144 | POST | /:id/notes | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
| 556 | features/referrals/referralRoutes.ts:170 | GET | /:id/notes | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
| 557 | features/referrals/referralRoutes.ts:190 | GET | /my-offers | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
| 558 | features/referrals/referralRoutes.ts:202 | GET | /:id | — | (req, res, next) => referralController.getById(req, res, next) | no middleware |
| 559 | features/referrals/referralRoutes.ts:204 | POST | / | idempotencyMiddleware() | (req, res, next) => referralController.create(req, res, next) | — |
| 560 | features/referrals/referralRoutes.ts:205 | PATCH | /:id | — | (req, res, next) => referralController.update(req, res, next) | no middleware |
| 561 | features/referrals/referralRoutes.ts:207 | PATCH | /by-episode/:episodeId | — | async (req, res, next) => {   try {     // Phase 0.7.5 c24 D8 (SD44... | no middleware |
| 562 | features/referrals/referralRoutes.ts:224 | POST | /:id/decision | — | (req, res, next) =>   referralController.decide(req, res, next) | no middleware |
| 563 | features/referrals/referralRoutes.ts:227 | POST | /:id/attachments | multerUpload.single('file') | (req, res, next) => referralController.uploadAttachment(req, res, n... | — |
| 564 | features/referrals/referralRoutes.ts:232 | GET | /:id/ocr-preview | — | (req, res, next) =>   referralController.getOcrPreview(req, res, next) | no middleware |
| 565 | features/referrals/referralRoutes.ts:235 | GET | /:id/ocr-fields | — | (req, res, next) =>   referralController.getOcrFields(req, res, next) | no middleware |
| 566 | features/referrals/referralRoutes.ts:238 | POST | /:id/ocr-confirm | — | (req, res, next) =>   referralController.confirmOcrData(req, res, n... | no middleware |
| 567 | features/referrals/referralRoutes.ts:253 | POST | /:id/allocate | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
| 568 | features/referrals/referralRoutes.ts:351 | POST | /:id/broadcast | requireRole('admin', 'receptionist', 'clinician') | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 569 | features/referrals/referralRoutes.ts:374 | GET | /:id/offers | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
| 570 | features/referrals/referralRoutes.ts:394 | POST | /:id/offers/:offerId/respond | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
| 571 | features/referrals/referralRoutes.ts:411 | POST | /:id/clarification | requireRole('clinician', 'admin', 'receptionist') | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 572 | features/referrals/referralRoutes.ts:437 | PATCH | /:id/clarification-response | requireRole('admin', 'receptionist') | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 573 | features/referrals/referralRoutes.ts:462 | GET | /:id/feedback-log | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
## reports

| # | File:Line | Verb | Path | Middleware Chain | Handler | Notes |
|---|---|---|---|---|---|---|
| 574 | features/reports/complianceDashboardRoutes.ts:81 | GET | /compliance/summary | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
| 575 | features/reports/reportsRoutes.ts:46 | GET | / | — | async (req, res, next) => {   try {     const { db } = await import... | no middleware |
| 576 | features/reports/reportsRoutes.ts:58 | GET | /filters/clinicians | — | (req, res, next) =>   reportsController.getCliniciansForFilter(req,... | no middleware |
| 577 | features/reports/reportsRoutes.ts:62 | GET | /encounters | — | (req, res, next) =>   reportsController.getEncounterReport(req, res... | no middleware |
| 578 | features/reports/reportsRoutes.ts:66 | GET | /outcomes/dashboard | — | (req, res, next) =>   reportsController.getOutcomeDashboard(req, re... | no middleware |
| 579 | features/reports/reportsRoutes.ts:70 | POST | /generate | — | (req, res, next) =>   reportsController.generateReport(req, res, next) | no middleware |
| 580 | features/reports/reportsRoutes.ts:74 | GET | /:id/download | — | (req, res, next) =>   reportsController.downloadReport(req, res, next) | no middleware |
| 581 | features/reports/reportsRoutes.ts:82 | GET | /admin-overview | governanceRoleGate | async (req, res, next) => {   try {     const { db } = await import... | — |
| 582 | features/reports/reportsRoutes.ts:238 | GET | /clinical-alerts | — | async (req, res, next) => {   try {     const { db } = await import... | no middleware |
| 583 | features/reports/reportsRoutes.ts:410 | GET | /caseload-by-team | — | async (req, res, next) => {   try {     const { db } = await import... | no middleware |
| 584 | features/reports/reportsRoutes.ts:454 | GET | /audit-templates | governanceRoleGate | async (req, res, next) => {   try {     const { db } = await import... | — |
| 585 | features/reports/reportsRoutes.ts:478 | POST | /audit-templates | governanceRoleGate | async (req, res, next) => {   try {     const { db } = await import... | — |
| 586 | features/reports/reportsRoutes.ts:494 | POST | /audit-runs | governanceRoleGate | async (req, res, next) => {   try {     const { db } = await import... | — |
| 587 | features/reports/reportsRoutes.ts:581 | GET | /audit-runs/:id | governanceRoleGate | async (req, res, next) => {   try {     const { db } = await import... | — |
| 588 | features/reports/reportsRoutes.ts:595 | GET | /audit-runs | governanceRoleGate | async (req, res, next) => {   try {     const { db } = await import... | — |
## risk

| # | File:Line | Verb | Path | Middleware Chain | Handler | Notes |
|---|---|---|---|---|---|---|
| 589 | features/risk/risk.routes.ts:28 | POST | / | — | (inline) | no middleware |
## roles

| # | File:Line | Verb | Path | Middleware Chain | Handler | Notes |
|---|---|---|---|---|---|---|
| 590 | features/roles/caseManagerFeatureRoutes.ts:58 | GET | /dashboard/caseload | requireRoles([...CASE_MANAGER_ROLES]) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 591 | features/roles/caseManagerFeatureRoutes.ts:102 | GET | /dashboard/days-since-contact | requireRoles([...CASE_MANAGER_ROLES]) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 592 | features/roles/caseManagerFeatureRoutes.ts:140 | GET | /care-plans/:planId/goals | requireRoles([...CASE_MANAGER_ROLES]) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 593 | features/roles/caseManagerFeatureRoutes.ts:155 | POST | /care-plans/:planId/goals | requireRoles([...CASE_MANAGER_ROLES]) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 594 | features/roles/caseManagerFeatureRoutes.ts:190 | PUT | /care-plans/:planId/goals/:goalId | requireRoles([...CASE_MANAGER_ROLES]) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 595 | features/roles/caseManagerFeatureRoutes.ts:222 | DELETE | /care-plans/:planId/goals/:goalId | requireRoles([...CASE_MANAGER_ROLES]) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 596 | features/roles/caseManagerFeatureRoutes.ts:238 | GET | /care-plans/:planId/goals/:goalId/interventions | requireRoles([...CASE_MANAGER_ROLES]) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 597 | features/roles/caseManagerFeatureRoutes.ts:253 | POST | /care-plans/:planId/goals/:goalId/interventions | requireRoles([...CASE_MANAGER_ROLES]) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 598 | features/roles/caseManagerFeatureRoutes.ts:288 | PUT | /care-plans/:planId/goals/:goalId/interventions/:interventionId | requireRoles([...CASE_MANAGER_ROLES]) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 599 | features/roles/caseManagerFeatureRoutes.ts:320 | DELETE | /care-plans/:planId/goals/:goalId/interventions/:interventionId | requireRoles([...CASE_MANAGER_ROLES]) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 600 | features/roles/caseManagerFeatureRoutes.ts:336 | GET | /care-plans/:planId/transition-checklist | requireRoles([...CASE_MANAGER_ROLES]) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 601 | features/roles/caseManagerFeatureRoutes.ts:364 | PUT | /care-plans/:planId/transition-checklist | requireRoles([...CASE_MANAGER_ROLES]) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 602 | features/roles/caseManagerFeatureRoutes.ts:392 | GET | /care-plans/:planId/recovery-star | requireRoles([...CASE_MANAGER_ROLES]) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 603 | features/roles/caseManagerFeatureRoutes.ts:419 | PUT | /care-plans/:planId/recovery-star | requireRoles([...CASE_MANAGER_ROLES]) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 604 | features/roles/caseManagerFeatureRoutes.ts:446 | GET | /community-resources | requireRoles([...CASE_MANAGER_ROLES]) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 605 | features/roles/caseManagerFeatureRoutes.ts:472 | POST | /community-resources | requireRoles([...CASE_MANAGER_ROLES]) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 606 | features/roles/caseManagerFeatureRoutes.ts:512 | PUT | /community-resources/:id | requireRoles([...CASE_MANAGER_ROLES]) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 607 | features/roles/caseManagerFeatureRoutes.ts:551 | DELETE | /community-resources/:id | requireRoles([...CASE_MANAGER_ROLES]) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 608 | features/roles/crossRoleFeatureRoutes.ts:15 | GET | /patients/:id/timeline | requireRoles([...CLINICAL_ROLES]) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 609 | features/roles/crossRoleFeatureRoutes.ts:126 | GET | /dashboard/clinical-alerts | requireRoles([...CLINICAL_ROLES]) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 610 | features/roles/crossRoleFeatureRoutes.ts:257 | POST | /patients/:id/photo | requireRoles([...CLINICAL_ROLES]), multerUpload.single('photo') | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 611 | features/roles/crossRoleFeatureRoutes.ts:309 | GET | /patients/:id/barcode | requireRoles([...CLINICAL_ROLES]) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 612 | features/roles/managerFeatureRoutes.ts:51 | GET | /reports/contacts-kpi | requireRoles([...MANAGER_ROLES]) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 613 | features/roles/managerFeatureRoutes.ts:95 | GET | /reports/staff-caseload | requireRoles([...MANAGER_ROLES]) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 614 | features/roles/managerFeatureRoutes.ts:130 | GET | /reports/dna-rates | requireRoles([...MANAGER_ROLES]) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 615 | features/roles/managerFeatureRoutes.ts:166 | GET | /reports/contacts-vs-booked | requireRoles([...MANAGER_ROLES]) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 616 | features/roles/managerFeatureRoutes.ts:195 | GET | /reports/bed-occupancy-trend | requireRoles([...MANAGER_ROLES]) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 617 | features/roles/managerFeatureRoutes.ts:248 | GET | /reports/workload-alerts | requireRoles([...MANAGER_ROLES]) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 618 | features/roles/managerFeatureRoutes.ts:297 | GET | /staff-leave | requireRoles([...MANAGER_ROLES]) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 619 | features/roles/managerFeatureRoutes.ts:319 | POST | /staff-leave | requireRoles([...MANAGER_ROLES]) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 620 | features/roles/managerFeatureRoutes.ts:348 | PUT | /staff-leave/:id | requireRoles([...MANAGER_ROLES]) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 621 | features/roles/managerFeatureRoutes.ts:378 | DELETE | /staff-leave/:id | requireRoles([...MANAGER_ROLES]) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 622 | features/roles/managerFeatureRoutes.ts:394 | GET | /report-schedules | requireRoles([...MANAGER_ROLES]) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 623 | features/roles/managerFeatureRoutes.ts:408 | POST | /report-schedules | requireRoles([...MANAGER_ROLES]) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 624 | features/roles/managerFeatureRoutes.ts:442 | PUT | /report-schedules/:id | requireRoles([...MANAGER_ROLES]) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 625 | features/roles/managerFeatureRoutes.ts:473 | DELETE | /report-schedules/:id | requireRoles([...MANAGER_ROLES]) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 626 | features/roles/nurseFeatureRoutes.ts:83 | GET | /medications/mar/:patientId | requireRoles([...NURSE_ROLES]) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 627 | features/roles/nurseFeatureRoutes.ts:137 | POST | /medication-administrations | requireRoles([...NURSE_ROLES]) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 628 | features/roles/nurseFeatureRoutes.ts:179 | GET | /medications/due-now | requireRoles([...NURSE_ROLES]) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 629 | features/roles/nurseFeatureRoutes.ts:222 | GET | /structured-observations | requireRoles([...NURSE_ROLES]) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 630 | features/roles/nurseFeatureRoutes.ts:250 | POST | /structured-observations | requireRoles([...NURSE_ROLES]) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 631 | features/roles/nurseFeatureRoutes.ts:295 | PUT | /structured-observations/:id | requireRoles([...NURSE_ROLES]) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 632 | features/roles/nurseFeatureRoutes.ts:338 | DELETE | /structured-observations/:id | requireRoles([...NURSE_ROLES]) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 633 | features/roles/nurseFeatureRoutes.ts:361 | GET | /shift-handovers/auto-summary | requireRoles([...NURSE_ROLES]) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 634 | features/roles/nurseFeatureRoutes.ts:431 | GET | /shift-handovers | requireRoles([...NURSE_ROLES]) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 635 | features/roles/nurseFeatureRoutes.ts:456 | POST | /shift-handovers | requireRoles([...NURSE_ROLES]) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 636 | features/roles/nurseFeatureRoutes.ts:502 | PUT | /shift-handovers/:id | requireRoles([...NURSE_ROLES]) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 637 | features/roles/nurseFeatureRoutes.ts:535 | DELETE | /shift-handovers/:id | requireRoles([...NURSE_ROLES]) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 638 | features/roles/nurseFeatureRoutes.ts:551 | GET | /nursing-assessments | requireRoles([...NURSE_ROLES]) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 639 | features/roles/nurseFeatureRoutes.ts:573 | POST | /nursing-assessments | requireRoles([...NURSE_ROLES]) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 640 | features/roles/nurseFeatureRoutes.ts:620 | PUT | /nursing-assessments/:id | requireRoles([...NURSE_ROLES]) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 641 | features/roles/nurseFeatureRoutes.ts:656 | DELETE | /nursing-assessments/:id | requireRoles([...NURSE_ROLES]) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 642 | features/roles/nurseFeatureRoutes.ts:680 | PATCH | /phone-triage/:id/clinical-triage | requireRoles([...NURSE_ROLES]) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 643 | features/roles/psychiatristFeatureRoutes.ts:57 | GET | /dashboard/my-clinic-today | requireRoles([...PSYCHIATRIST_ROLES]) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 644 | features/roles/psychiatristFeatureRoutes.ts:98 | POST | /medications/interaction-check | requireRoles([...PSYCHIATRIST_ROLES]) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 645 | features/roles/psychiatristFeatureRoutes.ts:187 | GET | /clinical-formulations | requireRoles([...PSYCHIATRIST_ROLES]) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 646 | features/roles/psychiatristFeatureRoutes.ts:226 | GET | /clinical-formulations/:id | requireRoles([...PSYCHIATRIST_ROLES]) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 647 | features/roles/psychiatristFeatureRoutes.ts:250 | POST | /clinical-formulations | requireRoles([...PSYCHIATRIST_ROLES]) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 648 | features/roles/psychiatristFeatureRoutes.ts:305 | PUT | /clinical-formulations/:id | requireRoles([...PSYCHIATRIST_ROLES]) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 649 | features/roles/psychiatristFeatureRoutes.ts:359 | DELETE | /clinical-formulations/:id | requireRoles([...PSYCHIATRIST_ROLES]) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 650 | features/roles/psychiatristFeatureRoutes.ts:388 | GET | /side-effect-schedules | requireRoles([...PSYCHIATRIST_ROLES]) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 651 | features/roles/psychiatristFeatureRoutes.ts:409 | POST | /side-effect-schedules | requireRoles([...PSYCHIATRIST_ROLES]) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 652 | features/roles/psychiatristFeatureRoutes.ts:443 | PUT | /side-effect-schedules/:id | requireRoles([...PSYCHIATRIST_ROLES]) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 653 | features/roles/psychiatristFeatureRoutes.ts:473 | DELETE | /side-effect-schedules/:id | requireRoles([...PSYCHIATRIST_ROLES]) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 654 | features/roles/psychiatristFeatureRoutes.ts:489 | POST | /voice/quick-memo | requireRoles([...PSYCHIATRIST_ROLES]), multerUpload.single('audio') | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 655 | features/roles/psychologistFeatureRoutes.ts:63 | GET | /psychology-session-notes | requireRoles([...CLINICAL_ROLES]) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 656 | features/roles/psychologistFeatureRoutes.ts:98 | GET | /psychology-session-notes/:id | requireRoles([...CLINICAL_ROLES]) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 657 | features/roles/psychologistFeatureRoutes.ts:121 | POST | /psychology-session-notes | requireRoles([...CLINICAL_ROLES]) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 658 | features/roles/psychologistFeatureRoutes.ts:156 | PATCH | /psychology-session-notes/:id | requireRoles([...CLINICAL_ROLES]) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 659 | features/roles/psychologistFeatureRoutes.ts:196 | DELETE | /psychology-session-notes/:id | requireRoles([...CLINICAL_ROLES]) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 660 | features/roles/receptionistFeatureRoutes.ts:101 | POST | /appointments/:id/check-in | requireRoles([...RECEPTIONIST_ROLES]) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 661 | features/roles/receptionistFeatureRoutes.ts:136 | POST | /patients/quick-register | requireRoles([...RECEPTIONIST_ROLES]) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 662 | features/roles/receptionistFeatureRoutes.ts:167 | GET | /waitlist/positions | requireRoles([...RECEPTIONIST_ROLES]) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 663 | features/roles/receptionistFeatureRoutes.ts:199 | GET | /phone-triage | requireRoles([...RECEPTIONIST_ROLES, ...NURSE_R... | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 664 | features/roles/receptionistFeatureRoutes.ts:229 | POST | /phone-triage | requireRoles([...RECEPTIONIST_ROLES]) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 665 | features/roles/receptionistFeatureRoutes.ts:265 | PUT | /phone-triage/:id | requireRoles([...RECEPTIONIST_ROLES]) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 666 | features/roles/receptionistFeatureRoutes.ts:290 | DELETE | /phone-triage/:id | requireRoles([...RECEPTIONIST_ROLES]) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
## routes

| # | File:Line | Verb | Path | Middleware Chain | Handler | Notes |
|---|---|---|---|---|---|---|
| 667 | routes/health.ts:14 | GET | /health | — | (_req: Request, res: Response): void => {   res.json({     status: ... | — |
| 668 | routes/health.ts:23 | GET | /ready | — | async (_req: Request, res: Response): Promise<void> => {     const ... | no middleware |
| 669 | routes/health.ts:208 | GET | /health/integrations | authMiddleware, requireRoles(['admin', 'superadmin']) | async (_req: Request, res: Response, next: NextFunction): Promise<v... | — |
## safety-plan

| # | File:Line | Verb | Path | Middleware Chain | Handler | Notes |
|---|---|---|---|---|---|---|
| 670 | features/safety-plan/safetyPlanRoutes.ts:26 | GET | /patient/:patientId | requireRoles(ROLES) | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 671 | features/safety-plan/safetyPlanRoutes.ts:55 | POST | / | requireRoles(ROLES) | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 672 | features/safety-plan/safetyPlanRoutes.ts:83 | PATCH | /:id | requireRoles(ROLES) | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 673 | features/safety-plan/safetyPlanRoutes.ts:116 | POST | /:id/sign | requireRoles(ROLES) | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
## settings

| # | File:Line | Verb | Path | Middleware Chain | Handler | Notes |
|---|---|---|---|---|---|---|
| 674 | features/settings/tabConfigRoutes.ts:30 | GET | /tab-config | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
| 675 | features/settings/tabConfigRoutes.ts:42 | PUT | /tab-config | requireRoles(['superadmin', 'admin']) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
## surgery

| # | File:Line | Verb | Path | Middleware Chain | Handler | Notes |
|---|---|---|---|---|---|---|
| 676 | features/surgery/surgeryRoutes.ts:37 | GET | /patients/:patientId/cases | requirePermission('note:read') | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 677 | features/surgery/surgeryRoutes.ts:48 | POST | /patients/:patientId/cases | requirePermission('note:create') | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 678 | features/surgery/surgeryRoutes.ts:65 | GET | /cases/:caseId/checklists | requirePermission('note:read') | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 679 | features/surgery/surgeryRoutes.ts:76 | POST | /cases/:caseId/checklists | requirePermission('note:create') | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 680 | features/surgery/surgeryRoutes.ts:93 | GET | /cases/:caseId/op-note | requirePermission('note:read') | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 681 | features/surgery/surgeryRoutes.ts:104 | POST | /cases/:caseId/op-note | requirePermission('note:create') | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 682 | features/surgery/surgeryRoutes.ts:121 | GET | /cases/:caseId/pacu | requirePermission('note:read') | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
| 683 | features/surgery/surgeryRoutes.ts:132 | POST | /cases/:caseId/pacu | requirePermission('note:create') | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
## tasks

| # | File:Line | Verb | Path | Middleware Chain | Handler | Notes |
|---|---|---|---|---|---|---|
| 684 | features/tasks/taskRoutes.ts:13 | POST | / | idempotencyMiddleware() | ctrl.createTask | — |
| 685 | features/tasks/taskRoutes.ts:14 | GET | / | — | ctrl.listTasks | no middleware |
| 686 | features/tasks/taskRoutes.ts:15 | GET | /:taskId | — | ctrl.getTask | no middleware |
| 687 | features/tasks/taskRoutes.ts:16 | PATCH | /:taskId | — | ctrl.updateTask | no middleware |
| 688 | features/tasks/taskRoutes.ts:17 | DELETE | /:taskId | — | ctrl.deleteTask | no middleware |
## telehealth

| # | File:Line | Verb | Path | Middleware Chain | Handler | Notes |
|---|---|---|---|---|---|---|
| 689 | features/telehealth/telehealthRoutes.ts:28 | POST | /appointments/:id/room | requireModuleWrite(MODULE_KEYS.TELEHEALTH) | async (req: Request, res: Response, next: NextFunction) => {     tr... | — |
## templates

| # | File:Line | Verb | Path | Middleware Chain | Handler | Notes |
|---|---|---|---|---|---|---|
| 690 | features/templates/template.routes.ts:12 | GET | / | — | ctrl.list | no middleware |
| 691 | features/templates/template.routes.ts:13 | GET | /:id | — | ctrl.getById | no middleware |
| 692 | features/templates/template.routes.ts:14 | POST | / | — | ctrl.create | no middleware |
| 693 | features/templates/template.routes.ts:15 | PATCH | /:id | — | ctrl.update | no middleware |
| 694 | features/templates/template.routes.ts:18 | PATCH | /:id/publish | — | ctrl.publish | no middleware |
| 695 | features/templates/template.routes.ts:19 | PATCH | /:id/retire | — | ctrl.retire | no middleware |
| 696 | features/templates/template.routes.ts:20 | DELETE | /:id | — | ctrl.softDelete | no middleware |
## tms

| # | File:Line | Verb | Path | Middleware Chain | Handler | Notes |
|---|---|---|---|---|---|---|
| 697 | features/tms/tmsRoutes.ts:38 | POST | /courses | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
| 698 | features/tms/tmsRoutes.ts:47 | POST | /courses/:courseId/sessions | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
| 699 | features/tms/tmsRoutes.ts:56 | GET | /patients/:patientId | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
| 700 | features/tms/tmsRoutes.ts:64 | GET | /courses/:courseId/sessions | — | async (req: Request, res: Response, next: NextFunction) => {   try ... | no middleware |
## treatment-pathways

| # | File:Line | Verb | Path | Middleware Chain | Handler | Notes |
|---|---|---|---|---|---|---|
| 701 | features/treatment-pathways/pathwayRoutes.ts:34 | GET | /templates | requireRoles(ROLES) | (_req: Request, res: Response) => {   res.json(PATHWAY_TEMPLATES); } | — |
| 702 | features/treatment-pathways/pathwayRoutes.ts:39 | GET | /patient/:patientId | requireRoles(ROLES) | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 703 | features/treatment-pathways/pathwayRoutes.ts:66 | POST | / | requireRoles(ROLES) | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 704 | features/treatment-pathways/pathwayRoutes.ts:108 | PATCH | /:id | requireRoles(ROLES) | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 705 | features/treatment-pathways/pathwayRoutes.ts:132 | POST | /:id/session | requireRoles(ROLES) | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
## voice

| # | File:Line | Verb | Path | Middleware Chain | Handler | Notes |
|---|---|---|---|---|---|---|
| 706 | features/voice/voiceRoutes.ts:29 | POST | /calls | requireRoles(['clinician', 'admin', 'superadmin']) | createCall | — |
| 707 | features/voice/voiceRoutes.ts:35 | GET | /calls/patient/:patientId | requireRoles([     'clinician',     'admin',   ... | getCallsByPatient | — |
| 708 | features/voice/voiceRoutes.ts:46 | GET | /calls/:callId | requireRoles([     'clinician',     'admin',   ... | getCallDetail | — |
| 709 | features/voice/voiceRoutes.ts:57 | PATCH | /calls/:callId | requireRoles(['clinician', 'admin', 'superadmin']) | patchCall | — |
| 710 | features/voice/voiceRoutes.ts:68 | GET | /scripts | requireRoles([     'clinician',     'admin',   ... | getScripts | — |
| 711 | features/voice/voiceRoutes.ts:79 | POST | /scripts | requireRoles(['admin', 'manager', 'superadmin']) | createScript | — |
| 712 | features/voice/voiceRoutes.ts:85 | PATCH | /scripts/:scriptId | requireRoles(['admin', 'manager', 'superadmin']) | updateScript | — |
| 713 | features/voice/voiceRoutes.ts:95 | GET | /preferences/:patientId | requireRoles([     'clinician',     'admin',   ... | getPreferences | — |
| 714 | features/voice/voiceRoutes.ts:106 | PUT | /preferences/:patientId | requireRoles(['clinician', 'admin', 'superadmin']) | setPreferences | — |
## webhooks

| # | File:Line | Verb | Path | Middleware Chain | Handler | Notes |
|---|---|---|---|---|---|---|
| 715 | features/webhooks/webhookRoutes.ts:83 | POST | /:source | — | async (req: Request, res: Response, next: NextFunction) => {   cons... | no middleware |
## workflows

| # | File:Line | Verb | Path | Middleware Chain | Handler | Notes |
|---|---|---|---|---|---|---|
| 716 | features/workflows/workflowRoutes.ts:40 | GET | / | requireRoles(ADMIN) | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 717 | features/workflows/workflowRoutes.ts:51 | GET | /:id | requireRoles(ADMIN) | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 718 | features/workflows/workflowRoutes.ts:69 | POST | / | requireRoles(ADMIN) | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 719 | features/workflows/workflowRoutes.ts:91 | PUT | /:id | requireRoles(ADMIN) | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 720 | features/workflows/workflowRoutes.ts:112 | DELETE | /:id | requireRoles(ADMIN) | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
| 721 | features/workflows/workflowRoutes.ts:122 | GET | /:id/executions | requireRoles(ADMIN) | async (req: Request, res: Response, next: NextFunction) => {   try ... | — |
