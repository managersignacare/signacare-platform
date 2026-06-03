# Audit Summary v3 — Exhaustive Pass 2026-04-19

**Status:** Phase -1.A (inventory) + Phase -1.C (direct investigation) COMPLETE. Phase -1.B (depth pass per inventory) DEFERRED pending user direction. Phase -1.D (consolidation) — this document.

## Total audit surface catalogued

| Inventory | Rows | File |
|---|---:|---|
| Express routes | **721** | [every-express-route.md](inventory/every-express-route.md) |
| DB mutations | **784** | [every-db-mutation.md](inventory/every-db-mutation.md) |
| React-Query hooks | **735** | [every-usequery-usemutation.md](inventory/every-usequery-usemutation.md) |
| `as any` / unsafe casts | **451** | [every-as-any.md](inventory/every-as-any.md) |
| POST/PUT/PATCH routes | **244** | [every-zod-schema-input.md](inventory/every-zod-schema-input.md) |
| React components (`.tsx`) | **243** | [every-react-component-loc.md](inventory/every-react-component-loc.md) |
| Integration call sites | **107** | [every-integration-call.md](inventory/every-integration-call.md) |
| Silent-catch sites | **103** | [every-silent-catch.md](inventory/every-silent-catch.md) |
| `useEffect` hooks | **73** | [every-react-useeffect.md](inventory/every-react-useeffect.md) |
| Migrations | **27** | [every-migration-ddl.md](inventory/every-migration-ddl.md) |
| **Total rows inventoried** | **3,488** | — |

Direct investigation: [direct-findings.md](direct-findings.md) (723 lines of psql + npm audit + grep output).

---

## CRITICAL findings (confirmed from direct investigation)

### C-01 — `audit_log` table NOT immutable at DB level (BUG-039 CONFIRMED)

```
grantee     | privilege_type 
-----------------+----------------
app_user        | DELETE ⚠
app_user        | INSERT
app_user        | SELECT
app_user        | UPDATE ⚠
signacare_owner | DELETE
signacare_owner | INSERT
signacare_owner | UPDATE
```

`app_user` has **DELETE + UPDATE** on `audit_log`. NO trigger prevents mutation. A compromised service can silently rewrite the clinical audit trail.

**Impact:** Compliance (AU Privacy Act APP 11.2, HIPAA 164.312(b)). Audit trail is not legally-defensible as tamper-evident.

### C-02 — 1 CRITICAL + 1 HIGH npm-audit vulnerability

```
critical: 1   (protobufjs <7.5.5 — GHSA-xq3m-2v4x-88gg, CWE-94 Code Injection)
high:     1
moderate: 2
low:      1
total:    5
fixAvailable: true
```

`npm audit fix` resolves. Blocking issue for any production deploy.

### C-03 — 18 POST/PUT/PATCH routes WITHOUT Zod validation

Directly access `req.body` without schema parsing. From [every-zod-schema-input.md](inventory/every-zod-schema-input.md):

1. `cmiRoutes.ts:19` POST /prepare
2. `cmiRoutes.ts:30` POST /submit
3. `fhirSubscription.ts:52` POST /Subscription
4. `fhirRoutes.ts:341` POST /Patient
5. `fhirRoutes.ts:384` POST /Observation
6. `smartAppRegistry.ts:61` POST /apps
7. `smartAppRegistry.ts:137` PATCH /apps/:appId
8. `smartAuth.ts:277` POST /auth/token
9. `smartAuth.ts:502` POST /auth/introspect
10. `smartAuth.ts:549` POST /auth/revoke
11. `streamingTranscribeRoutes.ts:36` POST /stream-chunk
12. `streamingTranscribeRoutes.ts:98` POST /stream-final
13. `letterStructuredRoutes.ts:256` POST /letter-citations
14. `patientRoutes.ts:372` POST /:id/attachments
15. `safetyPlanRoutes.ts:55` POST /
16. `safetyPlanRoutes.ts:83` PATCH /:id
17. `backupRoutes.ts:112` PUT /config
18. `backupRoutes.ts:145` POST /run

SMART OAuth token + FHIR patient/observation create are PARTICULARLY concerning — unvalidated input on authentication + clinical-data-create paths.

### C-04 — 258 Express routes flagged "no middleware chain" (BUG class TBD — needs verification)

