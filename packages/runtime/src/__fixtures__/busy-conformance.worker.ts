/// <reference lib="webworker" />
/*
 * Conformance of the attribution wrappers (ADR 0017): with them installed,
 * the scheduling functions and `MessagePort` listeners behave as the natives
 * do. Each check runs under the natives first, then wrapped, and the two
 * results must match. Posts `{ failures }`.
 */
import { createBusy, installBusy } from '../busy';

declare const self: DedicatedWorkerGlobalScope;

const NAMES = [
  'setTimeout',
  'setInterval',
  'requestAnimationFrame',
  'queueMicrotask',
  'requestIdleCallback',
] as const;

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => {
    setTimeout(r, ms);
  });

type Check = () => Promise<unknown>;

const checks: Record<string, Check> = {
  async 'setTimeout: number id, arguments and this forwarded'() {
    const got = await new Promise<unknown[]>((r) => {
      const id = setTimeout(
        function (this: unknown, a: number, b: string) {
          r([this === self, a, b, typeof id]);
        },
        0,
        1,
        'two',
      );
    });
    return got;
  },
  async 'clearTimeout cancels'() {
    let ran = false;
    const id = setTimeout(() => {
      ran = true;
    }, 5);
    clearTimeout(id);
    await sleep(30);
    return ran;
  },
  async 'setInterval repeats; clearInterval stops it'() {
    let n = 0;
    const id = setInterval(() => {
      n++;
      if (n === 3) clearInterval(id);
    }, 2);
    await sleep(80);
    return n;
  },
  async 'requestAnimationFrame: id, a time, cancelAnimationFrame cancels'() {
    if (typeof requestAnimationFrame !== 'function') return 'absent';
    let cancelled = false;
    const c = requestAnimationFrame(() => {
      cancelled = true;
    });
    cancelAnimationFrame(c);
    const time = await new Promise<unknown>((r) => {
      requestAnimationFrame((t) => {
        r(typeof t);
      });
    });
    return [typeof c, time, cancelled];
  },
  async 'queueMicrotask keeps its order among promise callbacks'() {
    const order: string[] = [];
    await new Promise<void>((r) => {
      queueMicrotask(() => order.push('m1'));
      void Promise.resolve().then(() => order.push('p1'));
      queueMicrotask(() => order.push('m2'));
      setTimeout(r, 0);
    });
    return order;
  },
  async 'requestIdleCallback gets a deadline'() {
    // Not in every worker (nor in the worker types).
    const ric: unknown = Reflect.get(self, 'requestIdleCallback');
    if (typeof ric !== 'function') return 'absent';
    return new Promise((r) => {
      Reflect.apply(ric, self, [
        (d: unknown) => {
          r(typeof d === 'object' && d !== null && typeof Reflect.get(d, 'timeRemaining'));
        },
      ]);
    });
  },
  async 'an error thrown in a callback reaches the worker as before'() {
    const message = await new Promise<string>((r) => {
      const on = (e: ErrorEvent): void => {
        e.preventDefault();
        self.removeEventListener('error', on);
        r(e.message);
      };
      self.addEventListener('error', on);
      setTimeout(() => {
        throw new Error('from a timer');
      }, 0);
    });
    return message.includes('from a timer');
  },
  async 'onmessage reads back what was set, and gets the message'() {
    const { port1, port2 } = new MessageChannel();
    const fn = (e: MessageEvent<unknown>): void => {
      got.push(e.data);
    };
    const got: unknown[] = [];
    // oxlint-disable-next-line unicorn/prefer-add-event-listener -- `onmessage` is what is checked
    port1.onmessage = fn;
    const same = port1.onmessage === fn;
    port2.postMessage('hi');
    await sleep(20);
    // oxlint-disable-next-line unicorn/prefer-add-event-listener -- `onmessage` is what is checked
    port1.onmessage = null;
    port2.postMessage('ignored');
    await sleep(20);
    port1.close();
    return [same, got, port1.onmessage];
  },
  async 'message listeners: this, handleEvent, once per listener, removable'() {
    const { port1, port2 } = new MessageChannel();
    const got: string[] = [];
    const fn = function (this: unknown, e: MessageEvent<unknown>): void {
      got.push(`fn:${String(e.data)}:${this === port1}`);
    };
    const obj = {
      handleEvent(this: unknown, e: MessageEvent<unknown>): void {
        got.push(`obj:${String(e.data)}:${this === obj}`);
      },
    };
    port1.addEventListener('message', fn);
    port1.addEventListener('message', fn);
    port1.addEventListener('message', obj);
    port1.start();
    port2.postMessage('a');
    await sleep(20);
    port1.removeEventListener('message', fn);
    port1.removeEventListener('message', obj);
    port2.postMessage('b');
    await sleep(20);
    port1.close();
    return got;
  },
};

async function runAll(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [name, check] of Object.entries(checks)) {
    // oxlint-disable-next-line no-await-in-loop -- one check at a time, so timings don't interleave
    out[name] = JSON.stringify(await check());
  }
  return out;
}

const shape = (): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const name of NAMES) {
    const fn: unknown = Reflect.get(self, name);
    out[name] = typeof fn === 'function' ? `${fn.name}/${fn.length}/${typeof fn}` : 'absent';
  }
  const d = Object.getOwnPropertyDescriptor(MessagePort.prototype, 'onmessage');
  out['onmessage'] = `${d?.get?.name}/${d?.set?.name}/${d?.set?.length}`;
  const add: unknown = Reflect.get(MessagePort.prototype, 'addEventListener');
  out['addEventListener'] = typeof add === 'function' ? `${add.name}/${add.length}` : 'absent';
  return out;
};

const before = { shape: shape(), results: await runAll() };
installBusy(self, createBusy());
const after = { shape: shape(), results: await runAll() };

const failures: string[] = [];
for (const part of ['shape', 'results'] as const) {
  for (const [k, v] of Object.entries(before[part])) {
    if (after[part][k] !== v) failures.push(`${k}: native ${v}, wrapped ${after[part][k]}`);
  }
}
self.postMessage({ failures, before });
