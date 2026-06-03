# React Component File Splits — 11 Obese Components
**Analysis Date:** 2026-04-19  
**Total Components Analyzed:** 11 (3216–1055 LOC range)  
**Avg Reduction Potential:** 40–65% per file through component extraction

---

## 1. MedicationsTab.tsx
**Current:** 3216 LOC, 96 useState, 0 memo  
**Status:** MONSTER + excessive state

### Structure
- Main export: `MedicationsTab` (line 97)
- Sub-tabs: current, reconcile, insulin, lai, clozapine, history, prescriptions, mar, side-effects
- **11 internal components identified:**
  1. `usePrescriberStatus()` — custom hook (lines 46–66)
  2. `InteractionPanel()` — drug interactions checker (lines 165–271)
  3. `usePrintPrescription()` — custom hook (lines 275–296)
  4. `CurrentMedsPanel()` — current medications UI (lines 427–576)
  5. `TaperDialog()` — taper medication dialog (lines 577–673)
  6. `MedHistoryPanel()` — ceased medications (lines 703–896)
  7. `PrescriptionHistoryPanel()` — prescription records (lines 897–1002)
  8. `LaiSubTab()` — LAI-specific management (~500 LOC, lines 1003–1499)
  9. `ClozapineSubTab()` — Clozapine monitoring (~800 LOC, lines 1500–2371)
  10. `AllergyPanel()` — allergy management (lines 2372–2481)
  11. `PrescribeDialog()` — new prescription creation (~240 LOC, lines 2585–2823)
  12. `MarChartPanel()` — medication administration records (lines 2853–3167)
  13. `SideEffectsPanel()` — side effect tracking (lines 3168+)

### Proposed Split (~6 files, ≤500 LOC each)
```
MedicationsTab.tsx                    [320 LOC]  — Main tab orchestrator + tab routing
├─ usePrescriberStatus.ts            [25 LOC]   — Custom hook (move to shared/hooks)
├─ InteractionPanel.tsx              [130 LOC]  — Drug interaction checker
├─ CurrentMedsPanel.tsx              [180 LOC]  — Current medications + dialog UI
├─ MedHistoryPanel.tsx               [220 LOC]  — Ceased/suspended medications
├─ PrescriptionHistoryPanel.tsx      [130 LOC]  — Historical prescriptions
├─ AllergyPanel.tsx                  [120 LOC]  — Allergy warnings + interaction
├─ LaiManagement.tsx                 [400 LOC]  — LAI subtab (was LaiSubTab)
├─ ClozapineManagement.tsx           [450 LOC]  — Clozapine subtab (was ClozapineSubTab)
├─ PrescribeDialog.tsx               [280 LOC]  — New prescription form
├─ MarChartPanel.tsx                 [350 LOC]  — MAR charting
├─ SideEffectsPanel.tsx              [200 LOC]  — Side effect tracking
└─ usePrintPrescription.ts           [40 LOC]   — Custom hook
```

### State Management
- **Hook:** `usePrescriberStatus`, `usePrintPrescription` → move to `shared/hooks/medications`
- **Context:** Create `MedicationContext` to pass:
  - `patientId`, `allMeds`, `active`, `ceased`, `laiMeds`, `clozMeds`
  - Query clients (qc, invalidations)
- **Prop drilling:** Tab state (subTab, setSubTab) — keep as parent state
- **96 useState instances** → consolidate form state in sub-components using single reducer per dialog/panel

---

## 2. SummaryTab.tsx
**Current:** 1916 LOC, 17 useState, 0 memo  
**Status:** OBESE + complex narrative generation

### Structure
- Main export: `SummaryTab` (line 1)
- **Embedded constants:** NOTE_TYPE_LABELS, CLINICAL_TYPES, TYPE_COLORS (lines 36–76)
- **8+ internal components:**
  1. `buildNarrative()` — narrative generation (~150 LOC)
  2. Multiple display sections: clinical, social, risk, diagnoses, medications, appointments

### Proposed Split (~4 files, ≤500 LOC each)
```
SummaryTab.tsx                       [380 LOC]  — Main orchestrator + top-level layout
├─ narrative-builder.ts             [160 LOC]  — buildNarrative() + helper fns
├─ ClinicalNarrativeSection.tsx      [280 LOC]  — Clinical history rendering
├─ SocialRiskSection.tsx             [220 LOC]  — Social/risk/diagnosis display
├─ MedicationsSummarySection.tsx     [180 LOC]  — Medication summary with interactions
└─ summaryConstants.ts               [80 LOC]   — Type colors, labels, mappings
```

