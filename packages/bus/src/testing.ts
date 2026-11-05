import type { Issue } from '@isoloop/protocol';
import { toIssues, type StandardSchemaV1 } from './standard-schema';
import type { Contracts } from './topic';

/** Sample values for one topic. An array is shorthand for `{ values }`. */
export type TopicSamples =
  | readonly unknown[]
  | { values: readonly unknown[]; replies?: readonly unknown[] };

export type ContractProblem = {
  topic: string;
  /** `value` for the topic schema, `reply` for its reply schema. */
  schema: 'value' | 'reply';
  /** Index of the sample, or -1 for `no_samples`. */
  sample: number;
  /**
   * `invalid`: the schema rejected the sample. `not_plain`: its output isn't
   * plain, structured-cloneable data. `no_samples`: the topic has none.
   */
  kind: 'invalid' | 'not_plain' | 'no_samples';
  message: string;
  issues?: Issue[];
};

const PLAIN_TAGS: ReadonlySet<string> = new Set([
  '[object Date]',
  '[object RegExp]',
  '[object ArrayBuffer]',
  '[object Boolean]',
  '[object Number]',
  '[object String]',
]);

/**
 * Finds the first part of `v` that isn't plain data: functions, symbols, and
 * objects other than plain objects, arrays, Map, Set, Date, RegExp, ArrayBuffer
 * and its views. Class instances clone without their prototype, so they count.
 */
function notPlain(v: unknown, path: string, seen: Set<object>): string | undefined {
  if (typeof v === 'function') return `${path} is a function`;
  if (typeof v === 'symbol') return `${path} is a symbol`;
  if (typeof v !== 'object' || v === null) return undefined;
  if (seen.has(v)) return undefined;
  seen.add(v);
  if (Array.isArray(v)) {
    for (const [i, x] of v.entries()) {
      const p = notPlain(x, `${path}[${i}]`, seen);
      if (p) return p;
    }
    return undefined;
  }
  if (v instanceof Map) {
    for (const [k, x] of v) {
      const p = notPlain(k, `${path} key`, seen) ?? notPlain(x, `${path}.get(${String(k)})`, seen);
      if (p) return p;
    }
    return undefined;
  }
  if (v instanceof Set) {
    for (const x of v) {
      const p = notPlain(x, `${path} entry`, seen);
      if (p) return p;
    }
    return undefined;
  }
  if (ArrayBuffer.isView(v) || PLAIN_TAGS.has(Object.prototype.toString.call(v))) return undefined;
  const proto: unknown = Object.getPrototypeOf(v);
  if (proto !== Object.prototype && proto !== null) {
    const name = (v as { constructor?: { name?: string } }).constructor?.name ?? 'unknown';
    return `${path} is an instance of ${name}`;
  }
  for (const [k, x] of Object.entries(v)) {
    const p = notPlain(x, `${path}.${k}`, seen);
    if (p) return p;
  }
  return undefined;
}

async function check(
  topic: string,
  which: 'value' | 'reply',
  schema: StandardSchemaV1,
  samples: readonly unknown[],
): Promise<ContractProblem[]> {
  const results = await Promise.all(samples.map(async (v) => schema['~standard'].validate(v)));
  return results.flatMap((result, sample): ContractProblem[] => {
    if (result.issues) {
      return [
        {
          topic,
          schema: which,
          sample,
          kind: 'invalid',
          message: `sample ${sample} was rejected`,
          issues: toIssues(result.issues),
        },
      ];
    }
    const problem = notPlain(result.value, 'output', new Set());
    return problem ? [{ topic, schema: which, sample, kind: 'not_plain', message: problem }] : [];
  });
}

const isList = (s: TopicSamples): s is readonly unknown[] => Array.isArray(s);

/**
 * Runs sample values through every schema in a contracts list and reports
 * samples the schema rejects and outputs that aren't plain, cloneable data
 * (ADR 0003, decision 11). The broker only checks cloneability in dev builds,
 * so run this in the contracts package's tests. An empty result means all good.
 */
export async function testContracts(
  list: Contracts,
  samples: Readonly<Record<string, TopicSamples>>,
): Promise<ContractProblem[]> {
  const perTopic = await Promise.all(
    list.topics.map(async (t): Promise<ContractProblem[]> => {
      const s = samples[t.name] ?? [];
      const values = isList(s) ? s : s.values;
      const replies = isList(s) ? [] : (s.replies ?? []);
      const none: ContractProblem[] =
        values.length === 0
          ? [
              {
                topic: t.name,
                schema: 'value',
                sample: -1,
                kind: 'no_samples',
                message: 'no samples',
              },
            ]
          : [];
      const [v, r] = await Promise.all([
        check(t.name, 'value', t.schema, values),
        t.reply ? check(t.name, 'reply', t.reply, replies) : [],
      ]);
      return [...none, ...v, ...r];
    }),
  );
  return perTopic.flat();
}
