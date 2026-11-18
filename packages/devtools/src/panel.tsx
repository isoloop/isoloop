/*
 * The devtools panel isolate (M4b devtools decisions 4 and 8): a visual
 * isolate in its own worker, never pooled, reading the inspection feed
 * through `ctx.inspector` (ADR 0020, decision 6).
 *
 * Its surface covers the viewport and takes no pointer events, so the panel
 * places itself: closed, a floating button in its corner, with a dot amber
 * while an isolate is restarting or late and red once one has given up;
 * open, a panel docked in that corner, resizable from its inner corner.
 * Open state, size and corner are kept across reloads (`persist.ts`).
 */
import { defineIsolate, useIsolate, type IsolateProps } from '@isoloop/preact';
import type { InspectSnapshot } from '@isoloop/protocol';
import type { IsolateDefinition } from '@isoloop/runtime';
import { useEffect, useRef, useState } from 'preact/hooks';
import { healthOf, useFeed, type Health } from './feed';
import type { DevtoolsPosition } from './index';
import { loadUi, saveUi, type UiState } from './persist';
import { Body } from './views';

const POSITIONS: readonly DevtoolsPosition[] = [
  'bottom-right',
  'bottom-left',
  'top-left',
  'top-right',
];

export const MIN_WIDTH = 280;
export const MIN_HEIGHT = 160;
const GAP = 12;

const font = 'font:12px/1.4 ui-sans-serif,system-ui,sans-serif;';

const configPosition = (config: unknown): DevtoolsPosition => {
  const p: unknown =
    typeof config === 'object' && config !== null ? Reflect.get(config, 'position') : undefined;
  return POSITIONS.find((x) => x === p) ?? 'bottom-right';
};

/**
 * CSS placing a box in `position`'s corner of the viewport. Fixed, not
 * absolute: the compositor's own element in the surface has no height.
 */
const corner = (position: DevtoolsPosition): string => {
  const [v, h] = position.split('-');
  return `position:fixed;${v}:${GAP}px;${h}:${GAP}px;`;
};

const DOT: Record<Health, string | undefined> = {
  ok: undefined,
  unwell: '#f59e0b',
  failed: '#dc2626',
};

function Fab(props: { position: DevtoolsPosition; health: Health; onOpen: () => void }) {
  const dot = DOT[props.health];
  return (
    <button
      type="button"
      data-isoloop-devtools-toggle=""
      data-health={props.health}
      aria-label="Open Isoloop devtools (Alt+Shift+D)"
      title="Isoloop devtools (Alt+Shift+D)"
      onClick={props.onOpen}
      style={`${corner(props.position)}pointer-events:auto;width:40px;height:40px;border-radius:20px;border:1px solid #374151;background:#111827;color:#e5e7eb;cursor:pointer;padding:0;box-shadow:0 2px 8px rgb(0 0 0 / 0.3);${font}`}
    >
      <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
        <circle cx="10" cy="10" r="6.5" fill="none" stroke="currentColor" stroke-width="2" />
        <circle cx="10" cy="3.5" r="2" fill="currentColor" />
      </svg>
      {dot ? (
        <span
          data-dot={props.health}
          style={`position:absolute;top:2px;right:2px;width:10px;height:10px;border-radius:5px;background:${dot};border:2px solid #111827;`}
        />
      ) : null}
    </button>
  );
}

type Drag = { x: number; y: number; width: number; height: number };

