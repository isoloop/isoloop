import type { Kernel } from '@isoloop/host';
import { EventEmitter } from './events';
import { control, dials } from './contracts';

// Receivers that are fields, private or not. A field named `kernel` or
// `bus` is Isoloop's, and one set to `new …(…)` isn't; a receiver it can't
// name is marked, not rewritten.
export class Model {
  #kernel: Kernel;
  #bus: Kernel;
  kernel: Kernel;
  #events = new EventEmitter();

  constructor(kernel: Kernel) {
    this.#kernel = kernel;
    this.#bus = kernel;
    this.kernel = kernel;
  }

  get #k(): Kernel {
    return this.#kernel;
  }

  save(x: number, other: { publish: (...a: unknown[]) => void }): void {
    void this.#kernel.publish(dials, x, { key: 'dials' });
    void this.#bus.publish(dials, x);
    void this.kernel.publish(dials, x);
    // isoloop-migrate: publish takes (topic, value, { key }) since 0.2; check this call by hand
    void this.#k.publish(control, { value: { to: 'a', act: 'crash' } });
    // isoloop-migrate: publish takes (topic, value, { key }) since 0.2; check this call by hand
    void this.#k.publish(control, { value: { value: 1 } });
    void this.#k.publish(control, x);
    // isoloop-migrate: publish takes (topic, value, { key }) since 0.2; check this call by hand
    other.publish(control, { key: 'a', value: x });
    this.#events.publish('tick', { value: x });
    const emitter = new EventEmitter();
    emitter.publish('tick', { value: x });
  }
}
