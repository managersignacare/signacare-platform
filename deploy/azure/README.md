# Signacare Azure Deployment (Linux App Service + Bicep)

This folder holds the Linux App Service deployment path:

- `main.bicep` — Linux stack: PostgreSQL, Redis, Key Vault, Storage, App Services
- `deploy.sh` — Infra + bootstrap helper for one-shot Linux provisioning
- `preflight-linux.sh` — deterministic preflight checks before Azure operations
- `post-deploy-smoke.sh` — app readiness probes after deployment
- `verify-database-release-controls.sh` — prod proof gate for database release controls
- `parameters.{staging,prod}.json` — Azure environment parameter sets
- `windows` deployment path is intentionally separate (`main-windows.bicep` and `windows-vm/*`)

For the deployment retrospective and future guardrails, see
[`docs/operations/deployment-learnings.md`](../../docs/operations/deployment-learnings.md).

## Active vs legacy deployment lanes

The active deployment lane is Linux App Service:

- `deploy/azure/main.bicep`
- `deploy/azure/deploy.sh`
- `deploy/azure/preflight-linux.sh`
- `deploy/azure/post-deploy-smoke.sh`
- `.github/workflows/azure-deploy.yml`

`.github/workflows/azure-deploy.yml` is the single canonical application image
deployment workflow for the Azure web/API estate. Stale alternate deploy
workflows must not be reintroduced.

The Windows VM lane is retained as legacy/reference only:

- `deploy/azure/main-windows.bicep`
- `deploy/azure/windows-vm/*`

Do not mix these lanes in a single deployment action. Do not use Windows VM
assets for production unless a Windows-only requirement is explicitly approved
and documented.

## Why this split exists

- Linux deployment covers App Service + managed platform services.
- Windows VM deployment uses a different topology and different runbooks.
- Keeping these paths separate prevents accidental dependency bleed and makes deployment failures diagnosable.

## Linux deployment sequence (gold-standard, fail-fast)

Development is local-machine development. The Azure lane starts at staging:
developer changes are committed and pushed to GitHub, GitHub Actions builds the
immutable staging artifact, and production is promoted from that reviewed
staging artifact. There is intentionally no Azure `dev` deployment lane.

1. **Preflight**

   ```bash
   bash deploy/azure/preflight-linux.sh staging
   # or
   bash deploy/azure/preflight-linux.sh prod
   ```

   The script checks:

   - Azure CLI/login/subscription context
   - provider registration state
   - parameter-level invariants (`namePrefix`, `location`, `postgresSku`, `redisSku`, etc.)
   - `keyVaultAdminObjectId` validity in tenant
   - PostgreSQL SKU validity for selected region
   - template validate readiness
   - existing in-flight deployments and resource-group deletion states
   - ACR visibility

2. **Deploy**

   ```bash
   bash deploy/azure/deploy.sh staging
   # or
   bash deploy/azure/deploy.sh prod
   ```

   `deploy.sh` now invokes `preflight-linux.sh` first and exits immediately on any blocking issue.

3. **Post-deploy smoke**

   ```bash
   ENV=staging bash deploy/azure/post-deploy-smoke.sh
   # or
   ENV=prod bash deploy/azure/post-deploy-smoke.sh
   ```

   For staging/demo environments, provide a demo clinician login so the smoke
   script also verifies the seeded rating-scale library that powers Patient →
   Assessments → Add Rating Scale:

   ```bash
   SMOKE_LOGIN_EMAIL='mateo.soerensen@eastern.goodhealth.demo' \
   SMOKE_LOGIN_PASSWORD='...' \
   ENV=staging bash deploy/azure/post-deploy-smoke.sh
   ```

   A clean demo database must run both:

   ```bash
   npm run seed:good-health -w apps/api
   npm run seed:rating-scales -w apps/api
   ```

   `seed:good-health` creates clinics, staff, patients, and notes.
   `seed:rating-scales` creates the enterprise assessment template library
   (`BPRS-24`, `PANSS`, `AIMS`, `HoNOS`, `PHQ-9`, etc.) in both `templates`
   and `clinical_templates`. If `/api/v1/templates` returns zero rows, the
   Assessments dropdown is empty even though the app code is healthy.

   CI staging smoke treats authenticated clinical-config probes as optional
   unless `SMOKE_REQUIRE_AUTHENTICATED_CHECKS=true` is configured in GitHub
   environment variables. Production smoke sets that flag by default, so prod
   promotion cannot pass without `SMOKE_LOGIN_EMAIL` and `SMOKE_LOGIN_PASSWORD`.

   Production smoke also requires observability proof by default. The smoke
   script reads API App Service settings through Azure CLI and fails if
   `APPLICATIONINSIGHTS_CONNECTION_STRING`, `OTEL_EXPORTER_OTLP_ENDPOINT`,
   `SLACK_WEBHOOK_SECURITY`, or `SLACK_WEBHOOK_OPS` are unset. Staging can opt
   into the same fail-closed behaviour with `SMOKE_REQUIRE_OBSERVABILITY=true`.

