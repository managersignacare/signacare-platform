# Deployment Learnings And Future Deployment Guardrails

**Status:** Authoritative operational learning note
**Last updated:** 2026-06-05
**Scope:** Azure deployment learning from the original Signacare monorepo

## Executive Summary

Signacare should treat the Azure Linux deployment path as the primary production candidate and the Windows VM path as legacy/reference until a specific customer, regulatory, or operational constraint requires Windows.

The Windows VM effort showed that the main failure mode was not application code. The failure mode was orchestration: a large EMR stack was being installed and configured through VM-agent-mediated operations that can become slow, serialized, or stuck. The Linux work moved the repo toward a cleaner model: containerized API/web services plus managed PostgreSQL, Redis, Key Vault, ACR, and App Service deployment gates.

## What We Learned

| Learning | Meaning | Required guardrail |
|---|---|---|
| Heavy VM bootstrap is brittle | Installing Postgres, Redis/Memurai, IIS, Node, migrations, services, and certificates through a VM control plane creates long-running operations and hard-to-debug partial states. | Prefer container image rollout plus managed services. Use VM bootstrap only for constrained customer requirements. |
| Deployment topology must be singular | Mixing Windows VM, Linux App Service, Container Apps, AKS, IIS, nginx, Front Door, and Application Gateway language creates operator confusion. | Declare one active topology per deployment lane and keep incompatible lanes clearly separated. |
| Static repo readiness is not deployment readiness | A Bicep validate pass does not prove the live app starts, resolves secrets, connects to DB/Redis, or serves clinical routes. | Every deployment must pass post-deploy smoke gates before being considered usable. |
| Secret contract drift is a deployment blocker | Wrong PHI key length/format, matching PHI/blind-index keys, stale Key Vault object IDs, or missing secrets can crash startup or silently disable features. | Validate secret shape before deployment and verify Key Vault references after deployment. |
| Runtime image content matters | Linux-aware code is not enough if the container image lacks required binaries such as `pg_dump`, `gzip`, OCR tools, Python, Whisper, or Ollama. | Each runtime workflow must be explicitly assigned to the API image, a sidecar/job, or a feature-flagged disabled state. |
| Container entrypoints are deployment contracts | The web App Service returned 503 even though Azure resources were healthy because `apps/web/entrypoint.sh` mis-parsed `API_UPSTREAM=https://.../api` as host `https:` and exited before nginx started. | Treat entrypoint parsing, DNS resolution, and generated nginx config as first-class smoke targets. Inspect App Service container startup logs before rerunning infra. |
| Managed service replacement reduces risk | Managed PostgreSQL and managed Redis remove whole classes of VM persistence, patching, service startup, and backup risks. | Prefer Azure Database for PostgreSQL Flexible Server and Azure Cache for Redis for staging/prod. |
| Integration incompleteness must be deployment-visible | Stubbed or partially linked integrations can look like deployed features unless explicitly gated. | Incomplete integrations must be feature-flagged, marked amber/red, and excluded from go-live claims. |
| Split repos must not hide deployment knowledge | Linux deployment work happened before repo split and exists in the original monorepo and platform split. | Continue proving deployment in the original repo if needed, then sync clean lessons into `signacare-platform`. |
| A second deploy workflow is operational clutter | The old dry-run AKS-style `.github/workflows/deploy.yml` created a competing deployment story next to the real Azure App Service workflow. | Keep `.github/workflows/azure-deploy.yml` as the single canonical app deployment pipeline and block stale deploy workflows with `guard:repo-architecture-contract`. |

## Active Deployment Lanes

| Lane | Location | Status | Rule |
|---|---|---|---|
| Linux App Service | `deploy/azure/main.bicep`, `deploy/azure/deploy.sh`, `deploy/azure/preflight-linux.sh` | Primary deployment candidate | Use this for current Azure Linux testing. |
| Windows VM | `deploy/azure/main-windows.bicep`, `deploy/azure/windows-vm/*` | Legacy/reference | Do not use for production unless Windows is explicitly required. |
| Container Apps / AKS | Not the current Bicep implementation | Future option | Do not describe current deployment as Container Apps unless a real Container Apps template exists. |

