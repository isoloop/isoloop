/*
 * The devtools panel isolate (M4b devtools decisions 4 and 8): a visual
 * isolate in its own worker, never pooled, reading the inspection feed
 * through `ctx.inspector` (ADR 0020, decision 6).
 *
 * Its surface covers the viewport and takes no pointer events, so the panel
 * places itself: closed, a floating button in its corner, with a dot amber
 * while an isolate is `restarting`, `crashed` or `blocked` and red once one
 * has `failed`;
 * open, a panel docked in that corner, resizable from its inner corner.
 * Open state, size and corner are kept across reloads (`persist.ts`).
 */
import { defineIsolate, useIsolate, type IsolateProps } from '@isoloop/preact';
import type { InspectSnapshot } from '@isoloop/protocol';
import type { IsolateDefinition } from '@isoloop/runtime';
import { useEffect, useRef, useState } from 'preact/hooks';
import { healthOf, useFeed, type Health } from './feed';
import type { DevtoolsPosition } from './index';
import { loadUi, saveUi, type PanelMode, type UiState } from './persist';
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
/** The open panel docks flush to the viewport edges, so it can be dragged to the very edge. */
const DOCK_GAP = 0;

/** Isoloop one-colour mark (logo exploration 6-cube v108), traced to a path. */
const MARK =
  'M33.9 79.4L31.7 79.4L28.4 79.2L26.3 78.8L23.5 78.1L19.9 76.6L17.1 75.0L15.2 73.7L12.5 71.4L10.6 69.3L9.1 67.3L7.7 65.0L6.6 62.1L5.9 59.7L5.4 56.7L5.2 53.3L0.1 53.2L5.4 43.7L6.0 40.3L6.9 36.7L7.9 33.8L9.2 30.7L11.1 27.0L13.9 22.9L15.5 20.8L17.6 18.4L19.9 16.2L24.2 12.7L26.7 11.0L30.5 8.9L33.9 7.4L38.6 5.7L42.9 4.8L47.5 4.3L51.6 4.2L55.2 4.5L59.2 5.2L63.8 6.5L67.3 7.9L71.6 10.1L75.4 12.5L77.7 14.3L80.1 16.5L83.3 19.8L84.9 21.8L87.1 25.0L89.7 29.6L90.9 32.3L92.3 36.0L93.1 38.8L93.8 42.0L94.3 45.9L99.7 46.1L94.4 55.9L93.2 60.7L91.6 65.4L91.6 65.5L91.1 64.8L80.0 46.2L86.0 46.1L85.9 43.7L85.5 41.3L84.8 38.3L84.2 36.4L83.4 34.2L82.0 31.0L80.2 27.8L79.0 26.1L77.7 24.4L75.7 22.1L72.1 18.8L68.7 16.3L66.4 15.0L64.2 13.9L59.9 12.3L56.3 11.5L53.7 11.1L51.6 10.9L48.7 10.9L46.3 11.0L41.5 11.9L37.6 13.1L33.7 14.7L30.7 16.3L26.5 19.4L23.9 21.7L20.8 25.1L18.3 28.5L16.5 31.8L15.5 34.2L14.4 37.6L13.8 40.1L13.5 43.5L13.7 44.0L19.3 53.1L19.2 53.2L13.5 53.3L13.1 53.4L13.3 55.3L14.1 58.4L15.3 61.4L16.6 63.6L18.4 65.9L21.0 68.3L23.7 70.0L25.9 71.0L27.2 71.4L30.2 71.9L32.1 72.1L34.7 71.9L36.7 71.7L38.9 71.1L41.0 70.5L42.6 69.8L44.5 68.7L46.1 67.6L46.9 66.9L48.5 65.0L49.4 63.2L50.0 61.4L50.2 59.5L50.3 51.2L77.6 35.1L77.7 36.5L77.8 65.2L77.7 65.4L72.0 68.8L71.4 69.1L71.3 69.0L71.1 65.9L70.4 62.0L70.3 47.3L70.1 47.2L57.1 54.8L57.0 62.0L56.9 63.3L56.5 65.2L55.7 67.4L54.6 69.5L53.1 71.4L51.8 72.6L49.8 74.2L47.6 75.6L45.7 76.6L43.0 77.7L38.4 78.9ZM32.8 39.5L30.1 38.1L23.1 33.9L24.4 33.1L49.9 18.0L69.9 29.5L69.1 30.0L62.6 33.8L50.1 26.5L42.6 30.6L38.9 33.0L37.5 34.1L35.2 36.3ZM30.2 60.9L30.0 60.9L30.0 51.5L30.2 49.0L30.6 46.7L31.1 45.0L31.8 43.2L32.9 41.0L35.1 37.9L36.9 35.9L38.5 34.5L42.3 31.9L49.5 27.8L49.7 30.0L49.7 35.2L49.6 41.0L44.9 38.4L43.4 39.6L41.6 41.4L39.8 43.7L38.6 45.9L37.8 48.4L37.5 50.7L37.5 52.6L41.1 54.7L41.2 54.9ZM50.6 40.8L50.6 27.9L61.5 34.4L60.5 35.0ZM49.7 50.4L40.3 45.0L40.5 44.4L41.8 42.7L43.7 40.6L44.9 39.6L45.0 39.5L45.8 39.9L49.9 42.3L70.9 30.1L77.5 33.9ZM33.6 71.1L31.4 71.1L22.3 65.5L22.4 34.7L32.2 40.3L31.0 42.7L30.2 44.8L29.5 47.4L29.2 48.9L29.0 51.4L29.1 61.8L39.0 67.7L41.4 69.2L40.1 69.8L37.4 70.6L35.1 71.0ZM42.9 68.5L42.6 68.6L42.5 68.2L42.6 54.6L38.4 52.0L38.6 49.0L39.0 47.6L39.7 45.8L49.3 51.4L49.3 59.7L49.0 61.4L48.6 62.7L47.7 64.6L46.8 65.6L45.2 67.2ZM69.4 61.3L58.5 55.0L69.3 48.7L69.4 48.8L69.4 48.9L69.5 58.3L69.5 61.2ZM41.6 68.0L41.4 68.0L40.4 67.4L30.9 61.9L30.8 61.7L41.6 55.8ZM56.1 69.2L55.9 69.3L55.8 69.2L56.7 67.6L57.3 65.8L57.9 63.2L58.0 60.9L58.0 56.0L58.1 55.9L58.6 56.2L68.6 62.0L68.6 62.1ZM52.8 95.6L46.0 95.6L43.1 95.3L39.3 94.7L35.8 93.7L33.2 92.7L31.2 91.8L27.6 89.9L24.4 87.7L22.2 86.0L19.3 83.3L17.5 81.4L15.6 79.1L13.5 76.1L11.3 72.6L10.2 70.5L10.3 70.5L12.2 72.4L14.3 74.1L18.5 77.0L22.6 78.7L25.0 79.4L28.2 80.0L31.8 82.6L35.8 84.6L38.6 85.7L42.4 86.6L46.4 87.0L49.3 86.9L51.8 86.4L53.9 85.5L55.9 84.2L58.2 82.0L59.4 80.3L60.3 78.7L61.5 75.3L61.9 72.9L62.0 71.4L61.9 69.0L61.6 67.3L69.5 62.7L69.8 64.0L70.3 67.6L70.4 70.4L70.2 73.0L69.8 75.6L69.3 77.6L68.4 80.1L67.2 82.2L64.8 85.6L62.7 87.7L60.4 89.6L58.1 91.1L56.3 92.1L53.2 93.4L49.7 94.5L50.3 94.5L51.7 94.4L54.4 93.7L57.7 92.3L60.3 90.9L62.9 88.9L64.5 87.4L66.2 85.5L67.8 83.2L68.8 81.4L72.0 78.9L75.4 75.7L78.1 72.4L81.1 68.0L83.6 63.1L84.7 60.3L85.6 57.5L91.1 66.7L89.0 71.1L87.1 74.2L84.5 77.9L82.4 80.5L78.8 84.2L75.5 86.9L72.0 89.3L69.1 91.0L64.8 92.9L60.7 94.2L56.2 95.2ZM50.6 81.7L50.6 74.8L52.9 72.9L54.7 71.0L60.7 67.7L61.0 69.5L61.1 71.6L60.9 73.9L60.5 75.4ZM49.7 82.3L49.4 82.3L45.6 80.1L43.2 78.6L46.9 77.0L49.7 75.5Z';

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
const corner = (position: DevtoolsPosition, gap = GAP): string => {
  const [v, h] = position.split('-');
  return `position:fixed;${v}:${gap}px;${h}:${gap}px;`;
};

