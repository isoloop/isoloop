import type { BusRecord, BusToIsolate, CallResult, Grants, IsolateToBus } from '@isoloop/protocol';
import type { Broker, BusPort } from '../src/broker';

/** An isolate's end of an in-memory bus port: what it was sent, and a way to send. */
export type FakeIsolate = {
  id: string;
  port: BusPort;
  /** Every message the broker posted, in order. */
  inbox: BusToIsolate[];
  closed: boolean;
  /** Sends a message as the isolate would. */
  send(msg: IsolateToBus | Record<string, unknown>): void;
  /** Sends with an id and resolves with the broker's `result`, once deliveries it caused are in. */
  call(t: IsolateToBus['t'], p: Record<string, unknown>): Promise<CallResult>;
  /** Records delivered on a topic, in order. */
  records(topic: string): BusRecord[];
  /** Values delivered on a topic, in order. */
  values(topic: string): unknown[];
};

let ids = 0;

export function fakeIsolate(id: string): FakeIsolate {
  let handler: ((msg: unknown) => void) | undefined;
  const waiting = new Map<string, (r: CallResult) => void>();
  const iso: FakeIsolate = {
    id,
    inbox: [],
    closed: false,
    port: {
      post(msg) {
        iso.inbox.push(structuredClone(msg));
        if (msg.t === 'result' && msg.re !== undefined) {
          waiting.get(msg.re)?.(msg.p);
          waiting.delete(msg.re);
        }
      },
      onMessage(h) {
        handler = h;
      },
      close() {
        iso.closed = true;
      },
    },
    send(msg) {
      handler?.(structuredClone(msg));
    },
    async call(t, p) {
      const callId = `c${++ids}`;
      const done = new Promise<CallResult>((resolve) => waiting.set(callId, resolve));
      iso.send({ v: 1, t, id: callId, p });
      const r = await done;
      await flush(); // deliveries go out in a microtask after the result
      return r;
    },
    records(topic) {
      return iso.inbox.flatMap((m) =>
        m.t === 'deliver' && m.p.topic === topic ? m.p.records : [],
      );
    },
    values(topic) {
      return iso.records(topic).map((r) => r.value);
    },
  };
  return iso;
}

/** Attaches a fake isolate to the broker. */
export function connect(broker: Broker, id: string, grants: Grants): FakeIsolate {
  const iso = fakeIsolate(id);
  broker.attach(id, grants, iso.port);
  return iso;
}

/** Lets every queued microtask run. */
export async function flush(): Promise<void> {
  await new Promise<void>((r) => setTimeout(r, 0));
}
