#!/usr/bin/env sh
set -eu

: "${PORT:=8080}"
: "${WHISPER_HOST:=0.0.0.0}"
: "${WHISPER_DEVICE:=cpu}"
: "${WHISPER_MODEL:=small}"
: "${WHISPER_WORKERS:=1}"
: "${WHISPER_THREADS:=2}"
: "${WHISPER_TIMEOUT_SECONDS:=900}"
: "${WHISPER_PRELOAD_MODEL:=true}"

export HOME="${HOME:-/opt/signacare/whisper}"
export WHISPER_CACHE_DIR="${WHISPER_CACHE_DIR:-$HOME/.cache/whisper}"

mkdir -p "$WHISPER_CACHE_DIR"

python - <<'PY'
import hashlib
import os
import sys
from pathlib import Path

import whisper

model = os.environ.get('WHISPER_MODEL', 'small')
cache_dir = Path(os.environ.get('WHISPER_CACHE_DIR', str(Path.home() / '.cache' / 'whisper')))
models = getattr(whisper, '_MODELS', {})
candidates = [cache_dir / f'{model}.pt', cache_dir / model / 'model.pt']
url = models.get(model) if isinstance(models, dict) else None
if isinstance(url, str):
    candidates.insert(0, cache_dir / Path(url).name)

found = next((candidate for candidate in candidates if candidate.is_file()), None)
if found is None:
    print(f'Required baked Whisper model is missing: {model}', file=sys.stderr)
    for candidate in candidates:
        print(f'  checked: {candidate}', file=sys.stderr)
    sys.exit(1)

expected = os.environ.get('WHISPER_MODEL_SHA256', '').strip().lower()
if expected:
    digest = hashlib.sha256(found.read_bytes()).hexdigest()
    if digest != expected:
        print(f'Baked Whisper model checksum mismatch for {found}: expected {expected}, got {digest}', file=sys.stderr)
        sys.exit(1)
PY

export WHISPER_DEVICE WHISPER_MODEL WHISPER_PRELOAD_MODEL

exec gunicorn \
  --bind "${WHISPER_HOST}:${PORT}" \
  --workers "$WHISPER_WORKERS" \
  --threads "$WHISPER_THREADS" \
  --timeout "$WHISPER_TIMEOUT_SECONDS" \
  --graceful-timeout 60 \
  --access-logfile - \
  --error-logfile - \
  server:app
