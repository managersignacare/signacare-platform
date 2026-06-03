# Agentic AI and Behavioral Engagement Features (Detailed Specification)

**Status:** Authoritative module detail (supports product SSoT)  
**Last updated:** 2026-05-31  
**Owner:** Product + Architecture + Clinical Safety + QA  
**Related:** [workflows-and-features-ssot.md](workflows-and-features-ssot.md), [product-roadmap-ssot.md](product-roadmap-ssot.md), [../gold-standard/ai-scribe.md](../gold-standard/ai-scribe.md)

## 1) Scope

This document defines the detailed feature behavior for:

1. Agentic AI Scribe (Next-Gen)
2. Behavior Contract Object
3. Routine Builder (if-then)
4. Recovery Streak Engine
5. Friction Radar
6. Escalation SLA Board
7. Behavioral Segmentation Engine
8. Micro-learning Cards
9. Choice Architecture Layer

The specification is implementation-aligned to live module keys, API routes, shared schemas, and UI surfaces.

## 2) Module Gating and Access Model

| Capability group | Module key | Toggle source | API gate | Default role access |
|---|---|---|---|---|
| Agentic AI Scribe | `agentic-ai-scribe` | Power Settings / Access Matrix | `requireClinicModuleEnabled` + `requireModuleRead/Write` + RBAC | Read/Write: `clinician`, `admin`, `superadmin` |
| Behavioral suite (contracts, routines, streak, friction, SLA, segment, micro-learning, defaults) | `pathways` | Power Settings / Access Matrix | `requireClinicModuleEnabled` + `requireModuleRead/Write` + RBAC | Read: `clinician`, `case_manager`, `manager`, `admin`, `superadmin`; Write: `clinician`, `manager`, `admin`, `superadmin` |

Cross-cutting controls:

1. Tenant context is clinic-scoped in every query path (`clinic_id` bound).
2. Patient-scoped routes enforce patient relationship/ownership checks.
3. Write surfaces are auditable and optimistic-lock protected where multi-writer risk exists.

## 3) End-to-End Workflow Map

### 3.1 In-visit (clinician) flow

1. Clinician opens Agentic AI Scribe and submits transcript + optional context.
2. System extracts structured action drafts: lab orders, referrals, follow-up plans.
3. Clinician selects relevant drafts and materializes them into concrete tasks.
4. Tasks appear in existing task workflows and dashboard/task boards.

### 3.2 Between-visit (care engagement) flow

1. Clinician/team creates behavior contracts and if-then routines.
2. Patient interaction events accumulate (medication/sleep/journal/walk/module usage/routine events).
3. Recovery streaks, friction signals, and behavioral segment are recalculated from recent events.
4. Micro-learning rules auto-assign targeted cards when trend thresholds are crossed.
5. Escalation SLA board tracks high-priority open tasks/referrals with breach timers.
6. Choice architecture defaults shape safe defaults for review cadence and reminders.

## 4) Feature Detail

### 4.1 Agentic AI Scribe (Next-Gen)

**Purpose**

Transform consultation text into actionable draft work items during the visit, then convert selected drafts into operational tasks.

**Primary UI surface**

- `apps/web/src/features/agentic-scribe/pages/AgenticScribePage.tsx`

**API contract**

1. `POST /api/v1/agentic-scribe/drafts`
2. `POST /api/v1/agentic-scribe/tasks/from-drafts`
3. Shared schemas in `packages/shared/src/agenticScribe.schemas.ts`

**Draft generation behavior**

1. Input requires transcript length >= 20 chars.
2. Optional `patientId` triggers relationship validation.
3. Output sections:
   - `labOrders[]` with urgency and rationale
   - `referrals[]` with urgency and reason
   - `followUps[]` with timeframe/date/mode/rationale
4. A clinical disclaimer is always included in response payload.

**Task materialization behavior**

1. Selected drafts are converted into task payloads.
2. Supports optional linkage to patient/episode/assignee.
3. Returns deterministic mapping of created task IDs to draft IDs/types.

**Safety and governance**

1. Module gated by `agentic-ai-scribe`.
2. RBAC restricted to clinical/admin roles.
3. Patient relationship checks enforced for patient-bound use.
4. Audit log written for draft generation and task creation.

**Current boundary**

1. Creates task work-items, not direct order/referral/appointment writes.
2. Keeps clinician final control inside existing approval workflows.

### 4.2 Behavior Contract Object

**Purpose**

Capture explicit patient commitments with trigger, target behavior, fallback, review date, accountability partner, and adherence state.

**UI surface**

