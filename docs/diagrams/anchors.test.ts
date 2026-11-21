import { describe, expect, it } from 'vitest';
import { citations, problemOf, relocate, rewrite, type Citation } from './anchors.ts';

/** A repo as a map of path to text. */
const repo =
  (files: Record<string, string>) =>
  (p: string): string | undefined =>
    files[p];

const code = ['// a', 'function one() {', '  return 1;', '}', ''].join('\n');
const cite: Citation = {
  path: 'packages/a/src/one.ts',
  line: 2,
  end_line: 4,
  label: 'one',
  anchor: 'function one() {',
};

describe('diagram anchors', () => {
  it('passes a citation whose anchor is on its line', () => {
    expect(problemOf(cite, repo({ 'packages/a/src/one.ts': code }))).toBeUndefined();
  });

  it('fails one whose line moved, or whose file is gone, or that has no anchor', () => {
    const moved = repo({ 'packages/a/src/one.ts': `// new\n${code}` });
    expect(problemOf(cite, moved)).toBe(
      'line 2 of packages/a/src/one.ts isn\'t "function one() {"',
    );
    expect(problemOf(cite, repo({}))).toBe("packages/a/src/one.ts doesn't exist");
    const { anchor: _anchor, ...bare } = cite;
    expect(problemOf(bare, repo({ 'packages/a/src/one.ts': code }))).toContain('has no anchor');
  });

  it('finds a shifted line again, and a file moved under the same name in its package', () => {
    const files = { 'packages/a/src/area/one.ts': `// new\n${code}` };
    const found = relocate(cite, repo(files), Object.keys(files));
    expect(found).toEqual({ ...cite, path: 'packages/a/src/area/one.ts', line: 3, end_line: 5 });
  });

  it('keeps the offset of an anchor that is not the first cited line', () => {
    const c: Citation = { ...cite, line: 1, anchor: 'function one() {', anchor_offset: 1 };
    const files = { 'packages/a/src/one.ts': `\n\n${code}` };
    expect(relocate(c, repo(files), Object.keys(files))).toMatchObject({ line: 3, end_line: 6 });
  });

  it('leaves an anchor that occurs twice, or a name in two folders, for a person', () => {
    const twice = { 'packages/a/src/one.ts': `${code}${code}` };
    expect(relocate(cite, repo(twice), Object.keys(twice))).toBeUndefined();
    const two = { 'packages/a/src/x/one.ts': code, 'packages/a/src/y/one.ts': code };
    expect(relocate(cite, repo(two), Object.keys(two))).toBeUndefined();
  });

  it('rewrites only the paths and lines, keeping the formatting', () => {
    const text = [
      '{ "nodes": [{ "sources": [',
      '  { "path": "packages/a/src/one.ts", "line": 2, "end_line": 4, "label": "one", "anchor": "x" }',
      '] }], "pos": [40, 40] }',
    ].join('\n');
    const [c] = citations(JSON.parse(text));
    expect(c).toBeDefined();
    const out = rewrite(text, [
      { ...cite, path: 'packages/a/src/area/one.ts', line: 3, end_line: 5 },
    ]);
    expect(out).toBe(
      text.replace(
        '"packages/a/src/one.ts", "line": 2, "end_line": 4',
        '"packages/a/src/area/one.ts", "line": 3, "end_line": 5',
      ),
    );
  });
});
