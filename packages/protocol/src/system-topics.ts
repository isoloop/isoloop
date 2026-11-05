import type { Retention } from './control';
import type { Issue } from './errors';
import { isSystemTopic } from './grants';

/**
 * A Standard Schema V1 built by hand (ADR 0003, decision 6). Protocol depends
 * on nothing, so this is the structural subset of the interface that system
 * topics need; it is assignable to the bus's vendored `StandardSchemaV1`.
 */
export type SystemSchema<T> = {
  readonly '~standard': {
    readonly version: 1;
    readonly vendor: 'isoloop';
    readonly validate: (
      value: unknown,
    ) => { readonly value: T; readonly issues?: undefined } | { readonly issues: readonly Issue[] };
    readonly types?: { readonly input: T; readonly output: T } | undefined;
  };
};

/** A kernel-owned `isoloop.*` topic: same shape as a bus `TopicDef`. */
export type SystemTopicDef<T> = {
  readonly name: string;
  readonly schema: SystemSchema<T>;
  readonly retention: Retention;
  readonly maxRecordBytes?: number;
};

/**
 * A check that returns the issues found in `value`, or none. `path` is where
 * `value` sits, so nested checks can report full paths.
 */
export type Check = (value: unknown, path: (string | number)[]) => Issue[];

/** Wraps a hand-written check as a Standard Schema that passes valid values through unchanged. */
export function systemSchema<T>(check: Check): SystemSchema<T> {
  return {
    '~standard': {
      version: 1,
      vendor: 'isoloop',
      validate: (value) => {
        const issues = check(value, []);
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the check is the guard
        return issues.length === 0 ? { value: value as T } : { issues };
      },
    },
  };
}

/** Defines a system topic. The name must start with `isoloop.`. */
export function systemTopic<T>(
  name: string,
  def: Omit<SystemTopicDef<T>, 'name'>,
): SystemTopicDef<T> {
  if (!isSystemTopic(name)) throw new Error(`system topic names start with isoloop.: ${name}`);
  return Object.freeze({ ...def, name });
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const issue = (path: (string | number)[], message: string): Issue[] => [{ message, path }];

/** Small building blocks for hand-written checks. */
export const checks: {
  string: Check;
  optionalString: Check;
  /** A plain object whose listed fields pass their checks. Other fields are allowed. */
  object: (fields: Readonly<Record<string, Check>>) => Check;
  /** Any value. */
  any: Check;
} = {
  string: (v, path) => (typeof v === 'string' ? [] : issue(path, 'expected a string')),
  optionalString: (v, path) =>
    v === undefined || typeof v === 'string' ? [] : issue(path, 'expected a string or nothing'),
  object: (fields) => (v, path) => {
    if (!isObject(v)) return issue(path, 'expected an object');
    return Object.entries(fields).flatMap(([k, check]) => check(v[k], [...path, k]));
  },
  any: () => [],
};
