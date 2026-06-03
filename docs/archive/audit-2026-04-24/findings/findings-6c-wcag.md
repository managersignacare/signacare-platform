# Findings 6c — WCAG 2.1 AA static screen

**Agent:** G-wcag
**Scope:** 270 `.tsx` files under `apps/web/src/features/**` + `apps/web/src/shared/**`.

## Summary

| SC | `[A11Y_BUG]` | `[A11Y_HEURISTIC]` | Notes |
|---|---:|---:|---|
| 1.1.1 non-text | 0 | 0 | All 4 `<img>` have alt |
| 1.3.1 info/relationships | 0 | 0 | 681 TextField, 299 FormControl — clean |
| **2.1.1 keyboard** | **~67** | ~50 | 36 files with clickable `<Card|Paper|Box|div>` missing keyboard handling |
| 2.4.3 focus order | 0 | 0 | No positive tabIndex |
| 2.4.4 link purpose | 0 | 0 | — |
| 3.3.2 labels/instructions | 0 | 34 | MUI auto-asterisk; visual check needed |
| **4.1.2 name/role/value** | **14** | ~50 | IconButtons with no Tooltip + no `aria-label` |
| 4.1.3 status messages | 0 | 3 | 168 aria-live elements present |
| **ARIA hygiene** | **96 dialogs** share `aria-labelledby="dialog-title"` with 97 DialogTitles using identical id | — | WCAG 4.1.1 parsing violation |
| Contrast | 0 | 0 | Needs axe-core live scan |

## [A11Y_BUG] — SC 2.1.1 (keyboard-inaccessible interactive elements)

Exemplary patterns (only 2 files in whole app): `Sidebar.tsx`, `ReferralLetterUpload.tsx`.

Top offenders (20+ found; each is a distinct bug):

| # | File:line | Element |
|---|---|---|
| 1 | `features/dashboard/pages/DashboardPage.tsx:1039` | KpiCard `<Card onClick>` — mouse only |
| 2 | `features/dashboard/pages/DashboardPage.tsx:1150` | dashboard row |
| 3 | `features/dashboard/pages/DashboardPage.tsx:337` | `<Paper onClick>` |
| 4 | `features/case-management/pages/CaseManagementPage.tsx:87` | `<Card onClick navigate>` |
| 5 | `features/patients/components/notes/NotesList.tsx:102` | `<Card onClick openNoteInWindow>` |
| 6 | `features/drafts/pages/DraftsPage.tsx:107` | `<Card onClick>` |
| 7 | `features/patients/components/detail/tabs/CorrespondenceTab.tsx:352` | thread expand |
| 8 | `features/patients/components/detail/tabs/CorrespondenceTab.tsx:805` | letter expand |
| 9 | `features/escalations/components/EscalationList.tsx:154-167` | escalation Paper expand — **safety-critical** |
| 10 | `features/patients/components/detail/tabs/EpisodesTab.tsx:266` | episode card |
| 11 | `features/lists/pages/HotSpotsPage.tsx:96` | hotspot row |
| 12 | `features/psychiatrist/pages/PsychiatristPage.tsx:77-79` | appointment Paper |
| 13 | `features/settings/pages/SettingsPage.tsx:101-103` | theme selector |
| 14 | `features/referrals/pages/ReferralsPage.tsx:164, 649-650` | section collapse + patient search row |
| 15 | `features/power-settings/pages/PowerSettingsPage.tsx:548-554, 665-667` | specialty toggles |
| 16 | `shared/components/ui/PatientTabBar.tsx:24` | tab switch Box |
| 17 | `features/appointments/pages/AppointmentsPage.tsx:171` | patient autocomplete row |
| 18-20+ | AlertsPlansTab, MedicationsTab, InpatientCareTab, VivaTab, AiAgentPage, AdmissionWaitlistPage, StaffAssignmentsPage | — |

## [A11Y_BUG] — SC 4.1.2 (IconButton with no accessible name)

