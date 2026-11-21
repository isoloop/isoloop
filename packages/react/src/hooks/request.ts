/* `useRequest` (design §6.3): request/reply over a topic with a `reply` schema. */
import type { TopicRef } from '@isoloop/protocol';
import type { RequestOptions } from '@isoloop/runtime';
import { useCallback } from 'react';
import { useIsolate } from '../isolate/context';

/**
 * A function that sends a request on `topic` and resolves with the first valid reply.
 * The function is stable while `topic` is the same.
 *
 * @param topic - A topic with a `reply` schema.
 * @returns `(value, opts?) => Promise<reply>`. `opts` takes `key` and `timeoutMs`
 *   (default 30 s). The promise rejects with a `BusError`: `timeout` when no reply came
 *   in time, `dropped` when retention removed the request before any subscriber got it,
 *   `reply_invalid` when the reply failed the `reply` schema, `not_requestable` on a
 *   topic without one, and the publish codes (`forbidden`, `invalid`, `too_large`,
 *   `unknown_topic`, `bus_unavailable`) for the request itself.
 * @experimental
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
