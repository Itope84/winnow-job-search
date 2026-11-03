import type { SourceEntry } from '@winnow/api';
import type { Offer } from '../intake.ts';
import type { BoardOffers, HttpCtx, Provider } from '../providers.ts';

/**
 * Apple's own jobs site, through the search API its pages call (`POST jobs.apple.com/api/v1/search`,
 * 20 jobs a page). Apple has over 6,000 jobs worldwide, so the entry's link decides what is read: the
 * same link as an Apple search, `https://jobs.apple.com/en-gb/search?location=united-kingdom-GBR&key=…`.
 * `location` takes one or more `name-CODE` places joined by `+`; `key` is the search text.
 */
const API = 'https://jobs.apple.com/api/v1/search';
const PAGE_SIZE = 20;
const DEFAULT_MAX_PAGES = 25;
const HARD_MAX_PAGES = 100;

interface AppleJob {
  positionId?: string;
  postingTitle?: string;
  transformedPostingTitle?: string;
  jobSummary?: string;
  postDateInGMT?: string;
  locations?: { name?: string; countryName?: string }[];
  team?: { teamName?: string };
}

/** The search an entry's link describes. */
export function appleSearch(entry: SourceEntry): {
  locale: string;
  query: string;
  locations: string[];
} | null {
  const raw = String(entry.api ?? entry.careers_url ?? '');
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.hostname !== 'jobs.apple.com') return null;
  const locale = /^\/([a-z]{2}-[a-z]{2})(\/|$)/.exec(u.pathname)?.[1] ?? 'en-us';
  const locations = (u.searchParams.get('location') ?? '')
    .split(/[+ ]/)
    .map((s) => /-([A-Z0-9]{2,6})$/.exec(s.trim())?.[1])
    .filter((c): c is string => !!c)
    .map((c) => `postLocation-${c}`);
  return { locale, query: (u.searchParams.get('key') ?? '').trim(), locations };
}

export function appleOffer(job: AppleJob, locale: string): Offer | null {
  if (!job.positionId || !job.postingTitle?.trim()) return null;
  const posted = job.postDateInGMT ? Date.parse(job.postDateInGMT) : Number.NaN;
  const places = (job.locations ?? [])
    .map((l) => [...new Set([l.name, l.countryName].filter(Boolean))].join(', '))
    .filter(Boolean);
  return {
    title: job.postingTitle.trim(),
    url: `https://jobs.apple.com/${locale}/details/${job.positionId}/${job.transformedPostingTitle ?? ''}`,
    company: 'Apple',
    location: [...new Set(places)].join(' · '),
    description: job.jobSummary?.trim() || undefined,
    postedAt: Number.isFinite(posted) ? posted : undefined,
  };
}

export const apple: Provider = {
  id: 'apple',
  detect(entry) {
    return appleSearch(entry) ? { url: API } : null;
  },
  async fetch(entry, ctx) {
    const search = appleSearch(entry);
    if (!search) throw new Error('apple: the link must be a jobs.apple.com search');
    const http = ctx as HttpCtx;
    const pages = Math.min(
      Math.max(Number(entry.max_pages) || DEFAULT_MAX_PAGES, 1),
      HARD_MAX_PAGES,
    );
    const offers: BoardOffers = [];
    for (let page = 1; page <= pages; page++) {
      const res = (await http.fetchJson(API, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // The API answers with no results unless `format` is sent.
        body: JSON.stringify({
          query: search.query,
          filters: search.locations.length ? { locations: search.locations } : {},
          page,
          locale: search.locale,
          sort: 'newest',
          format: { longDate: 'MMMM D, YYYY', mediumDate: 'MMM D, YYYY' },
        }),
        redirect: 'error',
        timeoutMs: 30_000,
      })) as { res?: { searchResults?: AppleJob[]; totalRecords?: number } };
      const jobs = res.res?.searchResults ?? [];
      for (const job of jobs) {
        const offer = appleOffer(job, search.locale);
        if (offer) offers.push(offer);
      }
      const total = res.res?.totalRecords ?? 0;
      if (jobs.length < PAGE_SIZE || page * PAGE_SIZE >= total) break;
      if (page === pages)
        offers.note = `Apple: read ${offers.length} of ${total} jobs; narrow the link's search or raise max_pages`;
    }
    return offers;
  },
};
