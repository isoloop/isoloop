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
<<<<<<< HEAD
  /** Each rule's states over time, oldest first, by rule id ("as of", amended 2026-11-28). */
  history: Record<string, Snapshot[]>;
  /** The points "as of" can show, oldest first; the last one is today. */
  points: Point[];
}

/**
 * A rule as it stood from the end of `date` on, until its next snapshot. Only
 * the statement and the status have a history (ADR 0026, amended 2026-11-28):
 * earlier wording comes from `prev`, and a whole day is one step. `since` isn't
 * a history of its own: it's the release named by the `shipped` event that
 * made the status active.
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
 * A rule's snapshots, one per day its status or statement changed. The
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
=======
  /** The keyword map: keywords placed on a plane, joined where they tag the same rules. */
  keywordGraph: KeywordGraph;
  /** For each rule with keywords, the rules in other concepts that share the most telling ones. */
  keywordNeighbours: Record<string, KeywordNeighbour[]>;
}

/** A keyword on the map: its rule count, its place and its radius, in the graph's own units. */
export interface KeywordNode {
  id: string;
  n: number;
  x: number;
  y: number;
  r: number;
}

/** Two keywords that tag `shared` rules; `weight` is shared / √(n_a × n_b), from 0 to 1. */
export interface KeywordEdge {
  a: string;
  b: string;
  shared: number;
  weight: number;
}

export interface KeywordGraph {
  /** The plane's size; a view scales it to fit. */
  width: number;
  height: number;
  nodes: KeywordNode[];
  edges: KeywordEdge[];
}

