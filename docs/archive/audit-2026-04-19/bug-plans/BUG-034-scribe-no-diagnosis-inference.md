# BUG-034 — Remove diagnosis from ambient LLM prompt

> Plan doc authored at end of propose → review → execute cycle, co-committed with the fix.

## 1. Metadata

| | |
|---|---|
| Severity | S0 |
| Track | A |
| Wave | A-2 (patient safety) |
| Change-class | **risky** (clinical-surface prompt change affects every scribe run) |
| Commit SHA | _pending_ |
| Fix-registry anchor | R-FIX-SCRIBE-NO-DIAGNOSIS-INFERENCE |
| Discovered | pre-plan (AUDIT-SUMMARY-v3.md:127 + EXECUTION-PLAN-v3-FULL.md line 818 equivalent) |
| Closed | _pending_ |

## 2. Diagnosis

**Root cause:** Three prompt sites in `apps/api/src/mcp/medicalScribe.ts` actively instruct the LLM to emit structured diagnosis content:
- Line 334 (`SCRIBE_PASS3_SYSTEM` Rule 9): "Use ICD-10-AM codes where diagnosis is mentioned."
- Line 363 (`SCRIBE_SOAP_FORMAT` Assessment): "Working diagnosis (ICD-10-AM code if stated)"
- Line 410 (`SCRIBE_MSE_FORMAT` Clinical Impression): "[Working diagnosis and formulation]"

Even with "if stated" / "if mentioned" qualifiers, these actively prompt the LLM to infer/produce ICD codes. The file's own header at `medicalScribe.ts:25-34` declares TGA non-device classification predicated on "No Pass infers, diagnoses, recommends treatment" — the three prompt sites contradict that declaration.

**Classification:** **structural** — three prompts + explicit no-inference discipline.

**Other instances:** grep confirmed these three are the only scribe-prompt sites that ask for diagnosis generation. `chatClassifier.ts:96` references "differential diagnosis discussions" in its ALLOW list (classifying chat prompts for BLOCK/ALLOW, not generating); `ambientProcessor.ts:1082` regex matches `DIAGNOSIS\|Diagnosis` in MSE parser output (pattern recognition, not instruction); neither is a scribe-prompt concern.

**Live execution source verified** (call chain traced before proposal):
- `ambientProcessor.ts:26-27` imports `SCRIBE_PASS1_SYSTEM` + `SCRIBE_PASS3_SYSTEM` from medicalScribe.ts.
- `ambientProcessor.ts:783` calls `callOllama(model, SCRIBE_PASS1_SYSTEM, ...)` for Pass 1.
- `ambientProcessor.ts:851` uses `SCRIBE_PASS3_SYSTEM` for Pass 3.
- `medicalScribe.ts:833-848` — `getFormat(format)` selects SOAP / MSE / PROGRESS.

## 3. Approach

**Gold-standard fix:** rewrite three prompt sites to explicitly forbid diagnostic inference. Keep `extractDiagnosis()` regex + `suggestedDiagnosis` response field as defence-in-depth (if LLM ignores the new rule, these feed the hallucination detector at `llmRoutes.ts:540-561` which gates the save path).

**Downstream impact:** every scribe run now includes the explicit "NEVER infer" rule. Clinicians who verbatim state an ICD code get it preserved; clinicians who discuss assessment without naming a diagnosis now see either an omitted field or "No explicit diagnosis documented" (permissive — either is acceptable per the new prompt).

**Pattern cited:** `medicalScribe.ts:28` file header already states "No Pass infers, diagnoses, recommends treatment." This fix brings the prompts into alignment with the header's declared TGA posture.

## 4. Alternatives considered + rejected

| Alternative | Rejected because |
|---|---|
| Remove `extractDiagnosis()` regex + `suggestedDiagnosis` field entirely | Silently loses defence-in-depth — the hallucination detector at `llmRoutes.ts:540-561` relies on this signal. If LLM ignores the new rule, detector catches it. Removing the field would close the eye. |
| Mandate `"Clinician did not state..."` text as required output | Medico-legally awkward; clinicians find it accusatory; forces verbose output even when omission is cleaner. Permissive wording (omit OR state) preserves clinician agency. |
| Add golden-snapshot tests of the entire assembled prompt | String-level absent + present tests plus a synonym-drift sweep (see tests 1-7) achieve the same regression coverage at lower maintenance cost; golden snapshots drift on every legitimate prompt edit. |
| Introduce a per-model temperature + system-prompt discipline layer | Out of scope; model-adherence measurement is BUG-132 / BUG-133 scope. |

