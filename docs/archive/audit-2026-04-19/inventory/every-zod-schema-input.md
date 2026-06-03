# Zod Validation Coverage — 2026-04-19

Total POST/PUT/PATCH routes: 244
With Zod validation: 178 (72%)
WITHOUT Zod validation: 18 (FLAG — each is a risk)

## Summary by Status

- **OK (Zod validated)**: 178 routes
- **MISSING (no Zod)**: 18 routes
- **DEFERRED (delegated to controller)**: 48 routes

---

## Complete Route Inventory

| # | File:Line | Verb | Path | Schema used | Status |
|---|---|---|---|---|---|
| 2 | `correspondenceRoutes.ts:15` | POST | `/` | (none) | DEFERRED |
| 3 | `correspondenceRoutes.ts:36` | POST | `/generate-from-note` | (none) | DEFERRED |
| 4 | `correspondenceRoutes.ts:38` | POST | `/letters` | (none) | DEFERRED |
| 5 | `correspondenceRoutes.ts:41` | PATCH | `/letters/:letterId` | (none) | DEFERRED |
| 7 | `cmiRoutes.ts:19` | POST | `/prepare` | (none) | **MISSING** |
| 8 | `cmiRoutes.ts:30` | POST | `/submit` | (none) | **MISSING** |
| 9 | `workflowRoutes.ts:69` | POST | `/` | WorkflowCreateSchema | **OK** |
| 10 | `workflowRoutes.ts:91` | PUT | `/:id` | WorkflowUpdateSchema | **OK** |
| 11 | `pathwayRoutes.ts:66` | POST | `/` | CreateTreatmentPathwaySchema | **OK** |
| 12 | `pathwayRoutes.ts:108` | PATCH | `/:id` | UpdateTreatmentPathwaySchema | **OK** |
| 13 | `pathwayRoutes.ts:132` | POST | `/:id/session` | (none) | DEFERRED |
| 14 | `reportsRoutes.ts:70` | POST | `/generate` | (none) | DEFERRED |
| 15 | `reportsRoutes.ts:478` | POST | `/audit-templates` | AuditTemplateCreateSchema | **OK** |
| 16 | `reportsRoutes.ts:494` | POST | `/audit-runs` | AuditRunCreateSchema | **OK** |
| 17 | `ereferralRoutes.ts:73` | POST | `/` | CreateEreferralSchema | **OK** |
| 18 | `ereferralRoutes.ts:100` | PATCH | `/:id/status` | UpdateEreferralSchema | **OK** |
| 22 | `fhirSubscription.ts:52` | POST | `/Subscription` | (none) | **MISSING** |
| 23 | `streamingTranscribeRoutes.ts:36` | POST | `/stream-chunk` | (none) | **MISSING** |
| 24 | `streamingTranscribeRoutes.ts:98` | POST | `/stream-final` | (none) | **MISSING** |
| 29 | `fhirRoutes.ts:341` | POST | `/Patient` | (none) | **MISSING** |
| 30 | `fhirRoutes.ts:384` | POST | `/Observation` | (none) | **MISSING** |
| 31 | `aiJobRoutes.ts:52` | POST | `/jobs` | AiJobSubmitSchema | **OK** |
| 32 | `smartAppRegistry.ts:61` | POST | `/apps` | (none) | **MISSING** |
| 33 | `smartAppRegistry.ts:137` | PATCH | `/apps/:appId` | (none) | **MISSING** |
| 35 | `smartAuth.ts:277` | POST | `/auth/token` | (none) | **MISSING** |
| 36 | `smartAuth.ts:502` | POST | `/auth/introspect` | (none) | **MISSING** |
| 37 | `smartAuth.ts:549` | POST | `/auth/revoke` | (none) | **MISSING** |
| 38 | `adminTrainingRoutes.ts:67` | POST | `/scrub-rules` | ScrubRuleCreateSchema | **OK** |
| 39 | `adminTrainingRoutes.ts:99` | PATCH | `/scrub-rules/:id` | ScrubRuleUpdateSchema | **OK** |
| 40 | `adminTrainingRoutes.ts:138` | POST | `/corpus/ingest` | IngestSchema | **OK** |
| 41 | `adminTrainingRoutes.ts:196` | PATCH | `/corpus/:id/review` | CorpusReviewSchema | **OK** |
| 42 | `adminTrainingRoutes.ts:235` | POST | `/models` | ModelRegisterSchema | **OK** |
| 43 | `adminTrainingRoutes.ts:292` | POST | `/models/:id/red-team` | RedTeamSchema | **OK** |
| 44 | `adminTrainingRoutes.ts:319` | POST | `/deployments` | DeploymentCreateSchema | **OK** |
| 45 | `adminTrainingRoutes.ts:361` | PATCH | `/deployments/:id` | DeploymentPatchSchema | **OK** |
| 46 | `adminTrainingRoutes.ts:458` | POST | `/opt-in` | OptInSchema | **OK** |
| 51 | `billingRoutes.ts:94` | POST | `/fee-schedules` | FeeScheduleCreateSchema | **OK** |
| 52 | `billingRoutes.ts:102` | PUT | `/fee-schedules/:id` | FeeScheduleUpdateSchema | **OK** |
| 53 | `billingRoutes.ts:118` | POST | `/fee-schedules/seed` | ApplyUniformGapSchema | **OK** |
| 54 | `billingRoutes.ts:134` | PUT | `/clinician-fees/:staffId/:itemNumber` | ApplyUniformGapSchema | **OK** |
| 55 | `billingRoutes.ts:149` | POST | `/clinician-fees/:staffId/apply-uniform-gap` | ApplyUniformGapSchema | **OK** |
| 56 | `billingRoutes.ts:159` | POST | `/invoices/:invoiceId/approve` | InvoiceApproveSchema | **OK** |
| 57 | `billingRoutes.ts:167` | POST | `/invoices/:invoiceId/send` | ReferralValidityCreateSchema | **OK** |
| 58 | `billingRoutes.ts:190` | POST | `/referrals` | ReferralValidityCreateSchema | **OK** |
| 59 | `billingRoutes.ts:208` | POST | `/suggest-mbs` | SuggestMbsSchema | **OK** |
| 60 | `letterRoutes.ts:78` | POST | `/` | CreateLetterSchema | **OK** |
| 61 | `letterRoutes.ts:165` | PATCH | `/:id/sections/:sectionKey` | SectionPatchSchema | **OK** |
| 62 | `letterRoutes.ts:180` | POST | `/:id/submit` | RejectSchema | **OK** |
| 63 | `letterRoutes.ts:191` | POST | `/:id/approve` | RejectSchema | **OK** |
| 64 | `letterRoutes.ts:204` | POST | `/:id/reject` | RejectSchema | **OK** |
| 65 | `letterRoutes.ts:262` | POST | `/:id/deliver` | DeliverSchema | **OK** |
| 66 | `letterRoutes.ts:308` | POST | `/:id/export` | ExportSchema | **OK** |
| 67 | `letterRoutes.ts:359` | POST | `/:id/translations` | TranslationUpsertSchema | **OK** |
| 68 | `letterRoutes.ts:429` | POST | `/:id/revise` | RevisionSchema | **OK** |
| 86 | `llmRoutes.ts:728` | POST | `/whisper/start` | (none) | DEFERRED |
| 87 | `checklistRoutes.ts:176` | POST | `/templates` | CreateChecklistSchema | **OK** |
| 88 | `checklistRoutes.ts:190` | PATCH | `/templates/:id` | UpdateChecklistSchema | **OK** |
| 89 | `checklistRoutes.ts:212` | POST | `/templates/seed-defaults` | CreateInstanceSchema | **OK** |
| 90 | `checklistRoutes.ts:233` | POST | `/instances` | CreateInstanceSchema | **OK** |
| 91 | `checklistRoutes.ts:267` | PATCH | `/instances/:id` | UpdateInstanceSchema | **OK** |
| 92 | `checklistRoutes.ts:283` | POST | `/instances/:id/complete` | (none) | DEFERRED |
| 94 | `taskRoutes.ts:13` | POST | `/` | (none) | DEFERRED |
| 95 | `taskRoutes.ts:16` | PATCH | `/:taskId` | (none) | DEFERRED |
| 99 | `letterStructuredRoutes.ts:66` | POST | `/capacity-assessments` | CapacityCreateSchema | **OK** |
| 100 | `letterStructuredRoutes.ts:161` | POST | `/forensic-risk` | ForensicCreateSchema | **OK** |
| 101 | `letterStructuredRoutes.ts:256` | POST | `/letter-citations` | (none) | **MISSING** |
| 102 | `privacyRoutes.ts:110` | POST | `/patient/:patientId/anonymise` | AnonymiseSchema | **OK** |
| 103 | `privacyRoutes.ts:153` | POST | `/consent` | ConsentCreateSchema | **OK** |
| 104 | `privacyRoutes.ts:194` | POST | `/breaches` | BreachLogSchema | **OK** |
| 105 | `privacyRoutes.ts:229` | POST | `/data-sharing-agreements` | DataSharingAgreementSchema | **OK** |
| 106 | `patientRoutes.ts:269` | PATCH | `/team-assignments/:patientId` | TeamAssignmentPatchSchema | **OK** |
| 107 | `patientRoutes.ts:372` | POST | `/:id/attachments` | (none) | **MISSING** |
| 108 | `patientRoutes.ts:466` | POST | `/:id/pathology` | PathologyUploadSchema | **OK** |
| 109 | `patientRoutes.ts:703` | POST | `/:id/notes` | CreateClinicalNoteInlineSchema | **OK** |
| 110 | `patientRoutes.ts:746` | PATCH | `/:id/notes/:noteId` | UpdateClinicalNoteInlineSchema | **OK** |
| 111 | `patientRoutes.ts:831` | POST | `/:id/legal-orders` | CreateLegalOrderSchema | **OK** |
| 112 | `patientRoutes.ts:852` | PATCH | `/legal-orders/:orderId` | UpdateLegalOrderSchema | **OK** |
| 113 | `patientRoutes.ts:867` | POST | `/:id/legal-attachments` | LegalAttachmentUploadSchema | **OK** |
| 114 | `patientRoutes.ts:959` | POST | `/:id/alerts` | CreatePatientAlertSchema | **OK** |
| 115 | `patientRoutes.ts:977` | PATCH | `/alerts/:alertId` | UpdatePatientAlertSchema | **OK** |
| 116 | `patientRoutes.ts:995` | POST | `/alerts/:alertId/attachments` | CreateHotspotSchema | **OK** |
| 117 | `patientRoutes.ts:1070` | POST | `/:id/hotspot` | CreateHotspotSchema | **OK** |
| 118 | `patientRoutes.ts:1090` | PATCH | `/hotspots/:hotspotId` | CreateAdmissionWaitlistSchema | **OK** |
| 119 | `patientRoutes.ts:1135` | POST | `/:id/flag-for-admission` | CreateAdmissionWaitlistSchema | **OK** |
| 120 | `patientRoutes.ts:1195` | PATCH | `/admission-waitlist/:entryId` | UpdateAdmissionWaitlistSchema | **OK** |
| 121 | `patientRoutes.ts:1217` | PATCH | `/admission-waitlist/:entryId/remove` | RemoveFromWaitlistSchema | **OK** |
| 122 | `patientRoutes.ts:1255` | POST | `/admission-waitlist/:entryId/admit` | CreatePatientContactSchema | **OK** |
| 123 | `patientRoutes.ts:1290` | POST | `/:id/contacts` | CreatePatientContactSchema | **OK** |
| 124 | `patientRoutes.ts:1317` | PATCH | `/contacts/:contactId` | CreatePatientProviderSchema | **OK** |
| 125 | `patientRoutes.ts:1383` | POST | `/:id/providers` | CreatePatientProviderSchema | **OK** |
| 126 | `patientRoutes.ts:1445` | PATCH | `/:id` | (none) | DEFERRED |
| 127 | `patientRoutes.ts:1446` | POST | `/` | (none) | DEFERRED |
| 128 | `patientRoutes.ts:1447` | PUT | `/:id` | (none) | DEFERRED |
| 129 | `llmTrainingRoutes.ts:79` | PUT | `/modelfiles/:actionType` | ModelfileUpsertSchema | **OK** |
| 130 | `llmTrainingRoutes.ts:140` | POST | `/rag/test-query` | RagTestQuerySchema | **OK** |
| 131 | `llmTrainingRoutes.ts:187` | POST | `/training/start` | TrainingStartSchema | **OK** |
| 134 | `duplicateRoutes.ts:52` | POST | `/patients/duplicates/check` | CheckInputSchema | **OK** |
| 137 | `adminImpersonationRoutes.ts:52` | POST | `/:staffId` | StartImpersonationSchema | **OK** |
| 138 | `adminImpersonationRoutes.ts:130` | POST | `/:id/end` | (none) | DEFERRED |
| 139 | `webauthnRoutes.ts:100` | POST | `/webauthn/register/options` | WebAuthnRegisterVerifySchema | **OK** |
| 140 | `webauthnRoutes.ts:132` | POST | `/webauthn/register/verify` | WebAuthnRegisterVerifySchema | **OK** |
| 141 | `webauthnRoutes.ts:172` | POST | `/webauthn/login/options` | WebAuthnLoginOptionsSchema | **OK** |
| 142 | `webauthnRoutes.ts:217` | POST | `/webauthn/login/verify` | WebAuthnLoginVerifySchema | **OK** |
| 143 | `episodeRoutes.ts:109` | POST | `/` | AllocateSchema | **OK** |
| 144 | `episodeRoutes.ts:110` | PUT | `/:id` | AllocateSchema | **OK** |
| 145 | `episodeRoutes.ts:111` | POST | `/:id/close` | AllocateSchema | **OK** |
| 146 | `episodeRoutes.ts:141` | POST | `/:id/allocate` | AllocateSchema | **OK** |
| 147 | `episodeRoutes.ts:339` | POST | `/:id/discharge-summary/generate` | DischargeSummarySubmitSchema | **OK** |
| 148 | `episodeRoutes.ts:366` | POST | `/:id/discharge-summary/submit` | DischargeSummarySubmitSchema | **OK** |
| 149 | `episodeRoutes.ts:399` | POST | `/:id/discharge-summary/sign` | DischargeSummarySignSchema | **OK** |
| 150 | `episodeRoutes.ts:428` | POST | `/:id/close-with-vetting` | CloseWithVettingSchema | **OK** |
| 151 | `episodeRoutes.ts:459` | POST | `/:id/close-sign` | CloseSignSchema | **OK** |
| 152 | `referralRoutes.ts:52` | POST | `/:id/triage` | ReferralTriageSchema | **OK** |
| 153 | `referralRoutes.ts:76` | POST | `/:id/assign` | ReferralAssignSchema | **OK** |
| 154 | `referralRoutes.ts:103` | POST | `/:id/accept` | ReferralAcceptSchema | **OK** |
| 155 | `referralRoutes.ts:122` | POST | `/:id/decline` | ReferralDeclineSchema | **OK** |
| 156 | `referralRoutes.ts:144` | POST | `/:id/notes` | ReferralNoteSchema | **OK** |
| 157 | `referralRoutes.ts:204` | POST | `/` | UpdateReferralByEpisodeSchema | **OK** |
| 158 | `referralRoutes.ts:205` | PATCH | `/:id` | UpdateReferralByEpisodeSchema | **OK** |
| 159 | `referralRoutes.ts:207` | PATCH | `/by-episode/:episodeId` | UpdateReferralByEpisodeSchema | **OK** |
| 160 | `referralRoutes.ts:224` | POST | `/:id/decision` | AllocationSchema | **OK** |
| 162 | `referralRoutes.ts:238` | POST | `/:id/ocr-confirm` | AllocationSchema | **OK** |
| 163 | `referralRoutes.ts:253` | POST | `/:id/allocate` | AllocationSchema | **OK** |
| 164 | `referralRoutes.ts:351` | POST | `/:id/broadcast` | ReferralBroadcastSchema | **OK** |
| 165 | `referralRoutes.ts:394` | POST | `/:id/offers/:offerId/respond` | RespondToOfferSchema | **OK** |
| 166 | `referralRoutes.ts:411` | POST | `/:id/clarification` | ClarificationRequestSchema | **OK** |
| 167 | `referralRoutes.ts:437` | PATCH | `/:id/clarification-response` | ClarificationResponseSchema | **OK** |
| 168 | `scribeRoutes.ts:111` | PUT | `/preferences` | PatientSummarySchema | **OK** |
| 169 | `scribeRoutes.ts:159` | PUT | `/macros` | PatientSummarySchema | **OK** |
| 170 | `scribeRoutes.ts:174` | POST | `/patient-summary` | PatientSummarySchema | **OK** |
| 171 | `scribeRoutes.ts:209` | POST | `/referral-letter` | ReferralLetterSchema | **OK** |
| 172 | `scribeRoutes.ts:271` | POST | `/icd10-suggest` | Icd10SuggestSchema | **OK** |
| 173 | `scribeRoutes.ts:285` | POST | `/mbs-suggest` | MbsSuggestSchema | **OK** |
| 174 | `scribeRoutes.ts:305` | POST | `/outcome-measures` | OutcomeMeasureSchema | **OK** |
| 175 | `scribeRoutes.ts:351` | POST | `/consent` | ScribeConsentCreateSchema | **OK** |
| 176 | `scribeRoutes.ts:457` | POST | `/vocabulary` | VocabCreateSchema | **OK** |
| 177 | `scribeRoutes.ts:488` | PATCH | `/vocabulary/:id` | VocabUpdateSchema | **OK** |
| 178 | `scribeRoutes.ts:566` | POST | `/session` | SessionStartSchema | **OK** |
| 179 | `scribeRoutes.ts:611` | PATCH | `/session/:id` | SessionPatchSchema | **OK** |
| 180 | `scribeRoutes.ts:719` | POST | `/session/:id/scan` | SensitiveScanSchema | **OK** |
| 181 | `scribeRoutes.ts:771` | PATCH | `/sensitive-flags/:id/review` | SensitiveFlagReviewSchema | **OK** |
| 182 | `scribeRoutes.ts:814` | POST | `/session/:id/action-items` | ActionItemReviewSchema | **OK** |
| 183 | `scribeRoutes.ts:870` | PATCH | `/action-items/:id/review` | ActionItemReviewSchema | **OK** |
| 184 | `scribeRoutes.ts:897` | PATCH | `/action-items/:id/link` | ActionItemLinkSchema | **OK** |
| 185 | `scribeRoutes.ts:934` | PUT | `/session/:id/talk-time` | TalkTimeSchema | **OK** |
| 186 | `scribeRoutes.ts:1047` | POST | `/note-templates` | TemplateUpsertSchema | **OK** |
| 187 | `scribeRoutes.ts:1086` | POST | `/search` | SemanticSearchSchema | **OK** |
| 191 | `prescriptionRoutes.ts:43` | POST | `/` | (none) | DEFERRED |
| 192 | `prescriptionRoutes.ts:47` | POST | `/erx/poll-dispense` | (none) | DEFERRED |
| 193 | `prescriptionRoutes.ts:52` | POST | `/mysl/consent` | (none) | DEFERRED |
| 194 | `prescriptionRoutes.ts:57` | POST | `/hi/verify-ihi` | (none) | DEFERRED |
| 195 | `prescriptionRoutes.ts:58` | POST | `/hi/search-ihi` | (none) | DEFERRED |
| 196 | `prescriptionRoutes.ts:63` | POST | `/:id/safescript-check` | (none) | DEFERRED |
| 197 | `prescriptionRoutes.ts:64` | POST | `/:id/submit-erx` | (none) | DEFERRED |
| 198 | `prescriptionRoutes.ts:65` | POST | `/:id/cancel` | (none) | DEFERRED |
| 199 | `prescriptionRoutes.ts:66` | POST | `/:id/deliver-token` | (none) | DEFERRED |
| 203 | `breakGlassRoutes.ts:145` | POST | `/break-glass/request` | BreakGlassRequestSchema | **OK** |
| 207 | `clinicalNote.routes.ts:70` | PATCH | `/:id/codes/:codeId` | (none) | DEFERRED |
| 208 | `clinicalNote.routes.ts:74` | POST | `/` | (none) | DEFERRED |
| 209 | `clinicalNote.routes.ts:75` | PATCH | `/:id` | (none) | DEFERRED |
| 210 | `clinicalNote.routes.ts:76` | POST | `/:id/sign` | (none) | DEFERRED |
| 211 | `clinicalNote.routes.ts:77` | POST | `/:id/amend` | (none) | DEFERRED |
| 214 | `escalation.routes.ts:57` | POST | `/` | RejectTransferSchema | **OK** |
| 215 | `escalation.routes.ts:58` | PATCH | `/:id` | RejectTransferSchema | **OK** |
| 216 | `escalation.routes.ts:59` | POST | `/:id/acknowledge` | RejectTransferSchema | **OK** |
| 217 | `escalation.routes.ts:60` | POST | `/:id/resolve` | RejectTransferSchema | **OK** |
| 218 | `escalation.routes.ts:61` | POST | `/:id/notes` | RejectTransferSchema | **OK** |
| 219 | `escalation.routes.ts:65` | POST | `/:id/accept-transfer` | RejectTransferSchema | **OK** |
| 220 | `escalation.routes.ts:118` | POST | `/:id/reject-transfer` | RejectTransferSchema | **OK** |
| 221 | `carerRoutes.ts:42` | POST | `/` | CreateCarerSchema | **OK** |
| 222 | `carerRoutes.ts:54` | PATCH | `/:id` | UpdateCarerSchema | **OK** |
| 223 | `advanceDirectiveRoutes.ts:68` | POST | `/` | CreateAdvanceDirectiveSchema | **OK** |
| 224 | `advanceDirectiveRoutes.ts:103` | PATCH | `/:id` | UpdateAdvanceDirectiveSchema | **OK** |
| 225 | `contactRecordRoutes.ts:212` | POST | `/` | CreateContactRecordSchema | **OK** |
| 226 | `contactRecordRoutes.ts:258` | PATCH | `/:id` | UpdateContactRecordSchema | **OK** |
| 231 | `tmsRoutes.ts:38` | POST | `/courses` | CreateCourseSchema | **OK** |
| 232 | `tmsRoutes.ts:47` | POST | `/courses/:courseId/sessions` | RecordSessionSchema | **OK** |
| 241 | `patientAppRoutes.ts:182` | POST | `/invite/:patientId` | ActivateSchema | **OK** |
| 242 | `patientAppRoutes.ts:254` | POST | `/activate` | ActivateSchema | **OK** |
| 243 | `patientAppRoutes.ts:336` | POST | `/login` | PatientLoginSchema | **OK** |
| 244 | `patientAppRoutes.ts:466` | POST | `/tracking` | TrackingBatchSchema | **OK** |
| 245 | `patientAppRoutes.ts:532` | PATCH | `/tracking/:entryId` | SingleTrackingSchema | **OK** |
| 246 | `patientAppRoutes.ts:566` | POST | `/med-reminders/:patientId` | MedReminderSchema | **OK** |
| 247 | `patientAppRoutes.ts:601` | POST | `/shared-docs/:patientId` | DocumentUploadSchema | **OK** |
| 248 | `patientAppRoutes.ts:623` | PUT | `/triage/:patientId` | TriageNumberSchema | **OK** |
| 249 | `patientAppRoutes.ts:634` | PATCH | `/appointment-response/:appointmentId` | TriageResponseSchema | **OK** |
| 250 | `patientAppRoutes.ts:657` | POST | `/thresholds/:patientId` | AlertThresholdSchema | **OK** |
| 251 | `patientAppRoutes.ts:745` | POST | `/assessments/:patientId/assign` | AssessmentStartSchema | **OK** |
| 252 | `patientAppRoutes.ts:785` | PATCH | `/assessments/:patientId/:assessmentId/complete` | AssessmentSubmitSchema | **OK** |
| 253 | `patientAppRoutes.ts:817` | POST | `/tasks/:patientId` | TaskCreateSchema | **OK** |
| 254 | `patientAppRoutes.ts:841` | PATCH | `/tasks/:patientId/:taskId` | TaskStatusSchema | **OK** |
| 255 | `patientAppRoutes.ts:864` | POST | `/checklists/:patientId` | ChecklistItemCreateSchema | **OK** |
| 256 | `patientAppRoutes.ts:877` | PATCH | `/checklists/:patientId/:checklistId` | ChecklistItemToggleSchema | **OK** |
| 257 | `patientAppRoutes.ts:901` | POST | `/fcm/register-device` | RegisterDeviceSchema | **OK** |
| 258 | `patientAppRoutes.ts:1017` | PATCH | `/sync-preferences` | SyncPreferenceSchema | **OK** |
| 261 | `groupTherapyRoutes.ts:108` | POST | `/` | CreateGroupSessionSchema | **OK** |
| 262 | `groupTherapyRoutes.ts:134` | PATCH | `/:id` | UpdateGroupSessionSchema | **OK** |
| 263 | `groupTherapyRoutes.ts:148` | POST | `/:id/attendance` | AddGroupAttendeeSchema | **OK** |
| 264 | `groupTherapyRoutes.ts:187` | POST | `/:id/attendees` | AddGroupAttendeeSchema | **OK** |
| 265 | `groupTherapyRoutes.ts:201` | PATCH | `/:id/attendees/:attendeeId` | UpdateGroupAttendeeSchema | **OK** |
| 266 | `groupTherapyRoutes.ts:227` | POST | `/:id/attendees/:attendeeId/note` | IndividualNoteSchema | **OK** |
| 273 | `clozapineRoutes.ts:35` | POST | `/` | (none) | DEFERRED |
| 274 | `clozapineRoutes.ts:36` | PATCH | `/:id` | (none) | DEFERRED |
| 275 | `clozapineRoutes.ts:42` | POST | `/blood-results` | (none) | DEFERRED |
| 276 | `clozapineRoutes.ts:46` | POST | `/titration-days` | (none) | DEFERRED |
| 277 | `clozapineRoutes.ts:52` | POST | `/administrations` | (none) | DEFERRED |
| 278 | `clozapineRoutes.ts:56` | POST | `/observations` | (none) | DEFERRED |
| 279 | `clozapineRoutes.ts:60` | POST | `/monitoring-checks` | (none) | DEFERRED |
| 299 | `outcomeRoutes.ts:124` | POST | `/` | CreateOutcomeMeasureSchema | **OK** |
| 300 | `outcomeRoutes.ts:176` | POST | `/:id/sign` | (none) | DEFERRED |
| 304 | `pathologyRoutes.ts:24` | POST | `/orders` | (none) | DEFERRED |
| 305 | `pathologyRoutes.ts:29` | POST | `/results` | (none) | DEFERRED |
| 306 | `pathologyRoutes.ts:33` | POST | `/results/:resultId/acknowledge` | (none) | DEFERRED |
| 307 | `ectRoutes.ts:38` | POST | `/courses` | CreateCourseSchema | **OK** |
| 308 | `ectRoutes.ts:47` | POST | `/courses/:courseId/sessions` | RecordSessionSchema | **OK** |
| 320 | `template.routes.ts:14` | POST | `/` | (none) | DEFERRED |
| 321 | `template.routes.ts:15` | PATCH | `/:id` | (none) | DEFERRED |
| 322 | `template.routes.ts:18` | PATCH | `/:id/publish` | (none) | DEFERRED |
| 323 | `template.routes.ts:19` | PATCH | `/:id/retire` | (none) | DEFERRED |
| 324 | `safetyPlanRoutes.ts:55` | POST | `/` | (none) | **MISSING** |
| 325 | `safetyPlanRoutes.ts:83` | PATCH | `/:id` | (none) | **MISSING** |
| 326 | `safetyPlanRoutes.ts:116` | POST | `/:id/sign` | (none) | DEFERRED |
| 327 | `documentRoutes.ts:14` | POST | `/generate` | (none) | DEFERRED |
| 329 | `backupRoutes.ts:112` | PUT | `/config` | (none) | **MISSING** |
| 330 | `backupRoutes.ts:145` | POST | `/run` | (none) | **MISSING** |
| 331 | `webhookRoutes.ts:83` | POST | `/:source` | (none) | DEFERRED |
| 332 | `laiScheduleRoutes.ts:49` | POST | `/given` | CreateLaiValidationSchema | **OK** |
| 333 | `laiScheduleRoutes.ts:52` | POST | `/aims-assessments` | CreateLaiValidationSchema | **OK** |
| 334 | `laiScheduleRoutes.ts:71` | POST | `/validations` | CreateLaiValidationSchema | **OK** |
| 335 | `laiScheduleRoutes.ts:124` | POST | `/` | (none) | DEFERRED |
| 336 | `laiScheduleRoutes.ts:127` | PATCH | `/:id` | (none) | DEFERRED |
| 339 | `bedRoutes.ts:103` | POST | `/` | CreateBedSchema | **OK** |
| 340 | `bedRoutes.ts:122` | POST | `/bulk` | BulkCreateBedsSchema | **OK** |
| 341 | `bedRoutes.ts:141` | PATCH | `/:bedId` | UpdateBedSchema | **OK** |
| 342 | `bedRoutes.ts:167` | POST | `/:bedId/admit` | AdmitPatientSchema | **OK** |
| 343 | `bedRoutes.ts:184` | POST | `/:bedId/discharge` | DischargeFromBedSchema | **OK** |
| 344 | `bedRoutes.ts:210` | POST | `/:bedId/leave` | BedLeaveSchema | **OK** |
| 345 | `bedRoutes.ts:241` | POST | `/restrictive-interventions` | CreateRestrictiveInterventionSchema | **OK** |
| 346 | `bedRoutes.ts:254` | POST | `/restrictive-interventions/:id/end` | EndRestrictiveInterventionSchema | **OK** |
| 347 | `messageRoutes.ts:26` | POST | `/threads` | SendEmailSchema | **OK** |
| 348 | `messageRoutes.ts:31` | POST | `/` | SendEmailSchema | **OK** |
| 349 | `messageRoutes.ts:32` | POST | `/threads/:threadId/messages` | SendEmailSchema | **OK** |
| 350 | `messageRoutes.ts:36` | PATCH | `/:messageId/read` | SendEmailSchema | **OK** |
| 351 | `messageRoutes.ts:39` | POST | `/send-email` | SendEmailSchema | **OK** |

