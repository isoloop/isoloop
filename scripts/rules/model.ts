// What the rules page derives from the registry when it's built (ADR 0026,
// amended 2026-11-28): symbols, links between rules, and each keyword's rules.
// The views read the result; nothing here is written back to the registry.
import { type EventType, parseRef, type Keyword, type Rule, type Status } from './registry.ts';

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
  /** Each rule's states over time, oldest first, by rule id ("as of", amended 2026-11-28). */
  history: Record<string, Snapshot[]>;
  /** The points "as of" can show, oldest first; the last one is today. */
  points: Point[];
}

/**
 * A rule as it stood from the end of `date` on, until its next snapshot. Only
 * the statement, the status and `since` have a history (ADR 0026, amended
 * 2026-11-28): earlier wording comes from `prev`, and a whole day is one step.
 */
export interface Snapshot {
  date: string;
  status: Status;
  statement: string;
  since?: string;
}

/** A point in time "as of" can show: a day with events, named after its release if one shipped that day. */
export interface Point {
  /** The release tag, `today` for the newest point, or the date. */
  id: string;
  date: string;
  /** The release shipped that day, if any. */
  tag?: string;
}

/** The status each event type leaves a rule in; `built` and `shipped` are handled apart. */
const STATUS_AFTER: Partial<Record<EventType, Status>> = {
  proposed: 'proposed',
  decided: 'decided',
  reopened: 'proposed',
  rejected: 'rejected',
  withdrawn: 'withdrawn',
  removed: 'withdrawn',
  superseded: 'superseded',
};

/**
 * A rule's snapshots, one per day its status, statement or `since` changed. The
 * statement on a day is the `prev` of the first amendment or clarification
 * after it, or today's statement. The last snapshot always matches the rule as
 * stored, so the newest point shows the registry exactly.
 */
export function historyOf(rule: Rule): Snapshot[] {
  const events = [...rule.events];
  events.sort((x, y) => x.date.localeCompare(y.date));
  const wording = events.filter((e) => (e.type === 'amended' || e.type === 'clarified') && e.prev);
  const statementOn = (date: string) => wording.find((e) => e.date > date)?.prev ?? rule.statement;
  const out: Snapshot[] = [];
  let status: Status | undefined;
  let since: string | undefined;
  for (let i = 0; i < events.length; i++) {
    const e = events[i]!;
    const after = STATUS_AFTER[e.type];
    if (after) status = after;
    else if (e.type === 'built' && rule.repo) status = 'active';
    else if (e.type === 'shipped') {
      status = 'active';
      since ??= e.ref.replace(/^v/, '');
    }
    if (events[i + 1]?.date === e.date) continue; // one snapshot per day
    const snap: Snapshot = {
      date: e.date,
      status: status ?? rule.status,
      statement: statementOn(e.date),
    };
    if (since !== undefined) snap.since = since;
    const last = out[out.length - 1];
    if (
      last &&
      last.status === snap.status &&
      last.statement === snap.statement &&
      last.since === snap.since
    )
      continue;
    out.push(snap);
  }
  const last = out[out.length - 1];
  if (last) {
    last.status = rule.status;
    last.statement = rule.statement;
    if (rule.since !== undefined) last.since = rule.since;
    else delete last.since;
  }
  return out;
}

/** Every day with an event, oldest first, named after the release shipped that day; the newest is `today`. */
export function pointsOf(rules: readonly Rule[]): Point[] {
  const tags = new Map<string, string>();
  const days = new Set<string>();
  for (const r of rules)
    for (const e of r.events) {
      days.add(e.date);
      if (e.type === 'shipped' && !tags.has(e.date)) tags.set(e.date, e.ref);
    }
  const sorted = [...days];
  sorted.sort();
  return sorted.map((date, i) => {
    const tag = tags.get(date);
    const id = i === sorted.length - 1 ? 'today' : (tag ?? date);
    return tag ? { id, date, tag } : { id, date };
  });
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
  const history: Record<string, Snapshot[]> = {};
  for (const r of rules) history[r.id] = historyOf(r);
  return {
    symbols,
    links,
    tooCommon,
    keywordRules: keywordRules(rules, vocab),
    history,
    points: pointsOf(rules),
  };
}
