# Signacare EMR — Azure Deployment Guide

**Version:** 1.0 (2026-04-12, S8.1)
**Audience:** Ops engineers deploying Signacare to Microsoft Azure for the first time, rebuilding after a DR event, or migrating from the on-prem macOS single-clinic distribution.
**Scope:** Infrastructure, containers, secrets, monitoring, backup, runbooks. Does not cover tenant onboarding, licensing, or clinical training — those are in `docs/DEPLOYMENT_GUIDE.md` and `docs/USER_MANUAL.md`.

---

## 1. Architecture on Azure

```
                          ┌──────────────────────────┐
                          │   Azure Front Door       │
                          │   WAF + TLS 1.3 + CDN    │
                          └───────────┬──────────────┘
                                      │
                   ┌──────────────────┴──────────────────┐
                   │                                     │
          ┌────────▼────────┐                 ┌─────────▼────────┐
          │  signacare-web- │                 │ signacare-api-   │
          │  <env>          │                 │ <env>            │
          │  (App Service)  │                 │ (App Service)    │
          │  nginx + SPA    │                 │ Node.js API      │
          └─────────────────┘                 └────────┬─────────┘
                                                       │
        ┌───────────────────┬──────────────────────────┼───────────────────┐
        │                   │                          │                   │
 ┌──────▼─────┐    ┌────────▼────────┐       ┌─────────▼──────┐   ┌────────▼─────┐
 │ Postgres   │    │ Redis           │       │ Storage        │   │ Key Vault    │
 │ Flexible   │    │ Standard C1     │       │ StorageV2      │   │ standard SKU │
 │ Server 16  │    │ 1 GB, TLS 6380  │       │ Blob (private) │   │ RBAC + soft  │
 │ HA: zone   │    │ DB0-3           │       │ GRS (prod)     │   │ delete 90d   │
 │ redundant  │    │                 │       │ LRS (staging)  │   │              │
 └────────────┘    └─────────────────┘       └────────────────┘   └──────────────┘
        │
 ┌──────┴──────────┐
 │ Geo-redundant   │
 │ backup 35 days  │
 └─────────────────┘

                ┌──────────────────────────────────────┐
                │  Log Analytics workspace             │
                │  + Application Insights              │
                │  ← OpenTelemetry + Pino from API     │
                └──────────────────────────────────────┘
```

Every resource lives in a single resource group `signacare-rg-<env>` in **australiaeast**, enforced by parameter validation in [deploy/azure/main.bicep](../deploy/azure/main.bicep). Australian Privacy Act compliance requires primary data residency inside Australia; the only sanctioned secondary region is **australiasoutheast**.

## 2. Prerequisites

| Item | How to get it |
|---|---|
| Azure subscription with Owner | Your Azure admin |
| AAD group `signacare-ops` | Create in Entra ID. Its Object ID goes into `parameters.<env>.json` as `keyVaultAdminObjectId`. |
| Service principal for CI | `az ad sp create-for-rbac --name signacare-deploy-<env> --role Contributor --scopes /subscriptions/<sub-id> --sdk-auth`. Paste the JSON into the GitHub secret `AZURE_CREDENTIALS`. Grant it `AcrPush` on the ACR after provisioning and `Key Vault Secrets User` on the vault. |
| `az` CLI ≥ 2.60 | `brew install azure-cli` or `curl -sL https://aka.ms/InstallAzureCLIDeb \| sudo bash` |
| `bicep` CLI | Bundled with recent `az`; verify with `az bicep version` |
| `jq`, `curl`, `openssl` | Standard operator toolbox |
| Custom domain (optional) | DNS zone you control; add a CNAME to the Front Door endpoint after provisioning |

## 3. First-time provisioning

### 3.1 Log in and select the subscription

```bash
az login --tenant <your-tenant-id>
az account set --subscription <your-subscription-id>
```

### 3.2 Fill in `parameters.staging.json`

Open [deploy/azure/parameters.staging.json](../deploy/azure/parameters.staging.json) and replace `keyVaultAdminObjectId` with the real Object ID of your ops AAD group. Every other value is safe for staging as-is.

