import { describe, expect, it } from 'vitest';
import { holdBack, staleAge } from './triage.ts';

const now = Date.parse('2026-11-06T12:00:00Z');
const day = (ago: number) => new Date(now - ago * 86_400_000).toISOString().slice(0, 10);

describe('Triage and old postings', () => {
  it('only calls a job old after 60 days', () => {
    expect(staleAge(day(10), now)).toBeNull();
    expect(staleAge(day(60), now)).toBeNull();
    expect(staleAge(day(61), now)).toBe('2 months ago');
    expect(staleAge(day(158), now)).toBe('5 months ago');
    expect(staleAge(null, now)).toBeNull();
    expect(staleAge('not a date', now)).toBeNull();
  });

  it('turns a Keep on an old job into Unsure, with the age first', () => {
    expect(
      holdBack(
        { verdict: 'keep', reason: 'Grants role at a UK charity.' },
        { hasJd: true, postedAt: day(158) },
        now,
      ),
    ).toEqual({
      verdict: 'unsure',
      reason: 'Posted 5 months ago. Grants role at a UK charity.',
    });
  });

  it('says both when the job is old and has no description', () => {
    expect(
      holdBack({ verdict: 'keep', reason: 'Fits.' }, { hasJd: false, postedAt: day(90) }, now),
    ).toEqual({ verdict: 'unsure', reason: 'Posted 3 months ago. No description to check. Fits.' });
  });

  it('keeps the old no-description rule', () => {
    expect(
      holdBack({ verdict: 'keep', reason: 'Fits.' }, { hasJd: false, postedAt: day(3) }, now),
    ).toEqual({
      verdict: 'unsure',
      reason: 'No description to check. Fits.',
    });
  });

  it('leaves a fresh Keep, a job with no date, and other verdicts alone', () => {
    const fresh = { verdict: 'keep' as const, reason: 'Fits.' };
    expect(holdBack(fresh, { hasJd: true, postedAt: day(5) }, now)).toBe(fresh);
    expect(holdBack(fresh, { hasJd: true, postedAt: null }, now)).toBe(fresh);
    const discard = { verdict: 'discard' as const, reason: 'Wrong field.' };
    expect(holdBack(discard, { hasJd: true, postedAt: day(300) }, now)).toBe(discard);
    const unsure = { verdict: 'unsure' as const, reason: 'Unclear.' };
    expect(holdBack(unsure, { hasJd: false, postedAt: day(300) }, now)).toBe(unsure);
  });
});
