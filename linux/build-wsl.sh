#!/usr/bin/env bash
set -euo pipefail

NODE_VER=v22.20.0
NODE_DIR="$HOME/node-${NODE_VER}-linux-x64"
if [[ ! -x "$NODE_DIR/bin/node" ]]; then
  curl -fsSL "https://nodejs.org/dist/${NODE_VER}/node-${NODE_VER}-linux-x64.tar.xz" -o /tmp/node.tar.xz
  tar -xJf /tmp/node.tar.xz -C "$HOME"
fi
export PATH="$NODE_DIR/bin:$PATH"

SRC="$(cd "$(dirname "$0")" && pwd)"
WORK="$HOME/muse-linux-build"
rm -rf "$WORK"
mkdir -p "$WORK"
cp "$SRC/package.json" "$SRC/main.js" "$SRC/preload.js" "$SRC/mpris.js" "$SRC/updater.js" "$WORK/"
mkdir -p "$WORK/build"
cp "$SRC/build/icon.png" "$WORK/build/icon.png"

cd "$WORK"
npm install
npx electron-builder --linux AppImage deb

UNPACK=dist/linux-unpacked/resources/app.asar.unpacked/node_modules
test -d "$UNPACK/call-bind-apply-helpers" || { echo "missing call-bind-apply-helpers in asarUnpack"; exit 1; }
test -d "$UNPACK/mpris-service" || { echo "missing mpris-service in asarUnpack"; exit 1; }
NODE_PATH="$UNPACK" node -e "require('call-bind-apply-helpers'); require('dbus-next'); require('mpris-service'); console.log('mpris-ok')"

mkdir -p "$SRC/dist"
cp -f dist/*.AppImage dist/*.deb "$SRC/dist/"
echo "BUILT"
ls -lh "$SRC/dist"/*.AppImage "$SRC/dist"/*.deb
