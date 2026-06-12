#!/usr/bin/env sh
set -eu

: "${OLLAMA_HOST:=0.0.0.0:11434}"
: "${OLLAMA_MODELS:=/opt/signacare/ollama/models}"
: "${OLLAMA_REQUIRE_MODELS:=llama3.2}"
: "${OLLAMA_MODEL_MANIFEST_PATH:=/tmp/ollama-model-manifest.json}"

export OLLAMA_HOST
export OLLAMA_MODELS

mkdir -p "$OLLAMA_MODELS"

if [ -n "${OLLAMA_MODEL_MANIFEST_SHA256:-}" ]; then
  if [ ! -f "$OLLAMA_MODEL_MANIFEST_PATH" ]; then
    echo "Required baked Ollama model manifest is missing: $OLLAMA_MODEL_MANIFEST_PATH" >&2
    exit 1
  fi

  actual_manifest_sha="sha256:$(sha256sum "$OLLAMA_MODEL_MANIFEST_PATH" | awk '{print $1}')"
  if [ "$actual_manifest_sha" != "$OLLAMA_MODEL_MANIFEST_SHA256" ]; then
    echo "Baked Ollama model manifest digest mismatch: expected $OLLAMA_MODEL_MANIFEST_SHA256, got $actual_manifest_sha" >&2
    exit 1
  fi
fi

ollama serve &
server_pid="$!"

shutdown() {
  kill "$server_pid" 2>/dev/null || true
  wait "$server_pid" 2>/dev/null || true
}
trap shutdown INT TERM

until ollama list >/dev/null 2>&1; do
  sleep 2
done

for model in $OLLAMA_REQUIRE_MODELS; do
  if ollama show "$model" >/dev/null 2>&1; then
    echo "Ollama model already present: $model"
  else
    echo "Required baked Ollama model is missing: $model" >&2
    shutdown
    exit 1
  fi
done

wait "$server_pid"
