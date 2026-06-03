# useEffect Inventory — 2026-04-19

Total: 73

| # | File:Line | Dependencies | Cleanup function? | Subscriptions inside? (setInterval/setTimeout/addEventListener/BroadcastChannel/EventSource) | Issue |
|---|---|---|---|---|---|
| 1 | apps/web/src/router.tsx:28 | [location.pathname] | NO | none | — |
| 2 | apps/web/src/shared/hooks/useEventStream.ts:37 | [isAuth, qc] | YES (clearTimeout, sourceRef.close()) | EventSource, setTimeout | — |
| 3 | apps/web/src/shared/hooks/useDebounce.ts:8 | [value, delay] | YES (clearTimeout) | setTimeout | — |
| 4 | apps/web/src/shared/hooks/useCsrf.ts:14 | [] | NO | none | — |
| 5 | apps/web/src/shared/hooks/useInactivityTimer.ts:70 | [isAuth, resetTimer] | YES (clearTimeout×3, removeEventListener) | setTimeout×2, setInterval | — |
| 6 | apps/web/src/shared/hooks/useBrandingLoader.ts:21 | [data, setBranding] | NO | none | — |
| 7 | apps/web/src/features/clinical-notes/hooks/useSnippetMacros.ts:100 | [onInsert] | NO | none | — |
| 8 | apps/web/src/features/clinical-notes/hooks/useSnippetMacros.ts:101 | [onHelp] | NO | none | — |
| 9 | apps/web/src/features/clinical-notes/hooks/useSnippetMacros.ts:102 | [onError] | NO | none | — |
| 10 | apps/web/src/shared/components/ui/SessionWarningDialog.tsx:30 | [show, secondsLeft] | NO | none | — |
| 11 | apps/web/src/features/messaging/components/MessageComposer.tsx:48 | [messages] | NO | none | — |
| 12 | apps/web/src/shared/components/ui/KeyboardShortcuts.tsx:24 | [navigate, pendingKey] | YES (removeEventListener, clearTimeout) | addEventListener, setTimeout | — |
| 13 | apps/web/src/features/ai-agent/pages/AiAgentPage.tsx:140 | [] | NO | none | — |
| 14 | apps/web/src/shared/components/ui/Sidebar.tsx:278 | [hiddenItems] | NO | none | — |
| 15 | apps/web/src/features/clinical-notes/components/NoteAmendModal.tsx:24 | [originalNote] | NO | none | — |
| 16 | apps/web/src/features/clinical-notes/components/NoteEditor.tsx:31 | [content, editor] | NO | none | — |
| 17 | apps/web/src/features/clinical-notes/components/AmbientRecorder.tsx:26 | [draft, onDraftReady] | NO | none | — |
| 18 | apps/web/src/features/clinical-notes/components/AmbientRecorder.tsx:30 | [isGenerating] | NO | none | — |
| 19 | apps/web/src/shared/components/ui/GuidedTour.tsx:111 | [] | YES (removeEventListener) | addEventListener | — |
| 20 | apps/web/src/shared/components/ui/GuidedTour.tsx:150 | [activeTour, next] | YES (removeEventListener) | addEventListener | — |
| 21 | apps/web/src/shared/components/ui/CommandPalette.tsx:37 | [] | YES (removeEventListener) | addEventListener | — |
| 22 | apps/web/src/features/power-settings/pages/PowerSettingsPage.tsx:153 | [selectedClinicId, allBranding, reset] | NO | none | — |
| 23 | apps/web/src/features/power-settings/pages/PowerSettingsPage.tsx:159 | [clinics, selectedClinicId] | NO | none | **stale closure risk** (missing reset in deps) |
| 24 | apps/web/src/features/internal-medicine/tabs/MedReconciliationTab.tsx:164 | [open, activeMeds] | NO | none | — |
| 25 | apps/web/src/features/notifications/useNotifications.ts:47 | [onEvent, qc] | YES (return unsubscribe) | SSE event listener | — |
| 26 | apps/web/src/features/risk-allergies/components/RiskAssessmentForm.tsx:78 | [template, setValue] | NO | none | — |
| 27 | apps/web/src/features/risk-allergies/components/RiskAssessmentForm.tsx:89 | [totalScore, derivedLevel, setValue] | NO | none | — |
| 28 | apps/web/src/features/waitlist/components/ConnectOutlookButton.tsx:38 | [] | NO | none | **infinite loop risk** — fetchStatus() not in deps |
| 29 | apps/web/src/features/waitlist/components/ConnectOutlookButton.tsx:43 | [] | NO | none | — |
| 30 | apps/web/src/features/settings/components/ClinicProfilePanel.tsx:65 | [data, reset] | NO | none | — |
| 31 | apps/web/src/features/settings/components/ThresholdsPanel.tsx:38 | [thresholds, reset] | NO | none | — |
| 32 | apps/web/src/features/settings/components/AiTrainingModule.tsx:81 | [currentConfig] | NO | none | — |
| 33 | apps/web/src/features/dashboard/pages/DashboardPage.tsx:139 | [autoRefresh, qc] | YES (clearInterval) | setInterval | — |
| 34 | apps/web/src/features/settings/pages/SettingsPage.tsx:422 | [] | NO | none | — |
| 35 | apps/web/src/features/surgery/tabs/PacuTab.tsx:202 | [cases, selectedId] | NO | none | — |
| 36 | apps/web/src/features/surgery/tabs/OpNoteTab.tsx:73 | [cases, selectedId] | NO | none | — |
| 37 | apps/web/src/features/surgery/tabs/OpNoteTab.tsx:87 | [selectedId, existing] | NO | none | — |
| 38 | apps/web/src/features/oncology/tabs/OncologyTab.tsx:130 | [conditions, selectedConditionId] | NO | none | — |
| 39 | apps/web/src/features/surgery/tabs/SafetyChecklistTab.tsx:122 | [existing] | NO | none | — |
| 40 | apps/web/src/features/surgery/tabs/SafetyChecklistTab.tsx:189 | [cases, selectedId] | NO | none | — |
| 41 | apps/web/src/features/calendar/components/AvailabilityGridEditor.tsx:113 | [dragging, pending] | YES (removeEventListener) | addEventListener | eslint-disable comment present |
| 42 | apps/web/src/features/patients/components/notes/SendMessageDialog.tsx:104 | [open] | NO | none | — |
| 43 | apps/web/src/features/subscription/pages/SubscriptionPage.tsx:243 | [subscription, open] | NO | none | — |
| 44 | apps/web/src/features/subscription/pages/SubscriptionPage.tsx:312 | [open] | NO | none | — |
| 45 | apps/web/src/features/patients/components/notes/ContactFormDialog.tsx:186 | [open, opts] | NO | none | eslint-disable comment present |
| 46 | apps/web/src/features/patients/components/notes/ContactFormDialog.tsx:210 | [episodes] | NO | none | eslint-disable comment present |
| 47 | apps/web/src/features/patients/components/notes/ContactFormDialog.tsx:216 | [templates, open, initialNoteType] | NO | none | eslint-disable comment present |
| 48 | apps/web/src/features/patients/components/notes/ContactFormDialog.tsx:229 | [episodeId, episodes] | NO | none | — |
| 49 | apps/web/src/features/obs-gyne/tabs/AntenatalVisitsTab.tsx:213 | [pregnancies, selectedId] | NO | none | — |
| 50 | apps/web/src/features/patients/components/notes/AmbientAiRecorder.tsx:235 | [checkServices] | NO | none | — |
| 51 | apps/web/src/features/patients/components/notes/AmbientAiRecorder.tsx:254 | [] | YES (clearInterval, cancelAnimationFrame, getTracks.stop) | setInterval, requestAnimationFrame | — |
| 52 | apps/web/src/features/patients/components/notes/AddNoteDialog.tsx:158 | [episodes] | NO | none | — |
| 53 | apps/web/src/features/patients/components/notes/AddNoteDialog.tsx:164 | [open, episodes] | NO | none | — |
| 54 | apps/web/src/features/patients/components/notes/AddNoteDialog.tsx:190 | [open, defaultTemplate, templateId, defaultContent] | NO | none | — |
| 55 | apps/web/src/features/patients/components/notes/AddNoteDialog.tsx:769 | (not shown in read) | ? | ? | **verify** |
| 56 | apps/web/src/features/patients/components/notes/NotesList.tsx:50 | [patientId, qc] | YES (ch.close()) | BroadcastChannel | — |
| 57 | apps/web/src/features/mobile/pages/MobileScribePage.tsx:84 | [] | YES (getTracks.stop, clearInterval) | — | — |
| 58 | apps/web/src/features/patients/components/detail/PatientDetailLayout.tsx:203 | [patient, patientId, openTab] | NO | none | — |
| 59 | apps/web/src/features/drafts/pages/DraftsPage.tsx:63 | [loadDrafts] | NO | none | — |
| 60 | apps/web/src/features/org-settings/components/LevelLabelsPanel.tsx:36 | [savedLabels] | NO | none | — |
| 61 | apps/web/src/features/org-settings/components/ScribeConsentPanel.tsx:59 | [data?.scribeConsentMode, data?.aiChatClassifierMode, data?.scribeAudioRetention] | NO | none | — |
| 62 | apps/web/src/features/patients/components/detail/tabs/MedicationsTab.tsx:582 | [medication] | NO | none | — |
| 63 | apps/web/src/features/patients/components/detail/tabs/MedicationsTab.tsx:2605 | [defaultMedName, defaultGeneric, defaultDose, defaultRoute, defaultFrequency, defaultLai, defaultClozapine, defaultS8] | NO | none | — |
| 64 | apps/web/src/features/patients/components/detail/tabs/AppointmentsTab.tsx:318 | [editing, open] | NO | none | — |
| 65 | apps/web/src/features/patients/components/detail/tabs/AppointmentsTab.tsx:333 | [startTime, duration] | NO | none | — |
| 66 | apps/web/src/features/auth/pages/MfaPage.tsx:10 | [navigate] | NO | none | — |
| 67 | apps/web/src/features/patients/components/detail/tabs/EpisodesTab.tsx:857 | [existingAlloc] | NO | none | — |
| 68 | apps/web/src/features/staff-settings/components/EditStaffCredentialsDialog.tsx:51 | [data] | NO | none | — |
| 69 | apps/web/src/features/patients/components/PatientList.tsx:293 | [myTeamIds, defaultsApplied] | NO | none | — |
| 70 | apps/web/src/features/patients/components/PatientList.tsx:301 | [debouncedSearch, status, teamFilter, clinicianFilter, keyWorkerFilter] | NO | none | — |
| 71 | apps/web/src/features/appointments/pages/AppointmentsPage.tsx:270 | [alloc, inviteEmails, setInviteEmails] | NO | none | **stale closure risk** (inviteEmails in deps causes re-runs) |
| 72 | apps/web/src/features/appointments/pages/AppointmentsPage.tsx:328 | [startTime, duration] | NO | none | — |
| 73 | apps/web/src/features/patients/components/registration/EditPatientWizard.tsx:537 | [open, patientId] | NO | none | — |

