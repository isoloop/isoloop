/*
 * The Preact adapter (ADR 0010): `defineIsolate(Component)` and the bus and
 * host hooks, on Preact 10 and 11.
 */
export { defineIsolate, type IsolateProps } from './isolate/define';
export { useIsolate, usePortalRoot } from './isolate/context';
export { usePublish, useTopic, type UseTopicOptions } from './hooks/topic';
export { useWatch, type UseWatchOptions } from './hooks/watch';
export { useRequest } from './hooks/request';
export type { RequestOptions } from '@isoloop/runtime';
export { useHost } from './hooks/host';
export { useRoute } from './hooks/route';
export { BusError, HostCallError, type HostApi, type IsolateContext } from '@isoloop/runtime';
export type { RouteValue } from '@isoloop/protocol';
