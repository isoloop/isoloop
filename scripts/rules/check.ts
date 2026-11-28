// `pnpm rules:check` (ADR 0026, decision 10): fails when the rules registry
// could quietly be wrong, or when the page's sources write a literal that
// belongs in a token (amended 2026-11-28). It runs in ci.yml next to docs:check, and reads only
// files in the repo.
//
// Until the backfill is done (decision 11), the ADR side is checked only for
// the ADRs that have `Rules:` lines; an ADR ref from a rule is always checked.
import { existsSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { literalProblems, readSources } from './literals.ts';
import { renderReadme } from './build.ts';
import {
  type Adr,
  compareVersions,
  CONCEPTS_FILE,
  EVENT_TYPES,
  isVersion,
  KEYWORDS_FILE,
  packagesVersion,
  parseRef,
  type Problem,
  README,
  readAdrs,
  readRegistry,
  REF_KINDS,
  RULES_DIR,
  RULES_LINES_FROM,
  type Registry,
  STATUSES,
} from './registry.ts';

export interface CheckInput {
  reg: Registry;
  adrs: Map<string, Adr>;
  /** Whether a repo-relative path exists. */
  exists: (path: string) => boolean;
  /** docs/rules/README.md as on disk, `undefined` when it's missing. */
  readme: string | undefined;
  /** The packages' shared version, for decision 13's guard; `undefined` skips it. */
  version: string | undefined;
}

const ID = /^([a-z][a-z0-9]*)\.[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';
const isOneOf = <T extends string>(list: readonly T[], v: unknown): v is T =>
  list.some((x) => x === v);
const isStrArr = (v: unknown): v is string[] => Array.isArray(v) && v.every(isStr);

const RULE_FIELDS = new Set([
  'id',
  'statement',
  'status',
  'experimental',
  'repo',
  'values',
  'knob',
  'errors',
  'code',
  'since',
  'target',
  'related',
  'supersededBy',
  'aliases',
  'keywords',
  'events',
]);
const EVENT_FIELDS = new Set(['type', 'date', 'ref', 'why', 'prev']);
const CONCEPT_FIELDS = new Set(['id', 'prefix', 'name', 'description', 'order']);
const KEYWORD_FIELDS = new Set(['id', 'label', 'definition', 'aliases']);
const KEYWORD_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function checkRules(input: CheckInput): Problem[] {
  const { reg, adrs, exists } = input;
  const problems: Problem[] = [];
  const at = (file: string, message: string) => problems.push({ file, message });

  // Concepts.
  const prefixOf = new Map<string, string>();
  const conceptOfPrefix = new Map<string, string>();
  if (!Array.isArray(reg.concepts)) at(CONCEPTS_FILE, 'must be an array of concepts');
  else
    reg.concepts.forEach((c: unknown, i) => {
      const where = `concept ${i + 1}`;
      if (!isObj(c)) {
        at(CONCEPTS_FILE, `${where}: must be an object`);
        return;
      }
      for (const k of Object.keys(c))
        if (!CONCEPT_FIELDS.has(k)) at(CONCEPTS_FILE, `${where}: unknown field "${k}"`);
      for (const k of ['id', 'prefix', 'name', 'description'])
        if (!isStr(c[k])) at(CONCEPTS_FILE, `${where}: "${k}" must be a non-empty string`);
      if (typeof c['order'] !== 'number') at(CONCEPTS_FILE, `${where}: "order" must be a number`);
      if (!isStr(c['id']) || !isStr(c['prefix'])) return;
      if (!/^[a-z][a-z0-9]*$/.test(c['prefix']))
        at(
          CONCEPTS_FILE,
          `${c['id']}: prefix "${c['prefix']}" must be lower-case letters and digits`,
        );
      if (prefixOf.has(c['id'])) at(CONCEPTS_FILE, `concept id "${c['id']}" is used twice`);
      if (conceptOfPrefix.has(c['prefix']))
        at(CONCEPTS_FILE, `prefix "${c['prefix']}" is used twice`);
      prefixOf.set(c['id'], c['prefix']);
      conceptOfPrefix.set(c['prefix'], c['id']);
    });
  for (const id of prefixOf.keys())
    if (!reg.files.some((f) => f.concept === id))
      at(CONCEPTS_FILE, `concept "${id}" has no file ${RULES_DIR}/${id}.json`);

  // The keyword vocabulary (amended 2026-11-28), optional.
  const keywordIds = new Set<string>();
  if (reg.keywords !== undefined) {
    if (isObj(reg.keywords) && 'parseError' in reg.keywords)
      at(KEYWORDS_FILE, `not valid JSON: ${String(reg.keywords['parseError'])}`);
    else if (!Array.isArray(reg.keywords)) at(KEYWORDS_FILE, 'must be an array of keywords');
    else
      reg.keywords.forEach((k: unknown, i) => {
        const where = `keyword ${i + 1}`;
        if (!isObj(k)) {
          at(KEYWORDS_FILE, `${where}: must be an object`);
          return;
        }
        for (const f of Object.keys(k))
          if (!KEYWORD_FIELDS.has(f)) at(KEYWORDS_FILE, `${where}: unknown field "${f}"`);
        for (const f of ['id', 'label', 'definition'])
          if (!isStr(k[f])) at(KEYWORDS_FILE, `${where}: "${f}" must be a non-empty string`);
        if (!isStrArr(k['aliases']))
          at(KEYWORDS_FILE, `${where}: "aliases" must be an array of strings`);
        if (isStr(k['id'])) {
          if (!KEYWORD_ID.test(k['id'])) at(KEYWORDS_FILE, `${where}: id must be kebab-case`);
          if (keywordIds.has(k['id'])) at(KEYWORDS_FILE, `keyword id "${k['id']}" is used twice`);
          keywordIds.add(k['id']);
        }
      });
  }

  // Rules, pass 1: shape, and every id and alias.
  const owner = new Map<string, string>(); // id or alias → file
  const rules: { file: string; r: Record<string, unknown> }[] = [];
  for (const f of reg.files) {
    if (!prefixOf.has(f.concept)) at(f.path, `no concept "${f.concept}" in ${CONCEPTS_FILE}`);
    if (isObj(f.data) && 'parseError' in f.data) {
      at(f.path, `not valid JSON: ${String(f.data['parseError'])}`);
      continue;
    }
    if (!Array.isArray(f.data)) {
      at(f.path, 'must be an array of rules');
      continue;
    }
    f.data.forEach((r: unknown, i) => {
      if (!isObj(r)) {
        at(f.path, `rule ${i + 1}: must be an object`);
        return;
      }
      const name = isStr(r['id']) ? r['id'] : `rule ${i + 1}`;
      for (const k of Object.keys(r))
        if (!RULE_FIELDS.has(k)) at(f.path, `${name}: unknown field "${k}"`);
      if (!isStr(r['id'])) at(f.path, `${name}: "id" must be a non-empty string`);
      else {
        const m = ID.exec(r['id']);
        if (!m) at(f.path, `${name}: id must be <prefix>.<kebab-case-slug>`);
        else if (!conceptOfPrefix.has(m[1]!))
          at(f.path, `${name}: prefix "${m[1]}" isn't in ${CONCEPTS_FILE}`);
        else if (prefixOf.get(f.concept) !== m[1])
          at(
            f.path,
            `${name}: prefix "${m[1]}" belongs in ${RULES_DIR}/${conceptOfPrefix.get(m[1]!)}.json`,
          );
      }
      if (!isStr(r['statement'])) at(f.path, `${name}: "statement" must be a non-empty string`);
      if (!isOneOf(STATUSES, r['status']))
        at(f.path, `${name}: "status" must be one of ${STATUSES.join(', ')}`);
      for (const k of ['experimental', 'repo'])
        if (k in r && typeof r[k] !== 'boolean')
          at(f.path, `${name}: "${k}" must be true or false`);
      for (const k of ['values', 'errors', 'code', 'related', 'aliases', 'keywords'])
        if (k in r && !isStrArr(r[k])) at(f.path, `${name}: "${k}" must be an array of strings`);
      for (const k of ['knob', 'supersededBy'])
        if (k in r && !isStr(r[k])) at(f.path, `${name}: "${k}" must be a non-empty string`);
      for (const k of ['since', 'target'])
        if (k in r && !(isStr(r[k]) && isVersion(r[k])))
          at(f.path, `${name}: "${k}" must be a version like 0.2.0`);
      if (!Array.isArray(r['events']) || r['events'].length === 0)
        at(f.path, `${name}: "events" must be a non-empty array`);
      for (const id of [r['id'], ...(isStrArr(r['aliases']) ? r['aliases'] : [])]) {
        if (!isStr(id)) continue;
        if (id !== r['id'] && !(ID.exec(id) && conceptOfPrefix.has(ID.exec(id)![1]!)))
          at(f.path, `${name}: alias "${id}" must be <known prefix>.<slug>`);
        const prev = owner.get(id);
        if (prev !== undefined)
          at(f.path, `${name}: "${id}" is already used${prev === f.path ? '' : ` in ${prev}`}`);
        else owner.set(id, f.path);
      }
      rules.push({ file: f.path, r });
    });
  }
  const ids = new Set(rules.map(({ r }) => r['id']).filter(isStr));
  const known = (id: string) => owner.has(id);

  // Rules, pass 2: links, events, status, code.
  for (const { file, r } of rules) {
    const name = isStr(r['id']) ? r['id'] : '(no id)';
    if (isStrArr(r['related']))
      for (const id of r['related'])
        if (!known(id)) at(file, `${name}: related "${id}" doesn't exist`);
    if (isStr(r['supersededBy']) && !ids.has(r['supersededBy']))
      at(file, `${name}: supersededBy "${r['supersededBy']}" doesn't exist`);
    if (isStrArr(r['keywords']))
      for (const k of r['keywords'])
        if (!keywordIds.has(k)) at(file, `${name}: keyword "${k}" isn't in ${KEYWORDS_FILE}`);
    if (isStrArr(r['code']))
      for (const p of r['code'])
        if (!exists(p)) at(file, `${name}: code path "${p}" doesn't exist`);

    const events = Array.isArray(r['events']) ? r['events'] : [];
    let lastDate = '';
    events.forEach((e: unknown, i) => {
      const where = `${name}, event ${i + 1}`;
      if (!isObj(e)) {
        at(file, `${where}: must be an object`);
        return;
      }
      for (const k of Object.keys(e))
        if (!EVENT_FIELDS.has(k)) at(file, `${where}: unknown field "${k}"`);
      const type = e['type'];
      if (!isOneOf(EVENT_TYPES, type))
        at(file, `${where}: "type" must be one of ${EVENT_TYPES.join(', ')}`);
      if (!(isStr(e['date']) && DATE.test(e['date'])))
        at(file, `${where}: "date" must be YYYY-MM-DD`);
      else {
        if (e['date'] < lastDate) at(file, `${where}: events must be oldest first`);
        lastDate = e['date'];
      }
      if (!isStr(e['why'])) at(file, `${where}: "why" must be a non-empty string`);
      if ('prev' in e && !isStr(e['prev'])) at(file, `${where}: "prev" must be a non-empty string`);
      if ((type === 'clarified' || type === 'amended') && !isStr(e['prev']))
        at(file, `${where}: a ${type} event needs "prev", the wording or behaviour before it`);
      if (!isStr(e['ref'])) {
        at(file, `${where}: "ref" must be a non-empty string`);
        return;
      }
      const ref = parseRef(e['ref']);
      if (!ref) {
        at(
          file,
          `${where}: ref "${e['ref']}" must be adr/NNNN#heading-anchor, #N, repo#N or vX.Y.Z`,
        );
        return;
      }
      if (isOneOf(EVENT_TYPES, type) && !REF_KINDS[type].includes(ref.kind))
        at(
          file,
          `${where}: a ${type} event's ref must be ${REF_KINDS[type].join(' or ')}, not ${ref.kind}`,
        );
      if (ref.kind === 'adr') {
        const adr = adrs.get(ref.number);
        if (!adr) at(file, `${where}: ref "${e['ref']}": no ADR ${ref.number} in docs/adr`);
        else if (!adr.anchors.has(ref.anchor))
          at(file, `${where}: ref "${e['ref']}": no heading #${ref.anchor} in ${adr.file}`);
      }
    });

    const has = (t: string) => events.some((e) => isObj(e) && e['type'] === t);
    const status = r['status'];
    if (r['repo'] === true) {
      // Amended 2026-11-27: a repo rule has no versions; its built event puts it in force.
      for (const k of ['since', 'target'])
        if (k in r) at(file, `${name}: a repo rule has no "${k}"`);
      if (has('shipped')) at(file, `${name}: a repo rule has no shipped event`);
      if (status === 'active' && !has('built'))
        at(file, `${name}: an active repo rule needs a built event`);
    } else {
      if (status === 'active') {
        if (!isStr(r['since'])) at(file, `${name}: an active rule needs "since"`);
        if (!has('shipped')) at(file, `${name}: an active rule needs a shipped event`);
      }
      if ((status === 'decided' || status === 'proposed') && !isStr(r['target']))
        at(file, `${name}: a ${status} rule needs "target"`);
      if (status !== 'decided' && status !== 'proposed' && 'target' in r)
        at(file, `${name}: only a decided or proposed rule has "target"`);
    }
    for (const s of ['withdrawn', 'rejected', 'superseded'] as const)
      if (status === s && !has(s)) at(file, `${name}: a ${s} rule needs a ${s} event`);
    if (status === 'superseded' && !isStr(r['supersededBy']))
      at(file, `${name}: a superseded rule needs "supersededBy"`);
    if (status !== 'superseded' && 'supersededBy' in r)
      at(file, `${name}: only a superseded rule has "supersededBy"`);
    // Decision 13: a version PR runs rules:ship, so no rule waits on a version already reached.
    if (
      (status === 'decided' || status === 'proposed') &&
      isStr(r['target']) &&
      input.version !== undefined &&
      isVersion(r['target']) &&
      compareVersions(input.version, r['target']) >= 0
    )
      at(
        file,
        `${name}: target ${r['target']} is reached (packages are at ${input.version}): run pnpm rules:ship ${r['target']}`,
      );
  }

  // ADRs from 0026 on: every decision and amendment has a `Rules:` line.
  for (const adr of adrs.values())
    if (adr.number >= RULES_LINES_FROM)
      for (const u of adr.unruled) at(`docs/adr/${adr.file}`, `${u} has no Rules: line`);

  // ADRs with `Rules:` lines.
  for (const adr of adrs.values())
    for (const id of adr.rulesIds)
      if (!known(id))
        at(`docs/adr/${adr.file}`, `Rules: line names "${id}", which isn't in docs/rules`);

  // The generated README, only once the registry itself is sound.
  if (problems.length === 0) {
    const want = renderReadme(reg, adrs);
    if (input.readme !== want) at(README, `out of date: run pnpm rules:build`);
  }
  return problems;
}

function main(): void {
  const root = resolve(import.meta.dirname, '../..');
  const t0 = performance.now();
  const readmePath = join(root, README);
  const problems = checkRules({
    reg: readRegistry(root),
    adrs: readAdrs(root),
    exists: (p) => existsSync(join(root, p)),
    readme: existsSync(readmePath) ? readFileSync(readmePath, 'utf8') : undefined,
    version: packagesVersion(root),
  });
  // The literal ban on the page's sources (amended 2026-11-28).
  const board = join(import.meta.dirname, 'board');
  problems.push(
    ...literalProblems(readSources(board), (p) =>
      relative(root, join(board, p)).split('\\').join('/'),
    ),
  );
  const ci = process.env['GITHUB_ACTIONS'] === 'true';
  for (const p of problems)
    console.log(ci ? `::error file=${p.file}::${p.message}` : `error   ${p.file}: ${p.message}`);
  const ms = Math.round(performance.now() - t0);
  console.log(
    problems.length === 0
      ? `rules:check passed in ${ms} ms`
      : `rules:check: ${problems.length} problem(s), in ${ms} ms`,
  );
  if (problems.length > 0) process.exitCode = 1;
}

if (import.meta.main) main();
