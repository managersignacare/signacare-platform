# React Component LOC + Memoisation Inventory — 2026-04-19

**Total files:** 243
**Monster files (>2000 LOC):** 1
**Obese files (1000-2000 LOC):** 10
**Large files (500-1000 LOC):** 27
**Normal files (≤500 LOC):** 205

**Files with excessive state (>10 useState):** 43
**Files >500 LOC under-memoised (no memo/useMemo/useCallback):** 15

## Summary

Total: 243 files | Monster: 1 | Obese: 10 | Large: 27

## Top 10 Largest Files

| # | File | LOC | React.memo | useMemo | useCallback | useState | Flag |
|---|---|---|---|---|---|---|---|
| 1 | MedicationsTab.tsx | 3216 | 0 | 6 | 3 | 96 | MONSTER + too-much-state |
| 2 | SummaryTab.tsx | 1916 | 0 | 5 | 0 | 17 | OBESE + too-much-state |
| 3 | VivaTab.tsx | 1726 | 0 | 0 | 0 | 26 | OBESE + too-much-state + under-memoised |
| 4 | SettingsPage.tsx | 1602 | 0 | 0 | 0 | 43 | OBESE + too-much-state + under-memoised |
| 5 | AmbientAiRecorder.tsx | 1529 | 0 | 0 | 4 | 19 | OBESE + too-much-state |
| 6 | ReportsPage.tsx | 1322 | 0 | 2 | 0 | 26 | OBESE + too-much-state |
| 7 | EpisodesTab.tsx | 1237 | 0 | 5 | 0 | 47 | OBESE + too-much-state |
| 8 | EctTab.tsx | 1198 | 0 | 0 | 0 | 18 | OBESE + too-much-state + under-memoised |
| 9 | DashboardPage.tsx | 1163 | 0 | 2 | 0 | 9 | OBESE |
| 10 | InpatientCareTab.tsx | 1133 | 0 | 0 | 0 | 21 | OBESE + too-much-state + under-memoised |

## Full Inventory (All Files ≥30 LOC)

