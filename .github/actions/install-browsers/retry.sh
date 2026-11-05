#!/usr/bin/env bash
# Runs a command up to 3 times, each attempt limited to ATTEMPT_TIMEOUT
# (default 5m). The Ubuntu apt mirror sometimes slows to a few KB/s and a
# Playwright install then hangs for an hour; a fresh attempt usually gets a
# fast connection, and apt keeps the archives it already downloaded.
set -uo pipefail
limit=${ATTEMPT_TIMEOUT:-5m}
for attempt in 1 2 3; do
  timeout --kill-after=30s "$limit" "$@" && exit 0
  echo "::warning::attempt $attempt of 3 failed or timed out after $limit: $*"
  sleep 10
done
exit 1
