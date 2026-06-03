# Signacare EMR — Complete Execution Plan v3.0

**Version:** 3.0
**Date:** 2026-04-19
**Status:** Approved for execution
**Scope:** 255 bugs catalogued (210 active + 9 closed + 36 deferred)
**Timeline:** ~12 months to full catalogue closure. First-customer-safe deploy at end of Track A (~month 4-5).

---

## DOCUMENT STRUCTURE

- PART 0: Executive summary
- PART 1: Scope baseline
- PART 2: Track structure + wave schedule
- PART 3: Principal-engineer binding rules
- PART 4: Per-commit protocol (tiered)
- PART 5: Per-wave protocol
- PART 6: Progressive deployment
- PART 7: Rollback discipline
- PART 8: RACI + approvers
- PART 9: Scope control
- PART 10: Detailed Wave A-0 plan
- PART 11: Communication format
- PART 12: QA agent specification (5 levels)
- PART 13: Exit criteria
- PART 14: Residual risk
- PART 15: Known execution risks
- **APPENDIX A: Complete bug catalogue (all 255 bugs enumerated)**
- APPENDIX B: File manifest per wave

---

## PART 0 — EXECUTIVE SUMMARY

Signacare EMR has undergone exhaustive discovery (see sibling audit docs for evidence). This plan closes 210 actively-scoped defects across three disciplined tracks with named governance, tiered commit ceremony, and a five-level QA agent that mechanically verifies adherence to principal-engineer rules.

**Key numbers:**

| Metric | Value |
|---|---|
| Total bugs catalogued | 255 |
| Active (in-scope) | 210 |
| Closed (false-positive / duplicate / resolved) | 9 |
| Deferred to feature roadmap | 36 |
| CRITICAL / S0 | 22 |
| HIGH / S1 | 78 |
| MEDIUM / S2 | 83 |
| LOW / S3-S4 | 27 |
| Engineer-days estimate | ~467 |
| Wall-clock estimate | ~12 months |
| First-customer-safe deploy | End of Track A (~month 4-5) |

**Deliverables:**
1. 210 bugs closed with regression tests
2. QA agent (5 levels) operational before Wave A-1 risky commits
3. Staged deployment pipeline (dev → staging → canary → production)
4. Full reversible-migration discipline
5. Documented post-programme review

---

## PART 1 — SCOPE BASELINE

### 1.1 Counts (immutable until CAB change-control)

| Category | Count |
|---|---|
| Active (in-scope) | 210 |
| Closed | 9 |
| Deferred | 36 |
| **Total** | **255** |

### 1.2 System context

- **Stack:** Node.js + TypeScript + React (Signacare EMR)
- **Database:** PostgreSQL 17 + Knex query builder, 162-table RLS schema
- **Auth:** JWT + Redis session + RLS tenant isolation
- **Error pattern:** `AppError` at `packages/shared/src/errors.ts` (ONLY class)
- **Validation:** Zod schemas, `*.schema.ts` co-located (ONLY pattern)
- **Logging:** Pino + PII redact (ONLY logger)
- **Testing:** Jest/Vitest + Supertest (ONLY frameworks)
- **AI:** Ollama local LLM; PHI never leaves the server

---

## PART 2 — TRACK STRUCTURE + SCHEDULE

### 2.1 Three tracks

| Track | Bugs | Purpose | Duration |
|---|---|---|---|
| **A — Urgent Remediation** | 41 | S0 + critical S1 patient-safety, tenant isolation, infra | 18 weeks (90 eng-days) |
| **B — Sustained Improvement** | 167 | Remaining S1 + all S2 + S3 + S4 | 42 weeks (12 sprints, overlaps A after A-0) |
| **C — Feature Delivery** | 4 + 65 endpoints | Dormant Tier 12-19 UI MVP, mobile register | 4 weeks (after A-exit) |

### 2.2 Track A waves

| Wave | Duration | Scope summary |
|---|---|---|
| A-0 | 6 eng-days | Infrastructure stability (BUG-187, 197), test runner fix, QA agent build, PR template, pre-commit hook, rollback runbooks, catalogue-v2.md, role register, TODO triage |
| A-1 | 8 eng-days | WebAuthn crypto, HL7 transport, login redirect diagnosis |
| A-2 | 15 eng-days | Patient safety S0 (16 bugs): PHI log redact, AI prompt, consent, requirePatientRelationship, model_version, disclaimer, REVOKE, prescribing CHECK, SIGTERM, integration config, RT family, MFA disclosure |
| A-3 | 16 eng-days | Tenant isolation S0 (22 bugs): 5 clinic_id gaps, org_units + programs cross-tenant, Outlook staff-token, patient_team_assignments, patient encryption layer, RBAC extensions, IDOR, mass-assignment |
| A-4 | 12 eng-days | Infrastructure & compliance critical (17 bugs): BullMQ idempotency, HTTP timeout, migration lock, env validator, cert expiry, DR drill, a11y CI, npm audit, licence allowlist, deploy.yml fixes, Trivy, gitleaks |
| A-exit | 16 eng-days | Staging 7-day soak + canary 72h + production promotion |
| Retro + buffer | 11 eng-days | Retro + 10% contingency |

### 2.3 Track B sprints (2 weeks each)

| Sprint | Bugs | Theme |
|---|---|---|
| B-1 | 11 | Silent-catch sweep + ghost-column + seed migrations |
| B-2 | 5 | E2E cascades + a11y sweep |
| B-3 | 21 | Small fixes + SQL hardening + schema drift |
| B-4 | 1 meta + 6 tables | Soft-delete conversion + UNIQUE partial indexes preamble |
| B-5 | as-any meta | as-any audit boundary layers (Category B + C + backend) |
| B-6 | 14 god-files | God-file refactor, ONE handler per commit (~280 commits) |
| B-7 | 18 | Structural contracts (error envelope, column lists, logger, circular-dep fix, repository pattern, fetch→apiClient) |
| B-8 | 20 | Clinical safety + audit completeness |
| B-9 | 42 | Enterprise hardening (Appendix P minus Track A subset) |
| B-10 | 23 | Prior-audit closeout (.returning('*'), unvalidated POST/PATCH, ghost-table handlers, ISMS/SNOMED/NDB/DSA) |
| B-11 | 6 | Test architecture + doctrines |
| B-12 | 1 meta | Manual test session + discovered-bug triage |

### 2.4 Track C sub-waves

| Sub-wave | Duration | Scope |
|---|---|---|
| C-0 | 1d | Mobile patient register wiring (BUG-240) |
| C-1 | 2d | Warm-up UI: note-templates, talk-time, scribe vocab, pause/resume |
| C-2 | 2.5d | Admin surfaces: impersonation, sensitive-flag queue, semantic search, governance dashboard (BUG-074) |
| C-3 | 1d | Action items panel |
| C-4 | 4d | Letters composer (18 endpoints), BUG-173 AI-DRAFT banner |
| C-5 | 3d | Clinical artefacts: MHA, capacity, forensic, citations, tone |
| C-6 | 4d | Training platform admin (14 endpoints) |
| C-7 | 1d | Scribe integration wire-up |
| C-8 | 1.5d | Correspondence migration + BUG-237 batch endpoint |

---

## PART 3 — PRINCIPAL-ENGINEER RULES (binding)