function Dock(props: {
  ui: UiState;
  snap: InspectSnapshot | undefined;
  onClose: () => void;
  onMove: () => void;
  onResize: (width: number, height: number, done: boolean) => void;
}) {
  const { ui } = props;
  const [v, h] = ui.position.split('-');
  const [drag, setDrag] = useState<Drag | undefined>(undefined);
  // The handle is on the panel's inner corner: dragging it away from the
  // docked corner makes the panel bigger.
  const sx = h === 'right' ? 1 : -1;
  const sy = v === 'bottom' ? 1 : -1;
  const sizeAt = (d: Drag, x: number, y: number): [number, number] => [
    Math.max(MIN_WIDTH, Math.round(d.width + (d.x - x) * sx)),
    Math.max(MIN_HEIGHT, Math.round(d.height + (d.y - y) * sy)),
  ];
  const handleV = v === 'bottom' ? 'top' : 'bottom';
  const handleH = h === 'right' ? 'left' : 'right';
  const cursor = sx === sy ? 'nwse-resize' : 'nesw-resize';
  return (
    <div
      data-isoloop-devtools-panel=""
      role="dialog"
      aria-label="Isoloop devtools"
      onKeyDown={(e) => {
        if (e.key === 'Escape') props.onClose();
      }}
      style={`${corner(ui.position)}pointer-events:auto;box-sizing:border-box;width:${ui.width}px;height:${ui.height}px;max-width:calc(100vw - ${2 * GAP}px);max-height:calc(100vh - ${2 * GAP}px);display:flex;flex-direction:column;border:1px solid #374151;border-radius:8px;background:#111827;color:#e5e7eb;box-shadow:0 4px 16px rgb(0 0 0 / 0.35);overflow:hidden;${font}`}
    >
      <div style="display:flex;align-items:center;gap:8px;padding:6px 8px;border-bottom:1px solid #374151;">
        <strong style="flex:1;">Isoloop devtools</strong>
        <button
          type="button"
          data-isoloop-devtools-move=""
          aria-label="Dock in the next corner"
          title="Dock in the next corner"
          onClick={props.onMove}
          style="background:none;border:0;color:inherit;cursor:pointer;"
        >
          ⤢
        </button>
        <button
          type="button"
          data-isoloop-devtools-toggle=""
          aria-label="Close Isoloop devtools (Alt+Shift+D)"
          title="Close (Alt+Shift+D)"
          onClick={props.onClose}
          style="background:none;border:0;color:inherit;cursor:pointer;"
        >
          ✕
        </button>
      </div>
      <div style="flex:1;overflow:auto;">
        <Body snap={props.snap} />
      </div>
      <div
        data-isoloop-devtools-resize=""
        aria-hidden="true"
        onPointerDown={(e) => {
          setDrag({ x: e.clientX, y: e.clientY, width: ui.width, height: ui.height });
        }}
        style={`position:absolute;${handleV}:0;${handleH}:0;width:14px;height:14px;cursor:${cursor};`}
      />
      {drag ? (
        // While dragging, a layer over the whole viewport takes the pointer,
        // so moves outside the panel still reach it (an isolate can't capture
        // the pointer).
        <div
          data-isoloop-devtools-drag=""
          onPointerMove={(e) => {
            const [w, ht] = sizeAt(drag, e.clientX, e.clientY);
            props.onResize(w, ht, false);
          }}
          onPointerUp={(e) => {
            const [w, ht] = sizeAt(drag, e.clientX, e.clientY);
            setDrag(undefined);
            props.onResize(w, ht, true);
          }}
          style={`position:fixed;inset:0;pointer-events:auto;cursor:${cursor};`}
        />
      ) : null}
    </div>
  );
}

function Panel({ config }: IsolateProps) {
  const ctx = useIsolate();
  const snap = useFeed(ctx.inspector);
  const [ui, setUi] = useState<UiState | undefined>(undefined);
  const latest = useRef<UiState | undefined>(undefined);
  latest.current = ui;

  useEffect(() => {
    let alive = true;
    void loadUi().then((stored) => {
      if (!alive) return;
      setUi({ open: false, width: 420, height: 320, position: configPosition(config), ...stored });
    });
    return () => {
      alive = false;
    };
  }, []);

  if (!ui) return null;
  const update = (patch: Partial<UiState>, persist = true): void => {
    const base = latest.current ?? ui;
    const next = { ...base, ...patch };
    latest.current = next;
    setUi(next);
    if (persist) void saveUi(next);
  };
  if (!ui.open) {
    return (
      <Fab
        position={ui.position}
        health={healthOf(snap)}
        onOpen={() => {
          update({ open: true });
        }}
      />
    );
  }
  return (
    <Dock
      ui={ui}
      snap={snap}
      onClose={() => {
        update({ open: false });
      }}
      onMove={() => {
        const i = POSITIONS.indexOf(ui.position);
        update({ position: POSITIONS[(i + 1) % POSITIONS.length] ?? 'bottom-right' });
      }}
      onResize={(width, height, done) => {
        update({ width, height }, done);
      }}
    />
  );
}

const panel: IsolateDefinition = defineIsolate(Panel);
export default panel;
