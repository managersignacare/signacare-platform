# Azure Dev/Test Deployment Runbook — Signacare EMR

**Phase R3 pre-staging artifact (2026-04-30).** End-to-end runbook for
provisioning + deploying Signacare EMR to an Azure dev/test environment
in `australiaeast` for parallel work alongside Phase R1 guard build.

**Two-tier posture (CRITICAL):**

| Tier | Data | Who uses | This doc covers |
|---|---|---|---|
| **dev/test** | Synthetic seed only (Good Health Australia fixture) | Engineering + QA + clinical-advisor familiarisation | ✅ |
| **staging** | Realistic anonymised dataset; vendor integrations live | Pilot clinicians, full UAT | See `docs/plans/azure-staging-deployment.md` |
| **production** | Real patient PHI | AHPRA-attested clinic | See `docs/guides/deployment-guide.md` |

**Real PHI MUST NOT touch the dev/test environment.** Doing so collapses the
testing-tier posture into production exposure (Privacy Act + AHPRA).

---

## Packaged artifacts in the repo (ready to use)

| Artifact | Path | Purpose |
|---|---|---|
| API Dockerfile | `apps/api/Dockerfile` | 3-stage multi-build (deps → builder → runtime); port 4000 |
| Web Dockerfile | `apps/web/Dockerfile` | Vite build → nginx:alpine; `VITE_API_URL` build arg |
| EMR Gateway Dockerfile | `apps/emr-gateway/Dockerfile` | MongoDB-backed gateway service |
| Docker build context | `.dockerignore` (root) | Excludes secrets, local config, build outputs, logs |
| Bicep template | `deploy/azure/main.bicep` | 197-line top-level IaC; AU region locked |
| Bicep modules | `deploy/azure/modules/{appservice,database,keyvault,monitoring,redis,storage}.bicep` | 6 modules |
| Dev parameters | `deploy/azure/parameters.dev.json` | Smaller SKUs (B1 / B1ms / Basic) |
| Deploy runner | `deploy/azure/deploy.sh` | Orchestrates `az deployment sub create` |
| Smoke test | `deploy/azure/post-deploy-smoke.sh` | Validates `/health`, `/ready`, `/api/docs`, FHIR metadata, SMART config, CORS preflight, Web index |
| GitHub Actions workflow | `.github/workflows/azure-deploy.yml` | Builds + pushes images; deploys to App Service |
| Migration runtime | `apps/api/scripts/migrate.ts` (compiled `dist/scripts/migrate.js`) | Idempotent 2-phase (.sql + .ts) — runs at App Service startup |
| Synthetic seed | `apps/api/src/seed-good-health/` | 14-generator demo dataset (clinic + staff + patients + clinical fixtures) |
| Health endpoints | `/health`, `/ready`, `/health/integrations` | Liveness + PG/Redis readiness + admin-gated integration status |
| Azure Key Vault loader | `apps/api/src/config/secrets.ts` | `loadSecretsAsync()` with `DefaultAzureCredential()`; 23 whitelisted secret names |

---

## Prerequisites (one-time setup)

1. **Azure subscription** with these RBAC roles assigned to your account:
   - Contributor (resource group level)
   - User Access Administrator (for Key Vault role assignments)
   - Key Vault Secrets Officer

2. **Tools installed locally:**
   - Azure CLI (`az` — `brew install azure-cli` or `winget install Microsoft.AzureCLI`)
   - Bicep CLI (`az bicep install`)
   - GitHub CLI (`gh` — for triggering workflow_dispatch)
   - `psql` (for migration verification — `brew install postgresql@17`)
   - `openssl` (for cryptographic key generation)

3. **GitHub repository secrets** (configure in repo Settings → Secrets and variables → Actions):
   ```
   AZURE_CREDENTIALS       Service principal JSON (Contributor + Key Vault Secrets User + ACR push)
   AZURE_SUBSCRIPTION_ID   Subscription to deploy into
   ACR_NAME_DEV            Dev/test ACR registry name (e.g. signacarecrdev)
   ACR_NAME_STAGING        Staging ACR registry name
   ACR_NAME_PROD           Production ACR registry name
   SLACK_WEBHOOK_OPS       (Optional) Ops channel for deploy notifications
   ```

4. **Azure AD group for Key Vault admin** (capture the object ID):
   ```bash
   az ad group create --display-name "Signacare-Dev-Ops" --mail-nickname signacare-dev-ops
   az ad group show --group "Signacare-Dev-Ops" --query id -o tsv
   # → paste this object ID into deploy/azure/parameters.dev.json keyVaultAdminObjectId
   ```

---

