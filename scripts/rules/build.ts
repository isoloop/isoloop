// `pnpm rules:build` writes docs/rules/README.md (ADR 0026, decision 14).
// `pnpm rules:board` writes the rules page (decision 15, amended 2026-11-28):
// one self-contained HTML file, to a gitignored path, then opens it. The page is
// board/shell.html with board/shell.css and shell.js, then every view's CSS and
// JS from board/views/ (by file name), the registry and the derived model inlined.
import { spawn } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { CONFIG, REPO_ROOT } from './config.ts';
import { buildModel } from './model.ts';
import {
  type Adr,
  conceptsOf,
  currentWhy,
  inForce,
  keywordsOf,
  parseRef,
  README,
  readAdrs,
  readRegistry,
  refLabel,
  refUrl,
  type Registry,
  type Rule,
  rulesOf,
} from './registry.ts';

/** Where `rules:board` writes the page; gitignored. */
export const BOARD_OUT: string = CONFIG.boardOut;
/** The page's sources, next to this file. */
export const BOARD_DIR: string = join(import.meta.dirname, 'board');
/** The placeholder the data replaces; oxfmt may put a space before `null`. */
const DATA_MARK = /\/\*RULES_DATA\*\/\s*null/;
const TITLE_MARK = '/*TITLE*/';
const STYLES_MARK = '/*STYLES*/';
const SCRIPTS_MARK = '/*SCRIPTS*/';

const cell = (s: string): string => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');

function refMd(raw: string, adrs: Map<string, Adr>): string {
  const ref = parseRef(raw);
  if (!ref) return cell(raw);
  const url = refUrl(ref, adrs, true);
  const label = refLabel(ref, adrs);
  return url ? `[${cell(label)}](${url})` : cell(label);
}

function versionCell(r: Rule, adrs: Map<string, Adr>): string {
  const built = inForce(r);
  if (built) return `in force since ${refMd(built.ref, adrs)}`;
  if (r.since) return `since \`${r.since}\``;
  if (r.target) return `target \`${r.target}\``;
  return '';
}