/**
 * The panel's size. Stretched or maximized, it is pinned to both edges instead
 * of given the viewport's width: `100vw` counts the page's scrollbar, so the
 * panel would run a few pixels past the window.
 */
const OPPOSITE: Record<string, string | undefined> = {
  left: 'right',
  right: 'left',
  top: 'bottom',
  bottom: 'top',
};

const fill = (ui: UiState): string => {
  const [v, h] = ui.position.split('-');
  const wide = ui.mode !== 'normal' ? `${OPPOSITE[h ?? ''] ?? 'left'}:0;` : '';
  const tall = ui.mode === 'max' ? `${OPPOSITE[v ?? ''] ?? 'top'}:0;` : '';
  const width = ui.mode === 'normal' ? `width:${ui.width}px;` : 'width:auto;';
  const height = ui.mode === 'max' ? 'height:auto;' : `height:${ui.height}px;`;
  return `${wide}${tall}${width}${height}max-width:100%;max-height:100%;`;
};

const DOT: Record<Health, string | undefined> = {
  ok: undefined,
  unwell: '#f59e0b',
  failed: '#dc2626',
};

/** The closed button: a round tile of 70px, the mark inside at 58px. */
const FAB_SIZE = 70;
const FAB_MARK = 58;

const STEP: Record<DevtoolsPosition, Record<'horizontal' | 'vertical', DevtoolsPosition>> = {
  'bottom-left': { horizontal: 'bottom-right', vertical: 'top-left' },
  'bottom-right': { horizontal: 'bottom-left', vertical: 'top-right' },
  'top-left': { horizontal: 'top-right', vertical: 'bottom-left' },
  'top-right': { horizontal: 'top-left', vertical: 'bottom-right' },
};