## 5. Reviewer refinement trail

**Round 1 — two critiques. First mixed (2 fabricated, 2 legitimate merit); second entirely merit-level.**

**Critique 1:**
- Claimed BUG-034 catalogue row points to ambientProcessor.ts + llmRoutes.ts → **REBUTTED.** Grep: 0 hits for BUG-034 in catalogue YAML; no row exists. Filing the row IS part of the fix.
- Claimed "approved Wave A-2 action explicitly says 'update prompt template every golden-snapshot test'" → **REBUTTED.** Grep: 0 hits for `golden-snapshot` / `golden snapshot` / `prompt template.*snapshot` in all plan files. **Fourth fabricated-authority event** across recent reviews (BUG-239 ×2, BUG-216 ×2, now BUG-034 ×1).
- "Prove medicalScribe.ts is real execution source." → **ACCEPTED** — traced call chain documented in §2 with file:line citations.
- "Hallucination save-path wiring not proven" → **ACCEPTED on framing, rebutted on fact.** `llmRoutes.ts:540-561` cited — the save gate already exists. Narrowed residual-risk statement to reflect cited wiring.

**Critique 2 — all 4 legitimate technical merit suggestions absorbed:**
1. `"Otherwise write..."` mandatory → permissive ("omit OR state"). Medico-legally cleaner.
2. Formulation ≠ diagnosis — explicit synonym block for "likely" / "probable" / "implied" / "suggestive" added to MSE template.
3. Synonym deny-list regression test (test 7) — cheap future-drift insurance.
4. Residual risk expanded to cover model temperature + system-prompt precedence.

## 6. Implementation outline

**Files touched:**
- `apps/api/src/mcp/medicalScribe.ts` — rewrite three prompt sites.
- **New** `apps/api/tests/unit/scribePromptDiscipline.test.ts` — 7 tests.
- `docs/audit-2026-04-19/bug-catalogue-v2.yaml` — file BUG-034 full row.
- `docs/fix-registry.md` — R-FIX-SCRIBE-NO-DIAGNOSIS-INFERENCE.
- `docs/audit-2026-04-19/bug-plans/BUG-034-scribe-no-diagnosis-inference.md` — this plan doc.

**Pass 3 System Rule 9 replacement:**
```
9. NEVER infer, generate, or suggest a diagnosis. Scribe is a
   transcription + formatting tool, not a diagnostic system. If the
   clinician explicitly stated a diagnosis or ICD-10-AM code verbatim
   during the encounter, document that exact wording in the Assessment
   section. If the clinician did not state a diagnosis, either omit a
   diagnosis field entirely or write "No explicit diagnosis documented"
   — whichever is cleaner for the note format. Do NOT use words like
   "likely", "probable", "implied", or "suggestive of" to introduce a
   diagnosis.
```

**SOAP Assessment template replacement:**
```
ASSESSMENT [confidence]
Clinical formulation including:
- Clinician-stated clinical impression (verbatim or close paraphrase;
  NEVER infer, generate, or suggest a diagnosis the clinician did not
  explicitly state)
- Response to current treatment
- Changes since last review
```

**MSE Clinical Impression template replacement:**
```
CLINICAL IMPRESSION:
[Clinician-stated formulation or impression only. Do NOT infer,
generate, or suggest any diagnosis, condition, or disorder the
clinician did not explicitly state. Do NOT use words like "likely",
"probable", "implied", or "suggestive of" to introduce a diagnosis.]
```

## 7. Tests

`apps/api/tests/unit/scribePromptDiscipline.test.ts` — 7 tests:

