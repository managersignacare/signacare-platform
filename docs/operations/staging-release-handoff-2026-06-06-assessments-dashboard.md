# Staging Release Handoff — 2026-06-06

## Scope

Release the assessment-registry continuation and dashboard discoverability work from:

- `0ba392e4` `feat(assessments): separate outcomes and rating scales`
- `7de81169` `feat(ui): add dashboard options and measurement trends`
- `5e0b86f6` `feat(assessments): restore builtin registry defaults`

At the time this handoff was prepared:

- local `main` = `5e0b86f6`
- `origin/main` = `2be4b380`

That means staging will not show the latest dashboard entry points until
`5e0b86f6` is pushed and the staging deploy runs.

## Canonical staging deploy lane

The active application deployment path is Azure Linux App Service, not the
legacy Windows VM assets.

Canonical files:

- `.github/workflows/azure-deploy.yml`
- `deploy/azure/README.md`
- `deploy/azure/post-deploy-smoke.sh`

Trigger rules:

- `push` to `main` auto-deploys to `staging`
- `workflow_dispatch` supports manual `staging` or `prod`

## Staging target names

The workflow computes these names for `staging`:

- resource group: `signacare-rg-staging`
- API app: `signacare-api-staging`
- web app: `signacare-web-staging`
- slot: none for staging deploys

The staging ACR default is:

- `signacarecrstaging.azurecr.io`

## Web build identity

The staging web image is built from `apps/web/Dockerfile` with:

- `VITE_API_URL=/api/v1`
- `VITE_BUILD_SHA=${GITHUB_SHA}`
- `VITE_ASSET_VERSION=<shortsha-timestamp image tag>`

The UI now exposes a visible build stamp so deploy drift is easier to confirm:

- `Web <sha>` comes from `VITE_BUILD_SHA` with fallback to `VITE_ASSET_VERSION`
- `API <sha>` comes from `/health`

If staging shows an unexpected web SHA after deploy, suspect browser or CDN
cache before assuming the app code is missing.

## Expected staging outcome

After the deploy reaches `5e0b86f6`, staging should show:

- separate patient tabs for `Rating Scales` and `Outcome Measures`
- built-in rating/self-rating scale availability even for clinics without local
  seeded template rows
- sidebar/settings entry points for `Dashboard Options`
- direct dashboard routes reachable at `/dashboards` and `/dashboards/my-work`
- visible build stamp in the UI showing web/API release IDs

## Post-deploy checks

1. Confirm the build stamp on the page shows the expected web SHA prefix for
   the deployed commit.
2. Confirm `/health` reports the same API commit SHA as the deploy run.
3. Open a patient file and verify both `Rating Scales` and `Outcome Measures`
   appear as separate tabs in the file explorer.
4. Open `/dashboards` and `/settings/dashboard-options`.
5. If the UI still shows the combined assessment page while the build stamp is
   old, clear site data and reload.

## Repo evidence

Relevant implementation files:

- `apps/web/src/shared/components/ui/BuildStamp.tsx`
- `apps/web/src/shared/components/ui/AppShell.tsx`
- `apps/web/src/shared/components/ui/Sidebar.tsx`
- `apps/web/src/features/settings/pages/SettingsPage.tsx`
- `apps/web/src/features/patients/types/patientTypes.ts`
- `apps/web/src/features/patients/components/detail/patientDetailTabRegistry.ts`
