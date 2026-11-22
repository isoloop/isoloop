// Moves the inline <script> and <style> blocks of each rendered diagram into
// shared files next to it, so the pages run under `script-src 'self'` and
// `style-src 'self'` (stricter than the hosting guide's policy for a page with
// surfaces, which also needs `'unsafe-inline'`) and the seven pages share
// one copy of the viewer. JSON data blocks (`type="application/json"`) stay
// inline: a CSP doesn't apply to them. Archify renders the same viewer code
// and styles into every page, so the files are named by content hash.
//
// A <style> inside an <svg> (archify puts one in its architecture diagrams)
// can't become a <link> in place: in SVG, <link> isn't a void element, so the
// parser makes it the parent of everything after it, and none of that is
// drawn. Those stylesheets go to the <head> instead, which also repairs pages
// externalized before this rule.
//
// Run after re-rendering (README.md): node docs/diagrams/externalize.mjs
// Same approach as isoloop/web apps/dashboards/plant/architecture/externalize.mjs.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/g;
const STYLE = /<style(\s[^>]*)?>([\s\S]*?)<\/style>/g;
const SVG = /<svg[\s>][\s\S]*?<\/svg>/g;
const VIEWER_LINK = /<link rel="stylesheet" href="\.\/viewer-[0-9a-f]{10}\.css">/g;
const hash = (body) => createHash('sha256').update(body).digest('hex').slice(0, 10);

/** Moves every viewer stylesheet link found inside an <svg> into the <head>. */
export function hoistSvgLinks(html) {
  const hoisted = [];
  const out = html.replace(SVG, (svg) =>
    svg.replace(VIEWER_LINK, (link) => {
      hoisted.push(link);
      return '';
    }),
  );
  const head = out.slice(0, out.indexOf('</head>'));
  const missing = [...new Set(hoisted)].filter((link) => !head.includes(link));
  if (missing.length === 0) return out;
  return out.replace('</head>', `${missing.map((link) => `  ${link}\n`).join('')}</head>`);
}

/** Externalizes every page in `dir` and deletes viewer files no page uses. */
function externalize(dir) {
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
    html = hoistSvgLinks(html);
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
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  externalize(dirname(fileURLToPath(import.meta.url)));
}
