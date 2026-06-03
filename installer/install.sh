#!/bin/bash
#
# ╔══════════════════════════════════════════════════════════════╗
# ║               Signacare EMR — Installation Script                ║
# ║                                                              ║
# ║  Mental Health Electronic Medical Record System              ║
# ║  Local, secure, AI-powered clinical documentation            ║
# ║                                                              ║
# ║  This script installs all required components:               ║
# ║    • Node.js 20+                                             ║
# ║    • PostgreSQL 16                                           ║
# ║    • Redis 7                                                 ║
# ║    • Python 3.10+ (for Whisper transcription server)         ║
# ║    • Ollama (local LLM runtime)                              ║
# ║    • Whisper large-v3-turbo model (~1.6GB)                   ║
# ║    • LLM models (qwen2.5:14b ~9GB, llama3.2 ~2GB)           ║
# ║    • Signacare EMR application (API + Web)                        ║
# ║                                                              ║
# ║  Supported platforms: macOS (Apple Silicon/Intel), Linux      ║
# ╚══════════════════════════════════════════════════════════════╝
#
set -e

# ── Colours ──
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color
BOLD='\033[1m'

# ── Variables ──
SIGNACARE_HOME="${SIGNACARE_HOME:-$HOME/signacare}"
SIGNACARE_DATA="${SIGNACARE_HOME}/data"
SIGNACARE_LOG="${SIGNACARE_HOME}/logs"
DB_NAME="signacaredb"
DB_USER="signacare_owner"
DB_APP_USER="app_user"
DB_PASS="$(openssl rand -hex 16 2>/dev/null || echo "signacare-secure-$(date +%s)")"
DB_APP_PASS="$(openssl rand -hex 16 2>/dev/null || echo "app_user-secure-$(date +%s)")"
# Local-dev port pin: 5433 lets postgresql@17 (Signacare) coexist with
# any other Postgres instance on the default 5432. Production servers
# can override DB_PORT=5432 in their .env if they only run one Postgres.
DB_PORT="${DB_PORT:-5433}"
REDIS_PORT=6379
API_PORT=4000
WEB_PORT=5173
WHISPER_PORT=8080
OLLAMA_MODELS="qwen2.5:14b llama3.2"
WHISPER_MODEL="large-v3-turbo"

