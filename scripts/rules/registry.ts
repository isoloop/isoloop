// The rules registry (ADR 0026): its types, and reading it and the ADRs from
// disk. check.ts, build.ts, ship.ts and pr.ts share this module; none of it
// needs a dependency.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const RULES_DIR = 'docs/rules';
export const ADR_DIR = 'docs/adr';
export const README = `${RULES_DIR}/README.md`;
export const CONCEPTS_FILE = `${RULES_DIR}/concepts.json`;
/** Files in docs/rules that hold no rules. */
export const NOT_RULE_FILES = new Set(['concepts.json', 'schema.json']);

/** Decision 5. */
export const STATUSES = [
  'active',
  'decided',
  'proposed',
  'withdrawn',
  'rejected',
  'superseded',
] as const;
export type Status = (typeof STATUSES)[number];

/** Decision 6. */
export const EVENT_TYPES = [
  'proposed',
  'decided',
  'clarified',
  'amended',
  'built',
  'shipped',
  'corrected',
  'reopened',
  'removed',
  'rejected',
  'withdrawn',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/** The kind of `ref` each event type takes (decision 6's table). */
export const REF_KINDS: Record<EventType, readonly RefKind[]> = {
  proposed: ['adr', 'issue'],
  decided: ['adr'],
  clarified: ['adr'],
  amended: ['adr'],
  built: ['issue'],
  shipped: ['tag'],
  corrected: ['adr'],
  reopened: ['issue'],
  removed: ['adr'],
  rejected: ['adr'],
  withdrawn: ['adr'],
};

export interface RuleEvent {
  type: EventType;
  date: string;
  ref: string;
  why: string;
  prev?: string;
}

export interface Rule {
  id: string;
  statement: string;
  status: Status;
  experimental?: boolean;
  values?: string[];
  knob?: string;
  errors?: string[];
  code?: string[];
  since?: string;
  target?: string;
  related?: string[];
  supersededBy?: string;
  aliases?: string[];
  events: RuleEvent[];
}

export interface Concept {
  id: string;
  prefix: string;
  name: string;
  description: string;
  order: number;
}

/** One concept file as read, before validation. */
export interface RuleFile {
  /** Repo-relative path, for messages. */
  path: string;
  /** The concept id the file is named for. */
  concept: string;
  /** Parsed JSON; validated by check.ts. */
  data: unknown;
}

export interface Registry {
  concepts: unknown;
  files: RuleFile[];
}

/** An ADR file: its number, file name, text, heading anchors and `Rules:` ids. */
export interface Adr {
  number: string;
  file: string;
  anchors: Map<string, string>;
  rulesIds: string[];
}

export interface Problem {
  file: string;
  message: string;
}

// --- Refs ---------------------------------------------------------------------

export type RefKind = 'adr' | 'issue' | 'tag';
export type Ref =
  | { kind: 'adr'; number: string; anchor?: string }
  | { kind: 'issue'; repo?: string; number: number }
  | { kind: 'tag'; tag: string };

/**
 * The three ref forms:
 * - `adr/0007#1-supervise-the-bus-like-an-isolate` (an ADR, optionally a heading);
 * - `#390` or `web#285` (a PR or an issue; GitHub serves both under one number);
 * - `v0.1.0` (a release tag).
 */
export function parseRef(ref: string): Ref | undefined {
  let m = /^adr\/(\d{4})(?:#([a-z0-9_-]+))?$/.exec(ref);
  if (m)
    return m[2] ? { kind: 'adr', number: m[1]!, anchor: m[2] } : { kind: 'adr', number: m[1]! };
  m = /^(?:([a-z][a-z0-9-]*))?#(\d+)$/.exec(ref);
  if (m)
    return m[1]
      ? { kind: 'issue', repo: m[1], number: Number(m[2]) }
      : { kind: 'issue', number: Number(m[2]) };
  m = /^v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(ref);
  if (m) return { kind: 'tag', tag: ref };
  return undefined;
}

const GITHUB = 'https://github.com/isoloop';

/** Where a ref points, for the board (absolute) or the README (`relativeAdr` from docs/rules). */
export function refUrl(ref: Ref, adrs: Map<string, Adr>, relativeAdr: boolean): string | undefined {
  if (ref.kind === 'adr') {
    const adr = adrs.get(ref.number);
    if (!adr) return undefined;
    const base = relativeAdr
      ? `../adr/${adr.file}`
      : `${GITHUB}/isoloop/blob/main/${ADR_DIR}/${adr.file}`;
    return ref.anchor ? `${base}#${ref.anchor}` : base;
  }
  if (ref.kind === 'issue') return `${GITHUB}/${ref.repo ?? 'isoloop'}/issues/${ref.number}`;
  return `${GITHUB}/isoloop/releases/tag/${ref.tag}`;
}

/** A short label: `ADR 0007 · 1. Supervise the bus like an isolate`, `#390`, `v0.1.0`. */
export function refLabel(ref: Ref, adrs: Map<string, Adr>): string {
  if (ref.kind === 'adr') {
    const heading = ref.anchor ? adrs.get(ref.number)?.anchors.get(ref.anchor) : undefined;
    return heading ? `ADR ${ref.number} · ${heading}` : `ADR ${ref.number}`;
  }
  if (ref.kind === 'issue') return `${ref.repo ?? ''}#${ref.number}`;
  return ref.tag;
}

// --- ADRs ---------------------------------------------------------------------

/** Heading text as shown: inline code, links and emphasis reduced to their text. */
export function headingText(raw: string): string {
  return raw
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/(\*\*|__|\*)(.*?)\1/g, '$2')
    .trim();
}

/**
 * GitHub's heading anchor: lower case, punctuation removed (letters, digits,
 * spaces, `-` and `_` kept), each space a `-`. Repeats get `-1`, `-2`, … in
 * readAnchors.
 */
export function slug(text: string): string {
  return headingText(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/ /g, '-');
}

/** Anchor → heading text, for every heading outside code fences. */
export function readAnchors(md: string): Map<string, string> {
  const out = new Map<string, string>();
  const seen = new Map<string, number>();
  let fence: string | undefined;
  for (const line of md.split('\n')) {
    const f = /^\s*(```+|~~~+)/.exec(line);
    if (f) {
      if (fence === undefined) fence = f[1]!.slice(0, 3);
      else if (f[1]!.startsWith(fence)) fence = undefined;
      continue;
    }
    if (fence !== undefined) continue;
    const h = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (!h) continue;
    const base = slug(h[1]!);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    out.set(n === 0 ? base : `${base}-${n}`, headingText(h[1]!));
  }
  return out;
}

/** The ids on an ADR's `Rules:` lines (decision 9): backticked, comma-separated. */
export function readRulesLines(md: string): string[] {
  const ids: string[] = [];
  for (const m of md.matchAll(/^Rules:(.*)$/gm)) {
    for (const id of m[1]!.matchAll(/`([^`]+)`/g)) ids.push(id[1]!);
  }
  return ids;
}

export function parseAdr(file: string, md: string): Adr | undefined {
  const m = /^(\d{4})-.+\.md$/.exec(file);
  if (!m) return undefined;
  return { number: m[1]!, file, anchors: readAnchors(md), rulesIds: readRulesLines(md) };
}

export function readAdrs(root: string): Map<string, Adr> {
  const out = new Map<string, Adr>();
  const dir = join(root, ADR_DIR);
  if (!existsSync(dir)) return out;
  const files = readdirSync(dir);
  files.sort();
  for (const file of files) {
    const adr = parseAdr(file, readFileSync(join(dir, file), 'utf8'));
    if (adr) out.set(adr.number, adr);
  }
  return out;
}

// --- The registry on disk -----------------------------------------------------

export function readRegistry(root: string): Registry {
  const dir = join(root, RULES_DIR);
  const concepts: unknown = JSON.parse(readFileSync(join(root, CONCEPTS_FILE), 'utf8'));
  const files: RuleFile[] = [];
  const names = readdirSync(dir);
  names.sort();
  for (const name of names) {
    if (!name.endsWith('.json') || NOT_RULE_FILES.has(name)) continue;
    const path = `${RULES_DIR}/${name}`;
    let data: unknown;
    try {
      data = JSON.parse(readFileSync(join(root, path), 'utf8'));
    } catch (e) {
      data = { parseError: e instanceof Error ? e.message : String(e) };
    }
    files.push({ path, concept: name.slice(0, -'.json'.length), data });
  }
  return { concepts, files };
}

// --- Versions -----------------------------------------------------------------

export const isVersion = (v: string): boolean => /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(v);

/** Semver order, prereleases below their release; prerelease ids compared numerically or as text. */
export function compareVersions(a: string, b: string): number {
  const [ma = '', pa] = a.split(/-(.*)/s);
  const [mb = '', pb] = b.split(/-(.*)/s);
  const na = ma.split('.').map(Number);
  const nb = mb.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (na[i] ?? 0) - (nb[i] ?? 0);
    if (d !== 0) return Math.sign(d);
  }
  if (pa === undefined || pb === undefined) return pa === pb ? 0 : pa === undefined ? 1 : -1;
  const xa = pa.split('.');
  const xb = pb.split('.');
  for (let i = 0; i < Math.max(xa.length, xb.length); i++) {
    const s = xa[i];
    const t = xb[i];
    if (s === undefined) return -1;
    if (t === undefined) return 1;
    const ns = /^\d+$/.test(s);
    const nt = /^\d+$/.test(t);
    if (ns && nt && Number(s) !== Number(t)) return Math.sign(Number(s) - Number(t));
    if (ns !== nt) return ns ? -1 : 1;
    if (s !== t) return s < t ? -1 : 1;
  }
  return 0;
}

/** The fixed group's version, from the public packages' manifests (undefined when they differ). */
export function packagesVersion(root: string): string | undefined {
  const versions = new Set<string>();
  const dir = join(root, 'packages');
  if (!existsSync(dir)) return undefined;
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const manifest = join(dir, d.name, 'package.json');
    if (!existsSync(manifest)) continue;
    const pkg: unknown = JSON.parse(readFileSync(manifest, 'utf8'));
    if (typeof pkg !== 'object' || pkg === null) continue;
    if (Reflect.get(pkg, 'private') === true) continue;
    const v: unknown = Reflect.get(pkg, 'version');
    if (typeof v === 'string') versions.add(v);
  }
  return versions.size === 1 ? [...versions][0] : undefined;
}

