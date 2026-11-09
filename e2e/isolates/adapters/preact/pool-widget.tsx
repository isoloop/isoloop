/*
 * A visual pool member for the visual pools suite (M2d task 6), built by
 * e2e/build-adapters.ts. Same behaviour as ../react/pool-widget.tsx. It shows
 * the latest `feed.v1` value and reports `{ id, instance, seen, fw }` on
 * `pooled.v1` when it starts and on every value, so the test can tell which
 * members restarted. `config.fault`: `hang` loops forever, `kill` throws from
 * a timer, `throw` throws while rendering, each 600 ms after it starts.
 */
import type { TopicRef } from '@isoloop/protocol';
import { defineIsolate, useIsolate, usePublish, useTopic } from '@isoloop/preact';
import { useEffect, useState } from 'preact/hooks';

const feed: TopicRef<number> = { name: 'feed.v1', schema: { '~standard': {} } };
const pooled: TopicRef = { name: 'pooled.v1', schema: { '~standard': {} } };

const faultOf = (config: unknown): unknown =>
  typeof config === 'object' && config !== null ? Reflect.get(config, 'fault') : undefined;

function Widget({ config }: { config: unknown }) {
  const { id } = useIsolate();
  const value = useTopic(feed, { from: 'earliest' });
  const publish = usePublish(pooled);
  // Per member: members of a pool share this module.
  const [instance] = useState(() => Math.random().toString(36).slice(2));
  const [seen, setSeen] = useState<number[]>([]);
  const [boom, setBoom] = useState(false);
  useEffect(() => {
    if (value !== undefined) setSeen((s) => [...s, value]);
  }, [value]);
  useEffect(() => {
    void publish({ id, instance, seen, fw: 'preact' }).catch(() => {});
  }, [id, instance, seen, publish]);
  useEffect(() => {
    const fault = faultOf(config);
    const t = setTimeout(() => {
      if (fault === 'hang')
        for (;;) {
          // Never returns.
        }
      if (fault === 'kill') throw new Error(`${id} throws from a timer`);
      if (fault === 'throw') setBoom(true);
    }, 600);
    return () => clearTimeout(t);
  }, [config, id]);
  if (boom) throw new Error(`${id} throws while rendering`);
  return <p class="v">{value ?? '-'}</p>;
}

export default defineIsolate(Widget);