# ── Helpers ──
log() { echo -e "${GREEN}[SIGNACARE]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }
step() { echo -e "\n${CYAN}${BOLD}═══ $1 ═══${NC}"; }
check() { command -v "$1" &>/dev/null; }

# ── Banner ──
echo -e "${CYAN}"
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║                                                              ║"
echo "║              🏥  Signacare EMR Installer  v1.0                    ║"
echo "║                                                              ║"
echo "║   Mental Health Electronic Medical Record System             ║"
echo "║   Local AI • Secure • Australian Standards                   ║"
echo "║                                                              ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# ── Detect platform ──
OS="$(uname -s)"
ARCH="$(uname -m)"
log "Platform: $OS $ARCH"

if [[ "$OS" != "Darwin" && "$OS" != "Linux" ]]; then
  error "Unsupported platform: $OS. Signacare EMR supports macOS and Linux."
fi

# ── Check disk space ──
if [[ "$OS" == "Darwin" ]]; then
  FREE_GB=$(df -g / | tail -1 | awk '{print $4}')
else
  FREE_GB=$(df -BG / | tail -1 | awk '{print $4}' | tr -d 'G')
fi
if (( FREE_GB < 30 )); then
  warn "Only ${FREE_GB}GB free disk space. Signacare EMR requires ~30GB (models + database). Continue? (y/N)"
  read -r CONTINUE
  [[ "$CONTINUE" != "y" && "$CONTINUE" != "Y" ]] && exit 0
fi
log "Disk space: ${FREE_GB}GB available"

# ══════════════════════════════════════════════════════════════════════
step "1/8 — Checking Prerequisites"
# ══════════════════════════════════════════════════════════════════════

# Homebrew (macOS)
if [[ "$OS" == "Darwin" ]] && ! check brew; then
  log "Installing Homebrew..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
fi

# Node.js
if ! check node; then
  log "Installing Node.js 20..."
  if [[ "$OS" == "Darwin" ]]; then
    brew install node@20
  else
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
  fi
else
  NODE_VER=$(node -v | sed 's/v//' | cut -d. -f1)
  if (( NODE_VER < 18 )); then
    warn "Node.js $NODE_VER detected. Signacare requires Node 18+. Upgrading..."
    if [[ "$OS" == "Darwin" ]]; then brew install node@20; else sudo apt-get install -y nodejs; fi
  else
    log "Node.js $(node -v) — OK"
  fi
fi

# Python 3
if ! check python3; then
  log "Installing Python 3..."
  if [[ "$OS" == "Darwin" ]]; then brew install python@3.11; else sudo apt-get install -y python3 python3-pip python3-venv; fi
else
  log "Python $(python3 --version) — OK"
fi

# PostgreSQL
if ! check psql; then
  log "Installing PostgreSQL 16..."
  if [[ "$OS" == "Darwin" ]]; then
    brew install postgresql@16
    brew services start postgresql@16
  else
    sudo apt-get install -y postgresql postgresql-contrib
    sudo systemctl enable postgresql
    sudo systemctl start postgresql
  fi
else
  log "PostgreSQL $(psql --version | awk '{print $3}') — OK"
fi

# Redis
if ! check redis-server && ! check redis-cli; then
  log "Installing Redis..."
  if [[ "$OS" == "Darwin" ]]; then
    brew install redis
    brew services start redis
  else
    sudo apt-get install -y redis-server
    sudo systemctl enable redis-server
    sudo systemctl start redis-server
  fi
else
  log "Redis — OK"
fi

# ══════════════════════════════════════════════════════════════════════
step "2/8 — Installing Ollama (Local LLM Runtime)"
# ══════════════════════════════════════════════════════════════════════

if ! check ollama; then
  log "Installing Ollama..."
  if [[ "$OS" == "Darwin" ]]; then
    brew install ollama
  else
    curl -fsSL https://ollama.com/install.sh | sh
  fi
fi
log "Ollama $(ollama --version 2>/dev/null || echo 'installed') — OK"

# Start Ollama if not running
if ! curl -s http://localhost:11434/api/tags &>/dev/null; then
  log "Starting Ollama..."
  ollama serve &>/dev/null &
  sleep 3
fi

# ══════════════════════════════════════════════════════════════════════
step "3/8 — Downloading AI Models"
# ══════════════════════════════════════════════════════════════════════

for MODEL in $OLLAMA_MODELS; do
  if ollama list 2>/dev/null | grep -q "$MODEL"; then
    log "Model $MODEL — already downloaded"
  else
    log "Downloading $MODEL (this may take 5-20 minutes)..."
    ollama pull "$MODEL"
    log "Model $MODEL — downloaded"
  fi
done

# ══════════════════════════════════════════════════════════════════════
step "4/8 — Setting Up Whisper Transcription Server"
# ══════════════════════════════════════════════════════════════════════

WHISPER_DIR="${SIGNACARE_HOME}/whisper-server"
mkdir -p "$WHISPER_DIR"

# Create Python virtual environment
if [[ ! -d "${WHISPER_DIR}/venv" ]]; then
  log "Creating Python virtual environment..."
  python3 -m venv "${WHISPER_DIR}/venv"
fi

log "Installing Whisper dependencies..."
source "${WHISPER_DIR}/venv/bin/activate"
pip install --quiet --upgrade pip
pip install --quiet flask flask-cors faster-whisper torch numpy

# Copy whisper server
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "${SCRIPT_DIR}/../deploy/whisper-server/server.py" ]]; then
  cp "${SCRIPT_DIR}/../deploy/whisper-server/server.py" "${WHISPER_DIR}/server.py"
fi
deactivate

log "Whisper server configured (model will download on first use: ~1.6GB)"

# ══════════════════════════════════════════════════════════════════════
step "5/8 — Setting Up PostgreSQL Database"
# ══════════════════════════════════════════════════════════════════════

# Create database + owner role + runtime app role.
#
# Per docs/gold-standard-reports/08-deployment-guide.md §2 Signacare
# uses two Postgres roles:
#   ${DB_USER} (signacare_owner) — runs migrations, DDL, owns objects,
#                                   bypasses RLS by default.
#   ${DB_APP_USER} (app_user)    — runs runtime queries, subject to
#                                   RLS tenant_isolation policies.
# The installer creates both so a fresh install matches the schema
# migrations' GRANT statements (20260329_rls_app_user.sql et al.).
if [[ "$OS" == "Darwin" ]]; then
  # macOS: current user is a Postgres superuser on Homebrew installs.
  if ! psql -lqt 2>/dev/null | cut -d \| -f 1 | grep -qw "$DB_NAME"; then
    createuser "$DB_USER" --no-password 2>/dev/null || true
    createuser "$DB_APP_USER" --no-password 2>/dev/null || true
    createdb "$DB_NAME" -O "$DB_USER" 2>/dev/null || true
    psql -d "$DB_NAME" -c "ALTER USER $DB_USER WITH PASSWORD '$DB_PASS';" 2>/dev/null || true
    psql -d "$DB_NAME" -c "ALTER USER $DB_APP_USER WITH PASSWORD '$DB_APP_PASS';" 2>/dev/null || true
    log "Database created: $DB_NAME (owner: $DB_USER, runtime: $DB_APP_USER)"
  else
    log "Database $DB_NAME already exists — OK"
  fi