For production, do the same in [parameters.prod.json](../deploy/azure/parameters.prod.json). Bump the SKUs if you expect more than ~200 concurrent clinicians.

### 3.3 Deploy the infrastructure

```bash
deploy/azure/deploy.sh staging
```

What the script does (see inline comments in [deploy.sh](../deploy/azure/deploy.sh)):

1. Validates the Bicep template (`az deployment sub validate`).
2. Generates a strong Postgres admin password if `$ADMIN_PASSWORD_SECRET` isn't set.
3. Runs `az deployment sub create` — ~12 minutes the first time, ~3 minutes on re-runs.
4. Seeds bootstrap secrets in Key Vault (`phi-encryption-key`, `blind-index-key`, `jwt-access-secret`, `jwt-refresh-secret`, `session-secret`, `redis-password`, `storage-access-key`, `storage-secret-key`) — skips any secret that already exists so you can re-run safely.
5. Inserts placeholder values for `sentry-dsn`, `slack-webhook-security`, `slack-webhook-ops` — replace these before go-live.

When the script exits cleanly you'll see:

```
Resource group: signacare-rg-staging
API:            https://signacare-api-staging.azurewebsites.net
Web:            https://signacare-web-staging.azurewebsites.net
Key Vault:      signacare-kv-staging
```

### 3.4 Push the first container images

The Bicep template creates the App Service sites with a bootstrap `staticsite` image so they come up healthy before you have any real images built. The first real deploy replaces them:

```bash
ENV=staging
NAME_PREFIX=signacare
ACR="${NAME_PREFIX}cr${ENV}.azurecr.io"

az acr create \
  --resource-group "${NAME_PREFIX}-rg-${ENV}" \
  --name "${NAME_PREFIX}cr${ENV}" \
  --sku Standard \
  --admin-enabled false

az acr login --name "${NAME_PREFIX}cr${ENV}"

docker build -f apps/api/Dockerfile -t "${ACR}/signacare-api:latest" .
docker push "${ACR}/signacare-api:latest"

docker build -f apps/web/Dockerfile --build-arg VITE_API_URL=/api -t "${ACR}/signacare-web:latest" .
docker push "${ACR}/signacare-web:latest"

az webapp config container set \
  --name "${NAME_PREFIX}-api-${ENV}" \
  --resource-group "${NAME_PREFIX}-rg-${ENV}" \
  --docker-custom-image-name "${ACR}/signacare-api:latest"

az webapp config container set \
  --name "${NAME_PREFIX}-web-${ENV}" \
  --resource-group "${NAME_PREFIX}-rg-${ENV}" \
  --docker-custom-image-name "${ACR}/signacare-web:latest"
```

### 3.5 Run the database migrations

The API container runs `npm run migrate` on startup via its entrypoint. Tail the logs to confirm every migration applied cleanly:

```bash
az webapp log tail \
  --name "${NAME_PREFIX}-api-${ENV}" \
  --resource-group "${NAME_PREFIX}-rg-${ENV}"
```

Look for `Batch 1 run: NN migrations`. If any migration fails, the container exits and App Service restarts it on loop — fix the migration and push a new image.

### 3.6 Smoke test

```bash
ENV=staging deploy/azure/post-deploy-smoke.sh
```

All green = production-ready bar load testing and tenant onboarding.

## 4. Secret reference

Every secret the API reads from the environment is listed here. Values in **bold** are Key Vault references; values in *italic* are plain settings. The `env` backend of `apps/api/src/config/secrets.ts` reads them uniformly — App Service resolves the Key Vault references into plain env vars at container start.

