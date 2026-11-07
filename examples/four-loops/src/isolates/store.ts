import { defineIsolate } from '@isoloop/runtime';
import { count, note, store } from '../topics';

// S · Store, headless (ADR 0008): folds the command topics into one state
// and publishes it to the compacted store.v1 topic. It keeps nothing of its
// own: after a restart it replays both topics from `earliest` and arrives at
// the same state. Publishes wait for a quiet moment and skip a state equal
// to the last snapshot, so a replay doesn't flash old states at readers.
// Delivery is at least once: after a bus crash, records after the last
// commit on disk come again, so the fold skips offsets it already applied.
export default defineIsolate({
  start(ctx) {
    const state = { count: 0, notes: 0 };
    let noteAt = -1;
    let last = JSON.stringify(state);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const changed = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const next = JSON.stringify(state);
        if (next === last) return;
        last = next;
        void ctx.bus.publish(store, { key: 'state', value: { ...state } });
      }, 50);
    };
    ctx.bus.subscribe(
      store,
      (r) => {
        last = JSON.stringify(r.value);
      },
      { from: 'earliest' },
    );
    ctx.bus.subscribe(
      count,
      (r) => {
        state.count = r.value;
        changed();
      },
      { from: 'earliest' },
    );
    ctx.bus.subscribe(
      note,
      (r) => {
        if (r.offset <= noteAt) return;
        noteAt = r.offset;
        state.notes++;
        changed();
      },
      { from: 'earliest' },
    );
  },
});