else
  # Linux: use sudo -u postgres.
  sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'" | grep -q 1 || \
    sudo -u postgres psql -c "CREATE USER $DB_USER WITH PASSWORD '$DB_PASS';"
  sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='$DB_APP_USER'" | grep -q 1 || \
    sudo -u postgres psql -c "CREATE USER $DB_APP_USER WITH PASSWORD '$DB_APP_PASS';"
  sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | grep -q 1 || \
    sudo -u postgres psql -c "CREATE DATABASE $DB_NAME OWNER $DB_USER;"
  log "Database created: $DB_NAME (owner: $DB_USER, runtime: $DB_APP_USER)"
fi

# ══════════════════════════════════════════════════════════════════════
step "6/8 — Installing Signacare EMR Application"
# ══════════════════════════════════════════════════════════════════════

mkdir -p "$SIGNACARE_HOME" "$SIGNACARE_DATA" "$SIGNACARE_LOG"

# Copy application
if [[ -d "${SCRIPT_DIR}/../apps" ]]; then
  log "Copying application files..."
  rsync -a --exclude='node_modules' --exclude='.git' --exclude='*.log' \
    "${SCRIPT_DIR}/../" "${SIGNACARE_HOME}/app/"
fi

# Install dependencies
cd "${SIGNACARE_HOME}/app"
log "Installing Node.js dependencies (this may take 2-5 minutes)..."
npm install --production 2>&1 | tail -3

# Build web frontend
log "Building web frontend..."
cd apps/web && npm run build 2>&1 | tail -3 && cd ../..

# ══════════════════════════════════════════════════════════════════════
step "7/8 — Creating Configuration"
# ══════════════════════════════════════════════════════════════════════

ENV_FILE="${SIGNACARE_HOME}/app/apps/api/.env"
cat > "$ENV_FILE" << ENVEOF
# Signacare EMR — Generated by installer $(date +%Y-%m-%d)
NODE_ENV=production
PORT=${API_PORT}

# Database — canonical names per docs/gold-standard-reports/08-deployment-guide.md §2
# Owner role runs migrations + DDL; app_user runs RLS-scoped runtime queries.
# Local-dev port pin: 5433 keeps postgresql@17 (Signacare) on a distinct
# port from any co-installed postgresql@16 instance on 5432.
DB_HOST=localhost
DB_PORT=${DB_PORT}
DB_USER=${DB_USER}
DB_PASSWORD=${DB_PASS}
DB_NAME=${DB_NAME}
DB_APP_USER=${DB_APP_USER}
DB_APP_PASSWORD=${DB_APP_PASS}
DATABASE_URL=postgres://${DB_USER}:${DB_PASS}@localhost:${DB_PORT}/${DB_NAME}
DB_POOL_MAX=50

# Redis
REDIS_URL=redis://localhost:${REDIS_PORT}

# JWT
JWT_SECRET=$(openssl rand -hex 32)
JWT_REFRESH_SECRET=$(openssl rand -hex 32)

# Ollama (local LLM)
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=qwen2.5:14b

# Whisper (local transcription)
WHISPER_API_URL=http://localhost:${WHISPER_PORT}

# LLM Rate Limiting
LLM_RATE_LIMIT=30

# Backup
BACKUP_DIR=${SIGNACARE_DATA}/backups

# License
SIGNACARE_LICENSE_SECRET=$(openssl rand -hex 32)
ENVEOF

log "Configuration written to ${ENV_FILE}"

# Run database migrations
log "Running database migrations..."
cd "${SIGNACARE_HOME}/app/apps/api"
npx knex migrate:latest 2>&1 | tail -5 || warn "Migrations may need manual review"

# ══════════════════════════════════════════════════════════════════════
step "8/8 — Creating Service Scripts"
# ══════════════════════════════════════════════════════════════════════

# Start script
cat > "${SIGNACARE_HOME}/start.sh" << 'STARTEOF'
#!/bin/bash
# Signacare EMR — Start all services
SIGNACARE_HOME="$(dirname "$0")"
echo "Starting Signacare EMR..."

# Start Redis (if not running)
redis-cli ping &>/dev/null || (redis-server --daemonize yes && echo "Redis started")

# Start Ollama (if not running)
curl -s http://localhost:11434/api/tags &>/dev/null || (ollama serve &>/dev/null & sleep 2 && echo "Ollama started")