### 3.1 Eight absolute prohibitions
1. NEVER GUESS — unverified facts = STOP and read source.
2. NEVER ASSUME — unread function/table/type/test = not known.
3. NEVER APPLY BAND-AIDS — workarounds are bugs; find root cause.
4. NEVER INTRODUCE NEW PATTERNS — one way: AppError / Zod / AuthContext / Pino / Knex.
5. NEVER SUPPRESS ERRORS — no `@ts-ignore` blanket, no empty catch, no prod TODO.
6. NEVER DEVIATE FROM GOLD STANDARDS — when conflicting, escalate with documented trade-off.
7. NEVER OPTIMISE PREMATURELY — no speculative caching/memoisation.
8. NEVER WRITE UNREASONED CODE — trace data flow end-to-end first.

### 3.2 Before-writing-code checklist (7 items)
- Full context read (file + imports + callers + tests)
- Root cause identified (not symptom) — one sentence
- Problem understanding in PR body
- Existing applicable pattern cited (file:line)
- Downstream impact enumerated
- Schema/migration/API change explicit
- Confidence ≥90%; <90% = STOP + escalate

### 3.3 When-writing-code standards (13 items)
- Naming conventions match
- Code style matches
- Strict types (no `any`, no `unknown` without narrowing, no `!` without guard)
- One responsibility per function
- Every parameter typed
- Every public function explicit return type
- Every async awaited OR fire-and-forget with rationale
- Error handling via AppError ONLY
- DB query: explicit columns + parameterised + LIMIT
- Service method: AuthContext first
- Route: Zod at entry
- New table: clinic_id, created_at, updated_at, deleted_at, RLS
- PHI never logged

### 3.4 Six-step bug-fix protocol
1. DIAGNOSE — root cause one sentence
2. CLASSIFY — isolated | symptomatic (fix all) | structural (propose first)
3. VERIFY SCOPE — min change + max blast-radius + callers + tests
4. FIX — complete, no TODO/placeholder
5. HARDEN — regression + boundary cases for the CLASS
6. VERIFY — trace original + null + empty + concurrent + max-payload + missing-env + expired-token

### 3.5 Code quality (TypeScript 6 + Functions 5 + Error 5 + Security 5 + Database 6 + Testing 5 = 32 rules)

See appendices of sibling discovery doc for verbatim list. Summary:
- Strict mode, no `any`, no `!` without guard, interfaces not anon types, enums for finite sets
- Max 40 LOC per function, one responsibility, pure where possible, early returns
- AppError pattern, error includes op+userId+clinicId+resourceId, logged at origin, consistent envelope, no internal leak
- AuthContext every service, server-side tenant isolation, Zod every route, env-only secrets, PHI never logged
- Explicit column lists, LIMIT on multi-row, transaction for multi-step, soft-delete clinical+audit, indexes on FK+filter, RLS multi-tenant
- Specific assertions, boundary ±1, mutation-resistant, happy+auth+role+error integration, regression per fix

### 3.6 Architectural standards (5)
- Defence in Depth (HTTP middleware → route Zod → service AuthContext → DB RLS)
- Fail Fast, Fail Loud (startup-throw missing config; reject at boundary)
- Single Source of Truth (one canonical location per constant/schema)
- Explicit Over Implicit (no magic)
- Reversibility (down() migrations, soft-delete)

### 3.7 Communication format

Every PR body has: DIAGNOSIS / APPROACH / IMPLEMENTATION / TESTS / VERIFICATION / RESIDUAL RISK / CHANGE METADATA sections. See PART 11.

### 3.8 Escalation rules

STOP + ask when: business rule unclear | pattern unclear | unread schema | unread function | backwards-compat uncertain | test-adequacy uncertain. Template: `"I need to see [X] before proceeding. Reason: [Y]. Once I have [X], I will [Z]."`

### 3.9 Clinical-system rules (8)
- Patient safety > elegance/speed
- Wrong-medication/missed-allergy/lost-flag = CRITICAL
- AI-content saved to record ONLY with: hallucination-check + clinician sign-off + model_version
- Clinical data append-only
- Every decision traceable to named human clinician
- PHI egress only with explicit consent
- Break-glass: justification + two-person + audit
- Graceful degradation: AI down ≠ clinical down

### 3.10 Final check (7 questions)
1. Full context read?
2. Root cause not symptom?
3. Right fix not just passing test?
4. Follows existing pattern?
5. Every line defensible?
6. Test catches original bug?
7. System more correct AND more robust?

Any NO → return to Step 1.

---

## PART 4 — PER-COMMIT PROTOCOL (TIERED)

### 4.1 Commit classification

**trivial:** ≤5 lines, no migration, no auth/RLS/PHI, no new route, no new dep.
**standard:** 6-100 lines OR one of the non-risky triggers.
**risky:** >100 lines OR migration OR auth/RLS/PHI OR new route OR new dep OR integration OR breaking API.

### 4.2 Gate matrix

| Gate | trivial | standard | risky |
|---|---|---|---|
| G.1 test-first | OPT | REQ | REQ |
| G.2 tsc × 3 | REQ | REQ | REQ |
| G.2b dist build | SKIP | REQ | REQ |
| G.3a fast guards (5) | REQ | REQ | REQ |
| G.3b remaining 7 guards | per-sub-wave | REQ | REQ |
| G.4 bash guards (6) | REQ | REQ | REQ |
| G.5 fix-registry row | REQ | REQ | REQ |
| G.6 13-point audit | 1 | 2-3 | 4-5 |
| G.7 Playwright | SKIP | per-sub-wave | REQ |
| G.8 snapshot regen | if migration | if migration | if migration |
| G.9 scope diff | REQ | REQ | REQ |
| G.10 13-point checklist | 1 line | full | full |
| G.11 error narrowing | if catch | if catch | if catch |
| G.12 regression diff | per-sub-wave | per-sub-wave | REQ |
| QA L1 (static) | REQ | REQ | REQ |
| QA L2 (narrative) | REQ | REQ | REQ |
| QA L3 (judgement) | SKIP | SKIP | REQ |
| QA L4 (clinical) | if clinical | if clinical | if clinical |
| QA L5 (architectural) | SKIP | if structural | REQ |

---

## PART 5 — PER-WAVE PROTOCOL

### 5.1 Pre-flight
1. Infra stable (pool + Redis verified under load)
2. Prior wave exit signed off
3. Baseline test run recorded to `/tmp/baseline-<wave>.log`
4. Wave scope frozen (change-control lock)
5. Wave owner named, escalation contact set

### 5.2 Execution
- Sequential per-bug
- Six-step protocol + PR body format + gate matrix
- QA agent every commit
- Human reviewer approves every PR before merge

### 5.3 Wave exit criteria
1. Every bug in scope CLOSED
2. No regression vs baseline
3. All 12 CI guards green
4. Wave owner sign-off
5. Approver sign-off
6. Tag `post-<wave-id>`
7. Deployment stage advanced per PART 6

---

## PART 6 — PROGRESSIVE DEPLOYMENT

### 6.1 Stage 1 Dev
Every merge → dev. Smoke within 5 min. Exit: 24h soak, no critical logs.

### 6.2 Stage 2 Staging
Per-wave-exit (A) or per-sprint-exit (B). Synthetic PHI. Load test 150 concurrent 30 min. Exit: 7d green, no S0/S1.

