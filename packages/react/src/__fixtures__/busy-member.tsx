/*
 * A React member for busy time (ADR 0017): re-renders every `config.everyMs`
 * from an interval its effect sets, and spins `config.burnMs` in each render.
 * With `config.quiet` its renders change nothing in the DOM, so only React's
 * commit hook can name the root that did the work.
 * Members of a pool share this module, so React's scheduler renders them all.
 */
import { useEffect, useState } from 'react';
import type { IsolateDefinition } from '@isoloop/runtime';
import { defineIsolate } from '../index';

const field = (config: unknown, key: string): number =>
  Number(typeof config === 'object' && config !== null ? Reflect.get(config, key) : 0);

const spin = (ms: number): void => {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    // Busy on purpose.
  }
};

function Burner({ config }: { config: unknown }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setN((x) => x + 1), field(config, 'everyMs'));
    return () => clearInterval(t);
  }, [config]);
  spin(field(config, 'burnMs'));
  return <p>{Reflect.get(Object(config), 'quiet') === true ? 'quiet' : n}</p>;
}

const definition: IsolateDefinition = defineIsolate(Burner);
export default definition;
