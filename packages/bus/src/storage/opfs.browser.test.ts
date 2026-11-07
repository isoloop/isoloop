// OpfsStorage in a real dedicated worker (M2b task 5): sync access handles
// exist only there. The scenarios live in __fixtures__/opfs-worker.ts.
import { afterAll, describe, expect, it } from 'vitest';
import { server } from 'vitest/browser';

// Playwright's WebKit build has no OPFS (`getDirectory()` throws UnknownError),
// though Safari does; there the bus falls back to memory (M2b task 15). Every
// other engine must have it, so only WebKit may skip.
const opfs = await navigator.storage.getDirectory().then(
  () => true,
  () => false,
);
const skip = !opfs && server.browser === 'webkit';

const worker = new Worker(new URL('../__fixtures__/opfs-worker.ts', import.meta.url), {
  type: 'module',
});
let ids = 0;
const dirs: string[] = [];

function run(scenario: string): Promise<unknown> {
  const id = ++ids;
  const dir = `isoloop-test-${Date.now()}-${id}`;
  dirs.push(dir);
  return new Promise((resolve, reject) => {
    const onMessage = (e: MessageEvent<{ id: number; value?: unknown; error?: string }>): void => {
      if (e.data.id !== id) return;
      worker.removeEventListener('message', onMessage);
      if (e.data.error !== undefined) reject(new Error(e.data.error));
      else resolve(e.data.value);
    };
    worker.addEventListener('message', onMessage);
    worker.postMessage({ id, scenario, dir });
  });
}

afterAll(async () => {
  worker.terminate();
  if (!opfs) return;
  const origin = await navigator.storage.getDirectory();
  await Promise.all(dirs.map((d) => origin.removeEntry(d, { recursive: true }).catch(() => {})));
});

describe.skipIf(skip)('OpfsStorage: segments and group commit', () => {
  it('writes 10,000 records and reads them back', async () => {
    expect(await run('write and read back')).toEqual({
      count: 10_000,
      offsetsInOrder: true,
      valuesMatch: true,
      keys: [null, 'k1', null, 'k3'],
      state: [{ topic: 'saved.v1', tail: 0, head: 10_000 }],
    });
  });

  it('rolls a segment over at 4 MiB', async () => {
    expect(await run('segments roll over at 4 MiB')).toEqual({
      count: 500,
      first: '0000000000000000.seg',
      segments: 2,
      // As full as a 10 KB record allows, and no fuller.
      firstFull: true,
    });
  });

  it('acknowledges a publish only after its batch is written', async () => {
    expect(await run('a publish resolves only after its flush')).toEqual({
      ackedEarly: false,
      onDiskBeforeAck: 0,
      result: { ok: true, value: { offset: 0 } },
      onDiskAfterAck: ['hello'],
      waitedForCommit: true,
    });
  });
});

describe.skipIf(skip)('OpfsStorage: committed offsets', () => {
  it('survive a reopen', async () => {
    expect(await run('offsets survive a reopen')).toEqual({ 'saved.v1': { c1: 42, c2: 7 } });
  });

  it('a write killed halfway leaves the previous offsets', async () => {
    expect(await run('a torn offsets write leaves the previous offsets')).toEqual({
      before: { 'saved.v1': { c1: 9, c2: 3 } },
      after: { 'saved.v1': { c1: 5 } },
      next: { 'saved.v1': { c1: 11 } },
    });
  });
});

describe.skipIf(skip)('recovery (M2b task 7)', () => {
  it('truncates a torn last frame and keeps the rest', async () => {
    expect(await run('recovery: a truncated last frame')).toEqual({
      state: [{ topic: 'saved.v1', tail: 0, head: 99 }],
      restored: [{ topic: 'saved.v1', head: 99 }],
      count: 99,
      missing: [99],
      committed: 60,
      next: 99,
      onDiskTail: [98, 'next'],
      onDiskCount: 100,
    });
  });

  it('skips a frame with a flipped byte and keeps every one after it', async () => {
    expect(await run('recovery: a flipped byte')).toEqual({
      state: [{ topic: 'saved.v1', tail: 0, head: 100 }],
      restored: [{ topic: 'saved.v1', head: 100 }],
      count: 99,
      missing: [50],
      committed: 60,
      next: 100,
      onDiskTail: [99, 'next'],
      onDiskCount: 100,
    });
  });

  it('opens with an empty newest segment', async () => {
    expect(await run('recovery: an empty segment')).toEqual({
      state: [{ topic: 'saved.v1', tail: 0, head: 100 }],
      restored: [{ topic: 'saved.v1', head: 100 }],
      count: 100,
      missing: [],
      committed: 60,
      next: 100,
      onDiskTail: [99, 'next'],
      onDiskCount: 101,
    });
  });
});

describe.skipIf(skip)('retention on disk (M2b task 9)', () => {
  it('a last-n: 1000 topic written with 100,000 records keeps only the segments it needs', async () => {
    expect(await run('retention on disk: last-n')).toEqual({
      atMostTwoSegments: true,
      keepsTheLast1000: true,
      fewerThanTwoSegments: true,
      tailOnReopen: true,
    });
  });

  it('a time topic drops the segments that fell out of retention', async () => {
    expect(await run('retention on disk: time')).toEqual({
      dropped: true,
      keepsEveryLiveRecord: true,
      oldestOnDisk: true,
    });
  });
});

describe.skipIf(skip)('compaction on disk (M2b task 10)', () => {
  it('leaves only the latest record per key, in order, with appends during it after it', async () => {
    expect(await run('compaction on disk: latest per key')).toEqual({
      shrank: true,
      count: 10 + 6 + 4 + 3,
      sameAsMemory: true,
      latestOnlyBeforeTheNewest: true,
      lateAtTheEnd: ['late', 'late', 'late'],
      lateAfterEverything: 3,
      flushedDuring: true,
      restoredSame: true,
      markers: [],
    });
  });

  // The crash is real: a child worker is killed partway. Firefox takes a
  // while to release a killed worker's files, hence the timeouts.
  it('a crash mid-rewrite leaves the old segments', async () => {
    expect(await run('compaction on disk: a crash mid-rewrite')).toEqual({
      oldSegments: true,
      compactedSegments: false,
      // The restore compacts in memory, so what the bus serves is the latest per key.
      restoredLatest: true,
      outputs: false,
      markers: [],
    });
  }, 60_000);

  it('a crash once the output is written finishes the swap on reopen', async () => {
    expect(await run('compaction on disk: a crash after the output is written')).toEqual({
      oldSegments: false,
      compactedSegments: true,
      restoredLatest: true,
      outputs: true,
      markers: [],
    });
  }, 60_000);
});
