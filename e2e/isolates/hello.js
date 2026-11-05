// A plain ES module isolate served from another origin by isolate-server.ts.

/**
 * @typedef {{ from: string }} State
 * @param {{
 *   setState(s: State): void;
 *   view(fn: (s: State) => unknown): void;
 *   h(tag: string, props: Record<string, string>, ...c: string[]): unknown;
 * }} iso
 */
export default function main(iso) {
  iso.setState({ from: new URL(import.meta.url).port });
  iso.view((s) => iso.h('span', { class: 'hello' }, `hello from :${s.from}`));
}