/** The README: one section per concept, a table, then each rule's history. */
export function renderReadme(reg: Registry, adrs: Map<string, Adr>): string {
  const all = rulesOf(reg);
  const out: string[] = ['# Rules', '', CONFIG.readmeIntro, ''];
  const concepts = conceptsOf(reg);
  for (const c of concepts) {
    const rules = all.filter((x) => x.concept === c.id).map((x) => x.rule);
    out.push(`## ${c.name}`, '', `${c.description} Prefix \`${c.prefix}\`.`, '');
    if (rules.length === 0) {
      out.push('No rules yet.', '');
      continue;
    }
    out.push('| Rule | Statement | Values | Status | Version |', '| --- | --- | --- | --- | --- |');
    for (const r of rules) {
      const status = [
        r.status,
        ...(r.experimental ? ['experimental'] : []),
        ...(r.repo ? ['repo'] : []),
      ].join(', ');
      const values = (r.values ?? []).map((v) => `\`${cell(v)}\``).join(', ');
      out.push(
        `| \`${r.id}\` | ${cell(r.statement)} | ${values} | ${status} | ${versionCell(r, adrs)} |`,
      );
    }
    out.push('');
    for (const r of rules) {
      out.push(`### \`${r.id}\``, '');
      const facts: string[] = [];
      if (r.knob) facts.push(`- **Change it:** ${cell(r.knob)}`);
      if (r.errors?.length)
        facts.push(`- **Errors and events:** ${r.errors.map((e) => `\`${e}\``).join(', ')}`);
      if (r.code?.length) facts.push(`- **Code:** ${r.code.map((p) => `\`${p}\``).join(', ')}`);
      if (r.supersededBy) facts.push(`- **Superseded by:** \`${r.supersededBy}\``);
      if (r.related?.length)
        facts.push(`- **Related:** ${r.related.map((p) => `\`${p}\``).join(', ')}`);
      if (r.aliases?.length)
        facts.push(`- **Old ids:** ${r.aliases.map((p) => `\`${p}\``).join(', ')}`);
      const why = currentWhy(r);
      if (why) facts.push(`- **Why:** ${why.why}`);
      if (facts.length) out.push(...facts, '');
      out.push('History:', '');
      for (const e of r.events) {
        const prev = e.prev ? ` Before: ${e.prev}` : '';
        out.push(`- ${e.date} · ${e.type} · ${refMd(e.ref, adrs)} · ${e.why}${prev}`);
      }
      out.push('');
    }
  }
  return `${out.join('\n').trimEnd()}\n`;
}

/** The data the page reads: config, concepts, rules, each ref's label and link, keywords and the derived model. */
export function boardData(reg: Registry, adrs: Map<string, Adr>): unknown {
  const refs: Record<string, { label: string; url?: string }> = {};
  const all = rulesOf(reg);
  for (const { rule } of all)
    for (const e of rule.events) {
      const ref = parseRef(e.ref);
      if (!ref) continue;
      const url = refUrl(ref, adrs, false);
      refs[e.ref] = url ? { label: refLabel(ref, adrs), url } : { label: refLabel(ref, adrs) };
    }
  const keywords = keywordsOf(reg);
  const rules = all.map(({ rule }) => rule);
  return {
    config: { title: CONFIG.title, rulesDir: CONFIG.rulesDir },
    concepts: conceptsOf(reg),
    rules: all.map(({ concept, rule }) => Object.assign({}, rule, { concept })),
    refs,
    keywords,
    model: buildModel(rules, keywords, {
      cap: CONFIG.links.cap,
      symbolsIgnore: CONFIG.symbolsIgnore,
    }),
  };
}

/** The page's sources: the shell, its CSS and JS, and each view's CSS and JS by file name. */
export interface BoardSources {
  shell: string;
  css: string[];
  js: string[];
}

const read = (p: string) => readFileSync(p, 'utf8');

/** Reads the shell and every view from `dir` (board/ by default). */
export function readBoardSources(dir: string = BOARD_DIR): BoardSources {
  const views = join(dir, 'views');
  const files = readdirSync(views);
  files.sort();
  return {
    shell: read(join(dir, 'shell.html')),
    css: [
      read(join(dir, 'shell.css')),
      ...files.filter((f) => f.endsWith('.css')).map((f) => read(join(views, f))),
    ],
    js: [
      read(join(dir, 'shell.js')),
      ...files.filter((f) => f.endsWith('.js')).map((f) => read(join(views, f))),
    ],
  };
}

const escHtml = (s: string) =>
  s.replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[m]!);

/** The page with the title, styles, data and scripts inlined; `</` escaped so no value can close a script. */
export function renderBoard(
  src: BoardSources,
  data: unknown,
  title: string = CONFIG.title,
): string {
  const js = src.js.join('\n') + '\nRules.start();\n';
  if (!DATA_MARK.test(js)) throw new Error('board/shell.js: no /*RULES_DATA*/ null placeholder');
  for (const mark of [TITLE_MARK, STYLES_MARK, SCRIPTS_MARK])
    if (!src.shell.includes(mark)) throw new Error(`board/shell.html: no ${mark} placeholder`);
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  const script = js.replace(DATA_MARK, () => json).replace(/<\/script/gi, '<\\/script');
  return src.shell
    .replace(TITLE_MARK, () => escHtml(title))
    .replace(STYLES_MARK, () => src.css.join('\n'))
    .replace(SCRIPTS_MARK, () => script);
}

function open(path: string): void {
  const cmd =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
  try {
    const child = spawn(cmd, [path], { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
  } catch {
    // No opener: the printed path is enough.
  }
}

function main(): void {
  const root = REPO_ROOT;
  const reg = readRegistry(root);
  const adrs = readAdrs(root);
  if (process.argv.includes('--board')) {
    const out = join(root, BOARD_OUT);
    mkdirSync(join(out, '..'), { recursive: true });
    writeFileSync(out, renderBoard(readBoardSources(), boardData(reg, adrs)));
    console.log(`rules:board wrote ${relative(process.cwd(), out) || out}`);
    console.log(out);
    if (!process.argv.includes('--no-open')) open(out);
    return;
  }
  writeFileSync(join(root, README), renderReadme(reg, adrs));
  console.log(`rules:build wrote ${README}`);
}

if (import.meta.main) main();
