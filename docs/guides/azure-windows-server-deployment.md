# Signacare EMR — Azure Windows Server Deployment Runbook

> **Legacy / reference only:** This Windows VM runbook is not the active
> Signacare production deployment lane. Use the Linux App Service lane in
> `deploy/azure/main.bicep` unless a Windows-only requirement is explicitly
> approved and documented. See
> [`docs/operations/deployment-learnings.md`](../operations/deployment-learnings.md).

**Target:** Windows Server 2022 Datacenter VM (IaaS) hosting the full Signacare stack on a single VM.
**Tier:** Dev / Test (single-VM, manual deploy)
**Region:** `australiaeast` (Australian Data Residency)
**Last updated:** 2026-05-03

---

## What this runbook covers

This is a **manual** deployment runbook for installing Signacare EMR on a single Windows Server 2022 VM in Azure. The VM hosts:

- **Node.js 20 LTS** (API + Web) running as Windows Services via `node-windows`
- **PostgreSQL 17** (Windows installer, data dir on attached data disk)
- **Memurai** (Microsoft's Windows-native Redis fork — API-compatible)
- **IIS 10** as TLS-terminating reverse proxy + static SPA host

This is the **single-VM hosting posture** chosen 2026-05-03 per organisational requirement that all components run on Windows Server. For the original Linux App Service stack (separate managed PG + Redis + App Service), see [`docs/guides/deployment-guide.md`](deployment-guide.md) and [`docs/plans/azure-staging-deployment.md`](../plans/azure-staging-deployment.md).

Architecture companion (high-level + detailed): [`azure-windows-vm-architecture-and-deployment.md`](./azure-windows-vm-architecture-and-deployment.md).

---

## Tradeoffs at a glance

| Aspect | Single Windows VM (this runbook) | Linux App Service (existing alt) |
|---|---|---|
| OS | Windows Server 2022 Datacenter | Linux (Ubuntu) App Service |
| Node hosting | Windows Service via node-windows | Docker container in App Service |
| PostgreSQL | Self-hosted on VM | Azure Database for PostgreSQL Flex Server (managed) |
| Redis | Memurai on VM | Azure Cache for Redis (managed) |
| Reverse proxy | IIS 10 | nginx in App Service container |
| Single point of failure | YES (one VM) | No (App Service auto-recovers; managed PG has HA option) |
| Backup posture | Operator's responsibility (Azure Backup recommended) | Automatic Azure managed-service backups |
| Cost (dev/test) | ~AUD $250-400/month | ~AUD $200-300/month |
| Maintenance burden | High (OS patching + PG upgrades + Redis upgrades) | Low (Azure manages) |
| Org's Windows licensing posture | Preserved | Not applicable |

---

## Prerequisites (one-time, on your operator workstation)

1. **Azure CLI installed**: `az --version` ≥ 2.55
2. **Azure subscription with these roles**:
   - `Contributor` on the resource group
   - `User Access Administrator` (for Key Vault role assignments later)
3. **Repository checkout**: this runbook references files in `deploy/azure/windows-vm/`
4. **Strong-password generator** (PowerShell, 1Password, or similar)
5. **Your corporate IP /32 CIDR** for RDP allowlist (e.g. `203.0.113.42/32`)

---

## Phase 0 — Build artifacts on your workstation

Before provisioning the VM you need a release bundle that preserves the monorepo workspace contract (`apps/api` depends on `@signacare/shared`).

```bash
# In the Signacare repo root:
git checkout main
git pull origin main

# Build + package a Windows VM release bundle
deploy/azure/windows-vm/00-package-release.sh

# Output:
#   artifacts/windows-vm-release-<timestamp>/
#   artifacts/windows-vm-release-<timestamp>.zip
```

---

## Phase 1 — Provision the Azure VM (10-15 minutes)

### 1.1 Set deploy parameters

Edit [`deploy/azure/parameters.windows-dev.json`](../../deploy/azure/parameters.windows-dev.json):

```json
{
  "rdpAllowedSource": { "value": "203.0.113.42/32" },
  "winrmAllowedSource": { "value": "None" }
}
```

Replace `203.0.113.42/32` with **your operator workstation's public IP** (find it via `curl ifconfig.me`).

### 1.2 Generate a strong admin password

PowerShell:
```powershell
$adminPassword = -join ((48..57) + (65..90) + (97..122) + (33,35,36,37,38,42,43,45,61,63,64) | Get-Random -Count 24 | ForEach-Object {[char]$_})
$adminPassword
```

Save it to your password manager. You'll RDP with this in step 2.

### 1.3 Run the Bicep deploy

```bash
# Login to Azure
az login
az account set --subscription <your-subscription-id>

# Create resource group
az group create \
  --name signacare-windows-dev-rg \
  --location australiaeast

# Deploy the VM + network
az deployment group create \
  --resource-group signacare-windows-dev-rg \
  --template-file deploy/azure/main-windows.bicep \
  --parameters @deploy/azure/parameters.windows-dev.json \
  --parameters adminPassword="$adminPassword"

# Capture outputs
az deployment group show \
  --resource-group signacare-windows-dev-rg \
  --name main-windows \
  --query 'properties.outputs' \
  --output json
```

**Expected outputs:**
- `vmFqdn` — e.g. `signacare-dev.australiaeast.cloudapp.azure.com`
- `vmPublicIp` — e.g. `52.187.x.x`
- `httpsEndpoint` — `https://signacare-dev.australiaeast.cloudapp.azure.com`

---

## Phase 2 — First-run VM setup (20-30 minutes)

### 2.1 RDP to the VM

```bash
mstsc /v:<vmFqdn>
```

Login as `signacareadmin` / `<adminPassword from 1.2>`.

### 2.2 Copy the windows-vm scripts to the VM

From the **operator workstation** (in a new terminal):
```bash
# zip the windows-vm directory
cd /path/to/Signacare
zip -r windows-vm-scripts.zip deploy/azure/windows-vm/

# upload via scp (if OpenSSH server enabled on VM) OR via:
# RDP clipboard copy-paste OR
# Azure Storage Account (az storage blob upload + download via VM)
```

The simplest first-time approach: **copy-paste each script through the RDP clipboard**:
1. On your laptop, open `deploy/azure/windows-vm/01-setup-prerequisites.ps1`
2. Select all + copy
3. In the RDP session, open Notepad, paste, save as `C:\Setup\01-setup-prerequisites.ps1`
4. Repeat for `02-create-database.ps1`, `03-deploy-app.ps1`, `04-configure-iis.ps1`, `05-install-services.ps1`, `06-configure-redis.ps1`, `web.config`, `env.windows-template`

### 2.3 Run script 01 — install prerequisites

In an **elevated PowerShell** (right-click → Run as Administrator):
```powershell
cd C:\Setup
.\01-setup-prerequisites.ps1
```

This takes 10-15 minutes and installs:
- Chocolatey
- Node.js 20 LTS + node-windows global
- PostgreSQL 17 (data dir relocated to `D:\Signacare\postgres-data\cluster`)
- Memurai (Redis-Windows fork)
- IIS 10 + URL Rewrite + Application Request Routing
- Windows Firewall rules (allow 80/443; block PG/Redis from outside)

The script generates a PostgreSQL superuser password and writes it to `D:\Signacare\postgres-data\superuser-password.txt`. **Note this for step 2.4** then keep it in your password manager.

### 2.4 Run script 02 — create database

```powershell
$pgSuperuserPassword = Get-Content D:\Signacare\postgres-data\superuser-password.txt
.\02-create-database.ps1 -PostgresSuperuserPassword $pgSuperuserPassword
```

This creates:
- Database `signacaredb`
- Role `signacare_owner` (DDL, runs migrations)
- Role `app_user` (runtime, minimum-privilege)
- Extensions `pgcrypto` + `pg_trgm`

Generated passwords are saved to `D:\Signacare\postgres-data\generated-passwords.txt`. **Move them to Azure Key Vault NOW** (see Phase 6) and delete the local file.

---

## Phase 3 — Stage the app artifacts (5-10 minutes)

### 3.1 Upload the build artifacts to the VM

Easiest path (Azure Storage Account):

```bash
# On your workstation: use the bundle created in Phase 0
ls artifacts/windows-vm-release-*.zip

# Create a temp storage account + container
az storage account create -n signacarestaging$RANDOM -g signacare-windows-dev-rg -l australiaeast --sku Standard_LRS
# Capture the account name from the output, then:
ACCOUNT_NAME=<from-above>
az storage container create -n staging --account-name $ACCOUNT_NAME --auth-mode login
az storage blob upload --account-name $ACCOUNT_NAME -c staging -n signacare-build.zip -f artifacts/windows-vm-release-<timestamp>.zip --auth-mode login
```

Then **on the VM**, download + extract:
```powershell
# Get a SAS URL from the operator workstation (az storage blob generate-sas)
# OR use az login on the VM (Az PowerShell module installed by chocolatey: choco install az.powershell)

Invoke-WebRequest -Uri '<sas-url>' -OutFile C:\Setup\signacare-build.zip
Expand-Archive -Path C:\Setup\signacare-build.zip -DestinationPath D:\Signacare -Force
# The extracted folder is windows-vm-release-<timestamp>. Rename it to
# the canonical runtime path expected by scripts:
$bundleDir = Get-ChildItem D:\Signacare -Directory | Where-Object Name -like 'windows-vm-release-*' | Select-Object -First 1
Rename-Item -Path $bundleDir.FullName -NewName app
```

After extraction the directory layout should be:
```
D:\Signacare\app\
├── package.json
├── package-lock.json
├── apps\
│   ├── api\
│   │   ├── dist\
│   │   ├── migrations\
│   │   ├── scripts\
│   │   ├── package.json
│   │   └── .env             ← created in step 3.2
│   └── web\
│       └── dist\
└── packages\
    └── shared\
        ├── dist\
        └── package.json
```

### 3.2 Create the .env file

```powershell
# Copy the template
Copy-Item C:\Setup\env.windows-template D:\Signacare\app\apps\api\.env

# Edit it with the actual values:
notepad D:\Signacare\app\apps\api\.env
```

Fill in:
- `DB_PASSWORD` from `D:\Signacare\postgres-data\generated-passwords.txt`
- `DB_APP_PASSWORD` (same file)
- `JWT_ACCESS_SECRET` — generate with `[Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))`
- `JWT_REFRESH_SECRET` — same shape
- `PHI_ENCRYPTION_KEY` — same shape; **NEVER ROTATE this after PHI lands**
- `BLIND_INDEX_KEY` — same shape
- `SESSION_SECRET` — same shape
- `CORS_ORIGIN` — `https://<vmFqdn>` (from step 1.3)
- `WEBAUTHN_RP_ID` — bare hostname, no protocol

### 3.3 Run script 03 — deploy app + run migrations

```powershell
cd C:\Setup
.\03-deploy-app.ps1
```

This:
1. Validates artifacts present
2. Runs `npm ci --omit=dev --workspace packages/shared --workspace apps/api --include-workspace-root=false`
3. Runs `npm run migrate --workspace apps/api` (applies all DB migrations)
4. Boots a temp instance of the API + curls `/health` to verify

Expected output: `Health check PASS — {"status":"ok","service":"signacare-api","timestamp":"..."}`

---

## Phase 4 — Configure IIS reverse proxy (5 minutes)

```powershell
cd C:\Setup
.\04-configure-iis.ps1
```

This:
1. Creates IIS site `signacare`
2. Binds 80 (HTTP) + 443 (HTTPS with self-signed cert)
3. Drops `web.config` into the site root with URL Rewrite + ARR rules
4. Restarts IIS

**Browser test (from your laptop):** open `https://<vmFqdn>` in a private tab — accept the self-signed cert warning. You should see the SPA loading state.

**For production**, replace the self-signed cert with a real one:
```powershell
# 1. Get a real cert (Let's Encrypt via Posh-ACME, or upload a PFX bought from a CA)
# 2. Import:
Import-PfxCertificate -FilePath C:\path\to\cert.pfx -CertStoreLocation Cert:\LocalMachine\My -Password (Read-Host -AsSecureString)
# 3. Re-bind:
$cert = Get-ChildItem Cert:\LocalMachine\My | Where-Object { $_.Subject -like '*your-domain*' } | Select-Object -First 1
Get-WebBinding -Name signacare -Protocol https | Remove-WebBinding
New-WebBinding -Name signacare -Protocol https -Port 443
$binding = Get-WebBinding -Name signacare -Protocol https
$binding.AddSslCertificate($cert.Thumbprint, 'My')
iisreset /restart
```

---

## Phase 5 — Register the API as a Windows Service (5 minutes)

```powershell
cd C:\Setup
.\05-install-services.ps1
```

This registers the Node.js API as `SignacareAPI` Windows Service that:
- Auto-starts on boot
- Restarts on crash (5 retries with backoff)
- Logs to `D:\Signacare\app\apps\api\daemon\`

Final smoke test (from your laptop):
```bash
curl https://<vmFqdn>/health
# Expected: {"status":"ok","service":"signacare-api","timestamp":"..."}

curl https://<vmFqdn>/ready
# Expected: {"status":"ready","checks":{"postgres":"ok","redis":"ok"}}
```

---

## Phase 5b — Relocate Memurai persistence to data drive (3 minutes; recommended for staging/prod)

By default Memurai writes its AOF/RDB persistence files to `C:\ProgramData\Memurai\`. The data-disk-separation rationale of `main-windows.bicep` (separate Premium SSD for stateful data) is half-applied without relocating Memurai. For staging/production where BullMQ jobs hold clinical work-in-progress (HL7 inbound queue, retention purge candidates), Azure Backup snapshots of the data disk should capture Redis state alongside PostgreSQL.

```powershell
cd C:\Setup
.\06-configure-redis.ps1
```

Idempotent — re-runs as a no-op if Memurai is already relocated. Backs up `memurai.conf` with a timestamp suffix before editing.

For dev/test where Redis is purely ephemeral cache (rate limit, session idle window), this phase is **optional**.

---

## Phase 6 — Move secrets to Key Vault (15 minutes)

The dev/test posture above stores secrets in `D:\Signacare\app\apps\api\.env`. For production-readiness, move them to Azure Key Vault:

```bash
# Create Key Vault
az keyvault create \
  --name signacare-windows-dev-kv \
  --resource-group signacare-windows-dev-rg \
  --location australiaeast

# Push secrets (substitute actual values)
az keyvault secret set --vault-name signacare-windows-dev-kv --name jwt-access-secret    --value "<value>"
az keyvault secret set --vault-name signacare-windows-dev-kv --name jwt-refresh-secret   --value "<value>"
az keyvault secret set --vault-name signacare-windows-dev-kv --name phi-encryption-key   --value "<value>"
az keyvault secret set --vault-name signacare-windows-dev-kv --name blind-index-key      --value "<value>"
az keyvault secret set --vault-name signacare-windows-dev-kv --name session-secret       --value "<value>"
az keyvault secret set --vault-name signacare-windows-dev-kv --name db-password          --value "<value>"
az keyvault secret set --vault-name signacare-windows-dev-kv --name db-app-password      --value "<value>"

# Grant the VM's managed identity read access (enable system-assigned identity first)
az vm identity assign --resource-group signacare-windows-dev-rg --name signacare-vm-dev
PRINCIPAL_ID=$(az vm show -g signacare-windows-dev-rg -n signacare-vm-dev --query 'identity.principalId' -o tsv)
az keyvault set-policy --name signacare-windows-dev-kv --object-id $PRINCIPAL_ID --secret-permissions get list

# DELETE the local password files on the VM
# (RDP into the VM)
Remove-Item D:\Signacare\postgres-data\generated-passwords.txt -Force
Remove-Item D:\Signacare\postgres-data\superuser-password.txt -Force
```

Then update `D:\Signacare\app\apps\api\.env`:
```env
SECRETS_BACKEND=azure_keyvault
AZURE_KEYVAULT_URL=https://signacare-windows-dev-kv.vault.azure.net
# Remove the inline DB_PASSWORD / DB_APP_PASSWORD / JWT_* / PHI_ENCRYPTION_KEY / BLIND_INDEX_KEY / SESSION_SECRET lines
```

Restart the service:
```powershell
Restart-Service -Name SignacareAPI
```

---

## Phase 7 — Backup posture (one-time setup)

Single-VM hosting carries SPOF risk. Set up daily backups:

```bash
# Enable Azure Backup for the VM
az backup vault create \
  --resource-group signacare-windows-dev-rg \
  --name signacare-backup-vault \
  --location australiaeast

az backup protection enable-for-vm \
  --resource-group signacare-windows-dev-rg \
  --vault-name signacare-backup-vault \
  --vm signacare-vm-dev \
  --policy-name DefaultPolicy
```

Default policy: daily snapshot, 30-day retention. Tune for your compliance posture.

**Database-level backup** (in addition to VM snapshot):
```powershell
# Schedule a daily pg_dump via Task Scheduler
$pgDump = 'C:\Program Files\PostgreSQL\17\bin\pg_dump.exe'
$backupDir = 'D:\Signacare\backups'
$action = New-ScheduledTaskAction -Execute $pgDump -Argument "-h localhost -U postgres -F custom -f $backupDir\signacaredb-$(Get-Date -Format yyyyMMdd).dump signacaredb"
$trigger = New-ScheduledTaskTrigger -Daily -At 2am
Register-ScheduledTask -Action $action -Trigger $trigger -TaskName 'SignacarePgBackup' -RunLevel Highest -User 'NT AUTHORITY\SYSTEM'
```

---

## Phase 8 — Seed dev/test data (optional)

Once the deployment passes smoke tests, seed synthetic data for engineering work:

```powershell
cd D:\Signacare\app\apps\api
node -r dotenv/config dist\src\seed-good-health\index.js
```

---

## Operations cheat sheet

| Task | Command |
|---|---|
| Restart API service | `Restart-Service -Name SignacareAPI` |
| View API logs | `Get-Content D:\Signacare\app\apps\api\daemon\SignacareAPI.out.log -Tail 100 -Wait` |
| View error logs | `Get-Content D:\Signacare\app\apps\api\daemon\SignacareAPI.err.log -Tail 100 -Wait` |
| Restart Postgres | `Restart-Service -Name postgresql-x64-17` |
| Restart Redis | `Restart-Service -Name Memurai` |
| Restart IIS | `iisreset /restart` |
| Check service health | `curl https://<vmFqdn>/health` |
| Run migrations | `cd D:\Signacare\app; npm run migrate --workspace apps/api` |
| Manual DB query | `psql -h localhost -U signacare_owner -d signacaredb` |
| OS patches | `Install-WindowsUpdate -AcceptAll -AutoReboot` (requires PSWindowsUpdate module) |
| Free disk space check | `Get-Volume \| Format-Table -AutoSize` |

---

## Troubleshooting

### Health check returns 503 (`postgres: not_ready`)

Check Postgres is running:
```powershell
Get-Service -Name postgresql-x64-17
psql -h localhost -U signacare_owner -d signacaredb -c "SELECT version()"
```

If service is stopped, check `D:\Signacare\postgres-data\cluster\log\` for crash details.

### Health check returns 503 (`redis: not_ready`)

```powershell
Get-Service -Name Memurai
redis-cli -h 127.0.0.1 -p 6379 ping
# Expected: PONG
```

### API service won't start

```powershell
# Check Event Viewer
Get-EventLog -LogName Application -Source SignacareAPI -Newest 20

# Check stderr
Get-Content D:\Signacare\app\apps\api\daemon\SignacareAPI.err.log -Tail 100
```

Common causes:
- `.env` file missing or malformed
- DB password wrong (verify by `psql -h localhost -U app_user -d signacaredb`)
- Port 4000 already in use (`netstat -ano | findstr :4000`)

### IIS shows blank page or 502 Bad Gateway

```powershell
# Verify ARR proxy is enabled
& "$env:windir\system32\inetsrv\appcmd.exe" list config -section:system.webServer/proxy
# Expected: enabled="true"

# Verify URL Rewrite module installed
Get-WebConfigurationProperty -PSPath 'IIS:\' -Filter 'system.webServer/globalModules' -Name '.' |
  Where-Object Name -like '*Rewrite*'
```

### Migrations fail with permission errors

The migration runner connects as `signacare_owner` (DDL role). If the role's password is wrong:
```powershell
# Reset role password (need superuser)
$pgSuperuserPassword = '<from-keyvault>'
$env:PGPASSWORD = $pgSuperuserPassword
& 'C:\Program Files\PostgreSQL\17\bin\psql.exe' -h localhost -U postgres -d postgres -c "ALTER ROLE signacare_owner PASSWORD '<new-password>'"
# Then update D:\Signacare\app\apps\api\.env DB_PASSWORD
Restart-Service -Name SignacareAPI
```

---

## What this runbook does NOT cover

These items are out of scope for this single-VM dev/test deploy and tracked elsewhere:

| Concern | Tracked in |
|---|---|
| Production-grade clustering / failover | TBD — single-VM is dev/test only |
| Multi-region / DR | Out of dev/test scope |
| HSM-backed key storage (above Key Vault standard SKU) | Compliance follow-up |
| ADHA / HL7 / eRx vendor sandbox certificates | `docs/plans/azure-staging-deployment.md` |
| Real PHI handling | Pre-staging gate (per session plan) |
| AHPRA Standard 1 attestation | Pre-pilot work |
| GitHub Actions automated deploy | Future enhancement (org has chosen manual for now) |
| Retention purge production-arming (RETENTION_DRY_RUN=false) | Requires ≥30d dry-run window per BUG-374c |

---

## Decommissioning

To tear down the dev/test environment:
```bash
# 1. Backup the database (just in case)
ssh ... pg_dump -F custom signacaredb > final-backup.dump

# 2. Delete the resource group (everything in one shot)
az group delete --name signacare-windows-dev-rg --yes
```

This deletes the VM, network, public IP, NSG, vnet, Key Vault (soft-deleted; purgeable for 90 days), and Storage Account.

---

## Cost estimate (dev/test, australiaeast, May 2026)

| Resource | SKU | Monthly est. (AUD) |
|---|---|---|
| VM Standard_D4s_v5 | 4 vCPU, 16 GB RAM, 24/7 | ~$220 |
| OS disk Premium SSD | P10 (128 GB) | ~$25 |
| Data disk Premium SSD | P15 (256 GB) | ~$40 |
| Static Public IP | Standard | ~$5 |
| Bandwidth | Outbound (varies) | ~$10 (low dev/test traffic) |
| Backup vault | Default policy (30-day retention) | ~$15 |
| Key Vault | Standard SKU | ~$3 |
| **Total** | | **~AUD $320/month** |

For production with always-on VM + larger SKU + tighter backup retention, expect ~AUD $600-1,200/month per VM.

---

## Appendix A — File inventory

All artifacts referenced by this runbook live in:

- [`deploy/azure/main-windows.bicep`](../../deploy/azure/main-windows.bicep) — VM provisioning template
- [`deploy/azure/parameters.windows-dev.json`](../../deploy/azure/parameters.windows-dev.json) — dev tier sizes
- [`deploy/azure/windows-vm/00-package-release.sh`](../../deploy/azure/windows-vm/00-package-release.sh) — build + package monorepo release bundle
- [`deploy/azure/windows-vm/01-setup-prerequisites.ps1`](../../deploy/azure/windows-vm/01-setup-prerequisites.ps1) — install Node + PG + Redis + IIS
- [`deploy/azure/windows-vm/02-create-database.ps1`](../../deploy/azure/windows-vm/02-create-database.ps1) — create signacaredb + roles
- [`deploy/azure/windows-vm/03-deploy-app.ps1`](../../deploy/azure/windows-vm/03-deploy-app.ps1) — install deps + migrations
- [`deploy/azure/windows-vm/04-configure-iis.ps1`](../../deploy/azure/windows-vm/04-configure-iis.ps1) — IIS reverse proxy
- [`deploy/azure/windows-vm/05-install-services.ps1`](../../deploy/azure/windows-vm/05-install-services.ps1) — Node as Windows Service
- [`deploy/azure/windows-vm/06-configure-redis.ps1`](../../deploy/azure/windows-vm/06-configure-redis.ps1) — Memurai persistence relocation to data drive (optional for dev/test; recommended for staging/prod)
- [`deploy/azure/windows-vm/web.config`](../../deploy/azure/windows-vm/web.config) — IIS URL Rewrite + ARR rules
- [`deploy/azure/windows-vm/env.windows-template`](../../deploy/azure/windows-vm/env.windows-template) — .env template

---

## Change log

| Date | Change |
|---|---|
| 2026-05-03 | Initial version — created in response to org clarification of Windows Server hosting requirement |