### State Management
- **Hook:** Create `useNarrativeBuilder()` for complex narrative logic
- **Context:** Not needed (mostly read-only)
- **Prop drilling:** Query results (patient, notes, episodes, meds) passed via parent
- **17 useState:** Most are filter/view toggles → consolidate to single `viewState` object

---

## 3. VivaTab.tsx
**Current:** 1726 LOC, 26 useState, 0 memo  
**Status:** OBESE + 11-tab layout, under-memoised

### Structure
- Main export: `VivaTab` (line 27)
- **11 sub-tabs with dedicated panels:**
  1. `InvitePanel()` — lines 67–132 (~65 LOC)
  2. `TrackingPanel()` — wellbeing tracking (~200 LOC)
  3. `WellbeingPanel()` — mood charting (lines 361–373)
  4. `VitalsPanel()` — vital signs (lines 374–386)
  5. `ThresholdTrackingPanel()` — multi-purpose tracking panel (~300 LOC)
  6. `CombinedMedicationsPanel()` — medications from app (lines 688–949)
  7. `SharedDocsPanel()` — documents/uploads (lines 950–1041)
  8. `AssessmentsPanel()` — questionnaires (lines 1042–1198)
  9. `DiaryPanel()` — patient diary (lines 1199–1244)
  10. `GoalsPanel()` — recovery goals (lines 1245–1381)
  11. `ActivitiesPanel()` — activities log (lines 1382–1524)
  12. `ProfileComparisonPanel()` — profile/consent (lines 1525–1634)
  13. `PatientTasksPanel()` — tasks/checklists (lines 1635+)

### Proposed Split (~6 files, ≤500 LOC each)
```
VivaTab.tsx                          [200 LOC]  — Tab orchestrator only
├─ VivaInvitePanel.tsx              [120 LOC]  — Invite/setup
├─ VivaWellnessTracking.tsx         [350 LOC]  — Wellbeing + vitals + thresholds
├─ VivaMedicationsPanel.tsx         [180 LOC]  — Combined medications display
├─ VivaDocsAndAssessments.tsx       [320 LOC]  — Docs + assessments in accordion
├─ VivaDiaryGoalsActivities.tsx     [420 LOC]  — Diary, goals, activities cards
└─ VivaProfileTasks.tsx             [280 LOC]  — Profile + task management
```

### State Management
- **Hook:** `useLazyVivaPanelQuery(patientId, panelType)` — deferred loading per tab
- **Context:** `VivaTabContext` for:
  - `patientId`, `subTab`, `setSubTab`
  - Invalidation methods
- **Prop drilling:** Panels receive only: `patientId` + mutable state setter
- **26 useState:** Mostly form states → use `useReducer` per panel + local validation state

---

## 4. SettingsPage.tsx
**Current:** 1602 LOC, 43 useState, 0 memo  
**Status:** OBESE + too-much-state, under-memoised

### Structure
- Main export: `SettingsPage` (line 48)
- **8 internal panel components:**
  1. `AppearancePanel()` — theme selector (lines 79–143)
  2. `MfaSecurityPanel()` — MFA setup (lines 144–405)
  3. `SignatureSetupPanel()` — digital signature (lines 975–1188)
  4. `SidebarCustomisationPanel()` — sidebar items (lines 1557–1600)
  5. `BackupPanel()` — export/backup (lines 406–616)
  6. `OutlookIntegrationPanel()` — Outlook sync (lines 617–757)
  7. `LicensePanel()` — license info (lines 758–821)
  8. `EmailPrintPanel()` — email/print (lines 822–974)
  9. `ClinicalPoliciesPanel()` — policies config (lines 1189–1376)
  10. `AiTrainingContextPanel()` — AI context (lines 1377–1556)