## Should Windows And Linux Deployment Files Live In The Same Repo?

Short term: yes, but only if they are clearly separated and labelled.

Long term: no. Keeping both active-looking deployment paths in the same repo is confusing and increases operational risk. It invites the wrong script, wrong parameter file, or wrong architecture assumption at exactly the moment deployment needs calm precision.

The recommended staged approach is:

1. Keep both paths in the original repo while Linux deployment is still being proven.
2. Mark the Windows VM path as legacy/reference in docs and runbooks.
3. Do not delete Windows files until the Linux deployment has passed live smoke, rollback, backup/restore, and secret-validation gates.
4. After Linux is green, move Windows VM assets into a legacy archive or separate Windows-deployment repository.
5. Keep the future `signacare-platform` repo Linux-first, with only the deployment assets required for the selected production topology.

## Windows VM Legacy Marker

The Windows VM path is now explicitly marked as legacy/reference in:

- `deploy/azure/windows-vm/README.md`
- `deploy/azure/main-windows.bicep`
- `docs/guides/azure-windows-server-deployment.md`
- `docs/guides/azure-windows-vm-architecture-and-deployment.md`

This is intentional. The files remain available for historical traceability and
Windows-only exception cases, but they are no longer to be treated as the default
deployment route.

## Current Linux Deployment Guardrails

The current Linux lane must run in this order:

1. Run `bash deploy/azure/preflight-linux.sh staging` or `prod`.
2. Validate and deploy infrastructure with `deploy/azure/deploy.sh`.
3. Seed or verify Key Vault secrets without rotating existing production secrets unexpectedly.
4. Build `linux/amd64` API and web images once in CI.
5. Roll images through `.github/workflows/azure-deploy.yml` by immutable `repo@sha256:...` digest.
6. For staging/demo rebuilds, run `npm run seed:good-health -w apps/api` and `npm run seed:rating-scales -w apps/api` after schema migration.
7. Run `ENV=<env> deploy/azure/post-deploy-smoke.sh`.
8. For staging/demo, rerun smoke with `SMOKE_LOGIN_EMAIL` and `SMOKE_LOGIN_PASSWORD` set so the authenticated template-library check verifies BPRS is present.
9. Inspect App Service container startup logs if any smoke probe fails, especially `/home/LogFiles/StartupLogs/*_failure.log` and `*_default_docker.log`.
10. Do not touch application runtime code unless the failure is proven to be a runtime contract issue and approved.

## 2026-06-03 Linux Staging Fix: Web Container 503

Confidence: HIGH for the observed staging failure and remediation, based on live Azure smoke verification on 2026-06-03.

During Linux staging verification, the API App Service passed all health,
readiness, FHIR, SMART, and CORS smoke checks, but the web App Service returned
503 for `/` and `/manifest.webmanifest`.

The Azure resource was not the problem. Container startup logs showed repeated:

```text
FATAL: API_UPSTREAM host is not resolvable in this container: https:
```

Root cause: `apps/web/entrypoint.sh` used a sed expression that did not strip
`https://` correctly in the nginx Alpine runtime, so the DNS preflight checked
`https:` instead of `signacare-api-staging.azurewebsites.net`.

Fix applied:

- Replaced the sed host parser with POSIX shell parameter expansion.
- Rendered nginx `proxy_pass` as `${API_UPSTREAM}/` so `/api/foo` forwards as
  `/api/foo` when `API_UPSTREAM` includes `/api`.
- Set nginx `Host`/TLS SNI to the upstream API host so Azure App Service does
  not route proxied API requests back to the web app.
- Rebuilt only the web image as `signacare-web:staging-web-entrypoint-20260603213808`,
  then as `signacare-web:staging-web-proxyhost-20260603214430` for the proxy
  host-header fix.
