// Runs OpfsStorage scenarios in a dedicated worker, where sync access handles
// exist (opfs.browser.test.ts). Each message names a scenario; the reply is
// its result or the error it threw.
import { connect } from '../../test/memory-port';
import { Broker } from '../broker';
import { TsEngine } from '../engine/ts-engine';
import { decodeFrame } from '../storage/frame';
import { OpfsStorage, type OpfsStorageOptions } from '../storage/opfs';
import { contracts, topic, unchecked } from '../topic';

declare const self: DedicatedWorkerGlobalScope;

const saved = topic('saved.v1', {
  schema: unchecked<unknown>(),
  retention: { kind: 'last-n', n: 1_000_000 },
  durability: 'persistent',
});

async function root(name: string): Promise<FileSystemDirectoryHandle> {
  const origin = await navigator.storage.getDirectory();
  return origin.getDirectoryHandle(name, { create: true });
}

async function engineOn(dir: string, opts: Omit<OpfsStorageOptions, 'root'> = {}) {
  const storage = new OpfsStorage({ ...opts, root: await root(dir) });
  await storage.open();
  const engine = new TsEngine({ storage });
  engine.createTopic({
    name: 'saved.v1',
    retention: saved.retention,
    requestable: false,
    durability: 'persistent',
  });
  return { storage, engine };
}

/** Every frame of a topic, oldest first, decoded. */
async function readAll(storage: OpfsStorage, name: string) {
  const out = [];
  let from = 0;
  for (;;) {
    // oxlint-disable-next-line no-await-in-loop -- segment by segment
    const frames = await storage.readSegment(name, from);
    if (frames.length === 0) break;
    const recs = frames.map(decodeFrame);
    out.push(...recs);
    from = (recs.at(-1)?.offset ?? from) + 1;
  }
  return out;
}

async function reopen(dir: string) {
  const storage = new OpfsStorage({ root: await root(dir) });
  const state = await storage.open();
  await storage.close();
  return state;
}

/** Writes 100 records to saved.v1 and closes; returns the segment's handle helper. */
async function hundred(dir: string): Promise<void> {
  const { storage, engine } = await engineOn(dir);
  for (let i = 0; i < 100; i++) engine.append('saved.v1', { value: i, ts: i, producer: 'p' });
  engine.commit('saved.v1', 'c', 60);
  await engine.flush();
  await storage.close();
}

/** Edits a file of saved.v1 through a sync access handle. */
async function edit(dir: string, name: string, f: (h: FileSystemSyncAccessHandle) => void) {
  const topicDir = await (await root(dir)).getDirectoryHandle('saved.v1');
  const handle = await (
    await topicDir.getFileHandle(name, { create: true })
  ).createSyncAccessHandle();
  try {
    f(handle);
    handle.flush();
  } finally {
    handle.close();
  }
}

/** Opens storage and engine as the bus does after a crash, then appends once and reads it all back. */
async function recover(dir: string) {
  const storage = new OpfsStorage({ root: await root(dir) });
  const state = await storage.open();
  const engine = new TsEngine({ storage });
  engine.createTopic({
    name: 'saved.v1',
    retention: saved.retention,
    requestable: false,
    durability: 'persistent',
  });
  const restored = await engine.restore(state);
  const values = engine.read('saved.v1', 0, 1000).map((r) => r.value);
  const next = engine.append('saved.v1', { value: 'next', ts: 0, producer: 'p' });
  await engine.flush();
  const onDisk = (await readAll(storage, 'saved.v1')).map((r) => r.value);
  await storage.close();
  return {
    state: state.topics,
    restored,
    count: values.length,
    missing: Array.from({ length: 100 }, (_, i) => i).filter((i) => !values.includes(i)),
    committed: engine.committed('saved.v1', 'c'),
    next,
    onDiskTail: onDisk.slice(-2),
    onDiskCount: onDisk.length,
  };
}

