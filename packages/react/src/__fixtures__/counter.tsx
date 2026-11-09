import { useState, type ReactElement } from 'react';

/** A labelled counter: enough to see each member render and handle its own clicks. */
export function Counter({ label }: { label: string }): ReactElement {
  const [n, setN] = useState(0);
  return (
    <button type="button" onClick={() => setN((x) => x + 1)}>
      {label}:{n}
    </button>
  );
}
