# 06 — AI Scribe

**Last refreshed:** 2026-05-29 (refresh — supersedes 2026-04-24 baseline; reflects May-2026 hardening: scribe-25 non-diagnostic posture, safety-plan collaboration attestation gate, consent revoke mid-stream fail-closed, AI-draft sign attestation safety-lock).

Signacare's AI Scribe is a 3-pass structured-note pipeline with clinical-safety rails that every competing product treats as optional. This document covers the architecture, the safety posture, the clinical integration, the May-2026 scribe-25 hardening, and ends with a competitive comparison against Nuance DAX, Abridge, Heidi, and Lyrebird.

## Architecture (3-pass pipeline)

Signacare does NOT send an uninterpreted transcript to a single LLM and publish the output. The pipeline is:

1. **Capture** — ambient audio or typed dictation → WebSocket → `apps/api/src/mcp/scribeStreaming.ts`. Consent is verified against the `scribe_consent` table on every connect. Access-token revocation re-checked on every frame boundary (BUG-356 wiring).
2. **Pass 1 — transcription + PII redaction.** Whisper produces the transcript; `pii_redactor.ts` scrubs before anything reaches the clinical LLM.
3. **Pass 2 — clinical structuring.** A structured-note-shape LLM prompt produces a JSON object matching the clinic's template. Ollama (local) for privacy-preserving deployment; optional gated cloud LLM per feature-flag.
4. **Pass 3 — clinical safety gate.** `scribeSafetyService.ts` runs deterministic checks: no new diagnosis claimed, no drug dose inferred, no clinical recommendation the transcript didn't contain. Any violation → AI-DRAFT envelope + clinician-review-required banner. Non-inferential by design (TGA classification evidence in `docs/compliance/tga-classification.md`).

See `apps/api/src/mcp/medicalScribe.ts` + `scribeRoutes.ts` for the wire.

## May-2026 scribe-25 hardening

The "scribe-25" track is the May-2026 cluster that closes the deepest clinical-safety gaps in the AI surface:

- **BUG-SCRIBE25-001 — Non-diagnostic risk-surfacing posture at AI egress.** Guard-level qualifier injection + labels at AI egress so the model output cannot make a diagnostic claim that wasn't qualified. `responseGuard.ts` + `responseGuard.test.ts` cover diagnosis / summary / agent paths. Status: ✅ in code; staging/UAT verification + governance sign-off remaining.
- **BUG-SCRIBE25-002 — Safety-plan collaboration attestation gate.** Two-clinician sign requirement on safety-plan create/activate/sign with audit writes (`SAFETY_PLAN_COLLAB_ATTESTATION_REQUIRED`). `bugScribe25SafetyPlanAttestation.int.test.ts` covers the role matrix. Status: ✅ in code; staging role-matrix/UAT replay remaining.
- **BUG-WF51-ATTESTATION-BYPASS — AI-draft sign attestation safety-locked.** No runtime bypass flag path across API + web utility guards. Status: ✅ fixed; `bug417AiDraftSignAttestation.int.test.ts` + `aiDraftSignAttestation.test.ts`.
- **BUG-WF51-CONSENT-REVOKE-RACE — Mid-stream consent revoke fail-closed.** `/llm/ambient-note` re-checks consent at post-upload + post-processing checkpoints; fails closed; best-effort deletes uploaded audio when consent becomes inactive. Status: ✅ fixed; `ambientNoteConsentGate.int.test.ts`.

Open scribe-25 items (S1, not yet in flight):

- **BUG-SCRIBE25-003** — shared lineage keying so in-visit and post-sign proposal flows cannot double-materialise clinically equivalent drafts.
- **BUG-SCRIBE25-004** — lock `mse_structured` contract (flat-column vs JSONB + citation cardinality) before migration/build.
- **BUG-SCRIBE25-005** — role-authorisation + immutable chain-of-custody controls for 291/court-report medico-legal output lifecycle.
- **BUG-SCRIBE25-006** — degraded-mode + recovery behaviour for scribe interruptions/model-host outages.

## Clinical integration

- Every output lands as an **AI-DRAFT note** that the clinician must sign. Signing writes an immutable `clinical_note_versions` row (append-only per §4). Signed notes now carry a content-hash (BUG-ARCH-CLINICAL-NOTE-SIGNATURE-HASH) with an immutability trigger so DB-write tampering is detected (AHPRA Standard 6).
- The generating prompt + model version + redaction report are stored in `llm_interactions` (immutable, chain-hashable per BUG-287).
- Break-glass path: if the scribe is disabled for a patient (e.g. consent revoked mid-session), partial output is discarded and the consent-revocation event is audited.

## Safety posture

- **Non-inferential rule** — the model is prompted to transcribe + structure, never to infer new clinical facts. Any inference surfaced in the output is flagged by Pass 3 and the note is blocked.
- **Non-diagnostic egress posture** — separate guard layer at the AI egress (BUG-SCRIBE25-001) ensures diagnosis-shaped output is qualified or rejected, regardless of what slipped through Pass 3.
- **PHI isolation** — transcripts never leave the tenant. Ollama runs in the same VNet. If cloud LLM is enabled, it's via `assertAiDataResidency` boot check pinning to an AU region.
- **Disclaimer envelope** — every AI-generated field is wrapped in `{ value, aiDraft: true, confidence, sourceSpan }` so the UI renders the provenance chip.
- **Consent gate** — `recording_consent` must be `granted` AND unexpired for the patient AND the session. Re-checked mid-stream (BUG-WF51-CONSENT-REVOKE-RACE).
- **Audit trail** — every field of every AI note carries its generating transcript span + prompt hash. Forensic replay is exact.
- **Attestation safety-lock** — clinician sign-attestation has no runtime bypass flag (BUG-WF51-ATTESTATION-BYPASS).

