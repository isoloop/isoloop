#!/bin/bash
# Plant CPU profile (docs/investigations/plant-cpu.md), inside plant-compare.
set -euo pipefail
cd /work
pnpm install --frozen-lockfile > /work/.cpu-install.log 2>&1
cd apps/dashboards/plant
echo "build $(date -u +%FT%TZ)"
npx vite build --minify false > /dev/null
npx vite build --mode native --minify false > /dev/null
npx vite build --mode native-workers --minify false > /dev/null
npx vite build --outDir dist-min/isoloop > /dev/null
npx vite build --mode native --outDir dist-min/native > /dev/null
npx vite build --mode native-workers --outDir dist-min/native-workers > /dev/null
npx vite preview --outDir dist --port 4792 --strictPort > /dev/null 2>&1 &
npx vite preview --outDir dist-min --port 4793 --strictPort > /dev/null 2>&1 &
sleep 5
echo "probe $(date -u +%FT%TZ)"
CONFIGS=native-workers,isoloop:matched,native,isoloop:one RATES=5,1 ROUNDS=4 OUT=.probe/results node .probe/probe.mjs
echo "minified $(date -u +%FT%TZ)"
NO_TRACE=1 BASE=http://localhost:4793 CONFIGS=native-workers,isoloop:matched,native,isoloop:one RATES=5 ROUNDS=3 OUT=.probe/minified node .probe/probe.mjs
NO_TRACE=1 CONFIGS=native-workers,isoloop:matched,native,isoloop:one RATES=5 ROUNDS=3 OUT=.probe/unminified node .probe/probe.mjs
echo "analyze $(date -u +%FT%TZ)"
node .probe/analyze.mjs .probe/results dist ../../../node_modules/.pnpm > .probe/results/analyze.log
echo "done $(date -u +%FT%TZ)"