| Env var | Source | Rotation cadence |
|---|---|---|
| `DB_HOST` | *Bicep output (postgresFqdn)* | n/a — infra |
| `DB_NAME` | *signacaredb* | n/a |
| `DB_USER` | *signacare_owner* | n/a |
| `DB_PASSWORD` | **kv: db-password** | 90 days |
| `DB_SSL` | *true* | n/a |
| `REDIS_HOST` | *Bicep output (redisHost)* | n/a — infra |
| `REDIS_PORT` | *6380* | n/a |
| `REDIS_PASSWORD` | **kv: redis-password** | rotate when Redis is rebuilt |
| `REDIS_TLS` | *true* | n/a |
| `PHI_ENCRYPTION_KEY` | **kv: phi-encryption-key** (64 hex chars) | **never** — rotation is a full re-encryption job |
| `BLIND_INDEX_KEY` | **kv: blind-index-key** (64 hex chars) | **never** — rotation rehashes every patient row |
| `JWT_ACCESS_SECRET` | **kv: jwt-access-secret** | 180 days |
| `JWT_REFRESH_SECRET` | **kv: jwt-refresh-secret** | 180 days |
| `SESSION_SECRET` | **kv: session-secret** | 180 days |
| `BLOB_BACKEND` | *s3* | n/a |
| `BLOB_S3_BUCKET` | *attachments* | n/a |
| `BLOB_S3_ENDPOINT` | *https://<account>.blob.core.windows.net* | n/a |
| `BLOB_S3_REGION` | *australiaeast* | n/a |
| `BLOB_S3_ACCESS_KEY_ID` | **kv: storage-access-key** (the storage account name) | 90 days |
| `BLOB_S3_SECRET_ACCESS_KEY` | **kv: storage-secret-key** | 90 days |
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | *Bicep output* | n/a |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | *Bicep output* | n/a |
| `SENTRY_DSN` | **kv: sentry-dsn** — replace placeholder before go-live | n/a |
| `SLACK_WEBHOOK_SECURITY` | **kv: slack-webhook-security** | when the channel rotates |
| `SLACK_WEBHOOK_OPS` | **kv: slack-webhook-ops** | when the channel rotates |
| `TRUST_PROXY` | *true* | n/a |
| `CORS_ORIGIN` | *https://<web-host>* | n/a |

**Key rotation cannot be done with this template.** `PHI_ENCRYPTION_KEY` protects data at rest; changing it requires decrypting every existing row with the old key and re-encrypting with the new one, plus revoking the old key only after the last reader has stopped using it. That is a dedicated project tracked under `docs/SECURITY_KEY_ROTATION.md` (future work).

`BLIND_INDEX_KEY` is similar — changing it invalidates every row's `medicare_number_lookup` / `ihi_number_lookup` / `dva_number_lookup` and requires a one-off re-hash. Treat both keys as effectively immutable unless there is a confirmed compromise.

## 5. BlobStorage backend choice

The API uses the pluggable `BlobStorage` facade in [apps/api/src/shared/blobStorage.ts](../apps/api/src/shared/blobStorage.ts) with two existing backends: `local` and `s3`. Azure Blob Storage exposes a compatible REST API but is **not** natively S3-compatible — however, the SDK-free path we use in the facade (PUT / GET with pre-signed URLs) works against both.

Current Azure deployment uses `BLOB_BACKEND=s3` pointing at the Azure Blob Storage account. This gives us:

- Attachment upload, download, pre-signed URL minting — all working via the existing code path
- Zero SDK additions — no `@azure/storage-blob` dependency to patch
- One-line cutover to a future `AzureBlobStorage` backend if we ever want native managed-identity access

The caveat: `BLOB_S3_ACCESS_KEY_ID` + `BLOB_S3_SECRET_ACCESS_KEY` are the Azure Storage account name and primary key, not AWS IAM credentials. The deploy script seeds them correctly from the Storage Account's primary key.

A follow-up PR can add a native `AzureBlobStorage` class that uses managed identity via fetch against the REST API (`x-ms-version` + `Authorization: Bearer`), eliminating the need to store the storage account key altogether. That work is tracked as TODO in the BlobStorage facade.

## 6. Custom domain + TLS

The default `*.azurewebsites.net` hostname is fine for staging. For production:

1. Create the DNS zone in your registrar and copy the NS records to Azure DNS if you want to manage it there.
2. Add a `CNAME` record mapping your chosen host (e.g. `emr.yourclinic.au`) to `<web-host>.azurewebsites.net`.
3. Verify ownership by adding the `asuid.*` TXT record Azure shows in the portal.
4. Bind the hostname:
   ```bash
   az webapp config hostname add \
     --webapp-name "${NAME_PREFIX}-web-${ENV}" \
     --resource-group "${NAME_PREFIX}-rg-${ENV}" \
     --hostname emr.yourclinic.au
   ```
