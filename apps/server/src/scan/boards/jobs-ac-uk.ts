import type { SourceEntry } from '@winnow/api';
import type { Offer } from '../intake.ts';
import type { BoardOffers, HttpCtx, Provider } from '../providers.ts';
import { BROWSER_HEADERS, dayMonth, intField, list, pause, searchTerms, text } from './html.ts';

/**
 * jobs.ac.uk, academic, research and university jobs, mostly UK. No public API, so this reads the search
 * results page, 25 jobs a page, newest first. Fields: `keywords` (a list, or text split on commas: one
 * search each, at most 5), `locations` (jobs.ac.uk places: `united-kingdom`, `london`, `scotland`… also
 * read from `location`), `max_pages` (2 by default, 8 at most).
 *
 * Its own free-text location box only works through a Google place id, so it is not used: a place is
 * matched through the site's location facet, which is what its filter list on the left sends.
 */
const SEARCH = 'https://www.jobs.ac.uk/search/';
const ORIGIN = 'https://www.jobs.ac.uk';
const PAGE_SIZE = 25;
const DEFAULT_MAX_PAGES = 2;
const HARD_MAX_PAGES = 8;
const GAP_MS = 400;

/** "United Kingdom" → "united-kingdom": the shape of the site's location facet values. */
export const facet = (place: string) =>
  place
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/** The place filters an entry asks for, as the site's facet values: `locations`, and the part of `location` before a comma. */
export const wantedFacets = (entry: SourceEntry): string[] => {
  const one = typeof entry.location === 'string' ? (entry.location.split(',')[0] ?? '') : '';
  return [...new Set([...list(entry.locations), one].map(facet).filter(Boolean))];
};

/** The place filters the site offers, read from the filter list on any results page. */
export function offeredFacets(html: string): string[] {
  return [...html.matchAll(/name="locationFacet\[\]"[^>]*value="([^"]*)"/g)].map(
    (m) => m[1] as string,
  );
}

export function jobsAcUkUrl(entry: SourceEntry, keyword: string, page: number): string {
  const p = new URLSearchParams();
  if (keyword) p.set('keywords', keyword);
  for (const f of wantedFacets(entry)) p.append('locationFacet[]', f);
  p.set('sortOrder', '1');
  p.set('pageSize', String(PAGE_SIZE));
  p.set('startIndex', String((page - 1) * PAGE_SIZE + 1));
  return `${SEARCH}?${p}`;
}

/** The jobs on one results page. */
export function jobsAcUkPage(html: string, now = Date.now()): Offer[] {
  // The listing container is there even for a search that finds nothing; without it the site changed.
  if (!html.includes('id="job-listings"'))
    throw new Error('the results page has changed shape; this board needs updating.');
  const blocks = html.split(/<div class="j-search-result__result\b[^>]*>/).slice(1);
  const offers: Offer[] = [];
  for (const block of blocks) {
    const link = /<a href="(\/job\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(block);
    const title = link ? text(link[2] as string) : '';
    if (!link || !title) continue;
    const employer = /j-search-result__employer">([\s\S]*?)<\/div>/.exec(block)?.[1];
    const department = /j-search-result__department">([\s\S]*?)<\/div>/.exec(block)?.[1];
    const where = /<div>\s*Location:\s*([\s\S]*?)<\/div>/.exec(block)?.[1];
    const pay = /Salary:\s*<\/strong>([\s\S]*?)<\/div>/.exec(block)?.[1];
    const placed = /Date Placed:\s*<\/strong>\s*([^<]*)/.exec(block)?.[1];
    offers.push({
      title,
      url: `${ORIGIN}${link[1]}`,
      company: (employer && text(employer)) || (department && text(department)) || 'jobs.ac.uk',
      location: where ? text(where) : '',
      postedAt: placed ? dayMonth(placed, now) : undefined,
      salary: pay && text(pay) ? { text: text(pay) } : undefined,
    });
  }
  return offers;
}

export const jobsAcUk: Provider = {
  id: 'jobs-ac-uk',
  async fetch(entry, ctx) {
    const http = ctx as HttpCtx;
    const pages = intField(entry.max_pages, DEFAULT_MAX_PAGES, 1, HARD_MAX_PAGES);
    const offers: BoardOffers = [];
    const seen = new Set<string>();
    let first = true;
    for (const keyword of searchTerms(entry)) {
      for (let page = 1; page <= pages; page++) {
        if (!first) await pause(GAP_MS);
        first = false;
        const html = await http.fetchText(jobsAcUkUrl(entry, keyword, page), {
          headers: BROWSER_HEADERS,
          timeoutMs: 30_000,
        });
        const got = jobsAcUkPage(html);
        // A place the site has no filter for finds nothing, which looks like "no jobs there". The filter
        // list is only on a page with no filter applied, so read it from one.
        if (!got.length && page === 1 && wantedFacets(entry).length) {
          const offered = offeredFacets(
            await http.fetchText(
              jobsAcUkUrl({ ...entry, locations: [], location: '' }, keyword, 1),
              {
                headers: BROWSER_HEADERS,
                timeoutMs: 30_000,
              },
            ),
          );
          const unknown = wantedFacets(entry).filter((f) => offered.length && !offered.includes(f));
          if (unknown.length)
            throw new Error(
              `no jobs.ac.uk filter for ${unknown.map((u) => `"${u}"`).join(', ')}. It filters by country or region, such as united-kingdom, england, scotland, wales or london`,
            );
        }
        for (const o of got) {
          if (seen.has(o.url)) continue;
          seen.add(o.url);
          offers.push(o);
        }
        if (got.length < PAGE_SIZE) break;
        if (page === pages)
          offers.note = `read the newest ${offers.length} jobs for "${keyword}"; narrow the search or raise max_pages`;
      }
    }
    return offers;
  },
};
