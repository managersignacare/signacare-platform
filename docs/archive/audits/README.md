# Audits — date-stamped findings reports

Point-in-time audit reports using the `audit-YYYYMMDD.md` convention.

## Convention

- **One file per audit session.** Create `audit-YYYYMMDD.md` (e.g.
  `audit-20260418.md`) on the day the audit starts.
- **Findings, not fixes.** This directory documents what was FOUND — root
  cause, file/line, severity, proposed remediation. The fixes themselves
  go in `../fixes/fixes-YYYYMMDD.md` once they land.
- **Stable.** Do not retroactively rewrite an audit file after the fixes
  land. If the audit's understanding of a finding turns out to be wrong,
  amend with an "update" block at the bottom dated with the correction
  date, rather than rewriting history.
- **Cross-link.** Every audit file should link to:
  - The preceding audit in chronological order
  - The fix file that addresses it (once the fixes land)
  - The master plan that scopes the fix phase

## Relationship to other directories

| Dir | Content | Mutability |
|---|---|---|
| `../audits/` | Findings at a moment in time | Stable once committed |
| `../fixes/` | Resolution report per fix-sprint | Stable once committed |
| `../plans/` | Forward-looking execution plan | Updated until superseded |
| `../archives/` | Retired reports of all three types | Append-only |

## Current audits

- [audit-20260418.md](audit-20260418.md) — Phase 0.7.5 c24 inventory + Phase R R1 code-columns guard findings (62 SDs + 53 ghost-column writes)
