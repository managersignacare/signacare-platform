#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# Signacare EMR — Uninstaller
#
# Removes all Signacare components from the system.
# Run: bash uninstall.sh
#
# Options:
#   --keep-data     Keep patient data and database (only remove app + services)
#   --keep-models   Keep Ollama/Whisper AI models (saves re-download)
#   --full          Remove everything including data and models
#   --dry-run       Show what would be removed without deleting anything
# ═══════════════════════════════════════════════════════════════════════════════

set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'; BOLD='\033[1m'

log()  { echo -e "${CYAN}[Uninstall]${NC} $1"; }
ok()   { echo -e "${GREEN}  ✓${NC} $1"; }
warn() { echo -e "${YELLOW}  ⚠${NC} $1"; }
fail() { echo -e "${RED}  ✗${NC} $1"; }
dry()  { echo -e "${YELLOW}  [DRY RUN]${NC} Would: $1"; }

KEEP_DATA=false
KEEP_MODELS=false
DRY_RUN=false

for arg in "$@"; do
  case $arg in
    --keep-data)   KEEP_DATA=true ;;
    --keep-models) KEEP_MODELS=true ;;
    --full)        KEEP_DATA=false; KEEP_MODELS=false ;;
    --dry-run)     DRY_RUN=true ;;
    --help|-h)
      echo "Usage: bash uninstall.sh [OPTIONS]"
      echo ""
      echo "Options:"
      echo "  --keep-data     Keep database and patient data"
      echo "  --keep-models   Keep AI models (Ollama + Whisper)"
      echo "  --full          Remove everything (default)"
      echo "  --dry-run       Preview without deleting"
      echo ""
      exit 0 ;;
  esac
done

SIGNACARE_HOME="${SIGNACARE_HOME:-$HOME/signacare}"

echo ""
echo -e "${RED}${BOLD}╔════════════════════════════════════════════════════╗${NC}"
echo -e "${RED}${BOLD}║       Signacare EMR — Uninstaller                 ║${NC}"
echo -e "${RED}${BOLD}╚════════════════════════════════════════════════════╝${NC}"
echo ""

if $KEEP_DATA; then
  warn "Database and patient data will be PRESERVED"
fi
if $KEEP_MODELS; then
  warn "AI models (Ollama + Whisper) will be PRESERVED"
fi
if $DRY_RUN; then
  warn "DRY RUN — nothing will be deleted"
fi

echo ""
if ! $DRY_RUN; then
  read -p "Are you sure you want to uninstall Signacare EMR? (type YES to confirm) " -r
  echo ""
  if [ "$REPLY" != "YES" ]; then
    echo "Uninstall cancelled."
    exit 0
  fi
fi

# ── Step 1: Stop all running services ──
log "Stopping services..."

# Stop API server
if lsof -ti:4000 &>/dev/null; then
  if $DRY_RUN; then dry "Kill API server (port 4000)"; else
    kill $(lsof -ti:4000) 2>/dev/null && ok "API server stopped" || true
  fi
fi

# Stop Vite dev server
if lsof -ti:5173 &>/dev/null; then
  if $DRY_RUN; then dry "Kill Vite dev server (port 5173)"; else
    kill $(lsof -ti:5173) 2>/dev/null && ok "Vite dev server stopped" || true
  fi
fi

# Stop Whisper
if lsof -ti:8080 &>/dev/null; then
  if $DRY_RUN; then dry "Kill Whisper server (port 8080)"; else
    kill $(lsof -ti:8080) 2>/dev/null && ok "Whisper server stopped" || true
  fi
fi

