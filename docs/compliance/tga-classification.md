# TGA Classification Evidence — Signacare Scribe Pipeline

**Last reviewed:** 2026-04-19 (Audit Tier 5.12).
**Owner:** Clinical Safety + Regulatory.
**Status:** Non-inferential (TGA non-device).

## Purpose

Records the regulatory classification of each software component in
Signacare's AI scribe pipeline against the TGA *Regulation of
software-based medical devices* guidance (v1.3, Nov 2021; updates
through 2025) and the supplementary 2026 AI Software Guidance
position statement.

This document is the evidence artefact that accompanies a TGA
pre-market submission OR a self-declaration of non-device status.
It is updated whenever a scribe pipeline Pass is added / modified /
removed.

## Summary

| Pass | Function | Inferential? | Classification |
|------|----------|-------------|----------------|
| Pass 1 — Verbatim Extraction | Extract only what was explicitly said | No | Non-device |
| Pass 2 — Medication Verification | Match extracted medications against transcript | No | Non-device |
| Pass 3 — Structured Note Formatting | Lay out facts into SOAP / MSE / progress etc. | No | Non-device |

The pipeline, as currently shipped, is classified as **non-device**
under TGA guidance because every Pass operates on the clinician's
own spoken content and produces a document representation of that
content. No Pass infers, diagnoses, recommends treatment, or
generates new clinical content not present in the transcript.

## Pass 1 — Verbatim Extraction

**Function:** Parse the Whisper transcript, tag mental-state-examination
domains, extract structured facts (medications mentioned, risks
mentioned, observations reported).

**Non-inferential evidence:**
- System prompt (`SCRIBE_PASS1_SYSTEM` in `apps/api/src/mcp/medicalScribe.ts`)
  explicitly instructs:
  > "Extract ONLY information EXPLICITLY stated in the transcript.
  > ZERO fabrication tolerance."
- Every extracted fact is tagged `[HIGH] = Multiple supporting facts from
  transcript` / `[NOT ASSESSED] = No evidence in transcript`.
- Hallucination detector (`apps/api/src/mcp/detectScribeHallucinations.ts`)
  runs post-Pass-1 and rejects any fact not corroborated by the raw
  transcript.

**Regulatory position:** Pass 1 is a transcription + tagging tool. It
does not produce clinical interpretation. TGA non-device.

## Pass 2 — Medication Verification

**Function:** Take the list of medications mentioned in the transcript
(Pass 1 output) and verify that each medication name is present in
the transcript at the claimed dose/frequency.

**Non-inferential evidence:**
- Implementation in `verifyMedications` at
  `apps/api/src/mcp/medicalScribe.ts:160`. Pure pattern-matching
  against the transcript; no external LLM call.
- Outputs `{medications: VerifiedMedication[], alerts: SafetyAlert[]}`
  where every `alert` is triggered ONLY by pattern-match failure
  (e.g. "clinician said 'sertraline 200mg' but transcript contains
  '100mg'") — it does NOT flag dosing errors (e.g. "dose exceeds
  safe range") because that would cross into clinical inference.

**Regulatory position:** Pass 2 is verification of what was said, not
assessment of what should have been said. TGA non-device.

**If Pass 2 ever grows to detect dose-out-of-range or drug-interaction
alerts** — that would be clinical inference and would shift the
classification to TGA Class IIa medical device (software that
provides information to aid diagnosis / treatment). Such a split is
tracked as Tier 5.12b (deferred) with a feature-flag-gated
`ai-scribe-clinical-review` opt-in that would NOT ship to clinics
without conformance evidence.

## Pass 3 — Structured Note Formatting

**Function:** Given extracted facts from Pass 1 + verification from
Pass 2, format them into the chosen document template (SOAP / MSE /
progress / intake / ward round / review / collateral / phone).

**Non-inferential evidence:**
- System prompt (`SCRIBE_PASS3_SYSTEM`) instructs:
  > "Format into a MEDICAL-GRADE {FORMAT} note. DO NOT add any
  > clinical content not present in the extracted facts. If a
  > section has no evidence, write 'Not assessed'."
- Format templates in `medicalScribe.ts` (`SCRIBE_SOAP_FORMAT` etc.)
  are structural (headings + field order) — they do not prescribe
  clinical content.

**Regulatory position:** Pass 3 is a document formatter. TGA
non-device.

## Related Controls

- **Prompt-injection guard** — `apps/api/src/integrations/scribe/promptGuard.ts`
  blocks transcript lines that attempt to redirect the LLM away from
  non-inferential behaviour. See also `scripts/tests/scribe-red-team.ts`.
- **PHI redactor** — `apps/api/src/mcp/pii_redactor.ts` strips
  AU-format PHI (Medicare / IHI / DVA / phone / email / URL) from
  the transcript before Pass 1 ingest. Audit trail in
  `llm_interactions.metadata.redactions`.
- **Model-version lock** — `apps/api/src/mcp/ollamaModelRegistry.ts`
  stamps `metadata.modelVersion = <name>@<sha256>` on every
  interaction so the classification evidence above is traceable to
  a specific weights artefact.

## Review Cadence

This document is re-reviewed:

- On every change to `medicalScribe.ts` Pass 1/2/3 system prompts or
  format templates.
- On every new Pass added to `ambientProcessor.ts`.
- Annually by Clinical Safety + Regulatory regardless of changes.
- Whenever TGA issues a revision to the software-based medical device
  guidance.

Deviation from the non-inferential posture requires explicit sign-off
from Clinical Safety + Regulatory and either:
- A TGA pre-market submission for the newly-inferential Pass, OR
- A conformance declaration with published evidence.
