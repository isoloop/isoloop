/*
 * `@isoloop/dom/testing/worker`: test tools that run inside a fixture worker
 * (M3a tasks 2 and 3). Not in `@isoloop/dom/testing`, which imports Vitest: a
 * worker can't.
 *
 * - `serveFixture()` installs the subset as the worker's `document` and wires
 *   it to `mountFixture()` on the page: batches out, host events in.
 * - `trackUsage()` logs which members of the subset a framework touches while
 *   it renders, and which it reaches for that the subset doesn't have. The M1
 *   spike did the same on Remote DOM's polyfill. It wraps every accessor and
 *   method on the subset's prototypes (calls the subset makes to itself
 *   included), and puts a `Proxy` under the bottom of their chain, so a
 *   lookup that finds nothing lands in its trap. Properties a framework
 *   writes onto nodes itself (Preact's `l`, React's `__reactFiber$…`) are
 *   expandos, not missing members: the trap sees their first write and
 *   leaves them out. It patches classes for the whole realm, so it runs in a
 *   worker of its own.
 *
 * Messages to the page: `{ t: 'batch', batch }`, `{ t: 'usage', log }` and
 * `{ t: 'error', error }`; from it: `{ t: 'event', event }`.
 */
import { DOM_GLOBALS } from '../worker/install';
import type { DomBatch, DomEvent } from '../shared/records';
import {
  createDom,
  WCharacterData,
  WDocument,
  WElement,
  WEventTarget,
  WParentNode,
  type WorkerDom,
} from '../worker/dom';
import { install } from '../worker/install';

/** One framework major's log, as `packages/dom/usage/<project>.json` stores it. */
export type UsageLog = {
  /** E.g. `preact@10.29.8`. */
  framework: string;
  /** `Class.member` for every member of the subset that was read, written or called. */
  used: string[];
  /** Members looked up that nothing in the subset defines (reads that came back `undefined`). */
  missing: string[];
  /** Names checked with `in` that the subset doesn't define: feature probes, not uses. */
  probed: string[];
};

export type UsageTracker = {
  /** The log so far, sorted. */
  report(framework: string): UsageLog;
};

/** Everything a framework sees: the classes `install()` exposes, and `document`. */
const CLASSES: [string, { prototype: object }][] = [
  ['EventTarget', WEventTarget],
  // Not globals, but where the shared members live.
  ['ParentNode', WParentNode],
  ['CharacterData', WCharacterData],
  ...Object.entries(DOM_GLOBALS).flatMap(([name, C]): [string, { prototype: object }][] =>
    typeof C === 'function' ? [[name, C as { prototype: object }]] : [],
  ),
  ['Document', WDocument],
];

/** React's own markers (`_reactRootContainer`, `__reactFiber$…`), read before they're written, or never. */
const ownedByFramework = (key: string): boolean => /^_+react/.test(key);

const sorted = (xs: Iterable<string>): string[] => {
  const out = [...xs];
  out.sort();
  return out;
};

/** What a fixture worker posts to the page. */
export type FixtureMessage =
  | { t: 'batch'; batch: DomBatch }
  | { t: 'usage'; log: UsageLog }
  | { t: 'error'; error: string };

const post = (msg: FixtureMessage): void => {
  postMessage(msg);
};

const fail = (err: unknown): void => {
  post({ t: 'error', error: err instanceof Error ? (err.stack ?? err.message) : String(err) });
};

const isEventMessage = (x: unknown): x is { t: 'event'; event: DomEvent } =>
  typeof x === 'object' && x !== null && Reflect.get(x, 't') === 'event';

/**
 * Installs the subset as this worker's `document`, posts every batch, and
 * delivers the page's events. Import it before the framework: React decides
 * at load time whether it has a DOM. Uncaught errors are posted with their
 * stack, which a worker `error` event doesn't carry.
 */
export function serveFixture(): { dom: WorkerDom; container: Element } {
  const dom = createDom({ onBatch: (batch) => post({ t: 'batch', batch }) });
  install(dom, self);
  addEventListener('message', (e: MessageEvent<unknown>) => {
    if (isEventMessage(e.data)) dom.deliver(e.data.event);
  });
  // Frameworks commit from their own tasks, so errors come from anywhere.
  addEventListener('error', (e) => {
    e.preventDefault();
    fail(e.error);
  });
  addEventListener('unhandledrejection', (e) => {
    e.preventDefault();
    fail(e.reason);
  });
  // `install()` made the subset's classes the worker's: the root is an `Element` now.
  const container: unknown = dom.root;
  if (!(container instanceof Element)) throw new Error('the subset is not installed');
  return { dom, container };
}