- `BehavioralEngagementPanel` contract section.

**API contract**

1. `GET /api/v1/pathways/behavioral/contracts/:patientId`
2. `POST /api/v1/pathways/behavioral/contracts`
3. `PATCH /api/v1/pathways/behavioral/contracts/:contractId`
4. Shared schemas in `packages/shared/src/behavioralPathway.schemas.ts`

**Data shape highlights**

1. Contract fields include `triggerText`, `commitmentBehavior`, `fallbackPlan`, `reviewDate`.
2. Adherence supports: `on_track`, `at_risk`, `missed`, `completed`, `paused`.
3. Uses `lockVersion` for optimistic concurrency on updates.

**Workflow behavior**

1. Clinician creates contract against patient (optionally linked to pathway).
2. Adherence updates occur during reviews.
3. Overdue/unfinished contracts feed Friction Radar and segmentation logic.

### 4.3 Routine Builder (If-Then)

**Purpose**

Define executable if-then-fallback plans for symptom or behavior thresholds.

**UI surface**

- `BehavioralEngagementPanel` routine section.

**API contract**

1. `GET /api/v1/pathways/behavioral/routines/:patientId`
2. `POST /api/v1/pathways/behavioral/routines`
3. `PATCH /api/v1/pathways/behavioral/routines/:routineId`
4. `POST /api/v1/pathways/behavioral/routines/events`

**Condition/action model**

1. Conditions: `anxiety_gte`, `mood_lte`, `sleep_hours_lte`, `manual_signal`, `custom`
2. Actions: `open_grounding_card`, `open_micro_learning_card`, `start_breathing_exercise`, `call_support_line`, `create_clinician_task`, `show_coping_plan`
3. Supports fallback timing and fallback action text.

**Workflow behavior**

1. Clinician configures routine conditions and response actions.
2. Events are recorded as routines trigger/complete/fallback.
3. Events feed streaks, segmentation, and rule-triggered micro-learning.

### 4.4 Recovery Streak Engine

**Purpose**

Track non-punitive adherence streaks for low-risk repeatable behaviors.

**API contract**

1. `GET /api/v1/pathways/behavioral/streaks/:patientId`

**Tracked streak types**

1. `medication_taken`
2. `sleep_logged`
3. `journal_completed`
4. `walk_done`
5. `module_opened`

**Computation behavior**

1. Uses 365-day event lookback.
2. Calculates consecutive-day streak from today, else from yesterday.
3. Emits per-type current streak + last completed timestamp.

### 4.5 Friction Radar

**Purpose**

Surface care-delivery drop-off points as actionable operational signals.

**API contract**

1. `GET /api/v1/pathways/behavioral/friction/:patientId`

**Current signal set**

1. Overdue active behavior contracts.
2. Upcoming appointments not confirmed (within 48h window).
3. Open clinical tasks.
4. Pending referral flow (not closed/completed/rejected/cancelled).

**Output behavior**

1. Emits severity (`low`, `moderate`, `high`, `critical`), count, last seen, and suggested action.
2. Designed as a triage board input, not a punitive compliance score.

### 4.6 Escalation SLA Board

**Purpose**

Provide queue-age, owner, status, and breach timer visibility for high-risk open work.

**API contract**

1. `GET /api/v1/pathways/behavioral/sla-board`

**Queue coverage**

1. High/urgent open tasks.
2. High/urgent open referrals.

**SLA policy in code**

1. Task target hours by priority:
   - urgent: 4h
   - high: 12h
   - medium: 24h
   - low: 48h
2. Referral target hours by urgency:
   - urgent: 24h
   - high: 48h
   - default: 72h
3. Board emits target time, warning time, remaining seconds, breach flag.
4. Results are sorted by nearest breach first.

### 4.7 Behavioral Segmentation Engine

**Purpose**

Classify engagement posture to tailor burden, prompts, and follow-up intensity.

**API contract**

1. `GET /api/v1/pathways/behavioral/segments/:patientId`
2. `PUT /api/v1/pathways/behavioral/segments/:patientId/override`

**Segments**

1. `motivated`
2. `ambivalent`
3. `avoidant`
4. `overwhelmed`
5. `externally_supported`
6. `resistant`

**Current computation features**

1. 14-day routine trigger/completion ratio.
2. Recent anxiety average.
3. Overdue active behavior contracts.
4. Deterministic rationale generation and confidence scoring.

**Override behavior**

1. Clinician override requires reason.
2. Override stores explicit staff attribution and rationale.
3. Override path remains clinic and patient scoped.

### 4.8 Micro-learning Cards

