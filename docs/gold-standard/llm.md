# 07 — LLM Integration

**Last refreshed:** 2026-05-29 (refresh — supersedes 2026-04-24 baseline; adds model-router pattern from PART 10, scribe-25 non-diagnostic egress posture, and current scribe-consent + clinical-note signature hash integration).

Signacare's LLM integration is designed for **tenant-residency**, **auditability**, and **explicit consent**. The 3-pass scribe pipeline in `ai-scribe.md` is ONE consumer of this LLM layer; letters, structured-recommendation, admin summarisation, and clinical-decision-support are the others.

## Integration surface

All LLM traffic flows through `apps/api/src/features/llm/` and `apps/api/src/mcp/`:

- **`llmService.ts`** — the single entry for every LLM call. Every caller passes `AuthContext` + a structured prompt template name (no free-form prompt injection from the UI).
- **`llmController.ts`** — HTTP surface for UI-driven use (letters composer, note enhancement, structured search).
- **`llmRepository.ts`** — writes to `llm_interactions` on every call. Every row includes: prompt template ID, redacted-input, model version, output, latency, cost-if-metered, consent context. Immutable per §4 — update triggers reject.
- **`aiEnhancer.ts`** — the AI-agent dispatch layer used by the scribe and letter surfaces.
- **`ollamaModelRegistry.ts`** — which model runs on which backend; lock-by-version so rollouts are explicit.
- **`responseGuard.ts`** — May-2026 addition (BUG-SCRIBE25-001): non-diagnostic egress posture at AI output boundary with qualifier injection + labels on diagnosis/summary/agent paths.

## Deployment modes

Signacare supports three LLM deployment shapes:

1. **Self-hosted Ollama (default)** — Ollama GPU host in the tenant VNet, inference never leaves tenant boundary. Suits compliance-heavy tenants (public health, corrections, defence).
2. **Tenant-isolated cloud (optional)** — Azure OpenAI with a tenant-specific Azure subscription OR a direct contract with an AU-resident LLM provider. Consent-gated at UI level.
3. **Hybrid (dev / test only)** — allowed in non-production for developer productivity; blocked in production by the `assertAiDataResidency` boot check (see `apps/api/src/shared/aiDataResidencyCheck.ts`).

## Model routing (PART 10 pattern)

A `modelRouter.ts` (PART 10 P2 design) selects the foundation model per clinic-flag (`ai-scribe.model_hosting` ∈ `{'on-prem', 'anthropic-au', 'azure-au-openai'}`). PHI scrubber + consent + audit unchanged regardless of host; only the LLM endpoint differs. Non-AU cloud is explicitly forbidden by default; clinic admin must opt in to AU-cloud with a BAA reference in `clinic_settings`. IRAP-PROTECTED-only flag for government tenants.

## Safety envelope

Every LLM response returned to a clinician UI carries a **disclaimer envelope**:

```json
{
  "value": "...",
  "aiDraft": true,
  "model": "qwen2.5:14b@2026-04-01",
  "promptTemplate": "structured-note-v3",
  "confidence": 0.87,
  "generatedAt": "2026-04-24T06:00:00Z",
  "redactionSummary": { "phiTokensRedacted": 12 },
  "signedByClinician": false
}
```

CI guard `check-disclaimer-envelope` (BUG-285 when shipped) asserts every LLM-output handler wraps in this envelope.

Diagnosis-shaped output additionally passes through `responseGuard.ts` (BUG-SCRIBE25-001) which:
- Detects diagnosis claims that lack a qualifier (e.g., "possible / consistent with / consider")
- Injects a qualifier label OR rejects the output entirely
- Logs the gate decision in `llm_interactions.metadata.responseGuardVerdict`

## Audit + forensics

- Every LLM call writes an `llm_interactions` row. Immutable via DB trigger.
- Hash-chain re-implementation (BUG-287 reopened) will allow forensic verification that no row has been edited or dropped.
- Break-glass sessions annotate their LLM calls with the `break_glass_session_id`.
- Cost and latency metrics aggregated per-clinic per-day into Application Insights / Sentry.
- Scribe consent revoke mid-stream (BUG-WF51-CONSENT-REVOKE-RACE) records `consent_revoked_at` + best-effort audio deletion in the `llm_interactions` row.

## Clinical-note tamper detection

Signed clinical notes that originated from an AI draft now carry a **content hash + immutability trigger** (BUG-ARCH-CLINICAL-NOTE-SIGNATURE-HASH). Any DB-write attacker who edits a signed note's content row is detected by the hash mismatch. AHPRA Standard 6 forensic chain extended from audit-log to clinical-note content.

