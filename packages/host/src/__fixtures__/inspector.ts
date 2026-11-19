// Test isolate for `ctx.inspector` (ADR 0020, decision 6) on the real
// runtime. It does what `config.do` says and reports on `report.v1`, each
// report carrying everything seen so far, so one lost to a bus restart is
// made up by the next. Typed structurally: host may not import @isoloop/runtime.
import { report } from './contracts';

type Msg = { t: string; p: unknown };
type Rec = { offset: number; preview: string; truncated: boolean };
type Insp = {
  snapshot(): Promise<{ isolates: { id: string }[]; bus: { restarts: number } }>;
  on(fn: (m: Msg) => void): () => void;
  records(topic: string, o: { last: number }): Promise<Rec[]>;
  tap(
    o: { topics: string[]; maxPerSec?: number; onSkipped?: (count: number) => void },
    fn: (r: Rec) => void,
  ): () => void;
  restart(id: string): Promise<void>;
  kill(id: string): Promise<void>;
  block(id: string, ms: number): Promise<void>;
};
type Ctx = {
  id: string;
  config: unknown;
  inspector: Insp | undefined;
  bus: { publish(topic: unknown, rec: { value: unknown }): Promise<void> };
};
type Config = { do?: string; action?: 'restart' | 'kill' | 'block'; target?: string; ms?: number };

const codeOf = (e: unknown): string =>
  typeof e === 'object' && e !== null && 'code' in e ? String(e.code) : String(e);

export default {
  start(ctx: Ctx): void {
    const cfg = (ctx.config ?? {}) as Config;
    const seen: unknown[] = [];
    const say = (step: string, data: unknown = null): void => {
      seen.push({ step, data });
      ctx.bus.publish(report, { value: { id: ctx.id, seen: [...seen] } }).catch(() => {});
    };
    const ins = ctx.inspector;
    if (!ins) {
      say('none');
      return;
    }
    switch (cfg.do) {
      case 'snapshot':
        void ins.snapshot().then((s) => {
          say('snapshot', { ids: s.isolates.map((i) => i.id), restarts: s.bus.restarts });
        });
        return;
      case 'listen':
        ins.on((m) => {
          const event =
            m.t === 'event' && typeof m.p === 'object' && m.p !== null && 'event' in m.p
              ? String(m.p.event)
              : null;
          say(m.t, event);
        });
        say('listening');
        return;
      case 'records':
        ins.records('count.v1', { last: 3 }).then(
          (r) => {
            say(
              'records',
              r.map((x) => x.preview),
            );
          },
          (e: unknown) => {
            say('error', codeOf(e));
          },
        );
        return;
      case 'tap':
        ins.tap({ topics: ['count.v1'] }, (r) => {
          say('tapped', r.preview);
        });
        say('tapping');
        return;
      case 'tap-skipped': {
        // A cap of 1 a second, so a burst is mostly skipped.
        let total = 0;
        ins.tap(
          {
            topics: ['count.v1'],
            maxPerSec: 1,
            onSkipped: (n) => {
              total += n;
              say('skipped', total);
            },
          },
          () => undefined,
        );
        say('tapping');
        return;
      }
      case 'control': {
        const { action = 'restart', target = '', ms = 0 } = cfg;
        const done = action === 'block' ? ins.block(target, ms) : ins[action](target);
        done.then(
          () => {
            say('done');
          },
          (e: unknown) => {
            say('error', codeOf(e));
          },
        );
        return;
      }
      case undefined:
      default:
        say('ready');
    }
  },
};
