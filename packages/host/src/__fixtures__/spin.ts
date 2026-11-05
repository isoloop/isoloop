// Test isolate: renders, gets going, then loops forever, so its heartbeat stops for good.
type Iso = { view(fn: () => unknown): void; h(tag: string, props: null, ...c: string[]): unknown };

export default function main(iso: Iso): void {
  iso.view(() => iso.h('span', null, 'spinning soon'));
  setTimeout(() => {
    for (;;) {
      // Never yields.
    }
  }, 300);
}
