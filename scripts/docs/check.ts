// `pnpm docs:check` (M4c, decision 22): the docs rules `docs/writing.md`
// marks (checked), and the map's coverage of the API (decisions 21, 33,
// 37–41). Problems fail the run; the map notice only reports.
//
// - Items 1, 3 and 4 (each guide's skeleton and lead, its links, banned
//   phrases and em dashes) need only the Markdown. `--guides` runs just these,
//   for the PR hook.
// - Item 6 (coverage) reads the built `dist/*.d.ts` through `readApi`, so it
//   needs `pnpm build` first.
// - Item 2 (fences that type-check, scripts/docs/fences.ts) runs `tsc` over
//   the guides' `ts` and `tsx` fences; `--guides` runs it too.
// - Item 5 (a guide naming a removed export) needs the PR's base built, so the
//   API check runs it (scripts/ci/api-check.ts), with checkRemovedNames from
//   ./markdown.ts.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkFences } from './fences.ts';
import { isTypeKind, readApi, type ApiModel, type EntryFile, type ExportKind } from './read-api.ts';

export type { Problem } from './markdown.ts';
export { checkRemovedNames, withoutFences } from './markdown.ts';
import { type Problem, withoutFences } from './markdown.ts';

/**
 * Guides that predate the skeleton and the lead rule (M4c decisions 9 and 19). Item 1
 * skips them until M4c task 5 brings them to it and empties this list. Every
 * other check still runs on them.
 */
export const SHAPE_PENDING: readonly string[] = [];

/** The packages the docs cover, in the order the reference lists them (decision 28). */
export const USER_FACING = [
  'host',
  'runtime',
  'bus',
  'dom',
  'react',
  'preact',
  'vite',
  'balancer',
  'devtools',
  'webmcp',
] as const;

export const MAX_LEAD = 200;

// --- The rules, read from docs/writing.md -----------------------------------

export type WritingRules = {
  banned: readonly string[];
  noEmDash: boolean;
  /** The h2s every guide starts with, and the ones it ends with. */
  skeleton: { first: readonly string[]; last: readonly string[] };
};

