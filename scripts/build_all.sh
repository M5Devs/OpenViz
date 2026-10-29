#!/usr/bin/env bash
set -e

echo "=== OpenViz Complete Build Automation ==="

echo "Step 1: Running unit tests..."
npm test

echo "Step 2: Building CLI and web bundle..."
npm run build

echo "Build process completed successfully!"