## Phase 1 — Provision infrastructure (15-30 min, one-time)

### 1.1 Login + set subscription

```bash
az login
az account set --subscription <subscription-id>
az account show  # verify subscription + tenant
```

### 1.2 Generate the Postgres admin password

```bash
PG_ADMIN_PASSWORD="$(openssl rand -base64 32 | tr -d '=+/')"
echo "PG admin password: $PG_ADMIN_PASSWORD"
# → Save this to a secure password manager. Required for migration step.
```

### 1.3 Update `parameters.dev.json` with Key Vault admin object ID

```bash
# Get the AAD group object ID from Phase 1 prereqs:
KV_ADMIN_OBJECT_ID="<from-step-4-above>"

# Edit parameters file:
sed -i '' "s/00000000-0000-0000-0000-000000000000/$KV_ADMIN_OBJECT_ID/" \
  deploy/azure/parameters.dev.json
```

### 1.4 Deploy infrastructure via Bicep

```bash
# From repo root:
cd deploy/azure
ENV=dev ADMIN_PW="$PG_ADMIN_PASSWORD" ./deploy.sh
```

This provisions:

| Resource | SKU/Tier | Region | Notes |
|---|---|---|---|
| Resource group | — | australiaeast | `signacare-dev-rg` |
| App Service Plan (Linux) | B1 | australiaeast | Runs API + Web containers |
| App Service: API | container | australiaeast | `signacare-api-dev.azurewebsites.net` |
| App Service: Web | container | australiaeast | `signacare-web-dev.azurewebsites.net` |
| Azure Database for PostgreSQL Flexible Server | Standard_B1ms (1 vCPU, 2GB RAM) | australiaeast | Single-zone (HA disabled for dev cost saving) |
| Azure Cache for Redis | Basic C0 | australiaeast | BullMQ + rate-limit + sessions |
| Storage Account | Standard_LRS | australiaeast | Blob container for attachments |
| Key Vault | Standard | australiaeast | Soft-delete enabled; managed-identity access from App Service |
| Application Insights | — | australiaeast | OpenTelemetry exporter target |
| Log Analytics workspace | PerGB2018 | australiaeast | Aggregated logs + queries |
| Container Registry | Basic | australiaeast | (must already exist as `signacarecrdev` per Phase 1.3) |

**Estimated monthly cost:** ~AUD $200-300 (B1 App Service × 2 + B1ms Postgres + Basic Redis + LRS Storage + Standard KV + Basic ACR).

### 1.5 Verify infrastructure provisioned successfully

```bash
az resource list --resource-group signacare-dev-rg --output table
# Expected: 10+ resources, all in australiaeast, all Provisioned
```

---

## Phase 2 — Seed Key Vault with secrets (10-20 min)

### 2.1 Generate cryptographic keys

```bash
KV_NAME="signacare-dev-kv"

# Generate keys (capture each — these are NOT recoverable if lost)
JWT_ACCESS_SECRET="$(openssl rand -hex 32)"
JWT_REFRESH_SECRET="$(openssl rand -hex 32)"
PHI_ENCRYPTION_KEY="$(openssl rand -hex 32)"   # NEVER rotate after first deploy — encrypts patient PHI at rest
BLIND_INDEX_KEY="$(openssl rand -hex 32)"      # HMAC-SHA-256 for searchable PHI encryption
SESSION_SECRET="$(openssl rand -hex 32)"
SIGNACARE_LICENSE_SECRET="$(openssl rand -hex 32)"
CALENDAR_ICAL_SECRET="$(openssl rand -hex 32)"
WEBHOOK_BOOTSTRAP_SECRET="$(openssl rand -hex 32)"
```

### 2.2 Push to Key Vault (kebab-case secret names match `loadSecretsAsync()` contract)

