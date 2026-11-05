import type { TopicConfig } from '@isoloop/protocol';
import type { LogStorage, StoredState } from './types';

/** Storage that keeps nothing (M2). Every topic behaves as `memory`. */
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

  rewrite(_topic: string, _keep: (offset: number) => boolean): Promise<void> {
    return Promise.resolve();
  }

  readSegment(_topic: string, _fromOffset: number): Promise<Uint8Array[]> {
    return Promise.resolve([]);
  }

  quarantineNewest(): Promise<string[]> {
    return Promise.resolve([]);
  }
}

let warned = false;

/**
 * Engines call this from `createTopic`. Until OPFS storage lands (M2b), a
 * `persistent` topic on memory storage behaves as `memory`, with one console
 * warning per bus worker. Returns the durability the topic actually gets.
 */
export function effectiveDurability(
  cfg: TopicConfig,
  storage: LogStorage,
  warn: (message: string) => void = console.warn,
): 'memory' | 'persistent' {
  if (cfg.durability !== 'persistent') return 'memory';
  if (storage.kind !== 'memory') return 'persistent';
  if (!warned) {
    warned = true;
    warn(
      `[isoloop] durability 'persistent' isn't available yet (M2b); ${cfg.name} and other persistent topics are kept in memory.`,
    );
  }
  return 'memory';
}

/** Tests only: lets the one-time warning fire again. */
export function resetDurabilityWarning(): void {
  warned = false;
}
