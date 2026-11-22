// After `pnpm build`: every file a public package's published `exports` point
// to exists, and is in its `files`. `pnpm pack` publishes `publishConfig.exports`
// in place of `exports`, so that's the map users resolve. CI runs this after
// the build; @isoloop/vite once shipped index.mjs behind an index.js export.
// The `./dist/` paths in `sideEffects` must exist too (ADR 0021, decision 8):
// a stale one would let a bundler drop a script it names. The layout test
// checks the `./src/` ones. The CLI's build copies the repo's skills/ into
// its dist (M4a decision 17), so that copy must be there and the same.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const targets = (v: unknown): string[] =>
  typeof v === 'string'
    ? [v]
    : typeof v === 'object' && v !== null
      ? Object.values(v).flatMap(targets)
      : [];

const field = (o: unknown, k: string): unknown => {
  if (typeof o !== 'object' || o === null) return undefined;
  const v: unknown = Reflect.get(o, k);
  return v;
};

const problems: string[] = [];
for (const d of readdirSync('packages', { withFileTypes: true })) {
  if (!d.isDirectory()) continue;
  const dir = join('packages', d.name);
  const file = join(dir, 'package.json');
  if (!existsSync(file)) continue;
  const manifest: unknown = JSON.parse(readFileSync(file, 'utf8'));
  if (field(manifest, 'private') === true) continue;
  const name = String(field(manifest, 'name'));
  const exportsMap =
    field(field(manifest, 'publishConfig'), 'exports') ?? field(manifest, 'exports');
  const files = targets(field(manifest, 'files'));
  for (const t of targets(exportsMap)) {
    const rel = t.replace(/^\.\//, '');
    if (!existsSync(join(dir, rel))) problems.push(`${name}: ${t} doesn't exist`);
    else if (!files.some((f) => rel === f || rel.startsWith(`${f}/`)))
      problems.push(`${name}: ${t} isn't in "files"`);
  }
  const sideEffects = field(manifest, 'sideEffects');
  for (const s of Array.isArray(sideEffects) ? sideEffects : []) {
    if (typeof s === 'string' && s.startsWith('./dist/') && !existsSync(join(dir, s.slice(2))))
      problems.push(`${name}: sideEffects names ${s}, which the build didn't write`);
  }
}
for (const file of readdirSync('skills', { recursive: true, encoding: 'utf8' })) {
  const source = join('skills', file);
  if (!statSync(source).isFile()) continue;
  const copy = join('packages/cli/dist/skills', file);
  if (!existsSync(copy) || !readFileSync(copy).equals(readFileSync(source)))
    problems.push(`isoloop: ${copy} isn't a copy of ${source}`);
}
if (problems.length > 0) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log('every published export and sideEffects path resolves');
