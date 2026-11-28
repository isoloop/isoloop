// What the rules page derives from the registry when it's built (ADR 0026,
// amended 2026-11-28): symbols, links between rules, and each keyword's rules.
// The views read the result; nothing here is written back to the registry.
import { parseRef, type Keyword, type Rule } from './registry.ts';

export type LinkKind = 'related' | 'section' | 'symbol' | 'code';

/** Two rules and what joins them, with the weights per kind added up. */
export interface Link {
  a: string;
  b: string;
  kind: LinkKind;
  /** 1 for a written link; the sum of 1/(n−1) over the shared keys for a derived one. */
  weight: number;
  /** The keys the pair shares: an ADR section, a symbol or a code path. Empty for a written link. */
  keys: string[];
}

/** A key shared by more rules than the cap: listed, never linked. */
export interface CommonKey {
  kind: Exclude<LinkKind, 'related'>;
  key: string;
  rules: number;
}

export interface Model {
  /** Each rule's symbols, by rule id. */
  symbols: Record<string, string[]>;
  links: Link[];
  tooCommon: CommonKey[];
  /** Each keyword's rule ids, in registry order. */
  keywordRules: Record<string, string[]>;
}

const BACKTICKS = /`([^`]+)`/g;

/** Backticked names in the statement, the knob and the errors; one word each, not in `ignore`. */
export function symbolsOf(rule: Rule, ignore: ReadonlySet<string> = new Set()): string[] {
  const out = new Set<string>();
  const take = (text: string) => {
    for (const m of text.matchAll(BACKTICKS)) {
      const s = m[1]!.trim();
      if (s && !/\s/.test(s) && !ignore.has(s)) out.add(s);
    }
  };
  take(rule.statement);
  if (rule.knob) take(rule.knob);
  for (const e of rule.errors ?? []) if (!/\s/.test(e) && !ignore.has(e)) out.add(e);
  return [...out];
}

/** The ADR sections a rule's events cite, as `adr/NNNN#anchor`. */
export function sectionsOf(rule: Rule): string[] {
  const out = new Set<string>();
  for (const e of rule.events) {
    const ref = parseRef(e.ref);
    if (ref?.kind === 'adr' && ref.anchor) out.add(`adr/${ref.number}#${ref.anchor}`);
  }
  return [...out];
}

