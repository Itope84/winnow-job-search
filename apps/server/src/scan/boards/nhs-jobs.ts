import type { SourceEntry } from '@winnow/api';
import type { Offer } from '../intake.ts';
import type { BoardOffers, HttpCtx, Provider } from '../providers.ts';
import {
  BROWSER_HEADERS,
  dayMonth,
  decodeEntities,
  intField,
  pause,
  searchTerms,
  text,
} from './html.ts';

/**
 * NHS Jobs (jobs.nhs.uk), the one place NHS trusts and many GP practices advertise. It has no public
 * API, so this reads the search results page a person would open, 10 jobs a page, newest first.
 * Fields: `keywords` (a list, or text split on commas: one search each, at most 5), `location` (a town,
 * city or postcode in England or Wales; "Leeds, UK" is tried as "Leeds" when NHS doesn't know it whole;
 * "Remote" means no place), `distance` (miles around it, 20 if not given), `max_pages` (2 by default,
 * 10 at most).
 */
const SEARCH = 'https://www.jobs.nhs.uk/candidate/search/results';
const ORIGIN = 'https://www.jobs.nhs.uk';
const PAGE_SIZE = 10;
const DEFAULT_MAX_PAGES = 2;
const HARD_MAX_PAGES = 10;
const GAP_MS = 400;

/**
 * The place to search around, or '' for the whole service. NHS matches any word to some place
 * ("Remote" finds jobs near Rame, in Cornwall), and it searches a radius around a country as if it were
 * a point, so words that mean "no place" are dropped.
 */
export function nhsPlace(raw: unknown): string {
  const place = typeof raw === 'string' ? raw.trim() : '';
  return /^(remote|anywhere|hybrid|nationwide|uk|united kingdom|great britain|britain|england|scotland|wales)$/i.test(
    place,
  )
    ? ''
    : place;
}

export function nhsUrl(
  entry: SourceEntry,
  keyword: string,
  page: number,
  location = nhsPlace(entry.location),
): string {
  const p = new URLSearchParams();
  if (keyword) p.set('keyword', keyword);
  if (location) {
    p.set('location', location);
    p.set('distance', String(intField(entry.distance, 20, 1, 200)));
  }
  p.set('language', 'en');
  p.set('sort', 'publicationDateDesc');
  if (page > 1) p.set('page', String(page));
  return `${SEARCH}?${p}`;
}

const field = (block: string, test: string) =>
  new RegExp(`data-test="${test}"[\\s\\S]*?<strong[^>]*>([\\s\\S]*?)</strong>`).exec(block)?.[1];

/**
 * The jobs on one results page, and how many jobs the search found in all (null when it doesn't say).
 * `unknownPlace` is set when NHS answered "Location not found" instead of searching.
 */
export function nhsPage(
  html: string,
  now = Date.now(),
): { offers: Offer[]; total: number | null; unknownPlace: boolean } {
  const blocks = html.split(/<li\b[^>]*data-test="search-result"[^>]*>/).slice(1);
  const found = /([\d,]+)\s+jobs?\s+found/i.exec(html)?.[1];
  const total = found ? Number(found.replace(/,/g, '')) : null;
  if (!blocks.length && /Location not found/i.test(html))
    return { offers: [], total: 0, unknownPlace: true };
  // A page that is neither results, "no results" nor "location not found" means the site changed.
  if (!blocks.length && !/No search results found/i.test(html)) {
    const title = /<title>([\s\S]*?)<\/title>/i.exec(html)?.[1];
    throw new Error(
      `the results page has changed shape (titled "${title ? text(title) : 'none'}"); this board needs updating`,
    );
  }
  const offers: Offer[] = [];
  for (const block of blocks) {
    const link =
      /<a\s+href="([^"]+)"[^>]*data-test="search-result-job-title"[^>]*>([\s\S]*?)<\/a>/.exec(
        block,
      );
    const title = link ? text(link[2] as string) : '';
    const ref = /\/candidate\/jobadvert\/([^/?#"]+)/.exec(decodeEntities(link?.[1] ?? ''))?.[1];
    if (!title || !ref) continue;
    const where =
      /data-test="search-result-location"[^>]*>\s*<h3[^>]*>([\s\S]*?)<div[^>]*>([\s\S]*?)<\/div>/.exec(
        block,
      );
    const employer = where ? text(where[1] as string) : '';
    const place = where ? text((where[2] as string).replace(/,\s*(<|$)/g, '$1')) : '';
    const salary = field(block, 'search-result-salary');
    const posted = field(block, 'search-result-publicationDate');
    offers.push({
      title,
      url: `${ORIGIN}/candidate/jobadvert/${ref}`,
      company: employer || 'NHS',
      location: place,
      postedAt: posted ? dayMonth(text(posted), now) : undefined,
      salary: salary ? { text: text(salary) } : undefined,
    });
  }
  return { offers, total, unknownPlace: false };
}

export const nhsJobs: Provider = {
  id: 'nhs-jobs',
  async fetch(entry, ctx) {
    const http = ctx as HttpCtx;
    const pages = intField(entry.max_pages, DEFAULT_MAX_PAGES, 1, HARD_MAX_PAGES);
    const offers: BoardOffers = [];
    const seen = new Set<string>();
    const wanted = nhsPlace(entry.location);
    // What to search around: the place as written, else the part before its first comma, found on the
    // first request and kept for the rest.
    const places = [...new Set([wanted, wanted.split(',')[0]?.trim() ?? ''])].filter(Boolean);
    let place = wanted;
    let first = true;
    for (const keyword of searchTerms(entry)) {
      for (let page = 1; page <= pages; page++) {
        if (!first) await pause(GAP_MS);
        first = false;
        const get = (where: string) =>
          http.fetchText(nhsUrl(entry, keyword, page, where), {
            headers: BROWSER_HEADERS,
            timeoutMs: 30_000,
          });
        let got = nhsPage(await get(place));
        if (got.unknownPlace && place === wanted && !offers.length) {
          for (const next of places.filter((p) => p !== place)) {
            await pause(GAP_MS);
            const again = nhsPage(await get(next));
            if (!again.unknownPlace) {
              place = next;
              got = again;
              break;
            }
          }
        }
        if (got.unknownPlace)
          throw new Error(
            `place "${wanted}" not found. Use an English or Welsh town, city or postcode, or leave the place empty to search everywhere`,
          );
        for (const o of got.offers) {
          if (seen.has(o.url)) continue;
          seen.add(o.url);
          offers.push(o);
        }
        if (got.offers.length < PAGE_SIZE) break;
        if (page === pages && got.total && got.total > page * PAGE_SIZE)
          offers.note = `read ${offers.length} jobs of ${got.total} for "${keyword}"; narrow the search or raise max_pages`;
      }
    }
    return offers;
  },
};
