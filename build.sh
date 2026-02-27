#!/bin/bash
# RetIQ Build & Deploy
# Usage:
#   ./build.sh          Build only (dist/ folder)
#   ./build.sh deploy   Build + deploy to Cloudflare Pages

set -e

echo ""
echo "═══════════════════════════════════════"
echo "  RetIQ Build Pipeline"
echo "═══════════════════════════════════════"

# Check esbuild
if ! node -e "require('esbuild')" 2>/dev/null; then
  echo ""
  echo "⚠ esbuild not found. Installing..."
  npm install esbuild --save-dev
fi

# Build
node build.js

# Deploy if requested
if [ "$1" = "deploy" ]; then
  echo ""
  echo "🚀 Deploying to Cloudflare Pages..."
  npx wrangler pages deploy retiq-deploy/ --project-name=retiqstudio
  echo ""
  echo "✅ Live at https://retiqstudio.com"
fi
