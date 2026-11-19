/*
 * The live record log (M4b plan, item 2; ADR 0020, decision 3): records
 * appended to the bus, copied from a tap while the Log tab is open, newest
 * first. A tap isn't a consumer, so it isn't in the bus figures, and the
 * host reopens it after a bus restart, so the log carries on. The tap sends
 * at most `MAX_PER_SEC` records a second; the header counts the records it
 * left out since the log was opened (ADR 0020, decision 6, amended
 * 2026-11-19). Values arrive as 2 KB previews with their full size.
 */
import { useIsolate } from '@isoloop/preact';
import type { InspectRecord } from '@isoloop/protocol';
import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';

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

type Entry = InspectRecord & { n: number };

export function LogView(): JSX.Element {
  const ctx = useIsolate();
  const inspector = ctx.inspector;
  const [filter, setFilter] = useState('');
  const [applied, setApplied] = useState<string[]>(['*']);
  const [paused, setPaused] = useState(false);
  const [entries, setEntries] = useState<Entry[]>([]);
  // Records the bus left out over the cap, since the log was opened.
  const [skipped, setSkipped] = useState(0);

  useEffect(() => {
    if (!inspector || paused) return undefined;
    let n = 0;
    const onSkipped = (count: number): void => {
      setSkipped((x) => x + count);
    };
    const off = inspector.tap({ topics: applied, maxPerSec: MAX_PER_SEC, onSkipped }, (r) => {
      n += 1;
      const entry: Entry = { ...r, n };
      setEntries((prev) => [entry, ...prev].slice(0, LOG_SIZE));
    });
    return off;
  }, [inspector, applied, paused]);

  return (
    <div class="dt-view" data-view="log">
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
      {entries.length === 0 ? (
        <p class="dt-muted">No records yet.</p>
      ) : (
        <table class="dt-table" data-log-table="">
          <thead>
            <tr>
              <th>Time</th>
              <th>Topic</th>
              <th class="dt-num">Offset</th>
              <th>Key</th>
              <th>Producer</th>
              <th class="dt-num">Size</th>
              <th>Value</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((r) => (
              <tr
                key={`${r.topic} ${r.offset} ${r.n}`}
                data-log-topic={r.topic}
                data-offset={r.offset}
              >
                <td>{time(r.ts)}</td>
                <td>
                  <code>{r.topic}</code>
                </td>
                <td class="dt-num">{r.offset}</td>
                <td>{r.key ?? ''}</td>
                <td>{r.producer}</td>
                <td class="dt-num">{r.bytes} B</td>
                <td class="dt-value" title={r.truncated ? 'Cut to a 2 KB preview' : ''}>
                  <code>
                    {r.preview}
                    {r.truncated ? '…' : ''}
                  </code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