4. **Image rollout (GitHub Actions only)**

   Infrastructure only creates/updates the platform. App image rollout is
   handled by `.github/workflows/azure-deploy.yml`.

   The workflow authenticates to Azure with GitHub OIDC, not a long-lived
   `AZURE_CREDENTIALS` secret. The checked-in defaults point to the Signacare
   Azure tenant/subscription and OIDC app registration; repo or environment
   vars/secrets may override `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`,
   `AZURE_SUBSCRIPTION_ID`, `ACR_NAME_STAGING`, and `ACR_NAME_PROD` if a future
   tenant split requires it.

   Staging builds `linux/amd64` images in CI, resolves each pushed image to
   `repo@sha256:...`, writes `artifacts/release/release-manifest.json`, deploys
   those digests into the non-prod `next` slot, proves API `/ready` plus
   `/version` on that slot, and only then swaps `next` into the live staging
   site. Post-swap smoke re-proves `/version` on the live staging hostname
   before the release is considered complete.

   Staging AI runtimes are part of that canonical lane. The workflow always
   builds and stamps the Ollama/Whisper sidecar digests for staging so
   `/version` and drift-audit evidence remain complete for the full staging
   stack. Prod remains a separate governance decision and does not implicitly
   enable staging-style sidecar rollout.

   The API container runs the compiled migration entrypoint on startup
   (`apps/api/entrypoint.sh`) before the server boots. The Azure deploy
   workflow waits for API `/ready` to return `200` after the new API image
   rolls out before it advances the release, so schema drift blocks staging
   immediately instead of surfacing later as partial runtime failure.

   Production is promoted from staging. Trigger the workflow manually with:

   - `environment=prod`
   - `staging_run_id=<reviewed staging GitHub Actions run ID>`
   - `staging_image_tag=<staging manifest artifact suffix>`
   - `swap_after_deploy=true` only after you want the smoked staging slot to
     become production

   The prod lane downloads the reviewed staging manifest artifact, imports the
   exact image digests into the prod ACR with `az acr import`, writes a prod
   promotion manifest, deploys by `prod-acr.azurecr.io/repo@sha256:...` into
   the production `staging` slot, smoke-tests `/version` against the promoted
   manifest before slot swap, and then repeats the same proof against the live
   production hostname after swap.

   Production promotion requires production Azure resources to exist first:
   a prod resource group, prod ACR, prod API/web App Services, and the matching
   OIDC role assignments. If those resources do not exist, the workflow is
   intentionally unable to promote from staging.

   Production promotion also requires database release-control evidence before
   images are rolled out. Configure these GitHub environment variables with the
   reviewed proof artifact or ticket references:

   - `DB_STAGING_CLONE_MIGRATION_PROOF`
   - `DB_EXPAND_CONTRACT_PROOF`
   - `DB_RESTORE_DRILL_PROOF`
   - `DB_ROLLBACK_REHEARSAL_PROOF`

   See
   [`docs/operations/runbooks/database-release-controls.md`](../../docs/operations/runbooks/database-release-controls.md)
   for the staging-clone migration test, expand/contract, restore-drill, and
   rollback-rehearsal sequence.

   Production deploys require a checked AI model governance record through
   the GitHub workflow. For a non-model release, provide a reviewed
   `decision: "no_change"` record whose `fromDeploymentRef` and
   `toDeploymentRef` are identical and whose shadow evidence uses the same
   deployment reference for every raw metric. Provide both workflow inputs:

   - `ai_model_promotion_alias=<fast_clinical|best_clinical|local_sovereign|court_report_reasoning>`
   - `ai_model_promotion_record=docs/quality/ai-model-governance/<record>.json`

   The deploy fails closed unless those inputs are present and
   `npm run ai:model-promotion:validate` passes. The workflow uploads the record
   as an artifact and stamps `SIGNACARE_AI_MODEL_PROMOTION_*` metadata onto the
   API runtime. See
   [`docs/architecture/ai-model-governance.md`](../../docs/architecture/ai-model-governance.md).
   Out-of-band provider or portal model changes are not detectable from this
   application deployment workflow and must be treated as break-glass incidents.

   The infrastructure helper enforces the same rule for production Azure
   OpenAI Bicep deployments. If `deploy/azure/parameters.prod.json` enables
   Azure OpenAI, run:

   ```bash
   AI_MODEL_PROMOTION_ALIAS=best_clinical \
   AI_MODEL_PROMOTION_RECORD=docs/quality/ai-model-governance/<record>.json \
   bash deploy/azure/deploy.sh prod
   ```

   Sovereign GPU lane provisioning has a separate model-artifact gate. If
   `parameters.<env>.json` enables `enableSovereignGpu=true`, run the helper
   with a reviewed artifact manifest:

   ```bash
   SOVEREIGN_MODEL_ARTIFACT_MANIFEST=docs/quality/sovereign-model-artifacts/<record>.json \
     bash deploy/azure/deploy.sh <staging|prod>
   ```

   The manifest must pass `npm run ai:sovereign-artifact:validate`; the helper
   extracts the digest-pinned `imageRef` and `modelManifestSha256` and passes
   those exact values into Bicep. This prevents a model/image swap from
   invalidating clinician style adapters silently.

   The workflow stamps the manifest hash, commit SHA, image digests, OpenAPI
   hash, env/config contract hash, migration head, and prod promotion provenance
   into API App Service settings. The post-deploy smoke script then compares
   those expected values with the API `/version` response.

   A second control checks for post-release drift. The scheduled workflow
   `.github/workflows/deployment-drift-audit.yml` runs
   `deploy/azure/check-release-drift.sh`, which compares the live API
   `/version` payload with App Service `linuxFxVersion` digests and stamped
   `SIGNACARE_*` release metadata. This catches portal-side container swaps,
   stale app settings, and release-proof drift after a successful deploy.

   Long psychiatric interview scribe work must use the async BullMQ/SSE
   architecture rather than a browser-blocking request. See
   [`docs/architecture/async-ai-scribe-architecture.md`](../../docs/architecture/async-ai-scribe-architecture.md)
   for the active target contract.

   Do not build or patch production/staging images from a developer laptop. If a
   break-glass manual rollout is ever required, open an incident, record release
   lead approval, and reproduce the exact CI artifact digest. A manually rebuilt
   image is not considered the same release artifact.

