# useMutation onError Gap Findings — 2026-04-19

## Summary

- **Total useMutation hooks**: 250
- **Write operations (POST/PUT/PATCH/DELETE)**: 132
- **With onError handlers**: 44 (17.6%)
- **WITHOUT onError**: 206 (82.4%)
- **onError present but empty**: 0 (none detected)

## Bug 6 Candidates: Server-State Mutations Without Error Handling

**HIGH RISK:** 99 mutations that write server state but have NO onError handler.

These mutations will silently fail, leaving the UI out of sync with server state. Users won't know if their action succeeded or failed.

### Table: High-Risk Mutations (All 99)

| # | File:Line | Method | Endpoint | invalidateQueries | Risk |
|---|---|---|---|---|---|
| 1 | `apps/web/src/features/auth/components/PasswordResetForm.tsx:22` | POST | `auth/password-reset/request` | NO - DOUBLE FAIL | CRITICAL |
| 2 | `apps/web/src/features/auth/components/PasswordResetForm.tsx:98` | POST | `auth/password-reset/confirm` | NO - DOUBLE FAIL | CRITICAL |
| 3 | `apps/web/src/features/auth/pages/ChangePasswordPage.tsx:25` | POST | `auth/change-password` | NO - DOUBLE FAIL | CRITICAL |
| 4 | `apps/web/src/features/case-management/pages/CaseManagementPage.tsx:138` | POST | `care-plans/${patientId}/goals` | YES | HIGH |
| 5 | `apps/web/src/features/case-management/pages/CaseManagementPage.tsx:142` | POST | `care-plans/${patientId}/goals` | YES | HIGH |
| 6 | `apps/web/src/features/ereferral/pages/EReferralPage.tsx:29` | POST | `ereferrals` | YES | HIGH |
| 7 | `apps/web/src/features/ereferral/pages/EReferralPage.tsx:34` | POST | `ereferrals` | YES | HIGH |
| 8 | `apps/web/src/features/group-therapy/pages/GroupTherapyPage.tsx:222` | POST | `group-therapy/${session.id}/attendees` | YES | HIGH |
| 9 | `apps/web/src/features/group-therapy/pages/GroupTherapyPage.tsx:228` | DELETE | `group-therapy/${session.id}/attendees/${attendeeId}` | YES | HIGH |
| 10 | `apps/web/src/features/group-therapy/pages/GroupTherapyPage.tsx:234` | PATCH | `group-therapy/${session.id}/attendees/${attendeeId}` | YES | HIGH |
| 11 | `apps/web/src/features/group-therapy/pages/GroupTherapyPage.tsx:241` | POST | `group-therapy/${session.id}/attendees/${attendeeId}/note` | YES | HIGH |
| 12 | `apps/web/src/features/group-therapy/pages/GroupTherapyPage.tsx:262` | PATCH | `group-therapy/${session.id}` | YES | HIGH |
| 13 | `apps/web/src/features/group-therapy/pages/GroupTherapyPage.tsx:268` | PATCH | `group-therapy/${session.id}` | YES | HIGH |
| 14 | `apps/web/src/features/lists/pages/AdmissionWaitlistPage.tsx:27` | PATCH | `patients/admission-waitlist/${id}/remove` | YES | HIGH |
| 15 | `apps/web/src/features/lists/pages/AdmissionWaitlistPage.tsx:32` | PATCH | `patients/admission-waitlist/${id}/remove` | YES | HIGH |
| 16 | `apps/web/src/features/lists/pages/HotSpotsPage.tsx:42` | PATCH | `patients/hotspots/${resolveId}` | YES | HIGH |
| 17 | `apps/web/src/features/nursing/pages/NursingPage.tsx:76` | POST | `medication-administrations` | YES | HIGH |
| 18 | `apps/web/src/features/nursing/pages/NursingPage.tsx:194` | POST | `structured-observations` | YES | HIGH |
| 19 | `apps/web/src/features/nursing/pages/NursingPage.tsx:488` | POST | `nursing-assessments` | NO - DOUBLE FAIL | CRITICAL |
| 20 | `apps/web/src/features/nursing/pages/NursingPage.tsx:540` | POST | `shift-handovers` | NO - DOUBLE FAIL | CRITICAL |
| 21 | `apps/web/src/features/nursing/pages/NursingPage.tsx:653` | PATCH | `phone-triage/${d.id}/clinical-triage` | YES | HIGH |
| 22 | `apps/web/src/features/oncology/tabs/OncologyTab.tsx:136` | POST | `oncology/ecog` | YES | HIGH |
| 23 | `apps/web/src/features/oncology/tabs/OncologyTab.tsx:161` | POST | `oncology/ecog` | YES | HIGH |
| 24 | `apps/web/src/features/patients/components/PatientList.tsx:268` | PATCH | `patients/${patientId}/reactivate` | YES | HIGH |
| 25 | `apps/web/src/features/patients/components/detail/PatientDetailLayout.tsx:733` | POST | `patients/${patientId}/hotspot` | YES | HIGH |
| 26 | `apps/web/src/features/patients/components/detail/tabs/AlertsPlansTab.tsx:67` | POST | `patients/${patientId}/alerts` | YES | HIGH |
| 27 | `apps/web/src/features/patients/components/detail/tabs/AlertsPlansTab.tsx:71` | POST | `patients/${patientId}/alerts` | YES | HIGH |
| 28 | `apps/web/src/features/patients/components/detail/tabs/AlertsPlansTab.tsx:771` | POST | `nursing-assessments` | YES | HIGH |
| 29 | `apps/web/src/features/patients/components/detail/tabs/AssessmentsTab.tsx:139` | POST | `outcomes` | YES | HIGH |
| 30 | `apps/web/src/features/patients/components/detail/tabs/AssessmentsTab.tsx:154` | POST | `patients/${patientId}/notes` | YES | HIGH |
| 31 | `apps/web/src/features/patients/components/detail/tabs/CarersTab.tsx:35` | POST | `carers` | YES | HIGH |
| 32 | `apps/web/src/features/patients/components/detail/tabs/CorrespondenceTab.tsx:406` | POST | `correspondence/letters` | YES | HIGH |
| 33 | `apps/web/src/features/patients/components/detail/tabs/EctTab.tsx:236` | POST | `nursing-assessments` | YES | HIGH |
| 34 | `apps/web/src/features/patients/components/detail/tabs/EctTab.tsx:365` | POST | `nursing-assessments` | YES | HIGH |
| 35 | `apps/web/src/features/patients/components/detail/tabs/EctTab.tsx:571` | POST | `nursing-assessments` | YES | HIGH |
| 36 | `apps/web/src/features/patients/components/detail/tabs/EctTab.tsx:667` | POST | `nursing-assessments` | YES | HIGH |
| 37 | `apps/web/src/features/patients/components/detail/tabs/EpisodesTab.tsx:104` | POST | `episodes` | YES | HIGH |
| 38 | `apps/web/src/features/patients/components/detail/tabs/EpisodesTab.tsx:105` | POST | `episodes` | YES | HIGH |
| 39 | `apps/web/src/features/patients/components/detail/tabs/EpisodesTab.tsx:106` | POST | `episodes` | YES | HIGH |
| 40 | `apps/web/src/features/patients/components/detail/tabs/EpisodesTab.tsx:326` | POST | `episodes/${episode.id}/close` | YES | HIGH |
| 41 | `apps/web/src/features/patients/components/detail/tabs/EpisodesTab.tsx:1011` | POST | `patients/${patientId}/hotspot` | YES | HIGH |
| 42 | `apps/web/src/features/patients/components/detail/tabs/EpisodesTab.tsx:1156` | POST | `tasks` | YES | HIGH |
| 43 | `apps/web/src/features/patients/components/detail/tabs/EpisodesTab.tsx:1160` | POST | `tasks` | YES | HIGH |
| 44 | `apps/web/src/features/patients/components/detail/tabs/EpisodesTab.tsx:1164` | PATCH | `tasks/${data.id}` | YES | HIGH |
| 45 | `apps/web/src/features/patients/components/detail/tabs/MedicationsTab.tsx:1035` | POST | `lai/validations` | YES | HIGH |
| 46 | `apps/web/src/features/patients/components/detail/tabs/MedicationsTab.tsx:1552` | POST | `clozapine` | YES | HIGH |
| 47 | `apps/web/src/features/patients/components/detail/tabs/MedicationsTab.tsx:1565` | POST | `clozapine/blood-results` | YES | HIGH |
| 48 | `apps/web/src/features/patients/components/detail/tabs/MedicationsTab.tsx:1583` | POST | `clozapine/administrations` | YES | HIGH |
| 49 | `apps/web/src/features/patients/components/detail/tabs/MedicationsTab.tsx:1610` | POST | `clozapine/observations` | YES | HIGH |
| 50 | `apps/web/src/features/patients/components/detail/tabs/MedicationsTab.tsx:1622` | POST | `clozapine/monitoring-checks` | YES | HIGH |
| 51 | `apps/web/src/features/patients/components/detail/tabs/MedicationsTab.tsx:1634` | POST | `clozapine/titration-days` | YES | HIGH |
| 52 | `apps/web/src/features/patients/components/detail/tabs/MedicationsTab.tsx:2926` | POST | `medication-administrations` | YES | HIGH |
| 53 | `apps/web/src/features/patients/components/detail/tabs/NinetyOneDayReviewTab.tsx:145` | POST | `patients/${patientId}/notes` | NO - DOUBLE FAIL | CRITICAL |
| 54 | `apps/web/src/features/patients/components/detail/tabs/TmsTab.tsx:117` | POST | `nursing-assessments` | YES | HIGH |
| 55 | `apps/web/src/features/patients/components/detail/tabs/TmsTab.tsx:261` | POST | `nursing-assessments` | YES | HIGH |
| 56 | `apps/web/src/features/patients/components/detail/tabs/TmsTab.tsx:365` | POST | `nursing-assessments` | YES | HIGH |
| 57 | `apps/web/src/features/patients/components/detail/tabs/TmsTab.tsx:413` | POST | `nursing-assessments` | YES | HIGH |
| 58 | `apps/web/src/features/patients/components/detail/tabs/VivaTab.tsx:422` | POST | `patient-app/thresholds/${patientId}` | YES | HIGH |
| 59 | `apps/web/src/features/patients/components/detail/tabs/VivaTab.tsx:427` | POST | `patient-app/thresholds/${patientId}` | YES | HIGH |
| 60 | `apps/web/src/features/patients/components/detail/tabs/VivaTab.tsx:714` | POST | `patient-app/med-reminders/${patientId}` | YES | HIGH |
| 61 | `apps/web/src/features/patients/components/detail/tabs/VivaTab.tsx:719` | POST | `patient-app/med-reminders/${patientId}` | YES | HIGH |
| 62 | `apps/web/src/features/patients/components/detail/tabs/VivaTab.tsx:852` | POST | `patient-app/med-reminders/${patientId}` | YES | HIGH |
| 63 | `apps/web/src/features/patients/components/detail/tabs/VivaTab.tsx:857` | POST | `patient-app/med-reminders/${patientId}` | YES | HIGH |
| 64 | `apps/web/src/features/patients/components/detail/tabs/VivaTab.tsx:961` | POST | `patient-app/shared-docs/${patientId}` | YES | HIGH |
| 65 | `apps/web/src/features/patients/components/detail/tabs/VivaTab.tsx:1058` | POST | `patient-app/assessments/${patientId}/assign` | YES | HIGH |
| 66 | `apps/web/src/features/patients/components/detail/tabs/VivaTab.tsx:1258` | POST | `patient-app/tracking` | YES | HIGH |
| 67 | `apps/web/src/features/patients/components/detail/tabs/VivaTab.tsx:1266` | POST | `patient-app/tracking` | YES | HIGH |
| 68 | `apps/web/src/features/patients/components/detail/tabs/VivaTab.tsx:1650` | POST | `patient-app/tasks/${patientId}` | YES | HIGH |
| 69 | `apps/web/src/features/power-settings/pages/PowerSettingsPage.tsx:289` | POST | `staff-settings/alert-types` | YES | HIGH |
| 70 | `apps/web/src/features/power-settings/pages/PowerSettingsPage.tsx:290` | POST | `staff-settings/alert-types` | YES | HIGH |
| 71 | `apps/web/src/features/power-settings/pages/PowerSettingsPage.tsx:291` | POST | `staff-settings/alert-types` | YES | HIGH |
| 72 | `apps/web/src/features/power-settings/pages/PowerSettingsPage.tsx:310` | POST | `staff-settings/legal-order-types` | YES | HIGH |
| 73 | `apps/web/src/features/power-settings/pages/PowerSettingsPage.tsx:311` | POST | `staff-settings/legal-order-types` | YES | HIGH |
| 74 | `apps/web/src/features/power-settings/pages/PowerSettingsPage.tsx:312` | POST | `staff-settings/legal-order-types` | YES | HIGH |
| 75 | `apps/web/src/features/power-settings/pages/PowerSettingsPage.tsx:331` | POST | `staff-settings/appointment-modes` | YES | HIGH |
| 76 | `apps/web/src/features/power-settings/pages/PowerSettingsPage.tsx:332` | POST | `staff-settings/appointment-modes` | YES | HIGH |
| 77 | `apps/web/src/features/power-settings/pages/PowerSettingsPage.tsx:333` | POST | `staff-settings/appointment-modes` | YES | HIGH |
| 78 | `apps/web/src/features/power-settings/pages/PowerSettingsPage.tsx:347` | POST | `staff-settings/template-categories` | YES | HIGH |
| 79 | `apps/web/src/features/power-settings/pages/PowerSettingsPage.tsx:348` | POST | `staff-settings/template-categories` | YES | HIGH |
| 80 | `apps/web/src/features/power-settings/pages/PowerSettingsPage.tsx:361` | POST | `staff-settings/episode-types` | YES | HIGH |
| 81 | `apps/web/src/features/power-settings/pages/PowerSettingsPage.tsx:362` | POST | `staff-settings/episode-types` | YES | HIGH |
| 82 | `apps/web/src/features/power-settings/pages/PowerSettingsPage.tsx:363` | POST | `staff-settings/episode-types` | YES | HIGH |
| 83 | `apps/web/src/features/power-settings/pages/PowerSettingsPage.tsx:396` | POST | `staff-settings/role-types` | YES | HIGH |
| 84 | `apps/web/src/features/power-settings/pages/PowerSettingsPage.tsx:400` | POST | `staff-settings/role-types` | YES | HIGH |
| 85 | `apps/web/src/features/power-settings/pages/PowerSettingsPage.tsx:404` | PUT | `staff-settings/role-types/${id}` | YES | HIGH |
| 86 | `apps/web/src/features/power-settings/pages/PowerSettingsPage.tsx:497` | PUT | `power-settings/subscriptions/${selectedClinic}/modules/${moduleKey}` | YES | HIGH |
| 87 | `apps/web/src/features/power-settings/pages/PowerSettingsPage.tsx:619` | PUT | `power-settings/specialties/${selectedClinic}/${specialtyCode}` | YES | HIGH |
| 88 | `apps/web/src/features/psychiatrist/pages/PsychiatristPage.tsx:150` | POST | `clinical-formulations` | YES | HIGH |
| 89 | `apps/web/src/features/psychiatrist/pages/PsychiatristPage.tsx:416` | POST | `clinical-notes` | NO - DOUBLE FAIL | CRITICAL |
| 90 | `apps/web/src/features/receptionist/pages/ReceptionistPage.tsx:124` | POST | `appointments/${appt.id}/check-in` | YES | HIGH |
| 91 | `apps/web/src/features/receptionist/pages/ReceptionistPage.tsx:239` | POST | `tasks` | NO - DOUBLE FAIL | CRITICAL |
| 92 | `apps/web/src/features/referrals/pages/ReferralCoordinatorQueue.tsx:127` | POST | `referrals/${id}/notes` | YES | HIGH |
| 93 | `apps/web/src/features/referrals/pages/ReferralCoordinatorQueue.tsx:139` | POST | `referrals/${id}/notes` | YES | HIGH |
| 94 | `apps/web/src/features/referrals/pages/ReferralCoordinatorQueue.tsx:151` | POST | `referrals/${id}/notes` | YES | HIGH |
| 95 | `apps/web/src/features/referrals/pages/ReferralCoordinatorQueue.tsx:194` | POST | `referrals` | YES | HIGH |
| 96 | `apps/web/src/features/referrals/pages/ReferralsPage.tsx:79` | POST | `referrals/${data.referralId}/allocate` | YES | HIGH |
| 97 | `apps/web/src/features/referrals/pages/ReferralsPage.tsx:87` | POST | `referrals/${data.referralId}/allocate` | YES | HIGH |
| 98 | `apps/web/src/features/referrals/pages/ReferralsPage.tsx:96` | POST | `referrals/${data.referralId}/allocate` | YES | HIGH |
| 99 | `apps/web/src/features/referrals/pages/ReferralsPage.tsx:105` | POST | `referrals/${data.referralId}/allocate` | YES | HIGH |


