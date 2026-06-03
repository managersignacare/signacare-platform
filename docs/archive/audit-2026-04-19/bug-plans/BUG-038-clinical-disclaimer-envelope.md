# BUG-038 — /suggest + /clinical-ai clinical disclaimer envelope

**Severity:** S0 | **Track:** A | **Wave:** A-2 | **Date:** 2026-04-21

---

## 1. Metadata

| Field | Value |
|---|---|
| Bug ID | BUG-038 |
| Plan source | EXECUTION-PLAN-v3-FULL §2.1 Wave A-2 |
| Related | BUG-036 (/agent patient-relationship gate — introduced the canonical `disclaimer` field), BUG-173 (AI-DRAFT banner UI surface, Track C follow-up), BUG-034 (scribe diagnosis-inference block) |
| Owner | Clinical Safety Approver |
| Change-class | standard (response envelope addition, no migration, no auth surface) |

---

## 2. Diagnosis

**Root cause (one sentence):** `POST /api/v1/llm/suggest` and `POST /api/v1/llm/clinical-ai` return AI-generated clinical content (SOAP summaries, ISBAR handovers, discharge plans, letters, etc.) without a machine-readable `disclaimer` field in the response envelope, so downstream UIs and forensic auditors cannot reliably distinguish AI output from clinician-authored content.

**Why this is patient-safety critical:**
- Under TGA non-device classification, clinical AI output must be marked as "non-authoritative" so clinicians treat it as a draft.
- `/agent` already carries `disclaimer: 'AI-generated — verify against current clinical guidelines before acting'` (added in BUG-036 line llmRoutes.ts:834). `/suggest` and `/clinical-ai` must reach parity.
- A frontend banner (BUG-173) can hard-code a message, but auditors who replay a response body post-hoc see no signal that the content was AI-generated. The response envelope is the forensic authority.
- Current `/suggest` output has the disclaimer *text-embedded in output_ref content* (llmService.ts:203-207). That's user-visible but not machine-parseable and inconsistent with `/agent`.

**Classification:** structural — the class is "LLM response envelope missing a discrete `disclaimer` field". Across `apps/api/src`:
- /agent has it ✓
- /suggest lacks it ✗
- /clinical-ai (all 9 actions: maudsley/isbar/formulation/91day/letter/discharge/med-summary/admin-report/register-summary) lacks it ✗
- /scribe/patient-summary + /scribe/referral-letter have `isAiDraft: true` flag but no canonical string ✗ (out of scope this bug; tracked as BUG-284)

---

## 3. Approach

1. **Canonical constant.** New file `apps/api/src/shared/llmDisclaimer.ts` exports:
   ```
   export const CLINICAL_AI_DISCLAIMER = 'AI-generated — verify against current clinical guidelines before acting';
   ```
   Single source of truth. Every LLM response handler imports from here.

2. **/suggest envelope.** `llmRoutes.ts` /suggest handler wraps `res.json(...)` to include `disclaimer: CLINICAL_AI_DISCLAIMER`. The text-embedded variant in `llmService.ts:203-207` (appended to output_ref content) is left intact — that's the user-visible inline footnote on saved output, a different concern.

3. **/clinical-ai envelope.** Both `res.json` paths in the handler (enhanced + direct) gain `disclaimer: CLINICAL_AI_DISCLAIMER`.

4. **/agent de-duplication.** The inline literal at llmRoutes.ts:834 is replaced with `disclaimer: CLINICAL_AI_DISCLAIMER`.

5. **No frontend changes required** (report from Explore): current consumers don't reference the envelope's `disclaimer` field — adding it is backward-compatible. BUG-173 will adopt the field in the Letters composer UI.

---

## 4. Alternatives considered + rejected

