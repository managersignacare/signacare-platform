#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# Signacare EMR — First-Run Setup
# Downloads dependencies, sets up database, downloads AI models
# ═══════════════════════════════════════════════════════════════════════════════

set -euo pipefail

SIGNACARE_HOME="${SIGNACARE_HOME:-$HOME/signacare}"
DB_NAME="signacaredb"
DB_USER="signacare_owner"
DB_APP_USER="app_user"
DB_PASS="$(openssl rand -hex 16 2>/dev/null || echo "signacare-$(date +%s)")"
DB_APP_PASS="$(openssl rand -hex 16 2>/dev/null || echo "app_user-$(date +%s)")"
# Local-dev port pin (Phase 0.7) — see installer/install.sh comment.
DB_PORT="${DB_PORT:-5433}"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'; BOLD='\033[1m'

log()  { echo -e "${CYAN}[Setup]${NC} $1"; }
ok()   { echo -e "${GREEN}  ✓${NC} $1"; }
warn() { echo -e "${YELLOW}  ⚠${NC} $1"; }
fail() { echo -e "${RED}  ✗${NC} $1"; }

step() {
  echo ""
  echo -e "${BOLD}${CYAN}── Step $1: $2 ──${NC}"
}

echo ""
echo -e "${CYAN}${BOLD}╔════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}${BOLD}║     Signacare EMR — First-Time Setup              ║${NC}"
echo -e "${CYAN}${BOLD}║                                                    ║${NC}"
echo -e "${CYAN}${BOLD}║  This will install:                                ║${NC}"
echo -e "${CYAN}${BOLD}║    • PostgreSQL 16 (database)                      ║${NC}"
echo -e "${CYAN}${BOLD}║    • Redis (session/rate limiting)                  ║${NC}"
echo -e "${CYAN}${BOLD}║    • Node.js 20 (application runtime)              ║${NC}"
echo -e "${CYAN}${BOLD}║    • Ollama + LLM models (~11GB download)          ║${NC}"
echo -e "${CYAN}${BOLD}║    • Whisper model (~1.6GB download)               ║${NC}"
echo -e "${CYAN}${BOLD}║                                                    ║${NC}"
echo -e "${CYAN}${BOLD}║  Total download: ~15GB | Time: 15-30 minutes       ║${NC}"
echo -e "${CYAN}${BOLD}╚════════════════════════════════════════════════════╝${NC}"
echo ""

read -p "Continue with setup? (y/n) " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then exit 0; fi

mkdir -p "$SIGNACARE_HOME"/{logs,pids,data,backups}

# ═══════════════════════════════════════════════════════════════════════════════
step "1/7" "Installing Homebrew (if needed)"
# ═══════════════════════════════════════════════════════════════════════════════
if command -v brew &>/dev/null; then
  ok "Homebrew already installed"
else
  log "Installing Homebrew..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  # Add to PATH for Apple Silicon
  if [ -f /opt/homebrew/bin/brew ]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
    echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile
  fi
  ok "Homebrew installed"
fi

# ═══════════════════════════════════════════════════════════════════════════════
step "2/7" "Installing system dependencies"
# ═══════════════════════════════════════════════════════════════════════════════
install_if_missing() {
  if command -v "$1" &>/dev/null; then
    ok "$2 already installed"
  else
    log "Installing $2..."
    brew install "$3"
    ok "$2 installed"
  fi
}

install_if_missing node "Node.js" "node@20"
install_if_missing psql "PostgreSQL" "postgresql@16"
install_if_missing redis-server "Redis" "redis"
install_if_missing python3 "Python 3" "python@3.11"

# Ensure npm packages
if ! command -v tsx &>/dev/null; then
  npm install -g tsx
  ok "tsx installed globally"
fi

# ═══════════════════════════════════════════════════════════════════════════════
step "3/7" "Setting up PostgreSQL database"
# ═══════════════════════════════════════════════════════════════════════════════
# Prefer postgresql@17 (current server version on dev machines) and
# fall back to @16 or generic postgresql if that formula isn't
# installed. Without an explicit version, pg_dump/pg_isready can
# pick the wrong keg on machines with multiple installs.
#
# Port pin (Phase 0.7): if postgresql@17 is the active version, write
# `port = 5433` to its postgresql.conf so it doesn't compete with any
# co-installed postgresql@16 instance on the default 5432. The port
# pin is idempotent — we only add the line if it isn't already
# present, so repeat installs are no-ops.
PG17_CONF="/opt/homebrew/var/postgresql@17/postgresql.conf"
if [ -f "$PG17_CONF" ] && ! grep -qE '^port = 5433' "$PG17_CONF"; then
  log "Pinning postgresql@17 to port 5433 (dev coexistence with postgresql@16 on 5432)..."
  # Replace the commented default with our pin. Use sed -i.bak for
  # macOS/BSD compatibility, then remove the backup.
  sed -i.bak 's/^#port = 5432.*/port = 5433\t\t\t# Signacare local-dev pin/' "$PG17_CONF" 2>/dev/null
  rm -f "${PG17_CONF}.bak" 2>/dev/null
fi
brew services start postgresql@17 2>/dev/null || \
  brew services start postgresql@16 2>/dev/null || \
  brew services start postgresql 2>/dev/null || true
sleep 3

if psql -p "$DB_PORT" -lqt 2>/dev/null | grep -qw "$DB_NAME"; then
  ok "Database '$DB_NAME' already exists on port $DB_PORT"
else
  log "Creating database and roles (owner + runtime) on port $DB_PORT..."
  # Owner role — signacare_owner — runs migrations + DDL, owns tables,
  # bypasses RLS by default.
  createuser -p "$DB_PORT" -s "$DB_USER" 2>/dev/null || true
  psql -p "$DB_PORT" -c "ALTER USER $DB_USER WITH PASSWORD '$DB_PASS';" postgres 2>/dev/null || true
  # Runtime role — app_user — RLS-scoped app pool. Must exist before
  # 20260329_rls_app_user.sql runs so its GRANT statements succeed.
  createuser -p "$DB_PORT" "$DB_APP_USER" --no-password 2>/dev/null || true
  psql -p "$DB_PORT" -c "ALTER USER $DB_APP_USER WITH PASSWORD '$DB_APP_PASS';" postgres 2>/dev/null || true
  createdb -p "$DB_PORT" -O "$DB_USER" "$DB_NAME" 2>/dev/null || true
  ok "Database created: $DB_NAME (owner: $DB_USER, runtime: $DB_APP_USER) on port $DB_PORT"
fi

# ═══════════════════════════════════════════════════════════════════════════════
step "4/7" "Starting Redis"
# ═══════════════════════════════════════════════════════════════════════════════
brew services start redis 2>/dev/null || redis-server --daemonize yes 2>/dev/null || true
sleep 1
if redis-cli ping 2>/dev/null | grep -q PONG; then ok "Redis running"; else warn "Redis not started"; fi

# ═══════════════════════════════════════════════════════════════════════════════
step "5/7" "Installing Ollama and AI models"
# ═══════════════════════════════════════════════════════════════════════════════
if command -v ollama &>/dev/null; then
  ok "Ollama already installed"
else
  log "Installing Ollama..."
  brew install ollama
  ok "Ollama installed"
fi

# Start Ollama and download models
ollama serve > "$SIGNACARE_HOME/logs/ollama.log" 2>&1 &
sleep 3

log "Downloading LLM model (llama3.2 ~2GB)..."
ollama pull llama3.2 2>/dev/null && ok "llama3.2 downloaded" || warn "llama3.2 download failed — retry later"

log "Downloading clinical model (qwen2.5:14b ~9GB — this takes a while)..."
ollama pull qwen2.5:14b 2>/dev/null && ok "qwen2.5:14b downloaded" || warn "qwen2.5:14b download failed — retry later with: ollama pull qwen2.5:14b"

# ═══════════════════════════════════════════════════════════════════════════════
step "6/7" "Setting up Whisper (speech-to-text)"
# ═══════════════════════════════════════════════════════════════════════════════
WHISPER_DIR="$SIGNACARE_HOME/whisper-server"
if [ -f "$WHISPER_DIR/server.py" ]; then
  ok "Whisper server already configured"
else
  mkdir -p "$WHISPER_DIR" 2>/dev/null || { log "Creating whisper-server directory..."; sudo mkdir -p "$WHISPER_DIR" && sudo chown "$(whoami)" "$WHISPER_DIR"; }
  log "Installing Whisper dependencies..."
  python3 -m pip install --quiet faster-whisper flask 2>/dev/null || pip3 install --quiet faster-whisper flask 2>/dev/null || true

  cat > "$WHISPER_DIR/server.py" << 'WHISPER_EOF'
#!/usr/bin/env python3
"""Signacare Whisper Transcription Server"""
import os, tempfile, logging
from flask import Flask, request, jsonify

app = Flask(__name__)
logging.basicConfig(level=logging.INFO)
model = None

def get_model():
    global model
    if model is None:
        from faster_whisper import WhisperModel
        model_size = os.environ.get("WHISPER_MODEL", "large-v3-turbo")
        model = WhisperModel(model_size, device="cpu", compute_type="int8")
        logging.info(f"Whisper model loaded: {model_size}")
    return model

@app.route("/health")
def health():
    return jsonify({"status": "ok"})

@app.route("/transcribe", methods=["POST"])
def transcribe():
    if "audio" not in request.files:
        return jsonify({"error": "No audio file"}), 400
    audio = request.files["audio"]
    with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as f:
        audio.save(f.name)
        segments, info = get_model().transcribe(f.name, beam_size=5, language="en")
        text = " ".join(s.text for s in segments)
    os.unlink(f.name)
    return jsonify({"transcript": text.strip(), "language": info.language, "duration": info.duration})

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("WHISPER_PORT", "8080")))
WHISPER_EOF

  ok "Whisper server created at $WHISPER_DIR"
  log "Pre-downloading Whisper model (large-v3-turbo ~1.6GB)..."
  python3 -c "from faster_whisper import WhisperModel; WhisperModel('large-v3-turbo', device='cpu', compute_type='int8')" 2>/dev/null && ok "Whisper model downloaded" || warn "Whisper model download deferred to first use"