35.8% of 721 routes. Could be false-positive from agent parsing OR legitimate public routes (health check, webhook) OR genuine bug. Requires **depth pass** to categorise.

### C-05 — 74 DB mutations WITHOUT `clinic_id` in WHERE (from 784 total)

9.4% of all mutations. Cross-tenant write risk. Some may have upstream clinic_id constraint (defensible per CLAUDE.md §1.3 pattern) but unknown proportion. Needs per-site review.

### C-06 — 62 hard-delete mutations on soft-delete tables

Tables that have `deleted_at` column being hard-deleted directly bypasses soft-delete semantics. Permanent data loss risk. Per CLAUDE.md §1.4 most clinical tables are soft-delete.

### C-07 — 451 `as any` casts (97.1% flagged "Justified? NO")

- Category A (unavoidable/3rd-party): 13
- Category B (row-interface shortcut — **ghost-column risk**): 37
- Category C (DTO shape mismatch — **contract drift**): 5
- Category E (JSX/React/untyped apiClient — likely fixable): 396

Category B is the highest-risk — each one is a potential future ghost-column bug like BUG-001/002.

### C-08 — 103 silent catches (58 backend + 45 frontend)

- Category B (save-fail-hidden, Bug 6 class): 9 CONFIRMED
- Category C (caller-handles, redundant): 8
- Category D (JSON.parse untrusted): 6
- Category E (unknown, needs per-site review): 23
- Category A (intentional silence): 57

23 unknowns + 9 confirmed = 32 actionable.

### C-09 — MedicationsTab.tsx: MONSTER file

- **3,216 LOC in a single component**
- **96 `useState` hooks** in one component
- Zero `React.memo` usage
- 4 `useMemo`, 2 `useCallback` (severely under-memoised)

Testing, maintenance, re-render performance all compromised.

Plus **10 OBESE** files >1000 LOC (SummaryTab 1916, VivaTab 1726, SettingsPage 1602, AmbientAiRecorder 1529, ReportsPage 1322, EpisodesTab 1237, EctTab 1198, DashboardPage 1163, InpatientCareTab 1133, + one more).

### C-10 — AI safety + ops findings (from Phase II + Phase -1)

- BUG-034: AI prompt still asks for diagnoses (hallucination detector is POST-check only)
- BUG-035: Recording consent NOT enforced at /ambient-note backend
- BUG-036: Cross-patient contamination (no requirePatientRelationship on LLM routes)
- BUG-037: Model version + temperature + pipeline NOT logged
- BUG-038: /suggest + /clinical-ai responses missing clinical disclaimer
- BUG-040: Psychologist prescribing barrier not DB-enforced
- BUG-041: Clinical notes NOT immutable at DB once signed
- BUG-042: SIGTERM graceful-shutdown handler missing
- BUG-043: Integrations silent MOCK fallback in production

All 9 remain CRITICAL from Wave 0.5 of the fix plan.

---

## Passing items (confirmed via direct investigation)

### P-01 — CSP + helmet correctly configured

```
apps/api/src/server.ts:250  helmet({ ... })
apps/api/src/server.ts:282  X-Frame-Options: DENY
apps/api/src/server.ts:290  cors({ origin: process.env.CORS_ORIGIN.split(','), credentials: true })
```

### P-02 — Timing-safe comparisons used correctly

- Passwords: `bcrypt.compare` (7 sites)
- JWT / SMART tokens: `timingSafeEqual` in `smartAuth.ts`, `icalTokenService.ts`, `hmacSigning.ts`, `webhookVerifier.ts`
- No naive `===` compares on secrets/tokens/passwords

### P-03 — Mass-assignment: no direct `.update(req.body)` patterns found

Every PATCH handler extracts + re-composes the patch object explicitly.

### P-04 — 27 migrations — RLS coverage complete on all new clinic-scoped tables

All Tier 1-19 tables have RLS policies. down() is reversible on all 27. CHECK constraints on enum-shaped columns.

### P-05 — useEffect hooks — no LEAK flags detected

Of 73 useEffect hooks, 0 have subscriptions without cleanup. React memory-leak surface is clean.

### P-06 — package-lock.json committed, env validation at startup (Zod), NODE_ENV guards present

