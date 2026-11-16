/*
 * A React pool member for the busy-time suite (ADR 0017), built in production
 * mode by e2e/build-adapters.ts. Every `config.everyMs` it re-renders and
 * spins `config.burnMs`, and its output never changes: no DOM change names
 * its root, so its renders count as its own only if production react-dom
 * calls the runtime's commit hook.
 */
import { defineIsolate } from '@isoloop/react';
import { useEffect, useState } from 'react';

const field = (config: unknown, key: string): number =>
  Number(typeof config === 'object' && config !== null ? Reflect.get(config, key) : 0);

function Burner({ config }: { config: unknown }) {
  const [, setN] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setN((x) => x + 1), field(config, 'everyMs'));
    return () => clearInterval(t);
  }, [config]);
  const end = performance.now() + field(config, 'burnMs');
  while (performance.now() < end) {
    // Busy on purpose.
  }
  return <p className="v">quiet</p>;
}

export default defineIsolate(Burner);