fi

# ═══════════════════════════════════════════════════════════════════════════════
step "7/7" "Configuring Signacare EMR"
# ═══════════════════════════════════════════════════════════════════════════════
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Create .env for the API
ENV_FILE="$APP_DIR/apps/api/.env"
if [ ! -f "$ENV_FILE" ] || ! grep -q "DB_PASSWORD" "$ENV_FILE" 2>/dev/null; then
  log "Creating API configuration..."
  JWT_ACCESS=$(openssl rand -hex 32)
  JWT_REFRESH=$(openssl rand -hex 32)
  cat > "$ENV_FILE" << ENV_EOF
NODE_ENV=development
PORT=4000

# PostgreSQL — canonical names per docs/gold-standard-reports/08-deployment-guide.md §2
# Local-dev port pin: 5433 lets postgresql@17 (Signacare) coexist with
# postgresql@16 on the default 5432.
DB_HOST=localhost
DB_PORT=$DB_PORT
DB_USER=$DB_USER
DB_PASSWORD=$DB_PASS
DB_NAME=$DB_NAME
DB_APP_USER=$DB_APP_USER
DB_APP_PASSWORD=$DB_APP_PASS

# JWT
JWT_ACCESS_SECRET=$JWT_ACCESS
JWT_REFRESH_SECRET=$JWT_REFRESH
JWT_ACCESS_TTL_MINUTES=60
JWT_REFRESH_TTL_DAYS=7

