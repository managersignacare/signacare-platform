# Findings 6a — Type-safety escape hatches (`any` + friends)

**Agent:** E-any
**Scope:** `.ts` and `.tsx` under `apps/api/src/**`, `apps/web/src/**`, `packages/shared/src/**`.

## Summary

| Workspace | Total matches |
|---|---:|
| `apps/api/src/` | 464 |
| `apps/web/src/` | 1,248 |
| `packages/shared/src/` | **0** (clean) |
| **TOTAL** | **1,712** |

| Pattern | Count |
|---|---:|
| `: any` | 1,134 |
| ` as any` | 154 |
| `@ts-ignore` | 0 |
| `@ts-expect-error` | 3 (all deliberate optional-peer-dep guards in `acsClient` / `fcmClient`) |
| `as unknown as` | 95 |
| `any[]` / `Record<string, any>` / `Promise<any>` | 326 |

## Top-3 highest-concentration files

| # | File | Count | Breakdown |
|---|---|---:|---|
| 1 | `apps/api/src/seed-demo-comprehensive.ts` | 87 | 48 `:any`, 39 container — seed script |
| 2 | `apps/web/src/features/patients/components/detail/tabs/VivaTab.tsx` | 86 | 64 `:any`, 10 `as any`, 12 container |
| 3 | `apps/web/src/features/patients/components/detail/tabs/SummaryTab.tsx` | 86 | 63 `:any`, 4 `as any`, 19 container |

## Security-critical `any` casts

### Middleware (10 casts)
- Every JWT-payload narrowing in `authMiddleware.ts`, `breakGlassAuditMiddleware.ts`, `adminImpersonationAuditMiddleware.ts` uses `as unknown as {field?:...}` because `authTokens.ts` does NOT declare a discriminated token-flavour union.
- **Fix:** define `StaffAccessTokenPayload` / `BreakGlassTokenPayload` / `ImpersonationTokenPayload` as a discriminated union, remove the casts.

### LLM feature (9)
- `features/llm/llmRoutes.ts` + `llmTrainingRoutes.ts` + `llmRepository.ts` — 7 `:any` + 2 double-casts on the training/usage pipeline.

### LLM prompt pipeline (~54)
- `mcp/aiEnhancer.ts` (22)
- `mcp/scribeEnhancements.ts` (7)
- `mcp/server/mcpServer.ts` (25)

These feed `recordLlmInteraction` from untyped DB rows. A field-name drift here produces silent audit-row gaps.

### Clean surfaces (no active casts)
- `features/legal/**` — 0
- `shared/phi*` — 0 (`shared/errors.ts` has 2 double-casts for PG error-code narrowing, which is acceptable)

## Pattern observations

- `packages/shared/src/` is the only workspace with **zero** escape hatches — the Zod-schemas-are-source-of-truth pattern works.
- `apps/web/src/` has **2.7× the api count** of `any` casts — frontend type hygiene needs focused effort.
- The Top-3 files together account for 259 matches (15 % of total). Refactoring those three alone cuts the total significantly.
- Seed scripts (`seed-demo-comprehensive.ts`, other `seed-*.ts`) contribute heavily — arguably acceptable if seed scripts are Node-only and not production code paths, but they should still be typed for maintainability.

## Related BUGs

- **BUG-420** (first audit — Wave 5) — roll-up for `any` + god-file debt; this enumeration is its data
- **BUG-463 (S1)** (new) — JWT-payload discriminated union in `authTokens.ts` + remove 10 middleware `as unknown as` casts (security-critical)
- **BUG-464 (S2)** (new) — LLM prompt-pipeline typing: type `mcp/aiEnhancer.ts` + `mcp/scribeEnhancements.ts` + `mcp/server/mcpServer.ts` against DB snapshot (54 casts)
- **BUG-465 (S2)** (new) — VivaTab.tsx + SummaryTab.tsx type-safety refactor — largest frontend files
- **BUG-466 (S3)** (new) — `@typescript-eslint/no-explicit-any` ESLint rule (currently disabled) — wire with grandfather allowlist, set to "warn" initially, ramp to "error" per quarter
