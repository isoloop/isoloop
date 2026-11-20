/*
 * The kernel's own history, newest first: isolates changing state, crashing,
 * failing, the bus restarting, and so on. It's the ring of the last events the
 * feed keeps, so it also shows what happened before the panel was opened. It
 * says why the ring around the closed button changed colour; the Messages tab
 * is a different thing, the records your app publishes.
 */
import type { InspectEvent, InspectSnapshot } from '@isoloop/protocol';
import { Fragment, type JSX } from 'preact';
import { useState } from 'preact/hooks';
import { highlight } from './format';

export type EventLevel = 'bad' | 'warn' | 'good' | 'info';

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** How serious an event is, in the ring's terms: failed is red, a crash or a stall amber. */
export function levelOfEvent(e: InspectEvent): EventLevel {
  switch (e.event) {
    case 'isolate:failed':
    case 'bus:failed':
      return 'bad';
    case 'isolate:crash':
    case 'isolate:error':
    case 'bus:crash':
    case 'bus:recovered':
    case 'bus:quota':
    case 'bus:durability-degraded':
    case 'workers:budget':
    case 'agents:unmatched':
      return 'warn';
    case 'isolate:ready':
    case 'bus:ready':
      return 'good';
    case 'isolate:state': {
      const state = str(e.data['state']);
      if (state === 'failed') return 'bad';
      if (state === 'running') return 'good';
      return ['blocked', 'restarting', 'crashed'].includes(state) ? 'warn' : 'info';
    }
    default:
      return 'info';
  }
}

/** How many of the events were problems (for the tab's badge). */
export const problemCount = (events: readonly InspectEvent[]): number =>
  events.filter((e) => {
    const l = levelOfEvent(e);
    return l === 'bad' || l === 'warn';
  }).length;

/** What the event is about: its isolate, or the bus. */
const subjectOf = (e: InspectEvent): string => {
  const id = str(e.data['id']);
  if (id) return id;
  return e.event.startsWith('bus:') ? 'bus' : '';
};

const show = (v: unknown): string =>
  typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'
    ? String(v)
    : JSON.stringify(v);

/** One line of what happened. */
export function detailOf(e: InspectEvent): string {
  const d = e.data;
  if (e.event === 'isolate:state') return `${str(d['prev'])} → ${str(d['state'])}`;
  if (e.event === 'isolate:crash' || e.event === 'isolate:failed' || e.event === 'bus:crash') {
    return [str(d['reason']), str(d['message'])].filter(Boolean).join(': ');
  }
  if (e.event === 'isolate:error') return str(d['message']);
  return Object.entries(d)
    .filter(([k]) => k !== 'id')
    .map(([k, v]) => `${k}=${show(v)}`)
    .join(' ');
}

const pad = (n: number, w = 2): string => String(n).padStart(w, '0');

/** Time since the page started, as the host's clock has it: m:ss.mmm. */
const since = (at: number): string => {
  const total = Math.max(0, Math.round(at));
  return `${Math.floor(total / 60_000)}:${pad(Math.floor(total / 1000) % 60)}.${pad(total % 1000, 3)}`;
};

type Row = { key: string; e: InspectEvent; level: EventLevel; subject: string; detail: string };