## Summary

**Total: 73 useEffect hooks**

**Issues detected:**
- **3 LEAK flags**: None found with missing cleanup
- **2 stale closure risk**: Line 23 (PowerSettingsPage), Line 71 (AppointmentsPage) — dependencies incomplete
- **1 infinite loop risk**: Line 28 (ConnectOutlookButton) — fetchStatus() called but not in deps
- **4 eslint-disable comments**: Lines 41, 45, 46, 47 — dependencies suppressed intentionally
- **1 unverified**: Line 55 (AddNoteDialog:769) — full context not shown in read

## Key Observations

1. **Event listeners**: All addEventListener/removeEventListener pairs are properly cleaned up in return statements.
2. **Timers**: setTimeout/setInterval subscriptions are properly cleared in cleanup functions (useEventStream, useDebounce, useInactivityTimer, KeyboardShortcuts, DashboardPage, AmbientAiRecorder, MobileScribePage).
3. **BroadcastChannel**: NotesList.tsx:50 properly closes the BroadcastChannel in cleanup.
4. **EventSource**: useEventStream.ts:37 properly closes EventSource and clears reconnect timeouts.
5. **No missing dependencies on effects with subscriptions**: All effects that register event listeners or timers properly clean them up.
6. **Potential issues**:
   - ConnectOutlookButton.tsx:38 has empty deps but calls fetchStatus() — should add fetchStatus to deps or memoize it
   - PowerSettingsPage.tsx:159 and AppointmentsPage.tsx:270 have incomplete dependency arrays that could cause stale closure issues

