/*
 * The DOM usage fixture for React (M3a task 2): renders into the subset with
 * every member access logged, drives it through host events, and posts the
 * log. What it renders is what the adapters will meet; React 19 also hoists
 * a `<title>`.
 */
import { driveUsageFixture, reportUsage, trackUsage } from '@isoloop/dom/testing/usage';
import { createDom, install } from '@isoloop/dom/worker';
import { useState, version } from 'react';
import { createRoot } from 'react-dom/client';

const tracker = trackUsage();
const dom = createDom({ onBatch: () => {} });
install(dom, self);
// `install()` made the subset's classes the worker's: the root is an `Element` now.
const container = dom.root;
if (!(container instanceof Element)) throw new Error('the subset is not installed');
const hoists = Number(version.split('.')[0]) >= 19;

const reversed = (xs: string[]): string[] => {
  const out = [...xs];
  out.reverse();
  return out;
};

function App() {
  const [items, setItems] = useState(['a', 'b', 'c', 'd']);
  const [text, setText] = useState('');
  const [pick, setPick] = useState('a');
  const [shown, setShown] = useState(true);
  return (
    <div className="app" style={{ color: shown ? 'red' : 'blue' }}>
      {hoists ? <title>{`usage ${text}`}</title> : null}
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
      <input value={text} onChange={(e) => setText(e.currentTarget.value)} />
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

const settle = () => new Promise<void>((r) => setTimeout(r, 10));
await reportUsage(tracker, `react@${version}`, async () => {
  const root = createRoot(container);
  root.render(<App />);
  await driveUsageFixture(dom, settle);
  root.unmount();
});
