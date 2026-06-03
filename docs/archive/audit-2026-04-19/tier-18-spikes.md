# Tier 18 — letter / scribe R&D spike register

Companion to `tier-14-spikes.md`. Tier 18 covers the **letter-tier**
spikes: collaboration, multi-signature, agentic sequencing, live
patient-attended redaction. Same ground rules: each deferral is
structural, each has exit criteria, each has a pre-registered feature
flag.

---

## 18.1 `letters-concurrent-collaboration`

**What:** two clinicians editing the same letter concurrently with
operational-transform or CRDT merge. Useful when a registrar drafts
and a consultant reviews without locking the other out.

**Why deferred:**
1. CRDT library choice (Yjs, Automerge) + hosting model not scoped.
2. Merge conflict UX needs design review — clinicians resolving
   overlapping edits on a medico-legal document cannot be allowed to
   silently clobber each other.
3. The Tier 15 state machine is sequential (draft → in_review →
   approved). A concurrent model requires re-thinking the
   approved-by / reviewer-by audit trail.

**Exit criteria:**
1. Design spec + mock conflict-resolution UI signed off.
2. CRDT library choice + hosting model documented (local vs hosted
   sync server).
3. Audit-log schema extended so collaborative edits preserve
   attribution per-character.

---

## 18.2 `letters-multi-signature`

**What:** multi-party signing chain — e.g. treating clinician +
consultant + approving supervisor each cryptographically sign a
letter before it can be sent. Required for specialist-trainee
sign-off under some college rules + for some medico-legal reports.

**Why deferred:**
1. Cryptographic signing chain (PKI vs KMS-backed HSM) needs
   infrastructure design.
2. Revocation flow — if a signer is later struck off, what happens
   to their prior signatures?
3. Legal review: does a co-signed report require ALL signers or is
   a last-signer-wins model acceptable?

**Exit criteria:**
1. Legal opinion on multi-sig semantics.
2. Signing infrastructure scoped (HSM or KMS).
3. Revocation flow designed + audit-log schema extended.

---

## 18.3 `scribe-agentic-sequencing`

**What:** scribe auto-sequences downstream EHR writes — accept the
action items from Tier 13 in ONE step and the agent handles
referral + letter + task + follow-up creation in sequence.

**Why deferred:** gated on the same preconditions as
`scribe-agentic-workflows` (Tier 14.2). MCP stabilisation,
clinical-safety review of autonomous write scope, audit-log schema
extension for agent actors.

**Exit criteria:** see Tier 14.2. When `scribe-agentic-workflows`
lands, this flag is the sequencing layer on top.

---

## 18.4 `scribe-patient-attended-redaction`

**What:** while the patient watches the transcript in real-time,
they can tap a phrase to redact it from the record (e.g. "don't
record my sister's name"). The clinician must approve.

**Why deferred:**
1. UX research: does showing a live transcript help or harm
   clinical rapport?
2. Clinical-safety review: can patient-initiated redaction be
   misused to hide disclosures that are legally required (mandatory
   reporting of child abuse)?
3. Legal: conflict with mandatory reporting obligations in some
   jurisdictions.

**Exit criteria:**
1. UX research report on live-transcript impact on rapport.
2. Clinical-safety review with policy for mandatory-reporting
   exceptions.
3. Legal opinion in all 8 Australian jurisdictions.

---

## Review cadence

Every 4 weeks — same as Tier 14. Obsolete rows are **removed**, not
archived. Fix-registry rows `R-FIX-TIER-18-SPIKE-FLAGS` +
`R-FIX-TIER-18-SPIKE-DOCS` prevent silent removal.
