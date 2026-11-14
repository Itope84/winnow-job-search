import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CountryFacts, SourceEntry, StudyPrefs } from '@winnow/api';

/** Shipped data: country fact cards and the catalogue of scholarship pages and feeds. */
export const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../data');

/**
 * One page or feed Winnow knows about. `scheme`: a named scholarship; `university`: a university's own
 * awards page; `feed`: news of new calls (RSS); `erasmus`: the Erasmus Mundus catalogue.
 */
export interface CatalogueEntry {
  name: string;
  url: string;
  kind: 'scheme' | 'university' | 'feed' | 'erasmus';
  /** Where the study happens. Empty: anywhere. */
  countries: string[];
  /** Who may apply, in a few words. */
  who: string;
  /** Levels it funds. */
  level: string;
  note: string;
}

let countryCache: CountryFacts[] | null = null;
let catalogueCache: CatalogueEntry[] | null = null;

export function countries(): CountryFacts[] {
  countryCache ??= JSON.parse(
    readFileSync(join(DATA_DIR, 'countries.json'), 'utf8'),
  ) as CountryFacts[];
  return countryCache;
}

export function catalogue(): CatalogueEntry[] {
  catalogueCache ??= JSON.parse(
    readFileSync(join(DATA_DIR, 'scholarship-catalogue.json'), 'utf8'),
  ) as CatalogueEntry[];
  return catalogueCache;
}

export function countryFacts(name: string): CountryFacts | null {
  const n = name.trim().toLowerCase();
  return countries().find((c) => c.name.toLowerCase() === n) ?? null;
}

const REGIONS: Record<string, (c: CountryFacts) => boolean> = {
  europe: (c) => c.region === 'Europe',
  eu: (c) =>
    c.region === 'Europe' &&
    !['United Kingdom', 'Switzerland', 'Norway', 'Iceland'].includes(c.name),
  nordics: (c) => ['Sweden', 'Norway', 'Denmark', 'Finland', 'Iceland'].includes(c.name),
  scandinavia: (c) => ['Sweden', 'Norway', 'Denmark'].includes(c.name),
  'north america': (c) => c.region === 'North America',
};

/** The countries a region name stands for; empty when it isn't a region Winnow knows. */
export function regionCountries(name: string): string[] {
  const test = REGIONS[name.trim().toLowerCase()];
  return test
    ? countries()
        .filter(test)
        .map((c) => c.name)
    : [];
}

const lower = (s: string) => s.trim().toLowerCase();

/** Whether a catalogue entry suits someone: it studies somewhere they haven't excluded. */
export function entryFits(e: CatalogueEntry, study: StudyPrefs): boolean {
  if (!e.countries.length) return true;
  const excluded = new Set(
    study.places.exclude.flatMap((p) => {
      const r = regionCountries(p);
      return (r.length ? r : [p]).map(lower);
    }),
  );
  return e.countries.some((c) => !excluded.has(lower(c)));
}

/** A catalogue entry as a Find source: pages are watched, feeds are read. */
export function catalogueSource(e: CatalogueEntry): SourceEntry {
  if (e.kind === 'feed')
    return { name: e.name, provider: 'rss', api: e.url, enabled: true, notes: e.note };
  if (e.kind === 'erasmus')
    return {
      name: e.name,
      provider: 'erasmus-mundus',
      careers_url: e.url,
      enabled: true,
      notes: e.note,
    };
  return {
    name: e.name,
    provider: 'page',
    careers_url: e.url,
    kind: e.kind,
    countries: e.countries,
    enabled: true,
    notes: [e.who, e.note].filter(Boolean).join(' · '),
  };
}
