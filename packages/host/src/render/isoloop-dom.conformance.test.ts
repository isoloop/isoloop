import { createIsoloopDomDriver, runBridgeConformance } from '@isoloop/dom/testing';
import { createIsoloopDomBridge } from './isoloop-dom';
import { createRegistry } from './registry';

// The real bridge: the registry from task 6 as its policy, host-owned input
// rules on top. No known gaps (M1 task 5).
runBridgeConformance('isoloop-dom', () => ({
  host: createIsoloopDomBridge(createRegistry()),
  isolate: createIsoloopDomDriver(),
}));