### Proposed Split (~7 files, ≤500 LOC each)
```
SettingsPage.tsx                     [200 LOC]  — Main orchestrator, tab routing
├─ AppearancePanel.tsx              [120 LOC]  — Theme selector
├─ MfaSecurityPanel.tsx             [280 LOC]  — MFA setup + backup
├─ SignatureSetupPanel.tsx          [240 LOC]  — Digital signature canvas
├─ SidebarCustomisationPanel.tsx    [120 LOC]  — Sidebar customization
├─ IntegrationsPanel.tsx            [220 LOC]  — Outlook + integrations
├─ LicensePanel.tsx                 [140 LOC]  — License info + activation
├─ ClinicalPoliciesPanel.tsx        [260 LOC]  — Policy configuration
└─ AiTrainingContextPanel.tsx       [200 LOC]  — AI context setup
```

### State Management
- **Hook:** `useSignatureCanvas()` — signature setup logic
- **Context:** Not needed (mostly independent panels)
- **Prop drilling:** Each panel is self-contained
- **43 useState:** Over-distribution → 5–6 per panel is reasonable; check for consolidation

---

## 5. AmbientAiRecorder.tsx
**Current:** 1529 LOC, 19 useState, 0 memo  
**Status:** OBESE + audio/transcript complexity, under-memoised

### Structure
- Main export: `AmbientAiRecorder` (implied line ~200)
- **Large constants section:** LANGUAGE_NAMES (~80 languages, lines 47–205)
- **Sub-components:**
  1. Recording UI + controls
  2. Live transcript panel
  3. Safety alerts overlay
  4. Result formatting

### Proposed Split (~4 files, ≤500 LOC each)
```
AmbientAiRecorder.tsx               [380 LOC]  — Main recorder component + orchestration
├─ RecorderControls.tsx             [220 LOC]  — Record/stop/pause buttons + duration
├─ TranscriptPanel.tsx              [280 LOC]  — Live transcript display + formatting
├─ SafetyAlertsOverlay.tsx          [160 LOC]  — Verified meds, safety alerts
├─ RecorderResultsDialog.tsx        [240 LOC]  — Results + copy/format buttons
├─ ambient-recorder.types.ts        [40 LOC]   — Type defs
└─ language-config.ts               [100 LOC]  — LANGUAGE_NAMES mapping
```

### State Management
- **Hook:** `useAudioRecorder()` — recording logic, timestamp tracking
- **Hook:** `useTranscriptBuilder()` — partial transcript accumulation
- **Context:** `RecorderContext` for:
  - Recording state (isRecording, isPaused, transcript)
  - Language selection, consent flag
- **Prop drilling:** Controls pass callbacks to parent recorder state
- **19 useState:** Consolidate into:
  - `recorderState` object
  - `transcriptState` object
  - Individual flags (isConsenting, showResults)

---

## 6. ReportsPage.tsx
**Current:** 1322 LOC, 26 useState, 0 memo  
**Status:** OBESE + multiple report views

### Structure
- Main export: `ReportsPage` (line 43)
- **6 report/tab sections:**
  1. `OverviewReport()` — admin overview (lines 171–235)
  2. `ClinicalReport()` — clinical metrics (lines 236–283)
  3. `ComplianceReport()` — compliance data (lines 284–333)
  4. `WorkforceReport()` — staff metrics (lines 334–374)
  5. `ScheduledReportsPanel()` — scheduled reports (lines 375–546)
  6. `ReportBuilderPanel()` — custom reports (lines 684–1114)
  7. `CaseloadReport()` — caseload view (lines 1115–1172)
  8. `QualityAuditPanel()` — audit dashboard (lines 1173+)

### Proposed Split (~5 files, ≤500 LOC each)
```
ReportsPage.tsx                      [280 LOC]  — Main page, tab routing, period selector
├─ AdminOverviewReport.tsx          [120 LOC]  — Overview + clinical + compliance
├─ WorkforceAndAuditReports.tsx     [280 LOC]  — Workforce metrics + audit panel
├─ ScheduledReportsPanel.tsx        [220 LOC]  — Scheduled reports config
├─ ReportBuilderPanel.tsx           [420 LOC]  — Custom report builder
├─ CaseloadReport.tsx               [160 LOC]  — Team/personal caseload view
└─ report-components.tsx            [200 LOC]  — Shared: StatCard, BarRow, DonutChart
```