## Model governance

- **Model-version lock** — production can't silently upgrade. A model-version bump is a config change that requires an evidence file showing regression tests pass on the new version.
- **Prompt-template registry** — every prompt has a template ID, a change log, and a test vector set (input + expected output shape). No free-form prompts from route handlers.
- **Temperature + max-tokens pinned per template** — prevents probabilistic drift between calls.

## Known limitations

- Ollama local inference is bounded by the host's VRAM (14B Qwen ceiling on current staging GPU).
- No multi-turn conversation state beyond the explicit turn-list passed in the prompt — each LLM call is stateless.
- Structured-output schema validation is Zod on the parsed JSON, not schema-constrained generation — a malformed response triggers retry, not guaranteed-structural-output.
- Cost metering is per-prompt-template-per-day, not per-clinician-per-encounter.
- Degraded-mode + recovery behaviour for model-host outages is not yet implemented (BUG-SCRIBE25-006).

## Comparison — LLM integration posture

| Dimension | Signacare | Epic (Cognome / MyChart AI) | Oracle Cerner (OCI + GenAI) | Best Practice (API wrapper model) |
|---|---|---|---|---|
| Self-hosted LLM option | ✅ Ollama default | ❌ Cloud-only | ❌ Cloud-only | ❌ Cloud-only |
| Tenant-residency guarantee | ✅ enforced at boot via `assertAiDataResidency` | ⚠️ Azure region selection | ⚠️ OCI region selection | ⚠️ depends on provider |
| **Model-router pattern (on-prem / AU-cloud opt-in / IRAP-PROTECTED flag)** | ✅ | ⚠️ region only | ⚠️ region only | ❌ |
| Every call audited to immutable store | ✅ `llm_interactions` | ⚠️ partial | ⚠️ partial | ❌ typically not |
| Hash-chain tamper-evidence | ⚠️ re-implementation pending (BUG-287) | ❌ | ❌ | ❌ |
| **Clinical-note signed-content hash + immutability trigger** (extends LLM-output tamper protection) | ✅ | ✅ | ✅ | ⚠️ |
| Prompt-template registry with test vectors | ✅ | ⚠️ vendor-curated | ⚠️ vendor-curated | ⚠️ application-level |
| Model-version lock in production | ✅ | ⚠️ | ⚠️ | ⚠️ |
| Disclaimer envelope on every output | ✅ CI-enforceable | ⚠️ UI-level | ⚠️ UI-level | ⚠️ application-level |
| **Non-diagnostic egress posture via responseGuard** | ✅ in code | ❌ | ❌ | ❌ |
| PHI redaction BEFORE LLM | ✅ | ⚠️ relies on provider content filter | ⚠️ relies on provider content filter | ⚠️ depends |
| Consent gate (per-patient, per-session) | ✅ | ⚠️ global opt-in | ⚠️ global opt-in | ⚠️ global opt-in |
| **Mid-stream consent revoke fail-closed + audio delete** | ✅ | ⚠️ | ⚠️ | ⚠️ |
| Break-glass annotation of LLM calls | ✅ | ❌ | ❌ | ❌ |
| Per-template cost + latency metrics | ✅ AppInsights | ✅ | ✅ | ✅ |

**Verdict:** Signacare's differentiators are (a) the self-host-first deployment model that lets a compliance-heavy tenant run inference entirely within their own VNet, (b) the `llm_interactions`-first auditability posture extended with clinical-note signature hash, (c) the single `llmService.ts` chokepoint that prevents bypass, (d) the May-2026 scribe-25 hardening (non-diagnostic egress posture + mid-stream consent revoke fail-closed) which exceeds typical vendor posture, (e) the model-router pattern that pins production to AU-region hosts with IRAP-PROTECTED option. The **gaps** are cost/performance at scale (local Ollama at 14B is capable but not GPT-4-class) and the fact that hash-chain tamper-evidence is re-queued (BUG-287) rather than currently active.

## Referenced files

- `apps/api/src/features/llm/llmService.ts` — single entry
- `apps/api/src/features/llm/llmRepository.ts` — `llm_interactions` writes
- `apps/api/src/features/llm/responseGuard.ts` — BUG-SCRIBE25-001 non-diagnostic egress posture
- `apps/api/src/mcp/ollamaModelRegistry.ts` — model-version lock
- `apps/api/src/shared/aiDataResidencyCheck.ts` — boot-time residency enforcement
- `docs/adr/ADR-0004-eop-content-redaction.md` — EoP redaction (ADHA conformance)
- `docs/gold-standard/ai-scribe.md` — the scribe pipeline built on this layer
