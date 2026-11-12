/* oxlint-disable typescript/no-unsafe-argument, typescript/no-unsafe-assignment, typescript/no-unsafe-call, typescript/no-unsafe-member-access, typescript/no-unsafe-return -- CDP payloads are untyped JSON in these plain scripts */
// CDP helpers for the plant memory probes: talk to every page and worker
// target from one browser session, over non-flattened sessions
// (Target.sendMessageToTarget), since Playwright's CDPSession has no
// per-session send.
export async function targets(b) {
  const pending = new Map();
  let next = 1;
  b.on('Target.receivedMessageFromTarget', (e) => {
    const m = JSON.parse(e.message);
    const settle = m.id === undefined ? undefined : pending.get(m.id);
    if (!settle) return;
    pending.delete(m.id);
    settle(m.result);
  });
  const call = (sessionId, method, params = {}) =>
    new Promise((resolve) => {
      const id = next++;
      pending.set(id, resolve);
      void b.send('Target.sendMessageToTarget', {
        sessionId,
        message: JSON.stringify({ id, method, params }),
      });
    });
  const list = async () => {
    const { targetInfos } = await b.send('Target.getTargets');
    return targetInfos.filter((t) => t.type === 'worker' || t.type === 'page');
  };
  /** Runs `fn(sessionId, target)` on each target, one at a time. */
  const each = async (fn) => {
    const out = [];
    for (const t of await list()) {
      // oxlint-disable-next-line no-await-in-loop -- one target at a time
      const { sessionId } = await b.send('Target.attachToTarget', {
        targetId: t.targetId,
        flatten: false,
      });
      // oxlint-disable-next-line no-await-in-loop -- one target at a time
      out.push(await fn(sessionId, t));
      // oxlint-disable-next-line no-await-in-loop -- one target at a time
      await b.send('Target.detachFromTarget', { sessionId });
    }
    return out;
  };
  const gcAll = async () => {
    // Twice: a worker's first collection can leave garbage the second frees.
    for (let i = 0; i < 2; i++) {
      // oxlint-disable-next-line no-await-in-loop -- rounds in order
      await each((s) => call(s, 'HeapProfiler.collectGarbage'));
    }
  };
  return { call, list, each, gcAll };
}
