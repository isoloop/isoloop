/*
 * Host calls from the isolate side (design §4.7): `call` envelopes answered
 * by `result`, with a 5 s timeout. Pending patches are flushed first, so the
 * host runs the call after the DOM changes made before it.
 */
import type { CallResult, ErrorCode, HostMethod, IsolateToHost, Rect } from '@isoloop/protocol';

/** A host call that failed, with the protocol's error code. */
export class HostCallError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = 'HostCallError';
    this.code = code;
  }
}

/** What `ctx.host` offers until the vanilla API (task 11) adds `navigate`. */
export type HostApi = {
  /** The node's box relative to the surface, after pending patches apply. */
  measure(node: unknown): Promise<Rect>;
  focus(node: unknown): Promise<void>;
  scrollIntoView(node: unknown, opts?: ScrollIntoViewOptionsLike): Promise<void>;
};

export type ScrollIntoViewOptionsLike = {
  behavior?: 'auto' | 'instant' | 'smooth';
  block?: 'start' | 'center' | 'end' | 'nearest';
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
} {
  const timeoutMs = opts.timeoutMs ?? 5000;
  const pending = new Map<
    string,
    { resolve(v: unknown): void; reject(e: Error): void; timer: ReturnType<typeof setTimeout> }
  >();
  let seq = 0;

  const call = (method: HostMethod, node: unknown, extra: unknown[] = []): Promise<unknown> => {
    const nodeId = opts.idOf(node);
    if (opts.surface && nodeId === undefined) {
      return Promise.reject(new HostCallError('not_found', `${method}: not a rendered node`));
    }
    opts.beforeCall();
    const id = `c${++seq}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new HostCallError('timeout', `${method}: no answer within ${timeoutMs} ms`));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      opts.post({ v: 1, t: 'call', id, p: { method, args: [nodeId ?? null, ...extra] } });
    });
  };

  return {
    api: {
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
    },
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
