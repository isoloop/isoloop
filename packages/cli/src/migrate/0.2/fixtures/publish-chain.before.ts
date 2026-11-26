import type { Kernel } from '@isoloop/host';
import { budget, specs } from './contracts';

// A member chain the formatter broke because the record made it too long:
// shorter now, it goes back on one line.
export class Budget {
  #kernel: Kernel;

  constructor(kernel: Kernel) {
    this.#kernel = kernel;
  }

  used(id: string): number {
    return id.length;
  }

  tell(id: string): void {
    void this.#kernel
      .publish(budget, { key: id, value: { used: this.used(id) } })
      .catch(() => undefined);
  }

  flush = (): Promise<void> =>
    this.#kernel
      .publish(specs, { key: '$sync', value: { sync: 'flushed', at: Date.now() } })
      .then(() => {});
}
