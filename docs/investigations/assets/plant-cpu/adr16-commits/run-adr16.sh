#!/bin/bash
# ADR 0016 decision 1 measurement, inside plant-compare. /work is the
# throwaway examples branch (packed #166 libraries), /base is origin/main
# (8f22ce0) with the stock 0.0.0-next.61245db libraries. One session,
# interleaved: stock, commits at 100 ms, commits at 250 ms, both natives.
set -euo pipefail
cd /base
pnpm install --frozen-lockfile > /work/.base-install.log 2>&1
cd /base/apps/dashboards/plant
echo "build base $(date -u +%FT%TZ)"
npx vite build --minify false --outDir dist/isobase > /dev/null
cd /work
pnpm install --frozen-lockfile > /work/.adr16-install.log 2>&1
cd /work/apps/dashboards/plant
echo "build adr16 $(date -u +%FT%TZ)"
npx vite build --minify false > /dev/null
VITE_COMMIT_MS=250 npx vite build --minify false --outDir dist/isoc250 > /dev/null
npx vite build --mode native --minify false > /dev/null
npx vite build --mode native-workers --minify false > /dev/null
rm -rf dist/isobase && cp -r /base/apps/dashboards/plant/dist/isobase dist/isobase
npx vite preview --outDir dist --port 4792 --strictPort > /dev/null 2>&1 &
sleep 5
echo "probe $(date -u +%FT%TZ)"
CONFIGS=native-workers,isobase:matched,isoloop:matched,isoc250:matched,native,isobase:one,isoloop:one,isoc250:one \
  RATES=5,1 ROUNDS=4 OUT=.probe/results node .probe/probe.mjs
echo "analyze $(date -u +%FT%TZ)"
mkdir -p .probe/base .probe/adr16
for f in .probe/results/*-run*; do
  b=$(basename "$f")
  case "$b" in
    native*) cp "$f" .probe/base/; cp "$f" .probe/adr16/ ;;
    isobase*) cp "$f" .probe/base/ ;;
    *) cp "$f" .probe/adr16/ ;;
  esac
done
PAIRS=native-workers=isobase:matched,native=isobase:one \
  node .probe/analyze.mjs .probe/base dist /base/node_modules/.pnpm > .probe/base/analyze.log
ISOLOOP_VERSION=file+vendor,0.0.0-next.61245db \
  PAIRS=native-workers=isoloop:matched,native-workers=isoc250:matched,native=isoloop:one,native=isoc250:one \
  node .probe/analyze.mjs .probe/adr16 dist ../../../node_modules/.pnpm > .probe/adr16/analyze.log
node .probe/msgs.mjs .probe/results > .probe/results/msgs.log
echo "done $(date -u +%FT%TZ)"
