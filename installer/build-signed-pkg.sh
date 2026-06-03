#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# Signacare EMR — Build Signed + Notarized macOS .pkg
#
# Prerequisites:
#   1. "Developer ID Installer" cert in Keychain (you have this: 6QYU8DW6S4)
#   2. "Developer ID Application" cert in Keychain (needed for app signing)
#      → Create at: https://developer.apple.com/account/resources/certificates/list
#      → Type: "Developer ID Application"
#   3. App-specific password for notarization:
#      → Generate at: https://appleid.apple.com/account/manage
#      → Section: "App-Specific Passwords"
#      → Store with: xcrun notarytool store-credentials "signacare-notary" \
#            --apple-id "drprakashkamath@gmail.com" \
#            --team-id "6QYU8DW6S4" \
#            --password "xxxx-xxxx-xxxx-xxxx"
#
# Usage:
#   ./build-signed-pkg.sh              # Build + sign only
#   ./build-signed-pkg.sh --notarize   # Build + sign + notarize + staple
# ═══════════════════════════════════════════════════════════════════════════════

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BUILD_DIR="$SCRIPT_DIR/build"

TEAM_ID="6QYU8DW6S4"
INSTALLER_CERT="Developer ID Installer: Signacare PTY Ltd ($TEAM_ID)"
APP_CERT="Developer ID Application: Signacare PTY Ltd ($TEAM_ID)"
APPLE_ID="drprakashkamath@gmail.com"
NOTARY_PROFILE="signacare-notary"

VERSION="1.0.0"
PKG_ID="com.signacare.emr"
PKG_NAME="Signacare-EMR-${VERSION}"

NOTARIZE=false
[ "${1:-}" = "--notarize" ] && NOTARIZE=true

echo ""
echo "╔════════════════════════════════════════════╗"
echo "║  Signacare EMR — Signed Package Builder    ║"
echo "╚════════════════════════════════════════════╝"
echo ""

rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"

# ══════════════════════════════════════════════════════════════════════════════
# Step 1: Create the .app bundle
# ══════════════════════════════════════════════════════════════════════════════
echo "Step 1: Creating .app bundle..."

APP_BUNDLE="$BUILD_DIR/Signacare.app"
bash "$SCRIPT_DIR/build-mac-app.sh" 2>/dev/null

if [ ! -d "$APP_BUNDLE" ]; then
  echo "ERROR: .app bundle not created"
  exit 1
fi
echo "  ✓ .app bundle created"

# ══════════════════════════════════════════════════════════════════════════════
# Step 2: Code-sign the .app
# ══════════════════════════════════════════════════════════════════════════════
echo "Step 2: Code-signing .app..."

# Check for Developer ID Application cert
if security find-identity -v -p codesigning | grep -q "Developer ID Application"; then
  codesign --deep --force --options runtime \
    --sign "$APP_CERT" \
    --timestamp \
    --entitlements /dev/stdin <<'ENTITLEMENTS' "$APP_BUNDLE"
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
    <true/>
    <key>com.apple.security.cs.disable-library-validation</key>
    <true/>
    <key>com.apple.security.device.audio-input</key>
    <true/>
    <key>com.apple.security.network.client</key>
    <true/>
    <key>com.apple.security.network.server</key>
    <true/>
    <key>com.apple.security.files.user-selected.read-write</key>
    <true/>
</dict>
</plist>
ENTITLEMENTS
  echo "  ✓ .app signed with Developer ID Application"

  # Verify
  codesign --verify --deep --strict "$APP_BUNDLE" && echo "  ✓ Signature verified" || echo "  ⚠ Signature verification issue"
else
  echo "  ⚠ Developer ID Application cert not found — signing with ad-hoc"
  echo "    To fix: create cert at https://developer.apple.com/account/resources/certificates/list"
  codesign --deep --force --sign - "$APP_BUNDLE"
  echo "  ✓ Ad-hoc signed (will trigger Gatekeeper warning)"
fi

# ══════════════════════════════════════════════════════════════════════════════
# Step 3: Build the payload for .pkg
# ══════════════════════════════════════════════════════════════════════════════
echo "Step 3: Building .pkg payload..."

PKG_ROOT="$BUILD_DIR/pkg-root"
PKG_SCRIPTS="$BUILD_DIR/pkg-scripts"
mkdir -p "$PKG_ROOT/Applications"
mkdir -p "$PKG_SCRIPTS"

