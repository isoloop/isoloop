// Runs worker.js in Node with postMessage stubbed, to surface load/runtime errors.
const out = [];
globalThis.postMessage = (m) => out.push(m);
await import('./worker.js');
globalThis.onmessage({ data: { t: 'step', name: 'build' } });
await new Promise((r) => setTimeout(r, 10));
console.log(JSON.stringify(out, null, 1).slice(0, 3000));
