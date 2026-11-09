/** `@isoloop/dom/worker`: the DOM subset and its recorder (ADR 0011). Internal to `@isoloop/runtime`. */
export {
  ISOLOOP_DOM_FMT,
  ROOT_ID,
  type DomBatch,
  type DomEvent,
  type DomMods,
  type DomRecord,
  type Namespace,
  type NodeId,
  type SerializedNode,
  type SyncedProp,
} from '../shared/records';
export {
  createDom,
  WComment,
  WDocument,
  WDocumentFragment,
  WElement,
  WNode,
  WText,
  type RenderRoot,
  type RootOptions,
  type WorkerDom,
  type WorkerDomOptions,
} from './dom';
export { DOM_GLOBALS, install } from './install';