const pairKey = (a: string, b: string) => (a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`);

/**
 * Links in four kinds. A written link (`related`, `supersededBy`) weighs 1. For
 * each derived kind, rules sharing a key are linked pairwise with weight
 * 1/(n−1) for n rules, unless n is over `cap`: then the key is listed instead.
 */
export function deriveLinks(
  rules: readonly Rule[],
  opts: { cap: number; symbols: Record<string, string[]> },
): { links: Link[]; tooCommon: CommonKey[] } {
  const ids = new Map<string, string>(); // id or alias → id
  for (const r of rules) {
    ids.set(r.id, r.id);
    for (const a of r.aliases ?? []) ids.set(a, r.id);
  }
  const byPair = new Map<string, Link>();
  const add = (a: string, b: string, kind: LinkKind, weight: number, key?: string) => {
    if (a === b) return;
    const k = `${kind}\u0000${pairKey(a, b)}`;
    const [x, y] = a < b ? [a, b] : [b, a];
    const link = byPair.get(k) ?? { a: x, b: y, kind, weight: 0, keys: [] };
    link.weight += weight;
    if (key !== undefined) link.keys.push(key);
    byPair.set(k, link);
  };

  for (const r of rules) {
    for (const t of [...(r.related ?? []), ...(r.supersededBy ? [r.supersededBy] : [])]) {
      const to = ids.get(t);
      if (to !== undefined && !byPair.has(`related\u0000${pairKey(r.id, to)}`))
        add(r.id, to, 'related', 1);
    }
  }

  const tooCommon: CommonKey[] = [];
  const groups: [Exclude<LinkKind, 'related'>, (r: Rule) => string[]][] = [
    ['section', sectionsOf],
    ['symbol', (r) => opts.symbols[r.id] ?? []],
    ['code', (r) => r.code ?? []],
  ];
  for (const [kind, keysOf] of groups) {
    const members = new Map<string, string[]>();
    for (const r of rules)
      for (const key of keysOf(r)) {
        const list = members.get(key) ?? [];
        list.push(r.id);
        members.set(key, list);
      }
    for (const [key, list] of members) {
      if (list.length < 2) continue;
      if (list.length > opts.cap) {
        tooCommon.push({ kind, key, rules: list.length });
        continue;
      }
      const w = 1 / (list.length - 1);
      for (let i = 0; i < list.length; i++)
        for (let j = i + 1; j < list.length; j++) add(list[i]!, list[j]!, kind, w, key);
    }
  }
  tooCommon.sort((x, y) => y.rules - x.rules || x.key.localeCompare(y.key));
  return { links: [...byPair.values()], tooCommon };
}

/** Each keyword's rules, in registry order; ids no rule uses get an empty list. */
export function keywordRules(
  rules: readonly Rule[],
  vocab: readonly Keyword[],
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const k of vocab) out[k.id] = [];
  for (const r of rules) for (const k of r.keywords ?? []) (out[k] ??= []).push(r.id);
  return out;
}

// --- Sources, code and health (the Sources tab) -------------------------------

/** Where a rule's first ADR event points, or `null` when no event cites an ADR. */
export function sourceOf(rule: Rule): { adr: string; type: string } | null {
  for (const e of rule.events) {
    const ref = parseRef(e.ref);
    if (ref?.kind === 'adr') return { adr: ref.number, type: e.type };
  }
  return null;
}

/** Rules flowing from one ADR into one concept, split by the type of that first ADR event. */
export interface Flow {
  /** An ADR number, or '' for rules that cite no ADR. */
  adr: string;
  concept: string;
  type: string;
  rules: string[];
}

/** One flow per (ADR, concept, first event type), biggest first within each ADR. */
export function sourceFlows(rules: readonly RuleIn[]): Flow[] {
  const by = new Map<string, Flow>();
  for (const { concept, rule } of rules) {
    const src = sourceOf(rule);
    const adr = src?.adr ?? '';
    const type = src?.type ?? 'none';
    const k = `${adr}\u0000${concept}\u0000${type}`;
    const f = by.get(k) ?? { adr, concept, type, rules: [] };
    f.rules.push(rule.id);
    by.set(k, f);
  }
  const out = [...by.values()];
  out.sort(
    (a, b) =>
      a.adr.localeCompare(b.adr) ||
      b.rules.length - a.rules.length ||
      a.concept.localeCompare(b.concept),
  );
  return out;
}

/** A code path and the rules citing it. Folders end in '/', as written in the registry. */
export interface CodePath {
  path: string;
  rules: string[];
}

/** Every cited path with its rules, most cited first. */
export function codePaths(rules: readonly Rule[]): CodePath[] {
  const by = new Map<string, string[]>();
  for (const r of rules)
    for (const p of new Set(r.code ?? [])) {
      const list = by.get(p) ?? [];
      list.push(r.id);
      by.set(p, list);
    }
  const out = [...by].map(([path, ids]) => ({ path, rules: ids }));
  out.sort((a, b) => b.rules.length - a.rules.length || a.path.localeCompare(b.path));
  return out;
}

/** One weakness in the registry: a title, what it means, and the rules or other items it lists. */
export interface HealthCheck {
  id: string;
  title: string;
  hint: string;
  /** Rule ids, when the check is about rules. */
  rules?: string[];
  /** Other items (ADR files, concept ids), when it isn't. */
  items?: string[];
}

/** A rule as the page gets it: with its concept. */
export interface RuleIn {
  concept: string;
  rule: Rule;
}

const ENDED = new Set(['rejected', 'withdrawn', 'superseded']);

/**
 * Where the registry is weak, computed from the registry and the ADR files
 * alone: nothing here knows about any one repo. Checks with nothing to list
 * are kept, so the page can say they're clear.
 */
export function healthChecks(
  rules: readonly RuleIn[],
  adrs: readonly { file: string; hasRules: boolean }[],
  tooCommon: readonly CommonKey[],
  links: readonly Link[],
): HealthCheck[] {
  const live = rules.filter(({ rule }) => !ENDED.has(rule.status));
  const coarse = new Set(tooCommon.filter((c) => c.kind === 'section').map((c) => c.key));
  const conceptOf = new Map(rules.map(({ concept, rule }) => [rule.id, concept]));
  const linked = new Set<string>();
  for (const l of links)
    if (l.kind === 'related' && conceptOf.get(l.a) !== conceptOf.get(l.b)) {
      linked.add(conceptOf.get(l.a)!);
      linked.add(conceptOf.get(l.b)!);
    }
  const concepts = [...new Set(rules.map((r) => r.concept))];
  return [
    {
      id: 'no-code',
      title: 'No code path',
      hint: 'Active or decided rules that name no file or folder, so nobody can check them against the code.',
      rules: live
        .filter(
          ({ rule }) =>
            (rule.status === 'active' || rule.status === 'decided') && !rule.code?.length,
        )
        .map(({ rule }) => rule.id),
    },
    {
      id: 'no-built',
      title: 'Shipped with no built event',
      hint: 'Active rules about the packages that go straight from decided to shipped, with no PR that built them.',
      rules: live
        .filter(
          ({ rule }) =>
            rule.status === 'active' && !rule.repo && !rule.events.some((e) => e.type === 'built'),
        )
        .map(({ rule }) => rule.id),
    },
    {
      id: 'coarse-anchor',
      title: 'Coarse ADR anchors',
      hint: 'Rules citing an ADR section shared by more rules than the link cap, so the ref doesn’t point at one decision.',
      rules: live
        .filter(({ rule }) => sectionsOf(rule).some((s) => coarse.has(s)))
        .map(({ rule }) => rule.id),
    },
    {
      id: 'no-keywords',
      title: 'No keywords',
      hint: 'Rules not tagged with any keyword yet, so they don’t show on the Keywords tab.',
      rules: live.filter(({ rule }) => !rule.keywords?.length).map(({ rule }) => rule.id),
    },
    {
      id: 'adr-no-rules',
      title: 'ADRs with no Rules: lines',
      hint: 'ADRs that name no rule, so no fact on the board traces back to them.',
      items: adrs.filter((a) => !a.hasRules).map((a) => a.file),
    },
    {
      id: 'concept-unlinked',
      title: 'Concepts with no written link to another concept',
      hint: 'Every connection to other concepts is derived; no `related` link crosses over by hand.',
      items: concepts.filter((c) => !linked.has(c)),
    },
  ];
}

/** Everything the views read beyond the registry itself. */
export function buildModel(
  rules: readonly Rule[],
  vocab: readonly Keyword[],
  opts: { cap: number; symbolsIgnore: readonly string[] },
): Model {
  const ignore = new Set(opts.symbolsIgnore);
  const symbols: Record<string, string[]> = {};
  for (const r of rules) symbols[r.id] = symbolsOf(r, ignore);
  const { links, tooCommon } = deriveLinks(rules, { cap: opts.cap, symbols });
  return { symbols, links, tooCommon, keywordRules: keywordRules(rules, vocab) };
}

/** What the Sources tab reads: flows from ADRs into concepts, cited code paths, and the health checks. */
export interface Sources {
  flows: Flow[];
  code: CodePath[];
  health: HealthCheck[];
}

export function buildSources(
  rules: readonly RuleIn[],
  adrs: readonly { file: string; hasRules: boolean }[],
  model: Pick<Model, 'links' | 'tooCommon'>,
): Sources {
  return {
    flows: sourceFlows(rules),
    code: codePaths(rules.map((r) => r.rule)),
    health: healthChecks(rules, adrs, model.tooCommon, model.links),
  };
}
