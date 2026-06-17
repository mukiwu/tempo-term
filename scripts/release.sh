#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

# Version is read from tauri.conf.json — the single source of truth.
VERSION=$(node -p "require('./src-tauri/tauri.conf.json').version")
TAG="v${VERSION}"

echo "→ Releasing TempoTerm ${TAG}"

# Accept either APPLE_PASSWORD or the longer APPLE_APP_SPECIFIC_PASSWORD name
# (xcrun notarytool + Tauri's auto-notarization both read APPLE_PASSWORD).
export APPLE_PASSWORD="${APPLE_PASSWORD:-${APPLE_APP_SPECIFIC_PASSWORD:-}}"

# 1. Pre-flight checks
[ -z "${APPLE_ID:-}" ] && { echo "✗ APPLE_ID env not set"; exit 1; }
[ -z "${APPLE_PASSWORD:-}" ] && { echo "✗ APPLE_PASSWORD / APPLE_APP_SPECIFIC_PASSWORD env not set (use an app-specific password)"; exit 1; }
[ -z "${APPLE_TEAM_ID:-}" ] && { echo "✗ APPLE_TEAM_ID env not set"; exit 1; }
[ -f ~/.tempoterm/updater-key.json ] || { echo "✗ Updater private key missing at ~/.tempoterm/updater-key.json"; exit 1; }
[ -f CHANGELOG-NEXT.md ] || { echo "✗ CHANGELOG-NEXT.md missing (write release notes there first)"; exit 1; }
if gh release view "$TAG" >/dev/null 2>&1; then
  echo "✗ Release $TAG already exists on GitHub"
  exit 1
fi

# 2. Build with signing + updater key in env.
# The key was generated without a password, so set it explicitly empty to stop
# the CLI from prompting.
export TAURI_SIGNING_PRIVATE_KEY=$(cat ~/.tempoterm/updater-key.json)
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""
echo "→ Building (this also notarizes + staples the .app, given the APPLE_* envs)..."
pnpm tauri build --target aarch64-apple-darwin

APP_PATH="src-tauri/target/aarch64-apple-darwin/release/bundle/macos/TempoTerm.app"
DMG_PATH="src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/TempoTerm_${VERSION}_aarch64.dmg"
TAR_PATH="src-tauri/target/aarch64-apple-darwin/release/bundle/macos/TempoTerm.app.tar.gz"
SIG_PATH="${TAR_PATH}.sig"

[ -d "$APP_PATH" ] || { echo "✗ Built .app missing at $APP_PATH"; exit 1; }
[ -f "$DMG_PATH" ] || { echo "✗ Built .dmg missing at $DMG_PATH"; exit 1; }
[ -f "$TAR_PATH" ] || { echo "✗ Updater .tar.gz missing at $TAR_PATH (is createUpdaterArtifacts on?)"; exit 1; }
[ -f "$SIG_PATH" ] || { echo "✗ Updater signature missing at $SIG_PATH"; exit 1; }

# 3. Notarize the .dmg.
# tauri build already notarized + stapled the .app during bundling. The .dmg is
# produced afterwards and is NOT auto-notarized, so do it explicitly so users
# get no Gatekeeper warning when they open the .dmg.
echo "→ Notarizing .dmg (this may take a few minutes)..."
xcrun notarytool submit "$DMG_PATH" \
  --apple-id "$APPLE_ID" \
  --password "$APPLE_PASSWORD" \
  --team-id "$APPLE_TEAM_ID" \
  --wait

echo "→ Stapling notarization ticket to .dmg..."
xcrun stapler staple "$DMG_PATH"

# 4. Generate latest.json (the manifest the in-app updater polls).
PUB_DATE=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
SIGNATURE=$(cat "$SIG_PATH")
DOWNLOAD_URL="https://github.com/mukiwu/tempo-term/releases/download/${TAG}/TempoTerm.app.tar.gz"

cat > /tmp/latest.json <<EOF
{
  "version": "${VERSION}",
  "pub_date": "${PUB_DATE}",
  "platforms": {
    "darwin-aarch64": {
      "signature": "${SIGNATURE}",
      "url": "${DOWNLOAD_URL}"
    }
  }
}
EOF

# 5. Create the GitHub release and upload assets.
echo "→ Creating GitHub release..."
gh release create "$TAG" \
  --title "TempoTerm ${VERSION}" \
  --notes-file CHANGELOG-NEXT.md \
  "$DMG_PATH" \
  "$TAR_PATH" \
  "$SIG_PATH" \
  "/tmp/latest.json"

echo "✅ Released ${TAG}"
echo ""
echo "Next: rename CHANGELOG-NEXT.md → docs/changelogs/CHANGELOG-${VERSION}.md and start a fresh one for the next release."
