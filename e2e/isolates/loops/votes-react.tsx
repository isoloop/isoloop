// R · React. Shares vote.v1 with P (Preact): each tallies every vote from the
// log, so a crashed and restarted R shows the same tally again.
import { defineIsolate, useIsolate, usePublish } from '@isoloop/react';
import { useEffect, useState } from 'react';
import { vote } from './topics';

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
    <div className="stack">
      <div className="big tally">{`${tally.preact} : ${tally.react}`}</div>
      <p className="muted">Preact : React votes, rendered by React in its own worker.</p>
      <div className="row">
        <button className="primary vote" onClick={() => void publish('react')}>
          Vote React
        </button>
        <button
          className="crash"
          onClick={() => {
            throw new Error('R threw on purpose');
          }}
        >
          Crash
        </button>
      </div>
    </div>
  );
}

export default defineIsolate(Votes);