const isRec = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** A shallow guard: check.ts validates the fields; this only keeps the readers from crashing. */
export const isRule = (v: unknown): v is Rule =>
  isRec(v) && typeof v['id'] === 'string' && Array.isArray(v['events']);

export const isConcept = (v: unknown): v is Concept =>
  isRec(v) && typeof v['id'] === 'string' && typeof v['order'] === 'number';

/** The rules in a file's data, for readers after check.ts. */
export function rulesIn(data: unknown): Rule[] {
  const list: unknown[] = Array.isArray(data) ? data : [];
  return list.filter(isRule);
}

/** Rules as checked, with their concept. */
export function rulesOf(reg: Registry): { concept: string; rule: Rule }[] {
  return reg.files.flatMap((f) => rulesIn(f.data).map((rule) => ({ concept: f.concept, rule })));
}

export function conceptsOf(reg: Registry): Concept[] {
  const list: unknown[] = Array.isArray(reg.concepts) ? reg.concepts : [];
  const out = list.filter(isConcept);
  out.sort((a, b) => a.order - b.order);
  return out;
}

/** The current why (decision 3): the newest decided, amended or clarified event's. */
export function currentWhy(rule: Rule): RuleEvent | undefined {
  for (let i = rule.events.length - 1; i >= 0; i--) {
    const e = rule.events[i]!;
    if (e.type === 'decided' || e.type === 'amended' || e.type === 'clarified') return e;
  }
  return undefined;
}
