/** `@isoloop/dom/testing`: the bridge conformance suite (ADR 0011). Needs Vitest. */
export {
  CASES,
  runBridgeConformance,
  type BridgePair,
  type CaseName,
  type ConformanceEvent,
  type ConformanceHost,
  type Handle,
  type IsolateDriver,
  type MakeBridgePair,
  type NodeIds,
} from './conformance';
export { createIsoloopDomDriver } from './driver';
export { checkDomUsage, TOLERATED_MISSING } from './check-usage';
export { mountFixture, mountMembers, SMOKE_STEPS, snapshot, type FixtureHost } from './fixture';
export type { FixtureMessage, UsageLog } from './worker';
