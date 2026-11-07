/*
 * The adapter conformance fixture for React (M3a task 13), built once per
 * major by e2e/build-adapters.ts. Same behaviour as ../preact/app.tsx.
 */
import type { TopicRef } from '@isoloop/protocol';
import { defineIsolate, useHost, usePublish, useRoute, useTopic } from '@isoloop/react';
import { useState, version } from 'react';

const notes: TopicRef<string> = { name: 'notes.v1', schema: { '~standard': {} } };

function App() {
  const last = useTopic(notes, { from: 'earliest' });
  const publish = usePublish(notes);
  const route = useRoute();
  const host = useHost();
  const [text, setText] = useState('');
  const count = Number(last ?? '0');
  return (
    <div>
      <p className="fw">{`react ${version}`}</p>
      <p className="count">{count}</p>
      <button className="inc" onClick={() => void publish(String(count + 1))}>
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
