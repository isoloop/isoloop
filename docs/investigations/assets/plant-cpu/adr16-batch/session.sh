#!/bin/bash
# One locked bench session for the ADR 0016 decision 3 measurement.
set -u
exec 9>~/bench/.lock
flock 9
echo "locked $(date -u +%FT%TZ)"
cd ~/bench
rm -rf ~/bench/examples-batch
git clone -q https://github.com/isoloop/examples.git examples-batch && git -C examples-batch checkout -q 8f22ce0
tar -xzf ~/bench/probe-batch/batch-overlay.tgz -C examples-batch
git -C examples-batch status --short
mkdir -p ~/bench/probe-batch/results
trap "sudo -n bench-mode off > ~/bench/probe-batch/bench-off.log 2>&1" EXIT
sudo -n bench-mode on
bench-mode status
docker rm -f plant-probe-batch >/dev/null 2>&1 || true
docker run --name plant-probe-batch --init --cpuset-cpus=2,4,6,8 --shm-size=2g \
  -v ~/bench/examples-batch:/work \
  -v ~/bench/probe-batch:/work/apps/dashboards/plant/.probe \
  plant-compare bash /work/apps/dashboards/plant/.probe/run-batch.sh
echo "exit $?"