- Updated only `signacare-web-staging` to that image and reran smoke.

Verification:

- `https://signacare-web-staging.azurewebsites.net/` returned 200.
- `https://signacare-web-staging.azurewebsites.net/manifest.webmanifest` returned 200.
- Manifest `scope` remained `/m/`.
- `https://signacare-web-staging.azurewebsites.net/api/docs/` returned 200
  through the web nginx proxy.
- `ENV=staging bash deploy/azure/post-deploy-smoke.sh` passed.

## 2026-06-04 Linux Staging Fix: Rating Scales Missing

Confidence: HIGH for the observed staging data gap and remediation, based on live authenticated API/UI verification on 2026-06-04.

During staging verification, Patient → Assessments → Add Rating Scale rendered
no built-in scales. The original repo already had the enterprise seed
(`apps/api/src/seed-rating-scales.ts`) with `BPRS-24`, `PANSS`, `AIMS`, `HoNOS`,
`PHQ-9`, and the wider 35-scale library; staging simply had zero rows returned
from `/api/v1/templates` for the logged-in Good Health clinic.

Root cause: the Linux staging database was seeded with Good Health demo data,
but the enterprise rating-scale seed was not run. The app was healthy; the
clinic-scoped `templates` data needed by the Assessments tab was absent.

Fix applied:

- Resolved staging DB credentials from API App Service Key Vault references
  inside the operator shell without printing secret values.
- Added a temporary PostgreSQL firewall rule via Azure management REST, because
  the Azure CLI `firewall-rule create/delete` wrapper was hanging locally.
- Ran `npm run seed:rating-scales -w apps/api`, which upserted 35 rating scales
  for all 5 active Good Health clinics.
- Removed the temporary firewall rule and verified only the existing
  `allow-azure-services` rule remained.
- Added an optional authenticated post-deploy smoke check for `/api/v1/templates`
  so future staging rebuilds fail visibly if BPRS/rating-scale templates are
  missing.

Verification:

- `/api/v1/templates` through the staging web host returned 35 rating-scale
  templates for `mateo.soerensen@eastern.goodhealth.demo`.
- `BPRS-24 (Brief Psychiatric Rating Scale)` was present in the API response.
- A browser-level Playwright check opened Patient → Assessments → Add Rating
  Scale and confirmed the UI option `BPRS-24 (Brief Psychiatric Rating Scale)
  — Clinician-rated` was visible.

## 2026-06-07 Demo Data / Access Parity Note

Confidence: HIGH for the repo-side remediation. The staging QA findings on
2026-06-06 showed two recurring operator problems: Soham Health sometimes
arrived without its patient walkthrough data, and Good Health demo documents
looked like all `*.goodhealth.demo` superadmins were guaranteed to sign in even
when `SUPERADMIN_ALLOWED_EMAIL_DOMAINS` stayed on the platform defaults.

Repo-side fixes applied:

- Added a canonical seed bundle script:
  `npm -w apps/api run seed:soham-mental-health-demo-suite`
- The bundle runs:
  - `seed:soham-mh-demo-staff`
  - `seed:demo-patient-registrations`
  - `seed:noah-bennett-longitudinal-demo`
  - `seed:demo-patient-messages-and-tasks`
- Updated the Soham and Noah demo markdown files to point operators at the
  canonical bundle instead of relying on tribal knowledge.
- Updated the Good Health master login-table generator and generated markdown to
  explain the superadmin domain guard clearly:
  environments that keep the default
  `SUPERADMIN_ALLOWED_EMAIL_DOMAINS=signacare.net,signacare.local`
  should use `admin@signacare.local` as the guaranteed demo superadmin login.

Operational guidance:

- For a clean mental-health staging walkthrough, run the canonical Soham bundle
  after staff seed and before QA.
- Do not promise `*.goodhealth.demo` superadmin logins unless ops has
  intentionally extended `SUPERADMIN_ALLOWED_EMAIL_DOMAINS` to include those
  demo domains.

