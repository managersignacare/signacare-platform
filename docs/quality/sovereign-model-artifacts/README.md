# Sovereign Model Artifact Evidence

Store reviewed sovereign GPU model-artifact manifests here when promoting a
self-hosted inference image for the `sovereign_gpu` lane.

Records must satisfy `SovereignModelArtifactManifestSchema` and pass:

```bash
npm run ai:sovereign-artifact:validate -- --manifest docs/quality/sovereign-model-artifacts/<record>.json
```

Do not add placeholder JSON. Each record must point to real image build
evidence, vulnerability scan evidence, rollback image evidence, approval
identity, and training-adapter compatibility evidence proving clinician style
adapters will not be silently invalidated by the model swap.
