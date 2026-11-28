// Event symbols (ADR 0026, amended 2026-11-28): every event type a rule's history
// can hold, in five families. A family is a colour (the semantic
// --ar-event-<family> token, set by each theme); within a family, the shape and
// whether it's filled tell the types apart, so colour is never the only cue.
(function (AR) {
  const { html, attrs } = AR;

  /** Each event type: its family, its shape and whether the shape is filled. */
  const TYPES = {
    proposed: { family: 'decision', shape: 'circle', filled: false, label: 'Proposed' },
    decided: { family: 'decision', shape: 'circle', filled: true, label: 'Decided' },
    clarified: { family: 'change', shape: 'diamond', filled: false, label: 'Clarified' },
    amended: { family: 'change', shape: 'diamond', filled: true, label: 'Amended' },
    built: { family: 'delivery', shape: 'square', filled: false, label: 'Built' },
    shipped: { family: 'delivery', shape: 'square', filled: true, label: 'Shipped' },
    withdrawn: { family: 'ending', shape: 'triangle', filled: false, label: 'Withdrawn' },
    superseded: { family: 'ending', shape: 'triangle', filled: true, label: 'Superseded' },
    rejected: { family: 'ending', shape: 'cross', filled: true, label: 'Rejected' },
    removed: { family: 'ending', shape: 'plus', filled: true, label: 'Removed' },
    reopened: { family: 'correction', shape: 'circle', filled: false, label: 'Reopened' },
    corrected: { family: 'correction', shape: 'diamond', filled: true, label: 'Corrected' },
  };
  const ORDER = Object.keys(TYPES);
  const FAMILIES = ['decision', 'change', 'delivery', 'ending', 'correction'];
  const UNKNOWN = { family: 'decision', shape: 'circle', filled: false, label: 'Event' };
  const typeOf = (t) => TYPES[t] || { ...UNKNOWN, label: String(t) };

  const n = (v) => Number(v.toFixed(2));

  /**
   * One shape centred on (cx, cy), `size` across: circle, square, diamond,
   * triangle, cross or plus, filled or outlined. Its colour comes from the
   * family on it or on an ancestor (data-family), never from a literal.
   */
  function symbol({ shape, cx, cy, size, filled = true, family, attrs: a }) {
    const h = size / 2;
    const at = attrs({ 'data-family': family, 'data-filled': String(filled), ...a });
    switch (shape) {
      case 'square':
        return html`<rect
          class="ar-symbol"
          x="${n(cx - h)}"
          y="${n(cy - h)}"
          width="${n(size)}"
          height="${n(size)}"
          ${at}
        ></rect>`;
      case 'diamond':
        return html`<path
          class="ar-symbol"
          d="M${n(cx)} ${n(cy - h)}L${n(cx + h)} ${n(cy)}L${n(cx)} ${n(cy + h)}L${n(cx - h)} ${n(cy)}Z"
          ${at}
        ></path>`;
      case 'triangle':
        return html`<path
          class="ar-symbol"
          d="M${n(cx)} ${n(cy - h)}L${n(cx + h)} ${n(cy + h * 0.85)}L${n(cx - h)} ${n(cy + h * 0.85)}Z"
          ${at}
        ></path>`;
      case 'cross':
        return html`<path
          class="ar-symbol"
          data-line
          d="M${n(cx - h)} ${n(cy - h)}L${n(cx + h)} ${n(cy + h)}M${n(cx + h)} ${n(cy - h)}L${n(cx - h)} ${n(cy + h)}"
          ${at}
        ></path>`;
      case 'plus':
        return html`<path
          class="ar-symbol"
          data-line
          d="M${n(cx)} ${n(cy - h)}L${n(cx)} ${n(cy + h)}M${n(cx - h)} ${n(cy)}L${n(cx + h)} ${n(cy)}"
          ${at}
        ></path>`;
      default:
        return html`<circle
          class="ar-symbol"
          cx="${n(cx)}"
          cy="${n(cy)}"
          r="${n(h)}"
          ${at}
        ></circle>`;
    }
  }

  /** The symbol for an event type, centred on (cx, cy). */
  const eventSymbol = ({ type, cx, cy, size, attrs: a }) => {
    const t = typeOf(type);
    return symbol({ shape: t.shape, filled: t.filled, family: t.family, cx, cy, size, attrs: a });
  };

  /** A small standalone <svg> holding one event type's symbol, for chips and legends. */
  const EventIcon = ({ type }) =>
    html`<svg class="ar-symbol-icon" viewBox="-6 -6 12 12" aria-hidden="true">
      ${eventSymbol({ type, cx: 0, cy: 0, size: 8 })}
    </svg>`;

  AR.events = { TYPES, ORDER, FAMILIES, typeOf, symbol, eventSymbol };
  AR.EventIcon = EventIcon;
})((globalThis.AR ??= {}));
