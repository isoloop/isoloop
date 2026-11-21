/*
 * Per-member busy time (M3h, ADR 0017): how long the worker spent running
 * each member's code during a heartbeat interval, reported as
 * `IdleReport.busyMs`.
 *
 * The runtime runs a member's code in a *frame*: the work it dispatches to
 * that member (host messages, `start`, DOM flushes), and every callback the
 * member registered with a timer, `requestAnimationFrame`, `queueMicrotask`,
 * `requestIdleCallback` or a `MessagePort` listener. A callback belongs to the
 * member whose frame registered it, so chains (a timer that sets a timer)
 * stay with their member. Each frame costs two `performance.now()` calls.
 *
 * A framework shared by a pool's members (ADR 0015) renders several of them
 * in one task. Such a frame *reports roots*: React's commit hook and the DOM
 * subset's first change to a root since its last flush name the member that
 * root belongs to. A frame that reported roots splits its time equally among
 * them instead of billing its owner; a callback registered in it belongs to
 * the next root it reports (React commits a root right after running its
 * effects), or to the frame's owner if none follows.
 *
 * Not attributed: promise continuations (an `await` in a member's code runs
 * outside any frame), module evaluation, other schedulers, and work shared by
 * the worker (garbage collection). That time shows only in the worker's
 * `lagMs`.
 *
 * Each member instance holds a *life* (ADR 0015, decision 9, amended): a
 * callback carries the life of the member it was billed to, and once that
 * life ends (the member stopped, its `onShutdown` handlers settled) the
 * callback no longer runs. The gating is lazy: an interval clears itself and
 * a port closes the next time they fire; a pending timeout keeps its closure
 * until then. A restart under the same name begins a new life.
 */

/** A member, by its `isolate` name; `undefined` is an own worker's isolate. */
export type MemberKey = string | undefined;

/** Not yet known: a callback registered in a frame that may still report a root. */
const PENDING: unique symbol = Symbol('pending');

/** One member instance's lifetime: its callbacks stop running once it ends. */
export type Life = { readonly key: MemberKey; ended: boolean };

/**
 * Who a callback is billed to. `key` `null`: nobody (registered outside any
 * frame). `life`: the member instance, when known; `null` is never gated.
 */
export type Owner = { key: MemberKey | null | typeof PENDING; life: Life | null };

type Frame = {
  owner: Owner;
  /** When it last started or resumed. */
  start: number;
  /** Time so far, excluding nested frames. */
  spent: number;
  parent: Frame | null;
  /** Members whose roots it reported, in order. */
  roots: MemberKey[] | null;
  /** Owners registered in it since the last reported root. */
  pending: Owner[] | null;
};

export type Busy = {
  /** Runs `fn` as `owner`'s code. Errors propagate; the frame ends either way. */
  run<A extends unknown[], T>(
    owner: Owner,
    fn: (this: unknown, ...args: A) => T,
    self: unknown,
    args: A,
  ): T;
  /** The owner a callback registered now belongs to. */
  capture(): Owner;
  /** An owner fixed to `key`, in `life` (by default the key's current one). */
  of(key: MemberKey, life?: Life | null): Owner;
  /** A new member instance of `key` begins: its callbacks run until `end`. */
  begin(key: MemberKey): Life;
  /** The instance stopped: callbacks registered as it no longer run. */
  end(life: Life): void;
  /** `fn` run as the owner that is current now, for schedulers the runtime can't see (Preact's). */
  bind<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R;
  /** A root of `key` (in `life`, by default its current one) did work in the current frame. A no-op outside any frame. */
  report(key: MemberKey, life?: Life | null): void;
  /** The milliseconds billed to `key` since the last call, then zero. */
  take(key: MemberKey): number;
  /** Maps a render container to the member it belongs to (React's commit hook names containers). */
  claim(container: object, key: MemberKey): void;
  /** The member a container was claimed for, if any. */
  keyOf(container: unknown): MemberKey | null;
  /** The member and its life a container was claimed for, if any. */
  rootOf(container: unknown): { key: MemberKey; life: Life | null } | null;
};

