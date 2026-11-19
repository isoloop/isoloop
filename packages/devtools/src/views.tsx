/*
 * What the open panel shows, by tab (M4b plan, item 2). The isolates view:
 * each isolate's state, lag, busy time, memory, restarts and patch queue,
 * its pool, and the restart, kill and block controls (devtools decision 7);
 * then the pools and their members. The panel lists itself, marked as
 * devtools (decision 6). The bus view: its state and restarts, each topic's
 * rates, head and retained count, each subscription's lag and credit, and
 * the publishes it rejected. The log view: records from a tap, live, while
 * its tab is open.
 */
import { useIsolate } from '@isoloop/preact';
import type { InspectIsolate, InspectMemory, InspectSnapshot } from '@isoloop/protocol';
import type { IsolateInspector } from '@isoloop/runtime';
import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { BusView } from './bus-view';
import { LogView } from './log-view';

/** How long the block control busy-loops an isolate's worker. */
export const BLOCK_MS = 2_000;

const CSS = `
.dt-tabs { display: flex; gap: 2px; padding: 4px 8px 0; border-bottom: 1px solid #374151; }
.dt-tab { background: none; border: 0; border-bottom: 2px solid transparent; color: #9ca3af;
  font: inherit; padding: 4px 8px; cursor: pointer; }
.dt-tab[aria-selected="true"] { color: #e5e7eb; border-bottom-color: #60a5fa; }
.dt-view { padding: 6px 8px; }
.dt-muted { color: #9ca3af; }
.dt-table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
.dt-table th { text-align: left; font-weight: 600; color: #9ca3af; padding: 2px 6px 4px 0;
  white-space: nowrap; }
.dt-table td { padding: 3px 6px 3px 0; border-top: 1px solid #1f2937; vertical-align: top;
  white-space: nowrap; }
.dt-table td.dt-num, .dt-table th.dt-num { text-align: right; }
.dt-badge { display: inline-block; margin-left: 4px; padding: 0 4px; border-radius: 3px;
  background: #1e3a8a; color: #bfdbfe; font-size: 10px; }
.dt-pool { display: block; color: #9ca3af; font-size: 11px; }
.dt-state-running { color: #86efac; }
.dt-state-blocked, .dt-state-crashed, .dt-state-restarting { color: #fcd34d; }
.dt-state-failed { color: #fca5a5; }
.dt-actions { display: flex; gap: 4px; }
.dt-actions button { background: #1f2937; color: #e5e7eb; border: 1px solid #374151;
  border-radius: 4px; font: inherit; font-size: 11px; padding: 1px 6px; cursor: pointer; }
.dt-actions button:focus-visible, .dt-tab:focus-visible { outline: 2px solid #60a5fa;
  outline-offset: 1px; }
.dt-status { margin: 6px 0 0; color: #fca5a5; }
.dt-h { margin: 10px 0 4px; font-size: 12px; color: #9ca3af; }
.dt-warning { color: #fcd34d; }
.dt-state-none { color: #9ca3af; }
.dt-log-bar { display: flex; gap: 4px; }
.dt-log-bar input { flex: 1; min-width: 0; background: #0b1220; color: #e5e7eb;
  border: 1px solid #374151; border-radius: 4px; font: inherit; padding: 2px 6px; }
.dt-log-bar button { background: #1f2937; color: #e5e7eb; border: 1px solid #374151;
  border-radius: 4px; font: inherit; font-size: 11px; padding: 1px 8px; cursor: pointer; }
.dt-log-bar input:focus-visible, .dt-log-bar button:focus-visible { outline: 2px solid #60a5fa;
  outline-offset: 1px; }
.dt-table td.dt-value { white-space: normal; word-break: break-all; max-width: 40ch; }
`;

const ms = (n: number | undefined): string => (n === undefined ? '–' : `${Math.round(n)} ms`);

const mb = (bytes: number): string => `${(bytes / 1_048_576).toFixed(1)} MB`;