const scenarios: Record<string, (dir: string) => Promise<unknown>> = {
  async 'recovery: a truncated last frame'(dir) {
    await hundred(dir);
    await edit(dir, '0000000000000000.seg', (h) => h.truncate(h.getSize() - 3));
    return recover(dir);
  },

  async 'recovery: a flipped byte'(dir) {
    await hundred(dir);
    await edit(dir, '0000000000000000.seg', (h) => {
      const bytes = new Uint8Array(h.getSize());
      h.read(bytes, { at: 0 });
      // Every frame here is the same size: the 51st frame's body, last byte.
      const frame = bytes.length / 100;
      const at = frame * 51 - 1;
      h.write(new Uint8Array([(bytes[at] ?? 0) ^ 0xff]), { at });
    });
    return recover(dir);
  },

  async 'recovery: an empty segment'(dir) {
    await hundred(dir);
    // A crash right after rolling over: the new segment exists, empty.
    await edit(dir, '0000000000000100.seg', () => {});
    return recover(dir);
  },

  async 'offsets survive a reopen'(dir) {
    const { storage, engine } = await engineOn(dir);
    engine.append('saved.v1', { value: 1, ts: 0, producer: 'p' });
    engine.commit('saved.v1', 'c1', 41);
    engine.commit('saved.v1', 'c2', 7);
    engine.commit('saved.v1', 'c1', 42);
    await engine.flush();
    await storage.close();
    return (await reopen(dir)).offsets;
  },

  async 'a torn offsets write leaves the previous offsets'(dir) {
    const { storage, engine } = await engineOn(dir);
    engine.append('saved.v1', { value: 1, ts: 0, producer: 'p' });
    engine.commit('saved.v1', 'c1', 5);
    await engine.flush();
    engine.commit('saved.v1', 'c1', 9);
    engine.commit('saved.v1', 'c2', 3);
    await engine.flush();
    await storage.close();
    const before = (await reopen(dir)).offsets;
    // Kill the newest write halfway: generation 2 went to the slot offsets.0.
    const topicDir = await (await root(dir)).getDirectoryHandle('saved.v1');
    const handle = await (await topicDir.getFileHandle('offsets.0')).createSyncAccessHandle();
    handle.truncate(Math.floor(handle.getSize() / 2));
    handle.close();
    const after = (await reopen(dir)).offsets;
    // The next write still lands, on the slot that was torn.
    const s2 = new OpfsStorage({ root: await root(dir) });
    await s2.open();
    s2.saveOffsets({ 'saved.v1': { c1: 11 } });
    await s2.flush();
    await s2.close();
    return { before, after, next: (await reopen(dir)).offsets };
  },

  async 'write and read back'(dir) {
    const { storage, engine } = await engineOn(dir);
    for (let i = 0; i < 10_000; i++) {
      engine.append('saved.v1', {
        value: { i, note: `record ${i}` },
        ts: 1000 + i,
        producer: 'p',
        ...(i % 2 ? { key: `k${i}` } : {}),
      });
    }
    await engine.flush();
    const recs = await readAll(storage, 'saved.v1');
    await storage.close();
    // A fresh instance finds the same head.
    const again = new OpfsStorage({ root: await root(dir) });
    const state = await again.open();
    await again.close();
    return {
      count: recs.length,
      offsetsInOrder: recs.every((r, i) => r.offset === i),
      valuesMatch: recs.every(
        (r, i) =>
          typeof r.value === 'object' &&
          r.value !== null &&
          Reflect.get(r.value, 'i') === i &&
          r.ts === 1000 + i &&
          r.producer === 'p',
      ),
      keys: recs.slice(0, 4).map((r) => r.key ?? null),
      state: state.topics,
    };
  },

  async 'segments roll over at 4 MiB'(dir) {
    const { storage, engine } = await engineOn(dir);
    const big = 'x'.repeat(10_000);
    for (let i = 0; i < 500; i++) engine.append('saved.v1', { value: big, ts: 0, producer: 'p' });
    await engine.flush();
    const names = await storage.segments('saved.v1');
    const sizes = [];
    const topicDir = await (await root(dir)).getDirectoryHandle('saved.v1');
    for (const n of names) {
      // oxlint-disable-next-line no-await-in-loop -- a few files
      sizes.push((await (await topicDir.getFileHandle(n)).getFile()).size);
    }
    const recs = await readAll(storage, 'saved.v1');
    await storage.close();
    const MiB = 1024 * 1024;
    const size = sizes[0] ?? 0;
    return {
      count: recs.length,
      first: names[0],
      segments: names.length,
      firstFull: size <= 4 * MiB && size > 4 * MiB - 10_100,
    };
  },

  async 'a publish resolves only after its flush'(dir) {
    const storage = new OpfsStorage({ root: await root(dir), commitMs: 100 });
    await storage.open();
    const broker = new Broker({ contracts: contracts(saved), engine: new TsEngine({ storage }) });
    const a = connect(broker, 'A', { publish: ['*'], subscribe: ['*'] });
    let acked = false;
    const t0 = performance.now();
    const done = a.call('publish', { topic: 'saved.v1', value: 'hello' }).then((r) => {
      acked = true;
      return r;
    });
    await new Promise((r) => setTimeout(r, 30));
    const ackedEarly = acked;
    const onDiskBeforeAck = (await readAll(storage, 'saved.v1')).length;
    const result = await done;
    const ms = performance.now() - t0;
    const onDiskAfterAck = (await readAll(storage, 'saved.v1')).map((r) => r.value);
    await storage.close();
    return { ackedEarly, onDiskBeforeAck, result, onDiskAfterAck, waitedForCommit: ms >= 90 };
  },
};

self.addEventListener(
  'message',
  (e: MessageEvent<{ id: number; scenario: string; dir: string }>) => {
    const { id, scenario, dir } = e.data;
    const run = scenarios[scenario];
    if (!run) {
      self.postMessage({ id, error: `no scenario ${scenario}` });
      return;
    }
    run(dir).then(
      (value) => self.postMessage({ id, value }),
      (err: unknown) =>
        self.postMessage({
          id,
          error: err instanceof Error ? `${err.name}: ${err.message}\n${err.stack}` : String(err),
        }),
    );
  },
);
