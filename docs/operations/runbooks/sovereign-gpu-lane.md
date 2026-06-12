# Runbook — Sovereign GPU Lane (Phase 5)

**Lane:** `sovereign_gpu`
**Backend:** Self-hosted Ollama on AKS GPU node pool, image-baked model, no runtime pulls.
**Provisioned by:** `deploy/azure/modules/sovereign-gpu-aks.bicep`
**Pre-requisites:** Private VNet from `network-private.bicep` with sovereign subnets enabled.

## 1 — Bake the inference image

Phase 5 requirement #2: model artefact must be IMMUTABLE.

```bash
# 1. Build an Ollama image that bakes the model at BUILD time, with
# the manifest SHA-256 pinned into the image's content layer.
docker build \
  --build-arg OLLAMA_MODEL=llama3.2:signacare-35f39aa1 \
  --build-arg OLLAMA_MODEL_MANIFEST_SHA256=sha256:35f39aa10ab6344466b66afa2681446fc66e9631e013b047068177842d9afc58 \
  -t <prefix>cr<env>.azurecr.io/signacare-ollama-sovereign:35f39aa1 \
  -f deploy/ai/ollama/Dockerfile .

# 2. Push to ACR.
az acr login -n <prefix>cr<env>
docker push <prefix>cr<env>.azurecr.io/signacare-ollama-sovereign:35f39aa1

# 3. Resolve the IMMUTABLE digest reference.
DIGEST=$(az acr repository show --name <prefix>cr<env> \
  --image signacare-ollama-sovereign:35f39aa1 \
  --query digest -o tsv)
echo "$DIGEST"
# sha256:9b8c... — record this in the governed artifact manifest below.
```

The image MUST contain the model under `/home/ollama/models` and MUST
have `OLLAMA_MODEL_MANIFEST_SHA256` baked into the environment so the
container fails at boot if the manifest digest changes. There is no
`ollama pull` at runtime; `check-no-runtime-model-pull`,
`guard:sovereign-gpu-artifact-contract`, and
`guard:sovereign-gpu-lane-contract` enforce this across the repo.

## 2 — Create and validate the governed artifact manifest

Create a reviewed manifest under
`docs/quality/sovereign-model-artifacts/<env>-<model>-<date>.json`.
The manifest must include:

- `imageRef`: the ACR image digest ref, not a mutable tag.
- `modelManifestSha256`: the baked model manifest digest.
- `runtimePullAllowed: false`.
- `inferenceTrainingSeparated: true`.
- `trainingAdapterReview`: proof every existing clinician style adapter is
  compatible, or a deliberate hold/retrain decision before promotion.
- `rollbackImageRef`: the previous known-good sovereign image digest.
- build, vulnerability-scan, approval, and rollback evidence URIs.

Validate it before provisioning:

```bash
npm run ai:sovereign-artifact:validate -- \
  --manifest docs/quality/sovereign-model-artifacts/<record>.json
```

Do not commit placeholder manifests. A manifest is production evidence, not
a template.

## 3 — Provision the AKS cluster

```bash
SOVEREIGN_MODEL_ARTIFACT_MANIFEST="docs/quality/sovereign-model-artifacts/<record>.json" \
  deploy/azure/deploy.sh staging
```

`deploy.sh` validates the manifest, extracts `imageRef` and
`modelManifestSha256`, and passes those exact values into Bicep as
`sovereignInferenceImage` and `sovereignInferenceModelManifestSha256`.

## 4 — Verify lane separation (Phase 5 #3)

Inference and training MUST live on separate node pools, each tainted
with `signacare.io/lane=<pool>:NoSchedule`.

```bash
CLUSTER="<prefix>-aks-staging"
RG="<prefix>-rg-staging"
az aks get-credentials -g "$RG" -n "$CLUSTER"

# Confirm both pools exist.
kubectl get nodes -l 'signacare.io/pool=inference' -o name
kubectl get nodes -l 'signacare.io/pool=training' -o name

# Confirm the taints are applied — these are the structural enforcement.
kubectl get nodes -l 'signacare.io/pool=inference' \
  -o jsonpath='{.items[*].spec.taints[?(@.key=="signacare.io/lane")].value}'
# Expect: inference

kubectl get nodes -l 'signacare.io/pool=training' \
  -o jsonpath='{.items[*].spec.taints[?(@.key=="signacare.io/lane")].value}'
# Expect: training

# Confirm the model manifest digest is published as a node label so
# in-cluster smoke jobs can compare it to the runtime container.
kubectl get nodes -l 'signacare.io/pool=inference' \
  -o jsonpath='{.items[*].metadata.labels.signacare\.io/model-manifest-sha256}'
# Expect: sha256:35f39aa10ab6344466b66afa2681446fc66e9631e013b047068177842d9afc58
```

