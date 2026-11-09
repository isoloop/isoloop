/*
 * The worker's one isoloop-dom document (ADR 0015, option D), installed
 * before React loads: React decides at load time whether it has a DOM.
 * Batches go to the page as they're produced.
 */
import { createDom } from '../../../packages/dom/src/worker/dom.ts';
import { install } from '../../../packages/dom/src/worker/install.ts';

export const dom = createDom({ onBatch: (batch) => self.postMessage({ t: 'batch', batch }) });
install(dom, self);
