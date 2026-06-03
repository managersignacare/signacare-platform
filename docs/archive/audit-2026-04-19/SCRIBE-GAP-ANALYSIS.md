# Signacare AI Scribe — Feature-Gap Analysis + Build Plan

**Date:** 2026-04-19
**Inputs:**
- Medical AI scribe research (10 products, 2025-2026): `/tmp/signacare-audit/research-medical-ai-scribe.md`
- Non-medical AI scribe research (10 products): `/tmp/signacare-audit/research-nonmedical-ai-scribe.md`
- Signacare scribe state inventory: `/tmp/signacare-audit/research-signacare-scribe-state.md`
- Audit findings register: `docs/audit-2026-04-19/FINDINGS.md`

**Method:** Compared Signacare current state against 10 medical + 10 non-medical scribe products, cross-referenced with the existing audit register, prioritised by clinical-safety risk + Australian regulatory fit.

---

## WHAT SIGNACARE ALREADY HAS (strengths — do not rebuild)

| Feature | Evidence | Parity vs market |
|---|---|---|
| Local-only LLM (Ollama) | `localLlmAgent.ts` | ✓ matches Heidi/Lyrebird privacy posture; stronger than cloud-only (DAX/Abridge) |
| 3-pass safety pipeline (verbatim → verify → format) | `medicalScribe.ts` | ✓ Abridge-class hallucination defence |
| Specialty prompts (psychiatry, child, aged, forensic, substance, perinatal) | `scribeSpecialties.ts` | ✓ mental-health niche coverage stronger than DAX/Abridge (general) |
| Training-data feedback loop with llm_interactions JOIN | `trainingPipeline.ts` (rewritten 908c13e) | ✓ parity with Suki/DeepScribe |
| Prompt-injection guard (14 OWASP LLM01 patterns) | `integrations/scribe/promptGuard.ts` | ✓ stronger than non-medical market (Grain/Gong don't publish patterns) |
| Australian MBS + ICD-10-AM coding | `scribeEnhancements.ts` | ✓ parity with Smart Scribe/Heidi |
| After-visit patient summary (Grade 6) | `scribeEnhancements.ts` | ✓ parity with Nuance/Abridge/Suki |
| Referral letter draft (GP/specialist/service) | `scribeEnhancements.ts` | ✓ parity with Suki/Freed/Medwriter |
| RAG context per patient | `aiEnhancer.ts` | ✓ parity with Abridge contextual reasoning |
| Outcome-measure extraction (PHQ-9, GAD-7, K10, HoNOS) | `scribeEnhancements.ts` | 🏆 NOT in any competitor — Signacare unique |

**Signacare is already competitive at the core-pipeline layer** — the gaps are almost entirely in consent, transparency, governance, and UX safety.

---

## GAPS vs MARKET — 32 features mapped by severity

Each gap already has a finding in `FINDINGS.md`; the ID in brackets links back.

### Tier A — CRITICAL (clinical safety + compliance blockers)

| # | Gap | What market leaders do | Signacare status | Source finding |
|---|---|---|---|---|
| A1 | **Patient consent capture linked to encounter** | Nuance/Abridge/Heidi: mandatory consent dialog + audit trail + audio-delete-policy disclosure | UI checkbox not linked to session; no `consentId` on StreamingSession | CRIT-G1 |
| A2 | **Recording active indicator (visual + audio + timer)** | All leaders: red indicator, audio cue, elapsed-time display | Missing | HIGH-G3 |
| A3 | **Model version locked + checkpoint hash per doc** | DAX + Abridge + Suki: version tracked per doc; change-log; upgrade approval workflow | `llm_interactions.model_name` = free text; no hash; no approval gate | CRIT-G3 |
| A4 | ~~**Sensitive-data gating for letter generator**~~ | ~~Suki/Abridge: HIV/substance/MH excluded by default~~ | **REVERSED by user direction 2026-04-19** — do not restrict or exclude HIV/substance/MH from letter generation. Clinician decides what to retain in drafted letter before signing. CRIT-G2 is reversed; no commit for this item. | REVERSED |
| A5 | **AI feature kill switch** | Teams/Zoom/Gong: tenant-level feature flags; admin disable in seconds | No `clinic_feature_flags` table | HIGH-G2 |
| A6 | **Data residency enforcement** | Heidi/Lyrebird/Teams EU: boot-time validation forbids offshore endpoints | `WHISPER_API_URL` defaults to `localhost:8080`; no validator | HIGH-G4 |
| A7 | **Cross-clinician review-and-adopt workflow** | DAX/Abridge: `reviewed_and_adopted_by` field + UI confirmation | Not tracked | HIGH-G1 |
| A8 | **Australian TGA non-device classification evidence** | Heidi/Lyrebird: summaries only, no interpretation, TGA non-device status documented | Signacare pipeline currently summarises → Pass 2 "safety verification" may cross into interpretation → TGA classification risk | NEW |

### Tier B — HIGH (UX + governance safety)

| # | Gap | Market pattern | Signacare status |
|---|---|---|---|
| B1 | **[AI-DRAFT] prominent banner + signed-immutable history** | DAX/Abridge: banner persistent until signed | `is_ai_draft` column unused in UI | MED-G1 |
| B2 | **Letter template table + version history** | Nuance/Suki/Abridge: templates in DB + admin-only edit | Hardcoded strings | MED-G2 |
| B3 | **AI Chat verify disclaimer + prescribing classifier** | DAX Copilot: scope rail + disclaimer | No classifier; no disclaimer | HIGH-G5 + MED-G3 |
| B4 | **Adversarial prompt red-team test suite** | NHS guidance 2025: red-team required | No test suite | NEW |
| B5 | **Patient-viewable transcript + post-visit summary workflow** | Abridge/Nuance/Suki: patient portal surface | Post-visit summary endpoint exists; no patient-facing delivery | PARTIAL |
| B6 | **Family / interpreter / carer role labels in diarisation** | Otter/Grain + medical leaders: role labels | Diarisation captures speakers but no role map | NEW |
| B7 | **Custom clinical vocabulary (drug names, allergies, protocols)** | Azure Custom Vocab / Abridge / Suki | Whisper base model only; no custom vocab | NEW |
| B8 | **Scribe on Sara (mobile clinical app)** | Heidi/Lyrebird/Freed have native mobile scribe | No Sara scribe UI (backend endpoints ready) | HIGH-J4 |
| B9 | **Offline-first mobile scribe queue** | Heidi offline-first; Granola pattern (local audio) | Sara has no scribe; Viva vitals silent-fail | HIGH-J3 |
| B10 | **Real-time PII redaction of PHI in transcripts** | Dialpad 2025 pilot; Teams Copilot EU residency | No real-time redaction | NEW |

### Tier C — MEDIUM (differentiation + polish)

| # | Gap | Market pattern | Signacare opportunity |
|---|---|---|---|
| C1 | Patient-facing after-visit summary push | Abridge: portal delivery | Already drafted server-side — wire to Viva |
| C2 | Prior-authorisation auto-draft | Abridge/Availity (Jan 2026) | Build for Medicare/ECLIPSE (overlaps with Tier 8 integrations) |
| C3 | Cross-encounter semantic search | Read AI Search Copilot | Index existing notes via pgvector (evidenceClient already has pgvector scaffold) |
| C4 | Pre-consult briefing (auto-pull meds + labs + prior visit) | Teams Copilot; Ambience | Adjacent feature — builds on `aiEnhancer.ts` RAG context |
| C5 | Action-item → EHR task (follow-up, referral, med-rec) | Gong/Zoom Tasks | Structured output parse → auto-create tasks / referrals |
| C6 | Talk-time ratios + shared-decision-making metrics | Grain (sales coaching) | Clinical variant: clinician:patient:family ratio feedback |
| C7 | Sensitive-topic real-time alerts (suicide/abuse/substance) | Gong custom trackers | Classifier on transcript → nurse/psych alert + link to safety-plan |
| C8 | Nursing documentation scribe variant | DAX Copilot for Nurses (late 2025) | Specialty prompt for nurse tasks — smaller lift given existing architecture |
| C9 | Multimodal vision (smart glasses / camera) | Ray-Ban Meta + Gemini (98% med-history accuracy) | Long-horizon (phase 3+) |
| C10 | Agentic follow-up workflows (auto-schedule / order) | Gong Mission Andromeda | Long-horizon after MCP tool registry matures |

### Tier D — LOW (market parity polish)

| # | Gap | Market pattern | Signacare fix scope |
|---|---|---|---|
| D1 | Configurable audio retention policy (admin) | Teams per-org; Heidi immediate-delete default | Power Setting toggle |
| D2 | Patient-controlled post-visit redaction request | NOT available anywhere (innovation) | Patient portal feature |
| D3 | Audio-fingerprint consent receipt | Not in market | Innovation opportunity (blockchain-signed) |
| D4 | Pause/resume mid-session | Heidi supports; Lyrebird WIP | Client-side extension |
| D5 | Whisper mode (low-volume dictation) | Freed/Suki | Client-side prompt |
| D6 | Patient opt-out list (persistent refusal captured) | Heidi | `patient_flags` category='no_ai_scribe' |
| D7 | Accent/language learning feedback loop | None in medical | Add to `ai_training_feedback` |
| D8 | Export to DOCX/PDF/Markdown | All leaders | Server-side render |
| D9 | Search across own notes | Read AI search | Wire pgvector over own notes |
| D10 | Admin impersonation for audit review | Teams/Gong | Governance console |

---

## BUILD PLAN — 4 phases, 10 new tiers (inserted into audit-remediation plan)

The gaps cluster into 4 phases. **Phase 1 overlaps existing audit Tier 4 + Tier 5** — so the plan below EXTENDS the existing `sleepy-roaming-meteor.md` rather than replacing it. Each phase ships independently behind a release tag.

### Phase 1 — Core safety (blocks next production tag)
Covered by existing audit remediation Tiers 4 + 5 (scribe consent dual-mode, recording indicator, model-version lock, kill switch, data residency, chat classifier, AI-draft banner, letter gating, cross-clinician review, training export gate).

Adds from this research:
- **New T5.10** — Adversarial red-team test suite (NHS 2025 guidance) — `scripts/tests/scribe-red-team.ts` with 20 injection prompts + assertion that every one triggers `promptGuard` or structured refusal. Add to CI. ~4h.
- **New T5.11** — Real-time PHI redaction pass — before LLM receives transcript, strip AU Medicare/IHI/DVA numbers + phone/email via regex + named-entity recognition. `apps/api/src/mcp/pii_redactor.ts`, unit tests with 30 AU-format fixtures. ~1 day.
- **New T5.12** — TGA non-device classification evidence — document the 3-pass pipeline's Pass 2 ("safety verification") output to confirm it is MATCHING spoken content (not INFERRING new clinical content). If Pass 2 infers, split it into two sub-passes: verification (non-inferential) vs optional clinical review (separate, opt-in, TGA-device-bound). ~6h.

### Phase 2 — UX + governance (v1.4.0)
After core safety lands.

- **T12.1** — `[AI-DRAFT] Pending review` banner across web + Sara + Viva. Signed notes preserve `is_ai_draft=true` for audit but banner hides once `signed_at IS NOT NULL`. ~4h.
- **T12.2** — Letter templates in DB (`letter_templates` table). Version history. Admin-only edit. Migrate 8 current hardcoded templates as seed rows. ~1 day.
- **T12.3** — Sara scribe UI parity with Web (MobileScribePage pattern ported to Flutter). Offline audio buffer using path_provider; flush-on-reconnect queue (same pattern as Viva offline vitals queue in Tier 4.1). ~3 days.
- **T12.4** — Role labels in diarisation (patient, family, interpreter, clinician, nurse, scribe). Client-side UI to tag each speaker stream; server stores under `llm_interactions.metadata.speakerRoles`. ~1 day.
- **T12.5** — Custom clinical vocabulary — `clinic_scribe_vocabulary` table (drug_brand, drug_generic, allergen_common_au, protocol_name). Passed to Whisper as `initial_prompt`. Admin editable in Power Settings. ~2 days.
- **T12.6** — Patient-viewable after-visit summary push — wire existing `/scribe/patient-summary` endpoint to Viva delivery inbox (existing messaging infra). ~6h.
- **T12.7** — Pre-consult briefing (auto-pull meds + active problems + last-visit SOAP) into RAG context on scribe start. Extend `aiEnhancer.ts`. ~1 day.

### Phase 3 — Differentiation (v1.5.0)

- **T13.1** — Sensitive-topic real-time alerts — classifier runs on streaming transcript chunks; keywords + local LLM dual-mode (same pattern as Tier 5.3 AI Chat classifier). Hit → toast to nurse/duty-clinician + link to patient safety-plan. ~3 days.
- **T13.2** — Action-item → EHR task/referral/order extraction. Structured output from Pass 3 parsed into `tasks`/`referrals`/`prescription_drafts` inserts (as drafts — clinician reviews and signs). ~3 days.
- **T13.3** — Cross-encounter semantic search over clinician's own notes using existing pgvector scaffold in `evidenceClient`. Use case: "all mentions of lithium side effects for patient X". ~2 days.
- **T13.4** — Talk-time ratio feedback (clinician:patient talk-time; shared-decision-making signals). Post-session optional summary card. ~2 days.
- **T13.5** — Nursing documentation scribe variant — new specialty prompt in `scribeSpecialties.ts`; separate `NURSING` document type; MBS/PBS-aware. ~1 day.
- **T13.6** — Prior-authorisation auto-draft (from signed note → PA form). Deferred if Tier 8 Medicare integration not yet live. ~2 days (behind flag).

### Phase 4 — Innovation (v1.6.0+)

- **T14.1** — Multimodal vision scribe (phone camera / smart-glasses stream). Explore Gemini Vision + Ray-Ban Meta integration patterns. ~2-week spike. Defer pending user interest.
- **T14.2** — Agentic follow-up workflows (MCP tool registry → structured orders → auto-referral, auto-schedule). ~2-week spike. Requires Tier 8 completions.
- **T14.3** — Audio-fingerprint consent receipt (blockchain-signed, for two-party consent evidentiary strength). ~1 week. Novel in market.
- **T14.4** — Patient-controlled post-visit redaction request (patient requests specific sentence be marked sensitive; clinician reviews; if accepted, masked in letter generation). ~1 week. Novel in market.

---

## ESTIMATED EFFORT

| Phase | Scope | Days | Release |
|---|---|---|---|
| 1 | Core safety (existing audit Tier 4+5 + T5.10-12) | Already planned: 7 days audit + 2 days additions = 9 days | v1.2.0 |
| 2 | UX + governance | 8 days | v1.4.0 |
| 3 | Differentiation | 13 days | v1.5.0 |
| 4 | Innovation | Deferred (spike) | v1.6.0+ |

Total net-new work to add to existing audit-remediation plan: **~21 days across Phases 2 + 3**. Phase 1 additions are ~2 extra days on top of what was already planned.

---

## RECOMMENDED IMMEDIATE ACTIONS

1. **Execute audit-remediation Tier 1 + Tier 2** (production blockers; v1.1.1). No scribe-specific work beyond Bug 2 Viva activation.
2. **Execute Tier 4 + Tier 5** (audit remediation) which already cover scribe consent dual-mode, recording indicator, model-version lock, kill switch, data residency, AI chat classifier, AI-draft banner, letter sensitive-data gating, cross-clinician review. **Add new T5.10 (red-team suite), T5.11 (PHI redaction), T5.12 (TGA evidence)** — 2 extra days.
3. **Proceed to Phase 2 (new T12.x)** after v1.2.0 tag — 8 days, covers Sara parity + templates + role labels + vocabulary.
4. **Phase 3 + 4 scoped as separate planning cycles.**

Phases 2, 3, 4 will be appended to the existing plan file once Tier 1-11 of audit-remediation complete.

---

## EVIDENCE SOURCES

- Medical AI scribe research report: `/tmp/signacare-audit/research-medical-ai-scribe.md`
- Non-medical research report: `/tmp/signacare-audit/research-nonmedical-ai-scribe.md`
- Signacare state inventory: `/tmp/signacare-audit/research-signacare-scribe-state.md`
- Audit findings: `docs/audit-2026-04-19/FINDINGS.md`

All claims in this gap analysis trace to one of these files (or are marked NEW where they extend beyond the current audit scope).
