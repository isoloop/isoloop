// Test isolate. Typed structurally: host may not import @isoloop/runtime.
type VNode = { t: string; p: Record<string, string>; c: (VNode | string)[] };
type Iso = {
  readonly state: { n: number };
  h(tag: string, props: Record<string, string> | null, ...c: (VNode | string | number)[]): VNode;
  view(fn: (s: { n: number }) => VNode): void;
  setState(p: { n: number } | ((s: { n: number }) => { n: number })): void;
  on(name: string, fn: (value: string | null) => void): void;
  bus: {
    publish(topic: string, value: unknown): void;
    subscribe(topic: string, fn: (value: unknown, from: string) => void): void;
  };
};

export default function main(iso: Iso): void {
  iso.setState({ n: 0 });
  iso.on('inc', () => {
    iso.setState((s) => ({ n: s.n + 1 }));
    iso.bus.publish('count', iso.state.n);
  });
  iso.on('crash', () => {
    throw new Error('fixture crash');
  });
  iso.on('block', () => {
    const t = performance.now();
    while (performance.now() - t < 700) {
      // Busy on purpose: the heartbeat stops.
    }
  });
  iso.bus.subscribe('count', (value, from) => {
    iso.setState({ n: typeof value === 'number' ? value * 100 : -1 });
    iso.bus.publish('seen', from);
  });
  iso.view((s) =>
    iso.h(
      'div',
      null,
      iso.h('span', { class: 'n' }, s.n),
      iso.h('button', { onclick: 'inc' }, 'inc'),
      iso.h('button', { onclick: 'crash' }, 'crash'),
      iso.h('button', { onclick: 'block' }, 'block'),
    ),
  );
}