/** The corner one step across (`horizontal`) or up or down (`vertical`) from `position`. */
export const stepPosition = (
  position: DevtoolsPosition,
  axis: 'horizontal' | 'vertical',
): DevtoolsPosition => STEP[position][axis];

const ARROW = 24;
const ARROW_GAP = 4;
const arrowStyle =
  `position:absolute;width:${ARROW}px;height:${ARROW}px;padding:0;border-radius:${ARROW / 2}px;` +
  'border:1px solid #374151;background:#111827;color:#e5e7eb;cursor:pointer;font-size:13px;line-height:1;' +
  'box-shadow:0 2px 6px rgb(0 0 0 / 0.5);';

function Fab(props: {
  position: DevtoolsPosition;
  health: Health;
  onOpen: () => void;
  onMove: (to: DevtoolsPosition) => void;
}) {
  const dot = DOT[props.health];
  const [hover, setHover] = useState(false);
  const [v, h] = props.position.split('-');
  // The arrows point to the free sides: from the bottom-left corner, right and up.
  const toH = stepPosition(props.position, 'horizontal');
  const toV = stepPosition(props.position, 'vertical');
  const arrowH = h === 'left' ? '→' : '←';
  const arrowV = v === 'top' ? '↓' : '↑';
  // Each arrow sits beside the button with a transparent bridge over the gap,
  // so the pointer crossing to it never leaves the hover area.
  const mid = (FAB_SIZE - ARROW) / 2;
  // Offsets from the wrapper's top-left: just past the button on the free side.
  const offH = h === 'left' ? FAB_SIZE + ARROW_GAP : -(ARROW + ARROW_GAP);
  const offV = v === 'top' ? FAB_SIZE + ARROW_GAP : -(ARROW + ARROW_GAP);
  const bridgeH = h === 'left' ? FAB_SIZE : -ARROW_GAP;
  const bridgeV = v === 'top' ? FAB_SIZE : -ARROW_GAP;
  return (
    <>
      {hover ? (
        // The isolate gets no pointerleave, only moves. A layer behind the
        // button and its arrows ends the hover on the first move outside them.
        <div
          data-isoloop-devtools-fab-away=""
          onPointerMove={() => {
            setHover(false);
          }}
          onPointerDown={() => {
            setHover(false);
          }}
          style="position:fixed;inset:0;pointer-events:auto;z-index:0;"
        />
      ) : null}
      <div
        data-isoloop-devtools-fab=""
        onPointerMove={() => {
          if (!hover) setHover(true);
        }}
        style={`${corner(props.position)}pointer-events:auto;z-index:1;width:${FAB_SIZE}px;height:${FAB_SIZE}px;`}
      >
        <button
          type="button"
          data-isoloop-devtools-toggle=""
          data-health={props.health}
          aria-label="Open Isoloop devtools (Alt+Shift+D)"
          title="Isoloop devtools (Alt+Shift+D)"
          onClick={props.onOpen}
          style={`position:absolute;inset:0;display:flex;align-items:center;justify-content:center;border-radius:${FAB_SIZE / 2}px;border:0;background:#111827;box-shadow:0 0 0 1px rgb(255 255 255 / 0.28),0 0 0 4px rgb(0 0 0 / 0.35),0 4px 14px rgb(0 0 0 / 0.7);color:#e5e7eb;cursor:pointer;padding:0;overflow:hidden;${font}`}
        >
          <svg width={FAB_MARK} height={FAB_MARK} viewBox="0 0 100 100" aria-hidden="true">
            <path d={MARK} fill="#fff" fill-rule="evenodd" />
          </svg>
          {dot ? (
            <span
              data-dot={props.health}
              style={`position:absolute;top:${FAB_SIZE / 10}px;right:${FAB_SIZE / 10}px;width:12px;height:12px;border-radius:6px;background:${dot};border:2px solid #111827;`}
            />
          ) : null}
        </button>
        {hover ? (
          <>
            <span
              style={`position:absolute;left:${bridgeH}px;top:${mid}px;width:${ARROW_GAP}px;height:${ARROW}px;`}
            />
            <span
              style={`position:absolute;top:${bridgeV}px;left:${mid}px;width:${ARROW}px;height:${ARROW_GAP}px;`}
            />
            <button
              type="button"
              data-isoloop-devtools-move="horizontal"
              aria-label={`Move the button ${h === 'left' ? 'right' : 'left'}`}
              title={`Move ${h === 'left' ? 'right' : 'left'}`}
              onClick={() => {
                props.onMove(toH);
              }}
              style={`${arrowStyle}top:${mid}px;left:${offH}px;`}
            >
              {arrowH}
            </button>
            <button
              type="button"
              data-isoloop-devtools-move="vertical"
              aria-label={`Move the button ${v === 'top' ? 'down' : 'up'}`}
              title={`Move ${v === 'top' ? 'down' : 'up'}`}
              onClick={() => {
                props.onMove(toV);
              }}
              style={`${arrowStyle}top:${offV}px;left:${mid}px;`}
            >
              {arrowV}
            </button>
          </>
        ) : null}
      </div>
    </>
  );
}

