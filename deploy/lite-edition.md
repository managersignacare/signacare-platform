# Signacare EMR — Lite Edition Configuration

## Purpose
Reduces the first-run download from ~15GB to ~2GB for clinics with limited bandwidth
or smaller hardware (e.g., MacBook Air, Mac Mini with 8GB RAM).

## Model Differences

| Component | Full Edition | Lite Edition |
|-----------|-------------|-------------|
| LLM | qwen2.5:14b (9GB) + llama3.2 (2GB) | llama3.2 (2GB only) |
| Whisper | large-v3-turbo (1.6GB) | small.en (500MB) |
| Total download | ~15GB | ~2.5GB |
| RAM required | 16GB+ | 8GB |
| AI quality | High (14B params) | Moderate (3B params) |
| Transcription | All languages | English only |

## Setup

### Install Lite Edition
```bash
# During first-run setup, set these environment variables:
export SIGNACARE_EDITION=lite
export OLLAMA_MODEL=llama3.2
export WHISPER_MODEL=small.en

# Then run the setup script
bash installer/setup-first-run.sh
```

### Upgrade from Lite to Full
```bash
# Download the larger models (can be done overnight)
ollama pull qwen2.5:14b

# Update .env
echo 'OLLAMA_MODEL=qwen2.5:14b' >> ~/signacare/apps/api/.env

# Download full Whisper model
python3 -c "from faster_whisper import WhisperModel; WhisperModel('large-v3-turbo', device='cpu', compute_type='int8')"
export WHISPER_MODEL=large-v3-turbo

# Restart
```

### .env Configuration
```env
# Lite Edition
OLLAMA_MODEL=llama3.2
WHISPER_MODEL=small.en
LLM_RATE_LIMIT=20

# Full Edition
OLLAMA_MODEL=qwen2.5:14b
WHISPER_MODEL=large-v3-turbo
LLM_RATE_LIMIT=30
```