### 6.3 Stage 3 Canary (10% prod)
Track A only. Monitoring: error rate, P99, saturation, integration health, audit, RLS bypass (0), break-glass (0). Exit: 72h green, data-integrity spot-check pass.

### 6.4 Stage 4 Full production
Canary exit + CAB approval + kill-switch ready (60s rollback). 14-day enhanced observability.

### 6.5 Customer communication
- Staging: internal only
- Canary: engineering + product ops
- Production: pre-release email 72h before + release-note doc
- Incident: customer-facing status page within 15 min

---

## PART 7 — ROLLBACK DISCIPLINE

### 7.1 Reversible-migration standard (binding)
Every migration has non-empty `down()` OR `# @irreversible: <reason>` + runbook. PHI-touching migrations = forward-fix only.

### 7.2 Rollback decision tree

```
Dev gate failure: git reset HEAD~1. SAFE.
Dev smoke fail: QA agent triage:
  - Infra flake → escalate, don't revert
  - Assertion regression → git revert
  - Environmental drift → snapshot refresh + retry
Staging soak fail: git revert + redeploy staging
Canary/prod: kill-switch (60s), forward-fix new commit, NEVER revert published
Irreversible state: forward-fix compensation commit. Incident runbook.
```

### 7.3 Runbooks (created in Wave A-0)
- `docs/runbooks/rollback-dev.md`
- `docs/runbooks/rollback-staging.md`
- `docs/runbooks/rollback-canary.md`
- `docs/runbooks/rollback-production.md`

---

## PART 8 — RACI + APPROVERS

### 8.1 Roles

| Role | Responsibility | Count |
|---|---|---|
| Executor | Writes code, responds to QA agent | 1 (AI) |
| Reviewer | Reviews every PR | 1 (human principal engineer) |
| Wave Owner | Owns scope, unblocks executor | 1 per wave |
| Approver | Wave-exit → staging | 1 (engineering lead) |
| Security Approver | Auth/RLS/PHI/integration | 1 (security lead) |
| Clinical Safety Approver | Medications/AI/clinical | 1 (consultant clinician) |
| CAB | Scope changes + production promotion | 3 (eng + product + clinical) |

### 8.2 Key RACI rows

| Decision | R | A |
|---|---|---|
| Commit merged | Executor | Reviewer |
| Wave exit | Wave Owner | Approver |
| Staging promotion | Approver | Approver |
| Canary promotion | Approver | CAB |
| Production promotion | CAB | CAB |
| Scope change | Wave Owner | CAB |
| Production rollback | Incident commander | CAB |

### 8.3 CAB
Weekly standing meeting during Track A. Ad-hoc for production incidents (within 4h). Quorum: 2 of 3 routine; 3 of 3 for production + scope changes. Emergency: 1 + async approval within 24h.

### 8.4 Go/no-go for first customer
Track A-exit + Canary 72h green + no open S0/S1 in staging + Security + Clinical + CAB triple sign-off + rollback drill within 7 days.

---

## PART 9 — SCOPE CONTROL

### 9.1 Single source of truth
`docs/audit-2026-04-19/bug-catalogue-v2.md` (to be created as Wave A-0 artefact — see APPENDIX A of this document for its content).

### 9.2 New-bug discovery
```
1. STOP current work.
2. File entry in catalogue.
3. Wave Owner triages.
4. CAB decides: current wave / next sprint / defer.
5. Resume after decision.
```

### 9.3 Weekly metrics to CAB
- Bugs closed/open/deferred
- Mid-execution discoveries (rate)
- QA agent rejection rate per level
- Appeal rate
- Schedule variance
- Staging incidents
- Rollback count
- Mean time to close per severity

Thresholds: >30% schedule slip, >20% QA rejection, any S0 incident, >5 new-bug-discoveries/week.

---

## PART 10 — DETAILED WAVE A-0 PLAN (first wave, 6 eng-days)

### 10.1 Tasks (sequential unless marked [P])

| # | Task | Time |
|---|---|---|
| A-0.1 | Environment baseline (psql, redis, git tag, npm ci, tsc) | 2h |
| A-0.2 | Infra stability fix (BUG-187 pool + BUG-197 Redis eviction) | 3h |
| A-0.3 | Snapshot pre-flight (regenerate + diff check) | 1h |
| A-0.4 | Catalogue-v2.md creation (all 255 bugs) | 3h |
| A-0.5 | Required reading + 1-line summaries (CLAUDE.md + 7 key files) | 4h |
| A-0.6 | GAP re-verification (19 ✅ CLOSED claims) | 6h |
| A-0.7 | BUG-180 TODO triage (37 markers) | 3h |
| A-0.8 | BUG-033/110 integration runner fix | 2h |
| A-0.9 [P] | QA agent L1 implementation | 1.5d |
| A-0.10 [P] | QA agent L2 implementation | 1.5d |
| A-0.11 [P] | QA agent L3/L4/L5 configuration | 1d |
| A-0.12 | PR template (.github/pull_request_template.md) | 1h |
| A-0.13 | Pre-commit hook (.husky/pre-commit) | 1h |
| A-0.14 | Rollback runbooks ×4 | 1d |
| A-0.15 | Role register (docs/governance/role-register.md) | 1h |
| A-0.16 | CI workflow updates (new QA agent jobs) | 3h |
| A-0.17 | A-0 exit sign-off | async |

### 10.2 A-0 exit criteria
All 17 tasks complete + Reviewer + Security Approver + CAB sign-off + git tag `post-wave-a-0`.

---

## PART 11 — COMMUNICATION FORMAT

### 11.1 PR body template

```markdown
## DIAGNOSIS
Root cause: <one sentence>
Classification: <isolated | symptomatic | structural>
Other instances: <list or 'none found after grep <pattern>'>

## APPROACH
Gold-standard fix: <what changes>
Downstream impact: <enumerated>
Follows existing pattern in: <file:line>

## IMPLEMENTATION
<complete code — no placeholders, no TODO, no ellipsis>
<inline WHY comments on non-obvious lines>

## TESTS
Regression: <code>
Boundary 1: <code>
Boundary 2: <code>

## VERIFICATION (traces explicit)
- Original failing scenario: <result>
- Null/empty input: <result>
- Concurrent/race: <result OR N/A + reason>
- Max payload: <result OR N/A + reason>
- Missing env var: <result OR N/A + reason>
- Expired token: <result OR N/A + reason>

## RESIDUAL RISK
What could still go wrong: <honest>
What catches it: <test/monitoring/accepted + rationale>

## CHANGE METADATA
Change-Class: <trivial | standard | risky>
Track: <A | B | C>
Wave: <A-N | B-N | C-N>
Severity: <S0 | S1 | S2 | S3>
Fix-Registry: <R-FIX-...>
Audit-Points: #<N>, #<N>, ...
BUG: BUG-NNN
```

### 11.2 Commit message template

```
<type>(<scope>): <summary ≤60 chars>

<what + why paragraph>

Change-Class: <trivial | standard | risky>
Track: <A | B | C>
Wave: <A-N | B-N | C-N>
Fix-Registry: <R-FIX-...>
Audit-Points: #<N>, #<N>
BUG: BUG-NNN

Co-Authored-By: <executor>
```

---

