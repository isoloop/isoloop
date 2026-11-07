import type { BusRecord, ErrorCode, Issue } from '@isoloop/protocol';
import type { LogEngine, NewRecord } from './engine/types';
import type { AnyTopicDef } from './topic';

/** How many source records one step of the seed loop reads before it yields. */
export const SEED_BATCH = 256;

/** What a mapped record became: the stored value, or why it was skipped. */
export type SeedVerdict =
  | { ok: true; value: unknown }
  | { ok: false; code: ErrorCode; issues: Issue[] };

/**
 * Seed progress, kept as committed offsets of reserved consumers on the
 * seeding topic. Offsets are written after the records of the same group
 * commit, so the progress never points past what is on disk (ADR 0003,
 * decision 18: exactly once).
 */
export const SEED_FROM = 'isoloop:seed:from';
/** The seeding topic's head when `SEED_FROM` was saved. */
export const SEED_HEAD = 'isoloop:seed:head';
/** Set when the seed ended: the source's head then. */
export const SEED_DONE = 'isoloop:seed:done';
/** How many source records were rejected, all runs together. */
export const SEED_REJECTED = 'isoloop:seed:rejected';
/** One per rejected source offset; its value is the offset. */
export const SEED_REJECTED_AT = 'isoloop:seed:rejected:';

/** At most this many `rejected` reports per topic per second; the rest only count. */
export const SEED_REPORTS_PER_SEC = 10;

export type SeedCopy = {
  engine: LogEngine;
  /** The seeding topic (v2) and the topic it reads (v1). */
  to: string;
  from: string;
  map: (value: unknown, record: BusRecord) => unknown;
  /** v2's schema and the broker's checks on a mapped value; may be async. */
  accept: (value: unknown) => SeedVerdict | Promise<SeedVerdict>;
  /** A source record was skipped. */
  onReject?: (offset: number, verdict: Extract<SeedVerdict, { ok: false }>) => void;
};

export type SeedResult = { copied: number; rejected: number };

/** Whether a seed into `to` started on this device and hasn't ended. */
export function seedPending(engine: LogEngine, to: string): boolean {
  return engine.committed(to, SEED_FROM) !== undefined && !seedDone(engine, to);
}

export function seedDone(engine: LogEngine, to: string): boolean {
  return engine.committed(to, SEED_DONE) !== undefined;
}

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

const issue = (message: string): Issue[] => [{ message, path: [] }];

/** Runs `map`; a throw or a returned promise rejects the record. */
function mapOne(c: SeedCopy, rec: BusRecord): SeedVerdict {
  let mapped: unknown;
  try {
    mapped = c.map(rec.value, rec);
  } catch (e) {
    return { ok: false, code: 'invalid', issues: issue(`map threw: ${String(e)}`) };
  }
  if (mapped instanceof Promise) {
    // `map` must be synchronous (ADR 0003, decision 18).
    mapped.catch(() => {});
    return { ok: false, code: 'seed_async', issues: issue('map returned a promise') };
  }
  return { ok: true, value: mapped };
}

/**
 * Copies `from`'s records into `to` until it reaches `from`'s head, keeping
 * each record's `ts`, `producer` and `key`, and saving progress with every
 * batch. A seed cut short resumes after the last saved source offset; records
 * it appended after that save are recognised and not appended again, since
 * `map` and the schema are pure. Records `map` or `to`'s schema rejects are
 * skipped, reported and recorded. Yields between batches, so other topics
 * carry on.
 */
export async function copySeed(c: SeedCopy): Promise<SeedResult> {
  const { engine, to, from } = c;
  const last = engine.committed(to, SEED_FROM);
  let offset = Math.max(last === undefined ? 0 : last + 1, engine.tail(from));
  // Appended after the last saved progress, before the seed was cut short.
  let skip = engine.head(to) - (engine.committed(to, SEED_HEAD) ?? 0);
  let rejected = engine.committed(to, SEED_REJECTED) ?? 0;
  while (offset < engine.head(from)) {
    if (!engine.readable(from, offset)) {
      // oxlint-disable-next-line no-await-in-loop -- one evicted segment at a time
      await engine.page(from, offset);
    }
    const batch = engine.read(from, offset, SEED_BATCH);
    const end = batch.at(-1);
    if (!end) break;
    for (const rec of batch) {
      const mapped = mapOne(c, rec);
      // oxlint-disable-next-line no-await-in-loop -- records are copied in order
      const verdict = mapped.ok ? await c.accept(mapped.value) : mapped;
      if (!verdict.ok) {
        const at = `${SEED_REJECTED_AT}${rec.offset}`;
        if (engine.committed(to, at) === undefined) {
          engine.commit(to, at, rec.offset);
          rejected++;
        }
        c.onReject?.(rec.offset, verdict);
        continue;
      }
      if (skip > 0) {
        skip--;
        continue;
      }
      let out: NewRecord = { value: verdict.value, ts: rec.ts, producer: rec.producer };
      if (rec.key !== undefined) out = { ...out, key: rec.key };
      engine.append(to, out);
    }
    offset = end.offset + 1;
    engine.commit(to, SEED_REJECTED, rejected);
    engine.commit(to, SEED_FROM, end.offset);
    engine.commit(to, SEED_HEAD, engine.head(to));
    // oxlint-disable-next-line no-await-in-loop -- yield between batches
    await new Promise<void>((r) => setTimeout(r, 0));
  }
  engine.commit(to, SEED_REJECTED, rejected);
  engine.commit(to, SEED_DONE, engine.head(from));
  return { copied: engine.head(to), rejected };
}
