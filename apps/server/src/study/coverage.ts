import type {
  CountryCoverage,
  CoverageLayer,
  CoverageReport,
  CoverageRow,
  StudyPrefs,
} from '@winnow/api';
import type { Db } from '../db.ts';
import { getSources } from '../library.ts';
import { nowIso } from '../util.ts';
import { catalogue, countries, regionCountries } from './data.ts';

type Row = Record<string, unknown>;

/** Record that a scan looked at something, including when it found nothing. */
export function recordCoverage(
  db: Db,
  layer: CoverageLayer,
  target: string,
  out: { found: number; added: number; note?: string },
) {
  db.prepare(
    `INSERT INTO coverage (layer, target, checked_at, found, added, note) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(layer, target) DO UPDATE SET checked_at = excluded.checked_at, found = excluded.found,
       added = excluded.added, note = excluded.note`,
  ).run(layer, target, nowIso(), out.found, out.added, out.note ?? '');
}

const lower = (s: string) => s.trim().toLowerCase();

/** The countries a person's places name, with regions ("Europe") opened up into their countries. */
export function placeCountries(names: string[]): string[] {
  const out: string[] = [];
  for (const n of names) {
    const region = regionCountries(n);
    for (const c of region.length ? region : [n])
      if (!out.some((o) => lower(o) === lower(c))) out.push(c);
  }
  return out;
}

/** Where a country stands for this person. Exclusion wins; a region they prefer counts as preferred. */
export function stanceOf(study: StudyPrefs, country: string): CountryCoverage['stance'] {
  const has = (names: string[]) => placeCountries(names).some((c) => lower(c) === lower(country));
  if (has(study.places.exclude)) return 'exclude';
  if (has(study.places.prefer)) return 'prefer';
  if (has(study.places.allow)) return 'allow';
  return 'other';
}

/**
 * What the scans covered: every source with when it was last read and what it gave, and every country
 * with its fact card, how many open items it has and the best score. Open counts come from the jobs
 * table, so they stay right as items move.
 */
export function coverageReport(db: Db, study: StudyPrefs): CoverageReport {
  const openBy = (where: string, ...args: string[]) =>
    db
      .prepare(
        `SELECT COUNT(*) AS n, MAX(score) AS best FROM jobs WHERE list != 'archive' AND kind != 'job' AND ${where}`,
      )
      .get(...args) as Row;
  const stored = db
    .prepare('SELECT * FROM coverage ORDER BY layer, checked_at DESC')
    .all() as Row[];
  const rows: CoverageRow[] = stored
    .filter((r) => r.layer !== 'country')
    .map((r) => {
      const target = r.target as string;
      const open =
        r.layer === 'feed' ||
        r.layer === 'query' ||
        r.layer === 'scheme' ||
        r.layer === 'university'
          ? Number(openBy('sources LIKE ?', `%${target.replace(/[%_]/g, '')}%`).n)
          : 0;
      return {
        layer: r.layer as CoverageLayer,
        target,
        checkedAt: (r.checked_at as string | null) ?? null,
        found: Number(r.found),
        added: Number(r.added),
        open,
        note: r.note as string,
      };
    });
  const pasted = Number(openBy("added_by = 'you'").n);
  if (pasted)
    rows.push({
      layer: 'pasted',
      target: 'Links you added',
      checkedAt: null,
      found: pasted,
      added: pasted,
      open: pasted,
      note: '',
    });
  const countryRows = new Map(
    stored.filter((r) => r.layer === 'country').map((r) => [lower(r.target as string), r]),
  );
  const list: CountryCoverage[] = countries().map((facts) => {
    const row = countryRows.get(lower(facts.name));
    const o = openBy('location LIKE ?', `%${facts.name}%`);
    return {
      facts,
      stance: stanceOf(study, facts.name),
      checkedAt: (row?.checked_at as string | undefined) ?? null,
      open: Number(o.n),
      best: (o.best as number | null) ?? null,
      note: (row?.note as string | undefined) ?? '',
    };
  });
  const order = { prefer: 0, allow: 1, other: 2, exclude: 3 };
  // A country they named comes before the ones a region they named stands for.
  const named = new Set([...study.places.prefer, ...study.places.allow].map(lower));
  list.sort(
    (a, b) =>
      order[a.stance] - order[b.stance] ||
      Number(named.has(lower(b.facts.name))) - Number(named.has(lower(a.facts.name))) ||
      a.facts.name.localeCompare(b.facts.name),
  );
  const sources = getSources(db);
  const have = new Set(
    [...sources.companies, ...sources.boards].map((e) =>
      lower(String(e.careers_url ?? e.api ?? e.name)),
    ),
  );
  const missing = catalogue().filter((e) => !have.has(lower(e.url))).length;
  return { rows, countries: list, catalogue: missing };
}
