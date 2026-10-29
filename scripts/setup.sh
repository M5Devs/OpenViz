#!/usr/bin/env bash
set -e

echo "=== OpenViz Environment Setup ==="

NODE_VER=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VER" -lt 18 ]; then
  echo "Error: Node.js version 18 or higher is required."
  exit 1
fi
echo "Node.js version check passed: $(node -v)"

echo "Installing NPM dependencies..."
npm install

echo "Environment setup complete and verified!"
