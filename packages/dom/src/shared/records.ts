/*
 * The isoloop-dom@1 format (ADR 0010 point 3, ADR 0011 point 4): what the
 * worker half records and the host half applies. Plain tuples and objects,
 * so a batch survives structuredClone unchanged. A breaking change here bumps
 * the fmt to isoloop-dom@2.
 */

export const ISOLOOP_DOM_FMT = 'isoloop-dom@1';

/** A node id. The worker assigns them at creation; the root is always 0. */
export type NodeId = number;
export const ROOT_ID: NodeId = 0;

export type Namespace = 'html' | 'svg';

/** Element properties that are synced as properties, not attributes. */
export type SyncedProp = 'value' | 'checked' | 'selected';
export const SYNCED_PROPS: readonly SyncedProp[] = ['value', 'checked', 'selected'];

/** A new subtree, as `insert` carries it. */
export type SerializedNode =
  | {
      k: 'el';
      id: NodeId;
      tag: string;
      ns: Namespace;
      attrs: [name: string, value: string][];
      props: [name: SyncedProp, value: string | boolean][];
      /** Event types with at least one listener on this node. */
      listen: string[];
      children: SerializedNode[];
    }
  | { k: 'text'; id: NodeId; data: string }
  /** A comment (ADR 0010 amendment, M3a): inert on the host. */
  | { k: 'comment'; id: NodeId; data: string };

export type DomRecord =
  /** A new subtree under `parent`, before `before` or at the end. */
  | ['insert', parent: NodeId, node: SerializedNode, before: NodeId | null]
  /** An existing node moves; it keeps its identity on the host. */
  | ['move', parent: NodeId, node: NodeId, before: NodeId | null]
  /** A node and its subtree leave the tree. */
  | ['remove', node: NodeId]
  /** New data for a text or comment node. */
  | ['text', node: NodeId, data: string]
  /** `null` removes the attribute. */
  | ['attr', node: NodeId, name: string, value: string | null]
  /**
   * `force` (ADR 0010 amendment, M3a): apply even to a host-owned input the
   * user is focused on, e.g. to clear a chat box after sending.
   */
  | ['prop', node: NodeId, name: SyncedProp, value: string | boolean, force?: true]
  /** The first listener of `type` was added (`true`) or the last removed (`false`). */
  | ['listen', node: NodeId, type: string, on: boolean];

/** One atomic UI change: every record since the last flush, in order. */
export type DomBatch = DomRecord[];

/** Modifier keys, as an event record carries them. */
export type DomMods = { alt: boolean; ctrl: boolean; meta: boolean; shift: boolean };

/** A DOM event as the host sends it to the worker half (design §4.6). */
export type DomEvent = {
  type: string;
  target: NodeId;
  /** The target and its ancestors that listen for `type`, innermost first. */
  currentTargets: NodeId[];
  value?: string;
  checked?: boolean;
  key?: string;
  code?: string;
  mods: DomMods;
  x?: number;
  y?: number;
  button?: number;
  /** For `resize` on a transferred canvas: its new CSS size (design §4.7). */
  width?: number;
  height?: number;
  /** For `scroll`: the scrolled element's offsets, mirrored on the worker node. */
  scrollTop?: number;
  scrollLeft?: number;
};

const isSyncedProp = (x: unknown): x is SyncedProp =>
  x === 'value' || x === 'checked' || x === 'selected';
const field = (x: object, k: string): unknown => Reflect.get(x, k);
const isId = (x: unknown): x is NodeId => typeof x === 'number' && Number.isInteger(x) && x >= 0;
const isStr = (x: unknown): x is string => typeof x === 'string';
const isIdOrNull = (x: unknown): boolean => x === null || isId(x);
const isPair = (x: unknown, value: (v: unknown) => boolean): boolean =>
  Array.isArray(x) && x.length === 2 && isStr(x[0]) && value(x[1]);

function isSerializedNode(x: unknown, depth: number): x is SerializedNode {
  if (depth > 512 || typeof x !== 'object' || x === null) return false;
  const k = field(x, 'k');
  if (k === 'text' || k === 'comment') return isId(field(x, 'id')) && isStr(field(x, 'data'));
  if (k !== 'el') return false;
  const [id, tag, ns, attrs, props, listen, children] = [
    'id',
    'tag',
    'ns',
    'attrs',
    'props',
    'listen',
    'children',
  ].map((f) => field(x, f));
  return (
    isId(id) &&
    isStr(tag) &&
    (ns === 'html' || ns === 'svg') &&
    Array.isArray(attrs) &&
    attrs.every((a) => isPair(a, isStr)) &&
    Array.isArray(props) &&
    props.every(
      (p: unknown) =>
        isPair(p, (v) => isStr(v) || typeof v === 'boolean') &&
        Array.isArray(p) &&
        isSyncedProp(p[0]),
    ) &&
    Array.isArray(listen) &&
    listen.every(isStr) &&
    Array.isArray(children) &&
    children.every((c) => isSerializedNode(c, depth + 1))
  );
}

function isRecord(x: unknown): x is DomRecord {
  if (!Array.isArray(x)) return false;
  const [k, a, b, c] = x as unknown[];
  switch (k) {
    case 'insert':
      return x.length === 4 && isId(a) && isSerializedNode(b, 0) && isIdOrNull(c);
    case 'move':
      return x.length === 4 && isId(a) && isId(b) && isIdOrNull(c);
    case 'remove':
      return x.length === 2 && isId(a);
    case 'text':
      return x.length === 3 && isId(a) && isStr(b);
    case 'attr':
      return x.length === 4 && isId(a) && isStr(b) && (c === null || isStr(c));
    case 'prop':
      return (
        (x.length === 4 || (x.length === 5 && x[4] === true)) &&
        isId(a) &&
        isSyncedProp(b) &&
        (isStr(c) || typeof c === 'boolean')
      );
    case 'listen':
      return x.length === 4 && isId(a) && isStr(b) && typeof c === 'boolean';
    default:
      return false;
  }
}

/** The batch comes from an isolate, so its shape is checked before anything touches the DOM. */
export function isDomBatch(x: unknown): x is DomBatch {
  return Array.isArray(x) && x.every(isRecord);
}
