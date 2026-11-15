import type { SourceEntry } from '@winnow/api';
import type { Offer } from '../intake.ts';
import type { BoardOffers, HttpCtx, Provider } from '../providers.ts';
import { BROWSER_HEADERS, intField, list, pause, searchTerms, text } from './html.ts';

/**
 * Jobberman, Nigeria's largest job board. No public API or feed, so this reads its search results page
 * (20 jobs a page). Fields: `keywords` (one search each, at most 5), `location` (a state or city,
 * "Lagos"), `max_pages` (2 by default, 6 at most).
 */
const SEARCH = 'https://www.jobberman.com/jobs';
const DEFAULT_MAX_PAGES = 2;
const HARD_MAX_PAGES = 6;
const GAP_MS = 500;

export function jobbermanUrl(entry: SourceEntry, keyword: string, page: number): string {
  const p = new URLSearchParams();
  if (keyword) p.set('q', keyword);
  const place = list(entry.location)[0];
  if (place) p.set('l', place.toLowerCase());
  if (page > 1) p.set('page', String(page));
  return `${SEARCH}?${p}`;
}

/** "Posted 2 weeks ago", "Posted yesterday", "Posted 3 days ago" → a timestamp. */
export function postedAgo(raw: string, now = Date.now()): number | undefined {
  const t = raw.toLowerCase();
  if (/today|hour|minute|just now/.test(t)) return now;
  if (/yesterday/.test(t)) return now - 86_400_000;
  const m = /(\d+)\s+(day|week|month)s?/.exec(t);
  if (!m) return undefined;
  const unit = { day: 1, week: 7, month: 30 }[m[2] as 'day' | 'week' | 'month'];
  return now - Number(m[1]) * unit * 86_400_000;
}

/** The jobs on one results page. */
export function jobbermanPage(html: string, now = Date.now()): Offer[] {
  const cards = html.match(/<article\b[^>]*data-cy="listing-cards-components"[\s\S]*?<\/article>/g);
  if (!cards) {
    if (/No results found|no jobs? found|0 results/i.test(html)) return [];
    if (!/data-cy="listing/.test(html))
      throw new Error('the results page has changed shape; this board needs updating.');
    return [];
  }
  const offers: Offer[] = [];
  for (const raw of cards) {
    const card = raw.replace(/<svg[\s\S]*?<\/svg>/g, '');
    const link =
      /<a\s+href="(https:\/\/www\.jobberman\.com\/listings\/[^"]+)"[^>]*data-cy="listing-title-link"[^>]*>([\s\S]*?)<\/a>/.exec(
        card,
      );
    if (!link) continue;
    const company = /<span\s+class="truncate text-text-secondary"\s*>([\s\S]*?)<\/span>/.exec(
      card,
    )?.[1];
    const posted = /(Posted [^<]*?ago|Posted (?:today|yesterday))/i.exec(text(card))?.[1];
    const desc = /data-cy="description-tile"[^>]*>([\s\S]*?)<\/div>/.exec(card)?.[1];
    // The last row: place, job type, pay, each in its own span.
    const facts =
      /<div\s+class="flex flex-wrap items-end[^"]*"[^>]*>([\s\S]*?)<\/div>/.exec(card)?.[1] ?? '';
    const spans = [...facts.matchAll(/<span[^>]*>([\s\S]*?)<\/span>/g)].map((m) =>
      text(m[1] as string),
    );
    const pay = spans.find((s) => /\bNGN\b|₦/.test(s));
    offers.push({
      title: text(link[2] as string),
      url: link[1] as string,
      company: company ? text(company) : 'Jobberman',
      location: spans[0] && !/\bNGN\b|time|contract|intern/i.test(spans[0]) ? spans[0] : '',
      description: desc ? text(desc) : undefined,
      postedAt: posted ? postedAgo(posted, now) : undefined,
      salary: pay ? { text: pay, currency: 'NGN' } : undefined,
    });
  }
  return offers;
}

export const jobberman: Provider = {
  id: 'jobberman',
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
        const got = jobbermanPage(
          await http.fetchText(jobbermanUrl(entry, keyword, page), {
            headers: BROWSER_HEADERS,
            timeoutMs: 30_000,
          }),
        );
        const fresh = got.filter((o) => !seen.has(o.url));
        for (const o of fresh) seen.add(o.url);
        offers.push(...fresh);
        if (got.length < 20 || !fresh.length) break;
      }
    }
    return offers;
  },
};