```bash
az keyvault secret set --vault-name $KV_NAME --name jwt-access-secret    --value "$JWT_ACCESS_SECRET"
az keyvault secret set --vault-name $KV_NAME --name jwt-refresh-secret   --value "$JWT_REFRESH_SECRET"
az keyvault secret set --vault-name $KV_NAME --name phi-encryption-key   --value "$PHI_ENCRYPTION_KEY"
az keyvault secret set --vault-name $KV_NAME --name blind-index-key      --value "$BLIND_INDEX_KEY"
az keyvault secret set --vault-name $KV_NAME --name session-secret       --value "$SESSION_SECRET"
az keyvault secret set --vault-name $KV_NAME --name signacare-license-secret --value "$SIGNACARE_LICENSE_SECRET"
az keyvault secret set --vault-name $KV_NAME --name calendar-ical-secret --value "$CALENDAR_ICAL_SECRET"
az keyvault secret set --vault-name $KV_NAME --name webhook-bootstrap-secret --value "$WEBHOOK_BOOTSTRAP_SECRET"

# Postgres credentials (use the password from Phase 1.2)
DB_HOST="$(az postgres flexible-server show -g signacare-dev-rg -n signacare-pg-dev --query fullyQualifiedDomainName -o tsv)"
APP_USER_PASSWORD="$(openssl rand -base64 32 | tr -d '=+/')"
az keyvault secret set --vault-name $KV_NAME --name db-password         --value "$PG_ADMIN_PASSWORD"
az keyvault secret set --vault-name $KV_NAME --name db-app-password     --value "$APP_USER_PASSWORD"

# Redis connection string
REDIS_HOST="$(az redis show -g signacare-dev-rg -n signacare-redis-dev --query hostName -o tsv)"
REDIS_KEY="$(az redis list-keys -g signacare-dev-rg -n signacare-redis-dev --query primaryKey -o tsv)"
REDIS_URL="rediss://:${REDIS_KEY}@${REDIS_HOST}:6380"
az keyvault secret set --vault-name $KV_NAME --name redis-url --value "$REDIS_URL"
```

### 2.3 Verify all secrets are in place

```bash
az keyvault secret list --vault-name $KV_NAME --query "[].name" -o tsv
# Expected: 10+ secrets including the REQUIRED_IN_PRODUCTION 5:
#   jwt-access-secret, jwt-refresh-secret, db-app-password, phi-encryption-key, blind-index-key
```

---

## Phase 3 — Configure App Service (one-time, ~5 min)

### 3.1 Set environment variables on the API App Service

```bash
az webapp config appsettings set \
  --resource-group signacare-dev-rg \
  --name signacare-api-dev \
  --settings \
    NODE_ENV=production \
    PORT=4000 \
    SECRETS_BACKEND=azure_keyvault \
    AZURE_KEYVAULT_URL=https://signacare-dev-kv.vault.azure.net \
    DB_HOST="$DB_HOST" \
    DB_PORT=5432 \
    DB_NAME=signacaredb \
    DB_USER=signacare_owner \
    DB_APP_USER=app_user \
    JWT_ACCESS_TTL_MINUTES=15 \
    JWT_REFRESH_TTL_DAYS=7 \
    SESSION_IDLE_TIMEOUT_MINUTES=15 \
    RETENTION_DRY_RUN=true \
    RETENTION_TZ=Australia/Sydney \
    HL7_LAB_PROTOCOL=disabled \
    CORS_ORIGIN="https://signacare-web-dev.azurewebsites.net" \
    WEBAUTHN_RP_ID="signacare-api-dev.azurewebsites.net" \
    WEBAUTHN_ORIGIN="https://signacare-web-dev.azurewebsites.net" \
    OLLAMA_BASE_URL="http://localhost:11434" \
    LOG_LEVEL=info \
    DB_NAME_ALLOWLIST=signacaredb \
    ALLOW_DEMO_SEED=1
```

### 3.2 Set environment variables on the Web App Service

```bash
az webapp config appsettings set \
  --resource-group signacare-dev-rg \
  --name signacare-web-dev \
  --settings \
    VITE_API_URL=https://signacare-api-dev.azurewebsites.net
```

### 3.3 Configure App Service startup command (runs migrations on every container start)

```bash
az webapp config set \
  --resource-group signacare-dev-rg \
  --name signacare-api-dev \
  --startup-file "npm run migrate && node -r dotenv/config dist/src/index.js"
```

This ensures:
1. Migrations run idempotently before the API starts (Knex `IF NOT EXISTS` guards)
2. If migrations fail, the container fails to start → `/ready` returns 503 → smoke test catches it

### 3.4 Enable App Service managed identity → grant Key Vault access

```bash
# Enable managed identity on API
az webapp identity assign \
  --resource-group signacare-dev-rg \
  --name signacare-api-dev

API_PRINCIPAL_ID="$(az webapp identity show --resource-group signacare-dev-rg --name signacare-api-dev --query principalId -o tsv)"

# Grant Key Vault Secrets User role
az role assignment create \
  --role "Key Vault Secrets User" \
  --assignee-object-id "$API_PRINCIPAL_ID" \
  --assignee-principal-type ServicePrincipal \
  --scope "$(az keyvault show --name signacare-dev-kv --query id -o tsv)"
```

---

## Phase 4 — First deploy via GitHub Actions (5 min)

### 4.1 Trigger the workflow

```bash
# Manual trigger (preferred for first deploy)
gh workflow run azure-deploy.yml -f environment=dev

# Watch run progress
gh run watch
```

