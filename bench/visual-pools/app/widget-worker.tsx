/// <reference lib="webworker" />
/*
 * The gate's prototype widget worker (M2d task 1). It hosts the widgets it is
 * told to, each rendering with React into its own root element in the
 * worker's one document. With one widget it is an own worker; with eight it is
 * a pool. Same script both ways, so the only difference measured is how many
 * workers the widgets are spread over.
 */
import { dom } from './setup.ts';
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { kindOf, type ScalarRecord, type VibRecord } from './records.ts';

declare const self: DedicatedWorkerGlobalScope;

function useRecords<T>(port: MessagePort, onFirst: () => void): T[] {
  const [rows, setRows] = useState<T[]>([]);
  useEffect(() => {
    onFirst();
    const on = (e: MessageEvent<T>): void => setRows((r) => [e.data, ...r].slice(0, 20));
    port.addEventListener('message', on);
    port.start();
    return () => port.removeEventListener('message', on);
  }, [port, onFirst]);
  return rows;
}

function Vibration({ port, onFirst }: { port: MessagePort; onFirst: () => void }) {
  const rows = useRecords<VibRecord>(port, onFirst);
  const last = rows[0];
  if (!last) return <section className="widget">waiting</section>;
  const v = last.values;
  let rms = 0;
  let max = 0;
  for (const x of v) {
    rms += x * x;
    max = Math.max(max, Math.abs(x));
  }
  rms = Math.sqrt(rms / v.length);
  const points = Array.from(v, (x, i) => `${i * 4},${(30 - x * 12).toFixed(1)}`).join(' ');
  return (
    <section className="widget" data-t={last.t}>
      <h3>Vibration</h3>
      <svg viewBox="0 0 200 60" width="200" height="60">
        <polyline points={points} fill="none" stroke="currentColor" />
      </svg>
      <dl>
        <dt>RMS</dt>
        <dd>{rms.toFixed(3)}</dd>
        <dt>Peak</dt>
        <dd>{max.toFixed(3)}</dd>
      </dl>
    </section>
  );
}

function Scalars({ port, onFirst }: { port: MessagePort; onFirst: () => void }) {
  const rows = useRecords<ScalarRecord>(port, onFirst);
  const last = rows[0];
  if (!last) return <section className="widget">waiting</section>;
  return (
    <section className="widget" data-t={last.t}>
      <h3>Signals</h3>
      <table>
        <tbody>
          {rows.map((r) => (
            <tr key={r.t}>
              <td>{r.bearingC[0].toFixed(1)}</td>
              <td>{r.bearingC[1].toFixed(1)}</td>
              <td>{r.exhaustC.toFixed(0)}</td>
              <td>{r.barG.toFixed(2)}</td>
              <td>{r.rpm.toFixed(0)}</td>
              <td>{r.kw.toFixed(0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

type Start = { members: number[]; ports: MessagePort[] };

self.addEventListener('message', (e: MessageEvent<Start>) => {
  const { members, ports } = e.data;
  let left = members.length;
  const first = () => {
    left -= 1;
    // After this commit's batch has gone out (batches flush in a microtask).
    if (left === 0) setTimeout(() => self.postMessage({ t: 'ready' }), 0);
  };
  members.forEach((m, k) => {
    const port = ports[k];
    if (!port) throw new Error(`no port for widget ${m}`);
    // ADR 0015: a root per member in the worker's one document.
    const root = dom.document.createElement('div');
    root.setAttribute('data-member', String(m));
    dom.root.appendChild(root);
    const once = { done: false };
    const onFirst = () => {
      if (once.done) return;
      once.done = true;
      first();
    };
    const W = kindOf(m) === 'vib' ? Vibration : Scalars;
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the subset's element stands in for a DOM Element (ADR 0010)
    createRoot(root as unknown as Element).render(<W port={port} onFirst={onFirst} />);
  });
});