export function createBusy(now: () => number = () => performance.now()): Busy {
  let frame: Frame | null = null;
  const spent = new Map<MemberKey, number>();
  const containers = new WeakMap<object, { key: MemberKey; life: Life | null }>();
  /** Each key's current life. */
  const lives = new Map<MemberKey, Life>();
  const lifeOf = (key: MemberKey): Life | null => lives.get(key) ?? null;

  const bill = (key: MemberKey, ms: number): void => {
    spent.set(key, (spent.get(key) ?? 0) + ms);
  };

  const settle = (f: Frame): void => {
    const fallback = f.owner.key === PENDING ? null : f.owner.key;
    if (f.pending)
      for (const o of f.pending) {
        o.key = fallback;
        o.life = f.owner.life;
      }
    if (f.roots && f.roots.length > 0) {
      const unique = [...new Set(f.roots)];
      const share = f.spent / unique.length;
      for (const key of unique) bill(key, share);
    } else if (fallback !== null) bill(fallback, f.spent);
  };

  const busy: Busy = {
    run(owner, fn, self, args) {
      const t = now();
      const outer = frame;
      if (outer) outer.spent += t - outer.start;
      const f: Frame = { owner, start: t, spent: 0, parent: outer, roots: null, pending: null };
      frame = f;
      try {
        return fn.apply(self, args);
      } finally {
        const end = now();
        f.spent += end - f.start;
        frame = outer;
        if (outer) outer.start = end;
        settle(f);
      }
    },
    capture() {
      const f = frame;
      if (!f) return { key: null, life: null };
      const o: Owner = { key: PENDING, life: null };
      (f.pending ??= []).push(o);
      return o;
    },
    of: (key, life) => ({ key, life: life === undefined ? lifeOf(key) : life }),
    begin(key) {
      const life: Life = { key, ended: false };
      lives.set(key, life);
      return life;
    },
    end(life) {
      life.ended = true;
      if (lives.get(life.key) === life) {
        lives.delete(life.key);
        spent.delete(life.key);
      }
    },
    bind(fn) {
      const owner = busy.capture();
      return (...args) => busy.run(owner, fn, undefined, args);
    },
    report(key, life) {
      const f = frame;
      if (!f) return;
      (f.roots ??= []).push(key);
      if (f.pending) {
        const l = life === undefined ? lifeOf(key) : life;
        for (const o of f.pending) {
          o.key = key;
          o.life = l;
        }
        f.pending = null;
      }
    },
    take(key) {
      const ms = spent.get(key) ?? 0;
      spent.delete(key);
      return ms;
    },
    claim(container, key) {
      containers.set(container, { key, life: lifeOf(key) });
    },
    keyOf(container) {
      return busy.rootOf(container)?.key ?? null;
    },
    rootOf(container) {
      if (typeof container !== 'object' || container === null) return null;
      return containers.get(container) ?? null;
    },
  };
  return busy;
}

/** Keeps a wrapper's `name` and `length` the native function's. */
function like<F extends Callback>(wrapper: F, native: { name: string; length: number }): F {
  Object.defineProperty(wrapper, 'name', { value: native.name, configurable: true });
  Object.defineProperty(wrapper, 'length', { value: native.length, configurable: true });
  return wrapper;
}

type Callback = (this: unknown, ...args: unknown[]) => unknown;

/** `f` as a callback, when it is a function: schedulers call any function. */
function callable(f: unknown): Callback | null {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a function takes any `this` and arguments
  return typeof f === 'function' ? (f as Callback) : null;
}

/**
 * `cb` run as `owner` when the scheduler calls it, with the scheduler's `this`
 * and arguments. Always in a frame, even for nobody: a shared framework's
 * task (React's scheduler port, set up while its module loaded) still splits
 * among the roots it reports. Once the owner's life ended it doesn't run;
 * `stale` gets the scheduler's `this` instead, to stop what would call it
 * again (ADR 0015, decision 9).
 */
