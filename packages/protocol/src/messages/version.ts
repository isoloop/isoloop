/*
 * Isoloop versions across the isolate seam (ADR 0012): isolates are stamped
 * with the `major.minor` they were built against (`requires`), and the host
 * runs `[FLOOR, VERSION]`. Patch releases never change the seam, so they
 * don't count.
 */

/** `"0.4.2"` → `"0.4"`. Anything that isn't `major.minor[.patch…]` gives `undefined`. */
export function majorMinor(version: string): string | undefined {
  const m = /^(\d+)\.(\d+)(?:[.+-].*)?$/.exec(version);
  return m ? `${Number(m[1])}.${Number(m[2])}` : undefined;
}

/** Orders two `major.minor` stamps: negative, zero or positive. Unparseable ones throw. */
const parse = (v: string): [number, number] => {
  const mm = majorMinor(v);
  if (mm === undefined) throw new TypeError(`not a version: ${JSON.stringify(v)}`);
  const [major = 0, minor = 0] = mm.split('.').map(Number);
  return [major, minor];
};

export function compareVersions(a: string, b: string): number {
  const [am, an] = parse(a);
  const [bm, bn] = parse(b);
  return am - bm || an - bn;
}
