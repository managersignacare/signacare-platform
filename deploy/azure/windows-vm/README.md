# Legacy Windows VM Deployment Assets

**Status:** Legacy / reference only
**Production status:** Not the active Signacare production deployment lane
**Active lane:** Linux App Service via `deploy/azure/main.bicep`

This folder contains the historical Windows Server 2022 single-VM deployment
assets for Signacare. These files are retained for forensic traceability,
comparison, and possible customer-specific Windows-only deployments.

Do not use this folder for normal staging or production deployment.

## Why this is legacy

The Windows VM track concentrates the full stack on one VM:

- IIS reverse proxy and static web hosting
- Node API service through `node-windows`
- PostgreSQL on the VM
- Memurai/Redis on the VM
- PowerShell bootstrap scripts

That shape created deployment and operations risk during Azure testing:

- long-running VM-agent-mediated bootstrap operations,
- `RunCommand` / extension contention,
- manual service and certificate management,
- self-hosted database/cache patching burden,
- harder rollback and smoke-test isolation.

The current preferred deployment path is Linux App Service plus managed Azure
services:

- `deploy/azure/main.bicep`
- `deploy/azure/deploy.sh`
- `deploy/azure/preflight-linux.sh`
- `deploy/azure/post-deploy-smoke.sh`
- `.github/workflows/azure-deploy.yml`

## Use only if explicitly approved

Use these Windows VM assets only when a Windows-only constraint is approved and
documented, such as a customer requirement, regulatory constraint, or explicit
operational mandate.

Before using this lane, create a deployment decision record that explains why
Linux App Service is unsuitable and lists the additional controls required for
Windows VM production hardening.

## Related documents

- `docs/operations/deployment-learnings.md`
- `deploy/azure/README.md`
- `docs/guides/azure-windows-server-deployment.md`
- `docs/guides/azure-windows-vm-architecture-and-deployment.md`
