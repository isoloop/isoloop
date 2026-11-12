/* oxlint-disable typescript/no-unsafe-argument, typescript/no-unsafe-assignment, typescript/no-unsafe-call, typescript/no-unsafe-member-access, typescript/no-unsafe-return -- a throwaway probe over untyped trace JSON (plant-cpu.md) */
// Splits each thread's CPU from probe.mjs into buckets (plant-cpu.md).
//
//   node analyze.mjs <results dir> <plant dist dir> <node_modules/.pnpm dir>
//
// Per run and renderer thread:
// - The events trace gives each trace event's self thread time (its tdur
//   minus its children's). Native work is bucketed by event name (canvas
//   raster, messaging, style/layout/paint, GC, ...).
// - Self time in events that run JS (FunctionCall, RunMicrotasks, ...) is
//   split by the profile trace's V8 samples on that thread, mapped to a
//   source module through the bundle's region markers and, for Isoloop's
//   libraries, their own dist files.
// - The split is scaled to the thread's CPU in the untraced window (/proc),
//   so tracing's cost doesn't count; CPU the events don't cover is reported
//   as such.
// Writes buckets.json, buckets-summary.json and buckets.md.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';

const [RESULTS, DIST, PNPM] = process.argv.slice(2);
const VERSION = process.env.ISOLOOP_VERSION ?? '0.0.0-next.61245db';

// --- Source mapping -------------------------------------------------------

const MARKER = /^\/\/ (\S+)$/;

/** For a file with `// path` region markers: each line's region. */
function regions(text) {
  const lines = text.split('\n');
  const out = Array.from({ length: lines.length });
  let cur = '';
  for (let i = 0; i < lines.length; i++) {
    const m = MARKER.exec(lines[i]);
    if (m) cur = m[1];
    out[i] = cur;
  }
  return { lines, regions: out };
}

/** Library dist files of this version, by package-relative path, with a text → inner region index. */
const libs = new Map();
function lib(pkgFile) {
  if (libs.has(pkgFile)) return libs.get(pkgFile);
  // pkgFile like '@isoloop/runtime/dist/worker.js'
  const [scope, name, ...rest] = pkgFile.split('/');
  const dirs = readdirSync(PNPM).filter((d) => d.startsWith(`${scope}+${name}@${VERSION}`));
  let entry = null;
  for (const d of dirs) {
    try {
      const text = readFileSync(join(PNPM, d, 'node_modules', scope, name, ...rest), 'utf8');
      const r = regions(text);
      const index = new Map();
      for (let i = 0; i < r.lines.length; i++) {
        const t = r.lines[i].trim();
        if (!t || MARKER.test(r.lines[i])) continue;
        const prev = index.get(t);
        index.set(t, prev === undefined ? r.regions[i] : prev === r.regions[i] ? prev : null);
      }
      entry = { index };
      break;
    } catch {
      // Not in this directory.
    }
  }
  libs.set(pkgFile, entry);
  return entry;
}

const chunks = new Map();
function chunk(url) {
  if (chunks.has(url)) return chunks.get(url);
  const m = /\/(isoloop|isobatch|native|native-workers)\/(assets\/.+\.js)$/.exec(url);
  let c = null;
  if (m) {
    try {
      c = regions(readFileSync(join(DIST, m[1], m[2]), 'utf8'));
    } catch {
      c = null;
    }
  }
  chunks.set(url, c);
  return c;
}

const PKG = /.*node_modules\/((?:@[^/]+\/)?[^/]+)\/(.+)$/;
const lineCache = new Map();
/** 'pkg:inner' for library code, 'app:src/...' for app code, or the chunk name. */
function moduleOf(url, line) {
  const key = `${url}:${line}`;
  if (lineCache.has(key)) return lineCache.get(key);
  let out = `chunk:${url.split('/').pop()}`;
  const c = chunk(url);
  if (c) {
    const outer = c.regions[line] ?? '';
    const pm = PKG.exec(outer);
    if (pm) {
      const [, pkg, file] = pm;
      out = pkg;
      const l = pkg.startsWith('@isoloop/') ? lib(`${pkg}/${file}`) : null;
      if (l) {
        for (let i = line; i >= 0 && i > line - 400; i--) {
          const inner = l.index.get(c.lines[i]?.trim());
          if (inner) {
            out = `${pkg}:${inner}`;
            break;
          }
        }
      }
    } else if (outer) out = `app:${outer}`;
  }
  lineCache.set(key, out);
  return out;
}