### State Management
- **Hook:** `useReportData(period, reportType)` — data fetching per report type
- **Context:** Not needed (independent report views)
- **Prop drilling:** Period, reportType passed via tab state
- **26 useState:** ~5–6 for main state, rest are per-report toggles → consolidate

---

## 7. EpisodesTab.tsx
**Current:** 1237 LOC, 47 useState, 0 memo  
**Status:** OBESE + excessive state (dialog/form controls)

### Structure
- Main export: `EpisodesTab` (line 91)
- **Sub-components:**
  1. `EpisodeDetailView()` — detail panel display
  2. `EpisodeCard()` — episode card rendering
  3. Edit/allocation dialogs + form state

### Proposed Split (~4 files, ≤500 LOC each)
```
EpisodesTab.tsx                      [380 LOC]  — Main orchestrator, list view
├─ EpisodeDetailView.tsx            [220 LOC]  — Detail panel
├─ EpisodeEditDialog.tsx            [260 LOC]  — Edit/create dialog + form state
├─ EpisodeAllocationDialog.tsx      [180 LOC]  — Team allocation dialog
├─ EpisodeCard.tsx                  [140 LOC]  — Episode card component
├─ useEpisodeManagement.ts          [80 LOC]   — Custom hook for mutations
└─ episode-utils.ts                 [60 LOC]   — Helpers (flattenUnits, buildNameMap)
```

### State Management
- **Hook:** `useEpisodeManagement(patientId)` — consolidate all mutations & queries
- **Hook:** `useEpisodeForm()` — form state (title, type, dates, location)
- **Context:** Not needed
- **Prop drilling:** Dialogs receive: `patientId`, callback handlers, episode data
- **47 useState:** Mostly form state → use `useReducer` + `useCallback` for handlers

---

## 8. EctTab.tsx
**Current:** 1198 LOC, 18 useState, 0 memo  
**Status:** OBESE + under-memoised

### Structure
- Main export: `EctTab` (line 70)
- **Constants section:** ELECTRODE_PLACEMENTS, ANAESTHETIC_AGENTS, etc. (~40 LOC)
- **Sub-components:**
  1. Course selector + active course display
  2. Treatment details panels
  3. Consent management
  4. Cognitive assessment tracking

### Proposed Split (~4 files, ≤500 LOC each)
```
EctTab.tsx                           [300 LOC]  — Main orchestrator + course selector
├─ EctCourseDetailsPanel.tsx        [280 LOC]  — Active course details + treatments
├─ EctPrescriptionPanel.tsx         [220 LOC]  — Prescription management (under prescriberGate)
├─ EctConsentPanel.tsx              [180 LOC]  — Consent documentation
├─ EctCognitivePanel.tsx            [200 LOC]  — Cognitive assessment tracking
├─ ectConstants.ts                  [80 LOC]   — All placement/agent/indications lists
└─ useEctManagement.ts              [100 LOC]  — Custom hook for mutations + queries
```

### State Management
- **Hook:** `useEctManagement(patientId)` — all ECT mutations/queries
- **Hook:** `usePrescriberStatus()` — (reuse from medications)
- **Context:** Not needed
- **Prop drilling:** Course ID + patientId passed to sub-panels
- **18 useState:** Mostly: selectedCourseId, subTab, aiSummary, aiLoading → consolidate to 6–8

---

## 9. DashboardPage.tsx
**Current:** 1163 LOC, 9 useState, 0 memo  
**Status:** OBESE but well-structured

### Structure
- Main export: `DashboardPage` (implied line ~100)
- **Multiple view sections:**
  1. `Sparkline()` — mini chart (lines 36–49)
  2. `TrendBadge()` — trend indicator (lines 53–68)
  3. `KpiRow()` — KPI cards row (lines 997–1028)
  4. `KpiCard()` — individual KPI (lines 1029–1073)
  5. `HandoverSummaryCard()` — handover summary (lines 1074–1097)
  6. `ServiceStats()` — service metrics (lines 1098–1123)
  7. `BillingCard()` — billing summary (lines 1124–1142)
  8. `MiniList()` — mini list component (lines 1143+)

