#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
VERSION="$(node -p "require('./package.json').version")"
NAME="wednesday-${VERSION}"
rm -rf dist
mkdir -p "dist/${NAME}"
git archive --format=tar HEAD | tar -x -C "dist/${NAME}"
rm -rf "dist/${NAME}/dist"
tar -C dist -czf "dist/${NAME}.tar.gz" "$NAME"
(cd dist && zip -qr "${NAME}.zip" "$NAME" && rm -rf "$NAME" && sha256sum "${NAME}.tar.gz" "${NAME}.zip" > SHA256SUMS)
echo "Built ${NAME} release archives"
