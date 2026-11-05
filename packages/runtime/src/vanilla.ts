/*
 * The vanilla isolate API (design §5): a module whose default export is
 * `{ start(ctx) }` renders with plain DOM calls on `ctx.root`, which is the
 * isoloop-dom subset installed as the worker's `document`. Adapters (M3)
 * build on the same context.
 */
import {
  isHostToIsolate,
  isLegacyHostToIsolate,
  type InitPayload,
  type IsolateToHost,
  type LegacyIsolateToHost,
  type ShutdownReason,
} from '@isoloop/protocol';
import { createBusClient, type BusClient } from './bus-client';
import { createHostCalls, type HostApi } from './host-calls';
import { createRender } from './render';

/**
 * What a render root offers, structurally, so DOM-typed isolate code can pass
 * its own nodes. Use `defineIsolate<HTMLElement>(…)` to get the DOM's types.
 */
export interface IsolateRoot {
  append(...nodes: (object | string)[]): void;
  replaceChildren(...nodes: (object | string)[]): void;
  appendChild<T extends object>(node: T): T;
  insertBefore<T extends object>(node: T, ref: object | null): T;
  removeChild<T extends object>(node: T): T;
  readonly childNodes: ArrayLike<object>;
  textContent: string | null;
  addEventListener(type: string, fn: (event: never) => void, options?: unknown): void;
}

/**
 * M0's main-thread bus over the isolate port, kept as `ctx.legacyBus` until
 * four-loops moves to topics (M2 task 11), which removes it.
 */
export type LegacyBus = {
  publish(topic: string, value: unknown): void;
  subscribe(topic: string, fn: (value: unknown, from: string) => void): void;
};

export type IsolateContext<Root = IsolateRoot> = {
  readonly id: string;
  /** `manifest.config`, passed through. */
  readonly config: unknown;
  /** The render target; `undefined` for a headless isolate (ADR 0008). */
  readonly root: Root | undefined;
  readonly host: HostApi;
  /** The log bus, on its own port to the bus worker (design §5). */
  readonly bus: BusClient;
  /** M0's main-thread bus, until four-loops moves to topics; removed in M2 task 11. */
  readonly legacyBus: LegacyBus;
  /** Adds stylesheets to the surface (design §4.8); a no-op when headless. */
  styles(css: string | readonly string[]): void;
  /** Runs on stop, within the host's grace period, before the worker goes. */
  onShutdown(fn: (reason: ShutdownReason) => void | Promise<void>): void;
  /** Holds the isolate against suspension (ADR 0001). A no-op until M2 builds suspension. */
  keepAwake(): () => void;
};

export type IsolateDefinition<Root = IsolateRoot> = {
  start(ctx: IsolateContext<Root>): void | Promise<void>;
};

/** Types an isolate module's default export. `Root` defaults to the structural `IsolateRoot`. */
export function defineIsolate<Root = IsolateRoot>(
  def: IsolateDefinition<Root>,
): IsolateDefinition<Root> {
  return def;
}

type Post = (msg: IsolateToHost | LegacyIsolateToHost) => void;

export type VanillaRuntime = {
  ctx: IsolateContext<unknown>;
  renderFmt: string;
  /** Feeds one message from the host: events, results and bus deliveries. */
  receive(msg: unknown): void;
  /** Runs the `onShutdown` handlers; resolves when all have settled. */
  shutdown(reason: ShutdownReason): Promise<void>;
};

/** Builds the context for `start(ctx)`. `scope` is the worker global the DOM subset installs on. */
export function createVanillaIsolate(init: InitPayload, post: Post, scope: object): VanillaRuntime {
  const render = init.renderFmt === 'none' ? null : createRender(post, scope);
  const calls = createHostCalls({
    post,
    beforeCall: () => render?.dom.flush(),
    idOf: (node) => (render ? render.idOf(node) : undefined),
    surface: render !== null,
    navigate: init.grants.navigate === true,
  });
  const subs = new Map<string, ((value: unknown, from: string) => void)[]>();
  const bus = createBusClient(init.busPort, {
    onError: (err) => {
      const p =
        err instanceof Error && err.stack !== undefined
          ? { message: err.message, stack: err.stack, fatal: false }
          : { message: String(err), fatal: false };
      post({ v: 1, t: 'error', p });
    },
  });
  const onShutdown: ((reason: ShutdownReason) => void | Promise<void>)[] = [];

  const ctx: IsolateContext<unknown> = {
    id: init.isolateId,
    config: init.config,
    root: render?.root,
    host: calls.api,
    bus: bus.client,
    legacyBus: {
      publish(topic, value) {
        post({ v: 1, t: 'x-pub', p: { topic, value } });
      },
      subscribe(topic, fn) {
        const list = subs.get(topic);
        if (list) list.push(fn);
        else {
          subs.set(topic, [fn]);
          post({ v: 1, t: 'x-sub', p: { topic } });
        }
      },
    },
    styles: (css) => render?.styles(css),
    onShutdown: (fn) => {
      onShutdown.push(fn);
    },
    keepAwake: () => () => {},
  };

  return {
    ctx,
    renderFmt: render ? render.fmt : 'none',
    receive(msg) {
      if (isHostToIsolate(msg)) {
        if (msg.t === 'event') render?.receive(msg.p);
        else if (msg.t === 'reattach') bus.reattach(msg.p.busPort);
        else if (msg.t === 'result' && msg.re !== undefined) calls.receive(msg.re, msg.p);
        return;
      }
      if (isLegacyHostToIsolate(msg)) {
        for (const fn of subs.get(msg.p.topic) ?? []) fn(msg.p.value, msg.p.from);
      }
    },
    async shutdown(reason) {
      await Promise.allSettled(onShutdown.map(async (fn) => fn(reason)));
      render?.dom.flush();
    },
  };
}
