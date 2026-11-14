// The core diagrams (docs/diagrams/*.json, rendered with Archify) describe the
// runtime. This checks the parts of them that the code can confirm, so a
// change to the supervisor, the pool field or a default that isn't redrawn
// fails here. It doesn't check layout, wording or arrows.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_COMMIT_INTERVAL_MS } from '../../packages/protocol/src/commits.ts';
import type { IsolateManifest } from '../../packages/host/src/kernel.ts';
import {
  DEFAULT_SUPERVISOR_CONFIG,
  type IsolateState,
} from '../../packages/host/src/supervisor/machine.ts';

type Labelled = { id?: string; label?: string; sublabel?: string; wraps?: string[] };
type Diagram = {
  meta: { repository?: { revision?: string } };
  components?: Labelled[];
  boundaries?: Labelled[];
  states?: Labelled[];
  transitions?: Labelled[];
  flows?: Labelled[];
  messages?: Labelled[];
};

const dir = new URL('./', import.meta.url);
const NAMES = [
  'runtime-topology',
  'placement',
  'bus-publish',
  'isolate-lifecycle',
  'restart-own-worker',
  'restart-pool',
  'bus-crash-reattach',
] as const;

const read = (name: string): Diagram =>
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the diagram's JSON, checked below
  JSON.parse(readFileSync(new URL(`${name}.json`, dir), 'utf8')) as Diagram;

const label = (items: Labelled[] | undefined, id: string): string => {
  const found = items?.find((x) => x.id === id);
  if (found?.label === undefined) throw new Error(`no labelled item ${id}`);
  return found.label;
};

/** How the diagrams write a duration: 400 ms, 10 s. */
/** The same members, in any order, and no duplicates. */
const sameMembers = (
  actual: readonly (string | undefined)[],
  expected: readonly string[],
): void => {
  expect(actual).toHaveLength(expected.length);
  expect(new Set(actual)).toEqual(new Set(expected));
};

const duration = (ms: number): string => (ms < 1000 ? `${ms} ms` : `${ms / 1000} s`);

// Every state the supervisor has, as a record so `tsc` fails when one is added
// or removed and this list isn't updated.
const STATES: Record<IsolateState, true> = {
  loading: true,
  running: true,
  blocked: true,
  stopped: true,
  crashed: true,
  restarting: true,
  failed: true,
  suspended: true,
};

// The manifest field that places an isolate in a pool.
const POOL_FIELD = 'pool' satisfies keyof IsolateManifest;

describe('core diagrams', () => {
  it('has exactly the seven diagrams, each with its rendered page', () => {
    const json = readdirSync(dir).filter((f) => f.endsWith('.json'));
    sameMembers(
      json.map((f) => f.replace(/\.json$/, '')),
      NAMES,
    );
    for (const name of NAMES) expect(existsSync(new URL(`${name}.html`, dir))).toBe(true);
  });

  it('cites only files that still exist', () => {
    const root = new URL('../../', import.meta.url);
    for (const name of NAMES) {
      const text = readFileSync(new URL(`${name}.json`, dir), 'utf8');
      for (const m of text.matchAll(/"path":\s*"([^"]+)"/g)) {
        expect(existsSync(new URL(m[1] ?? '', root)), `${name}: ${m[1]}`).toBe(true);
      }
    }
  });

  it('lifecycle: the same states as the supervisor', () => {
    const states = (read('isolate-lifecycle').states ?? []).map((s) => s.id);
    sameMembers(states, Object.keys(STATES));
  });

  it("lifecycle: the supervisor's default timings and restart limit", () => {
    const d = read('isolate-lifecycle');
    const cfg = DEFAULT_SUPERVISOR_CONFIG;
    expect(label(d.transitions, 't-slow')).toBe(`no beat ${duration(cfg.blockedAfterMs)}`);
    expect(label(d.transitions, 't-kill')).toBe(`no beat ${duration(cfg.killAfterMs)}`);
    expect(label(d.transitions, 't-again')).toBe(
      `under ${cfg.maxRestarts} in ${duration(cfg.withinMs)}`,
    );
    expect(label(read('restart-pool').messages, 'b-dead')).toMatch(
      new RegExp(`^no beat ${duration(cfg.killAfterMs)}\\b`),
    );
  });

  it('bus publish: the default commit interval', () => {
    expect(label(read('bus-publish').flows, 'f-commits')).toBe(
      `commits / ${duration(DEFAULT_COMMIT_INTERVAL_MS)}`,
    );
  });

  it('placement: the manifest field that picks a pool', () => {
    const kernel = read('placement').components?.find((c) => c.id === 'kernel');
    expect(kernel?.sublabel).toBe(`manifest.${POOL_FIELD} decides`);
  });

  // A pool is one worker whatever its size; an own worker holds one isolate.
  it('placement and topology: threads and isolates add up', () => {
    for (const name of ['placement', 'runtime-topology'] as const) {
      const d = read(name);
      for (const b of d.boundaries ?? []) {
        const m = /^(Own workers?|Pool[^·]*)· (\d+) threads? · (\d+) isolates?$/.exec(
          b.label ?? '',
        );
        if (!m) continue;
        const [, kind = '', threads, isolates] = m.map((x) => x?.trim());
        // A card stands for its leading count ("2 visual members"), or one isolate.
        const counted = (b.wraps ?? [])
          .map((id) => /^(\d+) /.exec(label(d.components, id))?.[1] ?? '1')
          .reduce((n, x) => n + Number(x), 0);
        expect(Number(isolates), `${name}: ${b.label}`).toBe(counted);
        if (kind.startsWith('Pool')) expect(Number(threads), `${name}: ${b.label}`).toBe(1);
        else expect(Number(threads), `${name}: ${b.label}`).toBe(Number(isolates));
      }
    }
  });
});
