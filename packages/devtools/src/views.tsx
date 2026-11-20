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
import { BusView, type BusSub } from './bus-view';
import { LogView } from './log-view';
import { SubTabs, subId, subPanelId, type SubItem } from './subtabs';

/** How long the block control busy-loops an isolate's worker. */
export const BLOCK_MS = 2_000;

const CSS = `
.dt-root { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.dt-nav { background: #0b1220; }
.dt-scroll { flex: 1; min-height: 0; overflow: auto; }
/* The log keeps its toolbar in place and scrolls only its rows. */
.dt-scroll-fill { display: flex; flex-direction: column; overflow: hidden; }
.dt-tabs { display: flex; gap: 2px; padding: 4px 12px 0; border-bottom: 1px solid #374151; }
.dt-subtabs { display: flex; gap: 4px; padding: 4px 12px; background: #0f1a2e;
  border-bottom: 1px solid #1f2937; }
.dt-subtab { background: none; border: 1px solid transparent; border-radius: 999px; color: #8b95a7;
  font: inherit; font-size: 11px; padding: 1px 9px; cursor: pointer; }
.dt-subtab:hover { color: #e5e7eb; }
.dt-subtab[aria-selected="true"] { background: #1e293b; border-color: #334155; color: #e5e7eb; }
.dt-subtab:focus-visible { outline: 2px solid #60a5fa; outline-offset: 1px; }
.dt-subcount { margin-left: 5px; color: #64748b; font-variant-numeric: tabular-nums; }
.dt-subtab[aria-selected="true"] .dt-subcount { color: #93c5fd; }
.dt-tab { background: none; border: 0; border-bottom: 2px solid transparent; color: #9ca3af;
  font: inherit; padding: 4px 8px; cursor: pointer; }
.dt-tab[aria-selected="true"] { color: #e5e7eb; border-bottom-color: #60a5fa; }
.dt-view { padding: 6px 12px; }
.dt-muted { color: #9ca3af; }
.dt-table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
.dt-table th { text-align: left; font-weight: 600; color: #9ca3af; padding: 2px 12px 4px 0;
  white-space: nowrap; }
.dt-table td { padding: 3px 12px 3px 0; border-top: 1px solid #1f2937; vertical-align: top;
  white-space: nowrap; }
.dt-table th { position: sticky; top: 0; z-index: 1; background: #111827; box-shadow: 0 1px 0 #374151; }
.dt-table td.dt-num, .dt-table th.dt-num { text-align: right; }
.dt-chips { display: flex; flex-wrap: wrap; gap: 3px; }
.dt-chip { background: #1f2937; border: 1px solid #374151; border-radius: 4px; padding: 0 5px;
  font-size: 11px; color: #d1d5db; }
.dt-more { background: none; border: 1px dashed #4b5563; border-radius: 4px; color: #93c5fd;
  font: inherit; font-size: 11px; padding: 0 5px; cursor: pointer; }
.dt-more:focus-visible { outline: 2px solid #60a5fa; outline-offset: 1px; }
.dt-pool-note { margin-top: 3px; font-size: 11px; }
.dt-badge { display: inline-block; margin-left: 4px; padding: 0 4px; border-radius: 3px;
  background: #1e3a8a; color: #bfdbfe; font-size: 10px; }
.dt-pool { display: block; color: #9ca3af; font-size: 11px; }
.dt-state-running { color: #86efac; }
.dt-state-blocked, .dt-state-crashed, .dt-state-restarting { color: #fcd34d; }
.dt-state-failed { color: #fca5a5; }
.dt-actions { display: flex; justify-content: center; gap: 4px; }
.dt-table th.dt-center { text-align: center; }
.dt-actions button { background: #1f2937; color: #e5e7eb; border: 1px solid #374151;
  border-radius: 4px; font: inherit; font-size: 11px; padding: 1px 6px; cursor: pointer; }
.dt-actions button:focus-visible, .dt-tab:focus-visible { outline: 2px solid #60a5fa;
  outline-offset: 1px; }
.dt-status { margin: 6px 0 0; color: #fca5a5; }
.dt-h { margin: 10px 0 4px; font-size: 12px; color: #9ca3af; }
.dt-warning { color: #fcd34d; }
.dt-state-none { color: #9ca3af; }
.dt-log { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.dt-log-rows { flex: 1; min-height: 0; overflow: auto; container-type: inline-size; }
/* The detail keeps the width you can see, so a wide table doesn't push its panels out of view. */
.dt-detail { position: sticky; left: 0; width: calc(100cqw - 16px); box-sizing: border-box; }
.dt-log-bar { display: flex; align-items: stretch; gap: 4px; }
.dt-log-bar input { flex: 1; min-width: 0; box-sizing: border-box; background: #0b1220; color: #e5e7eb;
  border: 1px solid #374151; border-radius: 4px; font: inherit; padding: 2px 6px; }
.dt-log-bar button { box-sizing: border-box; background: #1f2937; color: #e5e7eb; border: 1px solid #374151;
  border-radius: 4px; font: inherit; font-size: 11px; padding: 1px 8px; cursor: pointer; }
.dt-log-bar input:focus-visible, .dt-log-bar button:focus-visible { outline: 2px solid #60a5fa;
  outline-offset: 1px; }
.dt-table td.dt-value { white-space: normal; word-break: break-all; max-width: 40ch; }
/* The log's columns with a known width keep it; the value takes the rest, on one line. */
.dt-table .dt-c-time { width: 12ch; min-width: 12ch; }
.dt-table .dt-c-offset { width: 7ch; min-width: 7ch; }
.dt-table .dt-c-size { width: 9ch; min-width: 9ch; }
.dt-table .dt-c-key { width: 12ch; min-width: 12ch; max-width: 12ch; overflow: hidden;
  text-overflow: ellipsis; }
.dt-table td.dt-vclip { width: 100%; max-width: 0; overflow: hidden; text-overflow: ellipsis; }
.dt-table .dt-c-chev { width: 18px; min-width: 18px; padding-right: 0; }
.dt-chev { background: none; border: 0; color: #6b7280; font: inherit; font-size: 11px;
  padding: 0; width: 16px; cursor: pointer; }
.dt-log-row:hover .dt-chev, .dt-log-row[aria-expanded="true"] .dt-chev { color: #e5e7eb; }
.dt-chev:focus-visible { outline: 2px solid #60a5fa; outline-offset: 1px; }
.dt-sr { position: absolute; width: 1px; height: 1px; overflow: hidden;
  clip: rect(0 0 0 0); white-space: nowrap; }
.dt-log-row { cursor: pointer; }
.dt-log-row:hover { background: #172033; }
.dt-log-row[aria-expanded="true"] { background: #172033; }
.dt-table tr.dt-log-detail td { white-space: normal; background: #0b1220; padding: 6px 8px; }
.dt-detail-bar { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.dt-detail-bar .dt-subtabs { background: none; border: 0; padding: 0; }
.dt-detail-bar button[data-log-copy] { background: #1f2937; color: #e5e7eb; border: 1px solid #374151;
  border-radius: 4px; font: inherit; font-size: 11px; padding: 1px 8px; cursor: pointer; }
.dt-detail-bar button[data-log-copy]:focus-visible { outline: 2px solid #60a5fa; outline-offset: 1px; }
.dt-detail-h { color: #9ca3af; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; }
.dt-detail-cols { display: flex; flex-wrap: wrap; align-items: stretch; gap: 8px; }
.dt-detail-part { box-sizing: border-box; min-width: 0; background: #0f1a2e; border: 1px solid #1f2937;
  border-left-width: 3px; border-radius: 6px; padding: 6px 10px 8px; }
.dt-detail-value { flex: 1 1 260px; border-left-color: #4ade80; }
/* The record is as wide as its content, up to 30% of what you can see. */
.dt-detail-record { flex: 0 1 auto; width: max-content; max-width: 30%; min-width: 200px;
  border-left-color: #60a5fa; }
.dt-rec { margin: 0; }
.dt-rec-row { display: grid; grid-template-columns: 4.5em 1fr; gap: 0 12px; padding: 3px 0;
  border-top: 1px solid #1c2a40; }
.dt-rec-row:first-child { border-top: 0; }
.dt-rec dt { color: #8b95a7; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em;
  padding-top: 1px; }
.dt-rec dd { margin: 0; color: #e5e7eb; word-break: break-word; }
.dt-rec-mono, .dt-rec-topic, .dt-rec-num, .dt-rec-str { font: 11px/1.5 ui-monospace, SFMono-Regular,
  Menlo, monospace; }
.dt-rec-topic, .dt-col-topic { color: #93c5fd; }
.dt-rec-num, .dt-col-num { color: #fcd34d; }
.dt-rec-str, .dt-col-str { color: #86efac; }
.dt-dim { color: #64748b; }
.dt-rec-note { margin: 4px 0 0; color: #9ca3af; font-size: 11px; }
.dt-json { margin: 0; max-height: 240px; overflow: auto; white-space: pre-wrap;
  word-break: break-word; font: 11px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace;
  color: #d1d5db; }
.dt-j-key { color: #93c5fd; }
.dt-j-string { color: #86efac; }
.dt-j-number { color: #fcd34d; }
.dt-j-literal { color: #c4b5fd; }
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

/** How many members a pool row lists before "+N more". */
const POOL_PREVIEW = 8;

function PoolRow(props: { pool: InspectSnapshot['pools'][number] }) {
  const { pool: p } = props;
  const [all, setAll] = useState(false);
  const shown = all ? p.members : p.members.slice(0, POOL_PREVIEW);
  const rest = p.members.length - shown.length;
  return (
    <tr data-pool={p.name}>
      <td>
        <code>{p.name}</code>
      </td>
      <td class={p.running ? 'dt-state-running' : 'dt-state-failed'}>
        {p.running ? 'running' : 'stopped'}
      </td>
      <td class="dt-num">{p.members.length}</td>
      <td style="white-space:normal;">
        <div class="dt-chips">
          {shown.map((m) => (
            <span key={m} class="dt-chip">
              {m}
            </span>
          ))}
          {p.members.length > POOL_PREVIEW ? (
            <button
              type="button"
              class="dt-more"
              data-pool-more={p.name}
              aria-expanded={all ? 'true' : 'false'}
              onClick={() => {
                setAll(!all);
              }}
            >
              {all ? 'Show fewer' : `+${rest} more`}
            </button>
          ) : null}
        </div>
        {p.warning === undefined ? null : <div class="dt-pool-note dt-warning">⚠ {p.warning}</div>}
      </td>
    </tr>
  );
}

function PoolsTable(props: { snap: InspectSnapshot }) {
  return (
    <table class="dt-table" data-view="pools">
      <thead>
        <tr>
          <th>Pool</th>
          <th>Worker</th>
          <th class="dt-num">Isolates</th>
          <th>Members</th>
        </tr>
      </thead>
      <tbody>
        {props.snap.pools.map((p) => (
          <PoolRow key={p.name} pool={p} />
        ))}
      </tbody>
    </table>
  );
}

export type IsolatesSub = 'isolates' | 'pools';

function IsolatesView(props: { snap: InspectSnapshot; sub: IsolatesSub }) {
  const ctx = useIsolate();
  const [error, setError] = useState<string | undefined>(undefined);
  const { snap, sub } = props;
  if (sub === 'pools') {
    return (
      <div class="dt-view" data-view="isolates">
        <PoolsTable snap={snap} />
      </div>
    );
  }
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
            <th class="dt-center">Actions</th>
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
  // Each view's second-level tab, kept while the panel is open.
  const [isoSub, setIsoSub] = useState<IsolatesSub>('isolates');
  const [busSub, setBusSub] = useState<BusSub>('topics');
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
  let subBar: JSX.Element | null = null;
  let subGroup = '';
  let subValue = '';
  if (!snap) view = <p class="dt-view dt-muted">Waiting for the inspection feed…</p>;
  else if (tab === 'bus') {
    const m = snap.bus.metrics;
    const items: readonly SubItem<BusSub>[] = m
      ? [
          { id: 'topics', label: 'Topics', count: m.topics.length },
          { id: 'subscriptions', label: 'Subscriptions', count: m.subscriptions.length },
          {
            id: 'rejected',
            label: 'Rejected',
            count: Object.values(m.rejected).reduce<number>(
              (n, v) => n + (typeof v === 'number' ? v : 0),
              0,
            ),
          },
        ]
      : [];
    subGroup = 'bus';
    subValue = busSub;
    if (items.length > 0) {
      subBar = (
        <SubTabs group="bus" label="Bus views" items={items} value={busSub} onChange={setBusSub} />
      );
    }
    view = <BusView bus={snap.bus} sub={busSub} />;
  } else if (tab === 'log') view = <LogView />;
  else {
    // No pools, no Pools tab; a selected Pools tab falls back to the isolates.
    const hasPools = snap.pools.length > 0;
    const sub: IsolatesSub = hasPools ? isoSub : 'isolates';
    const items: readonly SubItem<IsolatesSub>[] = [
      { id: 'isolates', label: 'Isolates', count: snap.isolates.length },
      ...(hasPools ? [{ id: 'pools' as const, label: 'Pools', count: snap.pools.length }] : []),
    ];
    subGroup = 'isolates';
    subValue = sub;
    if (hasPools) {
      subBar = (
        <SubTabs
          group="isolates"
          label="Isolates views"
          items={items}
          value={sub}
          onChange={setIsoSub}
        />
      );
    }
    view = <IsolatesView snap={snap} sub={sub} />;
  }
  return (
    <div class="dt-root">
      <div class="dt-nav">
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
        {subBar}
      </div>
      <div
        class={tab === 'log' ? 'dt-scroll dt-scroll-fill' : 'dt-scroll'}
        role="tabpanel"
        id={subBar ? subPanelId(subGroup) : panelId(tab)}
        aria-labelledby={subBar ? subId(subGroup, subValue) : tabId(tab)}
      >
        {view}
      </div>
    </div>
  );
}