// --- Buckets --------------------------------------------------------------

/** JS by source module (from the V8 samples), within the time trace events spend running JS. */
function jsBucket(fn, url, line) {
  if (!url) {
    if (fn === 'postMessage') return 'messaging: postMessage (serialize)';
    return 'JS: browser API calls';
  }
  const mod = moduleOf(url, line);
  if (mod.startsWith('zod') || mod.includes('standard-schema')) return 'bus: schema validation';
  if (mod.startsWith('@isoloop/codec') || mod.includes('codec/dist')) return 'codec';
  if (mod.startsWith('@isoloop/bus'))
    return mod.includes('protocol') ? 'protocol guards' : 'bus: broker';
  if (mod.startsWith('@isoloop/runtime')) {
    if (mod.includes('../dom/')) return 'worker DOM and recorder';
    if (mod.includes('protocol')) return 'protocol guards';
    if (mod.includes('bus-client')) return 'runtime: bus client';
    return 'runtime: other';
  }
  if (mod.startsWith('@isoloop/dom')) return 'host: patch apply';
  if (mod.startsWith('@isoloop/host')) {
    if (mod.includes('../dom/') || /composit|applier|surface/.test(mod)) return 'host: patch apply';
    if (mod.includes('protocol')) return 'protocol guards';
    if (mod.includes('bus')) return 'host: bus controller';
    return 'host: other';
  }
  if (mod.startsWith('@isoloop/protocol')) return 'protocol guards';
  if (mod.startsWith('@isoloop/react') || /^(react|react-dom|scheduler)$/.test(mod)) return 'React';
  if (mod.startsWith('app:')) {
    const p = mod.slice(4);
    if (/src\/charts\//.test(p)) return 'app: canvas drawing (JS)';
    if (
      /src\/core\/(analysis|sensors|engines|store|retention)|isolates\/(feed|engine|headless)|native\/.*worker/.test(
        p,
      )
    )
      return 'app: feeds and engines';
    if (/src\/(metrics|responsive)|timing-batch|withStress/.test(p)) return 'app: metrics panels';
    return 'app: widgets and page';
  }
  return `JS: other (${mod})`;
}

/** Trace events whose self time is JS running (split by the samples). */
const JS_EVENTS = new Set([
  'FunctionCall',
  'v8.callFunction',
  'RunMicrotasks',
  'TimerFire',
  'FireAnimationFrame',
  'FrameRequestCallbackCollection::ExecuteFrameCallbacks',
  'AsyncTask Run',
  'EventDispatch',
  'V8.Execute',
  'v8.run',
  'v8.compile',
  'EvaluateScript',
  'v8.evaluateModule',
]);

/** Native work, by trace event name. */
function nativeBucket(name, comm) {
  if (
    /^void SkCanvas::|^Sk[A-Z]|Canvas2D|CanvasResource|OffscreenCanvas|ClientSharedImage|SharedImage|GpuChannel|RasterBuffer|Playback|ZeroCopy|RasterTask|Rasterizer|RasterSource|ImageDecode/.test(
      name,
    )
  )
    return 'canvas and tiles: raster and present';
  if (
    /SerializedScriptValue|MessagePort|PostMessage|postMessage|mojo|SimpleWatcher|EpollEvent|HandlePostMessage|MessageEvent/.test(
      name,
    )
  )
    return 'messaging: serialize, deserialize, IPC';
  if (/GC|Scavenge|Sweep|Mark|Heap|Atomic|ObservablePause|Finalize|Compact|Evacuat/.test(name))
    return 'GC';
  if (/WorkerAnimationFrameProvider|BeginFrameProvider/.test(name))
    return 'animation frames in workers';
  if (
    /Paint|Layout|Style|Layerize|Commit|Lifecycle|BeginMainFrame|Compositing|HitTest|UpdateLayer|Animat|Scheduled|Draw|Display|Renderer|Surface|BeginFrame|Graphics\.Pipeline|FrameViewer|TileManager|Proxy|Scheduler|LayerTree|Frame|cc::|viz/.test(
      name,
    )
  )
    return comm.startsWith('Compositor') ? 'compositor thread' : 'style, layout, paint, commit';
  return 'tasks and scheduling (other native)';
}

// --- Trace helpers --------------------------------------------------------

function load(name, kind) {
  const t = JSON.parse(gunzipSync(readFileSync(join(RESULTS, `${name}.${kind}.json.gz`))));
  return t.traceEvents ?? t;
}

/** Self thread time (tdur minus children's tdur) per event name, per tid, in µs. */
function selfTimes(events, pids) {
  const byTid = new Map();
  for (const e of events) {
    if (e.ph !== 'X' || !pids.has(e.pid) || e.tdur === undefined || e.dur === undefined) continue;
    if (!byTid.has(e.tid)) byTid.set(e.tid, []);
    byTid.get(e.tid).push(e);
  }
  const out = new Map();
  for (const [tid, list] of byTid) {
    list.sort((a, b) => a.ts - b.ts || b.dur - a.dur);
    const stack = [];
    const child = new Map();
    for (const e of list) {
      while (stack.length && stack.at(-1).ts + stack.at(-1).dur <= e.ts) stack.pop();
      const parent = stack.at(-1);
      if (parent) child.set(parent, (child.get(parent) ?? 0) + e.tdur);
      stack.push(e);
    }
    const self = new Map();
    for (const e of list)
      self.set(e.name, (self.get(e.name) ?? 0) + Math.max(0, e.tdur - (child.get(e) ?? 0)));
    out.set(tid, self);
  }
  return out;
}

/** JS self time per bucket per tid from the profile trace, in µs (idle, (program) and GC left out). */
function jsShares(events, pids) {
  const profiles = new Map();
  for (const e of events) {
    if (e.name === 'Profile' && pids.has(e.pid))
      profiles.set(`${e.pid}:${e.id}`, { tid: e.tid, nodes: new Map(), self: new Map() });
  }
  for (const e of events) {
    if (e.name !== 'ProfileChunk') continue;
    const p = profiles.get(`${e.pid}:${e.id}`);
    if (!p) continue;
    const d = e.args.data;
    for (const n of d.cpuProfile?.nodes ?? []) p.nodes.set(n.id, n);
    const samples = d.cpuProfile?.samples ?? [];
    const deltas = d.timeDeltas ?? [];
    for (let i = 0; i < samples.length; i++) {
      p.self.set(
        samples[i],
        (p.self.get(samples[i]) ?? 0) + Math.max(0, deltas[i + 1] ?? deltas[i] ?? 0),
      );
    }
  }
  const out = new Map();
  for (const p of profiles.values()) {
    const per = out.get(p.tid) ?? new Map();
    for (const [id, us] of p.self) {
      const cf = p.nodes.get(id)?.callFrame;
      if (!cf || /^\((idle|program|garbage collector|root)\)$/.test(cf.functionName)) continue;
      const b = jsBucket(cf.functionName, cf.url, cf.lineNumber ?? 0);
      per.set(b, (per.get(b) ?? 0) + us);
    }
    out.set(p.tid, per);
  }
  return out;
}

// --- Per run --------------------------------------------------------------

function analyze(name) {
  const meta = JSON.parse(readFileSync(join(RESULTS, `${name}.json`), 'utf8'));
  const seconds = meta.windowMs / 1000;
  const renderer = meta.untraced.filter((t) => t.type === 'renderer');
  const pids = new Set(renderer.map((t) => t.pid));
  const self = selfTimes(load(name, 'events'), pids);
  const js = jsShares(load(name, 'profile'), pids);
  const tracedCpu = new Map(
    meta.traced.events.filter((t) => t.type === 'renderer').map((t) => [t.tid, t.msPerS]),
  );

  const out = {
    name,
    config: meta.config,
    rate: meta.rate,
    round: meta.round,
    threads: [],
    buckets: {},
  };
  for (const t of renderer) {
    const role =
      t.tid === t.pid ? 'main' : t.comm.startsWith('DedicatedWorker') ? 'worker' : t.comm;
    const ev = self.get(t.tid) ?? new Map();
    const buckets = new Map();
    let jsUs = 0;
    for (const [n, us] of ev) {
      if (/^CpuProfiler|^TracingController|UpdateCounters/.test(n)) continue;
      if (JS_EVENTS.has(n)) {
        jsUs += us;
        continue;
      }
      const b = nativeBucket(n, t.comm);
      buckets.set(b, (buckets.get(b) ?? 0) + us);
    }
    const jsPer = js.get(t.tid);
    const jsTotal = jsPer ? [...jsPer.values()].reduce((a, b) => a + b, 0) : 0;
    if (jsUs > 0) {
      if (jsTotal > 0)
        for (const [b, us] of jsPer) buckets.set(b, (buckets.get(b) ?? 0) + (jsUs * us) / jsTotal);
      else buckets.set('JS: unsampled', jsUs);
    }
    // Scale the traced split to the untraced CPU; what the events don't cover is "outside trace events".
    const traced = tracedCpu.get(t.tid) ?? 0;
    const covered = [...buckets.values()].reduce((a, b) => a + b, 0) / 1000 / seconds;
    const factor = traced > 0 ? t.msPerS / traced : 0;
    const shares = {};
    for (const [b, us] of buckets) shares[b] = (us / 1000 / seconds) * factor;
    const rest = Math.max(0, t.msPerS - covered * factor);
    if (rest > 0)
      shares[
        role === 'main' || role === 'worker'
          ? 'not covered by trace events (JS threads)'
          : 'not covered by trace events (other threads)'
      ] = rest;
    for (const [b, ms] of Object.entries(shares)) out.buckets[b] = (out.buckets[b] ?? 0) + ms;
    out.threads.push({
      tid: t.tid,
      comm: t.comm,
      role,
      msPerS: t.msPerS,
      sysMsPerS: t.sysMsPerS ?? 0,
      tracedMsPerS: traced,
      coverage: traced ? covered / traced : 0,
      shares,
    });
  }
  out.rendererMsPerS = renderer.reduce((s, t) => s + t.msPerS, 0);
  out.kernelMsPerS = renderer.reduce((s, t) => s + (t.sysMsPerS ?? 0), 0);
  out.workerKernelMsPerS = renderer
    .filter((t) => t.comm.startsWith('DedicatedWorker'))
    .reduce((s, t) => s + (t.sysMsPerS ?? 0), 0);
  out.gpuMsPerS = meta.processMsPerS.GPU ?? 0;
  out.browserMsPerS = meta.processMsPerS.browser ?? 0;
  return out;
}

// --- Summary --------------------------------------------------------------

const roleOf = (t) => (t.role === 'main' || t.role === 'worker' ? t.role : 'other threads');
const median = (xs) => {
  const s = xs.toSorted((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};
const names = readdirSync(RESULTS)
  .filter((f) => /^(native|isoloop|isobatch).*-run\d+\.json$/.test(f))
  .map((f) => f.slice(0, -5));
const runs = names.map(analyze);
writeFileSync(join(RESULTS, 'buckets.json'), `${JSON.stringify(runs, null, 1)}\n`);

const groups = new Map();
for (const r of runs) {
  const k = `${r.config}@${r.rate}`;
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push(r);
}
const summary = {};
for (const [k, rs] of groups) {
  const keys = new Set(rs.flatMap((r) => Object.keys(r.buckets)));
  const buckets = {};
  for (const x of keys) buckets[x] = median(rs.map((r) => r.buckets[x] ?? 0));
  const roles = {};
  for (const role of ['main', 'worker', 'other threads']) {
    roles[role] = median(
      rs.map((r) => r.threads.filter((t) => roleOf(t) === role).reduce((s, t) => s + t.msPerS, 0)),
    );
  }
  summary[k] = {
    runs: rs.length,
    renderer: median(rs.map((r) => r.rendererMsPerS)),
    kernel: median(rs.map((r) => r.kernelMsPerS)),
    workerKernel: median(rs.map((r) => r.workerKernelMsPerS)),
    gpu: median(rs.map((r) => r.gpuMsPerS)),
    browser: median(rs.map((r) => r.browserMsPerS)),
    workers: median(rs.map((r) => r.threads.filter((t) => t.role === 'worker').length)),
    coverage: median(
      rs.flatMap((r) => r.threads.filter((t) => t.msPerS > 20).map((t) => t.coverage)),
    ),
    roles,
    buckets,
  };
}
writeFileSync(join(RESULTS, 'buckets-summary.json'), `${JSON.stringify(summary, null, 1)}\n`);

const f0 = (x) => x.toFixed(0);
const f1 = (x) => x.toFixed(1);
const PAIRS = (process.env.PAIRS ?? 'native-workers=isoloop:matched,native=isoloop:one')
  .split(',')
  .map((p) => p.split('='));
const md = [];
for (const rate of [...new Set(runs.map((r) => r.rate))].toSorted((a, b) => b - a)) {
  for (const [a, b] of PAIRS) {
    const A = summary[`${a}@${rate}`];
    const B = summary[`${b}@${rate}`];
    if (!A || !B) continue;
    const gap = B.renderer - A.renderer;
    md.push(`\n### ${a} (A) vs ${b} (B), ${rate} kHz, ${A.runs}/${B.runs} runs\n`);
    md.push(
      `Renderer CPU: A ${f0(A.renderer)} ms/s, B ${f0(B.renderer)} ms/s, gap ${gap >= 0 ? '+' : ''}${f0(gap)} ms/s. Main thread A ${f0(A.roles.main)}, B ${f0(B.roles.main)}; workers A ${f0(A.roles.worker)} (${A.workers}), B ${f0(B.roles.worker)} (${B.workers}); other renderer threads A ${f0(A.roles['other threads'])}, B ${f0(B.roles['other threads'])}. Kernel time within it A ${f0(A.kernel)}, B ${f0(B.kernel)} (on worker threads A ${f0(A.workerKernel)}, B ${f0(B.workerKernel)}). GPU process A ${f0(A.gpu)}, B ${f0(B.gpu)}; browser process A ${f0(A.browser)}, B ${f0(B.browser)}. Trace-event coverage of busy threads: A ${(A.coverage * 100).toFixed(0)}%, B ${(B.coverage * 100).toFixed(0)}%.\n`,
    );
    md.push('| Bucket | A ms/s | B ms/s | B − A | Share of gap |');
    md.push('| --- | --- | --- | --- | --- |');
    const keys = new Set([...Object.keys(A.buckets), ...Object.keys(B.buckets)]);
    const rows = [...keys]
      .map((k) => [k, A.buckets[k] ?? 0, B.buckets[k] ?? 0])
      .map(([k, x, y]) => [k, x, y, y - x]);
    rows.sort((p, q) => q[3] - p[3]);
    for (const [k, x, y, d] of rows) {
      if (Math.abs(d) < 0.5 && x < 2 && y < 2) continue;
      md.push(
        `| ${k} | ${f1(x)} | ${f1(y)} | ${d >= 0 ? '+' : ''}${f1(d)} | ${gap ? `${((d / gap) * 100).toFixed(0)}%` : '–'} |`,
      );
    }
  }
}
writeFileSync(join(RESULTS, 'buckets.md'), `${md.join('\n')}\n`);
console.log(md.join('\n'));
