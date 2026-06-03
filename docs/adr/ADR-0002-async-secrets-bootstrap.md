# ADR-0002: Async secrets bootstrap via index.ts entry point

## Status
Accepted (shipped in BUG-366a; commit 02023c8).

## Context

Before Azure deployment, secrets were loaded synchronously at `server.ts` module-load time via `loadSecrets()`. The S4.1 design supported three backends (env / json / file), all synchronous.

Azure Key Vault resolution requires `@azure/identity` + `@azure/keyvault-secrets` SDK calls — which are async. There's no sync Azure SDK surface. `config.ts` validates critical env vars (JWT secrets, DB creds) at module-load time via Zod, so any async resolution MUST complete BEFORE `config.ts` is imported.

Three approaches considered:
- (A) synchronous HTTP to the Key Vault REST API — works, but re-implements authentication + retry that the SDK already provides
- (B) top-level `await` in server.ts — requires ESM + Node 20+ + build toolchain changes
- (C) split the boot entry: async loader FIRST, then dynamic import of server.ts — works against both CommonJS and ESM, no build toolchain change

(C) was chosen.

## Decision
`apps/api/src/index.ts` is the canonical boot entry. When `SECRETS_BACKEND=azure_keyvault`, `loadSecretsAsync()` is awaited BEFORE `await import('./server')` so `config.ts` sees populated `process.env`. Every production entry point (package.json `start`, Dockerfile CMD, 3 ecosystem.config.js files) points at `dist/src/index.js`.

## Consequences
Enables Azure Key Vault + managed-identity secret resolution. Adds one indirection hop between `npm start` and server.ts. Tests that import server.ts directly remain unaffected (they bypass index.ts and run the sync path).

## References
- Commit 02023c8
- Fix-registry anchors R-FIX-BUG-366A-* (5 of them)
- `apps/api/src/config/secrets.ts:loadSecretsAsync`