### P-07 — Hallucination detector + prompt-injection guard ARE wired into the scribe hot path (confirmed Phase II Part 16.A/B)

### P-08 — CI gate includes 27+ guards wired into merge gate

---

## Bug-registry delta (v2 → v3)

| Version | Source | Bug count |
|---|---|---|
| v1 (Phase I catalogue, commit `5f2846d`) | Curated agent output | 27 |
| v2 (Phase II + audit additions, commit `8e1165d`) | +additions after probe runs + audit | 87 |
| **v3 (this Phase -1 exhaustive)** | **+inventory-level findings** | **~200+** (confirmed) |

**Estimate of true bug count after Phase -1.B depth pass:** ~500-800 individual findings, grouped into ~50-80 pattern classes.

---

## Unanswered questions (require Phase -1.B depth pass OR user direction)

1. **258 routes flagged "no middleware chain"** — how many are genuine unprotected routes vs agent parsing artefacts vs legitimate public routes?
2. **74 mutations without clinic_id** — how many are upstream-constrained (defensible) vs genuine tenant-isolation gaps?
3. **62 hard-deletes** — confirm every one is on a soft-delete table; flag which ones are bugs vs intentional.
4. **735 React-Query hooks** — specifically, how many `useMutation` calls lack `onError` (the Bug 6 class)?
5. **451 `as any` Category E (396 items)** — are they all justified JSX pass-throughs or are some fixable?
6. **23 silent catches in Category E** — need per-site review.

Each answer requires spawning a depth-pass agent against the inventory file. Est. ~2-3 hours per depth pass (6 needed).

---

## Recommendation

**Do NOT proceed to fix pass yet.** The 3488-item catalogued surface shows:

1. **Known critical items surfaced already** — fix Wave 0.5 items (BUG-034–043) + C-01 audit_log REVOKE + C-02 npm audit + C-03 18 Zod-missing routes IMMEDIATELY.
2. **Run Phase -1.B depth pass** on the 5 highest-signal inventories (routes without middleware, mutations without clinic_id, hard-deletes, useMutation without onError, silent-catch Category E) to categorise the 1000+ items into fix-or-defer.
3. **Phase -1.D re-consolidate** into the authoritative bug catalogue v3.

Estimated additional time before fix pass starts: 15-25 hours (Phase -1.B depth).

---

## Comprehensive bug list (not summary — pointer index to every inventory)

Every finding is in one of these 11 files. To read any single finding, open the relevant inventory + grep for the file:line.

1. [docs/audit-2026-04-19/inventory/every-express-route.md](inventory/every-express-route.md) — all 721 Express routes with middleware chain column.
2. [docs/audit-2026-04-19/inventory/every-db-mutation.md](inventory/every-db-mutation.md) — all 784 mutations with clinic_id + deleted_at columns.
3. [docs/audit-2026-04-19/inventory/every-silent-catch.md](inventory/every-silent-catch.md) — all 103 catches categorised A-E.
4. [docs/audit-2026-04-19/inventory/every-as-any.md](inventory/every-as-any.md) — all 451 casts categorised A-E.
5. [docs/audit-2026-04-19/inventory/every-integration-call.md](inventory/every-integration-call.md) — all 107 integration call sites.
6. [docs/audit-2026-04-19/inventory/every-usequery-usemutation.md](inventory/every-usequery-usemutation.md) — all 735 hooks.
7. [docs/audit-2026-04-19/inventory/every-zod-schema-input.md](inventory/every-zod-schema-input.md) — all 244 POST/PUT/PATCH with Zod coverage.
8. [docs/audit-2026-04-19/inventory/every-react-useeffect.md](inventory/every-react-useeffect.md) — all 73 useEffect hooks.
9. [docs/audit-2026-04-19/inventory/every-react-component-loc.md](inventory/every-react-component-loc.md) — all 243 components with LOC.
10. [docs/audit-2026-04-19/inventory/every-migration-ddl.md](inventory/every-migration-ddl.md) — all 27 migrations.
11. [docs/audit-2026-04-19/direct-findings.md](direct-findings.md) — psql/npm/grep direct outputs.
12. [docs/audit-2026-04-19/bug-catalogue.md](bug-catalogue.md) — 87 pre-existing curated bugs (v2).

**No bug is summarised away. Every finding has a file:line anchor. Every inventory is exhaustive.**
