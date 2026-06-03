# Feature Flag Registry

| Key | Owner | Lane | Default | Rollout % | Expiry Date | Cleanup BUG |
|---|---|---|---|---:|---|---|
| `auth-password-breach-check-p4` | Dr Prakash Kamath, Dr Amit Zutshi | A1b | `false` | 0 | 2026-08-31 | `BUG-P4` |
| `b5-error-boundary-raw-details` | Dr Prakash Kamath, Dr Amit Zutshi | B5 | `false` | 0 | 2026-07-31 | `BUG-418` |
| `b5-ai-draft-sign-attestation-bypass` | Dr Prakash Kamath, Dr Amit Zutshi | B5 | `false` | 0 | 2026-07-31 | `BUG-417` |
| `b5-letter-draft-sensitive-filter-bypass` | Dr Prakash Kamath, Dr Amit Zutshi | B5 | `false` | 0 | 2026-08-15 | `BUG-425` |
| `b5-first-visit-chart-review-bypass` | Dr Prakash Kamath, Dr Amit Zutshi | B5 | `false` | 0 | 2026-08-31 | `BUG-426` |
| `b5-recent-risk-assessment-bypass` | Dr Prakash Kamath, Dr Amit Zutshi | B5 | `false` | 0 | 2026-08-31 | `BUG-427` |
| `b5-staff-deactivation-pending-notes-bypass` | Dr Prakash Kamath, Dr Amit Zutshi | B5 | `false` | 0 | 2026-08-31 | `BUG-428` |

## Notes

- Flags are fail-closed by default when unset.
- Any expiry extension requires an explicit decision-log entry with rationale.
