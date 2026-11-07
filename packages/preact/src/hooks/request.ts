/* `useRequest` (design §6.3): request/reply over a topic with a `reply` schema. */
import type { TopicRef } from '@isoloop/protocol';
import { useCallback } from 'preact/hooks';
import { useIsolate } from '../context';

export type RequestOptions = { key?: string; timeoutMs?: number };

/**
 * A function that sends a request on `topic` and resolves with the reply.
 * It rejects with a `BusError`, `timeout` after `timeoutMs` (default 30 s).
 */
export function useRequest<In, ROut>(
  topic: TopicRef<In, any, any, ROut>,
): (value: In, opts?: RequestOptions) => Promise<ROut> {
  const { bus } = useIsolate();
  return useCallback(
    (value: In, o?: RequestOptions) => bus.request(topic, value, o),
    [bus, topic.name],
  );
}
