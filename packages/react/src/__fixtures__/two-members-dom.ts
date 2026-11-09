/*
 * One subset document for two members (ADR 0015, M2d task 2), installed as
 * this fixture worker's `document`. Imported first, before React: React
 * decides at load time whether it has a DOM.
 */
import { servePoolFixture } from '@isoloop/dom/testing/worker';

export const roots: Element[] = servePoolFixture(2);
