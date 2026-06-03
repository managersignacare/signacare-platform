# Notification Escalation Title Convention

## Scope
- Applies to backend emitters that produce escalation notifications.
- Applies to frontend bell rendering as a compatibility fallback only.

## Authority Order
1. `payload.tier` is the authoritative escalation signal.
2. Title prefix is human-readable copy, not policy authority.

## Prefix Standard
- Tier 1 (base alert): no escalation prefix required.
- Tier 2: `[ESCALATION]`.
- Tier 3: `[CRITICAL ESCALATION]`.
- Tier 4+: `[REGULATORY]` or lane-approved equivalent with explicit clinical/compliance signoff.

## Required Payload Contract
- Emitters must include `payload.tier` as an integer (`1`, `2`, `3`, ...).
- UI must prioritize `payload.tier` for rendering logic.
- Prefix text may evolve, but tier semantics must not.

## Compatibility Rule
- Existing title prefixes remain allowed for backward readability.
- New UI behavior must not infer tier solely from title strings.

## Rationale
- Prevents drift where wording changes break escalation behavior.
- Keeps recipient urgency semantics machine-readable and testable.
