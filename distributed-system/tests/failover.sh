#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
docker compose stop backend-1
sleep 1
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:9090
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:9090/api/health || true
docker compose start backend-1
