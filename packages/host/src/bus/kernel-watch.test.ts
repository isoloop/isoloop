// kernel.watch on the real bus worker (ADR 0023, points 30 to 34; M8 Watchers W1 task 5b).
import { afterEach, describe, expect, it, vi } from 'vitest';
import list, { count, report, saved } from '../__fixtures__/contracts';
import { createKernel, type Kernel, type KernelEvents } from '../index';

const worker = (path: string): string =>
  `${new URL(path, import.meta.url).href}?worker_file&type=module`;
const src = new URL('../__fixtures__/bus-isolate.ts', import.meta.url).href;
const ALL = { publish: ['*'], subscribe: ['*'] };

type View = [string | null, unknown][];
type Seen = { id: string; views?: Record<string, View> };

const kernels: Kernel[] = [];
afterEach(async () => {
  for (const r of restore.splice(0)) r();
  await Promise.all(kernels.splice(0).map((k) => k.destroy()));
  // The restart test writes a persistent topic to this origin's OPFS: start every test empty.
  const origin = await navigator.storage.getDirectory();
  await vi.waitUntil(() =>
    origin.removeEntry('isoloop', { recursive: true }).then(
      () => true,
      (e: unknown) => e instanceof DOMException && e.name === 'NotFoundError',
    ),
  );
});

function setup() {
  const kernel = createKernel({
    contracts: { url: new URL('../__fixtures__/contracts.ts', import.meta.url).href, list },
    workers: {
      isolateBootstrap: worker('../../../runtime/src/bootstrap.ts'),
      bus: worker('../../../bus/src/worker.ts'),
    },
    supervisor: { backoff: { initialMs: 50 } },
  });
  kernels.push(kernel);
  const log = <E extends keyof KernelEvents>(e: E): KernelEvents[E][] => {
    const got: KernelEvents[E][] = [];
    kernel.on(e, (x) => got.push(x));
    return got;
  };
  return { kernel, log };
}

const isMsg = (m: unknown): m is { t: string; p: unknown } =>
  typeof m === 'object' && m !== null && 'p' in m && 't' in m && typeof m.t === 'string';

/** The bus-port messages the main thread sends, by type; put back after each test. */
function sentOnPorts(): { t: string; p: unknown }[] {
  const sent: { t: string; p: unknown }[] = [];
  const proto = MessagePort.prototype;
  const post = Object.getOwnPropertyDescriptor(proto, 'postMessage');
  // oxlint-disable-next-line typescript/unbound-method -- called back with its own `this` below
  const original = proto.postMessage;
  proto.postMessage = function (this: MessagePort, ...args: unknown[]): void {
    const [msg] = args;
    if (isMsg(msg)) sent.push({ t: msg.t, p: msg.p });
    Reflect.apply(original, this, args);
  } as MessagePort['postMessage'];
  restore.push(() => {
    if (post) Object.defineProperty(proto, 'postMessage', post);
  });
  return sent;
}

const restore: (() => void)[] = [];

/** A view as an object by key, so order doesn't matter. */
const byKey = (v: View): Record<string, unknown> =>
  Object.fromEntries(v.map(([k, x]) => [String(k), x]));

const hasSeen = (p: unknown): boolean => typeof p === 'object' && p !== null && 'seen' in p;

