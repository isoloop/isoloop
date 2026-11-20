// The PR gate's docs step (M4c decision 22): it reports what docs:check says.
import { describe, expect, it } from 'vitest';
import { docsProblem } from './pr-gate.ts';

const here = import.meta.dirname;

describe('docsProblem', () => {
  it('passes when the guides check passes', () => {
    expect(docsProblem(here, () => ({ ok: true, out: '' }))).toBeUndefined();
  });

  it("blocks with the check's output when it fails", () => {
    const out =
      'error   docs/guide/a.md: line 3: "simply" is banned\ndocs:check: 1 problem(s), in 5 ms\n';
    expect(docsProblem(here, () => ({ ok: false, out }))).toBe(
      '`pnpm docs:check --guides` fails; fix the guides first:\nerror   docs/guide/a.md: line 3: "simply" is banned\ndocs:check: 1 problem(s), in 5 ms',
    );
  });

  it('lets the call run outside a git repository', () => {
    expect(docsProblem('/', () => ({ ok: false, out: 'x' }))).toBeUndefined();
  });
});