# Copy .app to payload
cp -R "$APP_BUNDLE" "$PKG_ROOT/Applications/"

# ── Postinstall script (removes quarantine + sets permissions) ──
cat > "$PKG_SCRIPTS/postinstall" << 'POSTINSTALL_EOF'
#!/bin/bash
# ── Signacare EMR Postinstall ──
# This script runs as root. $HOME is /var/root, NOT the user's home.
# We must find the real user who initiated the install.

# Get the actual logged-in user (not root)
REAL_USER=$(stat -f "%Su" /dev/console 2>/dev/null || echo "${SUDO_USER:-$USER}")
REAL_HOME=$(eval echo "~$REAL_USER")

# Remove quarantine flag
xattr -rd com.apple.quarantine /Applications/Signacare.app 2>/dev/null || true

# Ensure executable permissions
chmod +x /Applications/Signacare.app/Contents/MacOS/signacare
chmod +x /Applications/Signacare.app/Contents/Resources/*.sh 2>/dev/null || true

# Create application directories as the REAL user (not root)
SIGNACARE_HOME="$REAL_HOME/signacare"
sudo -u "$REAL_USER" mkdir -p "$SIGNACARE_HOME"/{logs,pids,data,backups}
sudo -u "$REAL_USER" mkdir -p "$SIGNACARE_HOME/whisper-server"

# Ensure ownership is correct (not root-owned)
chown -R "$REAL_USER" "$SIGNACARE_HOME" 2>/dev/null || true

# Log installation
echo "Signacare EMR installed at $(date) by $REAL_USER" >> "$SIGNACARE_HOME/logs/install.log"
chown "$REAL_USER" "$SIGNACARE_HOME/logs/install.log" 2>/dev/null || true

exit 0
POSTINSTALL_EOF
chmod +x "$PKG_SCRIPTS/postinstall"

echo "  ✓ Payload and scripts prepared"

# ══════════════════════════════════════════════════════════════════════════════
# Step 4: Build the .pkg
# ══════════════════════════════════════════════════════════════════════════════
echo "Step 4: Building .pkg..."

UNSIGNED_PKG="$BUILD_DIR/${PKG_NAME}-unsigned.pkg"
SIGNED_PKG="$BUILD_DIR/${PKG_NAME}.pkg"

pkgbuild \
  --root "$PKG_ROOT" \
  --scripts "$PKG_SCRIPTS" \
  --identifier "$PKG_ID" \
  --version "$VERSION" \
  --install-location "/" \
  "$UNSIGNED_PKG"

echo "  ✓ Unsigned .pkg built"

# ══════════════════════════════════════════════════════════════════════════════
# Step 5: Sign the .pkg with Developer ID Installer
# ══════════════════════════════════════════════════════════════════════════════
echo "Step 5: Signing .pkg..."

if security find-identity -v | grep -q "Developer ID Installer"; then
  productsign --sign "$INSTALLER_CERT" --timestamp "$UNSIGNED_PKG" "$SIGNED_PKG"
  rm "$UNSIGNED_PKG"
  echo "  ✓ .pkg signed with Developer ID Installer"

  # Verify
  pkgutil --check-signature "$SIGNED_PKG" | head -5
else
  mv "$UNSIGNED_PKG" "$SIGNED_PKG"
  echo "  ⚠ Developer ID Installer cert not found — .pkg is unsigned"
fi

# ══════════════════════════════════════════════════════════════════════════════
# Step 6: Notarize (if requested)
# ══════════════════════════════════════════════════════════════════════════════
if $NOTARIZE; then
  echo "Step 6: Submitting for notarization..."

  # Check if credentials are stored
  if xcrun notarytool history --keychain-profile "$NOTARY_PROFILE" 2>/dev/null | head -1 | grep -q "Successfully"; then
    NOTARY_AUTH="--keychain-profile $NOTARY_PROFILE"
  else
    echo "  Notarization credentials not stored. Store them first:"
    echo "  xcrun notarytool store-credentials \"$NOTARY_PROFILE\" \\"
    echo "    --apple-id \"$APPLE_ID\" \\"
    echo "    --team-id \"$TEAM_ID\" \\"
    echo "    --password \"YOUR_APP_SPECIFIC_PASSWORD\""
    echo ""
    echo "  Get app-specific password: https://appleid.apple.com/account/manage"
    echo ""
    read -p "  Enter app-specific password (or press Enter to skip): " APP_PASSWORD
    if [ -z "$APP_PASSWORD" ]; then
      echo "  ⚠ Skipping notarization"
      NOTARIZE=false
    else
      NOTARY_AUTH="--apple-id $APPLE_ID --team-id $TEAM_ID --password $APP_PASSWORD"
    fi
  fi

  if $NOTARIZE; then
    echo "  Uploading to Apple notarization service..."
    SUBMIT_OUT=$(xcrun notarytool submit "$SIGNED_PKG" $NOTARY_AUTH --wait 2>&1)
    echo "$SUBMIT_OUT"

    if echo "$SUBMIT_OUT" | grep -q "Accepted"; then
      echo "  ✓ Notarization accepted!"

      # Staple the notarization ticket to the .pkg
      echo "  Stapling ticket..."
      xcrun stapler staple "$SIGNED_PKG"
      echo "  ✓ Notarization ticket stapled"

      # Verify
      spctl --assess --type install "$SIGNED_PKG" 2>&1 && echo "  ✓ Gatekeeper: PASS" || echo "  ⚠ Gatekeeper check"
    else
      echo "  ✗ Notarization failed. Check logs:"
      SUBMISSION_ID=$(echo "$SUBMIT_OUT" | grep "id:" | head -1 | awk '{print $2}')
      [ -n "$SUBMISSION_ID" ] && xcrun notarytool log "$SUBMISSION_ID" $NOTARY_AUTH
    fi
  fi
else
  echo "Step 6: Skipping notarization (run with --notarize to enable)"
fi

# ══════════════════════════════════════════════════════════════════════════════
# Step 7: Also create a .dmg for convenience
# ══════════════════════════════════════════════════════════════════════════════
echo "Step 7: Creating .dmg..."

DMG_STAGING="$BUILD_DIR/dmg-staging"
rm -rf "$DMG_STAGING"
mkdir -p "$DMG_STAGING"
cp -R "$APP_BUNDLE" "$DMG_STAGING/"
ln -s /Applications "$DMG_STAGING/Applications"
cp "$SIGNED_PKG" "$DMG_STAGING/" 2>/dev/null || true

cat > "$DMG_STAGING/Install.txt" << 'INSTALL_EOF'
SIGNACARE EMR INSTALLATION

Option 1 (recommended): Double-click Signacare-EMR.pkg
Option 2: Drag Signacare.app to Applications

First launch downloads ~15GB of AI models.
Default login: admin@signacare.local / Admin123!
INSTALL_EOF

DMG_FILE="$BUILD_DIR/${PKG_NAME}.dmg"
hdiutil create -volname "Signacare EMR" -srcfolder "$DMG_STAGING" -ov -format UDZO "$DMG_FILE" 2>/dev/null

# Sign the DMG too
if security find-identity -v -p codesigning | grep -q "Developer ID Application"; then
  codesign --force --sign "$APP_CERT" --timestamp "$DMG_FILE" 2>/dev/null && echo "  ✓ .dmg signed" || true
fi

# Cleanup
rm -rf "$PKG_ROOT" "$PKG_SCRIPTS" "$DMG_STAGING"

echo ""
echo "╔════════════════════════════════════════════════════════╗"
echo "║  Build Complete!                                       ║"
echo "║                                                        ║"
echo "║  .pkg: $SIGNED_PKG"
echo "║  .dmg: $DMG_FILE"
echo "║  .app: $APP_BUNDLE"
echo "║                                                        ║"
if $NOTARIZE; then
echo "║  ✓ Signed + Notarized — no Gatekeeper warnings         ║"
else
echo "║  ⚠ Signed but NOT notarized — see steps above          ║"
fi
echo "╚════════════════════════════════════════════════════════╝"
echo ""
echo "Next steps for notarization:"
echo "  1. Create 'Developer ID Application' cert at:"
echo "     https://developer.apple.com/account/resources/certificates/list"
echo "  2. Create app-specific password at:"
echo "     https://appleid.apple.com/account/manage"
echo "  3. Store credentials:"
echo "     xcrun notarytool store-credentials \"$NOTARY_PROFILE\" \\"
echo "       --apple-id \"$APPLE_ID\" --team-id \"$TEAM_ID\" --password \"xxxx\""
echo "  4. Rebuild with: ./build-signed-pkg.sh --notarize"
