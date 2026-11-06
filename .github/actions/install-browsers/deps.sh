#!/usr/bin/env bash
# Installs the system packages for the given Playwright browsers, up to 3
# attempts of 5 minutes each.
#
# The Azure Ubuntu mirror sometimes serves a package at a trickle: too fast
# for apt's 30 s timeout, too slow to finish in 5 minutes. So the .deb files
# are kept in $APT_DEBS (cached by action.yml) and seeded into apt's archive
# before installing: apt then only downloads what changed since the cache
# was saved. A failed attempt switches to archive.ubuntu.com for the next one.
set -uo pipefail
: "${APT_DEBS:?APT_DEBS must name the package cache directory}"
mkdir -p "$APT_DEBS"
sudo tee /etc/apt/apt.conf.d/99isoloop-ci >/dev/null <<'CONF'
Acquire::http::Timeout "30";
Acquire::https::Timeout "30";
Acquire::Retries "5";
APT::Keep-Downloaded-Packages "true";
Binary::apt::APT::Keep-Downloaded-Packages "true";
CONF
if compgen -G "$APT_DEBS/*.deb" >/dev/null; then
  sudo cp "$APT_DEBS"/*.deb /var/cache/apt/archives/
  echo "Seeded $(ls "$APT_DEBS"/*.deb | wc -l) cached packages"
fi
for attempt in 1 2 3; do
  if [ "$attempt" -gt 1 ]; then
    echo "Switching from azure.archive.ubuntu.com to archive.ubuntu.com"
    grep -rlZ 'azure\.archive\.ubuntu\.com' /etc/apt/ 2>/dev/null |
      xargs -0 -r sudo sed -i 's#azure\.archive\.ubuntu\.com#archive.ubuntu.com#g'
  fi
  # Finish a package install that a killed attempt interrupted.
  sudo dpkg --configure -a
  if timeout --kill-after=30s 5m pnpm exec playwright install-deps "$@"; then
    if compgen -G /var/cache/apt/archives/*.deb >/dev/null; then
      cp /var/cache/apt/archives/*.deb "$APT_DEBS"/
    fi
    exit 0
  fi
  echo "::warning::attempt $attempt of 3 failed or timed out after 5m: playwright install-deps $*"
  # timeout can't reach apt-get, which runs as root under sudo and would keep
  # the dpkg lock: stop it before the next attempt.
  sudo pkill -9 -x apt-get || true
  sudo pkill -9 -x dpkg || true
  sleep 5
done
exit 1
