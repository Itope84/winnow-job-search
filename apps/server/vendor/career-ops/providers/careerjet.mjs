// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Careerjet provider — keyword-first aggregator search, added 2026-09-11 to
// cover Ireland: https://www.careerjet.com/partners/api
//
// WHY THIS EXISTS: Adzuna (the other job_boards aggregator in this project)
// has NO Ireland coverage — its API hard-rejects country "ie" (confirmed live
// against the real endpoint, not just from docs: HTTP 404 UNSUPPORTED_COUNTRY,
// listing 19 codes that omit "ie"). Careerjet runs a real Ireland site
// (careerjet.ie, confirmed live) and its v4 API takes a `locale_code` of
// `en_IE`, so it fills the gap Adzuna leaves for this project's primary
// market. See portals.yml's job_boards block comment for the Adzuna story.
//
// ✅ VERIFIED LIVE 2026-09-11 against the real endpoint with a real key and
// real Irish job data (353 hits for "marketing executive" in en_IE — Urban
// Thread Limited, WDZ Partnership, Soniya Beauty Studio, etc., all genuine
// Dublin-area postings). Two things the docs got wrong or omitted, both fixed
// below based on the live response, not guesswork:
//   1. The API ALSO requires a `Referer` header ("Undeclared referrer. Please
//      add a Referer header." on HTTP 403) — undocumented in every doc source
//      checked. Any value satisfies it (tested with a plain example.com
//      Referer, not the registered site) — see REFERER below.
//   2. The account's key was additionally IP-restricted at first (separate
//      403: "Unauthorized access from IP ...") until whitelisted on the
//      Careerjet Publisher dashboard. If this starts failing again with that
//      exact error, the IP allowlist is the first thing to check.
//
// ⚠️ KNOWN UNSOLVED ISSUE — unstable `url`, confirmed live: the SAME job
// (identical company+title) returned a COMPLETELY DIFFERENT `url` on two
// calls 3 seconds apart (both routed through jobviewtrack.com as opaque,
// single-use-looking tokens — no stable ad ID to extract, unlike Adzuna's
// `/jobs/details/{id}` path). scan.mjs's cross-run dedup in scan-history.tsv
// is keyed on `job.url`, so THIS PROVIDER WILL RE-SURFACE THE SAME JOB AS
// "NEW" ON EVERY SCAN RUN — there is no fix available at the provider level
// (scan.mjs owns the dedup keying, not the provider). Blast radius is bounded,
// not silent corruption: merge-tracker.mjs dedupes applications.md on
// company+fuzzy-role match, NOT url (see its own header comment), so the
// final tracker will NOT accumulate duplicate rows — the real cost is (a)
// wasted evaluate-tier spend re-scoring jobs already seen, and (b) growing
// scan-history.tsv / possible duplicate report files across repeated runs.
// Decide with the user whether that trade-off is acceptable before treating
// this as a fire-and-forget scheduled scan source.
//
// CREDENTIALS: needs CAREERJET_API_KEY in .env (gitignored). Sign up for a
// free Publisher account at https://www.careerjet.com/partners/api to get a
// key. Absent key = a hard, explicit error (same convention as adzuna.mjs),
// not a silent empty board.
//
// AUTH: HTTP Basic, API key as username, empty password — i.e. the
// Authorization header is `Basic ` + base64(`${apiKey}:`). Confirmed live.
//
// REQUIRED PARAMS/HEADERS Careerjet's API rejects without:
//   - `user_ip` / `user_agent` query params — this is a server-to-server
//     scanner, not a live visitor's browser, so both are sent as fixed
//     placeholder values (see USER_IP / USER_AGENT below), a deliberate
//     adaptation of an API designed for embedding a search box on a
//     visitor-facing website.
//   - `Referer` HTTP header — any value works (confirmed live); sent as a
//     fixed placeholder (see REFERER below) for the same reason as above.
//
// SALARY NORMALIZATION: Careerjet returns `salary_type` (Y/M/W/D/H) alongside
// salary_min/max — unlike Adzuna, which is always an annual figure. scan.mjs's
// salary_filter compares against an annual threshold, so non-annual figures
// are annualized here with the approximations documented on ANNUALIZE_FACTOR
// below. This is a best-effort conversion, not exact.
//
// Wire in via a `job_boards:` entry with `provider: careerjet`.

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { decodeEntities } from './_html-entities.mjs';
import { BROWSER_LIKE_USER_AGENT } from './_http.mjs';

