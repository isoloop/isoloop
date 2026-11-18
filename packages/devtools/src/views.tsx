/*
 * What the open panel shows. For now a summary of the feed: the isolates
 * with their states, and the bus's state. The isolates, bus and log views
 * follow (M4b tasks 8–10).
 */
import type { InspectSnapshot } from '@isoloop/protocol';

export function Body(props: { snap: InspectSnapshot | undefined }) {
  const { snap } = props;
  if (!snap) return <p style="margin:8px;color:#9ca3af;">Waiting for the inspection feed…</p>;
  return (
    <div style="padding:8px;">
      <p data-isoloop-devtools-summary="" style="margin:0 0 6px;color:#9ca3af;">
        {snap.isolates.length} isolates · bus {snap.bus.state}
      </p>
      <ul style="margin:0;padding:0;list-style:none;">
        {snap.isolates.map((i) => (
          <li key={i.id} data-isolate={i.id} data-state={i.state}>
            <code>{i.id}</code> {i.state}
          </li>
        ))}
      </ul>
    </div>
  );
}
