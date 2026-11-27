/*
 * `@isoloop/runtime/testing`: an `IsolateContext` with no worker, bus or host
 * behind it, for testing adapters and isolate components on a page. The test
 * drives the bus (`emit`, `reset`) and sees what the isolate did
 * (`published`, `subscriptions`, `shutdown`).
 */
import {
  BusError,
  type BusRecord,
  type Rect,
  type ShutdownReason,
  type TopicRef,
  type TypedRecord,
} from '@isoloop/protocol';
import type { BusClient, OnView, SubscribeOptions, WatchOptions } from './bus/bus-client';
import type { HostApi } from './isolate/host-calls';
import type { IsolateContext, IsolateRoot } from './isolate/vanilla';

type Sub = {
  topic: string;
  fn: (r: TypedRecord<unknown>) => void | Promise<void>;
  opts: SubscribeOptions;
};

type Watch = {
  topic: string;
  keys: ReadonlySet<string | null> | undefined;
  onView: OnView<unknown>;
};

/** `createTestContext`'s options. */
export type TestContextOptions = {
  /** `ctx.id`. Default `'test'`. */
  id?: string;
  /** `ctx.config`. Default `null`. */
  config?: unknown;
  /** The render root, for example an element on the test page. Default: none, a headless context. */
  root?: object;
  /** Answers `bus.request`. Default: reject with `timeout` after the request's `timeoutMs`. */
  respond?: (topic: string, value: unknown) => unknown;
  /** Answers host calls. Default: `measure` gives a zero rect, the rest resolve. */
  host?: Partial<HostApi>;
};

/** A context to test an isolate with, and the handles to drive it and see what it did. */
export type TestContext = {
  /** The context to pass to `start(ctx)`, or to render a component with. */
  readonly ctx: IsolateContext;
  /** What `ctx.reportError` got, in order. */
  readonly errors: { error: unknown; fatal: boolean }[];
  /**
   * Delivers a record to every subscription on `topic`, in order, and passes
   * its value to every watch of its key (`null` without a key) as one view.
   */
  emit: (topic: string, value: unknown, key?: string) => void;
  /**
   * Runs `onReset` of every subscription on `topic`, and empties its watches'
   * views, as when a bus restart loses a memory topic.
   */
  reset: (topic: string) => void;
  /** Every `publish`, in order. */
  readonly published: { topic: string; key?: string; value: unknown }[];
  /** Open subscriptions, by topic and start position. */
  subscriptions: () => { topic: string; from: string }[];
  /** Open watches, by topic and keys (`undefined` for every key). @experimental */
  watches: () => { topic: string; keys: (string | null)[] | undefined }[];
  /** Runs the `onShutdown` handlers, as the runtime does on `stop`. `reason` defaults to `'stop'`. */
  shutdown: (reason?: ShutdownReason) => Promise<void>;
};

const ZERO: Rect = { x: 0, y: 0, width: 0, height: 0 };

/**
 * Makes an `IsolateContext` with no worker, bus or host behind it, for
 * testing an isolate or a component on a page. The test drives the bus
 * (`emit`, `reset`) and sees what the isolate did (`published`,
 * `subscriptions`, `errors`). `ctx.inspector` is `undefined`.
 * @param o The id, config, root, and how requests and host calls are answered.
 * @returns The context and its handles.
 */