# Start Whisper server
if [[ ! -f /tmp/signacare-whisper.pid ]] || ! kill -0 $(cat /tmp/signacare-whisper.pid 2>/dev/null) 2>/dev/null; then
  source "${SIGNACARE_HOME}/whisper-server/venv/bin/activate"
  cd "${SIGNACARE_HOME}/whisper-server"
  python server.py --port 8080 &>/dev/null &
  echo $! > /tmp/signacare-whisper.pid
  deactivate
  echo "Whisper server started (port 8080)"
fi

# Start API server
cd "${SIGNACARE_HOME}/app/apps/api"
NODE_ENV=production node -r dotenv/config dist/index.js &>/dev/null &
echo $! > /tmp/signacare-api.pid
echo "API server started (port 4000)"

# Serve web frontend
cd "${SIGNACARE_HOME}/app/apps/web"
npx serve -s dist -l 5173 &>/dev/null &
echo $! > /tmp/signacare-web.pid
echo "Web frontend started (port 5173)"

echo ""
echo "╔═══════════════════════════════════════╗"
echo "║  Signacare EMR is running!                 ║"
echo "║                                       ║"
echo "║  Web:     http://localhost:5173        ║"
echo "║  API:     http://localhost:4000        ║"
echo "║  Whisper: http://localhost:8080        ║"
echo "║  Ollama:  http://localhost:11434       ║"
echo "║                                       ║"
echo "║  Stop:    ~/signacare/stop.sh           ║"
echo "╚═══════════════════════════════════════╝"
STARTEOF
chmod +x "${SIGNACARE_HOME}/start.sh"

# Stop script
cat > "${SIGNACARE_HOME}/stop.sh" << 'STOPEOF'
#!/bin/bash
# Signacare EMR — Stop all services
echo "Stopping Signacare EMR..."
kill $(cat /tmp/signacare-api.pid 2>/dev/null) 2>/dev/null && echo "API stopped"
kill $(cat /tmp/signacare-web.pid 2>/dev/null) 2>/dev/null && echo "Web stopped"
kill $(cat /tmp/signacare-whisper.pid 2>/dev/null) 2>/dev/null && echo "Whisper stopped"
rm -f /tmp/signacare-api.pid /tmp/signacare-web.pid /tmp/signacare-whisper.pid
echo "Signacare EMR stopped."
STOPEOF
chmod +x "${SIGNACARE_HOME}/stop.sh"

# Uninstall script
cat > "${SIGNACARE_HOME}/uninstall.sh" << 'UNINSTEOF'
#!/bin/bash
echo "This will remove Signacare EMR. Your database will NOT be deleted."
echo "To also remove the database, run: dropdb signacaredb"
read -p "Continue? (y/N) " CONFIRM
if [[ "$CONFIRM" == "y" || "$CONFIRM" == "Y" ]]; then
  ~/signacare/stop.sh 2>/dev/null
  rm -rf ~/signacare
  echo "Signacare EMR uninstalled. Database preserved."
fi
UNINSTEOF
chmod +x "${SIGNACARE_HOME}/uninstall.sh"

# ══════════════════════════════════════════════════════════════════════
step "Installation Complete!"
# ══════════════════════════════════════════════════════════════════════

echo -e "${GREEN}${BOLD}"
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║                                                              ║"
echo "║           Signacare EMR installed successfully!                   ║"
echo "║                                                              ║"
echo "║  Location:  ${SIGNACARE_HOME}"
echo "║  Database:  ${DB_NAME} (user: ${DB_USER})"
echo "║                                                              ║"
echo "║  To start:     ${SIGNACARE_HOME}/start.sh                        ║"
echo "║  To stop:      ${SIGNACARE_HOME}/stop.sh                         ║"
echo "║  To uninstall: ${SIGNACARE_HOME}/uninstall.sh                    ║"
echo "║                                                              ║"
echo "║  Next steps:                                                 ║"
echo "║  1. Activate license:                                        ║"
echo "║     cd ${SIGNACARE_HOME}/app && node installer/activate.js       ║"
echo "║  2. Start services:                                          ║"
echo "║     ${SIGNACARE_HOME}/start.sh                                   ║"
echo "║  3. Open browser:                                            ║"
echo "║     http://localhost:5173                                    ║"
echo "║                                                              ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo -e "${NC}"

echo ""
echo "AI Models downloaded:"
ollama list 2>/dev/null | head -10 || echo "  (Ollama models will download on first use)"
echo ""
echo "Disk usage:"
du -sh "${SIGNACARE_HOME}" 2>/dev/null || echo "  (calculating...)"
