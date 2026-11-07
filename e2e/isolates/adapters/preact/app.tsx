/*
 * The adapter conformance fixture for Preact (M3a task 13), built once per
 * major by e2e/build-adapters.ts. Same behaviour as ../react/app.tsx:
 *
 * - `.count` is the last value on `notes.v1`, read from `earliest`, so a
 *   restarted isolate replays it; `.inc` publishes the next one.
 * - `.field` is a controlled input; `.echo` shows it upper-cased.
 * - `.crash` throws from a handler; `.go` navigates to `/next`; `.path` shows the route.
 */
import { defineIsolate, useHost, usePublish, useRoute, useTopic } from '@isoloop/preact';
import type { TopicRef } from '@isoloop/protocol';
import { useRef, useState } from 'preact/hooks';
import pkg from 'preact/package.json';

const notes: TopicRef<string> = { name: 'notes.v1', schema: { '~standard': {} } };

function App() {
  const last = useTopic(notes, { from: 'earliest' });
  const publish = usePublish(notes);
  const route = useRoute();
  const host = useHost();
  const [text, setText] = useState('');
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
      <p class="fw">{`preact ${pkg.version}`}</p>
      <p class="count">{count}</p>
      <button class="inc" onClick={inc}>
        +1
      </button>
      <input class="field" value={text} onInput={(e) => setText(e.currentTarget.value)} />
      <p class="echo">{text.toUpperCase()}</p>
      <button
        class="crash"
        onClick={() => {
          throw new Error('adapter fixture crash');
        }}
      >
        crash
      </button>
      <button class="go" onClick={() => void host.navigate('/next')}>
        go
      </button>
      <p class="path">{route?.path ?? '…'}</p>
    </div>
  );
}

export default defineIsolate(App);