/** Starts logging. Call before the framework renders; it can't be undone. */
export function trackUsage(): UsageTracker {
  const used = new Set<string>();
  const missing = new Set<string>();
  const probed = new Set<string>();
  const expandos = new Set<string>();

  const seen = new Set<object>();
  for (const [name, C] of CLASSES) {
    const proto = C.prototype;
    if (seen.has(proto)) continue;
    seen.add(proto);
    for (const key of Reflect.ownKeys(proto)) {
      // Internal members are ours, not the DOM's.
      if (typeof key !== 'string' || key === 'constructor' || key.startsWith('iso')) continue;
      const d = Object.getOwnPropertyDescriptor(proto, key);
      if (!d) continue;
      const tag = `${name}.${key}`;
      const wrap = (fn: Function) =>
        function (this: unknown, ...args: unknown[]): unknown {
          used.add(tag);
          return Reflect.apply(fn, this, args) as unknown;
        };
      for (const part of ['value', 'get', 'set'] as const) {
        const fn: unknown = Reflect.get(d, part);
        if (typeof fn === 'function') Reflect.set(d, part, wrap(fn));
      }
      Object.defineProperty(proto, key, d);
    }
  }

  // Own fields set in constructors (`nodeType`, `ownerDocument`…) aren't on a
  // prototype, so reads of them aren't logged; they exist, which is what the
  // check needs.
  const base: object = Object.prototype;
  const trap = new Proxy(base, {
    get(target, key, receiver) {
      if (
        typeof key === 'string' &&
        !(key in target) &&
        !expandos.has(key) &&
        !ownedByFramework(key)
      )
        missing.add(key);
      return Reflect.get(target, key, receiver) as unknown;
    },
    has(target, key) {
      if (
        typeof key === 'string' &&
        !(key in target) &&
        !expandos.has(key) &&
        !ownedByFramework(key)
      )
        probed.add(key);
      return Reflect.has(target, key);
    },
    set(target, key, value, receiver: unknown) {
      if (typeof key === 'string' && !(key in target)) {
        expandos.add(key);
        missing.delete(key);
        probed.delete(key);
        if (typeof receiver !== 'object' || receiver === null) return false;
        return Reflect.defineProperty(receiver, key, {
          value,
          writable: true,
          enumerable: true,
          configurable: true,
        });
      }
      return Reflect.set(target, key, value, receiver);
    },
  });
  Object.setPrototypeOf(WEventTarget.prototype, trap);

  return {
    report: (framework) => ({
      framework,
      used: sorted(used),
      missing: sorted([...missing].filter((k) => !expandos.has(k))),
      probed: sorted([...probed].filter((k) => !expandos.has(k))),
    }),
  };
}

const mods = { alt: false, ctrl: false, meta: false, shift: false };

/** The first element under `from` with this tag (and `name` attribute, if given). */
function find(from: WElement, tag: string, name?: string): WElement | null {
  for (let n = from.firstChild; n; n = n.nextSibling) {
    if (!(n instanceof WElement)) continue;
    if (n.localName === tag && (name === undefined || n.getAttribute('name') === name)) return n;
    const deeper = find(n, tag, name);
    if (deeper) return deeper;
  }
  return null;
}

/**
 * Drives the usage fixture the way a user would, through host events: the
 * fixture renders `<button name="toggle">` (hides and shows a conditional
 * child), `<button name="reorder">` (reverses a keyed list), a controlled
 * `<input>` and a `<select>`. `settle` waits for the framework to commit.
 */
export async function driveUsageFixture(
  dom: WorkerDom,
  settle: () => Promise<void>,
): Promise<void> {
  const send = (tag: string, name: string | undefined, type: string, value?: string) => {
    const el = find(dom.root, tag, name);
    if (!el) throw new Error(`usage fixture: no <${tag}${name ? ` name=${name}` : ''}> rendered`);
    dom.deliver({
      type,
      target: dom.idOf(el),
      currentTargets: [],
      mods,
      ...(value === undefined ? {} : { value }),
    });
  };
  await settle();
  for (const step of [
    () => send('button', 'toggle', 'click'),
    () => send('button', 'reorder', 'click'),
    () => send('input', undefined, 'input', 'typed'),
    () => send('select', undefined, 'change', 'b'),
    () => send('button', 'toggle', 'click'),
  ]) {
    step();
    // One step at a time: each waits for the framework to commit the last.
    // oxlint-disable-next-line no-await-in-loop
    await settle();
  }
}

/** Runs the fixture, lets the framework settle, and posts the log (or the error). */
export async function reportUsage(
  tracker: UsageTracker,
  framework: string,
  run: () => Promise<void>,
): Promise<void> {
  try {
    await run();
    await new Promise((r) => setTimeout(r, 10));
    post({ t: 'usage', log: tracker.report(framework) });
  } catch (err) {
    fail(err);
  }
}
