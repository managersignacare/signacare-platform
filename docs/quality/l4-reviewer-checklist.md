# L4 reviewer checklist

**Purpose.** Pinned canonical reference for the L4 (`clinical-safety-reviewer`) reviewer agent. Codifies the recurring failure classes that have surfaced across this codebase's audit cycles — silent-catch, lie-about-success, schema fabrication — plus the **cascade-scan rule** that found BUG-521 (S0 fatality) during BUG-445's L4 review.

**Reader contract.** If you are running an L4 review and a finding matches a class on this list, you BLOCK or REQUEST_CHANGES per the listed verdict. You do not approve.

**Pin notice.** Update this file in the same commit as any new BUG-class discovery, per `feedback_no_silent_out_of_scope.md`. Do not park work behind a "follow-up" fence — file the new class as a BUG row in `docs/quality/bugs-remaining.md` and update the relevant section here in the same atomic commit.

**Relationship to the 8 baked clinical rules.** This checklist EXTENDS the 8 rules in `.claude/agents/clinical-safety-reviewer.md` (patient-safety > elegance, critical-class detection, AI-content discipline, append-only, traceability, PHI egress consent, break-glass integrity, graceful degradation). It does not redefine them. The classes below cross-reference the rules where they apply.

---

## A. Silent-catch detection

**Definition.** A `catch` block that swallows the error without:
1. re-throwing,
2. emitting `logger.error` / `logger.warn` / `console.warn` with a structured `kind` tag, or
3. returning a structured error to the caller.

This includes empty `} catch { }` blocks, `} catch (err) { /* ignore */ }`, and `.catch(() => fallback)` where `fallback` is a success-shaped value on a data-fetching path. The `// intentional silent — <reason>` (or `// allowed silent — <reason>`) inline comment is the canonical exemption directive that `.github/scripts/check-no-silent-catches.sh` recognises as deliberate; reviewers must verify the `<reason>` is auditable, not a hand-wave.

**Worst-case patterns (S0 territory):**

| Pattern | Site | Why fatal |
|---|---|---|
| Plaintext fallback on encrypt failure | `apps/api/src/shared/phiEncryption.ts:60,85` (BUG-441 SHIPPED) | PHI lands in DB as plaintext on a single transient HSM blip |
| Fail-open on Redis error in session blacklist | `middleware/jwtBlacklist.ts:46,71` (BUG-442 SHIPPED) | Revoked sessions still authenticate after Redis hiccup |
| Fabricated `{valid:true,edition:'development'}` on import failure | `middleware/licenseMiddleware.ts:50` (BUG-444 SHIPPED) | Production licence enforcement bypassed |

**Deploy-blocker patterns (S1 territory):**

| Pattern | Site | Why blocking |
|---|---|---|
| Login/logout audit swallow | `features/auth/authController.ts:118,192` (BUG-443 SHIPPED) | AHPRA audit-trail loss; compliance regression |
| Audit swallows on clinical writes | `findings-6a-silent-catch.md:53` enumerates 6 sites (BUG-517 OPEN) | Same shape, 6 controllers, all clinical |

**BUG references:** BUG-441, BUG-442, BUG-443, BUG-444, BUG-516, BUG-517, BUG-519, BUG-523.

**L4 verdict:**
- **BLOCK** if on a safety surface (`apps/api/src/features/{medications|clinical-notes|llm|scribe|ect|tms|risk|advance-directives|legal|clozapine|auth|audit}/` or any file handling PHI).
- **REQUEST_CHANGES** otherwise.

**Cross-references:** Rule 1 (patient safety > elegance), Rule 5 (traceability), Rule 8 (graceful degradation). CLAUDE.md §3.1 (every async route handler must call `next(err)`).

---

## B. Lie-about-success detection

**Definition.** A code path that:
1. returns a success-shaped response on a path that failed (`{success:true}`, `{sent:N, failed:0}`, severity='success', etc.), OR
2. fabricates an empty/false shape (`{jobs:[]}`, `connected:false`, `interactions:[]`) that is indistinguishable from a legitimate success state.

**Worst-case patterns (S0 territory):**

| Pattern | Site | Why fatal |
|---|---|---|
| Drug-interaction check fabricates "no interactions detected" on RxNav timeout | `MedicationsTab.tsx` InteractionPanel (BUG-521 SHIPPED) | Clinician prescribes contraindicated combination believing the check passed |

**Deploy-blocker patterns (S1 territory):**