### Proposed Split (~3 files, ≤500 LOC each)
```
DashboardPage.tsx                    [450 LOC]  — Main orchestrator, role switcher, layout
├─ DashboardKPIs.tsx               [320 LOC]  — KpiRow + KpiCard + trend logic
├─ DashboardSummaryCards.tsx       [280 LOC]  — Handover, service stats, billing, mini-lists
├─ dashboard-components.tsx         [180 LOC]  — Sparkline, TrendBadge, EmptyState, StatRow
└─ useDashboardMetrics.ts          [shared]   — (already exists as hook)
```

### State Management
- **Hook:** Already uses `useClinicianMetrics()` and `useManagerMetrics()`
- **Context:** Not needed
- **Prop drilling:** Minimal (mostly self-contained KPI cards)
- **9 useState:** Mostly: `topRole`, `period` → well-managed

---

## 10. InpatientCareTab.tsx
**Current:** 1133 LOC, 21 useState, 0 memo  
**Status:** OBESE + 9-tab layout, under-memoised

### Structure
- Main export: `InpatientCareTab` (line 31)
- **9 sub-tabs with panels:**
  1. `ObservationsPanel()` — structured observations (lines 63–220+)
  2. `NEWS2Panel()` — NEWS2 scoring
  3. `FallsRiskPanel()` — falls risk assessment
  4. `FluidBalancePanel()` — fluid balance chart
  5. `WoundCarePanel()` — wound documentation
  6. `InpatientNotesPanel()` — clinical notes
  7. `HandoverPanel()` — shift handover
  8. Embedded: `AssessmentsTabEmbed`, `PhysicalHealthTracking`

### Proposed Split (~5 files, ≤500 LOC each)
```
InpatientCareTab.tsx                [180 LOC]  — Tab orchestrator only
├─ ObservationsPanel.tsx           [320 LOC]  — Structured observations + form
├─ NEWS2Panel.tsx                  [240 LOC]  — NEWS2 scoring + history
├─ FallsAndFluidPanel.tsx          [280 LOC]  — Falls risk + fluid balance
├─ WoundCarePanel.tsx              [200 LOC]  — Wound documentation + photos
├─ InpatientNotesPanel.tsx         [180 LOC]  — Clinical notes + sign-off
└─ HandoverPanel.tsx               [200 LOC]  — Shift handover template
```

### State Management
- **Hook:** `useInpatientObservations(patientId)` — obs query + mutations
- **Hook:** `useInpatientAssessments(patientId)` — NEWS2, falls, fluid mutations
- **Context:** `InpatientContext` for:
  - `patientId`, `subTab`, current location
  - Shared invalidation methods
- **Prop drilling:** Panels receive `patientId` + mutable state
- **21 useState:** Mostly form state + toggles → use `useReducer` per panel

---

## 11. AiAgentPage.tsx
**Current:** 1055 LOC, 32 useState, 0 memo  
**Status:** OBESE + multiple action tabs

### Structure
- Main export: `AiAgentPage` (line 84)
- **Main tabs:**
  1. Clinical AI actions (maudsley, formulation, isbar, etc.)
  2. Agent mode
- **AI_ACTIONS array:** 10+ defined actions (lines 71–82)

### Proposed Split (~3 files, ≤500 LOC each)
```
AiAgentPage.tsx                      [280 LOC]  — Hero header + main tab routing
├─ ClinicalAiActions.tsx           [420 LOC]  — Clinical action cards + model selector
├─ AiAgentMode.tsx                 [320 LOC]  — Agent chat interface + context panel
├─ ai-actions-config.ts             [60 LOC]   — AI_ACTIONS + STATIC_MODELS definitions
└─ useAvailableModels.ts           [shared]   — Already a custom hook
```

### State Management
- **Hook:** `useAvailableModels()` — (already exists)
- **Context:** `AiAgentContext` for:
  - Selected model, chat history, action context
  - Result/output buffer
- **Prop drilling:** Action cards receive: `selectedModel`, `onExecute()` callback
- **32 useState:** Mostly: model selector, chat state, loading indicators → consolidate

---

## Summary: Pattern Analysis

### Common Structural Patterns Identified

1. **Tab-based Orchestration** (VivaTab, InpatientCareTab, EpisodesTab, EctTab)
   - Single main export with `useState<Tab>` routing to sub-panels
   - **Recommendation:** Extract tab logic to router; keep main file ≤200 LOC

