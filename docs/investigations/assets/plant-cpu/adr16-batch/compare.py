# Paired medians and ranges for the ADR 0016 decision 3 measurement (plant-cpu.md). Run from this folder.
# isoloop = combined commits at 100 ms, batching off; isobatch = the same libraries with bus.batch on.
import json, statistics as st
R = json.load(open('buckets.json'))
M = json.load(open('msgs.json'))
runs = {}
for r in R:
    runs.setdefault(r['name'], r)
def variant(n):
    for p in ('isobatch', 'isoloop', 'native-workers', 'native'):
        if n.startswith(p): return p
def placement(n):
    for p in ('matched', 'one'):
        if f'-{p}-' in n: return p
MSGB = lambda r: sum(v for k, v in r['buckets'].items() if k.startswith('messaging'))
JSB = lambda r: sum(v for k, v in r['buckets'].items() if k.startswith('bus:') or k in ('runtime: bus client', 'host: bus controller', 'protocol guards'))
g = {}
for n, r in runs.items():
    acc = M.get(n, {}).get('perS', {})
    g.setdefault((variant(n), placement(n), r['rate']), []).append(dict(
        ren=r['rendererMsPerS'], msg=MSGB(r), js=JSB(r), gpu=r['gpuMsPerS'],
        acc=acc.get('MessagePort::Accept', 0), ser=acc.get('SerializedScriptValueFactory::create', 0)))
def f(xs, k):
    v = [x[k] for x in xs]; return st.median(v), min(v), max(v)
for rate in (5, 1):
    for pl, nat in (('matched', 'native-workers'), ('one', 'native')):
        N = g[(nat, None, rate)]
        print(f"\n== {pl} vs {nat}, {rate} kHz (runs {len(g[('isoloop', pl, rate)])}/{len(g[('isobatch', pl, rate)])})")
        print(f"{'':9} {'renderer':>20} {'gap':>6} {'msg browser':>16} {'isoloop js':>14} {'port msgs/s':>20} {'serialize/s':>11} {'gpu':>5}")
        nr = f(N, 'ren')[0]
        print(f"{nat:9} {nr:7.0f} [{f(N,'ren')[1]:.0f}-{f(N,'ren')[2]:.0f}] {'':6} {f(N,'msg')[0]:7.0f} {'':8} {f(N,'js')[0]:6.0f} {'':7} {f(N,'acc')[0]:7.0f} {'':12} {f(N,'ser')[0]:7.0f} {f(N,'gpu')[0]:5.0f}")
        for v in ('isoloop', 'isobatch'):
            G = g[(v, pl, rate)]
            r, m, j, a, s = (f(G, k) for k in ('ren', 'msg', 'js', 'acc', 'ser'))
            print(f"{v:9} {r[0]:7.0f} [{r[1]:.0f}-{r[2]:.0f}] {r[0]-nr:+6.0f} {m[0]:5.0f} [{m[1]:.0f}-{m[2]:.0f}] {j[0]:4.0f} [{j[1]:.0f}-{j[2]:.0f}] {a[0]:6.0f} [{a[1]:.0f}-{a[2]:.0f}] {s[0]:7.0f} {f(G,'gpu')[0]:5.0f}")
