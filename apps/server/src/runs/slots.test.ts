import { describe, expect, it } from 'vitest';
import { Slots } from './slots.ts';

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('Slots', () => {
  it('lets scoring use every slot when no triage is waiting', () => {
    const slots = new Slots({ scan: 1, ai: 3 });
    const releases = [1, 2, 3].map(() => slots.take('ai', () => {}));
    expect(releases.every(Boolean)).toBe(true);
    expect(slots.take('ai', () => {})).toBeNull();
  });

  it('hands a freed slot to a waiting triage before earlier scoring waiters', async () => {
    const slots = new Slots({ scan: 1, ai: 2 });
    const a = slots.take('ai', () => {});
    slots.take('ai', () => {});
    const order: string[] = [];
    const score: () => void = () => {
      if (slots.take('ai', score)) order.push('score');
    };
    const triage: () => void = () => {
      if (slots.take('ai', triage, true)) order.push('triage');
    };
    slots.wait('ai', score);
    slots.wait('ai', triage, true);
    a?.();
    await tick();
    expect(order).toEqual(['triage']);
  });

  it('keeps new scoring from starting while triage waits, and gives triage a second slot', async () => {
    const slots = new Slots({ scan: 1, ai: 3 });
    const running = [1, 2, 3].map(() => slots.take('ai', () => {}) as () => void);
    const stop = new AbortController();
    const extra = slots.extra('ai', stop.signal);
    running[0]?.();
    expect(slots.take('ai', () => {})).toBeNull();
    const release = await extra;
    expect(release).toBeTypeOf('function');
    release?.();
    expect(slots.take('ai', () => {})).toBeTypeOf('function');
  });

  it('gives a waiting extra slot back when the run no longer needs it', async () => {
    const slots = new Slots({ scan: 1, ai: 1 });
    const only = slots.take('ai', () => {}) as () => void;
    const stop = new AbortController();
    const extra = slots.extra('ai', stop.signal);
    stop.abort();
    expect(await extra).toBeNull();
    only();
    expect(slots.stats().ai).toEqual({ used: 0, max: 1, waiting: 0 });
  });
});
