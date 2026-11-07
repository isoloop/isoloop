// Runs OpfsStorage scenarios in a dedicated worker, where sync access handles
// exist (opfs.browser.test.ts). Each message names a scenario; the reply is
// its result or the error it threw.
import type { Retention } from '@isoloop/protocol';
import { connect } from '../../test/memory-port';
import { Broker } from '../broker';
import { TsEngine } from '../engine/ts-engine';
import { decodeFrame, frameOffset, scanFrames } from '../storage/frame';
import { type CompactionStep, OpfsStorage, type OpfsStorageOptions } from '../storage/opfs';
import { SEED_DONE, SEED_FROM, SEED_HEAD } from '../seed';
import { contracts, topic, topicConfig, unchecked } from '../topic';

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

async function engineOn(
  dir: string,
  opts: Omit<OpfsStorageOptions, 'root'> = {},
  retention: Retention = saved.retention,
  now: () => number = Date.now,
) {
  const storage = new OpfsStorage({ ...opts, root: await root(dir) });
  await storage.open();
  const engine = new TsEngine({ storage, now });
  engine.createTopic({ name: 'saved.v1', retention, requestable: false, durability: 'persistent' });
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

function isRecordWith(value: unknown, i: number): boolean {
  return typeof value === 'object' && value !== null && 'i' in value && value.i === i;
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

// Compaction on disk (M2b task 10): ~2 KiB records in 8 KiB segments, so
// three to a segment and plenty of segments to rewrite.
const COMPACT_SEGMENT = 8 * 1024;
const note2k = 'z'.repeat(2000);

async function compactedOn(
  dir: string,
  onCompactionStep?: OpfsStorageOptions['onCompactionStep'],
  dirtyMin = 64,
) {
  const storage = new OpfsStorage({
    root: await root(dir),
    segmentBytes: COMPACT_SEGMENT,
    ...(onCompactionStep ? { onCompactionStep } : {}),
  });
  const state = await storage.open();
  const engine = new TsEngine({ storage, dirtyMin });
  engine.createTopic({
    name: 'saved.v1',
    retention: { kind: 'compacted' },
    requestable: false,
    durability: 'persistent',
  });
  await engine.restore(state);
  return { storage, engine };
}

/**
 * 15 rounds over 10 keys, a keyless record every 25, then four keyless
 * fillers: more than a segment, so the newest segment, which compaction
 * leaves alone, holds fillers only.
 */
function writeKeyed(engine: TsEngine): void {
  for (let i = 0; i < 150; i++) {
    const key = i % 25 === 24 ? undefined : `k${i % 10}`;
    engine.append('saved.v1', {
      value: { i, note: note2k },
      ts: i,
      producer: 'p',
      ...(key === undefined ? {} : { key }),
    });
  }
  for (let i = 0; i < 4; i++)
    engine.append('saved.v1', { value: { filler: i, note: note2k }, ts: 0, producer: 'p' });
}

const brief = (r: { offset: number; key?: string | undefined }) => [r.offset, r.key ?? null];

/** Whether no key appears twice, and offsets ascend. */
function latestOnly(recs: { offset: number; key?: string | undefined }[]): boolean {
  const keys = recs.flatMap((r) => (r.key === undefined ? [] : [r.key]));
  return (
    new Set(keys).size === keys.length &&
    recs.every((r, i) => i === 0 || r.offset > (recs[i - 1]?.offset ?? 0))
  );
}

/** Topic files other than segments: compaction markers left behind. */
async function markers(dir: string): Promise<string[]> {
  const topicDir = await (await root(dir)).getDirectoryHandle('saved.v1');
  const out: string[] = [];
  for await (const name of topicDir.keys()) if (name.startsWith('compact')) out.push(name);
  return out;
}

/** Opens the storage alone after a crash (recovery runs in `open`); the files may still be held for a moment. */
async function openAfterCrash(dir: string): Promise<OpfsStorage> {
  for (let i = 0; ; i++) {
    try {
      // oxlint-disable-next-line no-await-in-loop -- retried until the dead worker lets go
      const storage = new OpfsStorage({ root: await root(dir), segmentBytes: COMPACT_SEGMENT });
      // oxlint-disable-next-line no-await-in-loop
      await storage.open();
      return storage;
    } catch (e) {
      if (i >= 50 || !(e instanceof DOMException) || e.name !== 'NoModificationAllowedError')
        throw e;
      // oxlint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 20));
    }
  }
}

/**
 * Writes a compacted topic, has a child worker compact it and stop at
 * `step`, kills that worker, and reopens.
 */
async function crashAt(dir: string, step: CompactionStep) {
  // Never compacts by itself: the child does it.
  const first = await compactedOn(dir, undefined, Number.MAX_SAFE_INTEGER);
  writeKeyed(first.engine);
  await first.engine.flush();
  // In memory; on disk, segments wholly below the new tail go.
  first.engine.compact('saved.v1');
  const latest = JSON.stringify(first.engine.read('saved.v1', 0, 10_000).map(brief));
  await first.storage.close();
  const before = await openAfterCrash(dir);
  const all = JSON.stringify((await readAll(before, 'saved.v1')).map(brief));
  await before.close();

  const child = new Worker(new URL('./opfs-worker.ts', import.meta.url), { type: 'module' });
  await new Promise<void>((resolve, reject) => {
    child.addEventListener('error', (e) => reject(new Error(`child worker: ${e.message}`)));
    child.addEventListener('message', (e: MessageEvent<{ error?: string }>) => {
      if (e.data.error !== undefined) reject(new Error(e.data.error));
      else resolve();
    });
    child.postMessage({ id: 1, scenario: `compaction: stop at ${step}`, dir });
  });
  child.terminate();

  const storage = await openAfterCrash(dir);
  const names = await storage.segments('saved.v1');
  const onDisk = JSON.stringify((await readAll(storage, 'saved.v1')).map(brief));
  await storage.close();
  // The bus's own reopen: the restore compacts in memory, and on disk again.
  const again = await compactedOn(dir);
  const restored = JSON.stringify(again.engine.read('saved.v1', 0, 10_000).map(brief));
  await again.storage.compacting('saved.v1');
  await again.storage.close();
  return {
    oldSegments: onDisk === all,
    compactedSegments: onDisk === latest,
    restoredLatest: restored === latest,
    outputs: names.some((n) => /\.\d+\.seg$/.test(n)),
    markers: await markers(dir),
  };
}

/** Child side of `crashAt`: opening restores, which starts the compaction; hangs at `step`. */
async function stopAt(dir: string, step: CompactionStep): Promise<string> {
  let reached: (() => void) | undefined;
  const at = new Promise<void>((r) => {
    reached = r;
  });
  await compactedOn(dir, (s) => {
    if (s !== step) return undefined;
    reached?.();
    return new Promise<void>(() => {}); // the crash: never goes on
  });
  await at;
  return step;
}

const scenarios: Record<string, (dir: string) => Promise<unknown>> = {
  async 'retention on disk: last-n'(dir) {
    const { storage, engine } = await engineOn(dir, {}, { kind: 'last-n', n: 1000 });
    const note = 'x'.repeat(200);
    for (let i = 0; i < 100_000; i++)
      engine.append('saved.v1', { value: { i, note }, ts: 0, producer: 'p' });
    await engine.flush();
    const segments = await storage.segments('saved.v1');
    const onDisk = await readAll(storage, 'saved.v1');
    await storage.close();
    const state = await reopen(dir);
    return {
      atMostTwoSegments: segments.length <= 2,
      // The newest 1,000 are all still there; what's older is at most one segment's worth.
      keepsTheLast1000: onDisk.slice(-1000).every((r, k) => r.offset === 99_000 + k),
      fewerThanTwoSegments: onDisk.length < 2 * 20_000,
      tailOnReopen: (state.topics[0]?.tail ?? 0) <= 99_000,
    };
  },

  async 'retention on disk: time'(dir) {
    let now = 0;
    const { storage, engine } = await engineOn(
      dir,
      { segmentBytes: 64 * 1024 },
      { kind: 'time', ms: 1000 },
      () => now,
    );
    const note = 'y'.repeat(200);
    for (let i = 0; i < 3000; i++)
      engine.append('saved.v1', { value: { i, note }, ts: i, producer: 'p' });
    await engine.flush();
    const before = (await storage.segments('saved.v1')).length;
    now = 2500; // records with ts < 1500 expire
    engine.compact('saved.v1');
    await engine.flush();
    const after = await storage.segments('saved.v1');
    const onDisk = await readAll(storage, 'saved.v1');
    await storage.close();
    return {
      dropped: before > after.length,
      keepsEveryLiveRecord: onDisk.filter((r) => r.ts >= 1500).length === 1500,
      oldestOnDisk: (onDisk[0]?.ts ?? 0) > 1500 - 400,
    };
  },

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

  async 'compaction on disk: latest per key'(dir) {
    let engine: TsEngine | undefined;
    let over = false;
    let flushedDuring: boolean | undefined;
    let late: number[] = [];
    const opened = await compactedOn(dir, (step) => {
      if (step !== 'begin' || !engine) return;
      // Appends during the compaction, and a flush that mustn't wait for it.
      for (let i = 0; i < 3; i++)
        late.push(
          engine.append('saved.v1', { value: { late: i }, ts: 0, producer: 'p', key: 'late' }),
        );
      void engine.flush().then(() => {
        flushedDuring ??= !over;
      });
    });
    engine = opened.engine;
    const { storage } = opened;
    writeKeyed(engine);
    await engine.flush();
    const segmentsBefore = (await storage.segments('saved.v1')).length;
    engine.compact('saved.v1');
    await storage.compacting('saved.v1');
    over = true;
    await engine.flush();
    const onDisk = await readAll(storage, 'saved.v1');
    const inMemory = engine.read('saved.v1', 0, 10_000);
    // A reopen compacts in memory too, so of the late appends only the last is restored.
    engine.compact('saved.v1');
    const compacted = engine.read('saved.v1', 0, 10_000);
    const segmentsAfter = (await storage.segments('saved.v1')).length;
    await storage.close();
    const again = await compactedOn(dir);
    const restored = again.engine.read('saved.v1', 0, 10_000);
    await again.storage.close();
    late = late.filter((o) => o > (onDisk.at(-4)?.offset ?? 0));
    return {
      shrank: segmentsAfter < segmentsBefore / 4,
      // 10 keys, 6 keyless, 4 fillers and the 3 late appends.
      count: onDisk.length,
      sameAsMemory: JSON.stringify(onDisk.map(brief)) === JSON.stringify(inMemory.map(brief)),
      latestOnlyBeforeTheNewest: latestOnly(onDisk.filter((r) => r.key !== 'late')),
      lateAtTheEnd: onDisk.slice(-3).map((r) => r.key),
      lateAfterEverything: late.length,
      flushedDuring,
      restoredSame: JSON.stringify(restored.map(brief)) === JSON.stringify(compacted.map(brief)),
      markers: await markers(dir),
    };
  },

  'compaction on disk: a crash mid-rewrite'(dir) {
    return crashAt(dir, 'begin');
  },

  'compaction on disk: a crash after the output is written'(dir) {
    return crashAt(dir, 'done');
  },

  'compaction: stop at begin'(dir) {
    return stopAt(dir, 'begin');
  },

  'compaction: stop at done'(dir) {
    return stopAt(dir, 'done');
  },

  async 'eviction: a subscriber from earliest on a topic larger than memory'(dir) {
    const storage = new OpfsStorage({ root: await root(dir), segmentBytes: 16 * 1024 });
    await storage.open();
    const engine = new TsEngine({ storage, chunkSize: 256, residentBytes: 64 * 1024 });
    const broker = new Broker({ contracts: contracts(saved), engine });
    const p = connect(broker, 'P', { publish: ['*'], subscribe: [] });
    const note = 'e'.repeat(200);
    const n = 3000;
    for (let i = 0; i < n; i++)
      p.send({ v: 1, t: 'publish', p: { topic: 'saved.v1', value: { i, note } } });
    await engine.flush();
    const resident = engine.resident('saved.v1');
    const s = connect(broker, 'S', { publish: [], subscribe: ['*'] });
    s.send({ v: 1, t: 'subscribe', p: { topic: 'saved.v1', from: 'earliest' } });
    // Commits whatever arrived, as the isolate would, until everything has.
    let committed = -1;
    const deadline = performance.now() + 90_000;
    while (s.records('saved.v1').length < n && performance.now() < deadline) {
      // oxlint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 2));
      const last = s.records('saved.v1').at(-1);
      if (!last || last.offset === committed) continue;
      committed = last.offset;
      // oxlint-disable-next-line no-await-in-loop
      await s.call('commit', { topic: 'saved.v1', offset: committed });
    }
    const got = s.records('saved.v1');
    await storage.close();
    return {
      evicted: resident > n / 2,
      count: got.length,
      inOrder: got.every(
        (r, k) => r.offset === k && JSON.stringify(r.value) === JSON.stringify({ i: k, note }),
      ),
    };
  },

  async 'safe mode: the newest segment is set aside'(dir) {
    const { storage, engine } = await engineOn(dir, { segmentBytes: 4 * 1024 });
    const note = 's'.repeat(200);
    for (let i = 0; i < 50; i++)
      engine.append('saved.v1', { value: { i, note }, ts: 0, producer: 'p' });
    await engine.flush();
    const before = await storage.segments('saved.v1');
    await storage.close();
    const again = new OpfsStorage({ root: await root(dir), segmentBytes: 4 * 1024 });
    const quarantined = await again.quarantineNewest();
    const state = await again.open();
    const after = await again.segments('saved.v1');
    const kept = await readAll(again, 'saved.v1');
    await again.close();
    const topicDir = await (await root(dir)).getDirectoryHandle('saved.v1');
    const files: string[] = [];
    for await (const name of topicDir.keys()) files.push(name);
    return {
      quarantined: quarantined[0] === `saved.v1/${before.at(-1) ?? ''}`,
      oneFewer: after.length === before.length - 1,
      keptInOrder: kept.every((r, k) => r.offset === k),
      head: state.topics[0]?.head,
      setAside: files.some(
        (f) => f.startsWith(before.at(-1) ?? '?') && f.endsWith('.to-0000000000000050.quarantined'),
      ),
    };
  },

  async 'seeding from v1 on disk, with v1 partly evicted'(dir) {
    const v1 = topic('cart.items.v1', {
      schema: unchecked<{ i: number; note: string }>(),
      retention: { kind: 'last-n', n: 1_000_000 },
      durability: 'persistent',
    });
    const v2 = topic('cart.items.v2', {
      schema: unchecked<{ i: number; v: 2 }>(),
      retention: { kind: 'last-n', n: 1_000_000 },
      durability: 'persistent',
      seed: { from: v1, map: (v: { i: number }) => ({ i: v.i, v: 2 as const }) },
    });
    const n = 2000;
    const note = 'z'.repeat(200);
    {
      const storage = new OpfsStorage({ root: await root(dir), segmentBytes: 16 * 1024 });
      await storage.open();
      const engine = new TsEngine({ storage });
      engine.createTopic(topicConfig(v1));
      for (let i = 0; i < n; i++)
        engine.append(v1.name, { value: { i, note }, ts: 10 + i, producer: 'old' });
      await engine.flush();
      await storage.close();
    }
    // A new bus with v2 in the contracts: v2 starts empty, so it seeds.
    const storage = new OpfsStorage({ root: await root(dir), segmentBytes: 16 * 1024 });
    const stored = await storage.open();
    const engine = new TsEngine({ storage, chunkSize: 256, residentBytes: 64 * 1024 });
    const broker = new Broker({ contracts: contracts(v1, v2), engine });
    await engine.restore(stored);
    const evicted = !engine.readable(v1.name, 0);
    const seeded = broker.seed();
    const a = connect(broker, 'A', { publish: ['*'], subscribe: ['*'] });
    const pub = a.call('publish', { topic: v2.name, value: { i: -1, v: 2 } });
    await seeded;
    const result = await pub;
    await engine.flush();
    await storage.close();
    // Read v2 back from disk.
    const again = new OpfsStorage({ root: await root(dir), segmentBytes: 16 * 1024 });
    await again.open();
    const onDisk = await readAll(again, v2.name);
    await again.close();
    return {
      evicted,
      result,
      count: onDisk.length,
      inOrder: onDisk.slice(0, n).every((r, k) => isRecordWith(r.value, k) && r.ts === 10 + k),
      last: onDisk.at(-1)?.value,
    };
  },

  async 'a seed killed halfway resumes without duplicates'(dir) {
    const v1 = topic('cart.items.v1', {
      schema: unchecked<{ i: number }>(),
      retention: { kind: 'last-n', n: 1_000_000 },
      durability: 'persistent',
    });
    // Once `paused`, the schema never answers: the seed stops where it is, as if killed.
    let paused = false;
    const v2 = topic('cart.items.v2', {
      schema: {
        '~standard': {
          version: 1,
          vendor: 'test',
          validate: (value: unknown) => (paused ? new Promise<never>(() => {}) : { value }),
        },
      },
      retention: { kind: 'last-n', n: 1_000_000 },
      durability: 'persistent',
      seed: { from: v1, map: (v: { i: number }) => ({ i: v.i, v: 2 as const }) },
    });
    const n = 3000;
    const open = async () => {
      const storage = new OpfsStorage({ root: await root(dir) });
      const stored = await storage.open();
      const engine = new TsEngine({ storage });
      const broker = new Broker({ contracts: contracts(v1, v2), engine });
      await engine.restore(stored);
      return { storage, engine, broker };
    };
    {
      const storage = new OpfsStorage({ root: await root(dir) });
      await storage.open();
      const engine = new TsEngine({ storage });
      engine.createTopic(topicConfig(v1));
      for (let i = 0; i < n; i++) engine.append(v1.name, { value: { i }, ts: i, producer: 'old' });
      await engine.flush();
      await storage.close();
    }
    // Start the seed, and stop the bus once a third of it is through.
    {
      const { storage, engine, broker } = await open();
      void broker.seed().catch(() => {});
      while ((engine.committed(v2.name, SEED_FROM) ?? -1) < n / 3)
        // oxlint-disable-next-line no-await-in-loop -- polling the seed
        await new Promise((r) => setTimeout(r, 0));
      paused = true;
      await new Promise((r) => setTimeout(r, 10));
      await storage.close();
      paused = false;
    }
    // The last offsets write tore: progress goes back one generation, while
    // the records of that batch are on disk.
    const v2Dir = await (await root(dir)).getDirectoryHandle(v2.name);
    let newest: { slot: string; gen: number } | undefined;
    for (const slot of ['offsets.0', 'offsets.1']) {
      // oxlint-disable-next-line no-await-in-loop -- two files
      const h = await (await v2Dir.getFileHandle(slot, { create: true })).createSyncAccessHandle();
      const bytes = new Uint8Array(h.getSize());
      h.read(bytes, { at: 0 });
      h.close();
      const last = scanFrames(bytes).frames.at(-1);
      const gen = last ? frameOffset(last) : -1;
      if (!newest || gen > newest.gen) newest = { slot, gen };
    }
    if (newest) {
      // oxlint-disable-next-line no-await-in-loop -- one file
      const h = await (await v2Dir.getFileHandle(newest.slot)).createSyncAccessHandle();
      h.truncate(Math.floor(h.getSize() / 2));
      h.close();
    }
    const { storage, engine, broker } = await open();
    const ahead = engine.head(v2.name) - (engine.committed(v2.name, SEED_HEAD) ?? 0);
    const halfway = engine.committed(v2.name, SEED_DONE) === undefined;
    await broker.seed();
    await engine.flush();
    await storage.close();
    const again = new OpfsStorage({ root: await root(dir) });
    await again.open();
    const onDisk = await readAll(again, v2.name);
    await again.close();
    return {
      halfway,
      recordsAheadOfProgress: ahead > 0,
      count: onDisk.length,
      exactlyOnceInOrder: onDisk.every((r, k) => isRecordWith(r.value, k)),
    };
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
