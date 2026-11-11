import { describe, expect, it } from 'vitest';
import { createBatchSender, isBatch, unbatch } from './batch';
import { isIsolateToBus, type IsolateToBus } from './bus';

const commits = (offset: number): IsolateToBus => ({
  v: 1,
  t: 'commits',
  p: { offsets: [{ topic: 'a', offset }] },
});
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('createBatchSender (ADR 0016, decision 3)', () => {
  it('off: sends every envelope at once, as before', () => {
    const out: unknown[] = [];
    const s = createBatchSender<IsolateToBus>(
      (m) => out.push(m),
      () => false,
    );
    s.send(commits(1));
    s.send(commits(2));
    expect(out).toEqual([commits(1), commits(2)]);
    expect(s.queued()).toBe(0);
  });

  it('on: what one task sends goes at its end, one envelope as itself', async () => {
    const out: unknown[] = [];
    const s = createBatchSender<IsolateToBus>(
      (m) => out.push(m),
      () => true,
    );
    s.send(commits(1));
    expect(out).toEqual([]);
    await tick();
    expect(out).toEqual([commits(1)]);
  });

  it('on: several envelopes from one task go as one batch, in order; the next task starts a new one', async () => {
    const out: unknown[] = [];
    const s = createBatchSender<IsolateToBus>(
      (m) => out.push(m),
      () => true,
    );
    s.send(commits(1));
    s.send(commits(2));
    s.send(commits(3));
    await tick();
    s.send(commits(4));
    s.send(commits(5));
    await tick();
    expect(out).toEqual([
      { v: 1, t: 'batch', p: { msgs: [commits(1), commits(2), commits(3)] } },
      { v: 1, t: 'batch', p: { msgs: [commits(4), commits(5)] } },
    ]);
  });

  it('flush sends what is queued now, and clear drops it', async () => {
    const out: unknown[] = [];
    const s = createBatchSender<IsolateToBus>(
      (m) => out.push(m),
      () => true,
    );
    s.send(commits(1));
    s.flush();
    expect(out).toEqual([commits(1)]);
    s.send(commits(2));
    s.clear();
    await tick();
    expect(out).toEqual([commits(1)]);
  });

  it('turning it off sends what is queued first, so order holds', () => {
    const out: unknown[] = [];
    let on = true;
    const s = createBatchSender<IsolateToBus>(
      (m) => out.push(m),
      () => on,
    );
    s.send(commits(1));
    on = false;
    s.send(commits(2));
    expect(out).toEqual([commits(1), commits(2)]);
  });
});

describe('unbatch', () => {
  it('hands a batch’s envelopes over in order, and anything else as itself', () => {
    const seen: unknown[] = [];
    unbatch({ v: 1, t: 'batch', p: { msgs: [commits(1), commits(2)] } }, (m) => seen.push(m));
    unbatch(commits(3), (m) => seen.push(m));
    expect(seen).toEqual([commits(1), commits(2), commits(3)]);
  });

  it('a batch inside a batch is not opened: the port guard drops it like any unknown type', () => {
    const inner = { v: 1, t: 'batch', p: { msgs: [commits(1)] } };
    const seen: unknown[] = [];
    unbatch({ v: 1, t: 'batch', p: { msgs: [inner] } }, (m) => seen.push(m));
    expect(seen).toEqual([inner]);
    expect(isIsolateToBus(inner)).toBe(false);
  });

  it('a malformed batch is passed on whole, for the guard to drop', () => {
    const bad = { v: 1, t: 'batch', p: { msgs: 'nope' } };
    expect(isBatch(bad)).toBe(false);
    const seen: unknown[] = [];
    unbatch(bad, (m) => seen.push(m));
    expect(seen).toEqual([bad]);
  });
});
