# Linux App Service Deployment Readiness (Signacare)

## 0) Why keep this separate from Windows VM deployment

- **`deploy/azure/main.bicep`** and **`deploy/azure/deploy.sh`** are the Linux
  App Service stack (PostgreSQL Flexible Server, Redis, Key Vault, App Service).
- **`deploy/azure/main-windows.bicep`** + `deploy/azure/windows-vm/*` are the
  legacy/alternate Windows IaaS track.
- We should not mix them in one deployment action.
  - Linux action reads: `deploy/azure/main.bicep` and `deploy/azure/parameters.{staging,prod}.json`.
  - Windows action reads: `deploy/azure/main-windows.bicep` and `deploy/azure/parameters.windows-dev.json`.

When a team repeatedly hits deployment stalls, the highest ROI fix is to
**separate “infrastructure readyness” from “app rollout”** and fail early on
known Azure/infra contract mismatches before `az deployment` enters long-running
async state.

---

## 1) Linux deployment preflight checklist

Run the preflight script before every Linux infra deployment:

```bash
bash deploy/azure/preflight-linux.sh staging
# or:
bash deploy/azure/preflight-linux.sh prod
```

It enforces:

1. **Operator/tooling readiness**
   - `az`, `jq`, `openssl` present
   - logged-in Azure session + active subscription
2. **Azure provider registration**
   - `Microsoft.Web`, `Microsoft.DBforPostgreSQL`, `Microsoft.Cache`,
     `Microsoft.KeyVault`, `Microsoft.Storage`, `Microsoft.Insights`
     (and related telemetry providers) are registered.
3. **Subscription and namespace state**
   - no active deployment in the target resource group that is still running/in progress
   - no resource group with `provisioningState: Deleting`
4. **Parameter contract checks**
   - `keyVaultAdminObjectId` is real AAD objectId (Group/User/SP),
   - `location` is AU region expected by policy,
   - PostgreSQL SKU is valid in the selected region,
   - Azure Redis tier is safe for intended environment,
   - template validates without immediate template-level errors.
5. **Known blocker early indicators**
   - stale extension-like update locks in subscription-level deployment flow,
   - malformed object IDs causing `PrincipalNotFound`,
   - invalid PostgreSQL SKU causing `ServerEditionIncompatibleWithSkuSize`,
   - hidden naming/resource id conflicts.

### Interpretation of likely failures

| Failure symptom | Most likely root cause | First action |
|---|---|---|
| `PrincipalNotFound` on `keyVaultAdminObjectId` | stale/mistyped AAD object ID | replace with real, active AAD group/user/service principal objectId |
| `ServerEditionIncompatibleWithSkuSize` | PostgreSQL SKU invalid for that region/edition mode | choose valid SKU from location matrix (for AU east, `Standard_D2ds_v4` is valid for staged Linux deploy) |
| deployment state stuck in `Running/Accepted` | prior deployment still active or canceled incompletely | wait / cancel with explicit correlation IDs, then resume |
| `basic` Redis selected in non-dev + multi-DB clients expected | production-like runtime incompatibility | use `Standard` for staging/prod |

---

## 2) Minimal deployment order (Linux stack)

1. **Preflight** (new step)
2. `az deployment sub validate` (already in deploy script; now guaranteed to be meaningful)
3. `az deployment sub create` (infra)
4. Seed Key Vault required secrets (bootstrap)
5. App container image push (`gh` or `az acr login` + `docker push`)
6. Configure web/api containers (App Service)
7. Post-deploy smoke (`deploy/azure/post-deploy-smoke.sh`)
8. App smoke + manual clinical-path checks (login + one protected patient action)

---

## 3) How this anticipates future blocks

- We move from “retrying forever” to “**predict-then-fail-fast**”.
- Every known recurring blocker is now checked by deterministic script logic before
  infra creates/changes resources.
- We keep the two codepaths isolated, so one platform issue does not accidentally
  mask the other.

