import type { SourceEntry } from '@winnow/api';

/** Helpers shared by the boards that read a site's search pages. */

const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  pound: '£',
  euro: '€',
  ndash: '–',
  mdash: '—',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, body: string) => {
    if (body[0] === '#') {
      const code =
        body[1] === 'x' || body[1] === 'X'
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return NAMED[body.toLowerCase()] ?? m;
  });
}

/** Visible text of an HTML fragment, on one line. */
export function text(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

/** A list field as the entry may hold it: an array, or text split on commas. */
export const list = (v: unknown): string[] =>
  (Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : [])
    .map((x) => String(x).trim())
    .filter(Boolean);

/** The searches an entry asks for: one per keyword (at most 5), or one unfiltered search. */
export function searchTerms(entry: SourceEntry, max = 5): string[] {
  const terms = list(entry.keywords).slice(0, max);
  return terms.length ? terms : [''];
}

/** A whole number field, kept between `min` and `max`; `fallback` when missing or not a number. */
export function intField(v: unknown, fallback: number, min: number, max: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.max(Math.round(n), min), max) : fallback;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * "6 November 2026" or "06 Nov" as a UTC timestamp. A date with no year is the latest one that isn't
 * in the future (a job placed "28 Dec" seen on 2 January was placed last year).
 */
export function dayMonth(raw: string, now = Date.now()): number | undefined {
  const m = /(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?(?:\s+(\d{4}))?/.exec(raw);
  if (!m) return undefined;
  const month = MONTHS.indexOf((m[2] as string).toLowerCase());
  if (month < 0) return undefined;
  const day = Number(m[1]);
  if (m[3]) return Date.UTC(Number(m[3]), month, day);
  const year = new Date(now).getUTCFullYear();
  const thisYear = Date.UTC(year, month, day);
  return thisYear > now + 86_400_000 ? Date.UTC(year - 1, month, day) : thisYear;
}

export const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** What we say we are to sites that read their server logs: a browser-like agent, as the vendored providers use. */
export const BROWSER_HEADERS = {
  accept: 'text/html,application/xhtml+xml',
  'accept-language': 'en-GB,en;q=0.9',
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
};