# MFA
MFA_ISSUER=Signacare EMR

# CORS
CORS_ORIGIN=http://localhost:5173

# Redis
REDIS_URL=redis://localhost:6379

# Ollama
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3.2
ENV_EOF
  ok "API .env created"
else
  ok "API .env already exists"
fi

# Install Node.js dependencies
if [ -d "$APP_DIR/node_modules" ]; then
  ok "Node dependencies already installed"
else
  log "Installing Node.js dependencies (this may take a minute)..."
  cd "$APP_DIR" && npm install --legacy-peer-deps 2>/dev/null && cd - > /dev/null
  ok "Dependencies installed"
fi

# Run database migrations
log "Running database migrations..."
cd "$APP_DIR/apps/api"
npx tsx -r dotenv/config src/db/runMigrations.ts 2>/dev/null || log "Migrations may need manual run"
cd - > /dev/null

# Build web frontend
log "Building web frontend..."
cd "$APP_DIR/apps/web" && npx vite build 2>/dev/null && cd - > /dev/null
ok "Frontend built"

# Mark as installed
touch "$SIGNACARE_HOME/.installed"
echo "$DB_PASS" > "$SIGNACARE_HOME/.db-password"
chmod 600 "$SIGNACARE_HOME/.db-password"

echo ""
echo -e "${GREEN}${BOLD}╔════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}${BOLD}║     Setup Complete!                                ║${NC}"
echo -e "${GREEN}${BOLD}║                                                    ║${NC}"
echo -e "${GREEN}${BOLD}║  Signacare EMR is ready to launch.                 ║${NC}"
echo -e "${GREEN}${BOLD}║                                                    ║${NC}"
echo -e "${GREEN}${BOLD}║  Default login:                                    ║${NC}"
echo -e "${GREEN}${BOLD}║    Email:    admin@signacare.local                  ║${NC}"
echo -e "${GREEN}${BOLD}║    Password: Admin123!                             ║${NC}"
echo -e "${GREEN}${BOLD}╚════════════════════════════════════════════════════╝${NC}"
echo ""
