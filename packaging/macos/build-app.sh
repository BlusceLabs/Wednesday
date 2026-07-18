#!/usr/bin/env bash
# Builds an unsigned Wednesday.app bundle for local use on macOS.
#
# This produces a bare-bones .app wrapper around the existing `bun` runtime
# and source tree; it is NOT code-signed or notarized. Distributing a
# signed/notarized build requires an active Apple Developer ID and running
# `codesign`/`xcrun notarytool` with real credentials, which cannot be done
# from this environment. Run this script on a macOS machine with Xcode
# command line tools and Bun installed.
set -euo pipefail
cd "$(dirname "$0")/../.."
APP_NAME="Wednesday.app"
OUT_DIR="dist/macos"
CONTENTS="$OUT_DIR/$APP_NAME/Contents"
rm -rf "$OUT_DIR"
mkdir -p "$CONTENTS/MacOS" "$CONTENTS/Resources"
cp -R src package.json tsconfig.json "$CONTENTS/Resources/"
cat > "$CONTENTS/MacOS/wednesday" <<'LAUNCHER'
#!/usr/bin/env bash
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../Resources" && pwd)"
cd "$DIR"
exec bun run src/index.tsx
LAUNCHER
chmod +x "$CONTENTS/MacOS/wednesday"
cat > "$CONTENTS/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Wednesday</string>
  <key>CFBundleExecutable</key><string>wednesday</string>
  <key>CFBundleIdentifier</key><string>com.midknightmantra.wednesday</string>
  <key>CFBundleVersion</key><string>1.0.0-rc.6</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
  <key>LSUIElement</key><false/>
</dict>
</plist>
PLIST
echo "Built unsigned $OUT_DIR/$APP_NAME. Code signing and notarization must be run separately with an Apple Developer ID."
