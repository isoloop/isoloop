// `pnpm rules:build` writes docs/rules/README.md (ADR 0026, decision 14).
// `pnpm rules:board` writes the rules page (decision 15, amended 2026-11-28):
// one self-contained HTML file, to a gitignored path, then opens it. The page is
// board/shell.html with board/shell.css and shell.js, then every view's CSS and
// JS from board/views/ (by file name), the registry and the derived model inlined.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
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

/** The page's sources, in the order they go into the page. */
export interface BoardSources {
  shell: string;
  css: string[];
  js: string[];
  /** The theme's webfont stylesheet, if it has one. */
  fontHref?: string;
}

const read = (p: string) => readFileSync(p, 'utf8');
const inDir = (dir: string, ext: string) => {
  const files = readdirSync(dir).filter((f) => f.endsWith(ext));
  files.sort();
  return files.map((f) => read(join(dir, f)));
};

/** The design system's files, in order (ADR 0026, amended 2026-11-28). */
export const DS_CSS = ['tokens.css', 'base.css', 'layout.css', 'components.css'];
export const DS_JS = ['html.js', 'components.js', 'chart.js'];

/**
 * Reads the page's sources from `dir` (board/ by default): the design system with
 * the theme after its tokens, the shell, then every view in views/ by file name,
 * or the specimen in their place.
 */
export function readBoardSources(
  opts: { dir?: string; theme?: string; specimen?: boolean } = {},
): BoardSources {
  const dir = opts.dir ?? BOARD_DIR;
  const theme = opts.theme ?? CONFIG.theme;
  const ds = join(dir, 'ds');
  const themeCss = join(ds, 'themes', `${theme}.css`);
  if (!existsSync(themeCss)) throw new Error(`no theme "${theme}" in ${join(ds, 'themes')}`);
  const themeJson = join(ds, 'themes', `${theme}.json`);
  const meta: unknown = existsSync(themeJson) ? JSON.parse(read(themeJson)) : {};
  const fontHref =
    typeof meta === 'object' && meta !== null && typeof Reflect.get(meta, 'fontHref') === 'string'
      ? String(Reflect.get(meta, 'fontHref'))
      : undefined;
  const [tokens, ...rest] = DS_CSS.map((f) => read(join(ds, f)));
  const views = join(dir, 'views');
  const src: BoardSources = {
    shell: read(join(dir, 'shell.html')),
    css: [
      tokens!,
      read(themeCss),
      ...rest,
      read(join(dir, 'shell.css')),
      ...(opts.specimen ? [read(join(dir, 'specimen.css'))] : inDir(views, '.css')),
    ],
    js: [
      ...DS_JS.map((f) => read(join(ds, f))),
      read(join(dir, 'shell.js')),
      ...(opts.specimen ? [read(join(dir, 'specimen.js'))] : inDir(views, '.js')),
    ],
  };
  if (fontHref) src.fontHref = fontHref;
  return src;
}

const escHtml = (s: string) =>
  s.replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[m]!);

const FONT_MARK = '<!--FONT-->';

/** The page with the title, font, styles, data and scripts inlined; `</` escaped so no value can close a script. */
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
  const font = src.fontHref
    ? `<link rel="preconnect" href="https://fonts.googleapis.com" />\n    <link rel="stylesheet" href="${escHtml(src.fontHref)}" />`
    : '';
  return src.shell
    .replace(TITLE_MARK, () => escHtml(title))
    .replace(FONT_MARK, () => font)
    .replace(STYLES_MARK, () => src.css.join('\n'))
    .replace(SCRIPTS_MARK, () => script);
}

/** Where `rules:board --specimen` writes the specimen page, next to the board. */
export const SPECIMEN_OUT: string = join(dirname(CONFIG.boardOut), 'specimen.html');

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
    const specimen = process.argv.includes('--specimen');
    const out = join(root, specimen ? SPECIMEN_OUT : BOARD_OUT);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(
      out,
      renderBoard(
        readBoardSources({ specimen }),
        boardData(reg, adrs),
        specimen ? `${CONFIG.title} · specimen` : CONFIG.title,
      ),
    );
    console.log(`rules:board wrote ${relative(process.cwd(), out) || out}`);
    console.log(out);
    if (!process.argv.includes('--no-open')) open(out);
    return;
  }
  writeFileSync(join(root, README), renderReadme(reg, adrs));
  console.log(`rules:build wrote ${README}`);
}

if (import.meta.main) main();
