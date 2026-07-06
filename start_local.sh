#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 18 이상을 설치해주세요."
  exit 1
fi
echo "No npm install is needed in this version."
echo "Local address: http://localhost:${PORT:-3000}"
exec node server.js
