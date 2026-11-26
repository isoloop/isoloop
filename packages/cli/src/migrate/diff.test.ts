import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { unifiedDiff } from './diff';

/** Applies `patch` to `before` with `git apply`, the tool users pipe the dry run into. */
function gitApply(before: string, patch: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'isoloop-diff-'));
  try {
    writeFileSync(join(dir, 'f.ts'), before);
    // Line endings as written, and no warnings for blank lines the patch adds.
    const config = ['-c', 'core.autocrlf=false', '-c', 'core.safecrlf=false'];
    execFileSync('git', [...config, 'apply', '--whitespace=nowarn', '-'], {
      cwd: dir,
      input: patch,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return readFileSync(join(dir, 'f.ts'), 'utf8');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Lines as a text, with or without a newline at the end. */
const asText = (ls: string[], newline: boolean): string =>
  ls.length === 0 ? '' : `${ls.join('\n')}${newline ? '\n' : ''}`;

/** A small seeded generator, so a failure reproduces. */
function random(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1_664_525 + 1_013_904_223) >>> 0;
    return s / 2 ** 32;
  };
}

describe('unifiedDiff', () => {
  it('is empty for equal texts', () => {
    expect(unifiedDiff('f.ts', 'a\n', 'a\n')).toBe('');
  });

  it('prints one hunk with three lines of context', () => {
    const before = 'a\nb\nc\nd\ne\nf\ng\nh\n';
    const after = 'a\nb\nc\nd\nE\nf\ng\nh\n';
    expect(unifiedDiff('src/f.ts', before, after)).toBe(
      [
        '--- a/src/f.ts',
        '+++ b/src/f.ts',
        '@@ -2,7 +2,7 @@',
        ' b',
        ' c',
        ' d',
        '-e',
        '+E',
        ' f',
        ' g',
        ' h',
        '',
      ].join('\n'),
    );
  });

  it('splits changes more than six lines apart into hunks', () => {
    const lines = Array.from({ length: 20 }, (_, i) => `l${i}`);
    const after = lines.map((l, i) => (i === 1 || i === 18 ? `${l}!` : l));
    const patch = unifiedDiff('f.ts', `${lines.join('\n')}\n`, `${after.join('\n')}\n`);
    expect(patch.match(/^@@/gm)).toHaveLength(2);
  });

  it('marks a missing newline at the end', () => {
    const patch = unifiedDiff('f.ts', 'a\nb', 'a\nb\n');
    expect(patch).toContain('-b\n\\ No newline at end of file\n+b\n');
    expect(gitApply('a\nb', patch)).toBe('a\nb\n');
  });

  it('gives patches git applies, for random edits', () => {
    const next = random(411);
    const words = ['a', 'b', 'c', '', 'publish(t, 1);', '  x'];
    const pick = () => words[Math.floor(next() * words.length)] ?? '';
    for (let run = 0; run < 150; run++) {
      const before = Array.from({ length: Math.floor(next() * 25) }, pick);
      const after = before.flatMap((l) => {
        const r = next();
        if (r < 0.1) return [];
        if (r < 0.2) return [pick()];
        if (r < 0.3) return [l, pick()];
        return [l];
      });
      if (next() < 0.3) after.push(pick());
      const a = asText(before, next() < 0.9);
      const b = asText(after, next() < 0.9);
      const patch = unifiedDiff('f.ts', a, b);
      if (a === b) {
        expect(patch).toBe('');
        continue;
      }
      expect(gitApply(a, patch), `run ${run}:\n${patch}`).toBe(b);
    }
  });
});