**Purpose**

Deliver short targeted interventions based on observed tracking-pattern changes.

**API contract (staff)**

1. `GET /api/v1/pathways/behavioral/micro-learning/cards`
2. `GET /api/v1/pathways/behavioral/micro-learning/rules`
3. `POST /api/v1/pathways/behavioral/micro-learning/rules`
4. `PATCH /api/v1/pathways/behavioral/micro-learning/rules/:ruleId`
5. `GET /api/v1/pathways/behavioral/micro-learning/assignments/:patientId`
6. `POST /api/v1/pathways/behavioral/micro-learning/assignments/:assignmentId/status`

**API contract (patient app)**

1. `GET /api/v1/patient-app/interventions/:patientId/micro-learning`
2. `POST /api/v1/patient-app/interventions/:patientId/micro-learning/:assignmentId/status`
3. `POST /api/v1/patient-app/interventions/:patientId/routine-events`

**Rule engine behavior**

1. Rule tracks `anxiety`, `mood`, or `sleep_hours`.
2. Compares recent window average vs prior window average.
3. Triggers assignment when delta threshold is met/exceeded.
4. Enforces rule cooldown before re-assignment.
5. Stores assignment reason for explainability.

### 4.9 Choice Architecture Layer

**Purpose**

Set safe defaults that reduce omission risk and nudge protective care actions.

**API contract**

1. `GET /api/v1/pathways/behavioral/choice-architecture/defaults`
2. `PATCH /api/v1/pathways/behavioral/choice-architecture/defaults`

**Managed defaults**

1. `nextReviewDueDaysDefault`
2. `safetyPlanRefreshDaysDefault`
3. `medicationReminderWindowMinutes`

**Bootstrap behavior**

1. Missing row auto-seeds with clinic defaults (28/30/90).
2. Updates are partial, validated, and clinic-scoped.

## 5) UI Placement and Workflow Integration

### Web (clinician/manager)

1. Agentic drafting workspace lives on dedicated Agentic AI Scribe page.
2. Behavioral suite lives in Pathways via `BehavioralEngagementPanel`.
3. Escalation/SLA and friction outputs are intended as daily huddle inputs.

### Viva patient app

1. Patient app can receive micro-learning assignments and mark opened/completed.
2. Patient app can emit routine events that flow back into streak/segment/radar engines.
3. Pathways module toggle can hard-disable this entire intervention lane.

## 6) Enterprise Controls

1. Every route is tenant-scoped (`clinic_id`) and role-gated.
2. Module-level feature toggles enforce runtime disablement without code drift.
3. Contract/rule/routine updates use optimistic lock patterns where applicable.
4. Audit records are written for critical material actions (draft generation, task materialization, contract creation).
5. Shared Zod schemas are authoritative for request/response shape safety.

## 7) KPIs and Operational Metrics

Track at clinic/team and patient levels:

1. Draft-to-task conversion rate (Agentic Scribe utility).
2. Time-to-close for AI-created tasks vs manually created tasks.
3. Behavior contract overdue rate.
4. Routine trigger-to-completion ratio.
5. Mean streak duration by routine event type.
6. Friction item frequency by signal key.
7. SLA breach rate for urgent/high tasks and referrals.
8. Micro-learning assignment open/completion rates and median time-to-open.
9. Segment migration trend (for example overwhelmed -> externally_supported).

## 8) Regression-Proof Test and Guard Expectations

Minimum required evidence for changes touching these modules:

1. L1: workspace typecheck/lint/build passes.
2. L2: integration coverage includes:
   - `apps/api/tests/integration/agenticScribeModuleToggle.int.test.ts`
   - `apps/api/tests/integration/pathwayBehavioralEngagement.int.test.ts`
3. L3: UI behavior tests for touched surfaces (query keys/forms/render logic).
4. L4: guard passes at minimum:
   - route-contract/integration URL consistency
   - response-shape validation
   - service auth-context discipline
   - clinic-scope query discipline
5. L5: runtime proof for role/multi-tenant constraints and key data-flow round-trips.

## 9) Known Boundaries (Current State)

1. Agentic Scribe currently materializes to task objects (not direct live writes into orders/referrals/appointments).
2. Behavioral segmentation is deterministic heuristic-based today, not model-driven.
3. Micro-learning trigger logic is trend-threshold based and should be periodically recalibrated with outcome evidence.

## 10) Change Rule

Any behavioral or agentic feature change must update this file in the same PR, alongside:

1. schema updates (if contract changes),
2. integration evidence links,
3. bug ledger updates where residual risk remains.
