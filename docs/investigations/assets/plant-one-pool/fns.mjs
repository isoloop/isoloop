/* oxlint-disable typescript/no-unsafe-argument, typescript/no-unsafe-assignment, typescript/no-unsafe-call, typescript/no-unsafe-member-access, typescript/no-unsafe-return, unicorn/no-array-sort -- a throwaway probe over untyped trace and page data (plant-one-pool.md) */
// Per config at 5 kHz: JS self time by function from the V8 sampling profile,
// per thread role, weighted by sample deltas and by sample count.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
const [DIR, CONFIG, RATE = '5khz', FILTER = ''] = process.argv.slice(2);
const runs = readdirSync(DIR)
  .filter((f) => f.startsWith(`${CONFIG}-${RATE}-run`) && f.endsWith('.json'))
  .map((f) => f.slice(0, -5));
const tot = new Map(); // key -> {w, n}
let nruns = 0;
for (const name of runs) {
  nruns++;
  const meta = JSON.parse(readFileSync(join(DIR, `${name}.json`), 'utf8'));
  const rend = meta.untraced.filter((t) => t.type === 'renderer');
  const role = new Map(
    rend.map((t) => [
      t.tid,
      t.tid === t.pid ? 'main' : t.comm.startsWith('DedicatedWorker') ? 'worker' : 'other',
    ]),
  );
  const sec = meta.windowMs / 1000;
  const ev = JSON.parse(gunzipSync(readFileSync(join(DIR, `${name}.profile.json.gz`)))).traceEvents;
  const byId = new Map(); // profile id -> {tid, nodes Map, samples[], deltas[]}
  for (const e of ev) {
    if (e.name !== 'ProfileChunk' && e.name !== 'Profile') continue;
    const id = e.id;
    let p = byId.get(id);
    if (!p) {
      p = { tid: e.tid, nodes: new Map(), samples: [], deltas: [] };
      byId.set(id, p);
    }
    const d = e.args?.data;
    if (!d) continue;
    for (const n of d.cpuProfile?.nodes ?? []) p.nodes.set(n.id, n.callFrame);
    p.samples.push(...(d.cpuProfile?.samples ?? []));
    p.deltas.push(...(d.timeDeltas ?? []));
  }
  for (const p of byId.values()) {
    const r = role.get(p.tid) ?? 'other';
    for (let i = 0; i < p.samples.length; i++) {
      const cf = p.nodes.get(p.samples[i]);
      if (!cf) continue;
      if (/^\((idle|program|garbage collector|root)\)$/.test(cf.functionName)) continue;
      const url = (cf.url || '').split('/').pop().split('?')[0];
      const key = `${r}\t${cf.functionName || '(anon)'}\t${url}:${cf.lineNumber}`;
      if (FILTER && !new RegExp(FILTER).test(key)) continue;
      const w = Math.max(0, p.deltas[i + 1] ?? p.deltas[i] ?? 0) / 1000 / sec; // ms/s
      const t = tot.get(key) ?? { w: 0, n: 0 };
      t.w += w;
      t.n += 1 / sec;
      tot.set(key, t);
    }
  }
}
const rows = [...tot]
  .map(([k, v]) => [k, v.w / nruns, v.n / nruns])
  .sort((a, b) => b[1] - a[1])
  .slice(0, Number(process.env.TOP ?? 25));
for (const [k, w, n] of rows) console.log(`${w.toFixed(1)}\t${n.toFixed(0)}/s\t${k}`);
