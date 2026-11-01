import type { SourceEntry } from '@winnow/api';
import type { Offer } from '../intake.ts';
import type { BoardOffers, HttpCtx, Provider } from '../providers.ts';

/** What Winnow uses of the vendored career-ops LinkedIn provider. */
export interface LinkedInModule {
  default: Provider;
  buildLinkedInUrl(entry: SourceEntry): string;
  parseLinkedInSearchHtml(html: string, fallbackCompany?: string): Offer[];
}

/** LinkedIn's "see more" feed: the same search, 10 cards a page, from any offset (the search page has no paging). */
const FEED = 'https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search';
/** Feed pages read after the search page: 4 × 10 on top of its 60, so 100 jobs in 5 requests. */
export const LINKEDIN_EXTRA_PAGES = 4;

export function feedUrl(searchUrl: string, start: number): string {
  const feed = new URL(FEED);
  feed.search = new URL(searchUrl).search;
  feed.searchParams.set('start', String(start));
  return feed.href;
}

/**
 * The career-ops LinkedIn provider, then up to 4 pages of the feed past its results. The first 429 ends
 * that search with what it found: LinkedIn limits by IP, and this server is everyone's IP.
 */
export function deeperLinkedIn(
  mod: LinkedInModule,
  userAgent: string,
  opts: { pages?: number; gapMs?: number } = {},
): Provider {
  const pages = opts.pages ?? LINKEDIN_EXTRA_PAGES;
  const gapMs = opts.gapMs ?? 1_000;
  return {
    id: 'linkedin',
    async fetch(entry, ctx) {
      const http = ctx as HttpCtx;
      const offers: BoardOffers = [...((await mod.default.fetch(entry, ctx)) as Offer[])];
      const seen = new Set(offers.map((o) => o.url));
      const search = mod.buildLinkedInUrl(entry);
      const first = offers.length;
      for (let page = 0; page < pages; page++) {
        await new Promise((r) => setTimeout(r, gapMs));
        let html: string;
        try {
          html = await http.fetchText(feedUrl(search, first + page * 10), {
            redirect: 'error',
            headers: {
              'user-agent': userAgent,
              accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
              'accept-language': 'en-GB,en;q=0.9',
            },
          });
        } catch (e) {
          const limited = (e as { status?: number }).status === 429;
          offers.note = limited
            ? `LinkedIn rate-limited this search, so it stopped at ${offers.length} jobs`
            : `LinkedIn's next page failed (${(e as Error).message}), so it stopped at ${offers.length} jobs`;
          break;
        }
        const fresh = mod.parseLinkedInSearchHtml(html, entry.name).filter((o) => !seen.has(o.url));
        if (!fresh.length) break;
        for (const o of fresh) {
          seen.add(o.url);
          offers.push(o);
        }
      }
      return offers;
    },
  };
}
