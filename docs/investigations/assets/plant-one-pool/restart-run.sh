#!/bin/bash
set -euo pipefail
cd /work && pnpm install --frozen-lockfile > /work/.restart-install.log 2>&1
cd apps/dashboards/plant
npx vite build > /dev/null
npx vite preview --outDir dist --port 4792 --strictPort > /dev/null 2>&1 &
sleep 5
cp /p/restart-probe.mjs . && OUT=/p/restart-probe.json node restart-probe.mjs; rm -f restart-probe.mjs
