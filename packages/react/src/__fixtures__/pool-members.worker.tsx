/*
 * Two React members in one worker through `defineIsolate` (ADR 0015, M2d
 * task 3): the first throws while rendering once asked to, the second keeps
 * rendering; the second also opens a modal into its portal root. Errors each
 * member reports go to the page with its index.
 */
import { roots } from './two-members-dom';
import { createTestContext } from '@isoloop/runtime/testing';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { defineIsolate, usePortalRoot } from '../index';

function Ticker({ label, failAt }: { label: string; failAt: number }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setN((x) => x + 1), 20);
    return () => clearInterval(t);
  }, []);
  if (n >= failAt) throw new Error(`${label} failed at ${n}`);
  return <p data-ticks={n > 5 ? 'many' : 'few'}>{label}</p>;
}

function Modal() {
  const portal = usePortalRoot();
  return createPortal(<dialog open>modal of B</dialog>, portal);
}

const members = [
  () => <Ticker label="A" failAt={10} />,
  () => (
    <>
      <Ticker label="B" failAt={Number.POSITIVE_INFINITY} />
      <Modal />
    </>
  ),
];

roots.forEach((root, i) => {
  const t = createTestContext({ root, id: `m${i}` });
  // Report to the page instead (a spread would read the portal root too early).
  Object.defineProperty(t.ctx, 'reportError', {
    value: (error: unknown) => postMessage({ t: 'reported', member: i, message: String(error) }),
  });
  void defineIsolate(members[i] ?? (() => null)).start(t.ctx);
});