| Pattern | Site | Why blocking |
|---|---|---|
| Bulk SMS UI shows green "Campaign created" on apiClient throw | `ReceptionistPage.tsx:530` (BUG-445 SHIPPED) | Patient misses appointment reminder |
| Empty `{jobs:[]}` returned on BullMQ/Redis failure | `aiJobRoutes.ts:120,151` (BUG-446 OPEN) | Clinician sees empty queue while infra is broken |
| 4 sibling frontend fabrications | `PatientsPage.tsx:510`, `SummaryTab.tsx:1906`, `VivaTab.tsx:643+652`, `BedBoardPage.tsx:257` (BUG-520 OPEN) | Same shape, 4 surfaces |
| Print-prescription silent fallback to `null` | `usePrintPrescription` (BUG-523 OPEN) | Printed prescription has blank prescriber/clinic/patient fields |

**BUG references:** BUG-445, BUG-446, BUG-520, BUG-521, BUG-523.

**L4 verdict:** **BLOCK** on any clinical surface. False-success on clinical workflows is by definition a patient-harm path. Reviewer must verify the fix surfaces failure visibly (red banner, structured error, retry CTA) and does not collapse multiple end states (success-clean / partial / failed) into one boolean.

**Cross-references:** Rule 1 (patient safety > elegance), Rule 8 (graceful degradation).

---

## C. Schema fabrication detection

**Definition.** A `Db` interface, mapper, or DTO that:
1. declares a column or shape not present in the underlying migration, OR
2. omits a column the migration defines (the reverse direction; BUG-529 will guard this automatically once shipped).

**Deploy-blocker patterns (S1 territory):**

| Pattern | Site | BUG |
|---|---|---|
| `MedicationStatusEnum` SSoT vs DB CHECK drift | `packages/shared/src/medication.schemas.ts` ↔ baseline migration | BUG-456 SHIPPED |
| `LlmFeatureSchema` SSoT vs DB drift | `packages/shared/src/llm.schemas.ts` ↔ `llm_interactions.feature` | BUG-457 SHIPPED |
| `AppointmentDb` mapper fabricated null/false for 7 real columns | `appointmentService.ts:65 mapDbToResponse` | BUG-458 SHIPPED |

**BUG references:** BUG-456, BUG-457, BUG-458, BUG-489, BUG-511, BUG-512.

**L4 verdict:** **REQUEST_CHANGES**. Forces schema reconciliation as part of the fix; never let drift land. Verify `Db` interface (`apps/api/src/features/<feature>/<feature>Repository.ts`) matches `apps/api/src/db/schema-snapshot.json` for the bound table per CLAUDE.md §15.

---

## D. Cascade-scan rule

**The structural anchor of this checklist.** When you review a fix, scan adjacent code for the same shape — not the same fix. This procedure is what surfaced BUG-521 (S0 fatality) during BUG-445's L4 review.

**Procedure (numbered, mandatory):**

1. **Same file ±200 lines** of every changed line in the diff. Look for the same shape pattern (silent-catch, lie-about-success, schema fabrication, missing `clinic_id` WHERE, fail-open gate). NOT the same fix.

2. **Same feature directory.** For every file in the diff, `Glob` the parent feature directory (`apps/api/src/features/<feature>/**` or `apps/web/src/features/<feature>/**`) and `Grep` for the shape pattern.

3. **Imported-by chain.** For the fixed file, list its importers (`Grep` for `from '<file>'` or `import.*<file>`). Spot-check the importers for the same shape pattern. Callers often share the bug class via copy-paste.

**The active phrase is "not the same fix."** Cascading on shape catches the class; cascading on the fix only catches duplicates.

**Reference:** BUG-521 was discovered during BUG-445 L4 review by scanning `MedicationsTab.tsx` adjacent code. The lie-about-success class found in the receptionist page recurred in the drug-interaction panel — a different file, different feature directory, but the same shape. Without the cascade scan, BUG-521 would have shipped to staging undetected.

**Verdict integration.** Before issuing PASS, the L4 reviewer states explicitly: "Cascade scan ran across [files/directories]; [N] new findings surfaced; filed as BUG-XYZ per §E below." If no scan was performed, PASS is invalid.

---

## E. PART 3 trigger

When the cascade scan in §D finds a NEW shape (not already filed as a BUG):

1. **STOP** the L4 review on the current fix.
2. **File** the new shape via PART 3 of the runbook (a row in `docs/quality/bugs-remaining.md`) BEFORE the current fix's commit lands. This complies with `feedback_no_silent_out_of_scope.md`: do not park real work behind a "follow-up" fence.
3. **Resume** the L4 review on the original fix. The new BUG enters the queue at its own priority per the §13.7 comparator.

**Reject:** "we'll file a follow-up after merge". Work parking is the anti-pattern. Empirically, half the BUGs from this session were surfaced by cascade scans; none would have been found if reviewers had deferred filing.

**Accept:** "filed BUG-NNN at SHA pending; resuming review of original fix". Explicit position in the queue. Then continue.

**Cross-references:** `feedback_no_silent_out_of_scope.md`, runbook PART 3.

---

## F. Severity escalation

Decision rules (apply the FIRST that matches):