OR via GitHub UI: Actions → Azure Deploy → Run workflow → environment: `dev`.

### 4.2 What the workflow does

1. Builds API Docker image (multi-stage; runs `npm ci` + `tsc` build)
2. Builds Web Docker image (Vite build with `VITE_API_URL` baked in)
3. Pushes both images to `signacarecrdev.azurecr.io` with tag `<short-sha>-<utc-timestamp>`
4. Updates App Service container image references via `az webapp config container set`
5. Waits 120s grace for containers to come up (App Service startup hook runs `npm run migrate` here)
6. Runs `deploy/azure/post-deploy-smoke.sh` against the live env
7. Slack notify on success / failure

### 4.3 Expected smoke test output

```
▶ Signacare EMR post-deploy smoke (dev)
  API: https://signacare-api-dev.azurewebsites.net
  Web: https://signacare-web-dev.azurewebsites.net

  ✓ API liveness                  https://signacare-api-dev.azurewebsites.net/health → 200
  ✓ API readiness                 https://signacare-api-dev.azurewebsites.net/ready → 200
  ✓ API docs                      https://signacare-api-dev.azurewebsites.net/api/docs → 200
  ✓ FHIR metadata                 https://signacare-api-dev.azurewebsites.net/api/v1/fhir/metadata → 200
  ✓ SMART config                  https://signacare-api-dev.azurewebsites.net/.well-known/smart-configuration → 200
  ✓ CORS preflight                preflight → 204
  ✓ Web index                     https://signacare-web-dev.azurewebsites.net/ → 200
  ✓ Web manifest                  https://signacare-web-dev.azurewebsites.net/manifest.webmanifest → 200
  ✓ Web manifest scope            https://signacare-web-dev.azurewebsites.net/manifest.webmanifest contains "/m/"

✓ Smoke test passed.
```

---

## Phase 5 — Manual verification (10 min)

### 5.1 Liveness + readiness

```bash
curl -fsS https://signacare-api-dev.azurewebsites.net/health
# {"status":"ok","service":"signacare-api","timestamp":"2026-04-30T..."}

curl -fsS https://signacare-api-dev.azurewebsites.net/ready
# {"status":"ready","checks":{"postgres":"ok","redis":"ok"},"timestamp":"..."}
```

### 5.2 Migration count verification (stronger assertion than /ready proxy)

```bash
# Open SSH session into the API container:
az webapp ssh --resource-group signacare-dev-rg --name signacare-api-dev

# Inside container:
psql "host=$DB_HOST port=5432 dbname=signacaredb user=$DB_USER password=$DB_PASSWORD sslmode=require" \
  -c "SELECT COUNT(*) FROM knex_migrations"
# Expected: ≥ 106 migrations applied
```

### 5.3 Web SPA loads

```bash
curl -fsSL https://signacare-web-dev.azurewebsites.net/ | grep -o '<title>[^<]*</title>'
# <title>Signacare EMR</title>
```

---

## Phase 6 — Seed synthetic data (one-time, ~5-10 min)

The existing `seed:good-health` script produces a deterministic Good Health
Australia clinic with 14 generators (clinic, executive staff, department
heads, clinic staff, master login table, patients, episodes, clinical notes,
medications, pathology, risk assessments, outcomes, legal orders).

### 6.1 Run seed via App Service SSH

```bash
az webapp ssh --resource-group signacare-dev-rg --name signacare-api-dev

# Inside container:
cd /home/site/wwwroot/apps/api
DEMO_SEED=good-health node -r dotenv/config dist/src/seed-good-health/index.js
```

### 6.2 Verify seed succeeded

```bash
# Inside container, still in psql:
psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM clinics WHERE name = 'Good Health Australia'"
# Expected: 1

psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM patients"
# Expected: 25-50 synthetic patients
```

### 6.3 First login via Web SPA

Visit `https://signacare-web-dev.azurewebsites.net/` and log in with:
- Email: `admin@goodhealth.signacare.local`
- Password: as documented in `apps/api/src/seed-good-health/config/master-login.ts` (the deterministic seed table is intentionally checked into `docs/demo/`)

---

## Phase 7 — Azure dev/test environment ready

What's now possible (parallel work that becomes unblocked):

