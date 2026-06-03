# Mental Health Referral Management Spec (Intake + Referral Out)

**Date:** 2026-05-16  
**Status:** design-approved candidate (pre-implementation)  
**Scope type:** architecture + UX/API contract + verification contract

## 1) Objective

Replace fragmented referral surfaces with a single mental-health-first workflow that reduces staff cognitive load, prevents accidental state errors, and keeps audit and safety controls fail-closed.

## 2) In Scope

1. New side-nav structure for mental health referral work:
   - `Intake`
   - `Referral Out`
2. Intake flow:
   - create referral (existing patient search + inline patient registration)
   - list segmentation: `Received`, `Accepted`, `Declined`
   - accept/decline decision controls in list and episode banner
   - post-accept MDT allocation modal
   - automatic letter + contact creation on decision and allocation save
3. Referral episode + care episode naming contracts.
4. Regression-proof guards and L1-L5 verification.

## 3) Out Of Scope (This Slice)

1. Non-mental-health specialty referral redesign.
2. External partner integrations beyond existing local mock/test doubles.
3. Post-deployment canary/burn-in closure evidence.

## 4) UX Information Architecture

## 4.1 Side Navigation

1. Keep only:
   - `Intake`
   - `Referral Out`
2. Remove/retire from primary mental-health nav:
   - legacy `Referral Queue`
   - legacy `My Offers`
   - duplicate intake routes

## 4.2 Intake Header Context

1. Header shows `Subspecialty`, `Program`, `Team`.
2. Default team filter = logged-in staff member’s team.
3. User can switch team scope only if policy allows.

## 4.3 Intake Lists

Three visible sections:

1. `Referrals Received`
2. `Accepted`
3. `Declined`

Required columns per row:

1. `UR Number`
2. `Patient Name`
3. `DOB`
4. `Referral Date` (referrer-provided date)
5. `Referral Received Date` (system intake date)
6. `Subspecialty`
7. `Program`
8. `Team`
9. `Actions`

## 5) Workflow State Machine (SSoT)

Canonical referral lifecycle:

1. `received` -> `accepted`
2. `received` -> `declined`
3. `accepted` -> `allocated`

Rules:

1. Decision is single-shot. Once accepted/declined, decision buttons become disabled.
2. Every transition writes audit transition row with actor + reason + timestamp.
3. Decline requires mandatory reason.
4. Accept requires explicit confirm dialog.
5. Allocation creates/updates care-team assignment and episode naming.

## 6) Episode Naming Contract

1. Referral episode name:
   - `SOURCE YYYY-MM-DD`
   - `SOURCE` = referral source short label
   - date = referral received date
2. Care episode name after MDT allocation:
   - `TEAM YYYYMMDD`
   - `TEAM` = allocated team short label
   - date = allocation date

## 7) Screen States (Exact)

## 7.1 Add New Referral Dialog

1. Step A: patient lookup by name/UR/DOB.
2. Step B: if not found, inline open patient registration (same schema as patient create).
3. Step C: referral details entry.
4. Save result:
   - row appears in `Received`
   - referral episode auto-created with naming contract

## 7.2 Accept Flow

1. User clicks `Accept` in row or episode banner.
2. Confirm dialog:
   - shows patient + referral identifiers
   - confirms irreversible decision
3. On confirm:
   - status -> `accepted`
   - `Accept`/`Decline` disabled
   - open MDT allocation dialog

## 7.3 Decline Flow

1. User clicks `Decline`.
2. Decline dialog requires:
   - structured reason category
   - free-text justification
3. On save:
   - status -> `declined`
   - row moves to `Declined`
   - letters + contact records generated

## 7.4 MDT Allocation Dialog (Post-Accept)

Required fields:

1. Team
2. Program
3. Psychiatrist
4. Junior Medical Staff
5. Key Clinician
6. Additional Clinicians (optional multi-select)

On save:

