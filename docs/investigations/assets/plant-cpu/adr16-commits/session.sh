#!/bin/bash
# One locked bench session for the ADR 0016 decision 1 measurement: wait for
# the lock, set up both clones, bench mode on, the probe, bench mode off.
set -u
exec 9>~/bench/.lock
flock 9
echo "locked $(date -u +%FT%TZ)"
cd ~/bench
rm -rf ~/bench/examples-base ~/bench/examples-adr16
git clone -q https://github.com/isoloop/examples.git examples-base && git -C examples-base checkout -q 8f22ce0
git clone -q examples-base examples-adr16 && git -C examples-adr16 checkout -q 8f22ce0
tar -xzf ~/bench/probe-adr16/adr16-overlay.tgz -C examples-adr16
git -C examples-adr16 status --short
trap "sudo -n bench-mode off > ~/bench/probe-adr16/bench-off.log 2>&1" EXIT
sudo -n bench-mode on
bench-mode status
docker rm -f plant-probe-adr16 >/dev/null 2>&1 || true
docker run --name plant-probe-adr16 --init --cpuset-cpus=2,4,6,8 --shm-size=2g \
  -v ~/bench/examples-adr16:/work -v ~/bench/examples-base:/base \
  -v ~/bench/probe-adr16:/work/apps/dashboards/plant/.probe \
  plant-compare bash /work/apps/dashboards/plant/.probe/run-adr16.sh
echo "exit $?"