## 2026-06-04 Linux Staging Fix: AI Runtime Sidecars

Confidence: MEDIUM. The initial staging sidecar remediation was live-verified. It
was superseded on 2026-06-05 by dedicated Ollama/Whisper App Services because
the App Service compose canary path was too brittle and is now removed from the
repo.

During staging verification, the API was healthy but the medical scribe and
clinical-AI surfaces were not usable:

- `/api/v1/llm/whisper/status` reported `running:false`.
- Clinical AI returned the fallback text `[AI unavailable ...]`.
- `WHISPER_API_URL`, `OLLAMA_URL`, and `OLLAMA_BASE_URL` were absent from API
  App Service settings.
- `ai-scribe` and `ai-chat` were not visible to the frontend feature-flag
  bootstrap.

Fix applied:

- Added dedicated CI-built AI sidecar images:
  - `deploy/ai/ollama/Dockerfile` + entrypoint, serving Ollama on `11434` with
    `llama3.2:signacare-35f39aa1` baked into the image at build time. The
    Dockerfile validates a vendored registry manifest digest, downloads exact
    blob digests, and the entrypoint fails closed if the required model is
    absent.
  - `deploy/ai/whisper/Dockerfile` + entrypoint, serving the existing Flask
    Whisper server on `8080` with pinned CPU `openai-whisper`, `torch`, and
    `ffmpeg`; the configured Whisper model is downloaded into the image cache at
    build time, verified by SHA-256, and rechecked at startup.
- Retired the App Service compose/canary slot path. The active staging runtime
  path is dedicated App Services:
  `signacare-ollama-staging` and `signacare-whisper-staging`.
- Added `deploy/azure/deploy-ai-runtime-services.sh` as the dedicated runtime
  deployer. It requires digest-pinned `AI_OLLAMA_IMAGE` and `AI_WHISPER_IMAGE`
  values, refuses production unless `AI_RUNTIME_PROD_APPROVED=true`, refreshes
  IP allow-rules idempotently, restricts direct AI service ingress to API App
  Service outbound IPs, and wires the API to HTTPS AI service URLs.
- Updated GitHub Actions so API, web, Ollama, and Whisper images are built once
  in CI, resolved to `repo@sha256:...` digest references, and deployed by digest
  rather than mutable tags.
- Set App Service startup/routing settings explicitly:
  `WEBSITES_CONTAINER_START_TIME_LIMIT=1800`, `WEBSITES_PORT=4000`,
  `PORT=4000`, `WEBSITES_ENABLE_APP_SERVICE_STORAGE=true`.
- Set runtime AI env:
  `OLLAMA_URL=http://ollama:11434`,
  `OLLAMA_BASE_URL=http://ollama:11434`,
  `WHISPER_API_URL=http://whisper:8080`,
  `AI_EXTERNAL_HOSTS=ollama,whisper`,
  `OLLAMA_MODEL=llama3.2:signacare-35f39aa1`,
  `OLLAMA_MODEL_VERSION=llama3.2:signacare-35f39aa1@sha256:35f39aa10ab6344466b66afa2681446fc66e9631e013b047068177842d9afc58`,
  `WHISPER_MODEL=small`,
  `LLM_MAX_CONCURRENT=1`,
  `WHISPER_MAX_CONCURRENT=1`.
- Enabled staging AI UI flags for active clinics:
  `ai-chat`, `ai-scribe`, and `scribe-live-transcript-beta`.
- Patched `listFeatureFlags()` to use the same owner/tenant-aware lookup style
  as `isFeatureEnabled()` so global flags are not hidden from frontend
  bootstrap by tenant RLS.
- Added a read-only global feature-flag RLS policy locally so global rows remain
  visible under FORCE RLS without depending on runtime BYPASSRLS.
