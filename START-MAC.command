#!/bin/bash
set -e
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Install Node.js 24 or newer from https://nodejs.org, then try again."
  read -r -p "Press Enter to close."
  exit 1
fi
node -e 'if(Number(process.versions.node.split(".")[0])<24){console.error("Please install Node.js 24 or newer.");process.exit(1)}'
if [ ! -d node_modules ]; then npm ci; fi
if [ ! -f .env ]; then node scripts/setup.mjs; fi
npm run build
echo "Open http://localhost:3001 in your browser. Keep this window open. Ctrl+C stops Relay."
npm start
