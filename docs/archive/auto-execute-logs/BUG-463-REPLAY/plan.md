# Plan — BUG-463 REPLAY: JWT-payload Discriminated Union + Remove Middleware `as unknown as` Casts

[Plan agent invocation 2026-04-25 per `~/.claude/plans/sleepy-roaming-meteor.md` PART 2 §B; first-principles re-derivation per PART 6.1 — no cherry-pick from reverted commit `3fd674c`.]

**Severity:** S1 deploy-blocker (pre-staging)
**Reverted commit (do NOT re-read):** `3fd674c` — superseded by atomic revert `a475e32` 2026-04-24
**Replay queue position:** PART 1 Tier-3 #14 (after BUG-437)
**Sibling shipped at HEAD:** BUG-430-PATIENT-APP (`358038d`) — introduced `requirePatientOwnership` dual-mode helper; this plan MUST preserve `req.user.isPatientApp` + `req.user.patientId` semantics.

---

## 0. Why a discriminated union

Today `req.user` is typed `AuthUser | undefined` where `AuthUser` (`packages/shared/src/auth.schemas.ts:17-32`) is a single flat shape with `id, clinicId, role, permissions, givenName, familyName, email, patientId?, isPatientApp?`. Auth-related claims that DON'T live on every JWT — `breakGlass`, `breakGlassSessionId`, `impersonator`, `impersonationSessionId`, plus the `patientId/isPatientApp` pair — are stamped onto the JWT at issuance by three issuers (`authService.issueTokens` at `apps/api/src/features/auth/authService.ts:60-78`, `breakGlassRoutes.ts:274-287`, `adminImpersonationRoutes.ts:85-98`, and `patientAppRoutes.ts:401-410`) but are NOT in `AuthUserSchema`. Reading them off `payload` or `req.user` therefore requires `as unknown as { ... }` shape-extension casts that bypass the type system.

Two structural problems flow from the flat shape:

1. **No compile-time ownership guarantee.** Patient-app code reading `req.user.id` may legitimately have `req.user.patientId` set, but staff code can also read `patientId` without TypeScript catching it as semantically wrong. The dual-mode `requirePatientOwnership` helper (`shared/authGuards.ts:473-575`) currently runtime-discriminates via `user.isPatientApp === true`, which is the right discriminator — we just need to make it a TS discriminator too.