| # | File | LOC | React.memo | useMemo | useCallback | useState | Flag |
|---|---|---|---|---|---|---|---|
| 1 | MedicationsTab.tsx | 3216 | 0 | 6 | 3 | 96 | MONSTER + too-much-state |
| 2 | SummaryTab.tsx | 1916 | 0 | 5 | 0 | 17 | OBESE + too-much-state |
| 3 | VivaTab.tsx | 1726 | 0 | 0 | 0 | 26 | OBESE + too-much-state + under-memoised |
| 4 | SettingsPage.tsx | 1602 | 0 | 0 | 0 | 43 | OBESE + too-much-state + under-memoised |
| 5 | AmbientAiRecorder.tsx | 1529 | 0 | 0 | 4 | 19 | OBESE + too-much-state |
| 6 | ReportsPage.tsx | 1322 | 0 | 2 | 0 | 26 | OBESE + too-much-state |
| 7 | EpisodesTab.tsx | 1237 | 0 | 5 | 0 | 47 | OBESE + too-much-state |
| 8 | EctTab.tsx | 1198 | 0 | 0 | 0 | 18 | OBESE + too-much-state + under-memoised |
| 9 | DashboardPage.tsx | 1163 | 0 | 2 | 0 | 9 | OBESE |
| 10 | InpatientCareTab.tsx | 1133 | 0 | 0 | 0 | 21 | OBESE + too-much-state + under-memoised |
| 11 | AiAgentPage.tsx | 1055 | 0 | 1 | 0 | 32 | OBESE + too-much-state |
| 12 | OncologyTab.tsx | 996 | 0 | 0 | 0 | 29 | LARGE + too-much-state + under-memoised |
| 13 | AppointmentsTab.tsx | 977 | 0 | 6 | 0 | 36 | LARGE + too-much-state |
| 14 | CorrespondenceTab.tsx | 958 | 0 | 1 | 0 | 22 | LARGE + too-much-state |
| 15 | AddNoteDialog.tsx | 926 | 0 | 0 | 2 | 31 | LARGE + too-much-state |
| 16 | AlertsPlansTab.tsx | 910 | 0 | 0 | 0 | 29 | LARGE + too-much-state + under-memoised |
| 17 | ReferralCoordinatorQueue.tsx | 870 | 0 | 4 | 0 | 20 | LARGE + too-much-state |
| 18 | PatientDetailLayout.tsx | 859 | 0 | 3 | 0 | 10 | LARGE |
| 19 | PatientsPage.tsx | 799 | 0 | 0 | 0 | 23 | LARGE + too-much-state + under-memoised |
| 20 | NursingPage.tsx | 785 | 0 | 3 | 0 | 18 | LARGE + too-much-state |
| 21 | ReferralsPage.tsx | 777 | 0 | 9 | 0 | 27 | LARGE + too-much-state |
| 22 | EditPatientWizard.tsx | 732 | 0 | 0 | 0 | 4 | LARGE + under-memoised |
| 23 | TrackingTab.tsx | 706 | 0 | 0 | 0 | 3 | LARGE + under-memoised |
| 24 | StaffAssignmentsPage.tsx | 696 | 0 | 1 | 0 | 32 | LARGE + too-much-state |
| 25 | PowerSettingsPage.tsx | 691 | 0 | 0 | 0 | 6 | LARGE + under-memoised |
| 26 | ExportsPage.tsx | 649 | 0 | 0 | 0 | 32 | LARGE + too-much-state + under-memoised |
| 27 | ReceptionistPage.tsx | 601 | 0 | 0 | 0 | 9 | LARGE + under-memoised |
| 28 | IncidentsTab.tsx | 573 | 0 | 0 | 0 | 17 | LARGE + too-much-state + under-memoised |
| 29 | Sidebar.tsx | 550 | 0 | 1 | 8 | 5 | LARGE |
| 30 | MedReconciliationTab.tsx | 532 | 0 | 2 | 0 | 5 | LARGE |
| 31 | LivedExperienceTab.tsx | 531 | 0 | 5 | 0 | 11 | LARGE + too-much-state |
| 32 | PatientList.tsx | 520 | 0 | 8 | 2 | 12 | LARGE + too-much-state |
| 33 | OutcomeMeasuresTab.tsx | 519 | 0 | 0 | 0 | 8 | LARGE + under-memoised |
| 34 | PsychiatristPage.tsx | 519 | 0 | 0 | 3 | 12 | LARGE + too-much-state |
| 35 | ContactFormDialog.tsx | 507 | 0 | 2 | 0 | 18 | LARGE + too-much-state |
| 36 | AppointmentsPage.tsx | 504 | 0 | 5 | 0 | 37 | LARGE + too-much-state |
| 37 | GroupTherapyPage.tsx | 502 | 0 | 2 | 0 | 15 | LARGE + too-much-state |
| 38 | NinetyOneDayReviewTab.tsx | 501 | 0 | 0 | 0 | 10 | LARGE + under-memoised |
| 39 | BedBoardPage.tsx | 497 | 0 | 0 | 0 | 14 | too-much-state |
| 40 | AssessmentsTab.tsx | 481 | 0 | 0 | 0 | 14 | too-much-state |
| 41 | TemplateFormRenderer.tsx | 467 | 0 | 2 | 2 | 0 | OK |
| 42 | LLMSuggestPanel.tsx | 460 | 0 | 0 | 0 | 7 | OK |
| 43 | ManagerDashboardPage.tsx | 448 | 0 | 0 | 0 | 0 | OK |
| 44 | TmsTab.tsx | 442 | 0 | 0 | 0 | 9 | OK |
| 45 | ClinicalReviewView.tsx | 433 | 0 | 0 | 0 | 2 | OK |
| 46 | CaseManagementPage.tsx | 422 | 0 | 0 | 0 | 9 | OK |
| 47 | HandoverListPage.tsx | 410 | 0 | 1 | 0 | 9 | OK |
| 48 | PatientDeliveryPanel.tsx | 405 | 0 | 2 | 0 | 11 | too-much-state |
| 49 | AiTrainingModule.tsx | 389 | 0 | 0 | 0 | 13 | too-much-state |
| 50 | SubscriptionPage.tsx | 384 | 0 | 0 | 0 | 21 | too-much-state |
| 51 | MobileScribePage.tsx | 381 | 0 | 2 | 4 | 7 | OK |
| 52 | OrgTreePanel.tsx | 379 | 0 | 1 | 0 | 13 | too-much-state |
| 53 | ClinicalNotesPanel.tsx | 374 | 0 | 0 | 3 | 7 | OK |
| 54 | OnboardingWizard.tsx | 374 | 0 | 0 | 0 | 4 | OK |
| 55 | GlucoseFlowsheetTab.tsx | 371 | 0 | 0 | 0 | 9 | OK |
| 56 | InsulinRegimenTab.tsx | 367 | 0 | 0 | 0 | 15 | too-much-state |
| 57 | ModuleAccessMatrix.tsx | 365 | 0 | 0 | 0 | 0 | OK |
| 58 | PatientRegistrationWizard.tsx | 361 | 0 | 0 | 0 | 4 | OK |
| 59 | EscalationTimeline.tsx | 358 | 0 | 0 | 0 | 4 | OK |
| 60 | NotesList.tsx | 350 | 0 | 0 | 0 | 10 | OK |
| 61 | ReferralsTab.tsx | 345 | 0 | 4 | 0 | 10 | OK |
| 62 | ClinicalListPage.tsx | 345 | 0 | 3 | 0 | 7 | OK |
| 63 | InvoiceDetail.tsx | 342 | 0 | 0 | 0 | 2 | OK |
| 64 | AvailabilityGridEditor.tsx | 341 | 0 | 2 | 2 | 4 | OK |
| 65 | AppointmentForm.tsx | 337 | 0 | 0 | 0 | 6 | OK |
| 66 | ProblemListTab.tsx | 331 | 0 | 0 | 0 | 12 | too-much-state |
| 67 | ReferralForm.tsx | 330 | 0 | 0 | 0 | 1 | OK |
| 68 | VoiceCallLog.tsx | 326 | 0 | 0 | 0 | 7 | OK |
| 69 | TasksPage.tsx | 320 | 0 | 0 | 0 | 21 | too-much-state |
| 70 | LegalTab.tsx | 318 | 0 | 1 | 0 | 19 | too-much-state |
| 71 | AntenatalVisitsTab.tsx | 313 | 0 | 2 | 0 | 14 | too-much-state |
| 72 | EscalationForm.tsx | 312 | 0 | 0 | 0 | 0 | OK |
| 73 | OutcomeMeasureDashboard.tsx | 312 | 0 | 0 | 0 | 2 | OK |
| 74 | ReportBuilder.tsx | 311 | 0 | 0 | 0 | 4 | OK |
| 75 | AiQuickTasks.tsx | 311 | 0 | 0 | 0 | 9 | OK |
| 76 | PathwaysTab.tsx | 307 | 0 | 0 | 0 | 10 | OK |
| 77 | ComplianceDashboardPage.tsx | 304 | 0 | 0 | 0 | 0 | OK |
| 78 | RiskAssessmentForm.tsx | 298 | 0 | 0 | 0 | 3 | OK |
| 79 | ReviewPlanSection.tsx | 298 | 0 | 0 | 0 | 0 | OK |
| 80 | NoteEditor.tsx | 294 | 0 | 0 | 0 | 2 | OK |
| 81 | EditStaffCredentialsDialog.tsx | 291 | 0 | 0 | 0 | 4 | OK |
| 82 | EscalationList.tsx | 288 | 0 | 0 | 0 | 4 | OK |
| 83 | PacuTab.tsx | 288 | 0 | 0 | 0 | 12 | too-much-state |
| 84 | GuidedTour.tsx | 277 | 0 | 0 | 2 | 4 | OK |
| 85 | Step1Demographics.tsx | 276 | 0 | 0 | 0 | 0 | OK |
| 86 | PrescriptionForm.tsx | 274 | 0 | 0 | 0 | 2 | OK |
| 87 | MedicationForm.tsx | 268 | 0 | 0 | 0 | 4 | OK |
| 88 | PathologyOrderForm.tsx | 261 | 0 | 0 | 0 | 0 | OK |
| 89 | WorkflowBuilderPanel.tsx | 258 | 0 | 0 | 0 | 7 | OK |
| 90 | MessageThreadList.tsx | 258 | 0 | 0 | 0 | 3 | OK |
| 91 | PregnancyDashboardTab.tsx | 255 | 0 | 2 | 0 | 10 | OK |
| 92 | LetterComposer.tsx | 254 | 0 | 0 | 2 | 0 | OK |
| 93 | PatientHeader.tsx | 252 | 0 | 0 | 0 | 0 | OK |
| 94 | AdvanceDirectivesTab.tsx | 248 | 0 | 0 | 0 | 5 | OK |
| 95 | ChronicDiseaseRegisterTab.tsx | 247 | 0 | 2 | 0 | 2 | OK |
| 96 | PathologyTab.tsx | 246 | 0 | 0 | 0 | 8 | OK |
| 97 | MilestonesTab.tsx | 246 | 0 | 2 | 0 | 8 | OK |
| 98 | ImmunizationsTab.tsx | 246 | 0 | 0 | 0 | 11 | too-much-state |
| 99 | SafetyChecklistTab.tsx | 243 | 0 | 2 | 0 | 3 | OK |
| 100 | ConnectOutlookButton.tsx | 239 | 0 | 0 | 0 | 5 | OK |
| 101 | LoginForm.tsx | 239 | 0 | 0 | 0 | 2 | OK |
| 102 | AllergyList.tsx | 236 | 0 | 0 | 0 | 4 | OK |
| 103 | router.tsx | 235 | 0 | 0 | 0 | 2 | OK |
| 104 | ProgramsPanel.tsx | 235 | 0 | 0 | 0 | 5 | OK |
| 105 | FileUploader.tsx | 234 | 0 | 0 | 2 | 4 | OK |
| 106 | TaskList.tsx | 233 | 0 | 0 | 0 | 2 | OK |
| 107 | GrowthChartTab.tsx | 233 | 0 | 0 | 0 | 8 | OK |
| 108 | KanbanBoard.tsx | 231 | 0 | 0 | 0 | 2 | OK |
| 109 | ScribeConsentPanel.tsx | 223 | 0 | 0 | 0 | 3 | OK |
| 110 | SurgicalCasesTab.tsx | 220 | 0 | 0 | 0 | 9 | OK |
| 111 | AdmissionWaitlistPage.tsx | 219 | 0 | 0 | 0 | 13 | too-much-state |
| 112 | OpNoteTab.tsx | 218 | 0 | 0 | 0 | 8 | OK |
| 113 | SendMessageDialog.tsx | 217 | 0 | 0 | 0 | 4 | OK |
| 114 | RiskAssessmentList.tsx | 217 | 0 | 0 | 0 | 3 | OK |
| 115 | EpisodeForm.tsx | 217 | 0 | 0 | 0 | 0 | OK |
| 116 | OverviewTab.tsx | 216 | 0 | 0 | 0 | 2 | OK |
| 117 | SafetyPlanTab.tsx | 210 | 0 | 0 | 0 | 3 | OK |
| 118 | ReferralDecisionModal.tsx | 209 | 0 | 0 | 0 | 0 | OK |
| 119 | PathologyResultsList.tsx | 209 | 0 | 0 | 0 | 0 | OK |
| 120 | AllergyForm.tsx | 208 | 0 | 0 | 0 | 0 | OK |
| 121 | PatientBillingTab.tsx | 208 | 0 | 0 | 0 | 3 | OK |
| 122 | IntegrationStatusPanel.tsx | 206 | 0 | 0 | 0 | 0 | OK |
| 123 | ContactFormBanner.tsx | 204 | 0 | 0 | 0 | 12 | too-much-state |
| 124 | Step7Providers.tsx | 196 | 0 | 0 | 0 | 0 | OK |
| 125 | PhysicalHealthTab.tsx | 196 | 0 | 0 | 0 | 3 | OK |
| 126 | CmiPanel.tsx | 196 | 0 | 0 | 0 | 7 | OK |
| 127 | KeyIssuesPanel.tsx | 194 | 0 | 0 | 0 | 2 | OK |
| 128 | Step6SupportPersons.tsx | 192 | 0 | 0 | 0 | 0 | OK |
| 129 | IntakePage.tsx | 192 | 0 | 4 | 0 | 8 | OK |
| 130 | TemplatesPage.tsx | 191 | 0 | 0 | 0 | 10 | OK |
| 131 | SafeScriptPanel.tsx | 190 | 0 | 0 | 0 | 0 | OK |
| 132 | ReferralSourcesPanel.tsx | 187 | 0 | 0 | 0 | 5 | OK |
| 133 | ClaimStatusPanel.tsx | 187 | 0 | 0 | 0 | 3 | OK |
| 134 | StaffPicker.tsx | 187 | 0 | 0 | 0 | 5 | OK |
| 135 | DraftsPage.tsx | 183 | 0 | 0 | 2 | 4 | OK |
| 136 | PasswordResetForm.tsx | 181 | 0 | 0 | 0 | 5 | OK |
| 137 | DataTable.tsx | 181 | 0 | 0 | 0 | 0 | OK |
| 138 | MessageComposer.tsx | 180 | 0 | 0 | 0 | 0 | OK |
| 139 | TopBar.tsx | 180 | 0 | 0 | 0 | 1 | OK |
| 140 | ConsultationView.tsx | 178 | 0 | 0 | 0 | 0 | OK |
| 141 | CommandPalette.tsx | 178 | 0 | 5 | 2 | 3 | OK |
| 142 | AmbientRecorder.tsx | 177 | 0 | 0 | 3 | 4 | OK |
| 143 | LaiGivenForm.tsx | 175 | 0 | 0 | 0 | 0 | OK |
| 144 | MedicationList.tsx | 173 | 0 | 0 | 0 | 5 | OK |
| 145 | LookupListPanel.tsx | 172 | 0 | 0 | 0 | 4 | OK |
| 146 | ListExportBar.tsx | 172 | 0 | 0 | 4 | 1 | OK |
| 147 | SpecialtyNotesPanel.tsx | 171 | 0 | 0 | 0 | 2 | OK |
| 148 | ClinicProfilePanel.tsx | 170 | 0 | 0 | 0 | 0 | OK |
| 149 | TodayContactsView.tsx | 170 | 0 | 0 | 0 | 0 | OK |
| 150 | NewThreadDialog.tsx | 170 | 0 | 0 | 0 | 2 | OK |
| 151 | ClinicianFeePanel.tsx | 167 | 0 | 0 | 0 | 6 | OK |
| 152 | LaiScheduleList.tsx | 166 | 0 | 0 | 0 | 3 | OK |
| 153 | MfaForm.tsx | 165 | 0 | 0 | 0 | 0 | OK |
| 154 | BillingPage.tsx | 164 | 0 | 0 | 0 | 3 | OK |
| 155 | CorrespondenceList.tsx | 163 | 0 | 0 | 0 | 2 | OK |
| 156 | NotificationBell.tsx | 160 | 0 | 0 | 0 | 2 | OK |
| 157 | PathologyOrdersList.tsx | 159 | 0 | 0 | 0 | 0 | OK |
| 158 | TaskForm.tsx | 158 | 0 | 0 | 0 | 0 | OK |
| 159 | ClinicianOfferCard.tsx | 157 | 0 | 0 | 0 | 3 | OK |
| 160 | EngagementRapportScale.tsx | 157 | 0 | 0 | 0 | 0 | OK |
| 161 | FeeSchedulePanel.tsx | 156 | 0 | 0 | 0 | 3 | OK |
| 162 | InvoiceForm.tsx | 154 | 0 | 0 | 0 | 0 | OK |
| 163 | HotSpotsPage.tsx | 152 | 0 | 3 | 0 | 7 | OK |
| 164 | SpecialtyMdtBanner.tsx | 152 | 0 | 0 | 0 | 0 | OK |
| 165 | EpisodeTimeline.tsx | 148 | 0 | 0 | 0 | 0 | OK |
| 166 | LaiScheduleForm.tsx | 147 | 0 | 0 | 0 | 0 | OK |
| 167 | PathwaysPage.tsx | 146 | 0 | 0 | 0 | 3 | OK |
| 168 | EReferralPage.tsx | 146 | 0 | 0 | 0 | 4 | OK |
| 169 | CalendarPage.tsx | 143 | 0 | 0 | 0 | 2 | OK |
| 170 | AppShell.tsx | 142 | 0 | 0 | 0 | 0 | OK |
| 171 | PrintExportButtons.tsx | 142 | 0 | 0 | 0 | 2 | OK |
| 172 | PatientSearchBar.tsx | 139 | 0 | 0 | 0 | 0 | OK |
| 173 | DuplicatePatientModal.tsx | 138 | 0 | 0 | 0 | 0 | OK |
| 174 | RiskScoreGauge.tsx | 135 | 0 | 0 | 0 | 0 | OK |
| 175 | InvoiceList.tsx | 132 | 0 | 0 | 0 | 3 | OK |
| 176 | DigitInput.tsx | 132 | 0 | 0 | 4 | 0 | OK |
| 177 | CarersTab.tsx | 129 | 0 | 0 | 0 | 3 | OK |
| 178 | EpisodeList.tsx | 129 | 0 | 0 | 0 | 3 | OK |
| 179 | MfaChallengeDialog.tsx | 129 | 0 | 0 | 0 | 4 | OK |
| 180 | ChangePasswordPage.tsx | 127 | 0 | 0 | 0 | 7 | OK |
| 181 | Step3Funding.tsx | 125 | 0 | 0 | 0 | 0 | OK |
| 182 | ICalSubscribeCard.tsx | 125 | 0 | 0 | 0 | 3 | OK |
| 183 | StepAttachments.tsx | 124 | 0 | 0 | 0 | 0 | OK |
| 184 | Letterhead.tsx | 122 | 0 | 0 | 0 | 0 | OK |
| 185 | Step2Identifiers.tsx | 121 | 0 | 0 | 0 | 0 | OK |
| 186 | Step8Consent.tsx | 121 | 0 | 0 | 0 | 0 | OK |
| 187 | EpisodeCard.tsx | 120 | 0 | 0 | 0 | 0 | OK |
| 188 | SessionWarningDialog.tsx | 118 | 0 | 0 | 0 | 2 | OK |
| 189 | ThemeProvider.tsx | 117 | 0 | 1 | 0 | 0 | OK |
| 190 | AuditPage.tsx | 116 | 0 | 0 | 0 | 4 | OK |
| 191 | NoteCard.tsx | 112 | 0 | 0 | 0 | 0 | OK |
| 192 | ErrorBoundary.tsx | 111 | 0 | 0 | 0 | 0 | OK |
| 193 | LevelLabelsPanel.tsx | 110 | 0 | 0 | 0 | 2 | OK |
| 194 | NoteSignModal.tsx | 108 | 0 | 0 | 0 | 0 | OK |
| 195 | AppointmentCard.tsx | 105 | 0 | 0 | 0 | 1 | OK |
| 196 | ClarificationPanel.tsx | 104 | 0 | 0 | 0 | 3 | OK |
| 197 | PatientCard.tsx | 103 | 0 | 0 | 0 | 0 | OK |
| 198 | DocumentsTab.tsx | 103 | 0 | 0 | 0 | 4 | OK |
| 199 | NoteAmendModal.tsx | 103 | 0 | 0 | 0 | 2 | OK |
| 200 | AppointmentCalendar.tsx | 102 | 0 | 0 | 0 | 0 | OK |
| 201 | KeyboardShortcuts.tsx | 102 | 0 | 0 | 0 | 3 | OK |
| 202 | EpisodeDetailPanel.tsx | 101 | 0 | 0 | 0 | 0 | OK |
| 203 | ReferralList.tsx | 101 | 0 | 0 | 0 | 0 | OK |
| 204 | Step5Medications.tsx | 99 | 0 | 0 | 0 | 0 | OK |
| 205 | PatientBanner.tsx | 98 | 0 | 0 | 0 | 0 | OK |
| 206 | DigitalSignature.tsx | 97 | 0 | 0 | 0 | 2 | OK |
| 207 | ReferralDetailPage.tsx | 96 | 0 | 0 | 0 | 2 | OK |
| 208 | MyOffersPage.tsx | 95 | 0 | 0 | 0 | 0 | OK |
| 209 | GenerateLetterFromNoteButton.tsx | 95 | 0 | 0 | 0 | 2 | OK |
| 210 | AllergyConflictBanner.tsx | 94 | 0 | 0 | 0 | 0 | OK |
| 211 | ProviderSearchAutocomplete.tsx | 93 | 0 | 0 | 0 | 2 | OK |
| 212 | ThresholdsPanel.tsx | 90 | 0 | 0 | 0 | 0 | OK |
| 213 | TemplateInsertMenu.tsx | 90 | 0 | 0 | 0 | 2 | OK |
| 214 | MedicationHistory.tsx | 87 | 0 | 0 | 0 | 0 | OK |
| 215 | Breadcrumbs.tsx | 84 | 0 | 0 | 0 | 0 | OK |
| 216 | PatientFlagsPanel.tsx | 81 | 0 | 0 | 0 | 0 | OK |
| 217 | ReferralLetterUpload.tsx | 80 | 0 | 0 | 0 | 2 | OK |
| 218 | LoadingOverlay.tsx | 80 | 0 | 0 | 0 | 0 | OK |
| 219 | ReferralCard.tsx | 78 | 0 | 0 | 0 | 0 | OK |
| 220 | SurgeryTab.tsx | 77 | 0 | 0 | 0 | 2 | OK |
| 221 | ConfirmDialog.tsx | 77 | 0 | 0 | 0 | 0 | OK |
| 222 | ResourcesPage.tsx | 75 | 0 | 0 | 0 | 2 | OK |
| 223 | PaediatricsTab.tsx | 73 | 0 | 0 | 0 | 2 | OK |
| 224 | LaiAdministrationHistory.tsx | 73 | 0 | 0 | 0 | 0 | OK |
| 225 | OrgSettingsPage.tsx | 71 | 0 | 0 | 0 | 1 | OK |
| 226 | OcrPreviewPanel.tsx | 71 | 0 | 0 | 0 | 0 | OK |
| 227 | SpecialtyInformationExchangeTab.tsx | 71 | 0 | 0 | 0 | 2 | OK |
| 228 | ClinicianOffersPanel.tsx | 68 | 0 | 0 | 0 | 0 | OK |
| 229 | ObsGyneTab.tsx | 68 | 0 | 0 | 0 | 2 | OK |
| 230 | MentalHealthInformationExchangeTab.tsx | 67 | 0 | 0 | 0 | 2 | OK |
| 231 | CheckInPanel.tsx | 67 | 0 | 0 | 0 | 2 | OK |
| 232 | ReferralWorkflowTimeline.tsx | 66 | 0 | 0 | 0 | 0 | OK |
| 233 | MessagingPage.tsx | 66 | 0 | 0 | 0 | 3 | OK |
| 234 | FormSection.tsx | 65 | 0 | 0 | 0 | 0 | OK |
| 235 | Step4Conditions.tsx | 63 | 0 | 0 | 0 | 0 | OK |
| 236 | ReferralFeedbackHistory.tsx | 62 | 0 | 0 | 0 | 0 | OK |
| 237 | PatientTabBar.tsx | 51 | 0 | 0 | 0 | 0 | OK |
| 238 | MarkdownRenderer.tsx | 47 | 0 | 2 | 0 | 0 | OK |
| 239 | FlagBadge.tsx | 44 | 0 | 0 | 0 | 0 | OK |
| 240 | WaitlistPanel.tsx | 39 | 0 | 0 | 0 | 0 | OK |
| 241 | AuthGuard.tsx | 36 | 0 | 0 | 0 | 0 | OK |
| 242 | AIDraftBanner.tsx | 33 | 0 | 0 | 0 | 0 | OK |
| 243 | main.tsx | 31 | 0 | 0 | 0 | 0 | OK |
