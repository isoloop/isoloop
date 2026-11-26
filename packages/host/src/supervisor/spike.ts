/*
 * SPIKE #389 (not for main): option (a), judging a silent worker against its
 * siblings. Pure, so the kernel and the simulation share it.
 */
import type { IsolateSupervision } from './machine';

export type SpikeSwitches = { a: boolean; b: boolean; share: number; cap: number };

/**
 * `cap` when at least 2 workers, and at least `share` of the live ones, have
 * been silent for over `blockedAfterMs` (a loading worker counts from its
 * spawn); otherwise undefined. A pool's members count as one worker.
 */
export function siblingHold(
  members: Iterable<{ worker: string; sup: IsolateSupervision }>,
  at: number,
  blockedAfterMs: number,
  sw: Pick<SpikeSwitches, 'share' | 'cap'>,
): number | undefined {
  const silent = new Map<string, boolean>();
  for (const { worker, sup } of members) {
    const st = sup.state;
    if (st !== 'loading' && st !== 'running' && st !== 'blocked') continue;
    const since = st === 'loading' ? sup.spawnedAt : sup.lastBeatAt;
    silent.set(worker, (silent.get(worker) ?? false) || at - since > blockedAfterMs);
  }
  let n = 0;
  for (const q of silent.values()) if (q) n++;
  return n >= 2 && n / silent.size >= sw.share ? sw.cap : undefined;
}
