#!/bin/bash

set -e

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"

HOST_DIR="$ROOT_DIR/host-app"
REMOTE_DIR="$ROOT_DIR/profile-remote"

cleanup() {
  echo ""
  echo "🛑 Stopping Module Federation servers..."

  kill "$REMOTE_PID" 2>/dev/null || true
  kill "$HOST_PID" 2>/dev/null || true

  exit 0
}

trap cleanup SIGINT SIGTERM

echo "🚀 Starting Profile Remote on port 9000..."

cd "$REMOTE_DIR"
npx rnc-cli start --port 9000 &

REMOTE_PID=$!

echo "Starting Host on port 8081..."

cd "$HOST_DIR"
npx rnc-cli start --port 8081 &

HOST_PID=$!

echo ""
echo "✅ Module Federation servers started"
echo ""
echo "Host:   http://localhost:8081"
echo "Remote: http://localhost:9000"
echo ""
echo "Press CTRL+C to stop both."
echo ""

wait