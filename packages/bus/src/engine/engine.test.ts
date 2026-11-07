import type { TopicConfig } from '@isoloop/protocol';
import { describe, expect, it, vi } from 'vitest';
import { runEngineConformance } from '../../test/engine-conformance';
import { ReferenceEngine } from '../../test/reference-engine';
import { MemoryStorage, effectiveDurability } from './memory-storage';
import type { LogStorage } from './types';

// The suite checks itself against the simplest correct engine first.
runEngineConformance('reference', (opts) => new ReferenceEngine(opts));

describe('MemoryStorage', () => {
  it('keeps nothing', async () => {
    const s = new MemoryStorage();
    expect(s.kind).toBe('memory');
    s.appendBatch('t', [new Uint8Array([1])]);
    s.saveOffsets({ t: { x: 1 } });
    await s.flush();
    await s.rewrite('t', () => true);
    expect(await s.open()).toEqual({ topics: [], offsets: {} });
    expect(await s.readSegment('t', 0)).toEqual([]);
    expect(await s.quarantineNewest()).toEqual([]);
  });
});

const topic = (name: string, durability?: 'memory' | 'persistent'): TopicConfig => ({
  name,
  retention: { kind: 'compacted' },
  requestable: false,
  ...(durability ? { durability } : {}),
});

describe('effective durability', () => {
  it("keeps 'persistent' in memory on memory storage, without a warning", () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const storage = new MemoryStorage();
    expect(effectiveDurability(topic('a'), storage)).toBe('memory');
    expect(effectiveDurability(topic('b', 'memory'), storage)).toBe('memory');
    expect(effectiveDurability(topic('c', 'persistent'), storage)).toBe('memory');
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("stays 'persistent' on a storage that keeps data", () => {
    const m = new MemoryStorage();
    const opfs: LogStorage = {
      kind: 'opfs',
      open: async () => m.open(),
      appendBatch: (t, e) => m.appendBatch(t, e),
      flush: async () => m.flush(),
      saveOffsets: (o) => m.saveOffsets(o),
      dropBelow: (t, o) => m.dropBelow(t, o),
      rewrite: async (t, k) => m.rewrite(t, k),
      readSegment: async (t, f) => m.readSegment(t, f),
      quarantineNewest: async () => m.quarantineNewest(),
    };
    expect(effectiveDurability(topic('a', 'persistent'), opfs)).toBe('persistent');
  });
});
