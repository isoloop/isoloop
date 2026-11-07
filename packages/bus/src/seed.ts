import type { BusRecord } from '@isoloop/protocol';
import type { LogEngine, NewRecord } from './engine/types';
import type { AnyTopicDef } from './topic';

/** How many source records one step of the seed loop reads before it yields. */
export const SEED_BATCH = 256;

/** What a mapped record became: the stored value, or why it was skipped. */
export type SeedVerdict = { ok: true; value: unknown } | { ok: false; reason: unknown };

export type SeedCopy = {
  engine: LogEngine;
  /** The seeding topic (v2) and the topic it reads (v1). */
  to: string;
  from: string;
  map: (value: unknown, record: BusRecord) => unknown;
  /** v2's schema and the broker's checks on a mapped value; may be async. */
  accept: (value: unknown) => SeedVerdict | Promise<SeedVerdict>;
};

export type SeedResult = { copied: number; rejected: number[] };

/**
 * Topics with a seed, sources before the topics that seed from them, so a
 * chain (v3 from v2 from v1) runs in order. `contracts()` has already refused
 * unknown sources and cycles.
 */
export function seedOrder(topics: readonly AnyTopicDef[]): AnyTopicDef[] {
  const byName = new Map(topics.map((t) => [t.name, t]));
  const out: AnyTopicDef[] = [];
  const seen = new Set<string>();
  const visit = (t: AnyTopicDef): void => {
    if (seen.has(t.name)) return;
    seen.add(t.name);
    const from = t.seed && byName.get(t.seed.from.name);
    if (from) visit(from);
    if (t.seed) out.push(t);
  };
  for (const t of topics) visit(t);
  return out;
}

/** Runs `map`; a throw or a returned promise rejects the record. */
function mapOne(c: SeedCopy, rec: BusRecord): SeedVerdict {
  let mapped: unknown;
  try {
    mapped = c.map(rec.value, rec);
  } catch (e) {
    return { ok: false, reason: e };
  }
  if (mapped instanceof Promise) {
    // `map` must be synchronous (ADR 0003, decision 18).
    mapped.catch(() => {});
    return { ok: false, reason: 'seed_async' };
  }
  return { ok: true, value: mapped };
}

/**
 * Copies `from`'s records into `to` until it reaches `from`'s head, keeping
 * each record's `ts`, `producer` and `key`. Records `map` or `to`'s schema
 * rejects are skipped and their offsets returned. Yields between batches, so
 * other topics carry on.
 */
export async function copySeed(c: SeedCopy): Promise<SeedResult> {
  const result: SeedResult = { copied: 0, rejected: [] };
  let offset = c.engine.tail(c.from);
  while (offset < c.engine.head(c.from)) {
    if (!c.engine.readable(c.from, offset)) {
      // oxlint-disable-next-line no-await-in-loop -- one evicted segment at a time
      await c.engine.page(c.from, offset);
    }
    const batch = c.engine.read(c.from, offset, SEED_BATCH);
    const last = batch.at(-1);
    if (!last) break;
    for (const rec of batch) {
      const mapped = mapOne(c, rec);
      // oxlint-disable-next-line no-await-in-loop -- records are copied in order
      const verdict = mapped.ok ? await c.accept(mapped.value) : mapped;
      if (!verdict.ok) {
        result.rejected.push(rec.offset);
        continue;
      }
      let out: NewRecord = { value: verdict.value, ts: rec.ts, producer: rec.producer };
      if (rec.key !== undefined) out = { ...out, key: rec.key };
      c.engine.append(c.to, out);
      result.copied++;
    }
    offset = last.offset + 1;
    // oxlint-disable-next-line no-await-in-loop -- yield between batches
    await new Promise<void>((r) => setTimeout(r, 0));
  }
  return result;
}