# Stop PID-tracked processes
if [ -d "$SIGNACARE_HOME/pids" ]; then
  for pidfile in "$SIGNACARE_HOME/pids"/*.pid; do
    [ -f "$pidfile" ] || continue
    PID=$(cat "$pidfile")
    if $DRY_RUN; then dry "Kill process $PID ($(basename "$pidfile"))"; else
      kill "$PID" 2>/dev/null && ok "Stopped $(basename "$pidfile" .pid)" || true
      rm -f "$pidfile"
    fi
  done
fi

# ── Step 2: Remove the application ──
log "Removing application..."

if [ -d "/Applications/Signacare.app" ]; then
  if $DRY_RUN; then dry "Remove /Applications/Signacare.app"; else
    rm -rf "/Applications/Signacare.app" && ok "Signacare.app removed" || warn "Could not remove — try: sudo rm -rf /Applications/Signacare.app"
  fi
else
  ok "Signacare.app not found in /Applications"
fi

# Remove pkg receipt (so macOS knows it's uninstalled)
if $DRY_RUN; then dry "Forget pkg receipt com.signacare.emr"; else
  sudo pkgutil --forget com.signacare.emr 2>/dev/null && ok "Package receipt removed" || true
fi

# ── Step 3: Remove application data ──
log "Removing application data..."

if $KEEP_DATA; then
  warn "Keeping $SIGNACARE_HOME (--keep-data)"
  # Still remove non-data directories
  for dir in pids logs; do
    if [ -d "$SIGNACARE_HOME/$dir" ]; then
      if $DRY_RUN; then dry "Remove $SIGNACARE_HOME/$dir"; else
        rm -rf "$SIGNACARE_HOME/$dir" && ok "Removed $dir" || true
      fi
    fi
  done
else
  if [ -d "$SIGNACARE_HOME" ]; then
    if $DRY_RUN; then
      dry "Remove $SIGNACARE_HOME ($(du -sh "$SIGNACARE_HOME" 2>/dev/null | cut -f1))"
    else
      rm -rf "$SIGNACARE_HOME" && ok "Removed $SIGNACARE_HOME" || warn "Could not remove — try: sudo rm -rf $SIGNACARE_HOME"
    fi
  fi
fi

# ── Step 4: Remove license ──
if [ -d "$HOME/.signacare" ]; then
  if $DRY_RUN; then dry "Remove $HOME/.signacare (license)"; else
    rm -rf "$HOME/.signacare" && ok "License removed" || true
  fi
fi

# ── Step 5: Remove LaunchAgent (if installed) ──
LAUNCH_AGENT="$HOME/Library/LaunchAgents/com.signacare.emr.plist"
if [ -f "$LAUNCH_AGENT" ]; then
  if $DRY_RUN; then dry "Remove LaunchAgent $LAUNCH_AGENT"; else
    launchctl unload "$LAUNCH_AGENT" 2>/dev/null || true
    rm -f "$LAUNCH_AGENT" && ok "LaunchAgent removed" || true
  fi
fi

# ── Step 6: Database ──
if ! $KEEP_DATA; then
  log "Removing database..."
  if command -v psql &>/dev/null && pg_isready -q 2>/dev/null; then
    # Canonical names per docs/gold-standard-reports/08-deployment-guide.md §2.
    DB_NAME="signacaredb"
    DB_USER="signacare_owner"
    DB_APP_USER="app_user"
    if psql -lqt 2>/dev/null | grep -qw "$DB_NAME"; then
      if $DRY_RUN; then dry "Drop database $DB_NAME, owner $DB_USER, runtime $DB_APP_USER"; else
        dropdb "$DB_NAME" 2>/dev/null && ok "Database '$DB_NAME' dropped" || warn "Could not drop database (may be in use)"
        dropuser "$DB_USER" 2>/dev/null && ok "Owner role '$DB_USER' dropped" || true
        dropuser "$DB_APP_USER" 2>/dev/null && ok "Runtime role '$DB_APP_USER' dropped" || true
      fi
    else
      ok "Database '$DB_NAME' not found"
    fi
  else
    warn "PostgreSQL not running — database not removed. Start PostgreSQL and re-run to remove."
  fi
else
  warn "Keeping database (--keep-data)"
fi

# ── Step 7: Redis data ──
if command -v redis-cli &>/dev/null; then
  if redis-cli ping 2>/dev/null | grep -q PONG; then
    if $DRY_RUN; then dry "Flush all Redis data"; else
      redis-cli FLUSHALL 2>/dev/null && ok "Redis data cleared" || true
    fi
  fi
fi

# ── Step 8: Ollama models ──
if ! $KEEP_MODELS; then
  log "Removing AI models..."
  if command -v ollama &>/dev/null; then
    for model in llama3.2 qwen2.5:14b; do
      if $DRY_RUN; then dry "Remove Ollama model: $model"; else
        ollama rm "$model" 2>/dev/null && ok "Removed model: $model" || true
      fi
    done
  fi

  # Remove Whisper models (cached by faster-whisper)
  WHISPER_CACHE="$HOME/.cache/huggingface/hub"
  if [ -d "$WHISPER_CACHE" ]; then
    WHISPER_DIRS=$(find "$WHISPER_CACHE" -name "*whisper*" -type d 2>/dev/null)
    if [ -n "$WHISPER_DIRS" ]; then
      if $DRY_RUN; then dry "Remove Whisper model cache"; else
        echo "$WHISPER_DIRS" | xargs rm -rf 2>/dev/null && ok "Whisper model cache removed" || true
      fi
    fi
  fi
else
  warn "Keeping AI models (--keep-models)"
fi

# ── Step 9: Remove Homebrew packages (optional) ──
echo ""
log "Homebrew packages (PostgreSQL, Redis, Ollama) were NOT removed."
log "To remove them manually:"
echo "  brew uninstall postgresql@16 redis ollama"
echo "  brew services stop postgresql@16 redis"

# ── Summary ──
echo ""
if $DRY_RUN; then
  echo -e "${YELLOW}${BOLD}DRY RUN complete — nothing was deleted.${NC}"
  echo "Run without --dry-run to perform the actual uninstall."
else
  echo -e "${GREEN}${BOLD}╔════════════════════════════════════════════════════╗${NC}"
  echo -e "${GREEN}${BOLD}║  Uninstall Complete                                ║${NC}"
  echo -e "${GREEN}${BOLD}╚════════════════════════════════════════════════════╝${NC}"
  echo ""
  echo "Removed:"
  echo "  • Signacare.app from /Applications"
  echo "  • Package receipt"
  $KEEP_DATA  || echo "  • Application data ($SIGNACARE_HOME)"
  $KEEP_DATA  || echo "  • Database (signacareemr)"
  $KEEP_MODELS || echo "  • AI models (Ollama + Whisper)"
  echo "  • License"
  echo "  • Redis data"
  echo ""
  $KEEP_DATA && echo "  ⚠ Database and patient data were PRESERVED"
  $KEEP_MODELS && echo "  ⚠ AI models were PRESERVED (saves ~15GB re-download)"
  echo ""
  echo "NOT removed (manual if needed):"
  echo "  • Homebrew packages: brew uninstall postgresql@16 redis ollama"
  echo "  • Node.js: brew uninstall node@20"
  echo "  • Python: brew uninstall python@3.11"
fi
echo ""