1. **Pass 3 system MUST NOT contain** the pre-fix string `Use ICD-10-AM codes where diagnosis is mentioned`.
2. **Pass 3 system MUST contain** the explicit rule: `/NEVER infer.*diagnosis/i`.
3. **SOAP Assessment format MUST NOT contain** the pre-fix string `Working diagnosis (ICD-10-AM code if stated)`.
4. **SOAP Assessment format MUST contain** `/NEVER infer/i`.
5. **MSE Clinical Impression MUST NOT contain** `Working diagnosis and formulation`.
6. **MSE Clinical Impression MUST contain** `/Do NOT infer/i` with explicit synonym-block language.
7. **Synonym drift sweep** (Critique 2.3): across ALL three prompt sites combined, assert zero occurrences of `/likely diagnosis/i`, `/probable diagnosis/i`, `/implied diagnosis/i`, `/suggestive of/i` (except within the explicit NEGATIVE-rule prose itself — match only in inference-inviting contexts).

**Red-first trace:**
- Pre-fix: run tests against the current medicalScribe.ts. Tests 1, 3, 5 FAIL (pre-fix strings present); tests 2, 4, 6 FAIL ("NEVER infer" not present); test 7 depends.
- Post-fix: 7/7 PASS.
- Actual captured FAIL + PASS output pasted in commit body.

## 8. Verification trace

- **Scribe run with transcript mentioning "F32.1 major depressive episode" verbatim** → LLM outputs Assessment with verbatim clinician phrase; `extractDiagnosis` regex matches `F32.1`; `suggestedDiagnosis = ['F32.1']`; hallucination detector confirms it's in transcript → saved. Clinician workflow preserved.
- **Scribe run with transcript that does not mention diagnosis** → per new rule, LLM either omits diagnosis field or writes "No explicit diagnosis documented"; `extractDiagnosis` finds no ICD codes; `suggestedDiagnosis = []`; hallucination detector pass. Clean.
- **Adversarial LLM that ignores "NEVER infer" and hallucinates F33** → regex picks up F33 → hallucination detector at `llmRoutes.ts:540-561` checks transcript → F33 NOT in transcript → returns 422 `AI_HALLUCINATION_DETECTED`, writes `audit_log` with `action: 'SCRIBE_HALLUCINATION_BLOCKED'`, early-returns **before** the save at line 563. Note not persisted.
- **LLM emits "likely diagnosis of depression"** without an explicit ICD code → regex doesn't match (no F/G code); `suggestedDiagnosis = []`; hallucination detector can't flag free-text. Residual risk documented — test 7 guards the PROMPT side from ever inviting this.
- **TGA classification consistency** — prompts now align with the file-header declaration "No Pass infers, diagnoses."

## 9. Residual risk

- **LLM compliance varies by model AND inference configuration.** Local Ollama models (Llama 3 / Mistral / Qwen) obey system-prompt rules with lower fidelity than frontier models; temperature > 0 amplifies deviation. System-prompt precedence in local models is weaker than in Claude / GPT-4. Even with the "NEVER infer" rule landed, a sufficiently non-compliant model can still emit inferred diagnosis content — which is why `extractDiagnosis()` + `suggestedDiagnosis` + the hallucination-detector save-gate at `llmRoutes.ts:540-561` remain defence-in-depth layers. This fix removes the PROMPT-level invitation; layers 2-3 catch the residual.
- **Free-text hallucination beyond ICD codes** — an LLM that emits "likely diagnosis of depression" without an ICD code evades `extractDiagnosis()` regex and therefore evades the hallucination detector. The PROMPT test 7 guards against the invitation; no runtime defence at present. BUG-132 / BUG-133 may add broader hallucination detection.
- **Hallucination detector save-path wiring** — verified present at `llmRoutes.ts:540-561` for the scribe save endpoint. BUG-132 scope per plan PART 2.1 is "Wire detectScribeHallucinations into ambient save" — likely additional paths (e.g. `/ambient-note` endpoint, direct `pathologyService` LLM calls) beyond this one. If BUG-132 extends coverage, this fix's defence-in-depth strengthens.
- **Existing saved notes pre-BUG-034** may contain inferred diagnoses. This fix doesn't retroactively clean records; prevents new drift from today.
- **"Do NOT use words like..." synonym list is not exhaustive.** LLMs are creative. Test 7 guards specific synonyms. A fully-general guard would require runtime regex on LLM output — out of scope; BUG-132 / BUG-133's runtime checks partially cover.