/** Reads the checked rules from `docs/writing.md`, so they live in one place. */
export function parseWritingRules(md: string): WritingRules {
  const bannedAt = md.search(/^###\s+Banned phrases/m);
  if (bannedAt < 0) throw new Error('docs/writing.md: no "Banned phrases" section');
  const afterHeading = md.slice(bannedAt).split('\n').slice(1).join('\n').trimStart();
  const para = afterHeading.split(/\n\s*\n/)[0] ?? '';
  const banned = [...para.matchAll(/`([^`]+)`/g)].map((m) => (m[1] ?? '').toLowerCase());
  if (banned.length === 0) throw new Error('docs/writing.md: the banned phrases list is empty');

  const noEmDash = /\*\*No em dashes\.\*\*[^\n]*\(checked\)/.test(md);

  const shapeAt = md.search(/^##\s+A guide's shape/m);
  const block = /```md\n([\s\S]*?)```/.exec(md.slice(Math.max(shapeAt, 0)));
  if (shapeAt < 0 || !block)
    throw new Error('docs/writing.md: no skeleton block under "A guide\'s shape"');
  const h2s = [...(block[1] ?? '').matchAll(/^##\s+(.+)$/gm)].map((m) => (m[1] ?? '').trim());
  const body = h2s.findIndex((h) => h.startsWith('…'));
  if (body < 0) throw new Error('docs/writing.md: the skeleton has no "…" body placeholder');
  return { banned, noEmDash, skeleton: { first: h2s.slice(0, body), last: h2s.slice(body + 1) } };
}

// --- Markdown helpers --------------------------------------------------------

/** Prose as a reader sees it: inline code removed, links reduced to their text. */
const prose = (line: string): string =>
  line
    .replace(/`[^`]*`/g, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ');

// --- Item 1: the skeleton and the lead ---------------------------------------

export function checkShape(
  file: string,
  md: string,
  rules: WritingRules,
  o: { skeleton: boolean },
): Problem[] {
  const problems: Problem[] = [];
  const say = (message: string): void => void problems.push({ file, message });
  const lines = withoutFences(md).split('\n');
  const headings = lines
    .map((l, i) => ({ m: /^(#{1,6})\s+(.*)$/.exec(l), i }))
    .filter((h) => h.m)
    .map((h) => ({ level: (h.m?.[1] ?? '').length, text: (h.m?.[2] ?? '').trim(), i: h.i }));
  const h1s = headings.filter((h) => h.level === 1);
  const first = lines.findIndex((l) => l.trim() !== '');
  if (h1s.length !== 1 || h1s[0]?.i !== first) {
    say('a guide starts with its title as the only `# h1`');
    return problems;
  }

  // The lead: the first paragraph after the h1.
  let i = first + 1;
  while (i < lines.length && (lines[i] ?? '').trim() === '') i++;
  const para: string[] = [];
  while (i < lines.length && (lines[i] ?? '').trim() !== '') para.push(lines[i++] ?? '');
  const raw = para.join(' ').trim();
  if (raw === '' || /^(#|[-*+]\s|\d+\.\s|\||>)/.test(raw)) {
    say('the h1 is followed by a one-sentence lead paragraph');
  } else {
    const text = prose(raw).replace(/\s+/g, ' ').trim();
    const ends = text.match(/[.!?](?=\s|$)/g) ?? [];
    if (ends.length !== 1 || !/[.!?]$/.test(text))
      say(`the lead is one sentence (found ${ends.length})`);
    if (text.length > MAX_LEAD)
      say(`the lead is at most ${MAX_LEAD} characters (it has ${text.length})`);
  }

  if (o.skeleton) {
    const h2 = headings.filter((h) => h.level === 2).map((h) => h.text);
    const { first: want, last } = rules.skeleton;
    const head = h2.slice(0, want.length);
    const tail = h2.slice(Math.max(h2.length - last.length, 0));
    if (head.join('\n') !== want.join('\n'))
      say(
        `the first h2 ${want.length === 1 ? 'is' : 'are'} ${want.map((w) => `"## ${w}"`).join(', ')}`,
      );
    if (tail.join('\n') !== last.join('\n') || h2.length < want.length + last.length)
      say(`the last h2s are ${last.map((w) => `"## ${w}"`).join(', ')}, in that order`);
  }
  return problems;
}

// --- Item 3: links ------------------------------------------------------------

/** Relative link targets in the prose, with their line numbers. */
export function relativeLinks(md: string): { target: string; line: number }[] {
  const out: { target: string; line: number }[] = [];
  withoutFences(md)
    .split('\n')
    .forEach((l, n) => {
      const line = l.replace(/`[^`]*`/g, ' ');
      const targets = [
        ...[...line.matchAll(/\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)].map((m) => m[1] ?? ''),
        ...[...line.matchAll(/^\s*\[[^\]]+\]:\s*<?(\S+?)>?(?:\s|$)/g)].map((m) => m[1] ?? ''),
      ];
      for (const t of targets) {
        if (t === '' || t.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(t)) continue;
        out.push({ target: t, line: n + 1 });
      }
    });
  return out;
}

export function checkLinks(file: string, md: string, exists: (path: string) => boolean): Problem[] {
  return relativeLinks(md)
    .filter(({ target }) => {
      const path = decodeURIComponent((target.split('#')[0] ?? '').split('?')[0] ?? '');
      return path !== '' && !exists(join(dirname(file), path));
    })
    .map(({ target, line }) => ({
      file,
      message: `line ${line}: the link "${target}" resolves to nothing`,
    }));
}

// --- Item 4: banned phrases and em dashes -------------------------------------

export function checkWords(file: string, md: string, rules: WritingRules): Problem[] {
  const problems: Problem[] = [];
  const res = rules.banned.map((b) => ({
    b,
    re: new RegExp(
      `(?<![\\w-])${b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')}(?![\\w-])`,
      'i',
    ),
  }));
  withoutFences(md)
    .split('\n')
    .forEach((l, n) => {
      const text = prose(l);
      for (const { b, re } of res)
        if (re.test(text)) problems.push({ file, message: `line ${n + 1}: "${b}" is banned` });
      if (rules.noEmDash && text.includes('—'))
        problems.push({ file, message: `line ${n + 1}: no em dashes` });
    });
  return problems;
}

// --- Item 6: the map's coverage -----------------------------------------------

type Names = Record<string, readonly string[]>;
export type DocsMap = {
  guides: Record<string, { paths: readonly string[]; exports: Names }>;
  referenceOnly: Names;
  pending?: Record<string, Names>;
};

const MAP = 'docs/guide/map.json';

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const field = (v: unknown, k: string): unknown => (isRecord(v) ? v[k] : undefined);

function nameLists(v: unknown, where: string): Names {
  if (v === undefined) return {};
  if (!isRecord(v)) throw new Error(`${MAP}: ${where} is an object of entry points`);
  return Object.fromEntries(
    Object.entries(v).map(([entry, ns]) => {
      if (!Array.isArray(ns) || !ns.every((n) => typeof n === 'string'))
        throw new Error(`${MAP}: ${where}.${entry} is a list of export names`);
      return [entry, ns.filter((n): n is string => typeof n === 'string')];
    }),
  );
}

/** Parses `docs/guide/map.json`, failing with the path of anything out of shape. */
export function parseMap(text: string): DocsMap {
  const raw: unknown = JSON.parse(text);
  const guides = field(raw, 'guides');
  if (!isRecord(guides)) throw new Error(`${MAP}: no guides`);
  const pending = field(raw, 'pending');
  return {
    guides: Object.fromEntries(
      Object.entries(guides).map(([slug, g]) => {
        const paths = field(g, 'paths');
        if (!Array.isArray(paths) || !paths.every((p) => typeof p === 'string'))
          throw new Error(`${MAP}: guides.${slug}.paths is a list of paths`);
        return [
          slug,
          {
            paths: paths.filter((p): p is string => typeof p === 'string'),
            exports: nameLists(field(g, 'exports'), `guides.${slug}.exports`),
          },
        ];
      }),
    ),
    referenceOnly: nameLists(field(raw, 'referenceOnly'), 'referenceOnly'),
    ...(pending === undefined
      ? {}
      : {
          pending: Object.fromEntries(
            Object.entries(isRecord(pending) ? pending : {}).map(([g, v]) => [
              g,
              nameLists(v, `pending.${g}`),
            ]),
          ),
        }),
  };
}

/** Coverage problems: uncovered exports, stale names, pending that's covered or grew (decisions 33, 37–41). */
export function checkCoverage(map: DocsMap, api: ApiModel, base: DocsMap | undefined): Problem[] {
  const problems: Problem[] = [];
  const say = (message: string): void => void problems.push({ file: MAP, message });
  const byEntry = new Map(
    [...api.entries].map(([e, xs]) => [e, new Map(xs.map((x) => [x.name, x]))]),
  );
  const kindOfKey = new Map<string, ExportKind>();
  const homeName = new Map<string, string>();
  for (const [entry, xs] of api.entries)
    for (const x of xs) {
      kindOfKey.set(x.key, x.kind);
      if (entry === x.home || !homeName.has(x.key)) homeName.set(x.key, `${x.home} \`${x.name}\``);
    }

  const resolveName = (where: string, entry: string, name: string): string | undefined => {
    const x = byEntry.get(entry)?.get(name);
    if (!x) say(`${where}: ${entry} doesn't export \`${name}\` (remove or rename it)`);
    return x?.key;
  };

  const named = new Map<string, string>(); // key → where it's named
  for (const [slug, g] of Object.entries(map.guides))
    for (const [entry, names] of Object.entries(g.exports))
      for (const n of names) {
        const k = resolveName(`guides.${slug}`, entry, n);
        if (k) named.set(k, `guide "${slug}"`);
      }
  for (const [entry, names] of Object.entries(map.referenceOnly))
    for (const n of names) {
      const k = resolveName('referenceOnly', entry, n);
      if (k) named.set(k, 'referenceOnly');
    }

  // Types reached from a covered export are covered (decision 41).
  const covered = new Set(named.keys());
  const queue = [...named.keys()];
  for (let k = queue.pop(); k !== undefined; k = queue.pop()) {
    for (const r of api.refs.get(k) ?? []) {
      if (covered.has(r)) continue;
      const kind = kindOfKey.get(r);
      if (kind !== undefined && !isTypeKind(kind)) continue; // a value is named, never reached
      covered.add(r);
      queue.push(r);
    }
  }

  const pending = new Map<string, string>(); // key → group
  for (const [group, entries] of Object.entries(map.pending ?? {})) {
    if (!/^(\d+|freeze)$/.test(group))
      say(`pending: the group "${group}" is a task number or "freeze"`);
    for (const [entry, names] of Object.entries(entries))
      for (const n of names) {
        const k = resolveName(`pending.${group}`, entry, n);
        if (!k) continue;
        if (named.has(k))
          say(`pending.${group}: \`${n}\` is also in ${named.get(k)}; take it out of pending`);
        else if (covered.has(k))
          say(
            `pending.${group}: \`${n}\` is already reached from a covered export; take it out of pending`,
          );
        pending.set(k, group);
      }
  }

  for (const [k, label] of homeName)
    if (!covered.has(k) && !pending.has(k))
      say(`${label} is in no guide's exports or referenceOnly, and no covered export reaches it`);

  // `pending` only shrinks (decision 38), once it exists on the base branch.
  if (map.pending && base?.pending) {
    const before = new Set(
      Object.values(base.pending).flatMap((es) =>
        Object.entries(es).flatMap(([e, ns]) => ns.map((n) => `${e} ${n}`)),
      ),
    );
    for (const [group, es] of Object.entries(map.pending))
      for (const [e, ns] of Object.entries(es))
        for (const n of ns)
          if (!before.has(`${e} ${n}`))
            say(
              `pending.${group}: \`${n}\` (${e}) isn't pending on the base branch; pending only shrinks, so map it instead`,
            );
  }
  return problems;
}

/** Guides whose mapped paths a change touched without touching the guide (decision 21): notices, not failures. */
export function mapNotices(map: DocsMap, changed: readonly string[]): Problem[] {
  const set = new Set(changed);
  return Object.entries(map.guides).flatMap(([slug, g]) => {
    const guide = `docs/guide/${slug}.md`;
    if (set.has(guide)) return [];
    const hit = changed.find((f) =>
      g.paths.some((p) => (p.endsWith('/') ? f.startsWith(p) : f === p)),
    );
    return hit
      ? [{ file: guide, message: `${hit} changed; does "${slug}" need a change too?` }]
      : [];
  });
}

// --- Running it ----------------------------------------------------------------

/** The entry points of the user-facing packages that have types, in reference order. */
export function entryFiles(root: string): EntryFile[] {
  return USER_FACING.flatMap((p) => {
    const dir = join(root, 'packages', p);
    const pkg: unknown = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    const name = field(pkg, 'name');
    const exports = field(pkg, 'exports');
    if (typeof name !== 'string' || !isRecord(exports))
      throw new Error(`${dir}: no name or exports`);
    return Object.entries(exports).flatMap(([sub, v]) => {
      const types = field(v, 'types');
      return typeof types === 'string'
        ? [{ entry: sub === '.' ? name : `${name}${sub.slice(1)}`, file: resolve(dir, types) }]
        : [];
    });
  });
}

function git(root: string, args: string[]): string | undefined {
  try {
    return execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return undefined;
  }
}

function main(): void {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const guidesOnly = process.argv.includes('--guides');
  const ci = process.env.GITHUB_ACTIONS === 'true';
  const t0 = performance.now();
  const rules = parseWritingRules(readFileSync(join(root, 'docs/writing.md'), 'utf8'));
  const problems: Problem[] = [];
  const notices: Problem[] = [];

  const guideDir = join(root, 'docs/guide');
  const guides = readdirSync(guideDir).filter((f) => f.endsWith('.md'));
  guides.sort();
  for (const name of guides) {
    const file = relative(root, join(guideDir, name));
    const md = readFileSync(join(root, file), 'utf8');
    const slug = name.slice(0, -3);
    problems.push(
      ...(SHAPE_PENDING.includes(slug) ? [] : checkShape(file, md, rules, { skeleton: true })),
      ...checkLinks(file, md, (p) => existsSync(join(root, p))),
      ...checkWords(file, md, rules),
    );
  }
  problems.push(
    ...checkFences(
      root,
      guides.map((name) => {
        const file = relative(root, join(guideDir, name));
        return { file, md: readFileSync(join(root, file), 'utf8') };
      }),
    ),
  );

  if (!guidesOnly) {
    const map = parseMap(readFileSync(join(root, MAP), 'utf8'));
    const files = entryFiles(root);
    const missing = files.filter((f) => !existsSync(f.file));
    if (missing.length > 0) {
      problems.push({
        file: MAP,
        message: `no built types at ${relative(root, missing[0]?.file ?? '')}: run pnpm build first`,
      });
    } else {
      const baseRef =
        process.env.DOCS_CHECK_BASE ?? `origin/${process.env.GITHUB_BASE_REF || 'main'}`;
      const baseText = git(root, ['show', `${baseRef}:${MAP}`]);
      if (!baseText)
        notices.push({
          file: MAP,
          message: `couldn't read ${MAP} at ${baseRef}; pending wasn't compared with it`,
        });
      const base = baseText ? parseMap(baseText) : undefined;
      problems.push(...checkCoverage(map, readApi(files, root), base));
      const changed = git(root, ['diff', '--name-only', `${baseRef}...HEAD`]);
      if (changed !== undefined)
        notices.push(...mapNotices(map, changed.split('\n').filter(Boolean)));
    }
  }

  for (const n of notices)
    console.log(ci ? `::notice file=${n.file}::${n.message}` : `notice  ${n.file}: ${n.message}`);
  for (const p of problems)
    console.log(ci ? `::error file=${p.file}::${p.message}` : `error   ${p.file}: ${p.message}`);
  const ms = Math.round(performance.now() - t0);
  console.log(
    problems.length === 0
      ? `docs:check passed${guidesOnly ? ' (guides only)' : ''} in ${ms} ms`
      : `docs:check: ${problems.length} problem(s), in ${ms} ms`,
  );
  if (problems.length > 0) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
