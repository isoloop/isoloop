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
