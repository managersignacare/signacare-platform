# Fixes — date-stamped resolution reports

Per-sprint resolution reports using the `fixes-YYYYMMDD.md` convention.

## Convention

- **One file per fix-sprint session.** Create `fixes-YYYYMMDD.md` (e.g.
  `fixes-20260418.md`) on the day the sprint starts. Closes on the day
  the last commit of the sprint lands.
- **Commit-centric.** This directory documents WHAT WAS FIXED — per commit,
  which audit findings it closes, file list, rollback commands.
- **Findings come from audits.** Each fix entry references the audit finding
  ID it closes (e.g. `SD39`, `code-columns-53`).
- **Stable.** Do not rewrite after the fact. Add a correction block at the
  bottom if a fix turns out to be wrong.

## Relationship to other directories

See [../audits/README.md](../audits/README.md) for the full directory map.

## Current fixes

- [fixes-20260418.md](fixes-20260418.md) — Phase 0.7.5 c24 (D1–D12a) + Phase R R1 (guards + CLAUDE §12 + exemption inventory)