5. Provision a free App Service Managed Certificate:
   ```bash
   az webapp config ssl create \
     --resource-group "${NAME_PREFIX}-rg-${ENV}" \
     --name "${NAME_PREFIX}-web-${ENV}" \
     --hostname emr.yourclinic.au
   ```
6. Bind the cert to the hostname with SNI:
   ```bash
   THUMBPRINT="$(az webapp config ssl list --resource-group "${NAME_PREFIX}-rg-${ENV}" --query "[0].thumbprint" -o tsv)"
   az webapp config ssl bind \
     --resource-group "${NAME_PREFIX}-rg-${ENV}" \
     --name "${NAME_PREFIX}-web-${ENV}" \
     --certificate-thumbprint "$THUMBPRINT" \
     --ssl-type SNI
   ```
7. Update the `CORS_ORIGIN` app setting on the API to the new hostname, then restart the API.

## 7. Continuous deployment

The [.github/workflows/azure-deploy.yml](../.github/workflows/azure-deploy.yml) workflow builds, pushes, and deploys on every merge to `main` (auto-staging) or via manual dispatch (staging or prod with opt-in slot swap).

Required GitHub repository secrets:

| Secret | Value |
|---|---|
| `AZURE_CREDENTIALS` | JSON output of `az ad sp create-for-rbac --sdk-auth` for a service principal with Contributor on the resource group + AcrPush on the ACR + Key Vault Secrets User on the vault |
| `AZURE_SUBSCRIPTION_ID` | Target subscription ID |
| `ACR_NAME_STAGING` | e.g. `signacarecrstaging` |
| `ACR_NAME_PROD` | e.g. `signacarecrprod` |
| `SLACK_WEBHOOK_OPS` | (optional) Operations Slack webhook for deploy notifications |

Required GitHub environments:

| Environment | Purpose | Gates |
|---|---|---|
| `staging` | Auto-deploy on push to main | none |
| `prod` | Manual dispatch only | required reviewers (at least 1 admin) |

The workflow deploys to an `staging` slot on prod App Services, runs smoke tests against the slot FQDN, and only swaps to production if `swap_after_deploy: true` is passed on dispatch. That gives you a final human gate between "deployed to prod slot" and "serving traffic".

## 8. Monitoring

### 8.1 Live logs

```bash
az webapp log tail --name signacare-api-staging --resource-group signacare-rg-staging
```

### 8.2 Application Insights queries

```kusto
// API request rate and latency by route (last 15 min)
requests
| where timestamp > ago(15m)
| summarize
    count=count(),
    p50=percentile(duration, 50),
    p95=percentile(duration, 95),
    p99=percentile(duration, 99)
  by name
| order by count desc

// Error rate by route (last hour)
exceptions
| where timestamp > ago(1h)
| summarize count=count() by operation_Name, type
| order by count desc

// Patient duplicate detection hits (S7.1)
traces
| where timestamp > ago(1h)
| where message contains "DUPLICATE_PATIENT"
| project timestamp, message, customDimensions
```

### 8.3 Alert rules to create post-deploy

1. **High 5xx rate** — `requests | where resultCode startswith "5"` exceeds 1% for 5 min
2. **Health check failing** — `availabilityResults | where success == false` — 2 failures in 5 min
3. **Postgres CPU >80%** — Azure Monitor metric on the Flexible Server
4. **Postgres storage >85%** — same
5. **Redis memory >80%** — Azure Monitor metric on the cache
6. **Break-glass session created** — log search on `BREAK_GLASS_REQUESTED` in traces (the API logs this at warn level)

## 9. Backup and DR

### 9.1 Automated backups

- Postgres: Flexible Server takes full backup + continuous WAL every 5 min. Geo-redundant in prod. Point-in-time recovery within the 35-day retention window.
- Redis: not backed up — it's a cache, not a source of truth. A cold start rebuilds from scratch.
- Blob storage: GRS in prod means a second read-only copy lives in `australiasoutheast`. Soft delete gives 14-day recovery of accidentally-deleted attachments.
- App Insights / Log Analytics: 90-day retention. For longer audit retention, enable continuous export to a second storage account.
- Audit log: lives inside Postgres (`audit_log` partitioned table) with hash chain — backed up with the database.

