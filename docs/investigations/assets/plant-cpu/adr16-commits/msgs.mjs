/* oxlint-disable typescript/no-unsafe-argument, typescript/no-unsafe-assignment, typescript/no-unsafe-call, typescript/no-unsafe-member-access, typescript/no-unsafe-return -- a throwaway probe over untyped trace JSON (plant-cpu.md) */
// Messaging trace events per second per run (ADR 0016 decision 1 measurement):
// how many port messages the renderer handles, by event name.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';

const [RESULTS] = process.argv.slice(2);
const MSG =
  /MessagePort|PostMessage|postMessage|MessageEvent|SimpleWatcher|mojo|SerializedScriptValue/;
const out = {};
for (const f of readdirSync(RESULTS).filter((x) => /-run\d+\.events\.json\.gz$/.test(x))) {
  const name = f.replace('.events.json.gz', '');
  const meta = JSON.parse(readFileSync(join(RESULTS, `${name}.json`), 'utf8'));
  const pids = new Set(meta.untraced.filter((t) => t.type === 'renderer').map((t) => t.pid));
  const t = JSON.parse(gunzipSync(readFileSync(join(RESULTS, f))));
  const events = t.traceEvents ?? t;
  const counts = {};
  let first = Infinity;
  let last = -Infinity;
  for (const e of events) {
    if (!pids.has(e.pid) || (e.ph !== 'X' && e.ph !== 'B')) continue;
    first = Math.min(first, e.ts);
    last = Math.max(last, e.ts);
    if (MSG.test(e.name)) counts[e.name] = (counts[e.name] ?? 0) + 1;
  }
  const seconds = (last - first) / 1e6;
  const perS = Object.fromEntries(
    Object.entries(counts)
      .map(([k, v]) => [k, Math.round(v / seconds)])
      .toSorted((a, b) => b[1] - a[1]),
  );
  out[name] = { seconds: Math.round(seconds * 10) / 10, perS };
}
writeFileSync(join(RESULTS, 'msgs.json'), `${JSON.stringify(out, null, 1)}\n`);
console.log(JSON.stringify(out, null, 1));
