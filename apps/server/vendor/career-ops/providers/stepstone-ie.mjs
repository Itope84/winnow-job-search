// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// StepStone Ireland provider — irishjobs.ie and jobs.ie, added 2026-09-13.
//
// WHY THIS EXISTS: both `search_queries` entries pointing at these sites
// (`site:irishjobs.ie ...`, `site:jobs.ie ...`) were dead weight in practice —
// 11 of 11 hits from the 2026-09-11 scan run came back `skipped_expired` (see
// data/scan-history.tsv), because that path goes through Google's stale index
// of these sites, not the sites themselves. This provider fetches the real,
// live listing pages directly instead.
//
// ✅ VERIFIED LIVE 2026-09-13, through this exact code path (Node's global
// fetch via ctx.fetchText):
//   - Both hosts are the same StepStone Group platform (confirmed via shared
//     TLS certificate subject and near-identical job ids across the two
//     sites) and serve byte-identical listing markup — one parser covers
//     both, selected by the entry's `site` field.
//   - Listing pages are plain server-rendered HTML — no JS execution needed.
//     `https://www.irishjobs.ie/jobs/marketing-executive` returned 25 job
//     cards on page 1 of 74 total matches; `?page=2` genuinely advances (real
//     pagination, unlike LinkedIn's guest search — see providers/linkedin.mjs).
//   - irishjobs.ie and jobs.ie are NOT mirrors of each other — the same
//     "marketing-executive" category returned 74 results on irishjobs.ie vs.
//     35 on jobs.ie, with genuinely different postings in each (e.g. Oxfam
//     Ireland and Bolands appeared only on jobs.ie's list) — both are worth
//     tracking as distinct entries, not just one with a fallback.
//   - Each card carries a STABLE url: the href itself embeds the real numeric
//     job id in its path (e.g. `/job/marketing-executive/tirlan-job107970528`)
//     with no per-request tracking token — unlike this project's Careerjet
//     provider, this needs no custom cross-run dedup store; scan.mjs's normal
//     url-keyed scan-history.tsv works as-is.
//
// ⚠️ NOT the schema.org JobPosting data: individual job DETAIL pages do carry
// JobPosting JSON-LD (title/datePosted/hiringOrganization/description), but
// its `jobLocation.address` fields are all empty strings in every detail page
// checked live — useless for this project's location_filter. Fetching a
// detail page per job would also mean ~25-75 extra requests per category per
// scan, working against the "stay low-volume" principle this project applies
// to every scraped (non-API) source. So this provider reads company/location/
// posted-date straight off the LISTING page instead (via stable `data-at`/
// `data-testid` test-id attributes StepStone ships for its own QA — not CSS
// classes, which are hashed/regenerated per build and unsuitable as anchors),
// and never fetches a detail page at all.
//
// ⚠️ NO MACHINE-READABLE DATE ON THE LISTING PAGE: postedAt is parsed from the
// card's human-readable "N hours/days/weeks ago" text (there is no datetime
// attribute on this element, unlike LinkedIn's). This is a best-effort
// approximation to day/hour granularity, not exact — same spirit as
// careerjet.mjs's ANNUALIZE_FACTOR salary conversion. Unparseable phrasing
// (anything outside hour/day/week/month, "today", "yesterday") is omitted
// rather than guessed at, consistent with every other provider in this
// project (see _types.js's Job.postedAt doc).
//
// ⚠️ SLUG SEARCH ONLY: the flexible `/jobs?q=...` search endpoint was tested
// live and returned 0 results (it appears to be a client-side-only search
// with no server-rendered fallback) — only the pre-rendered category-slug
// pages like `/jobs/marketing-executive` work. This means ONE job_boards
// entry covers ONE title phrase (its slugified form), not a boolean OR of
// several — portals.yml needs one entry per title cluster, the same
// granularity this project's Careerjet/search_queries entries already use.
//
// Wire in via a `job_boards:` entry with `provider: stepstone-ie`,
// `category: "marketing-executive"` (the URL slug), and optionally
// `site: "jobsie"` (default: "irishjobs").

import { BROWSER_LIKE_USER_AGENT } from './_http.mjs';
import { decodeEntities } from './_html-entities.mjs';

