# BUG-269 — Preventive CI guard for PHI-field log drift

**Metadata**

- Severity: S1
- Track / Wave: A / A-2
- State: fixed
- Change class: standard
- Fix-registry anchor: `R-FIX-PHI-LOG-GUARD`
- Origin: BUG-216 residual — `PHI_FIELDS` is a static allow-list; new columns added by migrations don't auto-propagate to the runtime redactor.

## Diagnosis

`PHI_FIELDS` in [apps/api/src/utils/phiFields.ts](apps/api/src/utils/phiFields.ts) is consumed at runtime by `redactPhi()` (the recursive pino `formatters.log` helper) + `pino.redact.paths`. Any key NOT in the set passes through unredacted. BUG-216 added `checkSchemaPhiDrift()` which WARNs on BOOT if schema columns match the PHI regex but aren't in `PHI_FIELDS` — but this runs once per process start, not at commit time, and only surveys the DB schema (not actual logger call sites).

Result: a developer can inadvertently log `logger.info({ patient: { new_column: x } })` with a newly-migrated PHI-flavoured column and the leak survives until someone reviews journald. The set has grown from 16 (v1) → ~150 (post-BUG-267 BLIND_INDEX) and will keep growing.

## Fix

New CI guard `scripts/guards/check-log-no-phi.ts` (~260 LOC, TypeScript compiler AST).

### AST handling — fail-closed where static analysis can't prove safety

| Shape | Rule |
|---|---|
| `logger.info({ a: x, b: y })` | Scan each key; fail if PHI regex AND key not in `PHI_FIELDS` AND key not in allowlist. |
| `logger.info({ a, ...rest })` | WARN + rule out (spread keys not statically visible). |
| `logger.info(payload)` | WARN + rule out (identifier — shape unknown). |
| `logger.info('msg', { meta })` | Scan arg[1] if it's an object literal. |
| `logger.info(\`template ${v}\`)` | Accept (strings don't carry object keys). |
| `logger.info({ a: { b: 'x' } })` | Recursively scan inline nested objects. |
| `logger.info({ a: someIdentifier })` where key hints at PHI shape (`patient`, `staff`, `note`, etc.) | WARN — contents not statically visible. |

### Allowlist

`scripts/guards/log-phi.allowlist` — one key per line, `#` comments. Entries:

- `suspects` — column label in `checkSchemaPhiDrift` log, not a value.
- `familyId` — session/refresh-token family ID (security concept), not patient family.
- `emailSent` — boolean status flag `result.email.sent`, not an email address.

**KEEP SHORT.** Classification rule: if the key's value COULD contain OAIC personal info, it belongs in `PHI_FIELDS` (not the allowlist). Allowlist is for keys whose values are status flags / column labels / non-patient identifiers that happen to match the regex.

### Regex coupling

The PHI-suspect regex in this guard MUST match the regex in `utils/logger.ts::checkSchemaPhiDrift`. Both are:

```
/(?:phone|email|address|medicare|ihi\b|hpii|dva|ndis|prescriber|dob|given|family|preferred|nok|pbs|narrative|complaint|diagnosis|lookup|blind_?index)/i
```

Any change in one must be mirrored in the other. Drift produces silent coverage gaps.

### PHI_FIELDS loader robustness

The loader parses `PHI_CATEGORY_*` array literals from `phiFields.ts` via regex. An apostrophe in a comment (e.g. `They're`) was initially breaking the paired-quote extractor. Loader now strips single-line `//` comments before extraction.

### Classification findings during implementation

Running the guard baseline caught 4 real issues:

| Site | Key | Classification |
|---|---|---|
| `authService.ts:255` | `familyId` | **allowlist** — session/refresh-token family ID, not patient family |
| `provisioningService.ts:187` | `adminEmail` | **PHI** — added to `PHI_CATEGORY_EMAIL` as `adminEmail` + `admin_email`; admin email is OAIC personal info same as any email |
| `provisioningService.ts:471` | `adminEmail` | same as above |
| `tokenDeliveryService.ts:175` | `emailSent` | **allowlist** — boolean status flag, not email value |

Post-classification: guard reports 0 failures, 34 informational WARNs (identifier args / spreads — expected, not blocking).

## Files changed

- `scripts/guards/check-log-no-phi.ts` — new (~260 LOC, TS compiler AST).
- `scripts/guards/log-phi.allowlist` — new (3 entries with rationale comments).
- `apps/api/src/utils/phiFields.ts` — added `adminEmail` + `admin_email` to `PHI_CATEGORY_EMAIL`.
- `apps/api/tests/unit/logPhiGuard.test.ts` — new (5 tests covering the semantics).
- `docs/audit-2026-04-19/bug-catalogue-v2.yaml` — state: fixed.
- `docs/fix-registry.md` — `R-FIX-PHI-LOG-GUARD` anchor.

## Tests — 5 unit, all PASS

| # | Case |
|---|---|
| G1 | Novel PHI-shaped key (`consumer_medicare_number`) NOT in `PHI_FIELDS` → violation. |
| G2 | Known `medicare_number`, `given_name`, `ihi_number_lookup` → no violation (runtime redactor covers). |
| G3 | Allowlist keys (`familyId`, `emailSent`) matching regex → no violation. |
| G4 | Non-PHI-regex non-allowlisted keys (`clinicId`, `staffId`, etc.) → no violation. |
| G5 | `adminEmail` / `admin_email` are NOW in `PHI_FIELDS` (classification decision holds). |

Existing BUG-216 `loggerRedaction.test.ts` (8 tests) still PASS — no regression from the taxonomy extension.

## Limitations (documented in guard header)

1. **Static analysis only.** Runtime-constructed payloads (`Object.assign`, computed keys) are invisible.
2. **First-level keys only** for identifier-valued properties. Nested PHI behind `{ a: somePatientObj }` needs explicit-key logging to be caught; nested identifiers emit a WARN.
3. **Regex coupling** with `checkSchemaPhiDrift` — both guards share semantics; changes must be mirrored.
4. **Second-argument metadata** IS scanned (pino's `(msg, meta)` shape) but only when it's an object literal.

Reviewers should NOT assume stronger coverage than explicitly provided. Runtime `redactPhi()` + `pino.redact.paths` remain the last line of defence.

## QA verdicts

- L3 code-reviewer-general: TBD
- L4 / L5: not required (standard class — CI guard only, no production code path change beyond 2 PHI_FIELDS additions).

## Residual risk

- **Identifier arguments** (`logger.info(ctx)`) produce only WARNs, not FAILs. A future regression where `ctx` carries a PHI-named key could slip past. Follow-up: extend guard to track identifier shape back to its declaration (requires full TS type-checker integration — heavier).
- **Computed keys** (`{ [dynamicKey]: x }`) are invisible.
- **Allowlist drift:** if the allowlist grows large, classification scrutiny drops. Plan review: if allowlist exceeds ~10 entries, re-audit classifications.
