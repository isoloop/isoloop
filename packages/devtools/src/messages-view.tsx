/*
 * The messages tab: the live record log (M4b plan, item 2; ADR 0020, decision 3): records
 * appended to the bus, copied from a tap while the Messages tab is open, newest
 * first. A tap isn't a consumer, so it isn't in the bus figures, and the
 * host reopens it after a bus restart, so the log carries on. The tap sends
 * at most `MAX_PER_SEC` records a second; the header counts the records it
 * left out since the log was opened (ADR 0020, decision 6, amended
 * 2026-11-19). Values arrive as 2 KB previews with their full size.
 */
import { useIsolate } from '@isoloop/preact';
import type { InspectRecord } from '@isoloop/protocol';
import { Fragment, type JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { highlight, type Part } from './format';
import { RecordDetail } from './record-detail';

/** The tap's rate cap: the bus's default. */
export const MAX_PER_SEC = 50;

/** How many records the log keeps. */
export const LOG_SIZE = 200;

/** Splits the filter into tap patterns: `*` (every topic) when empty. */
export const patternsOf = (filter: string): string[] => {
  const p = filter
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return p.length > 0 ? p : ['*'];
};

const pad = (n: number, w = 2): string => String(n).padStart(w, '0');

const time = (ts: number): string => {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
};

/** The row's one-line value is coloured once, from its first characters (the cell clips the rest). */
const GLANCE = 240;

type Entry = InspectRecord & { n: number; glance: Part[] };

export function MessagesView(): JSX.Element {
  const ctx = useIsolate();
  const inspector = ctx.inspector;
  const [filter, setFilter] = useState('');
  const [applied, setApplied] = useState<string[]>(['*']);
  const [paused, setPaused] = useState(false);
  const [entries, setEntries] = useState<Entry[]>([]);
  // Records the bus left out over the cap, since the log was opened.
  const [skipped, setSkipped] = useState(0);
  // The records opened to read their value.
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    if (!inspector || paused) return undefined;
    let n = 0;
    const onSkipped = (count: number): void => {
      setSkipped((x) => x + count);
    };
    const off = inspector.tap({ topics: applied, maxPerSec: MAX_PER_SEC, onSkipped }, (r) => {
      n += 1;
      const entry: Entry = { ...r, n, glance: highlight(r.preview.slice(0, GLANCE)) };
      setEntries((prev) => [entry, ...prev].slice(0, LOG_SIZE));
    });
    return off;
  }, [inspector, applied, paused]);

  return (
    <div class="dt-view dt-log" data-view="messages">
      <form
        class="dt-log-bar"
        onSubmit={(e) => {
          e.preventDefault();
          setApplied(patternsOf(filter));
        }}
      >
        <input
          type="text"
          aria-label="Topics to log, as patterns (empty for every topic)"
          placeholder="Topics, e.g. orders.* (empty: all)"
          value={filter}
          data-log-filter=""
          onInput={(e) => {
            setFilter(e.currentTarget.value);
          }}
        />
        <button type="submit" data-log-apply="">
          Apply
        </button>
        <button
          type="button"
          data-log-pause=""
          aria-pressed={paused ? 'true' : 'false'}
          onClick={() => {
            setPaused((p) => !p);
          }}
        >
          {paused ? 'Resume' : 'Pause'}
        </button>
        <button
          type="button"
          data-log-clear=""
          onClick={() => {
            setEntries([]);
          }}
        >
          Clear
        </button>
      </form>
      <p class="dt-muted" style="margin:4px 0;">
        {paused ? 'Paused' : `Tapping ${applied.join(', ')}`} · newest first ·{' '}
        <span data-log-skipped={skipped}>
          {MAX_PER_SEC}/s cap · {skipped} skipped
        </span>
      </p>
      <div class="dt-log-rows">
        {entries.length === 0 ? (
          <p class="dt-muted">No records yet.</p>
        ) : (
          <table class="dt-table" data-log-table="">
            <thead>
              <tr>
                <th class="dt-c-chev">
                  <span class="dt-sr">Details</span>
                </th>
                <th class="dt-c-time">Time</th>
                <th>Topic</th>
                <th class="dt-num dt-c-offset">Offset</th>
                <th class="dt-c-key">Key</th>
                <th>Producer</th>
                <th class="dt-num dt-c-size">Size</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((r) => {
                const id = `${r.topic} ${r.offset} ${r.n}`;
                const isOpen = open.has(id);
                return (
                  <Fragment key={id}>
                    <tr
                      class="dt-log-row"
                      data-log-topic={r.topic}
                      data-offset={r.offset}
                      aria-expanded={isOpen ? 'true' : 'false'}
                      onClick={() => {
                        const next = new Set(open);
                        if (isOpen) next.delete(id);
                        else next.add(id);
                        setOpen(next);
                      }}
                    >
                      <td class="dt-c-chev">
                        <button
                          type="button"
                          class="dt-chev"
                          aria-expanded={isOpen ? 'true' : 'false'}
                          aria-label={isOpen ? 'Hide the record' : 'Show the record'}
                        >
                          {isOpen ? '▾' : '▸'}
                        </button>
                      </td>
                      <td class="dt-c-time">{time(r.ts)}</td>
                      <td class="dt-col-topic">
                        <code>{r.topic}</code>
                      </td>
                      <td class="dt-num dt-c-offset dt-col-num">{r.offset}</td>
                      <td class="dt-c-key dt-col-str" title={r.key ?? ''}>
                        {r.key ?? ''}
                      </td>
                      <td>{r.producer}</td>
                      <td class="dt-num dt-c-size">{r.bytes} B</td>
                      <td class="dt-vclip">
                        <code>
                          {r.glance.map((part, i) => (
                            <span key={i} class={part.kind ? `dt-j-${part.kind}` : undefined}>
                              {part.text}
                            </span>
                          ))}
                        </code>
                      </td>
                    </tr>
                    {isOpen ? (
                      <tr class="dt-log-detail" data-log-detail="">
                        <td colSpan={8}>
                          <RecordDetail r={r} />
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