function rowsOf(events: readonly InspectEvent[]): Row[] {
  const seen = new Map<string, number>();
  const oldestFirst = events.map((e): Row => {
    const subject = subjectOf(e);
    const base = `${e.at} ${e.event} ${subject}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return { key: `${base} ${n}`, e, level: levelOfEvent(e), subject, detail: detailOf(e) };
  });
  const rows: Row[] = [];
  for (let i = oldestFirst.length - 1; i >= 0; i--) {
    const r = oldestFirst[i];
    if (r) rows.push(r);
  }
  return rows;
}

const MARK: Record<EventLevel, string> = { bad: '●', warn: '●', good: '●', info: '○' };

export function EventsView(props: { snap: InspectSnapshot }): JSX.Element {
  const { snap } = props;
  const [filter, setFilter] = useState('');
  const [problems, setProblems] = useState(false);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [copied, setCopied] = useState<string | undefined>(undefined);
  const q = filter.trim().toLowerCase();
  const all = rowsOf(snap.events);
  const rows = all.filter(
    (r) =>
      (!problems || r.level === 'bad' || r.level === 'warn') &&
      (q === '' || `${r.e.event} ${r.subject} ${r.detail}`.toLowerCase().includes(q)),
  );
  return (
    <div class="dt-view dt-log" data-view="events">
      <form
        class="dt-log-bar"
        onSubmit={(e) => {
          e.preventDefault();
        }}
      >
        <input
          type="text"
          aria-label="Filter the events"
          placeholder="Filter, e.g. feed-T1 or crash"
          value={filter}
          data-events-filter=""
          onInput={(e) => {
            setFilter(e.currentTarget.value);
          }}
        />
        <button
          type="button"
          data-events-problems=""
          aria-pressed={problems ? 'true' : 'false'}
          onClick={() => {
            setProblems(!problems);
          }}
        >
          Problems only
        </button>
      </form>
      <p class="dt-muted" style="margin:4px 0;">
        {rows.length === all.length
          ? `${all.length} events`
          : `${rows.length} of ${all.length} events`}{' '}
        · newest first{snap.events.length >= 200 ? ' · only the last 200 are kept' : ''}
      </p>
      <div class="dt-log-rows">
        {rows.length === 0 ? (
          <p class="dt-muted">{all.length === 0 ? 'No events yet.' : 'No events match.'}</p>
        ) : (
          <table class="dt-table" data-events-table="">
            <thead>
              <tr>
                <th class="dt-c-chev">
                  <span class="dt-sr">Details</span>
                </th>
                <th class="dt-c-time">Since start</th>
                <th>Event</th>
                <th>Isolate</th>
                <th>What happened</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const isOpen = open.has(r.key);
                const text = JSON.stringify(r.e.data, null, 2);
                return (
                  <Fragment key={r.key}>
                    <tr
                      class={`dt-log-row dt-ev-${r.level}`}
                      data-event={r.e.event}
                      data-level={r.level}
                      aria-expanded={isOpen ? 'true' : 'false'}
                      onClick={() => {
                        const next = new Set(open);
                        if (isOpen) next.delete(r.key);
                        else next.add(r.key);
                        setOpen(next);
                      }}
                    >
                      <td class="dt-c-chev">
                        <button
                          type="button"
                          class="dt-chev"
                          aria-expanded={isOpen ? 'true' : 'false'}
                          aria-label={isOpen ? 'Hide the event' : 'Show the event'}
                        >
                          {isOpen ? '▾' : '▸'}
                        </button>
                      </td>
                      <td
                        class="dt-c-time"
                        title={`${((snap.at - r.e.at) / 1000).toFixed(1)} s ago`}
                      >
                        {since(r.e.at)}
                      </td>
                      <td>
                        <span class="dt-ev-dot" aria-hidden="true">
                          {MARK[r.level]}
                        </span>{' '}
                        <code>{r.e.event}</code>
                      </td>
                      <td>{r.subject}</td>
                      <td class="dt-vclip">{r.detail}</td>
                    </tr>
                    {isOpen ? (
                      <tr class="dt-log-detail" data-event-detail="">
                        <td colSpan={5}>
                          <div class="dt-detail">
                            <div class="dt-detail-part dt-detail-value">
                              <div class="dt-detail-bar">
                                <strong class="dt-detail-h">Data</strong>
                                <button
                                  type="button"
                                  data-isoloop-copy={text}
                                  data-log-copy="event"
                                  onClick={() => {
                                    setCopied(r.key);
                                    setTimeout(() => {
                                      setCopied((c) => (c === r.key ? undefined : c));
                                    }, 1500);
                                  }}
                                >
                                  {copied === r.key ? 'Copied' : 'Copy'}
                                </button>
                              </div>
                              <pre class="dt-json">
                                {highlight(text).map((part, i) => (
                                  <span key={i} class={part.kind ? `dt-j-${part.kind}` : undefined}>
                                    {part.text}
                                  </span>
                                ))}
                              </pre>
                            </div>
                          </div>
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
