/*
 * Host calls from the isolate side (design §4.7): `call` envelopes answered
 * by `result`, with a 5 s timeout. Pending patches are flushed first, so the
 * host runs the call after the DOM changes made before it.
 */
import type { CallResult, ErrorCode, HostMethod, IsolateToHost, Rect } from '@isoloop/protocol';

/** A host call (`ctx.host`) that failed, with an error code to branch on. */
export class HostCallError extends Error {
  /** What went wrong: `not_found`, `no_surface`, `forbidden`, `invalid`, `timeout`, … */
  readonly code: ErrorCode;
  /**
   * @param code What went wrong.
   * @param message A sentence for people.
   */
  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = 'HostCallError';
    this.code = code;
  }
}

/**
 * What `ctx.host` offers: calls the host runs on the main thread for the
 * isolate. Each runs after the DOM changes made before it, and rejects with a
 * `HostCallError`: `timeout` after 5 s without an answer, `not_found` for a
 * node that isn't rendered, `no_surface` in a headless isolate.
 */
export type HostApi = {
  /**
   * Asks the host to navigate. `/x` resolves against the host's `basePath`.
   * @param href Where to go: same-origin.
   * @param o `replace` the current history entry rather than push one, and the `state` to set.
   * @returns The host's answer: `true` accepted, `false` refused.
   * @throws `HostCallError` `forbidden` without `grants.navigate`, or
   *   `routing_disabled` when the host turned routing off.
   */
  navigate(href: string, o?: { replace?: boolean; state?: unknown }): Promise<boolean>;
  /**
   * Measures a rendered node, after pending changes apply.
   * @param node A node this isolate rendered.
   * @returns Its box relative to the surface, in CSS pixels.
   */
  measure(node: unknown): Promise<Rect>;
  /**
   * Focuses a rendered node on the page.
   * @param node A node this isolate rendered.
   * @returns Resolves once the host has focused it.
   */
  focus(node: unknown): Promise<void>;
  /**
   * Scrolls the page so a rendered node is in view.
   * @param node A node this isolate rendered.
   * @param opts As the DOM's `scrollIntoView` takes them.
   * @returns Resolves once the host has scrolled.
   */
  scrollIntoView(node: unknown, opts?: ScrollIntoViewOptionsLike): Promise<void>;
  /**
   * Hands a rendered `<canvas>` to the isolate as an `OffscreenCanvas`. Draw
   * on it from the worker. The element then gets `resize` events with its CSS
   * `width` and `height`, the first at once.
   * @param node A `<canvas>` this isolate rendered.
   * @param size Its size in canvas pixels, if given.
   * @returns The canvas, transferred to the worker.
   * @throws `HostCallError` `invalid` for a canvas already handed over (each
   *   goes once), `no_surface` in a headless isolate.
   */
  requestCanvas(
    node: unknown,
    size?: { width?: number; height?: number },
  ): Promise<OffscreenCanvas>;
};

/** `scrollIntoView`'s options, typed here since worker code has no DOM types. */
export type ScrollIntoViewOptionsLike = {
  /** Default `'auto'`. */
  behavior?: 'auto' | 'instant' | 'smooth';
  /** Default `'start'`. */
  block?: 'start' | 'center' | 'end' | 'nearest';
  /** Default `'nearest'`. */
  inline?: 'start' | 'center' | 'end' | 'nearest';
};

export type HostCallsOptions = {
  post(msg: IsolateToHost): void;
  /** Flushes pending patches; called before every call. */
  beforeCall(): void;
  /** The node id the host knows `node` by, or `undefined` for something else. */
  idOf(node: unknown): string | undefined;
  /** Whether the isolate has a surface; without one the host answers `no_surface`. */
  surface: boolean;
  /** `grants.navigate`: without it `navigate` rejects here, before reaching the host. */
  navigate: boolean;
  timeoutMs?: number;
};

const isRect = (x: unknown): x is Rect =>
  typeof x === 'object' &&
  x !== null &&
  ['x', 'y', 'width', 'height'].every((k) => typeof Reflect.get(x, k) === 'number');

export function createHostCalls(opts: HostCallsOptions): {
  api: HostApi;
  /** Settles the call a `result` answers. Unknown ids are ignored. */
  receive(re: string, result: CallResult): void;
  /** Calls waiting for an answer. */
  pending(): number;
} {
  const timeoutMs = opts.timeoutMs ?? 5000;
  const pending = new Map<
    string,
    { resolve(v: unknown): void; reject(e: Error): void; timer: ReturnType<typeof setTimeout> }
  >();
  let seq = 0;

  const send = (method: HostMethod, args: unknown[]): Promise<unknown> => {
    const id = `c${++seq}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new HostCallError('timeout', `${method}: no answer within ${timeoutMs} ms`));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      opts.post({ v: 1, t: 'call', id, p: { method, args } });
    });
  };

  const call = (method: HostMethod, node: unknown, extra: unknown[] = []): Promise<unknown> => {
    const nodeId = opts.idOf(node);
    if (opts.surface && nodeId === undefined) {
      return Promise.reject(new HostCallError('not_found', `${method}: not a rendered node`));
    }
    opts.beforeCall();
    return send(method, [nodeId ?? null, ...extra]);
  };

  return {
    api: {
      async navigate(href, o = {}) {
        if (!opts.navigate) {
          throw new HostCallError(
            'forbidden',
            'navigate: this isolate has no navigate grant (ADR 0002)',
          );
        }
        const value = await send('navigate', [
          href,
          { replace: o.replace ?? false, state: o.state },
        ]);
        return value === true;
      },
      async measure(node) {
        const value = await call('measure', node);
        if (!isRect(value)) throw new HostCallError('invalid', 'measure: the host sent no rect');
        return value;
      },
      async focus(node) {
        await call('focus', node);
      },
      async scrollIntoView(node, o) {
        await call('scrollIntoView', node, o === undefined ? [] : [o]);
      },
      async requestCanvas(node, size) {
        const value = await call('requestCanvas', node, size === undefined ? [] : [size]);
        if (!(value instanceof OffscreenCanvas)) {
          throw new HostCallError('invalid', 'requestCanvas: the host sent no OffscreenCanvas');
        }
        return value;
      },
    },
    pending: () => pending.size,
    receive(re, result) {
      const p = pending.get(re);
      if (!p) return;
      pending.delete(re);
      clearTimeout(p.timer);
      if (result.ok) p.resolve(result.value);
      else p.reject(new HostCallError(result.error.code, result.error.message));
    },
  };
}
