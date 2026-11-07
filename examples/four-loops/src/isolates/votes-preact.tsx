/** @jsxImportSource preact */
// P · Preact. Shares vote.v1 with R (React): each tallies every vote from the
// log, so a crashed and restarted P shows the same tally again.
import { defineIsolate, useIsolate, usePublish } from '@isoloop/preact';
import { useEffect, useState } from 'preact/hooks';
import { vote } from '../topics';

function Votes() {
  const { bus } = useIsolate();
  const publish = usePublish(vote);
  const [tally, setTally] = useState({ preact: 0, react: 0 });
  useEffect(
    () =>
      bus.subscribe(vote, (r) => setTally((t) => ({ ...t, [r.value]: t[r.value] + 1 })), {
        from: 'earliest',
        onReset: () => setTally({ preact: 0, react: 0 }),
      }),
    [bus],
  );
  return (
    <div class="stack">
      <div class="big tally">{`${tally.preact} : ${tally.react}`}</div>
      <p class="muted">Preact : React votes, rendered by Preact in its own worker.</p>
      <div class="row">
        <button class="primary vote" onClick={() => void publish('preact')}>
          Vote Preact
        </button>
        <button
          class="crash"
          onClick={() => {
            throw new Error('P threw on purpose');
          }}
        >
          Crash
        </button>
      </div>
    </div>
  );
}

export default defineIsolate(Votes);
