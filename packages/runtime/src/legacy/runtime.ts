import {
  isHostToIsolate,
  isLegacyHostToIsolate,
  type IsolateToHost,
  type LegacyIsolateToHost,
} from '@isoloop/protocol';
import { h, LEGACY_VDOM, type VNode } from './vdom';

export type Post = (msg: IsolateToHost | LegacyIsolateToHost) => void;

export type Handler = (value: string | null) => void;
export type Subscriber = (value: unknown, from: string) => void;

/** What an M0 isolate module gets: the proof of concept's runtime API. */
export type LegacyIsolate<S extends object> = {
  readonly id: string;
  readonly config: unknown;
  readonly state: S;
  h: typeof h;
  /** Sets the render function. Renders are coalesced to one per task. */
  view(fn: (state: S) => VNode): void;
  setState(patch: Partial<S> | ((state: S) => Partial<S>)): void;
  /** Registers the handler an event prop names, e.g. `on('inc', …)` for `onclick: 'inc'`. */
  on(name: string, fn: Handler): void;
  bus: {
    publish(topic: string, value: unknown): void;
    subscribe(topic: string, fn: Subscriber): void;
  };
};

/** An isolate module's default export. */
export type LegacyIsolateMain<S extends object> = (iso: LegacyIsolate<S>) => void;

export type LegacyIsolateRuntime<S extends object> = {
  iso: LegacyIsolate<S>;
  /** Feeds one message from the host. Unknown messages are dropped and counted. */
  receive(msg: unknown): void;
  /** Messages dropped so far because their `v` or `t` was unknown. */
  readonly dropped: number;
};

export type LegacyContext<S extends object> = {
  id: string;
  config: unknown;
  initial: S;
  post: Post;
};

export function createLegacyIsolate<S extends object>(
  ctx: LegacyContext<S>,
): LegacyIsolateRuntime<S> {
  const { post } = ctx;
  let state: S = ctx.initial;
  let render: ((state: S) => VNode) | null = null;
  let dirty = false;
  let dropped = 0;
  const handlers = new Map<string, Handler>();
  const subs = new Map<string, Subscriber[]>();

  const schedule = (): void => {
    if (dirty) return;
    dirty = true;
    setTimeout(() => {
      dirty = false;
      if (render) post({ v: 1, t: 'patch', p: { fmt: LEGACY_VDOM, batch: render(state) } });
    }, 0);
  };

  const iso: LegacyIsolate<S> = {
    id: ctx.id,
    config: ctx.config,
    get state() {
      return state;
    },
    h,
    view(fn) {
      render = fn;
      schedule();
    },
    setState(patch) {
      state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
      schedule();
    },
    on(name, fn) {
      handlers.set(name, fn);
    },
    bus: {
      publish(topic, value) {
        post({ v: 1, t: 'x-pub', p: { topic, value } });
      },
      subscribe(topic, fn) {
        const list = subs.get(topic);
        if (list) list.push(fn);
        else subs.set(topic, [fn]);
        post({ v: 1, t: 'x-sub', p: { topic } });
      },
    },
  };

  const receive = (msg: unknown): void => {
    if (isHostToIsolate(msg)) {
      // In legacy-vdom@1 the target of an event is the handler name its prop holds.
      if (msg.t === 'event') handlers.get(msg.p.target)?.(msg.p.value ?? null);
      // init is handled by the bootstrap; the host terminates on shutdown in M0;
      // result and reattach arrive with host calls and the bus worker (M1, M2).
      return;
    }
    if (isLegacyHostToIsolate(msg)) {
      for (const fn of subs.get(msg.p.topic) ?? []) fn(msg.p.value, msg.p.from);
      return;
    }
    dropped++;
  };

  return {
    iso,
    receive,
    get dropped() {
      return dropped;
    },
  };
}
