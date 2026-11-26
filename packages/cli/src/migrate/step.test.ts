import { describe, expect, it } from 'vitest';
import type { SourceFile } from './parser';
import { combine, type Transform } from './step';

const file: SourceFile = {
  path: 'a.ts',
  text: 'abc',
  program: { type: 'Program', start: 0, end: 3 },
};
const at = (n: number, on: string): Transform => ({
  summary: `t${n}`,
  mayChange: (text) => text.includes(on),
  transform: () => ({
    edits: [{ start: n, end: n, text: 'x' }],
    flags: [{ at: n, message: `m${n}` }],
  }),
});

describe('combine', () => {
  it('joins the summaries and runs only the transforms that may change the file', () => {
    const step = combine('0.2', [at(0, 'a'), at(1, 'z'), at(2, 'c')]);
    expect(step.summary).toBe('t0; t1; t2');
    expect(step.mayChange('zz')).toBe(true);
    expect(step.mayChange('qq')).toBe(false);
    expect(step.transform(file)).toEqual({
      edits: [
        { start: 0, end: 0, text: 'x' },
        { start: 2, end: 2, text: 'x' },
      ],
      flags: [
        { at: 0, message: 'm0' },
        { at: 2, message: 'm2' },
      ],
    });
  });
});
