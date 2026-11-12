# Paired medians and ranges for the ADR 0016 decision 1 measurement (plant-cpu.md). Run from this folder.
import json,statistics as st,sys
B=json.load(open('base-buckets.json')); A=json.load(open('adr16-buckets.json'))
M=json.load(open('msgs.json'))
runs={}
for r in B+A:
    if r['name'] in runs: continue
    runs[r['name']]=r
def variant(name):
    for p in ('isobase','isoc250','isoloop','native-workers','native'):
        if name.startswith(p): return p
MSGB=lambda r:sum(v for k,v in r['buckets'].items() if k.startswith('messaging'))
JSB=lambda r:sum(v for k,v in r['buckets'].items() if k.startswith('bus:') or k in('runtime: bus client','host: bus controller','protocol guards'))
def placement(name):
    for p in ('matched','one'):
        if f'-{p}-' in name: return p
    return None
groups={}
for n,r in runs.items():
    v=variant(n); pl=placement(n); rate=r['rate']
    key=(v,pl,rate)
    acc=M.get(n,{}).get('perS',{}).get('MessagePort::Accept',0)
    groups.setdefault(key,[]).append(dict(ren=r['rendererMsPerS'],msg=MSGB(r),js=JSB(r),acc=acc,gpu=r['gpuMsPerS']))
def fmt(xs,k):
    vals=[x[k] for x in xs]; return st.median(vals),min(vals),max(vals)
for rate in (5,1):
  for pl,nat in (('matched','native-workers'),('one','native')):
    N=groups[(nat,None,rate)]
    print(f"\n== {pl} vs {nat}, {rate} kHz (runs: base {len(groups[('isobase',pl,rate)])})")
    print(f"{'':10} {'renderer':>18} {'gap':>6} {'msg(browser)':>18} {'msg(isoloop js)':>18} {'port msgs/s':>18} {'gpu':>6}")
    nr=fmt(N,'ren')[0]
    print(f"{nat:10} {fmt(N,'ren')[0]:7.0f} [{fmt(N,'ren')[1]:.0f}-{fmt(N,'ren')[2]:.0f}] {'':6} {fmt(N,'msg')[0]:7.0f} {'':10} {fmt(N,'js')[0]:7.0f} {'':10} {fmt(N,'acc')[0]:7.0f} {'':10} {fmt(N,'gpu')[0]:6.0f}")
    for v in ('isobase','isoloop','isoc250'):
      G=groups[(v,pl,rate)]
      r=fmt(G,'ren');m=fmt(G,'msg');j=fmt(G,'js');a=fmt(G,'acc')
      print(f"{v:10} {r[0]:7.0f} [{r[1]:.0f}-{r[2]:.0f}] {r[0]-nr:+6.0f} {m[0]:7.0f} [{m[1]:.0f}-{m[2]:.0f}] {j[0]:7.0f} [{j[1]:.0f}-{j[2]:.0f}] {a[0]:7.0f} [{a[1]:.0f}-{a[2]:.0f}] {fmt(G,'gpu')[0]:6.0f}")
