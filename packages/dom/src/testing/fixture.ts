/*
 * The page side of a fixture worker (see `./worker`): applies the worker's
 * batches under a host container through the real applier, and sends the
 * container's events back. The framework smoke tests (M3a task 3) compare
 * what lands there with the same app rendered straight into the DOM.
 */
import { createApplier, type SanitisePolicy } from '../host/applier';
import type { FixtureMessage } from './worker';

/** Lets everything through: the smoke tests compare markup, not policy. */
const OPEN: SanitisePolicy = {
  element: (tag, ns) => ({ tag, ns }),
  attribute: (_tag, _ns, _name, value) => value,
  property: () => true,
};

const EVENTS = ['click', 'input', 'change', 'keydown'];

export type FixtureHost = {
  /** What the worker rendered, under a `<div>` in the document. */
  readonly container: HTMLElement;
  /**
   * Resolves once the worker has rendered and no batch has arrived for
   * `quietMs` (default 30). Rejects if the worker failed, or rendered nothing
   * within 5 s.
   */
  settled(quietMs?: number): Promise<void>;
  /** Terminates the worker and removes the container. */
  dispose(): void;
};

const isMessage = (x: unknown): x is FixtureMessage =>
  typeof x === 'object' && x !== null && typeof Reflect.get(x, 't') === 'string';

export function mountFixture(worker: Worker): FixtureHost {
  const container = document.createElement('div');
  document.body.append(container);
  const applier = createApplier(container, OPEN);
  const started = performance.now();
  let last = -1;
  let failed: Error | null = null;
  worker.addEventListener('message', (e: MessageEvent<unknown>) => {
    if (!isMessage(e.data)) return;
    if (e.data.t === 'batch') {
      applier.apply(e.data.batch);
      last = performance.now();
    } else if (e.data.t === 'error') failed = new Error(`fixture worker threw: ${e.data.error}`);
  });
  worker.addEventListener('error', (e) => {
    e.preventDefault();
    failed = new Error(`fixture worker failed: ${e.message}`);
  });
  for (const type of EVENTS) {
    container.addEventListener(type, (e) => {
      const event = applier.eventFor(e);
      if (event) worker.postMessage({ t: 'event', event });
    });
  }
  return {
    container,
    async settled(quietMs = 30) {
      for (;;) {
        if (failed) throw failed;
        if (last < 0 && performance.now() - started > 5000) {
          throw new Error('fixture worker rendered nothing within 5 s');
        }
        const wait = last < 0 ? quietMs : last + quietMs - performance.now();
        if (wait <= 0) return;
        // oxlint-disable-next-line no-await-in-loop
        await new Promise((r) => setTimeout(r, wait));
      }
    },
    dispose() {
      worker.terminate();
      container.remove();
    },
  };
}

/** Sets a control's value the way typing does: through the prototype's setter, past React's value tracker. */
function setNative(el: HTMLInputElement | HTMLSelectElement, value: string): void {
  const proto =
    el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLSelectElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, value);
}

const one = <T extends Element>(root: Element, selector: string, type: new () => T): T => {
  const el = root.querySelector(selector);
  if (!(el instanceof type)) throw new Error(`smoke: no ${selector} rendered`);
  return el;
};

/**
 * The user actions the smoke tests take on the fixture app (the same ones
 * `driveUsageFixture` sends as events), for a container either way: the
 * fixture host's or a real-DOM render's.
 */
export const SMOKE_STEPS: readonly { name: string; act(root: Element): void }[] = [
  { name: 'toggle', act: (r) => one(r, 'button[name=toggle]', HTMLButtonElement).click() },
  { name: 'reorder', act: (r) => one(r, 'button[name=reorder]', HTMLButtonElement).click() },
  {
    name: 'type',
    act(r) {
      const input = one(r, 'input', HTMLInputElement);
      setNative(input, 'typed');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    },
  },
  {
    name: 'pick',
    act(r) {
      const select = one(r, 'select', HTMLSelectElement);
      setNative(select, 'b');
      select.dispatchEvent(new Event('change', { bubbles: true }));
    },
  },
  { name: 'toggle back', act: (r) => one(r, 'button[name=toggle]', HTMLButtonElement).click() },
];

/** What the smoke tests compare: the markup, and the controls' live values. */
export function snapshot(root: Element): { html: string; input: string; select: string } {
  return {
    html: root.innerHTML,
    input: one(root, 'input', HTMLInputElement).value,
    select: one(root, 'select', HTMLSelectElement).value,
  };
}