/** A rule elsewhere that shares keywords with this one, ranked by how rare the shared keywords are. */
export interface KeywordNeighbour {
  id: string;
  keywords: string[];
  score: number;
>>>>>>> origin/main
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

/** The concept part of an id: rules in one concept share it. */
const prefixOf = (id: string) => id.slice(0, id.indexOf('.'));

/**
 * Edges between keywords that tag the same rules. Each keyword keeps its
 * `perNode` strongest edges (by weight, then shared count, then id), so a
 * keyword used everywhere can't tie itself to every other one.
 */
export function keywordEdges(
  byKeyword: Record<string, readonly string[]>,
  perNode = 4,
): KeywordEdge[] {
  const ids = Object.keys(byKeyword).filter((k) => byKeyword[k]!.length > 0);
  const sets = new Map(ids.map((k) => [k, new Set(byKeyword[k])]));
  const all: KeywordEdge[] = [];
  for (let i = 0; i < ids.length; i++)
    for (let j = i + 1; j < ids.length; j++) {
      const a = sets.get(ids[i]!)!;
      const b = sets.get(ids[j]!)!;
      let shared = 0;
      for (const r of a) if (b.has(r)) shared++;
      if (shared === 0) continue;
      const [x, y] = ids[i]! < ids[j]! ? [ids[i]!, ids[j]!] : [ids[j]!, ids[i]!];
      all.push({ a: x, b: y, shared, weight: shared / Math.sqrt(a.size * b.size) });
    }
  const rank = (p: KeywordEdge, q: KeywordEdge) =>
    q.weight - p.weight || q.shared - p.shared || (p.a + p.b).localeCompare(q.a + q.b);
  const keep = new Set<KeywordEdge>();
  for (const k of ids) {
    const mine = all.filter((e) => e.a === k || e.b === k);
    mine.sort(rank);
    for (const e of mine.slice(0, perNode)) keep.add(e);
  }
  const out = [...keep];
  out.sort(rank);
  return out;
}

/** One decimal place, so the page data stays small and stable. */
const round1 = (v: number) => Math.round(v * 10) / 10;

/** How wide a label is, roughly, in the graph's units: enough to keep labels apart. */
const labelWidth = (label: string) => label.length * 7 + 8;

/**
 * Places keywords on a plane with a fixed number of steps from fixed starting
 * points, so the same registry always gives the same map. Keywords that share
 * rules pull together, every pair pushes apart, and a node keeps room for its
 * label. No randomness and no library.
 */
export function layoutKeywords(
  counts: Record<string, number>,
  edges: readonly KeywordEdge[],
  labels: Record<string, string>,
  size: { width: number; height: number } = { width: 1000, height: 600 },
): KeywordNode[] {
  const ids = Object.keys(counts).filter((k) => counts[k]! > 0);
  ids.sort();
  if (ids.length === 0) return [];
  const { width: W, height: H } = size;
  const max = Math.max(...ids.map((k) => counts[k]!));
  const radius = (k: string) => 6 + 14 * Math.sqrt(counts[k]! / max);
  const room = (k: string) => Math.max(radius(k), labelWidth(labels[k] ?? k) / 2) + 6;
  const pos = new Map<string, { x: number; y: number }>();
  ids.forEach((k, i) => {
    const a = (2 * Math.PI * i) / ids.length;
    pos.set(k, { x: W / 2 + (W / 3) * Math.cos(a), y: H / 2 + (H / 3) * Math.sin(a) });
  });
  const ideal = Math.sqrt((W * H) / ids.length) * 0.6;
  let heat = W / 8;
  for (let step = 0; step < 400; step++) {
    const move = new Map(ids.map((k) => [k, { x: 0, y: 0 }]));
    for (let i = 0; i < ids.length; i++)
      for (let j = i + 1; j < ids.length; j++) {
        const p = pos.get(ids[i]!)!;
        const q = pos.get(ids[j]!)!;
        let dx = p.x - q.x;
        let dy = p.y - q.y;
        let d = Math.hypot(dx, dy);
        if (d < 0.01) {
          dx = 0.01 * (i - j);
          dy = 0.01;
          d = Math.hypot(dx, dy);
        }
        const min = room(ids[i]!) + room(ids[j]!);
        const push = (ideal * ideal) / d + (d < min ? (min - d) * 4 : 0);
        const fx = (dx / d) * push;
        const fy = (dy / d) * push;
        move.get(ids[i]!)!.x += fx;
        move.get(ids[i]!)!.y += fy;
        move.get(ids[j]!)!.x -= fx;
        move.get(ids[j]!)!.y -= fy;
      }
    for (const e of edges) {
      const p = pos.get(e.a);
      const q = pos.get(e.b);
      if (!p || !q) continue;
      const dx = p.x - q.x;
      const dy = p.y - q.y;
      const d = Math.max(0.01, Math.hypot(dx, dy));
      const pull = ((d * d) / ideal) * (0.3 + e.weight);
      move.get(e.a)!.x -= (dx / d) * pull;
      move.get(e.a)!.y -= (dy / d) * pull;
      move.get(e.b)!.x += (dx / d) * pull;
      move.get(e.b)!.y += (dy / d) * pull;
    }
    for (const k of ids) {
      const p = pos.get(k)!;
      const m = move.get(k)!;
      m.x += (W / 2 - p.x) * 0.05 * (ideal / 10);
      m.y += (H / 2 - p.y) * 0.05 * (ideal / 10);
      const len = Math.max(0.01, Math.hypot(m.x, m.y));
      p.x += (m.x / len) * Math.min(len, heat);
      p.y += (m.y / len) * Math.min(len, heat);
    }
    heat = Math.max(1, heat * 0.985);
  }
  // Fit the result into the plane, keeping room for the outermost labels.
  const xs = ids.map((k) => pos.get(k)!.x);
  const ys = ids.map((k) => pos.get(k)!.y);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const padX = 70;
  const padY = 40;
  const sx = (W - 2 * padX) / Math.max(1, x1 - x0);
  const sy = (H - 2 * padY) / Math.max(1, y1 - y0);
  return ids.map((k) => ({
    id: k,
    n: counts[k]!,
    x: round1(padX + (pos.get(k)!.x - x0) * sx),
    y: round1(padY + (pos.get(k)!.y - y0) * sy),
    r: round1(radius(k)),
  }));
}

/** The keyword map: the strongest edges and the placed nodes. */
export function keywordGraph(
  byKeyword: Record<string, readonly string[]>,
  vocab: readonly Keyword[],
): KeywordGraph {
  const size = { width: 1000, height: 600 };
  const edges = keywordEdges(byKeyword);
  const counts = Object.fromEntries(Object.entries(byKeyword).map(([k, rs]) => [k, rs.length]));
  const labels = Object.fromEntries(vocab.map((k) => [k.id, k.label]));
  return { ...size, nodes: layoutKeywords(counts, edges, labels, size), edges };
}

/**
 * For each rule, up to `limit` rules in other concepts that share its keywords.
 * A shared keyword counts 1/log2(1 + n) for a keyword on n rules, so rare
 * keywords say more than common ones.
 */
export function keywordNeighbours(
  rules: readonly Rule[],
  byKeyword: Record<string, readonly string[]>,
  limit = 8,
): Record<string, KeywordNeighbour[]> {
  const out: Record<string, KeywordNeighbour[]> = {};
  for (const r of rules) {
    if (!r.keywords?.length) continue;
    const found = new Map<string, KeywordNeighbour>();
    for (const k of r.keywords) {
      const others = byKeyword[k] ?? [];
      const w = 1 / Math.log2(1 + others.length);
      for (const id of others) {
        if (id === r.id || prefixOf(id) === prefixOf(r.id)) continue;
        const n = found.get(id) ?? { id, keywords: [], score: 0 };
        n.keywords.push(k);
        n.score += w;
        found.set(id, n);
      }
    }
    for (const n of found.values()) n.score = Math.round(n.score * 1000) / 1000;
    const list = [...found.values()];
    list.sort((p, q) => q.score - p.score || p.id.localeCompare(q.id));
    if (list.length) out[r.id] = list.slice(0, limit);
  }
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
<<<<<<< HEAD
  const history: Record<string, Snapshot[]> = {};
  for (const r of rules) history[r.id] = historyOf(r);
=======
  const byKeyword = keywordRules(rules, vocab);
>>>>>>> origin/main
  return {
    symbols,
    links,
    tooCommon,
<<<<<<< HEAD
    keywordRules: keywordRules(rules, vocab),
    history,
    points: pointsOf(rules),
=======
    keywordRules: byKeyword,
    keywordGraph: keywordGraph(byKeyword, vocab),
    keywordNeighbours: keywordNeighbours(rules, byKeyword),
>>>>>>> origin/main
  };
}
