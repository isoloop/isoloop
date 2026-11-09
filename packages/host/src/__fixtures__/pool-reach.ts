// M2d task 5 (ADR 0015): a visual pool member that tries to reach another
// member's node. `config.role`: 'target' draws a node with a known id;
// 'prober' then finds it through the shared document and asks the host about
// it, through ctx.host (refused in the worker) and as a forged call naming
// itself (refused by the host), and about its own node (answered). It
// publishes what came back on `report`.
import { report } from './contracts';

type Ctx = {
  id: string;
  config: unknown;
  root?: Element;
  host: { measure(node: unknown): Promise<unknown>; focus(node: unknown): Promise<void> };
  bus: { publish(topic: unknown, rec: { value: unknown }): Promise<void> };
};

const role = (config: unknown): string =>
  typeof config === 'object' && config !== null && 'role' in config ? String(config.role) : '';

const outcome = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
    return 'ok';
  } catch (err) {
    const code: unknown =
      typeof err === 'object' && err !== null ? Reflect.get(err, 'code') : undefined;
    return typeof code === 'string' ? code : String(err);
  }
};

export default {
  start(ctx: Ctx): void {
    const root = ctx.root;
    if (!root) throw new Error('no root');
    const own = document.createElement('p');
    own.setAttribute('id', `${role(ctx.config)}-node`);
    own.textContent = ctx.id;
    root.append(own);
    if (role(ctx.config) !== 'prober') return;
    setTimeout(() => {
      void (async () => {
        const other = document.getElementById('target-node');
        // The host's answer to a call this member forges, naming itself and
        // the other member's node id.
        const forged = new Promise<string>((resolve) => {
          addEventListener('message', (e: MessageEvent<unknown>) => {
            const d = e.data;
            if (typeof d !== 'object' || d === null || Reflect.get(d, 're') !== 'forged') return;
            const p: unknown = Reflect.get(d, 'p');
            const ok = typeof p === 'object' && p !== null && Reflect.get(p, 'ok') === true;
            const err: unknown =
              typeof p === 'object' && p !== null ? Reflect.get(p, 'error') : undefined;
            const code: unknown =
              typeof err === 'object' && err !== null ? Reflect.get(err, 'code') : undefined;
            resolve(ok ? 'ok' : String(code));
          });
        });
        const otherId: unknown = other ? Reflect.get(other, 'isoId') : undefined;
        postMessage({
          v: 1,
          t: 'call',
          id: 'forged',
          isolate: ctx.id,
          p: { method: 'measure', args: [String(otherId)] },
        });
        const value = {
          id: ctx.id,
          found: other !== null,
          ownMeasure: await outcome(ctx.host.measure(own)),
          otherMeasure: await outcome(ctx.host.measure(other)),
          otherFocus: await outcome(ctx.host.focus(other)),
          forged: await forged,
        };
        await ctx.bus.publish(report, { value });
      })();
    }, 200);
  },
};
