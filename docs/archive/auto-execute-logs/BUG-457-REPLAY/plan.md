# Plan — BUG-457 REPLAY: LlmFeature / LLMInteraction enum drift

[Plan agent invocation 2026-04-25 per `~/.claude/plans/sleepy-roaming-meteor.md` PART 2 §B; first-principles re-derivation per PART 6.1 #3 — no read of any reverted commit (`05893a2`). Atomic-scope per PART 11. **Applying BUG-456 absorb-2 lessons:** UNION up front, `^`-anchored fix-registry shapes, atomic catalogue flip.]

**Severity:** S1 deploy-blocker (pre-staging)
**Replay queue position:** PART 1 Tier-3 #18 (after BUG-456)
**Sibling shipped at HEAD:** BUG-456 (`718c72e`) — established Path A pattern.

---

## 0. Executive summary

Bug catalogue row at `docs/quality/bugs-remaining.md:160`: *"LlmFeature / LLMInteraction enum drift — zero overlap between shared + frontend"*. Ground-truth confirms the drift is real and worse than catalogued — the SSoT enum is fictional vs production reality on 3 axes:

- **SSoT** `LlmFeatureSchema` at `packages/shared/src/llm.schemas.ts:4-12` — 6 values: `ambient_note, suggestion, summarisation, risk_flag, coding_assist, other`.
- **Frontend** `LLMSuggestionTypeSchema` at `apps/web/src/features/llm/types/llmTypes.ts:9-18` — 7 different values: `soap_note, clinical_summary, referral_letter, risk_analysis, medication_review, discharge_summary, care_plan`. **Zero overlap** with SSoT. Embedded in `LLMInteractionSchema` (line 71-80).
- **DB column** `llm_interactions.feature` — `varchar(50) NOT NULL DEFAULT 'other'`, **no CHECK constraint** (verified `migrations/20260701000000_baseline.ts:7209`).
- **Production writes ZERO of the SSoT enum values:** `'ambient'`, `'ai-agent'`, `'scribe-patient-summary'`, `'scribe-referral-letter'`, `'scribe-search'`, plus template literals `document_*`, `clinical-ai:*`, `suggest:*`, plus free-form `feedback.action`.

### 0.1 Why this is a deploy-blocker

1. `POST /api/v1/llm/interactions` (`llmController.ts:30`) runs `LlmInteractionWriteDTOSchema.parse(req.body)`. Any caller writing the values production already uses (`'ambient'`, `'ai-agent'`, etc.) 422s — the endpoint is dead-letter for every realistic feature value.
2. Frontend `LLMInteractionSchema` is fictional: zero `.parse()` consumers, zero `LLMInteraction` type imports (verified by grep). Pure drift artefact.
3. Plain duplicate-API-types violation — same class as BUG-456.

### 0.2 Out-of-scope (PART 11 atomic)

BUG-458 (Appointment), BUG-459 (patientRoutes raw rows), BUG-460 (extend duplicate-types guard), BUG-461 (LegalOrderResponseSchema), BUG-462 (NoteType/Episode/Pathology enums), BUG-464 (LLM prompt-pipeline typing).

---

## 1. Current state — ground-truth Read

### 1.1 SSoT — `packages/shared/src/llm.schemas.ts`

| Symbol | Lines |
|---|---|
| `LlmFeatureSchema` enum (6 values) | 4-11 |
| `LlmInteractionWriteDTOSchema` (`feature: LlmFeatureSchema` strict) | 14-29 |
| `LlmInteractionResponseSchema` (`feature: z.string()` permissive) | 32-49 |
| `LlmUsageDaySummarySchema` (`feature: z.string()`) | 52-62 |
| `LlmSuggestionRequestSchema` (`feature: z.enum([...3 of 6])`) | 81-98 |

### 1.2 Frontend redeclaration — `apps/web/src/features/llm/types/llmTypes.ts`

| Symbol | Lines | Status |
|---|---|---|
| `LLMSuggestionTypeSchema` (7 values, UI taxonomy) | 9-17 | KEEP (UI state machine — not feature-write) |
| `LLMSuggestionType` | 18 | KEEP (used by `useLLMSuggest.ts:8,20,94,106,118,130`) |
| `LLMInteractionSchema` (drift) | 71-79 | DELETE (zero consumers) |
| `LLMInteraction` type | 80 | DELETE (zero consumers) |

### 1.3 Backend usage — clean (no redeclaration)

`llmService.ts:3-9` imports SSoT types. `mapInteraction()` returns `LlmInteractionResponse` permissively passes `feature: r.feature` through.

### 1.4 DB schema — no CHECK

`migrations/20260701000000_baseline.ts:7209` — `t.string('feature', 50).notNullable().defaultTo('other')`. No CHECK constraint anywhere.

### 1.5 Frontend `LLMInteraction` is dead code

- `LLMInteraction` (type) — zero consumers (grep verified).
- `LLMInteractionSchema` (Zod) — zero `.parse()`/`.safeParse()` calls (grep verified).
- `LLMSuggestionType` — UI state-machine taxonomy in `useLLMSuggest.ts`, not a feature-write column.

### 1.6 Production literal writes (12 sites verified)

| Site | File:line | Literal | Form |
|---|---|---|---|
| 1 | `scribeRoutes.ts:223` | `'scribe-patient-summary'` | string |
| 2 | `scribeRoutes.ts:295` | `'scribe-referral-letter'` | string |
| 3 | `scribeRoutes.ts:1332` | `'scribe-search'` | string (bypass-audit) |
| 4 | `llmRoutes.ts:310,364` | `` `clinical-ai:${action}` `` | template (bypass-audit) |
| 5 | `llmRoutes.ts:840` | `'ambient'` | string (bypass-audit) |
| 6 | `llmRoutes.ts:948,985` | `'ai-agent'` | string |
| 7 | `llmController.ts:143` | `` `suggest:${dto.feature}` `` | template |
| 8 | `documentService.ts:263` | `` `document_${type}` `` | template |
| 9 | `trainingPipeline.ts:79` | `feedback.action` | free-form |
| 10 | `ambientProcessor.ts:571` | `'ambient'` | string |

---

## 2. Design — Path A SSoT consolidation, UNION up front, parse-on-emit

### 2.1 Atomic edits

| File | Change |
|---|---|
| `packages/shared/src/llm.schemas.ts` | Widen `LlmFeatureSchema` to UNION of: 6 historical values + 5 production literals + 3 template-regex patterns + free-form fallback (per §2.2) |
| `apps/web/src/features/llm/types/llmTypes.ts` | DELETE `LLMInteractionSchema` + `LLMInteraction` (lines 71-80; zero consumers). Keep `LLMSuggestionType*` (UI state machine) |
| `apps/api/src/features/llm/llmService.ts` | Add parse-on-emit in `mapInteraction()` via `LlmInteractionResponseSchema.safeParse()` + `AppError(500, 'RESPONSE_SHAPE_ERROR')` wrap |
| `apps/api/tests/integration/llmInteractionShape.int.test.ts` | NEW — 5 cases verifying SSoT alignment |
| `docs/quality/fix-registry.md` | 4 anchor rows (`^`-anchored, no `\|`) |
| `docs/quality/bugs-remaining.md` | Mark BUG-457 fixed atomic with code commit |

### 2.2 SSoT widening — UNION up front

```ts
export const LlmFeatureSchema = z.union([
  z.enum([
    // Historical SSoT
    'ambient_note', 'suggestion', 'summarisation', 'risk_flag', 'coding_assist', 'other',
    // Production literals
    'ambient', 'ai-agent',
    'scribe-patient-summary', 'scribe-referral-letter', 'scribe-search',
  ]),
  // Template-literal shapes
  z.string().regex(/^document_[a-z0-9_-]{1,40}$/),
  z.string().regex(/^clinical-ai:[a-z0-9_-]{1,40}$/),
  z.string().regex(/^suggest:(ambient_note|suggestion|summarisation|risk_flag|coding_assist|other)$/),
  // Free-form feedback.action (DB has no CHECK; clinician input)
  z.string().min(1).max(50),
]);
```

The trailing `z.string().min(1).max(50)` admits any short string — defensible because DB has no CHECK and `feedback.action` is legitimate free-form. BUG-512 follow-up tightens to closed enum + DB CHECK after 30-day production observation.

### 2.3 Frontend dead-code removal

DELETE `LLMInteractionSchema` (71-79) + `LLMInteraction` (80). Keep `LLMSuggestionTypeSchema`/`LLMSuggestionType` (UI taxonomy).

### 2.4 Backend parse-on-emit

```ts
function mapInteraction(r: LlmInteractionRow): LlmInteractionResponse {
  const candidate = { /* ... */ };
  const parsed = LlmInteractionResponseSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new AppError(
      'LLM interaction response shape failed schema validation',
      500, 'RESPONSE_SHAPE_ERROR',
    );
  }
  return parsed.data;
}
```

### 2.5 What changes for the wire

- `POST /api/v1/llm/interactions` — broader payload acceptance. Pre-fix `feature: 'ambient'` → 422; post-fix → 201.
- `GET /api/v1/llm/usage` — unchanged (response schema permissive).
- `POST /api/v1/llm/suggest` — unchanged (narrow request DTO).
- Internal `recordLlmInteraction` callers — unchanged.

Monotonic widening, no caller breaks.

---

## 3. TDD red plan — `apps/api/tests/integration/llmInteractionShape.int.test.ts` (NEW)

| # | Test | Pre-fix | Post-fix |
|---|---|---|---|
| LI-1 | POST `/llm/interactions` with `feature: 'ambient'` | 422 (Zod enum) | 201 + body satisfies `LlmInteractionResponseSchema` |
| LI-2 | POST with `feature: 'document_handover-summary'` | 422 | 201 (matches `^document_[a-z0-9_-]+$`) |
| LI-3 | POST with `feature: 'risk_flag'` (legacy) | 201 | 201 (back-compat) |
| LI-4 | GET `/llm/usage` round-trip — assert `LlmInteractionSummaryResponseSchema` | PASS today | PASS (regression-trap) |
| LI-5 | Static check: `apps/web/src/features/llm/types/llmTypes.ts` does NOT contain `LLMInteractionSchema` or `export type LLMInteraction` | FAIL today | PASS post-deletion |

3× flake on the new file. §13.9 cross-cutting (touches `packages/shared/src/llm.schemas.ts`).

---

## 4. Files modified

| File | Change |
|---|---|
| `packages/shared/src/llm.schemas.ts` | Widen `LlmFeatureSchema` (UNION) |
| `apps/api/src/features/llm/llmService.ts` | parse-on-emit in `mapInteraction()` |
| `apps/web/src/features/llm/types/llmTypes.ts` | Delete `LLMInteractionSchema` + `LLMInteraction` |
| `apps/api/tests/integration/llmInteractionShape.int.test.ts` | NEW |
| `docs/quality/fix-registry.md` | 4 anchors |
| `docs/quality/bugs-remaining.md` | Mark BUG-457 fixed |

No CI guard changes. No migration. No backend redeclaration to delete.

---

## 5. Fix-registry anchors

All `^`-anchored (BUG-510 defect avoided).

| Row | File | Mode | Pattern |
|---|---|---|---|
| `R-FIX-BUG-457-NO-FRONTEND-INTERFACE-REDECLARATION` | `apps/web/src/features/llm/types/llmTypes.ts` | absent | `^export const LLMInteractionSchema` |
| `R-FIX-BUG-457-NO-FRONTEND-TYPE-REDECLARATION` | `apps/web/src/features/llm/types/llmTypes.ts` | absent | `^export type LLMInteraction =` |
| `R-FIX-BUG-457-SHARED-SSOT-IMPORT` | `apps/api/src/features/llm/llmService.ts` | present | `^import.*LlmInteractionResponseSchema.*@signacare/shared` |
| `R-FIX-BUG-457-MAPPER-SSOT-PARSE` | `apps/api/src/features/llm/llmService.ts` | present | `LlmInteractionResponseSchema\.safeParse\(` |

---

## 6. L4 / L5 conditional triggers

### 6.1 L4 — **FIRES**

Per §13.5 path trigger — `apps/api/src/features/llm/`. Focal points:
1. UNION-widening tolerance (especially trailing `z.string().min(1).max(50)`).
2. Audit-trail integrity preserved (BUG-037 contract).
3. Bypass-audit `feature` field unaffected (writes to `audit_log`, not `llm_interactions`).

### 6.2 L5 — **FIRES**

Per §I trigger — modifies `fix-registry.md` + `packages/shared/src/llm.schemas.ts`. Focal points:
1. SSoT discipline — frontend redeclaration deletion.
2. UNION-up-front (BUG-456 absorb-2 lesson).
3. Atomic scope.
4. `^`-anchored fix-registry shapes.

### 6.3 L3 — fires unconditionally.

---

## 7. PART 2 §A-§O execution map

§A done. §B done. §C TDD red. §D Implementation. §E L1. §F L2 (3× flake + integration suite per §13.9). §G L3. §H L4. §I L5. §J 2-REJECT absorb cap. §K fix-registry. §L commit (atomic catalogue flip per Wave A-4/A-5). §M chore commit with SHA. §N push (after explicit user authorization). §O.

---

## 8. Verification log — every cited site Read-confirmed

| Item | File | Line |
|---|---|---|
| BUG-457 row | `docs/quality/bugs-remaining.md` | 160 |
| SSoT `LlmFeatureSchema` | `packages/shared/src/llm.schemas.ts` | 4-12 |
| SSoT `LlmInteractionWriteDTOSchema` | `packages/shared/src/llm.schemas.ts` | 14-29 |
| SSoT `LlmInteractionResponseSchema` | `packages/shared/src/llm.schemas.ts` | 32-50 |
| Frontend `LLMInteractionSchema` (dead) | `apps/web/src/features/llm/types/llmTypes.ts` | 71-80 |
| Frontend `LLMSuggestionTypeSchema` (kept) | `apps/web/src/features/llm/types/llmTypes.ts` | 9-18 |
| Frontend `LLMInteraction` zero consumers | grep | verified |
| Backend `mapInteraction` | `apps/api/src/features/llm/llmService.ts` | 20-42 |
| Backend `LlmInteractionWriteDTOSchema.parse(req.body)` | `apps/api/src/features/llm/llmController.ts` | 30 |
| DB schema `feature` column | `apps/api/migrations/20260701000000_baseline.ts` | 7209 |
| Production literals (10 sites) | various | verified by grep |
| BUG-456 fix-registry precedent | `docs/quality/fix-registry.md` | 1043-1048 |

---

## 9. Risks + open questions

1. **Trailing `z.string().min(1).max(50)`** — admits typos. Mitigation: BUG-512 follow-up. Documented in commit body.
2. **Pre-fix POST endpoint unusable** — no internal callers found via grep.
3. **`LLMSuggestionType` retention** — UI taxonomy, not feature-write. BUG-513 (or BUG-462) follow-up to rename.
4. **No DB migration** — adding CHECK constraint would close the underlying tolerance. Filed as BUG-512.

---

## 10. Out-of-scope sibling drift (PART 3)

- BUG-458, BUG-459, BUG-460, BUG-461, BUG-462, BUG-464.
- BUG-512 (NEW): tighten LlmFeatureSchema + add DB CHECK after 30-day observation.
- BUG-513 (potential): rename frontend `LLMSuggestionType` → `LLMUITaskType`.

---

## 11. Critical Files

- `packages/shared/src/llm.schemas.ts`
- `apps/web/src/features/llm/types/llmTypes.ts`
- `apps/api/src/features/llm/llmService.ts`
- `apps/api/tests/integration/llmInteractionShape.int.test.ts` (NEW)
- `docs/quality/fix-registry.md`
- `docs/quality/bugs-remaining.md`