---

## Missing Zod Validation (18 routes)

These routes directly access `req.body` without Zod parsing:

- **backupRoutes.ts:112** | PUT `/config`
- **backupRoutes.ts:145** | POST `/run`
- **letterStructuredRoutes.ts:256** | POST `/letter-citations`
- **streamingTranscribeRoutes.ts:36** | POST `/stream-chunk`
- **streamingTranscribeRoutes.ts:98** | POST `/stream-final`
- **patientRoutes.ts:372** | POST `/:id/attachments`
- **safetyPlanRoutes.ts:55** | POST `/`
- **safetyPlanRoutes.ts:83** | PATCH `/:id`
- **cmiRoutes.ts:19** | POST `/prepare`
- **cmiRoutes.ts:30** | POST `/submit`
- **fhirRoutes.ts:341** | POST `/Patient`
- **fhirRoutes.ts:384** | POST `/Observation`
- **fhirSubscription.ts:52** | POST `/Subscription`
- **smartAppRegistry.ts:61** | POST `/apps`
- **smartAppRegistry.ts:137** | PATCH `/apps/:appId`
- **smartAuth.ts:277** | POST `/auth/token`
- **smartAuth.ts:502** | POST `/auth/introspect`
- **smartAuth.ts:549** | POST `/auth/revoke`