// Careerjet's `description` excerpt wraps matched keywords in <b>...</b> —
// confirmed live (2026-09-11): "Job Title: <b>Marketing</b> <b>Executive</b>
// Company Name: ...". _html-entities.mjs only decodes entities, not tags, so
// strip tags here before decoding whatever entities remain in the plain text.
function stripHtmlTags(s) {
  return s.replace(/<[^>]*>/g, '');
}

const API_BASE = 'https://search.api.careerjet.net/v4/query';
const PER_PAGE_MAX = 100; // Careerjet's documented cap
const DEFAULT_PER_PAGE = 20; // Careerjet's own default when page_size is omitted
const DEFAULT_MAX_PAGES = 3;
const MAX_PAGES_CAP = 10; // Careerjet's documented `page` range is 1-10
const DEFAULT_LOCALE = 'en_GB';

// Careerjet requires a user_ip/user_agent pair (see header note). These are
// fixed placeholders for a server-side scanner, not a real visitor's values.
const USER_IP = '127.0.0.1';
const USER_AGENT = BROWSER_LIKE_USER_AGENT;

// Careerjet also requires a Referer HEADER (undocumented — found live via a
// 403 "Undeclared referrer" error) or the request is rejected outright.
// Confirmed live that any value works; this is a fixed placeholder for the
// same reason USER_IP/USER_AGENT are.
const REFERER = 'https://career-ops.local/';

// Best-effort annualization for non-yearly salary_type values. Y is already
// annual (factor 1). M/W assume no unpaid gaps; D assumes a 5-day, 52-week
// working year (260 days); H assumes a 40-hour, 52-week working year (2080
// hours). All four are approximations — good enough for a coarse
// salary_filter threshold check, not for anything precise.
const ANNUALIZE_FACTOR = { Y: 1, M: 12, W: 52, D: 260, H: 2080 };

// ── Cross-run dedup store (Option B, added 2026-09-11) ──────────────────────
//
// WHY THIS PROVIDER OWNS ITS OWN STATE (every other provider is stateless):
// scan.mjs's cross-run dedup keys on `job.url` via data/scan-history.tsv, but
// Careerjet's `url` is a jobviewtrack.com token that is DIFFERENT on every
// single call for the same job — confirmed live (see file header). Unlike
// Adzuna's redirect (which has a stable numeric ad ID to canonicalize
// against), there is nothing stable to extract from Careerjet's url. Without
// this, the SAME job resurfaces as "new" on every scan forever.
//
// FIX: this provider keeps its own lightweight seen-store
// (data/careerjet-seen.tsv, gitignored — see .gitignore) keyed on normalized
// company+title+location, NOT url. Before returning jobs from fetch(), it
// drops anything already seen within `dedup_window_days` (default 30, matching
// this project's scan_history.recheck_after_days default — entries can't read
// that global config value directly, since ctx only exposes transport
// helpers, not the full portals.yml, so it's a separate per-entry setting
// that happens to share the same default). By the time scan.mjs sees the
// list, true duplicates are already gone — its own url-keyed scan-history.tsv
// never gets a second chance to (fail to) recognize the same job.
//
// TRADE-OFF: a company that reposts the exact same title as a genuinely NEW
// opening within the window stays suppressed until the window expires. This
// project already has detect-reposts.mjs for surfacing real reposts as a
// signal, so it's a narrow edge case, not a blind spot this provider is
// introducing — repost detection just won't see Careerjet-sourced reposts
// during the suppression window.
const SEEN_STORE_PATH = 'data/careerjet-seen.tsv';
const DEFAULT_DEDUP_WINDOW_DAYS = 30;

/** Resolve the dedup window in days: a positive integer `dedup_window_days` on the entry, else the default. */
function resolveDedupWindowDays(entry) {
  const v = entry?.dedup_window_days;
  if (Number.isInteger(v) && v > 0) return v;
  return DEFAULT_DEDUP_WINDOW_DAYS;
}

