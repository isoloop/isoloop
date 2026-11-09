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
import type { BusClient, SubscribeOptions } from './bus-client';
import type { HostApi } from './host-calls';
import type { IsolateContext, IsolateRoot } from './vanilla';

type Sub = {
  topic: string;
  fn: (r: TypedRecord<unknown>) => void | Promise<void>;
  opts: SubscribeOptions;
};

export type TestContextOptions = {
  id?: string;
  config?: unknown;
  /** The render root, e.g. an element on the test page; omit for a headless context. */
  root?: object;
  /** Answers `bus.request`; default: reject with `timeout` after the request's `timeoutMs`. */
  respond?: (topic: string, value: unknown) => unknown;
  /** Answers host calls; default: `measure` gives a zero rect, the rest resolve. */
  host?: Partial<HostApi>;
};

export type TestContext = {
  readonly ctx: IsolateContext;
  /** What `ctx.reportError` got, in order. */
  readonly errors: { error: unknown; fatal: boolean }[];
  /** Delivers a record to every subscription on `topic`, in order. */
  emit: (topic: string, value: unknown, key?: string) => void;
  /** Runs `onReset` of every subscription on `topic` (a bus restart lost it, ADR 0007). */
  reset: (topic: string) => void;
  /** Every `publish`, in order. */
  readonly published: { topic: string; key?: string; value: unknown }[];
  /** Open subscriptions, by topic and start position. */
  subscriptions: () => { topic: string; from: string }[];
  /** Runs the `onShutdown` handlers, as the runtime does on `stop`. */
  shutdown: (reason?: ShutdownReason) => Promise<void>;
};

const ZERO: Rect = { x: 0, y: 0, width: 0, height: 0 };

export function createTestContext(o: TestContextOptions = {}): TestContext {
  const subs = new Set<Sub>();
  const published: TestContext['published'] = [];
  const shutdownFns: ((reason: ShutdownReason) => void | Promise<void>)[] = [];
  const errors: TestContext['errors'] = [];
  let offset = 0;
  let portal: object | undefined;

  const bus: BusClient = {
    publish(topic, rec) {
      published.push(
        rec.key === undefined
          ? { topic: topic.name, value: rec.value }
          : { topic: topic.name, key: rec.key, value: rec.value },
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
    },
    reset(topic) {
      for (const s of subs) if (s.topic === topic) s.opts.onReset?.();
    },
    subscriptions: () => [...subs].map((s) => ({ topic: s.topic, from: s.opts.from ?? 'latest' })),
    async shutdown(reason = 'stop') {
      await Promise.allSettled(shutdownFns.map(async (fn) => fn(reason)));
    },
  };
}
