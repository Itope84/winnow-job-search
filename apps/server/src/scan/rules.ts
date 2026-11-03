import type { Rules } from '@winnow/api';

/**
 * The scan rules, ported from career-ops `scan.mjs` so imported `portals.yml` filters behave the same.
 * Each check returns null when the posting passes, or a short reason when it doesn't.
 */

/** Short alphanumeric keywords match as whole words (with an optional plural "s"); longer phrases as substrings. */
export function compileKeyword(kw: string): (lower: string) => boolean {
  if (/^[a-z0-9]+$/.test(kw)) {
    const re = new RegExp(`\\b${kw}s?\\b`);
    return (lower) => re.test(lower);
  }
  return (lower) => lower.includes(kw);
}

const norm = (list: string[]) =>
  list
    .filter((k) => typeof k === 'string')
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean);

/** Names a country goes by in job ads; an allowed place in one form matches the others. */
const COUNTRY_NAMES: string[][] = [
  [
    'uk',
    'u.k.',
    'united kingdom',
    'great britain',
    'britain',
    'england',
    'scotland',
    'wales',
    'northern ireland',
    'gb',
  ],
  ['us', 'u.s.', 'usa', 'u.s.a.', 'united states', 'united states of america'],
  ['uae', 'united arab emirates'],
  ['netherlands', 'the netherlands', 'holland'],
];
/** How job ads write "remote". */
const REMOTE_WORDS = [
  'remote',
  'home based',
  'home-based',
  'work from home',
  'wfh',
  'anywhere',
  'distributed',
];
/** Words that say how, not where: dropped when checking whether a location only names a country. */
const MODE_WORDS = [
  'remote',
  'hybrid',
  'on-site',
  'onsite',
  'on site',
  'in office',
  'in-person',
  'in person',
];
/** Regions a remote job may be limited to. A posting that names only these, and not the person's own
 * country or an open region, is remote somewhere they can't work from. */
const OTHER_REGIONS = [
  'americas',
  'north america',
  'south america',
  'latin america',
  'latam',
  'apac',
  'asia',
  'asia pacific',
  'us',
  'usa',
  'united states',
  'canada',
  'australia',
  'india',
  'mexico',
  'brazil',
];
const OPEN_REGIONS = ['emea', 'europe', 'worldwide', 'anywhere', 'global', 'international'];
const UNKNOWN_PLACE = /^(location\s+)?(unknown|not specified|unspecified|n\/a|tbc|tbd|various)$/;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A word or phrase on its own, not inside a longer word ("london" in "London (Hybrid)", not "Londonderry"). */
const wordRe = (term: string) => new RegExp(`(^|[^a-z0-9])${escape(term)}($|[^a-z0-9])`);
/** A location that only says how ("Hybrid", "In-Office"), not where: the place is unknown, not wrong. */
const NO_PLACE = [
  ...MODE_WORDS,
  'in-office',
  'office',
  'office based',
  'office-based',
  'flexible',
].map((w) => new RegExp(`(^|[^a-z0-9])${escape(w)}(?=$|[^a-z0-9])`, 'g'));
const placeless = (lower: string) => {
  let rest = lower;
  for (const re of NO_PLACE) rest = rest.replace(re, ' ');
  return !rest.replace(/[^a-z0-9]+/g, '');
};
const namesFor = (place: string) => COUNTRY_NAMES.find((g) => g.includes(place)) ?? [place];

/** The countries the person's allowed places are in, under all their names. */
function homeCountries(allow: string[]): string[] {
  return allow.flatMap((entry) => {
    const parts = entry
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    const last = parts.at(-1) ?? '';
    const group = COUNTRY_NAMES.find((g) => g.includes(last));
    return group ?? (parts.length > 1 ? [last] : []);
  });
}

/**
 * One allowed place, as a test on a lower-cased location. "London, UK" matches any location that names
 * London; its country also lets through a posting that names only that country ("United Kingdom",
 * "UK (Hybrid)"), since it may be anywhere there. "Remote" matches the ways ads write remote work,
 * except remote limited to regions away from the person's countries ("Home Based - Americas").
 */
