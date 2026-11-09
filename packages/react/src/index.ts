/*
 * The React adapter (ADR 0010): `defineIsolate(Component)` and the bus and
 * host hooks, on React 18 and 19.
 */
export { defineIsolate, type IsolateProps } from './define';
export { useIsolate, usePortalRoot } from './context';
export { usePublish, useTopic, type UseTopicOptions } from './hooks/topic';
export { useRequest, type RequestOptions } from './hooks/request';
export { useHost } from './hooks/host';
export { useRoute } from './hooks/route';
export { BusError, HostCallError, type HostApi, type IsolateContext } from '@isoloop/runtime';
export type { RouteValue } from '@isoloop/protocol';