## Limitations (honest)

- Quality degrades on accented speech if Whisper small/medium is used; large-v3 mitigates but costs latency.
- Multi-speaker diarisation is heuristic (prompt-guided), not a dedicated diariser.
- Structured output is template-coupled — changing the note template requires re-prompting; there's no zero-shot schema migration.
- Local-only LLM means model size is bounded by VRAM; 14B Qwen is the current ceiling on staging GPU.
- Degraded-mode behaviour for model-host outages is not yet implemented (BUG-SCRIBE25-006).
- Lineage keying for in-visit vs post-sign proposal flows is not yet implemented (BUG-SCRIBE25-003).

## Comparison — AI Scribe competitive landscape

| Dimension | Signacare | Nuance DAX | Abridge | Heidi | Lyrebird |
|---|---|---|---|---|---|
| Deployment model | Self-hosted (Ollama) OR gated-cloud | Cloud (MS/Azure) | Cloud (US) | Cloud (AU + overseas regions) | Cloud (AU) |
| Data residency | Full tenant-residency (AU / self-host) | US / EU / AU regions | US | AU | AU |
| **`assertAiDataResidency` boot check (production)** | ✅ unique | ❌ | ❌ | ❌ | ❌ |
| Non-inferential pipeline | ✅ explicit Pass 3 safety gate | ⚠️ inference-inclusive | ⚠️ inference-inclusive | ⚠️ inference-inclusive | ⚠️ inference-inclusive |
| **Non-diagnostic egress posture (BUG-SCRIBE25-001)** | ✅ in code | ❌ | ❌ | ❌ | ❌ |
| PHI redaction before LLM | ✅ Pass 1 `pii_redactor.ts` | ⚠️ relies on Azure OpenAI content filter | ⚠️ limited | ⚠️ limited | ⚠️ limited |
| Transparent prompt + output audit | ✅ `llm_interactions` table, hash-chainable | ❌ opaque | ❌ opaque | ⚠️ partial | ⚠️ partial |
| AI-DRAFT envelope + clinician sign | ✅ every field marked `aiDraft` until signed | ⚠️ banner only | ⚠️ banner only | ⚠️ banner only | ⚠️ banner only |
| **AI-draft sign attestation safety-locked (no runtime bypass)** | ✅ | ⚠️ | ⚠️ | ⚠️ | ⚠️ |
| **Safety-plan collaboration attestation gate** | ✅ | ⚠️ template-only | ⚠️ template-only | ⚠️ template-only | ⚠️ template-only |
| **Consent revoke mid-stream fail-closed (with audio delete)** | ✅ | ⚠️ | ⚠️ | ⚠️ | ⚠️ |
| **Clinical-note signed-content hash + immutability trigger** | ✅ | ✅ | ✅ | ⚠️ | ⚠️ |
| Real-time pause / resume mid-encounter | ✅ | ✅ | ✅ | ✅ | ✅ |
| Template-aware structured output | ✅ clinic-customisable templates | ⚠️ specialty pre-sets | ⚠️ specialty pre-sets | ⚠️ specialty pre-sets | ⚠️ specialty pre-sets |
| Multi-specialty support (MH, GP, EM, paeds, surg, etc.) | ✅ shared chassis, 6 specialties today | ✅ many specialties, US-centric | ✅ many specialties, US-centric | ✅ many specialties | ✅ many specialties |
| Mental-health-aware prompting (suicide risk, MSE, MHA capacity) | ✅ | ⚠️ generic | ⚠️ generic | ⚠️ generic | ⚠️ generic |
| **PHQ-9 Q9 / total ≥20 server-authoritative suicide-risk escalation** | ✅ | ⚠️ vendor-config | ⚠️ vendor-config | ⚠️ vendor-config | ⚠️ vendor-config |
| Pricing model | Per-tenant flat fee + self-host option | Per-clinician per-month | Per-clinician per-month | Per-clinician per-month | Per-clinician per-month |
| TGA / MDSAP classification posture | ✅ documented non-inferential claim | N/A (US-first) | N/A (US-first) | ⚠️ product-level claim | ⚠️ product-level claim |

**Verdict:** On the core product feature (structured-note generation) Signacare is parity-class with the best competitors. The **differentiators** are (a) full tenant-residency via self-hosted Ollama with no cloud hop, (b) the Pass-3 non-inferential safety gate plus **scribe-25 non-diagnostic egress posture** + immutable `llm_interactions` audit, (c) mental-health-specific prompting (suicide-risk, MSE structure, MHA capacity assessment terminology) built in, (d) **AI-draft sign attestation safety-lock**, **safety-plan collaboration attestation**, and **mid-stream consent revoke fail-closed** — each of which exceeds typical vendor banner-only / template-only patterns. The **gaps** vs best-of-breed competitors are diarisation quality, multi-speaker turn accuracy, and accent robustness — each improvable with better Whisper model selection and/or dedicated diariser integration.

## Referenced files

- `apps/api/src/mcp/scribeStreaming.ts` — WebSocket ingest
- `apps/api/src/mcp/medicalScribe.ts` — 3-pass orchestration
- `apps/api/src/mcp/pii_redactor.ts` — PHI scrub
- `apps/api/src/features/llm/scribeSafetyService.ts` — non-inferential gate
- `apps/api/src/features/llm/scribeRoutes.ts` — HTTP control plane
- `apps/api/src/features/llm/responseGuard.ts` — BUG-SCRIBE25-001 non-diagnostic egress posture
- `apps/api/src/features/safety-plan/` — BUG-SCRIBE25-002 collaboration attestation gate
- `docs/compliance/tga-classification.md` — regulatory posture
