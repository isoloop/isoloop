import type { IsolateManifest, Kernel } from '@isoloop/host';
import { expect, it } from 'vitest';
import { createBalancer } from './balancer';
import type { KernelLike } from './types';

// Type-level: the host's kernel fits the balancer as is, so apps pass it
// straight in. `tsc` checks this file; the test only keeps it in the suite.
const fits = (k: Kernel): KernelLike<IsolateManifest> => k;
const accepts = (k: Kernel) => createBalancer(k).spawn({ id: 'w', src: '/w.js' });

it('takes the host kernel as is', () => {
  expect(typeof fits).toBe('function');
  expect(typeof accepts).toBe('function');
});
