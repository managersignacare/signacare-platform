# Plan — BUG-531: ESLint `no-empty-catch-on-safety-surface` rule

[Plan agent invocation 2026-04-26 per PART 2 §B; first-principles per PART 6.1 #3. Phase A item 6 (FINAL) of structural prevention block.]

**Severity:** S1. **Subsumes:** BUG-516 (S2 → **fixed**). **Depends on:** BUG-530 (`tryAsync`/`Result<T,AppError>`/`isErr` from @signacare/shared, just shipped 621bfb1).

## §0 — Drift summary

Empty `} catch { }` blocks (TS/TSX, including `} catch (e) { }`) on production safety surfaces — the truly-silent variant of BUG-441/442/443/444/516/517/519/520/523 family. Operationally identical to `.catch(() => {})` already covered by `check-no-silent-catches.sh` but expressed via try/catch syntax which the regex doesn't detect — the gap BUG-516 was filed to close.

**ESLint AST > regex** for this class: (1) no false positives from substrings in strings/templates; (2) editor-time red squiggles (vs commit-time only); (3) suggestion-text that points at `tryAsync` from BUG-530 SSoT.

**Two complementary layers, neither replaceable:** shell-script catches `.catch(()=>...)` arrow-method-chain class; ESLint catches try/catch-block class. BUG-531 doesn't replace `check-no-silent-catches.sh`.

## §1 — Verification (read-confirmed)

- `.github/scripts/check-no-silent-catches.sh`: 5 arrow patterns + `// (intentional silent|allowed silent) — <reason>` allowlist phrase set.
- `.eslintrc.cjs`: legacy config (NOT flat); single root config; ESLint 8.57 + TS-ESLint 7.18.
- `.github/safety-surfaces.txt`: BUG-527 SSoT; bash-prefix-match semantics.
- `@signacare/shared` exports `tryAsync`, `isErr`, `Result`, `AppError` (BUG-530 just shipped).
- 9 in-scope `} catch {}` violations identified: MedicationsTab × 2 (BUG-545 new), VivaTab × 2 refetch (BUG-520 existing), VivaTab × 3 JSON.parse (legitimate-silent), SummaryTab × 1 JSON.parse (legitimate-silent), BedBoardPage × 1 (BUG-520 existing).
- CI `lint` job auto-discovers via `npm run lint --workspaces --if-present` — no new ci.yml job needed.

## §2 — Fix shape

### §2.1 — Plugin layout (option B locked)
Local plugin `eslint-plugins/signacare-rules/`; AST-aware path filtering, suggestion-text customisation pointing at `tryAsync`, allowlist matching shell-script contract.

### §2.2 — Files (5 NEW)
```
eslint-plugins/signacare-rules/
├── package.json                                    — plugin name = eslint-plugin-signacare-rules
├── README.md                                       — docs
├── index.js                                        — CJS entrypoint exporting rules registry
├── rules/no-empty-catch-on-safety-surface.js       — the rule
└── rules/__tests__/no-empty-catch-on-safety-surface.test.js  — RuleTester suite
```

### §2.3 — Rule implementation
- Visitor: `CatchClause(node)` — applies to both bare and named-param forms.
- Empty test: `node.body.type === 'BlockStatement' && node.body.body.length === 0`.
- Allowlist (TIGHTER than shell-script): `getCommentsInside(node.body)` matched against `/(intentional silent|allowed silent)/i`. Other comment forms (`/* TODO */`, `/* ignore */`) NOT honoured — those WERE the BUG-441/442/443/444 anti-pattern.
- Path-scoping: read `.github/safety-surfaces.txt` once, cache module-level. Resolution: plugin option > walk-up from `context.cwd` > graceful-degrade with console.warn (rule inert).
- Bash-prefix-match in JS mirrors `check-atomic-flip.sh`: trailing-slash → startsWith; no-slash → exact match.

### §2.4 — Suggestion (NOT autofix)
ESLint `suggest`, NOT `fix`. Suggestion replaces parent `TryStatement` with:
```ts
// BUG-531 suggestion: replace silent catch with tryAsync from @signacare/shared.
const r = await tryAsync(async () => { <ORIGINAL TRY BODY VERBATIM> });
if (isErr(r)) {
  // TODO(BUG-531): replace with proper handler:
  //   a) backend route: next(r.error)
  //   b) frontend UI: setStatus(UIStatus.failed(r.error, () => refetch()))
  //   c) service method: return Result.err(r.error)
  throw r.error;
}
```

Pinned by EC-6: suggestion output contains literal `tryAsync` + `isErr` + `@signacare/shared`.

### §2.5 — Wiring `.eslintrc.cjs`
Add to plugins: `"signacare-rules"`. Add to rules: `"signacare-rules/no-empty-catch-on-safety-surface": "error"`. Add `eslint-plugins` to ignorePatterns (don't lint the plugin's own JS files with TS-aware config). Plugin name resolves to `eslint-plugin-signacare-rules` per ESLint convention; root package.json adds `"eslint-plugin-signacare-rules": "file:./eslint-plugins/signacare-rules"`.

## §3 — Transition strategy (option b: grandfather + cascade BUG)

| File | Lines | Disposition |
|---|---|---|
| MedicationsTab.tsx | 2589, 2596 | grandfather — `eslint-disable-next-line ... — BUG-545` |
| VivaTab.tsx | 643, 652 | grandfather — `eslint-disable-next-line ... — BUG-520` |
| VivaTab.tsx | 1400, 1410, 1503 | legitimate-silent — `// intentional silent — JSON best-effort` |
| SummaryTab.tsx | 1906 | legitimate-silent — `// intentional silent — JSON best-effort` |
| BedBoardPage.tsx | 257 | grandfather — `eslint-disable-next-line ... — BUG-520` |

Net: 5 grandfather lines + 4 legitimate-silent comment-replacements + 1 NEW cascade BUG (BUG-545). Rule lands `error` from day one.

## §4 — CLAUDE.md update

- §3 line 247 + §16.2 line 881: tense `"will autofix"` → present `"autofixes"`; add rule's exact name `signacare-rules/no-empty-catch-on-safety-surface`.
- §3.4: single bullet under existing sub-section (NOT new section) — links the catch-boundary rule to the service-layer Result discipline.

## §5 — Test plan (12 cases, ≥3 PRE-FIX RED)

`eslint-plugins/signacare-rules/rules/__tests__/no-empty-catch-on-safety-surface.test.js`. ESLint `RuleTester` driven by vitest.

| ID | Shape | Expectation |
|---|---|---|
| EC-1 | `} catch { }` in safety-surface file | error reported (PRE-FIX RED) |
| EC-2 | `} catch (e) { }` in same | error reported (PRE-FIX RED) |
| EC-3 | `} catch { logger.warn() }` non-empty | NO error |
| EC-4 | `} catch { /* allowed silent — reason */ }` | NO error |
| EC-4b | `} catch { /* intentional silent — reason */ }` | NO error |
| EC-5 | `} catch { }` in NON-safety-surface file | NO error (path-scope) |
| EC-5b | `} catch { }` in API safety-surface | error reported (PRE-FIX RED) |
| EC-6 | suggestion text contains `tryAsync` + `isErr` + `@signacare/shared` | (PRE-FIX RED) |
| EC-7 | safety-surfaces.txt missing → graceful-degrade | (PRE-FIX RED) |
| EC-8 | filename relative vs absolute | both report |
| EC-9 | `} catch { /* TODO: handle */ }` | error (TIGHTER allowlist; PRE-FIX RED) |
| EC-10 | `} catch { /* ignore */ }` | error (TIGHTER allowlist; PRE-FIX RED) |

12/12 ×3 GREEN expected.

## §6 — Fix-registry anchors (5)

| ID | File | Type | Pattern |
|---|---|---|---|
| `R-FIX-BUG-531-PLUGIN-EXISTS` | `eslint-plugins/signacare-rules/index.js` | present | `^module\.exports = \{` |
| `R-FIX-BUG-531-RULE-IMPL-EXISTS` | `eslint-plugins/signacare-rules/rules/no-empty-catch-on-safety-surface.js` | present | `CatchClause\(node\)` |
| `R-FIX-BUG-531-AUTOFIX-POINTS-AT-TRYASYNC` | `eslint-plugins/signacare-rules/rules/no-empty-catch-on-safety-surface.js` | present | `tryAsync` |
| `R-FIX-BUG-531-WIRED-INTO-ESLINT-CONFIG` | `.eslintrc.cjs` | present | `signacare-rules/no-empty-catch-on-safety-surface` |
| `R-FIX-BUG-531-CLAUDE-MD-CITE` | `CLAUDE.md` | present | `signacare-rules/no-empty-catch-on-safety-surface` |

## §7 — Files to modify

NEW (5 plugin + 1 BUG-531 log dir):
- eslint-plugins/signacare-rules/package.json + README.md + index.js + rules/X.js + rules/__tests__/X.test.js
- docs/archive/auto-execute-logs/BUG-531/{started.txt, plan.md}

MODIFIED:
- .eslintrc.cjs (plugin + rule)
- package.json (workspace dep)
- CLAUDE.md (§3 + §16.2 + §3.4 sub-bullet)
- docs/quality/fix-registry.md (5 anchors)
- docs/quality/bugs-remaining.md (atomic flip BUG-531 fixed + BUG-516 fixed + BUG-545 new)

MODIFIED (grandfather/legitimate-silent annotations):
- apps/web/src/features/patients/components/detail/tabs/MedicationsTab.tsx (2 lines)
- apps/web/src/features/patients/components/detail/tabs/VivaTab.tsx (5 lines)
- apps/web/src/features/patients/components/detail/tabs/SummaryTab.tsx (1 line)
- apps/web/src/features/beds/pages/BedBoardPage.tsx (1 line)

## §8 — Trigger assessment

- L3: FIRES (always).
- L4: does NOT fire (pure tooling; no clinical behaviour change; comment annotations only).
- L5: FIRES (3 §I triggers stacked: .eslintrc edit + new plugin dir + fix-registry).

## §9 — Risks

- **§9.1** Existing violations: locked grandfather (option b) — 5 cited + 4 legitimate-silent + 1 new BUG-545.
- **§9.2** ESLint compat: 8.57 + TS-ESLint 7.18 confirmed; pure syntactic AST visitor; no `parserOptions.project` needed; flat-config-portable.
- **§9.3** Resolution: plugin option > walk-up > graceful-degrade with console.warn. Cache module-level once per Node process.
- **§9.4** Suggestion safety: not auto-applied; developer reviews before accepting. Multi-statement try wrap preserves outer-scope assignment via lexical capture; outer-scope fallbacks like `x = []` left for developer fix.
- **§9.5** BUG-516: row flipped S2 → **fixed** with cite to BUG-531. `check-no-silent-catches.sh` STAYS as defence-in-depth.
- **§9.6** Cascade: 1 new BUG (BUG-545, S1, MedicationsTab archive/restore allergy mutation). Other 8 hits already covered or legitimate-silent.

## §10 — Acceptance

- 5 fix-registry anchors GREEN.
- 12/12 ×3 flake; ≥7 PRE-FIX RED verified.
- L1 ESLint exits 0 across all workspaces.
- L1 silent-catches-guard still GREEN.
- L1 atomic-flip-guard GREEN (touches catalogue + registry + safety-surface files).
- L3 PASS.
- L4 NOT INVOKED (decision recorded).
- L5 PASS.
- CLAUDE.md updated.
- BUG-531 atomic flip + BUG-516 promote-and-close + BUG-545 new.
- Explicit user push authorization.
