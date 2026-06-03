# Tier 14 — R&D spike register

Spikes are **deferred for a structural reason**, not because of effort
or timeline. Each row below names the reason, the exit criteria the
spike has to meet before implementation begins, and the pre-registered
feature flag that gates the code path.

These are NOT backlog TODOs. A spike lands only when its exit criteria
are met — the feature flag flip is the last step, not the first.

---

## Flag-gated spikes

All flags are seeded DISABLED by migration
`apps/api/migrations/20260701000022_tier14_spike_flags.ts`. Enabling a
flag without meeting the exit criteria below is a merge-gate
violation — reviewers MUST cite the met criterion in the PR.

### 14.1 `scribe-multimodal-vision`

**What:** multimodal (image + audio) scribe input — photograph a
paper observation chart, whiteboard handover notes, or a prescription
image and have the scribe pipeline OCR + merge it into the
transcript.

**Why deferred:** no vetted multimodal LLM deployment strategy. The
known good options (Claude multimodal, Qwen-VL, LLaVA) all require
local GPU VRAM budgets we haven't scoped, and the local-only
deployment constraint (CLAUDE.md §6.2 — no PHI leaves the cluster)
rules out cloud multimodal unless we add enterprise agreements.

**Exit criteria before implementation:**
1. Infrastructure review selects the serving model + VRAM envelope.
2. TGA classification update: multimodal input may reclassify the
   scribe surface from non-device. Legal + regulatory sign-off.
3. Integration test with at least 20 real-world observation chart
   photos reaches ≥95% field-level accuracy on vital signs.

**Owner:** infrastructure lead + clinical-safety lead.

---

### 14.2 `scribe-agentic-workflows`

**What:** autonomous scribe-to-EHR writes via Anthropic MCP + tool-use
— scribe identifies an action item, calls the `tasks.create` /
`medications.prescribe` / `referrals.create` tool directly rather
than surfacing it as a pending_review row for the clinician.

**Why deferred:** the Tier 13.2 action-items surface was a deliberate
design choice — a clinician must explicitly accept every downstream
row. Moving to autonomous writes requires:

1. MCP protocol + tool-use spec to stabilise at Anthropic + any
   models we're locally hosting. The pre-Opus-4 tool-use semantics
   were still evolving; Opus 4.7 (Jan 2026) is the first stable
   surface.
2. Clinical-safety review of which EHR operations are acceptable
   autonomous candidates. "Create a draft task for the clinician"
   might pass; "prescribe a medication" will not.
3. Audit-trail shape — autonomous actions need a different audit
   actor model (`actor_type: 'agent'` with a linked `agent_policy_id`)
   that the current `audit_log` schema doesn't express.

**Exit criteria:**
1. MCP spec locked at the deployed Claude model version.
2. Clinical Safety Committee approves a **restricted** initial tool
   whitelist (e.g. "create draft letter", "suggest ICD-10-AM code",
   "propose MBS item").
3. Audit-log schema extended with `actor_type` + `agent_policy_id`.

**Owner:** AI lead + clinical-safety lead.

---

### 14.3 `scribe-audio-fingerprint-consent`

**What:** voice-biometric fingerprint of the patient spoken at
session start ("I, [name], consent to this session being recorded
for clinical documentation purposes") as an additional consent
artefact alongside the signature / attestation flow from Tier 4.3.

**Why deferred:** voice biometrics are sensitive data under the
Australian Privacy Act's definition of "sensitive information" and
trigger a different consent chain (explicit purpose limitation,
separate opt-in, right-to-delete across retained voiceprints).

**Exit criteria:**
1. Ethics Committee formal review of the biometric consent shape.
2. Privacy-by-design threat model (STRIDE) completed with DPO
   sign-off.
3. Storage + deletion contract: voice fingerprints MUST be
   separable-delete from the audio retention store.

**Owner:** DPO + clinical-safety lead.

---

### 14.4 `scribe-patient-redaction`

**What:** NLP-based redaction of third-party names / NHIs / phone
numbers in scribe transcripts before they're used for non-clinical
purposes (training set, de-identified research corpus, quality
improvement reports).

**Why deferred:** redaction policy is clinical, not technical. The
policy has to answer — per Tier 19.1's PHI scrubber discussion — how
it treats:

- Third-party names mentioned in a DV disclosure (redact? preserve
  with pseudonym?).
- Clinician names (preserve — they're not PHI of the patient).
- Treating-team references to a patient by first name only.
- Child-protection disclosures naming a named third party.

The Tier 13 sensitive-topic detector is pattern-match only and is
explicitly NOT a redactor. Redaction is the next logical step but
requires a written policy.

**Exit criteria:**
1. Clinical redaction policy document (under
   `docs/policies/scribe-redaction.md`) approved by clinical-safety
   + DPO + legal.
2. Evaluation corpus: ≥200 labelled transcripts from at least 3
   clinical contexts (psych, DV, CAMHS) with expected redaction
   output.
3. Redaction precision ≥95% on third-party names, ≥99% on NHIs,
   ≥99% on phone numbers, measured on the evaluation corpus.

**Owner:** DPO + clinical-safety lead + ML lead.

---

## Non-flag-gated deferrals

Spikes that don't have a flag because they don't yet have a concrete
feature surface:

### 14.5 Per-state MHA form generators

Deferred to Tier 17 (Letter Phase 3) per the audit plan.

### 14.6 Federated learning across clinics

Requires contracts + clinical governance model — not on the
engineering roadmap yet.

### 14.7 Real-time clinical decision support during scribe

Requires the Tier 19 training-data pipeline (R-FIX-TRAINING-PIPELINE)
to produce a fine-tuned decision-support model. Blocked on Tier 19.

---

## Review cadence

Every four weeks, this file is re-read and each row re-assessed:

- Did the exit criteria move?
- Does the spike still make sense?
- Is any row obsolete (requirement changed, scope descoped)?

Obsolete rows are **removed**, not archived. Live rows with unmet
criteria stay disabled and keep their flag in-place (verified by
R-FIX-TIER-14-SPIKE-FLAGS).
