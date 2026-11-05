/*
 * EventBridge (design §4.6): one delegated listener per event type on each
 * surface's shadow root. A DOM event reaches the isolate only if it
 * registered a listener for that type on the target or an ancestor (the
 * render bridge decides, through `toEvent`). Default actions:
 *
 * - `submit` is always prevented on the host: an isolate can't call
 *   preventDefault in time, and a submit would navigate the whole page.
 * - Links keep the browser's behaviour until routing (ADR 0002, M2 task 10)
 *   takes over same-origin clicks.
 *
 * Pointer moves are forwarded only to registered listeners and coalesced to
 * one per animation frame.
 */
import type { EventType, SerializedEvent } from '@isoloop/protocol';

/** Event types forwarded as they happen (design §4.6). */
export const FORWARDED_EVENTS: readonly EventType[] = [
  'click',
  'dblclick',
  'input',
  'change',
  'keydown',
  'keyup',
  'submit',
  'focusin',
  'focusout',
  'pointerdown',
  'pointerup',
];

export type EventBridgeOptions = {
  /** The serialized event for a DOM event, or `null` if no isolate listener wants it. */
  toEvent: (e: Event, type: EventType) => SerializedEvent | null;
  send: (e: SerializedEvent) => void;
  /** For tests: the frame scheduler for coalesced pointer moves. */
  requestFrame?: (fn: () => void) => void;
};

/** Wires the listeners on `root`; aborting `signal` removes them all. */
export function listenEvents(
  root: ShadowRoot,
  opts: EventBridgeOptions,
  signal: AbortSignal,
): void {
  const { toEvent, send } = opts;
  const requestFrame =
    opts.requestFrame ??
    ((fn: () => void) => {
      requestAnimationFrame(fn);
    });

  for (const type of FORWARDED_EVENTS) {
    root.addEventListener(
      type,
      (e) => {
        if (type === 'submit') e.preventDefault();
        const event = toEvent(e, type);
        if (event) send(event);
      },
      { signal },
    );
  }

  let pendingMove: SerializedEvent | null = null;
  root.addEventListener(
    'pointermove',
    (e) => {
      const event = toEvent(e, 'pointermove');
      if (!event) return;
      const first = pendingMove === null;
      pendingMove = event;
      if (!first) return;
      requestFrame(() => {
        const move = pendingMove;
        pendingMove = null;
        if (move && !signal.aborted) send(move);
      });
    },
    { signal },
  );
}