- Updated the GitHub Actions deploy path locally so deployments publish the API,
  web, Ollama, and Whisper images once, resolve digests, stamp AI model
  metadata into `/version`, and deploy the dedicated staging AI runtime services
  when `AZURE_AI_RUNTIME_ENABLED=true` is set.
- Added `guard:ai-runtime-immutable-contract` so the workflow cannot regress to
  `latest` deploys, build-at-deploy sidecars, runtime `ollama pull`, the
  retired compose canary path, unpinned base images, unverified Whisper model
  downloads, or optional authenticated smoke skips.
- Pinned AI sidecar base images by digest instead of mutable base tags.

Verification:

- `https://signacare-api-staging.azurewebsites.net/health` returned 200.
- `https://signacare-api-staging.azurewebsites.net/ready` returned
  `postgres: ok` and `redis: ok`.
- `/api/v1/feature-flags` for the Good Health Eastern clinician returned
  `ai-chat=true`, `ai-scribe=true`, and `scribe-live-transcript-beta=true`.
- `/api/v1/llm/whisper/status` returned `running:true` and
  `url:http://whisper:8080`.
- `/api/v1/llm/clinical-ai` with a synthetic non-PHI ISBAR prompt returned a
  real `llama3.2` response and did not contain an AI-unavailable fallback.
- `/api/v1/scribe/preferences` returned 200, proving the scribe feature gate is
  open for the staging clinician.
- The temporary PostgreSQL firewall rule used to set clinic flags was removed;
  only `allow-azure-services` remains.

Residual:

- Confidence: HIGH that this is a staging capacity limitation, LOW that CPU-only
  sidecars are sufficient for production until production-like load tests run.
- This is CPU-only staging capacity. Production-grade scribe/AI should decide
  whether Whisper/Ollama stay as App Service sidecars, move to Container Apps,
  or move to GPU-backed AKS/VM workers.
- The ambient scribe must support psychiatric interviews up to 60 minutes, not
  short voice memos. The synchronous HTTP path is now intentionally capped below
  Azure request-lifetime limits (`AMBIENT_HTTP_TIMEOUT_MS=210000`,
  `AMBIENT_WHISPER_TIMEOUT_MS=210000`, `AMBIENT_OLLAMA_TIMEOUT_MS=180000`,
  `AMBIENT_AUDIO_MAX_BYTES=67108864`, `AMBIENT_UPLOAD_MAX_CONCURRENT=1`).
  Hour-long interviews must use an async queue + persisted output +
  polling/SSE progress workflow; one long browser request is not an enterprise
  availability contract.
- OCR binaries (`ocrmypdf`, `pdftotext`, `tesseract`) are not part of the API
  runtime image today; keep OCR workflows assigned to a worker/sidecar or add
  those binaries explicitly before claiming OCR is production-ready.

## 2026-06-04 — AI summary 30-second web timeout after AI runtime was healthy

Confidence: HIGH for the observed frontend timeout failure mode; MEDIUM for local code hardening until the next staging deploy proves the final timeout chain.

After Ollama and Whisper were confirmed healthy, some AI summary surfaces still
failed in staging with `timeout of 30000ms exceeded`.

Root cause:

- The shared web Axios client had a 30-second default timeout.
- It attempted to extend AI timeouts only when `config.url` contained
  `/llm/`, `/scribe/`, or `/voice/`.
- Most frontend callers use relative paths such as `llm/clinical-ai`, without a
  leading slash, so those calls could silently retain the 30-second default.
- This presented to the user like another AI runtime failure even though
  deployed `/llm/models` showed `llama3.2 available:true` and Whisper status
  showed `running:true`.

Fix applied:

- Added normalized AI endpoint detection in
  `apps/web/src/shared/services/apiClient.ts` that recognises relative,
  slash-prefixed, and absolute `llm`, `scribe`, and `voice` URLs.
- The shared client now raises only default-timeout AI requests to the configured
  long-running AI timeout and preserves explicit per-route overrides, including
  the capped synchronous ambient-note upload timeout.