export function createTestContext(o: TestContextOptions = {}): TestContext {
  const subs = new Set<Sub>();
  const watches = new Set<Watch>();
  /** The newest value per key of each topic emitted to, for watches. */
  const latest = new Map<string, Map<string | null, unknown>>();
  const viewOf = (w: Watch): Map<string | null, unknown> => {
    const all = latest.get(w.topic) ?? new Map<string | null, unknown>();
    if (!w.keys) return new Map(all);
    const view = new Map<string | null, unknown>();
    for (const k of w.keys) if (all.has(k)) view.set(k, all.get(k));
    return view;
  };
  const published: TestContext['published'] = [];
  const shutdownFns: ((reason: ShutdownReason) => void | Promise<void>)[] = [];
  const errors: TestContext['errors'] = [];
  let offset = 0;
  let portal: object | undefined;

  const bus: BusClient = {
    publish(topic, value, opts = {}) {
      published.push(
        opts.key === undefined
          ? { topic: topic.name, value }
          : { topic: topic.name, key: opts.key, value },
      );
      return Promise.resolve();
    },
    subscribe<Out>(
      topic: TopicRef<any, Out, any, any>,
      fn: (r: TypedRecord<Out>) => void | Promise<void>,
      opts: SubscribeOptions = {},
    ) {
      const sub: Sub = {
        topic: topic.name,
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the test emits the topic's values
        fn: fn as (r: TypedRecord<unknown>) => void | Promise<void>,
        opts,
      };
      subs.add(sub);
      return () => {
        subs.delete(sub);
      };
    },
    async request<In, ROut>(
      topic: TopicRef<In, any, any, ROut>,
      value: In,
      ro: { key?: string; timeoutMs?: number } = {},
    ): Promise<ROut> {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the test answers with the reply type
      if (o.respond) return o.respond(topic.name, value) as ROut;
      const timeoutMs = ro.timeoutMs ?? 30_000;
      return new Promise<ROut>((_resolve, reject) => {
        setTimeout(() => {
          reject(
            new BusError({
              code: 'timeout',
              message: `No reply on ${topic.name} within ${timeoutMs} ms`,
            }),
          );
        }, timeoutMs);
      });
    },
    reply: () => Promise.resolve(),
    commit: () => {},
    watch<Out>(topic: TopicRef<any, Out, any, any>, onView: OnView<Out>, wo: WatchOptions = {}) {
      const w: Watch = {
        topic: topic.name,
        keys: wo.keys ? new Set(wo.keys) : undefined,
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the test emits the topic's values
        onView: onView as OnView<unknown>,
      };
      watches.add(w);
      // The snapshot: what was emitted so far, after the caller has the unwatch.
      queueMicrotask(() => {
        if (!watches.has(w)) return;
        const view = viewOf(w);
        void w.onView(view, new Set(view.keys()));
      });
      return () => {
        watches.delete(w);
      };
    },
  };

  const host: HostApi = {
    navigate: () => Promise.resolve(true),
    measure: () => Promise.resolve(ZERO),
    focus: () => Promise.resolve(),
    scrollIntoView: () => Promise.resolve(),
    requestCanvas: () => Promise.resolve(new OffscreenCanvas(1, 1)),
    ...o.host,
  };

  const ctx: IsolateContext = {
    id: o.id ?? 'test',
    config: o.config ?? null,
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- any element on the test page will do
    root: o.root as IsolateRoot | undefined,
    portalRoot: undefined,
    reportError: (error, ro = {}) => {
      errors.push({ error, fatal: ro.fatal ?? true });
    },
    host,
    bus,
    inspector: undefined,
    styles: () => {},
    setValue: () => {},
    onShutdown: (fn) => {
      shutdownFns.push(fn);
    },
    keepAwake: () => () => {},
  };

  // Made on first read, and not enumerable, as in the runtime.
  Object.defineProperty(ctx, 'portalRoot', {
    enumerable: false,
    get() {
      const root = o.root;
      if (!root) return undefined;
      if (!portal) {
        // Any DOM-like root: its document makes the container (no DOM lib here).
        const doc: unknown = Reflect.get(root, 'ownerDocument');
        const make: unknown = doc ? Reflect.get(doc, 'createElement') : undefined;
        if (typeof make !== 'function') return undefined;
        const div: unknown = Reflect.apply(make, doc, ['div']);
        if (typeof div !== 'object' || div === null) return undefined;
        const set: unknown = Reflect.get(div, 'setAttribute');
        const add: unknown = Reflect.get(root, 'appendChild');
        if (typeof set !== 'function' || typeof add !== 'function') return undefined;
        Reflect.apply(set, div, ['data-isoloop-portal', '']);
        // After the render that asked for it has committed, as in the runtime.
        queueMicrotask(() => {
          if (Reflect.get(div, 'parentNode') !== root) Reflect.apply(add, root, [div]);
        });
        portal = div;
      }
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- an element on the test page
      return portal as IsolateRoot;
    },
  });

  return {
    ctx,
    errors,
    published,
    emit(topic, value, key) {
      const rec: BusRecord = {
        offset: offset++,
        value,
        ts: Date.now(),
        producer: 'test',
        ...(key === undefined ? {} : { key }),
      };
      for (const s of subs) if (s.topic === topic) void s.fn(rec);
      const k = key ?? null;
      let values = latest.get(topic);
      if (!values) latest.set(topic, (values = new Map<string | null, unknown>()));
      values.set(k, value);
      for (const w of watches) {
        if (w.topic === topic && (!w.keys || w.keys.has(k))) void w.onView(viewOf(w), new Set([k]));
      }
    },
    reset(topic) {
      for (const s of subs) if (s.topic === topic) s.opts.onReset?.();
      const lost = latest.get(topic);
      latest.delete(topic);
      for (const w of watches) {
        if (w.topic !== topic) continue;
        const changed = new Set([...(lost?.keys() ?? [])].filter((k) => !w.keys || w.keys.has(k)));
        if (changed.size > 0) void w.onView(viewOf(w), changed);
      }
    },
    subscriptions: () => [...subs].map((s) => ({ topic: s.topic, from: s.opts.from ?? 'latest' })),
    watches: () =>
      [...watches].map((w) => ({ topic: w.topic, keys: w.keys ? [...w.keys] : undefined })),
    async shutdown(reason = 'stop') {
      await Promise.allSettled(shutdownFns.map(async (fn) => fn(reason)));
    },
  };
}