| Severity | Rule |
|---|---|
| **S0** | Patient harm is plausibly reachable in <30 days of normal operation without external mitigation. Examples: PHI plaintext fallback, session-revocation fail-open, prescription-print missing data, false-negative drug-interaction / allergy / risk-flag check. (BUG-441/442/521 precedents.) |
| **S1** | AHPRA / consent / licensing audit-trail loss; lie-about-success on clinician-facing UI; fail-OPEN gates on multi-tenant boundaries; missing `clinic_id` WHERE on PHI tables; deploy-blocker for staging. (BUG-443/444/445/416 precedents.) |
| **S2** | Feature completeness, observability, sibling sweeps of an already-fixed S0/S1 class, post-staging fixes. (BUG-446/517/519/520 precedents.) |
| **S3** | Tech-debt, type-safety cleanup, polish. |

**Safety-surface scope (used by BUG-527 atomic-flip CI guard):**

`apps/api/src/features/{medications|clinical-notes|llm|scribe|ect|tms|risk|advance-directives|legal|clozapine|auth|audit|prescriptions|pathology|patient-app|patient-outreach|power-settings}/`
`apps/web/src/features/{medications|clinical-notes|llm|scribe|patients/components/detail/tabs/(MedicationsTab|VivaTab|SummaryTab|PathologyTab|MhaTab|LegalTab|EctTmsTab)|receptionist|beds}/`
`apps/web/src/shared/hooks/useModuleVisibility.ts` (BUG-416 — clinical access-control gate)

The canonical machine-readable form of this scope is `.github/safety-surfaces.txt`. **The .txt is the SSoT** — this section reflects it. Update both in the same commit per §G ("How to update this checklist") and `feedback_no_silent_out_of_scope.md`. The atomic-flip CI guard at `.github/scripts/check-atomic-flip.sh` (BUG-527) reads the .txt directly.

Future BUGs that touch a surface NOT on this list but that handle PHI, audit, or clinical-safety semantics MUST update this list AND `.github/safety-surfaces.txt` in the same commit.

---

## G. Fail-loud-but-non-blocking canonical pattern

The BUG-443 reference shape. When a non-blocking side effect (audit write, telemetry, cache update, idle-window prime) fails, the correct pattern is:

```ts
try {
  await sideEffect();
} catch (err) {
  logger.error(
    { err: err instanceof Error ? err.message : String(err), kind: 'feature_action_failed' },
    '<canonical message>',
  );
  // Optional: increment a counter / metric.
}
// Continue with the primary clinical action — do not re-throw, do not return early.
```

**This is NOT silent-catch.** It has a structured `logger.error` call with a `kind` tag.

**This is NOT fail-closed.** The primary action still completes.

**It is the only acceptable shape for "best-effort" paths.**

When truly nothing-to-do is correct (e.g., cache pre-warm, redundant idempotent retry), use the canonical comment shape:

```ts
} catch (_) {
  // intentional silent — <reason — must explain WHY this throw cannot harm the user>
}
```

`.github/scripts/check-no-silent-catches.sh:85-86` accepts `// intentional silent — <reason>` and `// allowed silent — <reason>` as the recognised exemption directives (case-sensitive, on the same line as the catch or the line above). The `<reason>` must be auditable; "best effort" alone is not sufficient.

**Reference:** `findings-6a-silent-catch.md` "Pattern note" paragraph; canonical directive.

**Cross-references:** Rule 8 (graceful degradation), CLAUDE.md §3.

---

## How to update this checklist

**Trigger:** any future PART 3 finding that surfaces a NEW class must update this file in the same commit as the BUG that surfaces it.

**Anti-pattern:** copy-pasting examples from this file into reviewer prompts. The `clinical-safety-reviewer.md` agent has Read tool access; the agent reads this file at review time. Do not duplicate.

**Process for adding a new class:**
1. File the BUG that surfaced the new class (per §E PART 3 trigger).
2. Add a new section to this file (continue the alphabet — H, I, J, ...) with the same shape as §A through §G: definition, worst-case patterns table, deploy-blocker patterns table, BUG references, L4 verdict.
3. Update §F if the new class introduces a severity-rule edge case.
4. Atomic commit per `feedback_atomic_catalogue_flip.md`.

**Cross-links:**
- `feedback_audit_checklist.md` — the 13-point principal-engineer audit (broader scope; this checklist is the L4-specific subset).
- `feedback_no_silent_out_of_scope.md` — the PART 3 discipline rule.
- `feedback_atomic_catalogue_flip.md` — commit shape.
- CLAUDE.md §3 — Express route handler try/catch + `next(err)` requirement.
- `docs/archive/audit-2026-04-24/findings/findings-6a-silent-catch.md` — silent-catch enumeration (canonical precedent map).
- `.claude/agents/clinical-safety-reviewer.md` — the 8 baked clinical rules.
