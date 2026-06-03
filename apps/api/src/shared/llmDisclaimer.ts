// apps/api/src/shared/llmDisclaimer.ts
//
// BUG-038 — canonical clinical-AI disclaimer string.
//
// Every LLM response handler that returns AI-generated clinical content
// (letters, summaries, handovers, discharge plans, formulations, etc.)
// MUST embed this string in the response envelope as a `disclaimer` field
// so downstream UIs + forensic auditors can reliably distinguish AI output
// from clinician-authored content.
//
// Relevant TGA classification: Signacare's scribe + clinical-AI pipeline
// is classified as non-device under AU regulatory guidance on the basis
// that outputs are non-authoritative drafts requiring clinician review.
// The disclaimer is the response-body evidence that the server has
// informed the client of that classification.
//
// Source of truth: this file. Inline literals are forbidden — import the
// constant. See BUG-285 (planned CI guard) for mechanical enforcement.

export const CLINICAL_AI_DISCLAIMER =
  'AI-generated — verify against current clinical guidelines before acting';