## PART 12 — QA AGENT SPECIFICATION (5 levels)

### 12.1 Level 1 — Deterministic static checks (20 checks)

**Implementation:** `scripts/qa-agent/level-1-static.ts`
**Invoked:** pre-commit + CI per PR

| # | Check | Rule enforced |
|---|---|---|
| L1.1 | typescript-strict | `tsc --noEmit` × 3 workspaces |
| L1.2 | no-any | AST reject `: any` or `as any`/`as unknown as X` without `// @intentional` |
| L1.3 | no-non-null-bang | AST reject `!` without guard above |
| L1.4 | no-ts-ignore | Reject `@ts-ignore`/`@ts-expect-error` without justification |
| L1.5 | no-eslint-disable-blanket | Reject disable without rule name or justification |
| L1.6 | no-empty-catch | AST reject zero-statement catch |
| L1.7 | no-production-todo | Reject TODO/FIXME/HACK/XXX in apps/{api,web}/src non-test |
| L1.8 | no-console | Reject console.* in apps/api/src |
| L1.9 | return-type-on-exports | Exported function must have explicit return type |
| L1.10 | explicit-typed-params | No implicit any parameter |
| L1.11 | pattern-error-AppError | Reject `new Error(` in apps/api/src |
| L1.12 | pattern-validation-Zod | Route using req.body without Zod parse rejected |
| L1.13 | pattern-auth-AuthContext | Service function must accept AuthContext first |
| L1.14 | pattern-logger | Must import from shared/logger.ts |
| L1.15 | db-query-hygiene | No `.select('*')`; LIMIT on multi-row; escapeLike for ILIKE |
| L1.16 | new-table-requirements | clinic_id, created_at, updated_at, deleted_at, RLS, 2+ indexes |
| L1.17 | commit-class-matches-diff | Declared Change-Class matches diff |
| L1.18 | fix-registry-delta | Exactly 1 new fix-registry row matching BUG number |
| L1.19 | down-migration-present | Migration has down() or @irreversible + runbook |
| L1.20 | scope-diff-limited | git diff --stat matches PR body enumeration |

### 12.2 Level 2 — Narrative + protocol adherence (12 checks)

**Implementation:** `scripts/qa-agent/level-2-narrative.ts`

| # | Check |
|---|---|
| L2.1 | pr-body-format — all required sections present + non-empty |
| L2.2 | diagnosis-one-sentence — ≤200 chars |
| L2.3 | classification-stated — if symptomatic, Other instances non-empty or 'none found after grep' |
| L2.4 | pattern-reference-given — APPROACH names existing file:line |
| L2.5 | implementation-no-placeholders — no TODO/placeholder/ellipsis/no-op body |
| L2.6 | tests-assert-specific — no bare toBeDefined/toBeTruthy; ≥3 assertions |
| L2.7 | verification-traces-explicit — ≥4 trace lines or explicit N/A+reason |
| L2.8 | residual-risk-honest — not 'none'; named risk + named catch |
| L2.9 | audit-points-cited — N points matching class |
| L2.10 | bug-fix-6-step-discoverable — STEP 1-6 all present |
| L2.11 | no-guess-language — reject 'I assume', 'probably', 'should work', 'likely', 'seems to' |
| L2.12 | escalation-compliance — 'I need to see X' requires read-trace or blocked-label |

### 12.3 Level 3 — Judgement review (risky-class only)

**Implementation:** Claude `code-reviewer` subagent. 7 dimensions:

1. ROOT CAUSE ACCURACY — diagnosis matches code?
2. PATTERN ADHERENCE — existing AppError/Zod/AuthContext/logger?
3. BAND-AID DETECTION — null check hiding validation? swallowed error? hiding cast?
4. STRUCTURAL IMPLICATION — whole class closed if symptomatic/structural?
5. SECURITY/CLINICAL IMPACT — defence-in-depth? audit events?
6. TEST ADEQUACY — would test catch if fix reverted?
7. RESIDUAL RISK HONESTY — realistic or cleaned-up?

Verdict per dimension: APPROVE | REQUEST_CHANGES | BLOCK. Never APPROVE if any prohibition violated.

### 12.4 Level 4 — Clinical-safety-specific

**Invoked:** any commit to `apps/api/src/features/(medications|clinical-notes|llm|scribe|ect|tms|risk|advance-directives|legal|clozapine)/`.

8 clinical rules verified (patient safety priority, critical class, AI-content discipline, append-only, traceability, PHI egress consent, break-glass integrity, graceful degradation).

### 12.5 Level 5 — Architectural standards

**Invoked:** risky commits OR commits touching shared/, db/, auth/, llm/, integrations/.

5 standards verified (defence in depth, fail fast, SSoT, explicit over implicit, reversibility).

### 12.6 Wave-exit agent (10 checks)

W1-W10: every bug closed, regression clean, guards green, catalogue updated, sign-offs, runbook referenced, incident log clean, rejection rate ≤20%, appeal rate ≤10%.

### 12.7 Pre-release agent (12 checks)

R1-R12: SBOM diff, licence allowlist, down() or @irreversible, rollback drill 7d, approver sign-offs, CAB quorum, observability enhanced, customer comms queued, kill-switch verified, staging metrics reviewed, integration health 72h green.

### 12.8 Appeal mechanism
`QA-APPEAL:` in PR body → Reviewer approves/denies. Rate tracked per wave; >20% appeals triggers CAB rule-tuning review.

### 12.9 Coverage matrix
Every principal-engineer rule maps to ≥1 QA-agent check. 100% coverage documented in sibling doc.

---

## PART 13 — EXIT CRITERIA

1. All 210 active bugs CLOSED with fix-registry rows + regression tests
2. All 36 deferred bugs labelled in feature-roadmap plan
3. All 9 closed bugs documented with reason
4. All 12 CI guards green on main
5. Playwright + a11y + probe suites green on main
6. Staging soak 7d green
7. Canary 72h green
8. Production 14d post-release green
9. BUG-243 manual test session complete + triage done
10. Post-programme review published
11. Feature roadmap scoped separately
12. QA agent appeal rate <10% programme-wide

---

## PART 14 — RESIDUAL RISK

Acknowledged, OUT OF SCOPE:
- First-customer shakedown: 10-30 new bugs first 30 prod days
- Mobile (Sara/Viva) full audit: ~20-40 bugs estimated
- External pen test (CREST): separate engagement
- External WCAG audit: separate engagement
- Clinical safety officer review: separate engagement
- Feature roadmap (ρ1-ρ6, σ, τ): ~31 weeks follow-on

---

## PART 15 — KNOWN EXECUTION RISKS (honest)

From self-critique. These WILL happen; planning accordingly:

1. **Live infrastructure chicken-and-egg.** BUG-187 is Wave A-0.2 but tests in later waves depend on the pool being fixed. Mitigation: fix scheduler leak FIRST in A-0 before anything else.

2. **QA agent self-verification chicken-and-egg.** Agent builds in A-0.9-11 but must validate its own commits. Mitigation: manual review for A-0 commits by Reviewer + Security Approver; budget catch-up lag.

3. **Scope-drift rate vs CAB latency.** 10-30% new bugs discovered mid-execution. Mitigation: async CAB for MEDIUM/LOW; sync only for S0/S1.