function billed(busy: Busy, owner: Owner, cb: Callback, stale?: (self: unknown) => void): Callback {
  return function (this: unknown, ...args: unknown[]): unknown {
    if (owner.life?.ended === true) {
      stale?.(this);
      return undefined;
    }
    return busy.run(owner, cb, this, args);
  };
}

/**
 * Wraps a scheduling function on `scope` so the callback in argument 0 is
 * billed to the owner current at registration. Everything else (the return
 * value, ids, `clear*`, other arguments) is the native's.
 */
function wrapScheduler(scope: object, name: string, busy: Busy): void {
  const native: unknown = Reflect.get(scope, name);
  if (typeof native !== 'function') return;
  // An interval keeps calling: once its member stopped, it clears itself.
  const clear = name === 'setInterval' ? callable(Reflect.get(scope, 'clearInterval')) : null;
  const wrapper = like(function (this: unknown, ...args: unknown[]): unknown {
    const cb = callable(args[0]);
    let id: unknown;
    if (cb)
      args[0] = billed(
        busy,
        busy.capture(),
        cb,
        clear
          ? () => {
              clear.call(scope, id);
            }
          : undefined,
      );
    const r: unknown = Reflect.apply(native, this ?? scope, args);
    id = r;
    return r;
  }, native);
  Reflect.set(scope, name, wrapper);
}

const SCHEDULERS = [
  'setTimeout',
  'setInterval',
  'requestAnimationFrame',
  'queueMicrotask',
  'requestIdleCallback',
] as const;

const captureOf = (options: unknown): boolean =>
  typeof options === 'boolean'
    ? options
    : typeof options === 'object' && options !== null && Reflect.get(options, 'capture') === true;

/** A function, or an object with `handleEvent`, as `addEventListener` takes. */
const isListener = (l: unknown): l is object =>
  typeof l === 'function' ||
  (typeof l === 'object' && l !== null && typeof Reflect.get(l, 'handleEvent') === 'function');

/**
 * Wraps `MessagePort`'s `onmessage` and its `message` listeners, so a port
 * a member creates (a scheduler's `MessageChannel`, say) bills its messages
 * to that member. `onmessage` still reads back the function that was set,
 * and `removeEventListener` still removes what `addEventListener` added.
 */
function wrapPorts(scope: object, busy: Busy): void {
  const Port: unknown = Reflect.get(scope, 'MessagePort');
  if (typeof Port !== 'function') return;
  const proto: unknown = Reflect.get(Port, 'prototype');
  if (typeof proto !== 'object' || proto === null) return;

  // A port its stopped member listened on closes on its next message.
  const close = callable(Reflect.get(proto, 'close'));
  const shut = (port: unknown): void => {
    if (close && typeof port === 'object' && port !== null) close.call(port);
  };

  const on = Object.getOwnPropertyDescriptor(proto, 'onmessage');
  const get = callable(on ? Reflect.get(on, 'get') : undefined);
  const set = callable(on ? Reflect.get(on, 'set') : undefined);
  if (on && get && set) {
    /** What each port's `onmessage` was set to, as read back. */
    const assigned = new WeakMap<object, unknown>();
    Object.defineProperty(proto, 'onmessage', {
      configurable: true,
      enumerable: on.enumerable ?? true,
      get: like(function (this: unknown): unknown {
        if (typeof this === 'object' && this !== null && assigned.has(this))
          return assigned.get(this);
        return get.call(this);
      }, get),
      set: like(function (this: unknown, fn: unknown): void {
        if (typeof this === 'object' && this !== null) assigned.set(this, fn);
        const cb = callable(fn);
        set.call(this, cb ? billed(busy, busy.capture(), cb, shut) : fn);
      }, set),
    });
  }

  const add = callable(Reflect.get(proto, 'addEventListener'));
  const remove = callable(Reflect.get(proto, 'removeEventListener'));
  if (!add || !remove) return;
  /** Per port, per listener and capture flag: the wrapper `addEventListener` was given. */
  const added = new WeakMap<object, Map<object, Map<boolean, Callback>>>();

  Object.defineProperty(proto, 'addEventListener', {
    configurable: true,
    writable: true,
    enumerable: true,
    value: like(function (this: unknown, ...args: unknown[]): unknown {
      const [type, listener, options] = args;
      if (
        (type !== 'message' && type !== 'messageerror') ||
        !isListener(listener) ||
        typeof this !== 'object' ||
        this === null
      )
        return add.apply(this, args);
      const capture = captureOf(options);
      let byListener = added.get(this);
      if (!byListener) added.set(this, (byListener = new Map<object, Map<boolean, Callback>>()));
      let byCapture = byListener.get(listener);
      if (!byCapture) byListener.set(listener, (byCapture = new Map<boolean, Callback>()));
      let wrapper = byCapture.get(capture);
      if (!wrapper) {
        const fn = callable(listener);
        const call = function (this: unknown, e: unknown): unknown {
          if (fn) return fn.call(this, e);
          return callable(Reflect.get(listener, 'handleEvent'))?.call(listener, e);
        };
        wrapper = billed(busy, busy.capture(), call, shut);
        byCapture.set(capture, wrapper);
      }
      return add.apply(this, [type, wrapper, ...args.slice(2)]);
    }, add),
  });
  Object.defineProperty(proto, 'removeEventListener', {
    configurable: true,
    writable: true,
    enumerable: true,
    value: like(function (this: unknown, ...args: unknown[]): unknown {
      const [type, listener, options] = args;
      const byCapture =
        typeof this === 'object' && this !== null && isListener(listener)
          ? added.get(this)?.get(listener)
          : undefined;
      const capture = captureOf(options);
      const wrapper = byCapture?.get(capture);
      if (!wrapper || (type !== 'message' && type !== 'messageerror'))
        return remove.apply(this, args);
      byCapture?.delete(capture);
      return remove.apply(this, [type, wrapper, ...args.slice(2)]);
    }, remove),
  });
}