/** Normalized company+title+location key — same normalization style as adzuna.mjs's dedupKey. */
function seenKey(job) {
  const norm = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  return `${norm(job.company)}\t${norm(job.title)}\t${norm(job.location)}`;
}

/**
 * Read the seen-store into a Map<key, firstSeenEpochMs>. Missing/corrupt file
 * → empty map (never fatal; worst case this run treats everything as new
 * again, no different from before this feature existed).
 *
 * @returns {Map<string, number>}
 */
function loadSeenStore() {
  const map = new Map();
  if (!existsSync(SEEN_STORE_PATH)) return map;
  let text = '';
  try {
    text = readFileSync(SEEN_STORE_PATH, 'utf-8');
  } catch {
    return map;
  }
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const tabIdx = trimmed.lastIndexOf('\t');
    if (tabIdx < 0) continue;
    const key = trimmed.slice(0, tabIdx);
    const ts = Number(trimmed.slice(tabIdx + 1));
    if (key && Number.isFinite(ts)) map.set(key, ts);
  }
  return map;
}

/**
 * Filter `jobs` down to ones NOT seen within `windowDays`, and persist the
 * updated (pruned + refreshed) store. A job's first-seen timestamp is
 * preserved across calls within the window — only reset when it reappears
 * AFTER expiring, which is what lets it count as "new" again post-window.
 *
 * @param {Array<{title: string, company: string, location: string}>} jobs
 * @param {number} windowDays
 * @returns {typeof jobs} the subset of `jobs` not currently suppressed
 */
function filterAndUpdateSeenStore(jobs, windowDays) {
  const windowMs = windowDays * 24 * 60 * 60 * 1000;
  const now = Date.now();
  const store = loadSeenStore();

  const kept = [];
  for (const job of jobs) {
    const key = seenKey(job);
    const seenAt = store.get(key);
    const withinWindow = Number.isFinite(seenAt) && now - seenAt < windowMs;
    if (withinWindow) continue; // suppressed — already surfaced recently
    kept.push(job);
    store.set(key, seenAt ?? now); // preserve original first-seen; stamp fresh only if new/expired
  }

  // Prune anything past the window — no longer useful for suppression, so no
  // reason to keep it around (keeps the file bounded, not growing forever).
  const lines = [];
  for (const [key, ts] of store) {
    if (now - ts < windowMs) lines.push(`${key}\t${ts}`);
  }
  try {
    writeFileSync(SEEN_STORE_PATH, lines.join('\n') + (lines.length ? '\n' : ''), 'utf-8');
  } catch (err) {
    // Non-fatal: worst case the store doesn't persist and dedup silently
    // degrades to "everything looks new" next run — same as before this
    // feature existed, not a regression.
    console.error(`⚠️  careerjet: failed to persist ${SEEN_STORE_PATH} — ${err.message}`);
  }

  return kept;
}

/**
 * Read the API key from the environment. scan.mjs loads dotenv before
 * importing providers, so .env values are already on process.env by fetch time.
 *
 * @returns {string}
 */
function readApiKey() {
  const key = (process.env.CAREERJET_API_KEY || '').trim();
  if (!key) {
    throw new Error(
      'careerjet: missing CAREERJET_API_KEY — add to .env (free Publisher account: ' +
        'https://www.careerjet.com/partners/api). Set enabled: false on the Careerjet ' +
        'job_boards entry to skip it instead.',
    );
  }
  return key;
}

/** @param {string} apiKey @returns {string} */
function buildAuthHeader(apiKey) {
  return `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}`;
}

/** Resolve the page cap: a positive integer `max_pages` on the entry, capped. */
function resolveMaxPages(entry) {
  const v = entry?.max_pages;
  if (Number.isInteger(v) && v > 0) return Math.min(v, MAX_PAGES_CAP);
  return DEFAULT_MAX_PAGES;
}

/** Resolve page_size: positive integer, clamped to Careerjet's 100 cap. */
function resolvePerPage(entry) {
  const v = entry?.results_per_page;
  if (Number.isInteger(v) && v > 0) return Math.min(v, PER_PAGE_MAX);
  return DEFAULT_PER_PAGE;
}

