// Every step against its fixtures: each `<case>.before.<ext>` becomes
// `<case>.after.<ext>`, and the after file is left alone (a second run
// changes nothing). Every version folder has a step and at least one pair.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { applyChange } from './edit';
import { loadParser } from './parser';
import type { Step } from './step';
import { latest, needs, parseVersion, STEPS, stepsBetween, type Version } from './steps';

const here = fileURLToPath(new URL('.', import.meta.url));
const parser = await loadParser();

/** The version folders next to this file (`0.2`, …). */
const folders = readdirSync(here).filter(
  (n) => /^\d+\.\d+$/.test(n) && statSync(join(here, n)).isDirectory(),
);

/** A step run once on `text`, as `isoloop migrate` runs it. */
function run(step: Step, path: string, text: string): string {
  if (!step.mayChange(text)) return text;
  const r = parser.parse(path, text);
  if (!r.ok) throw new Error(`${path} doesn't parse: ${r.errors[0]?.message}`);
  return applyChange(text, step.transform(r.file));
}

describe('the steps', () => {
  it('are one per version folder, oldest first', () => {
    expect(STEPS.map((s) => s.version)).toEqual(
      folders.toSorted((a, b) => {
        const [x, y] = [parseVersion(a), parseVersion(b)];
        return (x?.major ?? 0) - (y?.major ?? 0) || (x?.minor ?? 0) - (y?.minor ?? 0);
      }),
    );
  });

  for (const step of STEPS) {
    describe(step.version, () => {
      const dir = join(here, step.version, 'fixtures');
      const befores = readdirSync(dir).filter((n) => /\.before\.[cm]?[jt]sx?$/.test(n));

      it('has fixtures, each with its after file', () => {
        expect(befores.length).toBeGreaterThan(0);
        for (const b of befores) {
          expect(readdirSync(dir), b).toContain(b.replace('.before.', '.after.'));
        }
      });

      for (const b of befores) {
        const a = b.replace('.before.', '.after.');
        it(`turns ${b} into ${a}, and leaves ${a} alone`, () => {
          const before = readFileSync(join(dir, b), 'utf8');
          const after = readFileSync(join(dir, a), 'utf8');
          expect(run(step, join(dir, b), before)).toBe(after);
          expect(run(step, join(dir, a), after)).toBe(after);
        });
      }
    });
  }
});

const v = (text: string): Version => {
  const p = parseVersion(text);
  if (p === undefined) throw new Error(`bad version ${text}`);
  return p;
};

/** A step that changes nothing, for picking by version. */
const step = (version: string): Step => ({
  version,
  summary: version,
  mayChange: () => false,
  transform: () => ({ edits: [], flags: [] }),
});

describe('versions', () => {
  it('parse as major.minor, a full version or a prerelease', () => {
    expect(parseVersion('0.2')).toEqual({ major: 0, minor: 2, before: false });
    expect(parseVersion('v1.4.2')).toEqual({ major: 1, minor: 4, before: false });
    expect(parseVersion('0.2.0-next.3')).toEqual({ major: 0, minor: 2, before: true });
    expect(parseVersion('0.2.1-next.0')).toEqual({ major: 0, minor: 2, before: false });
    for (const bad of ['', '2', 'latest', '0.2.x', '^0.2.0'])
      expect(parseVersion(bad)).toBeUndefined();
  });

  it("apply a release's step to code below it and to its prereleases", () => {
    expect(needs(v('0.1.1'), v('0.2'))).toBe(true);
    expect(needs(v('0.2.0-next.4'), v('0.2'))).toBe(true);
    expect(needs(v('0.2.0'), v('0.2'))).toBe(false);
    expect(needs(v('0.3.0'), v('0.2'))).toBe(false);
  });

  it('pick the steps between two versions, oldest first', () => {
    const steps = [step('0.2'), step('0.4'), step('1.0')];
    const names = (from: string, to?: string) =>
      stepsBetween(v(from), to === undefined ? undefined : v(to), steps).map((s) => s.version);
    expect(names('0.1.0')).toEqual(['0.2', '0.4', '1.0']);
    expect(names('0.1.0', '0.4')).toEqual(['0.2', '0.4']);
    expect(names('0.3.2', '0.9')).toEqual(['0.4']);
    expect(names('0.4.0-next.1', '0.4')).toEqual(['0.4']);
    expect(names('1.0.0')).toEqual([]);
    expect(latest(steps)).toEqual(v('1.0'));
    expect(latest([])).toBeUndefined();
  });
});
