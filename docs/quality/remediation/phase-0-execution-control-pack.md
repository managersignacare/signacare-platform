# Phase-0 Execution Control Pack

**Effective date:** 2026-05-16  
**Purpose:** prevent open-ended harness work and enforce deterministic escalation.

## 1) Time-box
- Phase-0 duration: **10 working days**.
- Day 10 is a hard decision gate, not a soft checkpoint.

## 2) Exit Gates (must be green to close Phase-0)
- `guard:all`
- `lint`
- `typecheck`
- representative integration pack
- probe pack
- workflow e2e classification (harness defect vs product defect)

## 3) Day-10 Escalation Rule
If Phase-0 gates are not fully green by Day 10:
1. freeze new module starts,
2. publish unresolved gate list with owners,
3. operator decision required: **extend**, **descope**, or **risk-accept**.

## 4) Required Templates / Protocols
- Module charter template:
  `docs/quality/remediation/templates/module-charter-template.md`
- L3 persona matrix template:
  `docs/quality/remediation/templates/l3-persona-matrix-template.md`
- New bug routing protocol:
  `docs/quality/remediation/new-bug-routing-protocol.md`
- Evidence packet schema:
  `docs/quality/remediation/schemas/evidence-packet.schema.json`

## 5) Weekly Cold-Start Ownership
- **Run owner:** QA lead (execution owner for weekly integrity workflow).
- **Backup owner:** Platform lead.

## 6) Weekly Cold-Start Failure Protocol
On any weekly cold-start failure:
1. file a regression BUG within 24 hours,
2. apply lane freeze for affected scope,
3. publish ETA + containment plan within 48 hours,
4. reopen only after gate replay is green.
