// The literal ban (ADR 0026, amended 2026-11-28): outside the token files, the
// page's sources may not write a colour, a font size, a font family or a
// spacing value; they use tokens. rules:check runs it on scripts/rules/board/.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { Problem } from './registry.ts';

/** The one allowlist: paths under the board folder where literals live. */
export const LITERAL_ALLOW: readonly string[] = ['ds/tokens.css', 'ds/themes/'];

const BANNED: { what: string; re: RegExp }[] = [
  { what: 'a hex colour', re: /(?<![&\w])#[0-9a-fA-F]{3,8}\b/ },
  { what: 'a colour function', re: /\b(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb|color-mix)\(/ },
  { what: 'a font size', re: /font-size:(?!\s*var\()[^;"'`{}]*\d/ },
  { what: 'a font size in `font:`', re: /\bfont:\s*[^;"'`{}]*\d+(?:px|r?em|%)/ },
  { what: 'a font family', re: /font-family:(?!\s*(?:var\(|inherit\b))/ },
  {
    what: 'a spacing value',
    re: /\b(?:margin|padding|gap|row-gap|column-gap|inset)(?:-[a-z-]+)?:\s*[^;"'`{}]*?(?<![\w-])(?:[1-9]\d*(?:\.\d+)?|0?\.\d*[1-9]\d*)(?:px|r?em|ch|vh|vw)\b/,
  },
];

/** Source text without comments, keeping line numbers. */
const blank = (m: string) => m.replace(/[^\n]/g, ' ');

export function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/^\s*\/\/.*$/gm, blank)
    .replace(/<!--[\s\S]*?-->/g, blank);
}

/** Problems for literals in `files` (paths relative to the board folder), skipping the allowlist. */
export function literalProblems(
  files: readonly { path: string; text: string }[],
  shown: (path: string) => string = (p) => p,
): Problem[] {
  const out: Problem[] = [];
  for (const f of files) {
    if (LITERAL_ALLOW.some((a) => (a.endsWith('/') ? f.path.startsWith(a) : f.path === a)))
      continue;
    const lines = stripComments(f.text).split('\n');
    lines.forEach((line, i) => {
      for (const b of BANNED)
        if (b.re.test(line))
          out.push({
            file: shown(f.path),
            message: `line ${i + 1}: ${b.what} outside the token files; use a token`,
          });
    });
  }
  return out;
}

/** Every .css, .js and .html file under `dir`, with paths relative to it. */
export function readSources(dir: string): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(css|js|html)$/.test(e.name))
        out.push({ path: relative(dir, p).split('\\').join('/'), text: readFileSync(p, 'utf8') });
    }
  };
  walk(dir);
  out.sort((a, b) => a.path.localeCompare(b.path));
  return out;
}
