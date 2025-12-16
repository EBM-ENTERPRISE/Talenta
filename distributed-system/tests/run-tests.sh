#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
bash ./failover.sh
node ./replication.test.cjs
