import type { BusRecord, TopicConfig } from '@isoloop/protocol';
import type { LogEngine, NewRecord } from '../src/engine/types';

type Topic = { cfg: TopicConfig; records: BusRecord[]; head: number; commits: Map<string, number> };

/**
 * The simplest correct `LogEngine`: one array per topic, filtered on
 * retention. Slow on purpose. It keeps the conformance suite honest and is the
 * model real engines are compared with.
 */
export class ReferenceEngine implements LogEngine {
  readonly #topics = new Map<string, Topic>();
  readonly #now: () => number;

  constructor(opts: { now: () => number }) {
    this.#now = opts.now;
  }

  #topic(name: string): Topic {
    const t = this.#topics.get(name);
    if (!t) throw new Error(`unknown topic ${name}`);
    return t;
  }

  createTopic(cfg: TopicConfig): void {
    if (this.#topics.has(cfg.name)) throw new Error(`topic ${cfg.name} exists`);
    this.#topics.set(cfg.name, { cfg, records: [], head: 0, commits: new Map() });
  }

  append(topic: string, rec: NewRecord): number {
    const t = this.#topic(topic);
    const offset = t.head++;
    t.records.push({ ...rec, offset });
    const r = t.cfg.retention;
    if (r.kind === 'last-n' && t.records.length > r.n) t.records.splice(0, t.records.length - r.n);
    return offset;
  }

  read(topic: string, fromOffset: number, max: number): BusRecord[] {
    return this.#topic(topic)
      .records.filter((r) => r.offset >= fromOffset)
      .slice(0, max);
  }

  head(topic: string): number {
    return this.#topic(topic).head;
  }

  tail(topic: string): number {
    const t = this.#topic(topic);
    return t.records[0]?.offset ?? t.head;
  }

  commit(topic: string, consumer: string, offset: number): void {
    this.#topic(topic).commits.set(consumer, offset);
  }

  committed(topic: string, consumer: string): number | undefined {
    return this.#topic(topic).commits.get(consumer);
  }

  durable(_topic: string): boolean {
    return false;
  }

  flush(): Promise<void> {
    return Promise.resolve();
  }

  readable(_topic: string, _fromOffset: number): boolean {
    return true;
  }

  page(_topic: string, _fromOffset: number): Promise<void> {
    return Promise.resolve();
  }

  compact(topic: string): void {
    const t = this.#topic(topic);
    const r = t.cfg.retention;
    if (r.kind === 'time') {
      // Records expire in offset order: the first one young enough stops the pass.
      const cutoff = this.#now() - r.ms;
      const keep = t.records.findIndex((x) => x.ts >= cutoff);
      t.records = keep === -1 ? [] : t.records.slice(keep);
    } else if (r.kind === 'compacted') {
      const latest = new Map<string, number>();
      for (const x of t.records) if (x.key !== undefined) latest.set(x.key, x.offset);
      t.records = t.records.filter((x) => x.key === undefined || latest.get(x.key) === x.offset);
    }
  }
}
