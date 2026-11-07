/*
 * The Preact adapter (ADR 0010): `defineIsolate(Component)` and the bus and
 * host hooks, on Preact 10 and 11.
 */
export { defineIsolate, type IsolateProps } from './define';
export { useIsolate } from './context';
export { usePublish, useTopic, type UseTopicOptions } from './hooks/topic';
export type { IsolateContext } from '@isoloop/runtime';