/**
 * React's devtools hook, the smallest one react-dom accepts (production
 * builds call it too): it reports each committed root's member, and each
 * root whose passive effects just ran, to the current frame.
 */
function installReactHook(scope: object, busy: Busy): void {
  const KEY = '__REACT_DEVTOOLS_GLOBAL_HOOK__';
  if (Reflect.get(scope, KEY) !== undefined) return;
  let renderers = 0;
  const committed = (_renderer: unknown, root: unknown): void => {
    if (typeof root !== 'object' || root === null) return;
    const at = busy.rootOf(Reflect.get(root, 'containerInfo'));
    if (at !== null) busy.report(at.key, at.life);
  };
  Reflect.set(scope, KEY, {
    supportsFiber: true,
    inject: () => ++renderers,
    onCommitFiberRoot: committed,
    onPostCommitFiberRoot: committed,
    onCommitFiberUnmount: () => {},
    checkDCE: () => {},
  });
}

/** The native `queueMicrotask`, for the runtime's own billed flushes. */
export let nativeQueueMicrotask: (fn: () => void) => void = (fn) => {
  queueMicrotask(fn);
};

/**
 * Installs attribution on a worker's global, once, before any member loads:
 * the scheduling functions, `MessagePort` listeners and React's hook.
 */
export function installBusy(scope: object, busy: Busy): void {
  const q: unknown = Reflect.get(scope, 'queueMicrotask');
  if (typeof q === 'function')
    nativeQueueMicrotask = (fn) => {
      Reflect.apply(q, scope, [fn]);
    };
  for (const name of SCHEDULERS) wrapScheduler(scope, name, busy);
  wrapPorts(scope, busy);
  installReactHook(scope, busy);
}

/** The worker's one ledger: the bootstrap installs it, members' contexts reach it. */
export const busy: Busy = createBusy();

/**
 * Where adapters find the ledger on a context (internal, ADR 0017): React
 * claims its container, Preact binds its render batches. A `Symbol.for`, so
 * an adapter built apart (ADR 0012) finds it too.
 */
export const BUSY: symbol = Symbol.for('isoloop.busy');

/** What a context offers adapters under `BUSY`. */
export type BusyHook = {
  /** `container` renders this member. */
  claim(container: object): void;
  /** `fn` run as the owner current now. */
  bind<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R;
};