2. **Cast contagion.** Each new optional claim drives a new `as unknown as` cast. Today there are 9 in middleware (this BUG's scope), but the same pattern radiates into `mcp/scribeStreaming.ts`, `features/auth/*`, and any future cross-cutting middleware. The discriminated union closes the class.

Per PART 6.1 principle 2, the discriminated union is the gold-standard fix for this class — not a string-literal-tagged extension type, not a type-guard helper.

---

## 1. Current state — ground-truth grep + Read

### 1.1 No `apps/api/src/utils/authTokens.ts` exists

Verified: `Glob apps/api/src/**/authTokens*` returns 0 hits. The bugs-remaining.md row's reference to `authTokens.ts` is an aspirational name — this BUG MUST CREATE the file as the SSoT module for the discriminated union and the typed `verifyAccessToken` helper.

### 1.2 `AuthUser` SSoT — `packages/shared/src/auth.schemas.ts:17-32`

```ts
export const AuthUserSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  givenName: z.string(),
  familyName: z.string(),
  email: z.string().email().nullable().optional(),
  role: RoleEnum,
  permissions: z.array(PermissionEnum).optional(),
  patientId: z.string().uuid().nullable().optional(),
  isPatientApp: z.boolean().optional(),
});
export type AuthUser = z.infer<typeof AuthUserSchema>;
```

Notably absent (the source of the casts): `breakGlass`, `breakGlassSessionId`, `impersonator`, `impersonationSessionId`. The casts in middleware exist precisely because these claims are JWT-stamped but not in the schema.

### 1.3 `req.user` ambient type — `apps/api/src/types/express.d.ts:3-21`

`req.user` is currently typed as `AuthUser | undefined`. Same flat shape, same gap.

### 1.4 `AuthContext` SSoT — `packages/shared/src/authContext.ts:18-43`

`AuthContext` is the SERVICE-LAYER auth surface (built from `req` via `buildAuthContext`). Already includes `breakGlassSessionId?: string`. **Out of scope for BUG-463**.

### 1.5 The 10 cast sites — site-by-site

Grep run: `Grep "as unknown as" path=apps/api/src/middleware -n true` → 9 hits across 3 files. Plus 1 closely-adjacent at `mcp/scribeStreaming.ts:167` reading the SAME JWT-payload shape during WS upgrade.

#### Site M1 — `apps/api/src/middleware/authMiddleware.ts:83`
- Cast target: `payload.patientId` + `payload.isPatientApp`.
- Replacement: `payload.kind === 'patient_app'` narrows non-optional.
- Load-bearing: YES — populates `user.patientId` + `user.isPatientApp` for `requirePatientOwnership`.

#### Sites M2-M3 — `apps/api/src/middleware/authMiddleware.ts:95,97`
- Cast target: `payload.breakGlass` + `payload.breakGlassSessionId`.
- Replacement: `payload.kind === 'staff_break_glass'` narrows.
- Load-bearing: YES — populates audit fields.

#### Sites M4-M5 — `apps/api/src/middleware/authMiddleware.ts:103,105`
- Cast target: `payload.impersonator` + `payload.impersonationSessionId`.
- Replacement: `payload.kind === 'staff_impersonation'` narrows.
- Load-bearing: YES.

#### Sites M6-M7 — `apps/api/src/middleware/breakGlassAuditMiddleware.ts:45,46`
- Cast target: `req.user.breakGlassSessionId` + `req.user.breakGlass`.
- Replacement: typed-optional read on `AuthRequestUser` projection.
- Load-bearing: YES.

#### Sites M8-M9 — `apps/api/src/middleware/adminImpersonationAuditMiddleware.ts:41,43`
- Cast target: `req.user.impersonationSessionId` + `req.user.impersonator`.
- Replacement: typed-optional read.
- Load-bearing: YES.

#### Site M10 — `apps/api/src/mcp/scribeStreaming.ts:167`
- Cast target: `payload.breakGlassSessionId` during WS-upgrade.
- Replacement: `payload.kind === 'staff_break_glass' ? payload.breakGlassSessionId : undefined`.
- Load-bearing: YES.

**Total: 10 cast sites across 4 files.**

### 1.6 NOT in scope (explicit exclusions)

- `apps/api/src/middleware/moduleAccessMiddleware.ts:101` — narrow read, not `as unknown as`. EXCLUDE.
- `apps/api/src/features/calendar/calendarController.ts:26` — same. EXCLUDE.
- `apps/api/src/features/patient-app/patientAppRoutes.ts:1000,1059,1092,1127,1208` — narrow reads (NOT `as unknown as`). After this BUG lands they become removable; tracked as **BUG-463-FU**.
- `apps/api/src/features/auth/authController.ts:86` — DTO unwrap, not JWT-payload. EXCLUDE.

---

## 2. BUG-430-PATIENT-APP preservation contract

### 2.1 What `requirePatientOwnership` reads — `apps/api/src/shared/authGuards.ts:473-575`

The helper depends on FOUR fields off `req.user`: `id, isPatientApp, patientId, clinicId`. The discriminated union MUST ensure:
- When `req.user.kind === 'patient_app'` (or projected `isPatientApp === true`), `patientId` is **non-optional `string`**.
- `clinicId` remains non-optional in BOTH variants.
- `isPatientApp` stays as a boolean field on the projection — runtime-equivalent to today.

### 2.2 Patient-app JWT issuance — `apps/api/src/features/patient-app/patientAppRoutes.ts:401-410`

```ts
const tokenPayload = {
  id: account.id,
  patientId: account.patient_id,
  clinicId: account.clinic_id,
  givenName: patient?.given_name,
  familyName: patient?.family_name,
  role: 'patient',
  isPatientApp: true,
};
```

The `patient_app` variant must mirror this exactly. `kind: 'patient_app'` is INFERRED by `discriminate()` from `isPatientApp === true && typeof patientId === 'string'`.

### 2.3 Constraint: no behavioral change

Branch A (patient-app) and Branch B (staff via `requirePatientRelationship`) remain bit-identical. Type narrowing is additive.

---

## 3. Discriminated-union shape

### 3.1 Variant inventory

| Variant tag | Issued by | Required claims |
|---|---|---|
| `staff` | `authService.issueTokens` | `id, clinicId, role, permissions, givenName, familyName, email, jti, iat, exp` |
| `staff_break_glass` | `breakGlassRoutes.ts:274-287` | staff fields + `breakGlass: true, breakGlassSessionId: string` |
| `staff_impersonation` | `adminImpersonationRoutes.ts:85-98` | staff fields + `impersonator: string, impersonationSessionId: string` |
| `patient_app` | `patientAppRoutes.ts:401-410` | `id, patientId, clinicId, givenName?, familyName?, role: 'patient', isPatientApp: true` |

### 3.2 SSoT location — `apps/api/src/utils/authTokens.ts` (NEW)

Server-only. Frontend doesn't need the JWT-payload type (reads `AuthUser` via `/me`).

### 3.3 Proposed shape

```ts
export interface StaffAccessClaims extends StaffBaseClaims { kind: 'staff'; }
export interface StaffBreakGlassAccessClaims extends StaffBaseClaims { kind: 'staff_break_glass'; breakGlass: true; breakGlassSessionId: string; }
export interface StaffImpersonationAccessClaims extends StaffBaseClaims { kind: 'staff_impersonation'; impersonator: string; impersonationSessionId: string; }
export interface PatientAppAccessClaims extends BaseClaims { kind: 'patient_app'; id: string; patientId: string; clinicId: string; role: 'patient'; givenName?: string; familyName?: string; isPatientApp: true; }
export type AccessTokenPayload = StaffAccessClaims | StaffBreakGlassAccessClaims | StaffImpersonationAccessClaims | PatientAppAccessClaims;

export function verifyAccessToken(token: string): AccessTokenPayload {
  const raw = jwt.verify(token, config.jwt.accessSecret) as Record<string, unknown> & BaseClaims;
  return discriminate(raw);
}

export function discriminate(raw: Record<string, unknown> & BaseClaims): AccessTokenPayload {
  if (raw.isPatientApp === true && typeof raw.patientId === 'string') return { ...raw, kind: 'patient_app' } as PatientAppAccessClaims;
  if (raw.breakGlass === true && typeof raw.breakGlassSessionId === 'string') return { ...raw, kind: 'staff_break_glass' } as StaffBreakGlassAccessClaims;
  if (typeof raw.impersonator === 'string' && typeof raw.impersonationSessionId === 'string') return { ...raw, kind: 'staff_impersonation' } as StaffImpersonationAccessClaims;
  return { ...raw, kind: 'staff' } as StaffAccessClaims;
}
```

**Mutually-exclusive flag policy:** `discriminate()` should reject (throw or hard-classify) any payload with both `isPatientApp: true` AND `breakGlass: true`. Per L4 §7.1 below; defence-in-depth at the verification boundary.

### 3.4 `req.user` ambient type — flat projection

```ts
// apps/api/src/types/express.d.ts (UPDATED)
type AuthRequestUser = AuthUser & {
  breakGlass?: boolean;
  breakGlassSessionId?: string;
  impersonator?: string;
  impersonationSessionId?: string;
};
```

**Two-tier design:** discriminated union at the verification boundary (precision); flat projection on `req.user` (low churn — no cascade into hundreds of route handlers).

### 3.5 Migration mode — issuance side

`discriminate()` infers `kind` from existing fields. **No issuance change required for cast removal to land.** Future BUG-463-FU stamps `kind` directly at sign time for explicit-tagging cleanliness.

### 3.6 Why this minimises downstream churn

- `AuthUser` (shared) UNCHANGED.
- `req.user` projection adds 4 OPTIONAL fields — readers using only staff fields unaffected.
- Server-only discriminated union behind `verifyAccessToken`.
- Issuance UNCHANGED.
- `requirePatientOwnership` continues to read `user.isPatientApp + user.patientId` against the typed projection.

---

## 4. Cast-removal site map

| Site | Today | After |
|---|---|---|
| M1 (`authMiddleware.ts:83`) | `as unknown as { patientId?, isPatientApp? }` | `payload.kind === 'patient_app'` narrowing. |
| M2-M3 (`authMiddleware.ts:95,97`) | `as unknown as { breakGlass?, breakGlassSessionId? }` | `payload.kind === 'staff_break_glass'` narrowing. |
| M4-M5 (`authMiddleware.ts:103,105`) | `as unknown as { impersonator?, impersonationSessionId? }` | `payload.kind === 'staff_impersonation'` narrowing. |
| M6-M7 (`breakGlassAuditMiddleware.ts:45,46`) | `req.user as unknown as { breakGlass?, breakGlassSessionId? }` | Direct read on typed-optional projection. |
| M8-M9 (`adminImpersonationAuditMiddleware.ts:41,43`) | `req.user as unknown as { impersonator?, impersonationSessionId? }` | Direct read. |
| M10 (`scribeStreaming.ts:167`) | `(payload as unknown as { breakGlassSessionId? }).breakGlassSessionId` | `payload.kind === 'staff_break_glass' ? payload.breakGlassSessionId : undefined`. |

After-state `authMiddleware.ts` (illustrative):

```ts
import { verifyAccessToken, AccessTokenPayload } from '../utils/authTokens';

let payload: AccessTokenPayload;
try { payload = verifyAccessToken(token); } catch { return next(new HttpError(401, 'UNAUTHENTICATED', '...')); }

const user: AuthRequestUser = {
  id: payload.id, clinicId: payload.clinicId, role: payload.role,
  permissions: 'permissions' in payload ? payload.permissions : [],
  givenName: payload.givenName ?? '', familyName: payload.familyName ?? '',
  email: 'email' in payload ? payload.email : null,
};
if (payload.kind === 'patient_app') { user.patientId = payload.patientId; user.isPatientApp = true; }
if (payload.kind === 'staff_break_glass') { user.breakGlass = true; user.breakGlassSessionId = payload.breakGlassSessionId; }
if (payload.kind === 'staff_impersonation') { user.impersonator = payload.impersonator; user.impersonationSessionId = payload.impersonationSessionId; }
req.user = user;
```

Zero `as unknown as` left. Audit middlewares simplify to direct typed-optional reads.

---

## 5. TDD red plan

### 5.1 `apps/api/tests/unit/authTokens.test.ts` (NEW) — 8 cases

| # | Axis | Test | Setup | Assert |
|---|---|---|---|---|
| 1 | type | staff JWT discriminates as `kind === 'staff'` | sign staff payload | `verifyAccessToken(t).kind === 'staff'` |
| 2 | type | break-glass JWT → `staff_break_glass` | sign with `breakGlass + breakGlassSessionId` | `kind === 'staff_break_glass'` AND `breakGlassSessionId` non-optional |
| 3 | type | impersonation JWT → `staff_impersonation` | sign with `impersonator + impersonationSessionId` | `kind === 'staff_impersonation'` |
| 4 | type | patient-app JWT → `patient_app` | sign with `isPatientApp: true + patientId` | `kind === 'patient_app'` AND `patientId` non-optional |
| 5 | type-narrowing | TS narrows correctly | `// @ts-expect-error` directives | `payload.breakGlassSessionId` access fails to compile inside `kind === 'staff'` block |
| 6 | behavior | invalid signature throws | sign with wrong secret | `verifyAccessToken` throws |
| 7 | behavior | expired token throws | `expiresIn: '-1s'` | `verifyAccessToken` throws |
| 8 | behavior | discriminate is pure | call twice | identical narrowed shape |

### 5.2 `apps/api/tests/integration/authJwtCrossUseRejection.int.test.ts` (NEW) — 5 cases

| # | Test | Expected response |
|---|---|---|
| I1 | patient-app JWT → staff route | 403 (or 401) — patient role NOT in staff role list |
| I2 | staff JWT (no patient relationship) → patient-app route for unrelated patient | 403 PATIENT_OWNERSHIP_MISMATCH from Branch B |
| I3 | patient-app JWT → own data | 200 |
| I4 | break-glass JWT → out-of-scope clinical route | 200 + `break_glass_sessions.actions_performed` row appended |
| I5 | impersonation JWT → audit-emitting endpoint | audit row's `newData.impersonatedBy === <admin-id>` |

### 5.3 Run discipline

3× flake on both new test files. Adjacent: `apps/api/tests/unit/jwtTokens.test.ts`, `apps/api/tests/integration/authBoundaries.test.ts`. Full unit + full integration per §13.9.

### 5.4 Expected pre-fix failure shape

```
FAIL apps/api/tests/unit/authTokens.test.ts
  Cannot find module '../../src/utils/authTokens' from 'tests/unit/authTokens.test.ts'
```

---

## 6. Fix-registry rows

| Row | File | Type | Pattern | Description |
|---|---|---|---|---|
| `R-FIX-BUG-463-DISCRIMINATED-PAYLOAD` | `apps/api/src/utils/authTokens.ts` | present | `kind: 'patient_app'\|kind: 'staff_break_glass'\|kind: 'staff_impersonation'\|kind: 'staff'` | JWT-payload discriminated-union SSoT + verifyAccessToken/discriminate |
| `R-FIX-BUG-463-NO-MIDDLEWARE-AS-UNKNOWN-AS-PAYLOAD` | `apps/api/src/middleware/authMiddleware.ts` | absent | `as unknown as` | `as unknown as` JWT-payload casts removed from authMiddleware |
| `R-FIX-BUG-463-NO-AUDIT-MW-AS-UNKNOWN-AS` | `apps/api/src/middleware/breakGlassAuditMiddleware.ts` | absent | `as unknown as` | Removed from breakGlassAuditMiddleware |
| `R-FIX-BUG-463-NO-IMPERSONATION-MW-AS-UNKNOWN-AS` | `apps/api/src/middleware/adminImpersonationAuditMiddleware.ts` | absent | `as unknown as` | Removed from adminImpersonationAuditMiddleware |

`absent`-mode rows are forensic regression-traps.

---

## 7. L4 / L5 conditional triggers

### 7.1 L4 (clinical-safety-reviewer) — **FIRES** (semantic)

Per §13.5 semantic list — "modifies any patient-safety gate, ... module-access guard". The discriminated payload backstops `requirePatientOwnership` (the patient-app IDOR gate from BUG-430-PATIENT-APP, a clinical-safety boundary). Misclassification creates an IDOR vector.

L4 must verify:
- `discriminate()` order: patient_app → break_glass → impersonation → staff. Mutually-exclusive flags (`isPatientApp + breakGlass`) should hard-reject, not silently classify.
- Branch A on `requirePatientOwnership` continues to fire when `payload.kind === 'patient_app'` — the projection MUST set `isPatientApp = true` whenever the variant is `patient_app`.
- I1-I5 integration tests cover the cross-use IDOR rejection class.

### 7.2 L5 (architecture-reviewer) — **FIRES**

Per §I — touches `apps/api/src/middleware/` (3 files), creates `utils/authTokens.ts`, edits `types/express.d.ts`, edits fix-registry.

L5 must verify:
- Two-tier design (discriminated union at verify boundary + flat projection on `req.user`) is justified vs threading union through `req.user`.
- Issuance side untouched is acceptable (BUG-463-FU follow-up).
- No 5th JWT issuer escapes the inventory. Search anchor: `jwt.sign(.*config.jwt.accessSecret`.
- No new CI guard needed; `absent`-mode fix-registry rows serve as the regression-trap.

### 7.3 L3 — fires unconditionally.

### 7.4-7.5 L1 / L2 — runs as standard.

---

## 8. PART 2 §A-§O execution map

§A done.
§B done.
§C TDD red — write `authTokens.test.ts` + `authJwtCrossUseRejection.int.test.ts`. Run 3×, confirm RED.
§D Implementation — create `utils/authTokens.ts`; refactor `authMiddleware.ts`; remove casts from 2 audit middlewares; refactor `scribeStreaming.ts:167`; update `types/express.d.ts`.
§E L1 — tsc × 3 + lint × 3 + 13 shell guards + 13 TS guards + fix-registry.
§F L2 — 3× flake on new tests; full unit + full integration per §13.9.
§G L3 — code-reviewer-general.
§H L4 — clinical-safety-reviewer (semantic trigger).
§I L5 — architecture-reviewer (path + fix-registry trigger).
§J 2-REJECT absorb cap per level.
§K Fix-registry rows.
§L Commit message.
§M Update `bugs-remaining.md` + yaml.
§N Push **only after explicit user authorization**.
§O Append `progress.md`.

---

## 9. Verification log — every cited site Read-confirmed

| Item | File | Line | Verified |
|---|---|---|---|
| `AuthUser` schema | `packages/shared/src/auth.schemas.ts` | 17-32 | Read |
| `req.user` ambient | `apps/api/src/types/express.d.ts` | 1-21 | Read |
| `AuthContext` SSoT | `packages/shared/src/authContext.ts` | 18-43 | Read |
| `requirePatientOwnership` reads | `apps/api/src/shared/authGuards.ts` | 477-494 | Read |
| Patient-app JWT issuance | `apps/api/src/features/patient-app/patientAppRoutes.ts` | 401-410 | Read |
| Staff JWT issuance | `apps/api/src/features/auth/authService.ts` | 60-78 | Read |
| Break-glass issuance | `apps/api/src/features/auth/breakGlassRoutes.ts` | 274-287 | Read |
| Impersonation issuance | `apps/api/src/features/auth/adminImpersonationRoutes.ts` | 85-98 | Read |
| M1 cast | `apps/api/src/middleware/authMiddleware.ts` | 83 | Grep + Read |
| M2-M5 casts | `apps/api/src/middleware/authMiddleware.ts` | 95, 97, 103, 105 | Grep + Read |
| M6-M7 casts | `apps/api/src/middleware/breakGlassAuditMiddleware.ts` | 45, 46 | Grep + Read |
| M8-M9 casts | `apps/api/src/middleware/adminImpersonationAuditMiddleware.ts` | 41, 43 | Grep + Read |
| M10 cast | `apps/api/src/mcp/scribeStreaming.ts` | 167 | Grep + Read |
| `authTokens.ts` does NOT exist | (none) | — | Glob 0 hits |
| Existing JWT unit tests | `apps/api/tests/unit/jwtTokens.test.ts` | 1-60 | Read |
| BUG-463 row | `docs/quality/bugs-remaining.md` | 157 | Grep |

Plan derived from current HEAD reading; commit `3fd674c`'s diff was NOT read (per PART 6.1 #3). No file modifications during plan derivation.

---

## 10. Risks + open questions

1. **Cast count (9 middleware vs 10 in row title).** Plan resolves by including `mcp/scribeStreaming.ts:167`. User can scope down to 9 if preferring strictest reading.
2. **Issuance migration deferred to BUG-463-FU.** `discriminate()` infers `kind` from existing fields. L5 may push for stamp-at-sign cleanliness; called out so L5 doesn't reject for "incomplete migration".
3. **5 patient-app route casts** (`patientAppRoutes.ts:1000/1059/1092/1127/1208`) NOT in scope. Track as **BUG-463-FU** post-staging.
4. **`AuthContext` not changed.** Already has `breakGlassSessionId?` so no churn.
5. **Webauthn `mfa_pending` temp tokens** — separate `TempTokenPayload` type, NOT verified through `authMiddleware`. Out of scope.

---

## 11. Critical Files

- `apps/api/src/utils/authTokens.ts` (NEW — discriminated-union SSoT + verifyAccessToken/discriminate)
- `apps/api/src/middleware/authMiddleware.ts` (refactor — adopt verifyAccessToken; remove 5 casts)
- `apps/api/src/middleware/breakGlassAuditMiddleware.ts` (remove 2 casts)
- `apps/api/src/middleware/adminImpersonationAuditMiddleware.ts` (remove 2 casts)
- `apps/api/src/types/express.d.ts` (extend `req.user` projection)
- `apps/api/src/mcp/scribeStreaming.ts` (remove cast at L167)
- `apps/api/tests/unit/authTokens.test.ts` (NEW — TDD red)
- `apps/api/tests/integration/authJwtCrossUseRejection.int.test.ts` (NEW — TDD red)
- `docs/quality/fix-registry.md` (4 anchor rows)
- `docs/quality/bugs-remaining.md` (BUG-463 → fixed in same commit)
