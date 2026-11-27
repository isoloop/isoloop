import { describe, expect, it } from 'vitest';
import { highlight, pretty, shown } from './format';

describe('log value formatting', () => {
  it('indents JSON and JSON-like text, one member to a line', () => {
    expect(pretty('{"a":1,"b":[true,null]}')).toBe(
      '{\n  "a": 1,\n  "b": [\n    true,\n    null\n  ]\n}',
    );
    expect(pretty('{"v":Float32Array(50),"m":{},"l":[]}')).toBe(
      '{\n  "v": Float32Array(50),\n  "m": {},\n  "l": []\n}',
    );
  });

  it('keeps strings whole, commas and brackets inside them included', () => {
    expect(pretty('{"s":"a, {b}: [c] \\" d"}')).toBe('{\n  "s": "a, {b}: [c] \\" d"\n}');
  });

  it('leaves plain text, and a preview cut short, readable', () => {
    expect(pretty('plain text')).toBe('plain text');
    expect(pretty('{"a":1,"b":[1,2')).toBe('{\n  "a": 1,\n  "b": [\n    1,\n    2');
  });

  it('splits text into keys, strings, numbers and literals, keeping every character', () => {
    const text = '{"id": "x", "n": -1.5e2, "ok": true, "none": null}';
    const parts = highlight(text);
    expect(parts.map((p) => p.text).join('')).toBe(text);
    expect(parts.filter((p) => p.kind === 'key').map((p) => p.text)).toEqual([
      '"id"',
      '"n"',
      '"ok"',
      '"none"',
    ]);
    expect(parts.find((p) => p.kind === 'string')?.text).toBe('"x"');
    expect(parts.find((p) => p.kind === 'number')?.text).toBe('-1.5e2');
    expect(parts.filter((p) => p.kind === 'literal').map((p) => p.text)).toEqual(['true', 'null']);
  });

  it('does not colour digits inside a name', () => {
    expect(highlight('Float32Array(50)').filter((p) => p.kind === 'number')).toEqual([
      { text: '50', kind: 'number' },
    ]);
  });

  it('does not colour a quoted word that only looks like a number or a literal', () => {
    const parts = highlight('"true 12"');
    expect(parts).toEqual([{ text: '"true 12"', kind: 'string' }]);
  });
});

const w = (records: number, values: number) =>
  ({ watches: 1, liveKeys: 1, transport: 'messages', records, values }) as const;

describe('watched topics in words', () => {
  it('says how many values each watch showed', () => {
    expect(shown(w(400, 10))).toBe('showed 1 of every 40 records on the topic');
    expect(shown(w(25, 10))).toBe('showed 1 of every 2.5 records on the topic');
    expect(shown(w(10, 10))).toBe('showed every record on the topic');
  });

  it('says so when nothing came yet, or nothing was shown', () => {
    expect(shown(w(0, 0))).toBe('no records yet');
    expect(shown(w(12, 0))).toBe('showed none of 12 records on the topic');
  });
});
