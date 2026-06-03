#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# Signacare EMR — Build macOS .app + .dmg
#
# Creates:
#   Signacare.app     — macOS application bundle
#   Signacare.dmg     — distributable disk image
#
# Usage: ./build-mac-app.sh
# ═══════════════════════════════════════════════════════════════════════════════

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BUILD_DIR="$SCRIPT_DIR/build"
APP_NAME="Signacare"
APP_BUNDLE="$BUILD_DIR/$APP_NAME.app"
DMG_NAME="Signacare-EMR"

echo "Building $APP_NAME.app..."

# Clean previous build
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"

# ── Create .app structure ──
mkdir -p "$APP_BUNDLE/Contents/MacOS"
mkdir -p "$APP_BUNDLE/Contents/Resources"

# ── Info.plist ──
cat > "$APP_BUNDLE/Contents/Info.plist" << 'PLIST_EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleName</key>
    <string>Signacare</string>
    <key>CFBundleDisplayName</key>
    <string>Signacare EMR</string>
    <key>CFBundleIdentifier</key>
    <string>com.signacare.emr</string>
    <key>CFBundleVersion</key>
    <string>1.0.0</string>
    <key>CFBundleShortVersionString</key>
    <string>1.0.0</string>
    <key>CFBundleExecutable</key>
    <string>signacare</string>
    <key>CFBundleIconFile</key>
    <string>AppIcon</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>LSMinimumSystemVersion</key>
    <string>12.0</string>
    <key>NSHighResolutionCapable</key>
    <true/>
    <key>LSUIElement</key>
    <false/>
    <key>NSMicrophoneUsageDescription</key>
    <string>Signacare uses the microphone for clinical voice transcription (AI Scribe).</string>
</dict>
</plist>
PLIST_EOF

# ── Main executable (shell launcher) ──
cat > "$APP_BUNDLE/Contents/MacOS/signacare" << 'EXEC_EOF'
#!/bin/bash
# Signacare EMR — macOS App Launcher
# This script runs inside the .app bundle

RESOURCES_DIR="$(cd "$(dirname "$0")/../Resources" && pwd)"
SIGNACARE_HOME="${SIGNACARE_HOME:-$HOME/signacare}"
LOG="$SIGNACARE_HOME/logs/launcher.log"
mkdir -p "$SIGNACARE_HOME/logs" "$SIGNACARE_HOME/pids"

# Add Homebrew to PATH (Apple Silicon + Intel)
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
[ -f /opt/homebrew/bin/brew ] && eval "$(/opt/homebrew/bin/brew shellenv)"

log() { echo "[$(date +%H:%M:%S)] $1" >> "$LOG"; }
log "Signacare starting..."

# ── First Run Check ──
if [ ! -f "$SIGNACARE_HOME/.installed" ]; then
  # Open Terminal for interactive setup
  osascript -e "
    tell application \"Terminal\"
      activate
      do script \"bash '$RESOURCES_DIR/setup-first-run.sh' && bash '$RESOURCES_DIR/signacare-launcher.sh'\"
    end tell
  "
  exit 0
fi

# ── Start Services (background) ──
start_service() {
  local name=$1 check_cmd=$2 start_cmd=$3
  if eval "$check_cmd" 2>/dev/null; then
    log "$name: already running"
    return 0
  fi
  log "$name: starting..."
  eval "$start_cmd" >> "$LOG" 2>&1
  sleep 2
  if eval "$check_cmd" 2>/dev/null; then
    log "$name: started"
  else
    log "$name: FAILED"
  fi
}

# PostgreSQL
start_service "PostgreSQL" "pg_isready -q" "brew services start postgresql@16 2>/dev/null || brew services start postgresql 2>/dev/null || true"
sleep 2

# Redis
start_service "Redis" "redis-cli ping 2>/dev/null | grep -q PONG" "redis-server --daemonize yes"

# Flush rate limits
redis-cli FLUSHALL > /dev/null 2>&1 || true

# Ollama
start_service "Ollama" "curl -s http://localhost:11434/api/tags > /dev/null" "ollama serve &"
sleep 2

# Whisper — ensure directory is writable
mkdir -p "$SIGNACARE_HOME/whisper-server" 2>/dev/null || true
if [ -f "$SIGNACARE_HOME/whisper-server/server.py" ]; then
  start_service "Whisper" "curl -s http://localhost:8080/health > /dev/null" "cd '$SIGNACARE_HOME/whisper-server' && python3 server.py &"
fi