function placeMatcher(entry: string, home: string[]): (lower: string) => boolean {
  const parts = entry
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  const head = parts[0] ?? '';
  if (REMOTE_WORDS.includes(head) || head === 'fully remote') {
    const res = REMOTE_WORDS.map(wordRe);
    // Without a home country there's no telling which regions are out, so any remote job passes.
    const elsewhere = home.length ? OTHER_REGIONS.filter((r) => !home.includes(r)).map(wordRe) : [];
    const open = [...OPEN_REGIONS, ...home].map(wordRe);
    return (lower) =>
      res.some((re) => re.test(lower)) &&
      !(elsewhere.some((re) => re.test(lower)) && !open.some((re) => re.test(lower)));
  }
  const names = namesFor(head).map(wordRe);
  const country = parts.length > 1 ? namesFor(parts.at(-1) ?? '') : null;
  const countryRes = country?.map(wordRe) ?? [];
  const strip = [...(country ?? []), ...MODE_WORDS].map(
    (w) => new RegExp(`(^|[^a-z0-9])${escape(w)}(?=$|[^a-z0-9])`, 'g'),
  );
  // A posting that names only the country, as the whole location or one item of a list
  // ("United Kingdom · Ireland · Spain"): nothing left once country names, work modes and punctuation go.
  // Commas don't split items: in "Manchester, United Kingdom" the country belongs to the city.
  const countryOnly = (item: string) => {
    if (!countryRes.some((re) => re.test(item))) return false;
    let rest = item;
    for (const re of strip) rest = rest.replace(re, ' ');
    return !rest.replace(/[^a-z0-9]+/g, '');
  };
  return (lower) =>
    names.some((re) => re.test(lower)) || lower.split(/[·;|\n]| or | \/ /).some(countryOnly);
}

export interface SalaryInfo {
  min?: number | null;
  max?: number | null;
  currency?: string | null;
}

export interface CompiledRules {
  title(title: string): string | null;
  location(location: string): string | null;
  salary(salary: SalaryInfo | null | undefined): string | null;
  age(postedAtMs: number | null | undefined): string | null;
}

export function compileRules(rules: Rules, now = Date.now()): CompiledRules {
  const positive = norm(rules.title.positive).map((k) => ({ k, m: compileKeyword(k) }));
  const negative = norm(rules.title.negative).map((k) => ({ k, m: compileKeyword(k) }));
  const alwaysAllow = norm(rules.location.alwaysAllow);
  const places = norm(rules.location.allow);
  const home = homeCountries(places);
  const allow = places.map((p) => placeMatcher(p, home));
  const block = norm(rules.location.block);
  const { min, max } = rules.salary;
  const currency = (rules.salary.currency || '').trim().toUpperCase();
  const cutoff = rules.maxAgeDays ? now - rules.maxAgeDays * 86_400_000 : null;

  return {
    title(title) {
      const lower = (title || '').toLowerCase();
      const neg = negative.find((n) => n.m(lower));
      if (neg) return `Title has “${neg.k}”`;
      if (positive.length && !positive.some((p) => p.m(lower)))
        return 'Title matches none of your roles';
      return null;
    },
    location(location) {
      if (typeof location !== 'string' || !location.trim()) return null;
      const lower = location.toLowerCase().trim();
      if (UNKNOWN_PLACE.test(lower)) return null;
      if (alwaysAllow.some((k) => lower.includes(k))) return null;
      const b = block.find((k) => lower.includes(k));
      if (b) return `Location “${location}” is blocked (${b})`;
      if (!allow.length || allow.some((matches) => matches(lower))) return null;
      // No place named: triage reads the posting for it.
      if (placeless(lower)) return null;
      return `Location “${location}” is outside your locations`;
    },
    salary(salary) {
      if (!salary || (min === 0 && max === 0)) return null;
      const jobMin = salary.min ?? salary.max ?? null;
      const jobMax = salary.max ?? salary.min ?? null;
      if (jobMin == null && jobMax == null) return null;
      const jobCurrency = (salary.currency || '').trim().toUpperCase();
      if (currency && jobCurrency && currency !== jobCurrency)
        return `Pay is in ${jobCurrency}, not ${currency}`;
      if (min > 0 && jobMax != null && jobMax < min)
        return `Pay ${fmt(jobMax, jobCurrency)} is under your ${fmt(min, currency)} floor`;
      if (max > 0 && jobMin != null && jobMin > max)
        return `Pay ${fmt(jobMin, jobCurrency)} is over your ${fmt(max, currency)} ceiling`;
      return null;
    },
    age(postedAt) {
      if (cutoff == null || typeof postedAt !== 'number' || !Number.isFinite(postedAt)) return null;
      return postedAt >= cutoff ? null : `Posted more than ${rules.maxAgeDays} days ago`;
    },
  };
}

function fmt(n: number, currency: string) {
  const sym = currency === 'GBP' ? '£' : currency === 'USD' ? '$' : currency === 'EUR' ? '€' : '';
  return `${sym}${Math.round(n / 1000)}k${sym ? '' : currency ? ` ${currency}` : ''}`;
}
