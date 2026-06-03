#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# Signacare EMR — macOS Launcher
# Starts all services, runs health checks, opens browser
# ═══════════════════════════════════════════════════════════════════════════════

set -euo pipefail

SIGNACARE_HOME="${SIGNACARE_HOME:-$HOME/signacare}"
LOG_DIR="${SIGNACARE_HOME}/logs"
PID_DIR="${SIGNACARE_HOME}/pids"
API_PORT=4000
WEB_PORT=5173
WHISPER_PORT=8080

mkdir -p "$LOG_DIR" "$PID_DIR"

# ── Colours ──
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'; BOLD='\033[1m'

log()  { echo -e "${CYAN}[Signacare]${NC} $1"; }
ok()   { echo -e "${GREEN}  ✓${NC} $1"; }
warn() { echo -e "${YELLOW}  ⚠${NC} $1"; }
fail() { echo -e "${RED}  ✗${NC} $1"; }

# ── Check if first run ──
check_first_run() {
  if [ ! -f "$SIGNACARE_HOME/.installed" ]; then
    log "First run detected — running setup..."
    SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
    if [ -f "$SCRIPT_DIR/setup-first-run.sh" ]; then
      bash "$SCRIPT_DIR/setup-first-run.sh"
    else
      fail "Setup script not found. Please run the installer first."
      exit 1
    fi
  fi
}

# ── Service Management ──
start_postgresql() {
  if pg_isready -q 2>/dev/null; then
    ok "PostgreSQL already running"
    return 0
  fi
  log "Starting PostgreSQL..."
  if command -v brew &>/dev/null && brew list postgresql@16 &>/dev/null; then
    brew services start postgresql@16 2>/dev/null || brew services start postgresql 2>/dev/null || true
  elif [ -d "/opt/homebrew/var/postgresql@16" ]; then
    pg_ctl -D /opt/homebrew/var/postgresql@16 start -l "$LOG_DIR/postgresql.log" &
  elif [ -d "$HOME/signacare/data/pg" ]; then
    pg_ctl -D "$HOME/signacare/data/pg" start -l "$LOG_DIR/postgresql.log" &
  fi
  # Wait for PostgreSQL
  for i in $(seq 1 15); do
    pg_isready -q 2>/dev/null && break
    sleep 1
  done
  if pg_isready -q 2>/dev/null; then ok "PostgreSQL started"; else fail "PostgreSQL failed to start"; return 1; fi
}

start_redis() {
  if redis-cli ping 2>/dev/null | grep -q PONG; then
    ok "Redis already running"
    return 0
  fi
  log "Starting Redis..."
  if command -v brew &>/dev/null; then
    brew services start redis 2>/dev/null || true
  fi
  redis-server --daemonize yes --logfile "$LOG_DIR/redis.log" 2>/dev/null || true
  sleep 1
  if redis-cli ping 2>/dev/null | grep -q PONG; then ok "Redis started"; else warn "Redis not available — rate limiting uses memory fallback"; fi
}

start_ollama() {
  if curl -s http://localhost:11434/api/tags &>/dev/null; then
    ok "Ollama already running"
    return 0
  fi
  log "Starting Ollama..."
  if command -v ollama &>/dev/null; then
    ollama serve > "$LOG_DIR/ollama.log" 2>&1 &
    echo $! > "$PID_DIR/ollama.pid"
    sleep 3
    if curl -s http://localhost:11434/api/tags &>/dev/null; then ok "Ollama started"; else warn "Ollama not responding"; fi
  else
    warn "Ollama not installed — AI features disabled"
  fi
}

start_whisper() {
  if curl -s http://localhost:$WHISPER_PORT/health &>/dev/null; then
    ok "Whisper already running"
    return 0
  fi
  log "Starting Whisper server..."
  local whisper_dir="$SIGNACARE_HOME/whisper-server"
  # Ensure directory exists and is writable
  mkdir -p "$whisper_dir" 2>/dev/null || true
  if [ ! -w "$whisper_dir" ]; then
    warn "Whisper directory not writable — fixing permissions..."
    sudo chown -R "$(whoami)" "$whisper_dir" 2>/dev/null || true
  fi
  if [ -f "$whisper_dir/server.py" ] && command -v python3 &>/dev/null; then
    cd "$whisper_dir"
    python3 server.py > "$LOG_DIR/whisper.log" 2>&1 &
    echo $! > "$PID_DIR/whisper.pid"
    cd - > /dev/null
    sleep 5
    if curl -s http://localhost:$WHISPER_PORT/health &>/dev/null; then ok "Whisper started"; else warn "Whisper not responding — transcription disabled"; fi
  else
    warn "Whisper server not configured — transcription disabled"
  fi
}

start_api() {
  if curl -s http://localhost:$API_PORT/health &>/dev/null; then
    ok "API already running"
    return 0
  fi
  log "Starting API server..."
  local api_dir="$SIGNACARE_HOME/api"
  if [ ! -d "$api_dir" ]; then
    # Try source directory
    api_dir="$(cd "$(dirname "$0")/.." && pwd)/apps/api"
  fi
  if [ -d "$api_dir" ]; then
    cd "$api_dir"
    npx tsx -r dotenv/config src/server.ts > "$LOG_DIR/api.log" 2>&1 &
    echo $! > "$PID_DIR/api.pid"
    cd - > /dev/null
    # Wait for API
    for i in $(seq 1 20); do
      curl -s http://localhost:$API_PORT/health &>/dev/null && break
      sleep 1
    done
    if curl -s http://localhost:$API_PORT/health &>/dev/null; then ok "API started on port $API_PORT"; else fail "API failed to start — check $LOG_DIR/api.log"; return 1; fi
  else
    fail "API directory not found"
    return 1
  fi
}

# ── Health Checks ──
run_health_checks() {
  log "${BOLD}Running health checks...${NC}"
  local all_ok=true

  # PostgreSQL
  if pg_isready -q 2>/dev/null; then ok "PostgreSQL: connected"; else fail "PostgreSQL: not running"; all_ok=false; fi

  # Redis
  if redis-cli ping 2>/dev/null | grep -q PONG; then
    ok "Redis: connected"
    # Flush rate limits on startup (dev convenience)
    redis-cli FLUSHALL > /dev/null 2>&1 || true
    ok "Rate limits: cleared"
  else
    warn "Redis: not available (rate limiting uses memory)"
  fi

  # API
  if curl -s http://localhost:$API_PORT/health &>/dev/null; then
    local ready=$(curl -s http://localhost:$API_PORT/ready 2>/dev/null)
    local db_status=$(echo "$ready" | python3 -c "import sys,json; print(json.load(sys.stdin).get('db','?'))" 2>/dev/null || echo "?")
    local redis_status=$(echo "$ready" | python3 -c "import sys,json; print(json.load(sys.stdin).get('redis','?'))" 2>/dev/null || echo "?")
    ok "API: running (db=$db_status, redis=$redis_status)"
  else
    fail "API: not responding"
    all_ok=false
  fi

  # Ollama
  if curl -s http://localhost:11434/api/tags &>/dev/null; then
    local models=$(curl -s http://localhost:11434/api/tags 2>/dev/null | python3 -c "import sys,json; print(', '.join(m['name'] for m in json.load(sys.stdin).get('models',[])))" 2>/dev/null || echo "unknown")
    ok "Ollama: running (models: $models)"
  else
    warn "Ollama: not running (AI features disabled)"
  fi

  # Whisper
  if curl -s http://localhost:$WHISPER_PORT/health &>/dev/null; then
    ok "Whisper: running"
  else
    warn "Whisper: not running (transcription disabled)"
  fi

  # License
  if [ -f "$SIGNACARE_HOME/.license" ]; then
    ok "License: activated"
  else
    warn "License: not activated — running in trial mode"
  fi

  echo ""
  if $all_ok; then
    log "${GREEN}${BOLD}All core services healthy${NC}"
  else
    log "${YELLOW}${BOLD}Some services have issues — check above${NC}"
  fi
}

# ── Open Browser ──
open_browser() {
  log "Opening Signacare EMR..."
  sleep 1
  if [ -f "$PID_DIR/vite.pid" ] && curl -s http://localhost:$WEB_PORT &>/dev/null; then
    open "http://localhost:$WEB_PORT"
  else
    open "http://localhost:$API_PORT"
  fi
}

# ── Stop All ──
stop_all() {
  log "Stopping Signacare services..."
  for pidfile in "$PID_DIR"/*.pid; do
    [ -f "$pidfile" ] && kill "$(cat "$pidfile")" 2>/dev/null && rm "$pidfile"
  done
  ok "Services stopped"
}

# ── Main ──
main() {
  echo ""
  echo -e "${CYAN}${BOLD}╔════════════════════════════════════════════╗${NC}"
  echo -e "${CYAN}${BOLD}║       Signacare EMR — Starting...         ║${NC}"
  echo -e "${CYAN}${BOLD}╚════════════════════════════════════════════╝${NC}"
  echo ""

  check_first_run

  start_postgresql
  start_redis
  start_ollama
  start_whisper
  start_api

  echo ""
  run_health_checks
  echo ""

  open_browser

  log "Signacare EMR is running. Close this window to keep services running."
  log "To stop all services: $0 stop"

  # Keep alive
  trap stop_all EXIT
  wait
}

case "${1:-start}" in
  start) main ;;
  stop) stop_all ;;
  health) run_health_checks ;;
  *) echo "Usage: $0 {start|stop|health}" ;;
esac
