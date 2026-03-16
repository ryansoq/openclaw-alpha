#!/bin/bash
# Auto-restart static-server.cjs if it dies
cd "$(dirname "$0")"
while true; do
  node static-server.cjs
  echo "[$(date)] static-server exited, restarting in 2s..."
  sleep 2
done