| Alternative | Rejected because |
|---|---|
| Embed disclaimer in response body text (as /suggest does today via output_ref) | Not machine-readable; auditor replaying response can't distinguish from clinical content; frontend must regex-split. |
| Add a `aiGenerated: true` boolean flag instead of full disclaimer string | Not human-readable in response logs; frontend still has to hard-code the message. Flag + string is redundant. |
| Wrap every LLM route via Express middleware that injects the disclaimer | Creates an implicit/magic contract ("why does my response have this field?"). Plan §3.1 #4 prohibits new patterns without a second use case. Explicit import is traceable. |
| Extend scope to all /scribe/* LLM endpoints in this commit | Scope creep — BUG-038 is named `/suggest + /clinical-ai`. Scribe endpoints have `isAiDraft: true` flag as interim safeguard. Filing BUG-284 as follow-up. |
| Put constant in `packages/shared` | The constant is a backend response-shape concern, not a cross-package type. Putting it in `packages/shared` would invite the frontend to import (not wrong, but premature coupling). When BUG-173 lands frontend rendering, re-evaluate. |

---

## 5. Reviewer refinement trail

_To be populated after L3 + L4 + L5 subagent reviews._

---

## 6. Implementation outline

**Files touched:**
- `apps/api/src/shared/llmDisclaimer.ts` (new — 1 exported const)
- `apps/api/src/features/llm/llmRoutes.ts` (3 handler edits)
- `apps/api/tests/integration/llmDisclaimerEnvelope.int.test.ts` (new — 4 tests)
- `docs/audit-2026-04-19/bug-catalogue-v2.yaml` (BUG-038 entry + BUG-284 follow-up)
- `docs/audit-2026-04-19/bug-plans/BUG-038-clinical-disclaimer-envelope.md` (this doc)
- `docs/fix-registry.md` (R-FIX-CLINICAL-DISCLAIMER-ENVELOPE anchor)

**Out of scope (not touched):**
- `apps/api/src/features/llm/llmService.ts` text-embedded disclaimer at line 203-207 — separate concern (inline footnote on saved content).
- `scribeRoutes.ts` endpoints — BUG-284.
- Frontend consumers — BUG-173.

---

## 7. Tests

File: `apps/api/tests/integration/llmDisclaimerEnvelope.int.test.ts` (4 tests)

1. **T1** — POST /api/v1/llm/suggest response contains `disclaimer` field === `CLINICAL_AI_DISCLAIMER`.
2. **T2** — POST /api/v1/llm/clinical-ai (enhanced path — action='maudsley', patientId present) response contains `disclaimer` field === canonical string.
3. **T3** — POST /api/v1/llm/clinical-ai (direct path — action='classify', no patientId) response contains `disclaimer` field === canonical string.
4. **T4** — POST /api/v1/llm/agent (regression) still contains the canonical disclaimer (not a drifted inline literal).

**Red-first:** pre-fix T1–T3 FAIL (no disclaimer field); T4 passes pre- and post-fix but pins that the de-duplication didn't drift the string.

---

## 8. Verification trace

- **Original failing scenario:** /suggest response body JSON-parsed by auditor — no `disclaimer` key → scenario: forensic review can't tell if the content was AI. Post-fix: key present in every non-error response.
- **Null / empty input:** N/A — the envelope field is added regardless of response content (even empty `result: ''` includes disclaimer).
- **Concurrent / race:** N/A — static string, no shared state.
- **Max payload:** N/A — ~70-char field, negligible overhead.
- **Missing env var:** N/A — not env-gated; constant is compile-time.
- **Expired token / auth failure:** Handlers short-circuit before `res.json({disclaimer})`; error responses (4xx/5xx) deliberately DON'T carry the disclaimer — the envelope is for successful AI output only. Error-path absence is verified by code inspection (llmController.ts:104-110 classifier-block path returns `{error, code, reason}` with no disclaimer); mechanical enforcement is BUG-285's CI guard scope.

---

## 9. Residual risk

| Risk | Mitigation | Owner |
|---|---|---|
| /scribe/* endpoints still lack the envelope | BUG-284 (S1 A-3) files pattern parity | Clinical Safety Approver |
| Frontend doesn't read the field yet — banner is still hard-coded | BUG-173 adopts field when Letters composer lands | Product Engineer |
| Text-embedded disclaimer at llmService.ts:203 is a DIFFERENT string | Clinically complementary not conflicting: the text-embedded variant (`'[⚠ Verify against current clinical guidelines before acting.]'`) gets appended to saved output_ref content (user-facing prose in the saved record); the envelope field (`CLINICAL_AI_DISCLAIMER`) is machine-readable metadata. They serve different auditor + UI concerns. Consolidation is deferred to a future ticket (not scoped here because output_ref content is persisted to the patient record and changing it retroactively would alter historical rows). | — |
| Future LLM endpoint added without disclaimer | A CI guard could assert every `apps/api/src/features/llm/*Routes.ts` `res.json` includes `disclaimer` — BUG-285 (S3 B-11) tracks | Reviewer |

---

## 10. CAB / change-control notes

- Response contract extension; backward-compatible (consumers ignore unknown fields).
- No migration, no auth surface change.
- Change-class standard (<100 lines changed; no migration; no new route; no new dependency; no auth/RLS/PHI surface touched).

---

## 11. QA agent verdicts

- **L1 static:** PASS (tsc clean; fix-registry guard green; snapshot-freshness N/A — no migration).
- **L2 narrative:** PASS (this plan doc + catalogue entry + fix-registry row).
- **L3 code judgement:** PASS — APPROVED. Key points:
  - Real fix not band-aid: machine-readable field; auditors can grep response logs.
  - SSOT clean: one constant, four imports, zero inline literals remaining in the three in-scope endpoints.
  - Mutation-resistant tests: deleting the line in any of the 4 handlers fails the corresponding test.
  - /agent anti-drift anchor: T4 strict-equality check on the canonical string catches any inline re-introduction.
  - Two plan-doc honesty fixes absorbed: (a) §8 wording corrected — error-path absence is verified by code inspection, mechanical enforcement is BUG-285 scope; (b) §9 residual-risk row amended — the text-embedded variant at llmService.ts:203 is a DIFFERENT string (complementary, not drift).
- **L4 clinical safety:** PASS — APPROVED. Verdict: "More safe."
  - Hallucination-detection gate, sign-off workflow, model_version audit (BUG-037), AI-DRAFT header, `is_ai_draft` flag all untouched.
  - New envelope field is additive, never weakens any existing guardrail.
  - De-duplication of /agent inline literal structurally prevents future drift.
  - TGA wording compliant: string identifies AI provenance, asserts non-authoritativeness, commands clinician verification — three signals an Australian regulatory auditor recognises as non-device evidence.
  - Residual: scribe endpoints still carry `isAiDraft:true` + AI_DRAFT_HEADER content but no envelope field; interim gap mitigated by server-appended content header, closed by BUG-284 in Wave A-3.
- **L5 architecture:** SKIP (standard-class per §5.1 — structural SSOT concerns covered by L3).
