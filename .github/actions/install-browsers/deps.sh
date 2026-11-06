#!/usr/bin/env bash
# Installs the system packages for the given Playwright browsers, up to 3
# attempts of 5 minutes each. The Ubuntu apt mirror sometimes stalls; apt's
# own timeout retries a stalled download within 30 s, and the attempt limit
# catches anything slower.
set -uo pipefail
echo 'Acquire::http::Timeout "30"; Acquire::https::Timeout "30"; Acquire::Retries "5";' |
  sudo tee /etc/apt/apt.conf.d/99isoloop-ci >/dev/null
for attempt in 1 2 3; do
  # Finish a package install that a killed attempt interrupted.
  sudo dpkg --configure -a
  timeout --kill-after=30s 5m pnpm exec playwright install-deps "$@" && exit 0
  echo "::warning::attempt $attempt of 3 failed or timed out after 5m: playwright install-deps $*"
  # timeout can't reach apt-get, which runs as root under sudo and would keep
  # the dpkg lock: stop it before the next attempt.
  sudo pkill -9 -x apt-get || true
  sudo pkill -9 -x dpkg || true
  sleep 5
done
exit 1