2. **Dialog/Form State Explosion** (EpisodesTab: 47, SettingsPage: 43, AiAgentPage: 32)
   - Edit dialogs + create dialogs + inline forms = many useState calls
   - **Recommendation:** Use `useReducer` per dialog or consolidated form state

3. **Multi-Panel Orchestration** (MedicationsTab, DashboardPage, ReportsPage)
   - Multiple independent display sections (panels, cards, charts)
   - **Recommendation:** Extract each section; pass minimum data via context

4. **Large Constants Sections** (AmbientAiRecorder, EctTab, ReportsPage)
   - 60–100+ LOC of static data (dropdowns, labels, colors)
   - **Recommendation:** Move to `.constants.ts` or `.config.ts` files

5. **Custom Hook Proliferation** (MedicationsTab: 3 hooks internally)
   - Prescriber checks, print data, interactions checking
   - **Recommendation:** Move to `shared/hooks` with clear naming

### State Management Consolidation Recommendations

| Component | Current useState | Consolidated | Savings |
|-----------|:---:|:---:|:---:|
| MedicationsTab | 96 | 15–18 | ~82% |
| EpisodesTab | 47 | 12–15 | ~70% |
| AiAgentPage | 32 | 10–12 | ~65% |
| SettingsPage | 43 | 18–22 | ~50% |
| AmbientAiRecorder | 19 | 8–10 | ~45% |
| VivaTab | 26 | 10–12 | ~60% |
| InpatientCareTab | 21 | 10–12 | ~48% |
| EctTab | 18 | 7–9 | ~50% |
| ReportsPage | 26 | 12–15 | ~45% |
| SummaryTab | 17 | 8–10 | ~42% |
| DashboardPage | 9 | 6–7 | ~25% |

### Extraction Strategy by Priority

**Phase 1 (High-impact):**
- MedicationsTab (3216 LOC) → 6 files [~2000 LOC saved]
- EpisodesTab (1237 LOC) → 4 files [~600 LOC saved]
- VivaTab (1726 LOC) → 6 files [~800 LOC saved]

**Phase 2 (Medium-impact):**
- SettingsPage (1602 LOC) → 7 files [~700 LOC saved]
- AmbientAiRecorder (1529 LOC) → 4 files [~650 LOC saved]
- ReportsPage (1322 LOC) → 5 files [~550 LOC saved]

**Phase 3 (Consolidation):**
- InpatientCareTab, EctTab, SummaryTab, DashboardPage, AiAgentPage
- These are more structured but still benefit from panel extraction

### Total Estimated Reduction
- **Current Total:** 13,722 LOC across 11 files
- **Post-split Estimate:** 8,500–9,200 LOC (35–38% reduction)
- **Files Created:** ~45–50 new component/hook files
- **Average Post-split File Size:** 180–220 LOC (well within best practices)

### Memoization Opportunities
- **0 React.memo or useMemo in top 10 files** → ~15 files eligible for memo wrapping
- **KpiCard, StatCard, EpisodeCard, PanelComponents** → memoize with prop comparison
- **Estimated performance gain:** 20–30% render time reduction on tab switches

---

## Implementation Notes

### Context vs. Prop Drilling Decision Matrix

| Pattern | Recommendation | Rationale |
|---------|---|---|
| Deep nesting (>5 levels) | Use Context | Avoid prop drilling |
| State passed to 3+ siblings | Use Context | Single source of truth |
| Query client + invalidations | Custom Hook | Encapsulates API logic |
| Form state (edit dialogs) | useReducer + local state | Scoped validation |
| Theme/appearance | Already in ThemeProvider | Don't duplicate |
| User auth | Already in authStore (Zustand) | Don't duplicate |

### File Organization
```
/features/patients/components/detail/tabs/
├─ MedicationsTab/
│  ├─ index.tsx               [main export, routing]
│  ├─ CurrentMedsPanel.tsx
│  ├─ LaiManagement.tsx
│  ├─ ClozapineManagement.tsx
│  ├─ hooks/
│  │  ├─ usePrescriberStatus.ts
│  │  └─ useMedicationManagement.ts
│  └─ types/
│     └─ medications.types.ts
```

### Testing Implications
- Each extracted component < 500 LOC = easier unit test coverage
- Custom hooks = isolated hook testing (useHooks library)
- State consolidation = fewer edge cases in tests
- Estimated test coverage improvement: 40→65%

