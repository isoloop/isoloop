/*
 * The bus view (M4b plan, item 2): the bus's state and restart count, then,
 * from its latest metrics, each topic's rates, head offset and retained
 * count, each subscription's lag (head − cursor) and credit, and the
 * publishes the bus rejected, by error code, since its worker started.
 * The panel's own feed doesn't go through the bus (devtools decision 5), so
 * none of these figures include it.
 */
import type { BusMetrics, InspectBus } from '@isoloop/protocol';
import type { JSX } from 'preact';

const rate = (n: number): string => (n >= 10 ? String(Math.round(n)) : n.toFixed(1));

const bytes = (n: number): string =>
  n >= 1_048_576
    ? `${(n / 1_048_576).toFixed(1)} MB`
    : n >= 1024
      ? `${(n / 1024).toFixed(1)} KB`
      : `${Math.round(n)} B`;

function Topics(props: { metrics: BusMetrics }) {
  const { topics } = props.metrics;
  if (topics.length === 0) return <p class="dt-muted">No topics.</p>;
  return (
    <table class="dt-table" data-view="topics">
      <thead>
        <tr>
          <th>Topic</th>
          <th class="dt-num">Records/s</th>
          <th class="dt-num">Bytes/s</th>
          <th class="dt-num" title="The next offset to be written">
            Head
          </th>
          <th class="dt-num" title="Records the topic still holds">
            Retained
          </th>
        </tr>
      </thead>
      <tbody>
        {topics.map((t) => (
          <tr key={t.topic} data-topic={t.topic}>
            <td>
              <code>{t.topic}</code>
            </td>
            <td class="dt-num">{rate(t.recordsPerSec)}</td>
            <td class="dt-num">{bytes(t.bytesPerSec)}</td>
            <td class="dt-num" data-head={t.head}>
              {t.head}
            </td>
            <td class="dt-num" data-retained={t.retained}>
              {t.retained}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Subscriptions(props: { metrics: BusMetrics }) {
  const { subscriptions } = props.metrics;
  if (subscriptions.length === 0) return <p class="dt-muted">No subscriptions.</p>;
  return (
    <table class="dt-table" data-view="subscriptions">
      <thead>
        <tr>
          <th>Consumer</th>
          <th>Topic</th>
          <th class="dt-num" title="Head minus the consumer's cursor">
            Lag
          </th>
          <th class="dt-num" title="Records that may still be delivered before its next commit">
            Credit
          </th>
        </tr>
      </thead>
      <tbody>
        {subscriptions.map((s) => (
          <tr
            key={`${s.consumer} ${s.topic}`}
            data-consumer={s.consumer}
            data-subscription={s.topic}
          >
            <td>
              <code>{s.consumer}</code>
            </td>
            <td>
              <code>{s.topic}</code>
            </td>
            <td class="dt-num" data-lag={s.lag}>
              {s.lag}
            </td>
            <td class="dt-num" data-credit={s.credit}>
              {s.credit}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Rejected(props: { metrics: BusMetrics }) {
  const entries = Object.entries(props.metrics.rejected).filter(
    (e): e is [string, number] => typeof e[1] === 'number' && e[1] > 0,
  );
  if (entries.length === 0) return <p class="dt-muted">None.</p>;
  return (
    <ul style="margin:0;padding:0;list-style:none;" data-view="rejected">
      {entries.map(([code, n]) => (
        <li key={code} data-rejected={code}>
          <code>{code}</code> {n}
        </li>
      ))}
    </ul>
  );
}

export function BusView(props: { bus: InspectBus }): JSX.Element {
  const { bus } = props;
  const m = bus.metrics;
  return (
    <div class="dt-view" data-view="bus">
      <p class="dt-muted" style="margin:0 0 4px;" data-bus-state={bus.state}>
        Bus <span class={`dt-state-${bus.state}`}>{bus.state}</span> · {bus.restarts} restarts
        {m?.storage ? ` · storage ${bytes(m.storage.usage)} of ${bytes(m.storage.quota)}` : ''}
      </p>
      {m ? (
        <>
          <h3 class="dt-h">Topics</h3>
          <Topics metrics={m} />
          <h3 class="dt-h">Subscriptions</h3>
          <Subscriptions metrics={m} />
          <h3 class="dt-h">Rejected publishes, since the bus worker started</h3>
          <Rejected metrics={m} />
        </>
      ) : (
        <p class="dt-muted">
          {bus.state === 'none'
            ? 'No bus: the kernel has no contracts.'
            : 'Waiting for bus metrics…'}
        </p>
      )}
    </div>
  );
}
