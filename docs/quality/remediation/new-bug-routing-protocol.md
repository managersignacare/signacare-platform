# New Bug Routing Protocol (During Active Module Execution)

## Goal
Classify newly discovered issues consistently so scope does not drift silently and high-risk defects are never deferred by accident.

## Routing Rules

1. **In-scope + S0/S1 severity**
- Add to current module immediately.
- Extend module DoD and verification set.
- Update active-slice + bug ledger in same change set.

2. **In-scope + S2/S3 severity**
- Create BUG row immediately.
- Mark as follow-up linked to current module.
- Track in current module evidence packet as residual.

3. **Out-of-scope (any severity)**
- Create BUG row immediately.
- Assign to owning lane/module.
- Do not patch in current module unless explicitly escalated and approved.

4. **Cross-cutting harness defect**
- Route to Phase-0/harness backlog.
- Mark all affected module evidence as provisional until harness defect is resolved.

## Mandatory Metadata
- `bug_id`
- `discovery_source` (test/spec/manual path)
- `severity`
- `owning_lane`
- `routing_decision`
- `owner`
- `target_cycle`

## Enforcement
- No module can be marked complete if discovered S0/S1 in-scope bugs remain unfiled.
- No ad-hoc “silent parking”; every finding must be catalogued.
