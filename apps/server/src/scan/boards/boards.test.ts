import { describe, expect, it } from 'vitest';
import type { Offer } from '../intake.ts';
import { freehire, freehireOffer, freehireParams } from './freehire.ts';
import { deeperLinkedIn, feedUrl, type LinkedInModule } from './linkedin.ts';

const offers = (from: number, n: number): Offer[] =>
  Array.from({ length: n }, (_, i) => ({
    title: `Job ${from + i}`,
    url: `https://www.linkedin.com/jobs/view/${from + i}`,
  }));

/** A fake vendored module: the search page gives 60 jobs; the feed's "html" is the start offset. */
function fakeLinkedIn(): LinkedInModule {
  return {
    default: { id: 'linkedin', fetch: async () => offers(0, 60) },
    buildLinkedInUrl: () =>
      'https://www.linkedin.com/jobs/search?keywords=Engineer&location=London',
    parseLinkedInSearchHtml: (html) => (html ? offers(Number(html), 10) : []),
  };
}

function feedCtx(answer: (start: number) => string | Error) {
  const starts: number[] = [];
  return {
    starts,
    ctx: {
      fetchJson: async () => ({}),
      fetchText: async (url: string) => {
        const start = Number(new URL(url).searchParams.get('start'));
        starts.push(start);
        const a = answer(start);
        if (a instanceof Error) throw a;
        return a;
      },
    },
  };
}

const http = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status });

describe('LinkedIn, read deeper', () => {
  it('reads the feed from where the search page ends', () => {
    const url = new URL(
      feedUrl('https://www.linkedin.com/jobs/search?keywords=A&f_TPR=r604800', 60),
    );
    expect(url.pathname).toBe('/jobs-guest/jobs/api/seeMoreJobPostings/search');
    expect(url.searchParams.get('keywords')).toBe('A');
    expect(url.searchParams.get('f_TPR')).toBe('r604800');
    expect(url.searchParams.get('start')).toBe('60');
  });

  it('reads 4 more pages, so 100 jobs', async () => {
    const { ctx, starts } = feedCtx((start) => String(start));
    const got = await deeperLinkedIn(fakeLinkedIn(), 'ua', { gapMs: 0 }).fetch({ name: 'x' }, ctx);
    expect(got).toHaveLength(100);
    expect(starts).toEqual([60, 70, 80, 90]);
    expect(got.note).toBeUndefined();
  });

  it('stops the search at the first 429 and keeps what it found', async () => {
    const { ctx, starts } = feedCtx((start) => (start === 80 ? http(429) : String(start)));
    const got = await deeperLinkedIn(fakeLinkedIn(), 'ua', { gapMs: 0 }).fetch({ name: 'x' }, ctx);
    expect(got).toHaveLength(80);
    expect(starts).toEqual([60, 70, 80]);
    expect(got.note).toBe('LinkedIn rate-limited this search, so it stopped at 80 jobs');
  });

  it('stops when a page brings nothing new', async () => {
    const { ctx, starts } = feedCtx((start) => (start >= 70 ? '' : String(start)));
    const got = await deeperLinkedIn(fakeLinkedIn(), 'ua', { gapMs: 0 }).fetch({ name: 'x' }, ctx);
    expect(got).toHaveLength(70);
    expect(starts).toEqual([60, 70]);
  });
});

describe('freehire', () => {
  it('builds the search from the entry', () => {
    const p = freehireParams(
      {
        name: 'x',
        keywords: 'title:senior software engineer',
        countries: 'GB, ie',
        posted_within_days: 7,
        work_mode: ['remote', 'hybrid'],
      },
      1,
    );
    expect(p.get('q')).toBe('title:senior software engineer');
    expect(p.getAll('countries')).toEqual(['gb', 'ie']);
    expect(p.get('posted_within_days')).toBe('7');
    expect(p.get('work_mode')).toBe('remote,hybrid');
    expect(p.get('offset')).toBe('100');
  });

  it('maps a posting, with yearly pay only', () => {
    const job = {
      title: ' Senior Software Engineer ',
      company: 'Deliveroo',
      location: 'London',
      url: 'https://boards.greenhouse.io/deliveroo/jobs/1?utm_source=freehire.me',
      description: 'The full posting',
      posted_at: '2026-10-30T10:00:00Z',
      enrichment: {
        salary_min: 90000,
        salary_max: 110000,
        salary_currency: 'GBP',
        salary_period: 'year',
      },
    };
    expect(freehireOffer(job)).toMatchObject({
      title: 'Senior Software Engineer',
      company: 'Deliveroo',
      postedAt: Date.parse('2026-10-30T10:00:00Z'),
      salary: { min: 90000, max: 110000, currency: 'GBP' },
    });
    expect(
      freehireOffer({ ...job, enrichment: { ...job.enrichment, salary_period: 'day' } })?.salary,
    ).toBeUndefined();
    expect(freehireOffer({ ...job, closed_at: '2026-10-31T00:00:00Z' })).toBeNull();
  });

  it('reads further pages only while they are full', async () => {
    const urls: string[] = [];
    const page = (n: number) => ({
      data: Array.from({ length: n }, (_, i) => ({
        title: `Job ${i}`,
        url: `https://x.test/${urls.length}/${i}`,
      })),
    });
    const ctx = {
      fetchText: async () => '',
      fetchJson: async (url: string) => {
        urls.push(url);
        return urls.length === 1 ? page(100) : page(30);
      },
    };
    const got = await freehire.fetch({ name: 'x', keywords: 'a', max_pages: 5 }, ctx);
    expect(got).toHaveLength(130);
    expect(urls).toHaveLength(2);
  });
});
