/*
 * The codemod steps `isoloop migrate` knows, one per release that breaks an
 * API (ADR 0019, decision 10), and the version arithmetic that picks them.
 * steps.test.ts runs every step on its fixtures.
 */
import { step as step02 } from './0.2/step';
import type { Step } from './step';

/** Every step, oldest first. */
export const STEPS: readonly Step[] = [step02];

/** A version as `isoloop migrate` compares them. */
export type Version = {
  readonly major: number;
  readonly minor: number;
  /** A prerelease of `major.minor.0` (`0.2.0-next.3`): that release's steps still apply. */
  readonly before: boolean;
};

/** `0.2`, `0.2.1` or `0.2.0-next.3`, or `undefined` for anything else. */
export function parseVersion(text: string): Version | undefined {
  const m = /^v?(\d+)\.(\d+)(?:\.(\d+)(-[0-9A-Za-z.-]+)?)?$/.exec(text.trim());
  if (!m) return undefined;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    before: m[4] !== undefined && Number(m[3]) === 0,
  };
}

/** Orders `major.minor`, ignoring `before`. */
export const compare = (a: Version, b: Version): number => a.major - b.major || a.minor - b.minor;

export const format = (v: Version): string => `${v.major}.${v.minor}`;

/** A step's version, parsed; steps are written by us, so a bad one is a bug. */
function versionOf(s: Step): Version {
  const v = parseVersion(s.version);
  if (v === undefined) throw new Error(`step version ${s.version} isn't major.minor`);
  return v;
}

/** Does code on `installed` still need the step for `step`? */
export function needs(installed: Version, step: Version): boolean {
  const c = compare(step, installed);
  return c > 0 || (c === 0 && installed.before);
}

/** The steps that take code from `from` up to `to` (inclusive), oldest first. */
export function stepsBetween(
  from: Version,
  to: Version | undefined,
  steps: readonly Step[] = STEPS,
): Step[] {
  return steps.filter((s) => {
    const v = versionOf(s);
    return needs(from, v) && (to === undefined || compare(v, to) <= 0);
  });
}

/** The newest version a step exists for, or `undefined` with no steps. */
export function latest(steps: readonly Step[] = STEPS): Version | undefined {
  return steps.map(versionOf).toSorted(compare).at(-1);
}