## Analysis

### Breakdown by Risk

- **CRITICAL (write + no onError + no invalidateQueries)**: 8
- **HIGH (write + no onError + has invalidateQueries)**: 91

### Recommendations

1. **Immediate**: Add `onError` handlers to all 99 mutations listed above
2. **Error handler template**:
   ```typescript
   onError: (err) => {
     toast.error(err?.message || 'Operation failed');
     logger.error({'mutation_error': err});
   }
   ```
3. **Audit**: For CRITICAL mutations, also add `invalidateQueries` to refresh stale data

### Files with Most High-Risk Mutations

- `apps/web/src/features/power-settings/pages/PowerSettingsPage.tsx`: 19 mutations
- `apps/web/src/features/patients/components/detail/tabs/VivaTab.tsx`: 11 mutations
- `apps/web/src/features/patients/components/detail/tabs/EpisodesTab.tsx`: 8 mutations
- `apps/web/src/features/patients/components/detail/tabs/MedicationsTab.tsx`: 8 mutations
- `apps/web/src/features/group-therapy/pages/GroupTherapyPage.tsx`: 6 mutations
- `apps/web/src/features/nursing/pages/NursingPage.tsx`: 5 mutations
- `apps/web/src/features/patients/components/detail/tabs/EctTab.tsx`: 4 mutations
- `apps/web/src/features/patients/components/detail/tabs/TmsTab.tsx`: 4 mutations
- `apps/web/src/features/referrals/pages/ReferralCoordinatorQueue.tsx`: 4 mutations
- `apps/web/src/features/referrals/pages/ReferralsPage.tsx`: 4 mutations
