/*
 * Record values in the messages: a value arrives as JSON-like text, at most 2 KB.
 * `pretty` indents it when it is whole JSON (a preview cut at 2 KB isn't, and
 * stays as it came); `highlight` splits the text into plain and coloured parts.
 */
import type { TopicWatchMetrics } from '@isoloop/protocol';

const pad = (n: number): string => '  '.repeat(n);

/**
 * The text indented like JSON, one member or element to a line. The values are
 * JSON-like, not always JSON (`Float32Array(50)`, or a preview cut short), so
 * this walks the text instead of parsing it: strings and anything in
 * parentheses stay whole, and a cut-off ending is left as it is.
 */
export function pretty(text: string): string {
  let out = '';
  let depth = 0;
  let parens = 0;
  // Spaces right after a break or a colon are ours to place.
  let fresh = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charAt(i);
    const wasFresh = fresh;
    fresh = false;
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text.charAt(j) !== '"') j += text.charAt(j) === '\\' ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j;
    } else if (parens > 0 || c === '(') {
      if (c === '(') parens++;
      else if (c === ')') parens--;
      out += c;
    } else if (c === '{' || c === '[') {
      const close = c === '{' ? '}' : ']';
      if (text.charAt(i + 1) === close) {
        out += c + close;
        i++;
      } else {
        depth++;
        out += `${c}\n${pad(depth)}`;
        fresh = true;
      }
    } else if (c === '}' || c === ']') {
      depth = Math.max(0, depth - 1);
      out += `\n${pad(depth)}${c}`;
    } else if (c === ',') {
      out += `,\n${pad(depth)}`;
      fresh = true;
    } else if (c === ':') {
      out += ': ';
      fresh = true;
    } else if (!(wasFresh && /\s/.test(c))) {
      out += c;
    }
  }
  return out;
}

export type Part = { text: string; kind?: 'key' | 'string' | 'number' | 'literal' };

const TOKEN =
  /("(?:\\.|[^"\\])*")(\s*:)?|\b(?:true|false|null)\b|(?<![\w$.])-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?(?![\w$])/g;

/** Splits JSON-like text into parts to colour: keys, strings, numbers, true/false/null. */
export function highlight(text: string): Part[] {
  const parts: Part[] = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    const at = m.index;
    if (at > last) parts.push({ text: text.slice(last, at) });
    if (m[1] !== undefined) {
      if (m[2] === undefined) parts.push({ text: m[1], kind: 'string' });
      else {
        parts.push({ text: m[1], kind: 'key' });
        parts.push({ text: m[2] });
      }
    } else {
      parts.push({ text: m[0], kind: /^[-\d]/.test(m[0]) ? 'number' : 'literal' });
    }
    last = at + m[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

/** What a record is besides its value, as indented JSON (for the Record panel's Copy). */
export function recordJson(r: {
  topic: string;
  offset: number;
  key?: string;
  ts: number;
  producer: string;
  bytes: number;
  truncated: boolean;
  req?: { from: string; id: string; via?: string };
}): string {
  return JSON.stringify(
    {
      topic: r.topic,
      offset: r.offset,
      ...(r.key === undefined ? {} : { key: r.key }),
      time: new Date(r.ts).toISOString(),
      ts: r.ts,
      producer: r.producer,
      bytes: r.bytes,
      truncated: r.truncated,
      ...(r.req === undefined ? {} : { req: r.req }),
    },
    null,
    2,
  );
}

/**
 * A watched topic's records against the values its watches got, in words:
 * "showed 1 of every 40 records on the topic". Every record on the topic
 * counts, keys a watch doesn't read included. Counted from the bus worker's
 * start.
 */
export function shown(w: TopicWatchMetrics): string {
  if (w.values === 0)
    return w.records === 0 ? 'no records yet' : `showed none of ${w.records} records on the topic`;
  const every = w.records / w.values;
  if (every < 1.05) return 'showed every record on the topic';
  return `showed 1 of every ${every >= 10 ? Math.round(every) : every.toFixed(1)} records on the topic`;
}
