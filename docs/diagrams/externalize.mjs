// Moves the inline <script> and <style> blocks of each rendered diagram into
// shared files next to it, so the pages run under `script-src 'self'` and
// `style-src 'self'` (the hosting guide's policy) and the seven pages share
// one copy of the viewer. JSON data blocks (`type="application/json"`) stay
// inline: a CSP doesn't apply to them. Archify renders the same viewer code
// and styles into every page, so the files are named by content hash.
//
// Run after re-rendering (README.md): node docs/diagrams/externalize.mjs
// Same approach as isoloop/examples apps/dashboards/plant/architecture/externalize.mjs.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const SCRIPT = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/g;
const STYLE = /<style(\s[^>]*)?>([\s\S]*?)<\/style>/g;
const hash = (body) => createHash('sha256').update(body).digest('hex').slice(0, 10);

const used = new Set();
for (const name of readdirSync(dir).filter((f) => f.endsWith('.html'))) {
  const path = join(dir, name);
  let html = readFileSync(path, 'utf8');
  let moved = 0;
  html = html.replace(SCRIPT, (whole, attrs = '', body) => {
    if (/\btype=/.test(attrs) || /\bsrc=/.test(attrs) || body.trim() === '') return whole;
    const file = `viewer-${hash(body)}.js`;
    writeFileSync(join(dir, file), body);
    moved++;
    return `<script src="./${file}"></script>`;
  });
  html = html.replace(STYLE, (_whole, _attrs, body) => {
    const file = `viewer-${hash(body)}.css`;
    writeFileSync(join(dir, file), body);
    moved++;
    return `<link rel="stylesheet" href="./${file}">`;
  });
  for (const m of html.matchAll(/(?:src|href)="\.\/(viewer-[0-9a-f]{10}\.(?:js|css))"/g))
    used.add(m[1]);
  writeFileSync(path, html);
  console.log(`${name}: ${moved} block(s) moved`);
}

// Drop viewer files no page references any more (after a re-render).
for (const f of readdirSync(dir).filter((f) => /^viewer-[0-9a-f]{10}\.(js|css)$/.test(f))) {
  if (!used.has(f)) {
    unlinkSync(join(dir, f));
    console.log(`${f}: unused, deleted`);
  }
}
