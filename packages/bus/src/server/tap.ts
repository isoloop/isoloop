/*
 * The inspection feed's tap in the bus worker (ADR 0020, decision 3): copies
 * records appended to matching topics onto a dedicated port as previews, at
 * most `maxPerSec` a second. Records over the cap are counted, not queued,
 * and the count goes out as `skipped` at most once a second. A tap isn't a
 * consumer, so it never shows in the bus figures and never holds back
 * delivery.
 */
import { DEFAULT_TAP_PER_SEC, isTapToBus, type BusToTap } from '@isoloop/protocol';
import type { Broker } from '../broker/broker';
import { recordPreview } from './preview';

/** The part of a `MessagePort` a tap uses. */
export type TapPort = {
  postMessage(msg: BusToTap): void;
  addEventListener(type: 'message', fn: (e: MessageEvent<unknown>) => void): void;
  start(): void;
  close(): void;
};

export type TapOptions = {
  topics: readonly string[];
  maxPerSec?: number;
  port: TapPort;
  /** Default `performance.now`. */
  now?: () => number;
  /** Default `setInterval`, for the `skipped` report. */
  every?: (fn: () => void, ms: number) => () => void;
};

/** `maxPerSec` as given when it's a positive number, else the default. */
export const tapRate = (n: unknown): number =>
  typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : DEFAULT_TAP_PER_SEC;

/** Starts a tap on `broker`. Returns the function that ends it; `close` on the port ends it too. */
export function openTap(broker: Broker, o: TapOptions): () => void {
  const max = tapRate(o.maxPerSec);
  const now = o.now ?? (() => performance.now());
  const every =
    o.every ??
    ((fn: () => void, ms: number) => {
      const t = setInterval(fn, ms);
      return () => clearInterval(t);
    });
  let windowAt = now();
  let sent = 0;
  let skipped = 0;
  let open = true;

  const untap = broker.tap(o.topics, (topic, rec, bytes) => {
    const t = now();
    if (t - windowAt >= 1000) {
      windowAt = t;
      sent = 0;
    }
    if (sent >= max) {
      skipped++;
      return;
    }
    sent++;
    o.port.postMessage({ v: 1, t: 'record', p: recordPreview(topic, rec, bytes) });
  });
  const stopReport = every(() => {
    if (skipped === 0) return;
    o.port.postMessage({ v: 1, t: 'skipped', p: { count: skipped } });
    skipped = 0;
  }, 1000);

  const end = (): void => {
    if (!open) return;
    open = false;
    untap();
    stopReport();
    o.port.close();
  };
  o.port.addEventListener('message', (e) => {
    if (isTapToBus(e.data) && e.data.t === 'close') end();
  });
  o.port.start();
  return end;
}