/** A toolbar button: the same 26 px square, its icon centered. */
const tool = (active: boolean): string =>
  `display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;box-sizing:border-box;background:${active ? '#374151' : 'none'};border:0;border-radius:4px;color:inherit;cursor:pointer;padding:0;`;

const Icon = (props: { d: string }) => (
  <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" style="display:block;">
    <path
      d={props.d}
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
);

/** A resize drag from the corner (`both`) or from the inner edge across (`x`) or up and down (`y`). */
type Drag = { x: number; y: number; width: number; height: number; axis: 'both' | 'x' | 'y' };

function Dock(props: {
  ui: UiState;
  snap: InspectSnapshot | undefined;
  onClose: () => void;
  onMode: (mode: PanelMode) => void;
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
    d.axis === 'y' ? d.width : Math.max(MIN_WIDTH, Math.round(d.width + (d.x - x) * sx)),
    d.axis === 'x' ? d.height : Math.max(MIN_HEIGHT, Math.round(d.height + (d.y - y) * sy)),
  ];
  const handleV = v === 'bottom' ? 'top' : 'bottom';
  const handleH = h === 'right' ? 'left' : 'right';
  const cornerCursor = sx === sy ? 'nwse-resize' : 'nesw-resize';
  const cursor = drag?.axis === 'x' ? 'ew-resize' : drag?.axis === 'y' ? 'ns-resize' : cornerCursor;
  const start = (axis: Drag['axis'], e: PointerEvent): void => {
    setDrag({ x: e.clientX, y: e.clientY, width: ui.width, height: ui.height, axis });
  };
  return (
    <div
      data-isoloop-devtools-panel=""
      role="dialog"
      aria-label="Isoloop devtools"
      onKeyDown={(e) => {
        if (e.key === 'Escape') props.onClose();
      }}
      style={`${corner(ui.position, DOCK_GAP)}${fill(ui)}pointer-events:auto;box-sizing:border-box;display:flex;flex-direction:column;border:1px solid #374151;border-radius:8px;background:#111827;color:#e5e7eb;box-shadow:0 4px 16px rgb(0 0 0 / 0.35);overflow:hidden;${font}`}
    >
      <div style="display:flex;align-items:center;gap:4px;padding:6px 12px;border-bottom:1px solid #374151;">
        <strong style="flex:1;">Isoloop devtools</strong>
        <button
          type="button"
          data-isoloop-devtools-stretch=""
          aria-label="Stretch across the window's width"
          aria-pressed={ui.mode === 'wide'}
          title={ui.mode === 'wide' ? 'Restore width' : 'Stretch across the width'}
          onClick={() => {
            props.onMode(ui.mode === 'wide' ? 'normal' : 'wide');
          }}
          style={tool(ui.mode === 'wide')}
        >
          <Icon d="M1.5 7h11M4 4.5 1.5 7 4 9.5M10 4.5 12.5 7 10 9.5" />
        </button>
        <button
          type="button"
          data-isoloop-devtools-maximize=""
          aria-label="Fill the window"
          aria-pressed={ui.mode === 'max'}
          title={ui.mode === 'max' ? 'Restore size' : 'Fill the window'}
          onClick={() => {
            props.onMode(ui.mode === 'max' ? 'normal' : 'max');
          }}
          style={tool(ui.mode === 'max')}
        >
          <Icon d="M2.5 2.5h9v9h-9z" />
        </button>
        <button
          type="button"
          data-isoloop-devtools-toggle=""
          aria-label="Close Isoloop devtools (Alt+Shift+D)"
          title="Close (Alt+Shift+D)"
          onClick={props.onClose}
          style={tool(false)}
        >
          <Icon d="M3 3l8 8M11 3l-8 8" />
        </button>
      </div>
      <div style="flex:1;min-height:0;display:flex;flex-direction:column;">
        <Body snap={props.snap} />
      </div>
      {/* Stretched across the width, the top edge still sets the height. */}
      {ui.mode === 'max' ? null : (
        <div
          data-isoloop-devtools-resize-y=""
          aria-hidden="true"
          onPointerDown={(e) => {
            start('y', e);
          }}
          style={`position:absolute;${handleV}:0;left:0;right:0;height:5px;cursor:ns-resize;`}
        />
      )}
      {ui.mode === 'normal' ? (
        <>
          {/* The inner side edge, which resizes the width... */}
          <div
            data-isoloop-devtools-resize-x=""
            aria-hidden="true"
            onPointerDown={(e) => {
              start('x', e);
            }}
            style={`position:absolute;${handleH}:0;top:0;bottom:0;width:5px;cursor:ew-resize;`}
          />
          {/* ...and the corner between them, both ways. */}
          <div
            data-isoloop-devtools-resize=""
            aria-hidden="true"
            onPointerDown={(e) => {
              start('both', e);
            }}
            style={`position:absolute;${handleV}:0;${handleH}:0;width:14px;height:14px;cursor:${cornerCursor};`}
          />
        </>
      ) : null}
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
      setUi({
        open: false,
        width: 420,
        height: 320,
        position: configPosition(config),
        mode: 'normal',
        ...stored,
      });
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
        onMove={(position) => {
          update({ position });
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
      onMode={(mode) => {
        update({ mode });
      }}
      onResize={(width, height, done) => {
        update({ width, height }, done);
      }}
    />
  );
}

const panel: IsolateDefinition = defineIsolate(Panel);
export default panel;
