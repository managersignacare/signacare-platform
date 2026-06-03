# Signacare Azure Deployment (Linux App Service + Bicep)

This folder holds the Linux App Service deployment path:

- `main.bicep` — Linux stack: PostgreSQL, Redis, Key Vault, Storage, App Services
- `deploy.sh` — Infra + bootstrap helper for one-shot Linux provisioning
- `preflight-linux.sh` — deterministic preflight checks before Azure operations
- `post-deploy-smoke.sh` — app readiness probes after deployment
- `parameters.{dev,staging,prod}.json` — environment parameter sets
- `windows` deployment path is intentionally separate (`main-windows.bicep` and `windows-vm/*`)

## Why this split exists

- Linux deployment covers App Service + managed platform services.
- Windows VM deployment uses a different topology and different runbooks.
- Keeping these paths separate prevents accidental dependency bleed and makes deployment failures diagnosable.

## Linux deployment sequence (gold-standard, fail-fast)

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

4. **Image rollout (GitHub Actions or manual)**

   Infrastructure only creates/updates the platform. App image rollout is handled by
   `.github/workflows/azure-deploy.yml`.

   For any manual `docker build` pushes to ACR, we must build multi-tenant-safe x64 Linux images explicitly:

   ```bash
   docker buildx build --platform linux/amd64 --push -f apps/api/Dockerfile -t signacarecrstaging.azurecr.io/signacare-api:latest .
  docker buildx build --platform linux/amd64 --push -f apps/web/Dockerfile --build-arg VITE_API_URL="https://signacare-api-staging.azurewebsites.net/api" -t signacarecrstaging.azurecr.io/signacare-web:latest .
   ```
   
   Never push arm64-only images to `${namePrefix}cr${ENV}` for the App Service Linux plan.

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
