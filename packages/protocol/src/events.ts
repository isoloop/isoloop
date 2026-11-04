/** Modifier keys held during an event. */
export type Mods = { alt: boolean; ctrl: boolean; meta: boolean; shift: boolean };

/** Event types the host forwards (design §4.6), plus `resize` for transferred canvases (§4.7). */
export type EventType =
  | 'click'
  | 'dblclick'
  | 'input'
  | 'change'
  | 'keydown'
  | 'keyup'
  | 'submit'
  | 'focusin'
  | 'focusout'
  | 'pointerdown'
  | 'pointerup'
  | 'pointermove'
  | 'resize';

/** A DOM event as it reaches an isolate (design §4.6). Node ids are the isolate's own. */
export type SerializedEvent = {
  type: EventType;
  target: string;
  /** The target and its ancestors that have a listener, innermost first. */
  currentTargets: string[];
  value?: string;
  checked?: boolean;
  key?: string;
  code?: string;
  mods: Mods;
  x?: number;
  y?: number;
  button?: number;
  /** For `resize`. */
  width?: number;
  height?: number;
};