4. **Reviewer throughput.** 1 reviewer × 10 PRs/week ≪ executor's 5-15 PRs/day. Mitigation: batch into fix-class sweeps where possible; escalate when reviewer backlog >2 weeks.

5. **Context economics over 12 months + god-file splits.** LLM session reloads lose context. Mitigation: external state file tracking split progress; AST-rewrite tooling preferred over pure LLM for mechanical work.

**Realistic schedule:** 1.5-2× the estimate. Track A 24-30 weeks. Full programme 15-18 months.

---

# APPENDIX A — COMPLETE BUG CATALOGUE (all 255 bugs)

## Legend
- Track: A (urgent remediation) | B (sustained improvement) | C (feature delivery) | closed | deferred
- Wave: A-0 through A-4 | B-1 through B-12 | C-0 through C-8
- Severity: S0 (critical) | S1 (high) | S2 (medium) | S3 (low) | S4 (trivial)

## A.1 ACTIVE BUGS (210)

| BUG | Sev | Track | Wave | Title | File / Area |
|---|---|---|---|---|---|
| 001 | S1 | B | B-1 | buildPatientContext medications ghost column | `apps/api/src/mcp/buildPatientContext.ts` |
| 002 | S1 | B | B-1 | buildPatientContext problem list ghost column | `apps/api/src/mcp/buildPatientContext.ts` |
| 003 | S2 | B | B-3 | Architecture smoke cross-feature import | `apps/api/src/features/roles/roleFeatureRoutes.ts` |
| 005 | S1 | B | B-1 | 40+ silent catches in apps/web | apps/web/src/** |
| 006 | S2 | B | B-1 | 3 silent catches in llmRoutes | `apps/api/src/features/llm/llmRoutes.ts:290,363,422` |
| 007 | S4 | B | B-3 | guard:query-key-factories npm script | package.json |
| 008 | S4 | B | B-3 | 3 void requireEnv in integration skeletons | 4 integration clients |
| 009 | S3 | B | B-3 | 8 parseInt without radix | 2 frontend files |
| 010 | S2 | B | B-3 | SQL identifier interpolation | matviewRefreshScheduler + reset-patient-data |
| 011 | S3 | B | B-3 | patientRepository LIKE-wildcard not escaped | `apps/api/src/features/patients/patientRepository.ts:195` |
| 012 | S3 | B | B-3 | clinicalDecisionRoutes LIKE-wildcard not escaped | `apps/api/src/features/clinical-decision/clinicalDecisionRoutes.ts:80` |
| 013 | S2 | B | B-1 | rating-scale templates empty (→ migration) | `templates` table |
| 014 | S2 | B | B-1 | clinical_templates empty (→ migration) | `clinical_templates` table |
| 015 | S4 | B | B-3 | vitest test npm script missing | apps/web/package.json |
| 016 | S4 | B | B-3 | nousdev stray in archive doc | `docs/archive/phase-0.5-rename-runbook.md:124` |
| 018 | S3 | B | B-3 | 4 missing indexes on patient_id FKs | oauth tokens + smart_launch_contexts |
| 020 | S0 | A | A-3 | Correspondence patient/staff read without clinic_id | `correspondenceRoutes.ts:54,55` |
| 021 | S0 | A | A-3 | audit_runs UPDATE without clinic_id | `reportsRoutes.ts:564` |
| 022 | S0 | A | A-3 | audit_templates read without clinic_id | `reportsRoutes.ts:568` |
| 023 | S0 | A | A-3 | billingRepository UPDATE without clinic_id | `billingRepository.ts:148` |
| 024 | S0 | A | A-3 | backupRoutes UPDATE without clinic_id | `backupRoutes.ts` |
| 025 | S1 | B | B-2 | E2E seed users don't exist | `apps/api/src/seed-e2e-fixtures.ts` |
| 026 | S2 | C | C-1→C-8 | 65 Tier 12-19 endpoints no UI | — |
| 028 | S1 | B | B-2 | Patient-detail tab cascade (no seeded patient) | E2E fixtures |
| 029 | S2 | B | B-2 | 10 axe a11y violations across key surfaces | apps/web/** |
| 030 | S2 | B | B-2 | /handover + /nursing + /case-management fail quick-assertion | apps/web/src/features/* |
| 031 | S1 | B | B-2 | new-patient-journey workflow cascade | `e2e/workflows/new-patient-journey.spec.ts` |
| 032 | S1 | A | A-1 | Login → dashboard redirect fails | Auth flow |
| 033 | S1 (from S4) | A | A-0 | Integration runner doesn't walk subdirs | `apps/api/scripts/run-integration-tests.mjs` |
| 034 | S0 | A | A-2 | AI prompt still asks for diagnosis | `ambientProcessor.ts` + `llmRoutes.ts` |
| 035 | S0 | A | A-2 | Recording consent NOT enforced at /ambient-note | `llmRoutes.ts:431` |
| 036 | S0 | A | A-2 | Cross-patient contamination (no requirePatientRelationship) | llmRoutes |
| 037 | S0 | A | A-2 | AI model_version+temperature+pipeline not logged | `llm_interactions` |
| 038 | S0 | A | A-2 | /suggest + /clinical-ai missing clinical disclaimer | `llmController.ts:72-121` |
| 039 | S0 | A | A-2 | audit_log REVOKE UPDATE/DELETE not enforced | baseline migration |
| 040 | S0 | A | A-2 | Psychologist prescribing barrier not DB-enforced | prescriptions CHECK |
| 042 | S0 | A | A-2 | SIGTERM graceful shutdown missing | `server.ts` |
| 043 | S0 | A | A-2 | Silent MOCK fallback integrations in production | every `integrations/*/` |
| 044 | S1 | B | B-3 | check_in_time column missing | `appointments` table |
| 045 | S1 | B | B-3 | observed_at ghost column in shift handover | `nurseFeatureRoutes.ts:373-375` |
| 046 | S1 | B | B-3 | observations handler notes→risk_concerns conflation | `nurseFeatureRoutes.ts:310-323` |
| 047 | S1 | A | A-3 | Clinical formulations GET missing requirePatientRelationship | `psychiatristFeatureRoutes.ts:186-223` |
| 048 | S1 | A | A-3 | clinical_formulations confidentiality NOT RLS-enforced | DB + psychiatristFeatureRoutes |
| 049 | S1 | B | B-9 | Integration health framework missing | `apps/api/src/integrations/` |
| 050 | S1 | B | B-6 | Frontend god files (MedicationsTab 3215, SummaryTab, VivaTab, ReportsPage) | apps/web/src/features/patients/components/detail/tabs/* |
| 051 | S1 | B | B-7 | Inconsistent HTTP error envelope | apps/api/src/features/** |
| 052 | S1 | B | B-7 | APPOINTMENT_COLUMNS hardcoded across 5+ files | apps/api/src |
| 053 | S1 | B | B-7 | Response envelope inconsistency | apps/api/src/features/** |
| 054 | S1 | B | B-9 | Health check doesn't cover DB+Redis+integrations | `server.ts` |
| 055 | S1 | B | B-8 | MAR no allergy re-check at admin time | `nurseFeatureRoutes.ts:78-131` |
| 056 | S1 | B | B-3 | Contacts KPI missing Zod period validation | `managerFeatureRoutes.ts:51-91` |
| 057 | S1 | B | B-8 | Patient ID capture no audit trail | `patientRoutes.ts` attachments |
| 059 | S1 | B | B-8 | File upload missing MIME validation | patient attachments |
| 060 | S1 | B | B-8 | 40+ blocking fs.*Sync in request handlers | multiple |
| 061 | S1 | B | B-3 | Seed files hardcode PHI + no NODE_ENV guard | seed-test-data, erx001-sample-for-xsd |
| 062 | S1 | B | B-7 | 223 console.log instances bypassing logger | apps/api/src |
| 063 | S1 | B | B-8 | LWW concurrent edit race (extend optimistic lock to episodes/prescriptions/medications) | 3 tables |
| 065 | S2 | B | B-3 | SSE idle uses `>` instead of `>=` | `sseRoutes.ts:100` |
| 066 | S2 | B | B-7 | 25 eslint-disable no-console without rationale | apps/api/src |
| 067 | S2 | B | B-3 | 2 @ts-expect-error in integration clients lack rationale | 2 integration clients |
| 068 | S2 | B | B-7 | Soft-delete inconsistency on 10 tables | CLAUDE.md §1.4 list |
| 069 | S2 | B | B-3 | SELECT * in caseManagerFeatureRoutes CTE | `caseManagerFeatureRoutes.ts:110` |
| 070 | S2 | B | B-1 | buildPatientContext N+1 query pattern | `buildPatientContext.ts` |
| 071 | S2 | A | A-3 | canSeeFormulation missing clinic_id | formulations service |
| 072 | S2 | A | A-3 | Drug interaction missing requirePatientRelationship | `psychiatristFeatureRoutes.ts:96-155` |
| 073 | S2 | B | B-8 | Staff leave NOT enforced on appointment scheduling | appointments |
| 074 | S2 | C | C-2 | Director governance routes (10 endpoints) missing | new directorFeatureRoutes |
| 076 | S2 | B | B-8 | MFA not mandatorily enforced for clinical roles | auth |
| 077 | S2 | B | B-8 | Clinic-settings PATCH change-logging missing | clinicSettings |
| 078 | S3 | B | B-3 | Clinic_settings no UNIQUE on clinic_id | `clinic_settings` |
| 079 | S3 | B | B-8 | AI feature kill-switch missing | clinic_settings |
| 080 | S3 | B | B-8 | Data retention policy table missing | new table |
| 081 | S3 | B | B-7 | Cache TTL / eviction missing | various caches |
| 082 | S3 | B | B-7 | Patient-list over-fetching (SELECT all cols) | patientRepository list |
| 083 | S3 | B | B-8 | Critical alert SLA framework missing | new table |
| 084 | S3 | B | B-9 | eScript integration health check missing | escriptService |
| 085 | S4 | B | B-8 | Model version locking not per-clinic | ai models |
| 088 | S0 | A | A-3 | org_units UPDATE cross-tenant | `orgSettingsRepository.ts:103` |
| 089 | S0 | A | A-3 | org_units DELETE cross-tenant | `orgSettingsRepository.ts:109` |
| 090 | S0 | A | A-3 | programs UPDATE cross-tenant | `orgSettingsRepository.ts:161` |
| 091 | S0 | A | A-3 | programs DELETE cross-tenant | `orgSettingsRepository.ts:165` |
| 092 | S0 | A | A-3 | Outlook OAuth state staff-token injection | `outlookRoutes.ts:64-70` |
| 093 | S0 | A | A-3 | Outlook disconnect cross-tenant | `outlookRoutes.ts:82-89` |
| 094 | S0 | A | A-3 | patient_team_assignments cross-tenant UPDATE | `patientRoutes.ts:276-278` |
| 095 | S0 | A | A-3 | patientRepository create encryption drops fields | `patientRepository.ts:125` |
| 096 | S0 | A | A-3 | patientRepository list decrypt drops fields | `patientRepository.ts:217` |
| 097 | S1 | B | B-5 | appointmentService invoice raw cast | `appointmentService.ts:485` |
| 098 | S1 | B | B-8 | blobStorage fs sync in request handler | `shared/blobStorage.ts:114,123-124,139,148` |
| 099 | S1 | B | B-8 | backupRoutes fs sync in list handler | `backupRoutes.ts:337-347` |
| 100 | S2 | B | B-9 | JWT rotation policy + patient-app 30d refresh | `authService.ts` + `patientAppRoutes.ts:396-400` |
| 101 | S1 | A | A-1 | hl7Worker void buildOrmO01 (subsumed by BUG-238) | `hl7Worker.ts:132` |
| 102 | S1 | B | B-6 | Backend god files (patientRoutes 1450, patientAppRoutes 1241, scribeRoutes 1110, etc.) | apps/api/src/features/* |
| 103 | S1 | B | B-7 | 3 circular deps in eScript integration | `integrations/escript/*` |
| 104 | S1 | B | B-7 | 335 direct db() calls in route files (bypass repo pattern) | apps/api/src/features/**/*Routes.ts |
| 105 | S2 | B | B-7 | 10 direct fetch() calls bypass apiClient | apps/web/src |
| 106 | S2 | B | B-7 | File-naming convention split (camelCase vs dot-notation) | apps/api/src/features |
| 107 | S3 | B | B-3 | Broken filename `patientRoutes.ts ts` | `apps/api/src/features/patients/` |
| 108 | S1 | B | B-9 | 13 hard-coded `.limit(N)` with no pagination | various endpoints |
| 109 | S1 | B | B-11 | Frontend has ~0 unit-test coverage | apps/web/src (243 components, 2 tests) |
| 110 | S1 | A | A-0 | Integration runner silent tier tests (merged with BUG-033) | apps/api/scripts |
| 111 | S2 | B | B-11 | 5 of 7 E2E discovery probes never execute in CI | e2e/probes/ |
| 112 | S3 | B | B-11 | No shared fixture-builder | apps/api/tests/ |
| 113 | S3 | B | B-11 | Playwright retries + flakiness tracking absent | playwright.config.ts |
| 114 | S2 | B | B-7 | Guard scripts split across 2 locations | `.github/scripts` + `scripts/guards` |
| 115 | S1 | A | A-4 | a11y CI dry-run default | `.github/workflows/ci.yml:722` |
| 116 | S1 | A | A-4 | `npm audit --omit=dev \|\| true` non-blocking | ci.yml |
| 117 | S2 | A | A-4 | No CI licence-allowlist gate | ci.yml |
| 118 | S2 | B | B-9 | Two competing deploy workflows | deploy.yml + azure-deploy.yml |
| 119 | S1 | A | A-4 | deploy.yml npm audit continue-on-error | deploy.yml:194 |
| 120 | S2 | B | B-9 | Postgres version drift (16 vs 17) | deploy.yml vs ci.yml |
| 121 | S1 | A | A-4 | deploy.yml stray DB literals | deploy.yml:113-151 |
| 122 | S3 | B | B-9 | azure-deploy sleep 120 | azure-deploy.yml:179 |
| 123 | S1 | A | A-4 | Nightly workflow 100% dry-run (DR drill unproven) | nightly.yml |
| 124 | S1 | A | A-4 | Trivy scans exit-code:0 non-blocking | deploy.yml + nightly.yml |
| 125 | S3 | B | B-11 | AWS SDK modules in Azure-deployed product audit | 41 @aws-sdk packages |
| 126 | S1 | A | A-4 | Zero modern secret-scanning | repo root |
| 127 | S1 | A | A-4 | No git-history scrub runbook | docs/runbooks/ |
| 128 | S1 | B | B-10 | ~142 `.returning('*')` sites → explicit columns | apps/api/src |
| 129 | S1 | B | B-10 | 59 unvalidated POST/PATCH endpoints | apps/api/src/features |
| 130 | S2 | B | B-10 | 21 ghost-table handlers `TODO(Phase F)` | roles/*FeatureRoutes |
| 131 | S2 | B | B-10 | Repository translation layers for dropped cols | apps/api/src/features |
| 132 | S1 | A | A-2 | Wire detectScribeHallucinations into ambient save | ambientProcessor |
| 133 | S1 | A | A-2 | Wire sanitizeLlmInput across all LLM paths | llmRoutes + scribeRoutes |
| 134 | S2 | B | B-10 | Add llm_model + llm_metadata columns | clinical_notes |
| 135 | S1 | A | A-2 | AI agent patient-context validation | llm routes + services |
| 136 | S2 | B | B-8 | Staff leave table + scheduling block | new table |
| 137 | S2 | B | B-8 | Capacity / utilisation reporting | new reports |
| 138 | S2 | B | B-8 | SAR (Subject Access Request) workflow | new module |
| 139 | S2 | B | B-10 | Patient list response shape reconciliation | patientRoutes |
| 140 | S2 | B | B-10 | Contract tests per response shape | tests |
| 143 | S2 | A | A-4 | IR tabletop exercise | docs/runbooks |
| 144 | S3 | A | A-4 | Staging env provisioning | infra |
| 173 | S2 | C | C-4 | AI-DRAFT banner persistent until signed | letters composer |
| 174 | S1 | A | A-2 | AI Chat disclaimer (disclaimer part) | llmController |
| 174-B | S2 | B | B-8 | AI Chat prescribing classifier | llmController |
| 180 | S2 | A | A-0 | 37 TODO/FIXME/HACK triage | apps/api + apps/web |
| 181 | S2 | A | A-3 | /medications/mar missing requirePatientRelationship | medicationRoutes |
| 182 | S2 | A | A-3 | /reports/admin-overview missing requireRoles | reportsRoutes |
| 183 | S3 | B | B-10 | Persona matrix missing routes (Psychologist) | docs + routes |
| 184 | S3 | B | B-10 | Top-level README.md missing | repo root |
| 185 | S3 | B | B-10 | Outdated architecture doc | docs/gold-standard-reports/ |
| 186 | S2 | B | B-10 | AppointmentsPage POST missing fields | AppointmentsPage.tsx:395-402 |
| 187 | S0 | A | A-0 | Postgres pool exhaustion + no statement_timeout | `db/index.ts` |
| 188 | S1 | B | B-9 | Matview refresh schedule no overlap protection | `matviewRefreshScheduler.ts` |
| 189 | S1 | B | B-9 | Matview staleness invisible to clinicians | dashboard widgets |
| 190 | S1 | B | B-9 | Knex + pgBouncer prepared-statement conflict | pgBouncer config |
| 191 | S1 | B | B-9 | int4 sequence on high-write tables audit | schema audit |
| 192 | S1 | B | B-9 | timestamp without timezone DST drift | migrations |
| 193 | S2 | B | B-9 | NOT VALID constraints never enforced | migrations audit |
| 194 | S1 | B | B-9 | Autovacuum falls behind on UPDATE-heavy tables | Postgres config |
| 195 | S2 | B | B-9 | pg_stat_statements not enabled | Postgres config |
| 196 | S3 | B | B-9 | idx_scan=0 indexes accumulating | monthly report |
| 197 | S0 | A | A-0 | Redis maxmemory-policy default noeviction | redis.conf |
| 198 | S1 | B | B-9 | Redis pub/sub loses messages on disconnect | SSE routes |
| 199 | S1 | B | B-9 | Cache stampede on hot key expiry | cache layer |
| 200 | S1 | B | B-9 | BullMQ jobs retry immediately (no backoff) | every worker |
| 201 | S1 | B | B-9 | BullMQ no priority tier | workers |
| 202 | S0 | A | A-4 | BullMQ duplicate enqueue | every queue.add |
| 203 | S1 | B | B-9 | No distributed lock for cron schedulers | schedulers |
| 204 | S2 | B | B-9 | Redis cross-tenant leak via key naming | cache helpers |
| 205 | S0 | A | A-4 | No HTTP request-timeout middleware | server.ts |
| 206 | S1 | B | B-9 | Body-size limit global only | server.ts + routes |
| 207 | S2 | B | B-9 | No gzip/brotli compression | server.ts |
| 208 | S2 | B | B-9 | HTTP keep-alive not tuned for integrations | integration clients |
| 209 | S2 | B | B-9 | No Retry-After on 429 | rate-limit middleware |
| 210 | S2 | B | B-9 | No ETag on GET endpoints | middleware |
| 211 | S3 | B | B-9 | No content-negotiation for exports | export endpoints |
| 212 | S3 | B | B-9 | No API versioning beyond /api/v1 | all routes |
| 213 | S1 | B | B-9 | pino-roll missing (disk fill risk) | logger config |
| 214 | S2 | B | B-9 | Log levels not per-module | logger config |
| 215 | S1 | B | B-9 | OTEL traces unbounded | observability |
| 216 | S0 | A | A-2 | PHI in structured logs (redact expansion) | pino redact config |
| 217 | S2 | B | B-9 | Request-ID not propagated to integrations | integration clients |
| 218 | S3 | B | B-9 | Error codes free-form | apps/api/src |
| 219 | S1 | B | B-9 | JWT kid rotation runtime missing | authService |
| 220 | S0 | A | A-2 | Refresh-token family invalidation + grace | authService |
| 221 | S1 | B | B-9 | Cookie SameSite per-context | smartAuth |
| 222 | S2 | B | B-9 | CSP violations no report endpoint | security headers |
| 223 | S2 | B | B-9 | No SRI on CDN assets | apps/web |
| 224 | S2 | B | B-9 | X-Frame vs CSP frame-ancestors mismatch | security headers |
| 225 | S1 | B | B-9 | Password-reset token binding audit | password reset |
| 226 | S2 | B | B-9 | SSRF allowlist guard on outbound HTTP | validateOutboundUrl guard |
| 227 | S1 | B | B-9 | DST cron UTC enforcement | schedulers |
| 228 | S2 | B | B-9 | Non-BMP Unicode in patient names | varchar columns |
| 229 | S1 | B | B-9 | HL7 ACK format matrix test | pathology integration |
| 230 | S2 | B | B-9 | FHIR R4 → R5 versioned serialisers | fhir integration |
| 231 | S2 | B | B-9 | audit_log timezone consistency | audit log |
| 232 | S0 | A | A-4 | Migration lock unlock runbook | docs/runbooks |
| 233 | S0 | A | A-4 | Env validator startup assertion | config.ts |
| 234 | S0 | A | A-4 | Certificate expiry monitoring dashboard | ops |
| 235 | S0 | A | A-4 | DR drill with encrypted PHI + key rotation | nightly + backup |
| 236 | S2 | B | B-9 | Observability budget (OTEL sampling) | otel config |
| 237 | S2 | C | C-8 | Patient batch endpoint | new endpoint |
| 238 | S0 | A | A-1 | HL7 orders NEVER transmitted to labs | `hl7Worker.ts:139` |
| 239 | S0 | A | A-1 | WebAuthn crypto is a placeholder | `webauthnRoutes.ts:143,237` |
| 240 | S1 | C | C-0 | Mobile patient register never submits | `register_screen.dart:64` |
| 241 | S1 | B | B-1 | 14 queryKey factory method TODOs | apps/web/src/features/** |
| 242 | S2 | B | B-10 | Phase F SD56/SD58 nurse-feature writes disabled | `nurseFeatureRoutes.ts:324,641` |
| 243 | S2 | B | B-12 | Manual test session (37 scenarios) meta | clinician + engineer |
| 244 | S2 | B | B-10 | ISMS SoA + Risk Treatment Plan | docs/governance |
| 245 | S2 | B | B-10 | SNOMED-CT / NCTS terminology integration | integrations/terminology |
| 246 | S2 | B | B-10 | NDB notification workflow | new workflow |
| 247 | S2 | B | B-10 | Data sharing agreement UI | new feature |
| 248 | S2 | B | B-10 | STRIDE threat model doc | docs/governance |
| 249 | S2 | B | B-10 | Children's privacy controls | auth + patient |
| 250 | S1 | A | A-2 | MFA-config existence disclosure | `authRoutes.ts:131` |
| 251 | S3 | B | B-7 | AppError migration (subsumed by BUG-051) | apps/api/src |
| 252 | S3 | B | B-10 | Verify no runtime db.schema.createTable | apps/api/src |
| 253 | S1 | A | A-3 | Mass-assignment on PATCH endpoints | apps/api/src/features |
| 254 | S1 | A | A-3 | IDOR within-clinic cross-caseload | read paths |
| 255 | S1 | B | B-3 | CSV export formula injection | csv exports |
| 256 | S2 | B | B-11 | useEffect cleanup audit (73 hooks) | apps/web/src |
| 257 | S2 | B | B-8 | Email/SMS template XSS via interpolation | integrations/acs, notifications/templates |
| 258 | S3 | B | B-8 | PDF renderer format-string / control-char | pdfGenerator.ts |
| 259 | S2 | B | B-8/C-2 | Break-glass abuse detection | scheduled task + dashboard tile |

## A.2 CLOSED BUGS (9)

| BUG | Reason |
|---|---|
| 004 | Cascade resolved by BUG-032 + BUG-025 (auth baseline 17s timeout) |
| 017 | False positive — patient_active_specialties is a view, not table |
| 019 | Placeholder ID; duplicate of BUG-018 |
| 041 | HAZARD-006 closed — clinical_note_versions + optimistic locking + audit hash chain |
| 058 | Duplicate of BUG-010 |
| 064 | Duplicate of BUG-011/BUG-012 |
| 075 | GAP-20 closed — session_tokens + max-5 + session-tree implemented |
| 087 | Duplicate of BUG-009 |
| 153 | GAP-08 closed — audit_log already monthly-partitioned |

## A.3 DEFERRED BUGS (36)

| BUG | Title | Phase |
|---|---|---|
| 027 | Sara/Viva mobile Tier 12-19 integration gap | σ (scribe) |
| 086 | Offline mode not implemented | ρ6 |
| 141 | Windows Server packaging | τ1 |
| 142 | Azure Key Vault secrets backend | τ2 |
| 145 | LLM/Whisper runs in same Express process | ρ1 |
| 146 | Report generation synchronous 180s timeout | ρ1 |
| 147 | AI clinical actions no validation layer | ρ1 |
| 148 | Dashboard KPIs polled every 2 min (→ SSE) | ρ1 |
| 149 | Patient arrival / task / pathology / medication no real-time notification | ρ1 |
| 150 | Manual `as any` in repositories (handled partly in B-5) | ρ2 |
| 151 | Patient search uses ILIKE %name% (slow) | ρ2 |
| 152 | Clinical notes / formulations / letters have NO search | ρ2 |
| 154 | No index hygiene monitoring | ρ2 |
| 155 | Task assignment uses UUID input instead of staff picker | ρ3 |
| 156 | Medication search free-text (no PBS autocomplete) | ρ3 |
| 157 | Referral assignment raw dropdown | ρ3 |
| 158 | 19 flat tabs cognitive overload | ρ3 |
| 159 | WCAG 2.1 AA partial (external audit scope) | ρ3 |
| 160 | Medicare ECLIPSE not started | ρ4 |
| 161 | SafeScript stub only | ρ4 |
| 162 | My Health Record not started | ρ4 |
| 163 | eRx stub only | ρ4 |
| 164 | FHIR R4 only 4 resources (expand) | ρ4 |
| 165 | NDIS Myplace Portal not started | ρ4 |
| 166 | 4-eyes principle for destructive actions | ρ5 |
| 167 | Full DB not encrypted at rest (TDE) | ρ5 |
| 168 | No automated backup-verification restore test | ρ5 |
| 169 | Recording-active indicator (red dot + audio cue) | σ |
| 170 | Data residency enforcement wired | σ |
| 171 | Cross-clinician review-and-adopt workflow | σ |
| 172 | TGA non-device classification evidence | σ |
| 175 | Patient-viewable transcript + post-visit summary delivery | σ |
| 176 | Family/interpreter role labels in diarisation | σ |
| 177 | Real-time PII redaction of PHI | σ |
| 178 | C1-C10 scribe differentiation features (10 items) | σ |

---

# APPENDIX B — FILE MANIFEST PER WAVE (high-level)

## Wave A-0 touches
- `apps/api/src/db/index.ts` (BUG-187)
- `infra/redis.conf` + `docker-compose.yml` (BUG-197)
- `apps/api/src/db/schema-snapshot.json` (regen)
- `apps/api/scripts/run-integration-tests.mjs` (BUG-033/110)
- `docs/audit-2026-04-19/bug-catalogue-v2.md` (NEW)
- `scripts/qa-agent/level-1-static.ts` (NEW)
- `scripts/qa-agent/level-2-narrative.ts` (NEW)
- `.github/pull_request_template.md` (NEW)
- `.husky/pre-commit` (NEW)
- `docs/runbooks/rollback-{dev,staging,canary,production}.md` (NEW ×4)
- `docs/governance/role-register.md` (NEW)
- `.github/workflows/ci.yml` (new QA agent jobs)

## Wave A-1 through A-4 touches
See individual BUG entries in APPENDIX A for file:line.

## Track B sprint touches
See PART 2.3 sprint scope + APPENDIX A for per-bug file:line.

## Track C touches
- `apps/web/src/router.tsx` + `Sidebar.tsx` (route registration per sub-wave)
- `apps/patient-app/lib/features/auth/register_screen.dart` (BUG-240)
- new frontend surfaces per sub-wave

---

END OF EXECUTION PLAN v3.0 — DOWNLOADABLE EDITION

Generated: 2026-04-19
Authoritative at: `docs/audit-2026-04-19/EXECUTION-PLAN-v3-FULL.md`
Companion doc: `.claude/plans/sleepy-roaming-meteor.md` (planning-session artefact)
