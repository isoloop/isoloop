/*
 * The browser features Isoloop relies on (ADR 0009 rule 7), checked once in
 * `createKernel` so an old browser fails with one clear error up front
 * instead of somewhere deep in a worker. Synchronous and side-effect free:
 * no worker is started, nothing is written to storage.
 */

export type Feature =
  /** `new Worker(url, { type: 'module' })`: Chrome 80, Firefox 114, Safari 15. */
  | 'module-workers'
  /** `MessageChannel`, with ports transferable through `postMessage`. */
  | 'message-channel'
  /** Constructable `CSSStyleSheet` adopted by a `ShadowRoot`: Chrome 73, Firefox 101, Safari 16.4. */
  | 'adopted-stylesheets'
  /**
   * The origin private file system: Chrome 86, Firefox 111, Safari 15.2. Its
   * sync access handles only exist inside workers, so the main thread checks
   * for OPFS itself; the bus worker uses the handles from M2b.
   */
  | 'opfs';

const has = (o: unknown, key: string): boolean => typeof o === 'object' && o !== null && key in o;

function moduleWorkers(): boolean {
  if (typeof Worker !== 'function') return false;
  // WebIDL reads the options dictionary before the URL is parsed, so an
  // engine that knows `type` reads it, and the bad URL then throws before any
  // worker exists. An engine without module workers never asks.
  let asked = false;
  const options = {
    get type(): 'module' {
      asked = true;
      return 'module';
    },
  };
  try {
    // oxlint-disable-next-line no-new -- constructed for the side effect of reading options
    new Worker('http://[', options);
  } catch {
    // Expected: the URL is invalid on purpose.
  }
  return asked;
}

const ORDER: readonly Feature[] = [
  'module-workers',
  'message-channel',
  'adopted-stylesheets',
  'opfs',
];

const CHECKS: Record<Feature, () => boolean> = {
  'module-workers': moduleWorkers,
  'message-channel': () =>
    typeof MessageChannel === 'function' && typeof MessagePort === 'function',
  'adopted-stylesheets': () => {
    if (typeof ShadowRoot !== 'function' || !has(ShadowRoot.prototype, 'adoptedStyleSheets'))
      return false;
    try {
      return typeof new CSSStyleSheet().replaceSync === 'function';
    } catch {
      return false;
    }
  },
  opfs: () =>
    typeof navigator === 'object' &&
    has(navigator, 'storage') &&
    typeof navigator.storage.getDirectory === 'function',
};

/** The features this browser lacks, in a fixed order. Empty means supported. */
export function missingFeatures(): Feature[] {
  return ORDER.filter((f) => !CHECKS[f]());
}