/** A memory figure, its age against the feed's latest time, and what it covers. */
function Memory(props: { memory: InspectMemory | undefined; now: number }) {
  const { memory } = props;
  if (!memory) {
    return (
      <span
        class="dt-muted"
        title="Measured only in Chromium on a cross-origin isolated page (ADR 0020, decision 4)"
      >
        –
      </span>
    );
  }
  const age = Math.max(0, Math.round((props.now - memory.at) / 1000));
  return (
    <span
      data-memory={memory.bytes}
      title={`Chromium, cross-origin isolated. Measured ${age} s ago${memory.shared ? '; the whole pool worker, shared by its members' : ''}.`}
    >
      {mb(memory.bytes)}
      {memory.shared ? ' (pool)' : ''}
      <span class="dt-muted"> · {age} s</span>
    </span>
  );
}

function Controls(props: {
  id: string;
  inspector: IsolateInspector;
  onError: (message: string | undefined) => void;
}) {
  const act = (name: string, run: () => Promise<void>) => () => {
    props.onError(undefined);
    run().catch((e: unknown) => {
      props.onError(`${name} ${props.id}: ${e instanceof Error ? e.message : String(e)}`);
    });
  };
  const { id, inspector } = props;
  return (
    <span class="dt-actions">
      <button
        type="button"
        data-control="restart"
        aria-label={`Restart ${id}`}
        title={`Restart ${id}`}
        onClick={act('restart', () => inspector.restart(id))}
      >
        Restart
      </button>
      <button
        type="button"
        data-control="kill"
        aria-label={`Kill ${id}`}
        title={`End ${id}'s worker as a crash; the supervisor restarts it. In a pool, every member restarts.`}
        onClick={act('kill', () => inspector.kill(id))}
      >
        Kill
      </button>
      <button
        type="button"
        data-control="block"
        aria-label={`Block ${id} for ${BLOCK_MS / 1000} s`}
        title={`Busy-loop ${id}'s worker for ${BLOCK_MS / 1000} s`}
        onClick={act('block', () => inspector.block(id, BLOCK_MS))}
      >
        Block {BLOCK_MS / 1000} s
      </button>
    </span>
  );
}

function IsolateRow(props: {
  isolate: InspectIsolate;
  self: boolean;
  now: number;
  inspector: IsolateInspector | undefined;
  onError: (message: string | undefined) => void;
}) {
  const i = props.isolate;
  return (
    <tr data-isolate={i.id} data-state={i.state}>
      <td>
        <code>{i.id}</code>
        {props.self ? (
          <span class="dt-badge" data-devtools-self="">
            devtools
          </span>
        ) : null}
        {i.pool === undefined ? null : <span class="dt-pool">pool {i.pool}</span>}
      </td>
      <td class={`dt-state-${i.state}`} title={i.error ?? i.reason ?? ''}>
        {i.state}
      </td>
      <td class="dt-num" data-lag={i.lagMs}>
        {ms(i.lagMs)}
      </td>
      <td class="dt-num" title="Busy time from its last beat (ADR 0017)">
        {ms(i.busyMs)}
      </td>
      <td class="dt-num">
        <Memory memory={i.memory} now={props.now} />
      </td>
      <td class="dt-num" data-restarts={i.restarts}>
        {i.restarts}
      </td>
      <td class="dt-num" title="Patch batches waiting for the compositor">
        {i.surface ? i.surface.queued : '–'}
      </td>
      <td>
        {props.inspector ? (
          <Controls id={i.id} inspector={props.inspector} onError={props.onError} />
        ) : null}
      </td>
    </tr>
  );
}

