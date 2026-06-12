FROM ollama/ollama@sha256:7a3fe51cf50e0a6ddbcd054247d160baa90eb1935700bb59f3e96aa9a6da5025

ARG OLLAMA_MODEL=llama3.2:signacare-35f39aa1
ARG OLLAMA_REGISTRY_MODEL_PATH=library/llama3.2
ARG OLLAMA_MODEL_MANIFEST_SHA256=sha256:35f39aa10ab6344466b66afa2681446fc66e9631e013b047068177842d9afc58

ENV OLLAMA_MODELS=/opt/signacare/ollama/models \
    OLLAMA_REQUIRE_MODELS=${OLLAMA_MODEL} \
    OLLAMA_MODEL_MANIFEST_PATH=/tmp/ollama-model-manifest.json \
    OLLAMA_MODEL_MANIFEST_SHA256=${OLLAMA_MODEL_MANIFEST_SHA256}

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl python3 \
  && rm -rf /var/lib/apt/lists/*

COPY deploy/ai/ollama/llama3.2-35f39aa1.manifest.json /tmp/ollama-model-manifest.json

RUN set -eux; \
  manifest="/tmp/ollama-model-manifest.json"; \
  actual="sha256:$(sha256sum "$manifest" | awk '{print $1}')"; \
  test "$actual" = "$OLLAMA_MODEL_MANIFEST_SHA256"; \
  mkdir -p "$OLLAMA_MODELS"; \
  python3 - "$manifest" "$OLLAMA_MODELS" "$OLLAMA_REGISTRY_MODEL_PATH" "$OLLAMA_MODEL" <<'PY'
import hashlib, json, os, sys, urllib.request
from pathlib import Path

manifest_path = Path(sys.argv[1])
models_root = Path(sys.argv[2])
registry_path = sys.argv[3]
model_alias = sys.argv[4]
manifest = json.loads(manifest_path.read_text())

blobs_dir = models_root / 'blobs'
blobs_dir.mkdir(parents=True, exist_ok=True)
descriptors = [manifest.get('config'), *manifest.get('layers', [])]
for descriptor in descriptors:
    if not isinstance(descriptor, dict):
        continue
    digest = descriptor.get('digest')
    if not isinstance(digest, str) or not digest.startswith('sha256:'):
        raise SystemExit(f'Invalid Ollama blob digest in manifest: {digest!r}')
    target = blobs_dir / digest.replace(':', '-')
    if not target.exists():
        url = f'https://registry.ollama.ai/v2/{registry_path}/blobs/{digest}'
        with urllib.request.urlopen(url) as response, target.open('wb') as out:
            out.write(response.read())
    actual = 'sha256:' + hashlib.sha256(target.read_bytes()).hexdigest()
    if actual != digest:
        raise SystemExit(f'Ollama blob checksum mismatch for {target}: expected {digest}, got {actual}')

repo, model_name = registry_path.split('/', 1)
alias_name, alias_tag = model_alias.split(':', 1)
if alias_name != model_name:
    raise SystemExit(f'OLLAMA_MODEL alias {model_alias!r} must match registry model {model_name!r}')
manifest_target = models_root / 'manifests' / 'registry.ollama.ai' / repo / model_name / alias_tag
manifest_target.parent.mkdir(parents=True, exist_ok=True)
manifest_target.write_bytes(manifest_path.read_bytes())
PY

COPY deploy/ai/ollama/entrypoint.sh /usr/local/bin/signacare-ollama
RUN chmod +x /usr/local/bin/signacare-ollama

EXPOSE 11434

ENTRYPOINT ["/usr/local/bin/signacare-ollama"]
