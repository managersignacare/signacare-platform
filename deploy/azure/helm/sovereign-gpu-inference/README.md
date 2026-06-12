# Sovereign GPU Inference Helm Chart

This chart deploys the Phase 5 `sovereign_gpu` inference workload onto the
AKS `inference` node pool provisioned by
`deploy/azure/modules/sovereign-gpu-aks.bicep`.

Non-negotiables:

- Image references are digest-only: `repository@sha256:<image-digest>`.
- Model identity is a separate pinned manifest SHA-256.
- Pods tolerate only `signacare.io/lane=inference:NoSchedule`.
- Pods select only `signacare.io/pool=inference`.
- Training jobs must use the separate `training` node pool and are not part
  of this chart.
- Runtime pulls are forbidden; the container exits if the baked model
  manifest is missing or mismatched.

Example:

```bash
helm upgrade --install signacare-sovereign-gpu \
  deploy/azure/helm/sovereign-gpu-inference \
  --namespace signacare-ai \
  --create-namespace \
  --set image.repository='<acr>.azurecr.io/signacare-ollama-sovereign' \
  --set image.digest='sha256:<image-digest>' \
  --set runtime.modelManifestSha256='sha256:<manifest-digest>'
```

After deploy, expose the internal service URL to the API runtime as
`OLLAMA_URL=http://signacare-sovereign-gpu-inference.signacare-ai.svc.cluster.local:11434`
and set:

```bash
SOVEREIGN_GPU_LANE_ENABLED=true
SOVEREIGN_INFERENCE_IMAGE=<acr>.azurecr.io/signacare-ollama-sovereign@sha256:<image-digest>
SOVEREIGN_INFERENCE_MODEL_MANIFEST_SHA256=sha256:<manifest-digest>
```
