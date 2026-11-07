// After `pnpm build`: every file a public package's published `exports` point
// to exists, and is in its `files`. `pnpm pack` publishes `publishConfig.exports`
// in place of `exports`, so that's the map users resolve. CI runs this after
// the build; @isoloop/vite once shipped index.mjs behind an index.js export.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
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
}
if (problems.length > 0) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log('every published export resolves');