## 5 — Deploy the Ollama workload

Deploy the repo-owned Helm chart:
`deploy/azure/helm/sovereign-gpu-inference`.

```bash
helm upgrade --install signacare-sovereign-gpu \
  deploy/azure/helm/sovereign-gpu-inference \
  --namespace signacare-ai \
  --create-namespace \
  --set image.repository='<prefix>cr<env>.azurecr.io/signacare-ollama-sovereign' \
  --set image.digest='sha256:<image-digest>' \
  --set runtime.modelManifestSha256='sha256:35f39aa10ab6344466b66afa2681446fc66e9631e013b047068177842d9afc58'
```

The chart is intentionally narrow:

1. Tolerates only `signacare.io/lane=inference:NoSchedule`.
2. Selects only `signacare.io/pool=inference`.
3. References the inference image as `repository@sha256:<image-digest>`,
   never by tag.
4. Passes `OLLAMA_MODEL_MANIFEST_SHA256` and
   `OLLAMA_MODEL_MANIFEST_PATH` into the container so startup fails if the
   baked manifest is missing or mismatched.
5. Exposes `/api/tags` for startup, readiness, and liveness probes.
6. Ships a `NetworkPolicy`, `PodDisruptionBudget`, and service account
   with `automountServiceAccountToken: false`.

## 6 — Promote lane for a clinic

```sql
-- The clinic AI runtime backend is `local_ollama` (sovereign GPU is
-- the AKS-hosted ollama; the routing model uses local_ollama as the
-- backend enum). The cluster URL is published via env to the API.
UPDATE staff_settings
SET setting_value = jsonb_set(setting_value, '{llmBackend}', '"local_ollama"', true)
WHERE setting_key = 'ai_runtime'
  AND staff_id IN (SELECT id FROM staff WHERE clinic_id = '<clinic_id>');

-- API env on the App Service:
--   OLLAMA_URL=https://<aks-internal-loadbalancer-host>/v1
--   SOVEREIGN_GPU_LANE_ENABLED=true
--   SOVEREIGN_INFERENCE_IMAGE=<prefix>cr<env>.azurecr.io/signacare-ollama-sovereign@sha256:9b8c...
--   SOVEREIGN_INFERENCE_MODEL_MANIFEST_SHA256=sha256:35f39aa10ab6...
```

## 7 — Staging smoke

```bash
API_URL="https://$(az webapp show -g <prefix>-rg-staging -n <prefix>-api-staging --query defaultHostName -o tsv)"
TOKEN="$(./scripts/staging-smoke/login-as-admin.sh)"

curl -sf "$API_URL/health"

curl -sf -H "Authorization: Bearer $TOKEN" \
  "$API_URL/api/v1/ai/capabilities" | jq '
    .activeLane.lane,
    .activeLane.deploymentRef,
    .activeLane.modelVersion,
    .activeLane.privateNetworkEnforced,
    .activeLane.inferenceTrainingSeparated,
    .activeLane.healthCheckPath
  '
# Expect:
#   "sovereign_gpu"
#   "<prefix>cr<env>.azurecr.io/signacare-ollama-sovereign@sha256:9b8c...@sha256:35f39aa10ab6..."
#   "sha256:35f39aa10ab6..."
#   true
#   true
#   "/api/tags"
```

## 8 — Training-run procedure (scale-up + scale-down)

The training pool starts at 0 nodes (`scale to zero`). Operator runbook
for a training run:

```bash
# Scale up the training pool to 1 node (or more).
az aks nodepool scale -g "$RG" --cluster-name "$CLUSTER" --name training --node-count 1

# Submit the training Job (separate Helm chart) — tolerates
# signacare.io/lane=training:NoSchedule. The taint guarantees the Job
# CANNOT land on inference nodes even if cluster auto-scaler resizes
# the inference pool.

# When the training Job completes, scale back to 0.
az aks nodepool scale -g "$RG" --cluster-name "$CLUSTER" --name training --node-count 0
```

## 9 — Audit metadata visible to clinicians

Every clinical-AI completion that flows through the sovereign lane
records `activeLane.deploymentRef = "<image>@<manifest-sha256>"` on
`llm_interactions`. The clinician-visible disclosure includes "AI
generated by Signacare sovereign GPU lane, manifest sha256:35f39aa1..."
which lets a clinician attest exactly which immutable model produced
the draft.
