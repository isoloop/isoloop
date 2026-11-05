import type { TopicConfig } from '@isoloop/protocol';
import { describe, expect, it, vi } from 'vitest';
import { runEngineConformance } from '../../test/engine-conformance';
import { ReferenceEngine } from '../../test/reference-engine';
import { MemoryStorage, effectiveDurability, resetDurabilityWarning } from './memory-storage';
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

describe('durability until M2b', () => {
  it("accepts 'persistent' but keeps it in memory, warning once", () => {
    resetDurabilityWarning();
    const warn = vi.fn();
    const storage = new MemoryStorage();
    expect(effectiveDurability(topic('a'), storage, warn)).toBe('memory');
    expect(effectiveDurability(topic('b', 'memory'), storage, warn)).toBe('memory');
    expect(warn).not.toHaveBeenCalled();
    expect(effectiveDurability(topic('c', 'persistent'), storage, warn)).toBe('memory');
    expect(effectiveDurability(topic('d', 'persistent'), storage, warn)).toBe('memory');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain('c');
  });

  it("stays 'persistent' on a storage that keeps data", () => {
    const m = new MemoryStorage();
    const opfs: LogStorage = {
      kind: 'opfs',
      open: async () => m.open(),
      appendBatch: (t, e) => m.appendBatch(t, e),
      flush: async () => m.flush(),
      saveOffsets: (o) => m.saveOffsets(o),
      rewrite: async (t, k) => m.rewrite(t, k),
      readSegment: async (t, f) => m.readSegment(t, f),
      quarantineNewest: async () => m.quarantineNewest(),
    };
    expect(effectiveDurability(topic('a', 'persistent'), opfs)).toBe('persistent');
  });
});