- Added `apps/web/src/shared/services/apiClientTimeouts.test.ts` so
  `llm/clinical-ai` cannot regress to the 30-second path.
- Rebuilt and deployed only the web image to staging:
  `signacarecrstaging.azurecr.io/signacare-web@sha256:bef965a11db6da302b8b0dc21acdb70964b35f8aa496479339a082eabd26f44d`.

Verification:

- `npm run test -w apps/web -- apiClientTimeouts.test.ts` passed.
- `npm run build -w apps/web` passed.
- `https://signacare-web-staging.azurewebsites.net/login` returned 200 and
  served assets tagged `staging-web-ai-timeout-20260604152021`.
- Azure reports the staging web app is pinned to the digest above.

## 2026-06-04 — AI summaries still slow after 30-second web fix

Confidence: MEDIUM. Local fixes align web/API timeouts with the 10-minute local Ollama generation budget; production-grade 60-minute psychiatric interviews still require an async job architecture.

After the normalized web timeout fix, routine AI summaries could still time
out or feel too slow in staging.

Root cause:

- The API route for `/api/v1/llm/clinical-ai` still hard-coded Express
  request/response timeouts to 180 seconds.
- The server-wide `/llm/*` timeout middleware also hard-coded 180 seconds.
- Staging App Service env already set `LOCAL_LLM_GENERATE_TIMEOUT_MS=600000`,
  so Ollama generation could legally run for 10 minutes while the API HTTP
  request could still abort at 3 minutes.
- Several frontend summary/document surfaces passed explicit 120-180 second
  Axios timeouts, preventing the shared long-running-AI timeout from helping.
- Patient Summary tab requests used `enhance: true`, which triggers the
  enhanced generator's two-pass path for complex actions such as Maudsley and
  formulation. On CPU-only staging, that can double latency.

Fix applied locally:

- Added API `resolveLlmHttpTimeoutMs()` so `/llm/*` HTTP timeouts default to
  `LOCAL_LLM_GENERATE_TIMEOUT_MS + 60s` and can be overridden with
  `LLM_HTTP_TIMEOUT_MS`.
- Raised the web long-running AI timeout default to 600 seconds, with optional
  `VITE_LONG_RUNNING_AI_TIMEOUT_MS`.
- Replaced explicit 120-180 second frontend AI timeouts with the shared
  long-running timeout.
- Extended API long-running route classification to include `/scribe` and
  `/voice`, matching the web client and preventing backend 30-second timeout
  regression on those AI paths.
- Kept clinical summary surfaces on `enhance: true`; staging speed should be
  fixed by capacity, timeout alignment, model choice, or async jobs rather than
  silently reducing clinical-summary quality.

Operational note:

- This improves synchronous staging behavior but does not make long AI
  generation enterprise-grade. Azure App Service/proxy request lifetimes can
  still make very long synchronous requests brittle. The production-grade path
  remains async AI jobs with persisted output and polling/SSE progress.

## Known Open Deployment Risks

| Risk | Required resolution before production |
|---|---|
| API container may not include all required runtime binaries | Decide whether backup/OCR/Whisper/Ollama live in the API image, sidecar jobs, dedicated workers, or disabled feature flags. |
| Live smoke has previously timed out after image rollout | Treat smoke failure as a hard stop and inspect App Service container logs before retrying. Do not rerun `deploy.sh` until startup logs prove infra is actually wrong. |
| Documentation still mixes App Service, Container Apps, AKS, Front Door, and Application Gateway concepts | Rewrite deployment docs around the selected active topology. |
| Windows VM files remain beside Linux files | Keep them labelled as legacy, then archive/split after Linux proof. |
| Some integrations remain partial or stubbed | Use `docs/integration-completeness-ssot.md` to feature-flag or exclude incomplete integrations from go-live scope. |

## Decision Rule

If there is no explicit Windows-only constraint, the production path should remain Linux App Service or a future Linux container platform. Windows VM deployment should be retained only as reference material until Linux deployment is proven and then archived or split away.