function IsolatesView(props: { snap: InspectSnapshot }) {
  const ctx = useIsolate();
  const [error, setError] = useState<string | undefined>(undefined);
  const { snap } = props;
  return (
    <div class="dt-view" data-view="isolates">
      <p data-isoloop-devtools-summary="" class="dt-muted" style="margin:0 0 4px;">
        {snap.isolates.length} isolates · bus {snap.bus.state}
      </p>
      <table class="dt-table">
        <thead>
          <tr>
            <th>Isolate</th>
            <th>State</th>
            <th class="dt-num">Lag</th>
            <th class="dt-num">Busy</th>
            <th class="dt-num">Memory</th>
            <th class="dt-num">Restarts</th>
            <th class="dt-num">Queue</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {snap.isolates.map((i) => (
            <IsolateRow
              key={i.id}
              isolate={i}
              self={i.id === ctx.id}
              now={snap.at}
              inspector={ctx.inspector}
              onError={setError}
            />
          ))}
        </tbody>
      </table>
      {error === undefined ? null : (
        <p class="dt-status" role="status" data-isoloop-devtools-status="">
          {error}
        </p>
      )}
      {snap.pools.length === 0 ? null : (
        <>
          <h3 class="dt-h">Pools</h3>
          <table class="dt-table" data-view="pools">
            <thead>
              <tr>
                <th>Pool</th>
                <th>Members</th>
                <th>Worker</th>
              </tr>
            </thead>
            <tbody>
              {snap.pools.map((p) => (
                <tr key={p.name} data-pool={p.name}>
                  <td>
                    <code>{p.name}</code>
                  </td>
                  <td style="white-space:normal;">
                    {p.members.join(', ')}
                    {p.warning === undefined ? null : (
                      <span class="dt-pool dt-warning">{p.warning}</span>
                    )}
                  </td>
                  <td>{p.running ? 'running' : 'stopped'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

type Tab = 'isolates' | 'bus' | 'log';

const TABS: readonly { id: Tab; label: string }[] = [
  { id: 'isolates', label: 'Isolates' },
  { id: 'bus', label: 'Bus' },
  { id: 'log', label: 'Log' },
];

const tabId = (t: Tab): string => `dt-tab-${t}`;
const panelId = (t: Tab): string => `dt-panel-${t}`;

export function Body(props: { snap: InspectSnapshot | undefined }): JSX.Element {
  const ctx = useIsolate();
  const [tab, setTab] = useState<Tab>('isolates');
  useEffect(() => {
    ctx.styles(CSS);
  }, []);
  const { snap } = props;
  // Arrow keys move between tabs and focus the new one (the WAI-ARIA tabs
  // pattern); focus is a host call, since the DOM lives on the page.
  const buttons = useRef<Partial<Record<Tab, unknown>>>({});
  const onKey = (e: KeyboardEvent): void => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (step === 0) return;
    const i = TABS.findIndex((t) => t.id === tab);
    const next = TABS[(i + step + TABS.length) % TABS.length];
    if (!next) return;
    setTab(next.id);
    const el = buttons.current[next.id];
    if (el !== undefined) ctx.host.focus(el).catch(() => undefined);
  };
  let view: JSX.Element;
  if (!snap) view = <p class="dt-view dt-muted">Waiting for the inspection feed…</p>;
  else if (tab === 'bus') view = <BusView bus={snap.bus} />;
  else if (tab === 'log') view = <LogView />;
  else view = <IsolatesView snap={snap} />;
  return (
    <>
      <div class="dt-tabs" role="tablist" aria-label="Devtools views" onKeyDown={onKey}>
        {TABS.map((t) => (
          <button
            key={t.id}
            ref={(el) => {
              buttons.current[t.id] = el ?? undefined;
            }}
            id={tabId(t.id)}
            type="button"
            role="tab"
            data-tab={t.id}
            aria-selected={tab === t.id ? 'true' : 'false'}
            aria-controls={panelId(t.id)}
            tabindex={tab === t.id ? 0 : -1}
            class="dt-tab"
            onClick={() => {
              setTab(t.id);
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={panelId(tab)} aria-labelledby={tabId(tab)}>
        {view}
      </div>
    </>
  );
}
