import type { Issue as WireIssue } from '@isoloop/protocol';

/**
 * The Standard Schema V1 interface (https://standardschema.dev), vendored so
 * the bus depends on no schema library (ADR 0003, decision 1). Zod 4, Valibot
 * and ArkType implement it. Copied from the spec; keep it in step with it.
 */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly '~standard': StandardSchemaV1.Props<Input, Output>;
}

export declare namespace StandardSchemaV1 {
  export interface Props<Input = unknown, Output = Input> {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (value: unknown) => Result<Output> | Promise<Result<Output>>;
    readonly types?: Types<Input, Output> | undefined;
  }

  export type Result<Output> = SuccessResult<Output> | FailureResult;

  export interface SuccessResult<Output> {
    readonly value: Output;
    readonly issues?: undefined;
  }

  export interface FailureResult {
    readonly issues: ReadonlyArray<Issue>;
  }

  export interface Issue {
    readonly message: string;
    readonly path?: ReadonlyArray<PropertyKey | PathSegment> | undefined;
  }

  export interface PathSegment {
    readonly key: PropertyKey;
  }

  export interface Types<Input = unknown, Output = Input> {
    readonly input: Input;
    readonly output: Output;
  }

  export type InferInput<Schema extends StandardSchemaV1> = NonNullable<
    Schema['~standard']['types']
  >['input'];

  export type InferOutput<Schema extends StandardSchemaV1> = NonNullable<
    Schema['~standard']['types']
  >['output'];
}

const segmentKey = (s: PropertyKey | StandardSchemaV1.PathSegment): PropertyKey =>
  typeof s === 'object' ? s.key : s;

/**
 * Maps schema issues to the cloneable `{ message, path }[]` sent with `invalid`
 * (ADR 0003, decision 10). Symbol keys become their description.
 */
export function toIssues(issues: ReadonlyArray<StandardSchemaV1.Issue>): WireIssue[] {
  return issues.map((i) => ({
    message: i.message,
    path: (i.path ?? []).map((s) => {
      const k = segmentKey(s);
      return typeof k === 'symbol' ? String(k) : k;
    }),
  }));
}
