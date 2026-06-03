# ADR-0004: Electronic EoP (Evidence of Prescription) content redaction

## Status
Proposed (tracked in sleepy-roaming-meteor plan PART 7e P1; not yet shipped).

## Context

ADHA's electronic Prescribing CTS v3.0.4 (DH-3945 §5) specifies that the electronic Evidence of Prescription (EoP) delivered to the patient's token MUST contain ONLY the prescription token, DSPID, and SCID. The prescriber's identifying details, the patient's demographic details, the dose/direction, and the reason for prescribing are ALL forbidden on the EoP path — they belong on the NPDS-submission channel where pharmacists retrieve the full clinical XML after token redemption.

Signacare's `buildFullPrescriptionXml` (at `apps/api/src/integrations/escript/erxRestPayloads.ts:246-319`) currently emits ONE XML that includes every clinical field and uses it for BOTH the NPDS submit AND the electronic EoP delivery. Every electronic prescription is CTS-non-compliant on the EoP path. This is an ADHA conformance blocker; any assessment submission would fail on this point alone.

The structural fix is to split the builder into two variants — one full clinical XML for NPDS, one redacted token-only XML for EoP delivery — and route each to its correct consumer.

## Decision (planned)
Split `buildFullPrescriptionXml` into two variants: `buildClinicalXml` (full content for NPDS submission) + `buildTokenEoPXml` (token + DSPID + SCID only, for electronic-EoP delivery). Add CI guard `check-eop-redaction.ts` forbidding the 7 fields from the token path.

## Consequences
Restores ADHA conformance on the electronic EoP path. No impact on clinical XML submitted to NPDS. Future CTS audit can verify redaction via the guard.

## References
- sleepy-roaming-meteor plan PART 7e P1
- Target files: `apps/api/src/integrations/escript/erxRestPayloads.ts`, `npdsClient.ts`
