# Plan — BUG-444: licenseMiddleware silent bypass on module-import failure

[Plan agent invocation 2026-04-25 per `~/.claude/plans/sleepy-roaming-meteor.md` PART 2 §B; first-principles re-derivation per PART 6.1 #3.]

**Severity:** S1 deploy-blocker (security/compliance — fail-OPEN gate)

## §0. Drift summary

`apps/api/src/middleware/licenseMiddleware.ts:50-57` swallows ALL exceptions from the `await import('../../../installer/license')` block AND the subsequent `mod.checkLicense()` call into a fabricated `{valid:true, edition:'development', maxUsers:999}` status. In production this silently grants unlimited-user development-edition bypass on any partial deploy / corrupt installer / runtime throw inside checkLicense. The dev-mode comment is correct intent, wrong implementation: zero observability + production fail-OPEN.

**Verified at HEAD:** middleware is NOT currently mounted in `server.ts` (only `licenseRoutes` is). The fix lands the fail-closed invariant BEFORE first-customer-on-prem rollout mounts it. Real `installer/license.ts` already returns `valid:false` on no-file-found path (the dev fabrication is doubly wrong).

## §1. Verification (read-confirmed)

- Catch block at `licenseMiddleware.ts:50-57` exactly as cited.
- Middleware NOT mounted (verified via grep across `apps/api/src/server.ts`, `index.ts`, feature routes).
- `installer/license.ts:190-201` exports `checkLicense(): LicenseStatus`; no NODE_ENV check; returns `valid:false` on no-license-file.
- `config.NODE_ENV` is the validated env path (`apps/api/src/config/config.ts:5,98`).
- `checkLicenseOnStartup()` (line 115) calls same `getLicenseStatus()` — pre-fix prod-with-broken-license logs `info` (green), not `error`.
- Zero existing tests for licenseMiddleware.

## §2. Fix shape — Path A (env-aware fail-closed, split try)

```ts
let mod;
try {
  mod = await import('../../../installer/license' as string);
} catch (err) {
  if (config.NODE_ENV === 'production') {
    logger.error({err, kind: 'license_module_unavailable'}, 'BUG-444: license module import failed in production');
    cachedStatus = { valid:false, expired:true, daysRemaining:0, expiryDate:'', edition:'unknown', maxUsers:0, customerName:'', organisationName:'', features:[], gracePeroid:false, error: 'License module unavailable.' };
  } else {
    logger.warn({err, kind: 'license_module_unavailable_dev'}, 'BUG-444: license module unavailable in development — using dev fallback');
    cachedStatus = { valid:true, expired:false, daysRemaining:999, expiryDate:'2099-12-31', edition:'development', maxUsers:999, customerName:'Development', organisationName:'Development', features:['all'], gracePeroid:false };
  }
  lastCheckTime = now;
  return cachedStatus;
}
try {
  cachedStatus = (mod as { checkLicense: () => LicenseStatus }).checkLicense();
} catch (err) {
  // ALWAYS fail closed when checkLicense() throws — even in dev — because the module ran and exploded.
  logger.error({err, kind: 'license_check_threw'}, 'BUG-444: checkLicense() threw');
  cachedStatus = { valid:false, expired:true, daysRemaining:0, expiryDate:'', edition:'unknown', maxUsers:0, customerName:'', organisationName:'', features:[], gracePeroid:false, error: 'License check failed.' };
}
lastCheckTime = now;
return cachedStatus;
```

Path B (always fail-closed + opt-in `LICENSE_DEV_MODE` env var) rejected — requires deploy-config edits.

## §3. UNION-up-front review

N/A — no schema, no DB.

## §4. §15 contract

N/A — no DB columns, no row-shape change. Existing optional `error?: string` is now USED on the fail-closed path.

## §5. Test plan

NEW `apps/api/tests/unit/licenseMiddlewareFailClosed.test.ts`:

- LM-1: happy path, real-module mock returns valid status; no warn/error.
- LM-2: production, import throws → status valid:false + edition:'unknown' + logger.error fires with `kind: 'license_module_unavailable'`. **PRE-FIX RED.**
- LM-3: development, import throws → dev fallback returned + logger.warn fires with `kind: 'license_module_unavailable_dev'` + ZERO logger.error. **PRE-FIX RED** (no warn pre-fix).
- LM-4: production middleware returns 402 on import-throw (next NOT called). **PRE-FIX RED** (200 today).
- LM-5: development middleware passes through (next called, no 402).
- LM-6 (bonus): checkLicense() runtime throw → fail-closed in BOTH envs + logger.error with `kind: 'license_check_threw'`. **PRE-FIX RED**.

Uses `vi.doMock` + `vi.resetModules` + `vi.stubEnv('NODE_ENV', ...)` per case. 3× flake check.

## §6. Fix-registry rows (5, all `^`-anchored, no `\|` per BUG-510)

| Row ID | File | Mode | Pattern |
|---|---|---|---|
| `R-FIX-BUG-444-NO-DEV-MODE-COMMENT-ALONE` | `apps/api/src/middleware/licenseMiddleware.ts` | absent | `If license module not available \(dev mode\), allow access` |
| `R-FIX-BUG-444-LICENSE-IMPORT-PROD-ERROR` | `apps/api/src/middleware/licenseMiddleware.ts` | present | `kind: 'license_module_unavailable'` |
| `R-FIX-BUG-444-LICENSE-IMPORT-DEV-WARN` | `apps/api/src/middleware/licenseMiddleware.ts` | present | `kind: 'license_module_unavailable_dev'` |
| `R-FIX-BUG-444-LICENSE-CHECK-THREW-KIND` | `apps/api/src/middleware/licenseMiddleware.ts` | present | `kind: 'license_check_threw'` |
| `R-FIX-BUG-444-PRODUCTION-FAIL-CLOSED` | `apps/api/src/middleware/licenseMiddleware.ts` | present | `BUG-444: license module import failed in production` |

## §7. Files to modify

| File | Change |
|---|---|
| `apps/api/src/middleware/licenseMiddleware.ts` | Replace catch block (50-57) with split-try env-aware shape; add `import { config } from '../config/config'` |
| `apps/api/tests/unit/licenseMiddlewareFailClosed.test.ts` | NEW (6 tests) |
| `docs/quality/fix-registry.md` | 5 anchor rows |
| `docs/quality/bugs-remaining.md` | Atomic flip BUG-444 → fixed |

No migration. No shared schema. No frontend.

## §8. PART 2 §H/§I trigger assessment

- **L4** (clinical-safety): FIRES — fail-OPEN ↔ fail-CLOSED transition; license enforcement is clinical-access gate.
- **L5** (architecture): FIRES — touches `apps/api/src/middleware/` + fix-registry.
- **L3**: unconditional.

## §9. Risks + follow-ups

1. Production-without-real-installer envs will 402 — CORRECT. Document in commit.
2. Misconfigured `NODE_ENV=production` in dev → 402. CORRECT.
3. checkLicense() runtime throw now fail-closed in both envs (was dev-laundered). CORRECT.
4. Module load order safe (middleware not mounted; no circular).
5. Test flake risk on `vi.stubEnv` + `vi.resetModules`. Standard vitest pattern.
6. `cachedStatus` module-level cache reset via `vi.resetModules()` between tests.

No new follow-up BUGs expected. (Sibling silent-catches in `licenseRoutes.ts:36`, `csrfMiddleware.ts:101`, `jwtBlacklist.ts:46,71`, `hmacSigning.ts:37`, `mcp/scribeStreaming.ts:207`, `authService.ts:173` are NOT in BUG-444 scope; some are tracked as separate BUG-441/442/443/etc. Verify before commit.)

## §10. Acceptance

5 fix-registry pass; 6 unit tests ×3 GREEN; tsc + lint clean; L1+L2+L3+L4+L5 PASS; atomic catalogue flip; commit message cites BUG-444 + L1/L2/L3/L4/L5 PASS.

Per PART 6.1: no shortcut, no abstraction wrapper, root-cause fix (env-aware fail-closed + observability), no scope creep into sibling silent-catches.
