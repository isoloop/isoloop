/*
 * The DOM subset, installed as this fixture worker's `document`. Imported
 * first by every fixture worker, before the framework: React decides at load
 * time whether it has a DOM.
 */
import { serveFixture } from '@isoloop/dom/testing/worker';
import type { WorkerDom } from '@isoloop/dom/worker';

const served = serveFixture();
export const dom: WorkerDom = served.dom;
export const container: Element = served.container;
