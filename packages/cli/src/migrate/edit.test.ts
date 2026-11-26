import { describe, expect, it } from 'vitest';
import { applyChange, applyEdits, EditConflict, flagEdits, mapOffset } from './edit';

describe('applyEdits', () => {
  it('replaces ranges and keeps everything around them', () => {
    const text = 'publish(t, { value: 1 }); // keep\n';
    const out = applyEdits(text, [
      { start: 11, end: 23, text: '1' },
      { start: 0, end: 7, text: 'send' },
    ]);
    expect(out).toBe('send(t, 1); // keep\n');
  });

  it('keeps inserts at one offset in the order given', () => {
    expect(
      applyEdits('ab', [
        { start: 1, end: 1, text: 'x' },
        { start: 1, end: 1, text: 'y' },
      ]),
    ).toBe('axyb');
  });

  it('puts an insert before a replacement that starts at the same offset', () => {
    expect(
      applyEdits('abc', [
        { start: 1, end: 2, text: 'B' },
        { start: 1, end: 1, text: '>' },
      ]),
    ).toBe('a>Bc');
  });

  it('refuses overlapping or out-of-range edits', () => {
    expect(() =>
      applyEdits('abcdef', [
        { start: 0, end: 3, text: '' },
        { start: 2, end: 4, text: '' },
      ]),
    ).toThrow(EditConflict);
    expect(() => applyEdits('abc', [{ start: 2, end: 9, text: '' }])).toThrow(EditConflict);
    expect(() => applyEdits('abc', [{ start: 2, end: 1, text: '' }])).toThrow(EditConflict);
  });
});

describe('flags', () => {
  const text = 'function f() {\n    publish(t, rec);\n}\n';
  const at = text.indexOf('rec');

  it('go on the line above, indented like it', () => {
    expect(
      applyChange(text, { edits: [], flags: [{ at, message: 'pass { value } inline' }] }),
    ).toBe(
      'function f() {\n    // isoloop-migrate: pass { value } inline\n    publish(t, rec);\n}\n',
    );
  });

  it('are added once, so a second run changes nothing', () => {
    const flags = [{ at, message: 'check this' }];
    const once = applyChange(text, { edits: [], flags });
    const again = once.indexOf('rec');
    expect(applyChange(once, { edits: [], flags: [{ at: again, message: 'check this' }] })).toBe(
      once,
    );
  });

  it('give one comment per message on a line, and none for a repeat', () => {
    const edits = flagEdits(text, [
      { at, message: 'one' },
      { at: at + 1, message: 'two' },
      { at, message: 'one' },
    ]);
    expect(edits.map((e) => e.text)).toEqual([
      '    // isoloop-migrate: one\n',
      '    // isoloop-migrate: two\n',
    ]);
  });

  it('work on the first line and on CRLF files', () => {
    expect(applyChange('x(rec);\r\n', { edits: [], flags: [{ at: 2, message: 'm' }] })).toBe(
      '// isoloop-migrate: m\r\nx(rec);\r\n',
    );
    const crlf = 'a;\r\n// isoloop-migrate: m\r\nx(rec);\r\n';
    expect(
      applyChange(crlf, { edits: [], flags: [{ at: crlf.indexOf('rec'), message: 'm' }] }),
    ).toBe(crlf);
  });
});

describe('mapOffset', () => {
  it('moves an offset past edits before it, and not past edits after it', () => {
    const edits = [
      { start: 0, end: 2, text: 'xxxx' },
      { start: 10, end: 12, text: '' },
    ];
    expect(mapOffset(5, edits)).toBe(7);
    expect(mapOffset(12, edits)).toBe(12);
  });

  it('puts an offset inside a replaced range at the start of its new text', () => {
    expect(
      mapOffset(6, [
        { start: 0, end: 1, text: 'ab' },
        { start: 4, end: 8, text: 'Z' },
      ]),
    ).toBe(5);
  });
});
