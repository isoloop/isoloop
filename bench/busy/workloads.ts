/// <reference lib="dom" />
/**
 * What a member's code schedules, one loop per wrapped entry point (ADR 0017,
 * decision 2). Each resolves once its last callback has run, and returns a
 * count so the work can't be optimised away. `n` is the number of callbacks.
 */
type Workload = (n: number) => Promise<number>;

/** A chain: each microtask queues the next. */
const microtaskChain: Workload = (n) =>
  new Promise((resolve) => {
    let i = 0;
    const step = (): void => {
      if (++i >= n) resolve(i);
      else queueMicrotask(step);
    };
    queueMicrotask(step);
  });

/** A burst: `n` zero-delay timeouts registered at once, then run. */
const timeoutBurst: Workload = (n) =>
  new Promise((resolve) => {
    let left = n;
    const done = (): void => {
      if (--left === 0) resolve(n);
    };
    for (let i = 0; i < n; i++) setTimeout(done, 0);
  });

/** Registration only: a timeout set and cleared, `n` times. */
const timeoutSetClear: Workload = (n) => {
  let x = 0;
  for (let i = 0; i < n; i++) {
    const id = setTimeout(() => {}, 1000);
    clearTimeout(id);
    x++;
  }
  return Promise.resolve(x);
};

/**
 * A port ping, the way React's scheduler yields: a `MessageChannel` whose
 * `onmessage` posts again, `n` times. The port is listened on inside the
 * member's code, so the wrapped `onmessage` setter bills it.
 */
const portPing: Workload = (n) =>
  new Promise((resolve) => {
    const ch = new MessageChannel();
    let i = 0;
    // oxlint-disable-next-line unicorn/prefer-add-event-listener -- the `onmessage` setter is what React's scheduler uses, and what this row measures
    ch.port1.onmessage = (): void => {
      if (++i >= n) {
        ch.port1.close();
        resolve(i);
      } else ch.port2.postMessage(null);
    };
    ch.port2.postMessage(null);
  });

/** The same ping through `addEventListener('message')`. */
const portListener: Workload = (n) =>
  new Promise((resolve) => {
    const ch = new MessageChannel();
    let i = 0;
    const on = (): void => {
      if (++i >= n) {
        ch.port1.removeEventListener('message', on);
        ch.port1.close();
        resolve(i);
      } else ch.port2.postMessage(null);
    };
    ch.port1.addEventListener('message', on);
    ch.port1.start();
    ch.port2.postMessage(null);
  });

/** `n` animation-frame callbacks registered in one task, run in the next frame. */
const frameBurst: Workload = (n) =>
  new Promise((resolve) => {
    let left = n;
    const done = (): void => {
      if (--left === 0) resolve(n);
    };
    for (let i = 0; i < n; i++) requestAnimationFrame(done);
  });

/** `n` idle callbacks registered at once. */
const idleBurst: Workload = (n) =>
  new Promise((resolve) => {
    let left = n;
    const done = (): void => {
      if (--left === 0) resolve(n);
    };
    for (let i = 0; i < n; i++) requestIdleCallback(done);
  });

export type WorkloadSpec = {
  readonly run: Workload;
  readonly n: number;
  /** The global it needs; skipped where the worker doesn't have it. */
  readonly needs?: string;
};

export const WORKLOADS: Record<string, WorkloadSpec> = {
  'queueMicrotask chain': { run: microtaskChain, n: 1_000_000 },
  'setTimeout burst': { run: timeoutBurst, n: 100_000 },
  'setTimeout + clearTimeout': { run: timeoutSetClear, n: 500_000 },
  'MessagePort onmessage ping': { run: portPing, n: 50_000 },
  'MessagePort addEventListener ping': { run: portListener, n: 50_000 },
  'requestAnimationFrame burst': { run: frameBurst, n: 100_000, needs: 'requestAnimationFrame' },
  'requestIdleCallback burst': { run: idleBurst, n: 100_000, needs: 'requestIdleCallback' },
};
