/*
 * The adapter conformance fixture for React (M3a task 13), built once per
 * major by e2e/build-adapters.ts. Same behaviour as ../preact/app.tsx.
 */
import type { TopicRef } from '@isoloop/protocol';
import { defineIsolate, useHost, usePublish, useRoute, useTopic, useWatch } from '@isoloop/react';
import { useRef, useState, version } from 'react';

const notes: TopicRef<string> = { name: 'notes.v1', schema: { '~standard': {} } };

// A second reader of the same topic (#410): both update, and `.unmirror`
// unmounts it while `.count` keeps updating.
function Mirror() {
  const last = useTopic(notes, { from: 'earliest' });
  return <p className="mirror">{last ?? '0'}</p>;
}

// Watchers (M8 Watchers W1): two components watch `notes.v1`, one for the
// records with no key and one for every key; `.key-a` watches key `a`, which
// only `.mark` publishes to.
function Watched() {
  const none = useWatch(notes, { key: null });
  const a = useWatch(notes, { key: 'a' });
  return (
    <>
      <p className="watched">{none ?? 'none'}</p>
      <p className="key-a">{a ?? 'none'}</p>
    </>
  );
}

function WatchedAll() {
  const view = useWatch(notes);
  return <p className="watched-all">{[...view].map(([k, v]) => `${k ?? '-'}=${v}`).join(',')}</p>;
}

function App() {
  const last = useTopic(notes, { from: 'earliest' });
  const publish = usePublish(notes);
  const route = useRoute();
  const host = useHost();
  const [text, setText] = useState('');
  const [mirror, setMirror] = useState(true);
  const count = Number(last ?? '0');
  // The next value counts from what this isolate already sent, not only from
  // what it has rendered: two clicks before the first record comes back from
  // the bus would otherwise both publish count + 1.
  const sent = useRef(0);
  const inc = () => {
    sent.current = Math.max(sent.current, count) + 1;
    void publish(String(sent.current));
  };
  return (
    <div>
      <p className="fw">{`react ${version}`}</p>
      <p className="count">{count}</p>
      {mirror ? <Mirror /> : null}
      <button className="unmirror" onClick={() => setMirror(false)}>
        unmirror
      </button>
      <Watched />
      <WatchedAll />
      <button className="mark" onClick={() => void publish(String(count), { key: 'a' })}>
        mark
      </button>
      <button className="inc" onClick={inc}>
        +1
      </button>
      <input className="field" value={text} onChange={(e) => setText(e.currentTarget.value)} />
      <p className="echo">{text.toUpperCase()}</p>
      <button
        className="crash"
        onClick={() => {
          throw new Error('adapter fixture crash');
        }}
      >
        crash
      </button>
      <button className="go" onClick={() => void host.navigate('/next')}>
        go
      </button>
      <p className="path">{route?.path ?? '…'}</p>
    </div>
  );
}

export default defineIsolate(App);
