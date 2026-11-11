Throwaway probes for [plant-one-pool.md](../../plant-one-pool.md), run on the benchmark server (4 physical cores fixed at 2.0 GHz, Playwright's image `v1.64.1-noble`).

- `freeze-bench.ts` (bundled with esbuild from `apps/dashboards/plant` in isoloop/examples) and `freeze-run.mjs`: the plant's feed and engine code for eight machines driven flat out in one worker, with or without the pool's frozen built-ins, and with parts of the freeze switched on one at a time. `freeze-variant.ts` is `packages/runtime/src/freeze.ts` with two switches added.
- `keys-bench.ts`: the same work with one `Array.prototype` property at a time turned into an accessor, as `tameOverrides` does.
- `restart-probe.mjs` and `restart-run.sh`: the `one` pool's restart after the 3 s block, after holds of 20 s to 10 min, with kernel events, retained records per topic and when each machine's spectra resume.
- `fns.mjs`: JS self time by function from the earlier CPU profiles' V8 samples (`plant-cpu.md`).
- `results/`: the outputs.
