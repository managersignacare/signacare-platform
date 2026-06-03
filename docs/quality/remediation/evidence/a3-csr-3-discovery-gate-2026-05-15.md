# A3 CSR-3 Discovery Gate Output (2026-05-15)

## Purpose

Produce the Phase-A regulatory discovery output required before any A2 closure claim:

1. confirm schema/contract dependencies between A3 and A2;
2. identify A3-required schema surfaces not yet closed;
3. lock compatibility rules so A2 closure does not drift after A3 execution.

## Inputs

1. `docs/quality/remediation/three-bucket-authoritative-plan.md`
2. `docs/quality/bugs-remaining.md`
3. `docs/quality/remediation/decision-log.md`

## Discovery Outputs (A3 -> A2 Compatibility Gate)

### GATE-A3-1: `clinics.hpio` (`BUG-334`) remains mandatory and aligned

1. A2 Phase-C already enforces `clinics.hpio NOT NULL`.
2. A3 eRx/HI surfaces depend on HPI-O presence and validation (`BUG-337`, `BUG-N1/N2/N4`, `BUG-P5` family context).
3. Compatibility decision: **do not reopen `BUG-334` enforcement; keep strict NOT NULL + canonical validator path**.

### GATE-A3-2: `clinical_notes.consent_id` (`BUG-315`) remains mandatory

1. A2 Phase-C already enforces `clinical_notes.consent_id NOT NULL` + validated FK.
2. A3 discovery found no conflicting contract requiring nullable note consent posture.
3. Compatibility decision: **do not reopen `BUG-315`; keep non-null contractual writes**.

### GATE-A3-3: A3 must introduce additional regulated schema in its own lane

1. `BUG-A5.3` requires `patient_ihis` history + record/number-status fields.
2. `BUG-N4` requires 10-field HI disclosure audit contract + `hi_error_log`.
3. These are **A3 schema additions** and must be delivered in A3 lane as Class-M changes with migration governance; they do not invalidate A2 Phase-C constraints.

### GATE-A3-4: Audit immutability compatibility

1. A3 regulated audit extensions (`BUG-P6`, `BUG-N4`) must remain append-only and compatible with A2 hash-chain guarantees (`BUG-287`).
2. Rule: A3 must extend audit payload/fields without introducing mutable rewrite behavior on historical audit rows.

### GATE-A3-5: Open A3 workflow families remain R2/R3 until executed

1. Remaining open A3 workflow contracts (`BUG-303/304/305`, `BUG-N1`, `BUG-N4`, `BUG-A5.4`, `BUG-A5.7`, `BUG-N5`, `BUG-P5`, `BUG-P7`) are not locally closed by this discovery pass.
2. This pass only provides **gating compatibility**, not conformance closure.

## Result

CSR-3 discovery gate is **complete** for pre-A2-closure compatibility:

1. no A3-discovered conflict requiring rollback of A2 `consent_id`/`hpio` constraints;
2. explicit A3 schema additions are identified and isolated to A3 lane;
3. A3 operational closure remains pending Phase-B rollout evidence.

