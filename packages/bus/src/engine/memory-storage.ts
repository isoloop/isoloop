import type { TopicConfig } from '@isoloop/protocol';
import type { LogStorage, StoredState } from './types';

/** Storage that keeps nothing. Every topic behaves as `memory`. */
export class MemoryStorage implements LogStorage {
  readonly kind = 'memory' as const;

  open(): Promise<StoredState> {
    return Promise.resolve({ topics: [], offsets: {} });
  }

  appendBatch(_topic: string, _encoded: Uint8Array[]): void {}

  flush(): Promise<void> {
    return Promise.resolve();
  }

  saveOffsets(_offsets: Record<string, Record<string, number>>): void {}

  dropBelow(_topic: string, _tail: number): void {}

  rewrite(
    _topic: string,
    _keep: (offset: number, key: string | undefined) => boolean,
  ): Promise<void> {
    return Promise.resolve();
  }

  readSegment(_topic: string, _fromOffset: number): Promise<Uint8Array[]> {
    return Promise.resolve([]);
  }

  bytes(_topic: string): Promise<number> {
    return Promise.resolve(0);
  }

  deleteTopic(_topic: string): Promise<boolean> {
    return Promise.resolve(false);
  }

  quarantineNewest(): Promise<string[]> {
    return Promise.resolve([]);
  }
}

/**
 * Engines call this from `createTopic`: the durability a topic actually gets.
 * A `persistent` topic on storage that keeps nothing (no OPFS, or another tab
 * holds it) behaves as `memory`; the kernel reports that as
 * `bus:durability-degraded` (ADR 0007, decision 6).
 */
export function effectiveDurability(
  cfg: TopicConfig,
  storage: LogStorage,
): 'memory' | 'persistent' {
  if (cfg.durability !== 'persistent') return 'memory';
  return storage.kind === 'memory' ? 'memory' : 'persistent';
}
