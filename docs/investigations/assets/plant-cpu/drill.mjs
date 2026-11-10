/* oxlint-disable typescript/no-unsafe-argument, typescript/no-unsafe-assignment, typescript/no-unsafe-call, typescript/no-unsafe-member-access, typescript/no-unsafe-return -- a throwaway probe over untyped trace JSON (plant-cpu.md) */
// Drill-down for plant-cpu.md: messaging events by name and thread role, and
// the JS functions behind chosen buckets, for one config at 5 kHz.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
const [RESULTS, CONFIG] = process.argv.slice(2);
const load = (n, k) =>
  JSON.parse(gunzipSync(readFileSync(join(RESULTS, `${n}.${k}.json.gz`)))).traceEvents;
const runs = readdirSync(RESULTS)
  .filter((f) => f.startsWith(CONFIG + '-5khz-run') && f.endsWith('.json'))
  .map((f) => f.slice(0, -5));
const MSG =
  /SerializedScriptValue|MessagePort|PostMessage|postMessage|mojo|SimpleWatcher|EpollEvent|HandlePostMessage|MessageEvent/;
const agg = new Map();
const fns = new Map();
for (const name of runs) {
  const meta = JSON.parse(readFileSync(join(RESULTS, `${name}.json`), 'utf8'));
  const sec = meta.windowMs / 1000;
  const rend = meta.untraced.filter((t) => t.type === 'renderer');
  const pids = new Set(rend.map((t) => t.pid));
  const role = new Map(
    rend.map((t) => [
      t.tid,
      t.tid === t.pid ? 'main' : t.comm.startsWith('DedicatedWorker') ? 'worker' : 'other',
    ]),
  );
  const ev = load(name, 'events').filter(
    (e) => e.ph === 'X' && pids.has(e.pid) && e.tdur !== undefined,
  );
  const byTid = new Map();
  for (const e of ev) {
    if (!byTid.has(e.tid)) byTid.set(e.tid, []);
    byTid.get(e.tid).push(e);
  }
  for (const [tid, list] of byTid) {
    list.sort((a, b) => a.ts - b.ts || b.dur - a.dur);
    const stack = [];
    const child = new Map();
    for (const e of list) {
      while (stack.length && stack.at(-1).ts + stack.at(-1).dur <= e.ts) stack.pop();
      const p = stack.at(-1);
      if (p) child.set(p, (child.get(p) ?? 0) + e.tdur);
      stack.push(e);
    }
    for (const e of list) {
      if (!MSG.test(e.name)) continue;
      const k = `${role.get(tid) ?? 'other'} | ${e.name}`;
      agg.set(
        k,
        (agg.get(k) ?? 0) + Math.max(0, e.tdur - (child.get(e) ?? 0)) / 1000 / sec / runs.length,
      );
    }
  }
  // JS functions in the profile, per thread role, for app/host/runtime/bus files.
  const pe = load(name, 'profile');
  const prof = new Map();
  for (const e of pe)
    if (e.name === 'Profile' && pids.has(e.pid))
      prof.set(`${e.pid}:${e.id}`, { tid: e.tid, nodes: new Map(), self: new Map() });
  for (const e of pe) {
    if (e.name !== 'ProfileChunk') continue;
    const p = prof.get(`${e.pid}:${e.id}`);
    if (!p) continue;
    const d = e.args.data;
    for (const n of d.cpuProfile?.nodes ?? []) p.nodes.set(n.id, n);
    const s = d.cpuProfile?.samples ?? [],
      td = d.timeDeltas ?? [];
    for (let i = 0; i < s.length; i++)
      p.self.set(s[i], (p.self.get(s[i]) ?? 0) + Math.max(0, td[i + 1] ?? td[i] ?? 0));
  }
  for (const p of prof.values())
    for (const [id, us] of p.self) {
      const cf = p.nodes.get(id)?.callFrame;
      if (!cf || !cf.url) continue;
      const file = cf.url
        .split('/')
        .pop()
        .replace(/-[A-Za-z0-9_]{8}\.js$/, '');
      const k = `${role.get(p.tid) ?? 'other'} | ${file} | ${cf.functionName || '(anonymous)'}:${cf.lineNumber}`;
      fns.set(k, (fns.get(k) ?? 0) + us / 1000 / sec / runs.length);
    }
}
console.log(
  `== ${CONFIG}, 5 kHz, ${runs.length} runs: messaging events, self thread time ms/s (traced)`,
);
for (const [k, v] of [...agg].toSorted((a, b) => b[1] - a[1]).slice(0, 16))
  console.log(v.toFixed(1).padStart(7), k);
console.log(`== top JS functions, sampled wall ms/s (profile trace)`);
for (const [k, v] of [...fns]
  .filter(([key]) => !process.env.ROLE || key.startsWith(process.env.ROLE + ' '))
  .toSorted((a, b) => b[1] - a[1])
  .slice(0, 40))
  console.log(v.toFixed(1).padStart(7), k);