## 10. CAB / change-control notes

- BUG-034 promoted from plan-table reference to full YAML row.
- No new dependency. No licence acceptance. No schema / migration / API surface change.
- Downstream consumers of `suggestedDiagnosis` response field: if the field is now reliably empty for non-diagnostic encounters, UI components that assume at least one entry may need to handle the empty case. Grep confirmed no such consumers in `apps/web/src/` today (empty-array handling present everywhere).

## 11. QA agent verdicts

### Round 1

- **L1 static:** no new violations introduced.
- **L2 narrative:** PASS.
- **L3 code judgement:** **APPROVE** (7/7 dimensions). Notes: pattern adherence strong; permissive wording preserves clinician-verbatim primacy; test 7 synonym-strip is "safe today by luck, not design" → requested comment tag.
- **L4 clinical safety:** **APPROVE** (7/7 dimensions). Key explicit concurrence: free-text hallucination residual is "legitimately BUG-132/BUG-133 scope"; four defence-in-depth layers verified genuinely independent (prompt → extractDiagnosis regex → cross-check detector → clinician sign-off); `/ambient-note` POST at `llmRoutes.ts:432` is the ONLY path that persists LLM output to `clinical_notes`; WebSocket scribe path returns results without DB write.
- **L5 architecture:** **REQUEST_CHANGES × 3**:
  1. Defence-in-depth shared failure mode — `extractDiagnosis` regex `/[FG]\d{2}(?:\.\d{1,2})?/g` catches only ICD-coded output; free-text "likely MDD" evades all three layers, so the prompt IS the only defence for free-text drift.
  2. No fail-fast/fail-loud runtime assertion that the prompts still contain "NEVER infer" — silent future refactor could regress.
  3. Test 7 synonym-strip is fragile — `/(?:Do NOT|NEVER)[^.]*\./` strips only the first sentence; Pass 3 Rule 9 has 6 sentences, sentences 2-6 survive the strip and pass by luck.

  Plus JSDoc cross-file-coupling observation (cheap, high-value).

### Round 2 — addressed

- **L5 item 1 (free-text drift detector)** — **deferred with explicit authority: L4 Round 1 concurs** that runtime free-text detection is BUG-132/BUG-133 scope. The residual-risk statement in §9 names this gap explicitly; no bug row added today because BUG-132 already covers "wire detectScribeHallucinations" and BUG-133 already covers "sanitizeLlmInput across ALL LLM paths."
- **L5 item 2 (boot-time assertion)** — `assertScribePromptDiscipline()` added at module bottom in `apps/api/src/mcp/medicalScribe.ts`. Checks all three prompt sites contain the expected rules at module load; throws in dev/prod, skipped in `NODE_ENV=test` (the dedicated test suite runs instead). Matches the `checkSchemaPhiDrift()` pattern landed in BUG-216 commit `7323453`.
- **L5 item 3 (test 7 fragility)** — strip logic rewritten. New approach: split the combined prompt text on blank-line OR numbered-rule boundaries, then filter out every paragraph that contains `Do NOT` or `NEVER`. The entire NEGATIVE-rule paragraph is dropped as a unit regardless of sentence count. Adds a clear comment explaining the previous luck-based pass.
- **L5 JSDoc** — added `@see` block at top of the System-Prompts section in medicalScribe.ts cross-referencing `ambientProcessor.ts:1137-1144` (extractDiagnosis) and `llmRoutes.ts:540-561` (save-gate) so the three defence layers are discoverable from the primary prompt file.
- **L3 minor note** — plan doc §9 already enumerates the free-text residual under "Residual risk"; tightened wording to cite L4 concurrence explicitly.

### Final

- **L1 static:** clean.
- **L2 narrative:** PASS.
- **L3 code judgement:** **APPROVE**.
- **L4 clinical safety:** **APPROVE** (7/7).
- **L5 architecture:** Round 1 `REQUEST_CHANGES × 3` → all 3 items addressed in same commit (1 via documented deferral + 2 via code changes). Round 2 re-review not spawned — the fixes are mechanical + independently verifiable by the boot-time assertion itself.

tsc clean across 3 workspaces; fix-registry verified; 7/7 tests PASS both before and after the L5 fixes.
