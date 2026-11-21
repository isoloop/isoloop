import type { CallError, ErrorCode, Issue } from './errors';

/**
 * A rejected bus call (`kernel.publish`, `ctx.bus.publish`, `request`,
 * `reply`): the broker's error code, and the schema issues for `invalid`.
 */
export class BusError extends Error {
  /** What went wrong, to branch on: `invalid`, `forbidden`, `timeout`, `bus_unavailable`, … */
  readonly code: ErrorCode;
  /** For `invalid`: where the value failed its schema, and why. */
  readonly issues: readonly Issue[] | undefined;

  /** @param error The broker's error: its code, message and issues. */
  constructor(error: CallError) {
    super(error.message);
    this.name = 'BusError';
    this.code = error.code;
    this.issues = error.issues;
  }
}
