/*
 * Memory per isolate (ADR 0020, decision 4). Chromium has `performance.memory`
 * only on the main thread, so the host measures instead: on a cross-origin
 * isolated page, `performance.measureUserAgentSpecificMemory()` breaks the
 * page's memory down by realm, naming each dedicated worker by its URL. Every
 * worker starts from a URL of its own (`workerUrl` in the loader), so the
 * breakdown maps back to isolates: an own worker to its isolate, a pool's
 * worker to every member, marked as shared.
 */
import type { InspectMemory } from '@isoloop/protocol';

/** One live worker and the isolates in it. */
export type MemoryWorker = {
  url: string;
  ids: readonly string[];
  /** True for a pool's worker: its figure is shared by every member. */
  pool: boolean;
};

/** Measures the page, or `undefined` where it can't be measured. */
export type MeasureMemory = () => Promise<unknown>;

/**
 * The browser's measurement, where there is one: Chromium, on a page that is
 * cross-origin isolated (COOP `same-origin` and COEP `require-corp`).
 */
export function memoryMeasure(): MeasureMemory | undefined {
  if (typeof crossOriginIsolated !== 'boolean' || !crossOriginIsolated) return undefined;
  const measure: unknown = Reflect.get(performance, 'measureUserAgentSpecificMemory');
  if (typeof measure !== 'function') return undefined;
  return () => Promise.resolve(Reflect.apply(measure, performance, []));
}

const field = (o: unknown, key: string): unknown =>
  typeof o === 'object' && o !== null ? Reflect.get(o, key) : undefined;

/**
 * The bytes the report attributes to each worker, by worker URL. A breakdown
 * entry that names several realms (memory the engine can't split) goes to
 * none of them, so no worker is shown more than it holds.
 */
export function bytesByWorkerUrl(report: unknown): Map<string, number> {
  const out = new Map<string, number>();
  const breakdown = field(report, 'breakdown');
  if (!Array.isArray(breakdown)) return out;
  for (const entry of breakdown) {
    const bytes = field(entry, 'bytes');
    const attribution = field(entry, 'attribution');
    if (typeof bytes !== 'number' || !Array.isArray(attribution) || attribution.length !== 1)
      continue;
    const a: unknown = attribution[0];
    const url = field(a, 'url');
    if (field(a, 'scope') !== 'DedicatedWorkerGlobalScope' || typeof url !== 'string') continue;
    out.set(url, (out.get(url) ?? 0) + bytes);
  }
  return out;
}

/** Each isolate's memory from one report; isolates whose worker isn't in it are left out. */
export function memoryByIsolate(
  report: unknown,
  workers: readonly MemoryWorker[],
  at: number,
): Map<string, InspectMemory> {
  const bytes = bytesByWorkerUrl(report);
  const out = new Map<string, InspectMemory>();
  for (const w of workers) {
    const b = bytes.get(w.url);
    if (b === undefined) continue;
    for (const id of w.ids) out.set(id, w.pool ? { bytes: b, at, shared: true } : { bytes: b, at });
  }
  return out;
}
