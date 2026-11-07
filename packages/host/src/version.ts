/*
 * The versions this host runs isolates from (ADR 0012, decision 4): an
 * isolate stamped `requires` runs if `FLOOR <= requires <= VERSION`.
 */
import { compareVersions, majorMinor } from '@isoloop/protocol';
import { version } from '../package.json';

/** This host's Isoloop `major.minor`, from the package version at build time. */
export const VERSION: string = majorMinor(version) ?? '0.0';

/**
 * The oldest `requires` this host still runs. It moves only when something
 * is removed from or changed in the seam, which takes an ADR (decision 5).
 */
export const FLOOR = '0.0';

export type VersionVerdict =
  | { ok: true }
  | { ok: false; reason: 'runtime-too-old' | 'isolate-too-old'; message: string };

/**
 * Whether an isolate stamped `requires` runs on a host in `[floor, version]`.
 * No stamp, or one that isn't a version, isn't checked.
 */
export function checkRequires(
  requires: string | undefined,
  range: { version: string; floor: string } = { version: VERSION, floor: FLOOR },
): VersionVerdict {
  if (requires === undefined || majorMinor(requires) === undefined) return { ok: true };
  const runs = range.floor === range.version ? range.version : `${range.floor} to ${range.version}`;
  const message = `built for ${majorMinor(requires)}, this host runs ${runs}`;
  if (compareVersions(requires, range.version) > 0) {
    return { ok: false, reason: 'runtime-too-old', message };
  }
  if (compareVersions(requires, range.floor) < 0) {
    return { ok: false, reason: 'isolate-too-old', message };
  }
  return { ok: true };
}

/**
 * `deprecated(member)` warns once per member, and only when `dev` is set:
 * a deprecated member keeps working for at least one minor before the floor
 * moves past it (decision 5).
 */
export function createDeprecations(dev: boolean): (member: string, instead?: string) => void {
  const warned = new Set<string>();
  return (member, instead) => {
    if (!dev || warned.has(member)) return;
    warned.add(member);
    console.warn(
      `[isoloop] ${member} is deprecated${instead ? `; use ${instead}` : ''}. It keeps working until the version floor moves past it (ADR 0012).`,
    );
  };
}
