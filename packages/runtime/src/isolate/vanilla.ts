/*
 * The vanilla isolate API (design §5): a module whose default export is
 * `{ start(ctx) }` renders with plain DOM calls on `ctx.root`, which is the
 * isoloop-dom subset installed as the worker's `document`. Adapters (M3)
 * build on the same context.
 */
import { createInspectorClient, type IsolateInspector } from './inspector';
import {
  isHostToIsolate,
  majorMinor,
  type IdleReport,
  type InitPayload,
  type IsolateToHost,
  type ShutdownReason,
} from '@isoloop/protocol';
import { createBusClient, type BusClient } from '../bus/bus-client';
import { BUSY, busy, type BusyHook, type MemberKey } from '../pools/busy';
import { createHostCalls, type HostApi } from './host-calls';
import { createKeepAwake } from './keep-awake';
import { WNode } from '@isoloop/dom/worker';
import { createRender } from '../render/render';
import { version } from '../../package.json';

/**
 * What a render root offers, structurally, so DOM-typed isolate code can pass
 * its own nodes. Each member works as the DOM's. Use
 * `defineIsolate<HTMLElement>(…)` to get the DOM's types instead.
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

/** An isolate's whole world, as `start(ctx)` gets it. */
export type IsolateContext<Root = IsolateRoot> = {
  /** The isolate's id, from the manifest. */
  readonly id: string;
  /** `manifest.config`, passed through. */
  readonly config: unknown;
  /** The render target inside the surface; `undefined` for a headless isolate. */
  readonly root: Root | undefined;
  /**
   * A container inside `root` for modals, tooltips, toasts and menus that
   * libraries would otherwise render into `document.body`, which reaches no
   * surface. Made on first use, typically from a component while it renders,
   * and added as `root`'s last child once that render has committed;
   * `undefined` for a headless isolate.
   */
  readonly portalRoot: Root | undefined;
  /** Calls the host runs on the main thread: navigate, measure, focus, scroll, hand over a canvas. */
  readonly host: HostApi;
  /** The bus, on its own port to the bus worker. */
  readonly bus: BusClient;
  /**
   * The inspection feed and its controls, on a port of its own to the host;
   * `undefined` unless the isolate holds `inspect: true`.
   * @experimental
   */
  readonly inspector: IsolateInspector | undefined;
  /**
   * Adds stylesheets to the surface; a no-op when headless.
   * @param css One stylesheet's text, or several.
   */
  styles(css: string | readonly string[]): void;
  /**
   * Sets an `<input>`'s, `<textarea>`'s or `<select>`'s value. The host owns
   * a focused input's value, so a plain `input.value = …` waits until the
   * user leaves it; with `force` the host applies it at once and keeps the
   * caret at the end, for example to clear a chat box after sending.
   * @param node The element, as this isolate rendered it.
   * @param value The new value.
   * @param opts `force`: apply it even while the user is in the field. Default false.
   */
  setValue(node: unknown, value: string, opts?: { force?: boolean }): void;
  /**
   * Reports an error as this isolate's own: framework adapters call it for a
   * render error their boundary caught, so in a pool it crashes only this
   * member, not the whole worker.
   * @param error What was thrown.
   * @param opts `fatal`: crash the isolate, which the host restarts as usual.
   *   Default true. With false the host emits `isolate:error` and the isolate
   *   keeps running.
   */
  reportError(error: unknown, opts?: { fatal?: boolean }): void;
  /**
   * Adds a handler that runs on stop, within the host's grace period (1 s),
   * before the worker goes.
   * @param fn Gets why the isolate is stopping; may return a promise.
   */
  onShutdown(fn: (reason: ShutdownReason) => void | Promise<void>): void;
  /**
   * Holds the isolate against suspension. Only matters for isolates spawned
   * with `suspend`.
   * @returns The function that releases the hold.
   */
  keepAwake(): () => void;
};

/** An isolate module's default export: what `defineIsolate` returns. */
export type IsolateDefinition<Root = IsolateRoot> = {
  /**
   * Runs once, when the isolate starts in its worker. A `start` that throws,
   * or whose promise rejects, crashes the isolate.
   */
  start(ctx: IsolateContext<Root>): void | Promise<void>;
  /**
   * The Isoloop `major.minor` it was built against, stamped by
   * `defineIsolate`. The host fails an isolate built for a newer Isoloop, or
   * for one older than it still runs; a definition without one isn't checked.
   */
  requires?: string;
};

/**
 * This build's stamp: `major.minor` of the package version, inlined when tsdown bundles it.
 *
 * @internal
 */
export const REQUIRES: string = majorMinor(version) ?? '0.0';

/**
 * Types an isolate module's default export and stamps it with the version
 * it was built against.
 * @param def The isolate: its `start(ctx)`.
 * @returns The definition, with `requires` set to this build's `major.minor`.
 * @example
 * ```ts
 * import { defineIsolate } from '@isoloop/runtime';
 * import { count } from './topics';
 *
 * export default defineIsolate<HTMLElement>({
 *   start(ctx) {
 *     const button = document.createElement('button');
 *     button.textContent = 'Add one';
 *     button.addEventListener('click', () => void ctx.bus.publish(count, { value: 1 }));
 *     ctx.root?.append(button);
 *   },
 * });
 * ```
 */
