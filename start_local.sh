#!/usr/bin/env sh
set -e
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 20 이상을 설치해주세요."
  exit 1
fi
if [ ! -d node_modules ]; then
  npm install
fi
npm start