## Web container startup troubleshooting

If the web App Service returns 503 while Azure reports the site as `Running`,
inspect container startup logs before rerunning infrastructure:

```bash
az webapp log tail -g signacare-rg-staging -n signacare-web-staging
az webapp log download -g signacare-rg-staging -n signacare-web-staging --log-file /tmp/signacare-web-staging-logs.zip
```

The 2026-06-03 staging failure was caused by `apps/web/entrypoint.sh` parsing
`API_UPSTREAM=https://.../api` as host `https:`. The fix was a web-only image
rebuild and App Service image update, not an infra redeploy. A follow-up web
proxy check also required nginx to send the upstream API host as `Host` with TLS
SNI enabled, otherwise `/api/*` requests through the web host can loop or return
400 on Azure App Service.

For web-only fixes, commit the patch and trigger the Azure Deploy workflow for
the target environment. The workflow must still deploy by digest; do not patch
the live App Service to an image tag built outside CI.

## What to do when preflight blocks

- **`keyVaultAdminObjectId not resolvable`**  
  Set a valid AAD object ID for the tenant where you are currently logged in.

- **Provider not registered**  
  Re-run `az provider register -n <provider>` and wait for `RegistrationState=Registered`.

- **PostgreSQL SKU invalid**  
  Use a SKU returned by `az postgres flexible-server list-skus` for your region.

- **Provider in-progress deployments detected**  
  Wait for completion or explicitly cancel/roll back only if you have operation context.

- **`Validation failed`**  
  Re-open `/tmp/signacare-<env>-validate.err` from preflight, fix the contract issue, rerun.

## Operational notes

- `deploy.sh` is still a local/manual operational entrypoint for infra shape changes.
- CI deploy workflow is not blocked by app-service image rollout; it assumes infra has already been prepared.
- For Linux and Windows VM work, use separate Git remotes if required by governance policy.