/** @param {any} entry @returns {string} */
function resolveLocale(entry) {
  const raw = typeof entry?.locale_code === 'string' ? entry.locale_code.trim() : '';
  if (!raw) return DEFAULT_LOCALE;
  // Loose shape check only (xx_XX) — Careerjet itself is the source of truth
  // on which locales actually exist; a wrong-but-shaped code surfaces as a
  // clear HTTP 400 from the API rather than failing silently here.
  if (!/^[a-z]{2}_[A-Z]{2}$/.test(raw)) {
    throw new Error(`careerjet: locale_code must look like "en_IE", got "${raw}"`);
  }
  return raw;
}

/**
 * Build one search-page URL (no credentials in the URL — those go in the
 * Authorization header, so this is safe to log unlike Adzuna's). Exported for
 * unit tests.
 *
 * @param {any} entry
 * @param {number} page
 * @returns {string}
 */
export function buildCareerjetUrl(entry, page) {
  const params = new URLSearchParams({
    locale_code: resolveLocale(entry),
    page: String(page),
    page_size: String(resolvePerPage(entry)),
    user_ip: (typeof entry?.user_ip === 'string' && entry.user_ip.trim()) || USER_IP,
    user_agent: (typeof entry?.user_agent === 'string' && entry.user_agent.trim()) || USER_AGENT,
  });

  /** @param {string} key @param {unknown} val */
  const addStr = (key, val) => {
    if (typeof val === 'string' && val.trim()) params.set(key, val.trim());
  };
  /** @param {string} key @param {unknown} val */
  const addNum = (key, val) => {
    if (Number.isFinite(val) && Number(val) > 0) params.set(key, String(val));
  };

  addStr('keywords', entry?.keywords ?? entry?.what_or); // what_or accepted as an alias so an entry copy-pasted from an Adzuna block still works
  addStr('location', entry?.where ?? entry?.location);
  addStr('contract_type', entry?.contract_type);
  addStr('work_hours', entry?.work_hours);
  addStr('sort', entry?.sort);
  addNum('radius', entry?.radius);

  return `${API_BASE}?${params.toString()}`;
}

/**
 * Normalize a single Careerjet job result. Exported for unit tests.
 *
 * Field mapping → the normalized Job shape:
 *   - title:       `title`, HTML-entity-decoded and trimmed (no title → dropped).
 *   - url:         `url`, must be absolute https (malformed/non-https values
 *                  are dropped). Confirmed live: this is a jobviewtrack.com
 *                  redirect with NO stable per-ad ID — the same job returns a
 *                  different url on every call. Still passed through as-is
 *                  (it's the real, correct link to visit), but see the
 *                  KNOWN UNSOLVED ISSUE in the file header re: scan.mjs's
 *                  url-keyed cross-run dedup.
 *   - company:     `company`, falling back to the entry name.
 *   - location:    `locations` (Careerjet's field is plural).
 *   - description: `description` — a short excerpt (fragment_size chars),
 *                  HTML-tag-stripped (confirmed live: wraps matches in
 *                  <b>...</b>) then entity-decoded. Same "filtering aid, not
 *                  the full JD" caveat as Adzuna's description field.
 *   - postedAt:    `date` (GMT string) → epoch ms (omitted when unparseable).
 *   - salary:      `{ min, max, currency }`, annualized via ANNUALIZE_FACTOR
 *                  when `salary_type` isn't already "Y". Omitted entirely when
 *                  Careerjet supplies no salary data, so scan.mjs's
 *                  salary_filter passes the job conservatively.
 *
 * @param {any} j
 * @param {string} [fallbackCompany]
 * @returns {{ title: string, url: string, company: string, location: string, description?: string, postedAt?: number, salary?: { min: number, max: number, currency: string } } | null}
 */
