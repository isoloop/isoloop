/*
 * What opens under a record in the messages: its value (indented, coloured) and the
 * record itself (time, topic, offset, key, producer, size, who asked). Each has
 * a Copy button; the page does the copying (see `connectDevtools`).
 */
import type { InspectRecord } from '@isoloop/protocol';
import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { highlight, pretty, recordJson } from './format';

type Part = 'value' | 'record';

const ITEMS: readonly { id: Part; label: string }[] = [
  { id: 'value', label: 'Value' },
  { id: 'record', label: 'Record' },
];

function Value(props: { text: string }): JSX.Element {
  return (
    <pre class="dt-json">
      {highlight(props.text).map((part, i) => (
        <span key={i} class={part.kind ? `dt-j-${part.kind}` : undefined}>
          {part.text}
        </span>
      ))}
    </pre>
  );
}

const dim = (v: string): JSX.Element => <span class="dt-dim">{v}</span>;

function Fields(props: { r: InspectRecord }): JSX.Element {
  const { r } = props;
  const rows: [string, string, JSX.Element | string][] = [
    ['Time', 'mono', new Date(r.ts).toISOString()],
    ['Topic', 'topic', r.topic],
    ['Offset', 'num', String(r.offset)],
    ['Key', r.key === undefined ? '' : 'str', r.key ?? dim('–')],
    ['Producer', '', r.producer],
    ['Size', 'num', `${r.bytes} B`],
    [
      'Request',
      '',
      r.req ? `${r.req.from} · ${r.req.id}${r.req.via ? ` · via ${r.req.via}` : ''}` : dim('–'),
    ],
  ];
  return (
    <>
      <dl class="dt-rec">
        {rows.map(([k, kind, v]) => (
          <div key={k} class="dt-rec-row">
            <dt>{k}</dt>
            <dd class={kind ? `dt-rec-${kind}` : undefined}>{v}</dd>
          </div>
        ))}
      </dl>
      {r.truncated ? <p class="dt-rec-note">The value is cut to a 2 KB preview.</p> : null}
    </>
  );
}

export function RecordDetail(props: { r: InspectRecord }): JSX.Element {
  const { r } = props;
  const [copied, setCopied] = useState<Part | undefined>(undefined);
  const value = pretty(r.preview);
  const record = recordJson(r);
  const copy = (p: Part): JSX.Element => (
    <button
      type="button"
      data-isoloop-copy={p === 'value' ? value : record}
      data-log-copy={p}
      onClick={() => {
        setCopied(p);
        setTimeout(() => {
          setCopied((c) => (c === p ? undefined : c));
        }, 1500);
      }}
    >
      {copied === p ? 'Copied' : 'Copy'}
    </button>
  );
  return (
    <div class="dt-detail dt-detail-cols">
      {ITEMS.map((it) => (
        <section key={it.id} class={`dt-detail-part dt-detail-${it.id}`}>
          <div class="dt-detail-bar">
            <strong class="dt-detail-h">{it.label}</strong>
            {copy(it.id)}
          </div>
          {it.id === 'value' ? <Value text={value} /> : <Fields r={r} />}
        </section>
      ))}
    </div>
  );
}