---

## Deferred to Controller (48 routes)

These routes delegate to controller methods without inline Zod validation:

### adminImpersonationRoutes.ts
- POST   `/:id/end` (line 130)
### checklistRoutes.ts
- POST   `/instances/:id/complete` (line 283)
### clinicalNote.routes.ts
- PATCH  `/:id/codes/:codeId` (line 70)
- POST   `/` (line 74)
- PATCH  `/:id` (line 75)
- POST   `/:id/sign` (line 76)
- POST   `/:id/amend` (line 77)
### clozapineRoutes.ts
- POST   `/` (line 35)
- PATCH  `/:id` (line 36)
- POST   `/blood-results` (line 42)
- POST   `/titration-days` (line 46)
- POST   `/administrations` (line 52)
- POST   `/observations` (line 56)
- POST   `/monitoring-checks` (line 60)
### correspondenceRoutes.ts
- POST   `/` (line 15)
- POST   `/generate-from-note` (line 36)
- POST   `/letters` (line 38)
- PATCH  `/letters/:letterId` (line 41)
### documentRoutes.ts
- POST   `/generate` (line 14)
### laiScheduleRoutes.ts
- POST   `/` (line 124)
- PATCH  `/:id` (line 127)
### llmRoutes.ts
- POST   `/whisper/start` (line 728)
### outcomeRoutes.ts
- POST   `/:id/sign` (line 176)
### pathologyRoutes.ts
- POST   `/orders` (line 24)
- POST   `/results` (line 29)
- POST   `/results/:resultId/acknowledge` (line 33)
### pathwayRoutes.ts
- POST   `/:id/session` (line 132)
### patientRoutes.ts
- PATCH  `/:id` (line 1445)
- POST   `/` (line 1446)
- PUT    `/:id` (line 1447)
### prescriptionRoutes.ts
- POST   `/` (line 43)
- POST   `/erx/poll-dispense` (line 47)
- POST   `/mysl/consent` (line 52)
- POST   `/hi/verify-ihi` (line 57)
- POST   `/hi/search-ihi` (line 58)
- POST   `/:id/safescript-check` (line 63)
- POST   `/:id/submit-erx` (line 64)
- POST   `/:id/cancel` (line 65)
- POST   `/:id/deliver-token` (line 66)
### reportsRoutes.ts
- POST   `/generate` (line 70)
### safetyPlanRoutes.ts
- POST   `/:id/sign` (line 116)
### taskRoutes.ts
- POST   `/` (line 13)
- PATCH  `/:taskId` (line 16)
### template.routes.ts
- POST   `/` (line 14)
- PATCH  `/:id` (line 15)
- PATCH  `/:id/publish` (line 18)
- PATCH  `/:id/retire` (line 19)
### webhookRoutes.ts
- POST   `/:source` (line 83)