export function defineIsolate<Root = IsolateRoot>(
  def: IsolateDefinition<Root>,
): IsolateDefinition<Root> {
  return { requires: REQUIRES, ...def };
}

type Post = (msg: IsolateToHost) => void;

export type VanillaRuntime = {
  ctx: IsolateContext<unknown>;
  renderFmt: string;
  /** Feeds one message from the host: events, results and bus deliveries. */
  receive(msg: unknown): void;
  /** The host's `inspect` port (ADR 0020, decision 6); ignored without the grant. */
  attachInspect(port: MessagePort): void;
  /** Runs the `onShutdown` handlers; resolves when all have settled. */
  shutdown(reason: ShutdownReason): Promise<void>;
  /** For the beat: whether the isolate could be suspended now. */
  idle(): IdleReport;
};

/** Builds the context for `start(ctx)`. `scope` is the worker global the DOM subset installs on. */
export function createVanillaIsolate(
  init: InitPayload,
  post: Post,
  scope: object,
  /** A pool member: a visual one gets its own root in the worker's shared document (ADR 0015). */
  pooled = false,
  /** The member it is, for busy time (ADR 0017); `null` outside the bootstrap. */
  member: MemberKey | null = null,
): VanillaRuntime {
  const render = init.renderFmt === 'none' ? null : createRender(post, scope, pooled, member);
  const calls = createHostCalls({
    post,
    beforeCall: () => render?.flush(),
    idOf: (node) => (render ? render.idOf(node) : undefined),
    surface: render !== null,
    navigate: init.grants.navigate === true,
  });
  const awake = createKeepAwake();
  const bus = createBusClient(init.busPort, {
    ...(init.wake ? { wake: true } : {}),
    ...(init.commitIntervalMs === undefined ? {} : { commitIntervalMs: init.commitIntervalMs }),
    onError: (err) => {
      const p =
        err instanceof Error && err.stack !== undefined
          ? { message: err.message, stack: err.stack, fatal: false }
          : { message: String(err), fatal: false };
      post({ v: 1, t: 'error', p });
    },
  });
  const onShutdown: ((reason: ShutdownReason) => void | Promise<void>)[] = [];
  let portal: unknown;
  const inspect = init.grants.inspect === true ? createInspectorClient() : undefined;

  const ctx: IsolateContext<unknown> = {
    id: init.isolateId,
    config: init.config,
    root: render?.root,
    portalRoot: undefined,
    reportError(error, o = {}) {
      const fatal = o.fatal ?? true;
      const p =
        error instanceof Error
          ? {
              message: error.message,
              ...(error.stack === undefined ? {} : { stack: error.stack }),
              fatal,
            }
          : { message: String(error), fatal };
      post({ v: 1, t: 'error', p });
    },
    host: calls.api,
    bus: bus.client,
    inspector: inspect?.inspector,
    styles: (css) => render?.styles(css),
    setValue(node, value, o) {
      if (!render) return;
      if (!(node instanceof WNode)) throw new TypeError('setValue: not a node of this isolate');
      render.setValue(node, value, o);
    },
    onShutdown: (fn) => {
      onShutdown.push(fn);
    },
    keepAwake: () => awake.hold(),
  };

  // For adapters (ADR 0017): React names the container it renders, Preact
  // binds its render batches. Not enumerable, like the portal root.
  if (member !== null) {
    const hook: BusyHook = {
      claim: (container) => {
        busy.claim(container, member);
      },
      bind: (fn) => busy.bind(fn),
    };
    Object.defineProperty(ctx, BUSY, { value: hook, enumerable: false });
  }

  // Made on first read. Not enumerable, so code that walks the context's
  // properties (React's dev tooling reads props) doesn't make it early.
  Object.defineProperty(ctx, 'portalRoot', {
    enumerable: false,
    get() {
      if (!render) return undefined;
      if (!portal) {
        const { root } = render;
        const div = root.ownerDocument.createElement('div');
        div.setAttribute('data-isoloop-portal', '');
        // Attached after the current task's render has committed: React and
        // Preact clear the container's other children on their first render.
        queueMicrotask(() => {
          if (div.parentNode !== root) root.appendChild(div);
        });
        portal = div;
      }
      return portal;
    },
  });

  return {
    ctx,
    renderFmt: render ? render.fmt : 'none',
    attachInspect(port) {
      if (inspect) inspect.attach(port);
      else port.close();
    },
    receive(msg) {
      if (isHostToIsolate(msg)) {
        if (msg.t === 'event') render?.receive(msg.p);
        else if (msg.t === 'reattach') bus.reattach(msg.p.busPort);
        else if (msg.t === 'result' && msg.re !== undefined) calls.receive(msg.re, msg.p);
      }
    },
    idle() {
      const b = bus.idle();
      return {
        sinceDeliveryMs: b.sinceDeliveryMs,
        inFlight: b.inFlight + calls.pending(),
        holds: awake.report(performance.now()),
      };
    },
    async shutdown(reason) {
      await Promise.allSettled(onShutdown.map(async (fn) => fn(reason)));
      // Its handlers may still inspect; after them the port ends (ADR 0020).
      inspect?.end();
      // Before `bye`, for every reason: a graceful stop or a suspend loses no commit.
      await bus.close();
      render?.flush();
      render?.dispose();
    },
  };
}