export function normalizeCareerjetJob(j, fallbackCompany) {
  if (!j || typeof j !== 'object') return null;

  const title = typeof j.title === 'string' ? decodeEntities(j.title).trim() : '';
  if (!title) return null;

  let url = '';
  const rawUrl = typeof j.url === 'string' ? j.url.trim() : '';
  if (rawUrl) {
    try {
      const parsed = new URL(rawUrl);
      if (parsed.protocol === 'https:') url = parsed.href;
    } catch {
      // malformed URL → leave url = '' → dropped below
    }
  }
  if (!url) return null;

  const rawCompany = j.company;
  const company =
    typeof rawCompany === 'string' && rawCompany.trim()
      ? decodeEntities(rawCompany).trim()
      : fallbackCompany || 'Careerjet';

  const rawLocation = j.locations;
  const location = typeof rawLocation === 'string' ? decodeEntities(rawLocation).trim() : '';

  /** @type {{ title: string, url: string, company: string, location: string, description?: string, postedAt?: number, salary?: { min: number, max: number, currency: string } }} */
  const job = { title, url, company, location };

  const desc = typeof j.description === 'string' ? decodeEntities(stripHtmlTags(j.description)).trim() : '';
  if (desc) job.description = desc;

  if (typeof j.date === 'string') {
    const ts = Date.parse(j.date);
    if (Number.isFinite(ts)) job.postedAt = ts;
  }

  const currency = typeof j.salary_currency_code === 'string' ? j.salary_currency_code.trim() : '';
  const sMin = Number(j.salary_min);
  const sMax = Number(j.salary_max);
  const hasSalary = currency && ((Number.isFinite(sMin) && sMin > 0) || (Number.isFinite(sMax) && sMax > 0));
  if (hasSalary) {
    const factor = ANNUALIZE_FACTOR[j.salary_type] ?? 1; // unknown salary_type: treat as already-annual rather than drop the data
    job.salary = {
      min: Math.round((Number.isFinite(sMin) && sMin > 0 ? sMin : sMax) * factor),
      max: Math.round((Number.isFinite(sMax) && sMax > 0 ? sMax : sMin) * factor),
      currency,
    };
  }

  return job;
}

/** @type {Provider} */
export default {
  id: 'careerjet',

  async fetch(entry, ctx) {
    const apiKey = readApiKey();
    const authHeader = buildAuthHeader(apiKey);
    // ctx.maxPages is verify-portals.mjs's health probe asking for page 1 only.
    const maxPages = Number.isInteger(ctx?.maxPages) && ctx.maxPages > 0
      ? Math.min(ctx.maxPages, resolveMaxPages(entry))
      : resolveMaxPages(entry);
    const perPage = resolvePerPage(entry);
    const fallbackCompany = entry?.name;

    const out = [];

    for (let page = 1; page <= maxPages; page++) {
      const url = buildCareerjetUrl(entry, page);
      const json = await ctx.fetchJson(url, {
        redirect: 'error', // SSRF guard, same convention as adzuna.mjs
        headers: { Authorization: authHeader, Referer: REFERER },
      });

      if (json?.type === 'LOCATIONS') {
        throw new Error(
          `careerjet: location "${entry?.where ?? entry?.location ?? ''}" is ambiguous — ` +
            `Careerjet returned a disambiguation list instead of jobs. Set a more specific ` +
            `\`location\`/\`where\` value on this job_boards entry.`,
        );
      }
      if (!json || json.type !== 'JOBS' || !Array.isArray(json.jobs)) {
        throw new Error(
          `careerjet: unexpected API response on page ${page} — expected { type: "JOBS", jobs: [...] }, got: ${json ? JSON.stringify(json).slice(0, 200) : 'null'}`,
        );
      }

      for (const j of json.jobs) {
        const normalized = normalizeCareerjetJob(j, fallbackCompany);
        if (normalized) out.push(normalized);
      }

      const totalPages = Number(json.pages);
      if (Number.isFinite(totalPages) && page >= totalPages) break;
      if (json.jobs.length < perPage) break; // short page → last page reached
      if (ctx?.sleep) await ctx.sleep(250); // be polite to the free tier
    }

    // Cross-run dedup (Option B — see the block comment above SEEN_STORE_PATH):
    // url is unstable across calls, so filter on company+title+location
    // instead, via this provider's own persisted store.
    return filterAndUpdateSeenStore(out, resolveDedupWindowDays(entry));
  },
};
