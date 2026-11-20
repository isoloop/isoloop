/*
 * The kernel's own history, newest first: isolates changing state, crashing,
 * failing, the bus restarting, and so on. This page session's events are all
 * kept (the feed holds only its last 200), and so are the last few sessions
 * before it, to look back at after a reload (`event-store.ts`). It says why
 * the ring around the closed button changed colour; the Messages tab is a
 * different thing, the records your app publishes.
 */
import { Fragment, type JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { detailOf, levelOfEvent, subjectOf, type EventLevel } from './event-level';
import {
  KEEP_SESSIONS,
  PER_SESSION,
  type Recorder,
  type SessionInfo,
  type StoredEvent,
} from './event-store';
import { highlight } from './format';

const pad = (n: number, w = 2): string => String(n).padStart(w, '0');

/** Time since the page started, as the host's clock has it: m:ss.mmm. */
const since = (at: number): string => {
  const total = Math.max(0, Math.round(at));
  return `${Math.floor(total / 60_000)}:${pad(Math.floor(total / 1000) % 60)}.${pad(total % 1000, 3)}`;
};

type Row = { key: string; e: StoredEvent; level: EventLevel; subject: string; detail: string };

/** Newest first, each with a key that stays the same while newer events arrive. */
function rowsOf(events: readonly StoredEvent[]): Row[] {
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

const isProblem = (l: EventLevel): boolean => l === 'bad' || l === 'warn';

const MARK: Record<EventLevel, string> = { bad: '●', warn: '●', good: '●', info: '○' };

const PAGE = 500;

const when = (ms: number): string =>
  new Date(ms).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'medium' });

export function EventsView(props: { recorder: Recorder; onAck: () => void }): JSX.Element {
  const { recorder } = props;
  const [filter, setFilter] = useState('');
  const [problems, setProblems] = useState(false);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [copied, setCopied] = useState<string | undefined>(undefined);
  const [limit, setLimit] = useState(PAGE);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  // The session being read: this one, or an earlier one loaded from storage.
  const [session, setSession] = useState(recorder.session);
  const [earlier, setEarlier] = useState<StoredEvent[] | undefined>(undefined);
  const current = session === recorder.session;

  const refreshSessions = (): void => {
    void recorder.sessions().then(setSessions);
  };
  useEffect(refreshSessions, []);
  useEffect(() => {
    let alive = true;
    setEarlier(undefined);
    if (!current) {
      void recorder.load(session).then((rows) => {
        if (alive) setEarlier(rows);
      });
    }
    return () => {
      alive = false;
    };
  }, [session]);

  const events: readonly StoredEvent[] = current ? recorder.events() : (earlier ?? []);
  const q = filter.trim().toLowerCase();
  const all = rowsOf(events);
  const matching = all.filter(
    (r) =>
      (!problems || r.level === 'bad' || r.level === 'warn') &&
      (q === '' || `${r.e.event} ${r.subject} ${r.detail}`.toLowerCase().includes(q)),
  );
  const rows = matching.slice(0, limit);
  const others = sessions.filter((s) => s.id !== recorder.session);
  const unseen = recorder.unacknowledged();
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
            setLimit(PAGE);
          }}
        />
        <button
          type="button"
          data-events-problems=""
          aria-pressed={problems ? 'true' : 'false'}
          onClick={() => {
            setProblems(!problems);
            setLimit(PAGE);
          }}
        >
          Problems only
        </button>
        {others.length > 0 ? (
          <select
            aria-label="Session"
            data-events-session=""
            value={session}
            onChange={(e) => {
              setSession(e.currentTarget.value);
              setLimit(PAGE);
              setOpen(new Set());
            }}
          >
            <option value={recorder.session}>This session</option>
            {others.map((s) => (
              <option key={s.id} value={s.id}>
                {when(s.started)} · {s.count} events
              </option>
            ))}
          </select>
        ) : null}
        <button
          type="button"
          data-events-ack=""
          disabled={unseen === 0}
          title="Mark the problems listed as seen, which clears the count on the tab"
          onClick={() => {
            recorder.acknowledge();
            props.onAck();
          }}
        >
          Acknowledge{unseen > 0 ? ` (${unseen})` : ''}
        </button>
        <button
          type="button"
          data-events-clear=""
          title={`Forget the stored events of every session. Kept in this browser (IndexedDB): the last ${KEEP_SESSIONS} sessions, up to ${PER_SESSION} events each.`}
          onClick={() => {
            void recorder.clear().then(() => {
              setSession(recorder.session);
              setOpen(new Set());
              refreshSessions();
              props.onAck();
            });
          }}
        >
          Clear
        </button>
      </form>
      <p class="dt-muted" style="margin:4px 0;">
        {matching.length === all.length
          ? `${all.length} events`
          : `${matching.length} of ${all.length} events`}
        {' · newest first · '}
        {current
          ? 'this page session'
          : `session from ${when(sessions.find((s) => s.id === session)?.started ?? 0)}`}
        {current && all.length >= PER_SESSION
          ? ` · the oldest are dropped past ${PER_SESSION}`
          : ''}
      </p>
      <div class="dt-log-rows">
        {rows.length === 0 ? (
          <p class="dt-muted">
            {!current && earlier === undefined
              ? 'Loading…'
              : all.length === 0
                ? 'No events yet.'
                : 'No events match.'}
          </p>
        ) : (
          <>
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
                        class={`dt-log-row dt-ev-${r.level}${current && isProblem(r.level) && recorder.isNew(r.e) ? ' dt-ev-new' : ''}`}
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
                        <td class="dt-c-time" title={when(r.e.wall)}>
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
                                    <span
                                      key={i}
                                      class={part.kind ? `dt-j-${part.kind}` : undefined}
                                    >
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
            {matching.length > rows.length ? (
              <p style="margin:6px 0;">
                <button
                  type="button"
                  class="dt-more"
                  data-events-older=""
                  onClick={() => {
                    setLimit(limit + PAGE);
                  }}
                >
                  Load older ({matching.length - rows.length} more)
                </button>
              </p>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