| # | File:line | Icon |
|---|---|---|
| B1 | `features/appointments/pages/AppointmentsPage.tsx:146` | ChevronLeft |
| B2 | `features/appointments/pages/AppointmentsPage.tsx:147` | ChevronRight |
| B3 | `features/patients/components/detail/PatientDetailLayout.tsx:379` | summary-pane toggle `▶`/`◀` |
| B4 | `features/dashboard/pages/DashboardPage.tsx:870` | refresh |
| B5 | `features/dashboard/pages/DashboardPage.tsx:946` | expand card |
| B6 | `features/dashboard/pages/DashboardPage.tsx:951` | hide card |
| B7 | `features/staff-settings/pages/StaffAssignmentsPage.tsx:275` | delete provider number |
| B8 | `features/referrals/pages/ReferralsPage.tsx:751` | remove attachment |
| B9 | `features/referrals/pages/ReferralCoordinatorQueue.tsx:758` | row expand |
| B10 | `features/group-therapy/pages/GroupTherapyPage.tsx:280` | back |
| B11 | `features/llm/components/LLMSuggestPanel.tsx:208` | dialog close |
| B12 | `features/messaging/components/MessageThreadList.tsx:103` | new thread |
| B13-14 | `features/case-management/pages/CaseManagementPage.tsx:403`, `ResourcesPage.tsx:55` | external-link |

## [A11Y_BUG] AR-1 — duplicate `id="dialog-title"`

59 files have `<Dialog aria-labelledby="dialog-title">` + `<DialogTitle id="dialog-title">` with the same literal id. When a page renders multiple Dialogs simultaneously (MedicationsTab renders 5: lines 534, 612, 2448, 2695, 3111), DOM has duplicate ids — WCAG 4.1.1 violation and makes `aria-labelledby` ambiguous. Convention should be per-dialog unique (`id="add-medication-title"`).

## Top-10 by issue density (patient-facing weighted)

1. `features/patients/components/detail/tabs/MedicationsTab.tsx` — ~50 onClick + 5 duplicate dialog ids — **prescription surface, TGA-critical**
2. `features/patients/components/detail/tabs/EpisodesTab.tsx` — ~39 onClick + 5 duplicate dialog ids
3. `features/patients/components/detail/tabs/AlertsPlansTab.tsx` — 15 onClick + 4 clickable — **safety plans**
4. `features/patients/components/detail/tabs/CorrespondenceTab.tsx` — 19 onClick + 3 clickable + 2 dup dialog ids
5. `features/dashboard/pages/DashboardPage.tsx` — 13 onClick + 3 unlabelled IconButtons + 7 clickable
6. `features/patients/components/detail/tabs/EctTab.tsx` — 15 onClick — ECT prescribing
7. `features/patients/components/detail/tabs/InpatientCareTab.tsx` — 15 onClick + 3 clickable
8. `features/referrals/pages/ReferralsPage.tsx` — 15 onClick + 1 IconButton + 3 clickable
9. `features/escalations/components/EscalationList.tsx` — 1 clickable (safety-critical)
10. `features/patients/components/detail/tabs/VivaTab.tsx` — 20 onClick + 32 Cards

Clean / near-clean: `LoginForm.tsx`, `MfaForm.tsx`, `MobileScribePage.tsx`, `Sidebar.tsx`.

## [A11Y_HEURISTIC] notes

- H1: ~64 IconButtons wrapped in `<Tooltip title>` without explicit `aria-label` — MUI propagates Tooltip title as accessible name EXCEPT on `disabled` buttons (Tooltip wraps a span, title not carried). Audit disabled states.
- H2: 137 `<Card>` with `cursor: 'pointer'` / `onClick` — some wrap inner `<Button>` / `<CardActionArea>`; static cannot tell.
- H3: No semantic `<nav>`/`<main>`/`<aside>` landmarks outside LoginForm.
- H4: Palette `#327C8D` / `#b8621a` / `#FBF8F5` / `#3D484B` needs axe-core ratio check.
- H5: `shared/components/ui/MarkdownRenderer.tsx:20` uses `dangerouslySetInnerHTML` — DOMPurify-sanitised (XSS-safe) but heading-order not audited.

## Related BUGs

- **BUG-447 (S1)** (new) — SC 2.1.1 keyboard-accessibility family across 36 files. Blocks WCAG 2.1 AA conformance; required for TGA submission.
- **BUG-448 (S2)** (new) — SC 4.1.2 14 unlabelled IconButtons — named-button pass
- **BUG-449 (S2)** (new) — duplicate dialog-title id family; move to per-dialog unique IDs
- **BUG-450 (S2)** (new) — live axe-core run in CI against `apps/web` dev-serve to cover SC 1.4.3 contrast + SC 4.1.1 parsing + SC 2.4.1 skip-links