const HOSTS = { irishjobs: 'www.irishjobs.ie', jobsie: 'www.jobs.ie' };
const ALLOWED_HOSTS = new Set(Object.values(HOSTS));
const DEFAULT_MAX_PAGES = 3;
const MAX_PAGES_CAP = 10; // safety cap, mirrors careerjet.mjs's convention
const CARDS_PER_PAGE = 25; // observed live on both hosts

const RELATIVE_AGE_RE = /^(\d+)\s+(hour|day|week|month)s?\s+ago$/;
const UNIT_MS = { hour: 3_600_000, day: 86_400_000, week: 7 * 86_400_000, month: 30 * 86_400_000 };

/** @param {string} host @returns {string} */
function assertAllowedHost(host) {
  if (!ALLOWED_HOSTS.has(host)) {
    throw new Error(`stepstone-ie: untrusted hostname "${host}" — must be one of: ${[...ALLOWED_HOSTS].join(', ')}`);
  }
  return host;
}

/** @param {any} entry @returns {string} */
function resolveHost(entry) {
  const site = typeof entry?.site === 'string' ? entry.site.trim().toLowerCase() : 'irishjobs';
  const host = HOSTS[site];
  if (!host) throw new Error(`stepstone-ie: unknown site "${entry?.site}" — must be "irishjobs" or "jobsie"`);
  return assertAllowedHost(host);
}

/** @param {any} entry @returns {string} */
function resolveCategory(entry) {
  const raw = typeof entry?.category === 'string' ? entry.category.trim() : '';
  if (!raw) throw new Error('stepstone-ie: entry is missing `category` (the URL slug, e.g. "marketing-executive")');
  if (!/^[a-z0-9-]+$/.test(raw)) {
    throw new Error(`stepstone-ie: \`category\` must be a URL slug (lowercase letters/digits/hyphens only), got "${raw}"`);
  }
  return raw;
}

/** @param {any} entry @returns {number} */
function resolveMaxPages(entry) {
  const v = entry?.max_pages;
  if (Number.isInteger(v) && v > 0) return Math.min(v, MAX_PAGES_CAP);
  return DEFAULT_MAX_PAGES;
}

/**
 * Build one listing-page URL. Exported for unit tests.
 * @param {any} entry
 * @param {number} page
 * @returns {string}
 */
export function buildStepstoneUrl(entry, page) {
  const host = resolveHost(entry);
  const category = resolveCategory(entry);
  const base = `https://${host}/jobs/${category}`;
  return page > 1 ? `${base}?page=${page}` : base;
}

/**
 * Approximate an epoch ms timestamp from StepStone's relative "N units ago"
 * listing-page text. Exported for unit tests. Returns undefined for anything
 * that doesn't match a known phrasing, rather than guessing.
 *
 * @param {string} text
 * @param {number} [now]
 * @returns {number | undefined}
 */
export function parseRelativeAge(text, now = Date.now()) {
  if (typeof text !== 'string') return undefined;
  const t = text.trim().toLowerCase();
  if (t === 'today' || t === 'just posted') return now;
  if (t === 'yesterday') return now - UNIT_MS.day;
  const m = t.match(RELATIVE_AGE_RE);
  if (!m) return undefined;
  const n = Number(m[1]);
  const unitMs = UNIT_MS[m[2]];
  if (!Number.isFinite(n) || !unitMs) return undefined;
  return now - n * unitMs;
}

/**
 * First non-empty, non-CSS text run found scanning forward from `fromIdx`.
 * StepStone's server HTML inlines a `<style data-emotion="...">` tag directly
 * before some elements' content — confirmed live, and without this guard the
 * first job card on a page yields raw CSS instead of its title/company text.
 * Real label text never contains `{`/`}` or starts with the `res-`/`.res-`
 * hashed class-name prefix, so that's what's filtered out here.
 *
 * @param {string} chunk
 * @param {number} fromIdx
 * @returns {string | null}
 */
function firstLabelTextAfter(chunk, fromIdx) {
  const re = />\s*([^<>\s][^<>]*)</g;
  re.lastIndex = fromIdx;
  let m;
  while ((m = re.exec(chunk))) {
    const text = m[1].trim();
    if (!text) continue;
    if (text.includes('{') || text.includes('}') || text.startsWith('.res-') || text.startsWith('res-')) continue;
    return text;
  }
  return null;
}

