#!/bin/bash
# ADR 0016 decision 3 measurement, inside plant-compare. /work is the
# throwaway examples branch (packed #167 libraries: combined commits at
# 100 ms plus batching behind VITE_BUS_BATCH). Batching off ("isoloop") and
# on ("isobatch") come from the same libraries; only the setting differs.
set -euo pipefail
cd /work
pnpm install --frozen-lockfile > /work/.batch-install.log 2>&1
cd /work/apps/dashboards/plant
echo "build $(date -u +%FT%TZ)"
npx vite build --minify false > /dev/null
VITE_BUS_BATCH=1 npx vite build --minify false --outDir dist/isobatch > /dev/null
npx vite build --mode native --minify false > /dev/null
npx vite build --mode native-workers --minify false > /dev/null
npx vite preview --outDir dist --port 4792 --strictPort > /dev/null 2>&1 &
PREVIEW=$!
sleep 5
echo "probe $(date -u +%FT%TZ)"
CONFIGS=native-workers,isoloop:matched,isobatch:matched,native,isoloop:one,isobatch:one \
  RATES=5,1 ROUNDS=4 OUT=.probe/results node .probe/probe.mjs
echo "analyze $(date -u +%FT%TZ)"
ISOLOOP_VERSION=file+vendor \
  PAIRS=native-workers=isoloop:matched,native-workers=isobatch:matched,native=isoloop:one,native=isobatch:one \
  node .probe/analyze.mjs .probe/results dist ../../../node_modules/.pnpm > .probe/results/analyze.log
node .probe/msgs.mjs .probe/results > .probe/results/msgs.log
kill $PREVIEW || true
# Responsiveness: the comparison runner, batching off then on (it builds its own dist).
for mode in off on; do
  echo "compare $mode $(date -u +%FT%TZ)"
  rm -rf dist
  if [ "$mode" = on ]; then export VITE_BUS_BATCH=1; else unset VITE_BUS_BATCH; fi
  pnpm compare:pairs --pair native-workers=isoloop:matched --pair native=isoloop:one \
    --rates 5,1 --rounds 4 --hold 0 --engines chromium --out ".probe/compare-$mode" > ".probe/compare-$mode.log" 2>&1 || echo "compare $mode exit $?"
done
echo "done $(date -u +%FT%TZ)"