describe('kernel.watch', () => {
  it('two host watches with different keys share one bus watch, and each gets only its keys', async () => {
    const { kernel } = setup();
    const sent = sentOnPorts();
    await kernel.publish(count, 1, { key: 'a' });
    await kernel.publish(count, 2, { key: 'b' });
    const a: View[] = [];
    const b: View[] = [];
    kernel.watch(count, (view) => void a.push([...view]), { keys: ['a'] });
    kernel.watch(count, (view) => void b.push([...view]), { keys: ['b'] });
    await vi.waitUntil(() => a.length > 0 && b.length > 0, { timeout: 3000 });
    expect(a.at(-1)).toEqual([['a', 1]]);
    expect(b.at(-1)).toEqual([['b', 2]]);
    // Both watches mounted in one task: one `watch`, on the union of their keys.
    const watches = sent.filter((m) => m.t === 'watch');
    expect(watches).toHaveLength(1);
    expect(watches[0]?.p).toEqual({ topic: 'count.v1', keys: ['a', 'b'] });

    await kernel.publish(count, 3, { key: 'b' });
    await vi.waitUntil(() => b.at(-1)?.[0]?.[1] === 3, { timeout: 3000 });
    expect(a.at(-1)).toEqual([['a', 1]]);
  });

  it('the next view waits for an async onView, then its seen goes out', async () => {
    const { kernel } = setup();
    const sent = sentOnPorts();
    const views: View[] = [];
    let release: (() => void) | undefined;
    kernel.watch(count, (view) => {
      views.push([...view]);
      return new Promise<void>((r) => {
        release = r;
      });
    });
    await vi.waitUntil(() => views.length === 1, { timeout: 3000 });
    expect(views[0]).toEqual([]);
    const seen = (): number => sent.filter((m) => m.t === 'commits' && hasSeen(m.p)).length;
    // Held: no `seen` for the snapshot yet, so the bus sends nothing more.
    await kernel.publish(count, 1, { key: 'a' });
    await kernel.publish(count, 2, { key: 'a' });
    await new Promise((r) => setTimeout(r, 250));
    expect(views).toHaveLength(1);
    expect(seen()).toBe(0);

    release?.();
    await vi.waitUntil(() => views.length === 2, { timeout: 3000 });
    expect(seen()).toBeGreaterThan(0);
    // The newest value per key, not each value in between.
    expect(views[1]).toEqual([['a', 2]]);
    release?.();
  });

  it('after a bus restart a persistent topic keeps its values and a memory topic resets to empty', async () => {
    const { kernel, log } = setup();
    const busReady = log('bus:ready');
    const views: Record<string, View> = {};
    const changed: Record<string, (string | null)[]> = {};
    for (const topic of [count, saved]) {
      kernel.watch(topic, (view, ch) => {
        views[topic.name] = [...view];
        changed[topic.name] = [...ch];
      });
    }
    await kernel.publish(count, 1, { key: 'a' });
    await kernel.publish(count, 2, { key: 'b' });
    await kernel.publish(saved, 4, { key: 'a' });
    await vi.waitUntil(() => views['count.v1']?.length === 2 && views['saved.v1']?.[0]?.[1] === 4, {
      timeout: 3000,
    });

    kernel.debug.crashBus();
    await vi.waitUntil(() => busReady.length === 2, { timeout: 3000 });
    // The memory topic was lost: its view is empty, every key it had changed.
    await vi.waitUntil(() => views['count.v1']?.length === 0, { timeout: 3000 });
    expect(new Set(changed['count.v1'])).toEqual(new Set(['a', 'b']));
    expect(views['saved.v1']).toEqual([['a', 4]]);

    // Both read on from the new bus.
    await kernel.publish(count, 5, { key: 'c' });
    await kernel.publish(saved, 6, { key: 'b' });
    await vi.waitUntil(() => views['count.v1']?.length === 1 && views['saved.v1']?.length === 2, {
      timeout: 3000,
    });
    expect(views['count.v1']).toEqual([['c', 5]]);
    expect(views['saved.v1']).toEqual([
      ['a', 4],
      ['b', 6],
    ]);
  });

  it("the host's view matches an isolate's on the same topics", async () => {
    const { kernel, log } = setup();
    const ready = log('isolate:ready');
    const reports: Seen[] = [];
    kernel.subscribe(
      report,
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the watcher isolate reports its views on this topic
      (r) => void reports.push(r.value as unknown as Seen),
      { from: 'earliest' },
    );
    kernel.spawn({ id: 'W', src, grants: ALL, config: { mode: 'watcher' } });
    await vi.waitUntil(() => ready.length === 1, { timeout: 3000 });
    const host: Record<string, View> = {};
    for (const topic of [count, saved])
      kernel.watch(topic, (view) => {
        host[topic.name] = [...view];
      });
    // In order, one after the other, so the newest per key is known.
    await ['a', 'b', 'a', 'c', 'b'].reduce(
      (prev, key, i) =>
        prev.then(async () => {
          await kernel.publish(count, i, { key });
          await kernel.publish(saved, i * 10, { key });
        }),
      Promise.resolve(),
    );
    const isolate = (): Record<string, View> | undefined => {
      for (let i = reports.length - 1; i >= 0; i--)
        if (reports[i]?.id === 'W') return reports[i]?.views;
      return undefined;
    };
    const want = {
      'count.v1': { a: 2, b: 4, c: 3 },
      'saved.v1': { a: 20, b: 40, c: 30 },
    };
    const sorted = (
      v: Record<string, View> | undefined,
    ): Record<string, Record<string, unknown>> | undefined =>
      v && Object.fromEntries(Object.entries(v).map(([k, e]) => [k, byKey(e)]));
    await vi.waitUntil(
      () =>
        JSON.stringify(sorted(host)) === JSON.stringify(want) &&
        JSON.stringify(sorted(isolate())) === JSON.stringify(want),
      { timeout: 3000 },
    );
    expect(sorted(host)).toEqual(sorted(isolate()));
  });

  it('needs contracts', () => {
    const kernel = createKernel({
      workers: { isolateBootstrap: worker('../../../runtime/src/bootstrap.ts') },
    });
    kernels.push(kernel);
    expect(() => kernel.watch(count, () => {})).toThrow(/contracts/);
  });
});