| Activity | Now possible because |
|---|---|
| Phase R1 PR-R1-13 through R1-24 (12 new guards) | Each merge auto-deploys to dev/test for fast iteration feedback |
| BUG-451 — 50 clinical-safety integration tests | Live Postgres on Azure (vs local mocks) |
| k6 baseline + load + stress + spike + soak | Real Azure cluster — actual p99 numbers (`npm run perf:baseline`) |
| ADHA CTS v3.0.1 — 55 conformance vectors | Sandbox endpoints accessible from Azure |
| HL7 ORU^R01 round-trip | Live MLLP endpoint connection from `australiaeast` |
| FHIR Bundle/CapabilityStatement validation | Live HI Service test endpoint (when configured) |
| BUG-374c retention production runbook | Starts the ≥30d dry-run clock (RETENTION_DRY_RUN=true is set) |
| Vendor sandbox cert (NPDS / DSP / SafeScript) | Can begin in parallel with Phase R1 progress |
| Clinical-advisor familiarisation with synthetic data | Real environment, no PHI risk |

Each merge to `main` auto-deploys to the dev/test environment via the
`push` trigger in `.github/workflows/azure-deploy.yml` (subject to the
`paths` filter — only commits touching `apps/api/**`, `apps/web/**`,
`packages/shared/**`, or `Dockerfile*` trigger a redeploy).

---

## Troubleshooting

### App Service container fails to start

```bash
# Stream logs:
az webapp log tail --resource-group signacare-dev-rg --name signacare-api-dev
```

Common causes:
- **Missing required secret in Key Vault** → `loadSecretsAsync()` throws on missing `phi-encryption-key`, `blind-index-key`, `jwt-access-secret`, `jwt-refresh-secret`, `db-app-password`. Verify Phase 2.3.
- **Migration failure** → check log stream for "Migration failed" stack trace. Often a connectivity issue (App Service can't reach Postgres) or a missing extension (pg_trgm / pgcrypto — Bicep should provision these).
- **Managed-identity not granted** → App Service can authenticate but Key Vault returns 403. Verify Phase 3.4 role assignment.

### `/ready` returns 503

```bash
curl -s https://signacare-api-dev.azurewebsites.net/ready | jq
# {"status":"not_ready","checks":{"postgres":"failed","redis":"ok"},...}
```

- `postgres: failed` → check Postgres firewall rules (Bicep should allow App Service outbound IP); check `DB_HOST` env var
- `redis: failed` → check Redis access policy + `REDIS_URL` Key Vault secret format (must be `rediss://...`)

### CORS preflight fails

The `CORS_ORIGIN` App Service setting must EXACTLY match the Web App
Service URL. After provisioning, verify:

```bash
az webapp config appsettings list --resource-group signacare-dev-rg --name signacare-api-dev | grep CORS_ORIGIN
# Must equal: https://signacare-web-dev.azurewebsites.net
```

### Resetting the dev environment (destructive)

```bash
# Delete entire resource group and re-provision
az group delete --name signacare-dev-rg --yes --no-wait

# Wait 5-10 min for deletion, then re-run Phase 1.4 onward
```

---

## Tier-graduation: dev/test → staging

When all pre-staging master list items close (per
`docs/quality/bugs-remaining.md` — Tier 1A + 1B + 1C):

1. Provision a SEPARATE staging environment from the same Bicep template:
   ```bash
   ENV=staging ADMIN_PW="$(openssl rand -base64 32)" ./deploy/azure/deploy.sh
   ```
2. Load anonymised dataset (NOT the synthetic Good Health seed) — see
   `docs/plans/azure-staging-deployment.md` §4.
3. Configure vendor integrations to point at TEST endpoints (NPDS test,
   DSP test, HealthLink test, etc.) — NOT sandbox.
4. Set `RETENTION_DRY_RUN=false` only after ≥30d dry-run review on
   dev/test (per BUG-374c gate).
5. Pilot UAT begins — clinical-advisor sign-off required before any
   real PHI lands.

Production cutover (after pilot UAT + AHPRA Standard 1 attestation +
ADHA conformance + vendor cert) follows `docs/guides/deployment-guide.md`.

---

## Reference

- Bicep template: `deploy/azure/main.bicep`
- Bicep modules: `deploy/azure/modules/`
- Workflow: `.github/workflows/azure-deploy.yml`
- Smoke test: `deploy/azure/post-deploy-smoke.sh`
- Secrets resolver: `apps/api/src/config/secrets.ts` (BUG-366a)
- Migration runner: `apps/api/scripts/migrate.ts`
- Good Health seed: `apps/api/src/seed-good-health/`
- Production deployment guide: `docs/guides/deployment-guide.md`
- Original Azure staging plan: `docs/plans/azure-staging-deployment.md`

**Per CLAUDE.md §17 + project-data-retention-policy:** real PHI must NEVER
touch the dev/test environment. The `RETENTION_DRY_RUN=true` setting is the
last line of defence — but the FIRST line is operator discipline.
