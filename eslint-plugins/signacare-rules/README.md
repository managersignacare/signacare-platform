# eslint-plugin-signacare-rules

Local ESLint plugin housing Signacare-specific lint rules.

## Rules

### `no-empty-catch-on-safety-surface` (BUG-531)

Bans empty `} catch { }` blocks on production safety surfaces (paths
listed in `.github/safety-surfaces.txt`). Suggestion-mode autofix
points at `tryAsync` / `isErr` from `@signacare/shared` (BUG-530 SSoT).

The rule is path-scoped — only fires inside files matching the
canonical safety-surface allowlist (BUG-527 SSoT). Comment-based
allowlist phrases honour `// (intentional silent|allowed silent) — <reason>`,
matching the `check-no-silent-catches.sh` shell-script contract.

See `CLAUDE.md` §3.4 + §16.2 for the canonical adoption rule.

## Adding a new rule

1. Create `rules/<rule-name>.js` exporting `{ meta, create }`.
2. Register in `index.js`:
   ```js
   module.exports = {
     rules: {
       '<rule-name>': require('./rules/<rule-name>'),
     },
   };
   ```
3. Add tests in `rules/__tests__/<rule-name>.test.js` using `RuleTester` from `eslint`.
4. Wire the rule in the root `.eslintrc.cjs`.
5. Add fix-registry anchors and update CLAUDE.md as required.
