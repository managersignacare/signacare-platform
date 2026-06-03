# Signacare Platform

Australian mental-health EMR platform. Multi-tenant, RLS-enforced, integrated
with MHR / HealthLink / Medicare / NHSD / Ollama.

This repository is the platform split only. Sara and Viva are maintained in
separate repositories:

- Sara clinician app: `managersignacare/Sara`
- Viva patient app: `managersignacare/viva`

## Workspaces

- `apps/api` — Node/TypeScript/Express backend + Knex migrations + BullMQ
- `apps/web` — React 18 + MUI v6 + TanStack Query + Formik
- `apps/emr-gateway` — eRx / SafeScript / HealthLink gateway shim
- `packages/shared` — Zod schemas + DTOs (single source of truth)

## Local development quickstart

1. Install deps:
   ```bash
   npm install
   ```

2. Bring up PostgreSQL 17 pinned to port **5433** (CLAUDE.md §10):
   ```bash
   bash installer/setup-first-run.sh
   ```

3. Bootstrap environment (copy example to `.env`):
   ```bash
   cp apps/api/.env.example apps/api/.env
   cp apps/web/.env.example apps/web/.env
   ```

4. Run migrations + seed:
   ```bash
   npm run migrate:dev --workspace=apps/api
   npm run db:snapshot --workspace=apps/api
   DEMO_SEED=good-health npm run seed:good-health --workspace=apps/api
   ```

5. Start both dev servers:
   ```bash
   npm run dev            # concurrently runs api + web
   ```
   - API: `http://localhost:4000` (HTTPS via `TLS_CERT_PATH` in prod)
   - Web: `http://localhost:5173`

## Required environment variables

| Var | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string; dev defaults to port 5433 |
| `REDIS_HOST` / `REDIS_PORT` | BullMQ queue backend |
| `JWT_ACCESS_SECRET` | HS256 signing key |
| `OLLAMA_URL` | Local LLM base URL (must be localhost / private) |
| `WHISPER_API_URL` | Ambient scribe transcription |
| `AI_EXTERNAL_HOSTS` | Comma-separated whitelist for non-localhost AI hosts (Tier 5.2) |

Optional integration env vars fail loudly at FIRST USE if missing
(Tier 7.1 `requireEnv` helper). See `apps/api/.env.example` for the
full list.

## Governance

- **CLAUDE.md** — development rules (13 sections, including §12.4
  gold-standard migration skeleton).
- **docs/quality/fix-registry.md** — every fix has a row with an ERE anchor
  verified by `check-fix-registry.sh`.
- **docs/compliance/tga-classification.md** — TGA non-device classification
  evidence for the scribe pipeline.

## CI guards

Every PR runs the guard suite:
```bash
for g in query-builder-columns code-columns row-iface-drift \
         migration-convention snapshot-freshness; do
  npm run guard:$g
done
bash .github/scripts/check-fix-registry.sh
bash .github/scripts/check-query-key-factories.sh
bash .github/scripts/check-no-silent-catches.sh
bash .github/scripts/check-no-stray-db-names.sh
```

TypeScript must be green across api / web / shared workspaces.

## Testing

- Unit: `vitest run` inside each workspace
- Integration: `npm run test:integration`
- Red-team: `npx ts-node scripts/tests/scribe-red-team.ts`

## Feedback

Security issues → email the clinical-safety owner.
Clinical feedback → GitHub issues with the `clinical-safety` label.