/**
 * Parse one StepStone listing page into normalized jobs. Exported for unit
 * tests. Cards are located by the stable `id="job-item-<id>"` marker on each
 * `<article>` and sliced up to the next marker — no HTML parser dependency,
 * same convention as this project's other regex-based providers.
 *
 * @param {string} html
 * @param {string} host
 * @param {string} [fallbackCompany]
 * @param {number} [now]
 * @returns {Array<{title: string, url: string, company: string, location: string, postedAt?: number}>}
 */
export function parseStepstoneListingHtml(html, host, fallbackCompany, now = Date.now()) {
  if (typeof html !== 'string' || !html) return [];
  const markers = [...html.matchAll(/id="job-item-\d+"/g)];
  const jobs = [];

  for (let i = 0; i < markers.length; i++) {
    const start = markers[i].index ?? 0;
    const end = i + 1 < markers.length ? (markers[i + 1].index ?? html.length) : html.length;
    const chunk = html.slice(start, end);

    const hrefMatch = chunk.match(/href="(\/job\/[^"]+)"/);
    if (!hrefMatch) continue;
    const url = `https://${host}${hrefMatch[1]}`;

    const titleIdx = chunk.indexOf('data-testid="job-item-title"');
    const rawTitle = titleIdx >= 0 ? firstLabelTextAfter(chunk, titleIdx) : null;
    const title = rawTitle ? decodeEntities(rawTitle) : '';
    if (!title) continue;

    const companyIdx = chunk.indexOf('data-at="job-item-company-name"');
    const rawCompany = companyIdx >= 0 ? firstLabelTextAfter(chunk, companyIdx) : null;
    const company = (rawCompany ? decodeEntities(rawCompany) : '') || fallbackCompany || 'StepStone';

    const locationIdx = chunk.indexOf('data-at="job-item-location"');
    const rawLocation = locationIdx >= 0 ? firstLabelTextAfter(chunk, locationIdx) : null;
    const location = rawLocation ? decodeEntities(rawLocation) : '';

    /** @type {{title: string, url: string, company: string, location: string, postedAt?: number}} */
    const job = { title, url, company, location };

    const timeagoIdx = chunk.indexOf('data-at="job-item-timeago"');
    const timeagoText = timeagoIdx >= 0 ? firstLabelTextAfter(chunk, timeagoIdx) : null;
    const postedAt = timeagoText ? parseRelativeAge(timeagoText, now) : undefined;
    if (postedAt !== undefined) job.postedAt = postedAt;

    jobs.push(job);
  }

  return jobs;
}

/** @type {Provider} */
export default {
  id: 'stepstone-ie',

  async fetch(entry, ctx) {
    const host = resolveHost(entry);
    // ctx.maxPages is verify-portals.mjs's health probe asking for page 1 only.
    const maxPages = Number.isInteger(ctx?.maxPages) && ctx.maxPages > 0
      ? Math.min(ctx.maxPages, resolveMaxPages(entry))
      : resolveMaxPages(entry);

    const out = [];
    for (let page = 1; page <= maxPages; page++) {
      const url = buildStepstoneUrl(entry, page);
      const html = await ctx.fetchText(url, {
        redirect: 'error', // SSRF guard, same convention as every other provider
        headers: {
          'user-agent': BROWSER_LIKE_USER_AGENT,
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'accept-language': 'en-IE,en;q=0.9',
        },
      });

      const jobs = parseStepstoneListingHtml(html, host, entry?.name);
      out.push(...jobs);
      if (jobs.length < CARDS_PER_PAGE) break; // short page → last page reached
      if (ctx?.sleep) await ctx.sleep(250); // be polite, same convention as careerjet.mjs
    }

    if (out.length === 0) {
      throw new Error(
        `stepstone-ie: 0 jobs parsed for category "${entry?.category}" on ${host} — likely an upstream markup ` +
          'change or a genuinely empty category. Inspect the raw response before assuming this entry is broken.',
      );
    }
    return out;
  },
};
