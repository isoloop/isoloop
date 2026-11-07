/*
 * The app the usage and smoke fixtures render (M3a tasks 2 and 3): a keyed
 * list that reorders, a controlled input, a `select`, SVG, a conditional
 * child and a fragment. The
 * buttons, input and select are what `driveUsageFixture` and the smoke tests
 * act on.
 */
import type { JSX } from 'preact';
import { useState } from 'preact/hooks';

const reversed = (xs: string[]): string[] => {
  const out = [...xs];
  out.reverse();
  return out;
};

export function App(): JSX.Element {
  const [items, setItems] = useState(['a', 'b', 'c', 'd']);
  const [text, setText] = useState('');
  const [pick, setPick] = useState('a');
  const [shown, setShown] = useState(true);
  return (
    <div class="app" style={{ color: shown ? 'red' : 'blue' }}>
      <button name="toggle" onClick={() => setShown((s) => !s)}>
        toggle
      </button>
      <button name="reorder" onClick={() => setItems(reversed)}>
        reorder
      </button>
      <ul>
        {items.map((i) => (
          <li key={i} data-key={i}>
            {i}
          </li>
        ))}
      </ul>
      <input value={text} onInput={(e) => setText(e.currentTarget.value)} />
      <select value={pick} onChange={(e) => setPick(e.currentTarget.value)}>
        <option value="a">A</option>
        <option value="b">B</option>
      </select>
      <svg viewBox="0 0 10 10">
        <circle cx="5" cy="5" r={shown ? 4 : 2} />
      </svg>
      {shown ? <p>shown</p> : null}
      <>
        <span>one</span>
        <span>{text}</span>
      </>
    </div>
  );
}
