/*
 * A controlled checkbox whose state comes back later, as it does from a
 * topic: the change handler only schedules the update. (React also restores the
 * old `checked` right after the click; Preact leaves the DOM as clicked.)
 */
import type { JSX } from 'preact';
import { useState } from 'preact/hooks';

export function Checkbox(): JSX.Element {
  const [on, setOn] = useState(true);
  return (
    <label>
      <input
        type="checkbox"
        name="box"
        checked={on}
        onChange={() => {
          setTimeout(() => setOn((v) => !v), 20);
        }}
      />
      box
    </label>
  );
}