# API Server
APP_SRC="$RESOURCES_DIR/app"
[ ! -d "$APP_SRC" ] && APP_SRC="$(cd "$RESOURCES_DIR/../../../" && pwd)"
if [ -d "$APP_SRC/apps/api" ]; then
  start_service "API" "curl -s http://localhost:4000/health > /dev/null" "cd '$APP_SRC/apps/api' && npx tsx -r dotenv/config src/server.ts &"
  # Wait longer for API
  for i in $(seq 1 15); do
    curl -s http://localhost:4000/health > /dev/null 2>&1 && break
    sleep 1
  done
fi

# ── Health Check Summary (notification) ──
api_ok=false; db_ok=false; redis_ok=false
curl -s http://localhost:4000/health > /dev/null 2>&1 && api_ok=true
pg_isready -q 2>/dev/null && db_ok=true
redis-cli ping 2>/dev/null | grep -q PONG && redis_ok=true

if $api_ok && $db_ok; then
  osascript -e 'display notification "All services running. Opening browser..." with title "Signacare EMR" sound name "Glass"'
  log "Health check: OK"
else
  msg="Issues detected:"
  $api_ok || msg="$msg API down."
  $db_ok || msg="$msg Database down."
  $redis_ok || msg="$msg Redis down."
  osascript -e "display notification \"$msg\" with title \"Signacare EMR\" sound name \"Basso\""
  log "Health check: $msg"
fi

# ── Open Browser ──
sleep 1
open "http://localhost:4000"

log "Signacare launched successfully"
EXEC_EOF

chmod +x "$APP_BUNDLE/Contents/MacOS/signacare"

# ── Copy resources ──
cp "$SCRIPT_DIR/setup-first-run.sh" "$APP_BUNDLE/Contents/Resources/"
cp "$SCRIPT_DIR/signacare-launcher.sh" "$APP_BUNDLE/Contents/Resources/"
chmod +x "$APP_BUNDLE/Contents/Resources/"*.sh

# ── Create app icon from SVG (if available) ──
LOGO_SVG="$PROJECT_DIR/apps/web/public/signacare-logo.svg"
if [ -f "$LOGO_SVG" ] && command -v rsvg-convert &>/dev/null; then
  ICONSET="$BUILD_DIR/AppIcon.iconset"
  mkdir -p "$ICONSET"
  for size in 16 32 64 128 256 512 1024; do
    rsvg-convert -w $size -h $size "$LOGO_SVG" > "$ICONSET/icon_${size}x${size}.png" 2>/dev/null || true
    if [ $size -le 512 ]; then
      rsvg-convert -w $((size*2)) -h $((size*2)) "$LOGO_SVG" > "$ICONSET/icon_${size}x${size}@2x.png" 2>/dev/null || true
    fi
  done
  iconutil -c icns "$ICONSET" -o "$APP_BUNDLE/Contents/Resources/AppIcon.icns" 2>/dev/null || true
  rm -rf "$ICONSET"
  echo "Icon created"
fi

echo "✓ $APP_NAME.app created at $APP_BUNDLE"

# ── Build DMG ──
echo "Building $DMG_NAME.dmg..."

DMG_STAGING="$BUILD_DIR/dmg-staging"
mkdir -p "$DMG_STAGING"
cp -r "$APP_BUNDLE" "$DMG_STAGING/"
ln -s /Applications "$DMG_STAGING/Applications"

# Create README
cat > "$DMG_STAGING/README.txt" << 'README_EOF'
Signacare EMR — Mental Health Electronic Medical Record

INSTALLATION:
  1. Drag Signacare.app to the Applications folder
  2. Double-click Signacare in Applications
  3. First launch will install dependencies (~15GB download)
  4. After setup, the app starts automatically

REQUIREMENTS:
  • macOS 12+ (Monterey or later)
  • 16GB RAM recommended
  • 25GB free disk space
  • Internet connection (first launch only)

DEFAULT LOGIN:
  Email:    admin@signacare.local
  Password: Admin123!

SUPPORT:
  Email: support@signacare.com.au
README_EOF

hdiutil create -volname "$APP_NAME" -srcfolder "$DMG_STAGING" -ov -format UDZO "$BUILD_DIR/$DMG_NAME.dmg" 2>/dev/null

echo ""
echo "╔════════════════════════════════════════════╗"
echo "║  Build Complete!                           ║"
echo "║                                            ║"
echo "║  App: $APP_BUNDLE"
echo "║  DMG: $BUILD_DIR/$DMG_NAME.dmg"
echo "╚════════════════════════════════════════════╝"
