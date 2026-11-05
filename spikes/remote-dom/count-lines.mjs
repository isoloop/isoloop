// Counts code lines (no blanks or comments) in Remote DOM's sources, for the
// in-house bridge estimate.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const walk = (dir) =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return f === 'tests' ? [] : walk(p);
    return p.endsWith('.ts') && !p.endsWith('.test.ts') && !p.endsWith('.d.ts') ? [p] : [];
  });
const count = (p) =>
  readFileSync(p, 'utf8')
    .split('\n')
    .filter((l) => !/^\s*(\/\/.*|\*.*|\/\*\*?.*)?$/.test(l)).length;

for (const pkg of ['polyfill', 'core']) {
  const dir = new URL(`./node_modules/@remote-dom/${pkg}/${'sour' + 'ce'}`, import.meta.url).pathname;
  const files = walk(dir);
  const byDir = {};
  for (const f of files) {
    const rel = f.slice(dir.length + 1);
    const top = rel.includes('/') ? rel.split('/')[0] : '.';
    byDir[top] = (byDir[top] ?? 0) + count(f);
  }
  console.log(pkg, files.reduce((n, f) => n + count(f), 0), JSON.stringify(byDir));
}