### 9.2 Restore drill (quarterly)

1. Take the most recent PITR snapshot restore time:
   ```bash
   az postgres flexible-server show --name signacare-pg-prod --resource-group signacare-rg-prod --query earliestRestoreDate
   ```
2. Restore to a throwaway server:
   ```bash
   az postgres flexible-server restore \
     --resource-group signacare-rg-drill \
     --name signacare-pg-drill \
     --source-server signacare-pg-prod \
     --restore-time "2026-04-12T10:00:00Z"
   ```
3. Connect with `psql`, run `SELECT count(*) FROM patients`, `SELECT count(*) FROM clinical_notes`.
4. Delete the drill server.
5. Log the result in `docs/accessibility/walkthrough-results/../dr-drills/`.

### 9.3 Region failover (prod only)

If australiaeast is down, the geo-redundant backup in australiasoutheast is 5-15 minutes behind. Recovery procedure:

1. Declare the incident in `#ops-signacare`.
2. Provision a new Flexible Server in australiasoutheast with `az postgres flexible-server geo-restore`.
3. Update the `DB_HOST` app setting on the API and restart.
4. Switch DNS to the `australiasoutheast` App Service.
5. RTO target: 4 hours. RPO target: 1 hour.

## 10. Pre-go-live checklist

Before the first patient data is entered in production, confirm every item:

- [ ] Key Vault placeholder secrets replaced (`sentry-dsn`, `slack-webhook-security`, `slack-webhook-ops`)
- [ ] Custom domain bound + TLS cert active (not `*.azurewebsites.net`)
- [ ] `CORS_ORIGIN` updated to the custom domain
- [ ] `parameters.prod.json` `keyVaultAdminObjectId` points at the real AAD group
- [ ] `postgresHaMode=ZoneRedundant` (verify in the portal — it silently downgrades if the region doesn't have enough zones)
- [ ] Geo-redundant backup on Postgres confirmed by running `az postgres flexible-server show --query "backup.geoRedundantBackup"`
- [ ] Alert rules from §8.3 created and tested
- [ ] `deploy/azure/post-deploy-smoke.sh` exits 0 against prod
- [ ] DR drill run at least once against the prod database, result logged
- [ ] Service principal for GitHub Actions has minimum necessary roles only (no Owner)
- [ ] PHI key + blind index key stored in a second offline location (e.g. sealed envelope in the physical ops safe) — losing Key Vault without this means unrecoverable PHI
- [ ] Fix Registry guard green on the deployed commit
- [ ] `npm run a11y:contrast` green
- [ ] `tsc --noEmit` clean on both workspaces
- [ ] Break-glass access tested end-to-end in staging
- [ ] WebAuthn registration + login tested in staging
- [ ] Mobile scribe (`/m/scribe`) tested on a real iPhone and a real Android device

## 11. Destroying the stack

```bash
# Staging only. NEVER run on prod without an RFC and a backup.
az group delete --name signacare-rg-staging --yes --no-wait
```

Bicep template is `targetScope = 'subscription'` so the resource group is owned by the deployment — `az group delete` tears everything down including the Key Vault (which enters the 90-day soft delete window and can be restored if this was a mistake).

## 12. Cost envelope (AUD, prod)

| Resource | SKU | Approx cost / month |
|---|---|---|
| App Service Plan | P1v3 | A$220 |
| Postgres Flexible Server | Standard_D4ds_v4 + 128 GB + HA | A$800 |
| Redis Cache | Standard C1 | A$110 |
| Storage Account | Standard_GRS, 100 GB | A$20 |
| Application Insights | Pay-as-you-go, ~2 GB/day | A$80 |
| Front Door | Standard tier | A$55 |
| Container Registry | Standard | A$30 |
| Key Vault | Standard | A$5 |
| **Total** | | **~A$1320 / month** |

Staging at the B1 / Standard_B2ms tier comes in around A$350/month. Dev environments can run on Free or Basic tiers if you're willing to accept no-HA and cold starts.

---

*End of Azure Deployment Guide. Revisions logged in git history.*
