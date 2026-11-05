import type { CallError, ErrorCode, Issue } from './errors';

/**
 * A rejected bus call (`kernel.publish`, `ctx.bus.publish`, `request`,
 * `reply`): the broker's error code, and the schema issues for `invalid`.
 */
export class BusError extends Error {
  readonly code: ErrorCode;
  readonly issues: readonly Issue[] | undefined;

  constructor(error: CallError) {
    super(error.message);
    this.name = 'BusError';
    this.code = error.code;
    this.issues = error.issues;
  }
}
