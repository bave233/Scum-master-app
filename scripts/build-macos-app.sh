#!/bin/zsh
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_DIR="$PROJECT_DIR/Scum Master App.app"
CONTENTS_DIR="$APP_DIR/Contents"

mkdir -p "$CONTENTS_DIR/MacOS" "$CONTENTS_DIR/Resources"
cp "$PROJECT_DIR/macos/Info.plist" "$CONTENTS_DIR/Info.plist"
cp "$PROJECT_DIR/public/scum-master-logo.png" "$CONTENTS_DIR/Resources/scum-master-logo.png"
swiftc \
  -framework Cocoa \
  -framework WebKit \
  "$PROJECT_DIR/macos/SprintCapacityApp.swift" \
  -o "$CONTENTS_DIR/MacOS/Scum Master App"
chmod +x "$CONTENTS_DIR/MacOS/Scum Master App"
echo "$APP_DIR"