1. care episode name updated to `TEAM YYYYMMDD`
2. letter generation triggered:
   - referring source
   - patient
   - support person(s)
3. contact record created

## 8) API Contract (Target)

Use existing referral route family where possible; converge to these semantic commands:

1. `POST /referrals`
   - create referral (+ optional inline patient payload)
2. `POST /referrals/:id/decision`
   - body:
     - `{ decision: "accepted" | "declined", reasonCategory?, reasonText?, confirmToken }`
3. `POST /referrals/:id/allocate`
   - body:
     - `episodeId`
     - `teamId`
     - `programId`
     - `psychiatristId`
     - `juniorMedicalId`
     - `keyClinicianId`
     - `additionalClinicianIds[]`
4. `GET /referrals?intakeView=true&teamId=...&status=...`
   - supports received/accepted/declined list segmentation

Contract requirements:

1. Idempotency required for create and decision commands.
2. Canonical error envelope only.
3. No direct status `PATCH` from UI on decision paths.

## 9) Data Contract / Validation

1. Referral received date required.
2. Referral date required (calendar field).
3. Decline reason mandatory.
4. Decision endpoints reject duplicate decision attempts with conflict error.
5. Allocation must validate role IDs belong to selected team/program scope.

## 10) Cognitive-Load Reduction Controls

1. Default view shows only decision-critical fields first.
2. Progressive disclosure for full referral text and attachments.
3. One action bar pattern across list + banner (same button order and labels).
4. Auto-prefill allocation from team defaults with explicit override.
5. Inline warnings for missing non-blocking fields; blocking only for safety-critical fields.

## 11) Regression-Proof Guard Set

Required new/updated guards:

1. `guard:referral-no-legacy-nav`
   - fail if old referral queue routes are still linked in MH nav.
2. `guard:referral-decision-command-only`
   - fail on direct referral decision status writes outside command handlers.
3. `guard:referral-episode-naming-contract`
   - fail if naming contract formatter diverges from required pattern.
4. `guard:intake-action-lock-after-decision`
   - fail if FE exposes active accept/decline controls after terminal decision state.
5. `guard:referral-letter-contact-on-decision`
   - integration guard ensuring decision transitions emit required side effects.

## 12) L1-L5 Verification Contract

1. `L1` compile/lint:
   - `npm run typecheck`
2. `L2` structural:
   - `npm run guard:all` including referral guard set above
3. `L3` deterministic module tests:
   - referral command unit tests
   - state-machine transition tests
4. `L4` integration:
   - create -> received
   - accept -> allocate -> letter/contact
   - decline -> reason -> letter/contact
   - negative paths (double decision, invalid team/program, unauthorized role)
5. `L5` workflow proof:
   - persona walkthrough for clinician/manager/receptionist/superadmin
   - decision controls visible/hidden by policy
   - no unauthorized state-changing action path

## 13) Stale Item Cleanup (After Green L1-L5)

Candidate stale surfaces to retire after cutover:

1. legacy queue UI pages/components for non-target MH path
2. duplicate intake/referral detail pages that no longer serve MH flow
3. orphaned hooks/query keys only used by retired surfaces
4. backend routes not used by retained MH decision path

Cleanup rule:

1. Deletion only after route map + test map confirms no active consumer.

## 14) Acceptance Criteria (Gold-Standard)

1. Staff can complete end-to-end intake without context switching across multiple referral modules.
2. Accept/decline cannot be accidentally triggered without explicit confirmation.
3. Decision once made is immutable from UI path without privileged override workflow.
4. MDT allocation data is complete and traceable in audit.
5. Letters and contacts are generated consistently with no silent failure path.
6. L1-L5 evidence is green and reproducible in a clean run.

## 15) Implementation Sequence

1. Backend command/state hardening.
2. Frontend intake/referral-out shell and list segmentation.
3. Decision dialogs + allocation dialog.
4. Letter/contact side-effect reliability checks.
5. Guard additions.
6. L1-L5 full replay.
7. Stale surface cleanup.

