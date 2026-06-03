# Architectural Decision Records

Each ADR captures ONE significant technical decision in a short, stable document. Standard format:

```
# ADR-<NNNN>: <Title>

## Status
Accepted | Superseded by ADR-XXXX | Deprecated

## Context
Why this decision was needed. What problem or constraint forced it.

## Decision
What was chosen. One or two paragraphs.

## Consequences
Positive + negative trade-offs. What this makes easier, what it makes harder.

## References
Commit SHAs, fix-registry anchors, related ADRs.
```

ADRs are append-only. Superseding a decision creates a new ADR and marks the old one **Superseded by ADR-XXXX**. Never edit an accepted ADR's decision; write a new one.
