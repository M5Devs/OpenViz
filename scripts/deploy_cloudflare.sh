#!/usr/bin/env bash
set -e

echo "=== OpenViz Cloudflare Pages Deployment Check ==="

if [ ! -d "dist" ]; then
  echo "dist/ directory not found! Running build first..."
  npm run build
fi

if [ ! -f "dist/index.html" ]; then
  echo "Error: dist/index.html is missing!"
  exit 1
fi

echo "Checking dist/ bundle size..."
du -sh dist/

echo "Build artifacts verified and ready for Cloudflare Pages deployment!"
